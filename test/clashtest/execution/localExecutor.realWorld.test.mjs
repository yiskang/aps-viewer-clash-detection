// test/clashtest/execution/localExecutor.realWorld.test.mjs
//
// T2: the executor over a REAL `CollisionWorld` + `buildMockModel` fixtures (Task P4.6 step 5, plus
// Task P4.7's pinned linear-ceiling compatibility case appended at the end) -- real diagnostics, real
// pairs, a real linear-ceiling error, and a statistics-key drift guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../../../collision/index.js';   // TEST-ONLY import; the engine core imports none of this
import { makeTwoModelFixture, box } from '../support/realWorldFixture.mjs';
import { makeExecutorDeps, makeRequest as realRequest } from '../support/executionRequests.mjs';
import { createLocalUnitExecutor, LINEAR_CEILING_MESSAGE_PREFIX } from '../../../clashtest/execution/LocalUnitExecutor.js';
import { LIBRARY_STATISTICS_KEYS } from '../../../clashtest/execution/diagnostics.js';

const OVERLAPPING = {   // modelA's dbId 100 and modelB's dbId 200 overlap by construction
  rootNodesA: [{ dbId: 100, fragments: [1] }],
  fragSpecsA: { 1: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  rootNodesB: [{ dbId: 200, fragments: [2] }],
  fragSpecsB: { 2: { geometryIndex: 0, geometry: box(2, 2, 2), at: [1, 0, 0] } },
};
const realWorld = async (fixture) => {
  const f = makeTwoModelFixture(fixture);
  const world = await CollisionWorld.fromViewer(f.viewer, { now: () => 0 });
  // Same P4-local builder as the fake-world tests, given a REAL world and the real models.
  return { ...f, world, exec: createLocalUnitExecutor(makeExecutorDeps({ world, models: { 'mk-a': f.modelA, 'mk-b': f.modelB } })) };
};

test('a real cross-model volume-overlap unit produces a clone-safe evaluated outcome', async () => {
  const { exec } = await realWorld(OVERLAPPING);
  const outcome = await exec(realRequest({ mode: 'volume-overlap', sourceDbIds: [100],
    targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [200] }] }));
  assert.equal(outcome.outcome, 'evaluated');
  assert.equal(outcome.scopeProof, 'equal');
  assert.equal(outcome.pairs.length, 1);
  assert.deepEqual(outcome.pairs[0].source, { modelKey: 'mk-a', dbId: 100 });
  assert.deepEqual(outcome.pairs[0].target, { modelKey: 'mk-b', dbId: 200 });
  assert.doesNotThrow(() => structuredClone(outcome), 'a real ClashPair carries a live Model (F4)');
  assert.equal(JSON.stringify(outcome).includes('"modelId"'), false);
});

test('real unattributable diagnostics survive projection with dbId null (F17)', async () => {
  // A whole-model TARGET is the only path that produces fragment-not-loaded /
  // fragment-owner-unresolvable, and their fragment.dbId is hard-coded null in the library.
  //
  // DEVIATION FROM PLAN SKETCH (verified empirically against the real CollisionWorld/buildMockModel):
  // the plan's own fixture added fragIds 3/4 to `fragSpecsB` WITHOUT listing them in any root's
  // `fragments` array. `buildMockModel`'s default `fragmentCount` is "one past the highest fragId
  // owned by any node in rootNodes" (test/fixtures/mockInstanceTree.mjs), which the base
  // `OVERLAPPING` fixture's `rootNodesB: [{ dbId: 200, fragments: [2] }]` pins at 3 -- so fragIds 3
  // and 4 fall OUTSIDE the whole-model enumeration walk's range and neither `notLoadedFragIds: [3]`
  // nor `ownerDbIdOverrides: {4: undefined}` is ever reached; instead the walk (fragIds 0..2) finds
  // fragIds 0 and 1 unclaimed by the tree and reports THEM as `fragment-owner-unresolvable`, and
  // `fragment-not-loaded` never fires at all -- run verbatim, this test's own first assertion fails
  // (confirmed by running it). Fixed by giving modelB one root that CONSECUTIVELY owns fragIds
  // `[0, 1, 2]` (so the default `fragmentCount` covers exactly the fragments this fixture cares
  // about, with no accidental "sparse lookup miss" gap) and applying `notLoadedFragIds` /
  // `ownerDbIdOverrides` to two of those three, mirroring
  // `test/CollisionWorld.findClashes.crossModel.test.mjs`'s own "I-2" fixture shape.
  const flat = { min: [0, 0, 0], max: [0, 0, 0] };
  const { exec } = await realWorld({
    rootNodesA: OVERLAPPING.rootNodesA, fragSpecsA: OVERLAPPING.fragSpecsA,
    rootNodesB: [{ dbId: 200, fragments: [0, 1, 2] }],
    fragSpecsB: {
      0: { geometryIndex: 1, bounds: flat },      // notLoadedFragIds -> fragment-not-loaded
      1: { geometryIndex: 2, bounds: flat },      // ownerDbIdOverrides -> fragment-owner-unresolvable
      2: { geometryIndex: 0, geometry: box(2, 2, 2), at: [1, 0, 0] },  // the real overlapping fragment
    },
    modelOptionsB: { notLoadedFragIds: [0], ownerDbIdOverrides: new Map([[1, undefined]]) },
  });
  const outcome = await exec(realRequest({ mode: 'volume-overlap', sourceDbIds: [100],
    targets: [{ modelKey: 'mk-b', scope: 'whole' }] }));

  const byReason = new Map(outcome.diagnostics.map((d) => [d.reason, d]));
  for (const reason of ['fragment-not-loaded', 'fragment-owner-unresolvable']) {
    const d = byReason.get(reason);
    assert.ok(d, `${reason} must reach the outcome`);
    assert.equal(d.fragment.dbId, null, 'never a sentinel');
    assert.deepEqual([d.fragment.modelKey, d.fragment.role, d.attribution, d.completenessAffecting],
      ['mk-b', 'target', 'target-model', true]);
  }
  assert.doesNotThrow(() => structuredClone(outcome));
});

