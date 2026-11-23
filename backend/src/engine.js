/**
 * Authoritative auction engine.
 *
 * Every mutation flows through dispatch() or tick(); both commit a cloned
 * state to persist(). No caller ever receives a reference to internal state.
 */

import { randomUUID } from 'node:crypto';

import { generatePlayers } from './players.js';
import { createFranchises, FRANCHISE_CONFIG_DEFAULTS, configForSeason } from './franchises.js';
import { createProceedings } from './proceedings.js';
import { getNextBid, validateBid, canFranchiseHoldPlayer as validateHold } from './validation.js';
import { computeResults } from './results.js';
import {
  RETENTION_LIMITS,
  retentionCost,
  validateRetentionSelection,
  applyRetentionSelection,
  resetRetentions,
  autoRetainAi,
} from './retention.js';
import {
  SEASONS,
  rulesFor,
  resolveSeason,
  isMega,
  salarySplit,
  matchFeeProjection,
} from './rules.js';
import {
  proposeTrade,
  respondTrade,
  injurePlayer,
  signInjuryReplacement,
  withdrawPlayer,
} from './season-ops.js';

export { getNextBid, validateBid, computeResults };
export { canFranchiseHoldPlayer } from './validation.js';
export { retentionCost, RETENTION_LIMITS };
export { SEASONS, rulesFor, salarySplit, matchFeeProjection };

// discussion.js is written by a separate agent. A missing hook must never
// take the auction down, so the import is optional at module load time.
let discussionModule = null;
try {
  discussionModule = await import('./discussion.js');
} catch {
  discussionModule = null;
}

const OPEN_PHASES = new Set(['BIDDING', 'GOING_ONCE', 'GOING_TWICE']);
const RTM_PHASES = new Set(['RTM_OFFER', 'RTM_COUNTER', 'RTM_MATCH']);
const TERMINAL_PHASES = new Set(['SETUP', 'COMPLETED', 'FINAL_REVIEW', 'STRATEGY_BREAK', 'SET_BREAK']);
const ROLES = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];
const EVENT_LIMIT = 1000;

/**
 * Auction pace is expressed in engine ticks. The server calls tick() every
 * config.tickMs, so BROADCAST at 1000ms gives the human roughly 5s to react to
 * an introduction, 5s per bidding call and 4-5s at each "going" call.
 * FAST keeps the original one-action-per-tick behaviour for automated tests.
 */
const PACE_TICKS = Object.freeze({
  FAST: { intro: 1, bid: 1, goingOnce: 1, goingTwice: 1, result: 1, announcement: 2, aiReaction: 0 },
  BROADCAST: { intro: 5, bid: 5, goingOnce: 5, goingTwice: 4, result: 3, announcement: 5, aiReaction: 2 },
  CINEMATIC: { intro: 8, bid: 7, goingOnce: 7, goingTwice: 6, result: 4, announcement: 7, aiReaction: 3 },
});
const PACE_NAMES = Object.keys(PACE_TICKS);

function paceOf(state) {
  const name = String(state?.config?.pace || 'BROADCAST').toUpperCase();
  return PACE_TICKS[name] || PACE_TICKS.BROADCAST;
}

export { PACE_TICKS, PACE_NAMES };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

function normaliseConfig(format, overrides = {}, seasonKey) {
  const season = resolveSeason(seasonKey, format);
  const rules = SEASONS[season];
  const base = { ...configForSeason(season), ...FRANCHISE_CONFIG_DEFAULTS[format] };
  // Season financial rules are authoritative; user overrides can only tune
  // the pacing and reserve behaviour, never the BCCI purse or salary cap.
  const out = { ...base };
  if (overrides && typeof overrides === 'object') {
    for (const key of ['minReservePerSlot', 'tickMs', 'maxAdditions']) {
      const raw = overrides[key];
      if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) out[key] = Number(raw);
    }
  }
  out.startingPurse = rules.startingPurse;
  out.totalSalaryCap = rules.totalSalaryCap;
  out.overseasSalaryCap = rules.overseasSalaryCap;
  out.matchFee = rules.matchFee;
  out.minSquad = rules.minSquad;
  out.maxSquad = rules.maxSquad;
  out.maxOverseas = rules.maxOverseas;
  out.maxRetentions = rules.maxRetentions;
  out.maxCappedRetentions = rules.maxCappedRetentions;
  out.maxUncappedRetentions = rules.maxUncappedRetentions;
  out.minSquad = Math.max(1, Math.floor(out.minSquad));
  out.maxSquad = Math.max(out.minSquad, Math.floor(out.maxSquad));
  out.maxOverseas = Math.max(0, Math.floor(out.maxOverseas));
  out.maxAdditions = Math.max(1, Math.floor(out.maxAdditions));
  out.minReservePerSlot = Math.max(0, out.minReservePerSlot);
  out.tickMs = Math.max(100, out.tickMs);
  const pace = String(overrides?.pace || out.pace || 'BROADCAST').toUpperCase();
  out.pace = PACE_NAMES.includes(pace) ? pace : 'BROADCAST';
  return out;
}

function formatOf(format) {
  return String(format || '').toUpperCase() === 'MINI' ? 'MINI' : 'MEGA';
}

function failure(error) {
  return { ok: false, error };
}

function validateStateShape(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid auction state: expected an object');
  if (state.version !== 1) throw new Error('Invalid auction state: unsupported version');
  if (state.format !== 'MEGA' && state.format !== 'MINI') throw new Error('Invalid auction state: bad format');
  if (typeof state.userFranchiseId !== 'string') throw new Error('Invalid auction state: bad userFranchiseId');
  if (!Number.isInteger(state.stageIndex) || state.stageIndex < 0) throw new Error('Invalid auction state: bad stageIndex');
  for (const key of ['players', 'franchises', 'proceedings', 'eventLog', 'conversations', 'bidHistory', 'nominations']) {
    if (!Array.isArray(state[key])) throw new Error(`Invalid auction state: ${key} must be an array`);
  }
  if (!state.proceedings.length) throw new Error('Invalid auction state: no proceedings');
  if (!state.players.length) throw new Error('Invalid auction state: no players');
  if (!state.franchises.length) throw new Error('Invalid auction state: no franchises');
  if (state.stageIndex > state.proceedings.length) throw new Error('Invalid auction state: stageIndex out of range');
  if (!state.config || typeof state.config !== 'object') throw new Error('Invalid auction state: missing config');
  for (const key of ['startingPurse', 'minSquad', 'maxSquad', 'maxOverseas', 'maxAdditions', 'minReservePerSlot', 'tickMs']) {
    if (!Number.isFinite(Number(state.config[key]))) throw new Error(`Invalid auction state: bad config.${key}`);
  }

  const playerIds = new Set();
  for (const player of state.players) {
    if (!player || typeof player.id !== 'string' || playerIds.has(player.id)) throw new Error('Invalid auction state: duplicate or missing player id');
    if (!Number.isFinite(Number(player.rating)) || !Number.isFinite(Number(player.basePrice))) throw new Error('Invalid auction state: bad player rating or price');
    playerIds.add(player.id);
  }
  const ownerByPlayer = new Map();
  for (const franchise of state.franchises) {
    if (!franchise || typeof franchise.id !== 'string') throw new Error('Invalid auction state: bad franchise id');
    if (!Number.isFinite(Number(franchise.purse))) throw new Error('Invalid auction state: non-numeric purse');
    if (!Array.isArray(franchise.squad) || !Array.isArray(franchise.purchases)) throw new Error('Invalid auction state: bad franchise squad');
    for (const id of franchise.squad) {
      if (ownerByPlayer.has(id) && ownerByPlayer.get(id) !== franchise.id) throw new Error('Invalid auction state: duplicate squad ownership');
      ownerByPlayer.set(id, franchise.id);
    }
  }
}

