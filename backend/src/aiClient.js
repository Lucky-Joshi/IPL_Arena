// AI service client. Never leaks privateReason to the engine or UI.
const DECIDES_PATH = '/decide';
const TIMEOUT_MS = 2500;
const ACTIONS = new Set(['BID', 'PASS', 'WITHDRAW']);

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hashString(value) {
  let h = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** Collapse any service text into one short, public-safe line. */
function sanitisePublicComment(value, decision, ctx) {
  let text = typeof value === 'string' ? value : '';
  const secret = typeof decision?.privateReason === 'string' ? decision.privateReason : '';
  if (secret) text = text.split(secret).join('');
  text = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(privateReason|ceiling|max bid|valuation)\b[^\s,.;:]{0,24}/gi, '')
    .trim();
  if (!text) {
    const player = ctx?.player || {};
    const role = String(player.role || 'player').toLowerCase();
    text = decision?.action === 'BID'
      ? `We are interested in this ${role} at the current price.`
      : decision?.action === 'WITHDRAW'
        ? 'We step back here and keep the purse for the remaining slots.'
        : 'We pass on this one and back our remaining options.';
  }
  if (text.length > 160) text = `${text.slice(0, 157).trimEnd()}...`;
  return text;
}

/** Public context only — uses the same facts the AI service receives. */
export function fallbackDecide(ctx = {}) {
  const self = ctx.self || {};
  const player = ctx.player || {};
  const auction = ctx.auction || {};
  const config = ctx.config || {};
  const nextBid = num(auction.nextBid, num(player.basePrice, 1));
  const leaderId = auction.leaderId || null;
  const id = String(self.id || 'F1');
  const role = String(player.role || 'BATTER');
  const rating = num(player.rating, 50);
  const isOverseas = player.nationality && player.nationality !== 'India';
  const squad = Array.isArray(self.squad) ? self.squad : [];
  const targets = Array.isArray(self.targets) ? self.targets : [];
  const strategy = String(self.strategy || 'BALANCED');

  const maxSquad = num(config.maxSquad, 25);
  const maxAdditions = num(config.maxAdditions, 6);
  const additionsUsed = num(self.additionsUsed, 0);
  const maxOverseas = num(config.maxOverseas, 8);
  const overseasCount = num(self.overseasCount, 0);
  const reserve = num(config.minReservePerSlot, 0.2);
  const purse = num(self.purse, 0);
  const available = auction.availableByRole || {};
  const alternatives = num(available[role], 10);

  // Public constraints first: the local fallback must never ask for an illegal bid.
  const squadFull = squad.length >= maxSquad || (maxAdditions > 0 && additionsUsed >= maxAdditions);
  const overseasFull = isOverseas && overseasCount >= maxOverseas;
  const reserveNeeded = Math.max(0, maxSquad - squad.length) * reserve;
  const affordable = nextBid > 0 && nextBid <= purse && purse - nextBid >= Math.min(reserveNeeded, reserve);

  let desire = 0.42 + (rating - 50) / 180; // 0.25..0.7 from quality alone
  const sameRole = squad.filter((p) => p && p.role === role).length;
  desire += sameRole === 0 ? 0.18 : sameRole === 1 ? 0.08 : -0.05 * (sameRole - 1);
  if (targets.includes(role)) desire += 0.1;
  if (alternatives <= 4) desire += 0.1;
  else if (alternatives >= 18) desire -= 0.05;
  if (isOverseas && overseasCount < maxOverseas - 2) desire += 0.03;
  if (strategy === 'AGGRESSIVE') desire += 0.1;
  if (strategy === 'VALUE') desire -= 0.05;
  if (strategy === 'CONSERVATIVE') desire -= 0.03;
  const bidCount = num(auction.bidsThisLot, 0);
  if (bidCount >= 4) desire -= 0.05 * (bidCount - 3);
  // Stable per-franchise jitter makes different franchises evaluate the same lot differently.
  desire += (hashString(`${id}:${player.id || ''}:${rating}`) - 0.5) * 0.28;

  const ceiling = clamp(purse - reserveNeeded, 0, 1000);
  const canStretch = nextBid <= ceiling || nextBid <= num(player.basePrice, 1) + 0.5;
  const wants = desire >= 0.5;

  if (self.withdrawn || squadFull || overseasFull || !affordable || !canStretch || !wants) {
    const action = (self.withdrawn || (bidCount > 0 && (!affordable || !canStretch)))
      ? 'WITHDRAW'
      : 'PASS';
    return {
      action,
      amount: action === 'BID' ? nextBid : 0,
      confidence: clamp(1 - desire, 0.1, 0.95),
      publicComment: action === 'WITHDRAW'
        ? 'We are stepping back — the price no longer fits the squad plan.'
        : 'We will let this one go and keep our options open for the remaining slots.',
    };
  }

  if (leaderId === id) {
    return {
      action: 'PASS',
      amount: 0,
      confidence: 0.8,
      publicComment: 'We are happy leading at this stage.',
    };
  }

  const confidence = clamp(desire, 0.35, 0.95);
  const roleText = role.toLowerCase().replace('_', ' ');
  const comment = rating >= 80
    ? `A quality ${roleText} — we are comfortable going to ${nextBid}cr.`
    : sameRole === 0
      ? `We need coverage in the ${roleText} slot, so we are in at ${nextBid}cr.`
      : `At ${nextBid}cr this fits our squad balance, so we will bid.`;
  return { action: 'BID', amount: nextBid, confidence, publicComment: comment };
}

function normaliseDecision(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI response is not an object');
  }
  const action = String(raw.action || '').toUpperCase();
  if (!ACTIONS.has(action)) throw new Error(`AI returned invalid action: ${raw.action}`);
  const nextBid = num(ctx?.auction?.nextBid, num(ctx?.player?.basePrice, 1));
  let amount = num(raw.amount, nextBid);
  // The engine requires exact increments; never return a number above the published next bid.
  amount = action === 'BID' ? nextBid : clamp(amount, 0, nextBid);
  const confidence = clamp(num(raw.confidence, 0.5), 0, 1);
  return {
    action,
    amount,
    confidence,
    publicComment: sanitisePublicComment(raw.publicComment, raw, ctx),
  };
}

export function createAiClient({ url } = {}) {
  const base = String(url || process.env.AI_URL || 'http://localhost:5000').replace(/\/+$/, '');

  return {
    async decide(ctx) {
      try {
        const response = await fetch(`${base}${DECIDES_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ctx || {}),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
        const raw = await response.json();
        return normaliseDecision(raw, ctx);
      } catch (error) {
        process.stderr.write(`[ai-client] ${error?.message || error}; using local fallback\n`);
        return fallbackDecide(ctx);
      }
    },
  };
}

export default createAiClient;
