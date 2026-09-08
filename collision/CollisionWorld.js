// collision/CollisionWorld.js
//
// The admit/evict/dispose/lease surface that makes every later cache and query safe
// against model eviction, world disposal, and modelId reuse.

import * as THREE from 'three';
import {
  WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
  CapacityExceededError, ModelPlacementChangedError,
} from './errors.js';
import { createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator, reportSpan } from './scheduler.js';
import {
  maxBroadPhaseInstancePairs, maxCollisionInstancesPerEpoch, maxTlasCandidatePairs,
  maxClearanceNarrowPhasePairs, weldEpsilonMeters, surfaceEpsilonFactor,
} from './constants.js';
import { extractFragments, extractAllFragments, readWorldMatrix, readWorldBounds } from './viewer/ViewerModelAdapter.js';
import { adaptViewerGeometry } from './viewer/ViewerGeometryAdapter.js';
import { createGeometryRegistry } from './geometry/createGeometryRegistry.js';
import { TlasCache } from './tlas/TlasCache.js';
import { surfaceIntersectionQuery } from './query/SurfaceIntersectionQuery.js';
import { containmentModeQuery } from './query/ContainmentModeQuery.js';
import { volumeOverlapQuery } from './query/VolumeOverlapQuery.js';
import { aabbMinDistance } from './geometry/AabbDistance.js';
import { validateUniformScale, computeToleranceFloor } from './query/ClearanceTransform.js';
import { clearanceQuery } from './query/ClearanceQuery.js';
import { classifyHardClashPrecheck } from './query/ClearanceHardClashPrecheck.js';

const supportedModes = ['surface-intersection', 'containment', 'volume-overlap', 'clearance'];

function modelIdOf(model) {
  return model && model.id !== undefined ? model.id : model;
}

// `weldEpsilonMeters` is declared in METERS; a model whose own unit scale is not meters needs it
// divided by that scale (constants.js: "1e-4 m / model.getUnitScale()"). getUnitScale is not
// guaranteed present on every Model-shaped object, and a nonsensical value must not silently
// produce a NaN/zero/negative epsilon (compactAndWeld throws TypeError on those) -- fall back to
// the literal, exactly as constants.js documents.
function resolveWeldEpsilon(model) {
  const unitScale = typeof model?.getUnitScale === 'function' ? model.getUnitScale() : undefined;
  if (typeof unitScale !== 'number' || !Number.isFinite(unitScale) || unitScale <= 0) {
    return weldEpsilonMeters;
  }
  return weldEpsilonMeters / unitScale;
}

// A PlacedInstance pairs the canonical, epoch-cached CollisionInstance (identity + geometry
// identity, Task 18) with this call's own placement data from the extraction record. ownerDbId is
// carried through verbatim from extraction's first-discovery-wins capture -- it is NEVER
// re-derived from query.source.dbIds/query.target.dbIds.
function makePlaced(admitted, extractedRecord) {
  return Object.freeze({
    instance: admitted.get(extractedRecord.fragmentId),
    worldMatrix: extractedRecord.worldMatrix,
    worldBounds: extractedRecord.worldBounds,
    ownerDbId: extractedRecord.ownerDbId,
  });
}

// M3 clearance-only admission validation: a finite, invertible worldMatrix and finite,
// correctly-ordered worldBounds. Operates on the RAW extraction-record shape (worldMatrix is a
// Float64Array of 16 numbers, per extractFragments/extractAllFragments's own readWorldMatrix
// contract -- makePlaced reads the identical field), never on a PlacedInstance -- this runs BEFORE
// admission, so no PlacedInstance exists yet. Scoped to the clearance path only (Global
// Constraints) -- never called from the other three modes' extraction path.
//
// Deviation from the plan's own sketch, found while implementing: the sketch guarded with
// `Array.isArray(m)`, but readWorldMatrix's real contract (ViewerModelAdapter.js) returns a
// `Float64Array`, and `Array.isArray(new Float64Array(16))` is `false` -- that guard would reject
// EVERY legitimately-valid worldMatrix, never admitting a single clearance instance. Guarding on
// `.length` instead (present identically on both `Array` and any TypedArray) is correct for both
// shapes without weakening the check -- `.length !== 16` and `.some(...)` both work identically on
// a Float64Array.
//
// Exported (test-only; NOT re-exported from collision/index.js, so the public library surface is
// unaffected -- same convention as VolumeOverlapQuery.js's `toFiniteWorldArray` and
// ClearanceQuery.js's `clearanceCrossCheckAllowedDisagreement`) so the Float64Array-acceptance
// contract (and the other admission rules) can be asserted directly.
export function isValidClearanceTransform(extractedRecord) {
  const m = extractedRecord.worldMatrix;
  if (!m || m.length !== 16 || m.some((v) => !Number.isFinite(v))) return false;
  const det = new THREE.Matrix4().fromArray(m).determinant();
  if (!Number.isFinite(det) || det === 0) return false;
  const b = extractedRecord.worldBounds;
  if (!b || !b.min || !b.max) return false;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(b.min[i]) || !Number.isFinite(b.max[i]) || b.min[i] > b.max[i]) return false;
  }
  return true;
}

// Fragment-scoped, deduped per (epoch, fragmentId) -- mirrors `diagnoseFragmentOnce`'s existing
// pattern exactly (a separate Set here, `clearanceInvalidTransformDiagnosed`, scoped per
// `findClashes` call, never shared with `oversizedDiagnosedFragments` -- these are two independent
// dedup namespaces for two independent diagnostic reasons, and conflating them would let one
// reason's dedup entry incorrectly suppress the other for the same fragment).
function diagnoseClearanceInvalidTransform(statistics, diagnosedSet, model, epoch, extractedRecord, role) {
  const key = `${epoch}:${extractedRecord.fragmentId}`;
  if (diagnosedSet.has(key)) return;
  diagnosedSet.add(key);
  statistics.diagnostics.push({
    scope: 'fragment',
    reason: 'clearance-invalid-transform',
    role,
    fragment: { modelId: modelIdOf(model), dbId: extractedRecord.ownerDbId, fragId: extractedRecord.fragmentId },
  });
}

// The FragmentRef every ClashDiagnostic names. `dbId` always comes from the placed instance's own
// ownerDbId (first-discovery-wins, captured during extraction), NEVER from the query's own
// source.dbIds/target.dbIds, which say only where the walk started.
function fragmentRef(model, placed) {
  return {
    modelId: modelIdOf(model),
    dbId: placed.ownerDbId,
    fragId: placed.instance.fragmentId,
  };
}

// Batch-2 review fix (Important #1, corrected after a codex-review finding on the fix's own first
// draft): anisotropic scale is a property of ONE operand's own worldMatrix, not of the pair, so it
// must be deduped -- and DIAGNOSED -- per (epoch, fragmentId) of the offending operand, exactly
// mirroring `diagnoseClearanceInvalidTransform` above (the sibling condition for the identical shape
// of problem: one operand's own worldMatrix, `validateUniformScale`'s finer-grained gate rather than
// `isValidClearanceTransform`'s admission-time one). `scope: 'fragment'`, `role`, and a `fragment`
// field -- NOT `scope: 'pair'` with `sourceFragment`/`targetFragment` -- is the correct shape: a
// pair-scoped diagnostic promises to describe one specific fragment-pair evaluation, and a dedup key
// that only tracks ONE operand cannot honor that promise (an earlier draft of this fix tried exactly
// that hybrid -- fragment-level dedup with pair-scoped output -- and a later pair sharing an
// already-diagnosed offending fragment silently got no diagnostic at all, with which pair "won" the
// one surviving diagnostic depending on candidate traversal order). Its OWN SEPARATE Set (never
// `oversizedDiagnosedFragments` or `clearanceInvalidTransformDiagnosed` -- three independent dedup
// namespaces for three independent diagnostic reasons; conflating any of them would let one reason's
// entry incorrectly suppress a different reason for the same fragment). Called once per SIDE, exactly
// like `diagnoseFragmentOnce`'s own once-per-side invocation -- both operands are checked
// independently, so a pair where BOTH sides are simultaneously anisotropic-for-the-first-time
// produces two diagnostics (one per fragment), never one.
function diagnoseAnisotropicScaleOnce(statistics, diagnosedSet, placed, role, operand) {
  const key = `${operand.epoch}:${placed.instance.fragmentId}`;
  if (diagnosedSet.has(key)) return;
  diagnosedSet.add(key);
  statistics.diagnostics.push({
    scope: 'fragment',
    reason: 'clearance-anisotropic-scale-unsupported',
    role,
    fragment: fragmentRef(operand.model, placed),
  });
}

// The matrix bvhcast wants: it maps the SECOND bvh's local space into the FIRST bvh's local space
// (source is always the first operand here), i.e. inverse(sourceWorld) * targetWorld -- the same
// derivation test/query/SurfaceIntersectionQuery.test.mjs's own `relativeMatrix(a, b)` helper uses.
function computeRelativeMatrix(sourceWorldMatrix, targetWorldMatrix) {
  const source = new THREE.Matrix4().fromArray(sourceWorldMatrix);
  const target = new THREE.Matrix4().fromArray(targetWorldMatrix);
  return source.invert().multiply(target);
}

// The stable, identity-based comparator that decides CANONICAL ORDER for volume-overlap
// (docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:1626-1632; implementation
// plan :2415-2437, which assigns supplying a real comparator to CollisionWorld). It exists ONLY to
// pick which operand's `localDiagonal` becomes L_canonical for ProperCrossingQuery's offset ladder
// (`{1e-3,1e-4,1e-5} x L_canonical`) -- never which operand is publicly named `source`/`target` in a
// diagnostic, which stays fixed to the caller's own arguments.
//
// Without it VolumeOverlapQuery falls back to its library default ("public source is always
// canonical-first"), which makes the ladder scale depend on which side the CALLER happened to label
// source. That is a public verdict bug, not a tolerance nuance: for a pair whose two operands differ
// sharply in local diagonal (a long duct crossing a short beam, ~700:1), findClashes(A -> B) and
// findClashes(B -> A) return DIFFERENT pair counts for the identical physical pair.
//
// (loadEpoch, geometryIndex, fragmentId) compared lexicographically is total and stable, and is
// sufficient for Milestone 1: cross-model queries are rejected at entry, so one call's operands
// always share a model and therefore a loadEpoch, and (loadEpoch, fragmentId) alone already
// uniquely identifies a CollisionInstance. geometryIndex sits between them so that two fragments
// sharing one geometry sort together, and all three are included so the order stays total if a
// later milestone lifts the single-model restriction.
//
// The two operands compare EQUAL only when they are literally the same fragment (a dbId appearing
// on both sides of the query), and that case is degenerate in the right way: one geometry, one
// placement, so L_canonical is the same number whichever operand is picked.
//
// Compared field by field off the PlacedInstances rather than through a materialized key array:
// this runs once per composed narrow-phase pair, and the broad phase admits up to
// maxBroadPhaseInstancePairs of them.
function comparePlacedCanonically(a, b) {
  const idA = a.instance.geometryIdentity;
  const idB = b.instance.geometryIdentity;
  if (idA.loadEpoch !== idB.loadEpoch) return idA.loadEpoch < idB.loadEpoch ? -1 : 1;
  if (idA.geometryIndex !== idB.geometryIndex) return idA.geometryIndex < idB.geometryIndex ? -1 : 1;
  const fragA = a.instance.fragmentId;
  const fragB = b.instance.fragmentId;
  if (fragA !== fragB) return fragA < fragB ? -1 : 1;
  return 0;
}

// M2.1 Task 5: total order over witness candidates for the SAME dbId-level pair, used to pick the
// one surviving `witness` when several fragment-pair candidates collapse onto one key. Rank, most to
// least preferred:
//   1. a real witness beats a null one (a null witness is `volumeOverlapQuery`'s own fault-tolerance
//      contract for a hit whose witness point came out non-finite -- never a normal outcome, so any
//      sibling candidate with a REAL witness should always be preferred over it).
//   2. among two real witnesses, 'surface-crossing' beats 'containment' (a crossing witness sits
//      strictly inside both solids, near their intersection curve -- ProperCrossingQuery's own probe
//      acceptance test (`_probe`, ProperCrossingQuery.js) only accepts a candidate when
//      classifyPoint returns 'inside' against BOTH bvhA and bvhB, explicitly rejecting a 'boundary'
//      result on either side; the segment-midpoint fallback it is preferred over is only guaranteed
//      to lie ON the intersection curve, not interior to either solid -- so a crossing witness is
//      more directly localized to the actual interference than a point of one solid found somewhere
//      inside the other).
//   3. among two real witnesses of the SAME kind, `comparePlacedCanonically` (this file's own
//      existing (loadEpoch, geometryIndex, fragmentId) total order, reused rather than reimplemented)
//      breaks the tie off the two candidates' OWN placements, so the winner never depends on which
//      fragment pair the broad phase happened to visit first.
//
// A valid total order for a stable min-reduction: reflexive (every branch compares a value against
// itself as equal), antisymmetric (swapping a/b negates every branch's sign -- the null-vs-real
// branch swaps -1/1, the kind branch swaps -1/1, and comparePlacedCanonically is itself
// antisymmetric), and transitive (the three ranks above are lexicographic: null-ness, then kind,
// then comparePlacedCanonically's own already-total order) -- so
// `compareWitnessCandidates(candidate, existing) < 0` inside the aggregation loop below always
// converges to the SAME winner regardless of arrival order.
//
// codex-advisor review (request 20260907-162936-71471-30255): the FIRST version of this function
// short-circuited `if (!aw && !bw) return 0` before ever reaching the placement tie-break below,
// which made two null-witness candidates compare EQUAL without regard to which physical fragment
// pair produced them. The public `witness: null` value was unaffected either way, but the internal
// `witnessCandidateByKey` entry that survives ties is whichever candidate happens to arrive FIRST
// under `!existing || compare(...) < 0` -- so the `witness-unavailable` diagnostic's
// sourceFragment/targetFragment provenance was silently arrival-order-dependent, violating this
// function's own "total order" contract even though no currently-required test caught it. Falling
// through to the SAME placement tie-break for the null-vs-null case (rather than returning 0 early)
// closes that gap: the tie-break runs unconditionally whenever `aw`/`bw` are equally (non-)present,
// so the diagnostic's blamed fragment pair is now canonically decided, not first-arrival-decided.
function compareWitnessCandidates(a, b) {
  const aw = a && a.witness;
  const bw = b && b.witness;
  if (Boolean(aw) !== Boolean(bw)) return aw ? -1 : 1;
  if (aw && bw && aw.kind !== bw.kind) return aw.kind === 'surface-crossing' ? -1 : 1;
  return (
    comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced) ||
    comparePlacedCanonically(a.targetPlaced, b.targetPlaced)
  );
}

// M3 Task 9: total order over clearance narrow-phase 'hit' outcomes for the SAME dbId-level key,
// used to pick the single surviving (minimum-distance) candidate when several fragment-pair
// candidates collapse onto one key. Mirrors compareWitnessCandidates's EXACT structure above, minus
// the witness-kind rank (clearance has exactly one witness kind, so there is nothing to rank there):
// distance first (the whole point of "minimum clearance distance wins"), then the same
// comparePlacedCanonically tie-break, applied source-then-target -- so the winner never depends on
// which fragment pair the broad phase happened to visit first (fixtures 10/14, order independence).
function compareClearanceCandidates(a, b) {
  if (a.distance !== b.distance) return a.distance < b.distance ? -1 : 1;
  return (
    comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced) ||
    comparePlacedCanonically(a.targetPlaced, b.targetPlaced)
  );
}

// M2.1 Task 4: `_runNarrowPhasePair` returns a structured `{ hit, witness }` object for
// `volume-overlap` (so its `witness` can flow into deterministic dbId-level aggregation, Task 5) but
// a bare boolean for `containment`/`surface-intersection`, whose return shapes are unchanged.
//
// This normalizes both shapes at the ONE aggregation-loop call site so the loop's own skip gate
// always reads a real boolean. Without it, `if (!hit) continue;` -- correct for a bare boolean --
// would silently break the moment `hit` is a structured NEGATIVE result: `{ hit: false, witness:
// null }` is still a truthy JS object, so `!hit` evaluates to `false` for it just as it would for
// `{ hit: true, ... }`, and the loop would stop skipping negative candidates entirely.
//
// Task review fix (post-commit 0579b21): `_runNarrowPhasePair`'s pre-existing `buildOne`-failure
// early-outs return the bare boolean `false` even under `mode === 'volume-overlap'` (that shared
// prep code is untouched by this task and knows nothing about the mode-specific return shape). A
// naive `(result && result.witness) ?? null` mishandles that case: `result` is `false`, so
// `result && result.witness` short-circuits to `false` (not `undefined`/`null`), and `false ?? null`
// stays `false` -- silently violating the `witness: {kind,point}|null` contract Task 5 depends on
// (e.g. an `=== null` check). The `typeof result === 'object'` guard below ensures `witness` can
// only ever come out `null` or a real `{kind,point}` object, never any other falsy value, regardless
// of what shape `result` turns out to be.
//
// Exported (test-only; NOT re-exported from collision/index.js, so the public library surface is
// unaffected) so this exact contract -- `witness` is never anything but `null` or an object -- can be
// asserted directly rather than only inferred through findClashes' own (currently witness-blind)
// output.
export function normalizeNarrowPhaseHit(mode, result) {
  if (mode === 'volume-overlap') {
    const isObjectShape = Boolean(result) && typeof result === 'object';
    return {
      isHit: isObjectShape && Boolean(result.hit),
      witness: isObjectShape ? (result.witness ?? null) : null,
    };
  }
  return { isHit: Boolean(result), witness: undefined }; // witness is not a concept for these modes
}

// Extracted from _runNarrowPhasePair's own private buildOne/diagnoseFragmentOnce closures (M3 Task 9)
// so clearance's narrow phase can resolve geometry through the IDENTICAL path the three existing
// modes already use, rather than a second, divergent one. Pure refactor: _runNarrowPhasePair below is
// rewritten to call these same functions, with the full existing regression suite proving zero
// observable behavior change for surface-intersection/containment/volume-overlap.
function diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, reason, operand) {
  const key = `${operand.epoch}:${placed.instance.fragmentId}`;
  if (oversizedDiagnosedFragments.has(key)) return;
  oversizedDiagnosedFragments.add(key);
  statistics.diagnostics.push({ scope: 'fragment', reason, role, fragment: fragmentRef(operand.model, placed) });
}

async function resolveGeometryRecord(registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments) {
  const identity = placed.instance.geometryIdentity;
  let record;
  try {
    record = await registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch,
      geometryIndex: identity.geometryIndex,
      ownerModelIdHint: modelIdOf(operand.model),
      needsConnectivity,
    });
  } catch (err) {
    // EXACTLY this one class is absorbed; anything else -- a checkpoint's own
    // WorldDisposedError/ModelEvictedError, a builder bug, an extraction invariant break --
    // still aborts the whole findClashes call, unchanged.
    if (!(err instanceof RenderProxyUnavailableError)) throw err;
    // Attribution caveat, inherited from _recordRepresentativeFragments' first-discovery-wins
    // rule rather than introduced here: the proxy that was missing belongs to the geometry's
    // REPRESENTATIVE fragment, which may not be `placed` when several fragments share one
    // geometryIndex. Render-proxy availability is per-fragment (load/cull state), so a
    // representative can be absent while a sibling instance of the same geometry is present, and
    // this diagnostic then names the sibling. The pre-fix code mis-attributed the identical way
    // (and permanently); widening representatives to a retry list is a separate design change.
    // The `role` and `fragment` fields therefore say WHICH PAIR was skipped, not necessarily
    // which fragment id the Viewer had no proxy for -- the error's own `fragId` does that.
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, 'geometry-not-yet-available', operand);
    return null;
  }
  if (record.oversized) {
    // KNOWN TENSION, deliberately not changed here: the spec's dedup guarantee is scoped to the
    // ceiling outcome only, and says a normalization failure (`unsupported-geometry-layout` or
    // `rejected-primitive-range`) "settles no persistent entry state, so those two diagnoses can
    // still be re-emitted per candidate pair" (spec :3170-3174). createGeometryRegistry's
    // buildWeld filter caches those two as oversized markers all the same, so they are in fact
    // emitted once per epoch, not once per pair. That is a pre-existing behavioural deviation
    // from the spec text, recorded here rather than silently reinterpreted; the batch-4 fix wave
    // was scoped to the missing-proxy half of this problem only.
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, record.reason, operand);
    return null;
  }
  return record;
}

