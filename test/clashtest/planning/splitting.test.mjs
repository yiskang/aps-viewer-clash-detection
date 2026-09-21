// test/clashtest/planning/splitting.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSplit, cutUnit, splitUnit, SPLIT_REFUSAL_REASONS } from '../../../clashtest/planning/splitting.js';
import { readRange } from '../../../clashtest/planning/planTables.js';
import { RUN_OPTION_DEFAULTS } from '../../../clashtest/options.js';
import { makeSplitFixture } from '../support/syntheticModels.mjs';

// The dbIds a unit stands for, read through the plan's tables (units carry ranges, never dbId arrays).
const sourceIds = (plan, u) => u.sourceRanges.flatMap((r) => readRange(plan, r));
const targetIds = (plan, u) => u.targets.flatMap((t) => (t.scope === 'whole' ? ['whole'] : t.scope.ranges.flatMap((r) => readRange(plan, r))));

test('split order step 1: > 1 source root bisects the sources', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'y', roots: [9] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => c.unitId), [`${unit.unitId}.0`, `${unit.unitId}.1`]);
  assert.deepEqual(children.map((c) => sourceIds(plan, c)), [[1, 2], [3, 4]]);
  assert.deepEqual(children.map((c) => targetIds(plan, c)), [[9], [9]]);       // the target side is untouched
  assert.equal(children[0].pairSpaceWeight + children[1].pairSpaceWeight, unit.pairSpaceWeight);
});

test('split order step 1 wins even when the unit also has many target entries', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [1] }, { modelKey: 'b', roots: [2] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => sourceIds(plan, c)), [[1], [2]]);
  assert.deepEqual(children.map((c) => c.targets.map((t) => t.modelKey)), [['a', 'b'], ['a', 'b']]);
});

test('an odd source count sends the middle root to the RIGHT child (floor bisection), exactly partitioning', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2, 3], targets: [{ modelKey: 'y', roots: [9] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => sourceIds(plan, c)), [[1], [2, 3]]);
  assert.deepEqual(children.map((c) => c.pairSpaceWeight), [1, 2]);
});

test('split order step 2: one source root, many target models partitions the ENTRIES by modelKey', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1],
    targets: [{ modelKey: 'a', roots: [1, 2] }, { modelKey: 'b', roots: [3] }, { modelKey: 'c', roots: [4] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => c.targets.map((t) => t.modelKey)), [['a'], ['b', 'c']]);
  assert.deepEqual(children.map((c) => c.pairSpaceWeight), [2, 2]);
  assert.equal(children[0].pairSpaceWeight + children[1].pairSpaceWeight, unit.pairSpaceWeight);
  assert.deepEqual(children.map((c) => sourceIds(plan, c)), [[1], [1]]);       // both children keep the single source root
});

test('step 2 keeps a whole-model entry whole: it goes to exactly one child, untouched', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', whole: true, weight: 6 }, { modelKey: 'b', roots: [3, 4] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => c.targets), [[{ modelKey: 'a', scope: 'whole' }], unit.targets.slice(1)]);
  assert.deepEqual(children.map((c) => c.targetWeight), [6, 2]);
});

test('split order step 3: one source root, one explicit target entry bisects that root list', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [1, 2, 3] }] });
  const { children } = planSplit(plan, unit);
  assert.deepEqual(children.map((c) => targetIds(plan, c)), [[1], [2, 3]]);
  assert.deepEqual(children.map((c) => c.targetWeight), [1, 2]);
  assert.deepEqual(children.map((c) => c.targets.map((t) => t.modelKey)), [['a'], ['a']]);
  assert.equal(children[0].pairSpaceWeight + children[1].pairSpaceWeight, unit.pairSpaceWeight);
});

