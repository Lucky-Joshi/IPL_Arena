/**
 * Retention rules shared by the engine, validator and results.
 *
 * Retentions are chosen during SETUP from the live player pool. Each retained
 * player is removed from the auction and costs a fixed slab based on rating;
 * that cost is deducted from the franchise purse immediately.
 */

export const RETENTION_SLABS = Object.freeze([
  { min: 90, cost: 5 },
  { min: 85, cost: 4 },
  { min: 80, cost: 3 },
  { min: 75, cost: 2 },
  { min: 70, cost: 1.5 },
  { min: -Infinity, cost: 1 },
]);

export const RETENTION_LIMITS = Object.freeze({ MEGA: 3, MINI: 15 });

/** Rating slab cost in ₹ Cr. */
export function retentionCost(player) {
  const rating = Number(player?.rating);
  const slab = RETENTION_SLABS.find((entry) => Number.isFinite(rating) && rating >= entry.min);
  return slab ? slab.cost : 1;
}

function fail(error) {
  return { ok: false, error };
}

function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * Validate a complete retention selection against the current SETUP state.
 * The caller must have reset existing retentions first so `purse` is the
 * starting purse and every candidate is AVAILABLE.
 */
export function validateRetentionSelection(state, franchiseId, playerIds) {
  if (!state || typeof state !== 'object') return fail('Auction state is unavailable');
  const franchise = (state.franchises || []).find((entry) => entry.id === franchiseId);
  if (!franchise) return fail(`Franchise ${franchiseId} was not found`);
  if (!Array.isArray(playerIds)) return fail('Retention selection must be a list of player ids');

  const unique = [...new Set(playerIds.map((id) => String(id)))];
  if (unique.length !== playerIds.length) return fail('A player cannot be retained twice');

  const max = Math.max(0, Math.floor(numberOr(state.config?.maxRetentions, RETENTION_LIMITS[state.format] || 3)));
  if (unique.length > max) {
    return fail(`${state.format} allows at most ${max} retention${max === 1 ? '' : 's'}`);
  }

  const maxSquad = numberOr(state.config?.maxSquad, 25);
  const maxOverseas = numberOr(state.config?.maxOverseas, 8);
  const minSquad = numberOr(state.config?.minSquad, 18);
  const reservePerSlot = numberOr(state.config?.minReservePerSlot, 0);
  const ownerByPlayer = new Map();
  for (const team of state.franchises || []) {
    for (const id of team.squad || []) ownerByPlayer.set(id, team.id);
  }

  let total = 0;
  let overseas = 0;
  for (const id of unique) {
    const player = (state.players || []).find((candidate) => candidate.id === id);
    if (!player) return fail(`Retained player ${id} was not found`);
    if (player.availability !== 'AVAILABLE') return fail(`${player.name} is no longer in the auction pool`);
    if (state.format === 'MINI' && !player.retentionCandidate) {
      return fail(`${player.name} is not an existing-squad retention candidate`);
    }
    if (ownerByPlayer.has(id)) return fail(`${player.name} is already in another squad`);
    if (isOverseas(player)) overseas += 1;
    total += retentionCost(player);
  }

  if (overseas > maxOverseas) return fail(`Retentions would exceed the overseas limit of ${maxOverseas}`);
  if (unique.length > maxSquad) return fail(`Retentions would exceed the squad limit of ${maxSquad}`);

  // An empty selection is always legal: reserve funds are a bidding rule for
  // the main auction, not a reason to block a small-purse auction from starting.
  if (unique.length > 0) {
    const requiredReserve = state.format === 'MINI' ? 0 : Math.max(0, minSquad - unique.length) * reservePerSlot;
    if (numberOr(franchise.purse, 0) - total < requiredReserve - 0.000001) {
      return fail(`Retention cost of ₹${total.toFixed(2)} Cr does not fit the purse`);
    }
  }
  return { ok: true };
}

