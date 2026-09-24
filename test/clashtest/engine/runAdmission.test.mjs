// test/clashtest/engine/runAdmission.test.mjs
//
// Task P7.2: the engine's ONE per-run `RunSpec` constructor (`buildRunSpec`) and the ONE admission
// sequence (`admitAndBegin`) that P7.4 (`startRun`) and P7.7 (`rerun`) both call. They are reached
// through the internal `createEngineCore(...).internals` seam (an internal named export of
// `clashtest/engine.js`, not of `clashtest/index.js`); the public surface never sees them.
//
// C-P7-3: `testIdOfInput` is a plain string VALUE on every RunSpec built here.
// G-EC: nothing below reads or asserts `provenance.models[].elementCount` (opaque pass-through).
// G-CAL: no §17.1 default is written as a literal; time comes from `createFakeClock`, never a wall clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngineCore } from '../../../clashtest/engine.js';
import {
  EngineDisposedError, ResultCapacityError, RunQueueFullError,
} from '../../../clashtest/errors.js';
import { resolveRunOptions } from '../../../clashtest/options.js';
import { DIGEST_VERSION } from '../../../clashtest/util/canonical.js';
import { createFakeClock } from '../support/fakeClock.mjs';
import {
  createEngineWorld, createDirectResolver, createHungResolver,
} from '../support/engineWorld.mjs';

const RUN_SPEC_FIELDS = [
  'runId', 'engineId', 'coordinator', 'world', 'testIdOfInput', 'derivedFromRunId', 'resolveDefinition',
  'modelKeysOf', 'planningCauseOf', 'enumerator', 'executor', 'validateUnitOutcome', 'internalErrorOutcome',
  'diagnosticAggregator', 'statisticsAccumulator', 'deriveUnitTaints', 'plannerPort', 'resultPort',
  'runOptions', 'limits', 'provenanceBase', 'now', 'yieldToScheduler', 'scheduleTimeout',
];

/** A recording `scheduleTimeout` seam: nothing ever fires, every cancel is observable. */
function recordingTimers() {
  const timers = [];
  const scheduleTimeout = (fn, ms) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  return { timers, scheduleTimeout };
}

function setup(extra = {}, runOptions) {
  const world = createEngineWorld();
  const core = createEngineCore(world.config(extra));
  const options = resolveRunOptions(runOptions, core.internals.effectiveLimits);
  const source = (definition = world.definition()) => ({ kind: 'definition', value: definition });
  return { world, ...core, options, source };
}

const build = (t, overrides = {}) => t.internals.buildRunSpec({
  runId: 'run-1', source: t.source(), options: t.options, resolver: createDirectResolver(), ...overrides,
});

// ---- buildRunSpec ------------------------------------------------------------------------------------

test('buildRunSpec writes exactly the RunSpec fields P6 declares, and nothing else', () => {
  const t = setup();
  const spec = build(t);
  assert.deepEqual(Object.keys(spec).sort(), [...RUN_SPEC_FIELDS].sort());
  assert.ok(Object.isFrozen(spec));
  assert.equal(spec.runId, 'run-1');
  assert.equal(spec.engineId, t.internals.engineId);
  assert.equal(spec.coordinator, t.internals.coordinator);
  assert.equal(spec.world, t.world.world);
  assert.equal(spec.enumerator, t.world.enumerator);
  assert.equal(spec.executor, t.internals.executor);
  assert.equal(spec.runOptions, t.options, 'the RESOLVED run options');
  assert.equal(spec.limits, t.internals.effectiveLimits, 'the RESOLVED engine limits (a distinct object)');
  assert.notEqual(spec.runOptions, spec.limits);
});

test('testIdOfInput is a plain string VALUE for every source kind, never a closure (C-P7-3)', () => {
  const t = setup();
  const direct = build(t, { source: t.source(t.world.definition({ testId: 'T-direct' })) });
  assert.equal(direct.testIdOfInput, 'T-direct');
  const reference = build(t, { source: { kind: 'reference', value: { testId: 'T-ref', revision: 2 } } });
  assert.equal(reference.testIdOfInput, 'T-ref');
  for (const spec of [direct, reference]) {
    assert.equal(typeof spec.testIdOfInput, 'string');
    assert.notEqual(typeof spec.testIdOfInput, 'function');
  }
  assert.throws(() => build(t, { source: { kind: 'reference', value: { testId: 7 } } }), TypeError);
  assert.throws(() => build(t, { source: { kind: 'reference', value: {} } }), TypeError);
});

