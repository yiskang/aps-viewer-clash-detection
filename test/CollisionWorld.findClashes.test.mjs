// test/CollisionWorld.findClashes.test.mjs
//
// Task 19: the first end-to-end `CollisionWorld.findClashes` vertical slice --
// entry lifecycle -> self-driven extraction -> capacity-gated CollisionInstance admission ->
// broad-phase AABB scan -> `surface-intersection` narrow-phase dispatch -> ownerDbId aggregation.
//
// Fixture INTENT is ported from the task brief's Step 1, but the mock plumbing is NOT: the brief's
// own inline mock targets a stale Viewer API (`getInstanceTree()` + a `.geomids` Proxy). The real
// one (`getObjectTree()` + `fragList.getGeometryId(fragId)`) is already implemented by
// test/fixtures/mockInstanceTree.mjs's buildMockModel, which is reused here and extended locally
// with the two things Task 19 newly needs: `model.getUnitScale()` and a fake
// `viewer.impl.getRenderProxy(model, fragId)` returning a real THREE.BufferGeometry.
//
// Importing mockInstanceTree.mjs also sets globalThis.THREE as a side effect, which is what
// extractFragments's own `THREE = globalThis.THREE` default resolves to in this headless process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { CollisionWorld as IndexExportedCollisionWorld } from '../collision/index.js';
import { WorldDisposedError, ModelEvictedError } from '../collision/errors.js';
import { ExtractionLimitExceededError } from '../collision/viewer/ViewerModelAdapter.js';
import {
  maxBroadPhaseInstancePairs, maxChildrenPerNode, maxFragmentsPerDbId, maxSyncTriangleCount,
} from '../collision/constants.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing -------------------------------------------------------------------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

/**
 * Builds { model, viewer, stats } from a plain tree spec plus a per-fragment spec.
 *
 * @param {Array} rootNodes  buildMockModel's own tree shape: { dbId, fragments?, children? }
 * @param {Object} fragSpecs { [fragId]: { geometryIndex, geometry?: THREE.BufferGeometry,
 *                                         at?: [x,y,z], bounds?: {min,max} } }
 *   `geometry` is the RAW Viewer-side geometry the fake getRenderProxy hands back; `at` is the
 *   fragment's world translation, used BOTH for the world matrix extraction reads and for the world
 *   bounds the broad phase reads, so the two are always consistent (the real Viewer computes
 *   getWorldBounds from the same placement, and an inconsistent fixture would let a broad-phase bug
 *   pass unnoticed). `bounds` overrides that derivation, for fixtures whose raw geometry is a
 *   deliberately non-THREE object.
 */
function makeFixture(rootNodes, fragSpecs = {}) {
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
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry);
  // buildMockModel predates Task 19; getUnitScale is what _resolveGeometryView reads to scale
  // weldEpsilonMeters. 1 (meters) is the identity case.
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        assert.equal(queriedModel, model, 'getRenderProxy must be called with the leased Model object');
        const geometry = rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { model, viewer, stats };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };

// A frozen clock makes "checkpoint is time-triggered, not unconditional" deterministic: with zero
// elapsed time the frame-budget accumulator is NEVER due, so any yield observed is an unconditional
// one. The eviction/disposal fixtures do NOT need a forced yield -- the checkpoint port validates
// liveness SYNCHRONOUSLY on every call, before it ever consults the accumulator.
function frozenClock() { return () => 0; }
function advancingClock(stepMs = 1000) { let t = 0; return () => (t += stepMs); }

async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}

function query(model, sourceDbIds, targetDbIds, mode = 'surface-intersection') {
  return {
    source: { model, dbIds: sourceDbIds },
    target: { model, dbIds: targetDbIds },
    mode,
    groupBy: 'dbId',
  };
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// === index.js / fromViewer wiring ==============================================================

test('collision/index.js re-exports the same CollisionWorld class', () => {
  assert.equal(IndexExportedCollisionWorld, CollisionWorld);
});

test('fromViewer resolves a non-disposed CollisionWorld with a real GeometryRegistry attached', async () => {
  const world = await freshWorld();
  assert.ok(world instanceof CollisionWorld);
  assert.equal(world._disposed, false);
  assert.equal(typeof world._registry.getOrBuildGeometry, 'function');
  assert.equal(typeof world._registry.releaseEntriesForEpoch, 'function');
});

test('fromViewer rejects unsupported narrowPhase / indexOwnership', async () => {
  await assert.rejects(
    CollisionWorld.fromViewer(null, { narrowPhase: 'bvh.js', indexOwnership: 'clone' }),
    /narrowPhase/,
  );
  await assert.rejects(
    CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'reference' }),
    /indexOwnership/,
  );
});

