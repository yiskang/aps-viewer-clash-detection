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
import {
  WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
} from '../collision/errors.js';
import * as collisionIndex from '../collision/index.js';
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
function makeFixture(rootNodes, fragSpecs = {}, modelOptions = {}) {
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
  // `modelOptions` is forwarded verbatim to buildMockModel -- notably objectTreeReady /
  // settleObjectTree, which drive findClashes's instance-tree readiness wait.
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
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

test('relative matrix direction: locally-offset target geometry pins inverse(source)*target', async () => {
  // Every OTHER narrow-phase fixture in this file pairs origin-centred boxes under pure world
  // translations, which is symmetric under negation of the relative offset: two such boxes at world
  // (0,0,0) and (1,0,0) intersect whether the relative matrix is T(+1) or T(-1). That symmetry means
  // those fixtures cannot see a direction error at all -- reversing computeRelativeMatrix's operands,
  // or replacing it outright with an identity matrix, leaves them all green.
  //
  // This fixture breaks the symmetry deliberately: the TARGET's raw geometry is a unit box translated
  // 4 units along +X in its OWN local space, so the target mesh sits nowhere near its own local
  // origin. Written out on the X axis, with source world T(10) and target world T(7):
  //
  //   source local box   [-1, 1]                       (world [9, 11])
  //   target local box   [3.5, 4.5]                    (world [10.5, 11.5])
  //   inverse(source)*target = T(-3)  -> target local maps to [0.5, 1.5]   -> HIT   (correct)
  //   inverse(target)*source = T(+3)  -> target local maps to [6.5, 7.5]   -> miss  (reversed)
  //   identity               = T(0)   -> target local stays  [3.5, 4.5]    -> miss  (stubbed out)
  //   target world alone     = T(7)   -> [10.5, 11.5]                      -> miss
  //   source world alone     = T(10)  -> [13.5, 14.5]                      -> miss
  //
  // Under the correct direction the target straddles the source's +X face (its Y/Z extents sit
  // strictly inside the source's), so this is a genuine SURFACE crossing, not the containment case
  // the fixture above proves is deliberately not a hit.
  //
  // Neither operand's world matrix is the identity either, so a helper that simply returned one of
  // its two arguments unchanged is caught as well. Task 20 reuses this same helper for its
  // containment / volume-overlap dispatch, where a reversed direction would produce silently wrong
  // answers with no crash -- hence a direction regression that fails loudly, here, first.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [10, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1).translate(4, 0, 0), at: [7, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20]));
  assert.equal(result.statistics.broadPhasePairs, 1);
  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair DID reach the narrow phase');
  assert.equal(
    result.pairs.length, 1,
    'only inverse(source)*target places the locally-offset target inside the source; a reversed or ' +
    'identity relative matrix reports no hit here',
  );
  assert.equal(result.pairs[0].source.dbId, 10);
  assert.equal(result.pairs[0].target.dbId, 20);
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

test('non-dbId groupBy rejected -- M1 supports only groupBy:dbId', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, children: [{ dbId: 10, fragments: [] }] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(
    world.findClashes({ ...query(model, [10], [10]), groupBy: 'fragment' }),
    /groupBy/,
  );
});

test('every supported mode is accepted; an unknown mode is rejected', async () => {
  // Task 19 shipped this fixture asserting a placeholder rejection for containment/volume-overlap.
  // Task 20 wired both modes for real, so the placeholder message is gone and the assertion it
  // pinned now belongs to test/CollisionWorld.findClashes.dispatch.test.mjs. What remains
  // load-bearing HERE is the unknown-mode rejection and the fact that mode validation still
  // happens at entry, before any extraction work.
  const { model, viewer } = makeFixture([{ dbId: 1, children: [{ dbId: 10, fragments: [] }] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  for (const mode of ['surface-intersection', 'containment', 'volume-overlap']) {
    const result = await world.findClashes(query(model, [10], [10], mode));
    assert.deepEqual(result.pairs, []);
  }
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

// === batch-4 fix wave ==========================================================================

// --- Finding 2: a transient missing render proxy must not permanently poison a geometry entry ---
//
// viewer.impl.getRenderProxy legitimately returns null for a fragment that is not yet loaded, is
// culled, or has already been torn down. Before the fix that null was handed to adaptViewerGeometry,
// which reported `unsupported-geometry-layout` -- indistinguishable from a genuinely malformed
// geometry -- and createGeometryRegistry's buildWeld converted it into a PERMANENT oversized marker
// cached for the whole epoch, with no retry mechanism. That contradicts the spec's own rule
// (:3171-3174) that a normalization failure "settles no persistent entry state", and left the
// fragment unusable for the rest of the model's life even once its proxy came back.
for (const [label, unavailableProxy] of [['null proxy', null], ['proxy with no geometry', { geometry: null }]]) {
  test(`transient render-proxy miss (${label}): pair skipped with a diagnostic, entry NOT poisoned`, async () => {
    const { model, viewer } = makeFixture(
      [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
      {
        100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
        200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
      },
    );
    // Fragment 200's proxy is missing on the FIRST attempt only -- exactly the Viewer's own
    // "not yet loaded" transient, which resolves by itself a moment later.
    const realGetRenderProxy = viewer.impl.getRenderProxy;
    let proxyMissing = true;
    viewer.impl.getRenderProxy = (queriedModel, fragId) =>
      (proxyMissing && fragId === 200 ? unavailableProxy : realGetRenderProxy(queriedModel, fragId));

    const world = await freshWorld(viewer, { now: frozenClock() });
    const epoch = world.admitModel(model).epoch;

    const first = await world.findClashes(query(model, [10], [20]));
    assert.equal(first.pairs.length, 0, 'no geometry was available, so no verdict may be reported');
    assert.equal(first.statistics.narrowPhasePairs, 1, 'the pair reached the narrow phase and was skipped there');
    assert.deepEqual(first.statistics.diagnostics, [{
      scope: 'fragment',
      reason: 'geometry-not-yet-available',
      role: 'target',
      fragment: { modelId: model.id, dbId: 20, fragId: 200 },
    }], 'a transient miss gets its OWN reason, never unsupported-geometry-layout');

    // The registry must hold NO entry for the missing geometry index -- not a record, and above all
    // not an oversized marker. geometryIndex 0 (which built fine) is still cached, proving the
    // discard is scoped to the failed entry alone.
    const registryBucket = world._registry._epochs.get(epoch);
    assert.equal(registryBucket.has(0), true, 'the geometry that DID build stays cached');
    assert.equal(registryBucket.has(1), false, 'the failed attempt settled no persistent entry state');

    // ...and once the proxy exists, the SAME (loadEpoch, geometryIndex) builds for real.
    proxyMissing = false;
    const second = await world.findClashes(query(model, [10], [20]));
    assert.equal(world.admitModel(model).epoch, epoch, 'still the same epoch -- no reload happened');
    assert.equal(second.pairs.length, 1, 'the retry succeeds: nothing was permanently poisoned');
    assert.deepEqual(second.statistics.diagnostics, []);
  });
}

test('a NON-RenderProxyUnavailable error from a geometry build still aborts the whole call', async () => {
  // The catch in buildOne is deliberately narrow: only the transient class is absorbed. A checkpoint
  // liveness failure, a builder bug, or any other error must still propagate and fail the call.
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const originalResolve = world._resolveGeometryView.bind(world);
  world._resolveGeometryView = (loadEpoch, geometryIndex) => {
    if (geometryIndex === 1) throw new Error('some other geometry-resolution failure');
    return originalResolve(loadEpoch, geometryIndex);
  };
  await assert.rejects(world.findClashes(query(model, [10], [20])), /some other geometry-resolution failure/);
});

test('RenderProxyUnavailableError / ObjectTreeUnavailableError are exported from collision/index.js', () => {
  assert.equal(collisionIndex.RenderProxyUnavailableError, RenderProxyUnavailableError);
  assert.equal(collisionIndex.ObjectTreeUnavailableError, ObjectTreeUnavailableError);
});

// --- Finding 3: a surface-intersection ABORT must be observable, not a silent clean negative -----
//
// surfaceIntersectionQuery owns a private, traversal-local clock and candidate-pair budget, and on
// exhaustion returns `{ intersects: false, aborted: true, diagnostics: [crossing-budget-exhausted] }`
// -- correctly refusing to read its own abort as a hit. findClashes read only `.intersects` and
// discarded the rest, making a budget-exhausted traversal indistinguishable from a verified no-touch
// (spec :3804-3810; the same rule spike/fixtures.mjs's own "aborted must NOT read as a hit" fixture
// pins one layer down).
test('an aborted surface-intersection traversal is surfaced as a diagnostic, not a clean negative', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      // The SAME overlapping pair the "cheap query" fixture at the top of this file reports as a
      // genuine hit -- so the zero-pairs result below is caused by the abort and nothing else.
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });

  // The query's private clock reads the real `performance.now()` and findClashes exposes no seam to
  // override it (the injected `now` above drives only the world's own frame-budget accumulator), so
  // the abort is forced by making that global clock leap on every read: the traversal is already
  // past frameBudgetMs at its very first callback entry. Deterministic -- no wall-clock luck, and no
  // dependence on how many candidate pairs this particular BVH pair happens to produce.
  const realNow = performance.now;
  let result;
  try {
    let t = 0;
    performance.now = () => (t += 1_000_000);
    result = await world.findClashes(query(model, [10], [20]));
  } finally {
    performance.now = realNow;
  }

  assert.equal(result.statistics.narrowPhasePairs, 1, 'the pair did reach the narrow phase');
  assert.equal(result.pairs.length, 0, 'an aborted traversal never fabricates a hit');
  assert.equal(result.statistics.diagnostics.length, 1,
    'the incompleteness must be observable -- an empty diagnostics array here would read as a VERIFIED no-touch');
  assert.deepEqual(result.statistics.diagnostics[0], {
    scope: 'pair',
    reason: 'crossing-budget-exhausted',
    sourceFragment: { modelId: model.id, dbId: 10, fragId: 100 },
    targetFragment: { modelId: model.id, dbId: 20, fragId: 200 },
  });
});

// --- Finding 5: the instance-tree readiness wait (Task 15's own approved decision) ---------------
//
// docs/superpowers/specs/instance-tree-readiness-decision.md, outcome (a) "wait": findClashes waits
// on model.getObjectTree()'s documented completion before the extraction walk begins, closing that
// record's Mode 1 (tree not yet created at all). Assigned to "Task 19/20" and missed by both.
const READINESS_TREE = [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }];
const READINESS_FRAGS = {
  100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
  200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
};

test('readiness fast path: an already-created tree is never waited on', async () => {
  const { model, viewer, stats } = makeFixture(READINESS_TREE, READINESS_FRAGS);
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20]));
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 0,
    'isObjectTreeCreated() === true means proceed synchronously -- getObjectTree(onSuccess, onError) is never called');
  assert.equal(result.pairs.length, 1, 'and the call behaves exactly as before');
});

