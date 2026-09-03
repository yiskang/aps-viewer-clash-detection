// collision/scheduler.js
//
// The checkpoint/scheduler PORT: the single interruption/revalidation primitive every
// yield point in this design shares (spec:2830-2837 "entry order: disposed first";
// spec:1392-1397 "same conditional, shared-frameBudgetMs-accumulator check every
// checkpoint in this design uses"). `GeometryRegistry` (Task 13) depends on this port
// via constructor injection; `CollisionWorld` (Task 17) is the real implementation
// and must expose its lifecycle state through this same shape.
//
// Deliberately ONE operation, not separate `isDisposed()`/`isEpochLive()` polls -- see
// this task's write-up for the full ordering/resume-safety rationale. Also deliberately
// NOT always-`async`: `checkpoint()` returns `undefined` synchronously on the "not due"
// fast path and only returns a real Promise when a yield is actually due (codex-advisor
// finding, this task: an always-`async` function that callers unconditionally `await`
// forces a microtask-queue suspension on EVERY call -- pure overhead, not real
// frame-budget relief, at the broad-phase scan's up-to-1,000,000-checkpoint scale,
// spec:3032-3034, 2014). Callers MUST use `const pending = checkpoint(...); if (pending)
// await pending;`, never a bare `await checkpoint(...)`.

import { WorldDisposedError, ModelEvictedError } from './errors.js';
import { frameBudgetMs } from './constants.js';

/**
 * A per-SCOPE elapsed-time accumulator, where "scope" is decided by whoever
 * constructs the port (spec:3106: each findClashes call owns its own accumulator;
 * spec:1392-1397: every checkpoint sharing one build/composition uses the SAME
 * accumulator instance). This module makes no assumption about how long a scope lasts
 * -- only that the caller passes ONE accumulator instance to every checkpoint() call
 * within one scope, and constructs a fresh accumulator (via this factory) for a new
 * scope. `ProperCrossingQuery`/`SurfaceIntersectionQuery` deliberately do NOT use this
 * accumulator at all (spec:1932-1957, 2065-2067) -- they own a private,
 * traversal-local clock instead; that exception lives in those later tasks, not here.
 */
export function createFrameBudgetAccumulator({ now = () => performance.now(), budgetMs = frameBudgetMs } = {}) {
  let lastCheckpointAt = now();
  return {
    isDue() {
      return now() - lastCheckpointAt >= budgetMs;
    },
    markCheckpointed() {
      lastCheckpointAt = now();
    },
  };
}

/**
 * Default real scheduling yield: one macrotask turn. `setTimeout(0)` (rather than a
 * microtask) is deliberate -- it actually lets the event loop run other queued work
 * before resuming, which is the point of yielding for frame-budget purposes.
 */
function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds a real CheckpointPort, scoped to whatever accumulator/lifecycle-state
 * callbacks it is given -- construct a FRESH one per findClashes call (or per
 * call-scoped checkpoint threaded into a triggered GeometryRegistry build), never as
 * one long-lived, world-scoped singleton (spec:3106 per-call accumulator ownership).
 * `isDisposed`/`isEpochLive` are supplied by the owning CollisionWorld (Task 17) --
 * this module owns only the ordering/yield/synchronicity contract, never the
 * lifecycle state itself (that state is CollisionWorld's, per spec:3420-3470; Task 17
 * needs a `liveEpochs: Set<number>` alongside its `modelLifecycle` WeakMap to answer
 * `isEpochLive`, since a WeakMap keyed by Model object cannot be reverse-looked-up by
 * loadEpoch -- see this task's write-up).
 *
 * @param {Object} deps
 * @param {() => boolean} deps.isDisposed
 * @param {(loadEpoch: number) => boolean} deps.isEpochLive
 * @param {ReturnType<typeof createFrameBudgetAccumulator>} deps.accumulator
 * @param {() => Promise<void>} [deps.yieldToScheduler]
 * @returns {{ checkpoint: (ctx: { loadEpoch: number, modelIdHint?: (number|string) }) => (undefined | Promise<void>) }}
 */
export function createCheckpointPort({ isDisposed, isEpochLive, accumulator, yieldToScheduler = defaultYield }) {
  function validate(loadEpoch, modelIdHint) {
    if (isDisposed()) {
      throw new WorldDisposedError();
    }
    if (!isEpochLive(loadEpoch)) {
      throw new ModelEvictedError(modelIdHint ?? loadEpoch);
    }
  }

  return {
    checkpoint({ loadEpoch, modelIdHint } = {}) {
      // Entry validation is ALWAYS synchronous, whether or not a yield follows -- an
      // invalid entry must reject before any yield is even attempted.
      validate(loadEpoch, modelIdHint);
      if (!accumulator.isDue()) {
        return undefined; // synchronous fast path -- no Promise, no microtask forced
      }
      return (async () => {
        await yieldToScheduler();
        accumulator.markCheckpointed();
        validate(loadEpoch, modelIdHint);
      })();
    },
  };
}