// Adapts one resolved GeometryRegistry record plus this call's own placement into the `Instance`
// shape ContainmentModeQuery/VolumeOverlapQuery document in their own JSDoc typedefs:
// `{ geometry, bvh, localDiagonal, connectivity, closedManifold: boolean, matrix,
//    aspectRatioExceeded?: boolean }`.
//
// Three fields the plan's own snippet dropped, all load-bearing (batch4 reconciliation note items
// 6/7, each re-verified against the consuming code rather than taken on trust):
//  - `geometry`  -- ContainmentQuery.anyComponentInside samples `sourceGeometry.attributes.position`
//                   through `sourceGeometry.index.array`; without it every containment term throws.
//  - `closedManifold` -- a SINGLE geometry-wide boolean in both consumers' typedefs (used directly,
//                   never indexed), reduced from GeometryConnectivity's per-component array. Left
//                   `undefined` when connectivity was not requested, which cannot happen on the two
//                   modes that read it (`needsConnectivity` is true for both).
//  - `aspectRatioExceeded` -- the M1 single-geometry aspect-ratio disposition gate in
//                   VolumeOverlapQuery (its crossing term) and ContainmentModeQuery (its witness
//                   term). Dropping it silently disables a safety guard rather than failing loudly.
//
// `matrix` must be a real THREE.Matrix4: both consumers call `.clone().invert().multiply(...)` on
// it. Extraction stores world matrices as plain 16-number arrays, so the conversion happens here.
//
// Note what is deliberately NOT here: any identity field. Canonical ordering is decided from the
// PlacedInstances at the call site (comparePlacedCanonically above), so this object stays exactly
// the shape both consumers' typedefs declare.
function toInstance(record, placedWorldMatrix) {
  return {
    geometry: record.geometry,
    bvh: record.bvh,
    localDiagonal: record.localDiagonal,
    connectivity: record.connectivity,
    closedManifold: record.connectivity ? record.connectivity.closedManifold.every(Boolean) : undefined,
    aspectRatioExceeded: record.aspectRatioExceeded,
    matrix: new THREE.Matrix4().fromArray(placedWorldMatrix),
  };
}

/**
 * The `SchedulerHandle` ContainmentModeQuery/VolumeOverlapQuery (and, through them,
 * ContainmentQuery/SurfaceCrossingWitness) actually consume:
 * `{ elapsedMs(): number, checkpointIfDue(): Promise<void> }` — verified against those modules'
 * own bodies, NOT the `{ checkpoint() }` shape the plan's snippet assumes.
 *
 * It wraps the SAME per-call `checkpoint` callable every other checkpoint in this findClashes call
 * uses, so a composed sub-query's between-stage yields share one frame-budget accumulator with the
 * broad phase and the pair boundary. That sharing is exactly what makes the round-9 counterexample
 * (a pair whose composed stages are each individually under budget but sum past it) reachable.
 *
 * `checkpointIfDue` is deliberately `async` — always a Promise, even on the port's synchronous fast
 * path — because its callers uniformly `await` it. The port call INSIDE it still branches on the
 * return value (`const pending = checkpoint(); if (pending) await pending;`), so the not-due path
 * costs no yield of its own, only the one microtask its callers' own `await` already implies.
 *
 * `elapsedMs` reports time since this pair's own entry, reset on every real yield. That is the
 * baseline SurfaceCrossingWitness needs: it cannot pause mid-bvhcast, so it only READS this to
 * abort a traversal that has already outrun frameBudgetMs since the last yield. A baseline taken at
 * findClashes entry instead would report the whole call's elapsed time and abort every witness
 * traversal on any non-trivial query.
 *
 * `checkpoint()` below is labeled (Task 23, fixed after a codex-advisor review finding): an
 * earlier draft called it unlabeled, which meant the real synchronous work a composed containment/
 * volume-overlap sub-query does BETWEEN its own internal stages (sampling, witness, etc.) was
 * silently discarded from the span log entirely -- the checkpoint still resets the shared per-call
 * port's own `lastSpanAt` baseline regardless of whether a label is given, so an unlabeled call
 * here erases that synchronous work from the next labeled span's measurement without ever
 * reporting it under any label of its own. Labeling it fixes that -- it is reused across every
 * `checkpointIfDue` call site (same recurring pattern as `narrow-phase-pair`/`broad-phase-scan`),
 * so it is subject to the SAME "last iteration's tail may go unflushed" caveat those two labels
 * have, documented in test/performance/README.md, but is no longer silently dropped altogether.
 */
function createComposedStageScheduler(checkpoint, now) {
  let sinceMs = now();
  return {
    elapsedMs: () => now() - sinceMs,
    checkpointIfDue: async () => {
      const pending = checkpoint({ label: 'composed-narrow-phase-stage' });
      if (pending) {
        await pending;
        sinceMs = now();
      }
    },
  };
}

// ---- Task 6: cross-model operand normalization -------------------------------------------------

// Normalizes `query.target` into a uniform internal shape: `{model, dbIds}[]`. The legacy
// `{model, dbIds}` target becomes a synthetic one-entry array, so every later step (extraction,
// admission, and later tasks' broad/narrow phase) operates on one shape regardless of which the
// caller supplied. `dbIds` is carried through EXACTLY as the caller supplied it, including
// `undefined` (a `targets` entry's whole-model-scope sentinel, validated in findClashes's own
// Step-8 checks before this is ever called).
//
// M-3 fix (Batch 2 whole-batch review): every returned entry -- and each entry's own `dbIds` array,
// when present -- is a SHALLOW COPY, never the caller's own object/array by reference. Without this,
// a caller mutating its own query object after the call starts (findClashes re-reads these entries
// across real `await`s: object-tree readiness, extraction checkpoints) could change behavior
// mid-flight. `model` itself is intentionally NOT copied (copying an object reference changes
// nothing; `model` identity is exactly what the rest of this method keys leases/epochs off of).
// `dbIds: undefined` (the whole-model-scope sentinel) is preserved exactly -- `.slice()` is only
// ever called when `dbIds` is genuinely an array, never turning a real `undefined` into `[]`.
function normalizeTargets(target) {
  if (Array.isArray(target?.targets)) {
    return target.targets.map((entry) => ({
      model: entry.model,
      dbIds: entry.dbIds !== undefined ? entry.dbIds.slice() : undefined,
    }));
  }
  return [{ model: target.model, dbIds: target.dbIds !== undefined ? target.dbIds.slice() : undefined }];
}

// Snapshots and DEDUPLICATES every distinct Model object across source + every targets entry, at
// query entry, before any extraction begins (design spec §9.2 points 1-3). Two targets entries (or
// a target entry sharing the source's own model) naming the same Model object collapse to one
// lease -- `Set` dedups by object identity, which is exactly "the same Model object" for the
// lifetime of one findClashes call. Source is inserted FIRST so `distinctModels[0]` is always the
// source's own model, a deterministic choice createCompositeCheckpointPort's "primary lease" relies
// on (see its own comment).
function collectDistinctModels(sourceModel, targetsEntries) {
  const models = new Set([sourceModel]);
  for (const entry of targetsEntries) models.add(entry.model);
  return [...models];
}

// ---- Task 7/8: source self-exclusion -----------------------------------------------------------

// A candidate target instance is excluded iff its (loadEpoch, fragmentId) is literally a fragment
// the SOURCE OPERAND'S OWN extraction walk discovered -- design spec §4.4's assembly-rooted rule,
// NOT dbId-level equality. A source query rooted at an assembly/parent dbId can discover fragments
// actually OWNED by child dbIds (extraction's own first-discovery-wins ownerDbId capture); every one
// of those discovered fragments must be excluded from the target side even though only the parent
// dbId was ever "requested" as source.
//
// `sourceOperand.fragmentIds` is `sourceExtracted` itself (a `Map<fragmentId, record>` scoped to the
// source's own single epoch) -- membership, not identity, is what this checks. Comparing epochs
// FIRST is sufficient and equivalent to a per-epoch `Map<epoch, Map>` lookup precisely because M2's
// source operand is always exactly one epoch; this also makes the check `false` immediately, at zero
// map-lookup cost, for the overwhelmingly common case of a genuinely cross-model target group whose
// epoch never equals the source's own.
function isSourceOwnFragment(sourceOperand, targetEpoch, targetFragmentId) {
  return targetEpoch === sourceOperand.epoch && sourceOperand.fragmentIds.has(targetFragmentId);
}

function emptyStatistics() {
  return {
    broadPhasePairs: 0,
    narrowPhasePairs: 0,
    // blasBuilt/blasCacheHits are reported as 0 for now: GeometryRegistry/BlasCache (Tasks 13-14)
    // expose no build/hit counters, and inferring them from this side would be a guess. The fields
    // stay in the shape so consumers can rely on it; instrumenting them belongs with the
    // performance gate (Task 24), which is what actually needs the numbers.
    blasBuilt: 0,
    blasCacheHits: 0,
    broadPhaseMs: 0,
    narrowPhaseMs: 0,
    totalMs: 0,
    diagnostics: [],
    // --- M2 additive fields (design spec §7.5.1), always present, default 0, never
    // conditionally omitted -- including for broadPhase:'linear' calls.
    tlasLeafRangeEmissions: 0,
    tlasPrimitiveCandidatePairs: 0,
    tlasExactRetestSurvivors: 0,
    tlasNarrowPhaseInputPairs: 0,
    tlasBuilds: 0,
    tlasCacheHits: 0,
    tlasSharedBuildWaits: 0,
    tlasBuildMs: 0,
    tlasQueryMs: 0,
    clearanceExpandedCandidatePairs: 0,
    clearanceExactAabbSurvivors: 0,
    clearanceOverlapPrechecksRun: 0,
    clearanceHardClashExclusions: 0,
    clearanceDistanceQueriesRun: 0,
    clearanceHits: 0,
    clearanceQueryMs: 0,
  };
}

function defaultYieldToScheduler() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export { CapacityExceededError }; // re-exported, not redeclared -- every existing `instanceof
                                 // CapacityExceededError` check anywhere in the codebase still
                                 // passes, since it is the SAME class object.

export class CollisionWorld {
  constructor({ registry = null, now = () => performance.now(), yieldToScheduler = defaultYieldToScheduler } = {}) {
    this._disposed = false;
    // WeakMap: never deleted, only ever transitions live -> evicted, permanent. docs/...:3196-3213.
    this._modelLifecycle = new WeakMap();
    // Global counter, NEVER scoped to or reset per modelId — round-11 ABA-race fix, docs/...:3196-3199.
    this._nextLoadEpoch = 1;
    // Best-effort diagnostic only, NOT load-bearing for correctness (round-15, docs/...:3395-3398) —
    // cannot enumerate every live model under modelId reuse; never consulted by any correctness path.
    this._liveModelByModelId = new Map();
    // Set<loadEpoch> of currently-live epochs. Reverse-lookup companion to _modelLifecycle (a WeakMap
    // keyed by model object cannot be looked up BY epoch) — this is what createCheckpointPort's real
    // scheduler primitive needs for its own isEpochLive(loadEpoch) dependency (Cross-Task Interface
    // Reconciliation item 3). loadEpoch is a global, monotonic, never-reused counter, so a given epoch
    // value can only ever have belonged to one model — "is this epoch live" is unambiguous without the
    // model object.
    this._liveEpochs = new Set();
    this._registry = registry;
    this._instanceCache = new Map(); // Map<loadEpoch, Map<fragmentId, CollisionInstance>> — Task 18
    // Map<loadEpoch, Model>. Reverse lookup GeometryRegistry cannot do for itself: a GeometryRecord
    // is keyed (loadEpoch, geometryIndex) and deliberately never holds a Model reference, but
    // _resolveGeometryView needs the Model object to call viewer.impl.getRenderProxy(model, fragId).
    // Written alongside _liveEpochs.add in admitModel, cleared alongside it in
    // _releaseEpochScopedState/dispose, so it can never outlive the epoch it belongs to.
    this._modelByEpoch = new Map();
    // Map<loadEpoch, Map<geometryIndex, fragId>>. Any ONE fragment sharing a geometryIndex is
    // representative — they all resolve to the same raw Viewer geometry — so first-discovery-wins
    // is sufficient and stable. Populated by _recordRepresentativeFragments, from extraction output.
    this._representativeFragmentByGeometry = new Map();
    // Task 9 (M2 Batch 3): Map<loadEpoch, Map<fragmentId, {worldBounds, worldMatrix, ownerDbId,
    // modelId}>>. A genuinely NEW, separate table from _instanceCache (spec §16's explicit
    // correction of the design's own first draft) -- _instanceCache stays scoped to
    // {fragmentId, geometryIdentity} only. Write-once per fragment: populated by _recordPlacement,
    // at the same extraction call sites _recordRepresentativeFragments already uses. Consumed by
    // Task 10's TlasCache (buildPrimitives) and Task 11's invalidateModelPlacement refresh.
    this._placementByEpoch = new Map();
    // Task 9: Map<loadEpoch, number>. Bumped only when _recordPlacement inserts at least one
    // genuinely new fragmentId ("growth") for that epoch -- ordinary re-extraction of an
    // already-present fragment never bumps it. Task 11's invalidateModelPlacement also bumps this
    // (a different kind of change: existing placements going stale, not new fragments arriving).
    this._placementRevisionByEpoch = new Map();
    // Task 11 (M2 Batch 3): Map<loadEpoch, revision>. Set by invalidateModelPlacement to the SAME
    // revision number it just bumped _placementRevisionByEpoch to -- distinguishes "this epoch's
    // revision changed because of an explicit invalidation" from "...because ordinary extraction
    // discovered new fragments" (Task 13's own refresh-vs-rebuild trigger condition needs this
    // distinction; a pure-growth revision bump must never trigger a placement re-read from the
    // Viewer, only a genuine invalidation should). Deleted once a refresh successfully publishes
    // for the exact revision it names; a second invalidation arriving mid-refresh overwrites it
    // with its own newer revision rather than being erased by the first refresh's cleanup (see
    // _refreshPlacementForEpoch below).
    this._placementInvalidatedAtRevision = new Map();
    // Task 10 (M2 Batch 3): null until fromViewer constructs it (mirrors this._registry's own
    // "constructed after the world, wired against it" pattern) -- a world built directly via the
    // constructor (bypassing fromViewer, as some lifecycle-only tests do) has no TLAS path
    // reachable, exactly like a registry-less world has no narrow phase reachable.
    this._tlasCache = null;
    this._viewer = null;  // set by fromViewer; only _resolveGeometryView reads it
    this._options = null; // set by fromViewer: { narrowPhase, indexOwnership }
    this._now = now;
    this._yieldToScheduler = yieldToScheduler;
    // NOTE: no accumulator/clock-baseline field here — the frameBudgetMs accumulator is scoped to one
    // findClashes CALL (docs/...: "one performance.now()-based accumulator for the whole call"), never
    // to the whole CollisionWorld instance. See createCheckpointPort() below, which is the ONLY place
    // that timing state lives, freshly, per call.
  }

  /**
   * The public construction path: a fully self-wired world with a real GeometryRegistry attached.
   *
   * Construction ORDER matters and is deliberate: the world is constructed FIRST, with no registry
   * (the constructor's `registry` default is null, and dispose()/_releaseEpochScopedState already
   * guard with `this._registry?.` — a registry-less world is valid, merely inert for geometry), and
   * only THEN is the registry built against the fully-constructed `world`. Nothing captured in the
   * closures below can run before this function returns, so there is no bind-before-constructed
   * hazard.
   *
   * The registry's checkpoint port is deliberately NOT `world.createCheckpointPort(lease)`: that
   * factory is per-findClashes-call and bound to one call's {model, epoch} lease, whereas this one
   * registry instance is shared across every future call and single-flights builds between them.
   * It gets the raw scheduler primitive instead, with its OWN long-lived accumulator and an
   * epoch-only liveness predicate — which is exactly the state a GeometryRecord (keyed by
   * (loadEpoch, geometryIndex), holding no Model) can be validated against.
   *
   * @param {Object|null} viewer  an Autodesk.Viewing.Viewer3D-shaped object; only
   *   `viewer.impl.getRenderProxy(model, fragId)` is ever called, and only from
   *   _resolveGeometryView. May be null for lifecycle-only use (no narrow phase reachable).
   * @param {Object} [options]
   * @param {'three-mesh-bvh'} [options.narrowPhase]
   * @param {'clone'} [options.indexOwnership]
   * @param {() => number} [options.now]  test seam, forwarded to the constructor
   * @param {() => Promise<void>} [options.yieldToScheduler]  test seam, forwarded to the constructor
   */
  static async fromViewer(viewer, options = {}) {
    const narrowPhase = options.narrowPhase ?? 'three-mesh-bvh';
    const indexOwnership = options.indexOwnership ?? 'clone';
    if (narrowPhase !== 'three-mesh-bvh') {
      throw new Error(
        `CollisionWorld.fromViewer: unsupported options.narrowPhase '${narrowPhase}' ` +
        `(only 'three-mesh-bvh' is implemented in Milestone 1)`,
      );
    }
    if (indexOwnership !== 'clone') {
      throw new Error(
        `CollisionWorld.fromViewer: unsupported options.indexOwnership '${indexOwnership}' ` +
        `(only 'clone' is implemented in Milestone 1)`,
      );
    }

    const world = new CollisionWorld({ now: options.now, yieldToScheduler: options.yieldToScheduler });
    world._viewer = viewer ?? null;
    world._options = Object.freeze({ narrowPhase, indexOwnership });

    const registryCheckpointPort = createRealCheckpointPort({
      isDisposed: () => world._disposed,
      isEpochLive: (loadEpoch) => world._isEpochLive(loadEpoch),
      accumulator: createFrameBudgetAccumulator({ now: world._now }),
      yieldToScheduler: world._yieldToScheduler,
    });
    world._registry = createGeometryRegistry({
      resolveGeometryView: (loadEpoch, geometryIndex) => world._resolveGeometryView(loadEpoch, geometryIndex),
      checkpointPort: registryCheckpointPort,
    });
    // Task 10 (M2 Batch 3): own long-lived checkpoint port, mirroring registryCheckpointPort's own
    // construction immediately above -- a fresh accumulator shared across every future TLAS build
    // this world ever runs, never scoped to one findClashes call.
    const tlasCheckpointPort = createRealCheckpointPort({
      isDisposed: () => world._disposed,
      isEpochLive: (loadEpoch) => world._isEpochLive(loadEpoch),
      accumulator: createFrameBudgetAccumulator({ now: world._now }),
      yieldToScheduler: world._yieldToScheduler,
    });
    world._tlasCache = new TlasCache({
      // Reads _placementByEpoch fresh on every call -- never a stale snapshot -- so a rebuild
      // triggered by growth or by Task 11's invalidateModelPlacement refresh always sees current
      // state. An epoch with no placement entries yet (never extracted, or already released)
      // builds an empty TLAS rather than throwing -- consistent with CollisionInstanceBVH's own
      // documented support for a zero-record BVH.
      buildPrimitives: (loadEpoch) => {
        const placementByFragment = world._placementByEpoch.get(loadEpoch);
        const records = [];
        if (placementByFragment) {
          for (const [fragmentId, placement] of placementByFragment) {
            records.push({ fragmentId, ...placement });
          }
        }
        return records;
      },
      checkpointPort: tlasCheckpointPort,
    });
    return world;
  }

  admitModel(model) {
    if (this._disposed) throw new WorldDisposedError();
    const existing = this._modelLifecycle.get(model);
    if (existing?.state === 'evicted') {
      // Never assigns a new epoch — a model that was ever evicted can never be re-leased.
      // docs/...:3211-3213.
      throw new ModelEvictedError(modelIdOf(model));
    }
    if (existing?.state === 'live') {
      return Object.freeze({ model, epoch: existing.epoch }); // idempotent, same epoch, no new epoch consumed
    }
    const epoch = this._nextLoadEpoch++;
    this._modelLifecycle.set(model, { state: 'live', epoch });
    this._liveEpochs.add(epoch);
    this._modelByEpoch.set(epoch, model);
    if (model && model.id !== undefined) this._liveModelByModelId.set(model.id, model);
    return Object.freeze({ model, epoch });
  }

  isLeaseValid(lease) {
    // Strictly non-throwing and total — one of two deliberate exceptions to "every public method
    // throws WorldDisposedError once disposed" (evictModel is the other). docs/...:3380-3391.
    if (this._disposed) return false;
    const entry = this._modelLifecycle.get(lease.model);
    return entry?.state === 'live' && entry.epoch === lease.epoch;
  }

  evictModel(model) {
    // Second deliberate exception: no-op on a disposed world, never throws. Justification
    // (docs/...:3167-177, verbatim from Public API section):
    //  1. evictModel runs from BEFORE_MODEL_UNLOAD_EVENT, dispatched via EventDispatcher.dispatchEvent
    //     with no try/catch, as the first statement of Viewer3DImpl.unloadModel, called from the
    //     unguarded loop in unloadCurrentModel — an uncaught throw here aborts the Viewer's own
    //     multi-model teardown.
    //  2. dispose() has already released world-owned collision state unconditionally; nothing left to do.
    //  3. It is the branch this method already had (total-by-no-op for the 'evicted' case).
    // This "never throws" guarantee extends to whatever _releaseEpochScopedState does on this
    // method's behalf — see its own defensive try/catch below: this method's non-throw contract must
    // not depend on an unverified assumption that Task 13/14's GeometryRegistry.releaseEntriesForEpoch
    // is itself non-throwing.
    if (this._disposed) return;
    const previous = this._modelLifecycle.get(model);
    if (previous?.state === 'evicted') return; // idempotent no-op
    this._modelLifecycle.set(model, { state: 'evicted' }); // unconditional, permanent; no epoch field
    if (previous?.state === 'live') {
      this._liveEpochs.delete(previous.epoch);
      this._releaseEpochScopedState(previous.epoch);
    }
    if (model && model.id !== undefined && this._liveModelByModelId.get(model.id) === model) {
      this._liveModelByModelId.delete(model.id); // diagnostic/bookkeeping only
    }
  }