test('readiness wait: extraction does not begin until getObjectTree calls back with success', async () => {
  let fireSuccess = null;
  const { model, viewer, stats } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
    objectTreeReady: false,
    // Captured, not fired: the Viewer settles this asynchronously, whenever the property database
    // actually finishes loading.
    settleObjectTree: (onSuccess, _onError, instanceTree) => { fireSuccess = () => onSuccess(instanceTree); },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes(query(model, [10], [20]));

  // Drain the microtask queue AND one macrotask turn: if findClashes were not waiting, extraction
  // would have run to completion by now.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 1, 'the documented wait mechanism was actually used');
  assert.equal(stats.enumNodeFragmentsCalls, 0,
    'the extraction walk must not touch the instance tree while the Viewer says it is not created');

  fireSuccess();
  const result = await pending;
  assert.ok(stats.enumNodeFragmentsCalls > 0, 'the walk ran after settlement');
  assert.equal(result.pairs.length, 1, 'and produced the normal result');
});

test('source dbIds is snapshotted at entry: caller mutation of query.source.dbIds during the readiness wait does not change what gets extracted', async () => {
  // M2 closeout: normalizeTargets already defensively .slice()s every target's dbIds at entry;
  // query.source.dbIds had no equivalent snapshot, so a caller mutating its own source-dbIds array
  // during this call's async gaps (the readiness wait below is the widest one) could change what
  // extractFragments actually walks, well after the call was made. Uses the SAME readiness-wait
  // harness as the tests above -- it is the one real async gap between findClashes entry (where the
  // snapshot must be taken) and the source extraction call that consumes it.
  let fireSuccess = null;
  const { model, viewer } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
    objectTreeReady: false,
    settleObjectTree: (onSuccess, _onError, instanceTree) => { fireSuccess = () => onSuccess(instanceTree); },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const sourceDbIds = [10];
  const pending = world.findClashes(query(model, sourceDbIds, [20]));

  await new Promise((resolve) => setTimeout(resolve, 0));
  // Mutate the CALLER's own array after the call has already started, before extraction runs.
  sourceDbIds.length = 0;
  sourceDbIds.push(999); // a dbId owning no fragments in this fixture

  fireSuccess();
  const result = await pending;
  assert.equal(result.pairs.length, 1,
    'extraction must use the dbIds snapshotted at entry (dbId 10, which genuinely overlaps dbId 20), not the caller\'s later-mutated array');
});

