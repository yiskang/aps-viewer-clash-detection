// test/vendor/MeshBVH.closestPointToGeometry.multiRoot.test.mjs
//
// RED regression test for Defect 1 on a MULTI-ROOT BVH (adjudication mandatory test 8). Proves
// the defect isn't specific to a single-root BVH: `shapecastTraverse` skips `intersectsBoundsFunc`
// on the ROOT of every call it's given, and for a multi-root BVH it is called once PER ROOT --
// so two independent root-leaf groups in the SAME BVH are each independently exposed.
//
// Important deviation from the other Task-1 tests: this fixture is built with `indirect: false`,
// not `indirect: true`. `GeometryBVH.getRootRanges()`
// (node_modules/three-mesh-bvh/src/core/GeometryBVH.js:169-181) hardcodes a SINGLE root range
// whenever `options.indirect` is true, regardless of `geometry.groups` -- indirect mode's
// compacted indirect-buffer layout makes per-group root separation unnecessary for it. Multi-root
// BVHs (`bvh._roots.length > 1`) are therefore only reachable via `indirect: false`, which is why
// this is the one Task-1 test that does not match `ThreeMeshBvhBackend.js`'s
// `indirect: true`-only production construction. This is also exactly why the adjudication's
// Patch 1 must be applied to `closestPointToGeometry.generated.js` (non-indirect) as well as the
// `_indirect` and `.template.js` variants (Step 4, recommendation 1) -- confirmed identical
// module-global-`obb2` structure between the two `.generated.js` files by direct diff.
//
// Task 1 of .superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/. Expected
// to FAIL against the current unpatched tree (RED); Task 3 applies the patch and confirms GREEN.
//
// Per task-1-brief.md's note (correcting the adjudication's own framing): this test's RETURN
// VALUE cannot by itself distinguish the adopted `intersectsRange`-box patch from the rejected
// `getBoundingBox` union-seed variant -- both are correctness-safe and can produce the same
// minimum on this fixture. Its job here is to prove the defect reproduces on a multi-root BVH
// (RED) and, after Task 3, that the adopted patch doesn't regress multi-root traversal (GREEN).
// Confirming WHICH variant was applied is Task 3's job (inspecting the patch diff directly), not
// this test's.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridGeometry,
  translateGeometry,
  twoGroupGeometry,
  buildMeshBvh,
  isRootLeaf,
  closestDistance,
  runEightCallPredecessorSequence,
} from './three-mesh-bvh-defects.fixtures.mjs';

const TRUTH = 0.05000000074505806;
const MAX_THRESHOLD = 0.5;

// Multi-root anchor: group A (2 triangles) sits at the origin, near the far operand (true
// distance 0.05); group B (2 triangles) is widely separated (at (3,3,3), true distance to the far
// operand ~5.2, well beyond maxThreshold=0.5). Both groups are <= targetLeafSize (10) triangles,
// so both roots are leaves -- group A is the only one that can realize the global minimum under
// maxThreshold=0.5.
const multiRootGeometry = twoGroupGeometry([0, 0, 0], [3, 3, 3]);
const multiRootBvh = buildMeshBvh(multiRootGeometry, { indirect: false });

const farGeometry = gridGeometry(6, 6, 1, 1, 0.05);
const farBvh = buildMeshBvh(farGeometry, { indirect: false });

const perturberNearGeometry = gridGeometry(4, 4, 1, 1, 0);
const perturberNearBvh = buildMeshBvh(perturberNearGeometry, { indirect: false });
const perturberDistantGeometry = translateGeometry(perturberNearGeometry, 1000, 1000, 1000);
const perturberDistantBvh = buildMeshBvh(perturberDistantGeometry, { indirect: false });

test('fixture sanity: multi-root anchor has exactly 2 roots, both leaves', () => {
  assert.equal(multiRootBvh._roots.length, 2, 'two widely-separated groups must build to 2 roots');
  assert.ok(isRootLeaf(multiRootBvh, 0), 'root 0 (group A, 2 triangles) must be a leaf');
  assert.ok(isRootLeaf(multiRootBvh, 1), 'root 1 (group B, 2 triangles) must be a leaf');
});

test('fixture sanity: perturber anchors are multi-node (root is NOT a leaf)', () => {
  assert.ok(!isRootLeaf(perturberNearBvh), 'near perturber anchor (32 triangles) must be multi-node');
  assert.ok(!isRootLeaf(perturberDistantBvh), 'translated perturber anchor must remain multi-node');
});

test('fixture sanity: brute-force ground truth for the multi-root anchor matches the single-root case', () => {
  const distance = closestDistance(multiRootBvh, farGeometry, { maxThreshold: Infinity });
  assert.equal(distance, TRUTH, 'group A (near the far operand) must be the global minimizer');
});

test('closestPointToGeometry: multi-root anchor (both roots leaves) returns the SAME correct distance across the 8-call predecessor sequence', () => {
  const measured = () => closestDistance(multiRootBvh, farGeometry, { maxThreshold: MAX_THRESHOLD });
  const nearPredecessor = () => closestDistance(perturberNearBvh, farGeometry, { maxThreshold: Infinity });
  const distantPredecessor = () => closestDistance(perturberDistantBvh, farGeometry, { maxThreshold: Infinity });

  const { measured: [A, B, C, D], predecessors } = runEightCallPredecessorSequence({
    measured, nearPredecessor, distantPredecessor,
  });

  console.log('[Defect 1 multiRoot] measured [A,B,C,D] =', [A, B, C, D]);
  console.log('[Defect 1 multiRoot] predecessor results (near1, distant1, near2, distant2) =', predecessors);

  for (const [label, value] of [['near1', predecessors[0]], ['distant1', predecessors[1]], ['near2', predecessors[2]], ['distant2', predecessors[3]]]) {
    assert.ok(typeof value === 'number' && Number.isFinite(value), `predecessor call ${label} must return a finite distance, got ${value}`);
  }

  assert.deepEqual([A, B, C, D], [TRUTH, TRUTH, TRUTH, TRUTH],
    'both roots being leaves means neither root ever refreshes obb2 via intersectsBounds -- ' +
    'unpatched three-mesh-bvh@0.9.14 is expected to reproduce the same [TRUTH, null, TRUTH, null] ' +
    'pattern as the single-root case');
});
