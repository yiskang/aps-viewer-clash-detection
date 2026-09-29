// test/acceptance/g1-svf2-f1-f8-verification.f5limits.test.mjs
//
// Offline regression tests for the bounded F5 remediation after the first live run:
//  (1) F1's maxPerDbIdFragmentCount must come from the extracted records' ownerDbId (it previously
//      counted rows with no ownerDbId, collapsing to the total loaded population -- 789 live);
//  (2) scoreF5 must compare observed values with the EXISTING constants (collision/constants.js);
//  (3) missing/blocked/malformed F4 (or F1/F2) evidence must fail closed, never become numeric 0.
// NEVER launches a browser, imports playwright, or executes main().

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  maxCollisionInstancesPerEpoch, maxFragmentsPerDbId, maxChildrenPerNode, maxSyncTriangleCount,
} from '../../collision/constants.js';
import { CHECK_VERDICT, IN_PAGE_FUNCTION_REGISTRY, observeF1, scoreF5 } from './g1-svf2-f1-f8-verification.mjs';

function createPageRealm(w) {
  const context = vm.createContext({ window: w, performance, setTimeout, clearTimeout, console });
  for (const [name, fn] of Object.entries(IN_PAGE_FUNCTION_REGISTRY)) vm.runInContext(`globalThis.${name} = (${fn.toString()})`, context);
  return { call: (fn, ...a) => vm.runInContext(fn.name, context)(...a) };
}

// owners[i] = ownerDbId of fragment i (all loaded). null -> record without a usable owner.
async function runF1(owners) {
  const records = new Map(owners.map((o, i) => [i, { fragmentId: i, ownerDbId: o, geometryIdentity: { loadEpoch: 0, geometryIndex: i } }]));
  const model = { getFragmentList: () => ({ getCount: () => owners.length }) };
  const enumerator = { resolveRoots: async () => ({ roots: [], ownerMismatch: { count: 0 }, unreachable: { count: 0 }, population: { count: owners.length, digest: 'd' } }) };
  const session = { binding: { model }, model, enumerator, artifacts: { f1FragmentMapsByRoot: new Map() } };
  const mod = {
    '/collision/viewer/ViewerModelAdapter.js': { extractFragments: async () => new Map(), extractAllFragments: async () => ({ records, diagnostics: [] }) },
    '/clashtest/planning/scopeDigest.js': { digestSubtree: async () => ({ digest: 'd' }), digestPopulation: async () => ({ digest: 'd' }) },
  };
  const realm = createPageRealm({ __g1: { sessions: { s1: session }, mod }, __viewer: {} });
  return realm.call(observeF1, 's1');
}

test('per-dbId max: uneven counts across several dbIds -> the true maximum and the responsible dbId', async () => {
  const r = await runF1([10, 10, 10, 20, 7, 7]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, 3);
  assert.equal(r.fields.maxPerDbIdOwnerDbId, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(r.fields.perDbIdEvidence.topOwners)), [{ dbId: 10, count: 3 }, { dbId: 7, count: 2 }, { dbId: 20, count: 1 }]);
  assert.equal(r.fields.perDbIdEvidence.distinctOwnerCount, 3);
  assert.equal(r.fields.perDbIdEvidence.loadedRecordCount, 6);
});

test('per-dbId max: total loaded count much larger than the true per-dbId max is NOT reported as the max', async () => {
  const owners = [];
  for (let d = 0; d < 300; d += 1) owners.push(d, d); // 300 owners x 2 fragments = 600 loaded
  owners.push(5);                                      // dbId 5 now has 3
  const r = await runF1(owners);
  assert.equal(r.fields.populationCount, 601);
  assert.equal(r.fields.maxPerDbIdFragmentCount, 3, 'must not collapse to the loaded total (the live-run defect)');
  assert.equal(r.fields.maxPerDbIdOwnerDbId, 5);
});

test('per-dbId max: sparse / non-contiguous dbIds, including 0', async () => {
  const r = await runF1([0, 1000000, 77, 1000000, 0, 1000000]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, 3);
  assert.equal(r.fields.maxPerDbIdOwnerDbId, 1000000);
});

test('per-dbId max: single dbId owns everything', async () => {
  const r = await runF1([42, 42, 42, 42]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, 4);
  assert.equal(r.fields.maxPerDbIdOwnerDbId, 42);
});

