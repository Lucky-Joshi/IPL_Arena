# T20 Dynasty — Cross-service contract (v1)

Three separated services. **Only the Node backend owns auction state.** The Python service is a stateless
valuation/decision engine. The Next.js frontend is a read-and-command client.

| Service | Dir | Port | Stack | Responsibility |
|---|---|---|---|---|
| Frontend | `frontend/` | 3000 | Next.js (JS/JSX) | Setup, auction hall, war room, squads, results, voice narration |
| Backend | `backend/` | 4000 | Node 24, built-in `http` (zero deps) | Authoritative engine, validation, persistence, proceedings, season rules |
| AI | `ai/` | 5000 | Python 3 stdlib `http.server` (zero deps) | Private valuations, per-franchise bid decisions, public commentary |

Runner scripts live at the root (`run-all.cmd`, `verify.cmd`). `npm test` in `backend/` starts isolated
backend and AI processes and runs the smoke suite.

---

## 1. Shared enums and season registry

```js
SEASON = '2025' | '2026' | '2027'
FORMAT = 'MEGA' | 'MINI'          // derived from SEASON: 2025 Mega, 2026/2027 Mini
DIFFICULTY = 'RELAXED' | 'BALANCED' | 'HARD'
ROLE = 'BATTER' | 'BOWLER' | 'ALLROUNDER' | 'WICKETKEEPER'
AVAILABILITY = 'AVAILABLE' | 'SOLD' | 'UNSOLD' | 'INJURED' | 'WITHDRAWN'
PHASE = 'SETUP' | 'OPENING' | 'PLAYER_INTRODUCTION' | 'BIDDING' | 'GOING_ONCE'
      | 'GOING_TWICE' | 'RTM_OFFER' | 'RTM_COUNTER' | 'RTM_MATCH'
      | 'SOLD' | 'UNSOLD' | 'SET_BREAK' | 'STRATEGY_BREAK'
      | 'ACCELERATED_AUCTION' | 'FINAL_REVIEW' | 'COMPLETED'
STAGE_KIND = 'ANNOUNCEMENT' | 'SET' | 'BREAK' | 'ACCELERATED' | 'REVIEW'
```

Money is always a number in **crore INR** (e.g. `12.5` = ₹12.5 Cr). Display formatting is the frontend's job.

`backend/src/rules.js` is the **single source of truth** for BCCI financial and squad limits. User config may
only tune `tickMs`, `pace` and `minReservePerSlot` (plus an internal `maxAdditions` fallback); it cannot
override a BCCI limit. Exports: `SEASONS`, `SEASON_KEYS`, `resolveSeason`, `rulesFor`, `isMega`,
`basePriceForRating`, `matchFeeProjection`, `salarySplit`.

| Season | Format | Starting purse | Total salary cap | Overseas salary cap | Retentions | RTM cards | Marquee sets |
|---|---|---:|---:|---:|---|---:|---:|
| 2025 | MEGA | ₹120 Cr | ₹146 Cr | none (`0`) | ≤6 (≤5 capped, ≤2 uncapped) | 6 − direct retentions | 2 |
| 2026 | MINI | ₹125 Cr | ₹151 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | 0 | 0 |
| 2027 | MINI | ₹130 Cr | ₹157 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | 0 | 0 |

Shared: squad 18–25, max 8 overseas, 4 overseas in the XI including Impact Player, ₹7.5 lakh match fee per
playing member (₹12.6 Cr for 14 league matches), base prices ₹0.3–2 Cr by rating tier. `salarySplit(price,
isOverseas, season)` returns `{ bid, salary, welfare, capped }`: in a Mini, an overseas bid above ₹18 Cr
still debits the full bid but diverts the excess to `state.welfareFund`.

## 2. Authoritative state shape (`state.version === 1`)