test('split order step 4: unsplittable units are gaps, never partial splits', () => {
  for (const targets of [[{ modelKey: 'a', roots: [1] }], [{ modelKey: 'a', whole: true }]]) {
    const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1], targets });
    const before = JSON.stringify(ledger.toLedgerRecord());
    assert.deepEqual(planSplit(plan, unit), { reason: 'unsplittable' });
    assert.equal(cutUnit(plan, unit), null);
    assert.equal(JSON.stringify(ledger.toLedgerRecord()), before);
  }
});

test('a whole-model sentinel is never partitioned, however many roots it stands for (step 4, not step 3)', () => {
  const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', whole: true, roots: [1, 2, 3] }] });
  assert.equal(unit.pairSpaceWeight, 3);
  assert.deepEqual(planSplit(plan, unit), { reason: 'unsplittable' });
  assert.equal(ledger.unitRecordCount, 1);
});

test('the split ORDER is a pure function of the plan: same inputs, same children', () => {
  const a = makeSplitFixture({ sourceRoots: [1, 2, 3], targets: [{ modelKey: 'a', roots: [1] }] });
  const b = makeSplitFixture({ sourceRoots: [3, 2, 1], targets: [{ modelKey: 'a', roots: [1] }] });
  assert.equal(JSON.stringify(planSplit(a.plan, a.unit).children.map((c) => sourceIds(a.plan, c))),
    JSON.stringify(planSplit(b.plan, b.unit).children.map((c) => sourceIds(b.plan, c))));
  // ... and the whole child records, not just the ids.
  const c = makeSplitFixture({ sourceRoots: [1, 2, 3], targets: [{ modelKey: 'a', roots: [1] }] });
  const d = makeSplitFixture({ sourceRoots: [3, 2, 1], targets: [{ modelKey: 'a', roots: [1] }] });
  assert.equal(JSON.stringify(planSplit(c.plan, c.unit)), JSON.stringify(planSplit(d.plan, d.unit)));
});

test('a child is a full WorkUnit: same keys as its parent, ranges only, never aliasing the parent', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [5, 6] }] });
  const frozen = structuredClone(unit);
  const { children } = planSplit(plan, unit);
  for (const c of children) {
    assert.deepEqual(Object.keys(c).sort(), Object.keys(unit).sort());
    assert.equal(c.cell, unit.cell);
    assert.equal(c.sourceModelKey, unit.sourceModelKey);
    assert.equal(c.orientationRole, unit.orientationRole);
    assert.equal(JSON.stringify(c).includes('dbIds'), false);
  }
  assert.deepEqual(unit, frozen);                                              // the parent is never mutated
  assert.notEqual(children[0].targets, unit.targets);
  assert.notEqual(children[0].targets[0], unit.targets[0]);
});

test('the children\'s weights partition the parent exactly, at every level of a full split tree', () => {
  const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1, 2, 3, 4, 5], targets: [{ modelKey: 'a', roots: [1, 2, 3] }, { modelKey: 'b', roots: [4, 5] }],
    limits: { maxUnitsPerRun: 200, maxLedgerRecords: 1e6 } });
  const leaves = [];
  const walk = (u) => {
    const r = planSplit(plan, u);
    if (r.reason === 'unsplittable') { leaves.push(u); return; }
    assert.equal(r.children[0].pairSpaceWeight + r.children[1].pairSpaceWeight, u.pairSpaceWeight, u.unitId);
    r.children.forEach(walk);
  };
  walk(unit);
  // Splitting to the bottom leaves only one-source-root-vs-one-target-root units, covering each root pair exactly once.
  assert.equal(leaves.length, 5 * 5);
  assert.ok(leaves.every((l) => l.pairSpaceWeight === 1));
  const pairs = leaves.map((l) => `${sourceIds(plan, l)}|${l.targets[0].modelKey}:${targetIds(plan, l)}`);
  assert.equal(new Set(pairs).size, 25);
  const rec = ledger.toLedgerRecord();
  assert.equal(rec.pairSpaceTotal, unit.pairSpaceWeight);                      // Σ leaves never moved
  assert.equal(rec.units.filter((u) => u.kind === 'leaf').length, 25);
});