  isModelLive(model) {
    if (this._disposed) throw new WorldDisposedError();
    const entry = this._modelLifecycle.get(model);
    return entry?.state === 'live';
  }

  // Task 11 (M2 Batch 3): marks an admitted model's placement (worldMatrix/worldBounds) as stale
  // for federated coordination -- alignment, translation, rotation, and equivalent model-level
  // transforms (spec §6.7). Does NOT touch _instanceCache/_modelByEpoch/_modelLifecycle/
  // _liveEpochs (spec §6.7.6) -- this is purely a placement-staleness signal; identity/lifecycle
  // state is untouched. No-ops for a never-admitted model rather than throwing: unlike
  // evictModel/isLeaseValid, this IS one of the ordinary "every public method throws
  // WorldDisposedError once disposed" methods (no special no-op-on-disposed exception here).
  invalidateModelPlacement(model) {
    if (this._disposed) throw new WorldDisposedError();
    const entry = this._modelLifecycle.get(model);
    if (entry?.state === 'evicted') throw new ModelEvictedError(modelIdOf(model));
    if (!entry) return; // never admitted -- nothing to invalidate
    const epoch = entry.epoch;
    const revision = (this._placementRevisionByEpoch.get(epoch) ?? 0) + 1;
    this._placementRevisionByEpoch.set(epoch, revision);
    this._placementInvalidatedAtRevision.set(epoch, revision);
  }

  // Minimal, read-only diagnostic accessor (Task 24, performance-gate criteria 8/12) -- the same
  // class of small, explicitly-scoped addition as scheduler.js's setSpanRecorder (Task 23). Reads
  // `_instanceCache`'s existing per-epoch bucket size; adds no new state and changes no existing
  // behavior. Returns 0 for an epoch with no bucket (never yet admitted, or already evicted) rather
  // than throwing -- callers use this purely to observe the identity-cache's retained size and to
  // confirm a capacity-precheck rejection left the bucket untouched, never as a liveness check (use
  // isModelLive/isLeaseValid for that).
  getEpochCollisionInstanceCount(epoch) {
    if (this._disposed) throw new WorldDisposedError();
    return this._instanceCache.get(epoch)?.size ?? 0;
  }

  dispose() {
    // dispose() is NOT one of the two deliberate no-op-on-disposed exceptions (isLeaseValid,
    // evictModel are the only two — docs/...:3380-3391, 3462-3464, 3478-3481) — a second dispose()
    // call must throw WorldDisposedError, same as every other public method. Guard first, before any
    // cleanup, so a re-entrant/racing second call cannot re-run cleanup that may not be safe to run
    // twice (e.g. an unverified GeometryRegistry.releaseAll()).
    if (this._disposed) throw new WorldDisposedError();
    this._disposed = true; // set FIRST, synchronously, before anything else. docs/...:3380-3391.
    // Each independent cleanup below is attempted regardless of whether an earlier one failed —
    // dispose() is terminal and cannot be retried, so no single failure may strand the others.
    try {
      this._registry?.releaseAll?.();
    } catch {
      // dispose() is contractually non-throwing (docs/...:3391-3392) even if a composed module's
      // own release path is not verified from here.
    }
    this._instanceCache.clear(); // Task 18's cache — one wholesale clear, not a per-epoch sweep.
    // Best-effort tombstoning of the diagnostic-only modelId map (docs/...: "liveModelByModelId is
    // best-effort tombstoned for diagnostic bookkeeping only... NOT load-bearing for correctness").
    this._liveModelByModelId.clear();
    this._liveEpochs.clear();
    this._modelByEpoch.clear();
    this._representativeFragmentByGeometry.clear();
    this._placementByEpoch.clear();
    this._placementRevisionByEpoch.clear();
    this._placementInvalidatedAtRevision.clear();
    try {
      this._tlasCache?.releaseAll?.();
    } catch {
      // dispose() is contractually non-throwing -- same defense-in-depth posture as _registry above.
    }
  }

  // Deliberately synchronous — the spec's "no await, no reentrant call between check and commit"
  // guarantee (docs/...:2991-3002) is satisfied for free by JS's single-threaded execution as long
  // as this method's own body never awaits. Callers MUST invoke this immediately after their own
  // extraction walk's last possible yield — not after any further await of their own.
  admitCollisionInstances(lease, uniqueFragments) {
    // Validate the lease FIRST (disposed, then modelLifecycle/epoch match) — synchronous, so it costs
    // nothing toward the atomicity guarantee below, but closes a real gap codex-advisor review found:
    // without this, a caller holding a stale epoch number (e.g. after its own model was evicted)
    // could silently recreate a bucket for a dead epoch that nothing will ever release again.
    if (this._disposed) throw new WorldDisposedError();
    this._assertEpochLive(lease.model, lease.epoch);
    const loadEpoch = lease.epoch;

    // Step 2 (docs/...:2977-2985): call-wide precheck, before touching any bucket.
    if (uniqueFragments.size > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('call-wide-unique-fragment-precheck', {
        loadEpoch,
        requested: uniqueFragments.size,
        limit: maxCollisionInstancesPerEpoch,
      });
    }

    // Step 3 (docs/...:2986-2990): look up WITHOUT creating; recompute against CURRENT contents.
    const existingBucket = this._instanceCache.get(loadEpoch) || null;
    const missing = [];
    for (const fragmentId of uniqueFragments.keys()) {
      if (!existingBucket || !existingBucket.has(fragmentId)) missing.push(fragmentId);
    }

    // Step 4 (docs/...:2991-3002): same synchronous step, check combined size, then commit.
    const currentSize = existingBucket ? existingBucket.size : 0;
    if (currentSize + missing.length > maxCollisionInstancesPerEpoch) {
      throw new CapacityExceededError('bucket-capacity', {
        loadEpoch,
        currentSize,
        missing: missing.length,
        limit: maxCollisionInstancesPerEpoch,
      });
    }

    // Stage every missing instance fully constructed/frozen BEFORE mutating any shared state, so a
    // construction failure (however unlikely — Object.freeze on a plain literal cannot realistically
    // throw, but this keeps the guarantee true by construction rather than by luck) can never leave a
    // half-committed bucket (codex-advisor review).
    const staged = missing.map((fragmentId) => {
      const { geometryIdentity } = uniqueFragments.get(fragmentId);
      return [fragmentId, Object.freeze({ fragmentId, geometryIdentity })];
    });

    let bucket = existingBucket;
    if (!bucket) {
      bucket = new Map();
      this._instanceCache.set(loadEpoch, bucket);
    }
    for (const [fragmentId, instance] of staged) bucket.set(fragmentId, instance);

    // Return canonical instances for every key the caller asked about — hits and new admissions alike.
    const result = new Map();
    for (const fragmentId of uniqueFragments.keys()) result.set(fragmentId, bucket.get(fragmentId));
    return result;
  }

  // Task 6: side-effect-free mirror of admitCollisionInstances's own real check
  // (CollisionWorld.js's own step 2/4 above) -- computes whether an admission WOULD succeed,
  // without touching `_instanceCache`. Used to preflight EVERY epoch a multi-model findClashes call
  // touches, all before committing any of them, so a later epoch's capacity failure can never leave
  // an earlier epoch partially admitted (design-review-fixed: extraction size alone is NOT the real
  // check -- an epoch that already holds instances only fails on currentSize + genuinely-NEW-id
  // count, which this replicates exactly).
  //
  // `uniqueFragments` here must already be the UNION of every source/target extraction touching
  // this one epoch in this call (a duplicate targets entry for the same model, or the source and a
  // target sharing a model, are unioned BEFORE preflighting -- exactly as the real commit step
  // unions them, `findClashes`'s own `perEpochUnique` construction).
  //
  // Returns `{ok: true}` or `{ok: false, reason, details}` -- `reason` is one of the SAME kind
  // strings (`'call-wide-unique-fragment-precheck'` / `'bucket-capacity'`) admitCollisionInstances
  // itself throws under, and `details` mirrors that method's own CapacityExceededError payload
  // field-for-field, so a preflight rejection and a (hypothetical) real-commit rejection for the
  // same input are indistinguishable to a caller.
  _preflightCollisionInstanceAdmission(lease, uniqueFragments) {
    const loadEpoch = lease.epoch;
    if (uniqueFragments.size > maxCollisionInstancesPerEpoch) {
      return {
        ok: false,
        reason: 'call-wide-unique-fragment-precheck',
        details: { loadEpoch, requested: uniqueFragments.size, limit: maxCollisionInstancesPerEpoch },
      };
    }
    const existingBucket = this._instanceCache.get(loadEpoch) || null;
    let missingCount = 0;
    for (const fragmentId of uniqueFragments.keys()) {
      if (!existingBucket || !existingBucket.has(fragmentId)) missingCount++;
    }
    const currentSize = existingBucket ? existingBucket.size : 0;
    if (currentSize + missingCount > maxCollisionInstancesPerEpoch) {
      return {
        ok: false,
        reason: 'bucket-capacity',
        details: { loadEpoch, currentSize, missing: missingCount, limit: maxCollisionInstancesPerEpoch },
      };
    }
    return { ok: true };
  }

  _releaseEpochScopedState(epoch) {
    if (this._registry && typeof this._registry.releaseEntriesForEpoch === 'function') {
      try {
        this._registry.releaseEntriesForEpoch(epoch);
      } catch {
        // See evictModel's own comment: this method's caller (evictModel) must never throw, so a
        // misbehaving registry release path is swallowed here rather than propagated. Task 13/14's
        // GeometryRegistry should itself be non-throwing by contract; this is defense in depth, not
        // a substitute for that contract.
      }
    }
    this._instanceCache.delete(epoch); // Task 18's bucket for exactly the outgoing epoch.
    // Task 19's two epoch-scoped side tables, released on exactly the same boundary — leaving
    // either behind would keep a dead Model object alive and let a later _resolveGeometryView call
    // resolve a fragment against an evicted epoch.
    this._modelByEpoch.delete(epoch);
    this._representativeFragmentByGeometry.delete(epoch);
    // Task 9's two epoch-scoped side tables, released on the same boundary.
    this._placementByEpoch.delete(epoch);
    this._placementRevisionByEpoch.delete(epoch);
    // Task 11's marker, released on the same boundary (codex-review flagged this table's release
    // was missing from Task 9's own step -- Task 9 was written before this table existed).
    this._placementInvalidatedAtRevision.delete(epoch);
    // Task 10: same defensive try/catch pattern as _registry.releaseEntriesForEpoch above -- held
    // to the same non-throw contract evictModel/dispose already guarantee, even though TlasCache
    // itself is fully controlled and verified non-throwing by design. `?.` guards the registry-
    // less/TLAS-less world case (constructed directly, bypassing fromViewer).
    try {
      this._tlasCache?.releaseEntryForEpoch(epoch);
    } catch {
      // Defense in depth, not a substitute for TlasCache's own non-throw contract.
    }
  }

  // Entry-order check for findClashes's single-distinct-model path (Tasks 19/20 originally called
  // this at the very top of their own method body). docs/...:2830-2837, 3533-3543.
  //
  // Task 6: the `source.model !== target.model` cross-model rejection this method used to throw
  // has been REMOVED -- cross-model queries are now in scope (see findClashes's own
  // collectDistinctModels-driven multi-lease capture, which handles the truly-multi-model case
  // directly via `admitModel` per distinct model). This method is kept, unmodified otherwise, for
  // exactly the single-distinct-model path (findClashes calls it only when
  // `distinctModels.length === 1`), so its own direct unit tests
  // (test/CollisionWorld.test.mjs) and the legacy single-model call path both keep the identical
  // disposed-then-evicted-then-lazy-admission behavior and ordering they always had. `target` is
  // now an unused parameter (the only thing it was ever read for is the branch just removed) --
  // kept so the existing two-argument call shape (including test/CollisionWorld.test.mjs's own
  // direct calls) needs no signature change.
  _checkEntryLifecycle(source, target) { // eslint-disable-line no-unused-vars
    if (this._disposed) throw new WorldDisposedError();
    const model = source.model;
    const entry = this._modelLifecycle.get(model);
    if (entry?.state === 'evicted') throw new ModelEvictedError(modelIdOf(model));
    if (entry?.state === 'live') return { model, epoch: entry.epoch };
    return this.admitModel(model); // never-seen -> lazy admission, same path admitModel exposes publicly
  }

  /**
   * The instance-tree readiness wait, per docs/superpowers/specs/instance-tree-readiness-decision.md
   * ("Decision": outcome (a) wait; "Hook point for implementation").
   *
   * Closes that record's Mode 1 -- "tree not yet created at all" -- using the Viewer's own
   * documented, public async-completion accessor. It does NOT close Mode 2 ("tree object exists but
   * under-populated"), which that record explicitly records as residual and undischarged: no Viewer
   * signal is documented or observed to guarantee enumeration has stabilized, and this
   * implementation deliberately does not layer the kit's optional retry-until-stable heuristic on
   * top (the decision record leaves that open rather than mandating it).
   *
   * CONDITIONALLY SYNCHRONOUS, exactly like this library's checkpoint port: it returns `undefined`
   * outright on the ready path and a real Promise only when a wait is genuinely needed, and callers
   * MUST branch on that (`const pending = ...; if (pending) await pending;`) rather than bare-`await`
   * it. `await` on an already-settled value still inserts a microtask boundary, and this codebase
   * treats that boundary as load-bearing, not cosmetic (see ViewerModelAdapter's own Item-D fix and
   * its "checkpoint returning undefined inserts NO microtask boundary before the model is read"
   * fixture) -- the decision record's "proceed synchronously (fast path, no added latency for the
   * common case)" is honoured literally here.
   *
   * `isObjectTreeCreated()` true means the tree object already exists (it is
   * `!!model.getData().instanceTree`, set in the same synchronous block that dispatches
   * OBJECT_TREE_CREATED_EVENT), so there is nothing to wait for and getObjectTree is not even called.
   *
   * With no predicate but a `getObjectTree` present, the documented accessor is used anyway rather
   * than assuming readiness -- declining to wait merely because the (equally documented) predicate is
   * missing would silently abandon the strategy this decision record selected. Only a model
   * implementing NEITHER accessor is treated as unwaitable: there is nothing left to ask, and
   * extraction reads the tree immediately afterwards and fails loudly if it is absent.
   */
  _awaitObjectTreeReady(model) {
    if (typeof model?.isObjectTreeCreated === 'function' && model.isObjectTreeCreated() === true) {
      return undefined; // synchronous fast path -- no Promise, no microtask boundary
    }
    if (typeof model?.getObjectTree !== 'function') return undefined;
    return new Promise((resolve, reject) => {
      model.getObjectTree(
        () => resolve(),
        // The Viewer's own "the property database / tree could not be built" signal. Reject with a
        // clearly-named error of its own rather than silently walking an unavailable tree.
        (err) => reject(new ObjectTreeUnavailableError(modelIdOf(model), err)),
      );
    });
  }

  // Used by Task 18's admitCollisionInstances lease validation, which needs full model+epoch
  // cross-checking (not just epoch liveness) against a specific model object. Kept verbatim from the
  // brief's own Step 3 for that later task's use — the checkpoint port itself does NOT use this; it
  // uses _isEpochLive(loadEpoch) instead (see createCheckpointPort below).
  _assertEpochLive(model, loadEpoch) {
    const entry = this._modelLifecycle.get(model);
    if (!entry || entry.state !== 'live' || entry.epoch !== loadEpoch) {
      throw new ModelEvictedError(modelIdOf(model));
    }
  }

  // Task 6: composite multi-lease liveness assertion -- disposed, THEN every captured lease's own
  // epoch still live, in that order (same "disposed first" precedence every other check in this
  // class uses). Used at every point design spec §9.2 point 7 requires a full-lease-set revalidation
  // that is NOT already covered by a single-epoch-scoped check: immediately before findClashes's own
  // return statements (success and empty-result alike), and by createCompositeCheckpointPort both
  // before AND after any real scheduler yield. For a single-model call `leases` has exactly one
  // entry, so this is a cheap, harmless restatement of what `_assertEpochLive`/the real checkpoint
  // port already check for that one lease.
  _assertLeasesStillLive(leases) {
    if (this._disposed) throw new WorldDisposedError();
    for (const lease of leases) {
      if (!this._isEpochLive(lease.epoch)) throw new ModelEvictedError(modelIdOf(lease.model));
    }
  }

  // Reverse-lookup predicate for the real checkpoint port primitive (collision/scheduler.js's
  // createCheckpointPort's own isEpochLive dependency) and for Task 19's separate GeometryRegistry
  // checkpoint port (isEpochLive: (loadEpoch) => world._isEpochLive(loadEpoch)). Safe and equivalent
  // to a model+epoch check because loadEpoch is global/monotonic/never-reused.
  _isEpochLive(loadEpoch) {
    return this._liveEpochs.has(loadEpoch);
  }

  // Real checkpoint port FACTORY — one call per findClashes invocation. Each call creates a FRESH,
  // closure-local accumulator (docs/...: "one performance.now()-based accumulator for the whole
  // call" — never shared across concurrent calls). This is a pure pass-through to the real
  // createCheckpointPort primitive in collision/scheduler.js, which already owns the
  // conditionally-synchronous ordering/yield contract (undefined synchronously when not due, a real
  // Promise only when a yield is actually due) — CollisionWorld supplies only the lifecycle state
  // (isDisposed/isEpochLive, both correctly global) and a fresh accumulator/clock-baseline per call.
  createCheckpointPort(lease) {
    const accumulator = createFrameBudgetAccumulator({ now: this._now });
    const realPort = createRealCheckpointPort({
      isDisposed: () => this._disposed,
      isEpochLive: (loadEpoch) => this._isEpochLive(loadEpoch),
      accumulator,
      yieldToScheduler: this._yieldToScheduler,
    });
    return (ctx = {}) => {
      const model = ctx.model !== undefined ? ctx.model : lease.model;
      const loadEpoch = ctx.loadEpoch !== undefined ? ctx.loadEpoch : lease.epoch;
      // `label`, when the caller supplies one, is threaded straight through to the real port so
      // its Task-23 span-recorder hook can bracket the synchronous span since the previous
      // checkpoint call under that stable, distinct name (see collision/scheduler.js).
      return realPort.checkpoint({ loadEpoch, modelIdHint: modelIdOf(model), label: ctx.label });
    };
  }

  // Task 6: a composite wrapper around ONE real per-call checkpoint port (createCheckpointPort,
  // unchanged) that revalidates EVERY captured lease -- not just the single lease the real port
  // itself is scoped to -- both BEFORE delegating to the real port and, when the real port actually
  // yields, AGAIN after that yield resolves.
  //
  // The after-yield revalidation is NOT redundant with the real port's own post-yield check
  // (collision/scheduler.js's own validate-await-validate sequence): that check only re-validates
  // whichever single `loadEpoch` THIS call's `ctx` named (or this port's own primary lease, by
  // default) -- a DIFFERENT captured epoch, evicted during that same yield, would otherwise escape
  // detection until whatever this call's NEXT checkpoint happens to be (codex-advisor review
  // finding for this task: checking only before delegation leaves exactly that window open).
  //
  // Reuses ONE real port/accumulator, built from an arbitrary "primary" lease (`leases[0]`, always
  // the query's own source model -- see collectDistinctModels) -- its own isEpochLive/isDisposed
  // callbacks are world-global, not lease-specific, so which lease is "primary" affects nothing but
  // which loadEpoch a caller's un-labeled `ctx` defaults to. This keeps the frame-budget accumulator
  // shared exactly once across the whole call, as every other checkpoint port in this design is.
  //
  // Still conditionally synchronous end to end: `undefined` when the real port has nothing due (no
  // Promise, no microtask boundary, after the synchronous pre-check above), a real Promise only when
  // the real port itself decides a yield is due.
  // Task 14 (M2 Batch 4): `tlasConsultedEpochs` (default empty -- every pre-Task-14 caller, and
  // every `broadPhase:'linear'` call, passes none) arms placement-revision revalidation for exactly
  // those epochs. Scoped deliberately (spec §9.2 point 8's own closing note): "a broadPhase:'linear'
  // call never consults `_placementByEpoch`/a cached TLAS for its own correctness and would gain
  // nothing from this check but spurious aborts from unrelated concurrent growth." Snapshotting
  // `expectedRevisionByEpoch` HERE, at true query entry (before this call's own extraction/
  // `_recordPlacement` ever touches any of these epochs), is what makes `_recordPlacement`'s own
  // pre-insertion compare-and-abort + sync-forward (spec §6.7.5's self-invalidation-avoidance rule)
  // correct: this query's OWN later growth is synced INTO this same map as it happens, so only a
  // change this query did NOT itself cause is ever detected as a mismatch below.
  createCompositeCheckpointPort(leases, tlasConsultedEpochs = new Set()) {
    const realCheckpoint = this.createCheckpointPort(leases[0]);
    const expectedRevisionByEpoch = new Map(
      [...tlasConsultedEpochs].map((epoch) => [epoch, this._placementRevisionByEpoch.get(epoch) ?? 0]),
    );
    // Precedence, matching this class's own established "disposed, then evicted" convention,
    // extended one level narrower here: disposed -> evicted (both already enforced by
    // `_assertLeasesStillLive`, called immediately before this) -> placement-revision mismatch.
    const assertPlacementUnchanged = () => {
      for (const [epoch, expected] of expectedRevisionByEpoch) {
        const actual = this._placementRevisionByEpoch.get(epoch) ?? 0;
        if (actual !== expected) {
          const model = this._modelByEpoch.get(epoch);
          throw new ModelPlacementChangedError({
            modelId: modelIdOf(model), loadEpoch: epoch, expectedRevision: expected, actualRevision: actual,
          });
        }
      }
    };
    const port = (ctx = {}) => {
      this._assertLeasesStillLive(leases);
      assertPlacementUnchanged();
      const pending = realCheckpoint(ctx);
      if (!pending) return undefined;
      return (async () => {
        await pending;
        this._assertLeasesStillLive(leases);
        assertPlacementUnchanged();
      })();
    };
    // Exposed so `_recordPlacement`'s own pre-insertion compare-and-abort check (Task 9, extended
    // here) can sync THIS query's own growth-triggered revision bumps into this SAME map, after
    // that check passes -- see `_recordPlacement`'s own comment.
    port.expectedRevisionByEpoch = expectedRevisionByEpoch;
    // codex-advisor review (Task 14): a SYNCHRONOUS, disposed -> evicted -> placement-revision check
    // with the SAME precedence/logic the port itself runs on every checkpoint call -- but return-site
    // revalidation (design spec §9.2 point 7b) and the object-tree-readiness wait's own revalidation
    // do NOT go through a checkpoint call at all (no yield to schedule around), so they previously
    // called only `_assertLeasesStillLive`, silently exempting them from placement revalidation. A
    // stale result could therefore still be returned if an external change landed during the LAST
    // shared-resource await before a return (e.g. a GeometryRegistry build another caller is also
    // awaiting) or during a real, potentially multi-second object-tree readiness wait. Exposed here
    // so `findClashes` can call it at exactly those points, matching the port's own checks exactly.
    port.assertCurrent = () => {
      this._assertLeasesStillLive(leases);
      assertPlacementUnchanged();
    };
    return port;
  }

