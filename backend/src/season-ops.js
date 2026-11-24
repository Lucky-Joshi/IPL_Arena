/**
 * Season operations outside the auction floor: injury replacements from the
 * Reserve Player Pool (RPP), the two-season ban for an uncertified pre-season
 * withdrawal, and anti-tampering enforcement.
 */

import { rulesFor } from './rules.js';

function fail(error) {
  return { ok: false, error };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
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

// ------------------------------------------------------------- anti-tampering

/** Log an allegation of informal contact outside the official LCB channel. */
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
    details: String(body.details || 'Informal contact outside the official league channel.').slice(0, 240),
    status: 'REPORTED',
    at: nowIso(),
  };
  state.tamperingCases.push(record);
  return { ok: true, case: record, message: `Tampering allegation logged against ${franchise.name} over ${player.name}.` };
}

/**
 * LCB ruling on a tampering case: fine/deduct purse from the offending
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
    return { ok: true, case: record, message: 'The LCB dismissed the tampering allegation.' };
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
  return { ok: true, case: record, message: `LCB upheld the tampering case${parts.length ? ': ' + parts.join(' and ') : ''}.` };
}

// ------------------------------------------------- injuries / RPP / withdrawal

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
    message: `${player.name} is out with a certified injury. ${owner.name} may sign a RPP replacement up to ${player.injuryReplacementBudget} Cr.`,
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
  if (!injured || !replacement) return fail('Injured player and RPP replacement must exist');
  if (!injured.injured) return fail('The outgoing player has no certified injury');
  const owner = franchiseOf(state, injured.soldTo);
  if (!owner) return fail('Contracted franchise not found');
  if (!['AVAILABLE', 'UNSOLD'].includes(replacement.availability)) return fail('Replacement is not in the RPP');
  const amount = roundMoney(fee ?? salaryOf(state, injuredPlayerId));
  if (amount > Number(injured.injuryReplacementBudget) + 1e-9) {
    return fail(`Replacement fee cannot exceed the injured player's salary of ${injured.injuryReplacementBudget} Cr`);
  }
  replacement.availability = 'SOLD';
  replacement.soldTo = owner.id;
  replacement.soldPrice = 0;
  replacement.salary = amount;
  replacement.soldRound = 'INJURY_REPLACEMENT';
  replacement.isRppReplacement = true;
  if (!owner.squad.includes(replacement.id)) owner.squad.push(replacement.id);
  injured.replacedBy = replacement.id;
  return {
    ok: true,
    message: `${owner.name} signed ${replacement.name} from the RPP for ${amount} Cr — no auction purse debit.`,
  };
}

export default {
  reportTampering,
  ruleTampering,
  injurePlayer,
  signInjuryReplacement,
  withdrawPlayer,
};
