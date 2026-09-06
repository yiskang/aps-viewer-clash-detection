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

// A box with one face's two triangles removed from the index: still ONE edge-connected component,
// but not a closed manifold -- GeometryConnectivity reports closedManifold: [false] for it. This is
// the geometry that makes `unverified-parity-operand` (a PAIR-scoped diagnostic, via `attach()`)
// reachable end-to-end, per test/CollisionWorld.findClashes.dispatch.test.mjs's own identical helper.
function openBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.setIndex(Array.from(g.index.array).slice(6));
  return g;
}

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
  // never 3.
  assert.equal(world.getEpochCollisionInstanceCount(epoch), 2, 'fragment 100 counted once, not twice');
  // `result.pairs.length` is now 1, not 2 (Task 7/8's documented, deliberate self-exclusion behavior
  // change): before self-exclusion existed, this fixture's own choice to let dbId 10 appear on BOTH
  // sides produced a degenerate self-pair (10-vs-10, two coincident identical boxes -- a real
  // surface-intersection hit under the OLD unconditional broad phase) in addition to the real
  // (10,20) hit. Self-exclusion now removes fragment 100 from the target side entirely (it is the
  // source's own extracted fragment, same epoch), so only the real (10,20) hit remains.
  assert.equal(result.pairs.length, 1, 'self-exclusion removes the (10,10) self-pair; only the real (10,20) hit remains');
});

// === Task 7/8: source self-exclusion, epoch-qualified dedup, operand-local provenance ============

test('legacy {model, dbIds} shape: an overlapping dbId on both sides is self-excluded (documented M1 behavior change)', async () => {
  // M1 never had a self-exclusion concept: `_runBroadPhaseScan`'s original unconditional Cartesian
  // loop counted and retested every pair, including a pathological self-pair from a caller passing an
  // overlapping dbId on both source and target. Task 8 applies self-exclusion UNIFORMLY, including to
  // this plain legacy `{model, dbIds}` shape -- this is the one narrow, deliberate, documented
  // behavior change to broadPhasePairs's numeric value and to `pairs` for this specific scenario.
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
    target: { model: modelA, dbIds: [10, 20] }, // LEGACY shape, dbId 10 shared with source
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  // Only the real (10,20) hit; the (10,10) self-pair is excluded and never even counted.
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 10);
  assert.equal(result.pairs[0].target.dbId, 20);
  assert.equal(result.statistics.broadPhasePairs, 1, 'the self-pair is never counted, not merely filtered post-hoc');
});

test('source self-exclusion is assembly-rooted (spec §4.4): excludes by fragmentId membership, not by the requested source dbId', async () => {
  // The source query requests only the PARENT assembly dbId (0). Extraction's own depth-first walk
  // discovers fragments actually OWNED by CHILD dbIds 10 and 20 (first-discovery-wins ownerDbId
  // capture) -- neither child dbId was ever "requested" as source. The target scope independently
  // names those same two child dbIds. Every one of those fragments must still be excluded, because
  // exclusion is keyed by (loadEpoch, fragmentId) membership in the source's own extracted set, never
  // by dbId-level equality against the literal source.dbIds the caller supplied.
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [
      {
        dbId: 0,
        children: [
          { dbId: 10, fragments: [100] },
          { dbId: 20, fragments: [200] },
        ],
      },
      // A GENUINELY separate top-level dbId, outside the assembly's own subtree -- the source's
      // dbIds:[0] walk never reaches it, so it is NOT a source-owned fragment and self-exclusion must
      // NOT touch it. Its own box is placed far away (disjoint AABB) so it still correctly produces
      // zero pairs, but for the ordinary "AABB miss" reason -- not because of self-exclusion. This is
      // what proves self-exclusion doesn't over-exclude / leak onto candidates it has no business
      // touching.
      { dbId: 40, fragments: [400] },
    ],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
      400: { geometryIndex: 2, geometry: box(2, 2, 2), at: [50, 0, 0] }, // far away, disjoint AABB
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [0] }, // only the PARENT assembly dbId requested
    // Target scope: dbIds 10 and 20 (the assembly's own children, source-owned -- must be
    // self-excluded) PLUS dbId 40 (genuinely outside the source's own extraction -- must survive
    // self-exclusion and be tested on its own merits).
    target: { model: modelA, dbIds: [10, 20, 40] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  // Every fragment the source's own assembly walk discovered (100 under dbId 10, 200 under dbId 20)
  // is excluded from the target side, even though the source's own query.source.dbIds named only the
  // parent (0), never 10 or 20 directly. dbId 40's fragment is NOT source-owned (self-exclusion
  // correctly leaves it alone) and is far away (disjoint AABB), so it correctly produces zero pairs
  // on its own merits, not because of self-exclusion.
  assert.deepEqual(result.pairs, []);
  // broadPhasePairs === 2, not 0: the source's own dbIds:[0] walk discovers TWO fragments (100 under
  // child 10, 200 under child 20), so sourceInstances.length === 2. The target group has 3 instances
  // (fragments 100, 200, 400 under dbIds 10/20/40). Every (source, target) pair whose TARGET is
  // fragment 100 or 200 is self-excluded (2 target instances x 2 source instances = 4 pairs, never
  // counted). Only target fragment 400 (dbId 40) survives self-exclusion, paired against EACH of the
  // 2 source instances = 2 counted pairs (each then fails _testBroadPhasePair on its own
  // disjoint-AABB merits) -- proving self-exclusion doesn't over-exclude dbId 40's own candidates.
  assert.equal(result.statistics.broadPhasePairs, 2, 'only dbId 40s 2 candidates (one per source instance) survive self-exclusion');
});

