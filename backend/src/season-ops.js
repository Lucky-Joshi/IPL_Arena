/**
 * Season operations outside the auction floor: the BCCI player-trading
 * protocol, injury replacements from the Registered Available Player Pool
 * (RAPP), the two-season ban for an uncertified pre-season withdrawal, and
 * anti-tampering enforcement.
 *
 * Trading follows the official four-step protocol:
 *   1. EOI submitted to the BCCI (PROPOSE_TRADE)         -> PENDING_48H
 *   2. Current franchise answers within 48h (RESPOND_TRADE)
 *   3. Negotiation + written player consent (PLAYER_TRADE_CONSENT / AMEND_TRADE)
 *   4. BCCI vetting of salary cap, squad limits and purse -> APPROVED / REJECTED
 *
 * Deal types: ALL_CASH (one-way, exact league fee), PLAYER_SWAP (equal-salary
 * exchange) and CASH_PLUS_PLAYER (a swap whose exact salary difference is
 * settled in cash). Contract fees are never renegotiated; an optional
 * off-purse transfer fee is split 50% BCCI / up to 50% of the remainder to the
 * player / the rest to the selling franchise.
 */

import { isMega, rulesFor } from './rules.js';
import { evaluateEoi, autoConsent } from './trade-ai.js';

const RESPONSE_HOURS = 48;
const CONSENT_HOURS = 72;
const EPSILON = 0.000001;

function fail(error) {
  return { ok: false, error };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
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

/**
 * The authoritative open window, derived from the season phase — never from a
 * caller-supplied value. Trades are only legal outside the live auction floor.
 */
export function activeTradeWindow(state) {
  if (!state) return null;
  if (state.phase === 'SETUP') return isMega(state.season) ? null : 'POST_SEASON';
  if (state.phase === 'COMPLETED' || state.phase === 'FINAL_REVIEW') return 'POST_AUCTION';
  return null;
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

function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

function uniqueIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(String))] : [];
}

function isBanned(state, player) {
  const through = Number(player?.banUntilSeason);
  return Number.isFinite(through) && through >= Number(state.season);
}

/** Eligibility of one player to leave `franchise` in the given window. */
function canTradePlayer(state, franchise, playerId, window) {
  const player = playerOf(state, playerId);
  if (!player) return `Player ${playerId} was not found`;
  if (!(franchise.squad || []).includes(playerId)) return `${player.name} is not in ${franchise.name}'s squad`;
  if (player.availability !== 'SOLD') return `${player.name} is not under an active contract`;
  if (player.consentWithheld) return `${player.name} has withheld written consent`;
  if (isBanned(state, player)) return `${player.name} is serving a BCCI ban and cannot be traded`;
  if (window === 'POST_AUCTION' && player.purchasedInMini === true) {
    return `${player.name} was bought at the mini auction and cannot be traded until they have played a season`;
  }
  return null;
}

/**
 * Classify the deal and compute the exact cash movement. `cashAdjustment` is
 * signed from the proposer's perspective: positive means the proposer pays.
 * Contract fees are fixed, so the cash is always derived, never negotiated.
 */
function computeDeal(state, giveIds, getIds) {
  const valueGiven = roundMoney(giveIds.reduce((sum, id) => sum + salaryOf(state, id), 0));
  const valueGot = roundMoney(getIds.reduce((sum, id) => sum + salaryOf(state, id), 0));
  let type;
  let cashAdjustment;
  if (!giveIds.length && getIds.length) {
    type = 'ALL_CASH';
    cashAdjustment = valueGot; // proposer buys, pays the exact league fee
  } else if (giveIds.length && !getIds.length) {
    type = 'ALL_CASH';
    cashAdjustment = -valueGiven; // proposer sells, the counterparty pays the fee
  } else {
    cashAdjustment = roundMoney(valueGot - valueGiven);
    type = cashAdjustment === 0 ? 'PLAYER_SWAP' : 'CASH_PLUS_PLAYER';
  }
  return { valueGiven, valueGot, type, cashAdjustment };
}

/**
 * Validate the post-trade squads of both franchises simultaneously: size,
 * overseas slots, total salary cap, overseas salary cap (Mini) and purse.
 * Minimum squad is only enforced once the auction is complete.
 */