function recordDiscussion(state, franchiseId, trigger, fallbackText) {
  const before = (state.conversations || []).length;
  try {
    discussionModule?.addContextualDiscussion?.(state, franchiseId, trigger);
  } catch (error) {
    console.error('[engine] discussion hook failed:', error?.message || error);
  }
  if ((state.conversations || []).length === before && fallbackText) {
    state.conversations.push({
      id: uid('conv'),
      at: nowIso(),
      franchiseId,
      author: 'War Room',
      text: String(fallbackText).slice(0, 240),
      tone: 'INFO',
    });
  }
}

export class AuctionEngine {
  constructor(state, { aiClient = null, persist = null } = {}) {
    this.state = clone(state);
    this.aiClient = aiClient;
    this.persist = typeof persist === 'function' ? persist : null;
    this._lastPhase = this.state.phase;
    this._normaliseInternals();
  }

  static create({ format = 'MEGA', season, difficulty = 'BALANCED', userFranchiseId = 'F1', config = {}, aiClient = null, persist = null } = {}) {
    const fmt = formatOf(format);
    const seasonKey = resolveSeason(season, fmt);
    const conf = normaliseConfig(fmt, config, seasonKey);
    const players = generatePlayers(undefined, seasonKey);
    const franchises = createFranchises({ format: fmt, config: conf, players, season: seasonKey });
    const proceedings = createProceedings(fmt, players, seasonKey);
    const now = nowIso();
    const chosenUser = franchises.some((franchise) => franchise.id === userFranchiseId) ? userFranchiseId : 'F1';
    const state = {
      version: 1,
      id: `auc_${randomUUID()}`,
      createdAt: now,
      savedAt: now,
      format: fmt,
      season: seasonKey,
      rules: { ...rulesFor(seasonKey) },
      difficulty: String(difficulty || 'BALANCED').toUpperCase(),
      config: conf,
      userFranchiseId: chosenUser,
      phase: 'SETUP',
      clockRunning: true,
      stageIndex: 0,
      proceedings,
      currentPlayerId: null,
      currentBid: 0,
      leaderId: null,
      activeBidderIds: [],
      withdrawnIds: [],
      bidHistory: [],
      bidsThisLot: 0,
      nominations: [],
      // Right to Match is a live three-step lot phase in the 2025 Mega Auction.
      rtm: null,
      rtmLog: [],
      welfareFund: 0,
      trades: [],
      matchFeeProjection: matchFeeProjection(seasonKey),
      players,
      franchises,
      eventLog: [],
      conversations: [],
      announcement: { id: uid('ann'), text: 'Auction room ready. Start the proceedings when you are.', kind: 'SYSTEM' },
      result: null,
      stageTicks: 0,
      playerCursor: 0,
      goingStage: 0,
      resultTicks: 0,
      phaseTicks: 0,
      aiWaitTicks: 0,
      breakReturn: null,
      calledThisStage: [],
      retentionsConfirmed: false,
    };
    return new AuctionEngine(state, { aiClient, persist });
  }

  static fromState(state, options = {}) {
    validateStateShape(state);
    return new AuctionEngine(state, options);
  }

  /** Attach or replace the AI client / persistence hook after loading a save. */
  attach({ aiClient, persist } = {}) {
    if (aiClient !== undefined) this.aiClient = aiClient;
    if (persist !== undefined) this.persist = typeof persist === 'function' ? persist : null;
    return this;
  }

  getState() {
    return clone(this.state);
  }

  dispatch(action) {
    if (!action || typeof action !== 'object') return failure('Invalid action');
    const result = this._apply(action);
    if (result.ok) this._commit();
    return result;
  }

  async tick() {
    const state = this.state;
    if (!state.clockRunning || TERMINAL_PHASES.has(state.phase)) return { changed: false };

    const pace = paceOf(state);
    state.phaseTicks = (Number(state.phaseTicks) || 0) + 1;
    state.stageTicks = state.phaseTicks; // retained for older saved states / UI
    let changed = false;
    const stage = this._stage();

    if (state.phase === 'OPENING' || (stage && stage.kind === 'ANNOUNCEMENT')) {
      if (state.phaseTicks >= pace.announcement) {
        this._advanceStage();
        changed = true;
      }
      return this._finishTick(changed);
    }

    switch (state.phase) {
      case 'PLAYER_INTRODUCTION': {
        const player = this._currentPlayer();
        if (!player) {
          this._advanceLot();
        } else if (state.phaseTicks >= pace.intro) {
          state.phase = 'BIDDING';
          state.goingStage = 0;
          state.aiWaitTicks = pace.aiReaction;
          this._pushEvent('BIDDING_OPEN', `Bidding is open for ${player.name} at ₹${player.basePrice} Cr.`, { playerId: player.id });
          this._announce(`Bidding is open for ${player.name} at ${player.basePrice} crore.`, 'BIDDING');
        }
        changed = true;
        break;
      }
      case 'ACCELERATED_AUCTION': {
        const player = this._currentPlayer();
        if (!player) {
          this._advanceLot();
        } else if (state.phaseTicks >= pace.intro) {
          state.phase = 'BIDDING';
          state.goingStage = 0;
          state.aiWaitTicks = pace.aiReaction;
          this._announce(`Bidding is open in the accelerated round for ${player.name}.`, 'BIDDING');
        }
        changed = true;
        break;
      }
      case 'BIDDING':
      case 'GOING_ONCE':
      case 'GOING_TWICE':
        changed = await this._auctionTick(pace);
        break;
      case 'RTM_OFFER':
      case 'RTM_COUNTER':
      case 'RTM_MATCH':
        changed = this._resolveRtmTick();
        break;
      case 'SOLD':
      case 'UNSOLD':
        if (state.phaseTicks >= pace.result) {
          this._advanceLot();
          changed = true;
        }
        break;
      default:
        changed = false;
    }
    return this._finishTick(changed);
  }

  // ---------------------------------------------------------------- dispatch

