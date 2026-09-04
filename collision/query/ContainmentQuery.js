// collision/query/ContainmentQuery.js
//
// Internal point-classification primitive (classifyPoint) plus, added by a LATER task
// (Task 9), anyComponentInside -- this task exports ONLY classifyPoint; leave room
// alongside it for that export, do not assume it exists in this task's own tests.
//
// Ported near-verbatim from spike/geometry-core.mjs's classifyPoint/nearTriangleEdge/
// RAY_DIRECTIONS -- the spike's algorithm already matches the spec's declared solid
// model exactly (spec:2253-2310). The only change here is sourcing tolerances from
// collision/constants.js instead of local hardcoded literals, and taking the target's
// precomputed L_X (localDiagonal, from ThreeMeshBvhBackend#build, Task 5) as an
// explicit parameter instead of recomputing it per call.

import * as THREE from 'three';
import { barycentricEpsilon, mergeDistanceFactor, surfaceEpsilonFactor } from '../constants.js';

// SPIKE FINDING (spec:2286-2296): the naive "local +X first, +Y on retry" rule is
// pathological for BIM. A ray along a local axis from a symmetric point inside an
// axis-aligned box hits the exact CENTRE of a face -- precisely where BoxGeometry
// splits its two triangles -- so every axis-aligned probe grazes a diagonal, every
// retry grazes too, and the point misclassifies `boundary`. Generic, non-axis-aligned,
// mutually unrelated directions avoid systematic alignment with mesh features.
const RAY_DIRECTIONS = [
  new THREE.Vector3(1, 0.3178, 0.1234).normalize(),
  new THREE.Vector3(0.2189, 1, 0.4567).normalize(),
  new THREE.Vector3(0.4321, 0.1357, 1).normalize(),
];

function nearTriangleEdge(hit) {
  const b = hit.barycoord;
  if (!b) return false;
  return b.x < barycentricEpsilon || b.y < barycentricEpsilon || b.z < barycentricEpsilon;
}

/**
 * Three-valued point classification against a target's ENTIRE triangle set, using
 * even-odd (parity) ray casting entirely in the target BVH's own local space
 * (spec:2267-2310). `boundary` is load-bearing, not a convenience third case: it is
 * what fixes round-3's boolean-classifier defect (a point exactly on a face gets a
 * near-zero-distance ray hit that naive parity would wrongly count as `inside`).
 *
 * @param {THREE.Vector3} point - in targetBvh's own local space.
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {number} targetLocalDiagonal - L_target := diagonal(localBounds(target)).
 * @returns {'inside' | 'outside' | 'boundary'}
 */
export function classifyPoint(point, targetBvh, targetLocalDiagonal) {
  // KNOWN GAP -- NOT a declared spec limitation, tracked separately, out of Task 6's
  // scope to fix (a proper fix needs geometric evidence beyond a single scalar --
  // hit positions/normals/local feature scale -- i.e. a spec-revision-level redesign
  // of this tolerance model, not a transcription concern):
  //
  // Both tolerances below scale off the target's single GLOBAL bounding-box diagonal
  // (targetLocalDiagonal), not off any local/per-feature thickness. For extreme
  // single-geometry aspect ratios (one dimension enormously larger than another, on
  // the SAME target -- distinct from the spec's existing "anisotropic scale" passage,
  // which covers cross-instance transform anisotropy, a different mechanism), this
  // produces two failure modes, both reproduced on the same box(0.5, 1_000_000,
  // 1_000_000) fixture (max/min local extent = 2,000,000:1 -- real BIM/MEP elements do not
  // realistically approach this):
  //   (a) merge-collapse: mergeDistance (~1.41 on that fixture) can exceed the box's
  //       actual 0.5 thickness, so the entry and exit crossings through the thin
  //       dimension merge into one -- flipping parity and misclassifying a genuinely
  //       OUTSIDE point (e.g. (-10, 0, 0)) as `inside`.
  //   (b) boundary-expansion: surfaceEpsilon uses the same global-diagonal scale, so
  //       once it approaches half the thin dimension, a genuinely INTERIOR point
  //       (e.g. the centre (0,0,0)) gets caught by the Stage-1 proximity pre-check
  //       and classified `boundary` before parity casting is even attempted, instead
  //       of `inside`.
  // See test/query/ContainmentQuery.classifyPoint.test.mjs's `{ todo: true }` fixture
  // for the exact reproducer and the desired (currently failing) correct answers.
  const surfaceEpsilon = surfaceEpsilonFactor * targetLocalDiagonal;
  const mergeDistance = mergeDistanceFactor * targetLocalDiagonal;

  // Stage 1: surface-proximity pre-check. Guarantees the parity ray below can never
  // meet a distance-zero hit, so that degenerate case cannot arise at all.
  const closest = targetBvh.closestPointToPoint(point);
  if (closest && closest.distance <= surfaceEpsilon) return 'boundary';

  const ray = new THREE.Ray();
  for (const direction of RAY_DIRECTIONS) {
    ray.origin.copy(point);
    ray.direction.copy(direction);

    // THREE.DoubleSide is mandatory: the default FrontSide drops back-facing
    // crossings and silently breaks parity (thin-shell fixture).
    const hits = targetBvh.raycast(ray, THREE.DoubleSide);

    let grazed = false;
    for (const hit of hits) {
      if (nearTriangleEdge(hit)) { grazed = true; break; }
    }
    if (grazed) continue; // retry along the next generic direction

    // Sort by distance THEN merge coincident hits -- MeshBVH.raycast does not
    // guarantee ordered hits.
    const distances = hits.map((h) => h.distance).sort((a, b) => a - b);
    let crossings = 0;
    let last = -Infinity;
    for (const d of distances) {
      if (d - last > mergeDistance) { crossings++; last = d; }
    }
    // Even-odd parity across the target's ENTIRE triangle set (spec:1658-1667) -- the
    // declared solid model, not incidental to MeshBVH.raycast.
    return crossings % 2 === 1 ? 'inside' : 'outside';
  }

  return 'boundary'; // every direction grazed -- genuinely cannot say
}
