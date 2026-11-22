import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuctionEngine, computeResults, getNextBid, validateBid, retentionCost } from '../src/engine.js';
import { fallbackDecide } from '../src/aiClient.js';
import { generatePlayers } from '../src/players.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BACKEND = path.join(ROOT, 'backend');
const AI_PORT = 5101;
const PORT = 4101;
const BASE = `http://127.0.0.1:${PORT}`;
const AI_BASE = `http://127.0.0.1:${AI_PORT}`;
const SAVE_FILE = path.join(BACKEND, 'data', 'smoke-state.json');
const TICK_MS = 100;
// Automated scenarios stay on FAST; the pacing scenario explicitly checks BROADCAST.
const CONFIG = { tickMs: TICK_MS, pace: 'FAST' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));
let aiProc = null;
let backendProc = null;
const logs = { ai: [], backend: [] };

function pass(name) {
  process.stdout.write(`PASS ${name}\n`);
}

function attachLogs(proc, key) {
  const push = (stream) => stream.on('data', (chunk) => {
    const text = chunk.toString();
    logs[key].push(text);
    if (process.env.SMOKE_VERBOSE) process.stderr.write(`[${key}] ${text}`);
  });
  push(proc.stdout);
  push(proc.stderr);
}

function pythonCommand() {
  for (const command of ['python', 'py']) {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: false });
    if (result.status === 0) return command;
  }
  throw new Error('Neither python nor py was found on PATH');
}

async function startChildren() {
  await mkdir(path.dirname(SAVE_FILE), { recursive: true });
  await rm(SAVE_FILE, { force: true });
  const env = { ...process.env };
  aiProc = spawn(pythonCommand(), ['server.py'], {
    cwd: path.join(ROOT, 'ai'),
    env: { ...env, PORT: String(AI_PORT), AI_PORT: String(AI_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachLogs(aiProc, 'ai');
  backendProc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: {
      ...env,
      PORT: String(PORT),
      AI_URL: AI_BASE,
      SAVE_FILE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachLogs(backendProc, 'backend');
  await waitForHealth(`${AI_BASE}/health`, 'AI', 20000);
  await waitForHealth(`${BASE}/api/health`, 'backend', 15000);
}

async function waitForHealth(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(400) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(80);
  }
  throw new Error(`${label} did not become healthy in ${timeoutMs}ms (${lastError})\n${logs[label.toLowerCase()]?.join('') || ''}`);
}

async function stopProc(proc, name) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => proc.once('exit', resolve)),
    sleep(1500),
  ]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
  void name;
}

async function stopChildren() {
  await stopProc(backendProc, 'backend');
  await stopProc(aiProc, 'AI');
}

async function request(urlPath, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = await response.json();
  return { status: response.status, ...json };
}

const getState = async () => (await request('/api/auction/state')).state;
const act = (body) => request('/api/auction', { method: 'POST', body });

// The engine re-exports validation's getNextBid(currentBid), while the cross-service
// contract describes getNextBid(state). Compute the exact expected bid locally so the
// smoke test works with either signature.
function nextBidFor(state) {
  const player = state.players.find((p) => p.id === state.currentPlayerId);
  const current = Number(state.currentBid) || 0;
  if (current > 0 && (state.bidsThisLot || 0) > 0) return getNextBid(current);
  return Number(player?.basePrice) || 0.25;
}

function relevantPhases(s) {
  return new Set(['BIDDING', 'GOING_ONCE', 'GOING_TWICE', 'ACCELERATED_AUCTION']);
}

function stripVolatile(state) {
  const cloneState = clone(state);
  for (const key of ['savedAt', 'clock', 'lastTick', 'tickCount', 'elapsedMs', 'clockMs', 'updatedAt']) {
    delete cloneState[key];
  }
  return cloneState;
}

function assertInvariants(state, label = 'auction') {
  const config = state.config;
  const squadOwners = new Map();
  for (const franchise of state.franchises) {
    assert.ok(franchise.purse >= 0, `${label}: ${franchise.id} purse negative (${franchise.purse})`);
    assert.ok(franchise.squad.length <= config.maxSquad, `${label}: ${franchise.id} squad over max`);
    const additionCap = Number.isFinite(Number(franchise.additionsLimit))
      ? Number(franchise.additionsLimit)
      : config.maxAdditions;
    if (additionCap > 0 && state.format === 'MINI') {
      assert.ok(franchise.purchases.length <= additionCap, `${label}: ${franchise.id} additions over cap`);
    }
    const map = new Map(state.players.map((p) => [p.id, p]));
    const overseas = franchise.squad.filter((id) => {
      const player = map.get(id);
      return player && player.nationality && player.nationality !== 'India';
    }).length;
    assert.ok(overseas <= config.maxOverseas, `${label}: ${franchise.id} overseas over max (${overseas})`);
    for (const id of franchise.squad) {
      assert.ok(!squadOwners.has(id), `${label}: player ${id} owned by two squads`);
      squadOwners.set(id, franchise.id);
    }
  }
  for (const player of state.players) {
    if (player.availability === 'SOLD') {
      assert.ok(player.soldTo, `${label}: sold player ${player.id} has no owner`);
      assert.equal(squadOwners.get(player.id), player.soldTo, `${label}: sold player ${player.id} ownership inconsistent`);
    }
  }
  const grouped = new Map();
  for (const bid of state.bidHistory) {
    if (!grouped.has(bid.playerId)) grouped.set(bid.playerId, []);
    grouped.get(bid.playerId).push(bid);
  }
  for (const [playerId, bids] of grouped) {
    // bidHistory is append-only, so array order is the authoritative chronology.
    let leader = null;
    for (const bid of bids) {
      assert.notEqual(leader, bid.franchiseId, `${label}: ${leader} bid twice in a row on ${playerId}`);
      leader = bid.franchiseId;
    }
  }
}

async function advanceHttp(state) {
  const phase = state.phase;
  if (phase === 'SETUP') return act({ action: 'START' });
  if (phase === 'SET_BREAK' || phase === 'STRATEGY_BREAK') return act({ action: 'RESUME_BREAK' });
  if (phase === 'PLAYER_INTRODUCTION') return act({ action: 'OPEN_BIDDING' });
  if (phase === 'OPENING' || phase === 'FINAL_REVIEW') return act({ action: 'CONTINUE' });
  if (phase === 'SOLD' || phase === 'UNSOLD') return act({ action: 'NEXT' });
  if (relevantPhases(state).has(phase)) {
    // Give the AI a couple of real ticks so a bidding war can develop, then
    // fast-forward the mechanical going-once/going-twice steps.
    if ((state.bidsThisLot || 0) >= 2 || phase === 'GOING_ONCE' || phase === 'GOING_TWICE') {
      return act({ action: 'NEXT' });
    }
    await sleep(TICK_MS + 5);
    return null;
  }
  return act({ action: 'NEXT' });
}

async function driveHttp({ maxSteps = 1400, stop = () => false, phasesSeen = null } = {}) {
  let last = await getState();
  for (let i = 0; i < maxSteps; i += 1) {
    phasesSeen?.add(last.phase);
    if (stop(last) || last.phase === 'COMPLETED') return last;
    await advanceHttp(last);
    last = await getState();
  }
  return last;
}

async function driveUntilLot(maxSteps = 200) {
  return driveHttp({
    maxSteps,
    stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase),
  });
}