// === one clashing pair, cheap query: zero yields, correct positive ==============================

test('cheap query: zero yields, exactly one ClashPair naming the owner dbIds', async () => {
  let yieldCount = 0;
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, {
    now: frozenClock(),
    yieldToScheduler: async () => { yieldCount++; },
  });
  const result = await world.findClashes(query(model, [10], [20]));

  assert.equal(yieldCount, 0, 'checkpoint is time-triggered, never unconditional');
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 10);
  assert.equal(result.pairs[0].target.dbId, 20);
  assert.equal(result.pairs[0].type, 'surface-intersection');
  assert.equal(result.pairs[0].source.modelId, model.id);
  assert.equal(typeof result.statistics.broadPhasePairs, 'number');
  assert.equal(result.statistics.broadPhasePairs, 1);
  assert.equal(result.statistics.narrowPhasePairs, 1);
  assert.deepEqual(result.statistics.diagnostics, []);
});

test('separated boxes: broad phase runs, narrow phase never does, zero pairs', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [50, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20]));
  assert.equal(result.pairs.length, 0);
  assert.equal(result.statistics.broadPhasePairs, 1);
  assert.equal(result.statistics.narrowPhasePairs, 0, 'AABB-disjoint pairs never reach the narrow phase');
});

test('surface-intersection really is a SURFACE test: a fully-contained box is not a clash', async () => {
  // AABB-overlapping (so the broad phase passes the pair through) but with no surface crossing at
  // all -- exactly the case `containment` mode exists for (Task 20). A findClashes that short-cut
  // the narrow phase to a bounds test, or that dispatched the wrong query, would report a hit here.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20]));
  assert.equal(result.statistics.broadPhasePairs, 1);
  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair DID reach the narrow phase');
  assert.equal(result.pairs.length, 0, 'containment without surface crossing is not a surface intersection');
});

// === empty / edge cases ========================================================================

test('elements with no fragments: empty pairs, zeroed statistics, no throw', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [] }, { dbId: 20, fragments: [] }] }],
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20]));
  assert.equal(result.pairs.length, 0);
  assert.equal(result.statistics.broadPhasePairs, 0);
  assert.equal(result.statistics.narrowPhasePairs, 0);
  assert.deepEqual(result.statistics.diagnostics, []);
});

test('cross-model query rejects', async () => {
  const a = makeFixture([{ dbId: 1, fragments: [] }]);
  const b = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(a.viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({
      source: { model: a.model, dbIds: [1] },
      target: { model: b.model, dbIds: [1] },
      mode: 'surface-intersection',
      groupBy: 'dbId',
    }),
    (err) => err.code === 'cross-model-query-rejected',
  );
});

test('non-dbId groupBy rejected -- M1 supports only groupBy:dbId', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, children: [{ dbId: 10, fragments: [] }] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...query(model, [10], [10]), groupBy: 'fragment' }),
    /groupBy/,
  );
});

test("containment / volume-overlap are rejected with Task 20's exact placeholder message", async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, children: [{ dbId: 10, fragments: [] }] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes(query(model, [10], [10], 'containment')),
    (err) => err.message === "findClashes: mode 'containment' not yet wired (Task 20)",
  );
  await assert.rejects(
    world.findClashes(query(model, [10], [10], 'volume-overlap')),
    (err) => err.message === "findClashes: mode 'volume-overlap' not yet wired (Task 20)",
  );
  await assert.rejects(world.findClashes(query(model, [10], [10], 'nonsense')), /unsupported mode/);
});

// === disposed / evicted entry-point checks =====================================================

