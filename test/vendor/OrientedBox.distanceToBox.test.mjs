// test/vendor/OrientedBox.distanceToBox.test.mjs
//
// RED regression tests for Defect 2 (adjudication §2.2): `OrientedBox.distanceToBox`'s
// `max[f2]`/`max[f3]` indexing typo at node_modules/three-mesh-bvh/src/math/OrientedBox.js:420,424
// (`start[f3] = i2 ? min[f3] : max[f2];` / `end[f3] = i2 ? min[f3] : max[f2];` -- both should read
// `max[f3]`). Exercises the vendored `OrientedBox` directly, not through `MeshBVH`.
//
// Task 1 of .superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/ -- these
// tests assert the CORRECT (post-Task-3-patch) behavior and are expected to FAIL against the
// current unpatched tree (RED). Task 3 applies the patch and confirms GREEN.
//
// Adjudication mandatory test 2, parts (a) named worst-case tuple, (b) 5000+-sample independent-
// reference sweep, (c) axis-permutation + cube control.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrientedBox } from 'three-mesh-bvh';
import {
  mulberry32,
  exactObbAabbDistance,
  sampledUpperBound,
  randomObbAabbPair,
} from './three-mesh-bvh-defects.fixtures.mjs';

// ---- (a) named worst-case tuple (adjudication §2.2(a)) ----

test('distanceToBox: named worst-case OBB/AABB tuple returns the exact reference distance, not the typo value', () => {
  const min = new THREE.Vector3(-0.3804163099641057, -0.9479515318050755, -2.03228256792402);
  const max = new THREE.Vector3(0.4589844705345968, 1.8687230714451164, 0.7140377524374228);

  // Matrix4.elements/fromArray storage is COLUMN-MAJOR (translation at indices 12-14) --
  // Matrix4.prototype.set takes its 16 args in ROW-MAJOR order and would silently build a
  // different matrix from this same flat array (confirmed: .set() on this array zeroes the
  // translation entirely). Must use fromArray, not set(...values).
  const matrixArray = [
    0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0,
    -0.5471904444278781, 0.8369961037130074, 0.004487749554735238, 0,
    0.836997078993147, 0.5471477941772834, 0.008073480282549787, 0,
    -1.07325792176335, 4.013246063149184, 0.5037035963049643, 1,
  ];
  const matrix = new THREE.Matrix4().fromArray(matrixArray);
  assert.equal(matrix.elements[12], -1.07325792176335, 'fromArray must place translation.x at index 12');

  const obb = new OrientedBox(min, max, matrix);
  obb.needsUpdate = true;

  const aabb = new THREE.Box3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.334708213962013, 3.561825842858211, 1.3125964404608106),
  );

  const distance = obb.distanceToBox(aabb);
  assert.equal(distance, 0.015450309808991687,
    'unpatched three-mesh-bvh@0.9.14 returns 0.045563153441575466 here (the max[f2]/max[f3] typo); ' +
    'this assertion targets the patched value and is expected to fail until Task 3 lands the fix');
});

// ---- (b) independent-reference sweep, >=5000 disjoint non-cubic pairs ----
//
// Computed once at module load (not inside a test()) so that each signal below -- over-estimate
// count, witness validity, reference-vs-sampled-upper-bound validity -- gets its own independent
// assertion and its own pass/fail line under `node --test`, instead of the first failing assert
// in a single test() suppressing the rest.

