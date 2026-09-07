// test/CollisionWorld.placementInvalidation.test.mjs
//
// Task 11 (Batch 3): invalidateModelPlacement(model) and the staged/atomic-publish
// _refreshPlacementForEpoch refresh. _refreshPlacementForEpoch has no production caller yet --
// Task 13 (Batch 4) is the one that wires the "TLAS entry stale due to invalidation" trigger
// condition -- so this file tests it directly, the same private-method-level pattern this repo
// already uses for _recordPlacement (Task 9) and TlasCache (Task 10) ahead of their own consumers.
//
// Every fixture below admits a SOURCE dbId (10) plus a spatially non-overlapping DUMMY target
// dbId (99, far away) purely so findClashes's extraction/placement-recording path actually runs
// (an empty target short-circuits BEFORE any placement is ever recorded -- see the
// "sourceExtracted.size === 0 || targetTotalCount === 0" fast path in findClashes). The dummy
// target never clashes and its own raw geometry is never read (non-overlapping AABBs never reach
// the narrow phase), so `getRenderProxy` returning null for it is never exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld, WorldDisposedError, ModelEvictedError } from '../collision/index.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function translationMatrix([x, y, z]) { return new THREE.Matrix4().makeTranslation(x, y, z).toArray(); }

/**
 * Builds { model, viewer, fragmentGeometry } for one SOURCE dbId (1, fragment 10, placed at `at`)
 * plus a fixed, far-away DUMMY target dbId (2, fragment 20). `fragmentGeometry` is the SAME live
 * Map the fixture's fake FragmentList reads from on every call -- mutating it between two calls
 * simulates a fragment that moved in the Viewer between reads (getWorldMatrix/getWorldBounds
 * behave exactly like the real Viewer's: fresh reads every call, never cached).
 */
function makeFixture(at = [0, 0, 0]) {
  const fragmentGeometry = new Map([
    [10, { geometryIndex: 0, matrix: translationMatrix(at), bounds: { min: at, max: at.map((v) => v + 1) } }],
    [20, { geometryIndex: 1, matrix: translationMatrix([1000, 0, 0]), bounds: { min: [1000, 0, 0], max: [1001, 1, 1] } }],
  ]);
  const { model: baseModel } = buildMockModel(
    [{ dbId: 1, fragments: [10] }, { dbId: 2, fragments: [20] }],
    fragmentGeometry,
  );
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: () => null } };
  return { model, viewer, fragmentGeometry };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
function query(model) {
  return { source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId' };
}

// --- invalidateModelPlacement itself -------------------------------------------------------------

test('invalidateModelPlacement throws WorldDisposedError on a disposed world', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.dispose();
  assert.throws(() => world.invalidateModelPlacement(model), WorldDisposedError);
});

test('invalidateModelPlacement throws ModelEvictedError for an evicted model', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.admitModel(model);
  world.evictModel(model);
  assert.throws(() => world.invalidateModelPlacement(model), ModelEvictedError);
});

test('invalidateModelPlacement no-ops for a never-admitted model', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  assert.doesNotThrow(() => world.invalidateModelPlacement(model));
});

test('invalidateModelPlacement bumps _placementRevisionByEpoch and records the invalidation marker', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  const revisionAfterExtraction = world._placementRevisionByEpoch.get(epoch);

  world.invalidateModelPlacement(model);

  const revisionAfterInvalidation = world._placementRevisionByEpoch.get(epoch);
  assert.ok(revisionAfterInvalidation > revisionAfterExtraction, 'revision must strictly increase');
  assert.equal(world._placementInvalidatedAtRevision.get(epoch), revisionAfterInvalidation);
});

// --- _refreshPlacementForEpoch (tested directly -- Task 13 wires its own trigger later) ----------

test('a staged refresh re-reads worldMatrix/worldBounds via the SAME primitives extractFragments uses', async () => {
  const { model, viewer, fragmentGeometry } = makeFixture([0, 0, 0]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  assert.deepEqual(world._placementByEpoch.get(epoch).get(10).worldBounds, { min: [0, 0, 0], max: [1, 1, 1] });

  // Move the source fragment between the initial extraction and the refresh.
  fragmentGeometry.set(10, { geometryIndex: 0, matrix: translationMatrix([9, 0, 0]), bounds: { min: [9, 0, 0], max: [10, 1, 1] } });

  const invalidationRevision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, invalidationRevision);
  world._placementInvalidatedAtRevision.set(epoch, invalidationRevision);

  const result = await world._refreshPlacementForEpoch(epoch, invalidationRevision, invalidationRevision);

  assert.deepEqual(result, { published: true });
  assert.deepEqual(world._placementByEpoch.get(epoch).get(10).worldBounds, { min: [9, 0, 0], max: [10, 1, 1] });
  assert.equal(world._placementInvalidatedAtRevision.has(epoch), false, 'marker cleared once this refresh publishes');
});