test('readiness fast path is CONDITIONALLY SYNCHRONOUS -- it costs no microtask boundary', async () => {
  // Not cosmetic: a bare `await` on an already-ready model would defer everything after it by a
  // microtask, which is exactly the boundary ViewerModelAdapter's own Item-D fix exists to keep
  // closed, and which the decision record's "proceed synchronously" wording rules out
  // (instance-tree-readiness-decision.md:149).
  //
  // Observable proof: with a frozen clock no checkpoint is ever due, so extractFragments runs its
  // whole walk synchronously before returning its promise. If findClashes reaches extraction without
  // suspending, the walk has therefore already happened by the time findClashes() returns to us --
  // synchronously, before a single `await` on our side.
  const { model, viewer, stats } = makeFixture(READINESS_TREE, READINESS_FRAGS);
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes(query(model, [10], [20]));
  assert.ok(stats.enumNodeFragmentsCalls > 0,
    'the fast path must not defer extraction behind a microtask -- _awaitObjectTreeReady returns undefined, it is not awaited');
  assert.equal((await pending).pairs.length, 1);
});

test('readiness wait: a model with no isObjectTreeCreated still uses the documented getObjectTree', async () => {
  // Declining to wait merely because the predicate is missing would silently abandon the strategy
  // the decision record selected. Only a model implementing NEITHER accessor is unwaitable.
  let fireSuccess = null;
  const { model, viewer, stats } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
    settleObjectTree: (onSuccess, _onError, instanceTree) => { fireSuccess = () => onSuccess(instanceTree); },
  });
  delete model.isObjectTreeCreated;
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes(query(model, [10], [20]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 1, 'the documented accessor is used, not assumed-ready');
  assert.equal(stats.enumNodeFragmentsCalls, 0);
  fireSuccess();
  assert.equal((await pending).pairs.length, 1);
});

