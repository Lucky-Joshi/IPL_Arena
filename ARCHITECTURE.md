# T20 Dynasty — Cross-service contract (v1)

Three separated services. **Only the Node backend owns auction state.** The Python service is a stateless
valuation/decision engine. The Next.js frontend is a read-and-command client.

Every rule is fictional. The **League Control Board (LCB)** is the invented governing body; a **Franchise
Clawback (CLAW)** is the invented retention claim used in the 2025 Mega Auction.

| Service | Dir | Port | Stack | Responsibility |
|---|---|---|---|---|
| Frontend | `frontend/` | 3000 | Next.js (JS/JSX) | Setup, auction hall, war room, Trade Desk, squads, results, voice narration |
| Backend | `backend/` | 4000 | Node 24, built-in `http` (zero deps) | Authoritative engine, validation, persistence, proceedings, season rules, LCB trading and integrity |
| AI | `ai/` | 5000 | Python 3 stdlib `http.server` (zero deps) | Private valuations, live-lot bid decisions, public commentary (no off-auction trade decisions) |

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
      | 'GOING_TWICE' | 'CLAW_OFFER' | 'CLAW_COUNTER' | 'CLAW_MATCH'
      | 'SOLD' | 'UNSOLD' | 'SET_BREAK' | 'STRATEGY_BREAK'
      | 'ACCELERATED_AUCTION' | 'FINAL_REVIEW' | 'COMPLETED'
STAGE_KIND = 'ANNOUNCEMENT' | 'SET' | 'BREAK' | 'ACCELERATED' | 'REVIEW'
DEAL_TYPE = 'ALL_CASH' | 'PLAYER_SWAP' | 'CASH_PLUS_PLAYER'
TRADE_STATUS = 'PENDING_48H' | 'AWAITING_CONSENT' | 'LCB_REVIEW' | 'APPROVED'
            | 'REJECTED' | 'EXPIRED' | 'VETOED'
TRADE_APPROVAL = 'EOI_SUBMITTED' | 'AWAITING_PLAYER_CONSENT' | 'LCB_REVIEW'
              | 'LCB_APPROVED' | 'LCB_REJECTED' | 'NOT_APPROVED'
