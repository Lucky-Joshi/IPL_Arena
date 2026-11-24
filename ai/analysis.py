"""Squad, purse and player-pool analysis for the T20 Dynasty AI.

Everything in this module is a pure function of the request context: no global
state, no randomness, no clock.  The numbers produced here feed the private
valuation engine in ``valuation.py`` and the public commentary in
``discussion.py``.
"""

from __future__ import annotations

ROLES = ("BATTER", "BOWLER", "ALLROUNDER", "WICKETKEEPER")

# Approximate composition of a balanced completed franchise squad.
ROLE_TARGET_SHARE = {
    "BATTER": 0.28,
    "BOWLER": 0.38,
    "ALLROUNDER": 0.20,
    "WICKETKEEPER": 0.12,
}

ROLE_ALIASES = {
    "BATTER": "BATTER",
    "BATSMAN": "BATTER",
    "BAT": "BATTER",
    "BOWLER": "BOWLER",
    "BOWL": "BOWLER",
    "ALLROUNDER": "ALLROUNDER",
    "ALL-ROUNDER": "ALLROUNDER",
    "ALL_ROUNDER": "ALLROUNDER",
    "AR": "ALLROUNDER",
    "WICKETKEEPER": "WICKETKEEPER",
    "WICKET-KEEPER": "WICKETKEEPER",
    "WICKET_KEEPER": "WICKETKEEPER",
    "WK": "WICKETKEEPER",
    "KEEPER": "WICKETKEEPER",
}

