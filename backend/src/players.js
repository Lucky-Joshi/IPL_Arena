/**
 * Deterministic fictional player pool for IPL Auction Arena.
 *
 * A single seed drives every random decision: categories, names, ratings,
 * prices and statistics. The default seed always produces the same 140
 * players, which keeps auctions reproducible in tests and demos.
 */

import { basePriceForRating, resolveSeason } from './rules.js';

export const PLAYER_SEED = 20240331;

const CATEGORY_PLAN = [
  ['MARQUEE', 12],
  ['BATTER', 30],
  ['ALLROUNDER', 24],
  ['WICKETKEEPER', 14],
  ['BOWLER', 40],
  ['ACCELERATED', 20],
];

/** India ~60%, the rest spread across 13 overseas cricketing nations. */
const NATIONALITY_PLAN = [
  ['India', 84],
  ['Australia', 8],
  ['England', 8],
  ['South Africa', 7],
  ['New Zealand', 5],
  ['West Indies', 6],
  ['Pakistan', 6],
  ['Sri Lanka', 5],
  ['Bangladesh', 3],
  ['Afghanistan', 3],
  ['Ireland', 2],
  ['Zimbabwe', 1],
  ['Nepal', 1],
  ['USA', 1],
];

const NAME_POOLS = {
  India: {
    first: ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Kabir', 'Rohan', 'Ayaan', 'Rehan', 'Samar', 'Dev', 'Ketan', 'Nikhil', 'Siddharth', 'Yash', 'Dhruv', 'Ishaan', 'Malhar', 'Shrey', 'Omkar', 'Pranav', 'Rishik', 'Tushar', 'Utkarsh', 'Anvit', 'Chaitanya', 'Girish', 'Harsh', 'Manav', 'Nirav', 'Parth', 'Sahil', 'Tavish', 'Zain', 'Aakash', 'Bhuvan'],
    last: ['Mehta', 'Deshmukh', 'Kapadia', 'Bhosale', 'Menon', 'Nair', 'Reddy', 'Gowda', 'Hegde', 'Chatterjee', 'Banerjee', 'Dutta', 'Sengupta', 'Agarwal', 'Maheshwari', 'Malhotra', 'Bedi', 'Bhandari', 'Chauhan', 'Dodiya', 'Goswami', 'Kulkarni', 'Mhatre', 'Patwardhan', 'Raut', 'Sawant', 'Tiwari', 'Uppal', 'Vartak', 'Wadia', 'Yelve', 'Zaveri', 'Bajpai', 'Chandrakar', 'Purohit', 'Sailesh'],
  },
  Australia: {
    first: ['Cooper', 'Harper', 'Lachlan', 'Jarrah', 'Bryce', 'Dylan', 'Ethan', 'Hugo', 'Jai', 'Kai', 'Liam', 'Noah', 'Oscar', 'Riley'],
    last: ['Warren', 'Hartley', 'Brennan', 'Kelly', 'Doyle', 'Fletcher', 'Maguire', 'Osborne', 'Paterson', 'Quigley', 'Renshaw', 'Sullivan', 'Tremain', 'Whitfield'],
  },
  England: {
    first: ['Alfie', 'Archie', 'Benjy', 'Charlie', 'Freddie', 'George', 'Harry', 'Jack', 'Leo', 'Oliver', 'Rory', 'Sam', 'Theo', 'Will'],
    last: ['Ashworth', 'Bramhall', 'Carter', 'Denton', 'Ellis', 'Foster', 'Gaskell', 'Hollins', 'Ivens', 'Jarvis', 'Kendall', 'Leeds', 'Marsden', 'Naylor'],
  },
  'South Africa': {
    first: ['Aiden', 'Bongani', 'Dane', 'Gideon', 'Jacob', 'Kagiso', 'Liam', 'Mihlali', 'Ruan', 'Siyabonga', 'Tyler', 'Wian'],
    last: ['Botha', 'Dlamini', 'Fourie', 'Greyling', 'Jansen', 'Khoza', 'Mokoena', 'Ndlovu', 'Pretorius', 'Sithole', 'Venter', 'Zulu'],
  },
  'New Zealand': {
    first: ['Arlo', 'Caleb', 'Finn', 'Hamish', 'Isaac', 'Jesse', 'Kieran', 'Leo', 'Mason', 'Noah', 'Rhys', 'Taine'],
    last: ['Barclay', 'Crombie', 'Dempster', 'Fenton', 'Gillespie', 'Hart', 'Ingram', 'Jamieson', 'Kirkpatrick', 'McLeod', 'Norris', 'Rowlands'],
  },
  'West Indies': {
    first: ['Akeem', 'Brandon', 'Chevon', 'Denzel', 'Everton', 'Jermaine', 'Kadeem', 'Milo', 'Orville', 'Ronaldo', 'Shamar', 'Tevin'],
    last: ['Baptiste', 'Clarke', 'Daniel', 'Edwards', 'Fredericks', 'Hodge', 'Jacobs', 'Lewis', 'Mayers', 'Nurse', 'Phillip', 'Rose'],
  },
  Pakistan: {
    first: ['Abrar', 'Bilal', 'Fahad', 'Harris', 'Imran', 'Kamran', 'Liaqat', 'Moazzam', 'Nabeel', 'Osama', 'Rameez', 'Saad'],
    last: ['Abbasi', 'Aftab', 'Bhatti', 'Chaudhry', 'Farooqi', 'Haque', 'Iqbal', 'Javed', 'Mahmood', 'Nawaz', 'Qureshi', 'Sheikh'],
  },
  'Sri Lanka': {
    first: ['Avishka', 'Chamika', 'Dhananjaya', 'Eshan', 'Kavindu', 'Lahiru', 'Maheesh', 'Nipun', 'Pasan', 'Ravindu', 'Sahan', 'Tharindu'],
    last: ['Fernando', 'Gunasekara', 'Jayawardena', 'Kodithuwakku', 'Liyanage', 'Mendis', 'Nanayakkara', 'Perera', 'Ranasinghe', 'Silva', 'Wickramasinghe', 'Yapa'],
  },
  Bangladesh: {
    first: ['Aamin', 'Fahim', 'Imran', 'Jaker', 'Khaled', 'Mahmud', 'Nahid', 'Rakib', 'Saif', 'Tanvir', 'Towhid', 'Zakir'],
    last: ['Ahmed', 'Alam', 'Hossain', 'Islam', 'Kabir', 'Miah', 'Rahman', 'Sarker', 'Talukder', 'Uddin'],
  },
  Afghanistan: {
    first: ['Ahmad', 'Farhad', 'Hashmat', 'Ismat', 'Karim', 'Lutfullah', 'Mujeeb', 'Nangialai', 'Rahmat', 'Sadiq', 'Yamin', 'Zia'],
    last: ['Ahmadzai', 'Akbar', 'Amini', 'Ghani', 'Hotak', 'Miakhel', 'Nabi', 'Omarzai', 'Safi', 'Shah', 'Zadran', 'Zaki'],
  },
  Ireland: {
    first: ['Adam', 'Cian', 'Eoin', 'Fergus', 'Gavin', 'Jack', 'Joshua', 'Liam', 'Mark', 'Nathan', 'Rory', 'Sean'],
    last: ['Byrne', 'Doyle', 'Fitzgerald', 'Houlihan', 'Kelleher', 'McCarthy', 'Osborne', 'Quinn', 'Roche', 'Traynor', 'Walsh', 'Whelan'],
  },
  Zimbabwe: {
    first: ['Brian', 'Chamu', 'Diran', 'Edmond', 'Farai', 'Gareth', 'Hilton', 'Innocent', 'Jonga', 'Kudzai', 'Tapiwa', 'Wesley'],
    last: ['Bvuma', 'Chari', 'Dzamba', 'Gaza', 'Hondo', 'Kadano', 'Maphosa', 'Nyamai', 'Shumba', 'Takunda', 'Zhvakala'],
  },
  Nepal: {
    first: ['Abinash', 'Bibek', 'Chandra', 'Diwakar', 'Gaurav', 'Karan', 'Lokesh', 'Pratis', 'Rijan', 'Sandeep', 'Sudarshan', 'Yogesh'],
    last: ['Adhikari', 'Bhandari', 'Chhetri', 'Dhakal', 'Gautam', 'Joshi', 'Khadka', 'Maharjan', 'Paudel', 'Shrestha'],
  },
  USA: {
    first: ['Aaron', 'Brandon', 'Devon', 'Ethan', 'Jaden', 'Kyle', 'Miles', 'Noah', 'Ryan', 'Saurabh', 'Tyler', 'Varun'],
    last: ['Adams', 'Brown', 'Desai', 'Gordon', 'Harris', 'Johnson', 'Miller', 'Patel', 'Robinson', 'Shah', 'Singh', 'Thompson'],
  },
};

