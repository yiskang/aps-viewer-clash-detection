// collision/query/SurfaceIntersectionQuery.js
//
// True iff any triangle pair from A/B has a non-empty geometric intersection,
// including zero-volume coincident contact (face-face, edge-edge, vertex-face).
// Correctly named: it reports touching too. docs/...:1814-1846.
//
// Built on bvhcast, not MeshBVH.intersectsGeometry -- verified at three-mesh-bvh@0.9.14
// that intersectsGeometry accepts no budget and offers no abort hook, making it the
// last unbounded synchronous path a review pass found. This is the SAME traversal
// ProperCrossingQuery uses, same maxCandidatePairsExamined ceiling, same abort
// protocol (including the private traversal-local time trigger), with a weaker
// predicate: no coplanar split (coplanar contact IS intersection here) and no probe
// ladder (no interior classification, hence no parity, hence no closure precondition).
// docs/...:1834-1846.

import { ExtendedTriangle } from 'three-mesh-bvh';
import { maxCandidatePairsExamined, frameBudgetMs } from '../constants.js';

const _triA = new ExtendedTriangle();
const _triB = new ExtendedTriangle();

/**
 * @param {import('three-mesh-bvh').MeshBVH} bvhA
 * @param {import('three-mesh-bvh').MeshBVH} bvhB
 * @param {import('three').Matrix4} matrixBtoA - maps B's local space into A's local space
 * @param {{ maxCandidatePairsExamined?: number, frameBudgetMs?: number, now?: () => number }} [options]
 */
export function surfaceIntersectionQuery(bvhA, bvhB, matrixBtoA, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;
  const now = options.now ?? (() => performance.now());

  // Private, traversal-local clock (docs/...:1932-1957, 2065-2077) -- the same
  // deliberate exception to the shared-accumulator convention ProperCrossingQuery
  // uses, admitted for the identical reason: bvhcast cannot pause/resume mid-call,
  // so this traversal's own worst case must be self-bounded, not a function of
  // whatever else already ran in the same findClashes call.
  const traversalStart = now();

  let candidatePairsExamined = 0;
  let intersects = false;
  let aborted = false;

  // Callback-exception containment: the pinned three-mesh-bvh's bvhcast sets a
  // module-global `_active` flag true at entry and clears it only on its
  // normal-completion path (no try/finally). If intersectsTriangles were allowed to
  // throw straight out of bvhcast, `_active` would stay stuck true and permanently
  // break every LATER bvhcast-based query in the process ("Recursive calls to bvhcast
  // not supported") until reload. So: catch everything inside the callback, save it,
  // return true so bvhcast still exits via its normal-completion path and clears its
  // internal state, then rethrow once bvhcast has actually returned.
  //
  // `hasCaughtError` is a SEPARATE flag from `caughtError` itself -- JS permits
  // `throw null`/`throw 0`/`throw undefined`/`throw ''`/`throw false`, all falsy, so a
  // plain `if (caughtError) throw caughtError;` guard would silently fail to rethrow
  // one of those and let this function return a fabricated clean result as if the
  // traversal completed normally (final whole-branch review, Finding 2).
  let caughtError = null;
  let hasCaughtError = false;

  bvhA.bvhcast(bvhB, matrixBtoA, {
    intersectsTriangles(triA, triB) {
      try {
        // Counts callbacks ENTERED, not triangle pairs actually geometrically tested --
        // the increment happens before the budget check below, so an abort on the
        // (budget+1)th callback still reports candidatePairsExamined === budget+1 even
        // though intersectsTriangle is never called for that pair. This is the same
        // entry-counting convention ProperCrossingQuery's shared budget protocol uses;
        // stats.candidatePairsExamined is a ceiling on callback invocations, not a
        // literal "pairs tested" count.
        candidatePairsExamined++;
        // Checked at callback entry only -- no probe loop exists in this mode, so
        // entry-granularity is both adequate and the only granularity there is
        // (docs/...:2069-2074, "applies unchanged to a traversal with no probe loop").
        if (candidatePairsExamined > candidateBudget || now() - traversalStart > timeBudgetMs) {
          aborted = true;
          return true;
        }

        _triA.copy(triA); _triA.needsUpdate = true;
        _triB.copy(triB); _triB.needsUpdate = true;

        // No target line requested -- coplanar contact IS an intersection here, so no
        // coplanar split is needed, and omitting the argument avoids
        // ExtendedTriangle's coplanar-target warning regardless (docs/...:1838-1840).
        if (_triA.intersectsTriangle(_triB)) {
          intersects = true;
          return true;
        }
        return false;
      } catch (err) {
        caughtError = err;
        hasCaughtError = true;
        return true; // let bvhcast take its normal-completion path so `_active` clears
      }
    },
  });

  if (hasCaughtError) throw caughtError;

  // bvhcast returns true on abort too (the only way to stop it early) -- reading that
  // as a hit would fabricate a result out of a timeout (docs/...:1926-1930).
  const finalIntersects = aborted ? false : intersects;

  return {
    intersects: finalIntersects,
    aborted,
    diagnostics: aborted ? [{ reason: 'crossing-budget-exhausted' }] : [],
    stats: { candidatePairsExamined },
  };
}
