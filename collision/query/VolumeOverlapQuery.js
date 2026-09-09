// collision/query/VolumeOverlapQuery.js
//
// Direct replacement for ThreeBSP.intersect(). docs/...:2498-2535.
//
//   volume-overlap(A, B) :=
//         ProperCrossingQuery(A, B)
//      OR ContainmentQuery(anyComponentOf(A) inside B)
//      OR ContainmentQuery(anyComponentOf(B) inside A)
//
// Evaluated in that order with early exit. Both directions are required for
// symmetry; the containment terms are "any component," not "the whole of A."

import * as THREE from 'three';
import { properCrossingQuery } from './ProperCrossingQuery.js';
import { anyComponentInside } from './ContainmentQuery.js';
import { reportDiagnosticEvent } from '../scheduler.js';

const defaultCompareCanonical = () => -1; // always treats `source` as canonical-first

// M2.1 Task 3: transforms a leaf witness (in SOME operand's local frame) into world
// space via that operand's own world matrix, and validates the result is 3 finite
// numbers before it is allowed to leave this module as public plain-data. `_worldPoint`
// is module-level scratch, cloned into a plain array before return -- it never escapes
// this module as a THREE.Vector3. A missing `localPoint` (a leaf witness absent on a
// positive verdict -- currently unreachable given Tasks 1/2's own guarantees, but those
// guarantees live in OTHER files) degrades to `null` here too, the SAME fault-tolerance
// contract as a non-finite result, rather than throwing out of this function and losing
// the whole findClashes call (whole-batch review, Batch 1).
//
// Exported (test-only; NOT re-exported from collision/index.js, so the public library
// surface is unaffected -- same convention as CollisionWorld.js's normalizeNarrowPhaseHit)
// so the missing-localPoint degrade-to-null contract can be asserted directly.
const _worldPoint = new THREE.Vector3();

export function toFiniteWorldArray(localPoint, worldMatrix) {
  if (!localPoint) return null;
  _worldPoint.copy(localPoint).applyMatrix4(worldMatrix);
  const point = [_worldPoint.x, _worldPoint.y, _worldPoint.z];
  return point.every(Number.isFinite) ? point : null;
}

/**
 * @typedef {{ geometry, bvh, localDiagonal, connectivity, closedManifold: boolean, matrix, aspectRatioExceeded?: boolean }} Instance
 * @param {Instance} source - fixed PUBLIC role, used for diagnostic naming; never swapped
 * @param {Instance} target - fixed PUBLIC role, used for diagnostic naming; never swapped
 * @param {{ crossing?: object, containment?: object, scheduler?: object, compareCanonical?: (source: Instance, target: Instance) => number }} [options]
 */