function validateTradeSquads(state, giveIds, getIds, from, to, cashAdjustment, window) {
  const config = state.config || {};
  const maxSquad = Number(config.maxSquad) || 25;
  const minSquad = Number(config.minSquad) || 18;
  const maxOverseas = Number(config.maxOverseas) || 8;
  const totalCap = Number(config.totalSalaryCap) || 0;
  const overseasCap = Number(config.overseasSalaryCap) || 0;
  const byId = new Map((state.players || []).map((player) => [player.id, player]));

  const fromSquad = new Set(from.squad || []);
  const toSquad = new Set(to.squad || []);
  for (const id of giveIds) { fromSquad.delete(id); toSquad.add(id); }
  for (const id of getIds) { toSquad.delete(id); fromSquad.add(id); }

  const check = (squad, franchise, purseAfter) => {
    const members = [...squad].map((id) => byId.get(id)).filter(Boolean);
    if (members.length > maxSquad) return `${franchise.name} would exceed the ${maxSquad}-player squad limit`;
    // Only a trade that actually shrinks an undersized squad is prohibited.
    // A 1-for-1 swap keeps the count and is allowed to rebuild a short squad.
    const before = (franchise.squad || []).length;
    if (window === 'POST_AUCTION' && members.length < before && members.length < minSquad) {
      return `${franchise.name} would drop below the ${minSquad}-player minimum squad`;
    }
    const overseas = members.filter(isOverseas);
    if (overseas.length > maxOverseas) return `${franchise.name} would exceed the ${maxOverseas}-overseas limit`;
    const salary = members.reduce((sum, p) => sum + (Number(p.salary) || 0), 0);
    if (totalCap > 0 && salary > totalCap + EPSILON) {
      return `${franchise.name} would breach the ₹${totalCap} Cr total salary cap`;
    }
    if (overseasCap > 0) {
      const overseasSalary = overseas.reduce((sum, p) => sum + (Number(p.salary) || 0), 0);
      if (overseasSalary > overseasCap + EPSILON) {
        return `${franchise.name} would breach the ₹${overseasCap} Cr overseas salary cap`;
      }
    }
    if (purseAfter < -EPSILON) return `${franchise.name} cannot fund the cash adjustment from its remaining purse`;
    return null;
  };

  const fromIssue = check(fromSquad, from, roundMoney(Number(from.purse) - cashAdjustment));
  if (fromIssue) return fail(fromIssue);
  const toIssue = check(toSquad, to, roundMoney(Number(to.purse) + cashAdjustment));
  if (toIssue) return fail(toIssue);
  return { ok: true };
}

function pushTimeline(trade, status, note) {
  if (!Array.isArray(trade.timeline)) trade.timeline = [];
  trade.timeline.push({ at: nowIso(), status, note });
}

function movedPlayerIds(trade) {
  return [...(trade.givePlayerIds || []), ...(trade.getPlayerIds || [])];
}

/**
 * Submit an EOI to the BCCI. The counterparty has 48 hours to answer. When the
 * counterparty is an AI franchise the simulator resolves the response with
 * need/budget logic unless `autoRespond:false` keeps it pending.
 */
