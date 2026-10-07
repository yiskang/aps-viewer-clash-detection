// test/clashtest/execution/localExecutor.checkpoint.test.mjs
//
// Option A (owner-authorized 2026-10-07, docs/research/2026-10-07-architecture-self-clash-real-model-profile.md
// §7): the executor's EnumerationContext `checkpoint()` (spec §6.2) is TIME-SLICED against the engine's
// existing `sliceBudgetMs` through the P0 slicer (`clashtest/util/slicer.js`), the way the planning-time
// `enumerationCheckpoint` (`clashtest/run/Run.js`) already is, instead of yielding to the scheduler on
// every call. The first checkpoint of every unit still yields unconditionally (it is the only yield
// the first unit of a run gets before its pre-bracket; later units also get Run's interUnitYield).
//
// Pinned here:
//   (a) many checkpoint calls inside one slice yield 0 times (beyond the first-call yield) and take the
//       synchronous `undefined` fast path (viewer/checkpoint.js "Item D" convention);
//   (b) once the slice budget elapses on the injected clock, the next checkpoint yields -- at least
//       once per slice, never earlier than the budget;
//   (c) outcomes (pairs, diagnostics, scope proof, failure, generations) are identical to the
//       always-yield schedule, at the unit level and end to end through the real engine with the
//       PRODUCTION Viewer enumerator (scope digests, pair-set, ledger outcomes);
//   (d) cancel is still observed only at the unit boundary: the in-flight unit drains, its library
//       call is issued, and every later unit is not-run.
// Time is a fake clock throughout (no wall clock is asserted, G-CAL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';
import { createFakeEnumerator } from '../support/fakeEnumerator.mjs';
import { createFakeClock } from '../support/fakeClock.mjs';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { getWorldCoordinator } from '../../../clashtest/run/coordinator.js';
import { makeRealWorldFixture, recordFindClashes } from '../support/realWorld.mjs';

const SLICE_MS = 8;   // makeExecutorDeps' default sliceBudgetMs

// The default two-model content, byte-matched to executionRequests.mjs' defaultScopeExpect().
const MODELS = {
  'mk-a': { roots: [
    { dbId: 10, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: 'sha256:a' },
    { dbId: 11, fragmentCount: 1, ownerDbIds: [11], subtreeDigest: 'sha256:b' },
  ] },
  'mk-b': { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:c' }] },
};

/**
 * An enumerator that calls `ctx.checkpoint()` `perCall` times per digest (the production adapter's
 * convention: `const p = checkpointNow(ctx); if (p) await p;`), advancing the fake clock by `stepMs`
 * of "work" before each call, then answers from P0's fake enumerator.
 */
function checkpointingEnumerator(clock, { perCall, stepMs = 0 }) {
  const inner = createFakeEnumerator({ models: MODELS, cooperative: false });
  const stats = { calls: 0, due: 0, yieldTimes: [] };
  clock.onYield(() => { stats.yieldTimes.push(clock.peek()); });
  const cooperate = async (ctx) => {
    for (let i = 0; i < perCall; i++) {
      if (stepMs > 0) clock.advance(stepMs);
      stats.calls += 1;
      const p = ctx.checkpoint();
      if (p) { stats.due += 1; await p; }
    }
  };
  return {
    stats,
    inner,
    digestScope: async (binding, scope, ctx) => { await cooperate(ctx); return inner.digestScope(binding, scope, null); },
    resolveRoots: async (binding, scope, ctx) => { await cooperate(ctx); return inner.resolveRoots(binding, scope, null); },
  };
}

function setup({ perCall, stepMs = 0 }) {
  const clock = createFakeClock({ start: 0 });
  const enumerator = checkpointingEnumerator(clock, { perCall, stepMs });
  const deps = makeExecutorDeps({ enumerator, now: clock.now, yieldToScheduler: clock.yieldToScheduler });
  return { clock, enumerator, deps, execute: createLocalUnitExecutor(deps) };
}

// ------------------------------------------------------------------------------------------------
// (a) inside one slice: no slice-driven yields, synchronous fast path
// ------------------------------------------------------------------------------------------------

test('(a) 1,200 checkpoint calls inside one slice yield only the unit\'s first-call yield; every other call is the synchronous fast path', async () => {
  const { clock, enumerator, execute } = setup({ perCall: 300 });   // clock never advances: one slice
  const outcome = await execute(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.scopeProof], ['evaluated', 'equal']);
  assert.equal(enumerator.stats.calls, 1_200, 'premise: 2 scopes x 2 brackets x 300 checkpoint calls');
  assert.equal(clock.yieldCount, 1, 'only the first checkpoint of the unit yields to the scheduler');
  assert.equal(enumerator.stats.due, 1, 'every other checkpoint returned undefined synchronously (Item D)');
});

