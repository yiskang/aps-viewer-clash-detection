// test/vendor/three-mesh-bvh-defects.fixtures.mjs
//
// Plain fixture-builders and assertion helpers for the M4 three-mesh-bvh@0.9.14 correctness
// regression tests (docs/research/m4-three-mesh-bvh-correctness-blocker-adjudication.md, Task 1
// of .superpowers/sdd/2026-09-10-three-mesh-bvh-correctness-patch-implementation/). No `test(...)`
// blocks here -- Task 3's clean-install integrity guard imports these same helpers directly, and a
// `node:test` file must never import another `*.test.mjs` file's contents.
//
// These tests exercise the VENDORED `three-mesh-bvh` library directly (via `new MeshBVH(...)`),
// not `collision/blas/ThreeMeshBvhBackend.js`'s wrapper around it, so this module builds BVHs
// itself rather than reusing test/fixtures/geometry.mjs's testInstance() (which always hardcodes
// `indirect: true` and does aspect-ratio/connectivity work irrelevant here). Test 3 (multi-root)
// specifically needs `indirect: false` -- see its own file for why.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// ---------------------------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------------------------

/**
 * A single-quad (2-triangle) BufferGeometry centered at (cx, cy, cz), lying in the z=cz plane,
 * with the given side length. `targetLeafSize` defaults to 10 (src/core/Constants.js), so 2
 * triangles always produce a single-node, root-is-leaf MeshBVH -- this is the anchor shape that
 * exposes Defect 1 (adjudication §2.1).
 */
