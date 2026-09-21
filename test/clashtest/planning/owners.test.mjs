// test/clashtest/planning/owners.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_CLASS, classifyOwners, ownerClassOf, rootOfOwner } from '../../../clashtest/planning/owners.js';
import { buildRootTables } from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

test('owners partition into root-only, unreachable-only and mixed (AC-17 (a))', () => {
  const { mixedOwnerDbIds, unreachableOnlyDbIds } =
    classifyOwners({ rootOwnerDbIds: [200, 900], unreachableOwnerDbIds: [900, 950] });
  assert.deepEqual(mixedOwnerDbIds, [900]);
  assert.deepEqual(unreachableOnlyDbIds, [950]);
});

test('classification is independent of input order and always ascending', () => {
  const a = classifyOwners({ rootOwnerDbIds: [900, 200], unreachableOwnerDbIds: [950, 900] });
  const b = classifyOwners({ rootOwnerDbIds: [200, 900], unreachableOwnerDbIds: [900, 950] });
  assert.deepEqual(a, b);
  assert.equal(OWNER_CLASS.MIXED, 'mixed');
});

test('classification edge cases: empty sides, full overlap, repeated ids, and inputs are never mutated', () => {
  assert.deepEqual(classifyOwners({ rootOwnerDbIds: [], unreachableOwnerDbIds: [] }),
    { mixedOwnerDbIds: [], unreachableOnlyDbIds: [] });
  assert.deepEqual(classifyOwners({ rootOwnerDbIds: [1, 2], unreachableOwnerDbIds: [] }),
    { mixedOwnerDbIds: [], unreachableOnlyDbIds: [] });
  assert.deepEqual(classifyOwners({ rootOwnerDbIds: [], unreachableOwnerDbIds: [7, 3] }),
    { mixedOwnerDbIds: [], unreachableOnlyDbIds: [3, 7] });
  assert.deepEqual(classifyOwners({ rootOwnerDbIds: [5, 1, 3], unreachableOwnerDbIds: [3, 5, 1] }),
    { mixedOwnerDbIds: [1, 3, 5], unreachableOnlyDbIds: [] });
  assert.deepEqual(classifyOwners({ rootOwnerDbIds: [4], unreachableOwnerDbIds: [9, 9, 4, 4] }),
    { mixedOwnerDbIds: [4], unreachableOnlyDbIds: [9] });
  const roots = Object.freeze([9, 1]);
  const unreach = Object.freeze([1, 9]);
  classifyOwners({ rootOwnerDbIds: roots, unreachableOwnerDbIds: unreach });   // frozen inputs: must not sort in place
  assert.deepEqual([...roots], [9, 1]);
});

test('the three classes are named, closed and frozen', () => {
  assert.deepEqual({ ...OWNER_CLASS }, { ROOT_ONLY: 'root-only', UNREACHABLE_ONLY: 'unreachable-only', MIXED: 'mixed' });
  assert.equal(Object.isFrozen(OWNER_CLASS), true);
});

const planWith = (unreachableByModel) => {
  const budget = createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });
  const root = (dbId, ownerDbIds) => ({ dbId, fragmentCount: 1, ownerDbIds, subtreeDigest: `sha256:${dbId}` });
  const tables = buildRootTables({ models: [
    { modelKey: 'm', classes: { "A'": [root(1, [200]), root(2, [900])], C: [], "B'": [] } },
    { modelKey: 'n', classes: { "A'": [], C: [root(5, [500])], "B'": [] } },
  ], budget });
  const models = new Map([
    ['m', { unreachable: unreachableByModel.m ?? null }],
    ['n', { unreachable: unreachableByModel.n ?? null }],
  ]);
  return { ...tables, models };
};

test('ownerClassOf reads the recorded plan data: root-only, unreachable-only, mixed, unknown', () => {
  const plan = planWith({ m: { ownerDbIds: [900, 950], mixedOwnerDbIds: [900] } });
  assert.equal(ownerClassOf(plan, 'm', 200), OWNER_CLASS.ROOT_ONLY);
  assert.equal(ownerClassOf(plan, 'm', 900), OWNER_CLASS.MIXED);
  assert.equal(ownerClassOf(plan, 'm', 950), OWNER_CLASS.UNREACHABLE_ONLY);
  assert.equal(ownerClassOf(plan, 'm', 12345), 'unknown');
  assert.equal(ownerClassOf(plan, 'nope', 200), 'unknown');   // an unrecorded model has no legal owners
});

test('ownerClassOf is per model: the same dbId in another model is a different owner', () => {
  const plan = planWith({ m: { ownerDbIds: [900, 950], mixedOwnerDbIds: [900] } });
  assert.equal(ownerClassOf(plan, 'n', 900), 'unknown');
  assert.equal(ownerClassOf(plan, 'n', 500), OWNER_CLASS.ROOT_ONLY);
  assert.equal(ownerClassOf(plan, 'n', 950), 'unknown');
});

test('ownerClassOf does not depend on the recorded unreachable list being sorted, and accepts a null/absent row', () => {
  const plan = planWith({ m: { ownerDbIds: [950, 900], mixedOwnerDbIds: [900] } });
  assert.equal(ownerClassOf(plan, 'm', 900), OWNER_CLASS.MIXED);
  assert.equal(ownerClassOf(plan, 'm', 950), OWNER_CLASS.UNREACHABLE_ONLY);
  const none = planWith({});
  assert.equal(ownerClassOf(none, 'm', 200), OWNER_CLASS.ROOT_ONLY);
  assert.equal(ownerClassOf({ ...none, models: new Map() }, 'm', 200), OWNER_CLASS.ROOT_ONLY);   // roots alone suffice
});

test('ownerClassOf accepts a plain-object models table (modelsByKey) without prototype leakage', () => {
  const base = planWith({});
  const plan = { ...base, models: { m: { unreachable: { ownerDbIds: [950] } } } };
  assert.equal(ownerClassOf(plan, 'm', 950), OWNER_CLASS.UNREACHABLE_ONLY);
  assert.equal(ownerClassOf(plan, 'toString', 950), 'unknown');
  assert.equal(ownerClassOf(plan, '__proto__', 950), 'unknown');
});

test('rootOfOwner is the recorded owner -> root map (spec 5.6.4), null for anything unrecorded', () => {
  const plan = planWith({ m: { ownerDbIds: [900, 950], mixedOwnerDbIds: [900] } });
  assert.equal(rootOfOwner(plan, 'm', 200), 1);
  assert.equal(rootOfOwner(plan, 'm', 900), 2);
  assert.equal(rootOfOwner(plan, 'm', 950), null);     // unreachable-only: no root
  assert.equal(rootOfOwner(plan, 'n', 500), 5);
  assert.equal(rootOfOwner(plan, 'n', 200), null);
  assert.equal(rootOfOwner(plan, 'nope', 200), null);
});