test('derivedFromRunId is written on every spec: null by default, the base run for a rerun (N33)', () => {
  const t = setup();
  assert.equal(build(t).derivedFromRunId, null);
  assert.equal(build(t, { derivedFromRunId: undefined }).derivedFromRunId, null);
  assert.equal(build(t, { derivedFromRunId: 'base-run' }).derivedFromRunId, 'base-run');
});

test('modelKeysOf is the ascending, distinct modelKey set over BOTH selections', () => {
  const spec = build(setup());
  const definition = {
    selectionA: { entries: [{ kind: 'model', modelKey: 'mB' }, { kind: 'elements', modelKey: 'mA', dbIds: [1] }] },
    selectionB: { entries: [{ kind: 'model', modelKey: 'mA' }, { kind: 'model', modelKey: 'mC' }] },
  };
  assert.deepEqual(spec.modelKeysOf(definition), ['mA', 'mB', 'mC']);
});

test('resolveDefinition is the zero-argument per-run closure over the resolver; planningCauseOf passes through', async () => {
  const t = setup();
  const calls = [];
  const resolved = { definition: { mode: 'volume-overlap' }, testRef: { testId: 'T1' } };
  const resolver = {
    resolveDefinition: (source) => { calls.push(source); return Promise.resolve(resolved); },
    planningCauseOf: () => 'enumeration-failed',
  };
  const source = t.source();
  const spec = build(t, { source, resolver });
  assert.equal(spec.resolveDefinition.length, 0);
  assert.equal(await spec.resolveDefinition(), resolved, 'the resolver\'s answer is returned unchanged');
  assert.deepEqual(calls, [source]);
  assert.equal(spec.planningCauseOf, resolver.planningCauseOf);
});

test('a resolver that throws synchronously surfaces as the closure throwing (Run.js turns it into a rejection)', () => {
  const t = setup();
  const boom = new Error('lookup exploded');
  const spec = build(t, { resolver: { resolveDefinition: () => { throw boom; }, planningCauseOf: () => 'enumeration-failed' } });
  assert.throws(() => spec.resolveDefinition(), (e) => e === boom);
});

test('the per-run diagnostic aggregator and statistics accumulator are fresh; the ports are shared', () => {
  const t = setup();
  const a = build(t, { runId: 'a' });
  const b = build(t, { runId: 'b' });
  assert.notEqual(a.diagnosticAggregator, b.diagnosticAggregator);
  assert.notEqual(a.statisticsAccumulator, b.statisticsAccumulator);
  for (const spec of [a, b]) {
    assert.equal(typeof spec.diagnosticAggregator.addUnit, 'function');
    assert.equal(typeof spec.diagnosticAggregator.snapshot, 'function');
    assert.equal(typeof spec.statisticsAccumulator.add, 'function');
    assert.equal(typeof spec.statisticsAccumulator.snapshot, 'function');
    assert.equal(typeof spec.validateUnitOutcome, 'function');
    assert.equal(typeof spec.internalErrorOutcome, 'function');
    assert.equal(typeof spec.deriveUnitTaints, 'function');
  }
  assert.equal(a.plannerPort, b.plannerPort);
  assert.equal(a.resultPort, b.resultPort);
  assert.equal(a.resultPort.residency, t.internals.residency, 'the run seals into THIS engine\'s residency');
  assert.deepEqual(Object.keys(a.plannerPort).sort(), [
    'checkScopeBracket', 'createLedger', 'createRecordBudget', 'materializeUnit', 'planRun', 'rootsForRanges', 'splitUnit',
  ]);
  assert.deepEqual(Object.keys(a.resultPort).sort(), [
    'buildResultSet', 'createResultAccumulator', 'deriveRunOutcome', 'residency', 'sealResultSet',
  ]);
});

