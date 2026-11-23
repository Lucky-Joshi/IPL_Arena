import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuctionEngine, computeResults } from './src/engine.js';
import { createAiClient } from './src/aiClient.js';
import { createStore } from './src/persistence.js';

const PORT = Number(process.env.PORT) || 4000;
const AI_URL = process.env.AI_URL || 'http://localhost:5000';
const SAVE_FILE = process.env.SAVE_FILE
  ? path.resolve(process.env.SAVE_FILE)
  : fileURLToPath(new URL('./data/auction-state.json', import.meta.url));
const MAX_BODY = 1024 * 1024;
// The engine owns format-specific defaults (MEGA uses maxAdditions as a squad cap,
// MINI uses 6). Only guarantee a usable tick interval here.
const CONFIG_DEFAULTS = { tickMs: 1000 };

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const store = createStore(SAVE_FILE);
const aiClient = createAiClient({ url: AI_URL });

let loaded = await store.load();
let hasSave = loaded.hasSave;
let saveError = loaded.saveError || null;
let engine = null;
let pendingSave = Promise.resolve();
let tickTimer = null;
let tickMs = 0;
let ticking = false;
let shuttingDown = false;
// The engine's tick() awaits nine AI decisions. Serialise every mutation with
// it so a concurrent HTTP action cannot land on a half-updated lot.
let engineQueue = Promise.resolve();

function log(...parts) {
  process.stdout.write(`[backend] ${parts.join(' ')}\n`);
}
function warn(...parts) {
  process.stderr.write(`[backend] ${parts.join(' ')}\n`);
}

const persist = (state) => {
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => store.save(state))
    .then(() => {
      hasSave = true;
      saveError = null;
    })
    .catch((error) => {
      saveError = error?.message || String(error);
      warn(`save failed: ${saveError}`);
    });
  return pendingSave;
};
const flushSave = () => pendingSave;

function wrapEngine(base) {
  const state = typeof base?.getState === 'function' ? base.getState() : base;
  return AuctionEngine.fromState(clone(state)).attach({ aiClient, persist });
}

function ensureEngine() {
  if (engine) return engine;
  if (loaded.state) {
    try {
      engine = wrapEngine(loaded.state);
    } catch (error) {
      saveError = `cannot restore save: ${error.message}`;
    }
  }
  return engine;
}