CONSENT = 'PENDING' | 'GRANTED' | 'DENIED'
```

Money is always a number in **crore INR** (e.g. `12.5` = ₹12.5 Cr). Display formatting is the frontend's job.

`backend/src/rules.js` is the **single source of truth** for LCB financial and squad limits. User config may
only tune `tickMs`, `pace` and `minReservePerSlot` (plus an internal `maxAdditions` fallback); it cannot
override a LCB limit. Exports: `SEASONS`, `SEASON_KEYS`, `resolveSeason`, `rulesFor`, `isMega`,
`basePriceForRating`, `matchFeeProjection`, `salarySplit`.

| Season | Format | Starting purse | Total salary cap | Overseas salary cap | Retentions | CLAW cards | Marquee sets |
|---|---|---:|---:|---:|---|---:|---:|
| 2025 | MEGA | ₹120 Cr | ₹146 Cr | none (`0`) | ≤6 (≤5 capped, ≤2 uncapped) | 6 − direct retentions | 2 |
| 2026 | MINI | ₹125 Cr | ₹151 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | 0 | 0 |
| 2027 | MINI | ₹130 Cr | ₹157 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | 0 | 0 |

Shared: squad 18–25, max 8 overseas, 4 overseas in the XI including X-Factor Substitute, ₹7.5 lakh match fee per
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
  claw: null,                       // live Franchise Clawback offer, see below
  clawLog: [ { playerId, step, franchiseId, price } ],
  trades: [ Trade ],                 // authoritative LCB EOI ledger
  tamperingCases: [ TamperingCase ],  // integrity allegations + rulings
  lcbTradeRevenue: 0,                // cumulative off-purse transfer-fee share
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

`Trade` (append-only EOI record; `status` is the protocol stage, `approval` is the LCB decision label):
```js
{
  id: 'trade_001',
  type: 'ALL_CASH' | 'PLAYER_SWAP' | 'CASH_PLUS_PLAYER',
  fromFranchiseId, toFranchiseId,
  givePlayerIds: [playerId], getPlayerIds: [playerId],
  valueGiven, valueGot,             // exact fixed-fee sums
  cash,                             // magnitude of the settlement
  cashAdjustment,                   // signed from the proposer's view: + = proposer pays
  transferFee: null | {
    total, playerSharePct, lcbCut, playerAmount, sellerAmount,
    payerId, sellerId, players: [{ playerId, amount }]
  },
  window: 'POST_SEASON' | 'POST_AUCTION',
  status, approval,
  createdAt, respondBy, consentBy, executedAt,
  consents: { [playerId]: CONSENT },
  timeline: [{ at, status, note }],
  rejectionReason?: string
}
```

`TamperingCase`:
```js
{
  id: 'tamper_001', franchiseId, playerId, details,
  status: 'REPORTED' | 'UPHELD' | 'DISMISSED', at,
  ruling?: { upheld, fine, banSeasons, at }
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
  replacedBy: string|null, isRppReplacement: boolean,
  consentWithheld: boolean, tamperingBan: boolean,
  traded: boolean,
  tradeHistory: [{ tradeId, from, to, at, fee }],
  transferFeeEarned: number
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
  retentionSpent, additionsLimit, clawCards, clawUsed,
  overseasSalarySpend, welfareContribution,
  purchases: [{ playerId, price, salary, welfare, round, source }],
  rejected: [playerId],
  trades: [{ playerId, direction: 'IN'|'OUT', with: franchiseId, tradeId }],
  tradedIn: [{ playerId, fee, tradeId }],
  tradedOut: [{ playerId, fee, tradeId }],
  tradeCashDelta: number,          // cash received is positive; paid is negative
  transferFeeEarned: number,
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
- CLAW `bidHistory` entries use `source: 'CLAW*'`; they are settlement records, not paddle raises.

### Retentions (`backend/src/retention.js`)

Each franchise starts SETUP with a distinct 15-player `previousSquad` from the 150 `R###` candidates
(non-overlapping across all ten teams). A player may only be retained by the franchise that holds their
previous-season contract (`previousFranchiseId === franchise.id` and `retentionCandidate === true`). Released
contracts enter the shared auction pool. Pre-retention trades move contracts between `previousSquad` lists and
update `previousFranchiseId`, so CLAW/retention eligibility follows the new owner. `SET_RETENTIONS` validates a
whole selection against a reset clone; AI franchises use
`autoRetainAi`, which applies each **complete ordered plan at once** so capped slabs and CLAW cards are
correct. `START` confirms an empty selection if the user has not picked one.

- **MEGA (2025):** at most 6 direct retentions, at most 5 capped and at most 2 uncapped. Capped picks cost
  ₹18 / ₹14 / ₹11 / ₹18 / ₹14 Cr in selection order; uncapped picks cost ₹4 Cr. `clawCards = 6 − retentions`.
- **MINI (2026/2027):** no CLAW and no fixed retention count; each retained player keeps `contractFee`.
  Overseas picks must also fit the ₹18 Cr overseas salary ceiling — `buildRetentionPlan` rejects an
  over-cap selection and the AI picker filters such players. `additionsLimit` adapts to the retained squad
  size; `validateBid` enforces the per-franchise cap.
- Re-selection in `SETUP` restores all players and purses before applying the new picks.
- Retention spend is debited at confirmation and included in results; `purseSpent + purseRemaining =
  config.startingPurse` holds.

### Franchise Clawback (2025 only)

When a sold player's previous franchise still holds a CLAW card and was not the winning bidder, the lot
enters `CLAW_OFFER` with `state.claw = { playerId, originalFranchiseId, leaderFranchiseId, bid, usedCard,
price, log, ticks }`.

| Phase | Franchise | Actions |
|---|---|---|
| `CLAW_OFFER` | previous franchise | `USE_CLAW` (spends one card → `CLAW_COUNTER`) or `PASS_CLAW` (finalise sale to leader) |
| `CLAW_COUNTER` | original + current leader | `CLAW_RAISE` / `CLAW_DECLINE`; AI decides on a tick |
| `CLAW_MATCH` | previous franchise | `MATCH_CLAW` (award at final price) or `PASS_CLAW` (leader keeps the player) |

`USE_CLAW` decrements `clawCards` and increments `clawUsed` exactly once; passing or matching does not.
`clawLog` records each step, and the final sale goes through the ordinary salary split and purse debit.

### LCB trading (`backend/src/season-ops.js`, `backend/src/trade-ai.js`)

`activeTradeWindow(state)` is the only source of truth for the open window; a `window` value in an action
body is ignored. `SETUP` is `POST_SEASON` for **every** season, before retentions are finalized; `FINAL_REVIEW`
and `COMPLETED` are `POST_AUCTION`. There is no window on the live auction floor. In `POST_SEASON`,
`canTradePlayer` accepts previous-season contracts from `previousSquad` while they remain `AVAILABLE` and
unsold; un-retained contracts stay in the auction pool. Active contracts still require `squad` membership and
`availability === 'SOLD'`. Withheld consent, LCB bans and the mini-signing freeze in `POST_AUCTION` remain
absolute. Salary ceilings are checked when retentions are submitted and after the auction; pre-retention
trades still face squad-size, overseas-slot and purse vetting.

The four-step approval protocol:

| Step | Dispatch action | State transition |
|---:|---|---|
| 1 | `PROPOSE_TRADE` | append `Trade` with `PENDING_48H` / `EOI_SUBMITTED`, `respondBy = now + 48h`; no player or purse changes |
| 2 | `RESPOND_TRADE` | reject → `REJECTED` / `NOT_APPROVED`; accept → `AWAITING_CONSENT` / `AWAITING_PLAYER_CONSENT`, `consentBy = now + 72h` |
| 3 | `AMEND_TRADE`, `PLAYER_TRADE_CONSENT` | renegotiate transfer fee/player lists; each player grants or vetoes. Any `DENIED` → `VETOED` / `NOT_APPROVED` |
| 4 | internal `vetAndExecute` | `LCB_REVIEW` → `APPROVED` / `LCB_APPROVED`, or `REJECTED` / `LCB_REJECTED` with a reason |

`computeDeal` classifies `ALL_CASH`, `PLAYER_SWAP` (equal fees) or `CASH_PLUS_PLAYER`, and derives
`cashAdjustment` from the exact fixed salaries. A submitted `cash` must equal its magnitude or the EOI is
rejected. `validateTradeSquads` checks both post-trade squads for maximum/minimum size, overseas slots,
total salary cap, Mini overseas salary cap and purse funding. `movePlayer` preserves the fee and contract
provenance, shifts overseas salary spend to the buyer, appends `tradeHistory` and `tradedIn`/`tradedOut`,
and records `tradeCashDelta` so `purseSpent = retentionSpent + auctionSpent − tradeCashDelta`.

An off-purse `transferFee` is legal only for `ALL_CASH`: 50% to `state.lcbTradeRevenue`, up to 50% of the
remainder to the moved player(s), and the balance to `seller.transferFeeEarned`. No purse is debited for it.
`expireTrades` runs inside every `tick()` before the terminal-phase gate and at the start of `dispatch()`;
lapsed EOIs/consents become `EXPIRED` / `NOT_APPROVED` with a timeline entry.

`evaluateEoi`, `autoConsent` and `suggestAiTrades` in `trade-ai.js` give the nine rivals deterministic,
role-gap-aware, budget-checked trading behaviour. The Python service never sees an off-auction trade.
`RUN_AI_TRADES` generates 1–4 candidate deals that are fed back through `proposeTrade`, so AI proposals
obey the same window, purse, cap and consent rules. It is human-triggered only; no phase transition files
a rival EOI automatically.

Anti-tampering: `REPORT_TAMPERING` records an allegation; `RULE_TAMPERING` either dismisses it or records an
upheld ruling with an optional purse fine and a ban of up to one season (`banUntilSeason`, `tamperingBan`).
Banned players cannot be traded.

### Injuries and withdrawals (`backend/src/season-ops.js`)

- `INJURE_PLAYER` marks a player `INJURED`. `SIGN_INJURY_REPLACEMENT` signs a RPP player within the injured
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
`WITHDRAW` (`franchiseId`), `USE_CLAW`, `PASS_CLAW`, `CLAW_RAISE`, `CLAW_DECLINE`, `MATCH_CLAW`
(`franchiseId`).

LCB season operations:
`PROPOSE_TRADE` (`toFranchiseId, givePlayerIds, getPlayerIds?, cash?, transferFee?, playerSharePct?,
autoRespond?` — `fromFranchiseId` is forced to `state.userFranchiseId`; `window` is ignored),
`RESPOND_TRADE` (`tradeId, accept, reason?`), `PLAYER_TRADE_CONSENT` (`tradeId, playerId, consent`),
`AMEND_TRADE` (`tradeId, givePlayerIds?, getPlayerIds?, transferFee?, playerSharePct?`),
`RUN_AI_TRADES` (`limit` clamped to 1–4), `REPORT_TAMPERING` (`franchiseId, playerId, details?`),
`RULE_TAMPERING` (`caseId, upheld, fine?, banSeasons?`), `INJURE_PLAYER` (`playerId`),
`SIGN_INJURY_REPLACEMENT` (`injuredPlayerId, replacementPlayerId, fee`), `PLAYER_WITHDRAW` (`playerId,
certifiedInjury`).

Room control: `CALL_BREAK`, `RESUME_BREAK`, `NEXT`, `PAUSE`, `UNPAUSE`, `NOMINATE` (`playerId,
selected`), `MEETING`, `RESET`.

Human-controlled actions are gated by `state.userFranchiseId`. The HTTP layer deletes `source` and `auto`
from those bodies and forces `fromFranchiseId` for `PROPOSE_TRADE`, so a browser client cannot impersonate
the internal AI orchestration path. `REPORT_TAMPERING` and `RULE_TAMPERING` are LCB integrity operations
and carry no franchise gate. A `BID` is accepted as soon as a player is on the block; a bid in
`PLAYER_INTRODUCTION` or `ACCELERATED_AUCTION` opens the floor first, then uses the same `validateBid`
check as AI bids. Human CLAW decisions must name `state.userFranchiseId`; AI CLAW decisions are resolved on
`tick()`. Trade deadlines are checked by the clock without a `clockRunning` guard, so a paused auction
cannot stall a 48h/72h window.

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
  clawUsed, trades, tradeWindows, lcbTradeRevenue, tamperingCases,
  injuries, soldCount, unsoldCount, biggestPurchases, bestValue, unsold,
  franchises: [{
    id, name, short, primary, owner, rank,
    purseSpent, purseRemaining, salaryCap, salaryHeadroom,
    overseasSalaryCap, overseasSalarySpend, overseasSalaryHeadroom,
    retentionCount, retentionSpent, retentionCappedCount, retentionUncappedCount,
    playerCount, existingCount, purchasedCount, tradedInCount, tradedOutCount, overseasCount,
    clawCards, clawUsed, tradeCount, tradeCashDelta, transferFeeEarned, welfareContribution,
    roleCounts, squad: [{...player, source:'EXISTING'|'PURCHASED'|'TRADED', price}],
    balanceScore, rankReason
  }]
}
```

`trades` rows spread the full EOI record and add `fromName`, `toName`, and `givePlayers`/`getPlayers`
as `[{ playerId, name, fee }]`. Money fields use two-decimal precision so per-team totals stay additive.
A retained player has `source: 'EXISTING'` and its price is the retention cost (Mega slab or existing Mini
contract fee); a LCB-approved trade acquisition has `source: 'TRADED'` and its exact fixed fee.

Persistence: `backend/data/auction-state.json`, atomic write (temp + rename) after every mutation. Load
validates `version`, array shapes (including a required `trades` ledger with unique ids and both franchise
references), an optional `tamperingCases` array, unique player ids, no duplicate sold ownership, numeric
purses and normalises season/rules. `lcbTradeRevenue` is optional for older saves; the engine fills missing
trade consent maps, timelines, player `tradeHistory`/`transferFeeEarned` and franchise trade ledgers on
load. Corrupt save → `saveError`, keep the file, no silent reset. Clear old saves before moving from custom
rules to LCB seasons; older states contain superseded fields.

`backend/src/engine.js` exports `AuctionEngine` (`create`, `fromState`, `attach`, `getState`, `dispatch`,
`tick`), `getNextBid`, `validateBid`, `computeResults` re-export, `SEASONS`, `rulesFor`, `salarySplit`,
`matchFeeProjection`, `PACE_TICKS`, `PACE_NAMES`. `backend/src/season-ops.js` exports `tradeWindows`,
`activeTradeWindow`, `proposeTrade`, `respondTrade`, `playerConsent`, `amendTrade`, `expireTrades`,
`reportTampering`, `ruleTampering`, `injurePlayer`, `signInjuryReplacement` and `withdrawPlayer`.
`backend/src/trade-ai.js` exports `evaluateEoi`, `autoConsent` and `suggestAiTrades` and imports only
`rules.js`, avoiding a circular dependency with `season-ops.js`.

`backend/src/aiClient.js` exports `createAiClient({ url })` with `decide(ctx)`, plus a `fallbackDecide`
heuristic when the AI service is unreachable. Private `privateReason` never reaches the engine or UI.

## 5. Python AI service (port 5000, stdlib only)

`ai/server.py` — `ThreadingHTTPServer`; `GET /health`, `POST /decide`, `OPTIONS` for CORS.

Request body (extends the earlier contract with LCB context):

```json
{
  "requestId": "req-...", "difficulty": "BALANCED", "format": "MEGA", "season": "2025",
  "rules": { "totalSalaryCap": 146, "overseasSalaryCap": 0, "clawAvailable": true, "matchFee": 0.075 },
  "config": { "startingPurse": 120, "minSquad": 18, "maxSquad": 25, "maxOverseas": 8,
              "minReservePerSlot": 0.2, "overseasSalaryCap": 0 },
  "player": { "id": "P001", "role": "BATTER", "category": "BATTER", "rating": 78, "age": 27,
              "nationality": "India", "capped": true, "contractFee": 6.5,
              "previousFranchiseId": "F7", "basePrice": 2, "stats": {} },
  "auction": { "currentBid": 2, "nextBid": 2.5, "leaderId": "F3", "bidsThisLot": 1,
               "stageKind": "SET", "accelerated": false, "claw": null,
               "availableByRole": {"BATTER": 12} },
  "self": { "id": "F1", "purse": 34.5, "squad": [], "additionsUsed": 2, "maxAdditions": 6,
            "overseasCount": 2, "overseasSalarySpend": 12, "clawCards": 4,
            "strategy": "BALANCED", "isLeader": false, "withdrawn": false, "rejected": [] },
  "others": [ {"id": "F2", "purse": 20, "squadSize": 17, "overseasCount": 5} ]
}
```

Response: `{ action: 'BID'|'PASS'|'WITHDRAW', amount, confidence, publicComment, privateReason }`.
`privateReason` stays inside the AI service. `BID.amount` must equal `auction.nextBid`. Valuations account
for capped/uncapped status and contract fees, season rules, overseas salary cap, CLAW context, role gaps,
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
                                  TradeDesk, SquadManager, ProceedingsPanel, BreakOverlay,
                                  ResultsView, TopBar
frontend/lib/api.js               fetch helpers against http://localhost:4000
frontend/lib/narration.js         speechSynthesis wrapper
frontend/lib/format.js            ₹ crore formatting, season/CLAW/retention helpers
```

