// test/fixtures/FakeCheckpointPort.mjs
//
// Test double for the CheckpointPort (collision/scheduler.js). Lets a unit test drive
// disposed-state, per-epoch liveness, and a forced-yield trigger directly, while
// enforcing the EXACT SAME ordering contract (disposed-first, then epoch,
// conditionally-yield, revalidate-after-yield) as the real port -- so
// `runCheckpointPortContractTests` (checkpointPort.contract.mjs) can be run against
// both this fake (here) and the real CollisionWorld-backed port (Task 17) to prove
// conformance.

import { WorldDisposedError, ModelEvictedError } from '../../collision/errors.js';

export function makeFakeCheckpointPort({ frameBudgetMs = 8 } = {}) {
  let disposed = false;
  const liveEpochs = new Set();
  let now = 0;
  let lastCheckpointAt = 0;
  let forcedDue = false;
  let yieldInvocationCount = 0;

  function validate(loadEpoch, modelIdHint) {
    if (disposed) throw new WorldDisposedError();
    if (!liveEpochs.has(loadEpoch)) throw new ModelEvictedError(modelIdHint ?? loadEpoch);
  }

  const port = {
    // Returns undefined SYNCHRONOUSLY on the "not due" fast path -- no Promise
    // allocated, no microtask forced on the caller -- and only returns a real
    // Promise when a yield is actually due. Validation is ALWAYS synchronous and
    // throws synchronously on failure, whether or not a yield follows (codex-advisor
    // finding: an always-async checkpoint forces a microtask tick per call even on
    // the fast path, which is real overhead at the broad-phase scan's scale).
    checkpoint({ loadEpoch, modelIdHint } = {}) {
      validate(loadEpoch, modelIdHint);
      const due = forcedDue || now - lastCheckpointAt >= frameBudgetMs;
      if (!due) return undefined;
      forcedDue = false;
      return (async () => {
        yieldInvocationCount++;
        // A real asynchronous hop -- deliberately not synchronous, so a caller can
        // mutate state between "checkpoint was called" and "checkpoint's internal
        // yield resolves" and have that mutation observed by the revalidation below.
        // This is exactly what the contract tests exploit to prove revalidate-after-yield.
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastCheckpointAt = now;
        validate(loadEpoch, modelIdHint);
      })();
    },
  };

  const controls = {
    setDisposed(value) { disposed = value; },
    setEpochLive(loadEpoch, live) {
      if (live) liveEpochs.add(loadEpoch);
      else liveEpochs.delete(loadEpoch);
    },
    advanceClock(ms) { now += ms; },
    forceYieldDue() { forcedDue = true; },
    forceYieldNotDue() { forcedDue = false; lastCheckpointAt = now; },
    getYieldInvocationCount() { return yieldInvocationCount; },
  };

  return { port, controls };
}
