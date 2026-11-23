/**
 * Need- and budget-based trade intelligence for the nine autonomous franchises.
 *
 * The Python AI service only prices live lots, so every off-auction trade
 * decision (responding to an EOI, player consent, and rival-initiated
 * proposals) is resolved here with deterministic, role-gap-aware heuristics.
 * This module never mutates state and never imports season-ops, so the engine
 * can orchestrate proposals without a circular dependency.
 */

import { rulesFor } from './rules.js';

const ROLES = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];
const BENCHMARKS = {
  MEGA: { BATTER: 6, BOWLER: 6, ALLROUNDER: 4, WICKETKEEPER: 2 },
  MINI: { BATTER: 2, BOWLER: 2, ALLROUNDER: 1, WICKETKEEPER: 1 },
};

function playerOf(state, id) {
  return (state.players || []).find((player) => player.id === id) || null;
}

function franchiseOf(state, id) {
  return (state.franchises || []).find((team) => team.id === id) || null;
}

function salaryOf(state, id) {
  const player = playerOf(state, id);
  if (!player) return 0;
  if (Number.isFinite(Number(player.salary)) && Number(player.salary) > 0) return Number(player.salary);
  if (Number(player.soldPrice) > 0) return Number(player.soldPrice);
  return Number(player.contractFee) || 0;
}

function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

function roleCounts(state, franchise) {
  const counts = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
  for (const id of franchise?.squad || []) {
    const player = playerOf(state, id);
    if (player && Object.hasOwn(counts, player.role)) counts[player.role] += 1;
  }
  return counts;
}

function benchmarkFor(state) {
  return BENCHMARKS[rulesFor(state.season, state.format).format] || BENCHMARKS.MEGA;
}

/** Stable per-player jitter in {-1, 0, 1} so consent is varied but repeatable. */
function idJitter(id) {
  let hash = 0;
  const text = String(id);
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 3) - 1;
}

function ownerOf(state, playerId) {
  for (const team of state.franchises || []) {
    if ((team.squad || []).includes(playerId)) return team;
  }
  return null;
}

/**
 * Decide whether the responding franchise (`to`) accepts an EOI. The responder
 * gives up `getPlayerIds` and receives `givePlayerIds` plus the signed cash
 * adjustment. Budget is re-checked even though proposeTrade pre-validates it.
 */
export function evaluateEoi(state, trade, responderId) {
  const responder = franchiseOf(state, responderId);
  if (!responder) return { accept: false, reason: 'Responding franchise not found' };

  const incoming = (trade.givePlayerIds || []).map((id) => playerOf(state, id)).filter(Boolean);
  const outgoing = (trade.getPlayerIds || []).map((id) => playerOf(state, id)).filter(Boolean);
  const cashReceived = Number(trade.cashAdjustment) || 0; // positive = responder is paid
  const cashToPay = Math.max(0, -cashReceived);

  if (cashToPay > Number(responder.purse) + 1e-9) {
    return { accept: false, reason: `${responder.name} cannot fund the salary difference from its remaining purse` };
  }

  const counts = roleCounts(state, responder);
  const benchmark = benchmarkFor(state);
  const targets = responder.targets || [];

  let needScore = 0;
  for (const player of incoming) {
    if (targets.includes(player.role)) needScore += 2;
    if (counts[player.role] < benchmark[player.role]) needScore += 1.5;
  }
  for (const player of outgoing) {
    if (counts[player.role] > benchmark[player.role]) needScore += 1.2; // surplus, willing to move
    if (targets.includes(player.role)) needScore -= 1.5; // reluctant to lose a target role
  }

  const inRating = incoming.reduce((sum, p) => sum + (Number(p.rating) || 0), 0);
  const outRating = outgoing.reduce((sum, p) => sum + (Number(p.rating) || 0), 0);
  const valueScore = inRating - outRating;

  const inSalary = (trade.givePlayerIds || []).reduce((sum, id) => sum + salaryOf(state, id), 0);
  const outSalary = (trade.getPlayerIds || []).reduce((sum, id) => sum + salaryOf(state, id), 0);
  const salaryRelief = outSalary - inSalary; // positive = shed salary

  let strategyBias = 0;
  const strategy = responder.strategy;
  if (strategy === 'AGGRESSIVE') strategyBias = valueScore >= 0 ? 2 : 0.5;
  else if (strategy === 'CONSERVATIVE') strategyBias = cashToPay > 0 ? -2 : 1;
  else if (strategy === 'VALUE') strategyBias = salaryRelief > 0 ? 1.5 : 0;

  const score = needScore * 3 + valueScore * 0.5 + salaryRelief * 0.2 + strategyBias - cashToPay * 0.25;
  const threshold = incoming.length || outgoing.length ? 2 : 0;
  const accept = score >= threshold;
  const reason = accept
    ? `${responder.name} sees a ${needScore >= 3 ? 'clear role-gap fit' : 'fair value return'} and accepts the terms.`
    : `${responder.name} does not see enough need or value to part with ${outgoing.map((p) => p.name).join(', ') || 'the player'}.`;
  return { accept, reason };
}