export function quadGeometry(cx = 0, cy = 0, cz = 0, size = 1) {
  const h = size / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    cx - h, cy - h, cz,   cx + h, cy - h, cz,   cx + h, cy + h, cz,   cx - h, cy + h, cz,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * An nx*ny grid of quads (2*nx*ny triangles total), spanning [-sx/2, sx/2] x [-sy/2, sy/2] in the
 * z=z plane. Used both as a "far operand" with its own boundsTree (so the nested accelerated path
 * in closestPointToGeometry is taken) and, at larger nx*ny, as a multi-node "perturber" anchor.
 */
export function gridGeometry(nx, ny, sx, sy, z) {
  const pos = [];
  const idx = [];
  let vi = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x0 = -sx / 2 + i * (sx / nx), x1 = -sx / 2 + (i + 1) * (sx / nx);
      const y0 = -sy / 2 + j * (sy / ny), y1 = -sy / 2 + (j + 1) * (sy / ny);
      pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
      idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Clone + translate a BufferGeometry (used to build the "distant" perturber from the "near" one). */
export function translateGeometry(geometry, dx, dy, dz) {
  return geometry.clone().translate(dx, dy, dz);
}

/**
 * Two 2-triangle quad groups, `gap` units apart, each its own BVH root range via
 * `geometry.addGroup`. A vertex gap of unused, unreferenced index range MUST separate the two
 * groups' index ranges -- adjacent (touching) group ranges collapse into a single root range
 * (src/core/build/geometryUtils.js's getRootPrimitiveRanges: "Triangles in gaps between groups
 * are excluded"). Only meaningful with `indirect: false` -- see multiRoot test file header for why
 * `indirect: true` can never produce more than one root (GeometryBVH.getRootRanges hardcodes a
 * single range whenever `options.indirect` is true, regardless of `geometry.groups`).
 */
export function twoGroupGeometry(groupACenter, groupBCenter, gapCenter = [-5000, -5000, -5000]) {
  const posA = quadCorners(...groupACenter);
  const posGap = quadCorners(...gapCenter); // unreferenced-by-any-group filler so the two real
  const posB = quadCorners(...groupBCenter); // groups' index ranges are non-adjacent (a real gap).
  const pos = [...posA, ...posGap, ...posB];
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.addGroup(0, 6, 0);
  g.addGroup(12, 6, 1);
  return g;
}

function quadCorners(cx, cy, cz, size = 1) {
  const h = size / 2;
  return [cx - h, cy - h, cz, cx + h, cy - h, cz, cx + h, cy + h, cz, cx - h, cy + h, cz];
}

// ---------------------------------------------------------------------------------------------
// BVH construction / inspection
// ---------------------------------------------------------------------------------------------

/**
 * Builds a MeshBVH the same way `ThreeMeshBvhBackend.js:55-56` builds a BLAS -- `new
 * MeshBVH(geometry, { indirect })` plus `geometry.boundsTree = bvh` -- but with `indirect`
 * caller-controlled (production always uses `indirect: true`; test 3's multi-root fixture needs
 * `indirect: false`, see that file).
 */
export function buildMeshBvh(geometry, { indirect = true } = {}) {
  const bvh = new MeshBVH(geometry, { indirect });
  geometry.boundsTree = bvh;
  return bvh;
}

/**
 * True if `bvh._roots[rootIndex]` is a single leaf node: 32 bytes (one BYTES_PER_NODE,
 * src/core/Constants.js) and the IS_LEAF flag (`uint16[15] === 0xFFFF`) set, per adjudication
 * §2.1's BVH-shape table.
 */
export function isRootLeaf(bvh, rootIndex = 0) {
  const root = bvh._roots[rootIndex];
  if (root.byteLength !== 32) return false;
  return new Uint16Array(root)[15] === 0xFFFF;
}

/** Node count of a root buffer (32 bytes/node, src/core/Constants.js BYTES_PER_NODE). */
export function nodeCount(bvh, rootIndex = 0) {
  return bvh._roots[rootIndex].byteLength / 32;
}

/**
 * Calls `anchorBvh.closestPointToGeometry(otherGeometry, geometryToBvh, ...)` and returns just the
 * distance (or `null` on a miss) -- the shape every measured/predecessor call in tests 1/3/4 needs.
 */
export function closestDistance(anchorBvh, otherGeometry, { geometryToBvh = new THREE.Matrix4(), maxThreshold = Infinity, minThreshold = 0 } = {}) {
  const target1 = {};
  const result = anchorBvh.closestPointToGeometry(otherGeometry, geometryToBvh, target1, undefined, minThreshold, maxThreshold);
  return result ? result.distance : null;
}

/**
 * The explicit 8-call predecessor sequence from task-1-brief.md (a `codex-advisor` review flagged
 * "interleave before calls 2 and 4" as ambiguous, so the brief spells out every call).
 *
 * IMPORTANT: step 1 ("warm-up... this is the 'near' predecessor for call 2") must be
 * `nearPredecessor()`, NOT `measured()`, despite the brief's literal wording appearing to reuse
 * the measured anchor/far operands. When the measured anchor's root is a leaf,
 * `closestPointToGeometry(measuredAnchor, ...)` NEVER invokes `intersectsBounds` on its own root
 * (that is the entire defect), so it structurally cannot refresh the module-global `obb2.min`/
 * `obb2.max` -- calling it as its own "predecessor" is a no-op for the very state this sequence is
 * trying to control, and produces `[A, null, null, null]` (C stays corrupted from the distant
 * predecessor, since nothing between it and C can un-corrupt it) rather than the required
 * `[A, null, C, null]`. `nearPredecessor` (a dedicated multi-node BVH, immune to the defect via
 * its own normal `intersectsBounds` traversal, paired with the unchanged far operand) is the
 * thing that actually sets `obb2` back to a near-ish state before call A and call C. Confirmed via
 * `codex-advisor` (request `20260910-211834-65265-17428`, effort high) against the adjudication
 * doc's own §2.1 wording and an independent live run of both interpretations against installed
 * three-mesh-bvh@0.9.14: literal-measured-warm-up gives `[0.05, null, null, null]`;
 * nearPredecessor-as-warm-up gives the required `[0.05, null, 0.05, null]`.
 *
 * `measured`, `nearPredecessor`, `distantPredecessor` are zero-arg functions each performing one
 * closestPointToGeometry call and returning its distance-or-null; `measured` is called 4 times
 * (all recorded), `nearPredecessor`/`distantPredecessor` twice each.
 * Returns `{ measured: [A, B, C, D], predecessors: [near1, distant1, near2, distant2] }`.
 */
export function runEightCallPredecessorSequence({ measured, nearPredecessor, distantPredecessor }) {
  const near1 = nearPredecessor(); // 1. warm-up: near predecessor, priming obb2 before call A
  const A = measured(); // 2. measured call A, immediately preceded by step 1
  const distant1 = distantPredecessor(); // 3. predecessor: distant pair
  const B = measured(); // 4. measured call B, immediately preceded by step 3
  const near2 = nearPredecessor(); // 5. predecessor: near pair again (repeats step 1's call)
  const C = measured(); // 6. measured call C, immediately preceded by step 5
  const distant2 = distantPredecessor(); // 7. predecessor: distant pair again (repeats step 3's call)
  const D = measured(); // 8. measured call D, immediately preceded by step 7
  return { measured: [A, B, C, D], predecessors: [near1, distant1, near2, distant2] };
}

// ---------------------------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) -- `seed` fully determines the sequence. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Independent exact OBB/AABB distance reference (test 2(b))
// ---------------------------------------------------------------------------------------------
//
// For two disjoint convex polytopes, the minimum-distance pair is realized either by a vertex of
// one against the closest point on the other (which itself may be a vertex, edge, or face -- the
// "closest point on box" clamp captures all three automatically), or by an edge-edge pair. This is
// exactly the decomposition OrientedBox.distanceToBox itself uses -- the point here is an
// INDEPENDENT implementation (own segment-segment solver, own corner/edge enumeration) so it
// cannot share the shipped code's typo. box edges are enumerated in LOCAL index space (corner
// index pairs differing in one bit) and only then transformed -- adjudication provenance section:
// enumerating by float-equality on already-transformed corners silently discards every edge
// candidate and produces a false "0 over-estimates" result.

/** The 12 box edges as pairs of local corner indices differing in exactly one bit (0..7, bit
 * layout matching OrientedBox.update(): i = (1<<0)*x | (1<<1)*y | (1<<2)*z). */
export function boxEdgeIndexPairs() {
  const pairs = [];
  for (let bit = 0; bit < 3; bit++) {
    const mask = 1 << bit;
    for (let i = 0; i < 8; i++) {
      if ((i & mask) === 0) pairs.push([i, i | mask]);
    }
  }
  return pairs; // 12 pairs
}
const EDGE_INDEX_PAIRS = boxEdgeIndexPairs();

function obbLocalCorner(min, max, i) {
  return new THREE.Vector3(
    (i & 1) ? max.x : min.x,
    (i & 2) ? max.y : min.y,
    (i & 4) ? max.z : min.z,
  );
}

function aabbCorner(box, i) {
  return new THREE.Vector3(
    (i & 1) ? box.max.x : box.min.x,
    (i & 2) ? box.max.y : box.min.y,
    (i & 4) ? box.max.z : box.min.z,
  );
}

/**
 * Independent closest-points-between-two-segments solver (Ericson, "Real-Time Collision
 * Detection" §5.1.9) -- NOT the vendored `closestPointsSegmentToSegment` from
 * src/math/MathUtilities.js, so it shares no code with the function under test. Writes the
 * closest points into `outC1`/`outC2` and returns the squared distance between them.
 */
export function closestPtSegmentSegment(p1, q1, p2, q2, outC1, outC2) {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const EPS = 1e-12;
  let s, t;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  outC1.copy(p1).addScaledVector(d1, s);
  outC2.copy(p2).addScaledVector(d2, t);
  return outC1.distanceToSquared(outC2);
}

/**
 * Independent exact distance between an OBB (given as local `min`/`max`/`matrix`, matching
 * OrientedBox's own constructor arguments) and an axis-aligned `THREE.Box3`, assuming the two are
 * disjoint (callers must have already confirmed this, e.g. via `obb.intersectsBox(aabb) === false`
 * -- see the Defect-3 contamination guard note in the test-2(b) sweep). Returns
 * `{ distance, p1, p2 }` where `p1`/`p2` are the realizing witness points in world space.
 */
export function exactObbAabbDistance(min, max, matrix, aabb) {
  const invMatrix = new THREE.Matrix4().copy(matrix).invert();

  const obbCornersWorld = [];
  for (let i = 0; i < 8; i++) obbCornersWorld.push(obbLocalCorner(min, max, i).applyMatrix4(matrix));
  const aabbCorners = [];
  for (let i = 0; i < 8; i++) aabbCorners.push(aabbCorner(aabb, i));

  let best = Infinity, bestP1 = null, bestP2 = null;

  // vertex(obb) vs body(aabb)
  for (let i = 0; i < 8; i++) {
    const p = obbCornersWorld[i];
    const c = p.clone().clamp(aabb.min, aabb.max);
    const d = p.distanceToSquared(c);
    if (d < best) { best = d; bestP1 = p.clone(); bestP2 = c; }
  }

  // vertex(aabb) vs body(obb)
  for (let i = 0; i < 8; i++) {
    const p = aabbCorners[i];
    const local = p.clone().applyMatrix4(invMatrix).clamp(min, max);
    const c = local.applyMatrix4(matrix);
    const d = p.distanceToSquared(c);
    if (d < best) { best = d; bestP1 = c; bestP2 = p.clone(); }
  }

  // edge(obb) x edge(aabb), 12x12, enumerated in local index space
  const c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  for (const [i1, i2] of EDGE_INDEX_PAIRS) {
    const oa = obbCornersWorld[i1], ob = obbCornersWorld[i2];
    for (const [j1, j2] of EDGE_INDEX_PAIRS) {
      const aa = aabbCorners[j1], ab = aabbCorners[j2];
      const dSq = closestPtSegmentSegment(oa, ob, aa, ab, c1, c2);
      if (dSq < best) { best = dSq; bestP1 = c1.clone(); bestP2 = c2.clone(); }
    }
  }

  return { distance: Math.sqrt(best), p1: bestP1, p2: bestP2 };
}

/**
 * Strictly-valid upper bound on the true OBB/AABB distance via dense sampling of random points on
 * the OBB's surface, clamped into the AABB. A second, independent check against
 * `exactObbAabbDistance` -- the adjudication doc's provenance section records that this upper
 * bound is what caught an earlier, silently-broken reference (see boxEdgeIndexPairs doc comment).
 */
export function sampledUpperBound(min, max, matrix, aabb, samples, rng) {
  let best = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < samples; i++) {
    const axis = Math.floor(rng() * 3);
    const side = rng() < 0.5 ? 0 : 1;
    const u = rng(), v = rng();
    const local = new THREE.Vector3();
    if (axis === 0) local.set(side ? max.x : min.x, min.y + u * (max.y - min.y), min.z + v * (max.z - min.z));
    else if (axis === 1) local.set(min.x + u * (max.x - min.x), side ? max.y : min.y, min.z + v * (max.z - min.z));
    else local.set(min.x + u * (max.x - min.x), min.y + v * (max.y - min.y), side ? max.z : min.z);
    p.copy(local).applyMatrix4(matrix);
    const c = p.clone().clamp(aabb.min, aabb.max);
    const d = p.distanceTo(c);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Random disjoint-candidate OBB/AABB pair generator for the test-2(b) sweep: non-cubic AABB
 * extents (distinct per axis, required -- a cube AABB makes the typo a structural no-op, see test
 * 2(c)), with a fraction of samples given a zero-thickness axis (degenerate BVH node bounds are
 * common for planar fragments). Callers must still confirm disjointness via
 * `obb.intersectsBox(aabb) === false` -- this generator does not guarantee it.
 */
export function randomObbAabbPair(rng) {
  const min = new THREE.Vector3(-0.5 - rng() * 1.5, -0.5 - rng() * 1.5, -0.5 - rng() * 1.5);
  const max = new THREE.Vector3(0.5 + rng() * 1.5, 0.5 + rng() * 1.5, 0.5 + rng() * 1.5);
  const euler = new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
  const translation = new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 6, (rng() - 0.5) * 6);
  const matrix = new THREE.Matrix4().makeRotationFromEuler(euler).setPosition(translation);

  const ax = 0.3 + rng() * 2.0, ay = 0.3 + rng() * 1.3, az = 0.3 + rng() * 0.7; // distinct extents
  const zeroAxis = rng() < 0.15 ? Math.floor(rng() * 3) : -1;
  const extents = [ax, ay, az];
  if (zeroAxis >= 0) extents[zeroAxis] = 0;
  const aabb = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(extents[0], extents[1], extents[2]));

  return { min, max, matrix, aabb };
}

// ---------------------------------------------------------------------------------------------
// Brute-force triangle-pair oracle (test 4 / finite-maxThreshold randomized search)
// ---------------------------------------------------------------------------------------------

/**
 * Extracts a geometry's triangles as plain `{ a, b, c }` THREE.Vector3 triples in the geometry's
 * own local space (not yet transformed).
 */
export function extractTriangleVertices(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index.array;
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    tris.push([
      new THREE.Vector3().fromBufferAttribute(pos, idx[i]),
      new THREE.Vector3().fromBufferAttribute(pos, idx[i + 1]),
      new THREE.Vector3().fromBufferAttribute(pos, idx[i + 2]),
    ]);
  }
  return tris;
}

