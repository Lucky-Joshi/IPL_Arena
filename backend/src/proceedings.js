/**
 * Auction running order. Stage ids/kinds follow ARCHITECTURE.md section 3.
 * SET stages receive the matching players in generation order; ACCELERATED
 * stages are filled by the engine when they become active.
 */

import { generatePlayers } from './players.js';

export const STAGE_TITLES = {
  'opening-ceremony': 'Opening Ceremony',
  'auctioneer-welcome': 'Auctioneer Welcome',
  'franchise-introductions': 'Franchise Introductions',
  'rules-briefing': 'Rules Briefing',
  'marquee-set': 'Marquee Set',
  'batter-set': 'Batter Set',
  'allrounder-set': 'Allrounder Set',
  'wicketkeeper-set': 'Wicketkeeper Set',
  'bowler-set': 'Bowler Set',
  'strategy-break': 'Strategy Break',
  'accelerated-auction': 'Accelerated Auction',
  'final-opportunities': 'Final Opportunities',
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
  ['marquee-set', 'SET', 'MARQUEE'],
  ['batter-set', 'SET', 'BATTER'],
  ['allrounder-set', 'SET', 'ALLROUNDER'],
  ['wicketkeeper-set', 'SET', 'WICKETKEEPER'],
  ['bowler-set', 'SET', 'BOWLER'],
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
  ['batter-set', 'SET', 'BATTER'],
  ['allrounder-set', 'SET', 'ALLROUNDER'],
  ['wicketkeeper-set', 'SET', 'WICKETKEEPER'],
  ['bowler-set', 'SET', 'BOWLER'],
  ['strategy-break', 'BREAK'],
  ['accelerated-auction', 'ACCELERATED'],
  ['verification', 'REVIEW'],
  ['closing-ceremony', 'ANNOUNCEMENT'],
];

/**
 * @param {'MEGA'|'MINI'} format
 * @param {Array<Object>} [players] pool used to populate SET stages
 */
export function createProceedings(format = 'MEGA', players = generatePlayers()) {
  const fmt = String(format).toUpperCase() === 'MINI' ? 'MINI' : 'MEGA';
  const plan = fmt === 'MINI' ? MINI_STAGES : MEGA_STAGES;
  const pool = Array.isArray(players) ? players : generatePlayers();

  return plan.map(([id, kind, category]) => ({
    id,
    title: STAGE_TITLES[id] || id,
    kind,
    status: 'PENDING',
    playerIds: kind === 'SET' && category
      ? pool.filter((player) => player.category === category).map((player) => player.id)
      : [],
  }));
}

export default createProceedings;