const PACE_STYLES = ['Right-arm fast', 'Left-arm fast-medium', 'Right-arm fast-medium', 'Left-arm fast', 'Right-arm medium-fast'];
const SPIN_STYLES = ['Right-arm off-spin', 'Slow left-arm orthodox', 'Right-arm leg-spin', 'Left-arm unorthodox spin', 'Right-arm medium'];

/** Small, fast, deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = (Number(seed) >>> 0) || PLAYER_SEED;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function money(value) {
  return Math.round(clamp(value, 0.2, 16) * 20) / 20;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function buildNationalities(rng) {
  const pool = [];
  for (const [nationality, count] of NATIONALITY_PLAN) {
    for (let i = 0; i < count; i += 1) pool.push(nationality);
  }
  return shuffled(pool, rng);
}

function makeUniqueName(nationality, rng, used) {
  const { first, last } = NAME_POOLS[nationality] || NAME_POOLS.India;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const name = `${pick(first, rng)} ${pick(last, rng)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Deterministic fallback if a small pool is exhausted.
  let n = 1;
  let name = `${pick(first, rng)} ${pick(last, rng)} ${n}`;
  while (used.has(name)) {
    n += 1;
    name = `${pick(first, rng)} ${pick(last, rng)} ${n}`;
  }
  used.add(name);
  return name;
}

function ratingFor(category, index, rng) {
  if (category === 'MARQUEE') {
    // Only a handful of players in the whole pool are rated above 90.
    return index < 5 ? 91 + Math.floor(rng() * 5) : 86 + Math.floor(rng() * 5);
  }
  if (category === 'BATTER') return clamp(60 + Math.floor(rng() * 24) + (index < 3 ? 2 : 0), 52, 89);
  if (category === 'ALLROUNDER') return clamp(62 + Math.floor(rng() * 22), 52, 89);
  if (category === 'WICKETKEEPER') return clamp(57 + Math.floor(rng() * 22), 52, 89);
  if (category === 'BOWLER') return clamp(58 + Math.floor(rng() * 23) + (index < 3 ? 3 : 0), 52, 89);
  return clamp(52 + Math.floor(rng() * 20), 52, 89); // ACCELERATED
}

function basePriceFor(rating, category, rng) {
  let min;
  let max;
  if (rating >= 92) [min, max] = [12, 16];
  else if (rating >= 88) [min, max] = [8, 12];
  else if (rating >= 84) [min, max] = [5, 9];
  else if (rating >= 78) [min, max] = [2.5, 5];
  else if (rating >= 70) [min, max] = [1, 3];
  else if (rating >= 62) [min, max] = [0.5, 1.5];
  else [min, max] = [0.2, 0.8];

  if (category === 'MARQUEE') min = Math.max(min, 8);
  if (category === 'ACCELERATED') {
    min = Math.min(min, 1);
    max = Math.min(max, 2.5);
  }
  return money(min + rng() * (max - min));
}

function styleFor(category, role, rng) {
  const battingStyle = rng() < 0.66 ? 'Right-hand bat' : 'Left-hand bat';
  const spin = rng() < 0.45;
  let subtype;
  let bowlingStyle = null;

  if (category === 'ACCELERATED') {
    const chosenRole = role;
    if (chosenRole === 'BOWLER') {
      subtype = spin ? 'UNCAPPED_SPINNER' : 'UNCAPPED_PACER';
      bowlingStyle = pick(spin ? SPIN_STYLES : PACE_STYLES, rng);
    } else if (chosenRole === 'ALLROUNDER') {
      subtype = 'YOUNG_ALLROUNDER';
      bowlingStyle = pick(spin ? SPIN_STYLES : PACE_STYLES, rng);
    } else if (chosenRole === 'WICKETKEEPER') {
      subtype = 'YOUNG_KEEPER_BATTER';
    } else {
      subtype = pick(['UNCAPPED_OPENER', 'UNCAPPED_MIDDLE_ORDER', 'YOUNG_FINISHER'], rng);
    }
    return { battingStyle, bowlingStyle, subtype };
  }

  if (role === 'BOWLER') {
    subtype = spin ? 'SPINNER' : 'PACER';
    bowlingStyle = pick(spin ? SPIN_STYLES : PACE_STYLES, rng);
  } else if (role === 'ALLROUNDER') {
    subtype = pick(['GENUINE_ALLROUNDER', 'BAT_ALLROUNDER', 'BOWL_ALLROUNDER'], rng);
    if (subtype !== 'BAT_ALLROUNDER') bowlingStyle = pick(spin ? SPIN_STYLES : PACE_STYLES, rng);
  } else if (role === 'WICKETKEEPER') {
    subtype = pick(['KEEPER_BATTER', 'WICKETKEEPER_BATTER'], rng);
  } else {
    subtype = pick(['OPENER', 'TOP_ORDER', 'MIDDLE_ORDER', 'FINISHER'], rng);
  }
  return { battingStyle, bowlingStyle, subtype };
}

function statsFor(role, rating, bowlingStyle, rng) {
  const matches = 18 + Math.floor(rng() * 148);
  const innings = Math.max(1, Math.round(matches * (0.72 + rng() * 0.16)));
  const quality = (rating - 52) / 43; // 0..1
  const isBowlerRole = role === 'BOWLER';
  const battingAverage = round1((isBowlerRole ? 12 : 21) + quality * (isBowlerRole ? 12 : 20) + rng() * 8);
  const runs = Math.round(innings * battingAverage * (0.82 + rng() * 0.2));
  const strikeRate = round1((isBowlerRole ? 88 : 104) + quality * (isBowlerRole ? 28 : 36) + rng() * 10);
  const highestScore = Math.max(12, Math.round(battingAverage * (1.5 + rng() * 1.5)));
  const hundreds = Math.min(9, Math.max(0, Math.floor((battingAverage - 24) / 9 + rng() * 1.4)));
  const fifties = Math.max(1, Math.floor(innings * (0.06 + rng() * 0.11)));

  const bowls = Boolean(bowlingStyle) || isBowlerRole || (role === 'ALLROUNDER' && rng() < 0.4);
  const bowlingSkill = bowls ? (isBowlerRole ? 0.65 + quality * 0.35 : 0.4 + quality * 0.4) : 0;
  const wickets = bowls ? Math.round(matches * (0.45 + bowlingSkill * 1.05 + rng() * 0.25)) : 0;
  const bowlingAverage = wickets > 0 ? round1(19 + (1 - bowlingSkill) * 16 + rng() * 5) : 0;
  const economy = wickets > 0 ? round1(4.8 + (1 - bowlingSkill) * 3.5 + rng() * 1.2) : 0;
  const bestFigures = wickets > 0
    ? `${1 + Math.floor(rng() * (isBowlerRole ? 5 : 3))}/${12 + Math.floor(rng() * 32)}`
    : '0/0';

  return {
    matches,
    runs,
    average: battingAverage,
    strikeRate,
    highestScore,
    hundreds,
    fifties,
    wickets,
    bowlingAverage,
    economy,
    bestFigures,
  };
}

function acceleratedRole(rng) {
  return pick(['BATTER', 'BATTER', 'ALLROUNDER', 'BOWLER', 'BOWLER', 'WICKETKEEPER'], rng);
}

/**
 * BCCI status for a generated player.
 *
 * Overseas players are capped. An Indian is capped when they have appeared in
 * international cricket; players who have not played international cricket for
 * five calendar years and hold no BCCI central contract are reclassified as
 * uncapped. `contractFee` is the player's previous league salary and is what a
 * Mini Auction retention costs.
 */