test('disposed world: findClashes rejects WorldDisposedError before any operand or argument check', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.dispose();
  await assert.rejects(world.findClashes(query(model, [1], [1])), WorldDisposedError);
  // Even a query this world would otherwise reject on its own arguments must report disposal first.
  await assert.rejects(world.findClashes({ ...query(model, [1], [1]), groupBy: 'fragment' }), WorldDisposedError);
});

test('findClashes against an already-evicted Model object rejects ModelEvictedError immediately', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.admitModel(model);
  world.evictModel(model);
  await assert.rejects(world.findClashes(query(model, [1], [1])), ModelEvictedError);
});

// === fanout ceiling: maxChildrenPerNode ========================================================

function wideNode(dbId, childCount, { fragmentFree = true, firstChildIsZero = false } = {}) {
  const children = [];
  for (let i = 0; i < childCount; i++) {
    const childDbId = firstChildIsZero && i === 0 ? 0 : dbId * 100000 + i + 1;
    children.push({ dbId: childDbId, fragments: fragmentFree ? [] : [childDbId] });
  }
  return { dbId, children };
}

for (const fragmentFree of [true, false]) {
  test(`fanout ceiling exceeded rejects the entire call (fragmentFree=${fragmentFree})`, async () => {
    const { model, viewer, stats } = makeFixture([wideNode(1, maxChildrenPerNode + 5, { fragmentFree })]);
    const world = await freshWorld(viewer, { now: frozenClock() });
    await assert.rejects(world.findClashes(query(model, [1], [1])), ExtractionLimitExceededError);
    assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1,
      'abort costs exactly maxChildrenPerNode + 1 callbacks -- never a full enumeration');
  });
}

test('fanout ceiling: a first child with dbId 0 does not defeat the abort (falsy-dbId regression)', async () => {
  const { model, viewer, stats } = makeFixture(
    [wideNode(1, maxChildrenPerNode + 5, { fragmentFree: true, firstChildIsZero: true })],
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(world.findClashes(query(model, [1], [1])), ExtractionLimitExceededError);
  assert.equal(stats.enumNodeChildrenCallbacks, maxChildrenPerNode + 1);
});

test('fanout at exactly maxChildrenPerNode proceeds normally (strict >, not >=)', async () => {
  const { model, viewer } = makeFixture([wideNode(1, maxChildrenPerNode, { fragmentFree: true })]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [1], [1]));
  assert.equal(result.pairs.length, 0);
});

// === maxFragmentsPerDbId ceiling, early stop ===================================================

test('maxFragmentsPerDbId exceeded: whole call rejects and the walk stops early, no full enumeration', async () => {
  const perNode = Math.ceil(maxFragmentsPerDbId / 9) + 1; // ceiling crosses at roughly the 9th sibling
  const children = [];
  for (let i = 0; i < 100; i++) {
    children.push({ dbId: 2000 + i, fragments: Array.from({ length: perNode }, (_, j) => 1_000_000 + i * 10000 + j) });
  }
  const { model, viewer, stats } = makeFixture([{ dbId: 1, children }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(world.findClashes(query(model, [1], [1])), ExtractionLimitExceededError);
  assert.ok(stats.enumNodeFragmentsCalls < 50,
    `walk must stop early, not enumerate all 100 siblings (actual=${stats.enumNodeFragmentsCalls})`);
});

test('oversized single-dbId subtree rejects before any instance bucket is created', async () => {
  const { model, viewer } = makeFixture(
    [{
      dbId: 0,
      children: [
        { dbId: 1, fragments: Array.from({ length: maxFragmentsPerDbId + 10 }, (_, i) => 900_000 + i) },
        { dbId: 2, fragments: [50_000] },
      ],
    }],
    { 50000: { geometryIndex: 0, geometry: box(1, 1, 1) } },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(world.findClashes(query(model, [1], [2])), ExtractionLimitExceededError);
  assert.equal(world._instanceCache.size, 0, 'no CollisionInstance bucket may be created for this epoch');
});

// === broad-phase ceiling: overflow-safe division form ==========================================

test('_exceedsBroadPhaseCeiling uses the overflow-safe division form', async () => {
  const world = await freshWorld();
  // At/under the ceiling: never rejected.
  assert.equal(world._exceedsBroadPhaseCeiling(1000, 1000), false, 'exactly at the ceiling is allowed');
  assert.equal(world._exceedsBroadPhaseCeiling(1, maxBroadPhaseInstancePairs), false);
  assert.equal(world._exceedsBroadPhaseCeiling(1001, 1000), true);
  // Counts whose literal product is not exactly representable as a JS number. The division form
  // stays correct here; a `a * b > ceiling` form would be evaluating a rounded product.
  const huge = Number.MAX_SAFE_INTEGER;
  assert.equal(world._exceedsBroadPhaseCeiling(huge, huge), true);
  assert.equal(world._exceedsBroadPhaseCeiling(huge, 2), true);
});

test('maxBroadPhaseInstancePairs exceeded: rejects before the nested scan is ever entered', async () => {
  const sourceCount = 1001;
  const targetCount = 1000; // 1,001,000 > maxBroadPhaseInstancePairs (1,000,000)
  const sourceChildren = Array.from({ length: sourceCount }, (_, i) => ({ dbId: 500_000 + i, fragments: [500_000 + i] }));
  const targetChildren = Array.from({ length: targetCount }, (_, i) => ({ dbId: 600_000 + i, fragments: [600_000 + i] }));
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, children: sourceChildren }, { dbId: 2, children: targetChildren }] }],
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  let scanEntered = false;
  const originalScan = world._runBroadPhaseScan.bind(world);
  world._runBroadPhaseScan = async (...args) => { scanEntered = true; return originalScan(...args); };

  await assert.rejects(world.findClashes(query(model, [1], [2])), /maxBroadPhaseInstancePairs/);
  assert.equal(scanEntered, false, 'the ceiling is a PRE-scan check');
});

