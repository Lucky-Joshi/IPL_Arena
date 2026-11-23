import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PHASES = new Set([
  'SETUP', 'OPENING', 'PLAYER_INTRODUCTION', 'BIDDING', 'GOING_ONCE', 'GOING_TWICE',
  'RTM_OFFER', 'RTM_COUNTER', 'RTM_MATCH',
  'SOLD', 'UNSOLD', 'SET_BREAK', 'STRATEGY_BREAK', 'ACCELERATED_AUCTION',
  'FINAL_REVIEW', 'COMPLETED',
]);
const REQUIRED_ARRAYS = [
  'players', 'franchises', 'proceedings', 'eventLog', 'conversations',
  'bidHistory', 'nominations',
];
const CONFIG_NUMBERS = [
  'startingPurse', 'minSquad', 'maxSquad', 'maxOverseas', 'maxAdditions',
  'minReservePerSlot', 'tickMs',
];
// Older saves predate retentions and the BCCI season rules; normalise them.
const OPTIONAL_CONFIG_NUMBERS = [
  'maxRetentions', 'maxCappedRetentions', 'maxUncappedRetentions',
  'totalSalaryCap', 'overseasSalaryCap', 'matchFee',
];
const OPTIONAL_STATE_NUMBERS = ['welfareFund', 'matchFeeProjection'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Strict structural validation — throws with a precise reason on bad saves. */
export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('state is not an object');
  if (state.version !== 1) throw new Error(`unsupported version: ${String(state.version)}`);
  if (typeof state.id !== 'string' || !state.id) throw new Error('missing auction id');
  if (!state.config || typeof state.config !== 'object' || Array.isArray(state.config)) {
    throw new Error('missing config object');
  }
  for (const [key, value] of Object.entries(state.config)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`config.${key} is not finite`);
  }
  for (const key of CONFIG_NUMBERS) {
    if (!isFiniteNumber(state.config[key])) throw new Error(`config.${key} is not a finite number`);
  }
  for (const key of OPTIONAL_CONFIG_NUMBERS) {
    if (state.config[key] !== undefined && !isFiniteNumber(state.config[key])) {
      throw new Error(`config.${key} is not a finite number`);
    }
  }
  for (const key of OPTIONAL_STATE_NUMBERS) {
    if (state[key] !== undefined && !isFiniteNumber(state[key])) {
      throw new Error(`${key} is not a finite number`);
    }
  }
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(state[key])) throw new Error(`${key} is not an array`);
  }
  if (state.franchises.length !== 10) throw new Error(`expected 10 franchises, found ${state.franchises.length}`);
  if (!PHASES.has(state.phase)) throw new Error(`unknown phase: ${String(state.phase)}`);

  const franchiseIds = new Set();
  for (const franchise of state.franchises) {
    if (!franchise || typeof franchise.id !== 'string' || !franchise.id) throw new Error('franchise missing id');
    if (franchiseIds.has(franchise.id)) throw new Error(`duplicate franchise id: ${franchise.id}`);
    franchiseIds.add(franchise.id);
    if (!isFiniteNumber(franchise.purse)) throw new Error(`franchise ${franchise.id} purse is not finite`);
    if (!Array.isArray(franchise.squad)) throw new Error(`franchise ${franchise.id} squad is not an array`);
  }

  // A player may belong to at most one squad, and soldTo must agree with that squad.
  const squadOwners = new Map();
  for (const franchise of state.franchises) {
    for (const id of franchise.squad) {
      if (typeof id !== 'string' || !id) throw new Error(`franchise ${franchise.id} has an invalid squad entry`);
      if (squadOwners.has(id)) {
        throw new Error(`duplicate squad ownership of player ${id}: ${squadOwners.get(id)} and ${franchise.id}`);
      }
      squadOwners.set(id, franchise.id);
    }
  }

  const playerIds = new Set();
  for (const player of state.players) {
    if (!player || typeof player.id !== 'string' || !player.id) throw new Error('player missing id');
    if (playerIds.has(player.id)) throw new Error(`duplicate player id: ${player.id}`);
    playerIds.add(player.id);
    if (player.soldTo !== null && player.soldTo !== undefined) {
      if (typeof player.soldTo !== 'string' || !franchiseIds.has(player.soldTo)) {
        throw new Error(`player ${player.id} sold to unknown franchise: ${String(player.soldTo)}`);
      }
      const owner = squadOwners.get(player.id);
      if (owner && owner !== player.soldTo) {
        throw new Error(`player ${player.id} sold to ${player.soldTo} but present in ${owner} squad`);
      }
    }
  }
  return true;
}

export function createStore(file) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  const base = path.basename(target);
  let corrupt = false;

  return {
    async load() {
      let text;
      try {
        text = await readFile(target, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          corrupt = false;
          return { state: null, hasSave: false };
        }
        corrupt = true;
        return { state: null, hasSave: true, saveError: `cannot read save: ${error.message}` };
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        corrupt = true;
        return { state: null, hasSave: true, saveError: `save is not valid JSON: ${error.message}` };
      }
      try {
        validateState(parsed);
      } catch (error) {
        corrupt = true;
        return { state: null, hasSave: true, saveError: `invalid save: ${error.message}` };
      }
      corrupt = false;
      return { state: parsed, hasSave: true };
    },

    async save(state, options = {}) {
      if (corrupt && !options.force) throw new Error('refusing to overwrite a corrupt save; call clear() first');
      validateState(state);
      await mkdir(directory, { recursive: true });
      const temp = path.join(directory, `${base}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
      try {
        await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        // Windows (OneDrive/antivirus) can briefly hold the destination open.
        // Rename a few times with a short backoff before surfacing the error.
        for (let attempt = 0; ; attempt += 1) {
          try {
            await rename(temp, target);
            break;
          } catch (error) {
            if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          }
        }
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      corrupt = false;
      return true;
    },

    async clear() {
      await unlink(target).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      // Remove abandoned atomic-write temp files for this save file.
      const entries = await readdir(directory).catch(() => []);
      await Promise.all(entries
        .filter((entry) => entry.startsWith(`${base}.`) && entry.endsWith('.tmp'))
        .map((entry) => unlink(path.join(directory, entry)).catch(() => {})));
      corrupt = false;
      return true;
    },

    get hasCorruptSave() {
      return corrupt;
    },
  };
}

export default createStore;
