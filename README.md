# T20 Dynasty

**Build Your Team. Command the Game.**

A premium T20 franchise auction simulator governed by the fictional **League Control Board (LCB)** and its original
2025–2027 player regulations. Ten franchises share one authoritative auction hall: you control one of them, and nine
autonomous AI management teams bid, retain, trade and rebuild against their own contracts, squads and strategies.

## Services

| Service | Folder | Port | Technology |
|---|---|---:|---|
| Frontend | `frontend/` | 3000 | Next.js (App Router) |
| Backend (authoritative engine) | `backend/` | 4000 | Node.js, zero dependencies |
| AI decision engine | `ai/` | 5000 | Python 3 standard library |

The frontend never changes a purse, squad or contract directly. Every bid, retention, trade, replacement,
break and stage transition goes through the Node engine, which validates human and AI decisions with the
same rules and persists the state to `backend/data/auction-state.json`. The Python service is stateless:
it receives only public auction information and returns a bid decision plus a short public commentary line.
Private valuations never leave the AI service.

The LCB limits live in `backend/src/rules.js`, the single source of truth for the season cycle. Setup may
tune only pacing (`tickMs`, `pace`) and a reserve-per-slot; all financial and squad limits come from the
season registry. See [ARCHITECTURE.md](ARCHITECTURE.md) for exact schemas and contracts.

## Brand and legal

T20 Dynasty is an independent, fictional franchise-auction simulator. It uses no official league, team or
player names, logos, portraits, tournament artwork or slogans. The League Control Board, its seasons, its clubs
and every player are invented for this game; the product is not affiliated with or endorsed by any official body.

Before commercial release, clear the **T20 Dynasty** name against IP India trademark records, check domain
availability and app-store names, and have a trademark professional review the final identity.

## Run

**Windows:** double-click `run-all.cmd` (three terminal windows open), then visit
<http://localhost:3000>.

**Manual:**

```bat
python ai\server.py
cd backend && node server.js
cd frontend && npm install && npm run dev
```

The backend falls back to a local heuristic if the AI service is briefly unavailable, so a live auction
never deadlocks.

## Deploy

The frontend is on Vercel; the backend and AI are Render web services. See [DEPLOYMENT.md](DEPLOYMENT.md)
for the full Vercel + Render guide, `render.yaml` blueprint, env-var reference and verification checklist.
Blank env templates live at `frontend/.env.example`, `backend/.env.example` and `ai/.env.example`;
real local values belong in the gitignored `frontend/.env.local`, `backend/.env` and `ai/.env`.

## Season cycle (League Control Board 2025–2027)

| Season | Format | Auction purse | Total salary cap | Overseas salary cap | Retentions | Clawback |
|---|---|---:|---:|---:|---|---|
| **2025** | Mega | ₹120 Cr | ₹146 Cr | — | max 6 (5 capped + 2 uncapped) | 6 − direct retentions |
| **2026** | Mini | ₹125 Cr | ₹151 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | none |
| **2027** | Mini | ₹130 Cr | ₹157 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | none |

Shared squad rules: **18–25 players**, **max 8 overseas**, **4 overseas in the Playing XI including the
X-Factor Substitute**, **₹7.5 lakh match fee** per playing member (₹12.6 Cr projected for 14 league matches),
and registration base prices of **₹0.3–2 Cr**. Retention charges use five capped slabs
(₹18/14/11/18/14 Cr) and ₹4 Cr for uncapped players. The 2025 Mega uses two marquee sets; Mini auctions
have no marquee set and no Clawback.

### 2025 Mega retentions

Retain only players from your own previous-season contract list. The ordered capped retention charges are
₹18 / ₹14 / ₹11 / ₹18 / ₹14 Cr; an uncapped retention costs ₹4 Cr. You may directly retain at most six,
with at most five capped and at most two uncapped. Every direct retention consumes one of your six Clawback
cards; the rest stay available during the auction.

If another franchise wins a lot that previously belonged to you, the auction enters a three-step Franchise
Clawback phase: `CLAW_OFFER` (use or pass) → `CLAW_COUNTER` (raise or decline) → `CLAW_MATCH` (match or let it go).
`USE_CLAW` spends exactly one card; passing and matching do not. A successful match awards the player at the
final price.

### 2026/2027 Mini retentions

Mini auctions keep all eligible previous-season contracts at their **existing contract fees** — there is no
fixed retention count and no rating slab. Overseas retentions must also fit under the **₹18 Cr overseas
salary ceiling**; an over-cap selection is rejected before the auction starts. Retained players are not
mini-auction signings and may be traded in the post-auction window. Your additions limit adapts to the
retained squad size, while the full bid (not just the capped salary) is debited from the purse.

### Overseas salary cap and welfare fund

A Mini auction overseas player can earn at most ₹18 Cr. Any bid above that still costs the franchise the
full bid amount, but the excess is diverted to the **LCB player welfare fund** and reported separately for
each team and in the final review. Mega auctions have no overseas salary ceiling.

## Auction floor

