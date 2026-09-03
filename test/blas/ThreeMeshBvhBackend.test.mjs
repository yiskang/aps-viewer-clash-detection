import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';

function rawBoxWelded(size) {
  const box = new THREE.BoxGeometry(size, size, size);
  return {
    position: box.attributes.position.array,
    index: Uint32Array.from(box.index.array),
    triangleCount: box.index.count / 3,
  };
}

test('build: box localDiagonal matches hand-computed diagonal(localBounds)', () => {
  const welded = rawBoxWelded(2); // 2x2x2 box centered at origin: bounds [-1,1]^3
  const { bvh, localDiagonal } = build(welded);
  assert.ok(bvh instanceof MeshBVH);
  const expectedDiagonal = Math.sqrt(2 * 2 + 2 * 2 + 2 * 2); // side 2 cube -> diagonal 2*sqrt(3)
  assert.ok(Math.abs(localDiagonal - expectedDiagonal) < 1e-6, `expected ${expectedDiagonal}, got ${localDiagonal}`);
});

test('build: sphere localDiagonal matches hand-computed diagonal', () => {
  const sphere = new THREE.SphereGeometry(1, 8, 8); // radius 1 -> bounds ~[-1,1]^3
  const welded = {
    position: sphere.attributes.position.array,
    index: Uint32Array.from(sphere.index.array),
    triangleCount: sphere.index.count / 3,
  };
  const { localDiagonal } = build(welded);
  const box3 = new THREE.Box3().setFromBufferAttribute(sphere.attributes.position);
  const expected = box3.getSize(new THREE.Vector3()).length();
  assert.ok(Math.abs(localDiagonal - expected) < 1e-6);
});

test('build: resulting BVH supports closestPointToPoint/raycast/bvhcast (smoke test only)', () => {
  const welded = rawBoxWelded(1);
  const { bvh } = build(welded);

  const hit = bvh.closestPointToPoint(new THREE.Vector3(0, 0, 0));
  assert.ok(hit && typeof hit.distance === 'number');

  const ray = new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0.3178, 0.1234).normalize());
  const raycastHits = bvh.raycast(ray, THREE.DoubleSide);
  assert.ok(Array.isArray(raycastHits) && raycastHits.length > 0);

  const otherBvh = build(rawBoxWelded(1)).bvh;
  let candidateSeen = false;
  bvh.bvhcast(otherBvh, new THREE.Matrix4().makeTranslation(0.5, 0, 0), {
    intersectsTriangles() { candidateSeen = true; return false; },
  });
  assert.equal(candidateSeen, true, 'bvhcast must invoke the callback for overlapping leaves');
});

test('build: is stateless -- two calls over equivalent input produce independent BVH instances', () => {
  const a = build(rawBoxWelded(1));
  const b = build(rawBoxWelded(1));
  assert.notEqual(a.bvh, b.bvh, 'no caching/memoization belongs in this module');
});

test('build: preserves original triangle index ordering (no reordering by MeshBVH)', () => {
  // Use rawBoxWelded(1): 12 triangles, sufficient to trigger MeshBVH's index partitioning logic
  // (targetLeafSize default is 10; with only 4 triangles, no partitioning occurs and index
  // would not reorder even without indirect: true, making the test blind to the bug).
  const welded = rawBoxWelded(1);
  const originalIndexArray = welded.index;
  const { bvh } = build(welded);

  // Direct verification: { indirect: true } option is set on the BVH.
  // This is version-resilient and doesn't depend on MeshBVH's internal partitioning heuristics.
  assert.equal(bvh.indirect, true, 'MeshBVH must be created with indirect: true option');

  // Element-for-element verification: the resulting index array is not reordered.
  // MeshBVH with indirect: true preserves the original index buffer; without it, 12 triangles
  // exceed targetLeafSize and trigger partitioning that reorders indices in place.
  const resultingIndexArray = bvh.geometry.getIndex().array;
  assert.deepEqual(
    Array.from(resultingIndexArray),
    Array.from(originalIndexArray),
    'BVH must preserve original triangle ordinal; reordering would break GeometryConnectivity.componentOf alignment'
  );
});

test('build: statelessness extends to identity-keyed caching -- same input object produces independent BVHs', () => {
  // Call build() twice with the EXACT SAME weldedGeometry object reference (not just equal-content).
  // This tests that there is no identity-keyed cache (e.g., WeakMap<weldedGeometry, {bvh, localDiagonal}>).
  const sharedWelded = rawBoxWelded(1);
  const a = build(sharedWelded);
  const b = build(sharedWelded); // Same object reference as above
  assert.notEqual(a.bvh, b.bvh, 'no identity-keyed caching (e.g., WeakMap) belongs in this module');
  assert.notEqual(a.bvh.geometry, b.bvh.geometry, 'geometries must be independent even if input object is reused');
});