test('(a) each unit gets its own first-call yield and its own slice', async () => {
  const { clock, enumerator, execute } = setup({ perCall: 50 });
  for (let i = 0; i < 3; i++) {
    const outcome = await execute(makeRequest({ unit: { unitId: `1.${i}` } }));
    assert.equal(outcome.outcome, 'evaluated');
  }
  assert.equal(enumerator.stats.calls, 600);
  assert.equal(clock.yieldCount, 3, 'one first-call yield per unit, none slice-driven');
});

// ------------------------------------------------------------------------------------------------
// (b) the slice budget elapses on the injected clock -> the next checkpoint yields
// ------------------------------------------------------------------------------------------------

test('(b) with 1 ms of work per checkpoint and an 8 ms slice, the executor yields once per elapsed slice', async () => {
  const { clock, enumerator, execute } = setup({ perCall: 20, stepMs: 1 });
  const outcome = await execute(makeRequest({}));
  assert.deepEqual([outcome.outcome, outcome.scopeProof], ['evaluated', 'equal']);
  assert.equal(enumerator.stats.calls, 80);
  // call k happens at t = k. The first call yields (t = 1) and starts a slice; thereafter a yield is
  // due on the call where t - sliceStart >= 8: t = 9, 17, ..., 73 -> 1 + 9 = 10 yields.
  assert.equal(clock.yieldCount, 10);
  assert.equal(enumerator.stats.due, 10);
  const times = enumerator.stats.yieldTimes;
  assert.equal(times[0], 1, 'the first checkpoint yields immediately');
  for (let i = 1; i < times.length; i++) {
    assert.equal(times[i] - times[i - 1], SLICE_MS, 'never earlier than the budget, and at least once per slice (spec §6.2)');
  }
});

test('(b) a long synchronous span between brackets (the library call) makes the next checkpoint due', async () => {
  const { clock, enumerator, deps, execute } = setup({ perCall: 5 });
  deps.world.script(() => { clock.advance(SLICE_MS); return { pairs: [], statistics: {} }; });
  const outcome = await execute(makeRequest({}));
  assert.equal(outcome.outcome, 'evaluated');
  assert.equal(enumerator.stats.calls, 20);
  assert.equal(clock.yieldCount, 2, 'first-call yield + the first post-bracket checkpoint after a full slice of library time');
  assert.equal(outcome.durationMs, SLICE_MS, 'durationMs still reads the injected clock');
});

// ------------------------------------------------------------------------------------------------
// (c) outcome parity with the always-yield schedule
// ------------------------------------------------------------------------------------------------

/** Runs one scenario twice: never-due (one slice) vs always-due (every call spends a whole slice,
 *  i.e. exactly the previous yield-on-every-call schedule). Returns both outcomes and both stats. */
