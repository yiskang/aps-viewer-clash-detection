// collision/query/SurfaceCrossingWitness.js
//
// Probes within the source triangle's OWN PLANE, classifies against target only.
// docs/...:2565-2616. Given a source triangle properly (non-coplanarly) intersecting
// target along segment L, take L's midpoint M, form in-plane direction
// u = normalize(nA x dir(L)), and probe P = M +/- delta*u for delta in
// crossingProbeFractions x dAvail -- dAvail recomputed FRESH per candidate from THIS
// triangle's own available in-plane distance, never a cached canonical/target scale
// (round-9 fix for the spike's `Math.min(src.L, target.L)` bug).

import { ExtendedTriangle } from 'three-mesh-bvh';
import * as THREE from 'three';
import { classifyPoint } from './ContainmentQuery.js';
import {
  coplanarAngleEpsilon,
  surfaceEpsilonFactor,
  crossingProbeFractions,
  maxCandidatePairsExamined,
  maxCrossingPairsExamined,
  frameBudgetMs,
} from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _segDir = new THREE.Vector3();
const _u = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probeInTarget = new THREE.Vector3();

const noopScheduler = { elapsedMs: () => 0 };

/**
 * @param {import('three-mesh-bvh').MeshBVH} sourceBvh
 * @param {import('three-mesh-bvh').MeshBVH} targetBvh
 * @param {import('three').Matrix4} targetToSourceMatrix - maps target's local space into source's local space
 * @param {number} sourceLocalDiagonal
 * @param {number} targetLocalDiagonal
 * @param {{ maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, scheduler?: { elapsedMs(): number } }} [options]
 */
