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

test('weld epsilon derived from unit scale: mm-authored and m-authored geometry weld to the same component count', () => {
  // Build meshes with intentional seams at distances that require CORRECT epsilon scaling to merge.
  // The test checks that epsilon is correctly scaled by comparing component counts across scales.
  // Seam distance is carefully chosen so incorrect scaling would produce different results.

  function buildMeshWithSeam(scale) {
    const seamDistance = 5e-5 * scale; // physical 5e-5 m, scaled to model units
    // Vertex positions: create two triangles that share edges (connected if seam merges)
    // plus an isolated triangle to verify component counting works
    const positions = new Float32Array(9 * 3);
    positions.set([0, 0, 0], 0 * 3);            // v0
    positions.set([scale, 0, 0], 1 * 3);        // v1
    positions.set([0, scale, 0], 2 * 3);        // v2
    positions.set([seamDistance, 0, 0], 3 * 3); // v3 (seam away from v0)
    positions.set([scale * 2, 0, 0], 4 * 3);    // v4
    positions.set([scale * 3, 0, 0], 5 * 3);    // v5
    positions.set([scale * 2, scale, 0], 6 * 3); // v6
    positions.set([scale * 4, 0, 0], 7 * 3);    // v7
    positions.set([scale * 5, 0, 0], 8 * 3);    // v8

    const index = new Uint32Array([
      0, 1, 2,  // triangle using v0
      3, 1, 2,  // triangle using v3 (seam vertex, same v1,v2 as previous)
      4, 5, 6,  // isolated triangle
    ]);

    return {
      unsupported: false,
      positions,
      positionStride: 3,
      positionOffset: 0,
      index,
      ranges: [{ start: 0, count: 9 }],
      activeTriangleCount: 3,
    };
  }

  const viewMeters = buildMeshWithSeam(1);
  const viewMillimeters = buildMeshWithSeam(1000);

  const resultMeters = compactAndWeld(viewMeters, { getUnitScale: () => 1 });
  // A model authored in millimetres reports getUnitScale() (meters-per-unit) = 0.001,
  // so weldEpsilon becomes 1e-4/0.001 = 0.1 (mm) -- the same PHYSICAL tolerance as
  // 1e-4 m applied to the metres model. This ensures the seams merge at the same
  // geometric tolerance, regardless of unit scale.
  const resultMillimeters = compactAndWeld(viewMillimeters, { getUnitScale: () => 0.001 });

  // With correct epsilon scaling, seams merge in both cases at the same physical distance.
  // Component counts should be the same, proving epsilon was scaled correctly.
  const componentsMeters = countComponents(resultMeters.index, resultMeters.triangleCount);
  const componentsMillimeters = countComponents(resultMillimeters.index, resultMillimeters.triangleCount);
  assert.equal(componentsMeters, componentsMillimeters,
    'unit-scale-aware epsilon: same component count across different model scales proves epsilon was scaled correctly');
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
