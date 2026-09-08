// test/CollisionWorld.clearanceStatistics.test.mjs
//
// M3 Task 12: statistics consistency/inequality audit for mode:'clearance''s own 7 `clearance*`
// counters (Tasks 9-11's wiring). PURE TEST -- no production code changes. Verifies the
// definitive increment-point table in task-12-brief.md against the real wiring in
// collision/CollisionWorld.js (`_runClearanceBroadPhaseScan`/`_runClearanceNarrowPhasePair`, around
// CollisionWorld.js:1654-1717 and :2230-2260).
//
// Fixture plumbing mirrors test/CollisionWorld.findClashes.clearance.test.mjs's own `makeFixture`/
// `frozenClock` conventions (buildMockModel-based, one independent copy per test file, per this
// repo's own convention) rather than inventing a new scheme. The one addition is an optional
// `spec.matrix` override on `makeFixture`'s fragSpecs -- lets a fragment carry an arbitrary
// THREE.Matrix4 transform (e.g. a rotation) instead of only a translation, needed by test 3 below to
// reproduce test/query/ClearanceHardClashPrecheck.test.mjs's own already-verified "AABBs overlap,
// actual solids don't" fixture (a rotated box(2,2,2) whose square world AABB is looser than its
// actual diamond footprint) -- everything else is unchanged from the existing file's pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.clearance.test.mjs's makeFixture,
// plus the one `spec.matrix` addition documented above) ---------------------------------------------

function boundsOfTransform(geometry, matrix4) {
  const g = geometry.clone().applyMatrix4(matrix4);
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

function makeFixture(rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    // Addition over the sibling file's makeFixture: an explicit `spec.matrix` (a THREE.Matrix4) wins
    // over `at`-based translation, so a fragment can carry a rotation. Every existing-style fixture
    // (using only `at`) is byte-for-byte unaffected -- `spec.matrix` is undefined for those.
    const matrix4 = spec.matrix ? spec.matrix.clone() : new THREE.Matrix4().makeTranslation(...at);
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: matrix4.toArray(),
      bounds: spec.bounds || (spec.geometry ? boundsOfTransform(spec.geometry, matrix4) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
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
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rotateY = (angleRad) => new THREE.Matrix4().makeRotationY(angleRad);

// === Test 1: clearanceHits === pairs.length =======================================================
//
// One genuine near-miss pair (dbId10 -> dbId20, gap 0.5, clearance 1) among several fragments -- a
// third target dbId (30) sits far outside clearance and must never become a candidate at all.
test('clearanceHits === pairs.length for a clearance call', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] }, // gap 0.5, within clearance 1
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [1000, 0, 0] }, // far outside clearance
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20, 30] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(statistics.clearanceHits, pairs.length);
});

// === Test 2: clearanceExpandedCandidatePairs stays 0 under broadPhase:linear ======================
test('clearanceExpandedCandidatePairs stays 0 under broadPhase:linear', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] }, // gap 0.5
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(statistics.clearanceExpandedCandidatePairs, 0);
});

// === Test 3: clearanceOverlapPrechecksRun counts excluded candidates too, not just proceed ========
//
// Source dbId 10 is a box(2,2,2) rotated 45deg about Y -- its square world AABB (x/z in
// [-1.4142, 1.4142]) is strictly LOOSER than its actual rotated-diamond footprint (|x|+|z| <=
// 1.4142). This decouples "AABB touches, so the precheck does not skip" from "the actual solids
// overlap", letting a `proceed` candidate reach the precheck without ALSO being a real Hard Clash --
// mirrors test/query/ClearanceHardClashPrecheck.test.mjs's own already-verified fixture pair:
//   - dbId 20 (excluded): box(1,1,1) at (0.5,0,0) sits on the x-axis at |x|<=1 < 1.4142, so it's
//     squarely inside the diamond at z=0 -- a genuine, easy-to-prove positive-volume overlap.
//   - dbId 30 (proceed): box(1,1,1) at (1.6,0,1.6), the EXACT fixture ClearanceHardClashPrecheck's
//     own test verified as "AABBs overlap (loose rotated-box AABB), volumeOverlapQuery proves
//     conclusive no-overlap -> proceed" (real solids stay ~0.56 world units apart).
// Both candidates' precheck must run (excluded AND proceed both count), so this must be >= 2 -- the
// original draft's bug (per the brief's increment-point table) never counted the `excluded` status.
test('clearanceOverlapPrechecksRun counts excluded candidates too, not just proceed/inconclusive', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), matrix: rotateY(Math.PI / 4) },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] }, // overlaps the diamond -> excluded
      300: { geometryIndex: 2, geometry: box(1, 1, 1), at: [1.6, 0, 1.6] }, // AABB-touches, real solids don't -> proceed
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20, 30] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.ok(statistics.clearanceOverlapPrechecksRun >= 2, 'both the excluded and the proceed candidate must count');
});