export function proposeTrade(state, body = {}) {
  const from = franchiseOf(state, body.fromFranchiseId || body.franchiseId);
  const to = franchiseOf(state, body.toFranchiseId);
  if (!from || !to) return fail('Both franchises must be specified');
  if (from.id === to.id) return fail('A franchise cannot trade with itself');

  const window = activeTradeWindow(state);
  if (!window) {
    if (state.phase === 'SETUP' && isMega(state.season)) {
      return fail('No trade is permitted immediately before a Mega Auction — finalize retentions instead');
    }
    return fail('Trades are only allowed in an official BCCI window outside the live auction');
  }

  const giveIds = uniqueIds(body.givePlayerIds);
  const getIds = uniqueIds(body.getPlayerIds);
  if (!giveIds.length && !getIds.length) return fail('At least one player must be included in the trade');
  if (giveIds.some((id) => getIds.includes(id))) return fail('A player cannot appear on both sides of the trade');

  for (const id of giveIds) {
    const issue = canTradePlayer(state, from, id, window);
    if (issue) return fail(issue);
  }
  for (const id of getIds) {
    const issue = canTradePlayer(state, to, id, window);
    if (issue) return fail(issue);
  }

  const deal = computeDeal(state, giveIds, getIds);
  const requiredCash = Math.abs(deal.cashAdjustment);
  if (body.cash !== undefined && body.cash !== null && roundMoney(body.cash) !== requiredCash) {
    return fail(`The cash adjustment is fixed at ₹${requiredCash} Cr by the players' exact league fees — it cannot be renegotiated`);
  }

  const transferFee = roundMoney(body.transferFee || 0);
  if (transferFee < 0) return fail('Transfer fee cannot be negative');
  if (transferFee > 0 && deal.type !== 'ALL_CASH') {
    return fail('An off-purse transfer fee is only permitted on an all-cash deal');
  }
  const playerSharePct = Math.min(50, Math.max(0, Number(body.playerSharePct ?? 0) || 0));

  const capCheck = validateTradeSquads(state, giveIds, getIds, from, to, deal.cashAdjustment, window);
  if (!capCheck.ok) return capCheck;

  const trade = {
    id: `trade_${String((state.trades || []).length + 1).padStart(3, '0')}`,
    type: deal.type,
    fromFranchiseId: from.id,
    toFranchiseId: to.id,
    givePlayerIds: giveIds,
    getPlayerIds: getIds,
    valueGiven: deal.valueGiven,
    valueGot: deal.valueGot,
    cash: requiredCash,
    cashAdjustment: deal.cashAdjustment,
    transferFee: transferFee > 0 ? { total: transferFee, playerSharePct } : null,
    window,
    status: 'PENDING_48H',
    approval: 'EOI_SUBMITTED',
    createdAt: nowIso(),
    respondBy: hoursFromNow(RESPONSE_HOURS),
    consents: {},
    timeline: [],
  };
  pushTimeline(trade, 'PENDING_48H', `EOI submitted to the BCCI by ${from.name}.`);
  if (!Array.isArray(state.trades)) state.trades = [];
  state.trades.push(trade);

  if (body.autoRespond === false || to.id === state.userFranchiseId) {
    return { ok: true, trade, message: `${from.name} filed an EOI for ${getIds.length ? 'the listed player(s)' : 'a sale'} — ${to.name} has 48 hours to respond.` };
  }
  const verdict = evaluateEoi(state, trade, to.id);
  return respondTrade(state, { tradeId: trade.id, accept: verdict.accept, auto: true, reason: verdict.reason });
}

/** Step 2 — the current franchise accepts or rejects within 48 hours. */
export function respondTrade(state, body = {}) {
  const trade = (state.trades || []).find((entry) => entry.id === body.tradeId);
  if (!trade) return fail('Trade not found');
  if (trade.status !== 'PENDING_48H') return fail('That trade has already been resolved');
  const from = franchiseOf(state, trade.fromFranchiseId);
  const to = franchiseOf(state, trade.toFranchiseId);
  if (!from || !to) return fail('Franchise missing from trade');

  if (Date.now() > Date.parse(trade.respondBy)) {
    trade.status = 'EXPIRED';
    trade.approval = 'NOT_APPROVED';
    pushTimeline(trade, 'EXPIRED', 'The 48-hour response window lapsed.');
    return { ok: true, trade, message: `${to.name} did not respond within 48 hours — the EOI has lapsed.` };
  }

  if (body.accept === false) {
    trade.status = 'REJECTED';
    trade.approval = 'NOT_APPROVED';
    trade.rejectionReason = body.reason || `${to.name} declined the approach.`;
    pushTimeline(trade, 'REJECTED', trade.rejectionReason);
    return { ok: true, trade, message: `${to.name} declined the approach within 48 hours.` };
  }

  trade.status = 'AWAITING_CONSENT';
  trade.approval = 'AWAITING_PLAYER_CONSENT';
  trade.consentBy = hoursFromNow(CONSENT_HOURS);
  trade.consents = {};
  for (const id of movedPlayerIds(trade)) trade.consents[id] = 'PENDING';
  pushTimeline(trade, 'AWAITING_CONSENT', `${to.name} accepted the EOI. Terms move to negotiation and written player consent.`);

  autoResolveConsents(state, trade);
  maybeCompleteConsent(state, trade);
  const message = trade.status === 'APPROVED'
    ? `${to.name} accepted and every player consented — the trade is complete.`
    : trade.status === 'VETOED'
      ? `${to.name} accepted, but a player vetoed the move.`
      : `${to.name} accepted the EOI. Awaiting written player consent.`;
  return { ok: true, trade, message };
}

