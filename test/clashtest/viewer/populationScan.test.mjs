// test/clashtest/viewer/populationScan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPopulation } from '../../../clashtest/viewer/populationScan.js';
import { rootedModel, liveCtx } from './support/models.mjs';

const fragListOf = (children, opts) => rootedModel(children, opts).model.getFragmentList();
const scan = (children, opts, ctx = liveCtx().ctx) => scanPopulation(fragListOf(children, opts), ctx, { loadEpoch: 1 });

test('classes: loaded L(owner, geometryId), not-loaded N, owner-unresolvable U (undefined and array)', async () => {
  const { count, records } = await scan(
    [{ dbId: 10, fragments: [0, 1, 2, 3] }],
    { notLoadedFragIds: [1], ownerDbIdOverrides: new Map([[2, undefined], [3, [10, 11]]]), fragmentCount: 5 });
  assert.equal(count, 5);
  assert.deepEqual(records[0], { fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 0 });
  assert.deepEqual(records[1], { fragId: 1, cls: 'N' });
  assert.deepEqual(records[2], { fragId: 2, cls: 'U' });
  assert.deepEqual(records[3], { fragId: 3, cls: 'U' });
  assert.deepEqual(records[4], { fragId: 4, cls: 'U' });          // in range, claimed by nothing
  assert.equal(records.length, 5);
});

test('not-loaded wins over any owner (checked before the owner lookup, as the library does)', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }], { notLoadedFragIds: [0] });
  await scanPopulation(model.getFragmentList(), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(stats.getDbIdsCalls, 0);   // the mock counts getDbIds calls; an N fragment's owner is never read
});

test('a non-number, non-undefined, non-array owner fails closed', async () => {
  await assert.rejects(scan([{ dbId: 10, fragments: [0] }], { ownerDbIdOverrides: new Map([[0, null]]) }),
    (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'owner-not-a-number');
});

test('population above maxCollisionInstancesPerEpoch (20,000) is refused before any fragment is read', async () => {
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0] }], { fragmentCount: 20_001 });
  await assert.rejects(scanPopulation(model.getFragmentList(), liveCtx().ctx, { loadEpoch: 9 }),
    (e) => e.name === 'CapacityExceededError');
  assert.equal(stats.isNotLoadedCalls, 0);
  const ok = await scan([{ dbId: 10, fragments: [0] }], { fragmentCount: 20_000 });
  assert.equal(ok.count, 20_000);
});

test('an invalid count is an enumerator defect', async () => {
  const fl = { ...fragListOf([]), getCount: () => -1 };
  await assert.rejects(scanPopulation(fl, liveCtx().ctx, {}), (e) => e.reason === 'fragment-count-invalid');
});

test('checkpoints at least once per 64 fragments', async () => {
  const { ctx, calls } = liveCtx();
  await scan([{ dbId: 10, fragments: [0] }], { fragmentCount: 200 }, ctx);
  assert.ok(calls.n >= 3);
});