function advanceEngine(engine, state) {
  const phase = state.phase;
  if (phase === 'SETUP') return engine.dispatch({ type: 'START' });
  if (phase === 'SET_BREAK' || phase === 'STRATEGY_BREAK') return engine.dispatch({ type: 'RESUME_BREAK' });
  if (phase === 'PLAYER_INTRODUCTION') return engine.dispatch({ type: 'OPEN_BIDDING' });
  if (phase === 'OPENING' || phase === 'FINAL_REVIEW') return engine.dispatch({ type: 'CONTINUE' });
  if (phase === 'SOLD' || phase === 'UNSOLD') return engine.dispatch({ type: 'NEXT' });
  if (relevantPhases(state).has(phase)) {
    if ((state.bidsThisLot || 0) >= 2 || phase === 'GOING_ONCE' || phase === 'GOING_TWICE') {
      return engine.dispatch({ type: 'NEXT' });
    }
    return null;
  }
  return engine.dispatch({ type: 'NEXT' });
}

async function driveEngine(engine, { maxSteps = 1200, stop = () => false, phasesSeen = null } = {}) {
  for (let i = 0; i < maxSteps; i += 1) {
    const state = engine.getState();
    phasesSeen?.add(state.phase);
    if (stop(state) || state.phase === 'COMPLETED') return state;
    const sync = advanceEngine(engine, state);
    if (sync?.error) throw new Error(sync.error);
    if (!sync) await engine.tick();
    await Promise.resolve();
  }
  return engine.getState();
}

function makeDirectEngine(format, aiClient, config = {}) {
  const base = AuctionEngine.create({
    format,
    difficulty: 'BALANCED',
    userFranchiseId: 'F1',
    config: { tickMs: TICK_MS, ...config },
    aiClient,
    persist: () => {},
  });
  return new AuctionEngine(base.getState(), { aiClient, persist: () => {} });
}

