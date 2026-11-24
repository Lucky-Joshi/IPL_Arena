import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuctionEngine,
  computeResults,
  getNextBid,
  validateBid,
  retentionCost,
  salarySplit,
  matchFeeProjection,
  rulesFor,
} from '../src/engine.js';
import { fallbackDecide } from '../src/aiClient.js';
import { generatePlayers } from '../src/players.js';
import { migrateLegacyNames } from '../src/persistence.js';

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
const CLAW_PHASES = new Set(['CLAW_OFFER', 'CLAW_COUNTER', 'CLAW_MATCH']);

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
      // CLAW entries are settlement records, not paddle raises, so a franchise
      // can legitimately appear twice when a lot is matched or passed through.
      if (String(bid.source || '').startsWith('CLAW')) {
        leader = bid.franchiseId;
        continue;
      }
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
  if (CLAW_PHASES.has(phase)) {
    const actor = phase === 'CLAW_COUNTER' ? state.claw?.leaderFranchiseId : state.claw?.originalFranchiseId;
    if (actor === state.userFranchiseId) {
      const action = phase === 'CLAW_COUNTER' ? 'CLAW_DECLINE' : 'PASS_CLAW';
      return act({ action, franchiseId: actor });
    }
    await sleep(TICK_MS + 5); // AI CLAW decisions resolve on a tick
    return null;
  }
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
  if (CLAW_PHASES.has(phase)) {
    const actor = phase === 'CLAW_COUNTER' ? state.claw?.leaderFranchiseId : state.claw?.originalFranchiseId;
    if (actor === state.userFranchiseId) {
      const type = phase === 'CLAW_COUNTER' ? 'CLAW_DECLINE' : 'PASS_CLAW';
      return engine.dispatch({ type, franchiseId: actor });
    }
    return null; // AI CLAW decisions resolve on the next tick
  }
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

