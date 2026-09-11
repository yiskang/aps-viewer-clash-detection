import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';

function rawBoxWelded(w, h = w, d = w) {
  const box = new THREE.BoxGeometry(w, h, d);
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

function weldedFromBox(w, h, d) {
  const box = new THREE.BoxGeometry(w, h, d);
  return {
    position: box.attributes.position.array,
    index: Uint32Array.from(box.index.array),
    triangleCount: box.index.count / 3,
  };
}

test('build: M1 aspect-ratio disposition guard -- realistic BIM-scale target (max/min extent = 1000:1) is NOT exceeded', () => {
  // Same envelope as ContainmentQuery.classifyPoint.test.mjs's "representative BIM aspect ratio"
  // fixture (a long thin duct/wall segment): 0.01m x 10m x 0.5m -- max/min = 10/0.01 = exactly 1000.
  const { aspectRatio, aspectRatioExceeded } = build(weldedFromBox(0.01, 10, 0.5));
  assert.ok(Math.abs(aspectRatio - 1000) < 1, `expected aspectRatio ~1000, got ${aspectRatio}`);
  assert.equal(aspectRatioExceeded, false);
});

test('build: M1 aspect-ratio disposition guard -- extreme target (the KNOWN GAP fixture) IS exceeded, at its ACTUAL ratio', () => {
  // Exact box dimensions from ContainmentQuery.classifyPoint.test.mjs's `{ todo: true }` KNOWN GAP
  // fixture: box(0.5, 1_000_000, 1_000_000) -- max/min = 1_000_000/0.5 = exactly 2,000,000, NOT the
  // ~1,000,000 the box's own dimensions might suggest by eye (codex-advisor caught this discrepancy
  // during the disposition-note consistency check). This test only asserts the GUARD fires at the
  // correct computed ratio -- it makes no claim about classifyPoint's own (still incorrect, still out
  // of scope) classification at this aspect ratio.
  const { aspectRatio, aspectRatioExceeded } = build(weldedFromBox(0.5, 1_000_000, 1_000_000));
  assert.ok(Math.abs(aspectRatio - 2_000_000) < 1, `expected aspectRatio ~2,000,000, got ${aspectRatio}`);
  assert.equal(aspectRatioExceeded, true);
});

test('build: M1 aspect-ratio disposition guard -- boundary: exactly maxLocalAspectRatio (10,000:1) is NOT exceeded (strict >)', () => {
  // box(1, 10_000, 1) -> max/min = 10_000/1 = exactly 10_000, the threshold itself.
  // aspectRatioExceeded uses strict `>`, so exactly-at-threshold must NOT be exceeded.
  const { aspectRatio, aspectRatioExceeded } = build(weldedFromBox(1, 10_000, 1));
  assert.ok(Math.abs(aspectRatio - 10_000) < 1, `expected aspectRatio ~10,000, got ${aspectRatio}`);
  assert.equal(aspectRatioExceeded, false);
});

test('build: M1 aspect-ratio disposition guard -- boundary: just past maxLocalAspectRatio (10,001:1) IS exceeded', () => {
  const { aspectRatio, aspectRatioExceeded } = build(weldedFromBox(1, 10_001, 1));
  assert.ok(Math.abs(aspectRatio - 10_001) < 1, `expected aspectRatio ~10,001, got ${aspectRatio}`);
  assert.equal(aspectRatioExceeded, true);
});

test('build() returns a 32-hex-char geometryDigest', () => {
  const geo = rawBoxWelded(1, 1, 1); // reuse the file's own existing fixture helper, adapt args to
                                       // its real signature
  const result = build(geo);
  assert.equal(typeof result.geometryDigest, 'string');
  assert.match(result.geometryDigest, /^[0-9a-f]{32}$/);
});

test('build() geometryDigest is identical for byte-identical geometry across two calls', () => {
  const geoA = rawBoxWelded(2, 3, 4);
  const geoB = rawBoxWelded(2, 3, 4);
  const a = build(geoA);
  const b = build(geoB);
  assert.equal(a.geometryDigest, b.geometryDigest);
});

test('build() geometryDigest differs for geometrically distinct meshes', () => {
  const a = build(rawBoxWelded(2, 3, 4));
  const b = build(rawBoxWelded(2, 3, 5));
  assert.notEqual(a.geometryDigest, b.geometryDigest);
});

test('build() geometryDigest ignores vertex/index count coincidence via the header', () => {
  // Two geometries with the same vertexCount/triangleCount but different bytes must not collide.
  // Build this fixture inline here (do not invent a new shared helper): take rawBoxWelded(1,1,1)'s
  // position array, clone it, and perturb one coordinate by a value large enough to move the digest
  // while keeping vertexCount/triangleCount identical -- e.g. add 1.0 to position[0].
  const geoA = rawBoxWelded(1, 1, 1);
  const geoB = rawBoxWelded(1, 1, 1);
  geoB.position[0] += 1.0;
  const a = build(geoA);
  const b = build(geoB);
  assert.notEqual(a.geometryDigest, b.geometryDigest);
});