test('refresh preserves ownerDbId/modelId unchanged -- only worldMatrix/worldBounds are re-read', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  const before = world._placementByEpoch.get(epoch).get(10);

  const revision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, revision);
  world._placementInvalidatedAtRevision.set(epoch, revision);
  await world._refreshPlacementForEpoch(epoch, revision, revision);

  const after = world._placementByEpoch.get(epoch).get(10);
  assert.equal(after.ownerDbId, before.ownerDbId);
  assert.equal(after.modelId, before.modelId);
});

test('a failed compare-and-publish check discards the staged refresh; the next attempt retries and succeeds', async () => {
  const { model, viewer, fragmentGeometry } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  const firstRevision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, firstRevision);
  world._placementInvalidatedAtRevision.set(epoch, firstRevision);

  // A SECOND invalidation lands before the first refresh's own compare-and-publish check runs --
  // simulated here by bumping the revision/marker again before calling the first refresh (the
  // real race would interleave an await; this asserts the same outcome via direct sequencing,
  // since _refreshPlacementForEpoch's own read phase has no injectable mid-point in this test).
  const secondRevision = firstRevision + 1;
  world._placementRevisionByEpoch.set(epoch, secondRevision);
  world._placementInvalidatedAtRevision.set(epoch, secondRevision);

  const staleAttempt = await world._refreshPlacementForEpoch(epoch, firstRevision, firstRevision);
  assert.deepEqual(staleAttempt, { published: false });
  assert.equal(world._placementInvalidatedAtRevision.get(epoch), secondRevision,
    'the second invalidations own marker must survive the first (superseded) refreshs cleanup');

  fragmentGeometry.set(10, { geometryIndex: 0, matrix: translationMatrix([3, 0, 0]), bounds: { min: [3, 0, 0], max: [4, 1, 1] } });
  const retried = await world._refreshPlacementForEpoch(epoch, secondRevision, secondRevision);
  assert.deepEqual(retried, { published: true });
  assert.deepEqual(world._placementByEpoch.get(epoch).get(10).worldBounds, { min: [3, 0, 0], max: [4, 1, 1] });
  assert.equal(world._placementInvalidatedAtRevision.has(epoch), false);
});

test('_refreshPlacementForEpoch throws ModelEvictedError if the epoch is already dead when it runs', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  const revision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, revision);
  world._placementInvalidatedAtRevision.set(epoch, revision);

  // Evict mid-refresh is not directly injectable without a hook into the read loop; assert the
  // guard fires when the epoch is already dead by the time the refresh runs at all (a caller
  // racing a stale epoch, e.g. after its own composite checkpoint should have already caught it).
  world.evictModel(model);
  await assert.rejects(() => world._refreshPlacementForEpoch(epoch, revision, revision), ModelEvictedError);
});

// Task 13's own documented refresh-vs-rebuild trigger formula (this method's own docblock), the
// exact `?? -1` coercions Batch 3 whole-batch review's Minor finding #8 required: without them,
// `entry.builtAtRevision === undefined` (never built) makes an unguarded `>=` always false,
// silently failing to treat "invalidated before its first-ever build" as invalidation-stale.
function isInvalidationStale(world, epoch) {
  const builtAtRevision = world._tlasCache.getBuiltAtRevision(epoch) ?? -1;
  const invalidatedAt = world._placementInvalidatedAtRevision.get(epoch) ?? -1;
  return world._placementRevisionByEpoch.get(epoch) !== builtAtRevision && invalidatedAt >= builtAtRevision;
}

test('invalidation BEFORE the epoch\'s first-ever TLAS build is still honored, not silently ignored', async () => {
  // The exact scenario codex-review's Critical #2 finding described: extraction records the
  // model's placement, invalidateModelPlacement is called, and ONLY THEN does the first-ever TLAS
  // query for that epoch run. Exercises the documented trigger formula directly (Task 13 itself
  // isn't implemented yet) to prove the `?? -1` coercion actually makes "never built" register as
  // invalidation-stale, not silently pass as fresh.
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  assert.equal(world._tlasCache.getBuiltAtRevision(epoch), undefined, 'no TLAS build has ever run for this epoch yet');
  world.invalidateModelPlacement(model);
  assert.equal(isInvalidationStale(world, epoch), true,
    'a never-built epoch with a pending invalidation must register as invalidation-stale, per the ?? -1 coercion fix');
});