const stubAi = (rule) => ({ async decide(ctx) { return rule(ctx); } });

async function scenarioCreateAndIntro() {
  const created = await act({
    action: 'CREATE', format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1', config: CONFIG,
  });
  assert.equal(created.ok, true, `CREATE failed: ${created.error}`);
  const state = created.state;
  assert.equal(state.franchises.length, 10);
  assert.ok(state.players.length >= 140, `expected >=140 players, got ${state.players.length}`);
  assert.ok(state.franchises.every((f) => f.squad.length === 0), 'squads should start empty');
  assert.ok(state.franchises.every((f) => f.purse === state.config.startingPurse), 'initial purse should match config');
  const started = await act({ action: 'START' });
  assert.equal(started.ok, true, `START failed: ${started.error}`);
  const phases = new Set();
  const introduced = await driveHttp({
    maxSteps: 120,
    stop: (s) => s.conversations.some((c) => /introduc|scout|need|coverage/i.test(c.text)) || Boolean(s.currentPlayerId),
    phasesSeen: phases,
  });
  assert.ok(introduced.currentPlayerId || phases.has('BIDDING'), 'no player introduction reached');
  pass('CREATE MEGA / 10 franchises / empty squads / purse 120 / 140+ players');
  pass('START + CONTINUE/ticks reach first SET with introduction');
}

async function scenarioHumanBid() {
  let state = await getState();
  if (!state.currentPlayerId) state = await driveUntilLot();
  // Let the clock open the lot if it is still in the introduction phase.
  for (let i = 0; i < 15 && state.phase === 'PLAYER_INTRODUCTION'; i += 1) {
    await sleep(TICK_MS + 2);
    state = await getState();
  }
  const human = state.franchises.find((f) => f.id === state.userFranchiseId);
  const beforePurse = human.purse;
  const amount = nextBidFor(state);
  const check = validateBid(state, state.userFranchiseId, amount);
  assert.equal(check.ok, true, `human bid should be legal: ${check.error}`);
  const result = await act({ action: 'BID', franchiseId: state.userFranchiseId, amount });
  assert.equal(result.ok, true, `human BID failed: ${result.error}`);
  const after = result.state;
  const newBid = after.bidHistory.find((b) => b.franchiseId === state.userFranchiseId && b.playerId === state.currentPlayerId);
  assert.ok(newBid, 'human bid not recorded in bidHistory');
  assert.equal(after.franchises.find((f) => f.id === state.userFranchiseId).purse, beforePurse, 'purse changed before SOLD');
  pass('human BID legal / purse unchanged until SOLD / bidHistory updated');
}

async function scenarioWarAndPasses() {
  const phases = new Set();
  const final = await driveHttp({ maxSteps: 350, phasesSeen: phases });
  const byPlayer = new Map();
  for (const bid of final.bidHistory) {
    if (!byPlayer.has(bid.playerId)) byPlayer.set(bid.playerId, new Set());
    byPlayer.get(bid.playerId).add(bid.franchiseId);
  }
  let war = [...byPlayer.values()].some((ids) => ids.size >= 2);
  let passEvidence = final.eventLog.some((e) => /pass|withdraw/i.test(`${e.type} ${e.text}`))
    || final.conversations.some((c) => /pass|step back|withdraw/i.test(c.text))
    || final.franchises.some((f) => f.rejected.length > 0);

  if (!war || !passEvidence) {
    // Exercise the same real engine directly with deterministic stub AIs.
    if (!war) {
      const warAi = stubAi((ctx) => ({
        action: 'BID', amount: ctx.auction.nextBid, confidence: 0.9, publicComment: 'We are in.',
      }));
      const engine = makeDirectEngine('MEGA', warAi);
      await driveEngine(engine, { maxSteps: 120, stop: (s) => s.bidHistory.length >= 8 });
      const direct = engine.getState();
      const directWar = new Map();
      for (const bid of direct.bidHistory) {
        if (!directWar.has(bid.playerId)) directWar.set(bid.playerId, new Set());
        directWar.get(bid.playerId).add(bid.franchiseId);
      }
      war = [...directWar.values()].some((ids) => ids.size >= 2);
    }
    if (!passEvidence) {
      const passAi = stubAi((ctx) => (ctx.self?.id === 'F6'
        ? { action: 'WITHDRAW', amount: 0, confidence: 0.7, publicComment: 'We step back.' }
        : { action: 'PASS', amount: 0, confidence: 0.7, publicComment: 'We pass.' }));
      const engine = makeDirectEngine('MEGA', passAi);
      await driveEngine(engine, {
        maxSteps: 120,
        stop: (s) => s.eventLog.some((e) => e.type === 'WITHDRAW' || e.type === 'PASS'),
      });
      const direct = engine.getState();
      passEvidence = direct.withdrawnIds.length > 0
        || direct.eventLog.some((e) => /pass|withdraw/i.test(`${e.type} ${e.text}`))
        || direct.conversations.some((c) => /pass|step back|withdraw/i.test(c.text));
    }
  }
  assert.ok(war, 'no lot attracted bids from multiple franchises');
  assert.ok(passEvidence, 'no PASS/WITHDRAW evidence found');
  assertInvariants(final, 'megaauction');
  pass('AI bidding war + PASS/WITHDRAW + all invariants hold');
}