// === chunked broad-phase yielding ==============================================================

test('chunked broad phase: every pair is tested, never truncated, and yields when the budget is due', async () => {
  let yieldCount = 0;
  const sourceCount = 20;
  const targetCount = 20;
  const sourceChildren = Array.from({ length: sourceCount }, (_, i) => ({ dbId: 7000 + i, fragments: [7000 + i] }));
  const targetChildren = Array.from({ length: targetCount }, (_, i) => ({ dbId: 8000 + i, fragments: [8000 + i] }));
  const fragSpecs = {};
  for (let i = 0; i < sourceCount; i++) fragSpecs[7000 + i] = { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [i * 100, 0, 0] };
  for (let i = 0; i < targetCount; i++) fragSpecs[8000 + i] = { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [10_000 + i * 100, 0, 0] };
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, children: sourceChildren }, { dbId: 2, children: targetChildren }] }],
    fragSpecs,
  );
  // An always-advancing clock makes the frame budget due at EVERY checkpoint -- the opposite of the
  // frozen-clock fixture above, and what forces the chunked-yield path to run for real.
  const world = await freshWorld(viewer, {
    now: advancingClock(),
    yieldToScheduler: async () => { yieldCount++; },
  });

  let pairsTested = 0;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => { pairsTested++; return originalTestPair(...args); };

  const result = await world.findClashes(query(model, [1], [2]));
  assert.equal(pairsTested, sourceCount * targetCount, 'every source x target pair is examined');
  assert.equal(result.statistics.broadPhasePairs, sourceCount * targetCount);
  assert.ok(yieldCount >= 1, 'the scan yields when the frame budget is due');
  assert.equal(result.pairs.length, 0, 'these fixtures are deliberately all AABB-disjoint');
});

test('eviction mid-broad-phase-scan: the resumed scan rejects ModelEvictedError', async () => {
  const sourceChildren = [{ dbId: 9000, fragments: [9000] }, { dbId: 9001, fragments: [9001] }];
  const targetChildren = [{ dbId: 9100, fragments: [9100] }];
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, children: sourceChildren }, { dbId: 2, children: targetChildren }] }],
    {
      9000: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] },
      9001: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [100, 0, 0] },
      9100: { geometryIndex: 0, geometry: box(0.01, 0.01, 0.01), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  let firstPairSeen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!firstPairSeen) { firstPairSeen = true; world.evictModel(model); }
    return originalTestPair(...args);
  };
  await assert.rejects(world.findClashes(query(model, [1], [2])), ModelEvictedError);
  assert.equal(firstPairSeen, true, 'the eviction really did land mid-scan');
});