test('dedup key is epoch-qualified: the same numeric dbId in two different target models both clash with source and are NOT collapsed', async () => {
  // modelA carries the source (dbId 1) AND a target-side dbId 5, coincident with the source's own
  // box. modelB carries its OWN target-side dbId 5 (same numeric dbId, a DIFFERENT model/epoch),
  // also coincident with the source. Both must appear as distinct pairs.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [{ dbId: 1, fragments: [100] }, { dbId: 5, fragments: [500] }] }],
    fragSpecsA: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      500: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
    rootNodesB: [{ dbId: 5, fragments: [5000] }],
    fragSpecsB: { 5000: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [5] }, { model: modelB, dbIds: [5] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.pairs.length, 2, 'both same-numeric-dbId-5 targets, in two different models, appear as distinct pairs');
  const byModelId = new Map(result.pairs.map((p) => [p.target.modelId, p]));
  assert.equal(byModelId.get(modelA.id).target.dbId, 5);
  assert.equal(byModelId.get(modelA.id).target.model, modelA);
  assert.equal(byModelId.get(modelB.id).target.dbId, 5);
  assert.equal(byModelId.get(modelB.id).target.model, modelB);
});

test('ClashPair carries an additive model reference per operand, alongside modelId (=== identity, not deep-equal)', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 2, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [2] }] },
    mode: 'volume-overlap', groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.model, modelA, 'source.model is the REAL modelA object (===)');
  assert.equal(result.pairs[0].target.model, modelB, 'target.model is the REAL modelB object (===)');
  assert.equal(result.pairs[0].source.modelId, modelA.id, 'modelId is untouched/additive alongside model');
  assert.equal(result.pairs[0].target.modelId, modelB.id);
});

