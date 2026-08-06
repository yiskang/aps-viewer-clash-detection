// SPIKE — not production code. Minimal implementation of the Milestone 1 geometry
// primitives from docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md,
// built only to answer the open questions that six rounds of spec review could not:
//   Q1 do the primitives actually behave as specified on the spec's named fixtures?
//   Q2 does three-mesh-bvh@0.9.14 behave as the spec assumes (verified by reading source)?
//   Q3 what do the operations cost at realistic triangle counts?
//
// Deliberately omits: Viewer adapters, caching, diagnostics plumbing, budgets.

import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- tolerances

// Spec: per-BVH scale L_X = diagonal(localBounds(X)); tolerances live in the frame
// they are applied in.
function scaleOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox.getSize(new THREE.Vector3()).length();
}

const BARYCENTRIC_EPSILON = 1e-6;
const COPLANAR_ANGLE_EPSILON = 1e-6;
const surfaceEpsilonFor = (L) => 1e-6 * L;
const mergeDistanceFor = (L) => 1e-6 * L;
const ladderFor = (L) => [1e-3 * L, 1e-4 * L, 1e-5 * L];

// ------------------------------------------------------- classifyPoint (3-valued)

const _target = {};
const _ray = new THREE.Ray();

// SPIKE FINDING: the spec said "local +X first, local +Y on retry". That is
// pathological for BIM. A ray along a local axis from a symmetric point inside an
// axis-aligned box hits the exact CENTRE of a face — which is precisely where
// BoxGeometry splits its two triangles — so every hit grazes a diagonal, both
// retries graze, and the point classifies `boundary`. Axis-aligned boxes are what
// BIM is mostly made of. Generic (non-axis-aligned, mutually unrelated) directions
// avoid systematic alignment with mesh features.
const RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0.3178, 0.1234).normalize(),
  new THREE.Vector3(0.2189, 1, 0.4567).normalize(),
  new THREE.Vector3(0.4321, 0.1357, 1).normalize(),
];

// Returns 'inside' | 'outside' | 'boundary'. Even-odd parity over the target's
// entire triangle set (the spec's declared solid model).
function classifyPoint(point, bvh, L) {
  const surfaceEpsilon = surfaceEpsilonFor(L);

  // Stage 1: surface-proximity pre-check. Guarantees the parity ray below cannot
  // meet a distance-zero hit, so that degenerate case cannot arise at all.
  const hit = bvh.closestPointToPoint(point, _target);
  if (hit && hit.distance <= surfaceEpsilon) return 'boundary';

  const mergeDistance = mergeDistanceFor(L);

  for (const axis of RAY_DIRECTIONS) {
    _ray.origin.copy(point);
    _ray.direction.copy(axis);

    // DoubleSide is mandatory: FrontSide (the default) drops back-facing crossings
    // and silently breaks parity.
    const hits = bvh.raycast(_ray, THREE.DoubleSide);

    let grazed = false;
    for (const h of hits) {
      if (nearTriangleEdge(h)) { grazed = true; break; }
    }
    if (grazed) continue; // retry on the alternate axis

    // Sort by distance THEN merge coincident hits — raycast does not guarantee order.
    const distances = hits.map((h) => h.distance).sort((a, b) => a - b);
    let crossings = 0;
    let last = -Infinity;
    for (const d of distances) {
      if (d - last > mergeDistance) { crossings++; last = d; }
    }
    return crossings % 2 === 1 ? 'inside' : 'outside';
  }

  return 'boundary'; // both axes grazed — genuinely cannot say
}

function nearTriangleEdge(hit) {
  // three-mesh-bvh reports barycoord on the hit when available.
  const b = hit.barycoord;
  if (!b) return false;
  return (
    b.x < BARYCENTRIC_EPSILON || b.y < BARYCENTRIC_EPSILON || b.z < BARYCENTRIC_EPSILON
  );
}

// ------------------------------------------------------------ ProperCrossingQuery

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();

