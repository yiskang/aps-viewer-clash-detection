import { createCheckpointPort, createFrameBudgetAccumulator } from '../../collision/scheduler.js';
import { runCheckpointPortContractTests } from './checkpointPort.contract.mjs';

function makeRealPortHarness(options = {}) {
  let disposed = false;
  const liveEpochs = new Set();
  let mockNow = 0;
  let forcedDue = false;
  let yieldInvocationCount = 0;
  let currentYieldResolvers = [];

  const accumulator = createFrameBudgetAccumulator({ now: () => mockNow, budgetMs: 8 });
  const wrappedAccumulator = {
    isDue: () => forcedDue || accumulator.isDue(),
    markCheckpointed: () => { forcedDue = false; accumulator.markCheckpointed(); },
  };

  const port = createCheckpointPort({
    isDisposed: () => disposed,
    isEpochLive: (loadEpoch) => liveEpochs.has(loadEpoch),
    accumulator: wrappedAccumulator,
    yieldToScheduler: () => {
      yieldInvocationCount++;
      if (options.controllableYield) {
        return new Promise((resolve) => { currentYieldResolvers.push(resolve); });
      } else {
        return new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
  });

  const controls = {
    setDisposed: (v) => { disposed = v; },
    setEpochLive: (loadEpoch, live) => { live ? liveEpochs.add(loadEpoch) : liveEpochs.delete(loadEpoch); },
    advanceClock: (ms) => { mockNow += ms; },
    forceYieldDue: () => { forcedDue = true; },
    forceYieldNotDue: () => { forcedDue = false; accumulator.markCheckpointed(); },
    getYieldInvocationCount: () => yieldInvocationCount,
    resolveNextYield: () => {
      if (currentYieldResolvers.length > 0) {
        currentYieldResolvers.shift()();
      }
    },
  };

  return { port, controls };
}

runCheckpointPortContractTests(() => makeRealPortHarness({ controllableYield: true }), {
  suiteName: 'CheckpointPort contract (real createCheckpointPort)',
});
