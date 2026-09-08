// test/CollisionWorld.findClashes.clearance.test.mjs
//
// M3 Task 9: mode:'clearance' end-to-end wiring, under broadPhase:'linear'.
//
// Fixture INTENT is ported from the task brief's Steps 4/6; the mock plumbing is NOT (the brief's
// own inline stubs use `null` placeholders). This file reuses the SAME stub-model idiom
// test/CollisionWorld.findClashes.test.mjs's own `makeFixture` and
// test/CollisionWorld.findClashes.crossModel.test.mjs's own `makeTwoModelFixture` already
// established (buildMockModel-based, one independent copy per test file, per this repo's own
// convention -- see those two files for the pattern this one mirrors).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.test.mjs's makeFixture) ------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

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

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.crossModel.test.mjs's
// makeTwoModelFixture, for the cross-model fixture only) -------------------------------------------

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
  return { model, rawGeometryByFragId, fragmentGeometry, stats };
}

function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }], fragSpecsA = {}, modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }], fragSpecsB = {}, modelOptionsB = {},
  } = opts;
  const a = makeModelPart(1, rootNodesA, fragSpecsA, modelOptionsA);
  const b = makeModelPart(2, rootNodesB, fragSpecsB, modelOptionsB);
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
  // `fragmentGeometryA`/`fragmentGeometryB` are the SAME live Maps the fixtures' fake FragmentLists
  // read from on every call (mirrors test/CollisionWorld.placementInvalidation.test.mjs's own
  // makeTwoModelFixture) -- mutating one between two findClashes calls simulates a fragment that
  // moved in the Viewer, for use with world.invalidateModelPlacement (fixture 12).
  return {
    modelA: a.model, modelB: b.model, viewer,
    fragmentGeometryA: a.fragmentGeometry, fragmentGeometryB: b.fragmentGeometry,
  };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// === Step 4: API-validation tests ================================================================

test('mode:"clearance" without a clearance param is rejected', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await assert.rejects(
    () => world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', groupBy: 'dbId' }),
    /clearance/i,
  );
});

for (const bad of [0, -1, NaN, Infinity, 'not-a-number', null]) {
  test(`mode:"clearance" with clearance=${bad} is rejected`, async () => {
    const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
    const world = await freshWorld(viewer, { now: frozenClock() });
    await world.admitModel(model);
    await assert.rejects(() => world.findClashes({
      source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', clearance: bad, groupBy: 'dbId',
    }));
  });
}

test('clearance param on a non-clearance mode is rejected', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await assert.rejects(() => world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', clearance: 1, groupBy: 'dbId',
  }));
});

test('existing three modes are unaffected by the new mode/clearance validation', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', groupBy: 'dbId' });
});

// === Step 6: end-to-end linear-path tests =========================================================

// Fixture 9: self-exclusion. The model's only fragment is BOTH the source and (via whole-model
// target scope) a candidate target -- it must never appear as its own clearance target.
test('source instance never appears as its own clearance target', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, fragments: [100] }],
    { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { targets: [{ model }] },
    mode: 'clearance', clearance: 100, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
});

// Fixture 3 (integration level): a real near-miss pair is reported with correct distance/witness.
// Two 2x2x2 boxes at (0,0,0) and (2.5,0,0) -> face gap 0.5.
test('a real near-miss same-model pair is reported under broadPhase:linear', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].type, 'clearance');
  assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-3);
  assert.equal(pairs[0].clearance, 1);
  assert.ok(pairs[0].witness.sourcePoint && pairs[0].witness.targetPoint);
  assert.equal(statistics.clearanceHits, pairs.length);
  assert.equal(statistics.clearanceExpandedCandidatePairs, 0); // linear path never populates this
  // Task reviewer fix (Important #2, fix round): this fixture has exactly one source instance and
  // one non-self-excluded target instance, so exactly one pair is tested in the broad phase and
  // exactly one candidate reaches narrow-phase evaluation -- these pre-existing, mode-agnostic
  // counters must be populated for clearance calls exactly like the three existing modes'.
  assert.equal(statistics.broadPhasePairs, 1);
  assert.equal(statistics.narrowPhasePairs, 1);
});

// Fixture 10: multi-fragment dbId, minimum wins, order-independent. Source dbId 10 owns fragments A
// (gap to target ~0.8) and B (gap to target ~0.3); the surviving winner must be the CLOSER pair (B).
test('fixture 10: multiple fragment pairs for one dbId -> minimum-distance fragment pair wins', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100, 101] }, { dbId: 20, fragments: [200] }] }],
    {
      // target face at x=9 (box centered at 10, half-extent 1)
      200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [10, 0, 0] },
      // fragment A: face at x=8.2 -> gap 0.8
      100: { geometryIndex: 1, geometry: box(2, 2, 2), at: [7.2, 0, 0] },
      // fragment B: face at x=8.7 -> gap 0.3 (the closer one, must win)
      101: { geometryIndex: 2, geometry: box(2, 2, 2), at: [7.7, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].distance - 0.3) < 1e-3, 'must pick the closer fragment pair (B), not A');
});

