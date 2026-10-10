// test/clashpanel/core/testSummary.test.mjs — spec §26.4 summary record and AC-M17 null-set runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealSummary, summaryStatusText } from '../../../clashpanel/core/testSummary.js';
import { STATEMENTS } from '../../../clashpanel/core/runReport.js';
import { makeSet, hardResults } from '../support/controllerHarness.mjs';

test('sealSummary captures the §26.4 fields from a sealed set; provenance is reduced to identity triples', () => {
  const set = makeSet({ runId: 'run-1', results: hardResults(3), coverage: 'partial', integrity: 'clean', freshness: 'current' });
  const s = sealSummary({
    summary: { runId: 'run-1', status: 'completed', resultSet: set },
    runState: { startedAtMs: 10, progress: { caveatCount: 2 } },
    draft: { lastRun: { definitionKey: 'K', revision: 1 } }, sealedAt: 25,
  });
  assert.deepEqual(s, {
    runId: 'run-1', status: 'completed', resultCount: 3, coverage: 'partial', integrity: 'clean', freshnessAtSeal: 'current', caveatCount: 2,
    models: [{ modelKey: 'mA', bindingGeneration: 1, modelVersion: 'v1' }, { modelKey: 'mB', bindingGeneration: 1, modelVersion: 'v1' }],
    definitionKey: 'K', startedAt: 10, sealedAt: 25,
  });
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.models) && Object.isFrozen(s.models[0]));
  assert.equal('results' in s, false, 'no results[], ledger or provenance beyond identity is retained');
});

test('AC-M17: a planning-stage cancel or failure (no set) has null counts/axes, models [] and keeps status, timing, definitionKey', () => {
  for (const status of ['cancelled', 'failed']) {
    const s = sealSummary({ summary: { runId: 'run-2', status, resultSet: null }, runState: { startedAtMs: 1, progress: null },
      draft: { lastRun: { definitionKey: 'K2', revision: 3 } }, sealedAt: 9 });
    assert.deepEqual(s, { runId: 'run-2', status, resultCount: null, coverage: null, integrity: null, freshnessAtSeal: null,
      caveatCount: null, models: [], definitionKey: 'K2', startedAt: 1, sealedAt: 9 });
  }
});

test('summaryStatusText: "<n> clashes reported" (0 included, never "No clashes"); a null set reads the §7.3 headline', () => {
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 0, coverage: 'full' }), 'Completed — 0 clashes reported');
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 1, coverage: 'full' }), 'Completed — 1 clash reported');
  assert.equal(summaryStatusText({ status: 'completed', resultCount: 12, coverage: 'partial' }), 'Completed — 12 clashes reported (partial coverage)');
  assert.equal(summaryStatusText({ status: 'cancelled', resultCount: 4, coverage: 'partial' }), 'Stopped — 4 clashes reported (partial coverage)');
  assert.equal(summaryStatusText({ status: 'cancelled', resultCount: null, coverage: null }), 'Stopped before any results');
  assert.equal(summaryStatusText({ status: 'failed', resultCount: null, coverage: null }), STATEMENTS.NO_RESULT_SET);
  assert.equal(summaryStatusText({ status: 'invalidated', resultCount: null, coverage: null }), STATEMENTS.MODEL_CHANGED);
  for (const n of [0, 3]) assert.doesNotMatch(summaryStatusText({ status: 'completed', resultCount: n, coverage: 'full' }), /no clashes/i);
});