function runDistanceToBoxSweep() {
  const rng = mulberry32(987654321);
  const N_TARGET = 5200;
  const MAX_ATTEMPTS = N_TARGET * 20;

  let attempts = 0;
  let disjointCount = 0;
  let skippedZeroDistance = 0; // Defect-3 contamination guard (out-of-scope incomplete SAT, §2.3)
  let overEstimateCount = 0;
  let underEstimateCount = 0;
  let sampledUpperBoundViolations = 0;
  let worstOverEstimate = null;
  let witnessFailureCount = 0;
  let firstWitnessFailure = null;

  while (disjointCount < N_TARGET && attempts < MAX_ATTEMPTS) {
    attempts++;
    const { min, max, matrix, aabb } = randomObbAabbPair(rng);
    const obb = new OrientedBox(min, max, matrix);
    obb.needsUpdate = true;

    // Only assert on pairs the library's own (possibly incomplete, Defect-3) SAT confirms
    // disjoint -- a `false` from an incomplete-axis-set SAT can only be a TRUE disjointness
    // (some tested axis proved separation), so this filter is always correct regardless of
    // Defect 3, and this test must not fail on Defect 3's already-adjudicated, out-of-scope
    // behavior (intersectsBox() false-positive intersections cause distanceToBox() to
    // false-zero -- see the separate skip below for defense in depth).
    if (obb.intersectsBox(aabb)) continue;
    disjointCount++;

    obb.needsUpdate = true; // distanceToBox may have consumed the cached points; force a recompute
    const target1 = new THREE.Vector3();
    const target2 = new THREE.Vector3();
    const shipped = obb.distanceToBox(aabb, 0, target1, target2);

    if (shipped === 0) { skippedZeroDistance++; continue; } // Defect-3 contamination guard

    const ref = exactObbAabbDistance(min, max, matrix, aabb);
    const upper = sampledUpperBound(min, max, matrix, aabb, 200, rng);
    if (ref.distance > upper + 1e-6) sampledUpperBoundViolations++;

    const diff = shipped - ref.distance;
    if (diff > 1e-9) {
      overEstimateCount++;
      if (!worstOverEstimate || diff > worstOverEstimate.diff) {
        worstOverEstimate = { diff, shipped, ref: ref.distance, min: min.clone(), max: max.clone(), matrix: matrix.clone(), aabb: aabb.clone() };
      }
    } else if (diff < -1e-9) {
      underEstimateCount++;
    }

    // witness points realize the reported distance and lie on their respective boxes
    const eps = 1e-6;
    const onAabb = target2.x >= aabb.min.x - eps && target2.x <= aabb.max.x + eps
      && target2.y >= aabb.min.y - eps && target2.y <= aabb.max.y + eps
      && target2.z >= aabb.min.z - eps && target2.z <= aabb.max.z + eps;
    const invMatrix = new THREE.Matrix4().copy(matrix).invert();
    const localTarget1 = target1.clone().applyMatrix4(invMatrix);
    const onObb = localTarget1.x >= min.x - eps && localTarget1.x <= max.x + eps
      && localTarget1.y >= min.y - eps && localTarget1.y <= max.y + eps
      && localTarget1.z >= min.z - eps && localTarget1.z <= max.z + eps;
    const realizesDistance = Math.abs(target1.distanceTo(target2) - shipped) < 1e-6;
    if (!onAabb || !onObb || !realizesDistance) {
      witnessFailureCount++;
      if (!firstWitnessFailure) firstWitnessFailure = { onAabb, onObb, realizesDistance, shipped, target1: target1.clone(), target2: target2.clone() };
    }
  }

  const stats = {
    attempts, disjointCount, skippedZeroDistance, overEstimateCount, underEstimateCount,
    sampledUpperBoundViolations, witnessFailureCount, worstOverEstimate, firstWitnessFailure,
  };
  console.log('[Defect 2 sweep]', JSON.stringify({ ...stats, worstOverEstimate: undefined, firstWitnessFailure: undefined }));
  if (worstOverEstimate) console.log('[Defect 2 sweep] worst over-estimate:', worstOverEstimate);
  if (firstWitnessFailure) console.log('[Defect 2 sweep] first witness failure:', firstWitnessFailure);
  return stats;
}

const sweep = runDistanceToBoxSweep();