// Returns { crossing: bool, inconclusive: bool, stats }.
// bvhcast hands the callback CANDIDATE pairs from overlapping leaves — NOT
// intersecting ones. Testing is our job (verified in MeshBVH.js @ v0.9.14).
function properCrossing(bvhA, bvhB, matrixBtoA, L) {
  const ladder = ladderFor(L);
  const surfaceEpsilon = surfaceEpsilonFor(L);
  const stats = { candidates: 0, intersecting: 0, coplanar: 0, probes: 0 };

  let crossing = false;
  let sawBoundaryProbe = false;

  bvhA.bvhcast(bvhB, matrixBtoA, {
    intersectsTriangles(triA, triB) {
      stats.candidates++;

      _triA.copy(triA); _triA.needsUpdate = true;
      _triB.copy(triB); _triB.needsUpdate = true;
      _triA.getNormal(_nA);
      _triB.getNormal(_nB);

      const parallel = Math.abs(_nA.dot(_nB)) >= 1 - COPLANAR_ANGLE_EPSILON;
      const coplanar =
        parallel &&
        Math.abs(_nA.dot(_triA.a) - _nA.dot(_triB.a)) <= surfaceEpsilon;

      if (coplanar) {
        // Call WITHOUT a target line: that is what avoids the upstream
        // "Triangles are coplanar…" warning, and a coplanar pair could never
        // yield a usable segment anyway. Zero-volume contact -> not a crossing.
        if (_triA.intersectsTriangle(_triB)) stats.coplanar++;
        return false;
      }

      // Must test explicitly; a non-intersecting pair leaves _line holding the
      // PREVIOUS pair's endpoints, which would fabricate a crossing from stale state.
      if (!_triA.intersectsTriangle(_triB, _line)) return false;
      stats.intersecting++;

      _line.getCenter(_mid);

      for (const s1 of [1, -1]) {
        for (const s2 of [1, -1]) {
          _dir.copy(_nA).multiplyScalar(s1).addScaledVector(_nB, s2);
          if (_dir.lengthSq() < 1e-20) continue; // degenerate: parallel normals
          _dir.normalize();

          for (const delta of ladder) {
            stats.probes++;
            _probe.copy(_mid).addScaledVector(_dir, delta);

            const inA = classifyPoint(_probe, bvhA, L);
            if (inA === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inA !== 'inside') continue;

            // Probe is in A's frame; bring it into B's frame to classify against B.
            const probeInB = _probe.clone().applyMatrix4(
              new THREE.Matrix4().copy(matrixBtoA).invert()
            );
            const inB = classifyPoint(probeInB, bvhB, L);
            if (inB === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inB === 'inside') { crossing = true; return true; } // early exit
          }
        }
      }
      return false;
    },
  });

  return { crossing, inconclusive: !crossing && sawBoundaryProbe, stats };
}

// ------------------------------------------------------- GeometryConnectivity

// Edge-based union-find (NOT vertex-based: vertex-sharing merges solids joined at
// a point, which defeated the containment guarantee). Also reports manifoldness.
function connectivity(geometry) {
  const index = geometry.index.array;
  const triCount = index.length / 3;
  const parent = new Int32Array(triCount).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const v0 = index[t * 3 + e];
      const v1 = index[t * 3 + ((e + 1) % 3)];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(t);
    }
  }
  for (const tris of edgeMap.values()) {
    for (let i = 1; i < tris.length; i++) union(tris[0], tris[i]);
  }

  // Per-COMPONENT manifoldness, not just per-geometry. Round 7 scoped the positive
  // diagnostic to "the deciding component," which a geometry-wide flag cannot answer:
  // one open shell would condemn every closed component sharing the geometry.
  let boundaryEdges = 0, nonManifoldEdges = 0;
  const perComponent = new Map(); // root -> {boundary, nonManifold}
  const bump = (root, field) => {
    if (!perComponent.has(root)) perComponent.set(root, { boundary: 0, nonManifold: 0 });
    perComponent.get(root)[field]++;
  };
  for (const tris of edgeMap.values()) {
    if (tris.length === 1) { boundaryEdges++; bump(find(tris[0]), 'boundary'); }
    else if (tris.length > 2) { nonManifoldEdges++; bump(find(tris[0]), 'nonManifold'); }
  }

  const components = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(t);
    if (!components.has(r)) components.set(r, []);
    components.get(r).push(t);
  }

  const roots = [...components.keys()];
  return {
    componentCount: components.size,
    components: [...components.values()],
    // Aligned with `components`: componentClosed[i] describes components[i].
    componentClosed: roots.map((r) => {
      const c = perComponent.get(r);
      return !c || (c.boundary === 0 && c.nonManifold === 0);
    }),
    closedManifold: boundaryEdges === 0 && nonManifoldEdges === 0,
    boundaryEdges,
    nonManifoldEdges,
  };
}

