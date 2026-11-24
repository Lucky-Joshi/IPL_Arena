export const ROLES = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];

export const ROLE_LABELS = {
  BATTER: 'Batter',
  BOWLER: 'Bowler',
  ALLROUNDER: 'All-rounder',
  WICKETKEEPER: 'Wicketkeeper',
};

export const ROLE_COLOURS = {
  BATTER: '#d4af37',
  BOWLER: '#55b7e8',
  ALLROUNDER: '#b07ce8',
  WICKETKEEPER: '#e8795a',
};

export const PHASE_LABELS = {
  SETUP: 'Setup',
  OPENING: 'Opening Ceremony',
  PLAYER_INTRODUCTION: 'Player Introduction',
  BIDDING: 'Bidding Live',
  GOING_ONCE: 'Going Once',
  GOING_TWICE: 'Going Twice',
  CLAW_OFFER: 'Franchise Clawback · Offer',
  CLAW_COUNTER: 'Franchise Clawback · Counter',
  CLAW_MATCH: 'Franchise Clawback · Final Call',
  SOLD: 'Sold',
  UNSOLD: 'Unsold',
  SET_BREAK: 'Set Break',
  STRATEGY_BREAK: 'Strategy Break',
  ACCELERATED_AUCTION: 'Accelerated Auction',
  FINAL_REVIEW: 'Final Review',
  COMPLETED: 'Completed',
};

/** The live three-step Franchise Clawback lot phase used in the 2025 Mega Auction. */
export const CLAW_PHASES = ['CLAW_OFFER', 'CLAW_COUNTER', 'CLAW_MATCH'];

/**
 * Fictional League Control Board (LCB) player regulations 2025–2027. Mirrors backend/src/rules.js so the
 * setup screen can show the authoritative financial limits before CREATE.
 */
export const SEASON_OPTIONS = [
  {
    key: '2025',
    label: 'T20 Dynasty 2025 · MEGA',
    format: 'MEGA',
    startingPurse: 120,
    totalSalaryCap: 146,
    overseasSalaryCap: 0,
    maxRetentions: 6,
    claw: true,
    kicker: 'The full rebuild',
    rules: [
      '₹120 Cr purse within a ₹146 Cr total salary cap.',
      'Retain up to 6: at most 5 capped (₹18/14/11/18/14 Cr slabs) and 2 uncapped (₹4 Cr each).',
      'Every unused retention becomes a Franchise Clawback card — 6 minus direct retentions.',
      'Two marquee sets, role-based sets, accelerated round and a final set.',
      'Squads of 18–25, maximum 8 overseas, 4 overseas in the Playing XI including the X-Factor Substitute.',
    ],
  },
  {
    key: '2026',
    label: 'T20 Dynasty 2026 · MINI',
    format: 'MINI',
    startingPurse: 125,
    totalSalaryCap: 151,
    overseasSalaryCap: 18,
    maxRetentions: 25,
    claw: false,
    kicker: 'Retain and refine',
    rules: [
      '₹125 Cr purse within a ₹151 Cr total salary cap.',
      'Retain any number of your own contracts at their existing fees, within the ₹18 Cr overseas salary ceiling.',
      'No Franchise Clawback and no marquee set in a Mini Auction.',
      'Overseas salary capped at ₹18 Cr — any excess bid is diverted to the LCB welfare fund.',
      'Mini-auction signings cannot be traded after the auction.',
    ],
  },
  {
    key: '2027',
    label: 'T20 Dynasty 2027 · MINI',
    format: 'MINI',
    startingPurse: 130,
    totalSalaryCap: 157,
    overseasSalaryCap: 18,
    maxRetentions: 25,
    claw: false,
    kicker: 'The final mini',
    rules: [
      '₹130 Cr purse within a ₹157 Cr total salary cap.',
      'Retain any number of your own contracts at their existing fees, within the ₹18 Cr overseas salary ceiling.',
      'No Franchise Clawback and no marquee set in a Mini Auction.',
      'Overseas salary capped at ₹18 Cr — any excess bid is diverted to the LCB welfare fund.',
      'Squads of 18–25, maximum 8 overseas, 4 overseas in the Playing XI including the X-Factor Substitute.',
    ],
  },
];

const CAPPED_RETENTION_SLABS = [18, 14, 11, 18, 14];
const UNCAPPED_RETENTION_COST = 4;

