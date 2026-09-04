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
import { maxLocalAspectRatio } from '../constants.js';

/**
 * @param {{ position: Float32Array, index: Uint32Array, triangleCount: number }} weldedGeometry
 *   Exactly the resolved shape of GeometryRecord.weldPromise.
 * @returns {{ bvh: import('three-mesh-bvh').MeshBVH, localDiagonal: number, aspectRatio: number,
 *   aspectRatioExceeded: boolean }} `aspectRatio`/`aspectRatioExceeded` are the M1 single-geometry
 *   aspect-ratio disposition guard (spec Tolerances section) -- this module only COMPUTES and
 *   surfaces the signal (stays stateless/non-gating per its own objective above); it does NOT itself
 *   reject anything, and neither should Task 14's GeometryRegistry/BlasCache orchestration, which
 *   builds this for every query mode including surface-intersection (which never calls
 *   classifyPoint and is unaffected by this limitation). The caller that uses this geometry as a
 *   classifyPoint TARGET -- ContainmentQuery.anyComponentInside (Task 9) / ContainmentModeQuery
 *   (Task 12) -- is responsible for checking `aspectRatioExceeded` and, if true, skipping
 *   classifyPoint for that target and emitting a
 *   `geometry-aspect-ratio-exceeds-tolerance-model` diagnostic instead of trusting a classification
 *   this tolerance model cannot make correctly at that aspect ratio.
 */
export function build(weldedGeometry) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(weldedGeometry.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(weldedGeometry.index, 1));

  // CONTRACT for any future caller that traverses this BVH (bvhcast, intersectsTriangles,
  // or any similar callback-based traversal): `indirect: true` means MeshBVH internally
  // reorders triangles into its own BVH-layout order and callback indices are reported
  // in THAT layout, NOT as original triangle ordinals into weldedGeometry.index. Naively
  // using a raw callback index to index into per-original-triangle-ordinal data (e.g.
  // GeometryConnectivity's componentOf) will silently misattribute triangles to the
  // wrong connectivity component once the BVH's internal partitioning reorders leaves.
  // Any such caller MUST first resolve the BVH-layout index back to the original
  // triangle ordinal via `bvh.resolveTriangleIndex(bvhLayoutIndex)` (confirmed against
  // the vendored three-mesh-bvh source, node_modules/three-mesh-bvh/src/core/MeshBVH.js)
  // before using it to index componentOf or any other per-original-triangle-ordinal
  // array. This module builds the BVH but performs no traversal itself -- no
  // bvhcast-consuming logic is implemented here.
  const bvh = new MeshBVH(geometry, { indirect: true });

  // L_X := diagonal(localBounds(X)), computed once in X's own local space, over the
  // SAME buffer the BLAS is built from (spec:1609-1614) -- ported from
  // spike/geometry-core.mjs's scaleOf.
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const localDiagonal = size.length();

  // M1 aspect-ratio disposition guard (spec Tolerances section, "Single-geometry aspect ratio"):
  // max/min local AABB extent. A zero minExtent (a mathematically flat/2D mesh) has no well-defined
  // ratio -- treated as exceeded (Infinity), conservatively flagging it for the same caller-side
  // disposition rather than silently computing a meaningless ratio.
  const extents = [size.x, size.y, size.z];
  const maxExtent = Math.max(...extents);
  const minExtent = Math.min(...extents);
  const aspectRatio = minExtent > 0 ? maxExtent / minExtent : Infinity;
  const aspectRatioExceeded = aspectRatio > maxLocalAspectRatio;

  return { bvh, localDiagonal, aspectRatio, aspectRatioExceeded };
}
