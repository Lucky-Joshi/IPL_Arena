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
  SOLD: 'Sold',
  UNSOLD: 'Unsold',
  SET_BREAK: 'Set Break',
  STRATEGY_BREAK: 'Strategy Break',
  ACCELERATED_AUCTION: 'Accelerated Auction',
  FINAL_REVIEW: 'Final Review',
  COMPLETED: 'Completed',
};

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

/** Rating-slab retention cost, mirroring backend/src/retention.js. */
export function retentionCost(player) {
  const rating = Number(player?.rating);
  if (!Number.isFinite(rating)) return 1;
  if (rating >= 90) return 5;
  if (rating >= 85) return 4;
  if (rating >= 80) return 3;
  if (rating >= 75) return 2;
  if (rating >= 70) return 1.5;
  return 1;
}

export function retentionLimit(state) {
  const configured = Number(state?.config?.maxRetentions);
  if (Number.isFinite(configured)) return configured;
  return state?.format === 'MINI' ? 15 : 3;
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
