import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adaptViewerGeometry } from '../../collision/viewer/ViewerGeometryAdapter.js';
import { compactAndWeld } from '../../collision/geometry/activeRangeCompaction.js';

function buildIsolatedTriangleView(triangleCount) {
  // Every triangle uses its OWN 3 vertices (no sharing) -- welding cannot merge
  // anything here, so triangleCount stays exact and easy to assert against.
  const positions = new Float32Array(triangleCount * 3 * 3);
  const index = new Uint32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const v = t * 3;
    positions.set([v, 0, 0, v + 1, 0, 0, v, 1, 0], v * 3);
    index[v] = v; index[v + 1] = v + 1; index[v + 2] = v + 2;
  }
  return {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index,
    ranges: [{ start: 0, count: index.length }], activeTriangleCount: triangleCount,
  };
}

// Minimal local edge-connectivity component counter -- Task 4 provides the reusable
// version (collision/geometry/GeometryConnectivity.js); this task predates it, so a
// small self-contained helper avoids a forward dependency on a not-yet-existing module.
function countComponents(index, triangleCount) {
  const parent = Array.from({ length: triangleCount }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const edgeMap = new Map();
  for (let t = 0; t < triangleCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index[t * 3 + e], v1 = index[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(t);
    }
  }
  for (const tris of edgeMap.values()) for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  return new Set(Array.from({ length: triangleCount }, (_, t) => find(t))).size;
}

test('activeTriangleCount = 13,000 (39,000 index elements): skipped, no buffers ever touched', () => {
  let accessed = false;
  const view = {
    activeTriangleCount: 13000,
    get ranges() { accessed = true; return []; },
    get index() { accessed = true; return null; },
    get positions() { accessed = true; return null; },
    positionStride: 3, positionOffset: 0,
  };
  const result = compactAndWeld(view);
  assert.equal(result.oversized, true);
  assert.equal(result.reason, 'geometry-too-large-for-sync-build');
  assert.equal(result.activeTriangleCount, 13000);
  assert.equal(accessed, false, 'oversized geometry must never have its buffers touched (checked BEFORE any copying)');
});

test('activeTriangleCount = 11,000 (33,000 index elements): must be built', () => {
  const result = compactAndWeld(buildIsolatedTriangleView(11000));
  assert.equal('oversized' in result, false);
  assert.equal(result.triangleCount, 11000);
});

test('activeTriangleCount = exactly 12,000 (36,000 index elements): built, not skipped (strict >, not >=)', () => {
  const result = compactAndWeld(buildIsolatedTriangleView(12000));
  assert.equal('oversized' in result, false, 'ceiling is a strict >; an exact match must still build');
  assert.equal(result.triangleCount, 12000);
});

test('huge raw index, tiny active ranges: builds only the active subset, never the whole raw buffer', () => {
  const totalTriangles = 20000; // far more than maxSyncTriangleCount if counted raw
  const positions = new Float32Array(totalTriangles * 3 * 3);
  const rawIndex = new Uint32Array(totalTriangles * 3);
  for (let i = 0; i < rawIndex.length; i++) rawIndex[i] = i;
  for (let t = 0; t < totalTriangles; t++) {
    const v = t * 3;
    positions.set([v, 0, 0, v + 1, 0, 0, v, 1, 0], v * 3);
  }
  const view = {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index: rawIndex,
    ranges: [{ start: 0, count: 9 }], activeTriangleCount: 3, // active range: only 3 triangles
  };
  const result = compactAndWeld(view);
  assert.equal('oversized' in result, false, 'must NOT be skipped -- the active range is tiny');
  assert.equal(result.triangleCount, 3);
  assert.ok(result.position.length <= 9 * 3, 'compacted buffer must not include inactive triangles');
});

test('box (24 raw vertices / 8 corners): welds to 8 vertices, 12 triangles', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const view = adaptViewerGeometry({
    attributes: { position: { array: box.attributes.position.array, itemSize: 3 } },
    index: { array: box.index.array },
  });
  assert.equal(view.activeTriangleCount, 12);
  const result = compactAndWeld(view);
  assert.equal(result.triangleCount, 12);
  assert.equal(result.position.length / 3, 8, 'welding must merge the 24 raw vertices down to the 8 real corners');
});