- Setup offers 2025 Mega, 2026 Mini and 2027 Mini; choose your home franchise and pace.
- Pick retentions (or start from zero) before the first lot; AI franchises apply a complete ordered plan
  at once so capped slabs and CLAW cards stay correct. Re-selection restores players and purses.
- **BROADCAST** is the default: roughly five seconds per call so you can read the room. **CINEMATIC** is
  slower; **FAST** is for automated runs.
- You can bid the moment a player is introduced — the lead auctioneer opens the floor and recognises the bid.
  The gold **BID ₹X Cr** button shows the next legal amount, with **B** as a shortcut; **W** withdraws from
  an active lot.
- The same `validateBid` checks human and AI bids: purse, salary/squad/overseas caps, minimum-squad reserve,
  player availability and phase.
- Accelerated shortlists re-offer unsold players; strategy breaks, management discussions, squad inspection,
  optional browser narration, autosave/resume and a full final report are included.

## Trades, integrity, injuries and withdrawals

### League Control Board trading protocol

The **Trade Desk** tab follows the four-step LCB approval protocol. The active window is derived from the
authoritative phase — a caller-supplied `window` is ignored. The EOI form stays visible with disabled controls outside
an open window, so it is clear when trading opens again.

- **Post-season** (`POST_SEASON`): `SETUP` in **every** season, before retentions are finalized. Each franchise
  trades its distinct previous-season contracts; un-retained players stay available for the auction. Clawback
  eligibility follows the contract to its new owner.
- **Post-auction** (`POST_AUCTION`): `FINAL_REVIEW`/`COMPLETED`, closing 30 days before the tournament.
  Players bought at the mini auction are frozen until they have played a season.

| Step | Action | Result |
|---:|---|---|
| 1 | `PROPOSE_TRADE` files an EOI with the LCB | `PENDING_48H` / `EOI_SUBMITTED`, 48h `respondBy`; no player moves |
| 2 | The approached franchise answers with `RESPOND_TRADE` | reject → `REJECTED`; accept → `AWAITING_CONSENT` / `AWAITING_PLAYER_CONSENT`, 72h `consentBy` |
| 3 | Terms are negotiated with `AMEND_TRADE`; every player signs via `PLAYER_TRADE_CONSENT` | any veto → `VETOED`; all consent → LCB vetting |
| 4 | The LCB checks salary caps, squad limits, purse and integrity flags | `LCB_REVIEW` → `APPROVED` / `LCB_APPROVED` or `REJECTED` / `LCB_REJECTED` |

Every EOI carries an audit `timeline[]`, its consent map and real deadlines. A response or consent that
passes its deadline lapses to `EXPIRED` / `NOT_APPROVED` on the next tick or dispatch, even in `SETUP`.
Human players sign their own consent; AI-owned players use need-based heuristics in `trade-ai.js`.
`RUN_AI_TRADES` (limit 1–4) is human-triggered only and every rival proposal still passes the same engine
validation — no deal is auto-filed when a phase changes.

**Deal types and money.** `ALL_CASH` covers a one-way sale; `PLAYER_SWAP` exchanges equal-fee players;
`CASH_PLUS_PLAYER` settles the exact salary difference in cash. Fees are fixed contracts and are never
renegotiated: the cash is derived from the players' exact league salaries and a mismatched `cash` value is
rejected. The side receiving the higher-salary package pays the difference from its purse; an unfunded
deal is blocked. An optional **off-purse transfer fee** is allowed only on all-cash deals: 50% to the LCB,
up to 50% of the remainder to the player, and the rest to the selling franchise.

**Anti-tampering.** Contact outside the official EOI channel is reportable with `REPORT_TAMPERING`. An
upheld `RULE_TAMPERING` ruling can fine and deduct the offender's purse and ban the player for up to one
season; banned players cannot be included in a trade. Every ruling is retained in the final report.

### Injuries and withdrawals

- A certified injury lets a franchise sign a replacement from the Reserve Player Pool (RPP)
  within the injured player's salary, without debiting the purse. The Trade Desk exposes the injury, RPP signing
  and withdrawal actions directly.
- An uncertified pre-season withdrawal removes the player and applies a ban for up to two seasons.

## Tests

```bat
cd backend && npm test
python -m unittest discover -s ai -p "test_*.py"
cd frontend && npm run build
```

Or run all three with `cmd /c verify.cmd`.

`backend/scripts/smoke-test.js` boots isolated AI and backend processes and drives complete Mega and Mini
auctions over HTTP. It covers season finances, own-contract retentions and capped/uncapped slabs
(including the Mini overseas retention ceiling), CLAW offer/counter/match and pass flows, salary splitting
and the welfare fund, overseas cap, all three trade deal types, the full four-step approval protocol,
transfer-fee splitting, negotiation, veto, expiry, cap/purse blocks, anti-tampering and rival scouting,
RPP replacements, withdrawal bans, early human bids, BROADCAST dwell timing, bidding wars, breaks,
save/resume, accelerated rounds and final results.

`ai/test_ai.py` (18 tests) verifies season context, capped/uncapped status and contract fees, overseas
salary-cap decisions, CLAW context, role/purse/age behaviour and the HTTP contract.