// Fixture 5/6 (integration level): Hard Clash exclusion.
// I-5 fix: dbId 10/20 here is a PURE Hard Clash -- the single fragment pair between them is a proven
// overlap, so it never reaches the distance query and clearanceCandidateByKey gets NO entry for this
// key. clearanceHardClashExclusions must still count exactly 1, derived from the complete
// excluded-key set (hardClashExcludedKeys), never from iterating clearanceCandidateByKey.
test('fixture 5/6: a pure Hard-Clash pair with no surviving clearance-distance candidate proves clearanceHardClashExclusions === 1', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      // Overlapping boxes (source: -1..1, target: 0..2 on x) -- a genuine crossing, proven overlap.
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
  assert.equal(statistics.clearanceHardClashExclusions, 1);
});

// Fixture 8: cross-model federated clearance.
test('fixture 8: cross-model near-miss pair reported with correct provenance', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].source.model, sourceModel);
  assert.equal(pairs[0].target.model, targetModel);
});

// === Task 10: TLAS clearance broad phase ==========================================================

// Fixture 11: linear-vs-TLAS parity. Source dbId 1 (a 2x2x2 box at the origin, face at x=+-1) faces
// several target dbIds: one near-miss on each side (within clearance), one genuine overlap (proven
// Hard Clash, excluded from clearance results), one far away (outside clearance, never a candidate
// at all), and one DIAGONAL near-miss (Task 13 addition, see below). broadPhase:'linear' and
// broadPhase:'tlas' must agree exactly.
//
// Task 13 addition (closing a deferred Minor from Task 10's review): every target above the diagonal
// one is offset along a SINGLE axis, so `_runClearanceTlasBroadPhase`'s own broad-phase admission test
// (the source AABB inflated by `clearance` on every axis independently -- a Chebyshev/L-infinity ball,
// via bvh.queryBox) and the exact per-candidate retest (`aabbMinDistance(...) <= clearance`, Euclidean/
// L2, from collision/geometry/AabbDistance.js) can never disagree for those cases alone -- a bug that
// dropped the exact retest entirely (returning every broad-phase admission as a real candidate) would
// still pass. dbId 5 below is offset by 2.5 on BOTH x and y (clearance 3): the Chebyshev distance is
// 2.5 (<=3, so the inflated-box broad phase genuinely ADMITS it as a candidate), but the true Euclidean
// gap is sqrt(2.5^2+2.5^2) ~= 3.5355 (>3, so the exact retest -- and the real geometric answer -- must
// REJECT it). This is deliberately NOT a boundary case (the codex-advisor-verified rejection margin is
// ~0.54, comfortably clear of the clearance=3 threshold): the point is proving the exact-retest layer
// is actually wired up and does real work, not probing a float-precision edge.
test('fixture 11: linear and TLAS produce identical clearance pairs on the same federated scene', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 1, fragments: [200] }, // face at x=1.5, gap 0.5 -> within clearance 3
      { dbId: 2, fragments: [201] }, // face at x=-1.5, gap 0.5 -> within clearance 3
      { dbId: 3, fragments: [202] }, // overlaps source (-1..1 vs -0.5..1.5) -> Hard Clash, excluded
      { dbId: 4, fragments: [203] }, // far away -> outside clearance, never a candidate
      // dbId 5: diagonal offset (2.5, 2.5, 0). Chebyshev gap 2.5 <= clearance 3 (broad phase admits),
      // Euclidean gap ~3.5355 > clearance 3 (exact retest correctly rejects) -- see comment above.
      { dbId: 5, fragments: [204] },
    ],
    fragSpecsB: {
      200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] },
      201: { geometryIndex: 1, geometry: box(2, 2, 2), at: [-2.5, 0, 0] },
      202: { geometryIndex: 2, geometry: box(2, 2, 2), at: [0.5, 0, 0] },
      203: { geometryIndex: 3, geometry: box(2, 2, 2), at: [100, 0, 0] },
      204: { geometryIndex: 4, geometry: box(2, 2, 2), at: [4.5, 4.5, 0] },
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const base = {
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 3, groupBy: 'dbId',
  };
  const linearResult = await world.findClashes({ ...base, broadPhase: 'linear' });
  const tlasResult = await world.findClashes({ ...base, broadPhase: 'tlas' });

  const normalize = (pairs) => pairs.map((p) => `${p.source.dbId}:${p.target.dbId}:${p.distance.toFixed(6)}`).sort();
  assert.deepEqual(normalize(tlasResult.pairs), normalize(linearResult.pairs));
  assert.equal(tlasResult.pairs.length, 2, 'exactly the two genuine near-misses, not the overlap, the far fragment, or the diagonal one');
  assert.ok(!tlasResult.pairs.some((p) => p.target.dbId === 5), 'the diagonal candidate must be rejected by the exact retest, not just happen to be absent');
  // TLAS-only counters: populated for the TLAS path, and never for the linear path (asserted
  // elsewhere in this file -- Task 9's own "linear path never populates this" assertion).
  assert.ok(tlasResult.statistics.clearanceExpandedCandidatePairs > 0);
  assert.equal(linearResult.statistics.clearanceExpandedCandidatePairs, 0);
  // The diagonal candidate (dbId 5) proves genuine broad-phase-vs-exact-retest divergence: it is
  // admitted by the inflated-box broad phase (counted in clearanceExpandedCandidatePairs) but
  // rejected by the exact aabbMinDistance retest (never reaches clearanceExactAabbSurvivors) -- so
  // the expanded count must be strictly greater than the exact-survivor count, not merely equal.
  assert.ok(
    tlasResult.statistics.clearanceExpandedCandidatePairs > tlasResult.statistics.clearanceExactAabbSurvivors,
    `expected the diagonal candidate to be admitted by broad phase but rejected by the exact retest: ` +
    `expanded=${tlasResult.statistics.clearanceExpandedCandidatePairs}, survivors=${tlasResult.statistics.clearanceExactAabbSurvivors}`,
  );
  // Design spec §11: the generic M2 TLAS fields are populated identically, by the same code, for a
  // clearance call as for the three pre-existing modes -- every candidate this broad phase returns
  // reaches the shared narrow-phase loop one-for-one, so tlasNarrowPhaseInputPairs must equal
  // narrowPhasePairs under broadPhase:'tlas' (the same invariant M2's own TLAS calls already hold).
  assert.equal(tlasResult.statistics.tlasNarrowPhaseInputPairs, tlasResult.statistics.narrowPhasePairs);
  assert.equal(tlasResult.statistics.tlasExactRetestSurvivors, tlasResult.statistics.narrowPhasePairs);
  assert.ok(tlasResult.statistics.broadPhasePairs > 0);
});

