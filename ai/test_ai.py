"""Standard-library test suite for the T20 Dynasty AI service.

The fixtures mirror the BCCI franchise player regulations 2025–2027: capped and
uncapped player status, existing contract fees, Right to Match context and the
₹18 Cr overseas salary cap in Mini Auctions.

Run from the workspace root:

    python ai/test_ai.py
"""

from __future__ import annotations

import copy
import json
import re
import threading
import unittest
import urllib.error
import urllib.request

try:  # direct script execution (python ai/test_ai.py)
    from analysis import analyze
    from server import HEALTH, create_server
    from valuation import decide, make_decision, value_player
except ImportError:  # pragma: no cover - imported as ai.test_ai
    from .analysis import analyze
    from .server import HEALTH, create_server
    from .valuation import decide, make_decision, value_player


def player(**overrides: object) -> dict:
    result = {
        "id": "P001",
        "name": "Rohan Sharma",
        "age": 27,
        "nationality": "India",
        "role": "BATTER",
        "subtype": "Top order",
        "rating": 72,
        "capped": True,
        "uncappedReason": None,
        "contractFee": 6.5,
        "previousFranchiseId": "F7",
        "basePrice": 2,
        "category": "BATTER",
        "stats": {
            "matches": 82, "runs": 2810, "average": 39.2, "strikeRate": 138.4,
            "hundreds": 2, "fifties": 19, "wickets": 0,
        },
    }
    result.update(overrides)
    return result


def squad_member(pid: str, role: str, rating: int, nationality: str = "India") -> dict:
    return {
        "id": pid, "role": role, "rating": rating, "nationality": nationality,
        "source": "EXISTING",
    }


def saturated_batters() -> list[dict]:
    return [
        squad_member("E1", "BATTER", 81),
        squad_member("E2", "BATTER", 83),
        squad_member("E3", "BATTER", 79),
        squad_member("E4", "BATTER", 78),
        squad_member("E5", "BATTER", 80),
        squad_member("E6", "BOWLER", 76),
        squad_member("E7", "BOWLER", 74),
        squad_member("E8", "ALLROUNDER", 77),
        squad_member("E9", "WICKETKEEPER", 72),
    ]


def bowler_short_squad() -> list[dict]:
    return [
        squad_member("E1", "BATTER", 79),
        squad_member("E2", "BATTER", 77),
        squad_member("E3", "BATTER", 74),
        squad_member("E4", "ALLROUNDER", 78),
        squad_member("E5", "WICKETKEEPER", 73),
        squad_member("E6", "BATTER", 71),
    ]


def make_ctx(**overrides: object) -> dict:
    ctx = {
        "requestId": "req-test-1",
        "difficulty": "BALANCED",
        "format": "MEGA",
        "season": "2025",
        "rules": {
            "totalSalaryCap": 146, "overseasSalaryCap": 0,
            "rtmAvailable": True, "matchFee": 0.075,
        },
        "config": {
            "startingPurse": 120, "minSquad": 18, "maxSquad": 25,
            "maxOverseas": 8, "minReservePerSlot": 0.2,
            "overseasSalaryCap": 0,
        },
        "player": player(),
        "auction": {
            "currentBid": 0, "nextBid": 2, "leaderId": None, "bidsThisLot": 0,
            "stageKind": "SET", "accelerated": False, "rtm": None,
            "availableByRole": {
                "BATTER": 12, "BOWLER": 10, "ALLROUNDER": 8, "WICKETKEEPER": 5,
            },
        },
        "self": {
            "id": "F1", "purse": 34.5, "squad": bowler_short_squad(),
            "additionsUsed": 2, "maxAdditions": 6, "overseasCount": 2,
            "overseasSalarySpend": 12.0, "rtmCards": 4,
            "strategy": "BALANCED", "isLeader": False, "withdrawn": False,
            "rejected": [],
        },
        "others": [
            {"id": "F2", "purse": 20, "squadSize": 17, "overseasCount": 5},
            {"id": "F3", "purse": 25, "squadSize": 16, "overseasCount": 4},
        ],
    }
    for key, value in overrides.items():
        if key in ("player", "auction", "self", "config") and isinstance(value, dict):
            ctx[key].update(copy.deepcopy(value))
        else:
            ctx[key] = copy.deepcopy(value)
    return ctx