test('the scheduler seams: a host seam wins, otherwise a default is derived (R-P7-6)', async () => {
  const seams = { scheduleTimeout: () => () => {}, yieldToScheduler: async () => {} };
  const given = build(setup(seams));
  assert.equal(given.scheduleTimeout, seams.scheduleTimeout);
  assert.equal(given.yieldToScheduler, seams.yieldToScheduler);

  const defaults = build(setup());
  assert.equal(typeof defaults.yieldToScheduler, 'function', 'derived from options.interUnitYield');
  await defaults.yieldToScheduler();
  assert.equal(typeof defaults.scheduleTimeout, 'function');

  // The default timer really schedules and really cancels. Only ORDER is asserted (a cancelled
  // 1 ms timer never runs while a later 10 ms one does), never a duration.
  const fired = [];
  const cancel = defaults.scheduleTimeout(() => fired.push('cancelled'), 1);
  assert.equal(typeof cancel, 'function');
  cancel();
  defaults.scheduleTimeout(() => fired.push('kept'), 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(fired, ['kept']);
});

// ---- provenanceBase (R-P7-1) ------------------------------------------------------------------------

test('provenanceBase carries the engine-level facts and the closed static fields', () => {
  const t = setup({ libraryVersion: 'lib-1', hierarchyInternalAcceptance: { recordRef: 'docs/acceptance.md' } },
    { broadPhase: 'linear' });
  const provenance = { ...build(t).provenanceBase };
  assert.equal(provenance.registrySessionId, t.world.registry.registrySessionId);
  assert.equal(provenance.libraryVersion, 'lib-1');
  assert.equal(provenance.broadPhase, 'linear', 'from the RESOLVED run options');
  assert.deepEqual(provenance.scopeProof, { method: 'bracketed-digest', digestVersion: DIGEST_VERSION });
  assert.deepEqual(provenance.hierarchyInternalAcceptance, { recordRef: 'docs/acceptance.md' });
  assert.equal(provenance.placementVerified, false);
  assert.deepEqual(provenance.libraryExclusions, [], 'provisional (owner item D-2): informational only');
  assert.deepEqual(Object.keys(provenance).sort(), [
    'broadPhase', 'determinismClass', 'finishedAt', 'hierarchyInternalAcceptance', 'libraryExclusions',
    'libraryVersion', 'placementVerified', 'registrySessionId', 'scopeProof', 'startedAt',
  ]);
});

test('an engine with no libraryVersion or acceptance records null for both', () => {
  const provenance = { ...build(setup()).provenanceBase };
  assert.equal(provenance.libraryVersion, null);
  assert.equal(provenance.hierarchyInternalAcceptance, null);
});

test('finishedAt is read at SEAL time (a getter the seal spread evaluates), startedAt at build time', () => {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24, 12, 0, 0) });
  const t = setup({ now: clock.now, yieldToScheduler: clock.yieldToScheduler });
  const { provenanceBase } = build(t);
  assert.equal(Object.getOwnPropertyDescriptor(provenanceBase, 'finishedAt').enumerable, true);
  assert.equal(typeof Object.getOwnPropertyDescriptor(provenanceBase, 'finishedAt').get, 'function');

  const first = { ...provenanceBase };
  assert.equal(first.startedAt, '2026-09-24T12:00:00.000Z');
  assert.equal(first.finishedAt, '2026-09-24T12:00:00.000Z');
  clock.advance(90_000);
  const second = { ...provenanceBase };
  assert.equal(second.startedAt, first.startedAt, 'startedAt does not move');
  assert.equal(second.finishedAt, '2026-09-24T12:01:30.000Z', 'finishedAt follows the clock at spread time');
});

test('determinismClass follows the RESOLVED mode; a run that never resolved is conservatively time-sensitive', async () => {
  const t = setup();
  const modeResolver = (mode) => ({
    resolveDefinition: () => Promise.resolve({ definition: { mode }, testRef: { testId: 'T1' } }),
    planningCauseOf: () => 'enumeration-failed',
  });
  const classOf = async (mode) => {
    const spec = build(t, { resolver: modeResolver(mode) });
    if (mode !== null) await spec.resolveDefinition();
    return { ...spec.provenanceBase }.determinismClass;
  };
  assert.equal(await classOf(null), 'time-sensitive', 'pre-resolution: the mode is unknown');
  assert.equal(await classOf('volume-overlap'), 'deterministic');
  assert.equal(await classOf('clearance'), 'deterministic');
  assert.equal(await classOf('surface-intersection'), 'time-sensitive');
  assert.equal(await classOf('containment'), 'time-sensitive');
});

test('each run gets its own mutable provenance substructures (a seal freezing one cannot freeze another)', () => {
  const t = setup({ hierarchyInternalAcceptance: { recordRef: 'r' } });
  const a = build(t, { runId: 'a' }).provenanceBase;
  const b = build(t, { runId: 'b' }).provenanceBase;
  assert.notEqual(a.libraryExclusions, b.libraryExclusions);
  assert.notEqual(a.scopeProof, b.scopeProof);
});

