# IPL Auction Arena — Cross-service contract (v1)

Three separated services. **Only the Node backend owns auction state.** The Python service is a stateless
valuation/decision engine. The Next.js frontend is a read-and-command client.

| Service | Dir | Port | Stack | Responsibility |
|---|---|---:|---|---|
| Frontend | `frontend/` | 3000 | Next.js (JS/JSX) | Setup, auction room, war room, squads, results, voice narration |
| Backend | `backend/` | 4000 | Node 24, built-in `http` (zero deps) | Authoritative engine, validation, persistence, proceedings, event log |
| AI | `ai/` | 5000 | Python 3 stdlib `http.server` (zero deps) | Private valuations, per-franchise bid decisions, public commentary |

Scripts (to be added at root later):
- `run-backend.cmd` / `run-ai.cmd` / `run-frontend.cmd`
- `npm test` equivalent: `node backend/scripts/smoke-test.js` (starts backend + ai itself)

---

## 1. Shared enums

```js
FORMAT   = 'MEGA' | 'MINI'
DIFFICULTY = 'RELAXED' | 'BALANCED' | 'HARD'
ROLE     = 'BATTER' | 'BOWLER' | 'ALLROUNDER' | 'WICKETKEEPER'
CATEGORY = 'MARQUEE' | 'BATTER' | 'ALLROUNDER' | 'WICKETKEEPER' | 'BOWLER' | 'ACCELERATED'
AVAILABILITY = 'AVAILABLE' | 'SOLD' | 'UNSOLD'
PHASE = 'SETUP' | 'OPENING' | 'PLAYER_INTRODUCTION' | 'BIDDING' | 'GOING_ONCE'
      | 'GOING_TWICE' | 'SOLD' | 'UNSOLD' | 'SET_BREAK' | 'STRATEGY_BREAK'
      | 'ACCELERATED_AUCTION' | 'FINAL_REVIEW' | 'COMPLETED'
STAGE_KIND = 'ANNOUNCEMENT' | 'SET' | 'BREAK' | 'ACCELERATED' | 'REVIEW'
```

Money is always a number in **crore INR** (e.g. `12.5` = ₹12.5 Cr). Display formatting is the frontend's job.

## 2. Authoritative state shape (`state.version === 1`)

```js
{
  version: 1,
  id: 'auc_...',
  createdAt: ISO, savedAt: ISO,
  format, difficulty,
  config: {
    startingPurse: 120, minSquad: 18, maxSquad: 25, maxOverseas: 8,
    maxAdditions: 6,          // MINI only; MEGA uses maxSquad
    maxRetentions: 3,         // MEGA max 3, MINI max 15; zero is always allowed
    minReservePerSlot: 0.2,   // reserve for remaining minimum squad slots
    tickMs: 1000,
    pace: 'BROADCAST'         // FAST | BROADCAST | CINEMATIC
  },
  userFranchiseId: 'F1',
  phase: 'SETUP',
  retentionsConfirmed: false, // true after SET_RETENTIONS or START auto-confirm
  clockRunning: true,
  stageIndex: 0,
  proceedings: [
    { id, title, kind: STAGE_KIND, status: 'PENDING'|'ACTIVE'|'DONE', playerIds: [] }
  ],
  currentPlayerId: null,
  currentBid: 0,               // 0 before the first bid; first bid is at base price
  leaderId: null,
  activeBidderIds: [],         // franchises that have bid in this lot and are still in
  withdrawnIds: [],            // terminal for this lot — cannot re-enter
  bidHistory: [ { id, at, playerId, franchiseId, amount, previousBid, source: 'HUMAN'|'AI' } ],
  bidsThisLot: 0,
  phaseTicks: 0,               // ticks spent in the current auctioneer call
  aiWaitTicks: 0,              // reaction delay before AI franchises answer
  nominations: [],             // playerIds nominated for accelerated round
  players: [ Player ],
  franchises: [ Franchise ],
  eventLog: [ { id, at, type, text, playerId?, franchiseId? } ],
  conversations: [ { id, at, franchiseId, author, text, tone } ],
  announcement: { id, text, kind },  // watched by voice narration
  result: null                 // computed when COMPLETED
}
```

`Player`:
```js
{
  id: 'P001', name, age, nationality: 'India'|'Australia'|'England'|..., country,
  role: ROLE, subtype, rating: 1..100, basePrice,
  battingStyle, bowlingStyle: string|null,
  stats: { matches, runs, average, strikeRate, highestScore, hundreds, fifties,
           wickets, bowlingAverage, economy, bestFigures },
  experience, category: CATEGORY, availability: AVAILABILITY,
  soldTo: null|franchiseId, soldPrice: null|number, soldRound: null|'MAIN'|'ACCELERATED',
  retained: boolean,              // true once picked as a retention (any franchise)
  retentionCost: number,          // rating-slab cost stamped at retention time, 0 otherwise
  retentionCandidate: boolean     // MINI "existing player" pool (R0xx ids) only
}
```