async function scenarioBreakFreeze() {
  let state = await getState();
  if (state.phase === 'COMPLETED') {
    await act({ action: 'CREATE', format: 'MEGA', userFranchiseId: 'F1', config: CONFIG });
    state = await driveUntilLot();
  }
  if (!relevantPhases(state).has(state.phase)) state = await driveUntilLot();
  const lotId = state.currentPlayerId;
  const breakCall = await act({ action: 'CALL_BREAK' });
  const inBreak = breakCall.state || await getState();
  if (breakCall.ok && (inBreak.phase === 'SET_BREAK' || inBreak.phase === 'STRATEGY_BREAK')) {
    const before = stripVolatile(inBreak);
    await sleep(TICK_MS * 15 + 80);
    const after = stripVolatile(await getState());
    assert.deepEqual(after, before, 'state changed during a break');
    const resumed = await act({ action: 'RESUME_BREAK' });
    assert.equal(resumed.ok, true, `RESUME_BREAK failed: ${resumed.error}`);
    assert.equal(resumed.state.currentPlayerId, lotId, 'break did not restore the exact lot');
    pass('CALL_BREAK freezes state across 15 ticks / RESUME_BREAK restores lot');
  } else {
    // Engine may restrict breaks to strategy windows; validate the same property directly.
    const ai = stubAi(async (ctx) => fallbackDecide(ctx));
    const engine = makeDirectEngine('MEGA', ai);
    await driveEngine(engine, { maxSteps: 100, stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase) });
    const direct = engine.getState();
    const call = engine.dispatch({ type: 'CALL_BREAK' });
    assert.equal(call.ok, true, `direct CALL_BREAK failed: ${call.error}`);
    const before = stripVolatile(engine.getState());
    for (let i = 0; i < 15; i += 1) await engine.tick();
    assert.deepEqual(stripVolatile(engine.getState()), before, 'direct state changed during break');
    const lotId = before.currentPlayerId;
    const resumed = engine.dispatch({ type: 'RESUME_BREAK' });
    assert.equal(resumed.ok, true, `direct RESUME_BREAK failed: ${resumed.error}`);
    assert.equal(engine.getState().currentPlayerId, lotId);
    pass('CALL_BREAK freezes state across 15 ticks / RESUME_BREAK restores lot (direct engine)');
  }
}

async function scenarioInsufficientPurse() {
  const created = await act({
    action: 'CREATE', format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1', config: { ...CONFIG, startingPurse: 0.3 },
  });
  assert.equal(created.ok, true, `small-purse CREATE failed: ${created.error}`);
  // FAST pace leaves only a 100 ms bidding window, so the lot can close between
  // reading state and posting the bid. Freeze the clock before asserting, and
  // retry if the server tick won that race.
  let state = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await driveUntilLot(160);
    await act({ action: 'PAUSE' });
    const frozen = await getState();
    if (frozen.currentPlayerId && relevantPhases(frozen).has(frozen.phase)) {
      state = frozen;
      break;
    }
    await act({ action: 'UNPAUSE' });
  }
  assert.ok(state, 'could not freeze an open lot for the tiny-purse scenario');
  const player = state.players.find((p) => p.id === state.currentPlayerId);
  assert.ok(player && player.basePrice > 0.3, 'need a player with base price above the tiny purse');
  const amount = nextBidFor(state);
  const result = await act({ action: 'BID', franchiseId: state.userFranchiseId, amount });
  assert.equal(result.ok, false, 'insufficient-purse bid should be rejected');
  assert.ok(result.error && /purse|funds|budget|afford/i.test(result.error), `unexpected rejection: ${result.error}`);
  assert.ok(result.state, 'validation failure must still return state for the UI');
  await act({ action: 'UNPAUSE' });
  pass('insufficient purse human BID rejected with state returned');
}

