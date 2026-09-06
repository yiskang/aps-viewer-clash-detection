// collision/CollisionWorld.js
//
// The admit/evict/dispose/lease surface that makes every later cache and query safe
// against model eviction, world disposal, and modelId reuse.

import * as THREE from 'three';
import {
  WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
  CapacityExceededError,
} from './errors.js';
import { createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator, reportSpan } from './scheduler.js';
import { maxBroadPhaseInstancePairs, maxCollisionInstancesPerEpoch, weldEpsilonMeters } from './constants.js';
import { extractFragments, extractAllFragments } from './viewer/ViewerModelAdapter.js';
import { adaptViewerGeometry } from './viewer/ViewerGeometryAdapter.js';
import { createGeometryRegistry } from './geometry/createGeometryRegistry.js';
import { surfaceIntersectionQuery } from './query/SurfaceIntersectionQuery.js';
import { containmentModeQuery } from './query/ContainmentModeQuery.js';
import { volumeOverlapQuery } from './query/VolumeOverlapQuery.js';

const supportedModes = ['surface-intersection', 'containment', 'volume-overlap'];

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
  createCompositeCheckpointPort(leases) {
    const realCheckpoint = this.createCheckpointPort(leases[0]);
    return (ctx = {}) => {
      this._assertLeasesStillLive(leases);
      const pending = realCheckpoint(ctx);
      if (!pending) return undefined;
      return (async () => {
        await pending;
        this._assertLeasesStillLive(leases);
      })();
    };
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
    // Task 8: `broadPhase` is validated above as an enum, but no branch in this method actually
    // dispatches on its VALUE yet -- `_runBroadPhaseScan` (the linear oracle) is the only broad-phase
    // implementation that exists before Batch 3/4's TLAS work lands. An explicit `broadPhase:'tlas'`
    // request therefore silently runs the SAME linear scan `broadPhase:'linear'`/the omitted default
    // would, rather than throwing "not yet implemented" -- a deliberate, explicit choice (not an
    // oversight) so a caller opting into 'tlas' early gets a correct, if not-yet-accelerated, result
    // instead of a hard failure. This is a placeholder, not a compatibility guarantee: once Batch 3/4
    // wires a real TLAS path, `broadPhase:'tlas'` will dispatch to it instead.

    const startedAt = this._now();
    const statistics = emptyStatistics();

    // --- Operand normalization and multi-lease capture (design spec §9.2 points 1-3), before any
    // extraction begins. `targetsEntries` is the uniform `{model, dbIds}[]` shape every later step
    // operates on; `distinctModels` is the deduplicated (by object identity) set of every Model
    // object this call touches, source included, source always first.
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
        // the entry checks above use (disposed first, then evicted).
        this._assertLeasesStillLive(leases);
      }
    }

    // ONE composite checkpoint port for this whole call (Task 6): revalidates every captured lease
    // on every checkpoint call, then delegates to ONE real per-call port/accumulator (keyed off the
    // source's own lease, `leases[0]`) shared by every checkpoint site in this call (extraction,
    // broad phase, narrow phase) -- unconditionally, even for a single-model call, since a
    // one-element composite check is a harmless, cheap restatement of what the real port already
    // checks internally.
    const checkpoint = this.createCompositeCheckpointPort(leases);

    // --- Extraction. Source is always exactly one model (query.source.model); its own dbIds are
    // walked via extractFragments, unchanged from pre-Task-6 behavior.
    const sourceLease = leaseByModel.get(query.source.model);
    const sourceEpoch = sourceLease.epoch;
    // `THREE` is deliberately NOT overridden anywhere in this method: extraction's own
    // `globalThis.THREE` default is the Viewer's real r71 global, and reading it there is the one
    // sanctioned crossing point.
    const sourceExtracted = await extractFragments(query.source.model, query.source.dbIds, sourceEpoch, { checkpoint });

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
      let bucket = targetRecordsByEpoch.get(entryEpoch);
      if (!bucket) { bucket = new Map(); targetRecordsByEpoch.set(entryEpoch, bucket); }
      // First-write-wins across duplicate `targets` entries touching the same model/epoch -- mirrors
      // extractFragments's own first-discovery-wins ownerDbId convention, rather than letting a
      // later duplicate entry silently overwrite an earlier one's captured ownerDbId.
      for (const [fragId, rec] of records) {
        if (!bucket.has(fragId)) bucket.set(fragId, rec);
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
      // closes exactly that gap for a genuinely multi-model call.
      this._assertLeasesStillLive(leases);
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
    // already known to be admissible."
    const leaseByEpoch = new Map(leases.map((l) => [l.epoch, l]));
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

    // --- Broad phase. Its ceiling was already enforced above, per target epoch, against the
    // extraction counts these groups are built from one-for-one, and deliberately BEFORE the
    // admission/bookkeeping side effects -- so there is no second check here.
    const broadPhaseStartedAt = this._now();
    const candidates = await this._runBroadPhaseScan(sourceOperand, sourceInstances, targetGroups, statistics, checkpoint);
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
    const oversizedDiagnosedFragments = new Set();
    for (const [sourcePlaced, targetPlaced, targetOperand] of candidates) {
      const pending = checkpoint({ label: 'narrow-phase-pair' });
      if (pending) await pending;
      const hit = await this._runNarrowPhasePair(
        sourcePlaced, targetPlaced, query.mode, sourceOperand, targetOperand,
        statistics, oversizedDiagnosedFragments, checkpoint,
      );
      statistics.narrowPhasePairs++;
      if (!hit) continue;
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
        });
      }
    }
    statistics.narrowPhaseMs = this._now() - narrowPhaseStartedAt;
    statistics.totalMs = this._now() - startedAt;
    // Return-site revalidation (design spec §9.2 point 7b): closes the gap between the LAST
    // checkpoint call above and this successful return, across which the pairs map / statistics are
    // assembled with no checkpoint call of their own.
    this._assertLeasesStillLive(leases);
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
    const diagnoseFragmentOnce = (placed, role, reason, operand) => {
      const key = `${operand.epoch}:${placed.instance.fragmentId}`;
      if (oversizedDiagnosedFragments.has(key)) return;
      oversizedDiagnosedFragments.add(key);
      statistics.diagnostics.push({
        scope: 'fragment',
        reason,
        role,
        fragment: fragmentRef(operand.model, placed),
      });
    };
    const buildOne = async (placed, role, operand) => {
      const identity = placed.instance.geometryIdentity; // { loadEpoch, geometryIndex }
      let record;
      try {
        record = await this._registry.getOrBuildGeometry({
          loadEpoch: identity.loadEpoch,
          geometryIndex: identity.geometryIndex,
          ownerModelIdHint: modelIdOf(operand.model), // diagnostic-only, per GeometryRegistry's contract
          needsConnectivity,
        });
      } catch (err) {
        // EXACTLY this one class is absorbed; anything else -- a checkpoint's own
        // WorldDisposedError/ModelEvictedError, a builder bug, an extraction invariant break --
        // still aborts the whole findClashes call, unchanged.
        if (!(err instanceof RenderProxyUnavailableError)) throw err;
        // A transient Viewer-side miss: no geometry existed to inspect, so nothing was diagnosed
        // ABOUT the geometry and nothing persistent was settled for it (GeometryRegistry already
        // discarded the in-flight entry on this rejection). Skip this candidate pair, say so, and
        // leave a later call free to build the same (loadEpoch, geometryIndex) for real.
        //
        // Attribution caveat, inherited from _recordRepresentativeFragments' first-discovery-wins
        // rule rather than introduced here: the proxy that was missing belongs to the geometry's
        // REPRESENTATIVE fragment, which may not be `placed` when several fragments share one
        // geometryIndex. Render-proxy availability is per-fragment (load/cull state), so a
        // representative can be absent while a sibling instance of the same geometry is present, and
        // this diagnostic then names the sibling. The pre-fix code mis-attributed the identical way
        // (and permanently); widening representatives to a retry list is a separate design change.
        // The `role` and `fragment` fields therefore say WHICH PAIR was skipped, not necessarily
        // which fragment id the Viewer had no proxy for -- the error's own `fragId` does that.
        diagnoseFragmentOnce(placed, role, 'geometry-not-yet-available', operand);
        return null;
      }
      if (record.oversized) {
        // The record's OWN reason, never a hardcoded literal — there are several
        // (geometry-too-large-for-sync-build, unsupported-geometry-layout,
        // rejected-primitive-range, index-references-invalid-vertex). Unlike the missing-proxy case
        // above, every one of them describes a geometry that WAS inspected and structurally rejected,
        // so re-attempting it could only reach the same verdict — which is why this path settles a
        // cached oversized marker for the epoch and is left exactly as Task 19 built it.
        //
        // KNOWN TENSION, deliberately not changed here: the spec's dedup guarantee is scoped to the
        // ceiling outcome only, and says a normalization failure (`unsupported-geometry-layout` or
        // `rejected-primitive-range`) "settles no persistent entry state, so those two diagnoses can
        // still be re-emitted per candidate pair" (spec :3170-3174). createGeometryRegistry's
        // buildWeld filter caches those two as oversized markers all the same, so they are in fact
        // emitted once per epoch, not once per pair. That is a pre-existing behavioural deviation
        // from the spec text, recorded here rather than silently reinterpreted; the batch-4 fix wave
        // was scoped to the missing-proxy half of this problem only.
        diagnoseFragmentOnce(placed, role, record.reason, operand);
        return null;
      }
      return record;
    };

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
    return result.overlap;
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
