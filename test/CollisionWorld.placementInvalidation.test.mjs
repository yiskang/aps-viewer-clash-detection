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

test('invalidation BEFORE the epoch\'s first-ever TLAS build is still honored, not silently ignored', async () => {
  // The exact scenario codex-review's Critical #2 finding described: extraction records the
  // model's placement, invalidateModelPlacement is called, and ONLY THEN does the first-ever TLAS
  // query for that epoch run. TlasCache.getBuiltAtRevision returns undefined for a never-built
  // epoch (Task 10), which Task 13's own trigger condition treats as -1 -- always stale relative
  // to any real invalidation marker. This test confirms the marker itself is present and readable
  // for that trigger condition to consult once Task 13 wires it.
  const { model, viewer } = makeFixture();
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model));

  assert.equal(world._tlasCache.getBuiltAtRevision(epoch), undefined, 'no TLAS build has ever run for this epoch yet');
  world.invalidateModelPlacement(model);
  assert.ok(world._placementInvalidatedAtRevision.has(epoch), 'the invalidation marker is set and available for Task 13s future trigger to consult');
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