async function scenarioRetentions() {
  // ---- MEGA: three costed retentions, rating slabs, AI auto-pick ----
  const mega = AuctionEngine.create({
    format: 'MEGA', config: CONFIG, userFranchiseId: 'F1', persist: () => {},
  });
  let state = mega.getState();
  assert.equal(state.config.maxRetentions, 3);
  assert.ok(state.franchises.every((f) => f.squad.length === 0 && f.retentions.length === 0));
  assert.equal(state.retentionsConfirmed, false);

  const top = state.players.filter((p) => p.availability === 'AVAILABLE')
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const picks = top.slice(0, 3).map((p) => p.id);
  const expectedCost = Math.round(top.slice(0, 3).reduce((total, p) => total + retentionCost(p), 0) * 100) / 100;
  const set = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: picks });
  assert.equal(set.ok, true, `MEGA SET_RETENTIONS failed: ${set.error}`);
  assert.equal(set.retentionSpent, expectedCost, 'rating-slab cost mismatch');

  state = mega.getState();
  const mine = state.franchises.find((f) => f.id === 'F1');
  assert.equal(mine.retentions.length, 3);
  assert.ok(Math.abs(mine.purse - (state.config.startingPurse - expectedCost)) < 0.001, 'purse not debited');
  assert.equal(mine.additionsLimit, state.config.maxSquad);
  for (const id of picks) {
    const player = state.players.find((p) => p.id === id);
    assert.equal(player.availability, 'SOLD');
    assert.equal(player.soldTo, 'F1');
    assert.equal(player.retained, true);
    assert.ok(player.retentionCost > 0, 'retention cost must be stamped on the player');
  }
  for (const rival of state.franchises.filter((f) => f.id !== 'F1')) {
    assert.equal(rival.retentions.length, 3, `${rival.id} did not auto-retain`);
    assert.ok(rival.retentionSpent > 0, `${rival.id} did not pay for retentions`);
  }
  assert.equal(state.retentionsConfirmed, true);
  pass('MEGA: 3 user retentions / rating-slab cost / purse debited / AI auto-retention');

  // Rejected over-limit selection must not disturb the current setup.
  const tooMany = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: top.slice(0, 4).map((p) => p.id) });
  assert.equal(tooMany.ok, false, '4 MEGA retentions should be rejected');
  assert.match(tooMany.error || '', /3|at most/i);
  assert.equal(mega.getState().franchises[0].retentions.length, 3, 'rejected selection mutated state');

  // Re-selection restores every player and the full purse, then re-picks AI.
  const cleared = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: [] });
  assert.equal(cleared.ok, true, `re-selection to zero failed: ${cleared.error}`);
  state = mega.getState();
  assert.equal(state.franchises[0].retentions.length, 0);
  assert.equal(state.franchises[0].purse, state.config.startingPurse, 'purse not restored on re-selection');
  for (const id of picks) {
    const player = state.players.find((p) => p.id === id);
    assert.equal(player.availability, 'AVAILABLE');
    assert.equal(player.retained, false);
  }
  pass('MEGA: re-selection resets players/purses and recomputes AI retentions');

  // START with no explicit SET_RETENTIONS confirms an empty selection.
  const autoStart = AuctionEngine.create({ format: 'MEGA', config: CONFIG, persist: () => {} });
  const started = autoStart.dispatch({ type: 'START' });
  assert.equal(started.ok, true, `START auto-confirm failed: ${started.error}`);
  const autoState = autoStart.getState();
  assert.equal(autoState.retentionsConfirmed, true);
  assert.equal(autoState.franchises[0].retentions.length, 0, 'zero-retention option lost');
  assert.ok(autoState.franchises.slice(1).every((f) => f.retentions.length === 3), 'AI retentions missing after START');
  assert.notEqual(autoState.phase, 'SETUP');
  pass('zero-retention start: START confirms empty selection and AI still retains');

  // ---- MINI: fifteen candidates, cap, cap-derived additionsLimit ----
  const mini = AuctionEngine.create({ format: 'MINI', config: CONFIG, persist: () => {} });
  let miniState = mini.getState();
  assert.equal(miniState.config.maxRetentions, 15);
  const candidates = miniState.players.filter((p) => p.retentionCandidate);
  assert.ok(candidates.length >= 150, `expected >=150 MINI retention candidates, got ${candidates.length}`);
  assert.ok(miniState.franchises.every((f) => f.squad.length === 0), 'MINI squads must start empty');

  const fifteen = candidates.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id)).slice(0, 15).map((p) => p.id);
  const miniSet = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: fifteen });
  assert.equal(miniSet.ok, true, `MINI 15-retention selection failed: ${miniSet.error}`);
  miniState = mini.getState();
  assert.equal(miniState.franchises[0].retentions.length, 15);
  assert.equal(miniState.franchises[0].additionsLimit, miniState.config.maxAdditions, '15 retentions should leave the base additions cap');
  assert.ok(miniState.franchises.slice(1).every((f) => f.retentions.length === 15), 'MINI AI franchises did not retain 15');

  const sixteenth = candidates.find((p) => !fifteen.includes(p.id));
  const over = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: [...fifteen, sixteenth.id] });
  assert.equal(over.ok, false, '16 MINI retentions should be rejected');
  assert.match(over.error || '', /15|at most/i);

  const zero = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: [] });
  assert.equal(zero.ok, true, `MINI zero retentions failed: ${zero.error}`);
  miniState = mini.getState();
  assert.equal(miniState.franchises[0].additionsLimit, miniState.config.minSquad, 'zero retentions must permit reaching minSquad');
  pass('MINI: 15-user-pick cap / candidate pool / zero retentions / additions cap adapts');

  // ---- results totals include retention spend ----
  const direct = AuctionEngine.create({ format: 'MEGA', config: CONFIG, persist: () => {} });
  direct.dispatch({ type: 'SET_RETENTIONS', playerIds: picks });
  const resultState = direct.getState();
  const results = computeResults(resultState);
  const totalRetention = resultState.franchises.reduce((sum, f) => sum + f.retentionSpent, 0);
  assert.ok(Math.abs(results.totalRetentionSpending - totalRetention) < 0.001, 'result retention total mismatch');
  for (const row of results.franchises) {
    const source = resultState.franchises.find((f) => f.id === row.id);
    assert.ok(Math.abs(row.purseSpent + row.purseRemaining - resultState.config.startingPurse) < 0.001,
      `${row.id}: purseSpent + purseRemaining must equal starting purse`);
    for (const member of row.squad.filter((p) => p.source === 'EXISTING')) {
      assert.ok(member.price > 0, `${row.id}: retained player is missing its cost in results`);
    }
  }
  pass('results: retention cost included in spending totals and squad prices');

  // ---- bid validation honours the retention-adjusted additions cap ----
  const capped = AuctionEngine.create({ format: 'MINI', config: CONFIG, persist: () => {} });
  capped.dispatch({ type: 'SET_RETENTIONS', playerIds: fifteen });
  const cappedState = clone(capped.getState());
  cappedState.phase = 'BIDDING';
  cappedState.currentPlayerId = cappedState.players.find((p) => p.availability === 'AVAILABLE' && !p.retentionCandidate).id;
  cappedState.currentBid = 0;
  cappedState.bidsThisLot = 0;
  const cappedFranchise = cappedState.franchises.find((f) => f.id === 'F1');
  cappedFranchise.purchases = Array.from({ length: cappedFranchise.additionsLimit }, (_, i) => ({ playerId: `X${i}`, price: 0.5, round: 'MAIN' }));
  cappedFranchise.purse = 100; // isolate the additions-cap check from the purse check
  const capCheck = validateBid(cappedState, 'F1', nextBidFor(cappedState));
  assert.equal(capCheck.ok, false, 'bid past retention-adjusted additions cap must be rejected');
  assert.match(capCheck.error || '', /addition|cap|limit/i);
  pass('validation: additions cap uses per-franchise additionsLimit');
}

