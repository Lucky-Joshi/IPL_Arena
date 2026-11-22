/**
 * Ten fictional IPL Auction Arena franchises.
 *
 * Both formats start with empty squads. Retentions are chosen by the user
 * (and auto-picked for the nine AI teams) during SETUP from a shared pool.
 * MEGA uses the main auction pool; MINI also receives a separate set of
 * R0xx "existing player" candidates so the main pool still supplies the
 * six-or-so additions that make a mini auction work.
 */

import { mulberry32 } from './players.js';

export const FRANCHISE_CONFIG_DEFAULTS = {
  MEGA: { startingPurse: 120, minSquad: 18, maxSquad: 25, maxOverseas: 8, maxAdditions: 25, maxRetentions: 3, minReservePerSlot: 0.2, tickMs: 1000, pace: 'BROADCAST' },
  MINI: { startingPurse: 50, minSquad: 18, maxSquad: 25, maxOverseas: 8, maxAdditions: 6, maxRetentions: 15, minReservePerSlot: 0, tickMs: 1000, pace: 'BROADCAST' },
};

const TEMPLATES = [
  {
    name: 'Aurangabad Aces', short: 'AAA', city: 'Aurangabad',
    primary: '#E63946', secondary: '#1D3557',
    owner: 'Meera Kapoor', headCoach: 'Vikram Desai', directorCricket: 'Anand Rao',
    strategist: 'Priya Nair', analyst: 'Kabir Malhotra', scoutingHead: 'Suresh Iyer',
    strategy: 'AGGRESSIVE', targets: ['BATTER', 'BOWLER'],
  },
  {
    name: 'Bengaluru Blaze', short: 'BLZ', city: 'Bengaluru',
    primary: '#FF6B35', secondary: '#004E89',
    owner: 'Rohan Bhatia', headCoach: 'Nigel Dsouza', directorCricket: 'Sanjay Gowda',
    strategist: 'Divya Menon', analyst: 'Arjun Rao', scoutingHead: 'Imran Pasha',
    strategy: 'VALUE', targets: ['ALLROUNDER', 'WICKETKEEPER'],
  },
  {
    name: 'Chennai Chargers', short: 'CHC', city: 'Chennai',
    primary: '#FFD166', secondary: '#073B4C',
    owner: 'Lakshmi Venkatesh', headCoach: 'Murali Krishnan', directorCricket: 'Deepa Natarajan',
    strategist: 'Karthik Subramanian', analyst: 'Anjali Iyer', scoutingHead: 'Ramachandran Pillai',
    strategy: 'CONSERVATIVE', targets: ['BATTER', 'ALLROUNDER'],
  },
  {
    name: 'Delhi Dynamos', short: 'DDY', city: 'Delhi',
    primary: '#3A86FF', secondary: '#14213D',
    owner: 'Aditi Malhotra', headCoach: 'Ajay Bhandari', directorCricket: 'Ravi Sehgal',
    strategist: 'Neha Tandon', analyst: 'Sahil Varma', scoutingHead: 'Gaurav Chopra',
    strategy: 'AGGRESSIVE', targets: ['BOWLER', 'BATTER'],
  },
  {
    name: 'Hyderabad Hawks', short: 'HYH', city: 'Hyderabad',
    primary: '#8E44AD', secondary: '#2B2D42',
    owner: 'Farhan Qureshi', headCoach: 'Mohsin Ali', directorCricket: 'Sana Begum',
    strategist: 'Omar Siddiqui', analyst: 'Tariq Ahmed', scoutingHead: 'Rehana Sultana',
    strategy: 'BALANCED', targets: ['WICKETKEEPER', 'BOWLER'],
  },
  {
    name: 'Kolkata Kings', short: 'KKG', city: 'Kolkata',
    primary: '#6A4C93', secondary: '#F4A261',
    owner: 'Ritwik Sengupta', headCoach: 'Subrata Dutta', directorCricket: 'Indrani Bose',
    strategist: 'Ananya Ghosh', analyst: 'Debashis Roy', scoutingHead: 'Soumen Chatterjee',
    strategy: 'VALUE', targets: ['BATTER', 'ALLROUNDER'],
  },
  {
    name: 'Lucknow Lancers', short: 'LKL', city: 'Lucknow',
    primary: '#2A9D8F', secondary: '#264653',
    owner: 'Pragya Srivastava', headCoach: 'Brijesh Yadav', directorCricket: 'Nisha Awasthi',
    strategist: 'Amitabh Verma', analyst: 'Shweta Pandey', scoutingHead: 'Dinesh Tiwari',
    strategy: 'BALANCED', targets: ['BOWLER', 'ALLROUNDER'],
  },
  {
    name: 'Nagpur Ninjas', short: 'NGN', city: 'Nagpur',
    primary: '#EF476F', secondary: '#118AB2',
    owner: 'Vikrant Deshmukh', headCoach: 'Prasad Kulkarni', directorCricket: 'Amruta Bhandari',
    strategist: 'Sameer Raut', analyst: 'Nikita Wagh', scoutingHead: 'Pravin Jadhav',
    strategy: 'CONSERVATIVE', targets: ['WICKETKEEPER', 'BATTER'],
  },
  {
    name: 'Pune Panthers', short: 'PNP', city: 'Pune',
    primary: '#06D6A0', secondary: '#073B4C',
    owner: 'Shreyas Gadgil', headCoach: 'Mangesh Pawar', directorCricket: 'Sonal Joshi',
    strategist: 'Amey Date', analyst: 'Rutuja Kulkarni', scoutingHead: 'Mahesh Shinde',
    strategy: 'AGGRESSIVE', targets: ['ALLROUNDER', 'BOWLER'],
  },
  {
    name: 'Vizag Vipers', short: 'VZV', city: 'Visakhapatnam',
    primary: '#E76F51', secondary: '#2A3B5C',
    owner: 'Padma Varma', headCoach: 'Srinivasa Rao', directorCricket: 'Kiran Kumar',
    strategist: 'Lakshmi Prasad', analyst: 'Chaitanya Varma', scoutingHead: 'Bhaskar Reddy',
    strategy: 'VALUE', targets: ['BATTER', 'WICKETKEEPER'],
  },
];