  // ---- Task 19: the surface-intersection vertical slice -------------------------------------

  /**
   * Entry -> extraction -> capacity-gated admission -> broad phase -> narrow phase -> aggregation.
   *
   * `groupBy: 'dbId'` only, all three query modes supported.
   *
   * Task 6: cross-model queries are no longer rejected. `target` accepts either the legacy
   * `{model, dbIds}` shape (unchanged, single target model) or `{targets: [{model, dbIds?}, ...]}`
   * (one or more target models; a `targets` entry's `dbIds` may be omitted as a whole-model-scope
   * sentinel). See `normalizeTargets`/`collectDistinctModels` above. Every distinct Model object
   * across source + every targets entry is leased (admitted) up front, and every checkpoint/return
   * in this method revalidates the FULL captured lease set, not just whichever epoch a given
   * sub-step happens to touch.
   *
   * Tasks 7/8: the broad phase runs once per distinct TARGET epoch (`targetGroups`), applying source
   * self-exclusion (`isSourceOwnFragment`, spec §4.4's assembly-rooted rule) before a candidate pair
   * is ever counted or retested, and the narrow phase threads real per-operand `{model, epoch}` pairs
   * (`sourceOperand`/`targetOperand`) through `_runNarrowPhasePair` and `fragmentRef` -- every
   * diagnostic and every `ClashPair.source`/`target` names its OWN operand's model, never a single
   * call-wide shared one. Pair-dedup is epoch-qualified
   * (`` `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` ``), so two different target
   * models sharing a numeric dbId no longer collapse into one pair.
   *
   * @param {{ source: {model: Object, dbIds: number[]},
   *           target: {model: Object, dbIds: number[]} | {targets: Array<{model: Object, dbIds?: number[]}>},
   *           mode: string, groupBy: 'dbId', broadPhase?: 'linear'|'tlas' }} query
   * @returns {Promise<{ pairs: Array, statistics: Object }>}
   */
  async findClashes(query) {
    // Disposal is checked FIRST, before argument validation and before any operand is touched, so a
    // disposed world always reports disposal rather than whichever other complaint it might also
    // have (spec entry order: "disposed first"). _checkEntryLifecycle/admitModel re-check it below;
    // that repetition is deliberate and free.
    if (this._disposed) throw new WorldDisposedError();

    if (!query || !query.source || !query.target) {
      throw new Error('findClashes: query must supply both a source and a target operand');
    }
    if (!Array.isArray(query.source.dbIds)) {
      throw new Error('findClashes: query.source.dbIds and query.target.dbIds must both be arrays');
    }
    // The legacy `{model, dbIds}` target shape still requires `dbIds` to be an array, exactly as
    // before (Protected Invariant: legacy behavior unchanged verbatim) -- but only when the NEW
    // `targets` shape isn't the one actually supplied; a `targets` call is validated by its own
    // per-entry rules below instead.
    if (!Array.isArray(query.target.targets) && !Array.isArray(query.target.dbIds)) {
      throw new Error('findClashes: query.source.dbIds and query.target.dbIds must both be arrays');
    }
    if (query.groupBy !== 'dbId') {
      throw new Error(
        `findClashes: unsupported groupBy '${query.groupBy}' (only 'dbId' is implemented in Milestone 1)`,
      );
    }
    if (!supportedModes.includes(query.mode)) {
      throw new Error(`findClashes: unsupported mode '${query.mode}'`);
    }
    // (Task 19's `mode !== 'surface-intersection'` placeholder rejection lived here; Task 20's
    // dispatch in _runNarrowPhasePair now handles all three modes, so the only mode check left is
    // the supportedModes membership test above.)
    // M3 Task 9: `clearance` is a REQUIRED, finite, positive number for mode:'clearance', and is
    // REJECTED outright for every other mode (never silently ignored) -- catches a caller mixing
    // clearance-only params onto a Hard-Clash-style call before any lease/epoch is ever consumed.
    if (query.mode === 'clearance') {
      if (typeof query.clearance !== 'number' || !Number.isFinite(query.clearance) || query.clearance <= 0) {
        throw new Error("findClashes: mode 'clearance' requires a finite, positive 'clearance' number");
      }
    } else if ('clearance' in query && query.clearance !== undefined) {
      throw new Error(`findClashes: 'clearance' is only valid when mode is 'clearance', got mode '${query.mode}'`);
    }

    // --- Task 6, Step 8: new query-shape validation, in this precedence order (disposed already
    // checked above; these run after the pre-existing groupBy/mode checks and before any
    // admitModel/lease-capture call).
    if (Array.isArray(query.target.targets) && query.target.targets.length === 0) {
      throw new Error('findClashes: targets must be non-empty when supplied');
    }
    if (query.target.dbIds !== undefined && query.target.targets !== undefined) {
      throw new Error('findClashes: target must be either {model,dbIds} or {targets}, not both');
    }
    // M-1 fix (Batch 2 whole-batch review): Task 6 added "every targets entry must supply a model"
    // validation for the NEW `targets`-array shape (below) but left `query.source.model` and a
    // legacy (non-`targets`) `query.target.model` unchecked -- a missing/null model there used to
    // fail cleanly in M1 but now silently proceeds into `collectDistinctModels` -> a `Set`
    // containing `undefined`/`null` -> `admitModel(undefined)` -> an internal
    // "Invalid value used as weak map key" TypeError, AFTER already consuming a global `loadEpoch`
    // for the OTHER, valid model in the call. Checked here, at the SAME point in the validation
    // sequence as the targets-entry check below and BEFORE any lease capture, so this rejection
    // path never wastes an epoch.
    if (query.source.model === undefined || query.source.model === null) {
      throw new Error('findClashes: query.source must supply a model');
    }
    if (!Array.isArray(query.target.targets)
      && (query.target.model === undefined || query.target.model === null)) {
      throw new Error('findClashes: query.target must supply a model');
    }
    if (Array.isArray(query.target.targets)) {
      for (const entry of query.target.targets) {
        if (!entry || entry.model === undefined || entry.model === null) {
          throw new Error('findClashes: every targets entry must supply a model');
        }
        // An explicit `dbIds: undefined` remains the whole-model-scope sentinel; `dbIds: null` is
        // REJECTED, not silently treated as omitted -- entry.dbIds !== undefined is true for null.
        if (entry.dbIds !== undefined && !Array.isArray(entry.dbIds)) {
          throw new Error('findClashes: targets entry dbIds must be an array when supplied');
        }
      }
    }
    if (query.broadPhase !== undefined && query.broadPhase !== 'tlas' && query.broadPhase !== 'linear') {
      throw new Error(`findClashes: unsupported broadPhase '${query.broadPhase}'`);
    }
    // Task 13 (M2 Batch 4): `broadPhase:'tlas'` now dispatches to a REAL accelerated path
    // (`_runTlasBroadPhase`) rather than silently falling back to the linear scan -- the
    // placeholder behavior this comment used to document (a Batch 3-era stopgap) no longer applies.
    //
    // spec §3.5 (an already-accepted review fix, "Important #2") requires a SHAPE-DEPENDENT
    // default: the new `targets` shape defaults to 'tlas', the legacy `{model,dbIds}` shape keeps
    // defaulting to 'linear' (byte-for-byte M1 compatibility, including placement freshness). An
    // earlier draft of this task deferred implementing this default (reasoning that two dozen+
    // pre-existing `targets`-shape tests with no explicit `broadPhase` would silently flip onto a
    // brand-new path) -- a codex-advisor review of this task's own diff correctly pushed back: those
    // tests are exactly the blast-radius detection this change needs, and in fact one of them is
    // what surfaced this task's own Critical finding (see `_runTlasBroadPhase`'s own comment on
    // resolving hits through the CURRENT call's target instances, never the cached placement table).
    // Computed ONCE, right here, and used for both this default AND the maxBroadPhaseInstancePairs
    // ceiling bypass below (spec §9.3, "not applied under broadPhase:'tlas' at all" -- the ceiling's
    // own O(sourceCount x targetCount) precheck is meaningless for a TLAS call, whose real cost is
    // NOT proportional to that product, and would reject queries the TLAS exists specifically to
    // make cheap).
    // M3 Task 9 (codex-advisor review, that task): `mode:'clearance'` had no TLAS broad-phase variant
    // yet at that point, so a `targets`-shaped clearance call was forced to default to 'linear'
    // regardless of shape, and an explicit `broadPhase:'tlas'` was rejected outright. M3 Task 10 now
    // supplies that variant (`_runClearanceTlasBroadPhase`, consulted in the clearance dispatch
    // below), so this collapses back to the ORIGINAL, uniform, shape-dependent expression the three
    // pre-existing modes already use -- a `targets`-shaped clearance call defaults to 'tlas' exactly
    // like they do, and an explicit `broadPhase:'tlas'` is accepted rather than rejected.
    const effectiveBroadPhase = query.broadPhase ?? (Array.isArray(query.target.targets) ? 'tlas' : 'linear');

    const startedAt = this._now();
    const statistics = emptyStatistics();

    // --- Operand normalization and multi-lease capture (design spec §9.2 points 1-3), before any
    // extraction begins. `targetsEntries` is the uniform `{model, dbIds}[]` shape every later step
    // operates on; `distinctModels` is the deduplicated (by object identity) set of every Model
    // object this call touches, source included, source always first.
    //
    // `sourceDbIds` is a defensive copy of `query.source.dbIds`, taken here at entry -- matching
    // `normalizeTargets`'s own defensive-copy discipline for every target's dbIds (`.slice()`
    // above). Without this, a caller mutating its own `query.source.dbIds` array during this call's
    // later async gaps (the instance-tree readiness wait below, in particular) could change what
    // `extractFragments` actually walks, well after this call already committed to the array it was
    // handed at entry.
    const sourceDbIds = query.source.dbIds.slice();
    const targetsEntries = normalizeTargets(query.target);
    const distinctModels = collectDistinctModels(query.source.model, targetsEntries);
    if (this._disposed) throw new WorldDisposedError();
    // Single-distinct-model calls (the legacy path, and a multi-`targets`-entry call that happens
    // to name only ONE model throughout) go through `_checkEntryLifecycle` unchanged -- identical
    // disposed-then-evicted-then-lazy-admission behavior/ordering to every pre-Task-6 test's own
    // expectations. A genuinely multi-model call leases every distinct model directly via the same
    // public `admitModel` each of those single-model leases would otherwise go through.
    const leases = distinctModels.length === 1
      ? [this._checkEntryLifecycle(query.source, query.target)]
      : distinctModels.map((m) => this.admitModel(m)); // throws ModelEvictedError per M1 admitModel contract
    const leaseByModel = new Map(leases.map((l) => [l.model, l]));
    // M3 Task 8: declared here (not built here) so the clearance-only admission-validation
    // filtering block below (right before `targetTotalCount` is computed) can build and use a
    // per-epoch lease lookup early, to attribute a target-side `clearance-invalid-transform`
    // diagnostic to the right model. Deliberately `let`, uninitialized, rather than eagerly built
    // here (codex-advisor review, this task): eagerly constructing this Map this early would cost
    // the three pre-existing modes real, if tiny, unconditional work on paths that previously never
    // built it at all (the empty-extraction fast path in particular, which returns before this
    // point in the original code) and would shift what the checkpoint port's own frame-budget clock
    // baseline (`createCompositeCheckpointPort`, just below) measures. Left `undefined` here, it
    // costs the three pre-existing modes nothing extra; the ORIGINAL `const leaseByEpoch = ...`
    // call site (now `leaseByEpoch ??= ...`, see its own comment) still builds it at exactly the
    // same point those modes always built it, so their behavior is unaffected byte-for-byte.
    let leaseByEpoch;

    // Task 14: the set of epochs THIS query will consult via a cached TLAS -- every distinct epoch
    // among the query's own `targetsEntries`' models. Known immediately from `leaseByModel`, with NO
    // extraction needed: WHICH epochs are targets is fixed by which MODELS are targets, not by which
    // fragments extraction later finds within them. Empty for `effectiveBroadPhase !== 'tlas'`
    // (never armed for a linear call, per spec §9.2 point 8's own scope).
    const tlasConsultedEpochs = effectiveBroadPhase === 'tlas'
      ? new Set(targetsEntries.map((entry) => leaseByModel.get(entry.model).epoch))
      : new Set();

    // ONE composite checkpoint port for this whole call (Task 6): revalidates every captured lease
    // on every checkpoint call, then delegates to ONE real per-call port/accumulator (keyed off the
    // source's own lease, `leases[0]`) shared by every checkpoint site in this call (extraction,
    // broad phase, narrow phase) -- unconditionally, even for a single-model call, since a
    // one-element composite check is a harmless, cheap restatement of what the real port already
    // checks internally.
    //
    // codex-advisor review (Task 14): constructed HERE -- immediately after lease capture, BEFORE
    // the object-tree readiness wait below -- not after it (an earlier draft placed this call after
    // that wait, which meant `expectedRevisionByEpoch`'s own revision snapshot silently absorbed any
    // external change landing during a REAL, potentially multi-second readiness wait as the accepted
    // baseline, rather than catching it). "Query entry" (spec §9.2 point 8, this method's own design
    // intent) means truly the earliest point every captured epoch is known, which is here.
    const checkpoint = this.createCompositeCheckpointPort(leases, tlasConsultedEpochs);

    // Instance-tree readiness wait, immediately after the entry-order lifecycle checks and BEFORE
    // any extraction (docs/superpowers/specs/instance-tree-readiness-decision.md, "Hook point for
    // implementation") -- generalized across EVERY distinct model this call captured, not just one.
    // `_awaitObjectTreeReady` is keyed by model, not by call, so this is safe to invoke once per
    // distinct model even though a legacy single-model call already did so exactly once before.
    //
    // Branch on each return value; do NOT bare-`await` any of them. On the all-ready fast path this
    // must not even cost a microtask boundary (see _awaitObjectTreeReady's own comment) -- so
    // `Promise.all` is only invoked when at least one wait is genuinely pending.
    const pendingObjectTreeWaits = [];
    for (const lease of leases) {
      const pending = this._awaitObjectTreeReady(lease.model);
      if (pending) pendingObjectTreeWaits.push(pending);
    }
    if (pendingObjectTreeWaits.length > 0) {
      // A REAL wait can last as long as the Viewer's property-database load, i.e. seconds -- far
      // wider a window than any other gap in this method -- so the FULL captured lease set is
      // revalidated across it. Without this, an eviction or disposal landing mid-wait could still be
      // reported as a SUCCESSFUL empty result: extraction's own first checkpoint is what normally
      // catches such a race (one non-empty operand is enough for that), but it never fires AT ALL
      // when every dbIds scope is empty -- ViewerModelAdapter's per-dbId loop body never runs -- and
      // the empty-extraction branch below then returns { pairs: [] } as a success.
      try {
        await Promise.all(pendingObjectTreeWaits);
      } finally {
        // In `finally`, deliberately: this runs on the failure path too, and a throw here REPLACES a
        // pending ObjectTreeUnavailableError -- which is the correct precedence. Disposal (and any
        // OTHER captured model's eviction) outranks "the tree could not be built", in the same order
        // the entry checks above use (disposed first, then evicted). Task 14 (codex-advisor review):
        // `checkpoint.assertCurrent()`, not a bare `_assertLeasesStillLive` -- this wait can run as
        // long as the Viewer's own property-database load, by far the widest gap in this whole
        // method, so a placement change landing during it must be caught here too, not just liveness.
        checkpoint.assertCurrent();
      }
    }

    // --- Extraction. Source is always exactly one model (query.source.model); its own dbIds are
    // walked via extractFragments, unchanged from pre-Task-6 behavior.
    const sourceLease = leaseByModel.get(query.source.model);
    const sourceEpoch = sourceLease.epoch;
    // `THREE` is deliberately NOT overridden anywhere in this method: extraction's own
    // `globalThis.THREE` default is the Viewer's real r71 global, and reading it there is the one
    // sanctioned crossing point.
    const sourceExtracted = await extractFragments(query.source.model, sourceDbIds, sourceEpoch, { checkpoint });

    // One extraction per `targets` entry, each against ITS OWN model's own lease/epoch, merged into
    // `Map<epoch, Map<fragmentId, record>>` -- NEVER a single flat `Map<fragmentId, record>` across
    // different models' extractions (codex-advisor review finding for this task): `fragmentId` is
    // only unique WITHIN one model's own fragment-index space, so two different models can both
    // legitimately own a fragment numbered, say, 42 -- keying a merged map by bare fragmentId across
    // models would silently clobber one with the other. Bare-fragmentId keying stays correct only
    // INSIDE one epoch's own bucket, exactly like `_instanceCache` itself
    // (`Map<loadEpoch, Map<fragmentId, CollisionInstance>>`).
    const targetRecordsByEpoch = new Map();
    // I-2 fix (Batch 2 whole-batch review): two `targets` entries naming the SAME model (e.g.
    // `targets: [{model: B}, {model: B}]`) each run `extractAllFragments(B, ...)` independently --
    // extraction re-work stays as-is (out of scope for this fix) -- but pushing EVERY diagnostic
    // from EACH run into `statistics.diagnostics` double-counts a genuine diagnostic (e.g.
    // `fragment-not-loaded` for one specific fragment) that only happened once. Deduped THIS CALL using
    // the same discipline `oversizedDiagnosedFragments` already applies on the narrow-phase side:
    // keyed by a composite of every field that makes one diagnostic entry unique. `role` is always
    // `'target'` for extractAllFragments's own diagnostics (its own interface contract) and
    // `modelId` is fixed per epoch, so `(epoch, fragId, reason)` alone is a total key here.
    const pushedWholeModelDiagnosticKeys = new Set();
    // Task 12 (M2 Batch 4): built as a byproduct of this SAME extraction loop -- purely additive
    // here, exactly like Task 9's _recordPlacement was when it first landed. Not yet consumed by
    // any broad-phase path (Task 13's job); see _addToTargetScopeFilter's own comment.
    const targetScopeFilter = new Map();
    for (const entry of targetsEntries) {
      const entryLease = leaseByModel.get(entry.model);
      const entryEpoch = entryLease.epoch;
      let records;
      if (Array.isArray(entry.dbIds)) {
        records = await extractFragments(entry.model, entry.dbIds, entryEpoch, { checkpoint });
      } else {
        // Whole-model-scope sentinel (`entry.dbIds === undefined`, validated above). Task 6 wires
        // the EXTRACTION call itself so the shape survives end-to-end; fully consuming this scope
        // through the broad/narrow phase for a genuinely non-empty call is Task 8's job.
        const wholeModel = await extractAllFragments(entry.model, entryEpoch, { checkpoint });
        records = wholeModel.records;
        for (const diagnostic of wholeModel.diagnostics) {
          const key = `${entryEpoch}:${diagnostic.fragment.fragId}:${diagnostic.reason}`;
          if (pushedWholeModelDiagnosticKeys.has(key)) continue;
          pushedWholeModelDiagnosticKeys.add(key);
          statistics.diagnostics.push(diagnostic);
        }
      }
      this._addToTargetScopeFilter(targetScopeFilter, entry.model, entry.dbIds, records);
      let bucket = targetRecordsByEpoch.get(entryEpoch);
      if (!bucket) { bucket = new Map(); targetRecordsByEpoch.set(entryEpoch, bucket); }
      // First-write-wins across duplicate `targets` entries touching the same model/epoch -- mirrors
      // extractFragments's own first-discovery-wins ownerDbId convention, rather than letting a
      // later duplicate entry silently overwrite an earlier one's captured ownerDbId.
      for (const [fragId, rec] of records) {
        if (!bucket.has(fragId)) bucket.set(fragId, rec);
      }
    }

    // M3 Task 8: clearance-only admission validation, run HERE -- immediately after
    // `targetRecordsByEpoch` is fully built and BEFORE `targetTotalCount` is computed just below,
    // and well before any of `_recordRepresentativeFragments`/`_recordPlacement`/
    // `admitCollisionInstances` run -- never later, and never inside a broad-phase candidate loop
    // (see this task's brief, "Fix (Critical #4)": a NaN-bounds target might never surface as a TLAS
    // candidate at all, so per-candidate validation would silently never run for it). Ordering
    // against `targetTotalCount` matters concretely: that count feeds the empty-extraction fast-path
    // check immediately below, so it must reflect POST-filter bucket sizes for a `mode:'clearance'`
    // call, not the stale pre-filter sizes filtering earlier would leave stranded.
    //
    // Scoped strictly to `query.mode === 'clearance'` -- the other three modes' extraction/admission
    // behavior is a protected invariant and must stay byte-for-byte unchanged; this whole block is a
    // no-op for them.
    if (query.mode === 'clearance') {
      // Built HERE, on first need, only for a clearance call -- never eagerly for the three other
      // modes (see the `let leaseByEpoch;` declaration's own comment above `leaseByModel`).
      leaseByEpoch = new Map(leases.map((l) => [l.epoch, l]));
      const clearanceInvalidTransformDiagnosed = new Set();
      for (const [fragmentId, extractedRecord] of sourceExtracted) {
        if (!isValidClearanceTransform(extractedRecord)) {
          sourceExtracted.delete(fragmentId);
          diagnoseClearanceInvalidTransform(
            statistics, clearanceInvalidTransformDiagnosed, sourceLease.model, sourceEpoch, extractedRecord, 'source',
          );
        }
      }
      for (const [epoch, bucket] of targetRecordsByEpoch) {
        for (const [fragmentId, extractedRecord] of bucket) {
          if (!isValidClearanceTransform(extractedRecord)) {
            bucket.delete(fragmentId);
            diagnoseClearanceInvalidTransform(
              statistics, clearanceInvalidTransformDiagnosed, leaseByEpoch.get(epoch).model, epoch, extractedRecord, 'target',
            );
          }
        }
      }
    }

    let targetTotalCount = 0;
    for (const bucket of targetRecordsByEpoch.values()) targetTotalCount += bucket.size;

    // ---- BEGIN synchronous span. Nothing between the end of extraction and admitCollisionInstances
    // may await: admission's check-then-commit atomicity guarantee (Task 18) is provided for free by
    // JS's single-threaded execution only for as long as this span stays await-free. Recording
    // representative fragments is a pure Map write and is safe to include.
    if (sourceExtracted.size === 0 || targetTotalCount === 0) {
      statistics.totalMs = this._now() - startedAt;
      // Return-site revalidation (design spec §9.2 point 7b): the empty-extraction fast path may
      // have run through ZERO checkpoint calls at all (every dbIds scope empty means no per-dbId
      // loop body ever ran), so nothing has re-validated the captured lease set since entry -- this
      // closes exactly that gap for a genuinely multi-model call. `checkpoint.assertCurrent()` (Task
      // 14, codex-advisor review) -- placement, not just liveness, per §9.2 point 8's own explicit
      // "immediately before every return" requirement.
      checkpoint.assertCurrent();
      return { pairs: [], statistics };
    }
    // The broad-phase ceiling is checked HERE -- before any side effect, not just before the scan
    // (finding 19-2). Extraction size and admitted-instance count are the same number for this
    // check's purposes (every extracted fragment becomes exactly one CollisionInstance), so nothing
    // is lost by checking early -- but a call that is going to be REJECTED must not first consume
    // maxCollisionInstancesPerEpoch headroom via admitCollisionInstances or pollute any epoch's
    // representative-fragment map, neither of which is undone on the throw.
    //
    // Task 8 Step 5: checked ONCE PER DISTINCT TARGET EPOCH (`sourceExtracted.size x bucket.size`),
    // never as a single call-wide product against the SUM across every target epoch -- the ceiling's
    // own mathematical shape is already a single-pair product, and generalizing it to "one check per
    // pair in the call" (rather than one check per whole call) is this task's own deliberate design
    // choice: a call touching many small target models must not be rejected merely because their
    // SUM happens to exceed the ceiling when no single (source, target-epoch) pair does. This is a
    // genuine judgment call the spec's own §9.3.1 text does not settle for the *linear* ceiling --
    // that section is scoped to the *TLAS* whole-call budget only.
    //
    // I-1 fix (Batch 2 whole-batch review): this check must be reconciled against the count the
    // scan will ACTUALLY produce, not the raw pre-exclusion `bucket.size`. `_runBroadPhaseScan`
    // applies source self-exclusion (`isSourceOwnFragment`) FIRST and only counts/tests surviving
    // pairs -- so a same-model target group whose fragments substantially overlap the source's own
    // extracted set (e.g. source ⊆ target scope) can have a raw product that exceeds the ceiling
    // while the scan itself would evaluate far fewer, or even zero, real pairs. Self-exclusion can
    // only ever apply to the ONE target group (if any) sharing the source's own epoch
    // (`isSourceOwnFragment`'s own epoch-equality gate -- M2's source is always exactly one epoch),
    // so only that one group's count needs adjusting; every other (genuinely cross-model) group's
    // raw `bucket.size` is already exact, by construction, since self-exclusion never touches it.
    // Task 13 fix (codex-advisor review, High #2): this Cartesian precheck is meaningless -- and
    // actively wrong -- for `broadPhase:'tlas'` (spec §9.3: "not applied under broadPhase:'tlas' at
    // all"). A spatially disjoint TLAS query whose raw extraction counts alone exceed this ceiling
    // must still be allowed to run (and correctly produce zero candidates) rather than being
    // rejected before the TLAS ever runs; the SEPARATE, TLAS-specific `maxTlasCandidatePairs`
    // budget (checked incrementally inside `_runTlasBroadPhase`) is what actually bounds its cost.
    if (effectiveBroadPhase !== 'tlas') {
      for (const [epoch, bucket] of targetRecordsByEpoch) {
        let effectiveTargetCount = bucket.size;
        if (epoch === sourceEpoch) {
          let selfExcludedCount = 0;
          for (const fragId of bucket.keys()) {
            if (sourceExtracted.has(fragId)) selfExcludedCount++;
          }
          effectiveTargetCount = bucket.size - selfExcludedCount;
        }
        if (this._exceedsBroadPhaseCeiling(sourceExtracted.size, effectiveTargetCount)) {
          throw new Error(
            `findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs ` +
            `(${sourceExtracted.size} x ${effectiveTargetCount} > ${maxBroadPhaseInstancePairs})`,
          );
        }
      }
    }

    // Build each distinct epoch's own UNIONED `uniqueFragments` map (source + every target group
    // touching that epoch, merged) -- the same merge this method already performed per-call before
    // Task 6 (`merged`, single epoch), generalized across every epoch this call touches. Which
    // side's record wins per fragmentId is immaterial WITHIN one epoch: admitCollisionInstances
    // reads only geometryIdentity, identical for a given fragmentId regardless of which walk found
    // it. The per-side ownerDbId/placement is read from each side's OWN original record below,
    // never from this union.
    //
    // Built here, BEFORE the preflight loop below, purely because the preflight needs it -- this
    // construction is pure local-Map bookkeeping with no side effect on world state, so moving it
    // earlier than its pre-M-2-fix position changes nothing about ordering guarantees.
    const perEpochUnique = new Map(); // epoch -> Map<fragmentId, record>
    const mergeIntoEpoch = (epoch, recordsMap) => {
      let bucket = perEpochUnique.get(epoch);
      if (!bucket) { bucket = new Map(); perEpochUnique.set(epoch, bucket); }
      for (const [fragId, rec] of recordsMap) {
        if (!bucket.has(fragId)) bucket.set(fragId, rec);
      }
    };
    mergeIntoEpoch(sourceEpoch, sourceExtracted);
    for (const [epoch, bucket] of targetRecordsByEpoch) mergeIntoEpoch(epoch, bucket);

    // Capacity-admission: PREFLIGHT every epoch first (read-only, `_preflightCollisionInstanceAdmission`
    // -- mirrors admitCollisionInstances's own real bucket-size-plus-missing-count check, never
    // extraction size alone), and only if ALL preflights pass does any epoch's REAL, mutating
    // admission run -- in one synchronous, await-free phase, so a later epoch's capacity failure
    // can never leave an earlier epoch partially admitted. Nothing in this whole span awaits, so
    // (JS being single-threaded) no other code can run between the first preflight and the last
    // commit -- a true zero-partial-commit guarantee against a capacity rejection specifically, not
    // a general transaction guarantee against a reentrant callback or an unrelated synchronous
    // exception.
    //
    // M-2 fix (Batch 2 whole-batch review): `_recordRepresentativeFragments` now runs strictly
    // AFTER this whole preflight loop, for EVERY epoch (not just the ceiling checks above, which
    // were already side-effect-free). Task 6 previously ran it before this loop, so a capacity
    // failure on one epoch (say, target model B) left representative-fragment state already WRITTEN
    // for every OTHER epoch the call touched (source's epoch, any other target epoch) even though
    // those epochs had nothing to do with the failure. The preflight loop is read-only by its own
    // design, so moving it earlier is safe and does not change its own semantics -- it only narrows
    // the window in which representative-fragment state can be written to "after every epoch is
    // already known to be admissible." `leaseByEpoch` is now declared earlier (see the M3 Task 8
    // comment above `leaseByModel`) but, for the three pre-existing modes, is still first BUILT
    // right here, at exactly this original call site -- `??=` rather than `=` only because a
    // clearance call may already have built it earlier (above) for its own filtering pass; for
    // every other mode this is a plain first assignment, identical to the pre-Task-8 `const`.
    leaseByEpoch ??= new Map(leases.map((l) => [l.epoch, l]));
    // `admissionStartedAt` is captured BEFORE the preflight loop, not between preflight and commit
    // (reviewer-caught finding, this task): `_now` is a constructor-injected clock seam, and the
    // "nothing between check and commit" atomicity guarantee above must not rest on an unverified
    // assumption that an injected `_now` is pure/non-reentrant. This widens what
    // 'capacity-admission-commit' measures to include the preflight loop AND (per the M-2 fix above)
    // the representative-fragment recording that now sits between preflight and commit -- both are
    // plain synchronous Map reads/writes with no clock read of their own, so neither reintroduces
    // the injected-clock-purity concern that motivated capturing this timestamp here rather than
    // between preflight and commit; the span is simply reporting more of the real work this call now
    // always does before it can commit anything.
    const admissionStartedAt = this._now();
    // codex-advisor review (I-1/M-2 reordering consult): `this._now()` immediately above is itself
    // an injected, not-guaranteed-pure/non-reentrant clock seam (see this span's own surrounding
    // comment). `_preflightCollisionInstanceAdmission` is deliberately read-only and does NOT check
    // lease liveness -- so if that clock call somehow disposed the world or evicted a captured model
    // (a real, if theoretical, reentrancy hazard given no documented non-reentrant contract exists
    // for an injected clock anywhere in this codebase), the preflight loop below would still run
    // against a now-dead epoch, and `_recordRepresentativeFragments` would then recreate
    // representative-fragment state for it before `admitCollisionInstances`'s own `_assertEpochLive`
    // eventually caught the stale lease and threw. Asserting here, before the preflight loop and
    // before any representative-fragment write, closes that gap at its earliest possible point
    // rather than leaving it to be caught only downstream.
    this._assertLeasesStillLive(leases);
    for (const [epoch, uniqueFragments] of perEpochUnique) {
      const preflight = this._preflightCollisionInstanceAdmission(leaseByEpoch.get(epoch), uniqueFragments);
      if (!preflight.ok) throw new CapacityExceededError(preflight.reason, preflight.details);
    }
    this._recordRepresentativeFragments(sourceEpoch, sourceExtracted);
    for (const [epoch, bucket] of targetRecordsByEpoch) this._recordRepresentativeFragments(epoch, bucket);
    // Task 9: same call sites, one more sibling write. `checkpoint.expectedRevisionByEpoch` (Task
    // 14) is passed to BOTH -- an empty map for a `broadPhase:'linear'`-effective call (a no-op,
    // exactly the pre-Task-14 behavior), or the real armed map for a `'tlas'`-effective call, so
    // this query's OWN growth into a TLAS-consulted epoch (source included, on the rare occasion its
    // own epoch coincides with a target epoch) is synced forward rather than misread as external.
    this._recordPlacement(sourceEpoch, leaseByEpoch.get(sourceEpoch).model, sourceExtracted, checkpoint.expectedRevisionByEpoch);
    for (const [epoch, bucket] of targetRecordsByEpoch) {
      this._recordPlacement(epoch, leaseByEpoch.get(epoch).model, bucket, checkpoint.expectedRevisionByEpoch);
    }
    const admittedByEpoch = new Map();
    for (const [epoch, uniqueFragments] of perEpochUnique) {
      admittedByEpoch.set(epoch, this.admitCollisionInstances(leaseByEpoch.get(epoch), uniqueFragments));
    }
    reportSpan('capacity-admission-commit', this._now() - admissionStartedAt);
    // ---- END synchronous span.

    const sourceInstances = [...sourceExtracted.values()].map(
      (rec) => makePlaced(admittedByEpoch.get(sourceEpoch), rec),
    );
    // Task 8: one group PER DISTINCT TARGET EPOCH, built from `targetRecordsByEpoch`'s own FINAL,
    // already-merged buckets (never from raw `targetsEntries` -- a duplicate `targets` entry for the
    // same model has already been folded into that one bucket by the extraction loop above). Each
    // group carries its own `targetOperand` ({model, epoch}), reused verbatim across every candidate
    // that group produces (never reallocated per candidate) so self-exclusion and per-operand
    // narrow-phase provenance (Task 7) can be applied per group.
    const targetGroups = [];
    for (const [epoch, bucket] of targetRecordsByEpoch) {
      const targetOperand = { model: leaseByEpoch.get(epoch).model, epoch };
      targetGroups.push({
        targetOperand,
        instances: [...bucket.values()].map((rec) => makePlaced(admittedByEpoch.get(epoch), rec)),
      });
    }

    // The source's own operand descriptor, threaded through both the broad phase (self-exclusion)
    // and the narrow phase (operand-local provenance). `fragmentIds` is `sourceExtracted` itself --
    // membership in it is exactly what `isSourceOwnFragment` checks (spec §4.4's assembly-rooted
    // rule), never re-derived or copied.
    const sourceOperand = { model: sourceLease.model, epoch: sourceEpoch, fragmentIds: sourceExtracted };

    // --- M3 Task 9: mode:'clearance' dispatch. Everything ABOVE this point (validation, lease
    // capture, extraction + clearance-only invalid-transform filtering, capacity preflight/
    // admission, placement recording, sourceInstances/targetGroups/sourceOperand construction) is
    // genuinely shared with the three pre-existing modes -- clearance reuses it verbatim, never
    // re-derives it. Everything BELOW this branch (the three modes' own broad/narrow phase and
    // aggregation) is UNREACHABLE for a clearance call, since this branch always returns -- so it
    // stays byte-for-byte unchanged and untouched by clearance (Protected Invariant).
    if (query.mode === 'clearance') {
      const broadPhaseStartedAt = this._now();
      // M3 Task 10: mirrors the three-mode dispatch's own
      // `effectiveBroadPhase === 'tlas' ? await this._runTlasBroadPhase(...) : await this._runBroadPhaseScan(...)`
      // pattern just below, verbatim -- `targetScopeFilter` (built earlier in this method, alongside
      // the three-mode path's own) is already in scope here.
      const candidates = effectiveBroadPhase === 'tlas'
        ? await this._runClearanceTlasBroadPhase(
          sourceOperand, sourceInstances, targetGroups, targetScopeFilter, query.clearance, statistics, checkpoint,
        )
        : await this._runClearanceBroadPhaseScan(
          sourceOperand, sourceInstances, targetGroups, query.clearance, statistics, checkpoint,
        );
      statistics.broadPhaseMs = this._now() - broadPhaseStartedAt;

      this._checkClearanceNarrowPhaseBudget(candidates);

      const narrowPhaseStartedAt = this._now();
      // key -> {distance, witness, sourcePlaced, targetPlaced, targetOperand}
      const clearanceCandidateByKey = new Map();
      const hardClashExcludedKeys = new Set();
      const oversizedDiagnosedFragments = new Set(); // reused across this call's own resolveGeometryRecord calls
      // Batch-2 review fix (Important #1): its OWN dedup namespace, scoped per findClashes call like
      // oversizedDiagnosedFragments above -- never reused for it, since anisotropic-scale is a
      // different diagnostic reason (see diagnoseAnisotropicScaleOnce's own comment).
      const anisotropicScaleDiagnosedFragments = new Set();

      for (const [sourcePlaced, targetPlaced, targetOperand] of candidates) {
        const pending = checkpoint({ label: 'clearance-narrow-phase-pair' });
        if (pending) await pending;
        const outcome = await this._runClearanceNarrowPhasePair(
          sourcePlaced, targetPlaced, sourceOperand, targetOperand, query.clearance, statistics,
          oversizedDiagnosedFragments, anisotropicScaleDiagnosedFragments, checkpoint,
        );
        // codex-advisor review (this task): mirrors the three-mode aggregation loop's own
        // `statistics.narrowPhasePairs++` (Task 19/20) -- every candidate that reaches narrow-phase
        // evaluation counts, regardless of its outcome (hit, miss, exclusion, or a diagnosed
        // failure). The brief's own Step 9 pseudocode never incremented this pre-existing,
        // mode-agnostic statistic for clearance, silently leaving it 0 for every clearance call.
        statistics.narrowPhasePairs++;
        const key = `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}`;
        if (outcome.outcome === 'hard-clash-excluded') {
          hardClashExcludedKeys.add(key);
          continue;
        }
        if (outcome.outcome !== 'hit') continue; // geometry-unavailable/anisotropic-scale/inconclusive/aborted/beyond-threshold
        const existing = clearanceCandidateByKey.get(key);
        if (!existing || compareClearanceCandidates(outcome, existing) < 0) {
          clearanceCandidateByKey.set(key, outcome);
        }
      }
      statistics.narrowPhaseMs = this._now() - narrowPhaseStartedAt;

      // Fix (I-5, post-Batch-1 reconciliation): clearanceHardClashExclusions must count every
      // proven-excluded dbId key from the COMPLETE hardClashExcludedKeys set, including a key that
      // never produced a surviving clearanceCandidateByKey entry -- e.g. a pure Hard-Clash pair
      // whose every contributing fragment pair was excluded before the distance query ever ran, so
      // clearanceCandidateByKey has no entry for that key at all. Deriving the count by iterating
      // clearanceCandidateByKey (the original draft's bug) would silently undercount exactly that case.
      statistics.clearanceHardClashExclusions += hardClashExcludedKeys.size;

      const pairs = [];
      for (const [key, winner] of clearanceCandidateByKey) {
        if (hardClashExcludedKeys.has(key)) {
          continue; // a later-processed fragment pair proved Hard Clash for this same dbId pair
        }
        pairs.push({
          source: {
            modelId: modelIdOf(sourceOperand.model), dbId: winner.sourcePlaced.ownerDbId, model: sourceOperand.model,
          },
          target: {
            // Verification/reconciliation note (Step 9): the winning candidate's OWN targetOperand
            // (threaded through `_runClearanceNarrowPhasePair`'s own `'hit'` return value), never a
            // placeholder -- a dbId-level key can only ever be won by candidates sharing one
            // (sourceEpoch, sourceDbId, targetEpoch, targetDbId) tuple, so every winner stored under
            // one key already shares the identical targetOperand; reading it off the winner itself
            // (rather than re-deriving it from the outer loop's per-candidate variable) keeps this
            // block correct regardless of which candidate happened to win.
            modelId: modelIdOf(winner.targetOperand.model), dbId: winner.targetPlaced.ownerDbId, model: winner.targetOperand.model,
          },
          type: 'clearance',
          distance: winner.distance,
          clearance: query.clearance,
          witness: winner.witness,
        });
      }
      statistics.clearanceHits = pairs.length;
      statistics.totalMs = this._now() - startedAt;
      checkpoint.assertCurrent();
      return { pairs, statistics };
    }

    // --- Broad phase. Its ceiling was already enforced above, per target epoch, against the
    // extraction counts these groups are built from one-for-one, and deliberately BEFORE the
    // admission/bookkeeping side effects -- so there is no second check here.
    const broadPhaseStartedAt = this._now();
    const candidates = effectiveBroadPhase === 'tlas'
      ? await this._runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, checkpoint)
      : await this._runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint);
    statistics.broadPhaseMs = this._now() - broadPhaseStartedAt;

    // --- Narrow phase + aggregation.
    //
    // Task 7: every candidate now carries its OWN target operand (`targetOperand`, from the
    // broad-phase tuple); `sourceOperand` (built above) is constant for the whole call. Both are
    // threaded through `_runNarrowPhasePair` so every diagnostic and every `ClashPair` side names its
    // own operand's model -- never a single call-wide shared one.
    const narrowPhaseStartedAt = this._now();
    // `${sourceEpoch}:${sourceDbId}:${targetEpoch}:${targetDbId}` -> ClashPair; ORDERED, never
    // canonicalized. Epoch-qualified so two different target models sharing a numeric dbId (or a
    // target dbId numerically equal to a source dbId in a DIFFERENT model) never collapse together.
    const pairsByKey = new Map();
    // M2.1 Task 5: internal side table, keyed by the SAME `key` string as `pairsByKey`, holding the
    // single currently-winning witness candidate (per `compareWitnessCandidates`) for each dbId-level
    // pair. Never exposed publicly -- it exists only so the final witness-unavailable diagnostic pass
    // below can build a FragmentRef for whichever fragment pair actually decided (or failed to
    // decide) the final witness, without leaking `sourcePlaced`/`targetPlaced`/`targetOperand`
    // provenance onto the public ClashPair itself.
    const witnessCandidateByKey = new Map();
    const oversizedDiagnosedFragments = new Set();
    for (const [sourcePlaced, targetPlaced, targetOperand] of candidates) {
      const pending = checkpoint({ label: 'narrow-phase-pair' });
      if (pending) await pending;
      const rawHit = await this._runNarrowPhasePair(
        sourcePlaced, targetPlaced, query.mode, sourceOperand, targetOperand,
        statistics, oversizedDiagnosedFragments, checkpoint,
      );
      statistics.narrowPhasePairs++;
      const { isHit, witness } = normalizeNarrowPhaseHit(query.mode, rawHit);
      if (!isHit) continue;
      const key = `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}`;
      if (!pairsByKey.has(key)) {
        pairsByKey.set(key, {
          source: {
            modelId: modelIdOf(sourceOperand.model), dbId: sourcePlaced.ownerDbId, model: sourceOperand.model,
          },
          target: {
            modelId: modelIdOf(targetOperand.model), dbId: targetPlaced.ownerDbId, model: targetOperand.model,
          },
          type: query.mode,
          // M2.1 Task 5: only volume-overlap has a witness concept at all. Omitted entirely (never
          // set to `undefined`) for containment/surface-intersection, so `'witness' in pair` stays
          // false for those modes -- exactly like today, before this task.
          ...(query.mode === 'volume-overlap' ? { witness: null } : {}),
        });
      }
      // M2.1 Task 5: `source`/`target`/`type` above stay first-discovery-wins -- M2's pair-dedup
      // identity is UNCHANGED. Only `witness` is order-independent: every fragment-pair candidate
      // that shares this `key` competes via `compareWitnessCandidates`, and the current winner's
      // witness (which may itself be `null`) is what ends up on the public ClashPair.
      if (query.mode === 'volume-overlap') {
        const candidate = { witness, sourcePlaced, targetPlaced, targetOperand };
        const existing = witnessCandidateByKey.get(key);
        if (!existing || compareWitnessCandidates(candidate, existing) < 0) {
          witnessCandidateByKey.set(key, candidate);
          pairsByKey.get(key).witness = witness;
        }
      }
    }
    statistics.narrowPhaseMs = this._now() - narrowPhaseStartedAt;

    // M2.1 Task 5: exactly one `witness-unavailable` diagnostic per dbId-level pair whose FINAL
    // aggregated witness is still `null`, emitted here after full aggregation -- never per
    // individual fragment-pair miss. `witnessCandidateByKey` shares `pairsByKey`'s own `key` string,
    // so the two Maps are iterated together rather than re-deriving `key` from `pair`.
    for (const [pairKey, pair] of pairsByKey) {
      if (pair.type !== 'volume-overlap' || pair.witness !== null) continue;
      const candidate = witnessCandidateByKey.get(pairKey);
      // Every volume-overlap `pairsByKey` entry gets a `witnessCandidateByKey` entry in the SAME
      // loop iteration that creates it (both are written unconditionally by the `query.mode ===
      // 'volume-overlap'` block above, for every hit). A missing candidate here means that
      // invariant broke -- silently `continue`ing would let a `witness: null` pair escape with NO
      // diagnostic at all, violating this method's own "never silent" contract (codex-advisor
      // review, request 20260907-162936-71471-30255: loud failure over a silent skip).
      if (!candidate) {
        throw new Error(`findClashes: internal invariant violated -- no witness candidate recorded for pair key '${pairKey}'`);
      }
      statistics.diagnostics.push({
        scope: 'pair',
        reason: 'witness-unavailable',
        sourceFragment: fragmentRef(sourceOperand.model, candidate.sourcePlaced),
        targetFragment: fragmentRef(candidate.targetOperand.model, candidate.targetPlaced),
      });
    }

    statistics.totalMs = this._now() - startedAt;
    // Return-site revalidation (design spec §9.2 point 7b): closes the gap between the LAST
    // checkpoint call above and this successful return, across which the pairs map / statistics are
    // assembled with no checkpoint call of their own. `checkpoint.assertCurrent()` (Task 14,
    // codex-advisor review): the real failure mode this closes -- an external placement change
    // landing while the LAST candidate pair's own narrow phase awaits a shared GeometryRegistry
    // build (surface-intersection performs no checkpoint of its own between that await and this
    // return) must still be caught here, not silently returned as a stale-but-successful result.
    checkpoint.assertCurrent();
    return { pairs: [...pairsByKey.values()], statistics };
  }

  // Division form, never `sourceCount * targetCount > maxBroadPhaseInstancePairs`: the product of
  // two instance counts can exceed Number.MAX_SAFE_INTEGER and silently compare against a rounded
  // value, whereas dividing the (small, exact) ceiling by one operand cannot. Strict `>`, so a count
  // landing exactly ON the ceiling is still allowed.
  _exceedsBroadPhaseCeiling(sourceCount, targetCount) {
    if (targetCount === 0) return false;
    return sourceCount > maxBroadPhaseInstancePairs / targetCount;
  }

  // Task 8: runs once per distinct TARGET epoch in `targetGroups` -- one nested (i,j) scan per
  // group, source instances always the outer-of-the-two-nested loops, so `broadPhasePairs` accumulates
  // as the SUM of each group's own `sourceInstances.length * group.instances.length`, never a single
  // merged Cartesian product across groups (which would double-count or cross-contaminate epochs).
  //
  // Self-exclusion (`isSourceOwnFragment`) is applied BEFORE `broadPhasePairs` is incremented and
  // before `_testBroadPhasePair` ever runs -- a self-excluded pair is never counted and never
  // retested (matches Task 13's own later TLAS-path ordering: filter, then count, then retest). This
  // is a genuine, narrow, deliberate behavior change versus M1: M1 had no self-exclusion concept and
  // counted/retested every pair unconditionally, including a pathological self-pair from a caller
  // passing an overlapping dbId on both sides. That legacy single-model shape is NOT special-cased --
  // self-exclusion applies uniformly to it too (see the dedicated compatibility test).
  //
  // `_testBroadPhasePair` itself is reused byte-for-byte, never modified.
  async _runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint) {
    const candidates = [];
    for (const group of targetGroups) {
      const { targetOperand, instances: targetInstances } = group;
      for (let i = 0; i < sourceInstances.length; i++) {
        for (let j = 0; j < targetInstances.length; j++) {
          // The checkpoint port is CONDITIONALLY synchronous — it returns undefined outright when no
          // yield is due. A bare `await checkpoint()` would force a microtask hop on every one of up
          // to maxBroadPhaseInstancePairs iterations, which is exactly what that contract exists to
          // avoid. Liveness is still validated synchronously on every call, due or not.
          const pending = checkpoint({ label: 'broad-phase-scan' });
          if (pending) await pending;
          const targetPlaced = targetInstances[j];
          if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, targetPlaced.instance.fragmentId)) {
            continue; // never counted, never retested -- source self-exclusion (spec §4.4)
          }
          statistics.broadPhasePairs++; // counted immediately before the exact predicate runs
          if (this._testBroadPhasePair(sourceInstances[i], targetPlaced)) {
            candidates.push([sourceInstances[i], targetPlaced, targetOperand]);
          }
        }
      }
    }
    return candidates;
  }

  // World-space AABB overlap, inclusive on every axis (touching counts — surface-intersection
  // reports contact, so a broad phase that excluded it would drop real positives).
  _testBroadPhasePair(sourcePlaced, targetPlaced) {
    const a = sourcePlaced.worldBounds;
    const b = targetPlaced.worldBounds;
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
        && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
        && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  }

  // M3 Task 9: linear broad phase for mode:'clearance'. Structurally identical to
  // _runBroadPhaseScan above (self-exclusion applied first, never counted/retested; source
  // instances always the outer-of-the-two-nested loops), minus any redundant per-candidate
  // transform-validity check -- Task 8 already filtered invalid-transform fragments out of
  // `sourceInstances`/`targetGroups`'s own source buckets, well before either broad phase ever
  // runs. The only real difference is the exact predicate: an AABB-to-AABB MINIMUM DISTANCE test
  // against `clearance` (aabbMinDistance <= clearance), rather than AABB overlap.
  async _runClearanceBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, clearance, statistics, checkpoint) {
    const candidates = [];
    for (const group of targetGroups) {
      const { targetOperand, instances: targetInstances } = group;
      for (let i = 0; i < sourceInstances.length; i++) {
        for (let j = 0; j < targetInstances.length; j++) {
          const pending = checkpoint({ label: 'clearance-broad-phase-scan' });
          if (pending) await pending;
          const targetPlaced = targetInstances[j];
          if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, targetPlaced.instance.fragmentId)) {
            continue; // never counted, never retested -- source self-exclusion (spec §4.4)
          }
          const sourcePlaced = sourceInstances[i];
          // codex-advisor review (this task): mirrors `_runBroadPhaseScan`'s own
          // `statistics.broadPhasePairs++` placement exactly (counted immediately before the exact
          // predicate runs, after self-exclusion) -- the brief's own Step 7 pseudocode never
          // incremented this pre-existing, mode-agnostic statistic, silently leaving it 0 for
          // every clearance linear scan.
          statistics.broadPhasePairs++;
          if (aabbMinDistance(sourcePlaced.worldBounds, targetPlaced.worldBounds) <= clearance) {
            statistics.clearanceExactAabbSurvivors++;
            candidates.push([sourcePlaced, targetPlaced, targetOperand]);
          }
        }
      }
    }
    return candidates;
  }

  // M3 Task 10: TLAS-accelerated broad phase for mode:'clearance'. Structurally the SAME traversal
  // shape as Hard Clash's own `_runTlasBroadPhase` (read directly, reused verbatim, never modified)
  // -- one `bvh.queryBox` per (source instance, target epoch) pair, a SEPARATE local
  // `candidateBudgetUsed` accumulator (never a `statistics.*` field) enforcing `maxTlasCandidatePairs`
  // via the identical onLeafRange/pendingCapacityError/'stop'/deferred-throw-after-traversal
  // discipline, and the identical `targetInstances.length === 0` empty-group guard (a Batch-1
  // whole-batch-review fix to the real `_runTlasBroadPhase`, landed after this task's own brief text
  // was written -- mirrored here for the identical reason: an empty target group must cost zero real
  // TLAS traversal/budget, never silently charge budget for fragments this call's own extraction
  // already knows contribute nothing).
  //
  // Differs from Hard Clash's own method in exactly two ways: (1) the query box is the SOURCE
  // instance's own AABB inflated by `clearance` on every axis (clearance's "any point within
  // clearance" semantics, vs. Hard Clash's un-inflated overlap query), and (2) the exact per-candidate
  // predicate is `aabbMinDistance(...) <= clearance`, not AABB-overlap. Per spec §11 ("Relationship to
  // existing M2 TLAS fields"), the generic M2 TLAS fields (`broadPhasePairs`,
  // `tlasExactRetestSurvivors`, `tlasNarrowPhaseInputPairs`, and the leaf/query-timing fields) are
  // populated IDENTICALLY, by the same code, for a clearance call as for the three pre-existing modes
  // -- clearance's own 7 `clearance*` fields (`clearanceExpandedCandidatePairs`/
  // `clearanceExactAabbSurvivors` here) are ADDITIONAL, layered on top, never a replacement for the
  // generic ones. (An earlier draft of this method's own comment, and this task's own brief text,
  // both claimed the opposite -- that the generic fields should stay unset for clearance -- but that
  // claim was checked directly against the current spec text during this task's own review and found
  // to contradict it.) No redundant per-candidate transform-validity check: Task 8 already filtered
  // invalid-transform instances out of `sourceInstances`/`targetGroups` before broad phase ever runs,
  // and `currentByFragmentId`'s own membership check already scopes every resolved candidate to this
  // call's own validated current target bucket -- matching Hard Clash's own equal simplicity.
  async _runClearanceTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, clearance, statistics, checkpoint) {
    const candidates = [];
    let candidateBudgetUsed = 0;
    let pendingCapacityError = null;

    outer: for (const group of targetGroups) {
      const { targetOperand, instances: targetInstances } = group;
      if (targetInstances.length === 0) continue;
      const modelFilter = targetScopeFilter.get(targetOperand.model);
      const scopeFragmentSet = modelFilter instanceof Set ? modelFilter : null;
      const currentByFragmentId = new Map();
      for (const placed of targetInstances) currentByFragmentId.set(placed.instance.fragmentId, placed);

      const { bvh } = await this._getTlasEntryForEpoch(targetOperand.epoch, checkpoint, statistics);

      for (const sourcePlaced of sourceInstances) {
        const pending = checkpoint({ label: 'clearance-tlas-broad-phase-query', loadEpoch: sourceOperand.epoch });
        if (pending) await pending;

        const queryStartedAt = this._now();
        const b = sourcePlaced.worldBounds;
        const inflatedMin = [b.min[0] - clearance, b.min[1] - clearance, b.min[2] - clearance];
        const inflatedMax = [b.max[0] + clearance, b.max[1] + clearance, b.max[2] + clearance];
        const { truncated } = bvh.queryBox(inflatedMin, inflatedMax, {
          onLeafRange: (offset, count) => {
            statistics.tlasLeafRangeEmissions++;
            if (pendingCapacityError) return 'stop';
            candidateBudgetUsed += count;
            statistics.tlasPrimitiveCandidatePairs += count;
            if (candidateBudgetUsed > maxTlasCandidatePairs) {
              pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', {
                limit: maxTlasCandidatePairs, completed: maxTlasCandidatePairs, attempted: maxTlasCandidatePairs + 1,
                sourceEpoch: sourceOperand.epoch, targetEpoch: targetOperand.epoch,
              });
              return 'stop';
            }
            return undefined;
          },
          onCandidate: (builderPositionIndex) => {
            const record = bvh.recordAt(builderPositionIndex);
            if (scopeFragmentSet && !scopeFragmentSet.has(record.fragmentId)) return undefined;
            if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, record.fragmentId)) return undefined;
            const targetPlaced = currentByFragmentId.get(record.fragmentId);
            if (!targetPlaced) return undefined;
            // Design spec §11 ("Relationship to existing M2 TLAS fields"): the generic M2 TLAS
            // fields are populated IDENTICALLY, by the same code, for a clearance call as for the
            // three pre-existing modes -- `broadPhasePairs` (mode-agnostic since M1) is incremented
            // at exactly this same point (immediately before the exact predicate), right alongside
            // clearance's own analogous `clearanceExpandedCandidatePairs`, matching Hard Clash's own
            // `_runTlasBroadPhase` verbatim. (This task's own brief text carried a note claiming the
            // opposite -- that the generic fields should stay unset for clearance -- but that note
            // was checked directly against the current spec text during this task's own review and
            // found to contradict it; the spec's explicit "populated identically" language governs.)
            statistics.broadPhasePairs++;
            statistics.clearanceExpandedCandidatePairs++;
            if (aabbMinDistance(sourcePlaced.worldBounds, targetPlaced.worldBounds) <= clearance) {
              statistics.clearanceExactAabbSurvivors++;
              candidates.push([sourcePlaced, targetPlaced, targetOperand]);
            }
            return undefined;
          },
        });
        statistics.tlasQueryMs += this._now() - queryStartedAt;
        if (truncated && pendingCapacityError) break outer;
      }
    }
    if (pendingCapacityError) throw pendingCapacityError;
    // Same reasoning as above: `tlasExactRetestSurvivors`/`tlasNarrowPhaseInputPairs` are the
    // generic M2 TLAS fields Hard Clash's own `_runTlasBroadPhase` sets to `candidates.length` right
    // here, after traversal -- required so `tlasNarrowPhaseInputPairs === statistics.narrowPhasePairs`
    // holds for a clearance TLAS call exactly like it does for the three pre-existing modes (every
    // candidate this method returns reaches the shared narrow-phase loop in findClashes's own
    // clearance dispatch, one-for-one, with no separate dedup stage).
    statistics.tlasExactRetestSurvivors = candidates.length;
    statistics.tlasNarrowPhaseInputPairs = candidates.length;
    return candidates;
  }

  /**
   * One candidate pair through the geometry registry and the mode's own query.
   *
   * `checkpoint` is this call's own port, passed in rather than reconstructed: Task 20's composed
   * containment/volume-overlap sub-queries need to fire it BETWEEN their internal stages, using the
   * same accumulator every other checkpoint in this call shares. (This replaces the `this.checkpoint`
   * the plan's Task 20 draft assumed -- CollisionWorld has no such method; the port is a per-call
   * factory product.)
   *
   * Task 7: `sourceOperand`/`targetOperand` (each `{model, epoch}`) replace the single shared
   * `model, epoch` pair Task 19/20 originally passed. Every diagnostic-facing use of a `model`
   * inside this method (FragmentRef.modelId via `fragmentRef`, GeometryRegistry's diagnostic-only
   * `ownerModelIdHint`) now reads the CORRECT per-operand model -- source-side always
   * `sourceOperand.model`, target-side always `targetOperand.model`, never one shared value. Real
   * geometry resolution is UNAFFECTED by this change: it was already, and remains, keyed off each
   * operand's own `placed.instance.geometryIdentity.loadEpoch`, never off either operand param here.
   */
  async _runNarrowPhasePair(
    sourcePlaced, targetPlaced, mode, sourceOperand, targetOperand, statistics, oversizedDiagnosedFragments, checkpoint,
  ) {
    const needsConnectivity = mode !== 'surface-intersection';
    // Diagnosed once per (epoch, fragment) per call, shared by BOTH fragment-scoped skip reasons
    // below: a fragment appearing in many candidate pairs must not flood statistics.diagnostics with
    // the same verdict, whichever of the two it is. Keyed by `${operand.epoch}:${fragmentId}`, NOT
    // bare fragmentId (Task 7 Step 3) -- fragmentId is only unique WITHIN one model's own
    // fragment-index space, so two different epochs can legitimately share a numeric fragmentId; a
    // bare-fragmentId Set would silently suppress the second epoch's own, genuinely distinct,
    // diagnostic (unreachable in M1's single-epoch-per-call world, reachable once two epochs are in
    // play in one call, per spec §4.2).
    // Delegates to the shared top-level resolveGeometryRecord/diagnoseFragmentOnce (M3 Task 9
    // extraction) -- same geometry-resolution path, transient-proxy-miss handling, and oversized
    // dedup behavior as before this refactor, byte-for-byte (proven by the full regression suite).
    const buildOne = (placed, role, operand) =>
      resolveGeometryRecord(this._registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments);

    const sourceRecord = await buildOne(sourcePlaced, 'source', sourceOperand);
    if (!sourceRecord) return false;
    const targetRecord = await buildOne(targetPlaced, 'target', targetOperand);
    if (!targetRecord) return false;

    // Every query mode's own diagnostics are PARTIAL -- `{ reason }` or `{ reason, role }`, with no
    // `scope` and no fragment refs (verified in SurfaceIntersectionQuery/ContainmentModeQuery/
    // VolumeOverlapQuery's own bodies; the plan's snippet branches on a `d.scope === 'pair'` field
    // that none of those modules ever sets). Completing them is this layer's job, and every one of
    // them is PAIR-scoped by construction: they are discovered while evaluating one specific pair, so
    // both sides are always known and both are always named. `role`, when present, says which operand
    // is indicted; it never turns the diagnostic into a fragment-scoped one (that scope belongs solely
    // to the geometry-availability/normalization/size failures buildOne emits above).
    //
    // The two FragmentRefs are built lazily, inside the empty check: the overwhelmingly common case
    // is a pair with no diagnostics at all, and this runs once per narrow-phase pair. Each side uses
    // its OWN operand's model (Task 7) -- never one shared value, so a cross-model pair's diagnostic
    // correctly names each side's real model.
    const attach = (diagnostics) => {
      if (!diagnostics || diagnostics.length === 0) return;
      const sourceFragment = fragmentRef(sourceOperand.model, sourcePlaced);
      const targetFragment = fragmentRef(targetOperand.model, targetPlaced);
      for (const d of diagnostics) {
        statistics.diagnostics.push({
          scope: 'pair',
          reason: d.reason,
          ...(d.role !== undefined ? { role: d.role } : {}),
          sourceFragment,
          targetFragment,
        });
      }
    };

    if (mode === 'surface-intersection') {
      const relativeMatrix = computeRelativeMatrix(sourcePlaced.worldMatrix, targetPlaced.worldMatrix);
      // surfaceIntersectionQuery is SYNCHRONOUS and owns a private, traversal-local clock: bvhcast
      // cannot pause mid-traversal, so there is nothing for this call's shared checkpoint to do
      // inside it. The pair-boundary checkpoint in findClashes is the one that applies here.
      //
      // This mode performs no parity test, so it emits no TOLERANCE diagnostics -- but it does emit
      // one on an ABORT (`crossing-budget-exhausted`, from its own private candidate-count/time
      // budgets), and that one must be surfaced. An aborted traversal did not reach a conclusive
      // answer; the query already refuses to read its own abort as a hit and returns
      // `intersects: false`, so without this the caller could not tell a budget-exhausted traversal
      // from a genuinely verified no-touch (spec :3804-3810). The boolean verdict is deliberately
      // left alone -- what changes is that the incompleteness is now OBSERVABLE.
      // `result.diagnostics` is [] whenever `aborted` is false, so this is a no-op on every
      // conclusive pair.
      const result = surfaceIntersectionQuery(sourceRecord.bvh, targetRecord.bvh, relativeMatrix);
      attach(result.diagnostics);
      return result.intersects;
    }

    // --- The two composed modes. Both take full `Instance` operands (never raw bvh/matrix pairs)
    // and compute whatever relative matrices they need from those operands' own `matrix` fields, so
    // computeRelativeMatrix is deliberately NOT called on this path.
    const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
    const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);
    const scheduler = createComposedStageScheduler(checkpoint, this._now);

    if (mode === 'containment') {
      // Directed, one direction only: "is any of this source surface inside that target solid".
      const result = await containmentModeQuery(sourceInstance, targetInstance, { scheduler });
      attach(result.diagnostics);
      return result.contained;
    }
    // mode === 'volume-overlap' -- the only remaining member of supportedModes.
    //
    // `compareCanonical` is REQUIRED here, not optional polish: VolumeOverlapQuery's own default
    // ("public source is always canonical-first") would make L_canonical -- and therefore
    // ProperCrossingQuery's offset ladder -- depend on which side the caller labelled source, so the
    // same physical pair could clash one way and not the other. See comparePlacedCanonically above.
    //
    // The sign is computed once, from the two PlacedInstances, and the comparator merely reports it
    // for whichever argument order it is handed -- so nothing identity-shaped has to be smuggled
    // into the `Instance` objects, and the comparison itself allocates nothing per pair.
    const canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced);
    const result = await volumeOverlapQuery(sourceInstance, targetInstance, {
      scheduler,
      compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
    });
    attach(result.diagnostics);
    return { hit: result.overlap, witness: result.witness ?? null };
  }

  // Preflight, not incremental (Important #3): the full candidates array is already materialized by
  // broad phase before narrow-phase work starts, so a single upfront length check is exactly equivalent
  // in outcome to a per-iteration counter and is both simpler and more directly testable. M3 Task 11.
  _checkClearanceNarrowPhaseBudget(candidates) {
    if (candidates.length > maxClearanceNarrowPhasePairs) {
      throw new CapacityExceededError('clearance-narrow-phase-budget', {
        limit: maxClearanceNarrowPhasePairs, attempted: candidates.length,
      });
    }
  }

  /**
   * One clearance candidate pair through geometry resolution, the tri-state Hard-Clash exclusion
   * precheck, and the exact clearance distance query. M3 Task 9.
   *
   * Returns `{ outcome, ... }`, never a bare boolean: `outcome` is one of
   * `'geometry-unavailable' | 'anisotropic-scale' | 'hard-clash-excluded' | 'inconclusive' |
   * 'aborted' | 'beyond-threshold' | 'hit'`. Only `'hit'` carries `{ distance, witness, sourcePlaced,
   * targetPlaced, targetOperand }` -- `targetOperand` is threaded through here (Step 9's own
   * verification/reconciliation note) so the aggregation loop in `findClashes` can build the public
   * `target.model`/`target.modelId` from the SAME operand that produced the winning candidate,
   * without re-deriving or guessing it from a placeholder.
   *
   * Every non-hit outcome that represents a genuinely INCOMPLETE verdict (never a clean negative)
   * pushes its own diagnostic before returning, matching this method's own "never silent" contract
   * (codex-advisor review, this task: the brief's own pseudocode diagnosed 'inconclusive'/'aborted'
   * but silently dropped 'anisotropic-scale', the one outcome its own aggregation-loop pseudocode
   * had no case for). The SCOPE differs by outcome, deliberately:
   *   - 'inconclusive' and 'aborted' push a PAIR-scoped diagnostic (`scope: 'pair'`, with both
   *     `sourceFragment` and `targetFragment`) -- each describes one specific fragment-pair
   *     evaluation, and is emitted once per such pair.
   *   - 'anisotropic-scale' pushes a FRAGMENT-scoped diagnostic instead (`scope: 'fragment'`,
   *     deduped per `(epoch, fragmentId)` of the offending operand, one per offending SIDE), via
   *     `diagnoseAnisotropicScaleOnce` -- anisotropic scale is a property of one operand's own
   *     worldMatrix, not of the pair (Batch-2 review fix; see that helper's own comment, and
   *     `diagnoseClearanceInvalidTransform`, the sibling fragment-scoped precedent it mirrors).
   * 'geometry-unavailable' needs no diagnostic of its own here -- `resolveGeometryRecord` already
   * pushed one via `diagnoseFragmentOnce` before returning `null`. 'hard-clash-excluded' and
   * 'beyond-threshold' are both clean, conclusive negatives and need no diagnostic either.
   */
  async _runClearanceNarrowPhasePair(
    sourcePlaced, targetPlaced, sourceOperand, targetOperand, clearance, statistics, oversizedDiagnosedFragments,
    anisotropicScaleDiagnosedFragments, checkpoint,
  ) {
    const sourceRecord = await resolveGeometryRecord(
      this._registry, sourcePlaced, 'source', sourceOperand, true, statistics, oversizedDiagnosedFragments,
    );
    if (!sourceRecord) return { outcome: 'geometry-unavailable' };
    const targetRecord = await resolveGeometryRecord(
      this._registry, targetPlaced, 'target', targetOperand, true, statistics, oversizedDiagnosedFragments,
    );
    if (!targetRecord) return { outcome: 'geometry-unavailable' };

    const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
    const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);

    const sourceScale = validateUniformScale(sourceInstance.matrix);
    const targetScale = validateUniformScale(targetInstance.matrix);
    if (!sourceScale.valid || !targetScale.valid) {
      // Task 8 already excluded non-finite/singular transforms upstream; this is
      // validateUniformScale's OWN, finer-grained gate (anisotropic scale) -- a
      // well-formed-but-unsupported transform, caught here right before the composed query, not at
      // admission time.
      //
      // Batch-2 review fix (Important #1, corrected shape -- see diagnoseAnisotropicScaleOnce's own
      // comment): a single anisotropically-scaled fragment paired against N targets must emit ONE
      // fragment-scoped diagnostic per offending fragment, not one pair-scoped diagnostic per pair --
      // diagnose each OFFENDING side independently (never a side that is already uniformly-scaled).
      if (!sourceScale.valid) {
        diagnoseAnisotropicScaleOnce(statistics, anisotropicScaleDiagnosedFragments, sourcePlaced, 'source', sourceOperand);
      }
      if (!targetScale.valid) {
        diagnoseAnisotropicScaleOnce(statistics, anisotropicScaleDiagnosedFragments, targetPlaced, 'target', targetOperand);
      }
      return { outcome: 'anisotropic-scale' };
    }

    const scheduler = createComposedStageScheduler(checkpoint, this._now);
    const canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced);
    const volumeOverlapOptions = {
      scheduler,
      compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
      // Task reviewer fix (Important #1, fix round): without this, ProperCrossingQuery.js's own
      // `options.now ?? (() => performance.now())` default (ProperCrossingQuery.js:40) reads the
      // REAL wall clock inside this precheck's own volumeOverlapQuery call, independent of this
      // call's own injected `_now` test seam -- an 8ms real-time stall (GC, parallel test load)
      // mid-traversal can abort the crossing term and flip a genuine proven overlap into
      // 'inconclusive', making the Hard-Clash exclusion precheck (and anything that depends on it,
      // e.g. clearanceHardClashExclusions) nondeterministic under a frozen/fake test clock. Reusing
      // this call's own `this._now` here closes that gap for clearance's own precheck call site. The
      // IDENTICAL exposure pre-exists, unfixed, in the three pre-existing modes' own
      // volumeOverlapQuery call in _runNarrowPhasePair -- out of scope here, their code path is a
      // Protected Invariant and must stay byte-for-byte unchanged.
      crossing: { now: this._now },
    };

    const precheck = await classifyHardClashPrecheck(
      sourceInstance, targetInstance, sourcePlaced.worldBounds, targetPlaced.worldBounds, volumeOverlapOptions,
    );
    // clearanceOverlapPrechecksRun increments for EVERY status volumeOverlapQuery actually ran under
    // (excluded, proceed, inconclusive) -- never for skip-precheck, which by definition never called
    // it. The increment happens BEFORE the excluded early-return below.
    if (precheck.status !== 'skip-precheck') statistics.clearanceOverlapPrechecksRun++;
    if (precheck.status === 'excluded') {
      return { outcome: 'hard-clash-excluded' };
    }
    if (precheck.status === 'inconclusive') {
      statistics.diagnostics.push({
        scope: 'pair',
        reason: precheck.diagnostic.reason,
        sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced),
        targetFragment: fragmentRef(targetOperand.model, targetPlaced),
      });
      return { outcome: 'inconclusive' };
    }
    // precheck.status is 'proceed' or 'skip-precheck' -- continue to the distance query.

    const toleranceFloor = computeToleranceFloor(
      { localDiagonal: sourceInstance.localDiagonal, scaleFactor: sourceScale.scaleFactor },
      { localDiagonal: targetInstance.localDiagonal, scaleFactor: targetScale.scaleFactor },
      surfaceEpsilonFactor,
    );
    const distanceQueryStart = this._now();
    const result = clearanceQuery(sourceInstance, targetInstance, { clearance, toleranceFloor });
    statistics.clearanceDistanceQueriesRun++;
    const distanceQueryMs = this._now() - distanceQueryStart;
    statistics.clearanceQueryMs += distanceQueryMs;
    reportSpan('clearance-distance-query', distanceQueryMs); // production instrumentation, consumed by Task 18's gate

    if (result.aborted) {
      statistics.diagnostics.push({
        scope: 'pair',
        reason: result.diagnostics[0].reason,
        sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced),
        targetFragment: fragmentRef(targetOperand.model, targetPlaced),
      });
      return { outcome: 'aborted' };
    }
    if (!result.withinClearance) return { outcome: 'beyond-threshold' };
    return {
      outcome: 'hit', distance: result.distance, witness: result.witness, sourcePlaced, targetPlaced, targetOperand,
    };
  }

  // Task 12 (M2 Batch 4): the plan's own `buildTargetScopeFilter`, reworked to consume records the
  // extraction loop in findClashes ALREADY produced for each `targets` entry, rather than
  // re-extracting a second time (per the plan's own reconciliation note). `filterByModel` is
  // Map<Model, Set<fragmentId>|'whole-model'>, mutated in place -- one call per `targets` entry,
  // in entry order.
  //
  // Whole-model scope (dbIds === undefined) always wins for a model, in EITHER processing order: a
  // later narrower entry for a model already marked 'whole-model' must not downgrade it back to a
  // Set (checked before the narrow-entry union path runs), and a whole-model entry processed AFTER
  // an existing narrower Set simply overwrites it (the `dbIds === undefined` branch above always
  // sets the sentinel unconditionally). `records` is a `Map<fragmentId, record>` -- fragmentId-keyed,
  // never ownerDbId-keyed, so an assembly-rooted entry's own descendant fragments (discovered under
  // child dbIds, not the requested root) are correctly included: this filter is built from the SAME
  // fragmentId set extraction's own first-discovery-wins walk already produced, never re-derived
  // from ownerDbId membership (the false-negative bug the plan's own §7.1a text found and fixed).
  _addToTargetScopeFilter(filterByModel, model, dbIds, records) {
    if (dbIds === undefined) {
      filterByModel.set(model, 'whole-model');
      return;
    }
    if (filterByModel.get(model) === 'whole-model') return; // already whole-model -- nothing narrower overrides it
    const existing = filterByModel.get(model);
    const union = existing instanceof Set ? existing : new Set();
    for (const fragmentId of records.keys()) union.add(fragmentId);
    filterByModel.set(model, union);
  }

  // First-discovery-wins per (loadEpoch, geometryIndex): any one fragment carrying that geometry
  // index resolves to the same raw Viewer geometry, so the first one seen is a valid representative
  // for every later build request against that index.
  _recordRepresentativeFragments(loadEpoch, extractedRecords) {
    let byGeometry = this._representativeFragmentByGeometry.get(loadEpoch);
    if (!byGeometry) {
      byGeometry = new Map();
      this._representativeFragmentByGeometry.set(loadEpoch, byGeometry);
    }
    for (const record of extractedRecords.values()) {
      const { geometryIndex } = record.geometryIdentity;
      if (!byGeometry.has(geometryIndex)) byGeometry.set(geometryIndex, record.fragmentId);
    }
  }

  // Task 9 (M2 Batch 3): write-once-per-fragment placement index, populated alongside
  // _recordRepresentativeFragments at the same call sites. A fragmentId ALREADY present in
  // _placementByEpoch.get(epoch) is NEVER overwritten by ordinary extraction -- only
  // invalidateModelPlacement's staged refresh (Task 11) may overwrite an EXISTING entry. Only a
  // genuinely new fragmentId is inserted, which also bumps the epoch's revision as "growth".
  //
  // `expectedRevisionByEpoch` (Task 14, M2 Batch 4): the SAME map `createCompositeCheckpointPort`
  // attached to this call's own `checkpoint` -- empty for a `broadPhase:'linear'`-effective call
  // (every check below becomes a no-op, exactly this method's pre-Task-14 behavior), or armed with
  // this call's own TLAS-consulted epochs' revisions as captured AT TRUE QUERY ENTRY.
  //
  // Pre-insertion compare-and-abort, BEFORE this call's own insertion below (spec §9.2 point 8): if
  // this epoch is tracked and its CURRENT revision already differs from what was captured at query
  // entry, a DIFFERENT actor already changed it for a reason this query never caused -- abort now,
  // before this query's own insertion could compound the confusion (e.g. publishing on top of a
  // refresh's own already-staged data, or masking the external change behind this call's own bump).
  _recordPlacement(loadEpoch, model, extractedRecords, expectedRevisionByEpoch) {
    // codex-advisor review (Task 14): `modelIdOf(model)` reads externally-owned `model.id`, read
    // ONCE here, BEFORE the pre-insertion comparison below -- not after it, as an earlier draft had
    // it (only for the write-once loop's own later use). If `model.id` were ever an accessor with a
    // side effect (e.g. synchronously calling `invalidateModelPlacement`), reading it AFTER the
    // comparison but BEFORE the growth-sync step would let that side effect's own revision bump get
    // silently absorbed by this call's OWN growth-sync as if it were self-caused, never compared
    // against. Reading it first closes that reentrancy window regardless of whether the Viewer SDK
    // actually has such an accessor today -- free, and removes the assumption entirely.
    const modelId = modelIdOf(model);
    if (expectedRevisionByEpoch?.has(loadEpoch)) {
      const currentRevision = this._placementRevisionByEpoch.get(loadEpoch) ?? 0;
      const expected = expectedRevisionByEpoch.get(loadEpoch);
      if (currentRevision !== expected) {
        throw new ModelPlacementChangedError({
          modelId, loadEpoch, expectedRevision: expected, actualRevision: currentRevision,
        });
      }
    }
    let placementByFragment = this._placementByEpoch.get(loadEpoch);
    if (!placementByFragment) {
      placementByFragment = new Map();
      this._placementByEpoch.set(loadEpoch, placementByFragment);
    }
    let grew = false;
    for (const record of extractedRecords.values()) {
      if (placementByFragment.has(record.fragmentId)) continue; // write-once: never overwrite
      placementByFragment.set(record.fragmentId, {
        worldBounds: record.worldBounds, worldMatrix: record.worldMatrix,
        ownerDbId: record.ownerDbId, modelId,
      });
      grew = true;
    }
    if (grew) {
      const newRevision = (this._placementRevisionByEpoch.get(loadEpoch) ?? 0) + 1;
      this._placementRevisionByEpoch.set(loadEpoch, newRevision);
      // Task 14, spec §6.7.5's self-invalidation-avoidance: sync THIS query's OWN growth-triggered
      // bump forward into expectedRevisionByEpoch. Without this, createCompositeCheckpointPort's own
      // LATER comparison would see this query's OWN insertion as an external change and falsely
      // abort its own call.
      if (expectedRevisionByEpoch?.has(loadEpoch)) {
        expectedRevisionByEpoch.set(loadEpoch, newRevision);
      }
    }
  }

  // Task 11 (M2 Batch 3): staged/atomic-publish placement refresh, triggered from the TLAS-
  // consuming query path (Task 13, not yet wired -- this method is complete and independently
  // tested but has no production caller until Task 13's own trigger condition lands) when it
  // observes a cached TlasCache entry stale specifically DUE TO an invalidation (not ordinary
  // growth): `entry.builtAtRevision !== _placementRevisionByEpoch.get(epoch)` AND
  // `(_placementInvalidatedAtRevision.get(epoch) ?? -1) >= (entry.builtAtRevision ?? -1)` -- the
  // `?? -1` coercions matter (Batch 3 whole-batch review, Minor finding #8): `builtAtRevision` is
  // `undefined` for a never-built epoch (`TlasCache.getBuiltAtRevision`'s own documented
  // convention), and an unguarded `>=` against `undefined` is always `false`, which would silently
  // fail to treat "invalidated before its first-ever build" as invalidation-stale (exactly the
  // scenario codex-review's own Critical #2 finding described).
  //
  // Re-reads worldMatrix/worldBounds fresh for every fragmentId ALREADY present in
  // _placementByEpoch.get(epoch), via the exact same primitives extractFragments uses
  // (readWorldMatrix/readWorldBounds, ViewerModelAdapter.js) -- never touching the shared map
  // until the compare-and-publish step below succeeds. `_placementByEpoch`'s shared map is never
  // mutated in place mid-refresh -- only swapped wholesale at that step (protected invariant).
  async _refreshPlacementForEpoch(epoch, expectedRevision, expectedInvalidationRevision, { checkpoint, THREE = globalThis.THREE } = {}) {
    // Entry liveness guard, BEFORE any model read -- same discipline extractAllFragments's own
    // preflight checkpoint uses ("checkpoint validates liveness before this code ever touches the
    // model"). Task 13's own trigger always validates liveness (via the composite checkpoint)
    // before calling this method, so this is defense in depth for this private method's own
    // robustness, not a substitute for that caller contract: without it, an already-dead epoch's
    // `_modelByEpoch.get(epoch)` (already deleted by evictModel/dispose) would throw a raw
    // TypeError on the very next line instead of the correct, diagnosable ModelEvictedError/
    // WorldDisposedError.
    if (this._disposed) throw new WorldDisposedError();
    if (!this._isEpochLive(epoch)) throw new ModelEvictedError(epoch);
    const model = this._modelByEpoch.get(epoch);
    // `?? new Map()` (Batch 3 whole-batch review, Minor finding #6): an epoch that was admitted and
    // invalidated but never actually extracted (findClashes never ran for it) has no
    // _placementByEpoch entry yet -- not reachable under Task 13's own planned ordering (a
    // TLAS-consuming query only reaches this refresh after its own extraction has already
    // populated the map), but this keeps the method correct standalone rather than relying on that
    // caller ordering. An empty `current` simply stages and publishes an empty map.
    const current = this._placementByEpoch.get(epoch) ?? new Map();
    const fragList = model.getFragmentList();
    const staged = new Map();
    const scratchMatrix = new THREE.Matrix4();
    const scratchBox = new THREE.Box3();
    for (const [fragmentId, oldRecord] of current) {
      if (checkpoint) {
        const pending = checkpoint({ loadEpoch: epoch, label: 'placement-refresh-fragment' });
        if (pending) await pending;
      }
      staged.set(fragmentId, Object.freeze({
        worldMatrix: readWorldMatrix(fragList, fragmentId, scratchMatrix),
        worldBounds: readWorldBounds(fragList, fragmentId, scratchBox),
        ownerDbId: oldRecord.ownerDbId, modelId: oldRecord.modelId, // carried over unchanged
      }));
    }
    // Compare-and-publish, synchronous, no further await in between:
    if (this._disposed) throw new WorldDisposedError();
    if (!this._isEpochLive(epoch)) throw new ModelEvictedError(modelIdOf(model));
    if (
      this._placementRevisionByEpoch.get(epoch) !== expectedRevision
      || this._placementInvalidatedAtRevision.get(epoch) !== expectedInvalidationRevision
    ) {
      // Superseded by a second invalidation/growth while this refresh was reading Viewer state --
      // discard the staged map entirely. Do NOT clear _placementInvalidatedAtRevision -- that would
      // erase the SECOND invalidation's own marker.
      return { published: false };
    }
    this._placementByEpoch.set(epoch, staged);
    this._placementInvalidatedAtRevision.delete(epoch); // this refresh's own captured revision is still current
    // Batch 3 whole-batch review, Important finding #3: the revision number itself does NOT change
    // from a refresh (only the DATA the revision-keyed cache serves does) -- TlasCache.getEntry's
    // own 'hit' check is keyed purely on revision equality, so without this, a TLAS built before
    // the refresh would incorrectly keep being served as a 'hit' for the SAME revision number after
    // the underlying placement data has changed underneath it. Releasing the cached entry forces
    // any subsequent getEntry for this epoch to rebuild from the freshly-published data.
    this._tlasCache?.releaseEntryForEpoch(epoch);
    return { published: true };
  }

  // Task 13: fetches this epoch's TLAS entry against the CURRENT expected revision, refreshing
  // placement first if an invalidation is pending, and retrying on TlasCache's own
  // {outcome:'superseded'} signal by re-deriving the current revision fresh each time -- NEVER
  // retrying with a stale value (Task 10's own caller contract). This is the first production
  // caller of both _refreshPlacementForEpoch (Task 11) and TlasCache.getEntry (Task 10), and the
  // first production caller of _refreshPlacementForEpoch's own `checkpoint` option -- threaded
  // through from findClashes's composite checkpoint (`checkpoint`, this call's own per-call port),
  // so a refresh over a large placement table actually yields under this call's shared frame
  // budget instead of running unpreemptibly (the deferred half of Task 11's own finding, explicitly
  // carried forward to this task rather than implemented speculatively ahead of a real caller).
  //
  // `statistics` is threaded in and updated DIRECTLY here (codex-advisor review, Medium #5): an
  // earlier draft measured/attributed tlasBuilds/tlasCacheHits/tlasSharedBuildWaits/tlasBuildMs in
  // the CALLER after this whole method returned, which silently mis-attributed (or dropped to zero)
  // any real work done in an EARLIER loop iteration whenever a later iteration changed the final
  // outcome (e.g. a genuine refresh's own elapsed time, followed by a 'superseded' retry and then a
  // final 'shared-wait' -- the refresh time is real, paid-for work, not zero). Attributing per
  // iteration, as each sub-step actually happens, is correct regardless of how many times this loop
  // retries before returning.
  async _getTlasEntryForEpoch(epoch, checkpoint, statistics) {
    for (;;) {
      // Re-validate liveness on every iteration -- a retry loop racing a genuine eviction must
      // abort, not spin. (Full disposed/evicted/placement-revision precedence at every checkpoint
      // in this call is enforced by the composite checkpoint at its own call sites; this is an
      // additional, local guard specific to this retry loop's own safety.)
      if (this._disposed) throw new WorldDisposedError();
      if (!this._isEpochLive(epoch)) throw new ModelEvictedError(modelIdOf(this._modelByEpoch.get(epoch)));

      let expectedRevision = this._placementRevisionByEpoch.get(epoch) ?? 0;
      const invalidatedAt = this._placementInvalidatedAtRevision.get(epoch);
      // `?? -1`: a never-built epoch's builtAtRevision is undefined (TlasCache's own documented
      // convention), always < any real invalidation revision, so a pending invalidation is honored
      // even on a cold first build (Batch 3 whole-batch review, Minor finding #8's own coercion
      // discipline, reused here for the same reason).
      const cachedBuiltAtRevision = this._tlasCache.getBuiltAtRevision(epoch) ?? -1;
      if (invalidatedAt !== undefined && invalidatedAt >= cachedBuiltAtRevision) {
        const refreshStartedAt = this._now();
        const { published } = await this._refreshPlacementForEpoch(epoch, expectedRevision, invalidatedAt, { checkpoint });
        // This call genuinely spent this wall-clock time getting a usable, current entry, REGARDLESS
        // of what happens next (a superseded retry below, or a subsequent hit/shared-wait rather than
        // a fresh build) -- never silently dropped to zero. No dedicated "refresh time" statistic
        // exists in spec §7.5.1's own 9-field list, and tlasBuildMs is the closest fit (this repo's
        // own established convention: reuse an existing bucket over inventing a new field ahead of a
        // real, spec-authorized need).
        statistics.tlasBuildMs += this._now() - refreshStartedAt;
        if (!published) {
          // Whole-batch review finding #2 (Medium): WITHIN one findClashes call, this epoch's own
          // `_recordPlacement` already ran once, before broad phase ever started -- so a SECOND
          // invalidation/growth superseding this refresh can only be externally caused (a DIFFERENT
          // concurrent call). Report it as Task 14's own public `ModelPlacementChangedError`
          // immediately, rather than silently absorbing it into another retry iteration -- a
          // persistently racing external actor would otherwise keep this loop rebuilding/retrying
          // forever without ever reaching the composite checkpoint Task 14 relies on to bound it.
          checkpoint.assertCurrent();
          continue; // superseded by a second invalidation/growth mid-refresh -- retry with fresh state
        }
        expectedRevision = this._placementRevisionByEpoch.get(epoch); // re-read: the refresh may have changed it
      }

      const getEntryStartedAt = this._now();
      const result = await this._tlasCache.getEntry(epoch, expectedRevision);
      const getEntryElapsed = this._now() - getEntryStartedAt;
      if (result.outcome === 'superseded') {
        // Same reasoning as the refresh-supersession case above: TlasCache's own 'superseded'
        // outcome for THIS epoch can only arise from a DIFFERENT concurrent call's own getEntry
        // request (target groups are processed sequentially within one findClashes call -- there is
        // no internal concurrency on the SAME epoch to self-trigger this).
        checkpoint.assertCurrent();
        continue; // Task 10's contract: never retry with the stale value that was just superseded
      }

      // codex-advisor review, High #4 (SECOND pass -- the first attempt, checking only the
      // invalidation marker, missed a real interleaving a follow-up review caught): a DIFFERENT
      // concurrent call can refresh this SAME epoch, publish a NEWER revision, and CLEAR the
      // invalidation marker (`_refreshPlacementForEpoch`'s own successful-publish side effect) --
      // all while THIS call's own `getEntry` above was in flight. `recheckInvalidatedAt` would then
      // be `undefined` (cleared by that other call), silently passing the marker-only check even
      // though `_placementRevisionByEpoch` has since moved past THIS call's own `expectedRevision`.
      // The unconditional revision-equality check below catches this regardless of the marker's own
      // state; the marker check is kept as defense in depth for a case the revision check alone
      // would not distinguish (a marker set for a FUTURE revision this loop hasn't reached yet,
      // possible on a very first, never-built epoch where `expectedRevision` and the eventual built
      // revision can coincide numerically while an invalidation is still pending against it).
      //
      // Statistics attribution happens BEFORE this staleness check, not after (a second real bug a
      // follow-up review caught in the first pass's placement): a `built`/`shared-wait` outcome
      // represents REAL, already-incurred work/wait, and must be counted even if this exact result
      // is about to be discarded and retried -- silently dropping it under-reports genuine cost. A
      // `hit`, by contrast, incurred no real cost (a bare Map lookup), so it is deliberately counted
      // ONLY after this result is confirmed non-stale (counting a stale, about-to-be-discarded 'hit'
      // would overstate cache effectiveness for a result nothing ever actually used).
      if (result.outcome === 'built') { statistics.tlasBuilds++; statistics.tlasBuildMs += getEntryElapsed; }
      else if (result.outcome === 'shared-wait') { statistics.tlasSharedBuildWaits++; }

      if (this._disposed) throw new WorldDisposedError();
      if (!this._isEpochLive(epoch)) throw new ModelEvictedError(modelIdOf(this._modelByEpoch.get(epoch)));
      const recheckInvalidatedAt = this._placementInvalidatedAtRevision.get(epoch);
      const recheckBuiltAtRevision = this._tlasCache.getBuiltAtRevision(epoch) ?? -1;
      const revisionMovedOn = (this._placementRevisionByEpoch.get(epoch) ?? 0) !== expectedRevision;
      const invalidationRaced = recheckInvalidatedAt !== undefined && recheckInvalidatedAt >= recheckBuiltAtRevision;
      if (revisionMovedOn || invalidationRaced) {
        // Whole-batch review finding #2: same reasoning as the two retry points above -- this
        // epoch's own extraction-driven growth already happened once, before broad phase started,
        // so ANY further change detected here is externally caused. Report it now.
        checkpoint.assertCurrent();
        continue; // built/shared-wait work above is already attributed; retry with fresh state
      }

      if (result.outcome === 'hit') statistics.tlasCacheHits++; // only counted once confirmed non-stale, see comment above
      return result;
    }
  }

  // Structural twin, Batch-2 review fix (Important #2): `mode:'clearance'` has its own deliberate
  // structural copy of this broad phase, `_runClearanceTlasBroadPhase` (above, ~line 1950), for its
  // inflated-query-box variant. Any change to THIS method's budget/guard/traversal discipline must be
  // mirrored there by hand -- e.g. the `targetInstances.length === 0` empty-group guard below had to
  // be manually re-derived and hand-mirrored into the clearance copy during Task 10, because the plan
  // text for that copy predated this guard. No test currently catches such a divergence.
  //
  // Task 13: runs once per distinct TARGET epoch in `targetGroups`, querying each admitted SOURCE
  // instance against that epoch's own (lazily built/cached) TLAS. Mirrors _runBroadPhaseScan's own
  // ordering discipline (target-scope filter and source self-exclusion applied BEFORE a candidate
  // is counted or retested), plus the TLAS-specific candidate-expansion budget (spec §9.3.1),
  // checked upstream of BOTH filters via `onLeafRange`'s own raw leaf-expansion count -- NOT via
  // `onCandidate`, which only fires for primitives that already pass CollisionInstanceBVH's own
  // per-primitive exact-overlap re-test and would therefore under-report raw expansion (see
  // CollisionInstanceBVH.js's own header comment on this exact point, and this method's own
  // dedicated codex-advisor consult: a leaf whose primitives never individually pass that re-test
  // could otherwise let a budget overflow escape detection entirely, since onCandidate would never
  // fire for it at all). This budget check is CONSERVATIVE-RANGE, not literally per-primitive-exact
  // (codex-advisor review, Medium #5): it adds a WHOLE leaf's raw `count` before checking against
  // the limit, so the internal counter can overshoot the nominal limit by up to one leaf's worth
  // before the check fires and traversal stops -- it never UNDER-throws (a genuine overflow is
  // never silently missed), and the thrown error's own `completed`/`attempted` fields are always
  // the exact spec-mandated `{limit, limit+1}` regardless of the real overshoot amount, so this
  // never affects returned results (the call throws either way) -- only how much EXTRA raw
  // expansion work happens in the single leaf that finally trips it. Documented rather than adding
  // a new per-primitive `onRawCandidate` callback to CollisionInstanceBVH: that would cost one JS
  // callback per raw primitive on every call (including every call that stays well under budget) to
  // fix an imprecision that is provably harmless to correctness.
  //
  // codex-advisor review, Critical #1: a TLAS-matched record is used ONLY as a spatial hit / a
  // fragmentId signal, NEVER as the source of `ownerDbId`/placement data for the resulting
  // candidate. `_placementByEpoch` is a write-once, EPOCH-WIDE table (Task 9) -- once a fragmentId
  // is recorded there, it is never overwritten by ordinary re-extraction, and extraction's own
  // first-discovery-wins `ownerDbId` promise is explicitly scoped to ONE call only, with NO
  // cross-call stability guarantee (ViewerModelAdapter.js's own extractFragments: "this module
  // makes no cross-call OR cross-node stability promise beyond 'first write wins'" -- the repo even
  // has a dedicated fixture for one fragment reported under a DIFFERENT dbId across two calls). A
  // fragment resolved via the cached placement table could therefore report a STALE ownerDbId the
  // linear path (which always re-derives ownerDbId from THIS call's own fresh extraction via
  // `makePlaced`) would never produce -- a genuine, reproducible tlas-vs-linear divergence, not a
  // theoretical one. The 'whole-model' scope (no Set filter) compounds this: a fragment admitted by
  // an EARLIER call remains in the epoch-wide placement/TLAS forever (write-once) even after the
  // CURRENT call's own `extractAllFragments` would no longer include it (e.g. it has since become
  // not-loaded) -- `scopeFragmentSet` alone cannot catch this, since 'whole-model' means "no Set to
  // check against" by design.
  //
  // Fixed by building `currentByFragmentId` -- a `Map<fragmentId, PlacedInstance>` from THIS group's
  // own `instances` (built moments earlier in `findClashes`, from THIS call's own fresh extraction,
  // exactly like the linear path's own `targetInstances`) -- and requiring membership in it for
  // EVERY resolved candidate, for BOTH scope kinds uniformly: an explicit-dbIds entry's own Set
  // membership check and this membership check always agree (both are built from the identical
  // per-entry extraction records, in the same loop, per Task 12's own construction), so this adds
  // no new false exclusions there; for 'whole-model', this is the ONLY membership check, and it is
  // exactly the current-call, current-state Set the linear path itself implicitly uses (a fragment
  // is a candidate iff `targetGroup.instances` -- this call's OWN extraction result -- contains it).
  // `targetScopeFilter`/`scopeFragmentSet` is still consulted first (Task 12's own committed,
  // separately-tested deliverable), as a cheap early-exit for the narrow-scope case; it is now
  // provably redundant with (never disagrees with) the membership check for correctness purposes,
  // kept for that early-exit value and to keep Task 12's own wiring genuinely "consumed" as its own
  // task description promised.
  async _runTlasBroadPhase(sourceOperand, sourceInstances, targetGroups, targetScopeFilter, statistics, checkpoint) {
    const candidates = [];
    let candidateBudgetUsed = 0;
    let pendingCapacityError = null;

    outer: for (const group of targetGroups) {
      const { targetOperand, instances: targetInstances } = group;
      // Whole-batch review finding #1 (High): a target group whose OWN extraction found ZERO
      // fragments this call (e.g. an explicit `dbIds: []` entry, or a genuinely empty whole-model
      // scope) must never fetch or query that epoch's TLAS at all -- the TLAS is built from
      // `_placementByEpoch`'s WHOLE, potentially HISTORICALLY-populated epoch table (Task 9), not
      // scoped to this call's own (here, empty) target instances. Without this guard, a call with
      // ANOTHER non-empty target group would still traverse this epoch's historical TLAS contents,
      // charging real candidate budget for fragments `currentByFragmentId` below would reject
      // anyway -- potentially throwing CapacityExceededError for a group that contributes, and was
      // always going to contribute, exactly zero real candidates (matching what `_runBroadPhaseScan`
      // already does for free: its own nested loop's inner bound is `targetInstances.length`, so an
      // empty group costs it literally zero iterations). This is a traversal/budget ordering gap,
      // not a disagreement between Task 12's filter and this method's own membership check -- both
      // already correctly say "empty"; the bug is doing real TLAS work before either ever runs.
      if (targetInstances.length === 0) continue;
      const modelFilter = targetScopeFilter.get(targetOperand.model);
      const scopeFragmentSet = modelFilter instanceof Set ? modelFilter : null; // null = whole-model, no Set filter
      const currentByFragmentId = new Map();
      for (const placed of targetInstances) currentByFragmentId.set(placed.instance.fragmentId, placed);

      const { bvh } = await this._getTlasEntryForEpoch(targetOperand.epoch, checkpoint, statistics);

      for (const sourcePlaced of sourceInstances) {
        const pending = checkpoint({ label: 'tlas-broad-phase-query', loadEpoch: sourceOperand.epoch });
        if (pending) await pending;

        const queryStartedAt = this._now();
        const [minX, minY, minZ] = sourcePlaced.worldBounds.min;
        const [maxX, maxY, maxZ] = sourcePlaced.worldBounds.max;
        const { truncated } = bvh.queryBox([minX, minY, minZ], [maxX, maxY, maxZ], {
          // Stage 1 (spec §7.5.1 tlasLeafRangeEmissions) AND the budget check both live here,
          // fired BEFORE per-primitive exact-overlap filtering -- exactly the "upstream of both
          // [target-scope/self-exclusion] filters" ordering §9.3.1 requires, and upstream of
          // CollisionInstanceBVH's own internal exact-overlap gate too (which is not one of the
          // two filters §9.3.1 means, but would otherwise silently narrow what this budget sees).
          onLeafRange: (offset, count) => {
            statistics.tlasLeafRangeEmissions++;
            if (pendingCapacityError) return 'stop'; // already flagged by an earlier leaf THIS CALL -- stop expanding further
            candidateBudgetUsed += count;
            statistics.tlasPrimitiveCandidatePairs += count;
            if (candidateBudgetUsed > maxTlasCandidatePairs) {
              // Exact contract values (spec §9.3.2), not the raw overshoot amount -- "permit
              // exactly maxTlasCandidatePairs... on the attempted (limit+1)-th expansion..." --
              // this leaf's own raw count may itself carry candidateBudgetUsed past the limit by
              // more than 1 (conservative-range accounting, see this method's own header comment);
              // the ERROR's fields stay exact regardless.
              pendingCapacityError = new CapacityExceededError('tlas-candidate-budget', {
                limit: maxTlasCandidatePairs, completed: maxTlasCandidatePairs, attempted: maxTlasCandidatePairs + 1,
                sourceEpoch: sourceOperand.epoch, targetEpoch: targetOperand.epoch,
              });
              return 'stop'; // never reaches this leaf's own per-primitive loop (CollisionInstanceBVH.js)
            }
            return undefined;
          },
          onCandidate: (builderPositionIndex) => {
            const record = bvh.recordAt(builderPositionIndex); // the ONLY valid resolution path (Task 3) -- fragmentId/spatial hit only, see this method's own header comment
            if (scopeFragmentSet && !scopeFragmentSet.has(record.fragmentId)) return undefined; // filtered out, not a candidate
            if (isSourceOwnFragment(sourceOperand, targetOperand.epoch, record.fragmentId)) return undefined; // self-excluded
            const targetPlaced = currentByFragmentId.get(record.fragmentId);
            if (!targetPlaced) return undefined; // NOT part of THIS call's own current target scope/state (Critical #1 fix) -- e.g. a stale whole-model-cached fragment
            statistics.broadPhasePairs++; // counted immediately before the exact predicate, matching the linear path's own ordering
            if (this._testBroadPhasePair(sourcePlaced, targetPlaced)) {
              candidates.push([sourcePlaced, targetPlaced, targetOperand]);
            }
            return undefined;
          },
        });
        statistics.tlasQueryMs += this._now() - queryStartedAt;
        if (truncated && pendingCapacityError) break outer; // stop ALL further traversal, throw below
      }
    }
    if (pendingCapacityError) throw pendingCapacityError; // thrown AFTER every traversal call returned (spec §9.3.3), never inside a shapecast callback
    statistics.tlasExactRetestSurvivors = candidates.length; // stage-3 count
    statistics.tlasNarrowPhaseInputPairs = candidates.length; // == retest survivors, spec §7.1b's no-dedup guarantee
    return candidates;
  }

  /**
   * GeometryRegistry's `resolveGeometryView(loadEpoch, geometryIndex)` dependency: the one place
   * this library reads raw geometry out of the Viewer.
   *
   * Deliberately synchronous end to end. adaptViewerGeometry returns LIVE references into Viewer's
   * own buffers, and createGeometryRegistry's buildWeld hands the result straight to compactAndWeld
   * with no intervening await — a promise here would open exactly the gap that rule closes.
   */
  _resolveGeometryView(loadEpoch, geometryIndex) {
    const model = this._modelByEpoch.get(loadEpoch);
    const fragId = this._representativeFragmentByGeometry.get(loadEpoch)?.get(geometryIndex);
    // Both are present by construction: findClashes records representative fragments before any
    // narrow-phase build can be requested, and the epoch's model is registered by admitModel before
    // extraction even starts. A miss means an internal invariant broke — say so, rather than let
    // getRenderProxy(undefined, undefined) fail with a cryptic Viewer-side error.
    if (!model || fragId === undefined) {
      throw new Error(
        `CollisionWorld: no representative fragment recorded for geometryIndex ${geometryIndex} ` +
        `in loadEpoch ${loadEpoch}`,
      );
    }
    // A fragment with no live render proxy -- or a proxy carrying no geometry -- is TRANSIENT: not
    // yet loaded, culled, or already torn down. It must NOT be fed to adaptViewerGeometry, which
    // would return the same `unsupported-geometry-layout` marker a genuinely malformed geometry
    // produces, and which createGeometryRegistry's buildWeld would then settle as a PERMANENT
    // oversized entry for the whole epoch -- contradicting the spec's own rule that a normalization
    // failure "settles no persistent entry state" (spec :3171-3174) and giving this fragment no way
    // back once its proxy exists again. Throw instead: GeometryRegistry._runPhase's existing
    // rejection handling discards the in-flight entry, so the next lookup starts a fresh attempt.
    const proxy = this._viewer?.impl?.getRenderProxy(model, fragId);
    if (!proxy || !proxy.geometry) {
      throw new RenderProxyUnavailableError({
        loadEpoch, geometryIndex, fragId, modelId: modelIdOf(model),
      });
    }
    const triangleGeometryView = adaptViewerGeometry(proxy.geometry);
    return { triangleGeometryView, weldEpsilon: resolveWeldEpsilon(model) };
  }
}