```js
{
  version: 1,
  id: 'auc_...',
  createdAt: ISO, savedAt: ISO,
  format, season,                  // '2025' | '2026' | '2027'
  rules: { ...SEASONS[season] },
  difficulty,
  config: {
    startingPurse: 120, totalSalaryCap: 146, overseasSalaryCap: 0,
    minSquad: 18, maxSquad: 25, maxOverseas: 8,
    maxRetentions: 6, maxAdditions: 6, minReservePerSlot: 0,
    tickMs: 1000, pace: 'BROADCAST'  // FAST | BROADCAST | CINEMATIC
  },
  userFranchiseId: 'F1',
  phase: 'SETUP',
  retentionsConfirmed: false,
  clockRunning: true,
  stageIndex: 0,
  proceedings: [ { id, title, kind, status, playerIds } ],
  currentPlayerId: null,
  currentBid: 0,                   // first bid is at base price
  leaderId: null,
  activeBidderIds: [], withdrawnIds: [],
  bidHistory: [ { id, at, playerId, franchiseId, amount, previousBid, source } ],
  bidsThisLot: 0,
  rtm: null,                       // live Right to Match offer, see below
  rtmLog: [ { playerId, step, franchiseId, price } ],
  trades: [ Trade ],
  welfareFund: 0,
  matchFeeProjection: 12.6,
  phaseTicks: 0, stageTicks: 0, aiWaitTicks: 0, goingStage: 0, resultTicks: 0,
  playerCursor: 0, breakReturn: null, calledThisStage: [],
  nominations: [],                 // playerIds for the accelerated shortlist
  players: [ Player ],
  franchises: [ Franchise ],
  eventLog: [ { id, at, type, text, playerId?, franchiseId? } ],
  conversations: [ { id, at, franchiseId, author, text, tone } ],
  announcement: { id, text, kind },
  result: null                     // computed in FINAL_REVIEW
}
```

`Player`:
```js
{
  id, name, age, nationality, country, role, subtype, rating, basePrice,
  capped: boolean, contractFee: number, previousFranchiseId: string|null,
  battingStyle, bowlingStyle, stats: {...},
  experience, category, availability,
  soldTo, soldPrice, soldRound, salary, welfareContribution,
  auctionRoundBought: 'MEGA'|'MINI'|null, purchasedInMini: boolean,
  retained: boolean, retentionCost: number, retentionCandidate: boolean,
  injured: boolean, withdrawn: boolean, banUntilSeason: string|null,
  replacedBy: string|null, isRappReplacement: boolean
}
```

`Franchise`:
```js
{
  id, name, short, city, primary, secondary, owner, headCoach, directorCricket,
  strategist, analyst, scoutingHead,
  strategy: 'AGGRESSIVE'|'BALANCED'|'CONSERVATIVE'|'VALUE',
  purse, squad: [playerId], previousSquad: [playerId], existing: [playerId],
  retentions: [{ playerId, cost, capped, name, contractFee }],
  retentionSpent, additionsLimit, rtmCards, rtmUsed,
  overseasSalarySpend, welfareContribution,
  purchases: [{ playerId, price, salary, welfare, round, source }],
  rejected: [playerId], trades: [tradeId],
  targets, discussions, biddingStatus
}
```

### Bid rules (single source of truth = `backend/src/engine.js` + `validateBid`)

- Next bid: `<2` → `+0.25`; `2–10` → `+0.5`; `>10` → `+1`.
- First bid must be exactly `player.basePrice`; later bids exactly `currentBid + increment`.
- Same validation for human and AI: purse, squad/addition limit, overseas limit, min-squad reserve,
  withdrawn state, self-bid, player availability and phase.
- Only `engine.dispatch()` / `engine.tick()` may change purse, squad, contracts or availability.
- `biddingStatus` is derived UI state; it never authorises anything.
- RTM `bidHistory` entries use `source: 'RTM*'`; they are settlement records, not paddle raises.

### Retentions (`backend/src/retention.js`)