class DecisionContractTests(unittest.TestCase):
    def test_response_shape_is_exact(self):
        result = decide(make_ctx())
        self.assertEqual(
            set(result),
            {"action", "amount", "confidence", "publicComment", "privateReason"},
        )
        self.assertIn(result["action"], ("BID", "PASS", "WITHDRAW"))
        self.assertIsInstance(result["confidence"], (int, float))
        self.assertGreaterEqual(result["confidence"], 0)
        self.assertLessEqual(result["confidence"], 1)
        self.assertIsInstance(result["publicComment"], str)
        self.assertIsInstance(result["privateReason"], str)
        if result["action"] == "BID":
            self.assertIsInstance(result["amount"], (int, float))
        else:
            self.assertIsNone(result["amount"])

    def test_no_bid_above_next_bid(self):
        for difficulty in ("RELAXED", "BALANCED", "HARD"):
            for role in ("BATTER", "BOWLER", "ALLROUNDER", "WICKETKEEPER"):
                for bid in (1, 2, 2.5, 4, 7.5, 12, 19):
                    ctx = make_ctx(
                        difficulty=difficulty,
                        player=player(role=role, category=role, basePrice=2),
                        auction={"nextBid": bid, "currentBid": bid - 0.5},
                    )
                    result = decide(ctx)
                    if result["action"] == "BID":
                        self.assertEqual(result["amount"], ctx["auction"]["nextBid"])
                        self.assertLessEqual(result["amount"], ctx["self"]["purse"])
                    else:
                        self.assertIsNone(result["amount"])

    def test_withdrawal_when_ceiling_exceeded(self):
        ctx = make_ctx(
            player=player(role="BOWLER", category="BOWLER", rating=78),
            auction={"nextBid": 60, "currentBid": 59, "leaderId": "F2", "bidsThisLot": 5},
            self={"activeBidderIds": ["F1"]},
        )
        self.assertEqual(decide(ctx)["action"], "WITHDRAW")

        leading = make_ctx(auction={"nextBid": 40, "leaderId": "F1"}, self={"isLeader": True})
        self.assertEqual(decide(leading)["action"], "PASS")  # cannot bid against self

        forced = make_ctx(self={"withdrawn": True})
        forced_result = decide(forced)
        self.assertEqual(forced_result["action"], "WITHDRAW")
        self.assertIsNone(forced_result["amount"])

    def test_interest_varies_by_role_gap(self):
        needy = make_ctx(
            player=player(role="BOWLER", category="BOWLER", rating=78),
            self={"squad": bowler_short_squad()},
        )
        full = make_ctx(
            player=player(role="BATTER", category="BATTER", rating=70, basePrice=2),
            self={"squad": saturated_batters(), "overseasCount": 3},
        )
        needy_value = value_player(analyze(needy))
        full_value = value_player(analyze(full))
        self.assertGreater(needy_value["interest"], full_value["interest"])
        self.assertGreater(analyze(needy)["role_gap"], analyze(full)["role_gap"])
        self.assertEqual(decide(needy)["action"], "BID")
        self.assertEqual(decide(full)["action"], "PASS")

    def test_overseas_constraint(self):
        blocked = make_ctx(
            player=player(role="BOWLER", category="BOWLER", nationality="Australia", rating=80),
            self={"overseasCount": 8, "squad": bowler_short_squad()},
        )
        self.assertEqual(decide(blocked)["action"], "PASS")
        allowed = make_ctx(
            player=player(role="BOWLER", category="BOWLER", nationality="Australia", rating=80),
            self={"overseasCount": 6, "squad": bowler_short_squad()},
        )
        self.assertEqual(decide(allowed)["action"], "BID")

    def test_purse_constraint(self):
        poor = make_ctx(
            player=player(role="BOWLER", category="BOWLER", rating=85),
            self={"purse": 0.5, "squad": bowler_short_squad()},
            auction={"nextBid": 2},
        )
        self.assertNotEqual(decide(poor)["action"], "BID")
        mid = make_ctx(
            player=player(role="BOWLER", category="BOWLER", rating=85),
            self={"purse": 3.0, "squad": bowler_short_squad()},
            auction={"nextBid": 2.5},
        )
        self.assertNotEqual(decide(mid)["action"], "BID")  # reserve is protected

    def test_difficulty_differences(self):
        ctx = make_ctx(
            player=player(role="BOWLER", category="BOWLER", rating=80),
            self={"squad": bowler_short_squad()},
            auction={"nextBid": 2},
        )
        ceilings = {}
        for difficulty in ("RELAXED", "BALANCED", "HARD"):
            local = make_ctx(**{**ctx, "difficulty": difficulty})
            ceilings[difficulty] = value_player(analyze(local))["ceiling"]
        self.assertLess(ceilings["RELAXED"], ceilings["BALANCED"])
        self.assertLess(ceilings["BALANCED"], ceilings["HARD"])

        # At a price between the conservative and aggressive ceilings the
        # tougher profiles still compete while the relaxed one steps away.
        mid_bid = round((ceilings["RELAXED"] + ceilings["BALANCED"]) / 2, 2)
        if mid_bid > 2:
            contested = make_ctx(
                player=player(role="BOWLER", category="BOWLER", rating=80),
                self={"squad": bowler_short_squad()},
                auction={"nextBid": mid_bid},
            )
            actions = {}
            for difficulty in ("RELAXED", "BALANCED", "HARD"):
                local = copy.deepcopy(contested)
                local["difficulty"] = difficulty
                actions[difficulty] = decide(local)["action"]
            self.assertNotEqual(actions["RELAXED"], actions["HARD"])

    def test_determinism_and_franchise_disagreement(self):
        ctx = make_ctx(player=player(role="BOWLER", category="BOWLER", rating=80))
        self.assertEqual(decide(ctx), decide(copy.deepcopy(ctx)))

        values = {}
        for franchise in ("F1", "F2", "F3", "F4", "F5"):
            local = copy.deepcopy(ctx)
            local["self"]["id"] = franchise
            values[franchise] = value_player(analyze(local))["fair_value"]
        self.assertGreater(max(values.values()) - min(values.values()), 0.5)

    def test_public_comment_never_leaks_private_numbers(self):
        ctx = make_ctx(player=player(role="BOWLER", category="BOWLER", rating=80))
        for bid in (2, 6, 40):
            local = copy.deepcopy(ctx)
            local["auction"]["nextBid"] = bid
            result = decide(local)
            comment = result["publicComment"]
            self.assertIn("Rohan Sharma", comment)
            self.assertEqual(comment.count("."), 1)
            lowered = comment.lower()
            self.assertNotIn("ceiling", lowered)
            self.assertNotIn("valuation", lowered)
            self.assertIsNone(re.search(r"\b(?:cr|crore|inr|rs)\b", lowered))

    def test_defensive_against_missing_optional_fields(self):
        sparse = {
            "difficulty": "BALANCED",
            "player": {"id": "P9", "role": "BOWLER", "rating": 70, "basePrice": 1},
            "auction": {"nextBid": 1},
            "self": {"id": "F1", "purse": 10, "squad": []},
        }
        result = decide(sparse)
        self.assertIn(result["action"], ("BID", "PASS", "WITHDRAW"))
        self.assertEqual(set(result), {"action", "amount", "confidence", "publicComment", "privateReason"})
        self.assertFalse(decide({})["action"] == "BID")

    def test_make_decision_keeps_amount_synced_to_next_bid(self):
        ctx = make_ctx(player=player(role="BOWLER", category="BOWLER", rating=80))
        for bid in (1, 1.25, 3.5, 9, 15):
            ctx["auction"]["nextBid"] = bid
            decision = make_decision(ctx)
            if decision["action"] == "BID":
                self.assertEqual(decision["amount"], bid)