/**
 * Deterministic player-consent decision. A player weighs whether the move
 * fills a need at the destination, upgrades their role, and pays them a
 * transfer-fee share. Surplus players at the destination may veto.
 */
export function autoConsent(state, trade, playerId) {
  const player = playerOf(state, playerId);
  if (!player) return { consent: false, reason: 'Player not found' };
  const owner = ownerOf(state, playerId);
  const destinationId = (trade.givePlayerIds || []).includes(playerId)
    ? trade.toFranchiseId
    : trade.fromFranchiseId;
  const destination = franchiseOf(state, destinationId);
  if (!destination) return { consent: false, reason: 'Destination franchise not found' };

  const counts = roleCounts(state, destination);
  const benchmark = benchmarkFor(state);
  const fitsTarget = (destination.targets || []).includes(player.role);
  const thinAtRole = counts[player.role] < benchmark[player.role];

  const rolePeers = (destination.squad || [])
    .map((id) => playerOf(state, id))
    .filter((p) => p && p.role === player.role && p.id !== playerId);
  const peerAvg = rolePeers.length
    ? rolePeers.reduce((sum, p) => sum + (Number(p.rating) || 0), 0) / rolePeers.length
    : 0;
  const upgrade = (Number(player.rating) || 0) >= peerAvg;

  let score = (fitsTarget ? 2 : 0) + (thinAtRole ? 1.5 : 0) + (upgrade ? 1 : 0);
  const feeShare = (trade.transferFee?.players || []).find((entry) => entry.playerId === playerId);
  if (feeShare && Number(feeShare.amount) > 0) score += 1;
  if (isOverseas(player) && counts[player.role] >= benchmark[player.role]) score -= 0.5;

  const consent = score + idJitter(playerId) >= 2;
  const reason = consent
    ? `${player.name} consents — ${destination.name} offers a ${thinAtRole ? 'clear starting role' : 'fresh challenge'}.`
    : `${player.name} is not convinced the move improves their role and withholds consent.`;
  void owner;
  return { consent, reason };
}

/**
 * Build up to `limit` need-based trade descriptors that AI franchises may
 * propose. The engine feeds each through proposeTrade, which enforces every
 * window, eligibility, purse and cap rule — invalid candidates are dropped.
 */
export function suggestAiTrades(state, limit = 2) {
  const deals = [];
  const user = state.userFranchiseId;
  const teams = (state.franchises || []).filter((team) => team.id !== user);
  const benchmark = benchmarkFor(state);
  const window = state.phase === 'SETUP' ? 'POST_SEASON' : 'POST_AUCTION';

  const tradeable = (player, owner) => {
    if (!player || player.availability !== 'SOLD') return false;
    if (player.consentWithheld) return false;
    if (window === 'POST_AUCTION' && player.purchasedInMini === true) return false;
    if (!(owner.squad || []).includes(player.id)) return false;
    return true;
  };

  for (const franchise of teams) {
    if (deals.length >= limit) break;
    const counts = roleCounts(state, franchise);
    const gapRole = ROLES.find((role) => counts[role] < benchmark[role])
      || (franchise.targets || [])[0];
    if (!gapRole) continue;

    // Find the best available target at another franchise that fills the gap.
    let best = null;
    let bestOwner = null;
    for (const other of state.franchises || []) {
      if (other.id === franchise.id) continue;
      for (const id of other.squad || []) {
        const player = playerOf(state, id);
        if (!player || player.role !== gapRole || !tradeable(player, other)) continue;
        const score = (Number(player.rating) || 0) + ((franchise.targets || []).includes(player.role) ? 3 : 0);
        if (!best || score > best.score) {
          best = { player, score };
          bestOwner = other;
        }
      }
    }
    if (!best || !bestOwner) continue;
    const target = best.player;

    // Prefer a player-for-player swap if we hold a surplus the owner wants.
    const ownerCounts = roleCounts(state, bestOwner);
    const surplus = (franchise.squad || [])
      .map((id) => playerOf(state, id))
      .filter((p) => p && tradeable(p, franchise) && p.id !== target.id)
      .filter((p) => counts[p.role] > benchmark[p.role] || (bestOwner.targets || []).includes(p.role))
      .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))[0];

    const ownerWantsSurplus = surplus
      && ((bestOwner.targets || []).includes(surplus.role) || ownerCounts[surplus.role] < benchmark[surplus.role]);

    if (surplus && ownerWantsSurplus) {
      deals.push({
        fromFranchiseId: franchise.id,
        toFranchiseId: bestOwner.id,
        givePlayerIds: [surplus.id],
        getPlayerIds: [target.id],
      });
    } else {
      const fee = salaryOf(state, target.id);
      if (Number(franchise.purse) + 1e-9 < fee) continue; // budget gate
      deals.push({
        fromFranchiseId: franchise.id,
        toFranchiseId: bestOwner.id,
        givePlayerIds: [],
        getPlayerIds: [target.id],
        transferFee: Number(franchise.purse) > fee * 2 ? Math.round(fee * 0.1 * 100) / 100 : 0,
        playerSharePct: 25,
      });
    }
  }
  return deals.slice(0, limit);
}

export default { evaluateEoi, autoConsent, suggestAiTrades };