for (const [label, kill, ExpectedError] of [
  ['eviction', (world, model) => world.evictModel(model), ModelEvictedError],
  ['disposal', (world) => world.dispose(), WorldDisposedError],
]) {
  test(`readiness wait: ${label} DURING the wait is reported, even with no dbIds to check it`, async () => {
    // The readiness wait is the widest gap in findClashes -- a real property-database load takes
    // seconds. Extraction's own first checkpoint normally catches a lifecycle change across it (a
    // single non-empty operand is enough for that), but it never fires AT ALL when both dbIds arrays
    // are empty: ViewerModelAdapter's per-dbId loop body never runs, and the empty-extraction branch
    // then returns { pairs: [] } as a SUCCESS against a disposed world or an evicted model. So the
    // entry-order checks are re-run across the wait itself.
    let fireSuccess = null;
    const { model, viewer } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
      objectTreeReady: false,
      settleObjectTree: (onSuccess, _onError, instanceTree) => { fireSuccess = () => onSuccess(instanceTree); },
    });
    const world = await freshWorld(viewer, { now: frozenClock() });
    const pending = world.findClashes(query(model, [], [])); // zero checkpoints will ever fire
    await new Promise((resolve) => setTimeout(resolve, 0));
    kill(world, model);
    fireSuccess();
    await assert.rejects(pending, ExpectedError);
  });
}