test('weld epsilon derived from unit scale: mm-authored and m-authored geometry weld to the same vertex count', () => {
  // Build meshes with intentional seams. The key: NO shared vertex indices between triangles.
  // Only v0 (from triangle A) and v3 (from triangle B) are near each other at controlled distance.
  // All other vertex pairs are far apart (>= 1 unit, well outside any epsilon).
  // Test asserts on raw vertex count (result.position.length / 3), not component connectivity,
  // because a single-vertex merge won't show up in edge-based component counting.
  // With CORRECT epsilon scaling, both models merge v0/v3 → 5 vertices.
  // With BROKEN epsilon (unit-blind), mm model doesn't merge → 6 vertices.

  function buildSeamPair(seamGap) {
    // Two triangles, 6 independent vertex ids, no shared indices.
    // Only v0 and v3 are near each other at distance seamGap.
    // Key: Small geometry bounds (~0.2) so that mergeVertices' relative epsilon
    // threshold makes the seam distance significant enough to merge only when
    // epsilon is correctly scaled (not when unit-blind).
    const positions = new Float32Array([
      0, 0, 0,           // v0 (triangle A, corner 0)
      0.1, 0, 0,         // v1 (triangle A, corner 1)
      0, 0.1, 0,         // v2 (triangle A, corner 2)
      seamGap, 0, 0,     // v3 (triangle B, corner 0) -- near v0 only
      0.2, 0.1, 0,       // v4 (triangle B, corner 1) -- far from everything
      0.2, -0.1, 0,      // v5 (triangle B, corner 2) -- far from everything
    ]);
    const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
    return {
      unsupported: false, positions, positionStride: 3, positionOffset: 0, index,
      ranges: [{ start: 0, count: index.length }], activeTriangleCount: 2,
    };
  }

  // Meters: seamGap = 5e-5 m, getUnitScale() = 1 → weldEpsilon = 1e-4 m
  // Geometry bounds ~0.2 m; with correctly scaled epsilon (1e-4), seam merges
  // v0/v3 distance = 5e-5 < epsilon → merge → 5 vertices
  const viewMeters = buildSeamPair(5e-5);
  const resultMeters = compactAndWeld(viewMeters, { getUnitScale: () => 1 });
  const vertexCountMeters = resultMeters.position.length / 3;

  // Millimeters: seamGap = 0.05 mm, getUnitScale() = 0.001 → weldEpsilon = 1e-4 / 0.001 = 0.1 mm
  // Geometry bounds ~200 mm; with correctly scaled epsilon (0.1 mm), seam merges
  // v0/v3 distance = 0.05 < epsilon → merge → 5 vertices
  // CRITICAL: if epsilon were unit-blind (always 1e-4 mm), distance 0.05 > 1e-4 → no merge → 6 vertices
  const viewMillimeters = buildSeamPair(0.05);
  const resultMillimeters = compactAndWeld(viewMillimeters, { getUnitScale: () => 0.001 });
  const vertexCountMillimeters = resultMillimeters.position.length / 3;

  // With correct epsilon scaling, both should be 5 (v0 and v3 merged).
  // A broken (unit-blind) implementation would give meters=5, millimeters=6.
  assert.equal(vertexCountMeters, 5, 'meters case: v0/v3 merge → 5 vertices');
  assert.equal(vertexCountMillimeters, 5, 'millimeters case: v0/v3 merge with scaled epsilon → 5 vertices');
  assert.equal(vertexCountMeters, vertexCountMillimeters,
    'unit-scale-aware epsilon: same vertex count across scales proves epsilon was scaled correctly');
});

test('explicit weldEpsilon option overrides getUnitScale derivation', () => {
  // Verify that options.weldEpsilon is honored and bypasses getUnitScale derivation.
  // Build a mesh with controlled seams that respond to epsilon values.
  const seamDistance = 5e-5; // 5e-5 m seam
  const positions = new Float32Array(6 * 3);
  // Triangle 1
  positions.set([0, 0, 0], 0 * 3);                          // v0
  positions.set([1, 0, 0], 1 * 3);                          // v1
  positions.set([0, 1, 0], 2 * 3);                          // v2
  // Triangle 2 (connected only via seam from v0)
  positions.set([seamDistance, 0, 0], 3 * 3);               // v3 (seam: 5e-5m from v0)
  positions.set([seamDistance + 1, 0, 0], 4 * 3);           // v4
  positions.set([seamDistance, 1, 0], 5 * 3);               // v5

  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);

  const view = {
    unsupported: false,
    positions,
    positionStride: 3,
    positionOffset: 0,
    index,
    ranges: [{ start: 0, count: 6 }],
    activeTriangleCount: 2,
  };

  // With explicit weldEpsilon = 1e-4 (larger than 5e-5 seam)
  const resultWithExplicitEpsilon = compactAndWeld(view, { weldEpsilon: 1e-4 });
  assert.ok(resultWithExplicitEpsilon.position instanceof Float32Array, 'explicit weldEpsilon option is honored (result has position array)');
  assert.equal(resultWithExplicitEpsilon.triangleCount, 2, 'explicit weldEpsilon produces valid output');

  // Verify explicit epsilon bypasses getUnitScale: with weldEpsilon specified, getUnitScale is ignored
  const resultIgnoringGetUnitScale = compactAndWeld(view, {
    weldEpsilon: 1e-4,
    getUnitScale: () => { throw new Error('should not be called'); }
  });
  assert.ok(resultIgnoringGetUnitScale.position instanceof Float32Array, 'explicit weldEpsilon bypasses getUnitScale entirely');
});