async function bothSchedules(scenario, perCall = 40) {
  const out = {};
  for (const [name, stepMs] of [['sliced', 0], ['always', SLICE_MS]]) {
    const s = setup({ perCall, stepMs });
    const request = scenario(s);
    const outcome = await s.execute(request);
    out[name] = { outcome, stats: s.enumerator.stats, yields: s.clock.yieldCount };
  }
  assert.equal(out.always.stats.due, out.always.stats.calls, 'premise: the always schedule yields on every checkpoint call');
  assert.ok(out.sliced.yields < out.always.yields, 'premise: the sliced schedule yields less');
  const strip = ({ durationMs, ...rest }) => rest;
  return { sliced: strip(out.sliced.outcome), always: strip(out.always.outcome) };
}

const PAIR_RESULT = () => ({
  pairs: [{ source: { modelId: 1, dbId: 10, model: {} }, target: { modelId: 2, dbId: 20, model: {} }, type: 'volume-overlap', witness: null }],
  statistics: { diagnostics: [{ scope: 'fragment', reason: 'inconclusive-crossing', role: 'source', fragment: { modelId: 1, dbId: 10, fragId: 1 } }] },
});
const CHANGED_B = { roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: 'sha256:CHANGED' }] };

const PARITY_SCENARIOS = {
  'evaluated with pairs and diagnostics': ({ deps }) => { deps.world.script(PAIR_RESULT); return makeRequest({}); },
  'pre-check drift (skipped)': ({ enumerator }) => { enumerator.inner.set('mk-b', CHANGED_B); return makeRequest({}); },
  'post-check drift (discarded)': ({ deps, enumerator }) => {
    deps.world.script(() => { enumerator.inner.set('mk-b', CHANGED_B); return PAIR_RESULT(); });
    return makeRequest({});
  },
  'lease dies during the pre-check bracket (skipped:model-evicted)': ({ deps, enumerator }) => {
    enumerator.inner.onCall(() => { deps.world.evictModel(deps.models['mk-b']); });
    return makeRequest({});
  },
  'lease dies during the post-check bracket (discarded:unverifiable)': ({ deps, enumerator }) => {
    let called = false;
    deps.world.script(() => { called = true; return PAIR_RESULT(); });
    enumerator.inner.onCall(() => { if (called) deps.world.evictModel(deps.models['mk-b']); });
    return makeRequest({});
  },
};

for (const [name, scenario] of Object.entries(PARITY_SCENARIOS)) {
  test(`(c) unit outcome identical to the always-yield schedule: ${name}`, async () => {
    const { sliced, always } = await bothSchedules(scenario);
    assert.deepEqual(sliced, always);
  });
}

// End to end: real engine, real CollisionWorld, PRODUCTION Viewer enumerator, a same-model (cell 3b)
// run -- the shape of the Architecture self-clash -- under both executor schedules.
const SELF_MODEL = {
  tree: [{ dbId: 1, children: Array.from({ length: 8 }, (_, i) => ({ dbId: 100 + i, fragments: [i] })) }],
  // 100..103 overlap their neighbours; 104..107 are apart.
  positions: { 0: [0, 0, 0], 1: [0.5, 0, 0], 2: [1, 0, 0], 3: [1.5, 0, 0], 4: [10, 0, 0], 5: [20, 0, 0], 6: [30, 0, 0], 7: [40, 0, 0] },
};
const SELF_DEFINITION = {
  schemaVersion: 1, testId: 'self', revision: 1, name: 'self', mode: 'volume-overlap',
  selectionA: { entries: [{ kind: 'model', modelKey: 'a' }] },
  selectionB: { entries: [{ kind: 'model', modelKey: 'a' }] },
};