/** Mirrors backend/src/engine.js PACE_TICKS so the UI can show a real countdown. */
export const PACE_TICKS = {
  FAST: { intro: 1, bid: 1, goingOnce: 1, goingTwice: 1, result: 1, announcement: 2, aiReaction: 0 },
  BROADCAST: { intro: 5, bid: 5, goingOnce: 5, goingTwice: 4, result: 3, announcement: 5, aiReaction: 2 },
  CINEMATIC: { intro: 8, bid: 7, goingOnce: 7, goingTwice: 6, result: 4, announcement: 7, aiReaction: 3 },
};

export const BID_PHASES = ['BIDDING', 'GOING_ONCE', 'GOING_TWICE', 'ACCELERATED_AUCTION'];

export const STATUS_LABELS = {
  IDLE: 'Idle',
  ACTIVE: 'Active',
  LEADING: 'Leading',
  WITHDRAWN: 'Withdrawn',
  PENDING: 'Pending',
  DONE: 'Done',
};

const EVENT_STYLES = {
  BID: { icon: '↑', tone: 'bid' },
  SOLD: { icon: '✦', tone: 'sold' },
  UNSOLD: { icon: '×', tone: 'unsold' },
  WITHDRAW: { icon: '↩', tone: 'withdraw' },
  CLAW_OFFER: { icon: '★', tone: 'claw' },
  CLAW_USED: { icon: '★', tone: 'claw' },
  CLAW_COUNTERED: { icon: '⇄', tone: 'claw' },
  CLAW_DECLINED: { icon: '⇄', tone: 'claw' },
  CLAW_MATCHED: { icon: '★', tone: 'claw' },
  CLAW_PASSED: { icon: '○', tone: 'claw' },
  TRADE: { icon: '⇆', tone: 'trade' },
  TRADE_EXPIRED: { icon: '⌛', tone: 'trade' },
  TAMPERING: { icon: '⚖', tone: 'injury' },
  INJURY: { icon: '⚑', tone: 'injury' },
  RPP_REPLACEMENT: { icon: '✚', tone: 'injury' },
  WITHDRAWAL: { icon: '⊘', tone: 'injury' },
  BREAK: { icon: 'II', tone: 'break' },
  MEETING: { icon: '◎', tone: 'meeting' },
  COMMENT: { icon: '❝', tone: 'comment' },
  SET: { icon: '▤', tone: 'set' },
  AUCTION: { icon: '◆', tone: 'auction' },
  SYSTEM: { icon: '•', tone: 'system' },
};

