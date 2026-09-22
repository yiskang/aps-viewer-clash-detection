// test/clashtest/execution/localExecutor.call.test.mjs
//
// Task P4.6: §7.2 call construction, `projectPairs`, and F4 structured-clone safety, against P0's
// fake world (`createFakeWorld` via `createExecutionWorld`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalUnitExecutor } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { emptyClashResult, createFakeClock, createFakeModel } from '../support/index.mjs';   // P0
import { makeRequest, makeExecutorDeps } from '../support/executionRequests.mjs';  // P4-local (additive)

const empty = emptyClashResult;   // P0's `{pairs: [], statistics: {diagnostics: []}}`

// DEVIATION FROM PLAN SKETCH (verified by running the plan's own literal test against the shipped
// fixtures): the plan's `rawPair` hardcodes `modelId: 1` (source) / `modelId: 2` (target), matching
// `collision/CollisionWorld.js`'s real `modelIdOf(model) = model.id ?? model` ONLY when the bound
// models' own `.id` are the numbers 1 and 2 -- which is how `test/clashtest/support/realWorldFixture.mjs`
// builds its real T2 models (`makeModelPart(1, ...)` / `makeModelPart(2, ...)`), but NOT how the
// shipped `executionRequests.mjs`'s own `makeExecutorDeps` default fixture builds its FAKE models:
// `createFakeModel('mk-a')` / `createFakeModel('mk-b')` give `.id === 'mk-a'` / `'mk-b'` (string,
// equal to the modelKey), never the numbers 1/2. Run verbatim, the plan's clone-safety test's
// resolved `modelKey`s would both come back `null` (no participant's `modelId` is the number 1 or 2),
// silently failing the very assertion the test exists to make. `executionRequests.mjs` is frozen
// (P4-shipped, read-only for this task), so the fix belongs in this file's own `run()` helper: give
// the fake fixture models whose `.id` matches this file's own pair fixtures' `modelId` numbering
// (source unit's `mk-a` = 1, target `mk-b` = 2), which is exactly what the REAL library would report
// for models registered in that order. No other test in this file depends on the string identity of
// the default models, so this is a pure fixture-consistency fix with no effect on their assertions.
const run = (step, request = makeRequest({}), extra = {}) => {
  const deps = makeExecutorDeps({
    models: { 'mk-a': createFakeModel(1), 'mk-b': createFakeModel(2) },
    ...extra,
  });
  deps.world.script(step);
  return createLocalUnitExecutor(deps)(request).then((outcome) => ({ world: deps.world, outcome }));
};
const rawPair = (over = {}) => ({ source: { modelId: 1, dbId: 10, model: {} },
  target: { modelId: 2, dbId: 20, model: {} }, type: 'volume-overlap', witness: null, ...over });

test('the composed world exposes P0 fake-world surface verbatim, including hold()', () => {
  // The composition NARROWS nothing: P7's disposal tests park an in-flight call with `hold()`.
  const w = makeExecutorDeps({}).world;
  for (const k of ['calls', 'script', 'hold', 'inFlight', 'maxInFlight', 'disposed', 'findClashes',
    'admitModel', 'isLeaseValid', 'evictModel', 'invalidateModelPlacement', 'dispose']) {
    assert.ok(k in w, `createExecutionWorld must pass through ${k}`);
  }
  assert.equal(typeof w.hold, 'function');
});