/** Auto-decide consent for players owned by AI franchises. */
function autoResolveConsents(state, trade) {
  for (const playerId of movedPlayerIds(trade)) {
    if (trade.consents[playerId] !== 'PENDING') continue;
    const owner = (trade.givePlayerIds || []).includes(playerId)
      ? franchiseOf(state, trade.fromFranchiseId)
      : franchiseOf(state, trade.toFranchiseId);
    if (!owner || owner.id === state.userFranchiseId) continue; // human decides
    const verdict = autoConsent(state, trade, playerId);
    trade.consents[playerId] = verdict.consent ? 'GRANTED' : 'DENIED';
    pushTimeline(trade, verdict.consent ? 'CONSENT_GRANTED' : 'CONSENT_DENIED', verdict.reason);
  }
}

/** If every consent is in, run BCCI vetting; a single veto voids the trade. */
function maybeCompleteConsent(state, trade) {
  if (trade.status !== 'AWAITING_CONSENT') return;
  const ids = movedPlayerIds(trade);
  if (ids.some((id) => trade.consents[id] === 'DENIED')) {
    const vetoed = ids.find((id) => trade.consents[id] === 'DENIED');
    const player = playerOf(state, vetoed);
    trade.status = 'VETOED';
    trade.approval = 'NOT_APPROVED';
    trade.rejectionReason = `${player?.name || vetoed} exercised their veto — written consent was refused.`;
    pushTimeline(trade, 'VETOED', trade.rejectionReason);
    return;
  }
  if (ids.every((id) => trade.consents[id] === 'GRANTED')) {
    vetAndExecute(state, trade);
  }
}

/** Step 3 — a player grants or withholds written consent. */
export function playerConsent(state, body = {}) {
  const trade = (state.trades || []).find((entry) => entry.id === body.tradeId);
  if (!trade) return fail('Trade not found');
  if (trade.status !== 'AWAITING_CONSENT') return fail('That trade is not awaiting player consent');
  if (trade.consentBy && Date.now() > Date.parse(trade.consentBy)) {
    trade.status = 'EXPIRED';
    trade.approval = 'NOT_APPROVED';
    pushTimeline(trade, 'EXPIRED', 'The consent window lapsed.');
    return { ok: true, trade, message: 'The consent window lapsed before every player signed.' };
  }
  const playerId = String(body.playerId || '');
  if (!Object.hasOwn(trade.consents, playerId)) return fail('That player is not part of this trade');
  if (trade.consents[playerId] !== 'PENDING') return fail('That player has already given their decision');
  const player = playerOf(state, playerId);
  const granted = body.consent !== false;
  trade.consents[playerId] = granted ? 'GRANTED' : 'DENIED';
  pushTimeline(trade, granted ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
    `${player?.name || playerId} ${granted ? 'signed written consent' : 'withheld consent'}.`);
  if (!granted) {
    trade.status = 'VETOED';
    trade.approval = 'NOT_APPROVED';
    trade.rejectionReason = `${player?.name || playerId} exercised their veto — the trade is void.`;
    pushTimeline(trade, 'VETOED', trade.rejectionReason);
    return { ok: true, trade, message: `${player?.name || playerId} vetoed the move — the trade is void.` };
  }
  maybeCompleteConsent(state, trade);
  return { ok: true, trade, message: `${player?.name || playerId} consented to the trade.` };
}

/**
 * Step 3 negotiation — amend the negotiable terms (transfer fee and its split,
 * or the player lists) while consent is pending. Changing players re-opens
 * consent. The exact salary cash is always recomputed, never negotiated.
 */