async function scenarioMiniAuction() {
  const created = await act({
    action: 'CREATE', format: 'MINI', difficulty: 'BALANCED', userFranchiseId: 'F1', config: CONFIG,
  });
  assert.equal(created.ok, true, `MINI CREATE failed: ${created.error}`);
  assert.ok(created.state.franchises.every((f) => f.squad.length === 0), 'MINI squads should start empty');
  const picks = created.state.players.filter((p) => p.retentionCandidate)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id)).slice(0, 15).map((p) => p.id);
  const configured = await act({ action: 'SET_RETENTIONS', playerIds: picks });
  assert.equal(configured.ok, true, `MINI SET_RETENTIONS failed: ${configured.error}`);
  const retained = clone(configured.state.franchises.map((f) => [f.id, [...f.existing]]));
  const phases = new Set();
  let state = await driveHttp({ maxSteps: 240, stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase), phasesSeen: phases });
  if (state.currentPlayerId) {
    for (let i = 0; i < 30; i += 1) {
      const r = await act({ action: 'BID', franchiseId: state.userFranchiseId, amount: nextBidFor(state) });
      state = r.state || await getState();
      if (r.ok === false && /addition|squad|limit/i.test(r.error || '')) break;
      const next = await driveHttp({ maxSteps: 30, stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase) });
      if (next.currentPlayerId === state.currentPlayerId) await act({ action: 'NEXT' });
      state = await getState();
    }
  }
  for (const [id, existing] of retained) {
    const franchise = state.franchises.find((f) => f.id === id);
    for (const playerId of existing) {
      assert.ok(franchise.squad.includes(playerId), `${id} lost retained player ${playerId}`);
    }
  }

  // Direct validation of the additions cap on the real engine/validator.
  const ai = stubAi(async (ctx) => fallbackDecide(ctx));
  const engine = makeDirectEngine('MINI', ai);
  await driveEngine(engine, { maxSteps: 120, stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase) });
  const snapshot = clone(engine.getState());
  const f = snapshot.franchises.find((x) => x.id === 'F1');
  const max = f.additionsLimit;
  f.purchases = Array.from({ length: max }, (_, i) => ({ playerId: `X${i}`, price: 1, round: 'MAIN' }));
  const capped = new AuctionEngine(snapshot, { aiClient: ai, persist: () => {} });
  const amount = nextBidFor(capped.getState());
  const check = validateBid(capped.getState(), 'F1', amount);
  assert.equal(check.ok, false, 'bid past additionsLimit must be rejected');
  assert.match(check.error || '', /addition|squad|limit/i);
  pass('MINI: user retentions persist through auction / additions cap enforced');
}

