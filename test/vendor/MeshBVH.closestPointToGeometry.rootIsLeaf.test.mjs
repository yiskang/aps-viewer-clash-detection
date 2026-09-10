// test/vendor/MeshBVH.closestPointToGeometry.rootIsLeaf.test.mjs
//
// RED regression test for Defect 1 (adjudication §2.1): the module-global `obb2` singleton in
// node_modules/three-mesh-bvh/src/core/cast/closestPointToGeometry_indirect.generated.js has its
// `min`/`max` refreshed ONLY inside the outer shapecast's `intersectsBounds` leaf branch (lines
// 78-84), but `shapecastTraverse` (src/core/cast/shapecast.js) calls `intersectsBoundsFunc` only
// on a node's CHILDREN during recursion -- never on the root. When the anchor BVH's root is
// itself a leaf (<=10 triangles, the default `targetLeafSize`), `intersectsBounds` never runs at
// all, so the nested traversal (which uses `obb2` to prune the far BVH's nodes) silently reuses
// whatever `obb2.min`/`max` a PRIOR, unrelated `closestPointToGeometry` call last set -- byte-
// identical (anchor, far) operands can then return a correct distance or a false `null`
// ("beyond threshold") purely depending on what ran immediately before.
//
// Task 1 of .superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/ -- these
// tests assert order-independent, brute-force-correct behavior and are expected to FAIL against
// the current unpatched tree (RED, reproducing the adjudication's documented
// `[0.05000000074505806, null, 0.05000000074505806, null]`). Task 3 applies the patch and
// confirms GREEN.
//
// Adjudication mandatory test 1. `indirect: true` throughout, matching
// `ThreeMeshBvhBackend.js:55-56`'s production BLAS construction (the only mode this repo uses).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quadGeometry,
  gridGeometry,
  translateGeometry,
  buildMeshBvh,
  isRootLeaf,
  nodeCount,
  closestDistance,
  runEightCallPredecessorSequence,
} from './three-mesh-bvh-defects.fixtures.mjs';

// Ground truth distance between the anchor quad (z=0) and the far grid (z=0.05), per adjudication
// §2.1 ("brute-force ground truth for (anchor, far): 0.05000000074505806", dense barycentric
// sampling of every triangle pair).
const TRUTH = 0.05000000074505806;
const MAX_THRESHOLD = 0.5;

// ---- fixtures ----

// Anchor under test: a 2-triangle quad -- targetLeafSize is 10, so this always builds a single
// leaf node (rootIsLeaf: true).
const anchorGeometry = quadGeometry(0, 0, 0, 1);
const anchorBvh = buildMeshBvh(anchorGeometry, { indirect: true });

// Far operand: a 6x6 grid (72 triangles) parallel to the anchor at z=0.05, with its own
// boundsTree, so the nested accelerated path that reads obb2 is taken.
const farGeometry = gridGeometry(6, 6, 1, 1, 0.05);
const farBvh = buildMeshBvh(farGeometry, { indirect: true });

// Perturber: a multi-node anchor (4x4 grid, 32 triangles) near the origin -- "near" when left in
// place (its own leaf boxes sit near the plate region the real test operates in), "distant" when
// translated ~1000 units away. Because it is multi-node, `intersectsBounds` fires normally on its
// own traversal (unlike the anchor under test), so a call using it is itself immune to Defect 1 --
// its own returned distance is always correct -- but it still leaves obb2's min/max set to
// whichever of ITS OWN leaf boxes was last visited, corrupting state for the NEXT call that hits
// a root-is-leaf anchor. Predecessor calls use maxThreshold=Infinity so `intersectsBounds`'s
// `score < maxThreshold` check can never block a leaf visit (a finite threshold would prevent
// obb2 from being refreshed at all when the perturber pair's true distance exceeds it).
const perturberNearGeometry = gridGeometry(4, 4, 1, 1, 0);
const perturberNearBvh = buildMeshBvh(perturberNearGeometry, { indirect: true });
const perturberDistantGeometry = translateGeometry(perturberNearGeometry, 1000, 1000, 1000);
const perturberDistantBvh = buildMeshBvh(perturberDistantGeometry, { indirect: true });

test('fixture sanity: anchor root is a single leaf node (32 bytes, IS_LEAF set)', () => {
  assert.equal(nodeCount(anchorBvh), 1, 'anchor (2 triangles) must build to exactly 1 node');
  assert.equal(anchorBvh._roots[0].byteLength, 32, 'a single node is 32 bytes (BYTES_PER_NODE)');
  assert.ok(isRootLeaf(anchorBvh), 'the anchor root must have the IS_LEAF flag set (uint16[15] === 0xFFFF)');
});