// === Test 4: clearanceExactAabbSurvivors >= clearanceOverlapPrechecksRun ==========================
//
// Mixed set: dbId 20 touches source (AABBs overlap -> precheck runs, proven overlap -> excluded);
// dbId 30 is clearly separated (gap 3, still within clearance 5) so its AABBs never touch --
// classifyHardClashPrecheck's own `skip-precheck` path (ClearanceHardClashPrecheck.js:19-21) means
// its precheck never runs at all, yet it's still an exact-AABB survivor (candidate) since its AABB
// min-distance is <= clearance.
//
// codex-review (medium, post-write) finding: asserting only the `<=` inequality would silently pass
// even if `_runClearanceBroadPhaseScan` stopped counting the separated (skip-precheck) survivor at
// all -- both counters would collapse to 1 and the weaker assertion would not notice. This fixture's
// own exact counts are asserted directly instead, so that specific regression is actually caught.
test('clearanceExactAabbSurvivors >= clearanceOverlapPrechecksRun', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] }, // touching/overlapping -> precheck runs, excluded
      300: { geometryIndex: 2, geometry: box(2, 2, 2), at: [5, 0, 0] }, // gap 3, within clearance 5, AABBs never touch -> skip-precheck
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20, 30] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.ok(statistics.clearanceOverlapPrechecksRun <= statistics.clearanceExactAabbSurvivors);
  assert.equal(statistics.clearanceExactAabbSurvivors, 2, 'both dbId 20 (touching) and dbId 30 (separated-but-in-clearance) must survive');
  assert.equal(statistics.clearanceOverlapPrechecksRun, 1, 'only dbId 20 (AABB-touching) reaches the precheck; dbId 30 takes skip-precheck');
});

// === Test 5: clearanceDistanceQueriesRun excludes hard-clash-excluded and inconclusive candidates ==
//
// Reuses the same rotated-box construction as test 3 above (dbId 20: overlapping -> excluded, never
// reaches clearanceQuery at all; dbId 30: AABB-touching but real solids apart -> proceeds to
// clearanceQuery). So clearanceDistanceQueriesRun (only the proceed candidate) must be strictly LESS
// than clearanceExactAabbSurvivors (both candidates, since both pass the exact-AABB test) --
// verifying the increment-point table's claim that clearanceDistanceQueriesRun is per actual
// clearanceQuery call, never per candidate.
test('clearanceDistanceQueriesRun excludes hard-clash-excluded and inconclusive candidates', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }, { dbId: 30, fragments: [300] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), matrix: rotateY(Math.PI / 4) },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] }, // overlaps the diamond -> excluded, never reaches clearanceQuery
      300: { geometryIndex: 2, geometry: box(1, 1, 1), at: [1.6, 0, 1.6] }, // AABB-touches, real solids don't -> proceed, reaches clearanceQuery
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20, 30] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.ok(statistics.clearanceDistanceQueriesRun < statistics.clearanceExactAabbSurvivors);
  assert.equal(statistics.clearanceDistanceQueriesRun, 1, 'only the proceed candidate (dbId 30) reaches clearanceQuery');
  assert.equal(statistics.clearanceExactAabbSurvivors, 2, 'both candidates survive the exact-AABB test');
});

// === Test 6 (I-5 regression): clearanceHardClashExclusions counts a dbId pair with zero surviving
// clearance-distance candidates =====================================================================
//
// Source dbId 10 owns TWO fragments (100, 101); target dbId 20 owns one fragment (200) sized and
// placed to overlap BOTH of dbId 10's fragments -- so EVERY fragment pair between the two dbIds
// (100x200 AND 101x200) is a genuine, proven overlap, per the task-12 brief's own requirement that
// this fixture leave no non-overlapping fragment pair that could reach the distance query and
// populate clearanceCandidateByKey for this key. Both fragment pairs resolve 'hard-clash-excluded',
// so clearanceCandidateByKey never gets an entry for this dbId-level key at all -- the exact I-5 case
// (fix: clearanceHardClashExclusions must be derived from the complete hardClashExcludedKeys set,
// never by iterating clearanceCandidateByKey, which would silently undercount this key to 0).
//
// Flakiness note: the crossing-traversal budget clock inside classifyHardClashPrecheck's own
// volumeOverlapQuery call is threaded through this call's injected `_now` (CollisionWorld.js's
// `_runClearanceNarrowPhasePair`, `crossing: { now: this._now }`, the Task 9 fix for exactly this
// kind of flake) -- this world is constructed with `frozenClock()`, so that fix applies here too.
test('clearanceHardClashExclusions counts a dbId pair with zero surviving clearance-distance candidates', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100, 101] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, // x/y/z in [-1,1]
      101: { geometryIndex: 1, geometry: box(2, 2, 2), at: [0, 3, 0] }, // y in [2,4]
      // Spans y in [-1.5, 4.5] and x in [0,2] -- overlaps fragment 100 (y in [-1,1]) AND fragment 101
      // (y in [2,4]) simultaneously.
      200: { geometryIndex: 2, geometry: box(2, 6, 2), at: [1, 1.5, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
  assert.equal(statistics.clearanceHardClashExclusions, 1, 'must count from the complete excluded-key set, not from clearanceCandidateByKey');
});