class BcciRulesTests(unittest.TestCase):
    def test_season_and_salary_cap_context(self):
        mega = analyze(make_ctx(season="2025", format="MEGA"))
        self.assertEqual(mega["season"], "2025")
        self.assertEqual(mega["format"], "MEGA")
        self.assertEqual(mega["overseas_salary"]["cap"], 0)
        self.assertFalse(mega["overseas_salary"]["salary_blocked"])

        mini26 = analyze(make_ctx(season="2026", format="MINI"))
        self.assertEqual(mini26["season"], "2026")
        self.assertEqual(mini26["format"], "MINI")

        mini27 = analyze(make_ctx(
            season="2027",
            format="MINI",
            player=player(nationality="Australia"),
            rules={"overseasSalaryCap": 18},
            config={"overseasSalaryCap": 18},
        ))
        self.assertEqual(mini27["season"], "2027")
        self.assertEqual(mini27["overseas_salary"]["cap"], 18)
        self.assertTrue(mini27["overseas_salary"]["salary_blocked"])

    def test_capped_status_and_contract_fee(self):
        capped = make_ctx(player=player(capped=True, contractFee=9))
        uncapped = make_ctx(player=player(
            capped=False, contractFee=2, uncappedReason="U19 World Cup"
        ))
        capped_status = analyze(capped)["status"]
        uncapped_status = analyze(uncapped)["status"]

        self.assertTrue(capped_status["capped"])
        self.assertFalse(capped_status["uncapped"])
        self.assertEqual(capped_status["contract_fee"], 9)
        self.assertFalse(uncapped_status["capped"])
        self.assertTrue(uncapped_status["uncapped"])
        self.assertEqual(uncapped_status["reason"], "U19 World Cup")
        self.assertEqual(uncapped_status["previous_franchise_id"], "F7")
        # Uncapped flexibility is a small, stable valuation premium.
        self.assertGreater(
            value_player(analyze(uncapped))["fair_value"],
            value_player(analyze(capped))["fair_value"],
        )

    def test_overseas_salary_cap_blocks_uncapped_value(self):
        ctx = make_ctx(
            season="2026",
            format="MINI",
            rules={"overseasSalaryCap": 18},
            config={"overseasSalaryCap": 18},
            player=player(
                nationality="Australia", role="BOWLER", category="BOWLER",
                capped=True, rating=94,
            ),
            self={"overseasCount": 2, "overseasSalarySpend": 5, "purse": 60},
            auction={
                "nextBid": 20, "currentBid": 19.5, "leaderId": "F2", "bidsThisLot": 2,
            },
        )
        analysis = analyze(ctx)
        self.assertTrue(analysis["overseas_salary"]["salary_blocked"])
        self.assertEqual(analysis["overseas_salary"]["effective_ceiling"], 18)
        self.assertLessEqual(value_player(analysis)["ceiling"], 18)
        self.assertNotEqual(decide(ctx)["action"], "BID")

    def test_right_to_match_context_is_available(self):
        rtm = {
            "phase": "RTM_OFFER",
            "playerId": "P001",
            "originalFranchiseId": "F7",
            "leaderFranchiseId": "F2",
            "price": 8.0,
        }
        analysis = analyze(make_ctx(auction={"rtm": rtm}, self={"rtmCards": 4}))
        self.assertEqual(analysis["overseas_salary"]["rtm"], rtm)
        self.assertIsNone(analyze(make_ctx())["overseas_salary"]["rtm"])
        result = decide(make_ctx(auction={"rtm": rtm}, self={"rtmCards": 4}))
        self.assertEqual(
            set(result),
            {"action", "amount", "confidence", "publicComment", "privateReason"},
        )


class HttpServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server("127.0.0.1", 0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def _request(self, path, data=None, method=None):
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method or ("POST" if data is not None else "GET"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read().decode("utf-8")
            return response.status, response.headers, body

    def test_health_endpoint_shape(self):
        status, headers, body = self._request("/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), HEALTH)
        self.assertEqual(json.loads(body), {"ok": True, "version": 1, "service": "t20-dynasty-ai"})
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_decide_endpoint_over_http(self):
        status, headers, body = self._request(
            "/decide", json.dumps(make_ctx()).encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        result = json.loads(body)
        self.assertEqual(set(result), {"action", "amount", "confidence", "publicComment", "privateReason"})
        self.assertIn(result["action"], ("BID", "PASS", "WITHDRAW"))

    def test_cors_options_and_errors(self):
        status, headers, _ = self._request("/decide", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))

        with self.assertRaises(urllib.error.HTTPError) as caught:
            self._request("/decide", b"{not json")
        self.assertEqual(caught.exception.code, 400)
        self.assertIn("error", json.loads(caught.exception.read().decode("utf-8")))
        caught.exception.close()

        with self.assertRaises(urllib.error.HTTPError) as caught:
            self._request("/health", data=b"{}")
        self.assertEqual(caught.exception.code, 405)
        caught.exception.close()

        with self.assertRaises(urllib.error.HTTPError) as caught:
            self._request("/unknown")
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
