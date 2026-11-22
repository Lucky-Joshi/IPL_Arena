// Contextual war-room chatter. Every line is built from the authoritative public state.
const ROLES = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];
const MAX_ITEMS = 60;

const VOICES = [
  { key: 'owner', author: 'Owner', tone: 'assertive' },
  { key: 'headCoach', author: 'Head Coach', tone: 'practical' },
  { key: 'directorCricket', author: 'Director of Cricket', tone: 'strategic' },
  { key: 'strategist', author: 'Strategist', tone: 'calculating' },
  { key: 'analyst', author: 'Analyst', tone: 'analytical' },
  { key: 'scoutingHead', author: 'Scouting Head', tone: 'observant' },
];

const roleLabel = (role) => String(role || 'BATTER').toLowerCase().replace(/_/g, ' ');
const money = (value) => `${Number.isFinite(Number(value)) ? Number(value) : 0}cr`;
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function cap(list) {
  if (!Array.isArray(list)) return [];
  return list.length > MAX_ITEMS ? list.slice(-MAX_ITEMS) : list;
}

function playerMap(state) {
  const map = new Map();
  for (const player of state?.players || []) if (player?.id) map.set(player.id, player);
  return map;
}

function squadPlayers(state, franchise) {
  const map = playerMap(state);
  const ids = [...(franchise?.existing || []), ...(franchise?.squad || [])];
  const seen = new Set();
  const result = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const player = map.get(id);
    if (player) result.push(player);
  }
  return result;
}

function countsFor(players) {
  const counts = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
  for (const player of players) if (counts[player.role] !== undefined) counts[player.role] += 1;
  return counts;
}

function overseasCount(state, franchise, players) {
  if (Number.isFinite(franchise?.overseasCount)) return franchise.overseasCount;
  return players.filter((p) => p.nationality && p.nationality !== 'India').length;
}

function poolByRole(state) {
  const pool = { BATTER: 0, BOWLER: 0, ALLROUNDER: 0, WICKETKEEPER: 0 };
  const accelerated = state?.phase === 'ACCELERATED_AUCTION' || state?.phase === 'FINAL_REVIEW';
  for (const player of state?.players || []) {
    const open = player.availability === 'AVAILABLE' || (accelerated && player.availability === 'UNSOLD');
    if (open && pool[player.role] !== undefined) pool[player.role] += 1;
  }
  return pool;
}

function missingRoles(counts) {
  const missing = ROLES.filter((role) => counts[role] === 0);
  if (missing.length) return missing;
  return [...ROLES].sort((a, b) => counts[a] - counts[b]).slice(0, 1);
}

function pickVoice(state, franchiseId, offset, preferred) {
  if (preferred) {
    const voice = VOICES.find((v) => v.key === preferred);
    if (voice) return voice;
  }
  let hash = 0;
  const key = `${franchiseId || ''}:${state?.id || ''}:${offset}`;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return VOICES[hash % VOICES.length];
}

function contextFor(state, franchise) {
  const players = squadPlayers(state, franchise);
  const counts = countsFor(players);
  const pool = poolByRole(state);
  const current = playerMap(state).get(state?.currentPlayerId);
  const targets = Array.isArray(franchise?.targets) ? franchise.targets : [];
  const config = state?.config || {};
  const maxAdditions = Number.isFinite(Number(franchise?.additionsLimit))
    ? Number(franchise.additionsLimit)
    : Number(config.maxAdditions) || 0;
  const additionsUsed = Array.isArray(franchise?.purchases) ? franchise.purchases.length : 0;
  return {
    players,
    counts,
    pool,
    current,
    targets,
    missing: missingRoles(counts),
    overseas: overseasCount(state, franchise, players),
    purse: Number(franchise?.purse) || 0,
    squadSize: players.length,
    maxSquad: Number(config.maxSquad) || 25,
    maxOverseas: Number(config.maxOverseas) || 8,
    maxAdditions,
    additionsUsed,
    bid: Number(state?.currentBid) || 0,
    leader: state?.leaderId,
    bidsThisLot: Number(state?.bidsThisLot) || 0,
    phase: state?.phase || 'SETUP',
  };
}