test('readiness wait: disposal during a FAILING wait reports disposal, not the tree error', async () => {
  // Ordering: disposed first, then evicted, then anything else -- the same precedence the entry
  // checks use. A disposal that lands during the wait outranks the Viewer's own tree failure.
  let fireError = null;
  const { model, viewer } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
    objectTreeReady: false,
    settleObjectTree: (_onSuccess, onError) => { fireError = () => onError(new Error('propertyDbError')); },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const pending = world.findClashes(query(model, [10], [20]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  world.dispose();
  fireError();
  await assert.rejects(pending, WorldDisposedError);
});

test('readiness wait: getObjectTree onError rejects with ObjectTreeUnavailableError, never a silent walk', async () => {
  const propertyDbError = new Error('propertyDbError');
  const { model, viewer, stats } = makeFixture(READINESS_TREE, READINESS_FRAGS, {
    objectTreeReady: false,
    settleObjectTree: (_onSuccess, onError) => onError(propertyDbError),
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await assert.rejects(world.findClashes(query(model, [10], [20])), (err) => {
    assert.ok(err instanceof ObjectTreeUnavailableError, `expected ObjectTreeUnavailableError, got ${err?.name}`);
    // Distinct from the two lifecycle errors: nothing is wrong with this world or this lease.
    assert.equal(err instanceof WorldDisposedError, false);
    assert.equal(err instanceof ModelEvictedError, false);
    assert.equal(err.modelId, model.id);
    assert.equal(err.cause, propertyDbError, 'the Viewer\'s own error is kept for diagnosis');
    return true;
  });
  assert.equal(stats.enumNodeFragmentsCalls, 0, 'no extraction walk against an unavailable tree');
});

// --- Finding 19-2: the broad-phase ceiling is checked BEFORE any side effect --------------------
test('broad-phase ceiling: a rejected call consumes no instance-cache or representative-fragment state', async () => {
  // Same shape as the "rejects before the nested scan is ever entered" fixture above (1001 x 1000 >
  // maxBroadPhaseInstancePairs), but asserting the OTHER half of the contract: a call that is going
  // to be rejected must not first admit 2,001 CollisionInstances against
  // maxCollisionInstancesPerEpoch (10% of the epoch's entire budget, never released) nor record
  // representative fragments for them.
  const sourceChildren = Array.from({ length: 1001 }, (_, i) => ({ dbId: 500_000 + i, fragments: [500_000 + i] }));
  const targetChildren = Array.from({ length: 1000 }, (_, i) => ({ dbId: 600_000 + i, fragments: [600_000 + i] }));
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, children: sourceChildren }, { dbId: 2, children: targetChildren }] }],
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;

  await assert.rejects(world.findClashes(query(model, [1], [2])), /maxBroadPhaseInstancePairs/);

  assert.equal(world._instanceCache.get(epoch)?.size ?? 0, 0,
    'a rejected call must not consume maxCollisionInstancesPerEpoch headroom');
  assert.equal(world._representativeFragmentByGeometry.get(epoch)?.size ?? 0, 0,
    'nor pollute the epoch representative-fragment map');

  // The epoch is still perfectly usable afterwards: a smaller query against the same live model
  // admits normally.
  const ok = await world.findClashes(query(model, [500_000], [600_000]));
  assert.equal(ok.statistics.broadPhasePairs, 1);
  assert.equal(world._instanceCache.get(epoch).size, 2, 'only the accepted call\'s two instances');
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

// === M2.1 Task 5: deterministic dbId-level witness aggregation =================================
//
// These tests exercise the AGGREGATION LOOP itself (compareWitnessCandidates + insert-or-replace),
// not volumeOverlapQuery's own witness computation (covered elsewhere). `_runNarrowPhasePair` is
// fully stubbed to return a SCRIPTED sequence of `{hit, witness}` results by call order -- call
// order is exactly the candidate-processing order the broad phase feeds the aggregation loop, so
// this proves the LOOP's own tie-break logic independent of any real geometry computation. The
// two-fragment-source / one-fragment-target fixture below guarantees exactly 2 narrow-phase calls
// collapsing onto ONE dbId-level key (source dbId 10, target dbId 20): broad-phase-only `bounds`
// are supplied directly with no `geometry` at all, since `_runNarrowPhasePair` never really runs.

function twoFragmentPairFixture() {
  return makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100, 101] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
      101: { geometryIndex: 1, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
      200: { geometryIndex: 2, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
    },
  );
}

// Scripts `_runNarrowPhasePair` to return `results[call]` in call order, bypassing real geometry
// resolution entirely -- the aggregation loop under test only cares "the Nth candidate's result",
// never which physical fragment pair produced it.
function stubNarrowPhaseSequence(world, results) {
  let call = 0;
  world._runNarrowPhasePair = async () => {
    const result = results[call];
    call += 1;
    return result;
  };
}

test('a valid witness from one fragment pair outranks a null witness from a sibling fragment pair for the same dbId pair, regardless of arrival order', async () => {
  const validWitness = { kind: 'containment', point: [1, 2, 3] };
  for (const order of [[null, validWitness], [validWitness, null]]) {
    const { model, viewer } = twoFragmentPairFixture();
    const world = await freshWorld(viewer, { now: frozenClock() });
    stubNarrowPhaseSequence(world, order.map((witness) => ({ hit: true, witness })));
    const { pairs } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
    assert.equal(pairs.length, 1);
    assert.notEqual(pairs[0].witness, null, "the sibling fragment pair's valid witness must survive aggregation");
    assert.deepEqual(pairs[0].witness, validWitness, `must win regardless of arrival order (order: ${order.map((w) => w?.kind ?? 'null')})`);
  }
});

test('when both a surface-crossing and a containment witness are available for the same dbId pair, surface-crossing wins, regardless of arrival order', async () => {
  const crossingWitness = { kind: 'surface-crossing', point: [5, 5, 5] };
  const containmentWitness = { kind: 'containment', point: [1, 1, 1] };
  for (const order of [[containmentWitness, crossingWitness], [crossingWitness, containmentWitness]]) {
    const { model, viewer } = twoFragmentPairFixture();
    const world = await freshWorld(viewer, { now: frozenClock() });
    stubNarrowPhaseSequence(world, order.map((witness) => ({ hit: true, witness })));
    const { pairs } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].witness.kind, 'surface-crossing', `surface-crossing must win regardless of arrival order (order: ${order.map((w) => w.kind).join(',')})`);
  }
});