export function statusFor({ rating, age, experience, nationality, rng, forceUncapped = false }) {
  const overseas = Boolean(nationality && nationality !== 'India');
  const quality = Number(rating) || 60;
  const years = Number(experience) || 0;
  const ageYears = Number(age) || 27;
  const random = typeof rng === 'function' ? rng : Math.random;

  let internationalCaps = 0;
  if (!overseas && !forceUncapped) {
    if (quality >= 88) internationalCaps = 18 + Math.floor(random() * 70);
    else if (quality >= 76) internationalCaps = 1 + Math.floor(random() * 14);
  } else if (overseas) {
    internationalCaps = 12 + Math.floor(random() * 70);
  }
  const centralContract = !forceUncapped && internationalCaps > 0 && quality >= 85 && ageYears <= 34;
  const retiredFiveYears = !overseas && internationalCaps === 0 && ageYears >= 34 && years >= 10;
  const capped = internationalCaps > 0 || centralContract;
  const uncappedReason = capped ? null
    : retiredFiveYears ? 'NO_INTERNATIONAL_CRICKET_5_YEARS'
      : 'NO_INTERNATIONAL_CAPS';

  let contractFee;
  if (capped) {
    contractFee = Math.min(18, Math.max(0.5, 0.5 + ((quality - 58) / 40) * 12 + random() * 2));
  } else {
    contractFee = Math.min(4, Math.max(0.3, 0.3 + ((quality - 50) / 40) * 3 + random() * 0.5));
  }
  return {
    capped,
    uncappedReason,
    internationalCaps,
    centralContract,
    retiredFiveYears,
    contractFee: Math.round(contractFee * 100) / 100,
  };
}