test('splitUnit is the P6 alias of planSplit', () => {
  assert.equal(splitUnit, planSplit);
});

// ---------------------------------------------------------------------------
// R8: live split ADMISSION. The refusal is always a truthy object and callers
// branch on `.reason` -- `result !== null` would treat every refusal as a
// successful split and hand back two `undefined` children.
// ---------------------------------------------------------------------------

test('the refusal vocabulary is closed and every refusal is truthy with a .reason', () => {
  assert.deepEqual([...SPLIT_REFUSAL_REASONS], ['unsplittable', 'unit-cap', 'ledger-cap']);
  assert.throws(() => { SPLIT_REFUSAL_REASONS.push('x'); }, TypeError);          // frozen
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [1] }] });
  const r = planSplit(plan, unit);
  assert.ok(r);                                   // truthy: `r !== null` proves nothing
  assert.equal('children' in r, false);
  assert.ok(SPLIT_REFUSAL_REASONS.includes(r.reason));
});

test('an admitted split records both children in the live ledger: parent superseded, children leaves, weight moved', () => {
  const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }] });
  const { children } = planSplit(plan, unit);
  const rec = ledger.toLedgerRecord();
  assert.deepEqual(rec.units.map((u) => [u.unitId, u.kind, u.parentUnitId]), [
    ['1.0', 'split', null], ['1.0.0', 'leaf', '1.0'], ['1.0.1', 'leaf', '1.0']]);
  assert.deepEqual(rec.units.slice(1).map((u) => u.sourceRootDbIds), [[1, 2], [3, 4]]);
  assert.deepEqual(rec.units.slice(1).map((u) => u.targets), [[{ modelKey: 'a', scope: 'roots', rootDbIds: [9] }], [{ modelKey: 'a', scope: 'roots', rootDbIds: [9] }]]);
  assert.equal(rec.pairSpaceTotal, unit.pairSpaceWeight);
  assert.deepEqual(rec.units.slice(1).map((u) => u.pairSpaceWeight), children.map((c) => c.pairSpaceWeight));
});

test('a whole-model target child is recorded with the `model` spelling and no rootDbIds', () => {
  const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', whole: true, weight: 3 }, { modelKey: 'b', roots: [7, 8] }] });
  planSplit(plan, unit);
  assert.deepEqual(ledger.unitRecord('1.0.0').targets, [{ modelKey: 'a', scope: 'model' }]);
});

test('the admission charges 2 + the children\'s range records to the live budget, as one block', () => {
  const { plan, unit, budget } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [5, 6] }] });
  const before = budget.discretionaryRemaining;
  planSplit(plan, unit);
  // Each child: 1 source range + 1 target range = 2 range records. Block = 2 + 2 + 2.
  assert.equal(before - budget.discretionaryRemaining, 2 + 2 + 2);
});

test('a nested split is refused unit-cap when the run is one unit record short (children count)', () => {
  // maxUnitsPerRun = 10,000. The ledger starts with 9,997 live unit records (`unit` among them),
  // so the first split fits (9,997 + 2 = 9,999) and the SECOND does not (9,999 + 2 = 10,001).
  const { plan, unit, ledger } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: RUN_OPTION_DEFAULTS.maxUnitsPerRun }, liveUnitRecords: 9_997,
  });
  assert.equal(RUN_OPTION_DEFAULTS.maxUnitsPerRun, 10_000);
  assert.equal(ledger.unitRecordCount, 9_997);
  const first = planSplit(plan, unit);            // 9,997 + 2 = 9,999 <= 10,000: admitted
  assert.deepEqual(first.children.map((c) => c.unitId), [`${unit.unitId}.0`, `${unit.unitId}.1`]);
  assert.equal(ledger.unitRecordCount, 9_999);
  // The CHILD is splittable by the §6.4 order (2 source roots), but the two grandchildren
  // would take the population to 10,001. A nested split must count.
  const nested = planSplit(plan, first.children[0]);
  assert.equal(nested.reason, 'unit-cap');
  assert.equal(nested.capDetail, 'unit-records');
  assert.equal('children' in nested, false);
  assert.equal(ledger.unitRecordCount, 9_999);
});

