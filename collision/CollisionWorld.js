// collision/CollisionWorld.js
//
// The admit/evict/dispose/lease surface that makes every later cache and query safe
// against model eviction, world disposal, and modelId reuse.

import * as THREE from 'three';
import {
  WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
} from './errors.js';
import { createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator } from './scheduler.js';
import { maxBroadPhaseInstancePairs, maxCollisionInstancesPerEpoch, weldEpsilonMeters } from './constants.js';
import { extractFragments } from './viewer/ViewerModelAdapter.js';
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
 */
function createComposedStageScheduler(checkpoint, now) {
  let sinceMs = now();
  return {
    elapsedMs: () => now() - sinceMs,
    checkpointIfDue: async () => {
      const pending = checkpoint();
      if (pending) {
        await pending;
        sinceMs = now();
      }
    },
  };
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
  };
}

function defaultYieldToScheduler() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class CapacityExceededError extends Error {
  constructor(kind, details) {
    super(`CollisionInstance admission rejected (${kind})`);
    this.name = 'CapacityExceededError';
    this.kind = kind; // 'call-wide-unique-fragment-precheck' | 'bucket-capacity'
    Object.assign(this, details);
  }
}

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

  // Entry-order check for findClashes (Tasks 19/20 call this at the very top of their own method
  // body). docs/...:2830-2837, 3533-3543.
  _checkEntryLifecycle(source, target) {
    if (this._disposed) throw new WorldDisposedError();
    if (source.model !== target.model) {
      const err = new Error('CollisionWorld.findClashes: cross-model queries are out of scope in Milestone 1');
      err.code = 'cross-model-query-rejected';
      throw err;
    }
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
      return realPort.checkpoint({ loadEpoch, modelIdHint: modelIdOf(model) });
    };
  }

  // ---- Task 19: the surface-intersection vertical slice -------------------------------------

  /**
   * Entry -> extraction -> capacity-gated admission -> broad phase -> narrow phase -> aggregation.
   *
   * Milestone 1 restrictions, all rejected loudly rather than silently degraded: single-model
   * queries only and `groupBy: 'dbId'` only. All three query modes are supported.
   *
   * @param {{ source: {model: Object, dbIds: number[]}, target: {model: Object, dbIds: number[]},
   *           mode: string, groupBy: 'dbId' }} query
   * @returns {Promise<{ pairs: Array, statistics: Object }>}
   */
  async findClashes(query) {
    // Disposal is checked FIRST, before argument validation and before any operand is touched, so a
    // disposed world always reports disposal rather than whichever other complaint it might also
    // have (spec entry order: "disposed first"). _checkEntryLifecycle re-checks it below; that
    // repetition is deliberate and free.
    if (this._disposed) throw new WorldDisposedError();

    if (!query || !query.source || !query.target) {
      throw new Error('findClashes: query must supply both a source and a target operand');
    }
    if (!Array.isArray(query.source.dbIds) || !Array.isArray(query.target.dbIds)) {
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

    const startedAt = this._now();
    const statistics = emptyStatistics();

    // Throws WorldDisposedError, then cross-model-query-rejected, then ModelEvictedError, in that
    // order; lazily admits a never-seen model.
    const { model, epoch } = this._checkEntryLifecycle(query.source, query.target);
    // Instance-tree readiness wait, immediately after the entry-order lifecycle checks and BEFORE
    // any extraction (docs/superpowers/specs/instance-tree-readiness-decision.md, "Hook point for
    // implementation"). Cross-model queries are rejected above, so both operands are the SAME model
    // object in Milestone 1 -- one wait per call, nothing to deduplicate.
    //
    // Branch on the return value; do NOT bare-`await` it. On the ready path this must not even cost
    // a microtask boundary (see _awaitObjectTreeReady's own comment).
    const pendingObjectTree = this._awaitObjectTreeReady(model);
    if (pendingObjectTree) {
      // A REAL wait can last as long as the Viewer's property-database load, i.e. seconds -- far
      // wider a window than any other gap in this method -- so the entry-order lifecycle checks are
      // re-run across it. Without this, an eviction or disposal landing mid-wait could still be
      // reported as a SUCCESSFUL empty result: extraction's own first checkpoint is what normally
      // catches such a race (one non-empty operand is enough for that), but it never fires AT ALL
      // when BOTH dbIds arrays are empty -- ViewerModelAdapter's per-dbId loop body never runs --
      // and the empty-extraction branch below then returns { pairs: [] } as a success.
      try {
        await pendingObjectTree;
      } finally {
        // In `finally`, deliberately: these run on the failure path too, and a throw here REPLACES a
        // pending ObjectTreeUnavailableError -- which is the correct precedence. Disposal outranks
        // "the tree could not be built", in the same order the entry checks above use (disposed
        // first, then evicted).
        if (this._disposed) throw new WorldDisposedError();
        this._assertEpochLive(model, epoch);
      }
    }
    const lease = Object.freeze({ model, epoch });
    // ONE port for this whole call, with one frame-budget accumulator shared by every checkpoint in
    // it (extraction, broad phase, narrow phase). Its ctx defaults to this lease, so almost every
    // call site can pass nothing at all.
    const checkpoint = this.createCheckpointPort(lease);

    // --- Extraction. extractFragments calls checkpoint({ requestedDbId }); the extra field is
    // simply ignored by the port, so the SAME callable is threaded straight through with no bridge.
    // `THREE` is deliberately NOT overridden: extraction's own `globalThis.THREE` default is the
    // Viewer's real r71 global, and reading it there is the one sanctioned crossing point.
    const sourceExtracted = await extractFragments(model, query.source.dbIds, epoch, { checkpoint });
    const targetExtracted = await extractFragments(model, query.target.dbIds, epoch, { checkpoint });

    // ---- BEGIN synchronous span. Nothing between the end of extraction and admitCollisionInstances
    // may await: admission's check-then-commit atomicity guarantee (Task 18) is provided for free by
    // JS's single-threaded execution only for as long as this span stays await-free. Recording
    // representative fragments is a pure Map write and is safe to include.
    if (sourceExtracted.size === 0 || targetExtracted.size === 0) {
      statistics.totalMs = this._now() - startedAt;
      return { pairs: [], statistics };
    }
    // The broad-phase ceiling is checked HERE -- before any side effect, not just before the scan
    // (finding 19-2). Extraction size and admitted-instance count are the same number for this
    // check's purposes (every extracted fragment becomes exactly one CollisionInstance), so nothing
    // is lost by checking early -- but a call that is going to be REJECTED must not first consume
    // maxCollisionInstancesPerEpoch headroom via admitCollisionInstances or pollute the epoch's
    // representative-fragment map, neither of which is undone on the throw.
    if (this._exceedsBroadPhaseCeiling(sourceExtracted.size, targetExtracted.size)) {
      throw new Error(
        `findClashes: broad-phase candidate count exceeds maxBroadPhaseInstancePairs ` +
        `(${sourceExtracted.size} x ${targetExtracted.size} > ${maxBroadPhaseInstancePairs})`,
      );
    }
    this._recordRepresentativeFragments(epoch, sourceExtracted);
    this._recordRepresentativeFragments(epoch, targetExtracted);
    // Which side's record wins per fragmentId is immaterial: admitCollisionInstances reads only
    // geometryIdentity, which is identical for a given fragmentId regardless of which walk found it.
    // The per-side ownerDbId/placement is read from each side's OWN record below, never from here.
    const merged = new Map([...sourceExtracted, ...targetExtracted]);
    const admitted = this.admitCollisionInstances(lease, merged);
    // ---- END synchronous span.

    const sourceInstances = [...sourceExtracted.values()].map((rec) => makePlaced(admitted, rec));
    const targetInstances = [...targetExtracted.values()].map((rec) => makePlaced(admitted, rec));

    // --- Broad phase. Its ceiling was already enforced above, against the extraction counts these
    // two arrays are built from one-for-one, and deliberately BEFORE the admission/bookkeeping side
    // effects -- so there is no second check here.
    const broadPhaseStartedAt = this._now();
    const candidates = await this._runBroadPhaseScan(sourceInstances, targetInstances, statistics, checkpoint);
    statistics.broadPhaseMs = this._now() - broadPhaseStartedAt;

    // --- Narrow phase + aggregation.
    const narrowPhaseStartedAt = this._now();
    const pairsByKey = new Map(); // `${sourceDbId}:${targetDbId}` -> ClashPair; ORDERED, never canonicalized
    const oversizedDiagnosedFragments = new Set();
    for (const [sourcePlaced, targetPlaced] of candidates) {
      const pending = checkpoint();
      if (pending) await pending;
      const hit = await this._runNarrowPhasePair(
        sourcePlaced, targetPlaced, query.mode, model, epoch, statistics, oversizedDiagnosedFragments, checkpoint,
      );
      statistics.narrowPhasePairs++;
      if (!hit) continue;
      const key = `${sourcePlaced.ownerDbId}:${targetPlaced.ownerDbId}`;
      if (!pairsByKey.has(key)) {
        const modelId = modelIdOf(model);
        pairsByKey.set(key, {
          source: { modelId, dbId: sourcePlaced.ownerDbId },
          target: { modelId, dbId: targetPlaced.ownerDbId },
          type: query.mode,
        });
      }
    }
    statistics.narrowPhaseMs = this._now() - narrowPhaseStartedAt;
    statistics.totalMs = this._now() - startedAt;
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

  async _runBroadPhaseScan(sourceInstances, targetInstances, statistics, checkpoint) {
    const candidates = [];
    for (let i = 0; i < sourceInstances.length; i++) {
      for (let j = 0; j < targetInstances.length; j++) {
        // The checkpoint port is CONDITIONALLY synchronous — it returns undefined outright when no
        // yield is due. A bare `await checkpoint()` would force a microtask hop on every one of up
        // to maxBroadPhaseInstancePairs iterations, which is exactly what that contract exists to
        // avoid. Liveness is still validated synchronously on every call, due or not.
        const pending = checkpoint();
        if (pending) await pending;
        statistics.broadPhasePairs++;
        if (this._testBroadPhasePair(sourceInstances[i], targetInstances[j])) {
          candidates.push([sourceInstances[i], targetInstances[j]]);
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
   * `epoch` is the lease's own load epoch. It is redundant with each operand's
   * `geometryIdentity.loadEpoch` (they are equal by construction, since both operands came from this
   * same lease's extraction) and is carried here only to keep the signature the plan's Task 20
   * section documents; the registry is keyed off the identity, not off this parameter.
   */
  async _runNarrowPhasePair(
    sourcePlaced, targetPlaced, mode, model, epoch, statistics, oversizedDiagnosedFragments, checkpoint,
  ) {
    const needsConnectivity = mode !== 'surface-intersection';
    // Diagnosed once per fragment per call, shared by BOTH fragment-scoped skip reasons below: a
    // fragment appearing in many candidate pairs must not flood statistics.diagnostics with the same
    // verdict, whichever of the two it is.
    const diagnoseFragmentOnce = (placed, role, reason) => {
      if (oversizedDiagnosedFragments.has(placed.instance.fragmentId)) return;
      oversizedDiagnosedFragments.add(placed.instance.fragmentId);
      statistics.diagnostics.push({
        scope: 'fragment',
        reason,
        role,
        fragment: fragmentRef(model, placed),
      });
    };
    const buildOne = async (placed, role) => {
      const identity = placed.instance.geometryIdentity; // { loadEpoch, geometryIndex }
      let record;
      try {
        record = await this._registry.getOrBuildGeometry({
          loadEpoch: identity.loadEpoch,
          geometryIndex: identity.geometryIndex,
          ownerModelIdHint: modelIdOf(model), // diagnostic-only, per GeometryRegistry's contract
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
        diagnoseFragmentOnce(placed, role, 'geometry-not-yet-available');
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
        diagnoseFragmentOnce(placed, role, record.reason);
        return null;
      }
      return record;
    };

    const sourceRecord = await buildOne(sourcePlaced, 'source');
    if (!sourceRecord) return false;
    const targetRecord = await buildOne(targetPlaced, 'target');
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
    // is a pair with no diagnostics at all, and this runs once per narrow-phase pair.
    const attach = (diagnostics) => {
      if (!diagnostics || diagnostics.length === 0) return;
      const sourceFragment = fragmentRef(model, sourcePlaced);
      const targetFragment = fragmentRef(model, targetPlaced);
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