export function cr(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '₹0 Cr';
  const rounded = Math.round(number * 100) / 100;
  return `₹${rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
}

export function amount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return String(Math.round(number * 100) / 100);
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || '').toLowerCase().replace(/(^|_)\w/g, (m) => m.toUpperCase());
}

export function roleColour(role) {
  return ROLE_COLOURS[role] || '#d4af37';
}

export function phaseLabel(phase) {
  return PHASE_LABELS[phase] || String(phase || '').replace(/_/g, ' ');
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '').replace(/_/g, ' ');
}

export function categoryLabel(category) {
  return String(category || '').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

export function strategyLabel(strategy) {
  return String(strategy || '').toLowerCase().replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

// ------------------------------------------------------------- LCB trading

export const TRADE_STATUS_LABELS = {
  PENDING_48H: 'EOI · 48h window',
  AWAITING_CONSENT: 'Awaiting consent',
  LCB_REVIEW: 'LCB review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  VETOED: 'Player veto',
};

export const TRADE_TYPE_LABELS = {
  ALL_CASH: 'All-cash',
  PLAYER_SWAP: 'Player swap',
  CASH_PLUS_PLAYER: 'Cash + player',
};

export const TRADE_APPROVAL_LABELS = {
  EOI_SUBMITTED: 'EOI submitted',
  AWAITING_PLAYER_CONSENT: 'Player consent pending',
  LCB_REVIEW: 'LCB vetting',
  LCB_APPROVED: 'LCB approved',
  LCB_REJECTED: 'LCB rejected',
  NOT_APPROVED: 'Not approved',
};

export function tradeStatusLabel(status) {
  return TRADE_STATUS_LABELS[status] || String(status || 'PROPOSED').replace(/_/g, ' ');
}

export function tradeTypeLabel(type) {
  return TRADE_TYPE_LABELS[type] || String(type || '').replace(/_/g, ' ');
}

export function tradeApprovalLabel(approval) {
  return TRADE_APPROVAL_LABELS[approval] || String(approval || '').replace(/_/g, ' ');
}

/**
 * Mirrors backend activeTradeWindow(): the open window is derived from the
 * season phase, never from a client-supplied value. Every season trades its
 * previous contracts in SETUP, before retentions are finalized; the live
 * auction floor is always closed to trading.
 */
export function activeTradeWindow(state) {
  if (!state) return null;
  if (state.phase === 'SETUP') return 'POST_SEASON';
  if (state.phase === 'COMPLETED' || state.phase === 'FINAL_REVIEW') return 'POST_AUCTION';
  return null;
}

export function tradeWindowInfo(state) {
  const window = activeTradeWindow(state);
  if (window === 'POST_SEASON') {
    return {
      open: true,
      window,
      label: 'Post-season window open',
      detail: 'Trades close one week before the auction. Previous-season contracts move at their exact league fee, before retentions are set.',
    };
  }
  if (window === 'POST_AUCTION') {
    return {
      open: true,
      window,
      label: 'Post-auction window open',
      detail: 'Closes 30 days before the tournament. Mini-auction signings are frozen until they have played a season.',
    };
  }
  return {
    open: false,
    window: null,
    label: 'Trade window closed',
    detail: 'The League Control Board only accepts EOIs in the post-season and post-auction windows, outside the live auction.',
  };
}

/** Fixed league fee of a contracted player (salary is never renegotiated). */
export function tradeSalary(state, playerId) {
  const player = playerById(state, playerId);
  if (!player) return 0;
  if (Number(player.salary) > 0) return Number(player.salary);
  if (Number(player.soldPrice) > 0) return Number(player.soldPrice);
  return Number(player.contractFee) || 0;
}

/** UI mirror of the backend eligibility check, used to grey-out options. */
export function tradeBlockReason(state, franchise, player, window) {
  if (!player) return 'Unknown player';
  const previous = state?.phase === 'SETUP'
    && player.retentionCandidate === true
    && player.previousFranchiseId === franchise?.id
    && (franchise?.previousSquad || []).includes(player.id)
    && player.availability === 'AVAILABLE'
    && !player.retained
    && !player.soldTo;
  if (!previous) {
    if (!(franchise?.squad || []).includes(player.id)) return 'Not in this squad';
    if (player.availability !== 'SOLD') return 'Not under an active contract';
  }
  if (player.consentWithheld) return 'Consent withheld';
  const banThrough = Number(player.banUntilSeason);
  if (Number.isFinite(banThrough) && banThrough >= Number(state?.season)) return 'Serving an LCB ban';
  if (window === 'POST_AUCTION' && player.purchasedInMini === true) return 'Mini-auction signing — frozen';
  return null;
}

/**
 * Mirrors backend computeDeal(): classify the deal and derive the exact cash
 * movement from the fixed league fees. Positive cashAdjustment = proposer pays.
 */
export function computeTradeDeal(state, giveIds = [], getIds = []) {
  const round = (value) => Math.round(value * 100) / 100;
  const valueGiven = round(giveIds.reduce((sum, id) => sum + tradeSalary(state, id), 0));
  const valueGot = round(getIds.reduce((sum, id) => sum + tradeSalary(state, id), 0));
  if (!giveIds.length && getIds.length) return { valueGiven, valueGot, type: 'ALL_CASH', cashAdjustment: valueGot };
  if (giveIds.length && !getIds.length) return { valueGiven, valueGot, type: 'ALL_CASH', cashAdjustment: -valueGiven };
  const cashAdjustment = round(valueGot - valueGiven);
  return { valueGiven, valueGot, type: cashAdjustment === 0 ? 'PLAYER_SWAP' : 'CASH_PLUS_PLAYER', cashAdjustment };
}

/** Human-readable countdown to an ISO deadline. */
export function deadlineLabel(iso) {
  if (!iso) return '';
  const remaining = Date.parse(iso) - Date.now();
  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return 'deadline lapsed';
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}m ${seconds}s left`;
}

export function isOverseas(player) {
  return Boolean(player && player.nationality && player.nationality !== 'India');
}

export function playerById(state, id) {
  if (!id || !state?.players) return null;
  return state.players.find((player) => player.id === id) || null;
}

export function franchiseById(state, id) {
  if (!id || !state?.franchises) return null;
  return state.franchises.find((franchise) => franchise.id === id) || null;
}

export function currentStage(state) {
  if (!state?.proceedings?.length) return null;
  return state.proceedings[state.stageIndex] || null;
}

