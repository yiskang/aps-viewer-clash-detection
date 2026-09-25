import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2].map((d) => ({ dbId: d, ownerDbIds: [d] })) }, { modelKey: 'B', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }] }];
const units = [
  { unitId: 'u1', source: { modelKey: 'A', roots: [1] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 5 },
  { unitId: 'u2', outcome: 'failed', cause: 'capacity-exceeded', source: { modelKey: 'A', roots: [2] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 7 },
  { unitId: 'u3', outcome: 'split', source: { modelKey: 'A', roots: [1, 2] }, targets: [{ modelKey: 'B', whole: true }], pairSpaceWeight: 100 },
];
const c = () => createContextInternal({}, {});

test('summarize: exact totals, deterministic ordering, gap weight ignores split parents', async () => {
  const set = makeResultSet({ models, units, coverage: 'partial', integrity: 'caveated', freshness: 'stale',
    results: [{ pair: [['A', 1], ['B', 1]] }, { pair: [['A', 1], ['A', 2]] }],
    diagnostics: { total: 9, countsByReason: [{ scope: 'fragment', reason: 'fragment-not-loaded', count: 4 }], completenessAffectingUpperBound: 4, omittedReasonOccurrences: 5 } });
  const s = await c().summarize(set);
  assert.equal(s.totalResults, 2);
  assert.deepEqual(s.resultsByMode, [{ mode: 'volume-overlap', count: 2 }]);
  assert.deepEqual(s.resultsByPairModels, [{ pairModels: ['A', 'A'], count: 1 }, { pairModels: ['A', 'B'], count: 1 }]);
  assert.deepEqual(s.resultsByCrossModel, { crossModel: 1, sameModel: 1 });
  assert.deepEqual(s.unitOutcomes, [{ outcome: 'evaluated', cause: null, count: 1 }, { outcome: 'failed', cause: 'capacity-exceeded', count: 1 }]);
  assert.equal(s.gapWeight, 7);
  assert.deepEqual(s.axes, { coverage: 'partial', integrity: 'caveated', freshness: 'stale', freshnessAtSeal: true });
  assert.equal(s.caveats.total, 9); assert.deepEqual(s.caveats.countsByReason, [{ scope: 'fragment', reason: 'fragment-not-loaded', count: 4 }]); assert.equal(s.caveats.omittedReasonOccurrences, 5);
});

test('summarize: caveated results use the pair-level verdict; planning gaps counted; empty set is exact', async () => {
  const set = makeResultSet({ models, units: [{ ...units[0], taints: [{ kind: 'unit', modelKey: null, reason: 'taint-overflow', occurrences: 1 }] }], results: [{ pair: [['A', 1], ['B', 1]] }] });
  assert.equal((await c().summarize(set)).resultsCaveated, 1);
  const gap = makeResultSet({ models, units: [], planningGaps: [{ phase: 'planning', cause: 'plan-too-large' }], coverage: 'partial', status: 'failed' });
  const s = await c().summarize(gap);
  assert.deepEqual(s.planningGaps, [{ cause: 'plan-too-large', count: 1 }]); assert.equal(s.totalResults, 0); assert.deepEqual(s.resultsByMode, []);
});