/**
 * Build the complete auction pool.
 * @param {number|string} [seed] defaults to PLAYER_SEED
 * @param {string} [season] BCCI season key; controls base-price tiers
 * @returns {Array<Object>} 140 deterministic fictional players
 */
export function generatePlayers(seed = PLAYER_SEED, season = '2025') {
  let numericSeed = seed;
  if (typeof seed === 'string') {
    numericSeed = 0;
    for (let i = 0; i < seed.length; i += 1) numericSeed = (numericSeed * 31 + seed.charCodeAt(i)) >>> 0;
  }
  if (!Number.isFinite(Number(numericSeed))) numericSeed = PLAYER_SEED;
  const rng = mulberry32(numericSeed >>> 0);
  const seasonKey = resolveSeason(season);

  const nationalities = buildNationalities(rng);
  const usedNames = new Set();
  const players = [];
  let index = 0;

  for (const [category, count] of CATEGORY_PLAN) {
    for (let i = 0; i < count; i += 1) {
      const nationality = nationalities[index % nationalities.length] || 'India';
      const name = makeUniqueName(nationality, rng, usedNames);
      const role = category === 'ACCELERATED' ? acceleratedRole(rng) : category;
      const rating = ratingFor(category, i, rng);
      const { battingStyle, bowlingStyle, subtype } = styleFor(category, role, rng);
      const experience = category === 'ACCELERATED'
        ? 1 + Math.floor(rng() * 6)
        : category === 'MARQUEE'
          ? 8 + Math.floor(rng() * 9)
          : 2 + Math.floor(rng() * 14);
      const age = 19 + Math.floor(rng() * 17);
      const status = statusFor({
        rating,
        age,
        experience,
        nationality,
        rng,
        forceUncapped: category === 'ACCELERATED',
      });

      players.push({
        id: `P${String(index + 1).padStart(3, '0')}`,
        name,
        age,
        nationality,
        country: nationality,
        role,
        subtype,
        rating,
        // BCCI registration tiers: ₹30 lakh to ₹2 crore for every season.
        basePrice: basePriceForRating(rating),
        battingStyle,
        bowlingStyle,
        stats: statsFor(role, rating, bowlingStyle, rng),
        experience,
        category,
        season: seasonKey,
        ...status,
        availability: 'AVAILABLE',
        soldTo: null,
        soldPrice: null,
        soldRound: null,
        existing: false,
        retentionCandidate: false,
      });
      index += 1;
    }
  }
  return players;
}

export default generatePlayers;