/** Role compositions deliberately leave visible gaps (e.g. one keeper, two allrounders). */
const RETAINED_ROLE_PLAN = [
  { BATTER: 5, BOWLER: 5, ALLROUNDER: 3, WICKETKEEPER: 2 },
  { BATTER: 5, BOWLER: 4, ALLROUNDER: 4, WICKETKEEPER: 2 },
  { BATTER: 5, BOWLER: 5, ALLROUNDER: 4, WICKETKEEPER: 1 },
  { BATTER: 5, BOWLER: 5, ALLROUNDER: 3, WICKETKEEPER: 2 },
  { BATTER: 4, BOWLER: 5, ALLROUNDER: 3, WICKETKEEPER: 3 },
  { BATTER: 6, BOWLER: 3, ALLROUNDER: 4, WICKETKEEPER: 2 },
  { BATTER: 6, BOWLER: 4, ALLROUNDER: 3, WICKETKEEPER: 2 },
  { BATTER: 4, BOWLER: 5, ALLROUNDER: 4, WICKETKEEPER: 2 },
  { BATTER: 6, BOWLER: 5, ALLROUNDER: 2, WICKETKEEPER: 2 },
  { BATTER: 5, BOWLER: 5, ALLROUNDER: 3, WICKETKEEPER: 2 },
];

const OVERSEAS_COUNTRIES = [
  'Australia', 'England', 'South Africa', 'New Zealand', 'West Indies',
  'Pakistan', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'Ireland',
];

const NAME_PARTS = {
  India: [['Aarav', 'Dev', 'Kabir', 'Rohan', 'Yash', 'Nikhil', 'Gaurav', 'Manav', 'Sahil', 'Aakash', 'Tushar', 'Omkar'], ['Mehta', 'Nair', 'Reddy', 'Gowda', 'Dutta', 'Agarwal', 'Bhandari', 'Goswami', 'Kulkarni', 'Raut', 'Vartak', 'Bajpai']],
  Australia: [['Cooper', 'Harper', 'Lachlan', 'Bryce', 'Kai', 'Oscar', 'Riley', 'Toby'], ['Warren', 'Hartley', 'Doyle', 'Fletcher', 'Quigley', 'Renshaw', 'Sullivan', 'Whitfield']],
  England: [['Alfie', 'Charlie', 'Freddie', 'Leo', 'Rory', 'Theo'], ['Ashworth', 'Carter', 'Ellis', 'Jarvis', 'Marsden', 'Naylor']],
  'South Africa': [['Aiden', 'Dane', 'Gideon', 'Ruan', 'Tyler'], ['Botha', 'Fourie', 'Khoza', 'Pretorius', 'Venter']],
  'New Zealand': [['Arlo', 'Caleb', 'Hamish', 'Isaac', 'Rhys'], ['Barclay', 'Dempster', 'Hart', 'Ingram', 'Norris']],
  'West Indies': [['Akeem', 'Chevon', 'Jermaine', 'Kadeem', 'Shamar'], ['Baptiste', 'Clarke', 'Hodge', 'Mayers', 'Rose']],
  Pakistan: [['Abrar', 'Fahad', 'Kamran', 'Nabeel', 'Saad'], ['Abbasi', 'Farooqi', 'Iqbal', 'Nawaz', 'Sheikh']],
  'Sri Lanka': [['Chamika', 'Kavindu', 'Nipun', 'Sahan', 'Tharindu'], ['Fernando', 'Liyanage', 'Mendis', 'Perera', 'Silva']],
  Bangladesh: [['Fahim', 'Jaker', 'Nahid', 'Saif', 'Towhid'], ['Alam', 'Hossain', 'Kabir', 'Rahman', 'Sarker']],
  Afghanistan: [['Farhad', 'Karim', 'Mujeeb', 'Rahmat', 'Zia'], ['Amini', 'Ghani', 'Miakhel', 'Nabi', 'Zadran']],
  Ireland: [['Cian', 'Eoin', 'Fergus', 'Nathan', 'Sean'], ['Byrne', 'Doyle', 'Kelleher', 'Quinn', 'Walsh']],
};

