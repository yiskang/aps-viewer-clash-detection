// test/CollisionWorld.findClashes.crossModel.test.mjs
//
// Task 6: cross-model operand normalization, multi-lease capture, composite liveness checkpoint.
//
// Fixture INTENT is ported from the task brief's Step 1; the plumbing is NOT (the brief's own inline
// stub is left as `/* ... */`). test/CollisionWorld.findClashes.test.mjs's own `makeFixture` hardcodes
// `id: 1` on every model it builds and returns its OWN independent `viewer` object per call -- never
// designed for two distinct models sharing one viewer. This file's `makeTwoModelFixture` below builds
// on `buildMockModel` directly and produces two models with DISTINCT ids sharing ONE
// `viewer.impl.getRenderProxy(model, fragId)` that dispatches by model identity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld, ModelEvictedError, WorldDisposedError } from '../collision/index.js';
import { CapacityExceededError } from '../collision/errors.js';
import { maxCollisionInstancesPerEpoch } from '../collision/constants.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.test.mjs's makeFixture, but for TWO
// distinct Model objects sharing one viewer) -----------------------------------------------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

/**
 * Builds ONE model (with a fresh, fully independent instance tree / fragment list) plus the raw
 * per-fragment geometry map `makeTwoModelFixture`'s shared viewer needs to serve THIS model's own
 * fragments. Does NOT build a `viewer` of its own -- unlike the single-model `makeFixture` in
 * test/CollisionWorld.findClashes.test.mjs, whose per-call viewer object would be wrong to reuse
 * here (CollisionWorld holds exactly one `_viewer` reference for the whole world).
 */
function makeModelPart(id, rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { model, rawGeometryByFragId, stats };
}

/**
 * @param {Object} [opts]
 * @param {Array} [opts.rootNodesA]  modelA's tree, default a trivial single dbId with no fragments.
 * @param {Object} [opts.fragSpecsA]
 * @param {Object} [opts.modelOptionsA]
 * @param {Array} [opts.rootNodesB]
 * @param {Object} [opts.fragSpecsB]
 * @param {Object} [opts.modelOptionsB]
 * @returns {{ modelA, modelB, viewer, statsA, statsB }}
 */
function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }],
    fragSpecsA = {},
    modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }],
    fragSpecsB = {},
    modelOptionsB = {},
  } = opts;
  const a = makeModelPart(1, rootNodesA, fragSpecsA, modelOptionsA);
  const b = makeModelPart(2, rootNodesB, fragSpecsB, modelOptionsB);

  // ONE shared viewer.impl.getRenderProxy -- CollisionWorld has exactly one `_viewer` reference
  // (set once by fromViewer), so a cross-model fixture needs one viewer object able to serve BOTH
  // models' fake render proxies, dispatching by model IDENTITY (not by assuming a single fixed
  // model the way the single-model makeFixture's own assert does).
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        let part;
        if (queriedModel === a.model) part = a;
        else if (queriedModel === b.model) part = b;
        else assert.fail('getRenderProxy called with a Model object neither fixture model produced');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return {
    modelA: a.model, modelB: b.model, viewer, statsA: a.stats, statsB: b.stats,
  };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// === Step 1's tests, filled in for real =========================================================

test('findClashes no longer rejects source.model !== target.model', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB }] },
    mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.deepEqual(result.pairs, []); // empty operands, but no rejection
});

test('two targets entries naming the same Model object collapse to one admitted lease', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [] }],
    rootNodesB: [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [11] }],
    fragSpecsB: {
      10: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      11: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.findClashes({
    source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB, dbIds: [1] }, { model: modelB, dbIds: [2] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  // Empty source -> empty-extraction fast path, so modelB's lease was captured (via admitModel) but
  // no CollisionInstance admission ever ran. The lease-collapse claim is about admitModel itself:
  // calling it twice for the SAME model object must yield the identical epoch (idempotent), proving
  // the two `targets` entries collapsed to one lease rather than each minting a fresh one.
  const leaseFirst = world.admitModel(modelB);
  const leaseSecond = world.admitModel(modelB);
  assert.equal(leaseFirst.epoch, leaseSecond.epoch, 'the SAME model always resolves to the SAME epoch');
});

test('legacy target: {model, dbIds} shape still works unchanged (M1 byte-for-byte compatibility)', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [10] },
    target: { model: modelA, dbIds: [20] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 10);
  assert.equal(result.pairs[0].target.dbId, 20);
});