test('the trigger formula does NOT fire for ordinary growth (no invalidation ever called)', async () => {
  // The negative case: a TLAS built once, then the placement map grows via ordinary extraction
  // (never invalidateModelPlacement) -- the revision changes, but there is no invalidation marker
  // at all, so this must NOT be treated as invalidation-stale (that is Task 13's own separate
  // "growth means rebuild via getEntry, not refresh" path, out of this task's scope, but the
  // formula itself must not conflate the two).
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  await world._tlasCache.getEntry(epoch, world._placementRevisionByEpoch.get(epoch));
  assert.notEqual(world._tlasCache.getBuiltAtRevision(epoch), undefined);

  assert.equal(isInvalidationStale(world, epoch), false, 'no invalidation was ever called -- must not be flagged invalidation-stale');
});

// --- Batch 3 whole-batch review fix pass: Important #3, #4, Minor #9, #13 ------------------------

test('Important #3: a successful refresh invalidates the cached TlasCache entry, so a stale-data "hit" can never be served again', async () => {
  const { model, viewer, fragmentGeometry } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  const builtRevision = world._placementRevisionByEpoch.get(epoch);
  const built = await world._tlasCache.getEntry(epoch, builtRevision);
  assert.equal(built.outcome, 'built');
  assert.equal(world._tlasCache.getBuiltAtRevision(epoch), builtRevision);

  // Invalidate WITHOUT bumping the revision beyond what the cached entry was already built at --
  // the exact scenario Important #3 describes: same revision number, different underlying data.
  world._placementInvalidatedAtRevision.set(epoch, builtRevision);
  fragmentGeometry.set(10, { geometryIndex: 0, matrix: translationMatrix([9, 0, 0]), bounds: { min: [9, 0, 0], max: [10, 1, 1] } });
  const refreshResult = await world._refreshPlacementForEpoch(epoch, builtRevision, builtRevision);
  assert.deepEqual(refreshResult, { published: true });

  assert.equal(world._tlasCache.getBuiltAtRevision(epoch), undefined,
    'the cached entry must be invalidated -- a getEntry at the SAME revision number must rebuild, not serve stale-data "hit"');
  const rebuilt = await world._tlasCache.getEntry(epoch, builtRevision);
  assert.equal(rebuilt.outcome, 'built', 'forced to rebuild from the refreshed (moved) placement data');
});

test('Important #4 / Minor #9: the refresh loop yields via an injected checkpoint per fragment, and accepts an injected THREE namespace', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  const revision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, revision);
  world._placementInvalidatedAtRevision.set(epoch, revision);

  const seenLabels = [];
  const checkpoint = (ctx) => { seenLabels.push(ctx.label); return undefined; };
  let matrixConstructed = 0;
  class CountingMatrix4 extends THREE.Matrix4 { constructor() { super(); matrixConstructed++; } }

  const result = await world._refreshPlacementForEpoch(epoch, revision, revision, {
    checkpoint, THREE: { ...THREE, Matrix4: CountingMatrix4 },
  });

  assert.deepEqual(result, { published: true });
  assert.ok(seenLabels.length >= 1, 'the checkpoint must be consulted at least once during the refresh walk');
  assert.ok(seenLabels.every((label) => label === 'placement-refresh-fragment'));
  assert.equal(matrixConstructed, 1, 'the injected THREE namespace must actually be used, not silently ignored in favor of globalThis.THREE');
});