`Franchise`:
```js
{
  id: 'F1', name, short, city, primary, secondary,
  owner, headCoach, directorCricket, strategist, analyst, scoutingHead,
  strategy: 'AGGRESSIVE'|'BALANCED'|'CONSERVATIVE'|'VALUE',
  purse, squad: [playerId],
  existing: [playerId],          // retained ids (kept for UI/results compatibility)
  retentions: [{ playerId, cost, rating, name }],  // user + AI picks, costed
  retentionSpent: number,        // sum of retention costs, already debited from purse
  additionsLimit: number,        // MINI: 6 (or minSquad - retained), MEGA: maxSquad
  purchases: [{ playerId, price, round }], rejected: [playerId],
  targets: [ROLE], discussions: [{ at, author, text, tone }],
  biddingStatus: 'IDLE'|'ACTIVE'|'LEADING'|'WITHDRAWN'
}
```

Rules (single source of truth = `backend/src/engine.js`):
- Next bid: `<1` → `+0.25`; `1–2` → `+0.25`; `2–5` → `+0.5`; `5–10` → `+0.5`; `>10` → `+1`.
- First bid on a lot must be exactly `player.basePrice`. Later bids exactly `currentBid + increment`.
- Same validation for human and AI: purse, squad/addition limit, overseas limit, min-squad reserve,
  withdrawn state, self-bid, player availability, phase.
- Only `engine.dispatch({type:'BID'})` and `engine.tick()` may change purse/squad/availability.
- `biddingStatus` is derived state for UI; it never authorises anything.

### Retentions (`backend/src/retention.js`)

Both formats begin with empty squads and unset retentions. During `SETUP` the human franchise selects its
picks with `SET_RETENTIONS`; the nine AI franchises then auto-retain from what remains, round-robin, scored
on rating, target roles, role need, value and strategy. `START` confirms an empty selection if the user has
not already done so, so starting from zero is always legal.

- Cap: MEGA `maxRetentions = 3`, MINI `maxRetentions = 15`; zero picks allowed in both.
- Pool: MEGA uses the main `AVAILABLE` pool; MINI restricts picks to `retentionCandidate === true` (the
  150 R0xx "existing player" candidates), keeping the main pool for the auction additions.
- Cost by rating slab, debited from `purse` at confirmation: `90+ → ₹5 Cr`, `85–89 → ₹4`, `80–84 → ₹3`,
  `75–79 → ₹2`, `70–74 → ₹1.5`, `<70 → ₹1`. Every pick is stamped `retained = true`,
  `availability = 'SOLD'`, `soldTo = franchiseId`, `soldPrice = 0`, `retentionCost = cost`, and added to
  `squad`, `existing` and `retentions`.
- Re-selecting in `SETUP` resets all ten franchises (players and purses restored) before applying the new
  selection and recomputing the AI picks. A rejected/invalid selection leaves the current setup untouched.
- MINI `additionsLimit = min(maxSquad - retained, max(maxAdditions, minSquad - retained))`; with zero
  retentions this is `minSquad`, with 15 it is `maxAdditions`. MEGA `additionsLimit = maxSquad`.
  `validateBid` and discussion copy use this per-franchise cap, not the global config value.
- Retention spend is included in results: `purseSpent + purseRemaining = config.startingPurse` always holds.

## 3. Proceedings

Mega (15 stages): opening-ceremony, auctioneer-welcome, franchise-introductions, rules-briefing,
marquee-set, batter-set, allrounder-set, wicketkeeper-set, bowler-set, strategy-break,
accelerated-auction, final-opportunities, unsold-review, verification, closing-ceremony.

Mini (11 stages): existing-squad-analysis, mini-welcome, mini-rules, batter-set, allrounder-set,
wicketkeeper-set, bowler-set, strategy-break, accelerated-auction, verification, closing-ceremony.

`ANNOUNCEMENT` stages auto-advance after ~4 s of ticks or on `CONTINUE`. `BREAK` stages never auto-advance;
only `RESUME_BREAK`. `SET` stages iterate `playerIds` in order. `ACCELERATED` stages use all `UNSOLD`
players (plus user nominations already unsold) and set phase `ACCELERATED_AUCTION`. `REVIEW` computes
`state.result` then sets `COMPLETED`.

## 4. Node backend HTTP API (port 4000)