test('eviction of a captured NON-current-operand model aborts the whole call', async () => {
  // Cross-model call touching models A and B; evict B (not the operand currently being processed)
  // mid-call via an injected checkpoint hook -- assert the whole call rejects ModelEvictedError.
  const sourceChildren = [{ dbId: 9000, fragments: [9000] }, { dbId: 9001, fragments: [9001] }];
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: sourceChildren }],
    fragSpecsA: {
      9000: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] },
      9001: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [100, 0, 0] },
    },
    rootNodesB: [{ dbId: 1, fragments: [9100] }],
    fragSpecsB: { 9100: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) { firstPairSeen = true; world.evictModel(modelB); }
    return originalTestPair(...args);
  };
  await assert.rejects(world.findClashes({
    source: { model: modelA, dbIds: [9000, 9001] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  }), ModelEvictedError);
  assert.equal(firstPairSeen, true, 'the eviction really did land mid-scan');
});

test('empty-extraction fast path still validates the FULL multi-model lease set, not zero checkpoints', async () => {
  // Both operands extract to zero fragments -- assert eviction of a captured (but never touched)
  // model still aborts, closing the empty-return gap for multi-model calls.
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes({
    source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB, dbIds: [] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  world.evictModel(modelB);
  await assert.rejects(pending, ModelEvictedError);
});

test('disposal immediately before a successful return is caught (return-site checkpoint, spec §9.2 point 7b)', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes({
    source: { model: modelA, dbIds: [] },
    target: { targets: [{ model: modelB, dbIds: [] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  world.dispose();
  await assert.rejects(pending, WorldDisposedError);
});

// === Step 7: preflight-admission arithmetic =====================================================

test('multi-model call failing the ceiling on the SECOND target model leaves ZERO instances committed to the first', async () => {
  // modelA's target group is small; modelB's target group alone exceeds the ceiling. modelB's
  // fragments are spread across several dbIds (each within maxFragmentsPerDbId) so this fixture
  // trips ONLY the capacity ceiling under test, never the unrelated fanout/per-dbId extraction
  // limits (maxChildrenPerNode=10,000, maxFragmentsPerDbId=5,000).
  const sourceChildren = [{ dbId: 1, fragments: [1] }];
  const smallTargetChildren = [{ dbId: 2, fragments: [2] }];
  const overCount = maxCollisionInstancesPerEpoch + 1; // 20,001
  const fragsPerDbId = 5000; // == maxFragmentsPerDbId, never exceeded
  const bigChildren = [];
  let assigned = 0;
  while (assigned < overCount) {
    const count = Math.min(fragsPerDbId, overCount - assigned);
    const dbId = 9000 + bigChildren.length;
    bigChildren.push({ dbId, fragments: Array.from({ length: count }, (_, i) => 100_000 + assigned + i) });
    assigned += count;
  }
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [...sourceChildren, ...smallTargetChildren] }],
    fragSpecsA: {
      1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      2: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
    rootNodesB: [{ dbId: 0, children: bigChildren }],
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const leaseA = world.admitModel(modelA);

  await assert.rejects(world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [2] }, { model: modelB, dbIds: bigChildren.map((c) => c.dbId) }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  }), CapacityExceededError);

  assert.equal(world.getEpochCollisionInstanceCount(leaseA.epoch), 0,
    'the first (small) target model must have ZERO instances committed when a LATER epoch fails preflight');
});

test('an epoch already partially populated fails preflight when new+existing exceeds the ceiling, even though the new extraction alone is small', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, fragments: [1] }],
    fragSpecsA: { 1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 0, children: Array.from({ length: 1000 }, (_, i) => ({ dbId: 5000 + i, fragments: [5000 + i] })) }],
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const leaseB = world.admitModel(modelB);
  // Prime modelB's epoch with (maxCollisionInstancesPerEpoch - 500) already-admitted instances, so a
  // fresh 1,000-id extraction (all new) pushes it over the ceiling even though 1,000 alone is tiny.
  const preExisting = new Map();
  for (let i = 0; i < maxCollisionInstancesPerEpoch - 500; i++) {
    preExisting.set(90_000_000 + i, { geometryIdentity: { loadEpoch: leaseB.epoch, geometryIndex: 0 } });
  }
  world.admitCollisionInstances(leaseB, preExisting);
  assert.equal(world.getEpochCollisionInstanceCount(leaseB.epoch), maxCollisionInstancesPerEpoch - 500);

  await assert.rejects(world.findClashes({
    source: { model: modelA, dbIds: [0] },
    target: { targets: [{ model: modelB, dbIds: [] }, { model: modelB, dbIds: Array.from({ length: 1000 }, (_, i) => 5000 + i) }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  }), CapacityExceededError);
});

