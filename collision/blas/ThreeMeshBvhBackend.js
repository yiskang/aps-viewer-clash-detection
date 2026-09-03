// collision/blas/ThreeMeshBvhBackend.js
//
// Stateless builder: one MeshBVH per welded geometry, built fresh every call. Caching
// (BlasCache, Task 14) is a LATER, separate module that wraps this behind the
// registry's single-flight accelerationPromise slot -- this module owns none of that:
// no memoization, no promise, no registry awareness (spec:1543-1568: "dedup of
// simultaneous BVH builds is not a BlasCache-owned mechanism -- it's the registry-
// level rule").
//
// Builds over the collision-owned, compacted-then-welded buffer ONLY (never raw
// Viewer geometry) -- L_X (the per-BVH tolerance scale) is computed over that same
// buffer (spec:1609-1614), so a caller must never hand this a pre-weld buffer.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * @param {{ position: Float32Array, index: Uint32Array, triangleCount: number }} weldedGeometry
 *   Exactly the resolved shape of GeometryRecord.weldPromise.
 * @returns {{ bvh: import('three-mesh-bvh').MeshBVH, localDiagonal: number }}
 */
export function build(weldedGeometry) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(weldedGeometry.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(weldedGeometry.index, 1));

  const bvh = new MeshBVH(geometry);

  // L_X := diagonal(localBounds(X)), computed once in X's own local space, over the
  // SAME buffer the BLAS is built from (spec:1609-1614) -- ported from
  // spike/geometry-core.mjs's scaleOf.
  geometry.computeBoundingBox();
  const localDiagonal = geometry.boundingBox.getSize(new THREE.Vector3()).length();

  return { bvh, localDiagonal };
}