CORS enabled (`*`), JSON body up to 1 MB.

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok:true, ai:{ok:boolean}, hasSave:boolean }` |
| GET | `/api/auction/state` | `{ state: State|null, hasSave:boolean, saveError?:string }` |
| POST | `/api/auction` | `{ ok:true, state:State, error?:null }` or `{ ok:false, error:string, state:State }` |
| GET | `/api/results` | `{ ok:true, results:Results }` |

POST body: `{ action: string, ...payload }`.

Actions (all go through `engine.dispatch`, never direct state edits):
`CREATE` (payload `format, difficulty, userFranchiseId, config?`), `SET_RETENTIONS` (`playerIds`,
`SETUP` only, human franchise only), `START`, `CONTINUE`, `OPEN_BIDDING`,
`BID` (`franchiseId`; user actions must match `state.userFranchiseId`), `WITHDRAW` (`franchiseId`),
`CALL_BREAK`, `RESUME_BREAK`, `NEXT`, `PAUSE`, `UNPAUSE`, `NOMINATE` (`playerId`, `selected`),
`MEETING`, `RESET`.

`SET_RETENTIONS` validates the whole selection against a reset clone first; on success it applies the
human picks, auto-retains the nine AI teams, debits every purse and returns
`{ ok:true, retentions, retentionSpent, additionsLimit }`. `START` calls the same path with `[]` if
`retentionsConfirmed` is still false. The HTTP layer rejects any `SET_RETENTIONS` request whose
`franchiseId` is not `state.userFranchiseId`.

`BID` is accepted as soon as a player is on the block. A bid in `PLAYER_INTRODUCTION` or
`ACCELERATED_AUCTION` opens the floor first, then applies the same `validateBid` check used for AI bids.
The engine records the human bid and the auctioneer's `BIDDING_OPEN` event in that order.

### Auction pace

`config.pace` controls how many engine ticks each auctioneer call lasts. At the default `tickMs: 1000`:

| Pace | Introduction | Bidding call | Going once | Going twice | AI reaction |
|---|---:|---:|---:|---:|---:|
| `FAST` | 1s | 1s | 1s | 1s | immediate |
| `BROADCAST` | 5s | 5s | 5s | 4s | 2s |
| `CINEMATIC` | 8s | 7s | 7s | 6s | 3s |

`FAST` exists for automated tests. `BROADCAST` is the default because it gives a human time to read the
lot, watch rivals hesitate, and raise a paddle before the hammer falls. The frontend mirrors these dwell
times to display a countdown; the backend remains authoritative for phase transitions.

`GET /api/results` returns the object from `computeResults(state)`:
```js
{
  generatedAt, format, totalAuctionSpending, totalRetentionSpending, soldCount, unsoldCount,
  biggestPurchases: [{playerId,name,price,franchiseId,franchiseName}],
  bestValue: [{playerId,name,price,rating,franchiseId,valueScore}],
  unsold: [Player],
  franchises: [{
    id, name, short, primary, owner,
    purseSpent, purseRemaining,          // purseSpent includes retention spend
    playerCount, existingCount, purchasedCount, retentionCount, retentionSpent, overseasCount,
    roleCounts: {BATTER,BOWLER,ALLROUNDER,WICKETKEEPER},
    squad: [{...player, source:'EXISTING'|'PURCHASED', price}],  // retained players carry their retention cost
    balanceScore, rank, rankReason
  }]
}
```

`totalAuctionSpending` covers auction purchases **plus** retention spend; `totalRetentionSpending` isolates
the retention portion. A retained player keeps `source: 'EXISTING'` for UI compatibility but its `price`
is its rating-slab cost (not zero).
```

Persistence: `backend/data/auction-state.json`, atomic write (temp + rename) after every mutation.
Load validates `version`, array shapes, unique player ids, no duplicate sold ownership, numeric purses.
Corrupt save → report `saveError`, keep file for inspection, no silent reset.

`backend/src/engine.js` must export:
```js
class AuctionEngine {
  static create({format, difficulty, userFranchiseId, config}) -> AuctionEngine
  static fromState(state) -> AuctionEngine   // throws on invalid
  constructor(state, { aiClient, persist })   // persist(state) called after mutations
  getState() -> plain JSON-serialisable state (clone)
  dispatch(action) -> { ok:boolean, error?:string }   // sync actions
  async tick() -> { changed:boolean }                // called every config.tickMs by server
}
export function getNextBid(state) -> number
export function validateBid(state, franchiseId, amount) -> { ok:boolean, error?:string }
export function computeResults(state) -> Results
export const PACE_TICKS, PACE_NAMES
```

