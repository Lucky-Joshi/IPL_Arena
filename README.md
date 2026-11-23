# T20 Dynasty

**Build Your Team. Command the Game.**

A premium T20 franchise auction simulator following the **BCCI franchise player regulations 2025–2027**. Ten franchises
share one authoritative auction hall: you control one of them, and nine autonomous AI management teams
bid, retain, trade and rebuild against their own contracts, squads and strategies.

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

The BCCI limits live in `backend/src/rules.js`, the single source of truth for the season cycle. Setup may
tune only pacing (`tickMs`, `pace`) and a reserve-per-slot; all financial and squad limits come from the
season registry. See [ARCHITECTURE.md](ARCHITECTURE.md) for exact schemas and contracts.

## Brand and legal

T20 Dynasty is an independent, fictional franchise-auction simulator. It uses no official league, team or
player names, logos, portraits, tournament artwork or slogans. The auction mechanics model published BCCI
franchise player regulations, but the product is not affiliated with or endorsed by any official body.

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

## Season cycle (BCCI 2025–2027)

| Season | Format | Auction purse | Total salary cap | Overseas salary cap | Retentions | RTM |
|---|---|---:|---:|---:|---|---|
| **2025** | Mega | ₹120 Cr | ₹146 Cr | — | max 6 (5 capped + 2 uncapped) | 6 − direct retentions |
| **2026** | Mini | ₹125 Cr | ₹151 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | none |
| **2027** | Mini | ₹130 Cr | ₹157 Cr | ₹18 Cr | unlimited within squad/purse at existing fees | none |

Shared squad rules: **18–25 players**, **max 8 overseas**, **4 overseas in the Playing XI including the
Impact Player**, **₹7.5 lakh match fee** per playing member (₹12.6 Cr projected for 14 league matches),
and registration base prices of **₹0.3–2 Cr**. Retention charges use five capped slabs
(₹18/14/11/18/14 Cr) and ₹4 Cr for uncapped players. The 2025 Mega uses two marquee sets; Mini auctions
have no marquee set and no RTM.

### 2025 Mega retentions

Retain only players from your own previous-season contract list. The ordered capped retention charges are
₹18 / ₹14 / ₹11 / ₹18 / ₹14 Cr; an uncapped retention costs ₹4 Cr. You may directly retain at most six,
with at most five capped and at most two uncapped. Every direct retention consumes one of your six RTM
cards; the rest stay available during the auction.

If another franchise wins a lot that previously belonged to you, the auction enters a real three-step RTM
phase: `RTM_OFFER` (use or pass) → `RTM_COUNTER` (raise or decline) → `RTM_MATCH` (match or let it go).
`USE_RTM` spends exactly one card; passing and matching do not. A successful match awards the player at the
final price.

### 2026/2027 Mini retentions

Mini auctions keep all eligible previous-season contracts at their **existing contract fees** — there is no
fixed retention count and no rating slab. Retained players are not mini-auction signings and may be traded
in the post-auction window. Your additions limit adapts to the retained squad size, while the full bid (not
just the capped salary) is debited from the purse.

### Overseas salary cap and welfare fund

A Mini auction overseas player can earn at most ₹18 Cr. Any bid above that still costs the franchise the
full bid amount, but the excess is diverted to the **BCCI player welfare fund** and reported separately for
each team and in the final review. Mega auctions have no overseas salary ceiling.

## Auction floor

- Setup offers 2025 Mega, 2026 Mini and 2027 Mini; choose your home franchise and pace.
- Pick retentions (or start from zero) before the first lot; AI franchises apply a complete ordered plan
  at once so capped slabs and RTM cards stay correct. Re-selection restores players and purses.
- **BROADCAST** is the default: roughly five seconds per call so you can read the room. **CINEMATIC** is
  slower; **FAST** is for automated runs.
- You can bid the moment a player is introduced — the lead auctioneer opens the floor and recognises the bid.
  The gold **BID ₹X Cr** button shows the next legal amount, with **B** as a shortcut; **W** withdraws from
  an active lot.
- The same `validateBid` checks human and AI bids: purse, salary/squad/overseas caps, minimum-squad reserve,
  player availability and phase.
- Accelerated shortlists re-offer unsold players; strategy breaks, management discussions, squad inspection,
  optional browser narration, autosave/resume and a full final report are included.

## Trades, injuries and withdrawals

- Two windows: **post-season** (closes one week before the auction; no trading immediately before a Mega)
  and **post-auction** (opens the day after the auction; mini-auction signings cannot be traded).
- A trade begins as an EOI and stays pending for 48 hours with player consent required. Player swaps and
  cash adjustments are supported; `RESPOND_TRADE` approves and executes the move.
- A certified injury lets a franchise sign a replacement from the Registered Available Player Pool (RAPP)
  within the injured player's salary, without debiting the purse.
- An uncertified pre-season withdrawal removes the player and applies a ban for up to two seasons.

## Tests

```bat
cd backend && npm test
python -m unittest discover -s ai -p "test_*.py"
cd frontend && npm run build
```

Or run all three with `cmd /c verify.cmd`.

`backend/scripts/smoke-test.js` boots isolated AI and backend processes and drives complete Mega and Mini
auctions over HTTP. It covers real season finances, own-contract retentions and capped/uncapped slabs,
RTM offer/counter/match and pass flows, salary splitting and the welfare fund, overseas cap, trades and
consent, RAPP replacements, withdrawal bans, early human bids, BROADCAST dwell timing, bidding wars,
breaks, save/resume, accelerated rounds and final results.

`ai/test_ai.py` (18 tests) verifies season context, capped/uncapped status and contract fees, overseas
salary-cap decisions, RTM context, role/purse/age behaviour and the HTTP contract.