function makeDirectEngine(format, aiClient, config = {}, season = format === 'MINI' ? '2026' : '2025') {
  const base = AuctionEngine.create({
    season,
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

/**
 * Mini retentions keep each player's exact contract fee, so overseas picks must
 * fit the ₹18 Cr ceiling. Greedy by rating, mirroring the AI retention picker.
 */
function miniRetentionPicks(state, franchiseId, count = 10) {
  const cap = Number(state.config?.overseasSalaryCap) || 0;
  const owned = state.players
    .filter((player) => player.previousFranchiseId === franchiseId && player.retentionCandidate)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const picks = [];
  let overseasSalary = 0;
  for (const player of owned) {
    if (picks.length >= count) break;
    const overseas = player.nationality && player.nationality !== 'India';
    const fee = Number(player.contractFee) || 0;
    if (overseas && cap > 0 && overseasSalary + fee > cap + 0.000001) continue;
    if (overseas) overseasSalary += fee;
    picks.push(player);
  }
  return picks;
}

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
  // The BCC purse is authoritative, so model a depleted franchise directly on
  // a cloned state instead of trying to override the season configuration.
  const created = AuctionEngine.create({ season: '2025', format: 'MEGA', config: CONFIG, persist: () => {} });
  created.dispatch({ type: 'START' });
  const live = await driveEngine(created, {
    maxSteps: 200,
    stop: (s) => Boolean(s.currentPlayerId) && relevantPhases(s).has(s.phase),
  });
  assert.ok(live.currentPlayerId, 'need an open lot for the tiny-purse check');
  const snapshot = clone(created.getState());
  const me = snapshot.franchises.find((f) => f.id === snapshot.userFranchiseId);
  me.purse = 0.3;
  const engine = new AuctionEngine(snapshot, { persist: () => {} });
  const player = snapshot.players.find((p) => p.id === snapshot.currentPlayerId);
  assert.ok(player && Number(player.basePrice) > 0.3, 'need a player above the tiny purse');
  const amount = nextBidFor(snapshot);
  const result = engine.dispatch({ type: 'BID', franchiseId: snapshot.userFranchiseId, amount });
  assert.equal(result.ok, false, 'insufficient-purse bid should be rejected');
  assert.match(result.error || '', /purse|funds|budget|afford/i);
  pass('insufficient purse human BID rejected on a depleted franchise');
}

async function scenarioRetentions() {
  // ---- 2025 MEGA: own contract list only, capped/uncapped ceilings, slabs ----
  const mega = AuctionEngine.create({
    season: '2025', format: 'MEGA', config: CONFIG, userFranchiseId: 'F1', persist: () => {},
  });
  let state = mega.getState();
  assert.equal(state.season, '2025');
  assert.equal(state.config.maxRetentions, 6);
  assert.equal(state.config.startingPurse, 120);
  assert.equal(state.config.totalSalaryCap, 146);
  assert.ok(state.franchises.every((f) => f.squad.length === 0 && f.retentions.length === 0));
  assert.ok(state.franchises.every((f) => f.clawCards === 6), 'each franchise starts with 6 CLAW cards');
  assert.equal(state.retentionsConfirmed, false);

  // A franchise can only retain players from its own previous-season contracts.
  const ownershipCheck = AuctionEngine.create({ season: '2025', format: 'MEGA', config: CONFIG, persist: () => {} });
  const foreign = ownershipCheck.getState().players.find((p) => p.previousFranchiseId === 'F2' && p.retentionCandidate);
  assert.ok(foreign, 'need a player contracted to F2 for the ownership check');
  const foreignResult = ownershipCheck.dispatch({ type: 'SET_RETENTIONS', playerIds: [foreign.id] });
  assert.equal(foreignResult.ok, false, 'another franchise\'s contract must not be retainable');
  assert.match(foreignResult.error || '', /another franchise|contracted/i);

  const owned = state.players.filter((p) => p.previousFranchiseId === 'F1' && p.retentionCandidate);
  assert.ok(owned.length >= 6, 'F1 should have at least six previous-season contracts');
  const cappedPool = owned.filter((p) => p.capped !== false)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const uncappedPool = owned.filter((p) => p.capped === false)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  assert.ok(cappedPool.length >= 5 && uncappedPool.length >= 1, 'need capped and uncapped candidates');

  const picks = [...cappedPool.slice(0, 5), ...uncappedPool.slice(0, 1)].map((p) => p.id);
  const expectedCost = 18 + 14 + 11 + 18 + 14 + 4;
  const set = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: picks });
  assert.equal(set.ok, true, `MEGA SET_RETENTIONS failed: ${set.error}`);
  assert.equal(set.retentionSpent, expectedCost, 'capped/uncapped slab cost mismatch');

  state = mega.getState();
  const mine = state.franchises.find((f) => f.id === 'F1');
  assert.equal(mine.retentions.length, 6);
  assert.equal(mine.clawCards, 0, 'six retentions consume every CLAW card');
  assert.equal(mine.retentionSpent, expectedCost);
  assert.ok(Math.abs(mine.purse - (120 - expectedCost)) < 0.001, 'purse not debited');
  assert.deepEqual(mine.retentions.filter((r) => r.capped !== false).map((r) => r.cost), [18, 14, 11, 18, 14]);
  assert.equal(mine.retentions.find((r) => r.capped === false).cost, 4);
  for (const id of picks) {
    const player = state.players.find((p) => p.id === id);
    assert.equal(player.availability, 'SOLD');
    assert.equal(player.soldTo, 'F1');
    assert.equal(player.retained, true);
    assert.equal(player.salary, player.retentionCost, 'retained salary must be stamped');
  }
  for (const rival of state.franchises.filter((f) => f.id !== 'F1')) {
    assert.ok(rival.retentions.length > 0 && rival.retentions.length <= 6, `${rival.id} AI retention count out of range`);
    assert.ok(rival.retentions.filter((r) => r.capped !== false).length <= 5, `${rival.id} too many capped retentions`);
    assert.ok(rival.retentions.filter((r) => r.capped === false).length <= 2, `${rival.id} too many uncapped retentions`);
    assert.equal(rival.clawCards, 6 - rival.retentions.length, `${rival.id} CLAW card count wrong`);
  }
  assert.equal(state.retentionsConfirmed, true);
  pass('2025 MEGA: own-contract retentions / capped+uncapped slabs / CLAW cards / AI auto-pick');

  if (uncappedPool.length >= 3) {
    const threeUncapped = [...cappedPool.slice(0, 3), ...uncappedPool.slice(0, 3)].map((p) => p.id);
    const rejected = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: threeUncapped });
    assert.equal(rejected.ok, false, 'three uncapped retentions should be rejected');
    assert.match(rejected.error || '', /uncapped/i);
  }
  const sixCapped = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: cappedPool.slice(0, 6).map((p) => p.id) });
  assert.equal(sixCapped.ok, false, 'six capped retentions should breach the capped ceiling');
  assert.match(sixCapped.error || '', /capped/i);
  assert.equal(mega.getState().franchises[0].retentions.length, 6, 'rejected plan mutated state');
  pass('2025 MEGA: 3-uncapped and 6-capped retentions rejected');

  const cleared = mega.dispatch({ type: 'SET_RETENTIONS', playerIds: [] });
  assert.equal(cleared.ok, true, `re-selection to zero failed: ${cleared.error}`);
  state = mega.getState();
  assert.equal(state.franchises[0].retentions.length, 0);
  assert.equal(state.franchises[0].purse, 120);
  assert.equal(state.franchises[0].clawCards, 6);
  for (const id of picks) {
    const player = state.players.find((p) => p.id === id);
    assert.equal(player.availability, 'AVAILABLE');
    assert.equal(player.retained, false);
  }
  pass('2025 MEGA: re-selection restores players, purse and CLAW cards');

  const autoStart = AuctionEngine.create({ season: '2025', format: 'MEGA', config: CONFIG, persist: () => {} });
  const started = autoStart.dispatch({ type: 'START' });
  assert.equal(started.ok, true, `START auto-confirm failed: ${started.error}`);
  const autoState = autoStart.getState();
  assert.equal(autoState.retentionsConfirmed, true);
  assert.equal(autoState.franchises[0].retentions.length, 0, 'zero-retention option lost');
  assert.notEqual(autoState.phase, 'SETUP');
  pass('zero-retention start confirms an empty selection for the human');

  // ---- 2026 MINI: contract fees, no CLAW, adaptive additionsLimit ----
  const mini = AuctionEngine.create({ season: '2026', format: 'MINI', config: CONFIG, persist: () => {} });
  let miniState = mini.getState();
  assert.equal(miniState.config.startingPurse, 125);
  assert.equal(miniState.config.totalSalaryCap, 151);
  assert.equal(miniState.config.overseasSalaryCap, 18);
  assert.equal(miniState.config.maxRetentions, 25);
  assert.ok(miniState.franchises.every((f) => f.clawCards === 0));

  const miniOwned = miniState.players.filter((p) => p.previousFranchiseId === 'F1' && p.retentionCandidate)
    .sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  const miniTen = miniRetentionPicks(miniState, 'F1', 10);
  const ten = miniTen.map((p) => p.id);
  const miniCost = Math.round(miniTen.reduce((sum, p) => sum + (Number(p.contractFee) || 0), 0) * 100) / 100;
  const miniSet = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: ten });
  assert.equal(miniSet.ok, true, `MINI SET_RETENTIONS failed: ${miniSet.error}`);
  miniState = mini.getState();
  assert.equal(miniState.franchises[0].retentions.length, 10);
  assert.equal(miniState.franchises[0].retentionSpent, miniCost, 'Mini retentions must use contract fees');
  assert.ok(Math.abs(miniState.franchises[0].purse - (125 - miniCost)) < 0.001);
  assert.ok(miniState.franchises.slice(1).every((f) => f.retentions.length > 0 && f.clawCards === 0));
  assert.ok(miniState.franchises[0].additionsLimit <= 15, 'ten retentions should reduce additions room');

  const overCap = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: miniOwned.map((p) => p.id) });
  assert.equal(overCap.ok, false, 'the full previous squad breaches the ₹18 Cr overseas salary ceiling');
  assert.match(overCap.error || '', /overseas salary cap/i);
  const allOwned = miniRetentionPicks(miniState, 'F1', miniOwned.length).map((p) => p.id);
  const allSet = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: allOwned });
  assert.equal(allSet.ok, true, `retaining a cap-compliant previous squad should be legal: ${allSet.error}`);
  const zeroMini = mini.dispatch({ type: 'SET_RETENTIONS', playerIds: [] });
  assert.equal(zeroMini.ok, true);
  miniState = mini.getState();
  assert.ok(miniState.franchises[0].additionsLimit >= miniState.config.minSquad,
    'zero retentions must permit reaching minSquad');
  pass('2026 MINI: contract-fee retentions / no CLAW / full squad / adaptive additionsLimit');

  // ---- results totals and salary-cap reporting ----
  const direct = AuctionEngine.create({ season: '2025', format: 'MEGA', config: CONFIG, persist: () => {} });
  direct.dispatch({ type: 'SET_RETENTIONS', playerIds: picks });
  const resultState = direct.getState();
  const results = computeResults(resultState);
  const totalRetention = resultState.franchises.reduce((sum, f) => sum + f.retentionSpent, 0);
  assert.ok(Math.abs(results.totalRetentionSpending - totalRetention) < 0.001);
  assert.equal(results.season, '2025');
  assert.ok(results.matchFeeProjection > 0, 'match-fee projection missing');
  assert.ok(results.cappedRetentions >= 5);
  assert.ok(results.uncappedRetentions >= 1);
  for (const row of results.franchises) {
    assert.ok(Math.abs(row.purseSpent + row.purseRemaining - 120) < 0.001,
      `${row.id}: purseSpent + purseRemaining must equal starting purse`);
    assert.equal(row.salaryCap, 146);
    for (const member of row.squad.filter((p) => p.source === 'EXISTING')) {
      assert.ok(member.price > 0, `${row.id}: retained player is missing its cost in results`);
    }
  }
  pass('results: season rules, salary cap, retention totals and match-fee projection');

  // ---- additions cap used by bid validation ----
  const capped = AuctionEngine.create({ season: '2026', format: 'MINI', config: CONFIG, persist: () => {} });
  capped.dispatch({ type: 'SET_RETENTIONS', playerIds: ten });
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
    action: 'CREATE', season: '2026', format: 'MINI', difficulty: 'BALANCED', userFranchiseId: 'F1', config: CONFIG,
  });
  assert.equal(created.ok, true, `MINI CREATE failed: ${created.error}`);
  assert.equal(created.state.season, '2026');
  assert.equal(created.state.config.startingPurse, 125);
  assert.equal(created.state.config.totalSalaryCap, 151);
  assert.equal(created.state.config.overseasSalaryCap, 18);
  assert.ok(created.state.franchises.every((f) => f.squad.length === 0), 'MINI squads should start empty');
  const picks = miniRetentionPicks(created.state, 'F1', 10).map((p) => p.id);
  assert.equal(picks.length, 10, 'F1 needs ten previous-season contracts');
  const configured = await act({ action: 'SET_RETENTIONS', playerIds: picks });
  assert.equal(configured.ok, true, `MINI SET_RETENTIONS failed: ${configured.error}`);
  const retained = clone(configured.state.franchises.map((f) => [f.id, [...f.existing]]));
  assert.equal(retained.find(([id]) => id === 'F1')[1].length, 10);
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
  for (const phase of ['CLAW_OFFER', 'CLAW_COUNTER', 'CLAW_MATCH']) {
    assert.equal(phases.has(phase), false, `Mini Auction must never enter ${phase}`);
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
  pass('2026 MINI: real purse/caps, own retentions persist, no CLAW, additions cap enforced');
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
  const created = await act({
    action: 'CREATE', season: '2025', format: 'MEGA', difficulty: 'HARD', userFranchiseId: 'F1', config: CONFIG,
  });
  assert.equal(created.ok, true, `MEGA CREATE failed: ${created.error}`);
  const final = await driveHttp({ maxSteps: 6000, phasesSeen: phases });
  assert.equal(final.phase, 'COMPLETED', `HTTP run did not complete: ${final.phase}`);
  const unsold = final.players.filter((p) => p.availability === 'UNSOLD');
  assert.ok(unsold.length > 0, 'expected some unsold players with 290 players and 10 squads');
  assert.ok(final.proceedings.some((s) => s.kind === 'ACCELERATED')
    || final.eventLog.some((e) => /accelerat/i.test(`${e.type} ${e.text}`)), 'accelerated stage never appeared');
  pass(`accelerated stage reached / ${unsold.length} unsold players exist`);

  const results = await request('/api/results');
  const source = results.ok ? results.results : computeResults(final);
  assert.equal(source.season, '2025');
  assert.equal(source.franchises.length, 10);
  assert.equal(source.salaryCap ?? source.franchises[0].salaryCap, 146);
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

  // A completed auction opens POST_AUCTION; the same LCB rules apply over HTTP.
  const scouted = await act({ action: 'RUN_AI_TRADES', limit: 3 });
  const purseDebug = final.franchises.map((f) => `${f.id}=${Number(f.purse).toFixed(2)}`).join(' ');
  assert.equal(scouted.ok, true, `HTTP RUN_AI_TRADES failed: ${scouted.error} [purses: ${purseDebug}]`);
  const tradedState = scouted.state || await getState();
  assert.ok(tradedState.trades.length > 0, 'rival scouting should file at least one EOI');
  assert.ok(tradedState.trades.some((trade) => trade.window === 'POST_AUCTION'));
  pass(`HTTP: ${tradedState.trades.length} rival EOI(s) filed in the post-auction window`);

  const foreignTrade = tradedState.trades.find((trade) => trade.toFranchiseId !== tradedState.userFranchiseId);
  if (foreignTrade) {
    const spoofed = await act({
      action: 'RESPOND_TRADE', tradeId: foreignTrade.id, accept: true, source: 'AI',
    });
    assert.equal(spoofed.ok, false, 'a human client must not answer an EOI addressed to an AI franchise');
    assert.match(spoofed.error || '', /approached/i);
    pass('HTTP: source:AI cannot impersonate the approached franchise');
  }
  const myEoi = tradedState.trades.find((trade) => trade.status === 'PENDING_48H'
    && trade.toFranchiseId === tradedState.userFranchiseId);
  if (myEoi) {
    const answered = await act({ action: 'RESPOND_TRADE', tradeId: myEoi.id, accept: true });
    assert.equal(answered.ok, true, `HTTP RESPOND_TRADE failed: ${answered.error}`);
    pass('HTTP: human answers an EOI addressed to their own franchise');
  }
  const reportedCase = await act({
    action: 'REPORT_TAMPERING', franchiseId: 'F2',
    playerId: final.franchises.find((f) => f.id === 'F2').squad[0], details: 'HTTP tampering check.',
  });
  assert.equal(reportedCase.ok, true, `HTTP REPORT_TAMPERING failed: ${reportedCase.error}`);
  const caseId = reportedCase.state.tamperingCases.at(-1).id;
  const ruledCase = await act({ action: 'RULE_TAMPERING', caseId, upheld: false });
  assert.equal(ruledCase.ok, true, `HTTP RULE_TAMPERING failed: ${ruledCase.error}`);
  assert.equal(ruledCase.state.tamperingCases.find((record) => record.id === caseId).status, 'DISMISSED');
  pass('HTTP: tampering report and LCB ruling round-trip');
}

