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

import { properCrossingQuery } from './ProperCrossingQuery.js';
import { anyComponentInside } from './ContainmentQuery.js';

const defaultCompareCanonical = () => -1; // always treats `source` as canonical-first

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

  const canonicalSecondToFirst = canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix);
  const crossing = properCrossingQuery(
    canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst,
    canonicalFirst.localDiagonal, canonicalSecond.localDiagonal, options.crossing
  );
  mergeDiagnostics(crossing.diagnostics);

  if (crossing.crossing) {
    // The crossing path classifies probes against BOTH solids, so both closure
    // preconditions apply regardless of which side the crossing geometrically
    // favored, and regardless of canonical order (docs/...:2378-2383). Neither
    // containment term ran, so this module must check closure directly here, against
    // the PUBLIC roles -- ProperCrossingQuery itself has no notion of "certified
    // closed" or public roles at all.
    if (!source.closedManifold) addDiagnostic('unverified-parity-operand', 'source');
    if (!target.closedManifold) addDiagnostic('unverified-parity-operand', 'target');
    return { overlap: true, via: 'crossing', diagnostics, stats: { crossing: crossing.stats } };
  }

  // Between-term checkpoint: each term below can individually sit under
  // frameBudgetMs while their SUM does not, so a checkpoint must exist HERE, not only
  // inside anyComponentInside's own sampling loop (the composition-level "must yield
  // between stages, not only between pairs" requirement a Codex spec-review of an
  // earlier draft found this function had no way to satisfy at all).
  await scheduler.checkpointIfDue();

  const sourceToTargetForAinB = target.matrix.clone().invert().multiply(source.matrix);
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
  mergeDiagnostics(aInB.diagnostics);

  if (aInB.inside) {
    return { overlap: true, via: 'containment(A in B)', diagnostics, stats: { crossing: crossing.stats, aInB } };
  }

  await scheduler.checkpointIfDue();

  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
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
  mergeDiagnostics(bInA.diagnostics);

  if (bInA.inside) {
    return { overlap: true, via: 'containment(B in A)', diagnostics, stats: { crossing: crossing.stats, aInB, bInA } };
  }

  // Negative: both containment terms already self-report unverified-parity-operand
  // for their own container role unconditionally (docs/...:2367-2389), merged above
  // -- so a negative here already carries every applicable parity diagnostic without
  // re-derivation. Any unresolved component makes this a DIAGNOSED negative, never a
  // clean one (docs/...:2526-2534).
  if (aInB.unresolvedComponentCount > 0 || bInA.unresolvedComponentCount > 0) {
    addDiagnostic('inconclusive-containment');
  }

  return {
    overlap: false,
    diagnostics,
    stats: { crossing: crossing.stats, aInB, bInA },
  };
}
