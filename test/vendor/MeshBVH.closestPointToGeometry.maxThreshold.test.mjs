// test/vendor/MeshBVH.closestPointToGeometry.maxThreshold.test.mjs
//
// RED regression test for Defect 2 (adjudication mandatory test 9): a false-prune case that
// manifests with a FINITE `maxThreshold`, the way production actually calls
// `closestPointToGeometry` (`ClearanceQuery.js` always passes a finite
// `anchorLocalMaxThreshold`). The adjudication's own end-to-end proof (§2.2(b)) used
// `maxThreshold = Infinity`, which only exercises the `score < closestDistance` prune conjunct;
// this test exercises the `score < maxThreshold` conjunct specifically.
//
// The abstract OBB/AABB tuple from test 2(a) is a `distanceToBox` node-pruning SCORE, not a full
// `closestPointToGeometry` scenario, so it can't be reused directly here -- there's no concrete
// triangle geometry/transform behind it. Instead this derives a concrete triangle fixture using
// the SAME randomized-search methodology the adjudication's own end-to-end proof used: a
// multi-node anchor mesh and a multi-node far mesh (so Defect 1 stays structurally out of play --
// intersectsBounds fires normally on both), many random rigid-transform placements of the far
// mesh, and for each a comparison between (i) the true minimum distance via brute-force
// triangle-pair sampling (`ExtendedTriangle.distanceToTriangle`, no BVH) and (ii) the unpatched
// `closestPointToGeometry` result with `maxThreshold = Infinity`. The frozen fixture below is the
// sample (fixed seed 42424242, fixed transform) kept from that search where the unpatched result
// over-estimated the true minimum in the false-prune direction by >=10x this test's tolerance;
// from that sample's true distance `d`, `maxThreshold` is set to `d * 1.05` so the true answer is
// within threshold but the unpatched over-estimate is not. See the fixtures module's
// `bruteForceMinDistance`/`randomRigidTransform` for the generator this fixture was searched with
// (not re-run here -- the fixture is frozen, not regenerated on every test run).
//
// Task 1 of .superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/. Expected
// to FAIL against the current unpatched tree (RED, returning `null`); Task 3 applies the patch and
// confirms GREEN (a non-null result equal to the true minimum).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ExtendedTriangle } from 'three-mesh-bvh';
import {
  gridGeometry,
  buildMeshBvh,
  isRootLeaf,
  extractTriangleVertices,
  bruteForceMinDistance,
} from './three-mesh-bvh-defects.fixtures.mjs';

// Multi-node anchor (40 triangles) and multi-node far mesh (18 triangles) -- both well over
// targetLeafSize (10), so neither BVH's root is a leaf and Defect 1 cannot contaminate this test.
const anchorGeometry = gridGeometry(4, 5, 2, 2.4, 0);
const anchorBvh = buildMeshBvh(anchorGeometry, { indirect: true });

const farGeometry = gridGeometry(3, 3, 0.6, 0.6, 0);
const farBvh = buildMeshBvh(farGeometry, { indirect: true });

// Frozen fixture: found via a fixed-seed (42424242) randomized search over rigid transforms of
// `farGeometry` at distances in [0.1, 3.0] from the anchor, keeping the sample with the largest
// over-prune margin among 20000 trials (63 qualifying samples found; see module header). This is
// the transform, stored as Matrix4.toArray() column-major order (translation at indices 12-14).
const FROZEN_TRANSFORM = new THREE.Matrix4().fromArray([
  0.14073677312702806, -0.9568191741805413, -0.2543427384657527, 0,
  0.05347897102422744, -0.2491776045576542, 0.9669801037483134, 0,
  -0.9886016186250057, -0.14969164742020913, 0.016101252890459508, 0,
  1.1869580472544647, 0.14228969809833164, -0.02936677379283659, 1,
]);
const FROZEN_TRUE_MIN_DISTANCE = 0.14192432541559227; // brute-force triangle-pair minimum at FROZEN_TRANSFORM
const MAX_THRESHOLD = FROZEN_TRUE_MIN_DISTANCE * 1.05; // 0.14902054168637188 -- true answer is inside, unpatched over-estimate (0.2446275839242859) is not

test('fixture sanity: both anchor and far meshes are multi-node (Defect 1 out of play)', () => {
  assert.ok(!isRootLeaf(anchorBvh), 'anchor (40 triangles) must be multi-node');
  assert.ok(!isRootLeaf(farBvh), 'far mesh (18 triangles) must be multi-node');
});

test('fixture sanity: frozen transform\'s brute-force triangle-pair minimum matches the recorded value', () => {
  const anchorTriangles = extractTriangleVertices(anchorGeometry).map(([a, b, c]) => {
    const t = new ExtendedTriangle(a, b, c);
    t.needsUpdate = true;
    return t;
  });
  const farTrianglesLocal = extractTriangleVertices(farGeometry);
  const trueMin = bruteForceMinDistance(anchorTriangles, farTrianglesLocal, FROZEN_TRANSFORM, ExtendedTriangle);
  assert.equal(trueMin, FROZEN_TRUE_MIN_DISTANCE);
});

test('fixture sanity: unpatched closestPointToGeometry over-estimates the true minimum with maxThreshold=Infinity (the false-prune signature)', () => {
  const target1 = {};
  const result = anchorBvh.closestPointToGeometry(farGeometry, FROZEN_TRANSFORM, target1, undefined, 0, Infinity);
  const shipped = result ? result.distance : null;
  console.log('[Defect 2 maxThreshold] unpatched result (maxThreshold=Infinity):', shipped, 'true min:', FROZEN_TRUE_MIN_DISTANCE);
  assert.ok(shipped !== null && shipped > FROZEN_TRUE_MIN_DISTANCE + 10 * 1e-9,
    'expected an over-estimate (false-prune signature) of at least 10x this test\'s tolerance');
});

test('closestPointToGeometry: finite maxThreshold that brackets the true distance but not the unpatched over-estimate', () => {
  const target1 = {};
  const result = anchorBvh.closestPointToGeometry(farGeometry, FROZEN_TRANSFORM, target1, undefined, 0, MAX_THRESHOLD);
  const shipped = result ? result.distance : null;

  console.log('[Defect 2 maxThreshold] maxThreshold =', MAX_THRESHOLD, 'unpatched result =', shipped,
    '(expected null: false prune -- the true minimizer node\'s over-estimated distanceToBox score exceeds maxThreshold)');

  assert.notEqual(shipped, null,
    'unpatched three-mesh-bvh@0.9.14 returns null here (false prune: the buggy distanceToBox ' +
    'over-estimate for the true-minimizer node exceeds this finite maxThreshold even though the ' +
    'true distance is within it); expected the true minimum after Task 3\'s patch');
  assert.equal(shipped, FROZEN_TRUE_MIN_DISTANCE);
});
