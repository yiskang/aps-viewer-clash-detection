// test/clashtest/results/resultSet.identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePairId, pairSemanticsOf, makeResultId, comparePairIds, elementRefKey } from '../../../clashtest/identity/ids.js';
import { projectUnitPairs } from '../../../clashtest/results/resultSet.js';

const ref = (modelKey, dbId) => ({ modelKey, dbId });
const ctx = (mode) => ({ mode, testId: 'T1', semanticDigest: `sha256:${'a'.repeat(64)}`,
  maxResultsPerRun: 10, unitPlanRank: new Map([['u1', 0]]), unreachableOwners: new Map(), mixedOwners: new Map() });

test('the projection uses P1 exactly: makePairId(mode, x, y) and P1 ids', () => {
  for (const mode of ['volume-overlap', 'surface-intersection', 'containment', 'clearance']) {
    const p = { source: ref('MB', 9), target: ref('MA', 1), type: mode,
      ...(mode === 'clearance' ? { distance: 1, clearance: 2, witness: { sourcePoint: [0, 0, 0], targetPoint: [1, 1, 1] } } : { witness: null }) };
    const [r] = projectUnitPairs({ unitId: 'u1', pairs: [p] }, ctx(mode));
    const expected = makePairId(mode, p.source, p.target);
    assert.deepEqual(r.pair, expected, mode);
    assert.equal(r.resultId, makeResultId('T1', `sha256:${'a'.repeat(64)}`, expected), mode);
    // P1's own mode -> semantics mapping predicts the orientation; P5 stores no semantics value.
    const ordered = pairSemanticsOf(mode) === 'ordered';
    assert.equal(r.pair.first.modelKey === p.source.modelKey && r.pair.first.dbId === p.source.dbId, ordered, mode);
    assert.equal('pairSemantics' in r, false, mode);
  }
});

test('P5 sorts with P1 comparePairIds and keys with P1 elementRefKey', () => {
  const a = makePairId('volume-overlap', ref('MA', 1), ref('MB', 7));
  const b = makePairId('volume-overlap', ref('MA', 2), ref('MB', 7));
  assert.equal(comparePairIds(a, b) < 0, true);
  assert.notEqual(elementRefKey(ref('MA', 1)), elementRefKey(ref('MA', 11)));
});
