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
  maxProbeClassificationsPerCrossingPair,
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
 * The ONE place the crossing term's `stats` shape is constructed, used by this file's real
 * traversal AND by VolumeOverlapQuery's aspect-ratio skip branch, so the two can never drift
 * (design Sec 5.2a). Returns a FRESH plain object every call -- never a shared or frozen
 * singleton -- so no two results can alias one another's stats.
 *
 * The defaults ARE the skip-path row of Sec 5.2a's table, specified rather than inferred:
 * every counter 0, `exhaustedBudget` null, `timeBudgetExceeded` false, and -- deliberately --
 * `elapsedMs: null` rather than `0`. A fabricated zero-duration measurement would pollute any
 * span distribution computed over these events; consumers must read `null` as NOT MEASURED.
 *
 * Exported test-only, NOT re-exported from collision/index.js, so the public library surface is
 * unaffected -- the same convention as VolumeOverlapQuery's own `toFiniteWorldArray`.
 *
 * @param {Partial<{candidatePairsExamined:number, crossingPairsExamined:number,
 *   pointClassifications:number, exhaustedBudget:null|'candidate-pairs'|'crossing-pairs'|'point-classifications',
 *   elapsedMs:number|null, timeBudgetExceeded:boolean}>} [overrides]
 */
export function createCrossingStats(overrides = {}) {
  return {
    candidatePairsExamined: 0,
    crossingPairsExamined: 0,
    pointClassifications: 0,
    exhaustedBudget: null,
    elapsedMs: null,
    timeBudgetExceeded: false,
    ...overrides,
  };
}

/**
 * @param {import('three-mesh-bvh').MeshBVH} bvhA - treated as the canonically-first operand (docs/...:1609-1621)
 * @param {import('three-mesh-bvh').MeshBVH} bvhB
 * @param {import('three').Matrix4} matrixBtoA - maps B's local space into A's local space
 * @param {number} localDiagonalA - L_A; also used as L_canonical for offsetLadder scaling
 * @param {number} localDiagonalB - L_B
 * @param {{ maxCandidatePairsExamined?: number, maxCrossingPairsExamined?: number,
 *   maxCrossingPointClassifications?: number, frameBudgetMs?: number, now?: () => number,
 *   __classifyPoint?: typeof classifyPoint }} [options]
 */
