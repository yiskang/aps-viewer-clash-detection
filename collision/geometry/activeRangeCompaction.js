// collision/geometry/activeRangeCompaction.js
//
// Round 16 fix for the maxSyncTriangleCount scope bug (spec:1500-1541): the ceiling
// must be checked against the ACTIVE range's triangle count, computed and gated
// BEFORE any copying happens -- never against a fragment's raw (possibly huge) index
// buffer. This is the "one more phase before weld/connectivity/BVH" the spec adds:
// active-range compaction, then welding, over a collision-owned buffer containing
// ONLY the triangles the adapter's ranges cover.
//
// Consumes the `unsupported: false` output of
// collision/viewer/ViewerGeometryAdapter.js#adaptViewerGeometry. Produces either the
// welded { position, index, triangleCount } buffer GeometryRegistry's weldPromise slot
// resolves to (Task 14), or an OversizedMarker.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { maxSyncTriangleCount as defaultMaxSyncTriangleCount, weldEpsilonMeters } from '../constants.js';

function collectActiveTriangleVertexIds(view) {
  // Only whole triangles from each range (spec:1164, 1523 floor(count/3)), and ONLY
  // the vertices those triangles actually reference -- this is what keeps the
  // compacted buffer bounded by activeTriangleCount rather than the (possibly
  // enormous) raw index/position buffer.
  const { index, ranges } = view;
  const triangleVertexIds = []; // flat, 3 per triangle, in ORIGINAL vertex-id space

  for (const range of ranges) {
    const flooredCount = Math.floor(range.count / 3) * 3;
    for (let i = 0; i < flooredCount; i++) {
      const streamPos = range.start + i;
      // Indexed: the stream is the index array itself. Non-indexed: the adapter's
      // range.count/start are already in VERTEX units (spec:1164 "same factor for
      // non-indexed fallback in position elements"), so the vertex id IS the stream position.
      triangleVertexIds.push(index ? index[streamPos] : streamPos);
    }
  }
  return triangleVertexIds;
}

function buildCompactBuffers(view, triangleVertexIds) {
  const { positions, positionStride, positionOffset } = view;
  const remap = new Map(); // original vertex id -> compact vertex id
  const compactPositions = [];
  const compactIndex = new Uint32Array(triangleVertexIds.length);

  for (let i = 0; i < triangleVertexIds.length; i++) {
    const originalId = triangleVertexIds[i];
    let compactId = remap.get(originalId);
    if (compactId === undefined) {
      compactId = remap.size;
      remap.set(originalId, compactId);
      const base = originalId * positionStride + positionOffset;
      compactPositions.push(positions[base], positions[base + 1], positions[base + 2]);
    }
    compactIndex[i] = compactId;
  }

  return { position: new Float32Array(compactPositions), index: compactIndex };
}

// Finding 3: an out-of-range index value reads past the position buffer (undefined ->
// NaN), and mergeVertices then silently welds the corrupted vertex into an unrelated
// real vertex instead of erroring. Caught HERE, before buildCompactBuffers ever reads
// position data for it, so corrupted output is never produced in the first place.
function findOutOfRangeVertexId(triangleVertexIds, vertexCount) {
  for (let i = 0; i < triangleVertexIds.length; i++) {
    const id = triangleVertexIds[i];
    if (!(id >= 0 && id < vertexCount)) return id;
  }
  return undefined;
}

// Finding 1: mergeVertices can itself produce a degenerate triangle (index triple with
// a repeated vertex, e.g. [0,0,1]) when two of a triangle's three vertices weld
// together under the weld epsilon. This is the single canonical choke point every
// downstream consumer (GeometryConnectivity, ThreeMeshBvhBackend) trusts, so filtering
// degenerate triangles out HERE fixes it for everyone, not just one caller. Only the
// index array is filtered -- unused/orphaned vertices left in the position array are
// fine (no later task requires a minimal vertex set, only a minimal triangle set with
// no degenerate entries).
function filterDegenerateTriangles(index) {
  const triangleCount = index.length / 3;
  let degenerateCount = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    if (a === b || b === c || a === c) degenerateCount++;
  }
  if (degenerateCount === 0) return index;

  const filtered = new Uint32Array((triangleCount - degenerateCount) * 3);
  let outOffset = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    filtered[outOffset] = a; filtered[outOffset + 1] = b; filtered[outOffset + 2] = c;
    outOffset += 3;
  }
  return filtered;
}

