/**
 * Single source of truth for bid legality. The engine and AI both use these
 * helpers so a human bid and an AI bid are validated identically.
 */

const EPSILON = 0.000001;
const OPEN_PHASES = new Set(['BIDDING', 'GOING_ONCE', 'GOING_TWICE']);

export const BID_INCREMENTS = Object.freeze([
  { upTo: 2, increment: 0.25 },
  { upTo: 10, increment: 0.5 },
  { upTo: Infinity, increment: 1 },
]);

/** <2 -> 0.25, 2..10 -> 0.5, >10 -> 1. */
export function getNextBid(currentBid) {
  const value = Number(currentBid);
  if (!Number.isFinite(value) || value < 0) return 0.25;
  const increment = value < 2 ? 0.25 : value <= 10 ? 0.5 : 1;
  return Math.round((value + increment) * 100) / 100;
}

function fail(error) {
  return { ok: false, error };
}

function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

function findFranchise(state, franchiseId) {
  return (state.franchises || []).find((franchise) => franchise.id === franchiseId) || null;
}

function squadPlayers(state, franchise) {
  const byId = new Map((state.players || []).map((player) => [player.id, player]));
  return (franchise.squad || []).map((id) => byId.get(id)).filter(Boolean);
}

function overseasCount(state, franchise) {
  return squadPlayers(state, franchise).filter(isOverseas).length;
}

/**
 * Capacity, overseas-slot and financial-reserve checks for adding `player`.
 * The prospective price is the next bid (or base price on the first bid).
 */
export function canFranchiseHoldPlayer(state, franchiseId, player, amountOverride) {
  if (!state || typeof state !== 'object') return fail('Auction state is unavailable');
  const franchise = findFranchise(state, franchiseId);
  if (!franchise) return fail(`Franchise ${franchiseId} was not found`);
  if (!player || !player.id) return fail('Player was not found');

  const config = state.config || {};
  const isMini = state.format === 'MINI';
  const maxSquad = Number.isFinite(Number(config.maxSquad)) ? Number(config.maxSquad) : 25;
  const maxOverseas = Number.isFinite(Number(config.maxOverseas)) ? Number(config.maxOverseas) : 8;
  const minSquad = Number.isFinite(Number(config.minSquad)) ? Number(config.minSquad) : 18;
  const reservePerSlot = Number.isFinite(Number(config.minReservePerSlot)) ? Number(config.minReservePerSlot) : 0;
  const squad = Array.isArray(franchise.squad) ? franchise.squad : [];

  if (squad.length >= maxSquad) return fail(`${franchise.name || franchiseId} already has a full squad`);
  if (isMini) {
    const maxAdditions = Number.isFinite(Number(franchise.additionsLimit))
      ? Number(franchise.additionsLimit)
      : Number.isFinite(Number(config.maxAdditions)) ? Number(config.maxAdditions) : 6;
    const additionsUsed = Array.isArray(franchise.purchases) ? franchise.purchases.length : 0;
    if (additionsUsed >= maxAdditions) return fail(`${franchise.name || franchiseId} has used all ${maxAdditions} additions`);
  }

  if (isOverseas(player) && overseasCount(state, franchise) >= maxOverseas) {
    return fail(`${franchise.name || franchiseId} has no overseas slot left`);
  }

  const amount = Number.isFinite(Number(amountOverride))
    ? Number(amountOverride)
    : Number(state.currentBid) > 0
      ? getNextBid(state.currentBid)
      : Number(player.basePrice) || 0;
  const remainingMinSlots = isMini ? 0 : Math.max(0, minSquad - squad.length);
  const requiredReserve = remainingMinSlots * reservePerSlot;
  if (Number(franchise.purse) - amount < requiredReserve - EPSILON) {
    return fail(`${franchise.name || franchiseId} must keep ₹${requiredReserve.toFixed(2)} Cr for remaining squad slots`);
  }
  return { ok: true };
}

/**
 * Validate an exact bid amount against the authoritative state.
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function validateBid(state, franchiseId, amount) {
  if (!state || typeof state !== 'object') return fail('Auction state is unavailable');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    return fail('Bid amount must be a finite positive number');
  }
  if (!OPEN_PHASES.has(state.phase)) return fail('Bidding is not open at the moment');

  const player = (state.players || []).find((candidate) => candidate.id === state.currentPlayerId);
  if (!player) return fail('There is no player on the block');
  if (player.availability !== 'AVAILABLE') return fail('This player is no longer available');

  const franchise = findFranchise(state, franchiseId);
  if (!franchise) return fail(`Franchise ${franchiseId} was not found`);
  if ((state.withdrawnIds || []).includes(franchiseId)) {
    return fail(`${franchise.name || franchiseId} has withdrawn from this player`);
  }
  if (state.leaderId === franchiseId) return fail(`${franchise.name || franchiseId} is already the highest bidder`);

  const expected = Number(state.currentBid) > 0 && Number(state.bidsThisLot) > 0
    ? getNextBid(state.currentBid)
    : Number(player.basePrice);
  if (Math.abs(amount - expected) > EPSILON) {
    return fail(`Bid must be exactly ₹${expected.toFixed(2)} Cr`);
  }
  if (Number(franchise.purse) + EPSILON < amount) {
    return fail(`${franchise.name || franchiseId} does not have enough purse`);
  }

  return canFranchiseHoldPlayer(state, franchiseId, player);
}

export default validateBid;
