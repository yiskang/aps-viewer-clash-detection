// test/clashpanel/core/resultIndex.test.mjs — Task 10 (spec §8.1, §8.2, AC-P12)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultIndex } from '../../../clashpanel/core/resultIndex.js';
import { sealedSet, sealFakeRun } from '../../clashtest/support/resultSetFixtures.mjs';

test('references, not copies: index.at(i) === set.results[i] for a real sealed set', async () => {
  const set = await sealedSet('positives');
  const index = buildResultIndex(set);
  assert.equal(index.count, 2);
  assert.equal(index.resultSet, set);
  for (let i = 0; i < set.results.length; i += 1) assert.equal(index.at(i), set.results[i]);
  assert.equal(index.at(-1), undefined);
  assert.equal(index.at(2), undefined);
  assert.equal(index.at(0.5), undefined);
  assert.ok(Object.isFrozen(index));
});

test('indexOfResultId maps every real resultId to its canonical index; unknown ⇒ -1', async () => {
  const set = await sealedSet('schema-corpus');
  const index = buildResultIndex(set);
  set.results.forEach((r, i) => assert.equal(index.indexOfResultId(r.resultId), i));
  assert.equal(index.indexOfResultId('nope'), -1);
  assert.equal(index.indexOfResultId(undefined), -1);
});

test('Hard (volume-overlap) vs Soft (clearance) from definition.mode; clearance from the sealed definition', async () => {
  const hard = buildResultIndex(await sealedSet('positives'));
  assert.deepEqual([hard.mode, hard.isSoft, hard.clearance], ['volume-overlap', false, null]);
  const soft = buildResultIndex(await sealedSet('schema-corpus'));
  assert.deepEqual([soft.mode, soft.isSoft, soft.clearance], ['clearance', true, 5]);
});

test('pre-resolution seal: definition null ⇒ not Soft, no clearance, empty models, zero count', async () => {
  for (const set of [await sealedSet('cancelled-pre-resolution'), await sealFakeRun('cancelled-pre-resolution'), await sealFakeRun('failed')]) {
    const index = buildResultIndex(set);
    assert.equal(set.definition, null);
    assert.deepEqual([index.mode, index.isSoft, index.clearance, index.count], [null, false, null, 0]);
    assert.deepEqual(index.models, []);
  }
});

test('models come from provenance (modelKey, modelVersion, bindingGeneration) and never carry elementCount', async () => {
  const set = await sealedSet('schema-corpus');
  const index = buildResultIndex(set);
  assert.deepEqual(index.models, set.provenance.models.map((m) => ({ modelKey: m.modelKey, modelVersion: m.modelVersion, bindingGeneration: m.bindingGeneration })));
  for (const m of index.models) assert.equal(Object.hasOwn(m, 'elementCount'), false);
});

test('rejects a non-set; accepts a hand-built minimal set', () => {
  assert.throws(() => buildResultIndex(null), TypeError);
  assert.throws(() => buildResultIndex({ results: 'x' }), TypeError);
  const index = buildResultIndex({ results: [], definition: { mode: 'clearance' }, provenance: { models: [] } });
  assert.deepEqual([index.isSoft, index.clearance], [true, null], 'Soft without a finite clearance ⇒ clearance null');
});

test('200k-entry set: construction completes, at() and indexOfResultId() are correct at both ends', () => {
  const N = 200_000;
  const results = new Array(N);
  for (let i = 0; i < N; i += 1) {
    results[i] = { resultId: `r${i}`, pair: { first: { modelKey: 'mA', dbId: i }, second: { modelKey: 'mB', dbId: i } }, mode: 'volume-overlap', evidence: { witness: null }, flags: {}, unitId: 'u' };
  }
  const set = { results, definition: { mode: 'volume-overlap' }, provenance: { models: [] } };
  const index = buildResultIndex(set);
  assert.equal(index.count, N);
  for (const i of [0, 1, N / 2, N - 1]) {
    assert.equal(index.at(i), results[i]);
    assert.equal(index.indexOfResultId(`r${i}`), i);
  }
});