test('disposal mid-broad-phase-scan: the resumed scan rejects WorldDisposedError', async () => {
  const { model, viewer } = makeFixture(
    [{
      dbId: 0,
      children: [
        { dbId: 1, children: [{ dbId: 11, fragments: [1] }, { dbId: 12, fragments: [2] }] },
        { dbId: 2, fragments: [3] },
      ],
    }],
    {
      1: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      2: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      3: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  let seen = false;
  const originalTestPair = world._testBroadPhasePair.bind(world);
  world._testBroadPhasePair = (...args) => {
    if (!seen) { seen = true; world.dispose(); }
    return originalTestPair(...args);
  };
  await assert.rejects(world.findClashes(query(model, [1], [2])), WorldDisposedError);
  assert.equal(seen, true);
});

// === active-range compaction, end-to-end =======================================================

test('active-range compaction end-to-end: an inflated raw index with a small active group still builds', async () => {
  // The raw index encodes far more triangles than maxSyncTriangleCount, but a single `groups` entry
  // marks only the original box's 12 triangles active. Without active-range compaction the pair
  // would be skipped as oversized; with it, the pair is a real positive.
  const inflated = box(1, 1, 1);
  const originalIndex = inflated.index.array;
  const bigIndex = new Uint32Array((maxSyncTriangleCount + 500) * 3);
  for (let i = 0; i < bigIndex.length; i++) bigIndex[i] = originalIndex[i % originalIndex.length];
  inflated.setIndex(new THREE.BufferAttribute(bigIndex, 1));
  inflated.clearGroups();
  inflated.addGroup(0, originalIndex.length, 0);

  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [11000] }, { dbId: 2, fragments: [11001] }] }],
    {
      11000: { geometryIndex: 0, geometry: inflated, at: [0, 0, 0] },
      11001: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [1], [2]));
  assert.equal(result.pairs.length, 1, 'built from the active range, not the raw index');
  assert.equal(result.statistics.diagnostics.length, 0, 'no geometry-too-large-for-sync-build diagnostic');
});

test('a geometry whose ACTIVE range alone is oversized is skipped with a diagnostic carrying the real reason', async () => {
  const oversized = new THREE.BufferGeometry();
  const triangles = maxSyncTriangleCount + 10;
  const positions = new Float32Array(triangles * 9);
  const index = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    // A degenerate-but-in-range triangle fan; only the ceiling classification is under test here,
    // and it fires before any buffer is materialized.
    positions[t * 9 + 0] = 0; positions[t * 9 + 1] = 0; positions[t * 9 + 2] = 0;
    positions[t * 9 + 3] = 1; positions[t * 9 + 4] = 0; positions[t * 9 + 5] = 0;
    positions[t * 9 + 6] = 0; positions[t * 9 + 7] = 1; positions[t * 9 + 8] = 0;
    index[t * 3] = t * 3; index[t * 3 + 1] = t * 3 + 1; index[t * 3 + 2] = t * 3 + 2;
  }
  oversized.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  oversized.setIndex(new THREE.BufferAttribute(index, 1));

  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [12000] }, { dbId: 2, fragments: [12001] }] }],
    {
      12000: { geometryIndex: 0, geometry: oversized, at: [0, 0, 0] },
      12001: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [1], [2]));
  assert.equal(result.pairs.length, 0, 'an oversized operand is skipped, never reported as a clash');
  assert.equal(result.statistics.diagnostics.length, 1);
  assert.deepEqual(result.statistics.diagnostics[0], {
    scope: 'fragment',
    reason: 'geometry-too-large-for-sync-build',
    role: 'source',
    fragment: { modelId: model.id, dbId: 1, fragId: 12000 },
  });
});

test('an unsupported raw geometry layout is skipped with its own reason, never crashing compactAndWeld', async () => {
  // createGeometryRegistry's buildWeld must filter adaptViewerGeometry's `unsupported: true` output
  // before handing it to compactAndWeld (whose JSDoc requires the unsupported:false variant).
  const unsupportedRaw = { attributes: {}, index: null }; // no resolvable position attribute
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [13000] }, { dbId: 2, fragments: [13001] }] }],
    {
      13000: {
        geometryIndex: 0,
        geometry: unsupportedRaw,
        at: [0, 0, 0],
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      },
      13001: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [1], [2]));
  assert.equal(result.pairs.length, 0);
  assert.equal(result.statistics.diagnostics.length, 1);
  assert.equal(result.statistics.diagnostics[0].reason, 'unsupported-geometry-layout');
  assert.equal(result.statistics.diagnostics[0].fragment.fragId, 13000);
});