test('missing getUnitScale falls back to the literal 1e-4 default (does not throw, still welds)', () => {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const view = adaptViewerGeometry({
    attributes: { position: { array: box.attributes.position.array, itemSize: 3 } },
    index: { array: box.index.array },
  });
  const result = compactAndWeld(view); // no options at all
  assert.equal(result.position.length / 3, 8);
});

// Finding 1: mergeVertices can itself produce a degenerate (repeated-vertex) triangle
// when two of a triangle's three vertices weld together under the weld epsilon. The
// filter must drop that triangle from the returned index/triangleCount.
test('Finding 1: triangle that becomes degenerate after welding is filtered out', () => {
  // Triangle A: v0, v1, v2 -- v0 and v1 are within weld epsilon of each other, so
  // after welding this triangle collapses to a repeated-vertex (degenerate) triangle.
  // Triangle B: a normal, well-separated triangle that must survive untouched.
  const weldEps = 1e-6;
  const positions = new Float32Array([
    0, 0, 0,               // v0 (triangle A)
    weldEps / 10, 0, 0,    // v1 (triangle A) -- within weldEps of v0, welds to it
    0, 1, 0,               // v2 (triangle A)
    10, 0, 0,              // v3 (triangle B)
    11, 0, 0,              // v4 (triangle B)
    10, 1, 0,              // v5 (triangle B)
  ]);
  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
  const view = {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index,
    ranges: [{ start: 0, count: index.length }], activeTriangleCount: 2,
  };

  const result = compactAndWeld(view, { weldEpsilon: weldEps });
  assert.equal('oversized' in result, false);
  // Triangle A collapsed to 2 distinct vertices post-weld (degenerate) and must be
  // dropped; only triangle B survives.
  assert.equal(result.triangleCount, 1, 'the post-weld degenerate triangle must be filtered out');
  for (let t = 0; t < result.triangleCount; t++) {
    const a = result.index[t * 3], b = result.index[t * 3 + 1], c = result.index[t * 3 + 2];
    assert.notEqual(a, b);
    assert.notEqual(b, c);
    assert.notEqual(a, c);
  }
});

// Finding 3: an index value that references past the actual vertex count must be
// rejected with a diagnostic, not silently welded into an unrelated real vertex.
test('Finding 3: out-of-range index value is rejected with a diagnostic, not silently corrupted', () => {
  const positions = new Float32Array([
    0, 0, 0,  // v0
    1, 0, 0,  // v1
    0, 1, 0,  // v2
  ]);
  const index = new Uint32Array([0, 1, 99]); // vertex 99 does not exist (only 0,1,2)
  const view = {
    unsupported: false, positions, positionStride: 3, positionOffset: 0, index,
    ranges: [{ start: 0, count: index.length }], activeTriangleCount: 1,
  };

  const result = compactAndWeld(view);
  assert.equal(result.oversized, true, 'out-of-range index must be rejected, not silently welded');
  assert.equal(result.reason, 'index-references-invalid-vertex');
});

// Finding 5: options.weldEpsilon is a programmer-facing override; an invalid value
// must be rejected rather than silently corrupting the geometry.
test('Finding 5: options.weldEpsilon NaN is rejected', () => {
  const view = buildIsolatedTriangleView(1);
  assert.throws(() => compactAndWeld(view, { weldEpsilon: NaN }), TypeError);
});

test('Finding 5: options.weldEpsilon Infinity is rejected', () => {
  const view = buildIsolatedTriangleView(1);
  assert.throws(() => compactAndWeld(view, { weldEpsilon: Infinity }), TypeError);
});

test('Finding 5: options.weldEpsilon negative is rejected', () => {
  const view = buildIsolatedTriangleView(1);
  assert.throws(() => compactAndWeld(view, { weldEpsilon: -1 }), TypeError);
});