  _apply(action) {
    const state = this.state;
    switch (action.type) {
      case 'CREATE':
        // Static create() owns construction; ignore here so generic clients work.
        return { ok: true };

      case 'SET_RETENTIONS': {
        if (state.phase !== 'SETUP') return failure('Retentions can only be changed in SETUP');
        const playerIds = Array.isArray(action.playerIds) ? action.playerIds : [];
        const outcome = this._setRetentions(playerIds);
        if (!outcome.ok) return outcome;
        const mine = this._franchise(state.userFranchiseId);
        this._announce(
          mine?.retentions?.length
            ? `${mine.name} retained ${mine.retentions.length} player(s) for ₹${mine.retentionSpent} Cr. Rival retentions are locked in.`
            : 'No retentions selected — every player goes into the auction pool.',
          'RETENTION'
        );
        return outcome;
      }

      case 'START': {
        if (state.phase !== 'SETUP') return failure('The auction has already started');
        // START confirms the current selection. An untouched setup means zero
        // retentions, so the user can begin with an empty squad if they wish.
        if (!state.retentionsConfirmed) {
          const outcome = this._setRetentions([]);
          if (!outcome.ok) return outcome;
        }
        this._pushEvent('AUCTION_START', 'The auction is under way.');
        this._activateStage(0);
        return { ok: true };
      }

      case 'CONTINUE': {
        const stage = this._stage();
        if (state.phase !== 'COMPLETED' && (state.phase === 'OPENING' || stage?.kind === 'ANNOUNCEMENT')) {
          this._advanceStage();
        }
        return { ok: true };
      }

      case 'OPEN_BIDDING': {
        if (state.phase === 'BIDDING') return { ok: true };
        if (state.phase !== 'PLAYER_INTRODUCTION' && state.phase !== 'ACCELERATED_AUCTION') {
          return failure('Bidding cannot be opened in the current phase');
        }
        const player = this._currentPlayer();
        if (!player) return failure('There is no player on the block');
        state.phase = 'BIDDING';
        state.goingStage = 0;
        this._pushEvent('BIDDING_OPEN', `Bidding is open for ${player.name} at ₹${player.basePrice} Cr.`, { playerId: player.id });
        this._announce(`Bidding is open for ${player.name} at ${player.basePrice} crore.`, 'BIDDING');
        return { ok: true };
      }

      case 'BID': {
        const source = action.source === 'AI' ? 'AI' : 'HUMAN';
        const franchiseId = action.franchiseId || (source === 'HUMAN' ? state.userFranchiseId : null);
        if (!franchiseId) return failure('A franchise is required to bid');
        if (source === 'HUMAN' && franchiseId !== state.userFranchiseId) {
          return failure('You may only bid for your own franchise');
        }
        const player = this._currentPlayer();
        if (!player) return failure('There is no player on the block');
        // A bidder may raise a paddle as soon as the player is on the screen —
        // the auctioneer then opens the floor and recognises the bid.
        if (!OPEN_PHASES.has(state.phase)) {
          if (state.phase !== 'PLAYER_INTRODUCTION' && state.phase !== 'ACCELERATED_AUCTION') {
            return failure('Bidding is not open at the moment');
          }
          state.phase = 'BIDDING';
          state.goingStage = 0;
          this._pushEvent('BIDDING_OPEN', `Bidding is opened for ${player.name} at ₹${player.basePrice} Cr.`, { playerId: player.id });
          this._announce(`Bidding is open for ${player.name} at ${player.basePrice} crore.`, 'BIDDING');
        }
        const amount = state.currentBid > 0 && state.bidsThisLot > 0
          ? getNextBid(state.currentBid)
          : Number(player.basePrice);
        const check = validateBid(state, franchiseId, amount);
        if (!check.ok) return failure(check.error);
        this._applyBid(franchiseId, amount, source, player);
        state.aiWaitTicks = paceOf(state).aiReaction;
        state.phaseTicks = 0;
        return { ok: true };
      }

      case 'WITHDRAW': {
        const source = action.source === 'AI' ? 'AI' : 'HUMAN';
        const franchiseId = action.franchiseId || (source === 'HUMAN' ? state.userFranchiseId : null);
        if (!franchiseId) return failure('A franchise is required to withdraw');
        if (source === 'HUMAN' && franchiseId !== state.userFranchiseId) {
          return failure('You may only withdraw your own franchise');
        }
        if (!OPEN_PHASES.has(state.phase)) return failure('Withdrawals are only allowed while bidding is open');
        if (state.leaderId === franchiseId) return failure('The leading franchise cannot withdraw');
        const player = this._currentPlayer();
        if (!player) return failure('There is no player on the block');
        this._applyWithdrawal(franchiseId, player);
        return { ok: true };
      }

      case 'CALL_BREAK': {
        if (state.phase !== 'PLAYER_INTRODUCTION' && !OPEN_PHASES.has(state.phase)) {
          return failure('A break cannot be called in the current phase');
        }
        state.breakReturn = {
          phase: state.phase,
          currentPlayerId: state.currentPlayerId,
          currentBid: state.currentBid,
          leaderId: state.leaderId,
          activeBidderIds: state.activeBidderIds.slice(),
          withdrawnIds: state.withdrawnIds.slice(),
          bidsThisLot: state.bidsThisLot,
          stageIndex: state.stageIndex,
        };
        state.phase = 'STRATEGY_BREAK';
        this._announce('Strategy break called. The floor is paused.', 'BREAK');
        this._pushEvent('BREAK', 'A strategy break has been called.');
        recordDiscussion(state, state.userFranchiseId, 'BREAK', 'We are using this break to reset our targets.');
        return { ok: true };
      }

      case 'RESUME_BREAK': {
        if (state.phase === 'SET_BREAK') {
          this._advanceStage();
          return { ok: true };
        }
        if (state.phase !== 'STRATEGY_BREAK') return failure('There is no active break to resume');
        const saved = state.breakReturn;
        if (!saved) return failure('No break state to restore');
        state.phase = saved.phase;
        state.currentPlayerId = saved.currentPlayerId;
        state.currentBid = saved.currentBid;
        state.leaderId = saved.leaderId;
        state.activeBidderIds = (saved.activeBidderIds || []).slice();
        state.withdrawnIds = (saved.withdrawnIds || []).slice();
        state.bidsThisLot = saved.bidsThisLot;
        state.stageIndex = saved.stageIndex;
        state.goingStage = saved.phase === 'GOING_TWICE' ? 2 : saved.phase === 'GOING_ONCE' ? 1 : 0;
        state.breakReturn = null;
        this._refreshBiddingStatus();
        this._announce('We are back on the auction floor.', 'BREAK');
        this._pushEvent('BREAK_RESUMED', 'The auction has resumed after the break.');
        return { ok: true };
      }

      case 'NEXT': {
        if (state.phase === 'SET_BREAK' || state.phase === 'STRATEGY_BREAK') return failure('Resume the break first');
        const stage = this._stage();
        if (state.phase === 'OPENING' || stage?.kind === 'ANNOUNCEMENT') {
          this._advanceStage();
        } else if (state.phase === 'PLAYER_INTRODUCTION') {
          const player = this._currentPlayer();
          if (!player) this._advanceLot();
          else {
            state.phase = 'BIDDING';
            this._announce(`Bidding is open for ${player.name} at ${player.basePrice} crore.`, 'BIDDING');
            this._pushEvent('BIDDING_OPEN', `Bidding is open for ${player.name}.`, { playerId: player.id });
          }
        } else if (state.phase === 'BIDDING') {
          if (state.bidsThisLot > 0) this._goingOnce();
          else this._completeLot('UNSOLD');
        } else if (state.phase === 'GOING_ONCE') {
          this._goingTwice();
        } else if (state.phase === 'GOING_TWICE') {
          this._completeLot(state.leaderId && state.currentBid > 0 ? 'SOLD' : 'UNSOLD');
        } else if (RTM_PHASES.has(state.phase)) {
          return failure('Resolve the Right to Match before continuing');
        } else if (state.phase === 'SOLD' || state.phase === 'UNSOLD') {
          this._advanceLot();
        }
        return { ok: true };
      }

      case 'PAUSE':
        state.clockRunning = false;
        this._pushEvent('PAUSED', 'The auction clock has been paused.');
        return { ok: true };

      case 'UNPAUSE':
        state.clockRunning = true;
        this._pushEvent('RESUMED', 'The auction clock has resumed.');
        return { ok: true };

      case 'NOMINATE': {
        const player = (state.players || []).find((candidate) => candidate.id === action.playerId);
        if (!player) return failure('Player not found');
        if (player.availability === 'SOLD') return failure('Sold players cannot be nominated');
        const selected = action.selected !== false;
        const has = state.nominations.includes(player.id);
        if (selected && !has) state.nominations.push(player.id);
        else if (!selected && has) state.nominations = state.nominations.filter((id) => id !== player.id);
        this._pushEvent(selected ? 'NOMINATED' : 'NOMINATION_REMOVED', `${selected ? 'Nominated' : 'Unnominated'} ${player.name} for the accelerated round.`, { playerId: player.id });
        this._announce(`${player.name} ${selected ? 'added to' : 'removed from'} the accelerated nomination list.`, 'NOMINATION');
        return { ok: true };
      }

      // ------------------------------------------------ right to match (2025)
      case 'USE_RTM':
      case 'PASS_RTM':
      case 'RTM_RAISE':
      case 'RTM_DECLINE':
      case 'MATCH_RTM': {
        const source = action.source === 'AI' ? 'AI' : 'HUMAN';
        const actor = action.franchiseId || (source === 'HUMAN' ? state.userFranchiseId : null);
        if (!actor) return failure('A franchise is required for a Right to Match decision');
        if (source === 'HUMAN' && actor !== state.userFranchiseId) {
          return failure('You may only decide for your own franchise');
        }
        return this._rtmDecision(action.type, actor);
      }

      // ------------------------------------------- season operations (BCCI)
      case 'PROPOSE_TRADE': {
        const outcome = proposeTrade(state, action);
        if (!outcome.ok) return outcome;
        this._pushEvent('TRADE', outcome.message, { tradeId: outcome.trade?.id });
        this._announce(outcome.message, 'TRADE');
        return outcome;
      }

      case 'RESPOND_TRADE': {
        const outcome = respondTrade(state, action);
        if (!outcome.ok) return outcome;
        this._pushEvent('TRADE', outcome.message, { tradeId: outcome.trade?.id });
        this._announce(outcome.message, 'TRADE');
        return outcome;
      }

      case 'INJURE_PLAYER': {
        const outcome = injurePlayer(state, action);
        if (!outcome.ok) return outcome;
        this._pushEvent('INJURY', outcome.message, { playerId: action.playerId });
        this._announce(outcome.message, 'INJURY');
        return outcome;
      }

      case 'SIGN_INJURY_REPLACEMENT': {
        const outcome = signInjuryReplacement(state, action);
        if (!outcome.ok) return outcome;
        this._pushEvent('RAPP_REPLACEMENT', outcome.message, { playerId: action.replacementPlayerId });
        this._announce(outcome.message, 'RAPP');
        return outcome;
      }

      case 'PLAYER_WITHDRAW': {
        const outcome = withdrawPlayer(state, action);
        if (!outcome.ok) return outcome;
        this._pushEvent('WITHDRAWAL', outcome.message, { playerId: action.playerId });
        this._announce(outcome.message, 'WITHDRAWAL');
        return outcome;
      }

      case 'MEETING': {
        const franchise = this._franchise(state.userFranchiseId);
        recordDiscussion(state, state.userFranchiseId, 'MEETING', `${franchise?.name || 'Our team'} is reviewing role gaps and remaining purse.`);
        this._pushEvent('MEETING', 'War room meeting held.', { franchiseId: state.userFranchiseId });
        this._announce('War room huddle in progress.', 'MEETING');
        return { ok: true };
      }

      case 'RESET':
        state.phase = 'SETUP';
        state.id = '';
        return { ok: true };

      default:
        return failure(`Unknown action: ${action.type}`);
    }
  }