async function selfClashRun({ execStepMs, onFirstExecutorYield = null }) {
  const fx = await makeRealWorldFixture({ models: { a: SELF_MODEL } });
  const calls = recordFindClashes(fx.world);
  const engineClock = createFakeClock({ start: Date.UTC(2026, 9, 7) });
  const execClock = createFakeClock({ start: 0, tickMs: execStepMs });
  const enumerator = createViewerElementEnumerator();
  let checkpointCalls = 0;
  const counting = {
    resolveRoots: (b, s, ctx) => enumerator.resolveRoots(b, s, ctx),
    digestScope: (b, s, ctx) => enumerator.digestScope(b, s, { ...ctx, checkpoint: () => { checkpointCalls += 1; return ctx.checkpoint(); } }),
  };
  const unitExecutor = createLocalUnitExecutor({
    world: fx.world, registry: getWorldCoordinator(fx.world).registry, enumerator: counting,
    now: execClock.now, yieldToScheduler: execClock.yieldToScheduler, sliceBudgetMs: 4,
  });
  const engine = createClashTestEngine({
    world: fx.world, enumerator, unitExecutor, now: engineClock.now,
    yieldToScheduler: engineClock.yieldToScheduler, scheduleTimeout: () => () => {},
  });
  const handle = engine.startRun(SELF_DEFINITION);
  if (onFirstExecutorYield) {
    let fired = false;
    execClock.onYield(() => { if (!fired) { fired = true; onFirstExecutorYield(handle); } });
  }
  const { resultSet } = await handle.done;
  return { resultSet, findClashesCalls: calls.calls.length, execYields: execClock.yieldCount, checkpointCalls };
}

const withoutTimings = (value) => JSON.parse(JSON.stringify(value, (k, v) => (k === 'durationMs' ? undefined : v)));

test('(c) end to end with the production Viewer enumerator: a same-model run is identical under both schedules', async () => {
  const sliced = await selfClashRun({ execStepMs: 0 });
  const always = await selfClashRun({ execStepMs: 4 });   // every now() read spends a whole 4 ms slice
  for (const r of [sliced, always]) assert.equal(r.resultSet.outcome.status, 'completed', JSON.stringify(r.resultSet.outcome));
  const units = sliced.resultSet.ledger.units.length;
  assert.ok(units > 1, `premise: the same-model plan has several units (got ${units})`);
  assert.ok(sliced.resultSet.results.length > 0, 'premise: the run finds clashes');
  assert.equal(always.execYields, always.checkpointCalls, 'premise: the always schedule yields on every checkpoint call');
  assert.equal(sliced.execYields, units, 'sliced: exactly one (first-call) executor yield per unit');
  assert.ok(sliced.checkpointCalls === always.checkpointCalls, 'the enumerator is asked for the same checkpoints');

  assert.deepEqual(sliced.resultSet.results, always.resultSet.results);
  assert.equal(sliced.resultSet.digests.pairSetDigest, always.resultSet.digests.pairSetDigest);
  assert.deepEqual(sliced.resultSet.provenance.models, always.resultSet.provenance.models, 'scope digests unchanged');
  assert.deepEqual(withoutTimings(sliced.resultSet.ledger), withoutTimings(always.resultSet.ledger));
  assert.deepEqual(sliced.resultSet.outcome, always.resultSet.outcome);
  assert.equal(sliced.findClashesCalls, always.findClashesCalls);
});

// ------------------------------------------------------------------------------------------------
// (d) cancel/stop: still observed only between units
// ------------------------------------------------------------------------------------------------

test('(d) a cancel requested during the first unit drains it (its library call is issued) and every later unit is not-run', async () => {
  for (const execStepMs of [0, 4]) {
    const { resultSet, findClashesCalls } = await selfClashRun({ execStepMs, onFirstExecutorYield: (handle) => handle.cancel() });
    assert.equal(resultSet.outcome.status, 'cancelled', JSON.stringify(resultSet.outcome));
    assert.equal(findClashesCalls, 1, 'the in-flight unit is drained, never interrupted (§10.1); no later unit starts');
    const evaluated = resultSet.ledger.units.filter((u) => u.outcome === 'evaluated');
    const notRun = resultSet.ledger.units.filter((u) => u.outcome === 'not-run');
    assert.equal(evaluated.length, 1);
    assert.equal(notRun.length, resultSet.ledger.units.length - 1);
  }
});