export function nextIncrement(currentBid) {
  const bid = Number(currentBid) || 0;
  if (bid < 2) return 0.25;
  if (bid <= 10) return 0.5;
  return 1;
}

export function projectedBid(state) {
  const player = playerById(state, state?.currentPlayerId);
  if (!player) return 0;
  const bid = Number(state?.currentBid) || 0;
  const next = Math.round((bid + nextIncrement(bid)) * 100) / 100;
  return bid === 0 ? Number(player.basePrice) || 0 : next;
}

export function paceOf(state) {
  const name = String(state?.config?.pace || 'BROADCAST').toUpperCase();
  return PACE_TICKS[name] || PACE_TICKS.BROADCAST;
}

export function phaseDwellTicks(state, phase = state?.phase) {
  const pace = paceOf(state);
  if (phase === 'PLAYER_INTRODUCTION' || phase === 'ACCELERATED_AUCTION') return pace.intro;
  if (phase === 'BIDDING') return pace.bid;
  if (phase === 'GOING_ONCE') return pace.goingOnce;
  if (phase === 'GOING_TWICE') return pace.goingTwice;
  if (phase === 'SOLD' || phase === 'UNSOLD') return pace.result;
  if (phase === 'OPENING' || currentStage(state)?.kind === 'ANNOUNCEMENT') return pace.announcement;
  return 0;
}

/** Approximate seconds left in the current lead auctioneer call. */
export function phaseSecondsRemaining(state) {
  const dwell = phaseDwellTicks(state);
  if (!dwell || !state?.clockRunning) return 0;
  const tickMs = Math.max(100, Number(state?.config?.tickMs) || 1000);
  const used = Math.max(0, Number(state?.phaseTicks) || 0);
  return Math.max(0, ((dwell - used) * tickMs) / 1000);
}