  // ------------------------------------------------------------------- tick

  async _auctionTick(pace) {
    const state = this.state;
    const player = this._currentPlayer();
    if (!player) {
      this._advanceLot();
      return true;
    }
    // Franchises do not answer instantly: the floor pauses while they think,
    // which also gives the human representative time to raise a paddle.
    if (state.aiWaitTicks > 0) {
      state.aiWaitTicks -= 1;
      return true;
    }

    const stage = this._stage();
    const nextAmount = state.currentBid > 0 && state.bidsThisLot > 0
      ? getNextBid(state.currentBid)
      : Number(player.basePrice);

    const decisions = await this._askAi(player, stage, nextAmount);
    for (const decision of decisions) {
      if (decision.franchiseId) this._publicAiComment(decision.franchiseId, decision);
    }

    const bids = decisions
      .filter((decision) => decision && decision.action === 'BID' && decision.franchiseId)
      .sort((a, b) => {
        const confidenceA = Number.isFinite(Number(a.confidence)) ? Number(a.confidence) : 0;
        const confidenceB = Number.isFinite(Number(b.confidence)) ? Number(b.confidence) : 0;
        return confidenceB - confidenceA || String(a.franchiseId).localeCompare(String(b.franchiseId));
      });

    for (const decision of bids) {
      if (decision.amount !== undefined && decision.amount !== null) {
        const offered = Number(decision.amount);
        if (!Number.isFinite(offered) || Math.abs(offered - nextAmount) > 0.000001) continue;
      }
      const check = validateBid(state, decision.franchiseId, nextAmount);
      if (check.ok) {
        this._applyBid(decision.franchiseId, nextAmount, 'AI', player);
        state.aiWaitTicks = pace.aiReaction;
        state.phaseTicks = 0;
        return true;
      }
    }

    const withdrawal = decisions.find((decision) => decision && decision.action === 'WITHDRAW'
      && decision.franchiseId
      && state.leaderId !== decision.franchiseId
      && !(state.withdrawnIds || []).includes(decision.franchiseId));
    if (withdrawal && OPEN_PHASES.has(state.phase)) {
      this._applyWithdrawal(withdrawal.franchiseId, player);
      state.aiWaitTicks = Math.max(1, pace.aiReaction);
      return true;
    }

    const dwell = state.phase === 'BIDDING'
      ? pace.bid
      : state.phase === 'GOING_ONCE' ? pace.goingOnce : pace.goingTwice;
    if (state.phaseTicks >= dwell) {
      if (state.phase === 'BIDDING') {
        if (state.bidsThisLot > 0) this._goingOnce();
        else this._completeLot('UNSOLD');
      } else if (state.phase === 'GOING_ONCE') {
        this._goingTwice();
      } else if (state.phase === 'GOING_TWICE') {
        this._completeLot(state.leaderId && state.currentBid > 0 ? 'SOLD' : 'UNSOLD');
      }
      return true;
    }

    // No team raised at this call. Let the room breathe before the next call.
    state.aiWaitTicks = pace.aiReaction > 0 ? 1 : 0;
    return true;
  }

