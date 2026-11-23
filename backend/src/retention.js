/**
 * BCCI 2025–27 retention rules.
 *
 * MEGA: at most six players, of whom at most five are capped and at most two
 * are uncapped. Capped retentions cost ₹18/14/11/18/14 Cr in selection order;
 * uncapped retentions cost ₹4 Cr each. Every retention not used leaves an RTM
 * card behind (up to 6 − direct retentions).
 *
 * MINI: no retention cap and no RTM. A retained player keeps their existing
 * contract fee; releasing them returns that salary to the purse.
 */

import {
  CAPPED_RETENTION_SLABS,
  MAX_RETENTIONS,
  UNCAPPED_RETENTION_COST,
  isMega,
  rulesFor,
} from './rules.js';

export const RETENTION_SLABS = Object.freeze(CAPPED_RETENTION_SLABS);
export const RETENTION_LIMITS = Object.freeze({ MEGA: MAX_RETENTIONS, MINI: 25 });
export const UNCAPPED_RETENTION_COST_CRS = UNCAPPED_RETENTION_COST;

function fail(error) {
  return { ok: false, error };
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

export function isUncapped(player) {
  return player?.capped === false || player?.capped === undefined
    ? true
    : false;
}

/** Cost of one retention in ₹ Cr, given its order among capped/uncapped picks. */
export function retentionCost(player, options = {}) {
  const opts = typeof options === 'string' ? { season: options } : options || {};
  const season = opts.season || player?.season || (opts.state?.season) || (opts.state?.format === 'MINI' ? '2026' : '2025');
  const rules = rulesFor(season, opts.format || opts.state?.format);
  if (rules.format === 'MINI') return Math.round(numberOr(player?.contractFee, 0.3) * 100) / 100;
  if (isUncapped(player)) return rules.uncappedRetentionCost;
  const index = numberOr(opts.cappedIndex, 0);
  return Number(rules.cappedRetentionSlabs[Math.min(Math.max(0, index), rules.cappedRetentionSlabs.length - 1)]);
}

/**
 * Build and validate a complete retention plan for one franchise.
 * The caller resets existing retentions first so every figure starts at CREATE.
 */
export function buildRetentionPlan(state, franchiseId, playerIds) {
  if (!state || typeof state !== 'object') return fail('Auction state is unavailable');
  const franchise = (state.franchises || []).find((entry) => entry.id === franchiseId);
  if (!franchise) return fail(`Franchise ${franchiseId} was not found`);
  if (!Array.isArray(playerIds)) return fail('Retention selection must be a list of player ids');

  const unique = [...new Set(playerIds.map((id) => String(id)))];
  if (unique.length !== playerIds.length) return fail('A player cannot be retained twice');

  const rules = rulesFor(state.season, state.format);
  const mega = rules.format === 'MEGA';
  const max = mega ? rules.maxRetentions : Math.min(numberOr(state.config?.maxSquad, 25), 25);
  if (unique.length > max) return fail(`${rules.label} allows at most ${max} retentions`);

  const maxSquad = numberOr(state.config?.maxSquad, rules.maxSquad);
  const maxOverseas = numberOr(state.config?.maxOverseas, rules.maxOverseas);
  const reservePerSlot = numberOr(state.config?.minReservePerSlot, 0);
  const ownerByPlayer = new Map();
  for (const team of state.franchises || []) {
    for (const id of team.squad || []) ownerByPlayer.set(id, team.id);
  }

  const entries = [];
  let total = 0;
  let overseas = 0;
  let overseasSalary = 0;
  let cappedCount = 0;
  let uncappedCount = 0;
  for (const id of unique) {
    const player = (state.players || []).find((candidate) => candidate.id === id);
    if (!player) return fail(`Retained player ${id} was not found`);
    if (player.availability !== 'AVAILABLE') return fail(`${player.name} is no longer in the auction pool`);
    if (!player.retentionCandidate) return fail(`${player.name} was not on a previous-season contract`);
    if (player.previousFranchiseId && player.previousFranchiseId !== franchiseId) {
      return fail(`${player.name} is contracted to another franchise`);
    }
    if (ownerByPlayer.has(id)) return fail(`${player.name} is already in another squad`);

    const capped = !isUncapped(player);
    if (capped) cappedCount += 1;
    else uncappedCount += 1;
    if (mega) {
      if (cappedCount > rules.maxCappedRetentions) {
        return fail(`A Mega auction allows at most ${rules.maxCappedRetentions} capped retentions`);
      }
      if (uncappedCount > rules.maxUncappedRetentions) {
        return fail(`A Mega auction allows at most ${rules.maxUncappedRetentions} uncapped retentions`);
      }
    }
    const cost = retentionCost(player, {
      season: state.season,
      cappedIndex: cappedCount - 1,
      uncappedIndex: uncappedCount - 1,
    });
    if (isOverseas(player)) {
      overseas += 1;
      overseasSalary += cost;
    }
    total += cost;
    entries.push({
      playerId: id,
      cost,
      capped,
      name: player.name,
      contractFee: numberOr(player.contractFee, 0),
    });
  }

  if (overseas > maxOverseas) return fail(`Retentions would exceed the overseas limit of ${maxOverseas}`);
  const overseasSalaryCap = numberOr(rules.overseasSalaryCap, 0);
  if (overseasSalaryCap > 0 && overseasSalary > overseasSalaryCap + 0.000001) {
    return fail(`Retained overseas contracts of ₹${Math.round(overseasSalary * 100) / 100} Cr breach the ₹${overseasSalaryCap} Cr overseas salary cap`);
  }
  if (unique.length > maxSquad) return fail(`Retentions would exceed the squad limit of ${maxSquad}`);
  if (unique.length > 0) {
    const reserve = mega ? Math.max(0, minSquadReserve(state, unique.length, reservePerSlot)) : 0;
    if (numberOr(franchise.purse, 0) - total < reserve - 0.000001) {
      return fail(`Retention cost of ₹${total.toFixed(2)} Cr does not fit the purse`);
    }
  }

  return {
    ok: true,
    entries,
    total: Math.round(total * 100) / 100,
    cappedCount,
    uncappedCount,
    rtmCards: mega ? rules.maxRetentions - entries.length : 0,
  };
}

function minSquadReserve(state, retainedCount, reservePerSlot) {
  const rules = rulesFor(state.season, state.format);
  return Math.max(0, numberOr(state.config?.minSquad, rules.minSquad) - retainedCount) * reservePerSlot;
}

export function validateRetentionSelection(state, franchiseId, playerIds) {
  return buildRetentionPlan(state, franchiseId, playerIds);
}

/** Apply a validated selection to one franchise. */
export function applyRetentionSelection(state, franchiseId, playerIds) {
  const franchise = (state.franchises || []).find((entry) => entry.id === franchiseId);
  if (!franchise) return;
  const plan = buildRetentionPlan(state, franchiseId, playerIds);
  if (!plan.ok) return;
  const config = state.config || {};
  const rules = rulesFor(state.season, state.format);

  for (const entry of plan.entries) {
    const player = (state.players || []).find((candidate) => candidate.id === entry.playerId);
    if (!player) continue;
    franchise.squad.push(player.id);
    franchise.existing.push(player.id);
    franchise.retentions.push({
      playerId: player.id,
      cost: entry.cost,
      capped: entry.capped,
      contractFee: entry.contractFee,
      rating: Number(player.rating) || 0,
      name: player.name,
    });
    player.availability = 'SOLD';
    player.soldTo = franchise.id;
    player.soldPrice = 0;
    player.soldRound = null;
    player.existing = true;
    player.retained = true;
    player.retentionCost = entry.cost;
    // A retained player keeps their previous contract salary. In a Mini
    // Auction every squad member counts towards the ₹18 Cr overseas salary
    // ceiling, so retained overseas contracts must be included.
    player.salary = entry.cost;
    player.auctionRoundBought = rules.format;
    // A retained contract is not a mini-auction signing and may be traded in
    // the post-auction window; only fresh purchases carry this flag.
    player.purchasedInMini = false;
    if (isOverseas(player)) {
      franchise.overseasSalarySpend = Math.round(((Number(franchise.overseasSalarySpend) || 0) + entry.cost) * 100) / 100;
    }
  }

  franchise.retentionSpent = Math.round((numberOr(franchise.retentionSpent, 0) + plan.total) * 100) / 100;
  franchise.purse = Math.round((numberOr(franchise.purse, 0) - plan.total) * 100) / 100;
  franchise.rtmCards = plan.rtmCards;

  if (rules.format === 'MINI') {
    const retainedCount = (franchise.squad || []).length;
    const room = Math.max(0, numberOr(config.maxSquad, rules.maxSquad) - retainedCount);
    const needed = Math.max(0, numberOr(config.minSquad, rules.minSquad) - retainedCount);
    franchise.additionsLimit = Math.min(room, Math.max(numberOr(config.maxAdditions, 6), needed));
  } else {
    franchise.additionsLimit = numberOr(config.maxSquad, rules.maxSquad);
  }
}

/** Restore every retained player and all franchise purses to their CREATE state. */
export function resetRetentions(state) {
  if (!state || !Array.isArray(state.franchises)) return;
  const retainedIds = new Set();
  for (const player of state.players || []) {
    if (!player?.retained) continue;
    retainedIds.add(player.id);
    player.availability = 'AVAILABLE';
    player.soldTo = null;
    player.soldPrice = 0;
    player.soldRound = null;
    player.existing = false;
    player.retained = false;
    delete player.retentionCost;
    delete player.salary;
    delete player.auctionRoundBought;
    delete player.purchasedInMini;
  }
  // Legacy saves used `existing` without the `retained` flag.
  if (state.phase === 'SETUP' && !state.retentionsConfirmed) {
    for (const player of state.players || []) {
      if (player?.existing && !player.retained && Number(player.soldPrice) === 0) {
        retainedIds.add(player.id);
        player.availability = 'AVAILABLE';
        player.soldTo = null;
        player.soldPrice = 0;
        player.soldRound = null;
        player.existing = false;
      }
    }
  }

  const startingPurse = numberOr(state.config?.startingPurse, 0);
  const rules = rulesFor(state.season, state.format);
  for (const franchise of state.franchises) {
    franchise.squad = (franchise.squad || []).filter((id) => !retainedIds.has(id));
    franchise.existing = (franchise.existing || []).filter((id) => !retainedIds.has(id));
    franchise.retentions = [];
    franchise.retentionSpent = 0;
    franchise.purse = startingPurse;
    franchise.rtmCards = rules.rtmAvailable ? rules.maxRetentions : 0;
    franchise.rtmUsed = 0;
    franchise.overseasSalarySpend = 0;
    franchise.additionsLimit = rules.format === 'MINI'
      ? numberOr(state.config?.maxAdditions, 6)
      : numberOr(state.config?.maxSquad, rules.maxSquad);
  }
  state.retentionsConfirmed = false;
}

/**
 * Deterministic retention picker for the nine AI franchises. Each team can
 * only retain players from its own previous-season contract list.
 */
export function autoRetainAi(state) {
  if (!state || !Array.isArray(state.franchises)) return;
  const rules = rulesFor(state.season, state.format);
  const teams = state.franchises.filter((franchise) => franchise.id !== state.userFranchiseId);
  if (!teams.length) return;

  teams.forEach((franchise, teamIndex) => {
    const ownedFor = (cappedWanted) => (state.players || []).filter((player) => {
      if (!player.retentionCandidate || player.previousFranchiseId !== franchise.id) return false;
      if (player.availability !== 'AVAILABLE') return false;
      return cappedWanted === null ? true : !isUncapped(player) === cappedWanted;
    });
    let plan = [];
    if (rules.format === 'MEGA') {
      const uncappedTarget = Math.min(rules.maxUncappedRetentions, 1 + (teamIndex % 2));
      const cappedTarget = Math.min(
        rules.maxCappedRetentions,
        rules.maxRetentions - uncappedTarget,
        3 + (teamIndex % 3)
      );
      plan.push(...pickBest(ownedFor(true), cappedTarget, franchise));
      plan.push(...pickBest(ownedFor(false), uncappedTarget, franchise));
    } else {
      const target = Math.min((franchise.previousSquad || []).length, 15 + (teamIndex % 3));
      // Mini retentions keep the exact contract fee, so overseas picks must
      // stay inside the ₹18 Cr overseas salary ceiling.
      const overseasCap = numberOr(rules.overseasSalaryCap, 0);
      let overseasSalary = 0;
      plan.push(...pickBest(ownedFor(null), target, franchise).filter((id) => {
        const player = (state.players || []).find((candidate) => candidate.id === id);
        if (!player || !isOverseas(player)) return true;
        const fee = retentionCost(player, { season: state.season });
        if (overseasCap > 0 && overseasSalary + fee > overseasCap + 0.000001) return false;
        overseasSalary += fee;
        return true;
      }));
    }
    // Apply the whole selection at once: capped slabs and the RTM card count
    // both depend on the complete ordered list, not on each player in isolation.
    plan = plan.slice(0, rules.maxRetentions);
    const check = buildRetentionPlan(state, franchise.id, plan);
    if (check.ok) applyRetentionSelection(state, franchise.id, plan);
  });
}

function pickBest(candidates, count, franchise) {
  if (count <= 0) return [];
  const targets = Array.isArray(franchise.targets) ? franchise.targets : [];
  return candidates
    .map((player) => ({
      player,
      score: ratingOf(player)
        + (targets.includes(player.role) ? 2 : 0)
        + (franchise.strategy === 'AGGRESSIVE' && ratingOf(player) >= 85 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || String(a.player.id).localeCompare(String(b.player.id)))
    .slice(0, count)
    .map((entry) => entry.player.id);
}

function ratingOf(player) {
  return Number(player?.rating) || 0;
}

export default retentionCost;