export function amendTrade(state, body = {}) {
  const trade = (state.trades || []).find((entry) => entry.id === body.tradeId);
  if (!trade) return fail('Trade not found');
  if (trade.status !== 'AWAITING_CONSENT') return fail('Terms can only be negotiated while consent is pending');
  const from = franchiseOf(state, trade.fromFranchiseId);
  const to = franchiseOf(state, trade.toFranchiseId);
  if (!from || !to) return fail('Franchise missing from trade');

  const giveIds = body.givePlayerIds !== undefined ? uniqueIds(body.givePlayerIds) : trade.givePlayerIds;
  const getIds = body.getPlayerIds !== undefined ? uniqueIds(body.getPlayerIds) : trade.getPlayerIds;
  if (!giveIds.length && !getIds.length) return fail('At least one player must be included in the trade');
  if (giveIds.some((id) => getIds.includes(id))) return fail('A player cannot appear on both sides of the trade');
  const window = trade.window;
  for (const id of giveIds) {
    const issue = canTradePlayer(state, from, id, window);
    if (issue) return fail(issue);
  }
  for (const id of getIds) {
    const issue = canTradePlayer(state, to, id, window);
    if (issue) return fail(issue);
  }
  const deal = computeDeal(state, giveIds, getIds);
  const transferFee = roundMoney(body.transferFee ?? trade.transferFee?.total ?? 0);
  if (transferFee < 0) return fail('Transfer fee cannot be negative');
  if (transferFee > 0 && deal.type !== 'ALL_CASH') return fail('An off-purse transfer fee is only permitted on an all-cash deal');
  const playerSharePct = Math.min(50, Math.max(0, Number(body.playerSharePct ?? trade.transferFee?.playerSharePct ?? 0) || 0));
  const capCheck = validateTradeSquads(state, giveIds, getIds, from, to, deal.cashAdjustment, window);
  if (!capCheck.ok) return capCheck;

  const playersChanged = giveIds.join(',') !== trade.givePlayerIds.join(',')
    || getIds.join(',') !== trade.getPlayerIds.join(',');
  trade.givePlayerIds = giveIds;
  trade.getPlayerIds = getIds;
  trade.type = deal.type;
  trade.valueGiven = deal.valueGiven;
  trade.valueGot = deal.valueGot;
  trade.cash = Math.abs(deal.cashAdjustment);
  trade.cashAdjustment = deal.cashAdjustment;
  trade.transferFee = transferFee > 0 ? { total: transferFee, playerSharePct } : null;
  if (playersChanged) {
    trade.consents = {};
    for (const id of movedPlayerIds(trade)) trade.consents[id] = 'PENDING';
    trade.consentBy = hoursFromNow(CONSENT_HOURS);
    autoResolveConsents(state, trade);
  }
  pushTimeline(trade, 'AMENDED', 'Terms renegotiated and re-submitted for consent.');
  maybeCompleteConsent(state, trade);
  return { ok: true, trade, message: 'Terms amended and sent back for written consent.' };
}

/** Step 4 — BCCI vetting, then execution. Runs synchronously once consent is in. */
function vetAndExecute(state, trade) {
  trade.status = 'BCCI_REVIEW';
  trade.approval = 'BCCI_REVIEW';
  pushTimeline(trade, 'BCCI_REVIEW', 'BCCI vetting salary cap, squad limits, overseas slots and anti-tampering.');
  const from = franchiseOf(state, trade.fromFranchiseId);
  const to = franchiseOf(state, trade.toFranchiseId);
  if (!from || !to) {
    trade.status = 'REJECTED';
    trade.approval = 'BCCI_REJECTED';
    trade.rejectionReason = 'Franchise missing from trade';
    return;
  }
  const capCheck = validateTradeSquads(state, trade.givePlayerIds, trade.getPlayerIds, from, to, trade.cashAdjustment, trade.window);
  if (!capCheck.ok) {
    trade.status = 'REJECTED';
    trade.approval = 'BCCI_REJECTED';
    trade.rejectionReason = capCheck.error;
    pushTimeline(trade, 'REJECTED', `BCCI rejected the trade: ${capCheck.error}`);
    return;
  }

  const net = trade.cashAdjustment;
  for (const id of trade.givePlayerIds) movePlayer(state, id, from, to, trade);
  for (const id of trade.getPlayerIds) movePlayer(state, id, to, from, trade);
  from.purse = roundMoney(Number(from.purse) - net);
  to.purse = roundMoney(Number(to.purse) + net);
  from.tradeCashDelta = roundMoney((Number(from.tradeCashDelta) || 0) - net);
  to.tradeCashDelta = roundMoney((Number(to.tradeCashDelta) || 0) + net);

  if (trade.transferFee && trade.transferFee.total > 0) settleTransferFee(state, trade, from, to);

  trade.status = 'APPROVED';
  trade.approval = 'BCCI_APPROVED';
  trade.executedAt = nowIso();
  pushTimeline(trade, 'APPROVED', 'BCCI approved and announced the trade.');
}

