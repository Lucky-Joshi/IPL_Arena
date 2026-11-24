# Verification matrix

Maps the fictional League Control Board (LCB) player regulations 2025–2027 and every required simulator
scenario to an automated or manual check. `cmd /c verify.cmd` runs all three suites in order: Python AI unit
tests, backend end-to-end smoke tests, Next.js production build.

| # | Scenario | Verified by |
|---:|---|---|
| 1 | Season registry drives all financial and squad limits | `backend/src/rules.js`; smoke-test season/results assertions; `ai/test_ai.py` LcbRulesTests |
| 2 | Ten franchises start correctly in 2025 Mega | smoke-test `scenarioCreateAndIntro` — CREATE MEGA, 10 squads empty, ₹120 Cr |
| 3 | Human bidding works | smoke-test `scenarioHumanBid` — BID + bidHistory + purse unchanged until SOLD |
| 4 | Multiple AI franchises compete for one player | smoke-test `scenarioWarAndPasses` — distinct franchiseIds on one lot |
| 5 | AI decisions reflect role requirements | `ai/test_ai.py` role-gap cases; smoke-test auction invariants |
| 6 | AI decisions reflect purse availability | `ai/test_ai.py` purse cases; smoke-test insufficient purse rejection |
| 7 | AI decisions reflect overseas restrictions | `ai/test_ai.py` overseas cases; smoke-test overseas cap |
| 8 | AI withdraws when ceilings exceeded | `ai/test_ai.py` withdrawal case; engine lot resolution |
| 9 | Human and AI cannot exceed purses | shared `validateBid`; smoke-test negative case |
| 10 | Same player cannot be sold twice | engine availability check; smoke-test invariant scan |
| 11 | Hammer sale updates all franchise states | engine SOLD finalisation; smoke-test invariant scan |
| 12 | Unsold players recorded correctly | engine UNSOLD; smoke-test results totals |
| 13 | Unsold players return in accelerated round | proceedings + smoke-test accelerated stage |
| 14 | Breaks pause auction | smoke-test `scenarioBreakFreeze` — snapshot after 15 ticks |
| 15 | Resuming break preserves state | smoke-test `scenarioBreakFreeze` — RESUME_BREAK restoration |
| 16 | Auction sets progress correctly | smoke-test stage assertions |
| 17 | Squad updates immediately after purchases | smoke-test SOLD assertions |
| 18 | Mini addition limits work | smoke-test `scenarioMiniAuction` — `additionsLimit` enforced |
| 19 | Narration enable/disable | frontend narration hook + manual browser check |
| 20 | Save/resume restores full auction | smoke-test `scenarioSaveResume` — backend restart comparison |
| 21 | Final review includes all ten franchises | `/api/results` assertion in smoke-test |
| 22 | No invalid transaction bypasses engine | server routes all state changes through `dispatch` |
| 23 | Human can bid during player introduction | smoke-test `scenarioPacingAndEarlyBid` — floor opens at base price |
| 24 | BROADCAST pace is slow enough to bid | smoke-test `scenarioPacingAndEarlyBid` — 5-tick bidding call |
| 25 | UI exposes countdown and early-bid affordance | frontend `BidPanel` + `format.js`; production build |
| 26 | Keyboard B/W shortcuts and success toast | frontend auction page; manual browser pass below |
| 27 | Mega: max 6 retentions from own contracts | smoke-test `scenarioRetentions` — 6 accepted, 7th rejected |
| 28 | Mega: ≤5 capped and ≤2 uncapped | smoke-test `scenarioRetentions` — 3 uncapped / 6 capped rejected |
| 29 | Mega capped slabs ₹18/14/11/18/14 and uncapped ₹4 Cr | smoke-test retention cost + `retentionSpent` + purse assertions |
| 30 | CLAW cards = 6 − direct retentions | smoke-test — card count after picks, re-selection and zero picks |
| 31 | Nine AI franchises auto-retain whole plans | smoke-test — every rival has a valid capped/uncapped plan and card count |
| 32 | Re-selecting retentions restores pool and purse | smoke-test — reselect to zero restores players and CLAW cards |
| 33 | Starting from zero retentions is legal | smoke-test — `START` auto-confirms empty selection |
| 34 | Mini keeps contracts at existing fees, no CLAW | smoke-test `scenarioMiniAuction` — own retentions persist, no CLAW phases |
| 35 | 2026 Mini ₹125 Cr / ₹151 Cr / ₹18 Cr overseas cap | smoke-test CREATE assertions; `ai/test_ai.py` season context |
| 36 | 2027 Mini ₹130 Cr / ₹157 Cr / ₹18 Cr overseas cap | smoke-test `scenarioSalaryAndSeasonOps` registry assertions |
| 37 | CLAW OFFER → COUNTER → MATCH spends one card | smoke-test `scenarioClawFlow` — one card, final price, player awarded |
| 38 | PASS_CLAW keeps card and awards leader | smoke-test `scenarioClawFlow` — card unchanged, player stays with leader |
| 39 | CLAW bid history entries are settlement records | smoke-test invariant skip of `CLAW*` bid sources |
| 40 | Overseas bid above ₹18 Cr splits salary/welfare | smoke-test — ₹25 Cr → ₹18 Cr salary, ₹7 Cr welfare, full purse debit |
| 41 | Match-fee projection ₹12.6 Cr | smoke-test `matchFeeProjection('2025')` assertion |
| 42 | Anti-tampering reporting and rulings | smoke-test — `REPORT_TAMPERING` + upheld `RULE_TAMPERING` fine the purse, ban the player and record the ruling |
| 43 | HTTP integrity actions | smoke-test `scenarioAccelerationAndResults` — `REPORT_TAMPERING` + `RULE_TAMPERING` round-trip over HTTP |
| 44 | RPP replacement within injured salary, no purse debit | smoke-test `scenarioSalaryAndSeasonOps` — `isRppReplacement`, purse unchanged |
| 45 | Uncertified withdrawal applies two-season ban | smoke-test — `banUntilSeason === '2028'` for 2026 |
| 46 | Results report caps, welfare, CLAW, injuries | smoke-test — `tamperingCases`, `injuries`, `welfareFund`; `ai/test_ai.py` (18 tests) |
| 47 | Money totals reconcile at two decimals | smoke-test `totalSpent === totalAuctionSpending`, `purseSpent + purseRemaining = startingPurse` |
| 48 | Retention/season UI reflects LCB rules | frontend `SetupScreen`, `BidPanel`, `SquadManager`, `ResultsView`; production build |
| 49 | Clawback/X-Factor readouts; RPP, withdrawal and integrity backend coverage | `BidPanel` command desk shows CLAW/X-Factor; RPP, withdrawal and tampering have no dedicated UI after the Trade Desk tab removal — covered by smoke-test backend actions; production build |

