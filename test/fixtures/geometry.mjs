// test/fixtures/geometry.mjs
//
// Shared geometry-building helpers for collision-library unit tests. Ported from
// spike/fixtures.mjs and spike/geometry-core.mjs's normalizeForCollision()/instance(),
// but delegates BVH construction to the real ThreeMeshBvhBackend (Task 4/5) instead of
// calling `new MeshBVH()` directly, so tests exercise the same construction path
// production code uses.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { build as buildBvh } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { computeGeometryConnectivity } from '../../collision/geometry/GeometryConnectivity.js';

export { THREE };

export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export function at(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

export function mergeGeometries(geoms) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g of geoms) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    const p = g.attributes.position.array;
    positions.push(...p);
    for (const i of gi) indices.push(i + offset);
    offset += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}

// A cube missing its bottom face: 10 triangles, already welded (shared indices), 1
// component, exactly 4 boundary edges. The acceptance-model bathtub in miniature.
export function openBottomedBox(size) {
  const h = size / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -h, -h, -h,   h, -h, -h,   h, -h, h,   -h, -h, h,   // 0..3 bottom ring
    -h,  h, -h,   h,  h, -h,   h,  h, h,   -h,  h, h,   // 4..7 top ring
  ], 3));
  g.setIndex([
    4, 5, 6,  4, 6, 7,   // top
    3, 2, 6,  3, 6, 7,   // +z
    1, 0, 4,  1, 4, 5,   // -z
    2, 1, 5,  2, 5, 6,   // +x
    0, 3, 7,  0, 7, 4,   // -x
                         // bottom deliberately omitted
  ]);
  return g;
}

// Interleaved teeth: heavy BVH-leaf overlap, zero triangle intersections. Shared input
// for every "budget exhaustion with no real intersections" fixture across this group.
export function comb(offset, teeth = 60) {
  const parts = [];
  for (let i = 0; i < teeth; i++) {
    parts.push(new THREE.BoxGeometry(0.02, 4, 0.02).translate(i * 0.1 + offset, 0, 0));
  }
  return mergeGeometries(parts);
}

// Strip to position+index BEFORE welding (mergeVertices compares all attributes;
// per-face normals/uvs would make every vertex unique otherwise, docs/...:1757-1761).
export function weld(geometry) {
  const positionOnly = new THREE.BufferGeometry();
  positionOnly.setAttribute('position', geometry.attributes.position.clone());
  if (geometry.index) {
    positionOnly.setIndex(geometry.index.clone());
  } else {
    positionOnly.setIndex([...Array(geometry.attributes.position.count).keys()]);
  }
  return mergeVertices(positionOnly, 1e-4);
}

// ThreeMeshBvhBackend.build() takes raw {position, index, triangleCount} arrays, not a
// THREE.BufferGeometry -- convert a welded buffer into that shape (established pattern,
// see test/query/ContainmentQuery.classifyPoint.test.mjs's weldedFromRaw()).
function weldedFromRaw(geometry) {
  const index = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from([...Array(geometry.attributes.position.count).keys()]);
  return { position: geometry.attributes.position.array, index, triangleCount: index.length / 3 };
}

// Full test instance: welded geometry + real backend-built BVH + connectivity + matrix.
export function testInstance(geometry, matrix = new THREE.Matrix4()) {
  const welded = weld(geometry);
  const raw = weldedFromRaw(welded);
  const { bvh, geometry: builtGeometry, localDiagonal, aspectRatio, aspectRatioExceeded, geometryDigest } = buildBvh(raw);
  const connectivity = computeGeometryConnectivity(raw);
  return {
    geometry: builtGeometry, bvh, localDiagonal, connectivity,
    closedManifold: connectivity.closedManifold.every(Boolean) && connectivity.componentCount > 0,
    matrix, aspectRatio, aspectRatioExceeded, geometryDigest,
  };
}