test('per-dbId max: ties resolve to the smallest dbId (deterministic)', async () => {
  const r = await runF1([9, 9, 3, 3]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, 2);
  assert.equal(r.fields.maxPerDbIdOwnerDbId, 3);
});

test('per-dbId max: no records -> null (fail closed), never 0', async () => {
  const r = await runF1([]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, null);
  assert.equal(r.fields.maxPerDbIdOwnerDbId, null);
  assert.equal(r.fields.perDbIdEvidence.state, 'NO_RECORDS');
});

test('per-dbId max: a record lacking a usable ownerDbId makes the value unavailable (null), never undercounted', async () => {
  const r = await runF1([10, 10, undefined, 10]);
  assert.equal(r.fields.maxPerDbIdFragmentCount, null);
  assert.equal(r.fields.perDbIdEvidence.state, 'RECORD_WITHOUT_OWNER');
  assert.equal(r.fields.perDbIdEvidence.recordsWithoutOwner, 1);
});

// ---- scoreF5 --------------------------------------------------------------------------------

const f1ok = (over = {}) => ({ ok: true, fields: { maxRootFragmentCount: 5, maxRootDbId: 10, sumRootFragmentCount: 20, maxPerDbIdFragmentCount: 3, maxPerDbIdOwnerDbId: 10, populationCount: 20, ...over } });
const f2ok = (over = {}) => ({ accountingBalanced: true, maxChildrenPerNode: 4, ...over });
const f4ok = (over = {}) => ({ maxActiveTriangleCount: 100, oversizedGeometryCount: 0, ...over });
const score = (o = {}) => scoreF5({ f1Result: f1ok(), f2Fields: f2ok(), f4Fields: f4ok(), ...o });
const check = (res, name) => res.fields.limitChecks.find((c) => c.name === name);

test('scoreF5: all observed values within existing limits -> PASS, with observed/limit/result recorded for every check', () => {
  const r = score();
  assert.equal(r.verdict, CHECK_VERDICT.PASS);
  assert.deepEqual(r.fields.limitChecks.map((c) => c.name).sort(),
    ['maxChildrenPerNode', 'maxCollisionInstancesPerEpoch', 'maxFragmentsPerDbId', 'maxFragmentsPerRoot', 'maxSyncTriangleCount']);
  assert.deepEqual({ ...check(r, 'maxFragmentsPerDbId') }, { name: 'maxFragmentsPerDbId', observed: 3, limit: maxFragmentsPerDbId, withinLimit: true, responsibleDbId: 10 });
});

test('scoreF5: values exactly AT a limit pass (limits are enforced with strict >)', () => {
  const r = score({
    f1Result: f1ok({ populationCount: maxCollisionInstancesPerEpoch, maxPerDbIdFragmentCount: maxFragmentsPerDbId, maxRootFragmentCount: maxFragmentsPerDbId }),
    f2Fields: f2ok({ maxChildrenPerNode }), f4Fields: f4ok({ maxActiveTriangleCount: maxSyncTriangleCount }),
  });
  assert.equal(r.verdict, CHECK_VERDICT.PASS);
});

for (const [name, mk, dbId] of [
  ['maxCollisionInstancesPerEpoch', () => ({ f1Result: f1ok({ populationCount: maxCollisionInstancesPerEpoch + 1 }) }), null],
  ['maxFragmentsPerDbId', () => ({ f1Result: f1ok({ maxPerDbIdFragmentCount: maxFragmentsPerDbId + 1, maxPerDbIdOwnerDbId: 77 }) }), 77],
  ['maxFragmentsPerRoot', () => ({ f1Result: f1ok({ maxRootFragmentCount: maxFragmentsPerDbId + 1, maxRootDbId: 55 }) }), 55],
  ['maxChildrenPerNode', () => ({ f2Fields: f2ok({ maxChildrenPerNode: maxChildrenPerNode + 1 }) }), null],
  ['maxSyncTriangleCount', () => ({ f4Fields: f4ok({ maxActiveTriangleCount: maxSyncTriangleCount + 1 }) }), null],
]) {
  test(`scoreF5: ${name} exceeded (even with oversizedGeometryCount 0) -> FAIL, never PASS, evidence names observed/limit/dbId`, () => {
    const r = score(mk());
    assert.equal(r.verdict, CHECK_VERDICT.FAIL);
    assert.equal(r.reason, 'existing-limit-exceeded');
    assert.equal(r.fields.withinLimits, false);
    const c = check(r, name);
    assert.equal(c.withinLimit, false);
    assert.equal(c.responsibleDbId, dbId);
    assert.ok(c.observed > c.limit);
  });
}