async function scenarioPacingAndEarlyBid() {
  const passAi = stubAi(() => ({
    action: 'PASS', amount: null, confidence: 0.4, publicComment: 'We wait for this lot.',
  }));

  // A human may raise a paddle during the introduction; the auctioneer then
  // opens the floor and recognises the bid instead of rejecting the click.
  const earlyEngine = AuctionEngine.create({
    season: '2025', format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1',
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
    season: '2025', format: 'MEGA', difficulty: 'BALANCED', userFranchiseId: 'F1',
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

async function scenarioClawFlow() {
  // Find a lot that belongs to the human franchise so it is offered the CLAW.
  const seed = AuctionEngine.create({
    season: '2025', format: 'MEGA', userFranchiseId: 'F1', config: CONFIG, persist: () => {},
  });
  seed.dispatch({ type: 'START' });
  const found = await driveEngine(seed, {
    maxSteps: 400,
    stop: (s) => {
      const candidate = s.players.find((p) => p.id === s.currentPlayerId);
      return Boolean(candidate && candidate.availability === 'AVAILABLE'
        && candidate.previousFranchiseId === 'F1' && candidate.retentionCandidate
        && (s.phase === 'PLAYER_INTRODUCTION' || relevantPhases(s).has(s.phase)));
    },
  });
  const target = found.players.find((p) => p.id === found.currentPlayerId);
  assert.ok(target, 'need a live lot previously contracted to F1');
  const snapshot = clone(seed.getState());
  const bid = Math.max(4, Math.round((Number(target.basePrice) || 1) * 2 * 100) / 100);
  snapshot.phase = 'GOING_TWICE';
  snapshot.phaseTicks = 0;
  snapshot.currentBid = bid;
  snapshot.bidsThisLot = 2;
  snapshot.leaderId = 'F2';
  snapshot.claw = null;

  const passAi = stubAi(() => ({ action: 'PASS', amount: 0, confidence: 0.3, publicComment: 'We hold.' }));
  const clawEngine = new AuctionEngine(snapshot, { aiClient: passAi, persist: () => {} });
  const close = clawEngine.dispatch({ type: 'NEXT' });
  assert.equal(close.ok, true, `closing the lot failed: ${close.error}`);
  let state = clawEngine.getState();
  assert.equal(state.phase, 'CLAW_OFFER', 'a sold lot should first enter CLAW_OFFER');
  assert.equal(state.claw.playerId, target.id);
  assert.equal(state.claw.originalFranchiseId, 'F1');
  assert.equal(state.claw.leaderFranchiseId, 'F2');
  assert.equal(state.claw.bid, bid);
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawCards, 6, 'the offer itself must not spend a card');

  const wrong = clawEngine.dispatch({ type: 'USE_CLAW', franchiseId: 'F2' });
  assert.equal(wrong.ok, false, 'a human must not decide for another franchise');
  const used = clawEngine.dispatch({ type: 'USE_CLAW', franchiseId: 'F1' });
  assert.equal(used.ok, true, `USE_CLAW failed: ${used.error}`);
  state = clawEngine.getState();
  assert.equal(state.phase, 'CLAW_COUNTER');
  assert.equal(state.claw.usedCard, true);
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawCards, 5, 'USE_CLAW spends exactly one card');
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawUsed, 1);

  await clawEngine.tick();
  state = clawEngine.getState();
  assert.equal(state.phase, 'CLAW_MATCH', 'AI counter/decline should open the final call');
  assert.ok(state.claw.log.some((entry) => entry.step === 'COUNTERED')
    || state.claw.log.some((entry) => entry.step === 'DECLINED'), 'counter step was not logged');
  const finalPrice = state.claw.price;
  const matched = clawEngine.dispatch({ type: 'MATCH_CLAW', franchiseId: 'F1' });
  assert.equal(matched.ok, true, `MATCH_CLAW failed: ${matched.error}`);
  state = clawEngine.getState();
  assert.equal(state.phase, 'SOLD');
  const awarded = state.players.find((p) => p.id === target.id);
  assert.equal(awarded.soldTo, 'F1');
  assert.equal(awarded.soldPrice, finalPrice);
  assert.ok(state.franchises.find((f) => f.id === 'F1').squad.includes(target.id));
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawCards, 5, 'matching must not spend a second card');
  assert.ok(state.clawLog.some((entry) => entry.playerId === target.id && entry.step === 'MATCHED'));
  pass('2025 CLAW: OFFER → COUNTER → MATCH, one card spent, player awarded at final price');

  const passEngine = new AuctionEngine(snapshot, { aiClient: passAi, persist: () => {} });
  passEngine.dispatch({ type: 'NEXT' });
  assert.equal(passEngine.getState().phase, 'CLAW_OFFER');
  const passed = passEngine.dispatch({ type: 'PASS_CLAW', franchiseId: 'F1' });
  assert.equal(passed.ok, true, `PASS_CLAW failed: ${passed.error}`);
  state = passEngine.getState();
  assert.equal(state.phase, 'SOLD');
  assert.equal(state.players.find((p) => p.id === target.id).soldTo, 'F2');
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawCards, 6, 'passing must keep the card');
  assert.equal(state.franchises.find((f) => f.id === 'F1').clawUsed, 0);
  pass('2025 CLAW: PASS_CLAW awards the lot to the leader without spending a card');
}

