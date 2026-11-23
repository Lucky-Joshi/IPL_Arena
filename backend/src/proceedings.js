/**
 * Auction running order for the BCCI 2025–27 cycle.
 *
 * MEGA opens with two marquee sets, then capped players by role, then the
 * uncapped pool. MINI has no marquee set: it starts directly with capped
 * players grouped by specialisation. Both finish with an accelerated round,
 * a final-opportunities round (MEGA) and verification.
 *
 * SET stages receive the matching players in generation order; ACCELERATED
 * stages are filled by the engine when they become active.
 */

import { generatePlayers } from './players.js';
import { resolveSeason } from './rules.js';

export const STAGE_TITLES = {
  'opening-ceremony': 'Opening Ceremony',
  'auctioneer-welcome': 'Lead Auctioneer Welcome',
  'franchise-introductions': 'Franchise Introductions',
  'rules-briefing': 'Rules Briefing',
  'marquee-set-1': 'Marquee Set 1 · Capped Headliners',
  'marquee-set-2': 'Marquee Set 2 · Remaining Stars',
  'capped-batter-set': 'Capped Batters',
  'capped-allrounder-set': 'Capped All-rounders',
  'capped-wicketkeeper-set': 'Capped Wicketkeepers',
  'capped-bowler-set': 'Capped Fast Bowlers & Spinners',
  'uncapped-set': 'Uncapped Players',
  'strategy-break': 'Strategy Break',
  'accelerated-auction': 'Accelerated Auction · Shortlists',
  'final-opportunities': 'Final Opportunities · Unsold Recall',
  'unsold-review': 'Unsold Review',
  'verification': 'Verification & Results',
  'closing-ceremony': 'Closing Ceremony',
  'existing-squad-analysis': 'Existing Squad Analysis',
  'mini-welcome': 'Mini Auction Welcome',
  'mini-rules': 'Mini Auction Rules',
};

const MEGA_STAGES = [
  ['opening-ceremony', 'ANNOUNCEMENT'],
  ['auctioneer-welcome', 'ANNOUNCEMENT'],
  ['franchise-introductions', 'ANNOUNCEMENT'],
  ['rules-briefing', 'ANNOUNCEMENT'],
  ['marquee-set-1', 'SET', 'MARQUEE_1'],
  ['marquee-set-2', 'SET', 'MARQUEE_2'],
  ['capped-batter-set', 'SET', 'BATTER'],
  ['capped-allrounder-set', 'SET', 'ALLROUNDER'],
  ['capped-wicketkeeper-set', 'SET', 'WICKETKEEPER'],
  ['capped-bowler-set', 'SET', 'BOWLER'],
  ['uncapped-set', 'SET', 'UNCAPPED'],
  ['strategy-break', 'BREAK'],
  ['accelerated-auction', 'ACCELERATED'],
  ['final-opportunities', 'ACCELERATED'],
  ['unsold-review', 'ANNOUNCEMENT'],
  ['verification', 'REVIEW'],
  ['closing-ceremony', 'ANNOUNCEMENT'],
];

const MINI_STAGES = [
  ['existing-squad-analysis', 'ANNOUNCEMENT'],
  ['mini-welcome', 'ANNOUNCEMENT'],
  ['mini-rules', 'ANNOUNCEMENT'],
  ['capped-batter-set', 'SET', 'BATTER'],
  ['capped-allrounder-set', 'SET', 'ALLROUNDER'],
  ['capped-wicketkeeper-set', 'SET', 'WICKETKEEPER'],
  ['capped-bowler-set', 'SET', 'BOWLER'],
  ['uncapped-set', 'SET', 'UNCAPPED'],
  ['strategy-break', 'BREAK'],
  ['accelerated-auction', 'ACCELERATED'],
  ['verification', 'REVIEW'],
  ['closing-ceremony', 'ANNOUNCEMENT'],
];

function poolOf(players) {
  return (players || []).filter((player) => player && !player.soldTo && player.availability === 'AVAILABLE');
}

function idsOf(players) {
  return players.map((player) => player.id);
}

/**
 * @param {'MEGA'|'MINI'} format
 * @param {Array<Object>} [players] pool used to populate SET stages
 * @param {string} [season] season key; 2025 is the only season with marquee sets
 */
export function createProceedings(format = 'MEGA', players = generatePlayers(), season = '2025') {
  const seasonKey = resolveSeason(season, format);
  const mega = seasonKey === '2025';
  const plan = mega ? MEGA_STAGES : MINI_STAGES;
  const pool = poolOf(players);
  const marquee = pool.filter((player) => player.category === 'MARQUEE')
    .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.id.localeCompare(b.id));
  const marqueeOne = new Set(marquee.slice(0, 5).map((player) => player.id));
  const marqueeTwo = new Set(marquee.slice(5).map((player) => player.id));

  return plan.map(([id, kind, category]) => {
    let playerIds = [];
    if (kind === 'SET') {
      if (category === 'MARQUEE_1') playerIds = idsOf(pool.filter((player) => marqueeOne.has(player.id)));
      else if (category === 'MARQUEE_2') playerIds = idsOf(pool.filter((player) => marqueeTwo.has(player.id)));
      else if (category === 'UNCAPPED') playerIds = idsOf(pool.filter((player) => player.capped === false && player.category !== 'MARQUEE'));
      else {
        playerIds = idsOf(pool.filter((player) => (
          player.capped !== false && player.category === category
        )));
      }
    }
    return {
      id,
      title: STAGE_TITLES[id] || id,
      kind,
      status: 'PENDING',
      playerIds,
    };
  });
}

export default createProceedings;