test('fixture sanity: far operand and perturber anchor are multi-node (root is NOT a leaf)', () => {
  assert.ok(!isRootLeaf(farBvh), 'far operand (72 triangles) must be multi-node');
  assert.ok(!isRootLeaf(perturberNearBvh), 'perturber anchor (32 triangles) must be multi-node');
  assert.ok(!isRootLeaf(perturberDistantBvh), 'translated perturber anchor must remain multi-node');
});

test('fixture sanity: brute-force ground truth matches the library\'s own multi-node-anchor answer', () => {
  // A multi-node anchor is immune to Defect 1 (intersectsBounds fires normally throughout), so
  // this confirms 0.05000000074505806 independently of any predecessor-call staleness.
  const controlGeometry = gridGeometry(4, 4, 1, 1, 0);
  const controlBvh = buildMeshBvh(controlGeometry, { indirect: true });
  const distance = closestDistance(controlBvh, farGeometry, { maxThreshold: Infinity });
  assert.equal(distance, TRUTH);
});

test('closestPointToGeometry: root-is-leaf anchor returns the SAME correct distance across the 8-call predecessor sequence (order-independence)', () => {
  const measured = () => closestDistance(anchorBvh, farGeometry, { maxThreshold: MAX_THRESHOLD });
  const nearPredecessor = () => closestDistance(perturberNearBvh, farGeometry, { maxThreshold: Infinity });
  const distantPredecessor = () => closestDistance(perturberDistantBvh, farGeometry, { maxThreshold: Infinity });

  const { measured: [A, B, C, D], predecessors } = runEightCallPredecessorSequence({
    measured, nearPredecessor, distantPredecessor,
  });

  console.log('[Defect 1 rootIsLeaf] measured [A,B,C,D] =', [A, B, C, D]);
  console.log('[Defect 1 rootIsLeaf] predecessor results (near1, distant1, near2, distant2) =', predecessors);

  // Both predecessor pairs are multi-node (immune to Defect 1 via their own normal
  // intersectsBounds traversal), so every predecessor call must itself return a real, finite
  // distance -- never null -- regardless of what the patch does. A null predecessor result would
  // mean the predecessor construction itself is broken (e.g. maxThreshold too tight), not that
  // Defect 1 is being demonstrated.
  for (const [label, value] of [['near1', predecessors[0]], ['distant1', predecessors[1]], ['near2', predecessors[2]], ['distant2', predecessors[3]]]) {
    assert.ok(typeof value === 'number' && Number.isFinite(value), `predecessor call ${label} must return a finite distance, got ${value}`);
  }

  // One combined assertion (rather than four separate ones) so a failure shows all four measured
  // values at once -- unpatched three-mesh-bvh@0.9.14 reproduces [TRUTH, null, TRUTH, null]
  // (B and D come back null: stale obb2 from the distant perturber pair immediately preceding
  // each, false "beyond threshold").
  assert.deepEqual([A, B, C, D], [TRUTH, TRUTH, TRUTH, TRUTH],
    'all four measured calls (A/B/C/D), byte-identical (anchor, far) operands, must return the ' +
    'same brute-force-correct distance regardless of which call ran immediately before them');
});

test('closestPointToGeometry: MULTI-NODE anchor control is stable across the same 8-call predecessor sequence (before AND after the patch)', () => {
  // Same experiment, but the measured anchor is multi-node (root is NOT a leaf) -- proves the
  // order-independence test above isn't passing by accident: a multi-node anchor's own
  // intersectsBounds always fires, so it must be immune to predecessor staleness both before and
  // after Task 3's patch.
  const controlAnchorGeometry = gridGeometry(4, 4, 1, 1, 0);
  const controlAnchorBvh = buildMeshBvh(controlAnchorGeometry, { indirect: true });
  assert.ok(!isRootLeaf(controlAnchorBvh), 'control anchor must be multi-node');

  const measured = () => closestDistance(controlAnchorBvh, farGeometry, { maxThreshold: MAX_THRESHOLD });
  const nearPredecessor = () => closestDistance(perturberNearBvh, farGeometry, { maxThreshold: Infinity });
  const distantPredecessor = () => closestDistance(perturberDistantBvh, farGeometry, { maxThreshold: Infinity });

  const { measured: [A, B, C, D] } = runEightCallPredecessorSequence({ measured, nearPredecessor, distantPredecessor });

  console.log('[Defect 1 control multi-node] measured [A,B,C,D] =', [A, B, C, D]);

  for (const [label, value] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
    assert.equal(value, TRUTH, `control call ${label} must be stable and correct regardless of predecessor`);
  }
});
