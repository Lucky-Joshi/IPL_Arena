"""Private, deterministic valuation and bid decision engine.

The franchise personality is derived from a SHA-256 hash of
``franchise id + player id + difficulty``.  Python's built-in ``hash()`` is
deliberately avoided: it is salted per process and would break determinism.

No value in this module is ever exposed directly through ``publicComment``.
"""

from __future__ import annotations

import hashlib

from analysis import (
    analyze,
    as_dict,
    as_list,
    clamp,
    num,
)

DIFFICULTY_SETTINGS = {
    # base multiplier, personality spread, scarcity weight, competition weight,
    # role-gain (how strongly an actual squad gap raises the bid)
    "RELAXED": {
        "base": 0.62,
        "spread": 0.16,
        "scarcity": 0.03,
        "competition": 0.0,
        "role_gain": 0.85,
    },
    "BALANCED": {
        "base": 0.95,
        "spread": 0.28,
        "scarcity": 0.08,
        "competition": 0.04,
        "role_gain": 1.05,
    },
    "HARD": {
        "base": 1.25,
        "spread": 0.24,
        "scarcity": 0.18,
        "competition": 0.12,
        "role_gain": 1.10,
    },
}

STRATEGY_FACTOR = {
    "AGGRESSIVE": 1.10,
    "BALANCED": 1.00,
    "CONSERVATIVE": 0.90,
    "VALUE": 0.92,
}

ROLE_FACTOR = {
    "BATTER": 1.00,
    "BOWLER": 1.02,
    "ALLROUNDER": 1.06,
    "WICKETKEEPER": 0.96,
}

CATEGORY_FACTOR = {
    "MARQUEE": 1.12,
    "ACCELERATED": 0.88,
    "BATTER": 1.00,
    "BOWLER": 1.00,
    "ALLROUNDER": 1.00,
    "WICKETKEEPER": 1.00,
}

RATING_ANCHORS = (
    (1, 0.05), (30, 0.30), (40, 0.60), (50, 1.20), (60, 2.40),
    (68, 3.80), (75, 6.00), (82, 9.00), (88, 13.00), (94, 18.00), (100, 24.00),
)

AGE_ANCHORS = (
    (16, 0.72), (20, 0.86), (24, 0.96), (27, 1.00), (30, 1.00),
    (32, 0.94), (34, 0.84), (36, 0.68), (42, 0.42),
)


def _interpolate(anchors: tuple[tuple[float, float], ...], value: float) -> float:
    """Piecewise-linear interpolation across (x, y) anchors."""
    if value <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if value <= x1:
            ratio = (value - x0) / float(x1 - x0)
            return y0 + ratio * (y1 - y0)
    return anchors[-1][1]


def hash_unit(*parts: object) -> float:
    """Stable 0..1 hash.  Same inputs always give the same number."""
    key = "|".join(str(part) for part in parts).encode("utf-8")
    digest = hashlib.sha256(key).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def personality(analysis: dict) -> dict:
    """The private per-franchise taste for this exact player and difficulty."""
    self_info = analysis["self_info"]
    franchise_id = str(self_info.get("id") or "F?")
    player_id = analysis["player_id"]
    difficulty = analysis["difficulty"]
    bias_unit = hash_unit(franchise_id, player_id, difficulty, "value-bias")
    appetite_unit = hash_unit(franchise_id, player_id, difficulty, "role-appetite")
    role_taste = hash_unit(franchise_id, analysis["role"], difficulty, "role-taste")
    return {
        "franchise_id": franchise_id,
        "bias_unit": bias_unit,
        "appetite_unit": appetite_unit,
        "role_taste": role_taste,
        "strategy": str(self_info.get("strategy") or "BALANCED").strip().upper(),
    }


def rating_value(rating: float) -> float:
    """Base crore value of a player purely from overall rating."""
    return _interpolate(RATING_ANCHORS, clamp(num(rating, 50), 1, 100))


def age_factor(age: object) -> float:
    """Peak years around 26-30; discount for raw youth and decline."""
    if age is None:
        return 1.0
    return _interpolate(AGE_ANCHORS, clamp(num(age, 27), 16, 42))


def _stat_bonuses(stats: dict) -> tuple[float, float]:
    """Batting and bowling bonuses from the optional stats object."""
    bat = 0.0
    bowl = 0.0
    has_bat = False
    has_bowl = False

    if "average" in stats and num(stats.get("average")) > 0:
        bat += clamp((num(stats.get("average")) - 25.0) / 35.0, -0.5, 1.0) * 0.10
        has_bat = True
    if "strikeRate" in stats and num(stats.get("strikeRate")) > 0:
        bat += clamp((num(stats.get("strikeRate")) - 110.0) / 60.0, -0.5, 1.0) * 0.10
        has_bat = True
    if "hundreds" in stats or "fifties" in stats:
        scoring = 2.0 * num(stats.get("hundreds")) + num(stats.get("fifties"))
        bat += clamp(scoring / 20.0, 0.0, 1.0) * 0.03
        has_bat = True

    if "wickets" in stats and num(stats.get("wickets")) > 0:
        bowl += clamp((num(stats.get("wickets")) - 1.0) / 2.5, -0.5, 1.0) * 0.10
        has_bowl = True
    if "bowlingAverage" in stats and num(stats.get("bowlingAverage")) > 0:
        bowl += clamp((35.0 - num(stats.get("bowlingAverage"))) / 20.0, -0.5, 1.0) * 0.08
        has_bowl = True
    if "economy" in stats and num(stats.get("economy")) > 0:
        bowl += clamp((9.0 - num(stats.get("economy"))) / 3.0, -0.5, 1.0) * 0.06
        has_bowl = True

    return (bat if has_bat else 0.0), (bowl if has_bowl else 0.0)