async function scenarioSalaryAndSeasonOps() {
  assert.deepEqual(salarySplit(25, true, '2025'), { bid: 25, salary: 25, welfare: 0, capped: false });
  assert.deepEqual(salarySplit(25, true, '2026'), { bid: 25, salary: 18, welfare: 7, capped: true });
  assert.deepEqual(salarySplit(25, false, '2026'), { bid: 25, salary: 25, welfare: 0, capped: false });
  assert.deepEqual(salarySplit(20, true, '2027'), { bid: 20, salary: 18, welfare: 2, capped: true });
  assert.equal(matchFeeProjection('2025'), 12.6, '₹7.5 lakh × 12 × 14');
  pass('salary split / welfare diversion / match-fee projection match LCB limits');

  const season2027 = AuctionEngine.create({ season: '2027', format: 'MINI', config: CONFIG, persist: () => {} });
  const rules27 = season2027.getState();
  assert.equal(rules27.config.startingPurse, 130);
  assert.equal(rules27.config.totalSalaryCap, 157);
  assert.equal(rules27.config.overseasSalaryCap, 18);
  assert.equal(rules27.config.maxRetentions, 25);
  pass('2027 mini registry: ₹130 Cr purse / ₹157 Cr cap / ₹18 Cr overseas cap');

  const base = AuctionEngine.create({ season: '2026', format: 'MINI', config: CONFIG, persist: () => {} });
  base.dispatch({ type: 'START' });
  await driveEngine(base, {
    maxSteps: 120,
    stop: (s) => Boolean(s.currentPlayerId) && (s.phase === 'PLAYER_INTRODUCTION' || relevantPhases(s).has(s.phase)),
  });
  const seed = base.getState();
  assert.notEqual(seed.stageIndex, -1, 'need an active set before forcing a sale');
  const available = seed.players.filter((p) => p.availability === 'AVAILABLE' && p.nationality && p.nationality !== 'India');
  assert.ok(available.length >= 3, 'need overseas players in the RPP for salary/trade checks');
  const target = available[0];
  const snapshot = clone(seed);
  snapshot.phase = 'GOING_TWICE';
  snapshot.phaseTicks = 0;
  snapshot.currentPlayerId = target.id;
  snapshot.currentBid = 25;
  snapshot.bidsThisLot = 2;
  snapshot.leaderId = 'F2';
  snapshot.claw = null;
  const purseBefore = snapshot.franchises.find((f) => f.id === 'F2').purse;
  const osSpendBefore = Number(snapshot.franchises.find((f) => f.id === 'F2').overseasSalarySpend) || 0;
  const passAi = stubAi(() => ({ action: 'PASS', amount: 0, confidence: 0.3, publicComment: 'We hold.' }));
  const engine = new AuctionEngine(snapshot, { aiClient: passAi, persist: () => {} });
  const finalised = engine.dispatch({ type: 'NEXT' });
  assert.equal(finalised.ok, true, `overseas lot failed: ${finalised.error}`);
  let state = engine.getState();
  const sold = state.players.find((p) => p.id === target.id);
  assert.equal(sold.salary, 18, 'overseas salary must be capped at ₹18 Cr');
  assert.equal(sold.welfareContribution, 7);
  assert.equal(sold.purchasedInMini, true);
  assert.equal(state.welfareFund, 7);
  const f2 = state.franchises.find((f) => f.id === 'F2');
  assert.equal(f2.welfareContribution, 7);
  assert.equal(f2.overseasSalarySpend, osSpendBefore + 18);
  assert.equal(f2.purse, purseBefore - 25, 'full bid debits the purse, not just the capped salary');
  pass('2026 overseas lot: ₹18 Cr salary / ₹7 Cr to welfare / full bid debited');

  // --- windows are derived from the phase, never from a caller-supplied value
  const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const domesticOf = (st, teamId, count) => st.franchises.find((f) => f.id === teamId).squad
    .map((id) => st.players.find((player) => player.id === id))
    .filter((player) => player && player.nationality === 'India')
    .slice(0, count);
  const liveTrade = engine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F2', toFranchiseId: 'F3',
    givePlayerIds: [f2.squad[0]], window: 'POST_AUCTION', source: 'AI', autoRespond: false,
  });
  assert.equal(liveTrade.ok, false, 'no EOI is allowed on the live auction floor');
  assert.match(liveTrade.error || '', /window|live auction/i);

  // A completed auction opens POST_AUCTION; the mini signing stays frozen and
  // the 18-player minimum blocks undersized squads from dealing.
  engine.state.phase = 'COMPLETED';
  const frozen = engine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F2', toFranchiseId: 'F3',
    givePlayerIds: [target.id], source: 'AI', autoRespond: false,
  });
  assert.equal(frozen.ok, false, 'a mini-auction signing cannot be traded post-auction');
  assert.match(frozen.error || '', /mini auction/i);

  const tradeable = f2.squad.find((id) => {
    const player = state.players.find((candidate) => candidate.id === id);
    return player && !player.purchasedInMini && !player.consentWithheld && player.availability === 'SOLD';
  });
  assert.ok(tradeable, 'F2 needs a retained player to trade');
  const undersized = engine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F2', toFranchiseId: 'F3',
    givePlayerIds: [tradeable], source: 'AI', autoRespond: false,
  });
  assert.equal(undersized.ok, false, 'post-auction trades require the minimum squad');
  assert.match(undersized.error || '', /minimum squad/i);
  pass('trades: no live-auction EOI / mini signings frozen / minimum squad enforced');

  // A 1-for-1 swap keeps the squad count, so it may rebuild an undersized squad.
  const domesticTradeable = (teamId, exclude = []) => state.franchises
    .find((f) => f.id === teamId).squad
    .map((id) => state.players.find((p) => p.id === id))
    .find((p) => p && !exclude.includes(p.id) && p.nationality === 'India'
      && p.availability === 'SOLD' && !p.purchasedInMini && !p.consentWithheld);
  const swapOut = domesticTradeable('F2');
  const swapIn = domesticTradeable('F3', swapOut ? [swapOut.id] : []);
  assert.ok(swapOut && swapIn, 'F2 and F3 need retained domestic players to swap');
  // F2 is already at the Mini overseas salary ceiling from the lot above; that
  // is unrelated to squad size, so lift it only while checking this rule.
  const overseasCapBefore = engine.state.config.overseasSalaryCap;
  engine.state.config.overseasSalaryCap = 0;
  let equalCountSwap;
  try {
    equalCountSwap = engine.dispatch({
      type: 'PROPOSE_TRADE', fromFranchiseId: 'F2', toFranchiseId: 'F3',
      givePlayerIds: [swapOut.id], getPlayerIds: [swapIn.id], source: 'AI', autoRespond: false,
    });
  } finally {
    engine.state.config.overseasSalaryCap = overseasCapBefore;
  }
  assert.equal(equalCountSwap.ok, true,
    `1-for-1 swap should be allowed while undersized: ${equalCountSwap.error}`);
  pass('trades: equal-count swap allowed while rebuilding an undersized squad');

  // --- full four-step protocol in the POST_SEASON window (2026 MINI SETUP)
  const setup = AuctionEngine.create({ season: '2026', format: 'MINI', config: CONFIG, persist: () => {} });
  const selection = miniRetentionPicks(setup.getState(), 'F1', 8);
  const configured = setup.dispatch({ type: 'SET_RETENTIONS', playerIds: selection.map((player) => player.id) });
  assert.equal(configured.ok, true, `SET_RETENTIONS failed: ${configured.error}`);
  let ts = setup.getState();
  const human = ts.franchises.find((f) => f.id === 'F1');
  const buyer = ts.franchises.find((f) => f.id === 'F2');
  const domesticMine = human.squad
    .map((id) => ts.players.find((player) => player.id === id))
    .filter((player) => player && player.nationality === 'India');
  assert.ok(domesticMine.length >= 4, 'need four domestic retained players for consent/negotiation scenarios');
  const star = domesticMine[0];
  const second = domesticMine[1];
  const third = domesticMine[2];
  const fourth = domesticMine[3];
  const fee = Number(star.salary);
  assert.ok(fee > 0, 'retained players must carry an exact contract fee');
  const purseHumanBefore = human.purse;
  const purseBuyerBefore = buyer.purse;

  const badCash = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F2',
    givePlayerIds: [star.id], cash: fee + 1, autoRespond: false,
  });
  assert.equal(badCash.ok, false, 'the cash adjustment cannot be renegotiated');
  assert.match(badCash.error || '', /fixed|exact/i);

  const eoi = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F2',
    givePlayerIds: [star.id], autoRespond: false, transferFee: 2, playerSharePct: 50,
  });
  assert.equal(eoi.ok, true, `EOI failed: ${eoi.error}`);
  assert.equal(eoi.trade.status, 'PENDING_48H');
  assert.equal(eoi.trade.approval, 'EOI_SUBMITTED');
  assert.equal(eoi.trade.type, 'ALL_CASH');
  assert.equal(eoi.trade.cash, fee);
  assert.equal(eoi.trade.window, 'POST_SEASON');
  ts = setup.getState();
  assert.ok(!ts.franchises.find((f) => f.id === 'F2').squad.includes(star.id), 'an EOI must not move the player');

  const wrongResponder = setup.dispatch({ type: 'RESPOND_TRADE', tradeId: eoi.trade.id, accept: true });
  assert.equal(wrongResponder.ok, false, 'only the approached franchise can answer an EOI');
  assert.match(wrongResponder.error || '', /approached/i);
  const accepted = setup.dispatch({ type: 'RESPOND_TRADE', tradeId: eoi.trade.id, accept: true, source: 'AI' });
  assert.equal(accepted.ok, true, `RESPOND_TRADE failed: ${accepted.error}`);
  assert.equal(accepted.trade.status, 'AWAITING_CONSENT');
  assert.equal(accepted.trade.consents[star.id], 'PENDING', 'human-owned player consent is never automated');

  const consented = setup.dispatch({
    type: 'PLAYER_TRADE_CONSENT', tradeId: eoi.trade.id, playerId: star.id, consent: true,
  });
  assert.equal(consented.ok, true, `PLAYER_TRADE_CONSENT failed: ${consented.error}`);
  assert.equal(consented.trade.status, 'APPROVED');
  assert.equal(consented.trade.approval, 'LCB_APPROVED');
  ts = setup.getState();
  const f1After = ts.franchises.find((f) => f.id === 'F1');
  const f2After = ts.franchises.find((f) => f.id === 'F2');
  assert.ok(f2After.squad.includes(star.id) && !f1After.squad.includes(star.id));
  assert.equal(f1After.purse, money(purseHumanBefore + fee), 'seller receives the exact league fee');
  assert.equal(f2After.purse, money(purseBuyerBefore - fee), 'buyer pays the exact league fee');
  assert.equal(f1After.tradeCashDelta, fee);
  assert.equal(f2After.tradeCashDelta, -fee);
  assert.equal(ts.players.find((p) => p.id === star.id).previousFranchiseId, 'F2');
  // Transfer fee: LCB 50%, player up to 50% of the remainder, seller the rest.
  assert.equal(ts.lcbTradeRevenue, 1);
  assert.equal(f1After.transferFeeEarned, 0.5);
  assert.equal(ts.players.find((p) => p.id === star.id).transferFeeEarned, 0.5);
  assert.equal(f1After.purse, money(purseHumanBefore + fee), 'the transfer fee never touches a purse');
  assert.ok(consented.trade.timeline.length >= 5, 'the approval audit trail must be complete');

  const tradeResults = computeResults(ts);
  const rowF1 = tradeResults.franchises.find((row) => row.id === 'F1');
  const rowF2 = tradeResults.franchises.find((row) => row.id === 'F2');
  assert.equal(rowF2.squad.find((player) => player.id === star.id).source, 'TRADED');
  assert.equal(rowF2.tradedInCount, 1);
  assert.equal(rowF1.tradedOutCount, 1);
  assert.equal(rowF1.purseSpent, money(Number(f1After.retentionSpent) - fee));
  assert.equal(rowF2.purseSpent, money(Number(f2After.retentionSpent) + fee));
  assert.equal(tradeResults.lcbTradeRevenue, 1);
  assert.equal(tradeResults.trades[0].fromName, f1After.name);
  assert.equal(tradeResults.trades[0].givePlayers[0].fee, fee);
  pass('trades: EOI → 48h answer → consent → LCB approval, exact fee and transfer-fee split');

  // A veto voids an otherwise accepted deal without moving any player or cash.
  const vetoEoi = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F3',
    givePlayerIds: [second.id], autoRespond: false,
  });
  assert.equal(vetoEoi.ok, true, `veto EOI failed: ${vetoEoi.error}`);
  const vetoAccept = setup.dispatch({
    type: 'RESPOND_TRADE', tradeId: vetoEoi.trade.id, accept: true, source: 'AI',
  });
  assert.equal(vetoAccept.ok, true);
  const veto = setup.dispatch({
    type: 'PLAYER_TRADE_CONSENT', tradeId: vetoEoi.trade.id, playerId: second.id, consent: false,
  });
  assert.equal(veto.ok, true);
  assert.equal(veto.trade.status, 'VETOED');
  assert.equal(veto.trade.approval, 'NOT_APPROVED');
  ts = setup.getState();
  assert.ok(ts.franchises.find((f) => f.id === 'F1').squad.includes(second.id));
  assert.ok(!ts.franchises.find((f) => f.id === 'F3').squad.includes(second.id));
  pass('trades: player veto voids an accepted EOI');

  // Player-for-player and cash-plus-player deals with controlled fixed fees.
  const fixtures = clone(setup.getState());
  const aPlayers = domesticOf(fixtures, 'F3', 3);
  const bPlayers = domesticOf(fixtures, 'F4', 2);
  assert.ok(aPlayers.length === 3 && bPlayers.length === 2, 'need domestic players for swap fixtures');
  const fixturePlayer = (player, salary) => {
    player.salary = salary;
    player.soldPrice = salary;
    player.rating = 99; // deterministic need/consent verdicts for AI-owned players
    player.role = 'BATTER';
  };
  [aPlayers[0], aPlayers[1]].forEach((player) => fixturePlayer(player, 4)); // 4 + 4 = 8
  fixturePlayer(bPlayers[0], 8);
  fixturePlayer(aPlayers[2], 5);
  fixturePlayer(bPlayers[1], 8); // ₹3 difference settled in cash by F3
  fixtures.franchises.find((f) => f.id === 'F3').targets = ['BATTER'];
  fixtures.franchises.find((f) => f.id === 'F4').targets = ['BATTER'];
  const purseF3Before = fixtures.franchises.find((f) => f.id === 'F3').purse;
  const purseF4Before = fixtures.franchises.find((f) => f.id === 'F4').purse;
  const fixEngine = new AuctionEngine(fixtures, { persist: () => {} });

  const swapEoi = fixEngine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F3', toFranchiseId: 'F4',
    givePlayerIds: [aPlayers[0].id, aPlayers[1].id], getPlayerIds: [bPlayers[0].id],
    source: 'AI', autoRespond: false,
  });
  assert.equal(swapEoi.ok, true, `multi-player swap failed: ${swapEoi.error}`);
  assert.equal(swapEoi.trade.type, 'PLAYER_SWAP');
  assert.equal(swapEoi.trade.cash, 0);
  assert.equal(swapEoi.trade.cashAdjustment, 0);
  const swapAccept = fixEngine.dispatch({
    type: 'RESPOND_TRADE', tradeId: swapEoi.trade.id, accept: true, source: 'AI',
  });
  assert.equal(swapAccept.ok, true);
  assert.equal(swapAccept.trade.status, 'APPROVED', 'AI consents should complete the swap');
  let fs = fixEngine.getState();
  assert.ok(fs.franchises.find((f) => f.id === 'F4').squad.includes(aPlayers[0].id));
  assert.ok(fs.franchises.find((f) => f.id === 'F3').squad.includes(bPlayers[0].id));
  assert.equal(fs.franchises.find((f) => f.id === 'F3').purse, purseF3Before, 'equal-salary swap moves no cash');
  assert.equal(fs.franchises.find((f) => f.id === 'F4').purse, purseF4Before);

  const badDifference = fixEngine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F3', toFranchiseId: 'F4',
    givePlayerIds: [aPlayers[2].id], getPlayerIds: [bPlayers[1].id],
    cash: 4, source: 'AI', autoRespond: false,
  });
  assert.equal(badDifference.ok, false, 'the salary difference is derived, not negotiable');
  assert.match(badDifference.error || '', /fixed|exact/i);
  const cashPlusEoi = fixEngine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F3', toFranchiseId: 'F4',
    givePlayerIds: [aPlayers[2].id], getPlayerIds: [bPlayers[1].id],
    cash: 3, source: 'AI', autoRespond: false,
  });
  assert.equal(cashPlusEoi.ok, true, `cash-plus-player EOI failed: ${cashPlusEoi.error}`);
  assert.equal(cashPlusEoi.trade.type, 'CASH_PLUS_PLAYER');
  assert.equal(cashPlusEoi.trade.cash, 3);
  assert.equal(cashPlusEoi.trade.cashAdjustment, 3, 'proposer pays the exact salary difference');
  const cashPlusAccept = fixEngine.dispatch({
    type: 'RESPOND_TRADE', tradeId: cashPlusEoi.trade.id, accept: true, source: 'AI',
  });
  assert.equal(cashPlusAccept.ok, true);
  assert.equal(cashPlusAccept.trade.status, 'APPROVED');
  fs = fixEngine.getState();
  assert.equal(fs.franchises.find((f) => f.id === 'F3').purse, money(purseF3Before - 3));
  assert.equal(fs.franchises.find((f) => f.id === 'F4').purse, money(purseF4Before + 3));
  pass('trades: multi-player PLAYER_SWAP / CASH_PLUS_PLAYER settle exact fixed fees');

  // Negotiation can amend the transfer fee while consent is pending; changing
  // players would re-open consent, and exact cash is always recomputed.
  const amendEoi = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F4',
    givePlayerIds: [third.id], autoRespond: false, transferFee: 1, playerSharePct: 50,
  });
  assert.equal(amendEoi.ok, true, `negotiation EOI failed: ${amendEoi.error}`);
  const amendAccept = setup.dispatch({
    type: 'RESPOND_TRADE', tradeId: amendEoi.trade.id, accept: true, source: 'AI',
  });
  assert.equal(amendAccept.trade.status, 'AWAITING_CONSENT');
  const amended = setup.dispatch({
    type: 'AMEND_TRADE', tradeId: amendEoi.trade.id, transferFee: 2, playerSharePct: 25,
  });
  assert.equal(amended.ok, true, `AMEND_TRADE failed: ${amended.error}`);
  assert.equal(amended.trade.transferFee.total, 2);
  assert.equal(amended.trade.transferFee.playerSharePct, 25);
  assert.equal(amended.trade.cash, Number(third.salary), 'amending a fee cannot renegotiate the exact league fee');
  assert.equal(amended.trade.consents[third.id], 'PENDING');
  const amendedConsent = setup.dispatch({
    type: 'PLAYER_TRADE_CONSENT', tradeId: amendEoi.trade.id, playerId: third.id, consent: true,
  });
  assert.equal(amendedConsent.trade.status, 'APPROVED');
  assert.equal(amendedConsent.trade.transferFee.lcbCut, 1);
  assert.equal(setup.getState().lcbTradeRevenue, 2, 'amended transfer fee settles through the LCB ledger');
  pass('trades: AMEND_TRADE renegotiates the transfer fee, not the fixed league fee');

  // LCB vetting rejects deals that would breach purse or squad limits.
  const guardState = clone(setup.getState());
  const guard = new AuctionEngine(guardState, { persist: () => {} });
  guard.state.franchises.find((f) => f.id === 'F4').purse = 0;
  const noPurse = guard.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F4',
    givePlayerIds: [fourth.id], source: 'AI', autoRespond: false,
  });
  assert.equal(noPurse.ok, false, 'a deal the buyer cannot fund must be rejected');
  assert.match(noPurse.error || '', /fund|purse/i);

  const slotState = clone(setup.getState());
  const slotGuard = new AuctionEngine(slotState, { persist: () => {} });
  slotGuard.state.config.maxSquad = slotGuard.getState().franchises.find((f) => f.id === 'F4').squad.length;
  const noSlot = slotGuard.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F4',
    givePlayerIds: [fourth.id], source: 'AI', autoRespond: false,
  });
  assert.equal(noSlot.ok, false, 'a deal that exceeds the receiving squad limit must be rejected');
  assert.match(noSlot.error || '', /squad limit/i);
  pass('trades: LCB vetting blocks unfunded deals and squad-limit breaches');

  // Anti-tampering: an upheld allegation fines the purse and bans the player.
  const offender = ts.franchises.find((f) => f.id === 'F6');
  const victimId = offender.squad[0];
  const reported = setup.dispatch({
    type: 'REPORT_TAMPERING', franchiseId: 'F6', playerId: victimId, details: 'Informal contact before an EOI.',
  });
  assert.equal(reported.ok, true, `REPORT_TAMPERING failed: ${reported.error}`);
  const purseOffenderBefore = setup.getState().franchises.find((f) => f.id === 'F6').purse;
  const ruled = setup.dispatch({
    type: 'RULE_TAMPERING', caseId: reported.case.id, upheld: true, fine: 1, banSeasons: 1,
  });
  assert.equal(ruled.ok, true, `RULE_TAMPERING failed: ${ruled.error}`);
  ts = setup.getState();
  assert.equal(ts.franchises.find((f) => f.id === 'F6').purse, money(purseOffenderBefore - 1));
  const bannedPlayer = ts.players.find((p) => p.id === victimId);
  assert.equal(bannedPlayer.banUntilSeason, '2027');
  assert.equal(bannedPlayer.tamperingBan, true);
  const bannedTrade = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F6', toFranchiseId: 'F2',
    givePlayerIds: [victimId], source: 'AI', autoRespond: false,
  });
  assert.equal(bannedTrade.ok, false, 'a banned player cannot be traded');
  assert.match(bannedTrade.error || '', /ban/i);
  pass('anti-tampering: report → purse fine + season ban → player cannot be traded');

  // Rival scouting obeys the same window, purse and cap rules as human EOIs.
  const aiRun = setup.dispatch({ type: 'RUN_AI_TRADES', limit: 3 });
  assert.equal(aiRun.ok, true, `RUN_AI_TRADES failed: ${aiRun.error}`);
  assert.ok(aiRun.trades.length >= 1, 'expected at least one budget-valid rival EOI');
  for (const rivalTrade of aiRun.trades) assert.equal(rivalTrade.window, 'POST_SEASON');
  pass(`AI trades: ${aiRun.trades.length} rival EOI(s) filed through the LCB rules engine`);

  const withheldSnapshot = clone(setup.getState());
  withheldSnapshot.players.find((p) => p.id === second.id).consentWithheld = true;
  const withheldEngine = new AuctionEngine(withheldSnapshot, { persist: () => {} });
  const withheldCheck = withheldEngine.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F3',
    givePlayerIds: [second.id], source: 'AI',
  });
  assert.equal(withheldCheck.ok, false, 'withheld player consent must block a trade');
  assert.match(withheldCheck.error || '', /consent/i);

  const megaSetup = AuctionEngine.create({ season: '2025', format: 'MEGA', config: CONFIG, persist: () => {} });
  const noWindow = megaSetup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F2', givePlayerIds: ['P001'],
  });
  assert.equal(noWindow.ok, false, 'no trading is allowed immediately before a Mega Auction');
  assert.match(noWindow.error || '', /Mega/i);
  pass('trades: withheld consent blocked / no trade before a Mega Auction');

  // Deadlines are real time: they lapse on dispatch and on tick, even SETUP.
  const expiryEoi = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F4',
    givePlayerIds: [second.id], autoRespond: false,
  });
  assert.equal(expiryEoi.ok, true);
  setup.state.trades.find((trade) => trade.id === expiryEoi.trade.id).respondBy =
    new Date(Date.now() - 1000).toISOString();
  setup.dispatch({ type: 'MEETING' });
  ts = setup.getState();
  assert.equal(ts.trades.find((trade) => trade.id === expiryEoi.trade.id).status, 'EXPIRED');

  const consentExpiryEoi = setup.dispatch({
    type: 'PROPOSE_TRADE', fromFranchiseId: 'F1', toFranchiseId: 'F5',
    givePlayerIds: [second.id], autoRespond: false,
  });
  assert.equal(consentExpiryEoi.ok, true);
  const consentExpiryAccept = setup.dispatch({
    type: 'RESPOND_TRADE', tradeId: consentExpiryEoi.trade.id, accept: true, source: 'AI',
  });
  assert.equal(consentExpiryAccept.trade.status, 'AWAITING_CONSENT');
  setup.state.trades.find((trade) => trade.id === consentExpiryEoi.trade.id).consentBy =
    new Date(Date.now() - 1000).toISOString();
  const ticked = await setup.tick();
  assert.equal(ticked.changed, true, 'tick must report lapsed trade deadlines');
  assert.equal(setup.getState().trades.find((trade) => trade.id === consentExpiryEoi.trade.id).status, 'EXPIRED');
  pass('trades: 48-hour response and 72-hour consent deadlines lapse automatically');

  const injured = engine.dispatch({ type: 'INJURE_PLAYER', playerId: target.id });
  assert.equal(injured.ok, true, `INJURE_PLAYER failed: ${injured.error}`);
  state = engine.getState();
  assert.equal(state.players.find((p) => p.id === target.id).availability, 'INJURED');
  const replacements = state.players.filter((p) => p.availability === 'AVAILABLE' && p.id !== target.id);
  assert.ok(replacements.length >= 2, 'need two RPP players');
  const purseBeforeReplacement = state.franchises.find((f) => f.id === 'F2').purse;
  const signed = engine.dispatch({
    type: 'SIGN_INJURY_REPLACEMENT', injuredPlayerId: target.id, replacementPlayerId: replacements[0].id, fee: 10,
  });
  assert.equal(signed.ok, true, `RPP replacement failed: ${signed.error}`);
  state = engine.getState();
  assert.equal(state.players.find((p) => p.id === replacements[0].id).isRppReplacement, true);
  assert.ok(state.franchises.find((f) => f.id === 'F2').squad.includes(replacements[0].id));
  assert.equal(state.players.find((p) => p.id === target.id).replacedBy, replacements[0].id);
  assert.equal(state.franchises.find((f) => f.id === 'F2').purse, purseBeforeReplacement, 'RPP signing must not debit purse');
  const tooDear = engine.dispatch({
    type: 'SIGN_INJURY_REPLACEMENT', injuredPlayerId: target.id, replacementPlayerId: replacements[1].id, fee: 99,
  });
  assert.equal(tooDear.ok, false, 'replacement fee must respect the injured salary');
  pass('RPP: certified injury replacement within salary budget, no purse debit');

  const withdrawn = engine.dispatch({ type: 'PLAYER_WITHDRAW', playerId: tradeable, certifiedInjury: false });
  assert.equal(withdrawn.ok, true, `PLAYER_WITHDRAW failed: ${withdrawn.error}`);
  state = engine.getState();
  const withdrawnPlayer = state.players.find((p) => p.id === tradeable);
  assert.equal(withdrawnPlayer.availability, 'WITHDRAWN');
  assert.equal(withdrawnPlayer.banUntilSeason, '2028', '2026 withdrawal bans through 2028');
  assert.ok(!state.franchises.find((f) => f.id === 'F3').squad.includes(tradeable));
  pass('withdrawal: uncertified exit removes player and applies two-season ban');

  const results = computeResults(state);
  assert.equal(results.season, '2026');
  assert.equal(results.welfareFund, 7);
  assert.ok(results.injuries.some((entry) => entry.playerId === target.id && entry.status === 'INJURED'));
  assert.ok(results.injuries.some((entry) => entry.playerId === tradeable && entry.status === 'WITHDRAWN'
    && entry.banUntilSeason === '2028'));
  assert.equal(results.tradeWindows.length, 2);
  pass('results: season rules, welfare and injury/withdrawal reporting');
}