// === ownerDbId / groupBy:'dbId' aggregation ====================================================

test("ownerDbId: the child instance's own dbId is used, never the requested ancestor", async () => {
  const { model, viewer } = makeFixture(
    [{
      dbId: 0,
      children: [
        { dbId: 2527, children: [{ dbId: 2530, fragments: [30000] }] },
        { dbId: 3000, fragments: [30001] },
      ],
    }],
    {
      30000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      30001: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [2527], [3000]));
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 2530, 'the structural owner, not the requested root');
});

test('ownerDbId: a fragment reachable via two requested roots keeps its single first-discovered owner', async () => {
  const { model, viewer } = makeFixture(
    [{
      dbId: 0,
      children: [
        { dbId: 40, children: [{ dbId: 41, fragments: [40000] }] },
        { dbId: 50, fragments: [50000] },
      ],
    }],
    {
      40000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      50000: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [40, 41], [50]));
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].source.dbId, 41, 'ownerDbId is captured once, at first discovery');
});

test('dedup collapses OUTPUT only: one ClashPair, but the narrow phase still ran per candidate pair', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 60, fragments: [60000] }, { dbId: 70, fragments: [70000, 70001] }] }],
    {
      60000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      70000: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0, 0, 0] },
      70001: { geometryIndex: 2, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  let narrowPhaseCalls = 0;
  const original = world._runNarrowPhasePair.bind(world);
  world._runNarrowPhasePair = async (...args) => { narrowPhaseCalls++; return original(...args); };
  const result = await world.findClashes(query(model, [60], [70]));
  assert.equal(result.pairs.length, 1, 'exactly one ClashPair for the (60,70) dbId key');
  assert.equal(narrowPhaseCalls, 2, 'collision work is not collapsed, only the output');
  assert.equal(result.statistics.narrowPhasePairs, 2);
});

test('reversed attribution: (X,Y) and (Y,X) are distinct keys, never canonicalized or merged', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 80, fragments: [80000] }, { dbId: 90, fragments: [90000] }] }],
    {
      80000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      90000: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const forward = await world.findClashes(query(model, [80], [90]));
  const backward = await world.findClashes(query(model, [90], [80]));
  assert.equal(forward.pairs.length, 1);
  assert.equal(backward.pairs.length, 1);
  assert.equal(`${forward.pairs[0].source.dbId}>${forward.pairs[0].target.dbId}`, '80>90');
  assert.equal(`${backward.pairs[0].source.dbId}>${backward.pairs[0].target.dbId}`, '90>80');
});

// === CollisionInstance admission wiring =========================================================

test('admitted CollisionInstances are cached per epoch and reused across calls in the same epoch', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 80, fragments: [80000] }, { dbId: 90, fragments: [90000] }] }],
    {
      80000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      90000: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.findClashes(query(model, [80], [90]));
  const epoch = world.admitModel(model).epoch;
  const bucket = world._instanceCache.get(epoch);
  assert.equal(bucket.size, 2);
  assert.equal(bucket.get(80000).geometryIdentity.geometryIndex, 0);
  const first = bucket.get(80000);
  await world.findClashes(query(model, [80], [90]));
  assert.equal(world._instanceCache.get(epoch).get(80000), first, 'the same canonical instance is reused');
});

test('representative fragments and the epoch->model map are released on eviction', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 80, fragments: [80000] }, { dbId: 90, fragments: [90000] }] }],
    {
      80000: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      90000: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.findClashes(query(model, [80], [90]));
  const epoch = world.admitModel(model).epoch;
  assert.equal(world._modelByEpoch.get(epoch), model);
  assert.equal(world._representativeFragmentByGeometry.get(epoch).get(0), 80000);
  world.evictModel(model);
  assert.equal(world._modelByEpoch.has(epoch), false);
  assert.equal(world._representativeFragmentByGeometry.has(epoch), false);
});