export function surfaceCrossingWitness(sourceBvh, targetBvh, targetToSourceMatrix, sourceLocalDiagonal, targetLocalDiagonal, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const crossingBudget = options.maxCrossingPairsExamined ?? maxCrossingPairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;

  // SHARED per-call elapsed-time accumulator, not a private clock (docs/...:2608-2613,
  // the explicit contrast with ProperCrossingQuery/SurfaceIntersectionQuery). This
  // function cannot await (bvhcast-native, no yield point mid-traversal), so it only
  // ever READS `scheduler.elapsedMs()` synchronously -- it never calls
  // `checkpointIfDue()`. Whichever composite caller owns this scheduler object is
  // responsible for the elapsed-time baseline actually reflecting the whole call, not
  // just this traversal's own entry -- a standalone caller (this task's own tests) may
  // omit `options.scheduler` entirely, which reports 0 forever, a degenerate
  // always-under-budget case, not a different contract.
  const scheduler = options.scheduler ?? noopScheduler;

  const sourceToTargetMatrix = targetToSourceMatrix.clone().invert();
  // Coplanarity is tested on triangles already in SOURCE's local frame (bvhcast
  // transforms `targetBvh`'s triangles into `sourceBvh`'s frame before the callback
  // ever sees them) -- so its distance tolerance must be scaled by sourceLocalDiagonal,
  // not targetLocalDiagonal. A Codex spec-review of an earlier draft caught this frame
  // mismatch, which silently misclassifies near-coplanar pairs whenever source and
  // target differ in local scale.
  const coplanarSurfaceEpsilon = surfaceEpsilonFactor * sourceLocalDiagonal;
  // classifyPoint's own boundary pre-check, further down, is scaled by targetLocalDiagonal
  // as usual -- that call classifies IN target's frame, a separate concern from the
  // coplanarity test above.

  let candidatePairsExamined = 0;
  let crossingPairsExamined = 0;
  let witnessFound = false;
  let aborted = false;
  let sawInconclusiveCandidate = false;   // no rung ever stayed inside the triangle
  let sawBoundaryClassification = false;  // a rung stayed inside but read `boundary` against target

  const timeExceeded = () => scheduler.elapsedMs() > timeBudgetMs;

  // Callback-exception containment (batch ledger, "Cross-cutting finding, discovered
  // during Task 8, applies to every bvhcast-consuming module"): the pinned
  // three-mesh-bvh's bvhcast sets a module-global `_active` flag true at entry and
  // clears it only on its normal-completion path (no try/finally). If
  // intersectsTriangles were allowed to let an exception escape straight out of
  // bvhcast, `_active` would stay stuck true and permanently break every LATER
  // bvhcast-based query in the process ("Recursive calls to bvhcast not supported")
  // until reload. So: catch everything inside the callback, save it, return true so
  // bvhcast still exits via its normal-completion path and clears its internal state,
  // then rethrow once bvhcast has actually returned.
  //
  // `hasCaughtError` is a SEPARATE flag from `caughtError` itself -- JS permits
  // `throw null`/`throw 0`/`throw undefined`/`throw ''`/`throw false`, all falsy, so a
  // plain `if (caughtError) throw caughtError;` guard would silently fail to rethrow
  // one of those and let this function return a fabricated clean result as if the
  // traversal completed normally (final whole-branch review, Finding 2).
  let caughtError = null;
  let hasCaughtError = false;

  sourceBvh.bvhcast(targetBvh, targetToSourceMatrix, {
    intersectsTriangles(triA, triB) {
      try {
        candidatePairsExamined++;
        // Checked at callback entry AND before every probe (docs/...:2608-2611) --
        // unlike ProperCrossingQuery/SurfaceIntersectionQuery, this is the shared
        // accumulator, checked at the same two granularities but against it.
        if (candidatePairsExamined > candidateBudget || timeExceeded()) {
          aborted = true;
          return true;
        }

        _triA.copy(triA); _triA.needsUpdate = true;
        _triB.copy(triB); _triB.needsUpdate = true;
        _triA.getNormal(_nA);
        _triB.getNormal(_nB);

        const parallel = Math.abs(_nA.dot(_nB)) >= 1 - coplanarAngleEpsilon;
        if (parallel && Math.abs(_nA.dot(_triA.a) - _nA.dot(_triB.a)) <= coplanarSurfaceEpsilon) {
          return false; // coplanar contact is boundary, never interior
        }
        if (!_triA.intersectsTriangle(_triB, _line)) return false;

        crossingPairsExamined++;
        if (crossingPairsExamined > crossingBudget) {
          aborted = true;
          return true;
        }

        _line.getCenter(_mid);
        _line.delta(_segDir);
        if (_segDir.lengthSq() < 1e-20) return false;
        _segDir.normalize();
        _u.crossVectors(_nA, _segDir).normalize(); // in-plane, perpendicular to the segment

        let candidateProducedInPlaneProbe = false;

        for (const sign of [1, -1]) {
          // dAvail: distance from M to THIS triangle's own edge along sign*u, recomputed
          // fresh per candidate -- never a cached per-geometry or canonical-frame scale
          // (docs/...:2568-2583, the round-9 fix).
          const dAvail = availableInPlaneDistance(_triA, _mid, _u, sign);
          if (dAvail <= 0) continue;

          for (const fraction of crossingProbeFractions) {
            if (timeExceeded()) { aborted = true; return true; }

            const delta = fraction * dAvail;
            _probe.copy(_mid).addScaledVector(_u, sign * delta);
            if (!_triA.containsPoint(_probe)) continue; // must stay ON the source triangle
            candidateProducedInPlaneProbe = true;

            _probeInTarget.copy(_probe).applyMatrix4(sourceToTargetMatrix);
            const c = classifyPoint(_probeInTarget, targetBvh, targetLocalDiagonal);
            if (c === 'inside') { witnessFound = true; return true; }
            if (c === 'boundary') sawBoundaryClassification = true;
          }
        }

        // Mirrors ProperCrossingQuery's step 5: a candidate that could never even
        // produce a usable in-triangle probe is inconclusive, not rejected
        // (docs/...:2585-2591).
        if (!candidateProducedInPlaneProbe) sawInconclusiveCandidate = true;
        return false;
      } catch (err) {
        caughtError = err;
        hasCaughtError = true;
        return true; // let bvhcast take its normal-completion path so `_active` clears
      }
    },
  });

  if (hasCaughtError) throw caughtError;

  const finalWitnessFound = aborted ? false : witnessFound;
  const inconclusive = !aborted && !finalWitnessFound && (sawInconclusiveCandidate || sawBoundaryClassification);

  const diagnostics = [];
  if (aborted) diagnostics.push({ reason: 'crossing-budget-exhausted' });
  else if (inconclusive) diagnostics.push({ reason: 'inconclusive-crossing' });

  return {
    witnessFound: finalWitnessFound,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
  };
}

// Distance from `origin` to the triangle's own boundary along `sign * direction`, by
// intersecting the ray with each of the triangle's 3 edges and taking the nearest
// positive-t hit (docs/...:2568-2570).
function availableInPlaneDistance(triangle, origin, direction, sign) {
  const verts = [triangle.a, triangle.b, triangle.c];
  const dir = direction.clone().multiplyScalar(sign);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const p0 = verts[i];
    const p1 = verts[(i + 1) % 3];
    const edge = p1.clone().sub(p0);
    const t = rayEdgeIntersectionT(origin, dir, p0, edge);
    if (t !== null && t > 1e-9 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : 0;
}

// Two coplanar lines: origin + t*dir = edgeStart + s*edgeVec. Both live in the
// triangle's own plane, so their cross products with each other are parallel to the
// shared plane normal n = dir x edgeVec, reducing the solve to two scalar divisions.
function rayEdgeIntersectionT(origin, dir, edgeStart, edgeVec) {
  const n = new THREE.Vector3().crossVectors(dir, edgeVec);
  const denom = n.lengthSq();
  if (denom < 1e-20) return null; // parallel to this edge
  const diff = new THREE.Vector3().subVectors(edgeStart, origin);
  const s = new THREE.Vector3().crossVectors(diff, dir).dot(n) / denom;
  if (s < -1e-9 || s > 1 + 1e-9) return null; // intersection falls outside the edge segment
  return new THREE.Vector3().crossVectors(diff, edgeVec).dot(n) / denom;
}