async function aiHealth() {
  try {
    const response = await fetch(`${AI_URL.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(700),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function currentState() {
  const active = ensureEngine();
  return active ? active.getState() : loaded.state || null;
}

function serial(task) {
  const run = engineQueue.then(task, task);
  engineQueue = run.catch(() => {});
  return run;
}

function syncTickInterval() {
  const state = engine?.getState() || loaded.state;
  const interval = Math.max(10, Number(state?.config?.tickMs) || 1000);
  if (interval === tickMs && tickTimer) return;
  if (tickTimer) clearInterval(tickTimer);
  tickMs = interval;
  tickTimer = setInterval(() => { void runTick(); }, interval);
  tickTimer.unref?.();
}

async function runTick() {
  if (ticking || shuttingDown) return;
  ticking = true;
  try {
    await serial(async () => {
      const active = ensureEngine();
      if (!active) return;
      if (active.getState().clockRunning === false) return;
      const result = await active.tick();
      if (result?.changed) await flushSave();
    });
  } catch (error) {
    warn(`tick failed: ${error?.message || error}`);
  } finally {
    ticking = false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('request body exceeds 1MB');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function failure(res, status, error, state) {
  const payload = { ok: false, error };
  if (state !== undefined) payload.state = state;
  send(res, status, payload);
}

async function createAuction(body) {
  const format = String(body.format || 'MEGA').toUpperCase();
  const difficulty = String(body.difficulty || 'BALANCED').toUpperCase();
  const userFranchiseId = String(body.userFranchiseId || 'F1');
  const config = { ...CONFIG_DEFAULTS, ...(body.config && typeof body.config === 'object' ? body.config : {}) };
  const created = AuctionEngine.create({ format, season: body.season, difficulty, userFranchiseId, config, aiClient, persist });
  engine = wrapEngine(created);
  await flushSave();
  // A fresh engine that does not persist in its constructor still gets a save here.
  if (!hasSave) await persist(engine.getState());
  await flushSave();
  syncTickInterval();
  return { ok: true, state: engine.getState(), error: null };
}

async function dispatchAction(body) {
  const active = ensureEngine();
  if (!active) return { ok: false, error: 'No auction in progress', state: null };
  const state = active.getState();
  const action = String(body.action || '');

  const HUMAN_ACTIONS = new Set([
    'BID', 'WITHDRAW', 'SET_RETENTIONS',
    'USE_RTM', 'PASS_RTM', 'RTM_RAISE', 'RTM_DECLINE', 'MATCH_RTM',
    'PROPOSE_TRADE', 'RESPOND_TRADE', 'INJURE_PLAYER',
    'SIGN_INJURY_REPLACEMENT', 'PLAYER_WITHDRAW',
  ]);
  if (HUMAN_ACTIONS.has(action)) {
    const requested = body.franchiseId || state.userFranchiseId;
    if (requested !== state.userFranchiseId) {
      return { ok: false, error: 'Only the human franchise can be controlled from this client', state };
    }
    body.franchiseId = requested;
  }

  // The HTTP contract uses `action`; the engine's dispatcher uses `type`.
  const engineAction = { ...body, type: action };
  let result;
  try {
    result = await active.dispatch(engineAction);
  } catch (error) {
    return { ok: false, error: error?.message || String(error), state: active.getState() };
  }
  await flushSave();
  syncTickInterval();
  const next = active.getState();
  if (result && result.ok === false) {
    return { ok: false, error: result.error || 'Action rejected', state: next };
  }
  return { ok: true, state: next, error: null };
}

async function handlePost(req, res) {
  let body;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be a JSON object');
  } catch (error) {
    failure(res, error.status || 400, error.message);
    return;
  }

  const action = String(body.action || '');
  if (!action) {
    failure(res, 400, 'Missing action', currentState());
    return;
  }
  if (saveError && action !== 'RESET') {
    failure(res, 409, `Cannot mutate a corrupt save: ${saveError}`, null);
    return;
  }

  if (action === 'RESET') {
    await serial(async () => {
      await store.clear();
      engine = null;
      loaded = { state: null, hasSave: false };
      hasSave = false;
      saveError = null;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
      tickMs = 0;
    });
    send(res, 200, { ok: true, state: null, error: null });
    return;
  }

  try {
    const payload = await serial(() => (
      action === 'CREATE' ? createAuction(body) : dispatchAction(body)
    ));
    send(res, 200, payload);
  } catch (error) {
    failure(res, 400, error?.message || String(error), currentState());
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, ai: { ok: await aiHealth() }, hasSave });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/auction/state') {
      const state = currentState();
      const payload = { state, hasSave };
      if (saveError) payload.saveError = saveError;
      send(res, 200, payload);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/results') {
      const state = currentState();
      if (!state) {
        failure(res, 404, 'No auction state');
        return;
      }
      try {
        send(res, 200, { ok: true, results: computeResults(state) });
      } catch (error) {
        failure(res, 400, `Cannot compute results: ${error.message}`);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/auction') {
      await handlePost(req, res);
      return;
    }
    failure(res, 404, `Unknown route ${url.pathname}`);
  } catch (error) {
    failure(res, 500, error?.message || String(error));
  }
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (tickTimer) clearInterval(tickTimer);
  server.close(async () => {
    await flushSave();
    log(`stopped (${signal})`);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

syncTickInterval();
server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT}`);
  log(`AI_URL=${AI_URL}`);
  log(`save=${SAVE_FILE}${hasSave ? ' (existing)' : saveError ? ' (CORRUPT: inspection required)' : ' (new)'}`);
  if (saveError) warn(`save error: ${saveError}`);
});
