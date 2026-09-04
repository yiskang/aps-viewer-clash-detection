// collision/CollisionWorld.js
//
// The admit/evict/dispose/lease surface that makes every later cache and query safe
// against model eviction, world disposal, and modelId reuse.

import { WorldDisposedError, ModelEvictedError } from './errors.js';
import { createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator } from './scheduler.js';

function modelIdOf(model) {
  return model && model.id !== undefined ? model.id : model;
}

function defaultYieldToScheduler() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
    this._now = now;
    this._yieldToScheduler = yieldToScheduler;
    // NOTE: no accumulator/clock-baseline field here — the frameBudgetMs accumulator is scoped to one
    // findClashes CALL (docs/...: "one performance.now()-based accumulator for the whole call"), never
    // to the whole CollisionWorld instance. See createCheckpointPort() below, which is the ONLY place
    // that timing state lives, freshly, per call.
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
}