/** Off-purse transfer-fee split: 50% BCCI, up to 50% of the rest to the player(s). */
function settleTransferFee(state, trade, from, to) {
  const fee = trade.transferFee;
  const total = roundMoney(fee.total);
  const bcciCut = roundMoney(total * 0.5);
  const remainder = roundMoney(total - bcciCut);
  const playerAmount = roundMoney(remainder * (Number(fee.playerSharePct) || 0) / 100);
  const sellerAmount = roundMoney(remainder - playerAmount);

  // In an all-cash deal the buyer is the side receiving the player(s).
  const buyerIsFrom = (trade.getPlayerIds || []).length > 0;
  const buyer = buyerIsFrom ? from : to;
  const seller = buyerIsFrom ? to : from;
  const movedIds = buyerIsFrom ? trade.getPlayerIds : trade.givePlayerIds;
  const perPlayer = movedIds.length ? roundMoney(playerAmount / movedIds.length) : 0;

  fee.bcciCut = bcciCut;
  fee.playerAmount = playerAmount;
  fee.sellerAmount = sellerAmount;
  fee.payerId = buyer.id;
  fee.sellerId = seller.id;
  fee.players = movedIds.map((id) => ({ playerId: id, amount: perPlayer }));

  state.bcciTradeRevenue = roundMoney((Number(state.bcciTradeRevenue) || 0) + bcciCut);
  seller.transferFeeEarned = roundMoney((Number(seller.transferFeeEarned) || 0) + sellerAmount);
  for (const entry of fee.players) {
    const player = playerOf(state, entry.playerId);
    if (player) player.transferFeeEarned = roundMoney((Number(player.transferFeeEarned) || 0) + entry.amount);
  }
  pushTimeline(trade, 'TRANSFER_FEE',
    `Off-purse transfer fee ₹${total} Cr: BCCI ₹${bcciCut} Cr, player(s) ₹${playerAmount} Cr, ${seller.name} ₹${sellerAmount} Cr.`);
}

/**
 * Move one contracted player, preserving the fixed league fee and contract
 * provenance. Roster metadata (tradedIn/tradedOut) is updated so squads and
 * results reflect the move; auction/retention spend ledgers stay intact and
 * the purse flow is tracked via tradeCashDelta.
 */
function movePlayer(state, playerId, seller, buyer, trade) {
  const player = playerOf(state, playerId);
  if (!player) return;
  const fee = salaryOf(state, playerId);
  seller.squad = (seller.squad || []).filter((id) => id !== playerId);
  if (!buyer.squad.includes(playerId)) buyer.squad.push(playerId);
  player.soldTo = buyer.id;
  player.previousFranchiseId = buyer.id;
  player.traded = true;
  // Overseas salary spend follows the player so later bid validation stays legal.
  if (isOverseas(player)) {
    seller.overseasSalarySpend = roundMoney(Math.max(0, (Number(seller.overseasSalarySpend) || 0) - fee));
    buyer.overseasSalarySpend = roundMoney((Number(buyer.overseasSalarySpend) || 0) + fee);
  }
  if (!Array.isArray(player.tradeHistory)) player.tradeHistory = [];
  player.tradeHistory.push({ tradeId: trade.id, from: seller.id, to: buyer.id, at: nowIso(), fee });

  if (!Array.isArray(buyer.tradedIn)) buyer.tradedIn = [];
  buyer.tradedIn.push({ playerId, fee, tradeId: trade.id });
  if (!Array.isArray(seller.tradedOut)) seller.tradedOut = [];
  seller.tradedOut.push({ playerId, fee, tradeId: trade.id });

  if (!Array.isArray(seller.trades)) seller.trades = [];
  seller.trades.push({ playerId, direction: 'OUT', with: buyer.id, tradeId: trade.id });
  if (!Array.isArray(buyer.trades)) buyer.trades = [];
  buyer.trades.push({ playerId, direction: 'IN', with: seller.id, tradeId: trade.id });
}