def stats_factor(player: dict, role: str) -> float:
    stats = as_dict(player.get("stats"))
    bat, bowl = _stat_bonuses(stats)
    if role in ("BATTER", "WICKETKEEPER"):
        bonus = bat
    elif role == "BOWLER":
        bonus = bowl
    else:
        bonus = 0.55 * bat + 0.55 * bowl
    return clamp(1.0 + bonus, 0.82, 1.20)


def need_factor(analysis: dict, settings: dict, rating: float, saturated: bool) -> tuple[float, bool]:
    """Squad gap drives the bid; quality already at the role damps it."""
    gap = analysis["role_gap"]
    role_info = analysis["role_info"]
    quality = num(role_info.get("quality"))
    # An empty role has no established player to be an "upgrade" on; the gap
    # multiplier already covers that case.
    upgrade = rating - quality if quality > 0 else 0.0

    factor = 0.35 + settings["role_gain"] * gap
    if saturated:
        factor *= 0.75
    elif upgrade >= 6.0:
        factor *= min(1.15, 1.0 + upgrade * 0.01)
    return max(0.05, factor), upgrade >= 10.0


def value_player(analysis: dict) -> dict:
    """Compute the private fair value, ceiling and interest for this lot."""
    player = analysis["player"]
    difficulty = analysis["difficulty"]
    settings = DIFFICULTY_SETTINGS[difficulty]
    persona = personality(analysis)

    rating = clamp(num(player.get("rating"), 50), 1, 100)
    role_info = analysis["role_info"]
    saturated = bool(
        role_info["count"] >= role_info["target"]
        and role_info["quality"] > 0
        and role_info["quality"] >= rating - 6.0
    )

    base = rating_value(rating)
    role_adj = ROLE_FACTOR.get(role_info["role"], 1.0)
    # Uncapped players cost less in retention and carry no international
    # commitment, so a small stable premium reflects that extra flexibility.
    status = analysis["status"]
    status_adj = 1.06 if status["uncapped"] else 1.0
    age_adj = age_factor(player.get("age"))
    stat_adj = stats_factor(player, role_info["role"])
    category_adj = CATEGORY_FACTOR.get(
        str(player.get("category") or "").strip().upper(), 1.0
    )
    need_adj, quality_upgrade = need_factor(analysis, settings, rating, saturated)

    scarcity = analysis["scarcity"]["score"] * analysis["role_gap"]
    competition = analysis["competition"]["score"] * analysis["role_gap"]
    scarcity_adj = 1.0 + settings["scarcity"] * scarcity
    competition_adj = 1.0 + settings["competition"] * competition

    strategy_adj = STRATEGY_FACTOR.get(persona["strategy"], 1.0)
    spread = settings["spread"]
    bias_adj = 1.0 - spread / 2.0 + spread * persona["bias_unit"]
    # A small, stable taste for the role itself adds another source of
    # genuine disagreement between franchises on the same player.
    taste_adj = 0.94 + 0.12 * persona["role_taste"]

    fair = (
        base
        * role_adj
        * status_adj
        * age_adj
        * stat_adj
        * category_adj
        * need_adj
        * scarcity_adj
        * competition_adj
        * strategy_adj
        * bias_adj
        * taste_adj
    )
    fair = round(max(0.0, fair), 3)

    plan = analysis["purse"]
    ceiling = round(min(fair, num(plan.get("spendable"))), 3)
    # Anything above the overseas salary ceiling goes to the welfare fund, so
    # it has no squad value and must not drive the AI's private ceiling.
    salary = analysis["overseas_salary"]
    if salary["salary_blocked"] and salary["effective_ceiling"] > 0:
        ceiling = round(min(ceiling, salary["effective_ceiling"]), 3)

    next_bid = analysis["next_bid"]
    headroom = clamp((ceiling - next_bid) / max(0.5, ceiling)) if ceiling > 0 else 0.0
    upgrade_score = clamp(
        (rating - role_info["quality"]) / 25.0 if role_info["quality"] > 0 else (rating - 60.0) / 30.0
    )

    interest = clamp(
        0.12
        + 0.46 * analysis["role_gap"]
        + 0.16 * (2.0 * persona["appetite_unit"] - 1.0)
        + 0.16 * upgrade_score
        + 0.10 * headroom
        + (0.08 if persona["strategy"] == "AGGRESSIVE" else 0.0)
        - (0.10 if persona["strategy"] == "CONSERVATIVE" else 0.0)
    )

    return {
        "base_value": round(base, 3),
        "fair_value": fair,
        "ceiling": ceiling,
        "interest": round(interest, 4),
        "headroom": round(headroom, 4),
        "saturated": saturated,
        "quality_upgrade": quality_upgrade,
        "persona": persona,
        "factors": {
            "role": role_adj,
            "status": status_adj,
            "age": round(age_adj, 4),
            "stats": round(stat_adj, 4),
            "category": category_adj,
            "need": round(need_adj, 4),
            "scarcity": round(scarcity_adj, 4),
            "competition": round(competition_adj, 4),
            "strategy": strategy_adj,
            "personality": round(bias_adj * taste_adj, 4),
        },
    }