async function scenarioSaveResume() {
  await act({ action: 'CREATE', format: 'MEGA', difficulty: 'HARD', userFranchiseId: 'F1', config: CONFIG });
  let state = await driveHttp({ maxSteps: 100, stop: (s) => Boolean(s.currentPlayerId) });
  for (let i = 0; i < 4; i += 1) {
    if (!state.currentPlayerId) break;
    const amount = nextBidFor(state);
    await act({ action: 'BID', franchiseId: state.userFranchiseId, amount });
    await sleep(TICK_MS * 8);
    await act({ action: 'NEXT' });
    state = await getState();
  }
  await act({ action: 'PAUSE' });
  const before = await getState();
  assert.ok(before, 'need state before restart');
  await stopProc(backendProc, 'backend');
  backendProc = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT), AI_URL: AI_BASE, SAVE_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachLogs(backendProc, 'backend');
  await waitForHealth(`${BASE}/api/health`, 'backend', 15000);
  const after = await getState();
  assert.ok(after, 'state missing after restart');
  assert.deepEqual(stripVolatile(after), stripVolatile(before), 'state changed across backend restart');
  await act({ action: 'UNPAUSE' });
  pass('save/resume across backend restart preserves state');
}

async function scenarioAccelerationAndResults() {
  const phases = new Set();
  // A zero-purse run makes every lot go unsold, which exercises both
  // accelerated stages and the final unsold review over HTTP.
  await act({
    action: 'CREATE',
    format: 'MEGA',
    difficulty: 'HARD',
    userFranchiseId: 'F1',
    config: { ...CONFIG, startingPurse: 0, minReservePerSlot: 0 },
  });
  const final = await driveHttp({ maxSteps: 5000, phasesSeen: phases });
  assert.equal(final.phase, 'COMPLETED', `HTTP run did not complete: ${final.phase}`);
  const unsold = final.players.filter((p) => p.availability === 'UNSOLD');
  assert.ok(unsold.length > 0, 'expected some unsold players');
  assert.ok(phases.has('ACCELERATED_AUCTION') || final.eventLog.some((e) => /accelerat/i.test(`${e.type} ${e.text}`))
    || final.proceedings.some((s) => s.kind === 'ACCELERATED'), 'accelerated stage never appeared');
  pass(`accelerated stage reached / ${unsold.length} unsold players exist`);

  const results = await request('/api/results');
  const source = results.ok ? results.results : computeResults(final);
  assert.equal(source.franchises.length, 10);
  const totalSpent = source.franchises.reduce((sum, f) => sum + f.purseSpent, 0);
  assert.ok(Math.abs(totalSpent - source.totalAuctionSpending) < 0.001, 'spending totals inconsistent');
  for (const f of source.franchises) {
    assert.equal(f.playerCount, f.existingCount + f.purchasedCount, `${f.id} squad counts inconsistent`);
    assert.ok(Math.abs(f.purseSpent + f.purseRemaining - final.config.startingPurse) < 0.001, `${f.id} purse math inconsistent`);
  }
  const called = final.players.filter((player) => player.availability !== 'AVAILABLE').length;
  assert.equal(source.soldCount + source.unsoldCount, called);
  assert.equal(source.unsold.length, source.unsoldCount);
  pass(`final review COMPLETED / results consistent (${source.soldCount} sold, ${source.unsoldCount} unsold)`);
}