// ---- admitAndBegin: admission, ownership and rollback ------------------------------------------------

const hungSpec = (t) => ({ source: t.source(), options: t.options, resolver: createHungResolver() });

test('admitAndBegin reserves a slot, records the run and its engine-only controller, and returns the handle', async () => {
  const t = setup();
  const handle = t.internals.admitAndBegin(hungSpec(t));
  assert.deepEqual(Object.keys(handle).sort(), ['cancel', 'done', 'getSnapshot', 'persisted', 'runId', 'subscribe']);
  assert.equal(t.engine.retentionReport().active.includes(handle.runId), true, 'the run holds a slot from admission');
  const owned = t.internals.ownRuns.get(handle.runId);
  assert.equal(owned.handle, handle);
  assert.equal(typeof owned.controller.requestDispose, 'function');
  assert.equal('requestDispose' in handle, false, 'a host holding the handle cannot dispose the engine\'s runs');
  assert.equal(handle.getSnapshot().runId, handle.runId);
  await t.engine.dispose();
});

test('every admission gets a fresh runId', async () => {
  const t = setup();
  const ids = new Set([t.internals.admitAndBegin(hungSpec(t)).runId, t.internals.admitAndBegin(hungSpec(t)).runId]);
  assert.equal(ids.size, 2);
  await t.engine.dispose();
});

test('the slot check fires first at the default maxQueuedRuns: ResultCapacityError, never RunQueueFullError', async () => {
  const t = setup({ limits: { maxResidentResultSets: 2 } });
  t.internals.admitAndBegin(hungSpec(t));
  t.internals.admitAndBegin(hungSpec(t));
  assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), ResultCapacityError);
  assert.equal(t.engine.retentionReport().slotsInUse, 2, 'the refusal leaked nothing');
  await t.engine.dispose();
});

test('a lowered maxQueuedRuns refuses with RunQueueFullError, counting WAITING runs only, and rolls back', async () => {
  const t = setup({ limits: { maxResidentResultSets: 4, maxQueuedRuns: 1 } });
  t.internals.admitAndBegin(hungSpec(t));              // takes the world's one in-flight slot
  t.internals.admitAndBegin(hungSpec(t));              // waits: queue depth 1
  let refusal;
  assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), (e) => { refusal = e; return e instanceof RunQueueFullError; });
  assert.equal(refusal.limit, 1);
  assert.equal(refusal.queued, 1, 'the in-flight run is not counted');
  const before = t.engine.retentionReport().slotsInUse;
  for (let i = 0; i < 5; i += 1) assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), RunQueueFullError);
  assert.equal(t.engine.retentionReport().slotsInUse, before, 'five refusals, zero drift');
  assert.equal(before, 2);
  assert.equal(t.internals.ownRuns.size, 2, 'a refused admission leaves no trace in the run map');
  await t.engine.dispose();
});

test('maxQueuedRuns: 0 still admits a run that starts at once (the queue bounds WAITING runs)', async () => {
  const solo = setup({ limits: { maxResidentResultSets: 1 } });     // derives maxQueuedRuns 0
  assert.equal(solo.internals.effectiveLimits.maxQueuedRuns, 0);
  solo.internals.admitAndBegin(hungSpec(solo));
  await solo.engine.dispose();

  const t = setup({ limits: { maxResidentResultSets: 2, maxQueuedRuns: 0 } });
  t.internals.admitAndBegin(hungSpec(t));
  let refusal;
  assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), (e) => { refusal = e; return e instanceof RunQueueFullError; });
  assert.deepEqual([refusal.limit, refusal.queued], [0, 0]);
  await t.engine.dispose();
});

test('a spec that createRun rejects rolls the reservation and the map entry back', () => {
  const t = setup();
  // `derivedFromRunId` is validated by createRun (I7): a non-string is an engine bug, a TypeError.
  assert.throws(() => t.internals.admitAndBegin({ ...hungSpec(t), derivedFromRunId: 42 }), TypeError);
  assert.equal(t.engine.retentionReport().slotsInUse, 0);
  assert.equal(t.internals.ownRuns.size, 0);
});

test('a begin() that the coordinator refuses rolls the reservation and the map entry back', () => {
  const t = setup();
  t.internals.coordinator.stopAdmitting(t.internals.engineId);     // the door is closed, the engine is not
  assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), EngineDisposedError);
  assert.equal(t.engine.retentionReport().slotsInUse, 0);
  assert.equal(t.internals.ownRuns.size, 0);
});