test('LIBRARY_STATISTICS_KEYS does not drift from the library\'s real statistics shape', async () => {
  const { world, modelA, modelB } = await realWorld();
  const raw = await world.findClashes({ source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB }] }, mode: 'volume-overlap', groupBy: 'dbId' });
  assert.deepEqual(Object.keys(raw.statistics).filter((k) => k !== 'diagnostics').sort(),
    [...LIBRARY_STATISTICS_KEYS].sort(),
    'the closed statistics schema must be updated deliberately when the library adds a field');
});

// ---- Task P4.7's appended T2 compatibility case: the pinned linear-ceiling message matcher -------

// 1,001 x 1,001 = 1,002,001 > maxBroadPhaseInstancePairs (1,000,000). Bounds-only fragments with no
// geometry are enough: `_exceedsBroadPhaseCeiling` is a pure count precheck run after extraction and
// BEFORE admission or any narrow-phase work, so this fixture is cheap.
const CEILING_FIXTURE = (() => {
  const bounds = { min: [0, 0, 0], max: [1, 1, 1] };
  const specs = (base) => Object.fromEntries(Array.from({ length: 1_001 }, (_, i) => [base + i, { geometryIndex: 0, bounds }]));
  const frags = (base) => Array.from({ length: 1_001 }, (_, i) => base + i);
  return { rootNodesA: [{ dbId: 1, fragments: frags(1_000) }], fragSpecsA: specs(1_000),
    rootNodesB: [{ dbId: 2, fragments: frags(5_000) }], fragSpecsB: specs(5_000) };
})();

test('the library still throws a message matching the pinned linear-ceiling matcher (T2 compatibility)', async () => {
  const { world, modelA, modelB } = await realWorld(CEILING_FIXTURE);
  await assert.rejects(
    () => world.findClashes({ source: { model: modelA, dbIds: [1] },
      target: { targets: [{ model: modelB, dbIds: [2] }] }, mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear' }),
    (err) => err.name === 'Error' && err.message.startsWith(LINEAR_CEILING_MESSAGE_PREFIX),
    'if this fails, the engine would classify a real capacity ceiling as failed:internal-error and fail the run',
  );
});

test('the executor maps that same real error to failed:capacity-exceeded', async () => {
  const { exec } = await realWorld(CEILING_FIXTURE);
  const outcome = await exec(realRequest({ mode: 'volume-overlap', broadPhase: 'linear',
    sourceDbIds: [1], targets: [{ modelKey: 'mk-b', scope: 'roots', dbIds: [2] }] }));
  assert.equal(outcome.outcome, 'failed');
  assert.equal(outcome.failure.code, 'capacity-exceeded');
  assert.equal(outcome.failure.capacityKind, undefined, 'a plain Error carries no typed kind');
});