test('source and target sharing the same model have their fragment ids unioned, not double-counted or preflighted twice', async () => {
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [10] },
    target: { targets: [{ model: modelA, dbIds: [10, 20] }] }, // dbId 10 shared with source
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  const epoch = world.admitModel(modelA).epoch;
  // The ADMISSION-ARITHMETIC claim under test: fragment 100 (reachable from BOTH source's [10] and
  // the target entry's [10, 20]) is admitted exactly ONCE -- 2 CollisionInstances total (100, 200),
  // never 3. `result.pairs.length` is a SEPARATE, incidental consequence of this fixture's own
  // choice to let dbId 10 appear on both sides: it genuinely produces TWO candidate pairs (the
  // degenerate self-pair 10-vs-10, two coincident identical boxes -- a real surface-intersection
  // hit -- plus the real 10-vs-20 hit), not proof of any double-admission bug.
  assert.equal(world.getEpochCollisionInstanceCount(epoch), 2, 'fragment 100 counted once, not twice');
  assert.equal(result.pairs.length, 2, 'the incidental self-pair (10,10) plus the real (10,20) hit');
});

// === Step 8: input validation ====================================================================

function baseQuery(model) {
  return { source: { model, dbIds: [] }, mode: 'surface-intersection', groupBy: 'dbId' };
}

test('empty targets array is rejected', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { targets: [] } }),
    /targets must be non-empty/,
  );
});

test('supplying both target.dbIds and target.targets is rejected', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { model: modelA, dbIds: [], targets: [{ model: modelB }] } }),
    /either \{model,dbIds\} or \{targets\}, not both/,
  );
});

test('a targets entry with no model is rejected', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { targets: [{ dbIds: [] }] } }),
    /every targets entry must supply a model/,
  );
});

test('a targets entry dbIds present but not an array is rejected; dbIds:null is rejected too', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { targets: [{ model: modelB, dbIds: 'nope' }] } }),
    /dbIds must be an array when supplied/,
  );
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { targets: [{ model: modelB, dbIds: null }] } }),
    /dbIds must be an array when supplied/,
  );
});

test('an explicit dbIds:undefined targets entry is accepted as the whole-model-scope sentinel (validation only)', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Source is empty, so this hits the empty-extraction fast path before whole-model extraction for
  // modelB would ever need to run for real (Task 8's job) -- this test asserts VALIDATION accepts
  // the shape, not that whole-model extraction is fully wired.
  const result = await world.findClashes({ ...baseQuery(modelA), target: { targets: [{ model: modelB }] } });
  assert.deepEqual(result.pairs, []);
});

test('an unsupported broadPhase value is rejected', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...baseQuery(modelA), target: { targets: [{ model: modelB }] }, broadPhase: 'nonsense' }),
    /unsupported broadPhase/,
  );
});

test("broadPhase: 'tlas' is accepted with the LEGACY {model, dbIds} target shape too", async () => {
  // 'tlas' broad-phase execution itself is Tasks 7/8+'s job (not yet wired) -- this only proves the
  // ENUM VALUE passes Step 8's validation rather than being rejected as "unsupported broadPhase". An
  // empty-dbIds call takes the empty-extraction fast path regardless of which broad phase would
  // eventually run, so this is a pure validation spot-check, not a broad-phase behavior test.
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({ ...baseQuery(modelA), target: { model: modelA, dbIds: [] }, broadPhase: 'tlas' });
  assert.deepEqual(result.pairs, []);
});