test('repeated identical queries never change the witness point', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const r1 = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  const r2 = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(r1.pairs.length, 1);
  assert.equal(r2.pairs.length, 1);
  assert.ok(r1.pairs[0].witness, 'witness must be present (a small box strictly inside a large one is a deterministic containment hit)');
  assert.equal(r1.pairs[0].witness.kind, 'containment');
  assert.deepEqual(r1.pairs[0].witness, r2.pairs[0].witness);
});

test('a dbId pair with no valid witness after full aggregation gets exactly one witness-unavailable diagnostic', async () => {
  const { model, viewer } = twoFragmentPairFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  stubNarrowPhaseSequence(world, [
    { hit: true, witness: null },
    { hit: true, witness: null },
  ]);
  const { pairs, statistics } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].witness, null);
  const witnessDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'witness-unavailable');
  assert.equal(witnessDiagnostics.length, 1, 'exactly one diagnostic for this dbId pair, not one per fragment-pair miss');
  assert.equal(witnessDiagnostics[0].scope, 'pair');
  assert.equal(witnessDiagnostics[0].sourceFragment.dbId, 10);
  assert.equal(witnessDiagnostics[0].targetFragment.dbId, 20);
});

test('a witness-unavailable diagnostic never fires when a sibling fragment pair supplied a valid witness', async () => {
  const { model, viewer } = twoFragmentPairFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  stubNarrowPhaseSequence(world, [
    { hit: true, witness: null },
    { hit: true, witness: { kind: 'containment', point: [1, 2, 3] } },
  ]);
  const { statistics } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
  assert.equal(statistics.diagnostics.some((d) => d.reason === 'witness-unavailable'), false);
});

// codex-advisor review (request 20260907-162936-71471-30255): the tests above change WHICH stub
// slot returns which witness, but never exercise two candidates that are genuinely tied under
// `compareWitnessCandidates`'s first two ranks (both real, same kind -- or both null) and can only
// be told apart by the placement tie-break itself. These two tests close that gap directly.

