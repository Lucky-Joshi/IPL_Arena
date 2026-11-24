/**
 * LCB franchise player regulations 2025–2027 season registry.
 *
 * Every financial and squad limit in the simulator is derived from one of
 * these three seasons. The rest of the backend reads from here rather than
 * hard-coding numbers, so the Mega/Mini cycle stays internally consistent.
 *
 * Money is in ₹ Crore. `overseasSalaryCap: 0` means "no cap" (Mega auctions).
 */

export const MATCH_FEE = 0.075; // ₹7.5 lakh per playing XI member, X-Factor Substitute included
export const PLAYING_XI = 11;
export const X_FACTOR = 1;
export const LEAGUE_MATCHES = 14;
export const MAX_CAPPED_RETENTIONS = 5;
export const MAX_UNCAPPED_RETENTIONS = 2;
export const MAX_RETENTIONS = 6; // overall retention + CLAW ceiling
export const MAX_DIRECT_RETENTIONS = 6; // CLAW cards = 6 - direct retentions
export const CAPPED_RETENTION_SLABS = Object.freeze([18, 14, 11, 18, 14]);
export const UNCAPPED_RETENTION_COST = 4;
export const BASE_PRICE_TIERS = Object.freeze([2, 1.5, 1, 0.5, 0.3]);

export const SEASONS = Object.freeze({
  2025: Object.freeze({
    key: '2025',
    label: 'T20 Dynasty 2025',
    format: 'MEGA',
    startingPurse: 120,
    totalSalaryCap: 146,
    overseasSalaryCap: 0, // no overseas salary ceiling in a Mega auction
    maxSquad: 25,
    minSquad: 18,
    maxOverseas: 8,
    maxRetentions: MAX_RETENTIONS,
    maxCappedRetentions: MAX_CAPPED_RETENTIONS,
    maxUncappedRetentions: MAX_UNCAPPED_RETENTIONS,
    cappedRetentionSlabs: CAPPED_RETENTION_SLABS,
    uncappedRetentionCost: UNCAPPED_RETENTION_COST,
    clawAvailable: true,
    marqueeSets: 2,
    matchFee: MATCH_FEE,
    playingXi: PLAYING_XI,
    xFactor: X_FACTOR,
    leagueMatches: LEAGUE_MATCHES,
    auctionNote: 'Mega auction · up to 6 retentions/CLAWs · two marquee sets',
  }),
  2026: Object.freeze({
    key: '2026',
    label: 'T20 Dynasty 2026',
    format: 'MINI',
    startingPurse: 125,
    totalSalaryCap: 151,
    overseasSalaryCap: 18,
    maxSquad: 25,
    minSquad: 18,
    maxOverseas: 8,
    maxRetentions: 25,
    maxCappedRetentions: 25,
    maxUncappedRetentions: 25,
    cappedRetentionSlabs: CAPPED_RETENTION_SLABS,
    uncappedRetentionCost: UNCAPPED_RETENTION_COST,
    clawAvailable: false,
    marqueeSets: 0,
    matchFee: MATCH_FEE,
    playingXi: PLAYING_XI,
    xFactor: X_FACTOR,
    leagueMatches: LEAGUE_MATCHES,
    auctionNote: 'Mini auction · retain at contract fee · ₹18 Cr overseas salary cap',
  }),
  2027: Object.freeze({
    key: '2027',
    label: 'T20 Dynasty 2027',
    format: 'MINI',
    startingPurse: 130,
    totalSalaryCap: 157,
    overseasSalaryCap: 18,
    maxSquad: 25,
    minSquad: 18,
    maxOverseas: 8,
    maxRetentions: 25,
    maxCappedRetentions: 25,
    maxUncappedRetentions: 25,
    cappedRetentionSlabs: CAPPED_RETENTION_SLABS,
    uncappedRetentionCost: UNCAPPED_RETENTION_COST,
    clawAvailable: false,
    marqueeSets: 0,
    matchFee: MATCH_FEE,
    playingXi: PLAYING_XI,
    xFactor: X_FACTOR,
    leagueMatches: LEAGUE_MATCHES,
    auctionNote: 'Mini auction · 18–25 squad · max 8 overseas · ₹18 Cr overseas cap',
  }),
});

export const SEASON_KEYS = Object.freeze(Object.keys(SEASONS));

/** Resolve a user-supplied season (or legacy format) to a season key. */
export function resolveSeason(value, format) {
  const key = String(value ?? '').trim();
  if (Object.hasOwn(SEASONS, key)) return key;
  if (key === '2025-27' || key === '2025-2027') return '2025';
  const fmt = String(format || '').toUpperCase();
  return fmt === 'MINI' ? '2026' : '2025';
}

export function rulesFor(value, format) {
  return SEASONS[resolveSeason(value, format)];
}

export function isMega(season) {
  return rulesFor(season).format === 'MEGA';
}

/** ₹0.3–2 Cr registration tiers, ascending with player rating. */
export function basePriceForRating(rating) {
  const value = Number(rating);
  if (!Number.isFinite(value)) return 0.3;
  if (value >= 92) return 2;
  if (value >= 85) return 1.5;
  if (value >= 76) return 1;
  if (value >= 62) return 0.5;
  return 0.3;
}

/** Projected match fees for a full playing XI plus X-Factor Substitute over the league stage. */
export function matchFeeProjection(season) {
  const rules = rulesFor(season);
  return roundMoney((rules.playingXi + rules.xFactor) * rules.leagueMatches * rules.matchFee);
}

/** Overseas salary above the cap is diverted to the LCB player welfare fund. */
export function salarySplit(price, isOverseasPlayer, season) {
  const rules = rulesFor(season);
  const bid = roundMoney(price);
  const cap = Number(rules.overseasSalaryCap) || 0;
  if (!isOverseasPlayer || cap <= 0 || bid <= cap) {
    return { bid, salary: bid, welfare: 0, capped: false };
  }
  return { bid, salary: cap, welfare: roundMoney(bid - cap), capped: true };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export default SEASONS;
