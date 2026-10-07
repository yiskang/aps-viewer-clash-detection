// test/clashtest/viewer/populationScan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPopulation } from '../../../clashtest/viewer/populationScan.js';
import { rootedModel, liveCtx } from './support/models.mjs';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';
import { encodePopulationRecords } from '../../../clashtest/planning/scopeDigest.js';

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

// Owner-authorized bounded contract change (2026-10-07): the same null-geometry discriminator as the library's
// extractAllFragments. A not-loaded fragment whose geometry id is INVALID_GEOM_ID (0) keeps digest class 'N' but is
// flagged `nullGeometry: true`; a not-loaded fragment with a real geometry id stays a plain 'N'.
test('null-geometry not-loaded fragment: N + nullGeometry flag; a not-loaded fragment with a real geometry id stays plain N', async () => {
  const { model, stats } = buildMockModel([{ dbId: 1, children: [{ dbId: 10, fragments: [0, 1, 2] }] }],
    new Map([[0, { geometryIndex: 5 }], [1, { geometryIndex: 0 }], [2, { geometryIndex: 3 }], [3, { geometryIndex: 0 }]]),
    { notLoadedFragIds: [1, 2], fragmentCount: 4 });
  const { records } = await scanPopulation(model.getFragmentList(), liveCtx().ctx, { loadEpoch: 1 });
  assert.deepEqual(records[0], { fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 5 });
  assert.deepEqual(records[1], { fragId: 1, cls: 'N', nullGeometry: true });
  assert.deepEqual(records[2], { fragId: 2, cls: 'N' });
  // geometry id 0 but NOT flagged not-loaded (e.g. an OTG fragment record still streaming): never N, unchanged path.
  assert.deepEqual(records[3], { fragId: 3, cls: 'U' });
  assert.equal(stats.getDbIdsCalls, 2, 'the owner of either N class is never read');
});

test('the population digest is byte-identical whether or not an N record carries the nullGeometry flag', async () => {
  const base = [{ fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 5 }, { fragId: 1, cls: 'N' }];
  const flagged = [base[0], { fragId: 1, cls: 'N', nullGeometry: true }];
  assert.deepEqual(encodePopulationRecords(flagged), encodePopulationRecords(base));
});
