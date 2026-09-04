// collision/query/ContainmentModeQuery.js
//
// The public `containment` mode. docs/...:2536-2564.
//
//   containment(A, B) :=
//         ContainmentQuery(anyComponentOf(A) inside B)   // a source VERTEX inside B
//      OR SurfaceCrossingWitness(A, B)                   // a point on a source TRIANGLE inside B
//
// One direction only, no bidirectional evaluation -- volume-overlap is symmetric,
// containment is a directed question about a source surface and a target solid.

import { anyComponentInside } from './ContainmentQuery.js';
import { surfaceCrossingWitness } from './SurfaceCrossingWitness.js';

/**
 * @typedef {{ geometry, bvh, localDiagonal, connectivity, closedManifold: boolean, matrix, aspectRatioExceeded?: boolean }} Instance
 * @param {Instance} source
 * @param {Instance} target
 * @param {{ containment?: object, witness?: object, scheduler?: object }} [options]
 */
export async function containmentModeQuery(source, target, options = {}) {
  // Default scheduler's `elapsedMs()` must report REAL, increasing wall-clock time
  // since this call was entered -- SurfaceCrossingWitness has no private clock of its
  // own by design (it reads only `scheduler.elapsedMs()`), so an always-0 default
  // scheduler makes frameBudgetMs inert for the witness term on any standalone call
  // with no injected scheduler (final whole-branch review, Finding 3).
  const t0 = performance.now();
  const defaultScheduler = { elapsedMs: () => performance.now() - t0, checkpointIfDue: async () => {} };
  const scheduler = options.scheduler ?? defaultScheduler;
  const diagnostics = [];
  const addDiagnostic = (reason, role) => {
    if (!diagnostics.some((d) => d.reason === reason && d.role === role)) {
      diagnostics.push(role ? { reason, role } : { reason });
    }
  };
  const mergeDiagnostics = (list) => { for (const d of list) addDiagnostic(d.reason, d.role); };

  const sourceToTarget = target.matrix.clone().invert().multiply(source.matrix);

  // First term: vertex sampling, stages 1-2 ONLY -- stage 3's constructed interior
  // witness would answer volume-overlap's question, not this mode's surface-only
  // contract (docs/...:2547-2553).
  const vertexTerm = await anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity,
    target.bvh, target.localDiagonal, target.closedManifold,
    sourceToTarget,
    {
      ...options.containment,
      mode: 'containment',
      containerRole: 'target',
      sampledRole: 'source',
      scheduler,
      // M1 aspect-ratio gating (docs/superpowers/specs/2026-08-06-collision-library-
      // milestone1-design.md's Tolerances section, "Single-geometry aspect ratio";
      // progress.md's "Ruling: maxLocalAspectRatio/aspectRatioExceeded gating" entry,
      // Tasks 9 & 12 only): `target` plays anyComponentInside's containerRole here, so the gate
      // reads TARGET's own aspectRatioExceeded signal. This is a pure pass-through --
      // anyComponentInside (Task 9) already owns the actual short-circuit/gating logic.
      targetAspectRatioExceeded: target.aspectRatioExceeded,
    }
  );
  mergeDiagnostics(vertexTerm.diagnostics);

  if (vertexTerm.inside) {
    return { contained: true, via: 'vertex', diagnostics, stats: { vertexTerm } };
  }

  // M1 aspect-ratio gating, second of the two spec-required gate sites (this task's
  // own target role -- SurfaceCrossingWitness/Task 10 has no aspect-ratio parameter of
  // its own and is NOT a gate site; this module is responsible for gating this term
  // itself). `target.aspectRatioExceeded` is a single fixed property of `target` for
  // the whole call, checked ONCE here -- deliberately BEFORE the between-term
  // checkpoint below: if the witness term isn't going to run at all, there is no
  // second stage left to checkpoint between (codex-advisor medium review of this
  // task's draft: an unconditional checkpoint here would yield/await for no remaining
  // geometry work whenever this gate fires).
  let witnessTerm;
  if (target.aspectRatioExceeded) {
    addDiagnostic('geometry-aspect-ratio-exceeds-tolerance-model', 'target');
    witnessTerm = { skipped: true, reason: 'geometry-aspect-ratio-exceeds-tolerance-model' };
  } else {
    // Between-term checkpoint -- the same composition-level gap Task 11 closes: the
    // vertex term and the witness traversal below can each individually sit under
    // frameBudgetMs while their SUM does not. Threading the SAME `scheduler` into
    // SurfaceCrossingWitness below (as its own `elapsedMs()` source) is what lets an
    // earlier yield HERE be visible to that traversal's own time check, rather than it
    // measuring from a stale baseline captured before this yield happened.
    await scheduler.checkpointIfDue();

    // Second term is NOT optional (round 7 shipped without it, docs/...:2555-2564):
    // a source straddling target's boundary with no vertex inside it -- a duct through
    // a beam, a lone triangle through a room -- returns a clean false from the vertex
    // term alone, at any sample count.
    const targetToSource = sourceToTarget.clone().invert();
    witnessTerm = surfaceCrossingWitness(
      source.bvh, target.bvh, targetToSource,
      source.localDiagonal, target.localDiagonal,
      { ...options.witness, scheduler }
    );
    mergeDiagnostics(witnessTerm.diagnostics);

    if (witnessTerm.witnessFound) {
      return { contained: true, via: 'surface-crossing', diagnostics, stats: { vertexTerm, witnessTerm } };
    }
  }

  // A component left unresolved by stages 1-2 contributes no witness of its own; if
  // the triangle-level search ALSO finds nothing (or was skipped by the aspect-ratio
  // gate above), this is a diagnosed negative, never a silently clean one
  // (docs/...:2445-2456).
  if (vertexTerm.unresolvedComponentCount > 0 || witnessTerm.inconclusive) {
    addDiagnostic('inconclusive-containment');
  }

  return { contained: false, diagnostics, stats: { vertexTerm, witnessTerm } };
}
