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
  RTM_OFFER: 'Right to Match · Offer',
  RTM_COUNTER: 'Right to Match · Counter',
  RTM_MATCH: 'Right to Match · Final Call',
  SOLD: 'Sold',
  UNSOLD: 'Unsold',
  SET_BREAK: 'Set Break',
  STRATEGY_BREAK: 'Strategy Break',
  ACCELERATED_AUCTION: 'Accelerated Auction',
  FINAL_REVIEW: 'Final Review',
  COMPLETED: 'Completed',
};

/** The live three-step Right to Match lot phase used in the 2025 Mega Auction. */
export const RTM_PHASES = ['RTM_OFFER', 'RTM_COUNTER', 'RTM_MATCH'];

/**
 * BCCI IPL Player Regulations 2025–2027. Mirrors backend/src/rules.js so the
 * setup screen can show the authoritative financial limits before CREATE.
 */
export const SEASON_OPTIONS = [
  {
    key: '2025',
    label: 'IPL 2025 · MEGA',
    format: 'MEGA',
    startingPurse: 120,
    totalSalaryCap: 146,
    overseasSalaryCap: 0,
    maxRetentions: 6,
    rtm: true,
    kicker: 'The full rebuild',
    rules: [
      '₹120 Cr purse within a ₹146 Cr total salary cap.',
      'Retain up to 6: at most 5 capped (₹18/14/11/18/14 Cr slabs) and 2 uncapped (₹4 Cr each).',
      'Every unused retention becomes a Right to Match card — 6 minus direct retentions.',
      'Two marquee sets, role-based sets, accelerated round and a final set.',
      'Squads of 18–25, maximum 8 overseas, 4 overseas in the Playing XI including the Impact Player.',
    ],
  },
  {
    key: '2026',
    label: 'IPL 2026 · MINI',
    format: 'MINI',
    startingPurse: 125,
    totalSalaryCap: 151,
    overseasSalaryCap: 18,
    maxRetentions: 25,
    rtm: false,
    kicker: 'Retain and refine',
    rules: [
      '₹125 Cr purse within a ₹151 Cr total salary cap.',
      'Retain any number of your own contracted players at their existing fees.',
      'No Right to Match and no marquee set in a Mini Auction.',
      'Overseas salary capped at ₹18 Cr — any excess bid is diverted to the BCCI welfare fund.',
      'Mini-auction signings cannot be traded after the auction.',
    ],
  },
  {
    key: '2027',
    label: 'IPL 2027 · MINI',
    format: 'MINI',
    startingPurse: 130,
    totalSalaryCap: 157,
    overseasSalaryCap: 18,
    maxRetentions: 25,
    rtm: false,
    kicker: 'The final mini',
    rules: [
      '₹130 Cr purse within a ₹157 Cr total salary cap.',
      'Retain any number of your own contracted players at their existing fees.',
      'No Right to Match and no marquee set in a Mini Auction.',
      'Overseas salary capped at ₹18 Cr — any excess bid is diverted to the BCCI welfare fund.',
      'Squads of 18–25, maximum 8 overseas, 4 overseas in the Playing XI including the Impact Player.',
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
  RTM_OFFER: { icon: '★', tone: 'rtm' },
  RTM_USED: { icon: '★', tone: 'rtm' },
  RTM_COUNTERED: { icon: '⇄', tone: 'rtm' },
  RTM_DECLINED: { icon: '⇄', tone: 'rtm' },
  RTM_MATCHED: { icon: '★', tone: 'rtm' },
  RTM_PASSED: { icon: '○', tone: 'rtm' },
  TRADE: { icon: '⇆', tone: 'trade' },
  INJURY: { icon: '⚑', tone: 'injury' },
  RAPP_REPLACEMENT: { icon: '✚', tone: 'injury' },
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

/** Approximate seconds left in the current auctioneer call. */
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
  if (!state) return 'Waiting for the auction room';
  switch (state.phase) {
    case 'SETUP':
      return 'Auction created — waiting for the start signal';
    case 'OPENING':
      return 'The auctioneer is opening the proceedings';
    case 'PLAYER_INTRODUCTION':
      return 'New lot on the podium — bidding opens shortly';
    case 'BIDDING':
      return 'Bidding is open. Franchises are considering their move';
    case 'GOING_ONCE':
      return 'Going once — any further bids?';
    case 'GOING_TWICE':
      return 'Going twice — final call';
    case 'RTM_OFFER':
      return 'Right to Match — the previous franchise may match the bid';
    case 'RTM_COUNTER':
      return 'The leading franchise may counter the Right to Match';
    case 'RTM_MATCH':
      return 'Final Right to Match call — match or let the player go';
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

/** BCCI capped/uncapped status. Missing data defaults to capped. */
export function isUncapped(player) {
  return player?.capped === false;
}

export function cappedLabel(player) {
  return isUncapped(player) ? 'Uncapped' : 'Capped';
}

export function seasonLabel(state) {
  return state?.rules?.label || state?.season || 'IPL 2025';
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
    rtmCards: mega ? Math.max(0, (Number(rules.maxRetentions) || 6) - entries.length) : 0,
    overLimit: entries.length > max,
    overCapped: mega && cappedCount > maxCapped,
    overUncapped: mega && uncappedCount > maxUncapped,
    valid: entries.length <= max && (!mega || (cappedCount <= maxCapped && uncappedCount <= maxUncapped)),
  };
}

/** Who must decide in the current Right to Match step, if anyone. */
export function rtmActor(state) {
  if (!state?.rtm || !RTM_PHASES.includes(state.phase)) return null;
  return state.phase === 'RTM_COUNTER' ? state.rtm.leaderFranchiseId : state.rtm.originalFranchiseId;
}

/** Human-facing actions for the current Right to Match step. */
export function rtmOptions(state) {
  switch (state?.phase) {
    case 'RTM_OFFER':
      return [
        { type: 'USE_RTM', label: 'Use Right to Match', primary: true },
        { type: 'PASS_RTM', label: 'Pass' },
      ];
    case 'RTM_COUNTER':
      return [
        { type: 'RTM_RAISE', label: 'Counter the bid', primary: true },
        { type: 'RTM_DECLINE', label: 'Stand pat' },
      ];
    case 'RTM_MATCH':
      return [
        { type: 'MATCH_RTM', label: 'Match the price', primary: true },
        { type: 'PASS_RTM', label: 'Let them have him' },
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