// Fixture 12: placement invalidation changes the clearance verdict on the next TLAS call.
//
// Task 13 addition (closing a deferred Minor from Task 10's review, codex-advisor-verified): the
// original before/after (moved-away) sequence below does NOT actually prove invalidation works. The
// clearance narrow phase always re-resolves each candidate's CURRENT worldBounds and re-applies the
// exact `aabbMinDistance(...) <= clearance` retest regardless of what the TLAS itself returned -- so
// even a completely stale near-position TLAS that kept emitting the (now far-away) target as a
// candidate would still get correctly rejected by that retest, and `before.pairs.length === 1` ->
// `after.pairs.length === 0` would still pass. The direction that actually discriminates a broken
// invalidation is the REVERSE: a TLAS built while the target is far away can never emit a candidate
// that only later moved into range -- that is a true stale-TLAS FALSE NEGATIVE (the broad phase would
// never even offer the fresh in-range fragment to the exact retest), and no downstream exact-retest
// logic can rescue it. Phase 3 below adds exactly this: after `after.pairs.length === 0` (which just
// built and cached a far-position TLAS), move the target to a THIRD, new position back within
// clearance, invalidate again, and assert both the pair reappears AND `tlasBuilds === 1` (proving a
// genuine rebuild happened on this call, not a stale cache hit that coincidentally still worked).
test('fixture 12: invalidateModelPlacement changes clearance verdict correctly', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer, fragmentGeometryB } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [10] }],
    fragSpecsA: { 10: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [100] }],
    fragSpecsB: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] } }, // gap 0.5
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const query = {
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'tlas',
  };

  const before = await world.findClashes(query);
  assert.equal(before.pairs.length, 1);

  // Move targetModel's fragment far away (same live-Map mutation mechanism
  // test/CollisionWorld.placementInvalidation.test.mjs's own fixtures use), then invalidate.
  fragmentGeometryB.set(100, {
    geometryIndex: 0,
    matrix: translationMatrix([1000, 0, 0]),
    bounds: boundsOf(box(2, 2, 2), [1000, 0, 0]),
  });
  world.invalidateModelPlacement(targetModel);

  const after = await world.findClashes(query);
  assert.equal(after.pairs.length, 0);

  // Phase 3 (Task 13 addition): move back within clearance -- to a NEW position, not the original
  // [2.5,0,0] -- and invalidate again. A stale-TLAS false negative would keep reporting 0 pairs here
  // even though the current placement genuinely clashes within clearance.
  fragmentGeometryB.set(100, {
    geometryIndex: 0,
    matrix: translationMatrix([-2.75, 0, 0]), // face at x=-1.75, gap 0.75 from source's face at x=-1
    bounds: boundsOf(box(2, 2, 2), [-2.75, 0, 0]),
  });
  world.invalidateModelPlacement(targetModel);

  const backAgain = await world.findClashes(query);
  assert.equal(backAgain.statistics.tlasBuilds, 1, 'invalidation must force a real rebuild, not a stale cache hit');
  assert.equal(backAgain.pairs.length, 1, 'moving back within clearance + invalidation must be detected -- not just the moved-away direction');
  assert.equal(backAgain.pairs[0].target.model, targetModel);
  assert.ok(Math.abs(backAgain.pairs[0].distance - 0.75) < 1e-3, `expected distance ~0.75, got ${backAgain.pairs[0].distance}`);
});