test('distanceToBox: independent-reference sweep >=5000 pairs -- reference validity (sampled upper bound)', () => {
  assert.ok(sweep.disjointCount >= 5000, `expected >=5000 disjoint pairs, got ${sweep.disjointCount}`);
  assert.equal(sweep.sampledUpperBoundViolations, 0,
    'the independent reference must never exceed the dense-sampling upper bound -- a violation ' +
    'here means the reference itself is broken (adjudication provenance: this is exactly what ' +
    'caught an earlier reference that silently discarded every edge-edge candidate)');
});

test('distanceToBox: independent-reference sweep >=5000 pairs -- zero over-estimates', () => {
  assert.equal(sweep.overEstimateCount, 0,
    'unpatched three-mesh-bvh@0.9.14 produces over-estimates here (false-prune-capable); ' +
    'expected 0 after Task 3\'s patch');
});

test('distanceToBox: independent-reference sweep >=5000 pairs -- witness points valid on non-skipped pairs', () => {
  assert.equal(sweep.witnessFailureCount, 0,
    'witness points must lie on their boxes and realize the reported distance on every ' +
    'non-skipped (shipped !== 0) pair');
});

// ---- (c) axis-permutation controls + cube no-op control ----

test('distanceToBox: axis-permuted rectangular AABBs each expose the typo (per-axis f2/f3 role)', () => {
  const min = new THREE.Vector3(-0.3804163099641057, -0.9479515318050755, -2.03228256792402);
  const max = new THREE.Vector3(0.4589844705345968, 1.8687230714451164, 0.7140377524374228);
  const matrix = new THREE.Matrix4().fromArray([
    0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0,
    -0.5471904444278781, 0.8369961037130074, 0.004487749554735238, 0,
    0.836997078993147, 0.5471477941772834, 0.008073480282549787, 0,
    -1.07325792176335, 4.013246063149184, 0.5037035963049643, 1,
  ]);

  // A cyclic permutation of the same three (distinct) extents across x/y/z, so every axis takes
  // the "large" role once -- the typo's effect depends on WHICH axis lands in the f2/f3 role
  // inside distanceToBox's inner loop.
  const baseExtents = [1.334708213962013, 3.561825842858211, 1.3125964404608106];
  const permutations = [
    { label: 'xyz', extents: [baseExtents[0], baseExtents[1], baseExtents[2]] },
    { label: 'yzx', extents: [baseExtents[1], baseExtents[2], baseExtents[0]] },
    { label: 'zxy', extents: [baseExtents[2], baseExtents[0], baseExtents[1]] },
  ];

  for (const { label, extents } of permutations) {
    const aabb = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(...extents));
    const obb = new OrientedBox(min, max, matrix);
    obb.needsUpdate = true;
    const shipped = obb.distanceToBox(aabb);
    const ref = exactObbAabbDistance(min, max, matrix, aabb).distance;
    assert.equal(shipped, ref,
      `permutation ${label}: unpatched three-mesh-bvh@0.9.14 diverges from the exact reference here ` +
      `(shipped=${shipped}, ref=${ref}); expected equal after Task 3's patch`);
  }
});

test('distanceToBox: cube AABB (max.x===max.y===max.z) is an exact no-op for the typo, both before and after the patch', () => {
  const min = new THREE.Vector3(-0.3804163099641057, -0.9479515318050755, -2.03228256792402);
  const max = new THREE.Vector3(0.4589844705345968, 1.8687230714451164, 0.7140377524374228);
  const matrix = new THREE.Matrix4().fromArray([
    0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0,
    -0.5471904444278781, 0.8369961037130074, 0.004487749554735238, 0,
    0.836997078993147, 0.5471477941772834, 0.008073480282549787, 0,
    -1.07325792176335, 4.013246063149184, 0.5037035963049643, 1,
  ]);
  const s = 1.5;
  const aabb = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(s, s, s));
  const obb = new OrientedBox(min, max, matrix);
  obb.needsUpdate = true;
  const shipped = obb.distanceToBox(aabb);
  const ref = exactObbAabbDistance(min, max, matrix, aabb).distance;
  assert.equal(shipped, ref, 'cube AABB: max[f2]===max[f3] for every f2/f3 pairing, so the typo is a literal no-op');
});
