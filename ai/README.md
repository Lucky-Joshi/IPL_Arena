# IPL Auction Arena — AI decision service

Python 3.14, **standard library only** (no pip installs). Stateless, deterministic, port **5000**.

## Run

From the workspace root:

```bat
python ai/server.py
```

Optional: `set AI_PORT=5001` overrides the port. The server binds `0.0.0.0`.

## Routes

| Method | Path | Response |
|---|---|---|
| `GET` | `/health` | `{"ok":true,"version":1,"service":"ipl-auction-ai"}` |
| `POST` | `/decide` | `{"action":"BID"\|"PASS"\|"WITHDRAW","amount":number\|null,"confidence":0..1,"publicComment":"...","privateReason":"..."}` |
| `OPTIONS` | any | `204` with `Access-Control-Allow-Origin: *` |

Errors are JSON (`{"ok":false,"error":"..."}`): `400` invalid JSON/body, `404` unknown route,
`405` wrong method, `413` body over 1 MB, `500` unexpected decision failure. `BID.amount` is always
exactly `auction.nextBid`; all other actions return `amount: null`.

## Test

```bat
python ai/test_ai.py
```

The suite covers the bid-amount invariant, ceiling withdrawals, role-gap sensitivity, overseas and
purse constraints, difficulty differences, determinism, private-data hygiene, missing optional
fields, and live HTTP checks (including CORS and error codes).

## Decision logic

- **`analysis.py`** — derives a squad profile (counts and established quality by role), target
  composition for the expected final squad size, per-role gap scores, overseas-slot headroom,
  remaining squad/addition slots, reserve money for unfilled slots, player-pool scarcity
  (`availableByRole`, optional `availablePlayers`) and rival bidding pressure. All reads use `.get()`,
  so partial payloads are safe.
- **`valuation.py`** — converts rating → base value through interpolated anchors, then adjusts for
  age curve, role, real stats, category, squad gap, quality already at the role, scarcity,
  competition, declared strategy and a private personality. The personality comes from a SHA-256
  hash of `franchise id + player id + difficulty` (plus a stable franchise/role taste), so different
  franchises genuinely disagree on the same player and bidding wars emerge. Fair value is capped by
  spendable purse after reserve planning to produce a private ceiling. Decisions: explicit
  withdrawal, rejected player, invalid bid, overseas/slot blocks and leading-the-lot can't bid; a
  price above the ceiling withdraws an engaged bidder (or passes a never-interested one); otherwise
  a sufficient role gap / quality upgrade bids at exactly `nextBid`.
- **`discussion.py`** — picks a management voice (Owner, Head Coach, Director of Cricket, Auction
  Strategist, Data Analyst, Scouting Head) from the actual reason for the call and emits one short
  sentence citing real player, squad, purse or pool facts. Valuations, ceilings and reserve figures
  never appear in `publicComment`.

Difficulty materially changes the maths:

- **RELAXED** — low value multiplier, narrow personality spread, ignores competition, extra reserve.
- **BALANCED** — squad-needs driven, moderate scarcity awareness and standard reserve planning.
- **HARD** — higher value multiplier, strongest scarcity/competition weighting and larger dynamic
  reserve for scarce late slots, still capped by spendable purse.

No state is kept between requests: identical input always produces identical output.