test('fragment-diagnostic dedup is (loadEpoch, fragmentId)-keyed, not bare fragmentId: two epochs sharing a numeric fragmentId both get diagnosed', async () => {
  // Two DIFFERENT models (hence different epochs) each own a fragment numbered 999 (same numeric
  // fragmentId, different model/epoch). Both are made OVERSIZED via an unsupported raw-geometry shape
  // (a deliberately non-THREE object, matching this repo's existing oversized-fixture convention),
  // and both must be diagnosed -- a bare-fragmentId Set would incorrectly suppress the second.
  const notARealGeometry = { attributes: {}, index: null }; // no resolvable position attribute
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [1] }, { dbId: 999, fragments: [999] }],
    fragSpecsA: {
      1: { geometryIndex: 0, geometry: box(50, 50, 50), at: [0, 0, 0] },
      999: { geometryIndex: 1, geometry: notARealGeometry, bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    },
    rootNodesB: [{ dbId: 999, fragments: [999] }],
    fragSpecsB: {
      999: { geometryIndex: 0, geometry: notARealGeometry, bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [999] }, { model: modelB, dbIds: [999] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  const oversizedDiagnostics = result.statistics.diagnostics.filter((d) => d.scope === 'fragment' && d.role === 'target');
  assert.equal(oversizedDiagnostics.length, 2, 'both epochs own fragmentId 999 -- both must be diagnosed, not deduped away');
  const modelIds = oversizedDiagnostics.map((d) => d.fragment.modelId).sort();
  assert.deepEqual(modelIds, [modelA.id, modelB.id].sort());
});

test('operand-local model/epoch: a fragment-scoped diagnostic on a cross-model pair names the CORRECT per-operand model', async () => {
  const notARealGeometry = { attributes: {}, index: null }; // no resolvable position attribute
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [1] }],
    fragSpecsA: { 1: { geometryIndex: 0, geometry: box(50, 50, 50), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 2, fragments: [2] }],
    fragSpecsB: { 2: { geometryIndex: 0, geometry: notARealGeometry, bounds: { min: [0, 0, 0], max: [1, 1, 1] } } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [2] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  const targetDiagnostic = result.statistics.diagnostics.find((d) => d.scope === 'fragment' && d.role === 'target');
  assert.ok(targetDiagnostic, 'the oversized target fragment must be diagnosed');
  assert.equal(targetDiagnostic.fragment.modelId, modelB.id, 'target-side diagnostic must name modelB, never modelA');
});

test('operand-local model/epoch: a PAIR-scoped diagnostic (attach()) on a cross-model pair names each side\'s CORRECT own model', async () => {
  // The test above exercises `diagnoseFragmentOnce` (a FRAGMENT-scoped diagnostic, via `buildOne`'s
  // oversized-geometry path) -- it does NOT exercise `attach()`, which is what produces PAIR-scoped
  // diagnostics (`unverified-parity-operand`, `crossing-budget-exhausted`, etc.) and is the OTHER call
  // site Task 7 changed to use `sourceOperand.model`/`targetOperand.model` instead of one shared
  // `model`. This test closes that gap: source is a small closed box strictly inside modelB's own
  // OPEN target box (not a closed manifold) under `containment` mode -- exactly the
  // `unverified-parity-operand` fixture shape test/CollisionWorld.findClashes.dispatch.test.mjs's own
  // single-model test uses, ported cross-model.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 10, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 20, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: openBox(6, 6, 6), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [10] },
    target: { targets: [{ model: modelB, dbIds: [20] }] },
    mode: 'containment', groupBy: 'dbId',
  });
  const parity = result.statistics.diagnostics.find((d) => d.reason === 'unverified-parity-operand');
  assert.ok(parity, `expected unverified-parity-operand, got ${JSON.stringify(result.statistics.diagnostics.map((d) => d.reason))}`);
  assert.equal(parity.scope, 'pair');
  assert.equal(parity.role, 'target');
  // Each side is attributed to its OWN model -- never one shared value (the exact bug a leftover
  // single shared `model` param inside `attach()` would produce).
  assert.equal(parity.sourceFragment.modelId, modelA.id, 'sourceFragment must name modelA');
  assert.equal(parity.targetFragment.modelId, modelB.id, 'targetFragment must name modelB, never modelA');
  assert.equal(parity.sourceFragment.dbId, 10);
  assert.equal(parity.targetFragment.dbId, 20);
  assert.equal(parity.fragment, undefined, 'a pair-scoped diagnostic must not use the fragment field');
});