test('two same-kind witnesses from different physical fragment pairs converge to the SAME point, regardless of arrival order', async () => {
  // Each PHYSICAL fragment keeps its OWN witness value across both variants below -- only the
  // aggregation loop's PROCESSING order differs (the physical listing order under dbId 10 is
  // reversed, and the stub script is reversed right along with it, so frag100 always resolves to
  // witnessForFrag100 and frag101 always resolves to witnessForFrag101 regardless of which one the
  // broad phase happens to visit first). Naively swapping which SCRIPTED witness lands on which
  // call index (as the other reversed-order tests above do) would be the wrong test here: since the
  // winner is decided by the placement tie-break (comparePlacedCanonically), swapping which VALUE
  // attaches to which fragment changes the correct answer, not just the winner's identity -- it is
  // only a genuine order-independence probe if the fragment<->witness association stays fixed and
  // the loop's OWN iteration order is what varies.
  const witnessForFrag100 = { kind: 'containment', point: [1, 1, 1] };
  const witnessForFrag101 = { kind: 'containment', point: [9, 9, 9] };
  const winners = [];
  for (const [fragOrder, scriptOrder] of [
    [[100, 101], [witnessForFrag100, witnessForFrag101]],
    [[101, 100], [witnessForFrag101, witnessForFrag100]],
  ]) {
    const { model, viewer } = makeFixture(
      [{ dbId: 1, children: [{ dbId: 10, fragments: fragOrder }, { dbId: 20, fragments: [200] }] }],
      {
        100: { geometryIndex: 0, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
        101: { geometryIndex: 1, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
        200: { geometryIndex: 2, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
      },
    );
    const world = await freshWorld(viewer, { now: frozenClock() });
    stubNarrowPhaseSequence(world, scriptOrder.map((witness) => ({ hit: true, witness })));
    const { pairs } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
    assert.equal(pairs.length, 1);
    assert.ok(pairs[0].witness, 'a real witness must survive when both candidates are real');
    winners.push(pairs[0].witness);
  }
  assert.deepEqual(winners[0], winners[1], 'the SAME physical fragment (and therefore the SAME witness value) must win regardless of processing order');
});

// Fragments 100/101 are listed under dbId 10 in DIFFERENT physical orders across the two fixture
// builds below, so the broad phase itself visits them in different orders -- unlike the stub-order
// tests above, which only vary which SCRIPTED witness a given call index returns. Both candidates
// here are scripted `witness: null` regardless of call index, so the only thing that can make the
// diagnosed FragmentRef differ between the two runs is which physical fragment pair the aggregation
// loop's own tie-break treats as canonical -- exactly the bug codex-advisor's review caught (the
// original comparator returned 0 for two nulls without ever reaching the placement tie-break, so the
// stored candidate -- and therefore the diagnostic's fragId -- was whichever arrived first).
test('two null-witness candidates for the same dbId pair get the SAME diagnostic fragment provenance, regardless of physical visitation order', async () => {
  const provenances = [];
  for (const fragOrder of [[100, 101], [101, 100]]) {
    const { model, viewer } = makeFixture(
      [{ dbId: 1, children: [{ dbId: 10, fragments: fragOrder }, { dbId: 20, fragments: [200] }] }],
      {
        100: { geometryIndex: 0, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
        101: { geometryIndex: 1, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
        200: { geometryIndex: 2, bounds: { min: [-1, -1, -1], max: [1, 1, 1] } },
      },
    );
    const world = await freshWorld(viewer, { now: frozenClock() });
    stubNarrowPhaseSequence(world, [
      { hit: true, witness: null },
      { hit: true, witness: null },
    ]);
    const { statistics } = await world.findClashes(query(model, [10], [20], 'volume-overlap'));
    const witnessDiagnostics = statistics.diagnostics.filter((d) => d.reason === 'witness-unavailable');
    assert.equal(witnessDiagnostics.length, 1);
    provenances.push(witnessDiagnostics[0].sourceFragment.fragId);
  }
  assert.equal(provenances[0], provenances[1], 'the diagnosed sourceFragment.fragId must be the SAME canonical choice regardless of which physical fragment the broad phase visits first');
});

test('containment pairs never carry a witness field or a witness-unavailable diagnostic (only volume-overlap has a witness concept)', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const result = await world.findClashes(query(model, [10], [20], 'containment'));
  assert.equal(result.pairs.length, 1);
  assert.equal('witness' in result.pairs[0], false, 'containment pairs must not carry a witness key at all');
  assert.equal(result.statistics.diagnostics.some((d) => d.reason === 'witness-unavailable'), false);
});