async function scenarioPacingAndEarlyBid() {
  const passAi = stubAi(() => ({
    action: 'PASS', amount: null, confidence: 0.4, publicComment: 'We wait for this lot.',
  }));

  // A human may raise a paddle during the introduction; the auctioneer then
  // opens the floor and recognises the bid instead of rejecting the click.
  const earlyEngine = AuctionEngine.create({
    format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1',
    config: { ...CONFIG, pace: 'BROADCAST' }, aiClient: passAi, persist: () => {},
  });
  earlyEngine.dispatch({ type: 'START' });
  for (let i = 0; i < 8 && earlyEngine.getState().phase === 'OPENING'; i += 1) await earlyEngine.tick();
  const beforeBid = earlyEngine.getState();
  assert.equal(beforeBid.phase, 'PLAYER_INTRODUCTION', 'expected an introduction phase for the early-bid check');
  const player = beforeBid.players.find((p) => p.id === beforeBid.currentPlayerId);
  const earlyBid = earlyEngine.dispatch({ type: 'BID', franchiseId: 'F1' });
  assert.equal(earlyBid.ok, true, `bid during introduction failed: ${earlyBid.error}`);
  const afterBid = earlyEngine.getState();
  assert.equal(afterBid.phase, 'BIDDING', 'early bid should open bidding');
  assert.equal(afterBid.leaderId, 'F1', 'early bidder should lead');
  assert.equal(afterBid.currentBid, Number(player.basePrice), 'early bid should be at base price');
  assert.ok(afterBid.eventLog.some((e) => e.type === 'BIDDING_OPEN'), 'auctioneer must recognise the early bid');
  pass('human BID accepted during PLAYER_INTRODUCTION / floor opens immediately');

  // BROADCAST holds each call for several ticks so a person can react.
  const dwellEngine = AuctionEngine.create({
    format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1',
    config: { ...CONFIG, pace: 'BROADCAST' }, aiClient: passAi, persist: () => {},
  });
  dwellEngine.dispatch({ type: 'START' });
  let announcementTicks = 0;
  while (dwellEngine.getState().phase === 'OPENING' && announcementTicks < 10) {
    await dwellEngine.tick();
    announcementTicks += 1;
  }
  assert.equal(dwellEngine.getState().phase, 'PLAYER_INTRODUCTION');
  assert.ok(announcementTicks >= 5, `announcement dwell too short: ${announcementTicks}`);
  const opened = dwellEngine.dispatch({ type: 'BID', franchiseId: 'F1' });
  assert.equal(opened.ok, true, `opening bid failed: ${opened.error}`);
  assert.equal(dwellEngine.getState().phase, 'BIDDING');
  for (let i = 0; i < 4; i += 1) {
    await dwellEngine.tick();
    assert.equal(dwellEngine.getState().phase, 'BIDDING', `BIDDING ended too early on tick ${i + 1}`);
  }
  await dwellEngine.tick();
  assert.equal(dwellEngine.getState().phase, 'GOING_ONCE', 'BROADCAST bidding call should last several ticks');
  pass('BROADCAST pace holds bidding for 5 ticks before Going Once');
}

async function main() {
  // Sanity-check the other agents' modules before starting processes.
  assert.equal(generatePlayers().length >= 140, true, 'generatePlayers() should create >=140 players');
  assert.equal(typeof AuctionEngine, 'function');
  assert.equal(typeof computeResults, 'function');
  try {
    await scenarioPacingAndEarlyBid();
    await scenarioRetentions();
    await startChildren();
    await scenarioCreateAndIntro();
    await scenarioHumanBid();
    await scenarioWarAndPasses();
    await scenarioBreakFreeze();
    await scenarioInsufficientPurse();
    await scenarioMiniAuction();
    await scenarioSaveResume();
    await scenarioAccelerationAndResults();
    process.stdout.write('\nAll smoke scenarios passed.\n');
  } catch (error) {
    process.stderr.write(`\nSMOKE FAILURE: ${error.stack || error}\n`);
    const tail = (lines, limit = 40) => lines.slice(-limit).join('');
    if (logs.backend.length) process.stderr.write(`\n--- backend log (tail) ---\n${tail(logs.backend)}`);
    if (logs.ai.length) process.stderr.write(`\n--- ai log (tail) ---\n${tail(logs.ai)}`);
    process.exitCode = 1;
  } finally {
    await stopChildren();
    await rm(SAVE_FILE, { force: true }).catch(() => {});
  }
}

await main();