  async _askAi(player, stage, nextAmount) {
    const state = this.state;
    if (!this.aiClient || typeof this.aiClient.decide !== 'function') return [];
    const config = state.config;
    const availableByRole = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
    for (const candidate of state.players) {
      if (candidate.availability === 'AVAILABLE' && Object.hasOwn(availableByRole, candidate.role)) {
        availableByRole[candidate.role] += 1;
      }
    }
    const squadInfo = (franchise) => {
      const byId = new Map(state.players.map((candidate) => [candidate.id, candidate]));
      const existing = new Set(franchise.existing || []);
      return (franchise.squad || []).map((id) => {
        const member = byId.get(id);
        if (!member) return null;
        return {
          role: member.role,
          nationality: member.nationality,
          rating: member.rating,
          source: existing.has(id) ? 'EXISTING' : 'PURCHASED',
        };
      }).filter(Boolean);
    };
    const overseasOf = (franchise) => {
      const byId = new Map(state.players.map((candidate) => [candidate.id, candidate]));
      return (franchise.squad || []).filter((id) => isOverseas(byId.get(id))).length;
    };

    const decisions = [];
    const eligible = state.franchises.filter((franchise) => franchise.id !== state.userFranchiseId
      && state.leaderId !== franchise.id
      && !(state.withdrawnIds || []).includes(franchise.id));

    for (const franchise of eligible) {
      const context = {
        requestId: uid('req'),
        difficulty: state.difficulty,
        format: state.format,
        season: state.season,
        rules: {
          totalSalaryCap: config.totalSalaryCap,
          overseasSalaryCap: config.overseasSalaryCap,
          rtmAvailable: Boolean(rulesFor(state.season).rtmAvailable),
          matchFee: config.matchFee,
        },
        config: {
          maxSquad: config.maxSquad,
          maxOverseas: config.maxOverseas,
          maxAdditions: config.maxAdditions,
          minReservePerSlot: config.minReservePerSlot,
          overseasSalaryCap: config.overseasSalaryCap,
        },
        player: {
          id: player.id,
          role: player.role,
          category: player.category,
          rating: player.rating,
          age: player.age,
          nationality: player.nationality,
          capped: player.capped !== false,
          uncappedReason: player.uncappedReason || null,
          contractFee: player.contractFee || 0,
          previousFranchiseId: player.previousFranchiseId || null,
          basePrice: player.basePrice,
          stats: { ...player.stats },
        },
        auction: {
          currentBid: state.currentBid,
          nextBid: nextAmount,
          leaderId: state.leaderId,
          bidsThisLot: state.bidsThisLot,
          stageKind: stage?.kind || 'SET',
          accelerated: stage?.kind === 'ACCELERATED',
          availableByRole: { ...availableByRole },
          rtm: state.rtm ? {
            phase: state.phase,
            playerId: state.rtm.playerId,
            originalFranchiseId: state.rtm.originalFranchiseId,
            leaderFranchiseId: state.rtm.leaderFranchiseId,
            price: state.rtm.price,
          } : null,
        },
        self: {
          id: franchise.id,
          purse: franchise.purse,
          squad: squadInfo(franchise),
          additionsUsed: (franchise.purchases || []).length,
          maxAdditions: Number.isFinite(Number(franchise.additionsLimit))
            ? Number(franchise.additionsLimit)
            : config.maxAdditions,
          overseasCount: overseasOf(franchise),
          overseasSalarySpend: Number(franchise.overseasSalarySpend) || 0,
          overseasSalaryCap: config.overseasSalaryCap,
          rtmCards: Number(franchise.rtmCards) || 0,
          strategy: franchise.strategy,
          isLeader: false,
          withdrawn: false,
          rejected: (franchise.rejected || []).slice(),
        },
        others: state.franchises.filter((other) => other.id !== franchise.id).map((other) => ({
          id: other.id,
          purse: other.purse,
          squadSize: (other.squad || []).length,
          overseasCount: overseasOf(other),
        })),
      };
      try {
        const decision = await Promise.resolve(this.aiClient.decide(context));
        if (decision && typeof decision === 'object') decisions.push({ ...decision, franchiseId: franchise.id });
      } catch (error) {
        console.error(`[engine] aiClient.decide failed for ${franchise.id}:`, error?.message || error);
      }
    }
    return decisions;
  }

  _publicAiComment(franchiseId, decision) {
    let text = '';
    try {
      const generated = discussionModule?.publicAiComment?.(decision, franchiseId);
      if (typeof generated === 'string') text = generated.replace(/^[A-Z]\d+:\s*/, '').trim();
    } catch {
      text = '';
    }
    if (!text && typeof decision.publicComment === 'string') text = decision.publicComment.trim();
    if (!text) text = decision.action === 'BID' ? 'We see value at this price.' : 'We will let this one go.';
    // privateReason is deliberately never copied into authoritative state.
    this.state.conversations.push({
      id: uid('conv'),
      at: nowIso(),
      franchiseId,
      author: 'AI Floor',
      text: String(text).slice(0, 240),
      tone: decision.action === 'BID' ? 'CONFIDENT' : 'NEUTRAL',
    });
    if (this.state.conversations.length > 1000) this.state.conversations.splice(0, this.state.conversations.length - 1000);
  }

  // --------------------------------------------------------------- internals

  /**
   * Replace every retention (human + AI) with a fresh selection. Validation
   * runs against a reset clone first so a rejected request leaves the current
   * setup untouched. The nine AI teams pick after the human, from what is left.
   */
  _setRetentions(playerIds) {
    const state = this.state;
    if (state.phase !== 'SETUP') return failure('Retentions can only be changed in SETUP');
    const mine = state.userFranchiseId;

    const preview = clone(state);
    resetRetentions(preview);
    const check = validateRetentionSelection(preview, mine, playerIds);
    if (!check.ok) return check;

    resetRetentions(state);
    applyRetentionSelection(state, mine, playerIds);
    autoRetainAi(state);
    state.retentionsConfirmed = true;

    const franchise = this._franchise(mine);
    const count = (franchise.retentions || []).length;
    this._pushEvent(
      'RETENTIONS_SET',
      `${franchise.name} retained ${count} player${count === 1 ? '' : 's'} for ₹${franchise.retentionSpent} Cr.`,
      { franchiseId: mine, count, cost: franchise.retentionSpent }
    );
    return {
      ok: true,
      retentions: (franchise.retentions || []).slice(),
      retentionSpent: franchise.retentionSpent,
      additionsLimit: franchise.additionsLimit,
    };
  }

  _normaliseInternals() {
    const state = this.state;
    state.season = resolveSeason(state.season, state.format);
    state.rules = { ...rulesFor(state.season, state.format) };
    state.config = normaliseConfig(state.format, state.config || {}, state.season);
    if (!Array.isArray(state.eventLog)) state.eventLog = [];
    if (!Array.isArray(state.conversations)) state.conversations = [];
    if (!Array.isArray(state.bidHistory)) state.bidHistory = [];
    if (!Array.isArray(state.nominations)) state.nominations = [];
    if (!Array.isArray(state.rtmLog)) state.rtmLog = [];
    if (!Array.isArray(state.trades)) state.trades = [];
    if (state.rtm === undefined || state.rtm === null) state.rtm = null;
    if (!Number.isFinite(Number(state.welfareFund))) state.welfareFund = 0;
    if (!Number.isFinite(Number(state.matchFeeProjection))) state.matchFeeProjection = matchFeeProjection(state.season);
    if (!state.announcement) state.announcement = { id: uid('ann'), text: 'Auction room ready.', kind: 'SYSTEM' };
    if (!Number.isFinite(Number(state.stageTicks))) state.stageTicks = 0;
    if (!Number.isFinite(Number(state.playerCursor))) state.playerCursor = 0;
    if (!Number.isFinite(Number(state.goingStage))) state.goingStage = 0;
    if (!Number.isFinite(Number(state.resultTicks))) state.resultTicks = 0;
    if (!Number.isFinite(Number(state.phaseTicks))) state.phaseTicks = 0;
    if (!Number.isFinite(Number(state.aiWaitTicks))) state.aiWaitTicks = 0;
    if (state.breakReturn === undefined) state.breakReturn = null;
    if (!Array.isArray(state.calledThisStage)) state.calledThisStage = [];
    if (typeof state.retentionsConfirmed !== 'boolean') state.retentionsConfirmed = false;
    if (!Number.isFinite(Number(state.config.maxRetentions))) {
      state.config.maxRetentions = RETENTION_LIMITS[state.format] || 6;
    }

    // Keep salary metadata consistent for saves created before the BCCI rules.
    for (const player of state.players || []) {
      if (!Number.isFinite(Number(player.salary))) {
        player.salary = Number(player.soldPrice) > 0
          ? Number(player.soldPrice)
          : Number(player.retentionCost) || Number(player.contractFee) || 0;
      }
    }

    const maxAdditions = Number.isFinite(Number(state.config.maxAdditions))
      ? Number(state.config.maxAdditions)
      : FRANCHISE_CONFIG_DEFAULTS[state.format]?.maxAdditions || 6;
    for (const franchise of state.franchises) {
      if (!Array.isArray(franchise.discussions)) franchise.discussions = [];
      if (!Array.isArray(franchise.rejected)) franchise.rejected = [];
      if (!Array.isArray(franchise.retentions)) franchise.retentions = [];
      if (!Array.isArray(franchise.existing)) franchise.existing = [];
      if (!Array.isArray(franchise.previousSquad)) franchise.previousSquad = [];
      if (!Array.isArray(franchise.trades)) franchise.trades = [];
      if (!Number.isFinite(Number(franchise.retentionSpent))) franchise.retentionSpent = 0;
      if (!Number.isFinite(Number(franchise.rtmCards))) {
        franchise.rtmCards = rulesFor(state.season, state.format).rtmAvailable
          ? Math.max(0, rulesFor(state.season, state.format).maxRetentions - (franchise.retentions || []).length)
          : 0;
      }
      if (!Number.isFinite(Number(franchise.rtmUsed))) franchise.rtmUsed = 0;
      if (!Number.isFinite(Number(franchise.welfareContribution))) franchise.welfareContribution = 0;
      if (!Number.isFinite(Number(franchise.overseasSalarySpend))) franchise.overseasSalarySpend = 0;
      if (!Number.isFinite(Number(franchise.additionsLimit))) {
        franchise.additionsLimit = state.format === 'MINI' ? maxAdditions : Number(state.config.maxSquad) || 25;
      }
      // Legacy saves used `existing` without a cost. Treat those as zero-cost
      // retentions so results keep the purse invariant without silently
      // changing an in-flight auction.
      if (franchise.retentions.length === 0 && franchise.existing.length) {
        franchise.retentions = franchise.existing.map((id) => {
          const player = state.players.find((candidate) => candidate.id === id);
          return { playerId: id, cost: Number(player?.retentionCost) || 0, rating: Number(player?.rating) || 0, name: player?.name || id };
        });
      }
      if (!franchise.biddingStatus) franchise.biddingStatus = 'IDLE';
    }
  }