A player may only be retained by the franchise that held their previous-season contract
(`previousFranchiseId === franchise.id` and `retentionCandidate === true`). Released contracts enter the
shared auction pool. `SET_RETENTIONS` validates a whole selection against a reset clone; AI franchises use
`autoRetainAi`, which applies each **complete ordered plan at once** so capped slabs and RTM cards are
correct. `START` confirms an empty selection if the user has not picked one.

- **MEGA (2025):** at most 6 direct retentions, at most 5 capped and at most 2 uncapped. Capped picks cost
  ₹18 / ₹14 / ₹11 / ₹18 / ₹14 Cr in selection order; uncapped picks cost ₹4 Cr. `rtmCards = 6 − retentions`.
- **MINI (2026/2027):** no RTM and no fixed retention count; each retained player keeps `contractFee`.
  `additionsLimit` adapts to the retained squad size; `validateBid` enforces the per-franchise cap.
- Re-selection in `SETUP` restores all players and purses before applying the new picks.
- Retention spend is debited at confirmation and included in results; `purseSpent + purseRemaining =
  config.startingPurse` holds.

### Right to Match (2025 only)

When a sold player's previous franchise still holds an RTM card and was not the winning bidder, the lot
enters `RTM_OFFER` with `state.rtm = { playerId, originalFranchiseId, leaderFranchiseId, bid, usedCard,
price, log, ticks }`.

| Phase | Franchise | Actions |
|---|---|---|
| `RTM_OFFER` | previous franchise | `USE_RTM` (spends one card → `RTM_COUNTER`) or `PASS_RTM` (finalise sale to leader) |
| `RTM_COUNTER` | original + current leader | `RTM_RAISE` / `RTM_DECLINE`; AI decides on a tick |
| `RTM_MATCH` | previous franchise | `MATCH_RTM` (award at final price) or `PASS_RTM` (leader keeps the player) |

`USE_RTM` decrements `rtmCards` and increments `rtmUsed` exactly once; passing or matching does not.
`rtmLog` records each step, and the final sale goes through the ordinary salary split and purse debit.

### Trades, injuries and withdrawals (`backend/src/season-ops.js`)

- `PROPOSE_TRADE` creates an EOI with `status: 'PENDING_48H'` and `approval: 'AWAITING_PLAYER_CONSENT'`.
  It never moves a player. `RESPOND_TRADE` approves and executes player swaps / cash adjustments.
- Post-season window closes one week before the auction; no trades immediately before a Mega. Post-auction
  window opens the day after the auction; `purchasedInMini === true` players cannot be traded there.
- `INJURE_PLAYER` marks a player `INJURED`. `SIGN_INJURY_REPLACEMENT` signs a RAPP player within the injured
  player's salary and does not debit the purse.
- `PLAYER_WITHDRAW` with `certifiedInjury: false` marks the player `WITHDRAWN`, removes them from the squad
  and sets `banUntilSeason` two seasons ahead (2026 → 2028).

## 3. Proceedings

Proceedings are season-aware (`backend/src/proceedings.js`). The 2025 Mega includes opening ceremony,
lead auctioneer welcome, franchise introductions, rules briefing, **two marquee sets**, role sets, strategy
break, accelerated auction, final opportunities, unsold review, verification and closing ceremony. The 2026
and 2027 Mini campaigns drop the marquee sets and use mini-specific announcements and rules copy.

`ANNOUNCEMENT` stages auto-advance after a few ticks or on `CONTINUE`. `BREAK` stages only advance on
`RESUME_BREAK`. `SET` stages iterate `playerIds`. `ACCELERATED` stages re-offer `UNSOLD` players and user
nominations with phase `ACCELERATED_AUCTION`. `REVIEW` calls `computeResults(state)` and sets `COMPLETED`.

## 4. Node backend HTTP API (port 4000)