export function properCrossingQuery(bvhA, bvhB, matrixBtoA, localDiagonalA, localDiagonalB, options = {}) {
  const candidateBudget = options.maxCandidatePairsExamined ?? maxCandidatePairsExamined;
  const crossingBudget = options.maxCrossingPairsExamined ?? maxCrossingPairsExamined;
  // Derived from the EFFECTIVE crossing-pair budget, not from the shipped constant, so the design's
  // "non-binding by construction" guarantee (Sec 4.3) holds for every caller rather than only for
  // callers using the shipped 64. With the shipped budget this is exactly 64 x 24 = 1536, the value
  // `maxCrossingPointClassifications` names in constants.js; with a RAISED
  // `options.maxCrossingPairsExamined` it scales with it, so raising the pair budget can never make
  // a traversal search less geometry than the same override bought before this cap existed. See
  // constants.js for the codex-review finding that produced this.
  const pointClassificationBudget = options.maxCrossingPointClassifications
    ?? crossingBudget * maxProbeClassificationsPerCrossingPair;
  const timeBudgetMs = options.frameBudgetMs ?? frameBudgetMs;
  const now = options.now ?? (() => performance.now());
  // INTERNAL TEST SEAM ONLY (design Sec 13 G), never supplied by production code and documented
  // alongside options.now / options.yieldToScheduler under collision/README.md's "internal test
  // seams ... not part of the supported developer API" declaration. It exists because it is the
  // only injection point for work performed INSIDE intersectsTriangles: now that the wall clock
  // has left the callback (Phase C), a throwing clock can no longer prove the callback-exception
  // containment protocol below, and a test rewritten to use one would silently stop exercising it.
  const classify = options.__classifyPoint ?? classifyPoint;

  // TELEMETRY ONLY, from Phase C onward (design Sec 2.1, Sec 9.1a). This traversal-local clock
  // used to be SEMANTIC -- it fed two abort branches, one at callback entry and one before every
  // probe, and `aborted` forces the geometric verdict to false, so a genuinely-proven crossing was
  // suppressed whenever the machine happened to be slow at that instant. Both branches are gone;
  // exactly two reads remain, this one and the exit read after bvhcast returns, and neither can
  // reach a semantic field. Sec 2.2 rows 5-6: a wall-clock breach annotates, it never decides.
  //
  // Fault-isolated per Sec 9.1a item 1: an observational dependency must not control AVAILABILITY
  // any more than it controls the verdict, so a throwing / non-finite `now()` degrades
  // `traversalStart` to null (=> `elapsedMs: null`, `timeBudgetExceeded: false`) instead of
  // propagating out and losing an already-computable geometric result. Isolating THIS read is only
  // possible now: while it was still semantic (Phase A), a null baseline would have made
  // `now() - null` NaN and silently changed every abort decision.
  let traversalStart = null;
  try {
    const entry = now();
    if (Number.isFinite(entry)) traversalStart = entry;
  } catch {
    // swallowed on purpose: telemetry must never withhold a geometric result
  }

  // offsetLadder is scaled by L_canonical = L of whichever operand sorts first
  // (docs/...:1609-1621); the caller is responsible for passing that operand as A.
  const ladder = offsetLadderFactors.map((f) => f * localDiagonalA);
  const surfaceEpsilon = surfaceEpsilonFactor * localDiagonalA;
  const matrixAtoB = matrixBtoA.clone().invert();

  let candidatePairsExamined = 0;
  let crossingPairsExamined = 0;
  // Counter 3 (design Sec 4.2): the traversal's DOMINANT cost tier. Tier-B candidate pair tests
  // cost ~0.3us each; a classifyPoint is one closestPointToPoint plus up to three full DoubleSide
  // raycasts -- roughly two orders of magnitude more. Reset here, at the same traversal-local
  // scope as the other two.
  let pointClassifications = 0;
  // Which deterministic cap terminated the traversal, or null. A single scalar, not a set: the
  // first cap reached terminates the cast, so exactly one is ever attributable.
  //
  // Post-Phase-C INVARIANT: `aborted === true` if and only if `exhaustedBudget !== null`. The
  // three deterministic caps below are now the ONLY terminators -- nothing else sets `aborted` --
  // so an abort is always reproducible, always attributable to one named budget, and always
  // identical across runs and across the TLAS/linear arms for identical operands (Sec 5.1).
  let exhaustedBudget = null;
  let crossing = false;
  let aborted = false;
  let sawBoundaryProbe = false;
  let witnessPoint;

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
        candidatePairsExamined++;
        // Deterministic tier-B terminator, and the ONLY check at callback entry. Phase C deleted
        // the `|| now() - traversalStart > timeBudgetMs` clause that used to share this condition
        // (design Sec 1.2 site 1, Sec 14.0 row C, "Required implementation tasks" item 7): a
        // wall-clock deadline must never set `aborted`, because `aborted` forces the geometric
        // verdict to false three lines from the bottom of this function. Deleting it also removes
        // up to 50,000 clock reads per traversal (~1-2.5 ms of pure `performance.now()` cost at
        // the cap, Sec 9.2), so the semantic fix is a small speedup rather than a cost.
        if (candidatePairsExamined > candidateBudget) {
          aborted = true;
          exhaustedBudget = 'candidate-pairs';
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
          exhaustedBudget = 'crossing-pairs';
          return true;
        }

        _line.getCenter(_mid);

        for (const s1 of [1, -1]) {
          for (const s2 of [1, -1]) {
            _dir.copy(_nA).multiplyScalar(s1).addScaledVector(_nB, s2);
            if (_dir.lengthSq() < 1e-20) continue; // degenerate: parallel normals
            _dir.normalize();

            for (const delta of ladder) {
              // Phase C deleted the whole per-probe wall-clock check that used to stand here
              // (design Sec 1.2 site 2, "Required implementation tasks" item 7 -- the round-11
              // "read the clock before EVERY individual probe" refinement). It was the finest
              // granularity of the same defect: it bounded the OVERSHOOT of a timing-driven abort
              // without making the abort any less timing-driven, and an abort suppresses a
              // crossing that a not-yet-executed probe would have proven. The deterministic
              // pointClassifications terminator immediately below replaces it at exactly the
              // same granularity, one probe, with no clock.
              _probe.copy(_mid).addScaledVector(_dir, delta);

              // Deterministic tier-C terminator (design Sec 4.2), and from Phase C onward the
              // ONLY per-probe terminator. Checked BEFORE the call, not after, so the cap is
              // REACHED and never exceeded -- `pointClassifications` tops out at exactly the
              // budget, unlike the two increment-then-strict-`>` counters above which top out at
              // budget+1. Non-binding at the shipped 1536 = 64 x 24 structural maximum: it cannot
              // fire on any traversal the pre-fix code would have completed, so removing the wall
              // clock strictly widens completeness and never narrows the search envelope
              // (Sec 4.3's governing principle).
              if (pointClassifications >= pointClassificationBudget) {
                aborted = true;
                exhaustedBudget = 'point-classifications';
                return true;
              }
              pointClassifications++;
              const inA = classify(_probe, bvhA, localDiagonalA);
              if (inA === 'boundary') { sawBoundaryProbe = true; continue; }
              if (inA !== 'inside') continue;

              _probeInB.copy(_probe).applyMatrix4(matrixAtoB);
              if (pointClassifications >= pointClassificationBudget) {
                aborted = true;
                exhaustedBudget = 'point-classifications';
                return true;
              }
              pointClassifications++;
              const inB = classify(_probeInB, bvhB, localDiagonalB);
              if (inB === 'boundary') { sawBoundaryProbe = true; continue; }
              if (inB === 'inside') {
                crossing = true;
                witnessPoint = _probe.clone(); // owned clone -- _probe is module-level scratch, reused on every call
                return true; // early exit on first proper crossing
              }
            }
          }
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

  // TELEMETRY ONLY (design Sec 9.1a). Placed AFTER the rethrow above deliberately: the
  // callback-exception path produces no result for telemetry to annotate (Sec 2.2 row 8, "no
  // result"), and doing observational work after a terminal callback failure would also perturb
  // the injected-clock call counts the existing containment tests depend on.
  //
  // Fault-isolated, because an observational dependency must never control AVAILABILITY any more
  // than it controls the verdict: a throwing `now()` here would lose an already-proven crossing.
  // Same degrade-to-null contract this codebase already applies to VolumeOverlapQuery's
  // toFiniteWorldArray, reused rather than invented. `elapsedMs` survives only if the read
  // succeeded AND the span is finite and non-negative, so a NaN/Infinity clock and a
  // backward-moving clock both degrade too. The failure stays VISIBLE as null -- consumers read
  // null as "not measured", never as zero -- and `timeBudgetExceeded` is never true on the
  // strength of an unvalidated value.
  //
  // The two reads are isolated INDEPENDENTLY, each validated on its own, and the span is computed
  // only once both survived (Sec 9.1a items 1-2: "both telemetry clock reads are individually
  // fault-isolated"; "emitted only if both reads succeeded AND exit - entry is finite and >= 0").
  // Short-circuiting the exit read on a failed entry read would produce the same returned stats,
  // but it would make the second read's isolation untested and untrue.
  let traversalEnd = null;
  try {
    const exit = now();
    if (Number.isFinite(exit)) traversalEnd = exit;
  } catch {
    // swallowed on purpose: telemetry must never withhold a geometric result
  }
  let elapsedMs = null;
  if (traversalStart !== null && traversalEnd !== null) {
    const span = traversalEnd - traversalStart;
    if (Number.isFinite(span) && span >= 0) elapsedMs = span;
  }
  const timeBudgetExceeded = elapsedMs !== null && elapsedMs > timeBudgetMs;

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
    stats: createCrossingStats({
      candidatePairsExamined,
      crossingPairsExamined,
      pointClassifications,
      exhaustedBudget,
      elapsedMs,
      timeBudgetExceeded,
    }),
    witnessPoint,
  };
}