test('Important #11: a genuine concurrent invalidation arriving mid-refresh (via a controllable checkpoint) is correctly discarded, not just a pre-set stale value', async () => {
  const { model, viewer, fragmentGeometry } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  const firstRevision = (world._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
  world._placementRevisionByEpoch.set(epoch, firstRevision);
  world._placementInvalidatedAtRevision.set(epoch, firstRevision);

  let releaseCheckpoint;
  const gate = new Promise((resolve) => { releaseCheckpoint = resolve; });
  let checkpointCalls = 0;
  const checkpoint = () => { checkpointCalls++; return gate; }; // suspends the refresh's read loop mid-walk

  const refreshPromise = world._refreshPlacementForEpoch(epoch, firstRevision, firstRevision, { checkpoint });
  assert.equal(checkpointCalls, 1, 'the refresh must already be suspended inside its read loop at this point');

  // A SECOND invalidation genuinely lands WHILE the first refresh is suspended mid-read.
  const secondRevision = firstRevision + 1;
  world._placementRevisionByEpoch.set(epoch, secondRevision);
  world._placementInvalidatedAtRevision.set(epoch, secondRevision);
  fragmentGeometry.set(10, { geometryIndex: 0, matrix: translationMatrix([42, 0, 0]), bounds: { min: [42, 0, 0], max: [43, 1, 1] } });

  releaseCheckpoint(); // let the first refresh's read loop resume and finish reading (stale-by-then)
  const staleResult = await refreshPromise;

  assert.deepEqual(staleResult, { published: false }, 'the first refresh must discard itself -- it read state that is no longer current');
  assert.equal(world._placementInvalidatedAtRevision.get(epoch), secondRevision,
    'the second (genuinely concurrent) invalidations own marker must survive the first refreshs cleanup');
  // _placementByEpoch itself must be untouched by the discarded refresh -- still the pre-refresh data.
  assert.deepEqual(world._placementByEpoch.get(epoch).get(10).worldBounds, { min: [0, 0, 0], max: [1, 1, 1] });

  const retried = await world._refreshPlacementForEpoch(epoch, secondRevision, secondRevision);
  assert.deepEqual(retried, { published: true });
  assert.deepEqual(world._placementByEpoch.get(epoch).get(10).worldBounds, { min: [42, 0, 0], max: [43, 1, 1] });
});

test('Minor #13: TlasCache.buildPrimitives (wired in fromViewer) produces a working BVH from the REAL _placementByEpoch data, not just a stub shape', async () => {
  const { model, viewer } = makeFixture([2, 0, 0]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  const revision = world._placementRevisionByEpoch.get(epoch);
  const { outcome, bvh } = await world._tlasCache.getEntry(epoch, revision);
  assert.equal(outcome, 'built');

  // A real query against the built BVH must find the source fragment's own bounds -- proves the
  // buildPrimitives closure's records (fragmentId spread over the placement entry) round-trip
  // correctly through CollisionInstanceBVH, not just an empty/stub shape no test ever exercised.
  const hits = [];
  bvh.queryBox([1.4, -0.6, -0.6], [3.6, 0.6, 0.6], {
    onLeafRange: () => {},
    onCandidate: (i) => hits.push(bvh.recordAt(i)),
  });
  assert.ok(hits.some((r) => r.fragmentId === 10), 'the source fragment (placed at [2,0,0]) must be found by a box query overlapping it');
  assert.ok(hits.every((r) => r.fragmentId !== undefined), 'every record the real closure builds must carry its fragmentId');
});

// --- Task 18: model-alignment / placement-invalidation acceptance fixture -------------------------
//
// spec:3174-3178, verbatim: "Passes as a synthetic fixture: align -> invalidateModelPlacement ->
// next TLAS query rebuilds using current world placement -> TLAS and linear oracle agree after
// alignment. Explode is not part of this acceptance, by design." This exercises the full public
// surface (findClashes, not the private _refreshPlacementForEpoch tested directly above) across TWO
// independent models, mirroring test/CollisionWorld.tlasTraversal.test.mjs's own
// `makeTwoModelFixture` two-model cross-model pattern (that file's helper is not exported, so it is
// reproduced here, extended only to also return each model's live fragmentGeometry Map so a single
// fragment's placement can be mutated between calls -- exactly this file's own single-model
// `makeFixture` convention above, applied to the two-model case this fixture needs).

const boxGeometry = () => new THREE.BoxGeometry(2, 2, 2); // centered at origin: extents [-1,-1,-1]..[1,1,1]
function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

function makeTwoModelFixture({ rootNodesA, fragSpecsA, rootNodesB, fragSpecsB }) {
  const rawGeometryByFragIdA = new Map();
  const fragmentGeometryA = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecsA)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometryA.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragIdA.set(fragId, spec.geometry);
  }
  const rawGeometryByFragIdB = new Map();
  const fragmentGeometryB = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecsB)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometryB.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragIdB.set(fragId, spec.geometry);
  }
  const modelA = { ...buildMockModel(rootNodesA, fragmentGeometryA).model, id: 1, getUnitScale: () => 1 };
  const modelB = { ...buildMockModel(rootNodesB, fragmentGeometryB).model, id: 2, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const map = queriedModel === modelA ? rawGeometryByFragIdA : queriedModel === modelB ? rawGeometryByFragIdB : null;
        const geometry = map?.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { modelA, modelB, viewer, fragmentGeometryA, fragmentGeometryB };
}