CORS enabled (`*`), JSON body up to 1 MB.

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{ ok:true, ai:{ok:boolean}, hasSave:boolean }` |
| GET | `/api/auction/state` | `{ state: State|null, hasSave:boolean, saveError?:string }` |
| POST | `/api/auction` | `{ ok:true, state:State, error?:null }` or `{ ok:false, error:string, state:State }` |
| GET | `/api/results` | `{ ok:true, results:Results }` |

POST body: `{ action: string, ...payload }`. Every action goes through `engine.dispatch`; the HTTP layer
never edits purses or squads directly.

Actions:
`CREATE` (`season, format, difficulty, userFranchiseId, config?`), `SET_RETENTIONS` (`playerIds`; `SETUP`
only; human franchise only), `START`, `CONTINUE`, `OPEN_BIDDING`, `BID` (`franchiseId`, `amount`),
`WITHDRAW` (`franchiseId`), `USE_RTM`, `PASS_RTM`, `RTM_RAISE`, `RTM_DECLINE`, `MATCH_RTM`
(`franchiseId`), `PROPOSE_TRADE` (`fromFranchiseId, toFranchiseId, givePlayerIds, cash?, window?,
autoRespond?`), `RESPOND_TRADE` (`tradeId, accept`), `INJURE_PLAYER` (`playerId`),
`SIGN_INJURY_REPLACEMENT` (`injuredPlayerId, replacementPlayerId, fee`), `PLAYER_WITHDRAW` (`playerId,
certifiedInjury`), `CALL_BREAK`, `RESUME_BREAK`, `NEXT`, `PAUSE`, `UNPAUSE`, `NOMINATE` (`playerId,
selected`), `MEETING`, `RESET`.

A `BID` is accepted as soon as a player is on the block; a bid in `PLAYER_INTRODUCTION` or
`ACCELERATED_AUCTION` opens the floor first, then uses the same `validateBid` check as AI bids. Human RTM
decisions must name `state.userFranchiseId`; AI RTM decisions are resolved on `tick()`.

### Auction pace

| Pace | Introduction | Bidding call | Going once | Going twice | AI reaction |
|---|---:|---:|---:|---:|---:|
| `FAST` | 1s | 1s | 1s | 1s | immediate |
| `BROADCAST` | 5s | 5s | 5s | 4s | 2s |
| `CINEMATIC` | 8s | 7s | 7s | 6s | 3s |

`BROADCAST` is the default. The frontend mirrors these dwell times for its countdown; the backend remains
authoritative for phase transitions.

### Results (`GET /api/results`)

`computeResults(state)` returns:

```js
{
  generatedAt, season, seasonLabel, format, rules: {...}, matchFeeProjection, welfareFund,
  totalAuctionSpending, totalRetentionSpending, cappedRetentions, uncappedRetentions,
  rtmUsed, trades, tradeWindows, injuries, soldCount, unsoldCount,
  biggestPurchases, bestValue, unsold,
  franchises: [{
    id, name, short, primary, owner, rank,
    purseSpent, purseRemaining, salaryCap, salaryHeadroom,
    overseasSalaryCap, overseasSalarySpend, overseasSalaryHeadroom,
    retentionCount, retentionSpent, retentionCappedCount, retentionUncappedCount,
    playerCount, existingCount, purchasedCount, overseasCount,
    rtmCards, rtmUsed, tradeCount, welfareContribution,
    roleCounts, squad: [{...player, source:'EXISTING'|'PURCHASED', price}],
    balanceScore, rankReason
  }]
}
```

Money fields use two-decimal precision so per-team totals stay additive. A retained player has
`source: 'EXISTING'` and its price is the retention cost (Mega slab or existing Mini contract fee).

Persistence: `backend/data/auction-state.json`, atomic write (temp + rename) after every mutation. Load
validates `version`, array shapes, unique player ids, no duplicate sold ownership, numeric purses and
normalises season/rules. Corrupt save → `saveError`, keep the file, no silent reset. Clear old saves before
moving from custom rules to BCCI seasons; older states contain superseded fields.

`backend/src/engine.js` exports `AuctionEngine` (`create`, `fromState`, `attach`, `getState`, `dispatch`,
`tick`), `getNextBid`, `validateBid`, `computeResults` re-export, `SEASONS`, `rulesFor`, `salarySplit`,
`matchFeeProjection`, `PACE_TICKS`, `PACE_NAMES`.

`backend/src/aiClient.js` exports `createAiClient({ url })` with `decide(ctx)`, plus a `fallbackDecide`
heuristic when the AI service is unreachable. Private `privateReason` never reaches the engine or UI.

## 5. Python AI service (port 5000, stdlib only)

`ai/server.py` — `ThreadingHTTPServer`; `GET /health`, `POST /decide`, `OPTIONS` for CORS.

Request body (extends the earlier contract with BCCI context):

```json
{
  "requestId": "req-...", "difficulty": "BALANCED", "format": "MEGA", "season": "2025",
  "rules": { "totalSalaryCap": 146, "overseasSalaryCap": 0, "rtmAvailable": true, "matchFee": 0.075 },
  "config": { "startingPurse": 120, "minSquad": 18, "maxSquad": 25, "maxOverseas": 8,
              "minReservePerSlot": 0.2, "overseasSalaryCap": 0 },
  "player": { "id": "P001", "role": "BATTER", "category": "BATTER", "rating": 78, "age": 27,
              "nationality": "India", "capped": true, "contractFee": 6.5,
              "previousFranchiseId": "F7", "basePrice": 2, "stats": {} },
  "auction": { "currentBid": 2, "nextBid": 2.5, "leaderId": "F3", "bidsThisLot": 1,
               "stageKind": "SET", "accelerated": false, "rtm": null,
               "availableByRole": {"BATTER": 12} },
  "self": { "id": "F1", "purse": 34.5, "squad": [], "additionsUsed": 2, "maxAdditions": 6,
            "overseasCount": 2, "overseasSalarySpend": 12, "rtmCards": 4,
            "strategy": "BALANCED", "isLeader": false, "withdrawn": false, "rejected": [] },
  "others": [ {"id": "F2", "purse": 20, "squadSize": 17, "overseasCount": 5} ]
}
```

Response: `{ action: 'BID'|'PASS'|'WITHDRAW', amount, confidence, publicComment, privateReason }`.
`privateReason` stays inside the AI service. `BID.amount` must equal `auction.nextBid`. Valuations account
for capped/uncapped status and contract fees, season rules, overseas salary cap, RTM context, role gaps,
age, strategy and pool scarcity; the backend independently validates every decision.

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
frontend/lib/format.js            ₹ crore formatting, season/RTM/retention helpers
```

Setup offers the 2025/2026/2027 season picker with the BCCI rules board, then a retention picker limited to
that franchise's own previous-season contracts. The review step shows capped/uncapped counts, slab costs,
RTM cards and every rival's plan. `BidPanel` exposes live RTM controls (`USE_RTM`, `PASS_RTM`, `RTM_RAISE`,
`RTM_DECLINE`, `MATCH_RTM`) when the human franchise is on the clock. `ResultsView` reports the salary cap,
overseas salary/welfare split, RTM usage, trades and injury/withdrawal entries.

`lib/api.js`: `getState()`, `postAction(action, payload)`, `getResults()`, `getHealth()`, with
`NEXT_PUBLIC_API_URL` fallback `http://localhost:4000`. Voice narration is optional and watches
`state.announcement.id`.

## 7. Deliverable boundaries

- `ai/` agent: only files inside `ai/`.
- `backend/` agent(s): only files inside `backend/`.
- `frontend/` agent: only files inside `frontend/`.
- Root-level runner scripts, README and integration fixes are handled by the orchestrator.