/** Apply a validated selection to one franchise. */
export function applyRetentionSelection(state, franchiseId, playerIds) {
  const franchise = (state.franchises || []).find((entry) => entry.id === franchiseId);
  if (!franchise) return;
  const unique = [...new Set(playerIds.map((id) => String(id)))];
  const config = state.config || {};
  let total = 0;

  for (const id of unique) {
    const player = (state.players || []).find((candidate) => candidate.id === id);
    if (!player) continue;
    const cost = retentionCost(player);
    total += cost;
    franchise.squad.push(id);
    franchise.existing.push(id);
    franchise.retentions.push({ playerId: id, cost, rating: Number(player.rating) || 0, name: player.name });
    player.availability = 'SOLD';
    player.soldTo = franchise.id;
    player.soldPrice = 0;
    player.soldRound = null;
    player.existing = true;
    player.retained = true;
    player.retentionCost = cost;
  }

  // AI picks are applied one at a time, so spend must accumulate rather than
  // be replaced by the cost of the latest selection.
  franchise.retentionSpent = Math.round((numberOr(franchise.retentionSpent, 0) + total) * 100) / 100;
  franchise.purse = Math.round((numberOr(franchise.purse, 0) - total) * 100) / 100;

  if (state.format === 'MINI') {
    // Derive the cap from the squad as a whole — AI picks are applied one at a
    // time, so `unique.length` alone would only describe the latest pick.
    const retainedCount = (franchise.squad || []).length;
    const base = numberOr(config.maxAdditions, 6);
    const needed = Math.max(0, numberOr(config.minSquad, 18) - retainedCount);
    const room = Math.max(0, numberOr(config.maxSquad, 25) - retainedCount);
    franchise.additionsLimit = Math.min(room, Math.max(base, needed));
  } else {
    franchise.additionsLimit = numberOr(config.maxSquad, 25);
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
  }
  // Legacy saves used `existing` without the `retained` flag. In SETUP those
  // players are treated as unset retentions so the new picker owns the choice.
  const legacyIds = new Set();
  if (state.phase === 'SETUP' && !state.retentionsConfirmed) {
    for (const player of state.players || []) {
      if (player?.existing && !player.retained && Number(player.soldPrice) === 0) legacyIds.add(player.id);
    }
    for (const id of legacyIds) {
      const player = (state.players || []).find((candidate) => candidate.id === id);
      if (!player) continue;
      player.availability = 'AVAILABLE';
      player.soldTo = null;
      player.soldPrice = 0;
      player.soldRound = null;
      player.existing = false;
      delete player.retentionCost;
    }
  }

  const removed = new Set([...retainedIds, ...legacyIds]);
  const startingPurse = numberOr(state.config?.startingPurse, 0);
  for (const franchise of state.franchises) {
    franchise.squad = (franchise.squad || []).filter((id) => !removed.has(id));
    franchise.existing = (franchise.existing || []).filter((id) => !removed.has(id));
    franchise.retentions = [];
    franchise.retentionSpent = 0;
    franchise.purse = startingPurse;
    franchise.additionsLimit = state.format === 'MINI'
      ? numberOr(state.config?.maxAdditions, 6)
      : numberOr(state.config?.maxSquad, 25);
  }
  state.retentionsConfirmed = false;
}

/**
 * Deterministic retention picker for the nine AI franchises. Selection is
 * round-robin so each team gets a turn at the strongest remaining players.
 */
export function autoRetainAi(state) {
  if (!state || !Array.isArray(state.franchises)) return;
  const limit = Math.max(0, Math.floor(numberOr(state.config?.maxRetentions, RETENTION_LIMITS[state.format] || 3)));
  const teams = state.franchises.filter((franchise) => franchise.id !== state.userFranchiseId);
  if (!teams.length || limit === 0) return;

  for (let round = 0; round < limit; round += 1) {
    for (const franchise of teams) {
      const currentCount = (franchise.retentions || []).length;
      if (currentCount >= limit) continue;
      const constitution = validateRetentionSelection(state, franchise.id, []);
      if (!constitution.ok) continue;

      const owned = new Set();
      for (const team of state.franchises) for (const id of team.squad || []) owned.add(id);
      const overseasCount = (franchise.squad || []).filter((id) => {
        const player = (state.players || []).find((candidate) => candidate.id === id);
        return isOverseas(player);
      }).length;
      const targets = Array.isArray(franchise.targets) ? franchise.targets : [];
      const roleCounts = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
      for (const id of franchise.squad || []) {
        const player = (state.players || []).find((candidate) => candidate.id === id);
        if (player && roleCounts[player.role] !== undefined) roleCounts[player.role] += 1;
      }

      let best = null;
      for (const player of state.players || []) {
        if (player.availability !== 'AVAILABLE' || owned.has(player.id)) continue;
        if (state.format === 'MINI' && !player.retentionCandidate) continue;
        const overseas = isOverseas(player) ? 1 : 0;
        if (overseasCount + overseas > numberOr(state.config?.maxOverseas, 8)) continue;
        const cost = retentionCost(player);
        const remainingSlots = Math.max(0, numberOr(state.config?.minSquad, 18) - currentCount - 1);
        const reserve = state.format === 'MINI' ? 0 : remainingSlots * numberOr(state.config?.minReservePerSlot, 0);
        if (numberOr(franchise.purse, 0) - cost < reserve - 0.000001) continue;

        const roleBonus = targets.includes(player.role) ? 2 : 0;
        const needBonus = Math.max(0, 2 - (roleCounts[player.role] || 0)) * 0.6;
        const valueBonus = (Number(player.rating) || 0) / Math.max(1, cost);
        const strategyBonus = franchise.strategy === 'AGGRESSIVE' ? (Number(player.rating) || 0) >= 85 ? 1 : 0
          : franchise.strategy === 'CONSERVATIVE' ? (Number(player.rating) || 0) >= 90 ? 1.5 : cost <= 2 ? 1 : 0
            : 0;
        const score = (Number(player.rating) || 0) + roleBonus + needBonus + valueBonus + strategyBonus;
        if (!best || score > best.score || (score === best.score && String(player.id).localeCompare(String(best.player.id)) < 0)) {
          best = { player, score, cost };
        }
      }
      if (!best) continue;
      const check = validateRetentionSelection(state, franchise.id, [best.player.id]);
      if (!check.ok) continue;
      applyRetentionSelection(state, franchise.id, [best.player.id]);
    }
  }
}

export default retentionCost;
