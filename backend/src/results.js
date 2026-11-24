/**
 * Deterministic post-auction analytics. Pure function: never mutates state.
 */

import { rulesFor } from './rules.js';

const ROLES = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];
const IDEAL_SHARE = { BATTER: 0.36, BOWLER: 0.34, ALLROUNDER: 0.2, WICKETKEEPER: 0.1 };

function round1(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}

/** Bid increments are in paise, so money needs two decimals to stay additive. */
function money(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function purchaseRows(state) {
  const playerById = new Map((state.players || []).map((player) => [player.id, player]));
  const rows = [];
  for (const franchise of state.franchises || []) {
    for (const purchase of franchise.purchases || []) {
      const player = playerById.get(purchase.playerId);
      if (!player) continue;
      rows.push({
        playerId: player.id,
        name: player.name,
        rating: player.rating,
        price: Number(purchase.price) || 0,
        franchiseId: franchise.id,
        franchiseName: franchise.name,
      });
    }
  }
  return rows;
}

function enrichedSquad(state, franchise) {
  const playerById = new Map((state.players || []).map((player) => [player.id, player]));
  const existing = new Set(franchise.existing || []);
  const prices = new Map((franchise.purchases || []).map((purchase) => [purchase.playerId, Number(purchase.price) || 0]));
  const retentionByPlayer = new Map((franchise.retentions || []).map((entry) => [entry.playerId, Number(entry.cost) || 0]));
  return (franchise.squad || [])
    .map((id) => {
      const player = playerById.get(id);
      if (!player) return null;
      const source = existing.has(id) ? 'EXISTING' : 'PURCHASED';
      const price = source === 'EXISTING'
        ? (retentionByPlayer.get(id) ?? (Number(player.retentionCost) || 0))
        : (prices.get(id) || 0);
      return { ...player, stats: { ...player.stats }, source, price };
    })
    .filter(Boolean);
}

/**
 * Compute the `/api/results` payload from an authoritative state.
 * @returns {Object} results object described in ARCHITECTURE.md section 4
 */
export function computeResults(state) {
  const config = state?.config || {};
  const minSquad = Number.isFinite(Number(config.minSquad)) ? Number(config.minSquad) : 18;
  const maxOverseas = Number.isFinite(Number(config.maxOverseas)) ? Number(config.maxOverseas) : 8;
  const franchises = state?.franchises || [];
  const players = state?.players || [];
  const purchases = purchaseRows(state);

  // Retained players are resolved at a retention cost rather than an auction
  // price; they still count as sold for the called-lot totals.
  const sold = players.filter((player) => player.availability === 'SOLD'
    && (Number(player.soldPrice) > 0 || player.retained === true));
  const unsold = players.filter((player) => player.availability === 'UNSOLD');
  const rows = franchises.map((franchise) => {
    const squad = enrichedSquad(state, franchise);
    const roleCounts = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
    for (const player of squad) {
      if (Object.hasOwn(roleCounts, player.role)) roleCounts[player.role] += 1;
    }
    const overseasCount = squad.filter((player) => player.nationality && player.nationality !== 'India').length;
    const purchased = franchise.purchases || [];
    const retentionSpent = Number(franchise.retentionSpent) || 0;
    const auctionSpent = purchased.reduce((total, purchase) => total + (Number(purchase.price) || 0), 0);
    const purseSpent = money(retentionSpent + auctionSpent);
    const purchasedCount = squad.filter((player) => player.source === 'PURCHASED').length;
    const existingCount = squad.filter((player) => player.source === 'EXISTING').length;
    const salaryCap = Number(config.totalSalaryCap) || 0;
    const overseasSalaryCap = Number(config.overseasSalaryCap) || 0;
    const overseasSalarySpend = money(franchise.overseasSalarySpend || 0);
    const salaryHeadroom = money(Math.max(0, salaryCap - purseSpent));
    const retentionCappedCount = (franchise.retentions || []).filter((entry) => entry.capped !== false).length;
    const retentionUncappedCount = (franchise.retentions || []).length - retentionCappedCount;
    const avgRating = squad.length
      ? squad.reduce((total, player) => total + (Number(player.rating) || 0), 0) / squad.length
      : 0;

    const denominator = Math.max(1, squad.length);
    let deviation = 0;
    for (const role of ROLES) deviation += Math.abs(roleCounts[role] / denominator - IDEAL_SHARE[role]);
    const roleScore = Math.max(0, 100 - deviation * 110);
    const qualityScore = Math.min(25, avgRating * 0.28);
    const overseasPenalty = Math.max(0, overseasCount - maxOverseas) * 12;
    const shortSquadPenalty = Math.max(0, minSquad - squad.length) * 2;
    const balanceScore = round1(clamp(roleScore * 0.72 + qualityScore * 0.28 - overseasPenalty - shortSquadPenalty, 0, 100));

    const teamScore = balanceScore * 0.55 + avgRating * 0.35 + Math.min(8, purchasedCount * 0.8) + (squad.length >= minSquad ? 4 : 0);
    const strongestRole = ROLES.slice().sort((a, b) => roleCounts[b] - roleCounts[a] || ROLES.indexOf(a) - ROLES.indexOf(b))[0];
    const thinnestRole = ROLES.slice().sort((a, b) => roleCounts[a] - roleCounts[b] || ROLES.indexOf(a) - ROLES.indexOf(b))[0];
    let rankReason = `Balance ${balanceScore}, average rating ${round1(avgRating)}; strongest at ${strongestRole.toLowerCase()}, thinnest at ${thinnestRole.toLowerCase()}.`;
    rankReason += purchasedCount
      ? ` ${purchasedCount} addition(s) for ₹${money(auctionSpent)} Cr.`
      : ' No auction purchases.';
    if (retentionSpent > 0) rankReason += ` ₹${money(retentionSpent)} Cr committed to retentions.`;

    return {
      id: franchise.id,
      name: franchise.name,
      short: franchise.short,
      primary: franchise.primary,
      owner: franchise.owner,
      purseSpent,
      purseRemaining: money(franchise.purse),
      playerCount: squad.length,
      existingCount,
      purchasedCount,
      retentionCount: (franchise.retentions || []).length,
      retentionSpent: money(retentionSpent),
      retentionCappedCount,
      retentionUncappedCount,
      overseasCount,
      salaryCap,
      salaryHeadroom,
      overseasSalaryCap,
      overseasSalarySpend,
      overseasSalaryHeadroom: money(Math.max(0, overseasSalaryCap - overseasSalarySpend)),
      welfareContribution: money(franchise.welfareContribution || 0),
      clawCards: Number(franchise.clawCards) || 0,
      clawUsed: Number(franchise.clawUsed) || 0,
      roleCounts,
      squad,
      balanceScore,
      rankReason,
      _teamScore: Math.round(teamScore * 1000) / 1000,
    };
  });

  rows.sort((a, b) => b._teamScore - a._teamScore || b.balanceScore - a.balanceScore || a.id.localeCompare(b.id));
  rows.forEach((row, index) => {
    row.rank = index + 1;
    delete row._teamScore;
  });

  const biggestPurchases = purchases.slice().sort((a, b) => b.price - a.price || a.playerId.localeCompare(b.playerId))
    .slice(0, 5)
    .map(({ playerId, name, price, franchiseId, franchiseName }) => ({ playerId, name, price: money(price), franchiseId, franchiseName }));

  const bestValue = purchases.slice()
    .map((row) => ({ ...row, valueScore: round1(row.rating / Math.max(0.2, row.price)) }))
    .sort((a, b) => b.valueScore - a.valueScore || b.rating - a.rating || a.playerId.localeCompare(b.playerId))
    .slice(0, 5)
    .map(({ playerId, name, price, rating, franchiseId, valueScore }) => ({ playerId, name, price: money(price), rating, franchiseId, valueScore }));

  const retentionSpending = (state?.franchises || [])
    .reduce((total, franchise) => total + (Number(franchise.retentionSpent) || 0), 0);
  const seasonKey = state?.season || '2025';
  const rules = rulesFor(seasonKey, state?.format);
  const cappedRetentions = rows.reduce((total, row) => total + row.retentionCappedCount, 0);
  const uncappedRetentions = rows.reduce((total, row) => total + row.retentionUncappedCount, 0);
  const clawUsed = rows.reduce((total, row) => total + row.clawUsed, 0);
  const injuries = players.filter((player) => player.injured || player.withdrawn)
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      status: player.injured ? 'INJURED' : 'WITHDRAWN',
      banUntilSeason: player.banUntilSeason || null,
      replacedBy: player.replacedBy || null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    season: seasonKey,
    seasonLabel: rules.label,
    format: rules.format,
    rules: { ...rules },
    matchFeeProjection: Number(state?.matchFeeProjection) || 0,
    welfareFund: money(state?.welfareFund || 0),
    totalAuctionSpending: money(purchases.reduce((total, row) => total + row.price, 0) + retentionSpending),
    totalRetentionSpending: money(retentionSpending),
    cappedRetentions,
    uncappedRetentions,
    clawUsed,
    tamperingCases: Array.isArray(state?.tamperingCases) ? state.tamperingCases : [],
    injuries,
    soldCount: sold.length,
    unsoldCount: unsold.length,
    biggestPurchases,
    bestValue,
    unsold: unsold.map((player) => ({ ...player, stats: { ...player.stats } })),
    franchises: rows,
  };
}

export default computeResults;
