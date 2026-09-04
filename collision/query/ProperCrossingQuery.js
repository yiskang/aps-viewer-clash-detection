// collision/query/ProperCrossingQuery.js
//
// Answers "do these two solids share positive volume near their contact" -- not
// merely touching. docs/...:1848-2093.

import { ExtendedTriangle } from 'three-mesh-bvh';
import * as THREE from 'three';
import { classifyPoint } from './ContainmentQuery.js';
import {
  coplanarAngleEpsilon,
  surfaceEpsilonFactor,
  offsetLadderFactors,
  maxCandidatePairsExamined,
  maxCrossingPairsExamined,
  frameBudgetMs,
} from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();
const _line = new THREE.Line3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _probeInB = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();

/**
 * @param {import('three-mesh-bvh').MeshBVH} bvhA - treated as the canonically-first operand (docs/...:1609-1621)
 * @param {import('three-mesh-bvh').MeshBVH} bvhB
 * @param {import('three').Matrix4} matrixBtoA - maps B's local space into A's local space
 * @param {number} localDiagonalA - L_A; also used as L_canonical for offsetLadder scaling
 * @param {number} localDiagonalB - L_B
 * @param {{ maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number, frameBudgetMs?: number, now?: () => number }} [options]
 */
export function properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const crossingBudget = options.maxCrossingPairsExamined ?? maxCrossingPairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;
  const now = options.now ?? (() => performance.now());

  // Private, traversal-local clock (docs/...:1932-1957) -- the one documented
  // exception to the shared-accumulator convention (Round 21's H-B7). Its own worst
  // case is bounded starting fresh at THIS traversal's own entry, independent of
  // whatever else ran earlier in the same findClashes call.
  const traversalStart = now();

  // offsetLadder is scaled by L_canonical = L of whichever operand sorts first
  // (docs/...:1609-1621); the caller is responsible for passing that operand as A.
  const ladder = offsetLadderFactors.map((f) => f * localDiagonalA);
  const surfaceEpsilon = surfaceEpsilonFactor * localDiagonalA;
  const matrixAtoB = matrixBtoA.clone().invert();

  let candidatePairsExamined = 0;
  let crossingPairsExamined = 0;
  let crossing = false;
  let aborted = false;
  let sawBoundaryProbe = false;

  bvhA.bvhcast(bvhB, matrixBtoA, {
    intersectsTriangles(triA, triB) {
      candidatePairsExamined++;
      // Entry-granularity is adequate for a raw candidate that never reaches probe
      // classification (~0.3us/pair, docs/...:1974-1976).
      if (candidatePairsExamined > candidateBudget || now() - traversalStart > timeBudgetMs) {
        aborted = true;
        return true;
      }

      _triA.copy(triA); _triA.needsUpdate = true;
      _triB.copy(triB); _triB.needsUpdate = true;
      _triA.getNormal(_nA);
      _triB.getNormal(_nB);

      // Classify the candidate before doing anything else, ordered so the upstream
      // coplanar-warning path is never entered (docs/...:1874-1891).
      const parallel = Math.abs(_nA.dot(_nB)) >= 1 - coplanarAngleEpsilon;
      const coplanar = parallel && Math.abs(_nA.dot(_triA.a) - _nA.dot(_triB.a)) <= surfaceEpsilon;

      if (coplanar) {
        // Call WITHOUT a target line: a coplanar pair has zero-volume contact --
        // not a crossing regardless of whether it touches -- and omitting the
        // argument is what avoids ExtendedTriangle's coplanar-target warning.
        _triA.intersectsTriangle(_triB);
        return false;
      }

      // Must test explicitly: a non-intersecting pair leaves _line holding the
      // PREVIOUS confirmed pair's endpoints, which would fabricate a crossing from
      // stale state if read without this guard (docs/...:1859-1873, round-4 regression).
      if (!_triA.intersectsTriangle(_triB, _line)) return false;

      crossingPairsExamined++;
      if (crossingPairsExamined > crossingBudget) {
        aborted = true;
        return true;
      }

      _line.getCenter(_mid);

      for (const s1 of [1, -1]) {
        for (const s2 of [1, -1]) {
          _dir.copy(_nA).multiplyScalar(s1).addScaledVector(_nB, s2);
          if (_dir.lengthSq() < 1e-20) continue; // degenerate: parallel normals
          _dir.normalize();

          for (const delta of ladder) {
            // Round-11 fix: performance.now() read before EVERY individual probe,
            // not once per callback and not once per confirmed pair
            // (docs/...:1966-1989) -- bounds overshoot to one probe's cost (up to
            // two classifyPoint calls), not one confirmed pair's cost (up to 24).
            if (now() - traversalStart > timeBudgetMs) {
              aborted = true;
              return true;
            }

            _probe.copy(_mid).addScaledVector(_dir, delta);

            const inA = classifyPoint(_probe, bvhA, localDiagonalA);
            if (inA === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inA !== 'inside') continue;

            _probeInB.copy(_probe).applyMatrix4(matrixAtoB);
            const inB = classifyPoint(_probeInB, bvhB, localDiagonalB);
            if (inB === 'boundary') { sawBoundaryProbe = true; continue; }
            if (inB === 'inside') {
              crossing = true;
              return true; // early exit on first proper crossing
            }
          }
        }
      }
      return false;
    },
  });

  // Abort protocol: bvhcast returning true on abort must never be read as a crossing
  // (docs/...:1926-1930).
  const finalCrossing = aborted ? false : crossing;
  const inconclusive = !aborted && !finalCrossing && sawBoundaryProbe;

  const diagnostics = [];
  if (aborted) diagnostics.push({ reason: 'crossing-budget-exhausted' });
  else if (inconclusive) diagnostics.push({ reason: 'inconclusive-crossing' });

  return {
    crossing: finalCrossing,
    aborted,
    inconclusive,
    diagnostics,
    stats: { candidatePairsExamined, crossingPairsExamined },
  };
}
