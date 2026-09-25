import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger, createStatusReader, buildStatusReaderSteps, getPairStatus, getElementStatus } from '../../../clashtest/results/status.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const pair = (a, b) => ({ first: { modelKey: 'M', dbId: a }, second: { modelKey: 'M', dbId: b } });
const drain = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };

test('D4: the status surface is P5\'s; P8 ships no second copy of the reader or the ledger layout reader', async () => {
  for (const f of [readLedger, createStatusReader, buildStatusReaderSteps, getPairStatus, getElementStatus]) assert.equal(typeof f, 'function');
  await assert.rejects(import('../../../clashtest/derive/status.js'), { code: 'ERR_MODULE_NOT_FOUND' });
  await assert.rejects(import('../../../clashtest/derive/ledgerReader.js'), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('P8 fixtures are a set P5\'s reader answers for; one-shot, indexed and generator forms agree', () => {
  const set = makeResultSet({ units: [U1] });
  const one = getPairStatus(set, pair(100, 200));
  assert.equal(one.verdict, 'covered-clean');
  assert.deepEqual(createStatusReader(set).pairStatus(pair(100, 200)), one);
  assert.deepEqual(drain(buildStatusReaderSteps(set)).pairStatus(pair(100, 200)), one);
  assert.equal(getElementStatus(set, { modelKey: 'M', dbId: 100 }).coverage, 'full');
  assert.equal(getPairStatus(makeResultSet({ units: [{ ...U1, outcome: 'failed', cause: 'unit-cap' }] }), pair(100, 200)).verdict, 'gap');
  const model = drain(readLedger(set));                                         // readLedger is a generator that drains to the LedgerModel ...
  assert.deepEqual(model.leaves.map((u) => u.unitId), ['1.0']);                   // ... whose `leaves` (what summarize reads) are the non-split units
  assert.deepEqual(createStatusReader(set).ledger.leaves.map((u) => u.unitId), ['1.0']);   // and the reader exposes the same model as `reader.ledger`
});

test('OPEN-2: hierarchy-internal element caveats follow the per-root `cls` marker on rootOwners rows, not the bounded examples', () => {
  const roots = Array.from({ length: 25 }, (_, i) => ({ dbId: 1000 + 10 * i, cls: 'C', ownerDbIds: [1000 + 10 * i, 1001 + 10 * i] }));
  const set = makeResultSet({ models: [{ modelKey: 'M', modelVersion: 'v1', roots: [{ dbId: 1, ownerDbIds: [1] }, ...roots] }],
    units: [{ unitId: 'u', source: { modelKey: 'M', roots: [1] }, targets: [{ modelKey: 'M', whole: true }] }] });
  assert.deepEqual(set.ledger.rootOwners[0].owners.slice(0, 2).map((o) => o.cls), ['A', 'C']);    // the marker is on the digested rows
  assert.equal(set.ledger.hierarchyInternal[0].examples.length, 20);                                // the report is bounded ...
  const last = roots[24];                                                                            // ... so this root is NOT among the examples
  assert.ok(!set.ledger.hierarchyInternal[0].examples.some((e) => e.rootDbId === last.dbId));
  assert.ok(getElementStatus(set, { modelKey: 'M', dbId: last.ownerDbIds[1] }).caveats.some((c) => c.reason === 'hierarchy-internal'));
});
