"""Short, contextual public management commentary.

Only facts present in the request (player, squad, purse, pool) are used here.
Private fair values, ceilings and reserve maths never enter a public comment.
"""

from __future__ import annotations

import hashlib

from analysis import num

AUTHORS = (
    "Owner",
    "Head Coach",
    "Director of Cricket",
    "Auction Strategist",
    "Data Analyst",
    "Scouting Head",
)

ROLE_LABEL = {
    "BATTER": "batter",
    "BOWLER": "bowler",
    "ALLROUNDER": "all-rounder",
    "WICKETKEEPER": "wicketkeeper",
}


def as_list(value: object) -> list:
    return value if isinstance(value, list) else []


def _facts(analysis: dict, valuation: dict, decision: dict) -> dict:
    player = analysis["player"]
    role_info = analysis["role_info"]
    plan = analysis["purse"]
    role_label = ROLE_LABEL.get(analysis["role"], "player")
    name = str(player.get("name") or f"the {role_label}").strip()
    rejected = str(analysis["player_id"]) in [
        str(item) for item in as_list(analysis["self_info"].get("rejected"))
    ]
    return {
        "name": name,
        "role": analysis["role"],
        "role_label": role_label,
        "count": int(role_info["count"]),
        "target": int(role_info["target"]),
        "quality": num(role_info["quality"]),
        "gap": analysis["role_gap"],
        "rating": num(player.get("rating"), 50),
        "category": str(player.get("category") or "").upper(),
        "purse": num(plan.get("purse")),
        "slots": int(plan.get("remaining_slots", 0)),
        "pool": int(analysis["scarcity"].get("count", 0)),
        "pool_scarce": analysis["scarcity"]["score"] >= 0.55,
        "overseas_remaining": int(analysis["overseas"].get("remaining", 0)),
        "overseas_player": bool(analysis["overseas"].get("overseas_player")),
        "bids": int(analysis["competition"].get("bids", 0)),
        "action": decision["action"],
        "quality_upgrade": bool(valuation.get("quality_upgrade")),
        "saturated": bool(valuation.get("saturated")),
        "rejected": rejected,
    }


def _voice_unit(analysis: dict, decision: dict) -> float:
    key = "|".join(
        str(part) for part in (
            analysis["self_info"].get("id"),
            analysis["player_id"],
            decision["action"],
            "management-voice",
        )
    ).encode("utf-8")
    return int.from_bytes(hashlib.sha256(key).digest()[:8], "big") / float(1 << 64)


def select_author(analysis: dict, valuation: dict, decision: dict, facts: dict) -> str:
    """Pick the management voice whose remit matches the reason for the call."""
    index = min(len(AUTHORS) - 1, int(_voice_unit(analysis, decision) * len(AUTHORS)))

    if facts["action"] == "WITHDRAW":
        return "Auction Strategist" if facts["purse"] < 15 else "Director of Cricket"
    if facts["rejected"]:
        return "Scouting Head"
    if facts["overseas_player"] and facts["overseas_remaining"] <= 1:
        return "Scouting Head"
    if facts["pool_scarce"] and facts["gap"] > 0.3:
        return "Data Analyst"
    if facts["role"] == "BOWLER" and facts["count"] < facts["target"]:
        return "Head Coach"
    if facts["category"] == "MARQUEE" or facts["rating"] >= 88:
        return "Owner"
    if facts["action"] == "BID" and facts["bids"] >= 3:
        return "Auction Strategist"
    return AUTHORS[index]


def _sentence(facts: dict) -> str:
    name = facts["name"]
    role = facts["role_label"]
    count = facts["count"]
    action = facts["action"]

    if action == "WITHDRAW":
        if facts["purse"] < 15 or facts["slots"] > 4:
            return f"We step away from {name} to protect the purse for the slots still to fill."
        return f"We step away from {name}; the bidding has run past our {role} plan."

    if facts["rejected"]:
        return f"{name} stays off our list after the scouting review."
    if facts["overseas_player"] and facts["overseas_remaining"] <= 1:
        return f"{name} is talented, but our overseas slots are nearly gone."
    if facts["saturated"]:
        return f"We already have {count} established {role}s, so {name} is not a priority."
    if action == "PASS":
        if facts["purse"] < 15:
            return f"We let {name} go to keep the purse for the slots still to fill."
        if facts["pool"] > 0 and not facts["pool_scarce"]:
            return f"There is still depth at {role} in the pool, so we can let {name} go."
        return f"{name} does not add enough to our {role} group."

    # BID messages: each cites a real fact from the request.
    if facts["quality_upgrade"]:
        return f"{name} is a clear step up on the {role}s we already have."
    if facts["pool_scarce"]:
        return f"{name} is one of the few {role}s left in the pool."
    if facts["gap"] >= 0.55:
        return f"{name} gives us needed {role} cover with only {count} in the squad."
    if facts["bids"] >= 3:
        return f"{name} strengthens the {role} group, so we stay in the fight."
    return f"{name} fits the {role} group we are building."


def public_comment(analysis: dict, valuation: dict, decision: dict) -> str:
    """One short sentence, prefixed by the speaking manager's role."""
    facts = _facts(analysis, valuation, decision)
    author = select_author(analysis, valuation, decision, facts)
    return f"{author}: {_sentence(facts)}"
