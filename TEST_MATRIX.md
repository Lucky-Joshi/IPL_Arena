# Verification matrix

Maps every required scenario from the master prompt to the place where it is exercised.
`verify.cmd` runs all three suites in order: Python AI unit tests, backend end-to-end smoke tests,
Next.js production build.

| # | Scenario | Verified by |
|---:|---|---|
| 1 | All ten franchises start correctly in Mega | `backend/scripts/smoke-test.js` — CREATE MEGA assertions |
| 2 | Both formats start with empty squads and unset retentions | smoke-test CREATE MEGA / MINI assertions |
| 3 | Human bidding works | smoke-test BID action + bidHistory assertion |
| 4 | Multiple AI franchises compete for one player | smoke-test war scenario (distinct franchiseIds on one lot) |
| 5 | AI decisions reflect role requirements | `ai/test_ai.py` role-gap cases; smoke-test |
| 6 | AI decisions reflect purse availability | `ai/test_ai.py` purse cases |
| 7 | AI decisions reflect overseas restrictions | `ai/test_ai.py` overseas cases |
| 8 | AI withdraws when ceilings exceeded | `ai/test_ai.py` withdrawal case; engine lot resolution |
| 9 | Human and AI cannot exceed purses | `validateBid` used by both paths; smoke-test negative case |
| 10 | Same player cannot be sold twice | engine availability check; smoke-test invariant scan |
| 11 | Hammer sale updates all franchise states | engine SOLD finalisation; smoke-test invariant scan |
| 12 | Unsold players recorded correctly | engine UNSOLD; smoke-test |
| 13 | Unsold players return in accelerated round | proceedings + smoke-test accelerated stage |
| 14 | Breaks pause auction | smoke-test break snapshot after 15 ticks |
| 15 | Resuming break preserves state | smoke-test RESUME_BREAK restoration |
| 16 | Auction sets progress correctly | smoke-test stage assertions |
| 17 | Squad updates immediately after purchases | smoke-test SOLD assertions |
| 18 | Mini addition limits work | smoke-test MINI repeated purchase attempts |
| 19 | Narration enable/disable | frontend narration hook + manual browser check |
| 20 | Save/resume restores full auction | smoke-test backend restart comparison |
| 21 | Final review includes all ten franchises | `/api/results` assertion in smoke-test |
| 22 | No invalid transaction bypasses engine | server routes all state changes through `dispatch` |
| 23 | Human can bid during player introduction | smoke-test `scenarioPacingAndEarlyBid` — BID accepted, floor opens, bidder leads at base price |
| 24 | BROADCAST pace is slow enough to bid | smoke-test `scenarioPacingAndEarlyBid` — bidding holds for 5 ticks before Going Once |
| 25 | UI exposes countdown and early-bid affordance | frontend `BidPanel` + `format.js` countdown helpers; production build |
| 26 | Keyboard B/W shortcuts and success toast | frontend auction page; manual browser pass below |
| 27 | Mega allows up to 3 user-picked retentions | smoke-test `scenarioRetentions` — 3 picks accepted, 4th rejected, cap message |
| 28 | Retention cost uses rating slabs and debits the purse | smoke-test `scenarioRetentions` — expected slab cost vs `retentionSpent` vs purse |
| 29 | Retained players are stamped and removed from the pool | smoke-test — `retained`, `availability='SOLD'`, `soldTo`, `retentionCost` |
| 30 | Nine AI franchises auto-retain and pay | smoke-test — every rival has 3 retentions and `retentionSpent > 0` |
| 31 | Re-selecting retentions restores players and purses | smoke-test — reselect to zero, players `AVAILABLE`, purse restored |
| 32 | Starting from zero retentions is legal | smoke-test — `START` auto-confirms empty selection, AI still retains |
| 33 | Mini caps at 15 user picks from the candidate pool | smoke-test — 150 R0xx candidates, 15 accepted, 16th rejected |
| 34 | Mini additions cap adapts to retention count | smoke-test — 15 retentions → 6 additions, 0 → `minSquad`; bid past cap rejected |
| 35 | Results include retention spend and costs | smoke-test — `totalRetentionSpending`, `purseSpent + purseRemaining = startingPurse`, retained squad prices |
| 36 | Retention picker UI | frontend `SetupScreen` two-step modal, `format.js` helpers; production build |

Edge cases: low purse, squad cap, overseas cap, no interested franchise, all AI withdrawn, human leading,
human withdrawing, break during active lot, reload during bidding war — covered by validation unit checks
and the persistence/break scenarios in the smoke test.

## Manual browser pass

1. `run-all.cmd`, open <http://localhost:3000>.
2. Create a Mega auction as F1; in the modal select up to 3 players, check the running cost and projected
   purse, then confirm. Verify all ten franchise retentions in the review step.
3. Use **Change retentions**, clear the selection and confirm **Start with 0 retentions**; verify the purse
   is restored and the pool is back to full.
4. Start with BROADCAST pace; watch the 5-second introduction and bidding countdowns.
5. Bid during the introduction, then bid again at Going Once; confirm the success toast and trailing red final call.
6. Try the B and W keyboard shortcuts, then call a break and resume.
7. Open My War Room, call a management meeting, verify comments mention actual role gaps and purse.
8. Open Squads; filter by role/nationality/source and confirm retained players show their cost.
9. Create a Mini auction and select 15 (or zero) retentions; verify the additions cap shown in the bid panel
   reflects the choice.
10. Let the auction run to accelerated round and final review; check all ten franchise reports.
11. Reload mid-bidding war; use Resume to confirm state restored.