// ---------------------------------------------------------- anyComponentInside

function anyComponentInside(srcGeom, srcBvh, targetBvh, matrixSrcToTarget, Ltarget) {
  const conn = connectivity(srcGeom);
  const index = srcGeom.index.array;
  const pos = srcGeom.attributes.position;
  let sawBoundary = false;

  for (let ci = 0; ci < conn.components.length; ci++) {
    const tris = conn.components[ci];
    const verts = new Set();
    for (const t of tris) for (let e = 0; e < 3; e++) verts.add(index[t * 3 + e]);
    const list = [...verts];

    // Spatially-spread stride, then continue through the component. A "first N"
    // pick can land entirely on a shared face and read boundary forever.
    const stride = Math.max(1, Math.ceil(list.length / 8));
    const order = [];
    for (let s = 0; s < stride; s++) for (let i = s; i < list.length; i += stride) order.push(list[i]);

    let resolved = false;
    for (const v of order) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(matrixSrcToTarget);
      const c = classifyPoint(p, targetBvh, Ltarget);
      // Report the DECIDING component's closure, not the whole geometry's.
      if (c === 'inside') {
        return {
          inside: true,
          decidingComponentClosed: conn.componentClosed[ci],
          closedManifold: conn.closedManifold,
          conn,
        };
      }
      if (c === 'outside') { resolved = true; break; }
    }
    if (!resolved) sawBoundary = true;
  }

  return { inside: false, unresolved: sawBoundary, closedManifold: conn.closedManifold, conn };
}

// ------------------------------------------------------------ volume-overlap

// ROUND 7: the diagnostic is scoped by MODE, not by a degeneracy measurement.
// Round 7's draft tried to separate a nearly-closed bathtub from a zero-volume
// sheet and could not define the test. The real error was that the room-locator
// was asking a containment question through a volume-overlap contract.
//
//   volume-overlap : needs BOTH sides closed (probe classification is parity
//                    against both, so the crossing path is not closure-free either)
//   containment    : needs only the TARGET closed; the source is sampled, never
//                    parity-tested, so its openness cannot affect soundness

// Is any part of `src` inside `target`'s interior? Open sources are sound here.
function containment(src, target) {
  const srcToTarget = new THREE.Matrix4().copy(target.matrix).invert().multiply(src.matrix);
  const r = anyComponentInside(src.geometry, src.bvh, target.bvh, srcToTarget, target.L);
  const targetClosed = connectivity(target.geometry).closedManifold;

  return {
    contained: r.inside,
    // Parity ran against the target, so an open TARGET taints every result --
    // positive and negative alike. Rounds 6/7 checked only the source.
    unverifiedTarget: !targetClosed,
    inconclusive: !r.inside && r.unresolved,
  };
}