  _commit() {
    if (this._lastPhase && this.state.phase !== this._lastPhase) this.state.phaseTicks = 0;
    this._lastPhase = this.state.phase;
    this.state.savedAt = nowIso();
    if (!this.persist) return;
    try {
      this.persist(clone(this.state));
    } catch (error) {
      console.error('[engine] persist failed:', error?.message || error);
    }
  }

  _finishTick(changed) {
    if (changed) this._commit();
    return { changed };
  }

  _stage() {
    return this.state.proceedings[this.state.stageIndex] || null;
  }

  _currentPlayer() {
    return this.state.players.find((player) => player.id === this.state.currentPlayerId) || null;
  }

  _franchise(id) {
    return this.state.franchises.find((franchise) => franchise.id === id) || null;
  }

  _pushEvent(type, text, extra = {}) {
    this.state.eventLog.push({ id: uid('evt'), at: nowIso(), type, text, ...extra });
    if (this.state.eventLog.length > EVENT_LIMIT) this.state.eventLog.splice(0, this.state.eventLog.length - EVENT_LIMIT);
  }

  _announce(text, kind) {
    this.state.announcement = { id: uid('ann'), text: String(text), kind };
  }

  _refreshBiddingStatus() {
    const state = this.state;
    const withdrawn = new Set(state.withdrawnIds || []);
    const active = new Set(state.activeBidderIds || []);
    for (const franchise of state.franchises) {
      franchise.biddingStatus = withdrawn.has(franchise.id)
        ? 'WITHDRAWN'
        : state.leaderId === franchise.id
          ? 'LEADING'
          : active.has(franchise.id)
            ? 'ACTIVE'
            : 'IDLE';
    }
  }

  _applyBid(franchiseId, amount, source, player) {
    const state = this.state;
    const franchise = this._franchise(franchiseId);
    if (!franchise) return;
    const previousBid = state.currentBid;
    state.currentBid = roundMoney(amount);
    state.leaderId = franchiseId;
    if (!state.activeBidderIds.includes(franchiseId)) state.activeBidderIds.push(franchiseId);
    state.bidsThisLot += 1;
    state.bidHistory.push({
      id: uid('bid'),
      at: nowIso(),
      playerId: player.id,
      franchiseId,
      amount: state.currentBid,
      previousBid,
      source,
    });
    if (state.phase === 'GOING_ONCE' || state.phase === 'GOING_TWICE') state.phase = 'BIDDING';
    state.goingStage = 0;
    this._refreshBiddingStatus();
    this._pushEvent('BID', `${franchise.name} bids ₹${state.currentBid} Cr for ${player.name}.`, { playerId: player.id, franchiseId });
    this._announce(`${franchise.name} bids ${state.currentBid} crore for ${player.name}.`, 'BID');
    recordDiscussion(state, franchiseId, 'BID', `${franchise.name} can stretch to ₹${state.currentBid} Cr for ${player.role.toLowerCase()} ${player.name}.`);
  }

  _applyWithdrawal(franchiseId, player) {
    const state = this.state;
    const franchise = this._franchise(franchiseId);
    if (!franchise || state.withdrawnIds.includes(franchiseId)) return;
    state.withdrawnIds.push(franchiseId);
    this._refreshBiddingStatus();
    this._pushEvent('WITHDRAW', `${franchise.name} withdraws from the bid for ${player.name}.`, { playerId: player.id, franchiseId });
    this._announce(`${franchise.name} is out for ${player.name}.`, 'WITHDRAW');
    recordDiscussion(state, franchiseId, 'WITHDRAW', `${franchise.name} stepped back — the price no longer fits our plan.`);
  }

  _goingOnce() {
    this.state.phase = 'GOING_ONCE';
    this.state.goingStage = 1;
    const player = this._currentPlayer();
    this._pushEvent('GOING_ONCE', `Going once for ${player ? player.name : 'the player'}.`, player ? { playerId: player.id } : {});
    this._announce('Going once.', 'GOING_ONCE');
  }

  _goingTwice() {
    this.state.phase = 'GOING_TWICE';
    this.state.goingStage = 2;
    const player = this._currentPlayer();
    this._pushEvent('GOING_TWICE', `Going twice for ${player ? player.name : 'the player'}.`, player ? { playerId: player.id } : {});
    this._announce('Going twice.', 'GOING_TWICE');
  }

  // ------------------------------------------------ right to match (2025)

  /** A sold lot first gives its previous franchise the Right to Match. */
  _completeLot(outcome) {
    if (outcome === 'SOLD' && this._maybeStartRtm()) return;
    this._finaliseLot(outcome);
  }

  _maybeStartRtm() {
    const state = this.state;
    const rules = rulesFor(state.season, state.format);
    if (!rules.rtmAvailable) return false;
    const player = this._currentPlayer();
    if (!player || !player.retentionCandidate || !player.previousFranchiseId) return false;
    if (!state.leaderId || player.previousFranchiseId === state.leaderId) return false;
    const original = this._franchise(player.previousFranchiseId);
    if (!original || !(Number(original.rtmCards) > 0)) return false;
    if (!validateHold(state, original.id, player, state.currentBid).ok) return false;

    state.rtm = {
      playerId: player.id,
      originalFranchiseId: original.id,
      leaderFranchiseId: state.leaderId,
      bid: roundMoney(state.currentBid),
      counterBid: null,
      price: roundMoney(state.currentBid),
      usedCard: false,
      log: [],
    };
    state.phase = 'RTM_OFFER';
    state.phaseTicks = 0;
    this._pushEvent('RTM_OFFER', `${original.name} may use Right to Match on ${player.name} at ₹${state.rtm.bid} Cr.`, {
      playerId: player.id,
      franchiseId: original.id,
    });
    this._announce(`Right to Match: ${original.name} can match ${state.rtm.bid} crore for ${player.name}.`, 'RTM');
    recordDiscussion(state, original.id, 'RTM', `${original.name} holds a Right to Match card for ${player.name} at ${state.rtm.bid} crore.`);
    return true;
  }

  /** Resolve the AI side of an RTM exchange; the human side waits for input. */
  _resolveRtmTick() {
    const state = this.state;
    const rtm = state.rtm;
    if (!rtm || !RTM_PHASES.has(state.phase)) return false;
    const actor = state.phase === 'RTM_COUNTER' ? rtm.leaderFranchiseId : rtm.originalFranchiseId;
    if (actor === state.userFranchiseId) return false;
    const outcome = this._rtmDecision(this._aiRtmDecision(actor), actor);
    return outcome.ok;
  }