test('the call is always the targets shape with groupBy dbId and one mode', async () => {
  // `mk-c` is a THIRD participant this test introduces beyond the default two-model fixture, so it
  // must also be added to `snapshot` (the authoritative participant list the executor's lease gate
  // and generation bookkeeping iterate -- P4.8's `participantKeys = request.snapshot.map(...)`) and
  // to `models`/the registry, or `resolved.byKey.get('mk-c')` would be undefined when
  // `buildFindClashesQuery` reads its `.model`. `scopeExpect` is left at its two-entry default:
  // `checkScopeBracket` only re-digests the scopes an expectation actually lists, so a target with no
  // expectation entry is simply never bracketed, which is legal.
  const { world } = await run(empty, makeRequest({ mode: 'surface-intersection',
    targets: [{ modelKey: 'mk-b', scope: 'whole' }, { modelKey: 'mk-c', scope: 'roots', dbIds: [7, 8] }],
    snapshot: [
      // bindingGeneration 1 = P1's value for a key's first registration; the executor now compares
      // these run-start generations against the live registry (internal holistic review, 2026-09-22).
      { modelKey: 'mk-a', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
      { modelKey: 'mk-b', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
      { modelKey: 'mk-c', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 0 },
    ] }),
  { models: { 'mk-a': createFakeModel(1), 'mk-b': createFakeModel(2), 'mk-c': createFakeModel(3) } });
  assert.equal(world.calls.length, 1);
  const q = world.calls[0].query;   // P0 records {index, query, snapshot}
  assert.deepEqual(Object.keys(q).sort(), ['broadPhase', 'groupBy', 'mode', 'source', 'target']);
  assert.equal(q.groupBy, 'dbId');
  assert.equal(q.mode, 'surface-intersection');
  assert.equal('clearance' in q, false, 'clearance is absent for a non-clearance mode');
  assert.ok(Array.isArray(q.target.targets), 'never the legacy {model, dbIds} shape');
  assert.equal('dbIds' in q.target.targets[0], false, 'whole-model target omits dbIds entirely');
  assert.deepEqual(q.target.targets[1].dbIds, [7, 8]);
  assert.deepEqual(q.source.dbIds, [10, 11]);
});

test('clearance mode carries the definition clearance; the library has no default', async () => {
  const { world } = await run(empty, makeRequest({ mode: 'clearance', clearance: 0.05 }));
  assert.equal(world.calls[0].query.clearance, 0.05);
});

test('the engine passes fresh arrays and never mutates plan data after issue', async () => {
  const request = makeRequest({});
  await run((q) => { q.source.dbIds.push(999); return empty(); }, request);
  assert.deepEqual(request.materialized.sourceDbIds, [10, 11], 'the library got a copy, not the plan array');
});

test('a ClashPair carrying a live Model never leaks: the outcome is structured-clone safe (F4)', async () => {
  const liveModel = { id: 2 };
  liveModel.window = liveModel;   // the circular reference that crashed the M1 gate
  const { outcome } = await run(() => ({
    pairs: [rawPair({ target: { modelId: 2, dbId: 20, model: liveModel },
      witness: { kind: 'surface-crossing', point: [1, 2, 3] } })],
    statistics: { broadPhasePairs: 1, diagnostics: [] },
  }));
  assert.equal(outcome.outcome, 'evaluated');
  assert.doesNotThrow(() => structuredClone(outcome), 'a raw ClashPair[] would throw here');
  assert.deepEqual(outcome.pairs, [{ source: { modelKey: 'mk-a', dbId: 10 }, target: { modelKey: 'mk-b', dbId: 20 },
    type: 'volume-overlap', witness: { kind: 'surface-crossing', point: [1, 2, 3] } }]);
  assert.equal(JSON.stringify(outcome).includes('modelId'), false);
});

test('library pair ORDER is preserved verbatim; canonical ordering is not the executor\'s job (F3)', async () => {
  const { outcome } = await run(() => ({
    pairs: [30, 10, 20].map((dbId) => rawPair({ source: { modelId: 1, dbId, model: {} } })), statistics: {} }));
  assert.deepEqual(outcome.pairs.map((x) => x.source.dbId), [30, 10, 20]);
});

test('more pairs than maxPairsPerOutcome yields the O(1) marker with no projection', async () => {
  const pairs = new Proxy(new Array(5_000).fill(rawPair()), {
    get(t, k, r) { if (typeof k === 'string' && /^\d+$/.test(k)) assert.fail('read an element of an over-cap pairs array'); return Reflect.get(t, k, r); },
  });
  const { outcome } = await run(() => ({ pairs, statistics: {} }),
    makeRequest({ limits: { maxPairsPerOutcome: 1_000, maxDiagnosticsPerOutcome: 2_000, maxDistinctReasons: 64 } }));
  assert.deepEqual(outcome.pairs, []);
  assert.equal(outcome.pairsOverflowLength, 5_000);
});

test('durationMs comes from the injected clock, never wall time', async () => {
  const clock = createFakeClock({ start: 0 });
  const { outcome } = await run(() => { clock.advance(42); return empty(); }, makeRequest({}), { now: clock.now });
  assert.equal(outcome.durationMs, 42);
});
