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
  // Create geometry with asymmetric layout so original index order is unambiguous.
  // Use a tetrahedron (4 vertices, 4 triangles) with vertices at distinct positions.
  const weldedGeometry = {
    position: new Float32Array([
      0, 0, 0,       // v0: origin
      1, 0, 0,       // v1: +x
      0, 1, 0,       // v2: +y
      0, 0, 1,       // v3: +z
    ]),
    index: new Uint32Array([
      0, 1, 2,       // triangle 0: (v0, v1, v2)
      0, 2, 3,       // triangle 1: (v0, v2, v3)
      0, 3, 1,       // triangle 2: (v0, v3, v1)
      1, 2, 3,       // triangle 3: (v1, v2, v3)
    ]),
    triangleCount: 4,
  };

  const originalIndexArray = weldedGeometry.index;
  const { bvh } = build(weldedGeometry);

  // Get the index array from the BVH's geometry and verify it matches original order.
  const resultingIndexArray = bvh.geometry.getIndex().array;
  assert.deepEqual(
    Array.from(resultingIndexArray),
    Array.from(originalIndexArray),
    'BVH must preserve original triangle ordinal via indirect: true; index buffer reordering would break GeometryConnectivity alignment'
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