const PACE = ['Right-arm fast', 'Right-arm fast-medium', 'Left-arm fast-medium', 'Right-arm medium-fast'];
const SPIN = ['Right-arm off-spin', 'Slow left-arm orthodox', 'Right-arm leg-spin'];

function pick(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function retainedName(nationality, rng, used) {
  const [first, last] = NAME_PARTS[nationality] || NAME_PARTS.India;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const name = `${pick(first, rng)} ${pick(last, rng)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  let n = 1;
  let name = `${pick(first, rng)} ${pick(last, rng)} ${n}`;
  while (used.has(name)) {
    n += 1;
    name = `${pick(first, rng)} ${pick(last, rng)} ${n}`;
  }
  used.add(name);
  return name;
}

function buildSquadRoles(composition, rng) {
  const remaining = { ...composition };
  const order = ['BATTER', 'BOWLER', 'ALLROUNDER', 'WICKETKEEPER'];
  const roles = [];
  // Interleave roles so each squad reads like a real playing group.
  while (order.some((role) => remaining[role] > 0)) {
    for (const role of shuffled(order, rng)) {
      if (remaining[role] > 0) {
        roles.push(role);
        remaining[role] -= 1;
      }
    }
  }
  return roles;
}

function makeRetainedPlayer(id, role, nationality, rng) {
  const rating = 56 + Math.floor(rng() * 27);
  const quality = (rating - 56) / 26;
  const bowlingStyle = role === 'BOWLER'
    ? pick(rng() < 0.45 ? SPIN : PACE, rng)
    : role === 'ALLROUNDER' && rng() < 0.6
      ? pick(rng() < 0.5 ? SPIN : PACE, rng)
      : null;
  const matches = 25 + Math.floor(rng() * 120);
  const innings = Math.max(1, Math.round(matches * 0.8));
  const isBowler = role === 'BOWLER';
  const average = round1((isBowler ? 14 : 23) + quality * 18 + rng() * 6);
  const runs = Math.round(innings * average * (0.8 + rng() * 0.2));
  const wickets = bowlingStyle ? Math.round(matches * (0.5 + quality * 0.9 + rng() * 0.2)) : 0;
  const subtype = role === 'BATTER'
    ? pick(['OPENER', 'TOP_ORDER', 'MIDDLE_ORDER', 'FINISHER'], rng)
    : role === 'BOWLER'
      ? pick(['PACER', 'SPINNER'], rng)
      : role === 'ALLROUNDER'
        ? pick(['GENUINE_ALLROUNDER', 'BAT_ALLROUNDER', 'BOWL_ALLROUNDER'], rng)
        : 'KEEPER_BATTER';

  return {
    id,
    name: retainedName(nationality, rng, retainedName.used),
    age: 22 + Math.floor(rng() * 14),
    nationality,
    country: nationality,
    role,
    subtype,
    rating,
    basePrice: 0,
    battingStyle: rng() < 0.68 ? 'Right-hand bat' : 'Left-hand bat',
    bowlingStyle,
    stats: {
      matches,
      runs,
      average,
      strikeRate: round1((isBowler ? 90 : 105) + quality * 28 + rng() * 10),
      highestScore: Math.max(12, Math.round(average * (1.4 + rng() * 1.4))),
      hundreds: Math.min(6, Math.max(0, Math.floor((average - 24) / 10 + rng()))),
      fifties: Math.max(1, Math.floor(innings * (0.06 + rng() * 0.1))),
      wickets,
      bowlingAverage: wickets > 0 ? round1(19 + (1 - quality) * 14 + rng() * 4) : 0,
      economy: wickets > 0 ? round1(5 + (1 - quality) * 3 + rng()) : 0,
      bestFigures: wickets > 0 ? `${1 + Math.floor(rng() * 4)}/${12 + Math.floor(rng() * 30)}` : '0/0',
    },
    experience: 3 + Math.floor(rng() * 13),
    category: role,
    // Retention candidates live in the shared pool until a franchise picks
    // them. They are not part of any auction stage, so they never get called.
    availability: 'AVAILABLE',
    soldTo: null,
    soldPrice: 0,
    soldRound: null,
    existing: false,
    retained: false,
    retentionCandidate: true,
  };
}

/**
 * Create the MINI retention-candidate pool: 15 role-balanced existing players
 * per franchise (R0xx ids). These are NOT pre-assigned; the user and the AI
 * choose from them during SETUP.
 * @returns {{retainedPlayers: Array<Object>, squads: Object<string, string[]>}}
 */
export function createMiniSquads({ franchises, config = FRANCHISE_CONFIG_DEFAULTS.MINI, rng } = {}) {
  const random = typeof rng === 'function' ? rng : mulberry32(424242);
  const teams = franchises || TEMPLATES.map((template, i) => ({
    ...template,
    id: `F${i + 1}`,
    strategy: template.strategy,
    targets: template.targets.slice(),
  }));
  retainedName.used = new Set();
  const retainedPlayers = [];
  let counter = 0;

  teams.forEach((franchise, teamIndex) => {
    const roles = buildSquadRoles(RETAINED_ROLE_PLAN[teamIndex % RETAINED_ROLE_PLAN.length], random);
    const overseasCount = Math.min(4, 2 + Math.floor(random() * 3));
    const overseasSlots = new Set(shuffled(roles.map((_, i) => i), random).slice(0, overseasCount));
    for (let position = 0; position < roles.length; position += 1) {
      counter += 1;
      const role = roles[position];
      const nationality = overseasSlots.has(position)
        ? OVERSEAS_COUNTRIES[(teamIndex + position) % OVERSEAS_COUNTRIES.length]
        : 'India';
      retainedPlayers.push(makeRetainedPlayer(`R${String(counter).padStart(3, '0')}`, role, nationality, random));
    }
  });

  void config; // accepted for API symmetry
  void franchises; // candidates are format-wide, not owned until selected
  return { retainedPlayers, squads: {} };
}

/**
 * Build the ten franchises for a format. Both formats start with empty squads.
 * For MINI, retention candidates are appended to the supplied `players` array.
 */
export function createFranchises({ format = 'MEGA', config, players = [], rng } = {}) {
  const fmt = String(format).toUpperCase() === 'MINI' ? 'MINI' : 'MEGA';
  const conf = config || FRANCHISE_CONFIG_DEFAULTS[fmt];
  const random = typeof rng === 'function' ? rng : mulberry32(fmt === 'MINI' ? 724241 : 191114);
  const maxAdditions = Number.isFinite(Number(conf.maxAdditions))
    ? Number(conf.maxAdditions)
    : FRANCHISE_CONFIG_DEFAULTS[fmt].maxAdditions;

  const franchises = TEMPLATES.map((template, i) => ({
    id: `F${i + 1}`,
    name: template.name,
    short: template.short,
    city: template.city,
    primary: template.primary,
    secondary: template.secondary,
    owner: template.owner,
    headCoach: template.headCoach,
    directorCricket: template.directorCricket,
    strategist: template.strategist,
    analyst: template.analyst,
    scoutingHead: template.scoutingHead,
    strategy: template.strategy,
    purse: typeof conf.startingPurse === 'number' ? conf.startingPurse : FRANCHISE_CONFIG_DEFAULTS[fmt].startingPurse,
    squad: [],
    existing: [],
    retentions: [],
    retentionSpent: 0,
    additionsLimit: fmt === 'MEGA' ? Number(conf.maxSquad) || 25 : maxAdditions,
    purchases: [],
    rejected: [],
    targets: template.targets.slice(),
    discussions: [],
    biddingStatus: 'IDLE',
  }));

  if (fmt === 'MINI') {
    const { retainedPlayers } = createMiniSquads({ franchises, config: conf, rng: random });
    const knownIds = new Set(players.map((player) => player.id));
    for (const player of retainedPlayers) {
      if (!knownIds.has(player.id)) players.push(player);
    }
  }
  return franchises;
}

export default createFranchises;