DOMESTIC = {"india", "ind", "indian"}


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """Clamp ``value`` into [low, high]."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = low
    if number != number:  # NaN
        return low
    return max(low, min(high, number))


def num(value: object, default: float = 0.0) -> float:
    """Defensive numeric conversion for optional request fields."""
    if value is None or isinstance(value, bool):
        return float(default)
    try:
        result = float(value)
    except (TypeError, ValueError):
        return float(default)
    if result != result or result in (float("inf"), float("-inf")):
        return float(default)
    return result


def integer(value: object, default: int = 0) -> int:
    return int(num(value, default))


def as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def as_list(value: object) -> list:
    return value if isinstance(value, list) else []


def normalize_role(value: object) -> str | None:
    """Map a role-like string onto one of the four contract roles."""
    if not isinstance(value, str):
        return None
    key = value.strip().upper().replace(" ", "_")
    return ROLE_ALIASES.get(key)


def normalize_difficulty(value: object) -> str:
    text = str(value or "").strip().upper()
    return text if text in ("RELAXED", "BALANCED", "HARD") else "BALANCED"


def normalize_format(value: object) -> str:
    text = str(value or "").strip().upper()
    return "MINI" if text == "MINI" else "MEGA"


def normalize_season(value: object, fmt: str) -> str:
    """Resolve a LCB season key, falling back to the auction format."""
    text = str(value or "").strip()
    if text in ("2025", "2026", "2027"):
        return text
    return "2026" if fmt == "MINI" else "2025"


def capped_status(player: dict) -> dict:
    """LCB capped/uncapped status, with safe defaults for older test fixtures."""
    capped_value = player.get("capped")
    capped = True if capped_value is None else bool(capped_value)
    return {
        "capped": capped,
        "uncapped": not capped,
        "reason": player.get("uncappedReason") or "",
        "contract_fee": max(0.0, num(player.get("contractFee"))),
        "previous_franchise_id": player.get("previousFranchiseId") or "",
    }


def nationality_of(player: dict) -> str:
    for key in ("nationality", "country", "nation"):
        text = player.get(key)
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def is_overseas(player: dict) -> bool:
    """Only Indian players occupy domestic slots; missing data is domestic."""
    return nationality_of(player).lower() not in DOMESTIC and bool(nationality_of(player))


def squad_profile(squad: object) -> dict:
    """Count players and measure established quality at each role."""
    counts = {role: 0 for role in ROLES}
    ratings = {role: [] for role in ROLES}
    overseas = 0
    age_sum = 0.0
    age_count = 0

    for entry in as_list(squad):
        if not isinstance(entry, dict):
            continue
        role = normalize_role(entry.get("role"))
        if role is None:
            continue
        counts[role] += 1
        ratings[role].append(clamp(num(entry.get("rating"), 60), 1, 100))
        if is_overseas(entry):
            overseas += 1
        if entry.get("age") is not None:
            age_sum += num(entry.get("age"), 27)
            age_count += 1

    quality = {}
    for role in ROLES:
        ordered = sorted(ratings[role], reverse=True)
        if ordered:
            top = ordered[:3]
            quality[role] = round(sum(top) / len(top), 2)
        else:
            quality[role] = 0.0

    total = sum(counts.values())
    return {
        "squad_size": total,
        "counts": counts,
        "quality": quality,
        "top_ratings": {role: sorted(ratings[role], reverse=True) for role in ROLES},
        "overseas_count": overseas,
        "average_age": round(age_sum / age_count, 1) if age_count else 0.0,
    }


def target_counts(squad_size: int, config: dict) -> dict:
    """Target head-count per role for the squad we expect to finish with."""
    min_squad = integer(config.get("minSquad"), 18)
    max_squad = integer(config.get("maxSquad"), 25)
    final_size = max(squad_size, min_squad)
    if max_squad > 0:
        final_size = min(final_size, max_squad)
    final_size = max(final_size, squad_size, 1)
    targets = {}
    for role in ROLES:
        targets[role] = max(1, int(round(final_size * ROLE_TARGET_SHARE[role])))
    return targets


def role_gaps(profile: dict, config: dict) -> dict:
    """Per-role need in [0, 1], combining head-count and established quality."""
    targets = target_counts(integer(profile.get("squad_size")), config)
    gaps = {}
    for role in ROLES:
        target = targets[role]
        count = integer(profile.get("counts", {}).get(role))
        quality = num(profile.get("quality", {}).get(role))
        deficit = max(0, target - count)
        # A squad with no proven player at the role has a full quality gap.
        quality_gap = 1.0 if quality <= 0 else clamp((74.0 - quality) / 40.0)
        count_score = deficit / max(2, target)
        score = clamp(0.78 * count_score + 0.22 * quality_gap + (0.12 if deficit else 0.0))
        gaps[role] = {
            "role": role,
            "target": target,
            "count": count,
            "deficit": deficit,
            "quality": round(quality, 2),
            "score": round(score, 4),
        }
    return gaps


def overseas_status(player: dict, self_info: dict, profile: dict, config: dict) -> dict:
    """Remaining overseas slots and whether this player is blocked/tight."""
    maximum = integer(config.get("maxOverseas"), 8)
    declared = integer(self_info.get("overseasCount"), -1)
    counted = integer(profile.get("overseas_count"))
    used = declared if declared >= 0 else counted
    remaining = max(0, maximum - used)
    overseas = is_overseas(player)
    return {
        "used": used,
        "max": maximum,
        "remaining": remaining,
        "overseas_player": overseas,
        "blocked": overseas and remaining <= 0,
        "tight": overseas and remaining == 1,
    }


def alternative_scarcity(auction: dict, player: dict, fmt: str) -> dict:
    """How hard is it to find a comparable player still in the pool?"""
    available = as_dict(auction.get("availableByRole"))
    raw = available.get(player.get("role"))
    if raw is None:
        raw = available.get(normalize_role(player.get("role")) or "")
    fallback = 14 if fmt == "MEGA" else 7
    count = integer(raw, fallback) if raw is not None else fallback
    reference = 24 if fmt == "MEGA" else 12
    pool_scarcity = clamp(1.0 - count / float(reference))

    # If the optional full list is supplied, count genuinely similar players.
    pool = as_list(auction.get("availablePlayers"))
    alternatives = 0
    if pool:
        target_rating = num(player.get("rating"), 60)
        target_role = normalize_role(player.get("role"))
        for candidate in pool:
            if not isinstance(candidate, dict):
                continue
            if target_role and normalize_role(candidate.get("role")) != target_role:
                continue
            if abs(num(candidate.get("rating"), 0) - target_rating) <= 8:
                alternatives += 1
        direct_scarcity = clamp(1.0 - alternatives / 4.0)
    else:
        direct_scarcity = 0.0

    return {
        "count": count,
        "direct_alternatives": alternatives if pool else None,
        "score": round(max(pool_scarcity, direct_scarcity), 4),
    }


def competition_pressure(auction: dict, self_info: dict, others: object, next_bid: float) -> dict:
    """Estimate how much rival money is likely to contest this lot."""
    bids = max(0, integer(auction.get("bidsThisLot")))
    leader = auction.get("leaderId")
    self_id = self_info.get("id")
    is_leader = bool(self_info.get("isLeader")) or bool(leader and self_id and leader == self_id)
    rivals = [entry for entry in as_list(others) if isinstance(entry, dict)]
    funded = sum(1 for rival in rivals if num(rival.get("purse")) >= max(1.0, next_bid))
    funded_share = funded / len(rivals) if rivals else 0.35
    score = clamp(0.55 * min(1.0, bids / 5.0) + 0.45 * funded_share)
    return {
        "bids": bids,
        "is_leader": is_leader,
        "funded_rivals": funded,
        "rival_count": len(rivals),
        "score": round(score, 4),
    }


def engagement(auction: dict, self_info: dict) -> dict:
    """Has this franchise already committed to the current lot?"""
    self_id = self_info.get("id")
    active = self_id in [entry for entry in as_list(auction.get("activeBidderIds"))]
    history = any(
        isinstance(entry, dict) and entry.get("franchiseId") == self_id
        for entry in as_list(auction.get("bidHistory"))
    )
    is_leader = bool(self_info.get("isLeader")) or bool(
        auction.get("leaderId") and self_id and auction.get("leaderId") == self_id
    )
    return {
        "is_leader": is_leader,
        "active": active,
        "has_bid": history,
        "in_lot": is_leader or active or history or bool(self_info.get("hasBid")),
    }


def purse_plan(ctx: dict, profile: dict, scarcity: float, difficulty: str) -> dict:
    """Affordable spend after reserving money for the slots left to fill."""
    config = as_dict(ctx.get("config"))
    self_info = as_dict(ctx.get("self"))
    fmt = normalize_format(ctx.get("format"))
    purse = max(0.0, num(self_info.get("purse")))
    squad_size = integer(profile.get("squad_size"))
    squad_slots = max(0, integer(config.get("maxSquad"), 25) - squad_size)

    additions_used = max(0, integer(self_info.get("additionsUsed")))
    max_additions = max(0, integer(self_info.get("maxAdditions")))
    if fmt == "MINI" and max_additions > 0:
        remaining_slots = min(squad_slots, max(0, max_additions - additions_used))
    else:
        remaining_slots = squad_slots

    reserve_per_slot = max(0.0, num(config.get("minReservePerSlot"), 0.2))
    after_this_bid = max(0, remaining_slots - 1)
    base_reserve = reserve_per_slot * after_this_bid

    if difficulty == "RELAXED":
        reserve = base_reserve + reserve_per_slot + 0.05 * purse
    elif difficulty == "HARD":
        # Scarcer remaining talent means the later slots cost more to fill.
        reserve = base_reserve + (0.03 + 0.04 * scarcity) * purse
    else:
        reserve = base_reserve

    reserve = min(purse, reserve)
    return {
        "purse": round(purse, 4),
        "remaining_slots": remaining_slots,
        "reserve": round(reserve, 4),
        "spendable": round(max(0.0, purse - reserve), 4),
        "reserve_per_slot": reserve_per_slot,
    }


def analyze(ctx: dict) -> dict:
    """Build the full analytical picture used by the decision engine."""
    context = as_dict(ctx)
    config = as_dict(context.get("config"))
    self_info = as_dict(context.get("self"))
    auction = as_dict(context.get("auction"))
    player = as_dict(context.get("player"))
    difficulty = normalize_difficulty(context.get("difficulty"))
    fmt = normalize_format(context.get("format"))
    season = normalize_season(context.get("season"), fmt)
    rules = as_dict(context.get("rules"))
    status = capped_status(player)

    profile = squad_profile(self_info.get("squad"))
    gaps = role_gaps(profile, config)
    role = normalize_role(player.get("role")) or "BATTER"
    role_info = gaps[role]
    overseas = overseas_status(player, self_info, profile, config)
    scarcity = alternative_scarcity(auction, player, fmt)
    next_bid = num(auction.get("nextBid"), -1.0)
    competition = competition_pressure(auction, self_info, context.get("others"), max(0.0, next_bid))
    engaged = engagement(auction, self_info)

    # In Mini Auctions an overseas salary above ₹18 Cr is diverted to the LCB
    # welfare fund, so it does not increase the player's value to the squad.
    cap_value = rules.get("overseasSalaryCap", config.get("overseasSalaryCap"))
    overseas_cap = max(0.0, num(cap_value))
    is_overseas_player = overseas["overseas_player"]
    salary_blocked = is_overseas_player and overseas_cap > 0
    salary_spend = max(0.0, num(self_info.get("overseasSalarySpend")))
    salary_ceiling = max(0.0, overseas_cap) if salary_blocked else 0.0

    return {
        "difficulty": difficulty,
        "format": fmt,
        "season": season,
        "status": status,
        "overseas_salary": {
            "cap": overseas_cap,
            "spend": round(salary_spend, 4),
            "effective_ceiling": salary_ceiling,
            "salary_blocked": salary_blocked,
            "claw": as_dict(auction.get("claw")) or None,
        },
        "player": player,
        "player_id": str(player.get("id") or ""),
        "role": role,
        "self_info": self_info,
        "auction": auction,
        "config": config,
        "profile": profile,
        "gaps": gaps,
        "role_info": role_info,
        "role_gap": role_info["score"],
        "overseas": overseas,
        "scarcity": scarcity,
        "competition": competition,
        "engagement": engaged,
        "next_bid": next_bid,
        "base_price": max(0.0, num(player.get("basePrice"), 1.0)),
        "purse": purse_plan(context, profile, scarcity["score"], difficulty),
    }