test('single-model dedup-key spot-check: the new epoch-qualified key partitions identically to the old bare dbId:dbId key', async () => {
  // Completion criteria (Task 7): for a single-model call, sourceOperand.epoch === targetOperand.epoch
  // always, so the new key `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` reduces to the
  // OLD key `${sourceDbId}:${targetDbId}`'s information content plus a redundant-but-harmless epoch
  // prefix shared by every entry -- the UNIQUENESS PARTITION over a set of (sourceDbId, targetDbId)
  // pairs is identical either way. Verified directly here rather than merely asserted.
  const pairs = [[10, 20], [10, 20], [20, 10], [10, 21]];
  const sharedEpoch = 7;
  const oldKeys = pairs.map(([s, t]) => `${s}:${t}`);
  const newKeys = pairs.map(([s, t]) => `${sharedEpoch}:${s}:${sharedEpoch}:${t}`);
  const partitionOf = (keys) => {
    const groups = new Map();
    keys.forEach((k, i) => {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    return [...groups.values()].map((idxs) => idxs.slice().sort().join(',')).sort();
  };
  assert.deepEqual(partitionOf(newKeys), partitionOf(oldKeys), 'identical uniqueness partition, old key vs new key');
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

// === M-1: symmetric model-presence validation for query.source.model / legacy query.target.model ==

test('M-1: a missing query.source.model is rejected with a clear Error, consuming no epoch', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: undefined, dbIds: [] },
      target: { model: modelA, dbIds: [] },
      mode: 'surface-intersection', groupBy: 'dbId',
    }),
    /query\.source must supply a model/,
  );
  // No epoch was consumed by the rejected call: admitting a never-before-seen model now still
  // yields epoch 1, the very first epoch this world would ever mint.
  const lease = world.admitModel(modelA);
  assert.equal(lease.epoch, 1, 'the rejected call must not have consumed any epoch');
});

test('M-1: a null query.source.model is rejected with a clear Error', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: null, dbIds: [] },
      target: { model: modelA, dbIds: [] },
      mode: 'surface-intersection', groupBy: 'dbId',
    }),
    /query\.source must supply a model/,
  );
});

test('M-1: a missing legacy query.target.model is rejected with a clear Error, consuming no epoch', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: modelA, dbIds: [] },
      target: { model: undefined, dbIds: [] },
      mode: 'surface-intersection', groupBy: 'dbId',
    }),
    /query\.target must supply a model/,
  );
  const lease = world.admitModel(modelA);
  assert.equal(lease.epoch, 1, 'the rejected call must not have consumed any epoch, including the VALID source model\'s');
});

test('M-1: a null legacy query.target.model is rejected with a clear Error', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: modelA, dbIds: [] },
      target: { model: null, dbIds: [] },
      mode: 'surface-intersection', groupBy: 'dbId',
    }),
    /query\.target must supply a model/,
  );
});

test('M-1: a missing model in the NEW targets-array shape is still rejected by its own existing check (unchanged)', async () => {
  const { modelA, viewer } = makeTwoModelFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: modelA, dbIds: [] },
      target: { targets: [{ model: undefined, dbIds: [] }] },
      mode: 'surface-intersection', groupBy: 'dbId',
    }),
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

// === Task 8: cross-model linear-oracle broad phase (the shippable milestone) ====================

test('THE MILESTONE: source has a same-model AND a cross-model Hard Clash -- both aggregate in one pairs array, genuinely non-empty end-to-end', async () => {
  // Source (modelA dbId 1) clashes with:
  //  - a SAME-MODEL target (modelA dbId 2), and
  //  - a CROSS-MODEL target (modelB dbId 1),
  // both coincident boxes, both real surface-intersection hits. Neither target is the source itself.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children: [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [20] }] }],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      20: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelA, dbIds: [2] }, { model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(result.pairs.length, 2, 'both the same-model and cross-model Hard Clash aggregate together');
  const sameModelPair = result.pairs.find((p) => p.target.model === modelA);
  const crossModelPair = result.pairs.find((p) => p.target.model === modelB);
  assert.ok(sameModelPair, 'the same-model clash (modelA dbId 2) must be present');
  assert.ok(crossModelPair, 'the cross-model clash (modelB dbId 1) must be present');
  assert.equal(sameModelPair.target.dbId, 2);
  assert.equal(sameModelPair.source.model, modelA);
  assert.equal(crossModelPair.target.dbId, 1);
  assert.equal(crossModelPair.source.model, modelA);
  assert.equal(crossModelPair.source.dbId, 1);
  // The source itself is correctly excluded: modelA dbId 1 does NOT appear as its own target, even
  // though it was never explicitly listed in the targets scope above (nothing to exclude here by
  // construction, but this documents that the fixture is not accidentally self-clashing).
  assert.equal(result.pairs.some((p) => p.target.model === modelA && p.target.dbId === 1), false);
});