test('the unit cap is exact at the boundary: 9,998 live records still split (to exactly 10,000), 9,999 does not', () => {
  for (const [live, reason] of [[9_998, undefined], [9_999, 'unit-cap']]) {
    const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [9] }], liveUnitRecords: live });
    const r = planSplit(plan, unit);
    assert.equal(r.reason, reason, `live=${live}`);
    assert.equal(ledger.unitRecordCount, reason === undefined ? 10_000 : live);
  }
});

test('a split that fits the unit cap but not the record budget is refused ledger-cap', () => {
  const { plan, unit } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: 64 }, exhaustLedgerRecords: true,
  });
  const r = planSplit(plan, unit);
  assert.equal(r.reason, 'ledger-cap');
  assert.equal(r.capDetail, 'ledger-records');
  assert.equal('children' in r, false);
});

test('a refused split records NOTHING — admission is atomic in both directions', () => {
  for (const { limits, exhaust, reason } of [
    { limits: { maxUnitsPerRun: 64 }, exhaust: true, reason: 'ledger-cap' },
    { limits: {}, exhaust: false, reason: 'unit-cap', live: 9_999 },
  ]) {
    const { plan, unit, ledger, budget } = makeSplitFixture({
      sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }],
      limits, exhaustLedgerRecords: exhaust, liveUnitRecords: reason === 'unit-cap' ? 9_999 : 1,
    });
    const before = JSON.stringify(ledger.toLedgerRecord());
    const used = budget.used;
    assert.equal(planSplit(plan, unit).reason, reason);
    assert.equal(JSON.stringify(ledger.toLedgerRecord()), before);
    assert.equal(budget.used, used);
  }
});

test('a ledger-cap refusal is the budget\'s FIRST refusal: it names the parent unit (spec 6.5.1)', () => {
  const { plan, unit, ledger } = makeSplitFixture({
    sourceRoots: [1, 2, 3, 4], targets: [{ modelKey: 'a', roots: [9] }], limits: { maxUnitsPerRun: 64 }, exhaustLedgerRecords: 'silent',
  });
  assert.equal(ledger.toLedgerRecord().budgetExhausted, false);
  assert.equal(planSplit(plan, unit).reason, 'ledger-cap');
  assert.equal(ledger.toLedgerRecord().budgetExhausted, true);
  assert.equal(ledger.toLedgerRecord().firstRefusalUnitId, unit.unitId);
});

test('when both caps would refuse, the unit-record cap is the reported one', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [9] }],
    liveUnitRecords: 9_999, exhaustLedgerRecords: true });
  assert.equal(planSplit(plan, unit).reason, 'unit-cap');
});

test('an unsplittable unit is decided before admission: it never touches the budget flags', () => {
  const { plan, unit, ledger } = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [9] }],
    limits: { maxUnitsPerRun: 64 }, exhaustLedgerRecords: 'silent' });
  assert.equal(planSplit(plan, unit).reason, 'unsplittable');
  assert.equal(ledger.toLedgerRecord().budgetExhausted, false);
});

test('planSplit reaches the run\'s ledger only through plan.ledger, and says so when it is missing', () => {
  const { plan, unit } = makeSplitFixture({ sourceRoots: [1, 2], targets: [{ modelKey: 'a', roots: [9] }] });
  const { ledger, ...bare } = plan;
  assert.throws(() => planSplit(bare, unit), TypeError);
  assert.equal(ledger.unitRecordCount, 1);
  // An unsplittable unit needs no ledger at all: the cut is decided first.
  const one = makeSplitFixture({ sourceRoots: [1], targets: [{ modelKey: 'a', roots: [9] }] });
  const { ledger: l2, ...bare2 } = one.plan;
  assert.deepEqual(planSplit(bare2, one.unit), { reason: 'unsplittable' });
});