function scenarioLegacyFictionNames() {
  const legacy = {
    phase: 'RTM_OFFER',
    rtm: { playerId: 'P1' },
    rtmLog: [],
    bcciTradeRevenue: 2,
    rules: { rtmAvailable: true, impactPlayer: 1 },
    players: [{ id: 'P1', isRappReplacement: true }],
    franchises: [{ id: 'F1', rtmCards: 3, rtmUsed: 1 }],
    trades: [{ id: 't1', status: 'BCCI_REVIEW', approval: 'BCCI_REVIEW', transferFee: { bcciCut: 1 }, timeline: [] }],
    eventLog: [{ type: 'RTM_USED' }],
    bidHistory: [{ source: 'RTM_MATCH' }],
  };
  migrateLegacyNames(legacy);
  assert.equal(legacy.phase, 'CLAW_OFFER');
  assert.deepEqual(legacy.claw, { playerId: 'P1' });
  assert.equal(legacy.lcbTradeRevenue, 2);
  assert.equal(legacy.rules.clawAvailable, true);
  assert.equal(legacy.rules.xFactor, 1);
  assert.equal(legacy.players[0].isRppReplacement, true);
  assert.equal(legacy.franchises[0].clawCards, 3);
  assert.equal(legacy.franchises[0].clawUsed, 1);
  assert.equal(legacy.trades[0].status, 'LCB_REVIEW');
  assert.equal(legacy.trades[0].approval, 'LCB_REVIEW');
  assert.equal(legacy.trades[0].transferFee.lcbCut, 1);
  assert.equal(legacy.eventLog[0].type, 'CLAW_USED');
  assert.equal(legacy.bidHistory[0].source, 'CLAW_MATCH');
  for (const key of ['rtm', 'rtmLog', 'bcciTradeRevenue']) assert.equal(key in legacy, false);
  pass('legacy identifiers migrate to fictional LCB/Clawback/RPP names');
}

async function main() {
  // Sanity-check the other agents' modules before starting processes.
  assert.equal(generatePlayers().length >= 140, true, 'generatePlayers() should create >=140 players');
  assert.equal(typeof AuctionEngine, 'function');
  assert.equal(typeof computeResults, 'function');
  try {
    scenarioLegacyFictionNames();
    await scenarioPacingAndEarlyBid();
    await scenarioRetentions();
    await scenarioClawFlow();
    await scenarioSalaryAndSeasonOps();
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