  _aiRtmDecision(franchiseId) {
    const state = this.state;
    const rtm = state.rtm;
    const player = this._currentPlayer();
    if (!rtm || !player) return 'PASS_RTM';
    if (state.phase === 'RTM_COUNTER') {
      return this._aiWantsPlayer(franchiseId, player, getNextBid(rtm.bid)) ? 'RTM_RAISE' : 'RTM_DECLINE';
    }
    const amount = state.phase === 'RTM_MATCH' ? rtm.price : rtm.bid;
    if (!this._aiWantsPlayer(franchiseId, player, amount)) return 'PASS_RTM';
    return state.phase === 'RTM_MATCH' ? 'MATCH_RTM' : 'USE_RTM';
  }

  _aiWantsPlayer(franchiseId, player, amount) {
    const state = this.state;
    const franchise = this._franchise(franchiseId);
    if (!franchise) return false;
    if (state.phase !== 'RTM_COUNTER' && !(Number(franchise.rtmCards) > 0)) return false;
    if (Number(franchise.purse) + 1e-9 < amount) return false;
    if (!validateHold(state, franchiseId, player, amount).ok) return false;
    const roleWanted = (franchise.targets || []).includes(player.role);
    const ceiling = (franchise.strategy === 'AGGRESSIVE' ? 95 : franchise.strategy === 'VALUE' ? 82 : 88)
      + (roleWanted ? 3 : 0);
    return (Number(player.rating) || 0) <= ceiling;
  }

  _rtmDecision(type, actor) {
    const state = this.state;
    const rtm = state.rtm;
    if (!rtm || !RTM_PHASES.has(state.phase)) return failure('There is no active Right to Match decision');
    const player = this._currentPlayer();
    if (!player || player.id !== rtm.playerId) return failure('The Right to Match lot has changed');
    const original = this._franchise(rtm.originalFranchiseId);
    const leader = this._franchise(rtm.leaderFranchiseId);
    if (!original || !leader) return failure('Right to Match franchises are missing');

    const log = (step, text, extra = {}) => {
      const entry = { step, at: nowIso(), franchiseId: actor, text, ...extra };
      rtm.log.push(entry);
      if (!Array.isArray(state.rtmLog)) state.rtmLog = [];
      state.rtmLog.push({ playerId: player.id, ...entry });
      this._pushEvent(`RTM_${step}`, text, { playerId: player.id, franchiseId: actor, ...extra });
    };

    switch (type) {
      case 'USE_RTM': {
        if (state.phase !== 'RTM_OFFER') return failure('Right to Match can only be used at the offer stage');
        if (actor !== original.id) return failure(`Only ${original.name} can use the Right to Match`);
        if (!(Number(original.rtmCards) > 0)) return failure(`${original.name} has no RTM cards left`);
        const check = validateHold(state, actor, player, rtm.bid);
        if (!check.ok) return failure(check.error);
        original.rtmCards = Number(original.rtmCards) - 1;
        original.rtmUsed = (Number(original.rtmUsed) || 0) + 1;
        rtm.usedCard = true;
        log('USED', `${original.name} exercises Right to Match on ${player.name} at ₹${rtm.bid} Cr.`);
        state.phase = 'RTM_COUNTER';
        state.phaseTicks = 0;
        this._announce(`${original.name} has matched — ${leader.name} may counter.`, 'RTM');
        return { ok: true };
      }
      case 'RTM_RAISE': {
        if (state.phase !== 'RTM_COUNTER') return failure('No counter is open');
        if (actor !== leader.id) return failure(`Only ${leader.name} can counter`);
        const raised = getNextBid(rtm.bid);
        const check = validateHold(state, actor, player, raised);
        if (!check.ok) return failure(check.error);
        if (Number(leader.purse) + 1e-9 < raised) return failure(`${leader.name} cannot fund the counter`);
        rtm.counterBid = raised;
        rtm.price = raised;
        log('COUNTERED', `${leader.name} counters at ₹${raised} Cr for ${player.name}.`, { amount: raised });
        state.phase = 'RTM_MATCH';
        state.phaseTicks = 0;
        this._announce(`${leader.name} counters at ${raised} crore — ${original.name} to decide.`, 'RTM');
        return { ok: true };
      }
      case 'RTM_DECLINE': {
        if (state.phase !== 'RTM_COUNTER') return failure('No counter is open');
        if (actor !== leader.id) return failure(`Only ${leader.name} can decline the counter`);
        rtm.price = rtm.bid;
        log('DECLINED', `${leader.name} declines to raise and stands by ₹${rtm.bid} Cr.`);
        state.phase = 'RTM_MATCH';
        state.phaseTicks = 0;
        this._announce(`${leader.name} stands pat. ${original.name} can still match.`, 'RTM');
        return { ok: true };
      }
      case 'MATCH_RTM': {
        if (state.phase !== 'RTM_MATCH') return failure('The match decision is not open');
        if (actor !== original.id) return failure(`Only ${original.name} can match`);
        const check = validateHold(state, actor, player, rtm.price);
        if (!check.ok) return failure(check.error);
        log('MATCHED', `${original.name} matches ${rtm.price} crore and takes ${player.name}.`, { amount: rtm.price });
        this._awardRtm(player, original.id, rtm.price, 'RTM_MATCH');
        return { ok: true };
      }
      case 'PASS_RTM': {
        if (state.phase === 'RTM_OFFER') {
          if (actor !== original.id) return failure(`Only ${original.name} can pass on Right to Match`);
          log('PASSED', `${original.name} passes on the Right to Match for ${player.name}.`);
          this._awardRtm(player, leader.id, rtm.bid, 'RTM_PASS');
          return { ok: true };
        }
        if (state.phase === 'RTM_MATCH') {
          if (actor !== original.id) return failure(`Only ${original.name} can decline to match`);
          log('PASSED', `${original.name} does not match ${rtm.price} crore.`);
          this._awardRtm(player, leader.id, rtm.price, 'RTM_PASS');
          return { ok: true };
        }
        return failure('The match decision is not open');
      }
      default:
        return failure(`Unknown Right to Match decision: ${type}`);
    }
  }

  _awardRtm(player, winnerId, price, source) {
    const state = this.state;
    const previousBid = state.currentBid;
    state.bidHistory.push({
      id: uid('bid'),
      at: nowIso(),
      playerId: player.id,
      franchiseId: winnerId,
      amount: roundMoney(price),
      previousBid,
      source,
    });
    state.leaderId = winnerId;
    state.currentBid = roundMoney(price);
    this._refreshBiddingStatus();
    this._finaliseLot('SOLD', { winnerId, price, source });
  }