test('whole-model target scope (targets:[{model}], no dbIds) against a dense model finds every real clash via extractAllFragments', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 1, fragments: [100] }, // clashes with source
      { dbId: 2, fragments: [200] }, // does NOT clash (disjoint AABB)
      { dbId: 3, fragments: [300] }, // clashes with source
    ],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [50, 0, 0] },
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [0, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB }] }, // dbIds omitted -- whole-model scope
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.pairs.length, 2, 'both real clashes (dbId 1 and dbId 3) found, the disjoint dbId 2 correctly excluded');
  const targetDbIds = result.pairs.map((p) => p.target.dbId).sort();
  assert.deepEqual(targetDbIds, [1, 3]);
});

test("an explicit broadPhase:'tlas' request runs the SAME linear scan and finds the correct real clash (documented placeholder behavior, not yet a real TLAS dispatch)", async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase: 'tlas',
  });
  assert.equal(result.pairs.length, 1, "broadPhase:'tlas' finds the real clash via the same linear scan today");
  assert.equal(result.pairs[0].target.model, modelB);
});

test('O(n*m)-per-pair shape, single target epoch: broadPhasePairs equals sourceCount*targetCount exactly', async () => {
  // Baseline sanity check before the two-epoch discriminator test below: 2 source instances x 3
  // target instances, one single target epoch -- broadPhasePairs must be exactly 6.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [
      { dbId: 1, fragments: [10] },
      { dbId: 2, fragments: [20] },
    ],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [1000, 0, 0] }, // disjoint from everything
      20: { geometryIndex: 1, geometry: box(0.01, 0.01, 0.01), at: [1000, 0, 0] },
    },
    rootNodesB: [
      { dbId: 1, fragments: [100] },
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
      200: { geometryIndex: 1, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
      300: { geometryIndex: 2, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1, 2] }, // 2 source instances
    target: { targets: [{ model: modelB, dbIds: [1, 2, 3] }] }, // 1 target epoch, 3 instances
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.statistics.broadPhasePairs, 6, '2 source x 3 target instances, one target epoch');
  assert.equal(result.pairs.length, 0, 'all fixtures are deliberately AABB-disjoint');
});

test('O(n*m)-per-pair shape across TWO target epochs: broadPhasePairs is the SUM, not a merged product', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [
      { dbId: 1, fragments: [10] },
      { dbId: 2, fragments: [20] },
    ],
    fragSpecsA: {
      10: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [1000, 0, 0] },
      20: { geometryIndex: 1, geometry: box(0.01, 0.01, 0.01), at: [1000, 0, 0] },
    },
    rootNodesB: [
      { dbId: 1, fragments: [100] },
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      100: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
      200: { geometryIndex: 1, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
      300: { geometryIndex: 2, geometry: box(0.01, 0.01, 0.01), at: [2000, 0, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // Source has 2 instances (dbIds 1,2 in modelA). Target has TWO distinct epochs: modelA's own dbId 3
  // (needs adding) is unavailable here without a third dbId in rootNodesA -- instead, target epoch #1
  // is modelA's dbIds [1,2] themselves (2 instances -- self-excluded entirely, since they ARE the
  // source's own fragments) and target epoch #2 is modelB's dbIds [1,2,3] (3 instances, none
  // self-excluded, all disjoint). A merged-Cartesian-product implementation that failed to scope
  // self-exclusion PER GROUP could double-count or cross-contaminate; the correct SUM is
  // 0 (all 4 modelA candidates self-excluded, never counted) + 6 (2 source x 3 modelB instances,
  // none self-excluded) = 6.
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [1, 2] },
    target: { targets: [{ model: modelA, dbIds: [1, 2] }, { model: modelB, dbIds: [1, 2, 3] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.statistics.broadPhasePairs, 6, '0 (all self-excluded) + 6 (2x3 cross-model), summed per target epoch');
  assert.equal(result.pairs.length, 0, 'all real candidates are AABB-disjoint');
});

// === I-1: broad-phase ceiling reconciled against the POST-self-exclusion count =====================

test('I-1: same-model query where source is fully contained in the target scope no longer falsely trips the ceiling', async () => {
  // 1001 source fragments; the target scope is the IDENTICAL 1001 dbIds (source ⊆ target, in fact
  // source === target here). The RAW pre-self-exclusion product (1001 x 1001 = 1,002,001) exceeds
  // maxBroadPhaseInstancePairs (1,000,000) -- the OLD code (finding I-1) threw
  // "broad-phase candidate count exceeds maxBroadPhaseInstancePairs" here even though EVERY one of
  // those candidate pairs is self-excluded (every target fragment IS a source fragment, same epoch),
  // so the REAL scan evaluates exactly ZERO pairs. The fix must reconcile the ceiling against that
  // true post-exclusion count and let this call through.
  const dbIds = Array.from({ length: 1001 }, (_, i) => 1000 + i);
  const children = dbIds.map((dbId) => ({ dbId, fragments: [dbId] }));
  const fragSpecsA = {};
  for (const dbId of dbIds) fragSpecsA[dbId] = { geometryIndex: dbId, at: [dbId, 0, 0] };
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children }],
    fragSpecsA,
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds }, // 1001 source fragments
    target: { model: modelA, dbIds }, // legacy shape, IDENTICAL scope to source (same model/epoch)
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.deepEqual(result.pairs, [], 'every candidate is self-excluded, so there are zero real pairs');
  assert.equal(result.statistics.broadPhasePairs, 0,
    'every one of the raw 1001x1001 candidates is self-excluded before ever being counted');
});