test('scoreF5: F4 missing / blocked / malformed -> BLOCKED f4-evidence-unavailable, never PASS, never numeric 0', () => {
  for (const f4Fields of [undefined, null, {}, { oversizedGeometryCount: 0 }, { maxActiveTriangleCount: 100 },
    { maxActiveTriangleCount: 'x', oversizedGeometryCount: 0 }, { maxActiveTriangleCount: -1, oversizedGeometryCount: 0 },
    { maxActiveTriangleCount: NaN, oversizedGeometryCount: 0 }, { maxActiveTriangleCount: 100, oversizedGeometryCount: null }]) {
    const r = score({ f4Fields });
    assert.equal(r.verdict, CHECK_VERDICT.BLOCKED, JSON.stringify(f4Fields));
    assert.equal(r.reason, 'f4-evidence-unavailable');
    // A missing/invalid F4 value is reported as null, never synthesized as 0 (a valid partial value is kept as-is).
    const src = f4Fields || {};
    assert.equal(r.fields.oversizedGeometryCount, Number.isInteger(src.oversizedGeometryCount) && src.oversizedGeometryCount >= 0 ? src.oversizedGeometryCount : null);
    assert.equal(r.fields.maxActiveTriangleCount, Number.isInteger(src.maxActiveTriangleCount) && src.maxActiveTriangleCount >= 0 ? src.maxActiveTriangleCount : null);
  }
});

test('scoreF5: valid F4 evidence (including oversizedGeometryCount > 0) is honored', () => {
  assert.equal(score({ f4Fields: f4ok({ oversizedGeometryCount: 0 }) }).verdict, CHECK_VERDICT.PASS);
  const r = score({ f4Fields: f4ok({ oversizedGeometryCount: 2 }) });
  assert.equal(r.verdict, CHECK_VERDICT.FAIL);
  assert.equal(r.reason, 'oversized-geometry-present');
});

test('scoreF5: F1 per-dbId / population / root values unavailable, or F2 child fan-out unavailable -> BLOCKED (fail closed)', () => {
  for (const over of [{ maxPerDbIdFragmentCount: null }, { maxPerDbIdFragmentCount: undefined }, { populationCount: null }, { maxRootFragmentCount: 'x' }]) {
    const r = score({ f1Result: f1ok(over) });
    assert.equal(r.verdict, CHECK_VERDICT.BLOCKED, JSON.stringify(over));
    assert.equal(r.reason, 'f1-evidence-unavailable');
  }
  const r2 = score({ f2Fields: f2ok({ maxChildrenPerNode: undefined }) });
  assert.equal(r2.verdict, CHECK_VERDICT.BLOCKED);
  assert.equal(r2.reason, 'f2-evidence-unavailable');
});

test('scoreF5: not-fully-enumerated (F2 unbalanced) still FAILs with its existing reason', () => {
  const r = score({ f2Fields: { accountingBalanced: false, maxChildrenPerNode: 0 } });
  assert.equal(r.verdict, CHECK_VERDICT.FAIL);
  assert.equal(r.reason, 'not-fully-enumerated');
});

test('scoreF5: F2 observation absent/failed (null) or malformed -> BLOCKED f2-evidence-unavailable, not a limit FAIL', () => {
  for (const f2Fields of [null, undefined, {}, { accountingBalanced: 'yes' }]) {
    const r = score({ f2Fields });
    assert.equal(r.verdict, CHECK_VERDICT.BLOCKED, JSON.stringify(f2Fields));
    assert.equal(r.reason, 'f2-evidence-unavailable');
  }
});

test('scoreF5: an oversized geometry that also exceeds maxSyncTriangleCount keeps the specific oversized-geometry-present reason', () => {
  const r = score({ f4Fields: f4ok({ maxActiveTriangleCount: maxSyncTriangleCount + 1, oversizedGeometryCount: 1 }) });
  assert.equal(r.verdict, CHECK_VERDICT.FAIL);
  assert.equal(r.reason, 'oversized-geometry-present');
});