  _finaliseLot(outcome, sale = {}) {
    const state = this.state;
    const player = this._currentPlayer();
    if (!player) {
      this._advanceLot();
      return;
    }
    const stage = this._stage();
    const winnerId = sale.winnerId || state.leaderId;
    const price = roundMoney(sale.price ?? state.currentBid);
    const rules = rulesFor(state.season, state.format);
    let text;
    if ((outcome === 'SOLD' || sale.winnerId) && winnerId && price > 0) {
      const franchise = this._franchise(winnerId);
      const split = salarySplit(price, isOverseas(player), state.season);
      player.availability = 'SOLD';
      player.soldTo = winnerId;
      player.soldPrice = price;
      player.soldRound = sale.source || (stage?.kind === 'ACCELERATED' ? 'ACCELERATED' : 'MAIN');
      player.salary = split.salary;
      player.welfareContribution = split.welfare;
      player.auctionRoundBought = rules.format;
      player.purchasedInMini = rules.format === 'MINI';
      franchise.purse = roundMoney(franchise.purse - price);
      franchise.squad.push(player.id);
      franchise.purchases.push({
        playerId: player.id,
        price,
        salary: split.salary,
        welfare: split.welfare,
        round: player.soldRound,
        source: sale.source || 'AUCTION',
      });
      if (split.welfare > 0) {
        franchise.welfareContribution = roundMoney((Number(franchise.welfareContribution) || 0) + split.welfare);
        state.welfareFund = roundMoney((Number(state.welfareFund) || 0) + split.welfare);
      }
      if (isOverseas(player)) {
        franchise.overseasSalarySpend = roundMoney((Number(franchise.overseasSalarySpend) || 0) + split.salary);
      }
      text = `Sold to ${franchise.name} for ₹${price} Cr — ${player.name}.`;
      if (split.welfare > 0) text += ` ₹${split.welfare} Cr diverted to the BCCI welfare fund.`;
      this._pushEvent('SOLD', text, { playerId: player.id, franchiseId: winnerId, price, welfare: split.welfare });
      this._announce(`Sold to ${franchise.name} for ${price} crore${split.welfare > 0 ? `, with ${split.welfare} crore to the welfare fund` : ''}.`, 'SOLD');
    } else {
      player.availability = 'UNSOLD';
      player.soldTo = null;
      player.soldPrice = null;
      player.soldRound = null;
      text = `Unsold — ${player.name} goes back into the pool.`;
      this._pushEvent('UNSOLD', text, { playerId: player.id });
      this._announce(`Unsold. ${player.name} is available in the accelerated round.`, 'UNSOLD');
    }
    state.nominations = state.nominations.filter((id) => id !== player.id);
    state.rtm = null;
    state.phase = player.availability === 'SOLD' ? 'SOLD' : 'UNSOLD';
    state.resultTicks = 0;
    state.goingStage = 0;
    for (const franchise of state.franchises) franchise.biddingStatus = 'IDLE';
    recordDiscussion(state, state.userFranchiseId, 'RESULT', `Lot result: ${text}`);
  }

  _beginLot(player, stage) {
    const state = this.state;
    state.currentPlayerId = player.id;
    state.currentBid = 0;
    state.leaderId = null;
    state.activeBidderIds = [];
    state.withdrawnIds = [];
    state.bidsThisLot = 0;
    state.goingStage = 0;
    state.resultTicks = 0;
    state.aiWaitTicks = paceOf(state).aiReaction;
    state.phase = stage?.kind === 'ACCELERATED' ? 'ACCELERATED_AUCTION' : 'PLAYER_INTRODUCTION';
    if (!state.calledThisStage.includes(player.id)) state.calledThisStage.push(player.id);
    this._refreshBiddingStatus();
    this._pushEvent('PLAYER_INTRODUCTION', `${player.name}, ${player.role}, base price ₹${player.basePrice} Cr.`, { playerId: player.id });
    this._announce(`Up next: ${player.name}, ${player.role}, base price ${player.basePrice} crore.`, 'PLAYER_INTRODUCTION');
    recordDiscussion(state, state.userFranchiseId, 'INTRODUCTION', `${player.name} is on the block at ${player.basePrice} crore.`);
  }

  _advanceLot() {
    const state = this.state;
    const stage = this._stage();
    if (!stage || (stage.kind !== 'SET' && stage.kind !== 'ACCELERATED')) {
      this._advanceStage();
      return;
    }
    let cursor = Number(state.playerCursor) || 0;
    while (cursor < stage.playerIds.length) {
      const id = stage.playerIds[cursor];
      const player = state.players.find((candidate) => candidate.id === id);
      cursor += 1;
      if (!player || player.availability === 'SOLD') continue;
      if (stage.kind === 'ACCELERATED') {
        // Each accelerated stage gives every eligible player exactly one chance.
        if (state.calledThisStage.includes(id)) continue;
        // Unsold and nominated players are exactly what this stage re-auctions.
        if (player.availability === 'UNSOLD') player.availability = 'AVAILABLE';
      } else if (player.availability !== 'AVAILABLE') {
        // A player already called in this SET must not be re-opened.
        continue;
      }
      state.playerCursor = cursor - 1;
      this._beginLot(player, stage);
      return;
    }
    state.playerCursor = cursor;
    this._advanceStage();
  }

  _advanceStage() {
    const state = this.state;
    const current = this._stage();
    if (current) current.status = 'DONE';
    state.stageIndex += 1;
    state.playerCursor = 0;
    state.stageTicks = 0;
    state.goingStage = 0;
    state.resultTicks = 0;
    state.currentPlayerId = null;
    state.currentBid = 0;
    state.leaderId = null;
    state.activeBidderIds = [];
    state.withdrawnIds = [];
    state.bidsThisLot = 0;
    state.calledThisStage = [];
    this._refreshBiddingStatus();

    if (state.stageIndex >= state.proceedings.length) {
      this._finishAuction('The auction is complete.');
      return;
    }
    const stage = this._stage();
    this._pushEvent('STAGE_START', `Stage ${state.stageIndex + 1}: ${stage.title}`);
    this._announce(`Next: ${stage.title}.`, 'STAGE');
    this._activateStage(state.stageIndex);
  }

  _activateStage(index) {
    const state = this.state;
    const stage = state.proceedings[index];
    if (!stage) {
      this._finishAuction('The auction is complete.');
      return;
    }
    stage.status = 'ACTIVE';
    state.stageTicks = 0;
    state.playerCursor = 0;

    if (stage.kind === 'ANNOUNCEMENT') {
      state.phase = 'OPENING';
      this._announce(stage.title, 'ANNOUNCEMENT');
      this._pushEvent('ANNOUNCEMENT', stage.title);
      return;
    }
    if (stage.kind === 'SET') {
      if (!stage.playerIds.length) {
        this._advanceStage();
        return;
      }
      this._advanceLot();
      return;
    }
    if (stage.kind === 'BREAK') {
      state.phase = 'SET_BREAK';
      this._announce('Strategy break. No lots will be called until the break is resumed.', 'BREAK');
      this._pushEvent('BREAK', `${stage.title} started.`);
      recordDiscussion(state, state.userFranchiseId, 'BREAK', 'We are reviewing remaining role gaps during this break.');
      return;
    }
    if (stage.kind === 'ACCELERATED') {
      state.phase = 'ACCELERATED_AUCTION';
      state.calledThisStage = [];
      stage.playerIds = state.players
        .filter((player) => player.availability === 'UNSOLD'
          || player.category === 'ACCELERATED'
          || (state.nominations.includes(player.id) && player.availability !== 'SOLD'))
        .map((player) => player.id);
      this._pushEvent('ACCELERATED', `${stage.title}: ${stage.playerIds.length} players available.`);
      this._announce(`Accelerated auction — ${stage.playerIds.length} players available.`, 'ACCELERATED');
      if (!stage.playerIds.length) this._advanceStage();
      else this._advanceLot();
      return;
    }
    if (stage.kind === 'REVIEW') {
      state.phase = 'FINAL_REVIEW';
      state.result = computeResults(state);
      state.phase = 'COMPLETED';
      for (let i = index; i < state.proceedings.length; i += 1) state.proceedings[i].status = 'DONE';
      this._announce('Final review complete — the results are in.', 'RESULT');
      this._pushEvent('COMPLETED', 'Results computed and auction completed.');
    }
  }

  _finishAuction(reason) {
    const state = this.state;
    state.phase = 'COMPLETED';
    for (const stage of state.proceedings) stage.status = 'DONE';
    state.result = computeResults(state);
    this._announce(reason, 'RESULT');
    this._pushEvent('COMPLETED', reason);
  }
}

export { AuctionEngine as default };