function volumeOverlap(a, b) {
  const L = Math.min(a.L, b.L);
  const bToA = new THREE.Matrix4().copy(a.matrix).invert().multiply(b.matrix);
  const aToB = new THREE.Matrix4().copy(b.matrix).invert().multiply(a.matrix);
  const aClosed = connectivity(a.geometry).closedManifold;
  const bClosed = connectivity(b.geometry).closedManifold;
  const unverifiedTarget = !aClosed || !bClosed;

  const cross = properCrossing(a.bvh, b.bvh, bToA, L);
  // The crossing path classifies probes against BOTH solids, so it inherits both
  // closure preconditions rather than being the closure-free path earlier drafts
  // assumed.
  if (cross.crossing) {
    return { overlap: true, via: 'crossing', unverifiedTarget, stats: cross.stats };
  }

  const aInB = anyComponentInside(a.geometry, a.bvh, b.bvh, aToB, b.L);
  if (aInB.inside) {
    return {
      overlap: true,
      via: 'containment(A in B)',
      openComponent: !aInB.decidingComponentClosed,
      unverifiedTarget: !bClosed,
      stats: cross.stats,
    };
  }

  const bInA = anyComponentInside(b.geometry, b.bvh, a.bvh, bToA, a.L);
  if (bInA.inside) {
    return {
      overlap: true,
      via: 'containment(B in A)',
      openComponent: !bInA.decidingComponentClosed,
      unverifiedTarget: !aClosed,
      stats: cross.stats,
    };
  }

  return {
    overlap: false,
    unverifiedTarget,
    inconclusive: cross.inconclusive || aInB.unresolved || bInA.unresolved,
    stats: cross.stats,
  };
}

// --------------------------------------------------------- surface-intersection

// Same bvhcast traversal as properCrossing, same candidate budget, weaker
// predicate. Round 7 found the spec's `MeshBVH.intersectsGeometry` definition was
// the last unbounded synchronous path: it takes no budget and offers no abort
// hook, so the very input the crossing budget bounds would freeze the Viewer here.
// No parity, so no closure precondition on either side.
function surfaceIntersection(a, b, maxCandidatePairs = 50_000) {
  const bToA = new THREE.Matrix4().copy(a.matrix).invert().multiply(b.matrix);
  let hit = false, aborted = false, candidates = 0;

  a.bvh.bvhcast(b.bvh, bToA, {
    intersectsTriangles(triA, triB) {
      if (++candidates > maxCandidatePairs) { aborted = true; return true; }
      // Coplanar contact IS surface intersection here, so no coplanar split --
      // but still call without a target line to avoid the upstream warning.
      if (triA.intersectsTriangle(triB)) { hit = true; return true; }
      return false;
    },
  });

  // bvhcast returns true on abort too; reading that as a hit would turn a
  // timeout into a fabricated result.
  return { intersects: aborted ? false : hit, aborted, candidates };
}

// ------------------------------------------------------------------- helpers

// SPIKE FINDING: welding is MANDATORY, not the optional "repair" the spec deferred.
// Tessellated geometry duplicates vertices per-face (BoxGeometry: 24 vertices for 8
// corners, because each face carries its own normals/uvs). Index-based connectivity
// on that splits a plain box into SIX components, every edge a boundary edge, so
// `closedManifold` is false for the simplest solid there is — and the containment
// guarantee would never hold for any real geometry.
//
// Note mergeVertices() compares ALL attributes, so it merges nothing while normals
// and uvs are present. Stripping to position-only FIRST is what makes welding work
// — which means the spec's "don't copy rendering attributes" rule (written for
// memory) is load-bearing for CORRECTNESS.
function normalizeForCollision(geometry) {
  const positionOnly = new THREE.BufferGeometry();
  positionOnly.setAttribute('position', geometry.attributes.position.clone());
  if (geometry.index) {
    positionOnly.setIndex(geometry.index.clone());
  } else {
    positionOnly.setIndex([...Array(geometry.attributes.position.count).keys()]);
  }
  return mergeVertices(positionOnly);
}

function instance(geometry, matrix = new THREE.Matrix4()) {
  const collision = normalizeForCollision(geometry);
  return { geometry: collision, bvh: new MeshBVH(collision), matrix, L: scaleOf(collision) };
}

export {
  THREE, MeshBVH,
  classifyPoint, properCrossing, connectivity, anyComponentInside,
  volumeOverlap, containment, surfaceIntersection,
  instance, scaleOf, normalizeForCollision,
};