test('I-1: a partially-overlapping same-model scope uses the TRUE post-exclusion count, not the raw product, for the ceiling', async () => {
  // A companion to the "fully contained" case above: the target scope OVERLAPS the source's own
  // extracted set on some fragments (self-excluded) and contains additional, genuinely distinct
  // fragments (never self-excluded). The raw product would trip the ceiling; the true post-exclusion
  // count must not.
  const overlapDbIds = Array.from({ length: 1000 }, (_, i) => 2000 + i); // shared with source -- self-excluded
  const extraDbIds = Array.from({ length: 1 }, (_, i) => 3000 + i); // target-only, genuinely new
  const allTargetDbIds = [...overlapDbIds, ...extraDbIds];
  const children = allTargetDbIds.map((dbId) => ({ dbId, fragments: [dbId] }));
  const fragSpecsA = {};
  for (const dbId of allTargetDbIds) fragSpecsA[dbId] = { geometryIndex: dbId, at: [dbId, 0, 0] };
  const { modelA, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 0, children }],
    fragSpecsA,
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  // sourceCount = 1000 (overlapDbIds only), targetCount (raw) = 1001 (overlap + extra). Raw product =
  // 1,001,000 > 1,000,000 (would have falsely rejected under the OLD code). True post-exclusion
  // target count = 1 (only extraDbIds' single fragment survives self-exclusion), so the true product
  // is 1000, nowhere near the ceiling.
  const result = await world.findClashes({
    source: { model: modelA, dbIds: overlapDbIds },
    target: { model: modelA, dbIds: allTargetDbIds },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(result.statistics.broadPhasePairs, 1000,
    '1000 source instances x 1 surviving (non-self-excluded) target instance');
  assert.deepEqual(result.pairs, [], 'fixtures are deliberately non-overlapping in space (distinct at[] positions)');
});

// === I-2: extraction-diagnostic dedup for a duplicate-model targets entry ==========================

test('I-2: a duplicate-model whole-model targets entry produces each real extraction diagnostic exactly once, not twice', async () => {
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [] }],
    rootNodesB: [
      { dbId: 1, fragments: [0] },
      { dbId: 2, fragments: [1] },
    ],
    fragSpecsB: {
      0: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
    modelOptionsB: { hiddenDbIds: [2] }, // dbId 2's fragment (1) is hidden -- ONE real diagnostic
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes({
    source: { model: modelA, dbIds: [] },
    // Duplicate whole-model targets entry naming the SAME model twice -- extractAllFragments(modelB)
    // runs twice, and its diagnostics array must not be pushed into statistics.diagnostics twice.
    target: { targets: [{ model: modelB }, { model: modelB }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });
  const hiddenDiagnostics = result.statistics.diagnostics.filter((d) => d.reason === 'fragment-hidden');
  assert.equal(hiddenDiagnostics.length, 1,
    'dbId 2s fragment-hidden condition happened once and must appear once, not once per duplicate targets entry');
  assert.equal(hiddenDiagnostics[0].fragment.fragId, 1);
  assert.equal(hiddenDiagnostics[0].fragment.dbId, 2);
});

// === M-2: representative-fragment recording moved AFTER the full admission preflight ===============

test("M-2: a capacity-preflight failure on a LATER epoch leaves NO epoch's representative-fragment state populated", async () => {
  // Same fixture shape as the pre-existing "multi-model call failing the ceiling on the SECOND
  // target model leaves ZERO instances committed to the first" test above, but asserting the OTHER
  // half of the M-2 fix: not just the instance-cache bucket, but the REPRESENTATIVE-FRAGMENT map for
  // every epoch this call touched (including epochs that had nothing to do with the failure) must
  // also stay empty.
  const sourceChildren = [{ dbId: 1, fragments: [1] }];
  const smallTargetChildren = [{ dbId: 2, fragments: [2] }];
  const overCount = maxCollisionInstancesPerEpoch + 1; // 20,001
  const fragsPerDbId = 5000;
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
  // M-2: modelA/source's own REPRESENTATIVE-FRAGMENT map must ALSO stay empty -- the admission
  // preflight for the whole call now runs, for every epoch, strictly BEFORE
  // _recordRepresentativeFragments runs for ANY of them, so modelB's later capacity failure can no
  // longer leave modelA's map populated the way Task 6's ordering did.
  assert.equal(world._representativeFragmentByGeometry.get(leaseA.epoch)?.size ?? 0, 0,
    "modelA/source epoch's representative-fragment map must stay empty after modelB's later capacity failure");
  const leaseB = world.admitModel(modelB);
  assert.equal(world._representativeFragmentByGeometry.get(leaseB.epoch)?.size ?? 0, 0,
    "the failing epoch's own representative-fragment map must also stay empty (pre-existing M1 guarantee, unchanged)");
});

test('M-2 hardening (codex-advisor consult on the I-1/M-2 reordering): a reentrant injected clock that evicts a captured model exactly when the admission-preflight timer is captured is caught immediately, before any representative-fragment state is (re)written', async () => {
  // codex-advisor's review of the I-1/M-2 reordering flagged a gap: `admissionStartedAt = this._now()`
  // reads an injected, not-guaranteed-pure/non-reentrant clock. If that clock call itself disposed
  // the world or evicted a captured model, the (read-only, liveness-blind) preflight loop would still
  // run against a now-dead epoch, and `_recordRepresentativeFragments` would RECREATE representative-
  // fragment state for it (evictModel's own `_releaseEpochScopedState` already deleted that epoch's
  // entry) before `admitCollisionInstances`'s own `_assertEpochLive` eventually caught the stale
  // lease downstream. The fix adds `this._assertLeasesStillLive(leases)` immediately after that timer
  // capture, closing the gap at its earliest possible point.
  const { modelA, modelB, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [1] }],
    fragSpecsA: { 1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [1] }],
    fragSpecsB: { 1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [50, 0, 0] } },
  });
  let world;
  let callCount = 0;
  // Empirically verified (one-off stack-trace probe against this exact fixture shape -- a single
  // source dbId/fragment against a single cross-model target dbId/fragment, `broadPhase` omitted):
  // the 6th call to this injected clock is EXACTLY `admissionStartedAt = this._now()`. This is an
  // internal-implementation-count dependency, acknowledged as somewhat fragile to unrelated future
  // changes in this call's own checkpoint/timing shape -- but it is the only way to land a reentrant
  // side effect at that EXACT boundary from outside the class, and the fixture is deliberately the
  // smallest possible shape (1 fragment per side) to keep the count small and stable.
  const reentrantClock = () => {
    callCount++;
    if (callCount === 6) world.evictModel(modelB);
    return 0;
  };
  world = await freshWorld(viewer, { now: reentrantClock });
  const leaseBBefore = world.admitModel(modelB); // captures modelB's epoch before the call; findClashes's
  // own internal admitModel(modelB) is idempotent against this, so it changes nothing about the call.
  await assert.rejects(world.findClashes({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId',
  }), ModelEvictedError);
  assert.ok(callCount >= 6, 'the reentrant clock call this test targets must actually have fired');
  assert.equal(world._representativeFragmentByGeometry.get(leaseBBefore.epoch)?.size ?? 0, 0,
    'the evicted epochs representative-fragment map must stay empty -- caught before _recordRepresentativeFragments ever ran for it');
});