Setup offers the 2025/2026/2027 season picker with the LCB rules board, then a retention picker limited to
that franchise's own previous-season contracts (Mini picks honour the ₹18 Cr overseas ceiling). The review
step shows capped/uncapped counts, slab costs, CLAW cards and every rival's plan. `BidPanel` exposes live CLAW
controls (`USE_CLAW`, `PASS_CLAW`, `CLAW_RAISE`, `CLAW_DECLINE`, `MATCH_CLAW`) when the human franchise is on the
clock. `TradeDesk` files BUY/SELL/SWAP EOIs (including pre-retention previous contracts in every SETUP), shows the
derived exact cash and transfer-fee split, exposes accept/reject, consent/veto, amendment and deadline
timelines for every EOI, offers `RUN_AI_TRADES` scouting, manages RPP injuries/replacements/withdrawals and
lists integrity rulings. `SquadManager` marks trade acquisitions `TRADED IN` and filters by source.
`ResultsView` reports the salary cap, overseas salary/welfare split, CLAW usage, LCB trade revenue, detailed
trade ledger, tampering cases and injury/withdrawal entries.

`lib/api.js`: `getState()`, `postAction(action, payload)`, `getResults()`, `getHealth()`, with
`NEXT_PUBLIC_API_URL` fallback `http://localhost:4000`. Voice narration is optional and watches
`state.announcement.id`.

## 7. Deliverable boundaries

- `ai/` agent: only files inside `ai/`.
- `backend/` agent(s): only files inside `backend/`.
- `frontend/` agent: only files inside `frontend/`.
- Root-level runner scripts, README and integration fixes are handled by the orchestrator.