`backend/src/aiClient.js` exports `createAiClient({ url })` with `decide(ctx) -> decision object`; graceful
fallback heuristic if the AI service is unreachable (so the auction never deadlocks), logged to stderr.

`backend/src/discussion.js` exports `addContextualDiscussion(state, franchiseId, trigger)` and
`publicAiComment(decision)` helpers. Comments must reference real role gaps / purse / player pool.

## 5. Python AI service (port 5000, stdlib only)

`ai/server.py` — `ThreadingHTTPServer`, routes:
- `GET /health` → `{ "ok": true, "version": 1, "service": "ipl-auction-ai" }`
- `POST /decide` → decision JSON
- `OPTIONS` → CORS headers

Request body:
```json
{
  "requestId": "string",
  "difficulty": "BALANCED",
  "format": "MEGA",
  "config": { "maxSquad": 25, "maxOverseas": 8, "minReservePerSlot": 0.2 },
  "player": { "id":"P001", "role":"BATTER", "category":"BATTER", "rating":78, "age":27,
              "nationality":"India", "basePrice":2, "stats": {...} },
  "auction": { "currentBid": 2, "nextBid": 2.5, "leaderId":"F3", "bidsThisLot":1,
               "stageKind":"SET", "accelerated":false, "availableByRole":{"BATTER":12} },
  "self": { "id":"F1", "purse":34.5, "squad":[{"role":"BATTER","nationality":"India","rating":76,"source":"EXISTING"}],
            "additionsUsed":2, "maxAdditions":6,   // franchise.additionsLimit (retention-adjusted)
            "overseasCount":3,
            "strategy":"BALANCED", "isLeader":false, "withdrawn":false,
            "rejected":[ "P004" ] },
  "others": [ {"id":"F2","purse":20,"squadSize":17,"overseasCount":5} ]
}
```
Response (private fields stay in the AI service; backend must strip `privateReason` before UI):
```json
{
  "action": "BID" | "PASS" | "WITHDRAW",
  "amount": 2.5,
  "confidence": 0.72,
  "publicComment": "He strengthens the middle order — we can stretch to this.",
  "privateReason": "valuation 8.4cr / remaining slots 4"
}
```
Rules: `BID.amount` must equal `auction.nextBid`. Multiple franchises must be able to want the same player;
withdrawal is decided per franchise from its own ceiling. Hard = stronger role-gap analysis, competition
awareness and financial discipline; Relaxed = conservative. Never bid beyond purse/limits (backend also
validates). AI must NOT bid on every player; role gaps, quality already at that role, age, category,
overseas slots, alternatives in pool, reserve for remaining slots and strategy must matter.

## 6. Frontend (Next.js App Router, JavaScript)

```
frontend/app/layout.jsx           root shell + TopBar + narration provider
frontend/app/page.jsx             setup / resume
frontend/app/auction/page.jsx     live room (polling state every 800ms)
frontend/app/results/page.jsx     final review
frontend/app/globals.css          dark charcoal + gold broadcast theme
frontend/components/*.jsx         SetupScreen, AuctionRoom, AuctioneerPodium, PlayerCard,
                                  BidPanel, FranchiseFloor, EventFeed, ManagementRoom,
                                  SquadManager, ProceedingsPanel, BreakOverlay, ResultsView, TopBar
frontend/lib/api.js               fetch helpers against http://localhost:4000
frontend/lib/narration.js         speechSynthesis wrapper
frontend/lib/format.js            ₹ crore formatting, role labels, colours, retention helpers
```

Setup flow: `CREATE` leaves retentions unset and immediately opens a two-step modal. Step 1 is the retention
picker (role filters, running rating-slab cost, projected purse, explicit "start with 0" action) which posts
`SET_RETENTIONS`. Step 2 reviews every franchise's retentions and spend before `START`. "Change retentions"
returns to step 1 and resubmits, which resets and recomputes all ten squads. `format.js` exposes
`retentionCost`, `retentionLimit` and `squadLimit(state, franchise)` so the bid panel,
break overlay, management room, franchise floor and squad inspector all respect the per-franchise cap.

`lib/api.js`: `getState()`, `postAction(action, payload)`, `getResults()`, `getHealth()`, with
`NEXT_PUBLIC_API_URL` fallback `http://localhost:4000`. All actions call POST and then re-read state.

Voice: `useAuctioneerVoice(state)` watches `state.announcement.id`; enabled/muted flags in localStorage;
fully optional, no paid APIs, app works without speechSynthesis.

## 7. Deliverable boundaries

- `ai/` agent: only files inside `ai/`.
- `backend/` agent(s): only files inside `backend/`.
- `frontend/` agent: only files inside `frontend/`.
- Root-level runner scripts, README and integration fixes are handled by the orchestrator.
