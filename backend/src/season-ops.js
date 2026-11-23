/**
 * Season operations outside the auction floor: BCCI trade windows, injury
 * replacements from the Registered Available Player Pool (RAPP), and the
 * two-season ban for an uncertified pre-season withdrawal.
 */

import { isMega, rulesFor } from './rules.js';

function fail(error) {
  return { ok: false, error };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function tradeWindows() {
  return [
    {
      id: 'POST_SEASON',
      label: 'Post-season window',
      detail: 'Opens after the season, closes one week before the auction. No trades immediately before a Mega Auction.',
    },
    {
      id: 'POST_AUCTION',
      label: 'Post-auction window',
      detail: 'Opens the day after the auction, closes 30 days before the tournament. Mini-auction signings cannot be traded.',
    },
  ];
}

export function salaryOf(state, playerId) {
  const player = (state.players || []).find((candidate) => candidate.id === playerId);
  if (!player) return 0;
  if (Number.isFinite(Number(player.salary)) && Number(player.salary) > 0) return Number(player.salary);
  if (Number(player.soldPrice) > 0) return Number(player.soldPrice);
  return Number(player.contractFee) || 0;
}

function franchiseOf(state, id) {
  return (state.franchises || []).find((team) => team.id === id) || null;
}

function playerOf(state, id) {
  return (state.players || []).find((player) => player.id === id) || null;
}

function canTrade(state, franchise, playerId, trade) {
  const player = playerOf(state, playerId);
  if (!player) return `Player ${playerId} was not found`;
  if (!(franchise.squad || []).includes(playerId)) return `${player.name} is not in ${franchise.name}'s squad`;
  if (player.consentWithheld) return `${player.name} has withheld written consent`;
  if (trade.window === 'POST_AUCTION' && player.purchasedInMini === true) {
    return `${player.name} was bought at the mini auction and cannot be traded yet`;
  }
  return null;
}

/**
 * Submit an EOI to the BCCI. The current franchise has 48 hours to answer; the
 * simulator resolves that decision with `respondTrade`.
 */
export function proposeTrade(state, body = {}) {
  const from = franchiseOf(state, body.fromFranchiseId || body.franchiseId);
  const to = franchiseOf(state, body.toFranchiseId);
  if (!from || !to) return fail('Both franchises must be specified');
  if (from.id === to.id) return fail('A franchise cannot trade with itself');
  const rules = rulesFor(state.season, state.format);
  const window = body.window || (state.phase === 'SETUP'
    ? (isMega(state.season) ? null : 'POST_SEASON')
    : 'POST_AUCTION');
  if (!window) return fail('No trade is permitted immediately before a Mega Auction');
  if (!['POST_SEASON', 'POST_AUCTION'].includes(window)) return fail('Unknown trading window');

  const giveIds = Array.isArray(body.givePlayerIds) ? [...new Set(body.givePlayerIds.map(String))] : [];
  const getIds = Array.isArray(body.getPlayerIds) ? [...new Set(body.getPlayerIds.map(String))] : [];
  if (!giveIds.length && !getIds.length) return fail('At least one player must be included in the trade');
  for (const id of giveIds) {
    const issue = canTrade(state, from, id, { window });
    if (issue) return fail(issue);
  }
  for (const id of getIds) {
    const issue = canTrade(state, to, id, { window });
    if (issue) return fail(issue);
  }
  const cash = roundMoney(body.cash || 0);
  if (cash < 0) return fail('Cash Adjustment cannot be negative');
  if (cash > 0 && Number(from.purse) + 1e-9 < cash) return fail(`${from.name} cannot fund the cash adjustment`);

  const valueGiven = giveIds.reduce((sum, id) => sum + salaryOf(state, id), 0);
  const valueGot = getIds.reduce((sum, id) => sum + salaryOf(state, id), 0);
  const trade = {
    id: `trade_${String((state.trades || []).length + 1).padStart(3, '0')}`,
    fromFranchiseId: from.id,
    toFranchiseId: to.id,
    givePlayerIds: giveIds,
    getPlayerIds: getIds,
    cash,
    valueGiven: roundMoney(valueGiven),
    valueGot: roundMoney(valueGot),
    window,
    status: 'PENDING_48H',
    approval: 'AWAITING_PLAYER_CONSENT',
    createdAt: new Date().toISOString(),
  };
  if (!Array.isArray(state.trades)) state.trades = [];
  state.trades.push(trade);
  // The EOI sits in PENDING_48H until the other franchise answers. Callers may
  // let the simulator resolve it immediately, or answer with RESPOND_TRADE to
  // model the full 48-hour response window.
  if (body.autoRespond === false) {
    return { ok: true, trade, message: `${to.name} has 48 hours to respond to the EOI.` };
  }
  const accepts = valueGot + cash >= valueGiven * 0.9 && getIds.every((id) => !playerOf(state, id)?.consentWithheld);
  return respondTrade(state, { tradeId: trade.id, accept: accepts, auto: true });
}

export function respondTrade(state, body = {}) {
  const trade = (state.trades || []).find((entry) => entry.id === body.tradeId);
  if (!trade) return fail('Trade not found');
  if (trade.status !== 'PENDING_48H') return fail('That trade has already been resolved');
  const from = franchiseOf(state, trade.fromFranchiseId);
  const to = franchiseOf(state, trade.toFranchiseId);
  if (!from || !to) return fail('Franchise missing from trade');

  if (body.accept === false) {
    trade.status = 'REJECTED';
    trade.approval = 'NOT_APPROVED';
    return { ok: true, trade, message: `${to.name} declined the approach within 48 hours.` };
  }
  const net = roundMoney(trade.valueGot + trade.cash - trade.valueGiven);
  if (net > 0 && Number(from.purse) + 1e-9 < net) return fail(`${from.name} cannot fund the cash adjustment`);
  if (net < 0 && Number(to.purse) + 1e-9 < -net) return fail(`${to.name} cannot fund the cash adjustment`);

  for (const id of trade.givePlayerIds) movePlayer(state, id, from, to);
  for (const id of trade.getPlayerIds) movePlayer(state, id, to, from);
  from.purse = roundMoney(Number(from.purse) - net);
  to.purse = roundMoney(Number(to.purse) + net);
  trade.status = 'APPROVED';
  trade.approval = 'BCCI_APPROVED';
  trade.cashAdjustment = net;
  return {
    ok: true,
    trade,
    message: `BCCI approved the trade: ${trade.givePlayerIds.length + trade.getPlayerIds.length} player(s), net cash ${net >= 0 ? 'paid by ' + from.name : 'paid by ' + to.name}.`,
  };
}

function movePlayer(state, playerId, seller, buyer) {
  const player = playerOf(state, playerId);
  if (!player) return;
  seller.squad = (seller.squad || []).filter((id) => id !== playerId);
  if (!buyer.squad.includes(playerId)) buyer.squad.push(playerId);
  player.previousFranchiseId = buyer.id;
  player.soldTo = buyer.id;
  player.traded = true;
  (seller.trades || []).push({ playerId, direction: 'OUT', with: buyer.id });
  (buyer.trades || []).push({ playerId, direction: 'IN', with: seller.id });
}

export function injurePlayer(state, { playerId, certifiedInjury = true } = {}) {
  const player = playerOf(state, playerId);
  if (!player) return fail('Player not found');
  const owner = franchiseOf(state, player.soldTo);
  if (!owner) return fail('Contracted franchise not found');
  if (!certifiedInjury) return withdrawPlayer(state, { playerId, certifiedInjury: false });
  player.availability = 'INJURED';
  player.injured = true;
  player.injuryReplacementBudget = salaryOf(state, playerId);
  return {
    ok: true,
    message: `${player.name} is out with a certified injury. ${owner.name} may sign a RAPP replacement up to ${player.injuryReplacementBudget} Cr.`,
  };
}

export function withdrawPlayer(state, { playerId, certifiedInjury = false } = {}) {
  const player = playerOf(state, playerId);
  if (!player) return fail('Player not found');
  const owner = franchiseOf(state, player.soldTo);
  if (!owner) return fail('Contracted franchise not found');
  if (certifiedInjury) return injurePlayer(state, { playerId, certifiedInjury: true });
  const rules = rulesFor(state.season, state.format);
  const bannedThrough = `${Number(String(rules.key)) + 2}`;
  player.withdrawn = true;
  player.banUntilSeason = bannedThrough;
  player.availability = 'WITHDRAWN';
  owner.squad = (owner.squad || []).filter((id) => id !== playerId);
  return {
    ok: true,
    message: `${player.name} withdrew without a certified injury — banned from the IPL and its auctions through ${bannedThrough}.`,
  };
}

export function signInjuryReplacement(state, { injuredPlayerId, replacementPlayerId, fee } = {}) {
  const injured = playerOf(state, injuredPlayerId);
  const replacement = playerOf(state, replacementPlayerId);
  if (!injured || !replacement) return fail('Injured player and RAPP replacement must exist');
  if (!injured.injured) return fail('The outgoing player has no certified injury');
  const owner = franchiseOf(state, injured.soldTo);
  if (!owner) return fail('Contracted franchise not found');
  if (!['AVAILABLE', 'UNSOLD'].includes(replacement.availability)) return fail('Replacement is not in the RAPP');
  const amount = roundMoney(fee ?? salaryOf(state, injuredPlayerId));
  if (amount > Number(injured.injuryReplacementBudget) + 1e-9) {
    return fail(`Replacement fee cannot exceed the injured player's salary of ${injured.injuryReplacementBudget} Cr`);
  }
  replacement.availability = 'SOLD';
  replacement.soldTo = owner.id;
  replacement.soldPrice = 0;
  replacement.salary = amount;
  replacement.soldRound = 'INJURY_REPLACEMENT';
  replacement.isRappReplacement = true;
  if (!owner.squad.includes(replacement.id)) owner.squad.push(replacement.id);
  injured.replacedBy = replacement.id;
  return {
    ok: true,
    message: `${owner.name} signed ${replacement.name} from the RAPP for ${amount} Cr — no auction purse debit.`,
  };
}

export default { tradeWindows, proposeTrade, respondTrade, injurePlayer, signInjuryReplacement, withdrawPlayer };