/**
 * Brute-force minimum distance between `anchorTriangles` (an array of ExtendedTriangle already in
 * the anchor's local/BVH frame) and `farTrianglesLocal` (plain vertex triples in the far
 * geometry's OWN local frame, transformed by `matrix` here) -- no BVH involved, so this is immune
 * to both Defect 1 and Defect 2. Uses `ExtendedTriangle.prototype.distanceToTriangle`, the exact
 * SAME leaf-level math `closestPointToGeometry` itself uses once it has selected a candidate
 * triangle pair (per adjudication §2.2(b)'s own end-to-end oracle) -- the only thing this function
 * differs on from the library is that it never prunes, so it cannot be Defect-2-wrong.
 */
export function bruteForceMinDistance(anchorTriangles, farTrianglesLocal, matrix, ExtendedTriangleCtor) {
  let best = Infinity;
  const t2 = new ExtendedTriangleCtor();
  for (const [a, b, c] of farTrianglesLocal) {
    t2.a.copy(a).applyMatrix4(matrix);
    t2.b.copy(b).applyMatrix4(matrix);
    t2.c.copy(c).applyMatrix4(matrix);
    t2.needsUpdate = true;
    for (const t1 of anchorTriangles) {
      const d = t1.distanceToTriangle(t2);
      if (d < best) best = d;
    }
  }
  return best;
}

/** A random rigid transform (rotation + translation at distance in [minDist, maxDist]). */
export function randomRigidTransform(rng, minDist, maxDist) {
  const euler = new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
  const dist = minDist + rng() * (maxDist - minDist);
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  const dir = new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
  );
  const translation = dir.multiplyScalar(dist);
  return new THREE.Matrix4().makeRotationFromEuler(euler).setPosition(translation);
}