test('align -> invalidateModelPlacement -> next TLAS query rebuilds -> TLAS and linear oracle agree after alignment', async () => {
  // 1. Two models: model A has a fixed 2x2x2 box at the origin. Model B has a 2x2x2 box placed far
  //    away (no overlap with A) -- the "before alignment" state.
  const { modelA, modelB, viewer, fragmentGeometryB } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: boxGeometry(), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: boxGeometry(), at: [50, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const alignmentQuery = (broadPhase) => ({
    source: { model: modelA, dbIds: [1] },
    target: { targets: [{ model: modelB, dbIds: [1] }] },
    mode: 'surface-intersection', groupBy: 'dbId', broadPhase,
  });
  const pairKey = (p) => `${p.source.modelId}:${p.source.dbId}:${p.target.modelId}:${p.target.dbId}`;

  // 2. Query broadPhase:'tlas' BEFORE the move -- no clash yet (also admits both models and builds
  //    the epoch's first-ever TLAS entry, so step 5 below genuinely exercises a REBUILD).
  const beforeAlignment = await world.findClashes(alignmentQuery('tlas'));
  assert.equal(beforeAlignment.pairs.length, 0, 'model B starts far from model A -- no clash before alignment');
  assert.equal(beforeAlignment.statistics.tlasBuilds, 1, 'sanity: the first-ever query for this epoch is a cold build');

  // codex-advisor review: without this warm-cache repeat, the fixture cannot rule out an
  // always-rebuild TLAS implementation happening to still find the post-move clash by accident --
  // prove the SAME unchanged query is served from cache (no rebuild) before invalidation ever runs.
  const warmRepeat = await world.findClashes(alignmentQuery('tlas'));
  assert.equal(warmRepeat.pairs.length, 0);
  assert.equal(warmRepeat.statistics.tlasBuilds, 0, 'an unchanged epoch must be served from cache, not rebuilt, absent invalidation');
  assert.ok(warmRepeat.statistics.tlasCacheHits >= 1);

  // 3. Simulate a model-alignment tool moving model B's fragment on top of model A's known geometry
  //    -- update what the mock Viewer's FragmentList.getWorldMatrix/getWorldBounds report for model
  //    B's fragment 100, exactly this file's own `fragmentGeometry.set(...)` convention above (the
  //    fixture's fake FragmentList reads fresh from this live Map on every call).
  fragmentGeometryB.set(100, {
    geometryIndex: 0,
    matrix: translationMatrix([0, 0, 0]),
    bounds: boundsOf(boxGeometry(), [0, 0, 0]),
  });

  // 4. Tell the world model B's placement is stale.
  world.invalidateModelPlacement(modelB);

  // 5. Query broadPhase:'tlas' again -- the next TLAS query rebuilds using CURRENT world placement
  //    and finds the new clash. Asserting tlasBuilds === 1 here (not just the pairs outcome) proves
  //    invalidateModelPlacement is what triggered the rebuild, not an always-rebuild implementation.
  const afterAlignment = await world.findClashes(alignmentQuery('tlas'));
  assert.equal(afterAlignment.statistics.tlasBuilds, 1, 'invalidation must force a real rebuild of the stale TLAS entry');
  assert.equal(afterAlignment.pairs.length, 1, 'after alignment + invalidation, the rebuilt TLAS finds the real clash');
  assert.equal(afterAlignment.pairs[0].target.model, modelB);

  // 6. Query broadPhase:'linear' -- it must agree EXACTLY (same pairs set) with the post-alignment
  //    TLAS result. Explode/continuous movement is never exercised here -- this is one discrete
  //    alignment action only.
  const linearOracle = await world.findClashes(alignmentQuery('linear'));
  assert.deepEqual(
    linearOracle.pairs.map(pairKey).sort(),
    afterAlignment.pairs.map(pairKey).sort(),
    'the linear oracle must agree exactly with the TLAS result after alignment',
  );
});

// --- release lifecycle for the new marker ---------------------------------------------------------

test('_placementInvalidatedAtRevision is released on evictModel', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));
  world.invalidateModelPlacement(model);
  assert.ok(world._placementInvalidatedAtRevision.has(epoch));

  world.evictModel(model);
  assert.equal(world._placementInvalidatedAtRevision.has(epoch), false);
});

test('_placementInvalidatedAtRevision is cleared wholesale on dispose', async () => {
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.admitModel(model);
  await world.findClashes(query(model));
  world.invalidateModelPlacement(model);
  assert.equal(world._placementInvalidatedAtRevision.size, 1);

  world.dispose();
  assert.equal(world._placementInvalidatedAtRevision.size, 0);
});