/**
 * Lapse any EOI past its 48-hour deadline or consent window past its deadline.
 * Returns the trades that expired so the engine can announce them. Runs on
 * every tick (even outside the live auction) and before each dispatch.
 */
export function expireTrades(state, now = Date.now()) {
  const expired = [];
  for (const trade of state.trades || []) {
    if (trade.status === 'PENDING_48H' && trade.respondBy && now > Date.parse(trade.respondBy)) {
      trade.status = 'EXPIRED';
      trade.approval = 'NOT_APPROVED';
      pushTimeline(trade, 'EXPIRED', 'The 48-hour response window lapsed.');
      expired.push(trade);
    } else if (trade.status === 'AWAITING_CONSENT' && trade.consentBy && now > Date.parse(trade.consentBy)) {
      trade.status = 'EXPIRED';
      trade.approval = 'NOT_APPROVED';
      pushTimeline(trade, 'EXPIRED', 'The consent window lapsed before every player signed.');
      expired.push(trade);
    }
  }
  return expired;
}

// ------------------------------------------------------------- anti-tampering

/** Log an allegation of informal contact outside the official BCCI channel. */
export function reportTampering(state, body = {}) {
  const franchise = franchiseOf(state, body.franchiseId);
  const player = playerOf(state, body.playerId);
  if (!franchise) return fail('The offending franchise must be specified');
  if (!player) return fail('The player involved must be specified');
  if (!Array.isArray(state.tamperingCases)) state.tamperingCases = [];
  const record = {
    id: `tamper_${String(state.tamperingCases.length + 1).padStart(3, '0')}`,
    franchiseId: franchise.id,
    playerId: player.id,
    details: String(body.details || 'Informal contact outside the official EOI channel.').slice(0, 240),
    status: 'REPORTED',
    at: nowIso(),
  };
  state.tamperingCases.push(record);
  return { ok: true, case: record, message: `Tampering allegation logged against ${franchise.name} over ${player.name}.` };
}

/**
 * BCCI ruling on a tampering case: fine/deduct purse from the offending
 * franchise and/or ban the player for up to a year (one season).
 */
export function ruleTampering(state, body = {}) {
  const record = (state.tamperingCases || []).find((entry) => entry.id === body.caseId);
  if (!record) return fail('Tampering case not found');
  if (record.status !== 'REPORTED') return fail('That case has already been ruled on');
  const franchise = franchiseOf(state, record.franchiseId);
  const player = playerOf(state, record.playerId);
  const upheld = body.upheld !== false;
  if (!upheld) {
    record.status = 'DISMISSED';
    record.ruling = { upheld: false, at: nowIso() };
    return { ok: true, case: record, message: 'The BCCI dismissed the tampering allegation.' };
  }
  const fine = roundMoney(Math.max(0, Number(body.fine) || 0));
  const banSeasons = Math.min(1, Math.max(0, Number(body.banSeasons) || 0));
  if (franchise && fine > 0) {
    franchise.purse = roundMoney(Math.max(0, Number(franchise.purse) - fine));
  }
  if (player && banSeasons > 0) {
    player.banUntilSeason = String(Number(state.season) + banSeasons);
    player.tamperingBan = true;
  }
  record.status = 'UPHELD';
  record.ruling = { upheld: true, fine, banSeasons, at: nowIso() };
  const parts = [];
  if (fine > 0) parts.push(`fined ${franchise?.name || record.franchiseId} ₹${fine} Cr`);
  if (banSeasons > 0) parts.push(`banned ${player?.name || record.playerId} through ${player?.banUntilSeason}`);
  return { ok: true, case: record, message: `BCCI upheld the tampering case${parts.length ? ': ' + parts.join(' and ') : ''}.` };
}

// ------------------------------------------------- injuries / RAPP / withdrawal

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
    message: `${player.name} withdrew without a certified injury — banned from T20 Dynasty and its auctions through ${bannedThrough}.`,
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

export default {
  tradeWindows,
  activeTradeWindow,
  proposeTrade,
  respondTrade,
  playerConsent,
  amendTrade,
  expireTrades,
  reportTampering,
  ruleTampering,
  injurePlayer,
  signInjuryReplacement,
  withdrawPlayer,
};