export async function volumeOverlapQuery(source, target, options = {}) {
  // Default scheduler's `elapsedMs()` must report REAL, increasing wall-clock time
  // since this call was entered, matching ContainmentModeQuery's own default-scheduler
  // fix (final whole-branch review, Finding 3). Not independently reachable today --
  // this function never routes anything through SurfaceCrossingWitness -- but kept
  // consistent with the pattern as defense-in-depth against the same trap if that ever
  // changes.
  const t0 = performance.now();
  const defaultScheduler = { elapsedMs: () => performance.now() - t0, checkpointIfDue: async () => {} };
  const scheduler = options.scheduler ?? defaultScheduler;
  // Decides ONLY which operand's fields go first into properCrossingQuery, for
  // correct L_canonical scaling (docs/...:1609-1621) -- NEVER which operand this
  // function calls `source`/`target` for diagnostic role-naming, which stay fixed to
  // the caller's own public arguments throughout (the conflict a Codex spec-review of
  // an earlier draft found: swapping operands for canonical order would otherwise
  // also swap which one gets blamed in a diagnostic). Default: source is always
  // treated as canonical-first, preserving today's behavior for standalone tests;
  // CollisionWorld (a later task) supplies a real comparator once it has
  // (modelId, geometryKey, instanceId) identity.
  const compareCanonical = options.compareCanonical ?? defaultCompareCanonical;
  const [canonicalFirst, canonicalSecond] = compareCanonical(source, target) <= 0 ? [source, target] : [target, source];

  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };
  const mergeDiagnostics = (list) => { for (const d of list) addDiagnostic(d.reason, d.role); };

  // M1 aspect-ratio disposition guard for the crossing term (Batch-2 reconciliation
  // pass; docs/...Tolerances section, "Single-geometry aspect ratio"; see
  // ContainmentQuery.js's updated gate-site comment near its own guard).
  // properCrossingQuery's classifyPoint calls treat BOTH bvhA and bvhB as
  // parity-tested targets -- the identical role anyComponentInside's containerRole
  // plays -- so it needs the identical gate. Checked here against the PUBLIC
  // source/target roles (never canonicalFirst/canonicalSecond: diagnostic
  // role-naming must stay tied to the public roles regardless of canonical order,
  // per this file's own convention -- see the compareCanonical comment above).
  // When gated, properCrossingQuery is never called at all; a synthetic result is
  // substituted so the rest of this function's control flow is unaffected.
  // Task 1.4: optional per-pair diagnostic-event context (Task 1.2's reportDiagnosticEvent
  // mechanism). Additive and gated on options.diagnosticPairContext -- when the caller omits it
  // (every pre-existing caller/test), no event fires and no covariate object is constructed.
  const diagnosticPairContext = options.diagnosticPairContext;
  const triangleCovariates = diagnosticPairContext ? {
    sourceTriangles: source.geometry.index.count / 3,
    targetTriangles: target.geometry.index.count / 3,
    sourceComponents: source.connectivity ? source.connectivity.componentCount : undefined,
    targetComponents: target.connectivity ? target.connectivity.componentCount : undefined,
  } : null;

  let crossing;
  const crossingStartedAt = diagnosticPairContext ? performance.now() : 0;
  if (source.aspectRatioExceeded || target.aspectRatioExceeded) {
    const skippedDiagnostics = [];
    if (source.aspectRatioExceeded) {
      skippedDiagnostics.push({ reason: 'geometry-aspect-ratio-exceeds-tolerance-model', role: 'source' });
    }
    if (target.aspectRatioExceeded) {
      skippedDiagnostics.push({ reason: 'geometry-aspect-ratio-exceeds-tolerance-model', role: 'target' });
    }
    crossing = {
      crossing: false,
      aborted: false,
      inconclusive: true,
      skipped: true,
      diagnostics: skippedDiagnostics,
      stats: { candidatePairsExamined: 0, crossingPairsExamined: 0 },
    };
  } else {
    const canonicalSecondToFirst = canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix);
    crossing = properCrossingQuery(
      canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst,
      canonicalFirst.localDiagonal, canonicalSecond.localDiagonal, options.crossing
    );
  }
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'crossing', ms: performance.now() - crossingStartedAt,
    });
  }

  // NOTE: crossing.diagnostics is deliberately NOT merged here. Per the design spec
  // (docs/...:3858-3862), truncation/coverage diagnostics (which this crossing-term
  // skip diagnostic, and inconclusive-crossing/crossing-budget-exhausted, all are)
  // must never attach to a positive result. It is deferred and merged only on the
  // negative path at the end of this function, once no positive term rescued the
  // overlap.

  if (crossing.crossing) {
    // The crossing path classifies probes against BOTH solids, so both closure
    // preconditions apply regardless of which side the crossing geometrically
    // favored, and regardless of canonical order (docs/...:2378-2383). Neither
    // containment term ran, so this module must check closure directly here, against
    // the PUBLIC roles -- ProperCrossingQuery itself has no notion of "certified
    // closed" or public roles at all.
    if (!source.closedManifold) addDiagnostic('unverified-parity-operand', 'source');
    if (!target.closedManifold) addDiagnostic('unverified-parity-operand', 'target');
    // crossing.witnessPoint is in canonicalFirst's local frame (Task 1) -- transform
    // it into world space via whichever PHYSICAL operand (source/target) resolved to
    // canonicalFirst, never the other one (docs spec Sec 0.3).
    const canonicalFirstIsSource = canonicalFirst === source;
    const worldMatrix = canonicalFirstIsSource ? source.matrix : target.matrix;
    const point = toFiniteWorldArray(crossing.witnessPoint, worldMatrix);
    return {
      overlap: true,
      conclusive: true,
      via: 'crossing',
      diagnostics,
      stats: { crossing: crossing.stats },
      witness: point ? { kind: 'surface-crossing', point } : null,
    };
  }

  // Between-term checkpoint: each term below can individually sit under
  // frameBudgetMs while their SUM does not, so a checkpoint must exist HERE, not only
  // inside anyComponentInside's own sampling loop (the composition-level "must yield
  // between stages, not only between pairs" requirement a Codex spec-review of an
  // earlier draft found this function had no way to satisfy at all).
  await scheduler.checkpointIfDue();

  const sourceToTargetForAinB = target.matrix.clone().invert().multiply(source.matrix);
  const aInBStartedAt = diagnosticPairContext ? performance.now() : 0;
  const aInB = await anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTargetForAinB,
    {
      ...options.containment,
      mode: 'volume-overlap',
      containerRole: 'target',
      sampledRole: 'source',
      scheduler,
      // M1 aspect-ratio gating (docs/superpowers/specs/2026-08-06-collision-library-
      // milestone1-design.md's Tolerances section, "Single-geometry aspect ratio";
      // Tasks 9 & 12 ruling): `target` plays anyComponentInside's containerRole here, so the gate reads
      // TARGET's own aspectRatioExceeded signal.
      targetAspectRatioExceeded: target.aspectRatioExceeded,
    }
  );
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'containment-a-in-b', ms: performance.now() - aInBStartedAt,
      containmentSamplesUsed: aInB.samplesUsed,
    });
  }
  // aInB.diagnostics is deliberately NOT merged here either, for the identical reason
  // as crossing.diagnostics above (codex-review finding on this reconciliation pass):
  // if aInB is a NEGATIVE (e.g. gated by target.aspectRatioExceeded, or a truncated
  // incomplete-component-coverage), merging its diagnostics unconditionally here would
  // taint a SUBSEQUENT bInA positive that has nothing to do with aInB's own failed
  // attempt. Deferred to: immediately below (aInB's own positive, its own
  // diagnostics only), or the final negative path (all three terms' diagnostics).
  if (aInB.inside) {
    mergeDiagnostics(aInB.diagnostics);
    // aInB.witnessPoint is in the CONTAINER's (target's) local frame (Task 2).
    const point = toFiniteWorldArray(aInB.witnessPoint, target.matrix);
    return {
      overlap: true,
      conclusive: true,
      via: 'containment(A in B)',
      diagnostics,
      stats: { crossing: crossing.stats, aInB },
      witness: point ? { kind: 'containment', point } : null,
    };
  }

  await scheduler.checkpointIfDue();

  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
  const bInAStartedAt = diagnosticPairContext ? performance.now() : 0;
  const bInA = await anyComponentInside(
    target.geometry, target.bvh, target.localDiagonal, target.connectivity,
    source.bvh, source.localDiagonal, source.closedManifold,
    targetToSource,
    {
      ...options.containment,
      mode: 'volume-overlap',
      containerRole: 'source',
      sampledRole: 'target',
      scheduler,
      // Here `source` plays anyComponentInside's containerRole, so the gate reads
      // SOURCE's own aspectRatioExceeded signal.
      targetAspectRatioExceeded: source.aspectRatioExceeded,
    }
  );
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'containment-b-in-a', ms: performance.now() - bInAStartedAt,
      containmentSamplesUsed: bInA.samplesUsed,
    });
  }
  // bInA.diagnostics is likewise deliberately NOT merged here (same reasoning as
  // aInB above, codex-review finding on this reconciliation pass): a bInA NEGATIVE
  // must not taint anything, and there is no later positive term for it to leak into
  // here anyway (bInA is the last term) -- but merging unconditionally on this shared
  // codepath would be inconsistent with aInB's own now-deferred merge and easy to
  // regress. Deferred to: immediately below (bInA's own positive, its own
  // diagnostics only), or the final negative path (all three terms' diagnostics).
  if (bInA.inside) {
    mergeDiagnostics(bInA.diagnostics);
    // bInA.witnessPoint is in the CONTAINER's (source's) local frame (Task 2).
    const point = toFiniteWorldArray(bInA.witnessPoint, source.matrix);
    return {
      overlap: true,
      conclusive: true,
      via: 'containment(B in A)',
      diagnostics,
      stats: { crossing: crossing.stats, aInB, bInA },
      witness: point ? { kind: 'containment', point } : null,
    };
  }

  // Negative: no positive term rescued this call, so none of the three terms'
  // diagnostics could taint a positive result -- merge all of them now.
  // crossing.diagnostics, aInB.diagnostics, and bInA.diagnostics were all
  // deliberately withheld above for exactly this reason (docs/...:3858-3862:
  // truncation/coverage diagnostics must never attach to a positive). Both
  // containment terms also already self-report unverified-parity-operand for their
  // own container role unconditionally (docs/...:2367-2389) -- included in this
  // merge like any other diagnostic. Any unresolved component makes this a DIAGNOSED
  // negative, never a clean one (docs/...:2526-2534).
  mergeDiagnostics(crossing.diagnostics);
  mergeDiagnostics(aInB.diagnostics);
  mergeDiagnostics(bInA.diagnostics);

  if (aInB.unresolvedComponentCount > 0 || bInA.unresolvedComponentCount > 0) {
    addDiagnostic('inconclusive-containment');
  }

  // M3 Task 6: authoritative conclusive flag (docs/superpowers/sdd/2026-09-08-
  // collision-library-milestone3-clearance-implementation/task-6-brief.md). A negative
  // is conclusive only when the crossing term fully resolved (never aborted/
  // inconclusive), both containment terms sampled every component
  // (unresolvedComponentCount === 0), and neither containment term's own diagnostics
  // carry a non-manifold-component or unverified-parity-operand taint -- both of which
  // can occur even when sampling itself fully resolved (a component classified cleanly
  // but flagged non-manifold, or a container never certified closed).
  const crossingConclusive = !(crossing.aborted || crossing.inconclusive);
  const containmentConclusive = aInB.unresolvedComponentCount === 0 && bInA.unresolvedComponentCount === 0;
  const taintedByNonManifoldOrUnverified = diagnostics.some(
    (d) => d.reason === 'non-manifold-component' || d.reason === 'unverified-parity-operand',
  );
  const conclusive = crossingConclusive && containmentConclusive && !taintedByNonManifoldOrUnverified;

  // Task 1.5: bounded, additive cause set. `crossing.inconclusive` alone conflates two situations
  // ProperCrossingQuery.js:166-171 already distinguishes: an ABORTED traversal
  // ('crossing-budget-exhausted') vs. one that ran to completion but saw an ambiguous boundary
  // probe ('crossing-tolerance-ambiguous', not a budget problem -- and not the aspect-ratio-exceeded
  // synthetic skip branch above, which also sets `crossing.inconclusive` but is its own distinct
  // cause, keyed off `crossing.skipped`). 'unverified-parity-operand' and 'non-manifold-component'
  // are grouped under 'non-manifold-component' -- the same taint category
  // `taintedByNonManifoldOrUnverified` above already treats as one condition for `conclusive`.
  //
  // `unresolved-containment` deliberately does NOT use a bare `unresolvedComponentCount > 0` check
  // (codex-advisor-verified fix during this task, over an earlier draft that did): when a term's OWN
  // `aspectRatioExceeded` gates its containerRole (options.targetAspectRatioExceeded in
  // ContainmentQuery.js), `anyComponentInside` short-circuits BEFORE its sampling loop and reports
  // the FULL remaining component count as "unresolved" -- with `budgetExhausted: false` -- even
  // though nothing was ever sampled. That count is already fully explained by the
  // 'aspect-ratio-exceeded' cause above; counting it again here would double-report the same root
  // cause under two names (verified: this early-return and the sampling-budget-exhaustion path are
  // mutually exclusive within one anyComponentInside call, so a term can be gated XOR genuinely
  // budget/witness-unresolved, never both). Detected via each term's own reported diagnostics
  // (`geometry-aspect-ratio-exceeds-tolerance-model`) rather than re-deriving from
  // source/target.aspectRatioExceeded directly, since aInB and bInA read the OPPOSITE operand's flag
  // for their own containerRole (aInB's containerRole is target, bInA's is source) -- checking each
  // term's own diagnostics keeps this local and immune to that reversed mapping.
  const isAspectGated = (term) => term.diagnostics.some((d) => d.reason === 'geometry-aspect-ratio-exceeds-tolerance-model');
  const inconclusiveCauses = new Set();
  if (!conclusive) {
    if (crossing.aborted) inconclusiveCauses.add('crossing-budget-exhausted');
    if (crossing.inconclusive && !crossing.aborted && !crossing.skipped) inconclusiveCauses.add('crossing-tolerance-ambiguous');
    if (source.aspectRatioExceeded || target.aspectRatioExceeded) inconclusiveCauses.add('aspect-ratio-exceeded');
    if (aInB.budgetExhausted || bInA.budgetExhausted) inconclusiveCauses.add('containment-sample-budget-exhausted');
    if (taintedByNonManifoldOrUnverified) inconclusiveCauses.add('non-manifold-component');
    if ((aInB.unresolvedComponentCount > 0 && !isAspectGated(aInB)) || (bInA.unresolvedComponentCount > 0 && !isAspectGated(bInA))) {
      inconclusiveCauses.add('unresolved-containment');
    }
  }

  return {
    overlap: false,
    conclusive,
    diagnostics,
    inconclusiveCauses: [...inconclusiveCauses].sort(),
    containmentSamplesUsed: aInB.samplesUsed + bInA.samplesUsed,
    stats: { crossing: crossing.stats, aInB, bInA },
  };
}