Edge cases: low purse, squad cap, overseas cap, no interested franchise, all AI withdrawn, human leading,
human withdrawing, break during active lot, reload during bidding war — covered by validation checks, the
persistence/break scenarios and smoke invariants.

## Manual browser pass

1. `run-all.cmd`, open <http://localhost:3000>. Clear `backend/data/auction-state.json` first if you have
   an older custom-rule save.
2. Create a **2025 Mega** auction as F1. Review the rules board: ₹120 Cr purse, ₹146 Cr cap, six
   retentions/CLAWs, two marquee sets.
3. Select up to six of your own previous-season contracts; confirm capped/uncapped counters, slab costs,
   running purse and remaining CLAW cards. Verify the nine rival plans in the review step.
4. Use **Change retentions**, clear the selection and start with zero retentions; verify the pool and CLAW
   cards are restored.
5. Start with BROADCAST pace; bid during the introduction and again at Going Once. Confirm the toast,
   countdown and trailing red final call; try the B and W shortcuts.
6. On a lot previously contracted to you, watch for the CLAW panel: use a card, raise/decline the counter,
   then match or pass. Verify one card is spent only on `USE_CLAW`.
7. Call a break, resume, then open My War Room and verify comments reflect actual role gaps and purse.
8. Open Squads; confirm retained players show their Mega slab fee or Mini contract fee.
9. Create a **2026 Mini**, retain several contracts, verify no CLAW controls and the adaptive additions cap.
   Let an overseas player sell above ₹18 Cr and check the welfare line in the final report.
10. Let the auction run to the accelerated round and final review; check salary caps, overseas/welfare
    split, CLAW usage and injury/withdrawal reporting for all ten franchises.
11. Reload mid-bidding war; use Resume to confirm state restored.
12. For a **2026 Mini**, retain contracts within the ₹18 Cr overseas ceiling; try an over-cap selection and
    confirm the rules engine rejects it with the overseas-cap message.
13. In the Auction Hall command desk, confirm the Clawback card count in Mega (and "Mega only · none" in Mini)
    and the X-Factor paid-places readout (labelled `CLAWBACK (RTM)`).

RPP injuries/replacements, withdrawals and tampering rulings have no dedicated UI tab after the Trade Desk
removal; their backend actions are exercised directly by the smoke suite.
