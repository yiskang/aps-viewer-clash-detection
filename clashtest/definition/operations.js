// clashtest/definition/operations.js
//
// The store-bound spec 18 definition surface (validateTest / saveTest / getTest / listTests / archiveTest).
// P2 owns the 5.3 / 5.5 rules for these operations; P7's engine facade delegates to them. `deleteTest` is not
// here: it needs `resultStore.tombstoneTest` first (5.5 ordering) and is wired in P7.

import { captureAndValidate, toDefinitionError, validateTestSummaryPage, validateTest } from './validate.js';
import { prepareDefinition } from './normalize.js';
import { deepFreeze } from '../util/capture.js';
import { StoreNotConfiguredError, CorruptListingError } from '../errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../options.js';

/** 5.5: the engine maps a resolveForRun status to one planning cause. Consumed by P6; P2 does not map it. */
export const RESOLVE_STATUS_TO_PLANNING_CAUSE = Object.freeze({
  live: null, archived: 'test-archived', deleted: 'test-deleted', missing: 'test-not-found',
});

/**
 * @param {object} o
 * @param {object|null} [o.testStore]  a ClashTestStore; absent => every operation but validateTest rejects
 * @param {object} [o.limits]          resolved engine limits, merged over P0's defaults
 * @param {() => (void | Promise<void>)} [o.yieldToScheduler]
 * @param {() => number} [o.now]
 */
export function createDefinitionOperations({ testStore = null, limits = {}, yieldToScheduler, now } = {}) {
  const resolved = { ...ENGINE_LIMIT_DEFAULTS, ...limits };
  const slice = { yieldToScheduler, now, limits: resolved };
  const requireStore = () => { if (!testStore) throw new StoreNotConfiguredError({ store: 'testStore' }); };

  async function prepareUntrusted(value) {
    const result = captureAndValidate(value, { limits: resolved });
    if (result.issues.length > 0) throw toDefinitionError(result);
    const { definition } = await prepareDefinition(result.captured, slice);
    return definition;
  }

  return {
    validateTest: (def) => validateTest(def, { limits: resolved }),

    saveTest(def) {
      // The capture MUST happen in the caller's turn, before the promise is returned (5.3 (iii)).
      const captured = captureAndValidate(def, { limits: resolved });
      return (async () => {
        requireStore();
        if (captured.issues.length > 0) throw toDefinitionError(captured);
        const { definition } = await prepareDefinition(captured.captured, slice);
        return testStore.put(definition);
      })();
    },

    async getTest(testId, revision) {
      requireStore();
      const stored = await testStore.get(testId, revision);
      if (stored === null || stored === undefined) return null;
      return prepareUntrusted(stored);       // 5.3 (iv): untrusted, captured and validated on receipt
    },

    async listTests(options = {}) {
      requireStore();
      const page = await testStore.list(options);
      // The store's page is untrusted and may keep changing: validate a detached copy and return THAT, frozen.
      const { issues, captured } = validateTestSummaryPage(page, { returnCopy: true });
      if (issues.length > 0 || captured === null) throw new CorruptListingError({ issues });
      return deepFreeze(captured);
    },

    async archiveTest(testId) {
      requireStore();
      return testStore.archive(testId);
    },
  };
}