export function countdownLabel(state) {
  if (!state?.clockRunning) return 'Clock paused';
  const seconds = phaseSecondsRemaining(state);
  if (!seconds) return '';
  if (state.phase === 'GOING_TWICE') return `Final call · ${seconds.toFixed(0)}s`;
  if (BID_PHASES.includes(state.phase)) return `Bidding closes in ~${seconds.toFixed(0)}s`;
  if (state.phase === 'PLAYER_INTRODUCTION' || state.phase === 'ACCELERATED_AUCTION') {
    return `Lot opens in ~${seconds.toFixed(0)}s`;
  }
  return `${seconds.toFixed(0)}s remaining`;
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function eventStyle(type) {
  return EVENT_STYLES[type] || EVENT_STYLES.SYSTEM;
}

export function phaseStatus(state) {
  if (!state) return 'Waiting for the auction hall';
  switch (state.phase) {
    case 'SETUP':
      return 'Auction created — waiting for the start signal';
    case 'OPENING':
      return 'The lead auctioneer is opening the proceedings';
    case 'PLAYER_INTRODUCTION':
      return 'New lot on the podium — bidding opens shortly';
    case 'BIDDING':
      return 'Bidding is open. Franchises are considering their move';
    case 'GOING_ONCE':
      return 'Going once — any further bids?';
    case 'GOING_TWICE':
      return 'Going twice — final call';
    case 'CLAW_OFFER':
      return 'Franchise Clawback — the previous franchise may match the bid';
    case 'CLAW_COUNTER':
      return 'The leading franchise may counter the Franchise Clawback';
    case 'CLAW_MATCH':
      return 'Final Franchise Clawback call — match or let the player go';
    case 'SOLD':
      return 'Hammer down. The player has a new home';
    case 'UNSOLD':
      return 'No bidder — the player goes unsold';
    case 'SET_BREAK':
    case 'STRATEGY_BREAK':
      return 'The room is paused for strategy';
    case 'ACCELERATED_AUCTION':
      return 'Accelerated round — quick decisions';
    case 'FINAL_REVIEW':
      return 'Final verification of squads and purses';
    case 'COMPLETED':
      return 'Auction complete — the full report is ready';
    default:
      return phaseLabel(state.phase);
  }
}

/** Number of auction additions a franchise may still make, after retentions. */
export function squadLimit(state, franchise) {
  if (Number.isFinite(Number(franchise?.additionsLimit))) return Number(franchise.additionsLimit);
  if (state?.format === 'MINI') return Number(state?.config?.maxAdditions) || 6;
  return Number(state?.config?.maxSquad) || 25;
}

/** Fictional capped/uncapped status. Missing data defaults to capped. */
export function isUncapped(player) {
  return player?.capped === false;
}

export function cappedLabel(player) {
  return isUncapped(player) ? 'Uncapped' : 'Capped';
}

export function seasonLabel(state) {
  return state?.rules?.label || state?.season || 'T20 Dynasty 2025';
}

export function seasonOption(stateOrKey) {
  const key = typeof stateOrKey === 'string' ? stateOrKey : stateOrKey?.season || '2025';
  return SEASON_OPTIONS.find((option) => option.key === key) || SEASON_OPTIONS[0];
}

export function retentionLimit(state) {
  const configured = Number(state?.config?.maxRetentions);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return seasonOption(state).maxRetentions;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Cost of a single retention, mirroring backend/src/retention.js.
 * Mini Auctions pay the existing contract fee; Mega Auctions use the capped
 * slabs in selection order, with uncapped players fixed at ₹4 Cr.
 */
export function retentionCost(player, options = {}) {
  const season = options.season || player?.season || options.state?.season || '2025';
  const format = options.format || options.state?.format || seasonOption(season).format;
  if (format === 'MINI') return round2(player?.contractFee ?? 0.3);
  if (isUncapped(player)) return UNCAPPED_RETENTION_COST;
  const index = Math.max(0, Math.min(CAPPED_RETENTION_SLABS.length - 1, Number(options.cappedIndex) || 0));
  return CAPPED_RETENTION_SLABS[index];
}

/** Cost and legality of an ordered retention selection. Pure UI mirror. */
export function retentionPlan(state, playerIds = []) {
  const players = state?.players || [];
  const entries = [];
  let cappedCount = 0;
  let uncappedCount = 0;
  let total = 0;

  for (const id of playerIds) {
    const player = players.find((candidate) => candidate.id === id);
    if (!player) continue;
    const capped = !isUncapped(player);
    if (capped) cappedCount += 1;
    else uncappedCount += 1;
    const cost = retentionCost(player, {
      season: state?.season,
      state,
      cappedIndex: cappedCount - 1,
      uncappedIndex: uncappedCount - 1,
    });
    total += cost;
    entries.push({ playerId: id, player, cost, capped });
  }

  const max = retentionLimit(state);
  const rules = state?.rules || seasonOption(state);
  const maxCapped = Number(rules.maxCappedRetentions) || 5;
  const maxUncapped = Number(rules.maxUncappedRetentions) || 2;
  const mega = (rules.format || seasonOption(state).format) === 'MEGA';

  return {
    entries,
    total: round2(total),
    cappedCount,
    uncappedCount,
    clawCards: mega ? Math.max(0, (Number(rules.maxRetentions) || 6) - entries.length) : 0,
    overLimit: entries.length > max,
    overCapped: mega && cappedCount > maxCapped,
    overUncapped: mega && uncappedCount > maxUncapped,
    valid: entries.length <= max && (!mega || (cappedCount <= maxCapped && uncappedCount <= maxUncapped)),
  };
}

/** Who must decide in the current Franchise Clawback step, if anyone. */
export function clawActor(state) {
  if (!state?.claw || !CLAW_PHASES.includes(state.phase)) return null;
  return state.phase === 'CLAW_COUNTER' ? state.claw.leaderFranchiseId : state.claw.originalFranchiseId;
}

/** Human-facing actions for the current Franchise Clawback step. */
export function clawOptions(state) {
  switch (state?.phase) {
    case 'CLAW_OFFER':
      return [
        { type: 'USE_CLAW', label: 'Use Franchise Clawback', primary: true },
        { type: 'PASS_CLAW', label: 'Pass' },
      ];
    case 'CLAW_COUNTER':
      return [
        { type: 'CLAW_RAISE', label: 'Counter the bid', primary: true },
        { type: 'CLAW_DECLINE', label: 'Stand pat' },
      ];
    case 'CLAW_MATCH':
      return [
        { type: 'MATCH_CLAW', label: 'Match the price', primary: true },
        { type: 'PASS_CLAW', label: 'Let them have him' },
      ];
    default:
      return [];
  }
}

export function overseasCount(state, franchise) {
  if (!franchise) return 0;
  return (franchise.squad || []).filter((id) => isOverseas(playerById(state, id))).length;
}

export function roleCounts(state, franchise) {
  const counts = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
  for (const id of franchise?.squad || []) {
    const player = playerById(state, id);
    if (player && counts[player.role] !== undefined) counts[player.role] += 1;
  }
  return counts;
}