def _reason(action: str, analysis: dict, valuation: dict, detail: str) -> str:
    plan = analysis["purse"]
    persona = valuation["persona"]
    return (
        f"{detail}; difficulty={analysis['difficulty']}; "
        f"valuation={valuation['fair_value']:.2f}cr ceiling={valuation['ceiling']:.2f}cr "
        f"base={valuation['base_value']:.2f}cr; role={analysis['role']} "
        f"gap={analysis['role_gap']:.2f}; spendable={plan['spendable']:.2f}cr "
        f"reserve={plan['reserve']:.2f}cr; "
        f"scarcity={analysis['scarcity']['score']:.2f} "
        f"pressure={analysis['competition']['score']:.2f}; "
        f"personality={persona['bias_unit']:.2f}; action={action}"
    )


def make_decision(ctx: dict, analysis: dict | None = None, valuation: dict | None = None) -> dict:
    """Pure decision step: BID at nextBid, otherwise PASS / WITHDRAW."""
    analysis = analysis or analyze(ctx)
    valuation = valuation or value_player(analysis)
    self_info = analysis["self_info"]
    player = analysis["player"]
    next_bid = analysis["next_bid"]
    base_price = analysis["base_price"]
    ceiling = valuation["ceiling"]
    plan = analysis["purse"]
    persona = valuation["persona"]
    engaged = analysis["engagement"]["in_lot"]
    is_leader = analysis["engagement"]["is_leader"]

    def result(action: str, amount: float | None, confidence: float, detail: str) -> dict:
        return {
            "action": action,
            "amount": amount,
            "confidence": round(clamp(confidence), 4),
            "publicComment": "",
            "privateReason": _reason(action, analysis, valuation, detail),
            "_analysis": analysis,
            "_valuation": valuation,
        }

    if self_info.get("withdrawn"):
        return result("WITHDRAW", None, 0.99, "franchise already withdrawn from this lot")

    rejected = [str(item) for item in as_list(self_info.get("rejected"))]
    if analysis["player_id"] and analysis["player_id"] in rejected:
        return result("PASS", None, 0.86, "player on the rejected list")

    if next_bid <= 0:
        return result("PASS", None, 0.70, "no valid next bid supplied")

    if analysis["overseas"]["blocked"]:
        return result("PASS", None, 0.95, "overseas slot quota exhausted")

    if plan["remaining_slots"] <= 0:
        return result("PASS", None, 0.95, "no squad slot remaining")

    if is_leader:
        return result("PASS", None, 0.99, "already leading this lot")

    price_gap = max(0.0, next_bid - ceiling)
    over_ceiling = price_gap > 1e-9
    if over_ceiling and (engaged or ceiling >= base_price):
        excess = clamp(price_gap / max(0.5, ceiling))
        return result(
            "WITHDRAW", None, 0.62 + 0.28 * excess + 0.08 * persona["bias_unit"],
            f"price {next_bid:.2f}cr exceeds private ceiling",
        )

    if ceiling < base_price:
        return result("PASS", None, 0.58 + 0.20 * (1.0 - valuation["interest"]),
                      "player is outside our private range at base price")

    willing = valuation["interest"] >= 0.30 or valuation["quality_upgrade"]
    if not willing:
        return result("PASS", None, 0.52 + 0.25 * (1.0 - valuation["interest"]),
                      f"role gap {analysis['role_gap']:.2f} does not justify a bid")

    if next_bid > num(plan["purse"]) + 1e-9:
        return result("WITHDRAW", None, 0.96, "next bid exceeds remaining purse")

    amount = next_bid
    confidence = (
        0.50
        + 0.24 * valuation["headroom"]
        + 0.18 * valuation["interest"]
        + 0.08 * persona["bias_unit"]
    )
    return result(
        "BID", amount, confidence,
        f"bidding {next_bid:.2f}cr on a {analysis['role'].lower()} we need",
    )


def decide(ctx: dict) -> dict:
    """Return the exact contract response for POST /decide."""
    analysis = analyze(ctx)
    valuation = value_player(analysis)
    decision = make_decision(ctx, analysis, valuation)

    # discussion.py imports nothing from this module, so there is no cycle.
    from discussion import public_comment

    comment = public_comment(analysis, valuation, decision)
    return {
        "action": decision["action"],
        "amount": decision["amount"],
        "confidence": round(clamp(decision["confidence"]), 2),
        "publicComment": comment,
        "privateReason": decision["privateReason"],
    }
