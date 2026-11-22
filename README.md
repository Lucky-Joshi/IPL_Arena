# IPL Auction Arena

A complete, playable IPL-style franchise auction simulator. Ten franchises bid in one shared auction room;
you control one of them, and nine autonomous AI management teams evaluate every lot against their own
squads, purses and strategies.

## Services

| Service | Folder | Port | Technology |
|---|---|---:|---|
| Frontend | `frontend/` | 3000 | Next.js (App Router) |
| Backend (authoritative engine) | `backend/` | 4000 | Node.js, zero dependencies |
| AI decision engine | `ai/` | 5000 | Python 3 standard library |

The frontend never changes a purse or squad directly. Every bid, sale, break and stage transition passes
through the Node engine, which validates human and AI bids with the same rules and persists the state to
`backend/data/auction-state.json`. The Python service is stateless: it receives only public auction
information and returns a bid decision plus a short public commentary line. Private valuations never
leave the AI service.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the exact state schema and HTTP/AI contracts.

## Run

**Windows:** double-click `run-all.cmd` (three terminal windows open), then visit
<http://localhost:3000>.

**Manual:**

```bat
python ai\server.py
cd backend && node server.js
cd frontend && npm install && npm run dev
```

The backend works even if the AI service is momentarily unavailable: it falls back to a local heuristic so
a live auction never deadlocks.

## Auction formats

- **Mega Auction** — ₹120 Cr each, 18–25 players, max 8 overseas, up to **3 retentions**.
- **Mini Auction** — ₹50 Cr each, up to **15 retentions** from a dedicated existing-player pool. Your
  auction-addition cap adapts: **18 additions with zero retentions**, falling to **6** once you retain 12
  or more. Both formats allow starting from **zero retentions**.

Purse, squad limits, additions and retention count are configurable in setup. After you create an auction
you choose your retentions before the first lot: nothing is predefined by the system. The nine AI franchises
then auto-pick their own retentions from what remains, using their strategies and role needs.

Both formats include marquee/role sets, auctioneer commentary, genuine multi-franchise bidding wars,
strategy breaks, an accelerated round for unsold players, management discussions, squad inspection,
optional browser speech narration, autosave/resume, and a full final report.

## Retentions

Retentions are paid for out of your purse at confirmation, using a rating slab:

| Rating | Cost | Rating | Cost |
|---:|---:|---:|---:|
| 90+ | ₹5 Cr | 75–79 | ₹2 Cr |
| 85–89 | ₹4 Cr | 70–74 | ₹1.5 Cr |
| 80–84 | ₹3 Cr | below 70 | ₹1 Cr |

The picker shows the running cost and your projected purse as you select players, and you can clear the
selection or start with zero. You can re-open and change your picks any time before `START`; doing so
restores every player and purse and recomputes the AI retentions. Retained players count towards your squad
and their cost is debited from the purse before bidding begins. The same rules apply to all ten franchises.

## Bidding as the human franchise

You control one of the ten franchises; the other nine run their own AI war rooms. Setup defaults to
**BROADCAST** pace, where each lot stays on screen for roughly five seconds per call and rival teams pause
before answering. That gives you time to watch the room and bid like a real representative.

- You can bid the moment a player is introduced — the auctioneer opens the floor and recognises your bid.
- The gold **BID ₹X Cr** button shows the exact next legal amount. Press **B** anywhere as a shortcut.
- A live countdown shows when the current call is closing; the button turns red at the final call.
- Press **W** to withdraw while you are an active bidder. Pause the clock at any time if you need a break.
- Your bid can never break purse, squad, overseas or reserve rules: the same `validateBid` runs for humans
  and AI teams, and a successful bid produces a confirmation toast.

Choose **CINEMATIC** for even longer calls, or **FAST** only if you want a quick automated run.

## Tests

```bat
cd backend && npm test
cd ai && python -m unittest test_ai.py
cd frontend && npm run build
```

`backend/scripts/smoke-test.js` boots isolated AI + backend processes and drives complete mega and mini
auctions over HTTP, checking bid validation, early human bids during introduction, BROADCAST dwell timing,
multi-bidder wars, break restoration, mini addition limits, save/resume and final results. It also covers
retentions: rating-slab costs, purse debit, AI auto-pick, re-selection resets, the 3/15 caps, the zero-pick
option, MINI's candidate pool, retention-adjusted addition caps and retention-inclusive result totals.