test('admission after dispose throws EngineDisposedError and reserves nothing', async () => {
  const t = setup();
  await t.engine.dispose();
  assert.throws(() => t.internals.admitAndBegin(hungSpec(t)), EngineDisposedError);
  assert.equal(t.internals.ownRuns.size, 0);
});

// ---- the whole stack, through the real P0-P6 code ---------------------------------------------------

test('a spec built by buildRunSpec drives a real run to a completed clean set with the engine\'s provenance', async () => {
  const clock = createFakeClock({ start: Date.UTC(2026, 8, 24), tickMs: 1 });
  const timers = recordingTimers();
  const t = setup({
    now: clock.now, yieldToScheduler: clock.yieldToScheduler, scheduleTimeout: timers.scheduleTimeout,
    libraryVersion: 'lib-1', hierarchyInternalAcceptance: { recordRef: 'docs/acceptance.md' },
  });
  const handle = t.internals.admitAndBegin({
    source: t.source(t.world.definition({ testId: 'T-e2e' })), options: t.options,
    resolver: createDirectResolver(), derivedFromRunId: 'base-run',
  });
  const { status, resultSet, persistence } = await handle.done;

  assert.equal(status, 'completed');
  assert.equal(resultSet.runId, handle.runId);
  assert.equal(resultSet.derivedFromRunId, 'base-run', 'rerun lineage is sealed (N33)');
  assert.equal(resultSet.testRef.testId, 'T-e2e');
  assert.equal(resultSet.outcome.coverage, 'full');
  assert.equal(resultSet.outcome.integrity, 'clean');
  assert.deepEqual(resultSet.results, []);
  assert.equal(persistence.state, 'saved', 'the default in-memory result store took the set');

  const { provenance } = resultSet;
  assert.equal(provenance.registrySessionId, t.world.registry.registrySessionId);
  assert.equal(provenance.libraryVersion, 'lib-1');
  assert.equal(provenance.determinismClass, 'deterministic');
  assert.equal(provenance.broadPhase, t.options.broadPhase);
  assert.deepEqual(provenance.hierarchyInternalAcceptance, { recordRef: 'docs/acceptance.md' });
  assert.equal(provenance.placementVerified, false);
  assert.deepEqual(provenance.models.map((m) => m.modelKey), ['mA', 'mB']);
  assert.deepEqual(provenance.admissionBaseline, [
    { modelKey: 'mA', epochInstanceCount: 0 }, { modelKey: 'mB', epochInstanceCount: 0 },
  ]);
  assert.ok(Date.parse(provenance.startedAt) <= Date.parse(provenance.finishedAt));
  assert.equal(provenance.finishedAt.endsWith('Z'), true);

  // The finalize window's timer went through the scheduleTimeout seam, bounded by persistTimeoutMs,
  // and was cancelled when the write settled: nothing is left pending.
  assert.ok(timers.timers.length >= 1);
  assert.equal(timers.timers[0].ms, t.internals.effectiveLimits.persistTimeoutMs);
  assert.ok(timers.timers.every((timer) => timer.cancelled));
  await t.engine.dispose();
});

test('a time-sensitive mode seals determinismClass "time-sensitive"', async () => {
  const t = setup({ scheduleTimeout: recordingTimers().scheduleTimeout });
  const handle = t.internals.admitAndBegin({
    source: t.source(t.world.definition({ mode: 'surface-intersection' })), options: t.options,
    resolver: createDirectResolver(),
  });
  const { resultSet } = await handle.done;
  assert.equal(resultSet.provenance.determinismClass, 'time-sensitive');
  await t.engine.dispose();
});

test('a run cancelled before its definition resolved seals a time-sensitive, provenance-complete set', async () => {
  const t = setup({ scheduleTimeout: recordingTimers().scheduleTimeout });
  const handle = t.internals.admitAndBegin(hungSpec(t));
  const { status, resultSet } = await handle.cancel('user');
  assert.equal(status, 'cancelled');
  assert.equal(resultSet.definition, null, 'pre-resolution shape');
  assert.equal(resultSet.provenance.determinismClass, 'time-sensitive');
  assert.equal(resultSet.provenance.registrySessionId, t.world.registry.registrySessionId);
  await t.engine.dispose();
});