function linesForTrigger(trigger, franchise, ctx) {
  const label = franchise?.short || franchise?.name || 'We';
  const gap = ctx.missing.map(roleLabel).join(' and ');
  const poolGap = [...ROLES].sort((a, b) => ctx.pool[a] - ctx.pool[b])[0];
  const base = `${label} have ${ctx.squadSize} in the squad with ${money(ctx.purse)} left`;

  const lines = [];
  switch (trigger) {
    case 'MEETING':
      lines.push(`${base}; our open slot is ${gap}. ${ctx.targets.length ? `We have marked ${ctx.targets.map(roleLabel).join(', ')} as priority.` : 'We are keeping the targets flexible today.'}`);
      lines.push(`The board wants value from this pool: only ${ctx.pool[poolGap]} ${roleLabel(poolGap)}s remain, so waiting too long has a cost.`);
      lines.push(`${ctx.overseas}/${ctx.maxOverseas} overseas slots used — we can still add ${Math.max(0, ctx.maxOverseas - ctx.overseas)} overseas players without losing balance.`);
      break;
    case 'INTRODUCTION': {
      const p = ctx.current;
      if (!p) return [`${base}; we are ready for the next name on the list.`];
      const fits = ctx.targets.includes(p.role) || ctx.counts[p.role] === 0;
      lines.push(`${p.name} is a ${p.rating}-rated ${roleLabel(p.role)} from ${p.nationality}; ${fits ? 'that is exactly the profile we came for' : `we already have ${ctx.counts[p.role]} at that role`}.`);
      lines.push(`${base}; a base price of ${money(p.basePrice)} leaves room to compete if the price stays sensible.`);
      break;
    }
    case 'RESULT': {
      const p = ctx.current;
      const sold = p?.availability === 'SOLD';
      const won = p?.soldTo === franchise?.id;
      if (!p) return [`${base}; the result is logged and we move on to the next name.`];
      lines.push(won
        ? `${p.name} is ours at ${money(p.soldPrice)} — that fills a need without breaking the ${money(ctx.purse)} budget.`
        : `${p.name} went ${sold ? `to ${p.soldTo} at ${money(p.soldPrice)}` : 'unsold'}; we stay with ${money(ctx.purse)} and keep our ${gap} search alive.`);
      lines.push(`Squad is now ${ctx.squadSize}/${ctx.maxSquad}, overseas ${ctx.overseas}/${ctx.maxOverseas}, with ${ctx.pool[poolGap]} ${roleLabel(poolGap)}s still in the pool.`);
      break;
    }
    case 'BID': {
      const p = ctx.current;
      lines.push(p
        ? `${p.name} is at ${money(ctx.bid)} with ${ctx.bidsThisLot} bids in; ${ctx.leader === franchise?.id ? 'we are leading and will not bid against ourselves' : `${ctx.leader || 'nobody'} leads and we still have ${money(ctx.purse)}`}.`
        : `${base}; we are watching the price before committing.`);
      lines.push(`Only ${ctx.pool[poolGap]} ${roleLabel(poolGap)}s remain in the pool, so we will not overpay for cover at ${money(ctx.bid)}.`);
      break;
    }
    case 'AI': {
      const p = ctx.current;
      lines.push(p
        ? `Public read on ${p.name}: ${p.rating} rating, ${roleLabel(p.role)}, base ${money(p.basePrice)}; current bid ${money(ctx.bid)}.`
        : `No live lot — we are resetting our model around ${money(ctx.purse)} of remaining purse.`);
      lines.push(`Our squad need remains ${gap}; overseas is ${ctx.overseas}/${ctx.maxOverseas} and the pool still has ${ctx.pool[poolGap]} ${roleLabel(poolGap)}s.`);
      break;
    }
    default:
      lines.push(`${base}; ${gap} remains the priority with ${ctx.pool[poolGap]} ${roleLabel(poolGap)}s left in the pool.`);
  }
  return lines;
}

/** Public-safe single-line comment for an AI decision (no privateReason, no ceilings). */
export function publicDecisionComment(decision, franchiseId = '') {
  const action = String(decision?.action || 'PASS').toUpperCase();
  const amount = Number(decision?.amount) || 0;
  const comment = oneLine(decision?.publicComment);
  const prefix = franchiseId ? `${franchiseId}: ` : '';
  if (action === 'BID') return `${prefix}${comment || `We are in at ${money(amount)} for this player.`}`;
  if (action === 'WITHDRAW') return `${prefix}${comment || 'We are stepping back from this bid.'}`;
  return `${prefix}${comment || 'We are passing on this lot.'}`;
}

export const publicAiComment = publicDecisionComment;

/** Add real, state-derived management-room discussion to a franchise and the global feed. */
export function addContextualDiscussion(state, franchiseId, trigger = 'MEETING') {
  if (!state || !Array.isArray(state.franchises)) return;
  const franchise = state.franchises.find((f) => f?.id === franchiseId);
  if (!franchise) return;

  const ctx = contextFor(state, franchise);
  const lines = linesForTrigger(trigger, franchise, ctx);
  const at = new Date().toISOString();
  const isAi = franchiseId !== state.userFranchiseId;
  if (!Array.isArray(franchise.discussions)) franchise.discussions = [];
  if (!Array.isArray(state.conversations)) state.conversations = [];

  lines.forEach((text, index) => {
    const voice = pickVoice(state, franchiseId, index, isAi ? (index === 1 ? 'analyst' : 'directorCricket') : undefined);
    const entry = { at, author: voice.author, text: oneLine(text), tone: voice.tone };
    franchise.discussions.push(entry);
    state.conversations.push({ ...entry, id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, franchiseId });
  });

  franchise.discussions = cap(franchise.discussions);
  state.conversations = cap(state.conversations);
  return franchise.discussions;
}

export default addContextualDiscussion;
