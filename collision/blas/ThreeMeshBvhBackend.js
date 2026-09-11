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
import { computeContentDigest } from '../geometry/contentDigest.js';

/**
 * Dependency-free 128-bit content digest of a welded geometry's own bytes (vertex/triangle count
 * header + position + index buffers). Computed once per `build()` call -- `build()` is already the
 * once-per-geometry-per-epoch hook, so no separate caching layer belongs here; the caching
 * *lifecycle* comes from the caller (GeometryRegistry) only calling `build()` once per geometry per
 * epoch. See design doc §4.3 C-1 rank 5: this is what later tasks use as the reload-stable geometric
 * tiebreaker in place of `geometryIndex`.
 * @param {{ position: Float32Array, index: Uint32Array, triangleCount: number }} weldedGeometry
 * @returns {string} 32 lowercase hex characters (128 bits)
 */
function computeGeometryDigest(weldedGeometry) {
  const positionArray = weldedGeometry.position; // bare Float32Array -- see this task's Interfaces note
  const indexArray = weldedGeometry.index;       // bare Uint32Array/Uint16Array, same note
  const vertexCount = positionArray.length / 3;
  const triangleCount = weldedGeometry.triangleCount ?? (indexArray.length / 3);

  const header = new DataView(new ArrayBuffer(8));
  header.setUint32(0, vertexCount >>> 0, true);
  header.setUint32(4, triangleCount >>> 0, true);

  const headerBytes = new Uint8Array(header.buffer);
  const positionBytes = new Uint8Array(positionArray.buffer, positionArray.byteOffset, positionArray.byteLength);
  const indexBytes = new Uint8Array(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength);

  return computeContentDigest([headerBytes, positionBytes, indexBytes]);
}

/**
 * @param {{ position: Float32Array, index: Uint32Array, triangleCount: number }} weldedGeometry
 *   Exactly the resolved shape of GeometryRecord.weldPromise.
 * @returns {{ bvh: import('three-mesh-bvh').MeshBVH, localDiagonal: number, aspectRatio: number,
 *   aspectRatioExceeded: boolean, geometry: import('three').BufferGeometry, geometryDigest: string }}
 *   `geometry` is the welded, collision-owned BufferGeometry this BVH was built over (the one
 *   `ContainmentQuery.anyComponentInside` samples vertices from).
 *   `aspectRatio`/`aspectRatioExceeded` are the M1 single-geometry
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
 *   `geometryDigest` is a 32-hex-char (128-bit) dependency-free content digest of the welded
 *   position/index buffers (design doc §4.3 C-1 rank 5) -- see `computeGeometryDigest` above.
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
  geometry.boundsTree = bvh; // M3: required for closestPointToGeometry's target-side acceleration —
                             // the one canonical BLAS construction point; never attach a second tree.

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

  const geometryDigest = computeGeometryDigest(weldedGeometry);

  // `geometry` is returned, not merely used locally: ContainmentQuery.anyComponentInside reads the
  // WELDED geometry directly (`sourceGeometry.index.array` / `.attributes.position`), so
  // `containment` / `volume-overlap` need it on the resolved GeometryRegistry record. It costs
  // nothing to surface -- `bvh` already holds a hard reference to this exact object -- and
  // GeometryRegistry._awaitEntry spreads this whole return value, so no change is needed there or
  // in BlasCache (batch4 reconciliation note item 6).
  return { bvh, localDiagonal, aspectRatio, aspectRatioExceeded, geometry, geometryDigest };
}