function resolveWeldEpsilon(getUnitScale) {
  if (getUnitScale == null) return weldEpsilonMeters;
  const unitScale = typeof getUnitScale === 'function' ? getUnitScale() : getUnitScale;
  if (typeof unitScale !== 'number' || !Number.isFinite(unitScale) || unitScale <= 0) {
    return weldEpsilonMeters; // fallback: literal 1e-4 if unit scale unavailable (spec:1780-1781)
  }
  return weldEpsilonMeters / unitScale;
}

function toUint32Index(indexAttribute) {
  const arr = indexAttribute.array;
  return arr instanceof Uint32Array ? arr : Uint32Array.from(arr);
}

/**
 * @param {ReturnType<typeof import('../viewer/ViewerGeometryAdapter.js').adaptViewerGeometry>} triangleGeometryView
 *   Must be the `unsupported: false` variant -- callers filter oversized/unsupported
 *   layout diagnostics upstream of this function; this function only knows about the
 *   maxSyncTriangleCount ceiling, not layout support.
 * @param {Object} [options]
 * @param {number} [options.maxSyncTriangleCount]
 * @param {number|(() => number)} [options.getUnitScale]
 * @param {number} [options.weldEpsilon] If provided, use this value directly; otherwise
 *   derive from getUnitScale. Must be a finite, positive number -- throws TypeError
 *   otherwise (a caller contract violation, not malformed input geometry).
 */
export function compactAndWeld(triangleGeometryView, options = {}) {
  // Finding 5: options.weldEpsilon is a programmer-facing API override (not untrusted
  // Viewer geometry data), so an invalid value is a caller contract violation --
  // thrown, matching this codebase's existing convention for invalid function
  // arguments (collision/geometry/GeometryIdentity.js's constructor validators), not
  // returned as a geometry-data diagnostic.
  if (options.weldEpsilon !== undefined) {
    const eps = options.weldEpsilon;
    if (typeof eps !== 'number' || !Number.isFinite(eps) || eps <= 0) {
      throw new TypeError(`compactAndWeld: options.weldEpsilon must be a finite positive number, got ${eps}`);
    }
  }

  const ceiling = options.maxSyncTriangleCount ?? defaultMaxSyncTriangleCount;
  const { activeTriangleCount } = triangleGeometryView;

  // Checked BEFORE any copying happens (spec:1570-1594) -- strict `>`, not `>=` (an
  // activeTriangleCount exactly AT the ceiling must still be built).
  if (activeTriangleCount > ceiling) {
    return { oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount };
  }

  const triangleVertexIds = collectActiveTriangleVertexIds(triangleGeometryView);

  // Finding 3: an index value that references past the actual vertex count would
  // otherwise read undefined/NaN position data and let mergeVertices silently weld
  // the corrupted vertex into an unrelated real one. Reject with the same
  // {oversized: ...}-style diagnostic shape this file already uses for "cannot
  // process this input", rather than proceeding to build corrupted output.
  const { positions, positionStride } = triangleGeometryView;
  const vertexCount = Math.floor(positions.length / positionStride);
  const invalidVertexId = findOutOfRangeVertexId(triangleVertexIds, vertexCount);
  if (invalidVertexId !== undefined) {
    return { oversized: true, reason: 'index-references-invalid-vertex', activeTriangleCount };
  }

  const compact = buildCompactBuffers(triangleGeometryView, triangleVertexIds);

  // Strip to position+index BEFORE welding: mergeVertices compares ALL attributes on
  // the geometry it's given, so per-face normals/uvs would make every vertex unique
  // and welding would merge nothing (spec:1757-1761).
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(compact.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(compact.index, 1));

  const weldEpsilon = options.weldEpsilon !== undefined
    ? options.weldEpsilon
    : resolveWeldEpsilon(options.getUnitScale);
  const welded = mergeVertices(geometry, weldEpsilon);

  const position = welded.attributes.position.array instanceof Float32Array
    ? welded.attributes.position.array
    : Float32Array.from(welded.attributes.position.array);
  const index = filterDegenerateTriangles(toUint32Index(welded.index));

  return { position, index, triangleCount: index.length / 3 };
}
