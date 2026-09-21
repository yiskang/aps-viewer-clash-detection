// test/clashtest/planning/planTables.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRootTables, readRange, rangeRootCount, rangeFragmentWeight, bisectRanges, TABLE_CLASSES }
  from '../../../clashtest/planning/planTables.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';

const model = (modelKey, aPrime, c, bPrime) => ({ modelKey, classes: { "A'": aPrime, C: c, "B'": bPrime } });
const root = (dbId, owners, frags) => ({ dbId, fragmentCount: frags, ownerDbIds: owners, subtreeDigest: `sha256:${dbId}` });
const roomy = () => createRecordBudget({ maxPlanReferences: 1000, maxLedgerRecords: 3000, maxUnitsPerRun: 10 });

test('table ids are positional and canonical (ascending modelKey, then A&prime;, C, B&prime;)', () => {
  const budget = roomy();
  const { tables, tableById } = buildRootTables({ models: [
    model('zz', [root(1, [1], 1)], [], []),
    model('aa', [], [root(4, [4], 2)], [root(9, [9], 3)]),
  ], budget });
  assert.deepEqual(tables.map(t => [t.id, t.modelKey, t.cls]), [
    ['t0', 'aa', 'C'], ['t1', 'aa', "B'"], ['t2', 'zz', "A'"],
  ]);
  assert.equal(tableById.get('t2').rows[0].dbId, 1);
  assert.deepEqual([...TABLE_CLASSES], ["A'", 'C', "B'"]);
});

test('the build is a pure function of the input set: model order does not change ids or contents', () => {
  const ms = [
    model('b', [root(1, [1], 1)], [root(5, [5, 6], 2)], []),
    model('a', [root(2, [2], 1)], [], [root(3, [3], 4)]),
    model('c', [], [], [root(7, [7], 1)]),
  ];
  const one = buildRootTables({ models: ms, budget: roomy() });
  const two = buildRootTables({ models: [...ms].reverse(), budget: roomy() });
  assert.deepEqual(one.tables, two.tables);
  assert.deepEqual([...one.ownersByModel], [...two.ownersByModel]);
  assert.deepEqual([...one.ownerRootByModel].map(([k, m]) => [k, [...m]]), [...two.ownerRootByModel].map(([k, m]) => [k, [...m]]));
  assert.deepEqual([...one.ownersByModel.keys()], ['a', 'b', 'c']);   // canonical order, not input order
});

test('rows carry the D1 shape and the per-model owner array is the roots\' owners concatenated in root order', () => {
  const out = buildRootTables({ models: [
    model('m', [root(1, [10, 11], 2), root(3, [30], 1)], [root(2, [20, 21, 22], 3)], []),
  ], budget: roomy() });
  assert.deepEqual(out.tables[0].rows, [
    { dbId: 1, fragmentCount: 2, subtreeDigest: 'sha256:1', ownerStart: 0, ownerEnd: 2 },
    { dbId: 3, fragmentCount: 1, subtreeDigest: 'sha256:3', ownerStart: 2, ownerEnd: 3 },
  ]);
  assert.deepEqual(out.tables[1].rows, [
    { dbId: 2, fragmentCount: 3, subtreeDigest: 'sha256:2', ownerStart: 3, ownerEnd: 6 },
  ]);
  assert.deepEqual([...out.ownersByModel.get('m')], [10, 11, 30, 20, 21, 22]);
  assert.deepEqual([...out.ownerRootByModel.get('m')], [[10, 1], [11, 1], [30, 3], [20, 2], [21, 2], [22, 2]]);
});

test('a model with no roots still gets (empty) owner lookups, and contributes no table', () => {
  const out = buildRootTables({ models: [model('e', [], [], [])], budget: roomy() });
  assert.equal(out.ok, true);
  assert.deepEqual(out.tables, []);
  assert.deepEqual([...out.ownersByModel.get('e')], []);
  assert.equal(out.ownerRootByModel.get('e').size, 0);
});

test('the built tables are immutable (tables, rows and owner arrays are deep-frozen)', () => {
  const out = buildRootTables({ models: [model('m', [root(1, [1], 1)], [], [])], budget: roomy() });
  assert.equal(Object.isFrozen(out.tables), true);
  assert.equal(Object.isFrozen(out.tables[0]), true);
  assert.equal(Object.isFrozen(out.tables[0].rows), true);
  assert.equal(Object.isFrozen(out.tables[0].rows[0]), true);
  assert.equal(Object.isFrozen(out.ownersByModel.get('m')), true);
});

test('the build does not alias caller data: mutating the input afterwards changes nothing', () => {
  const owners = [1, 2];
  const input = model('m', [root(1, owners, 1)], [], []);
  const out = buildRootTables({ models: [input], budget: roomy() });
  owners.push(99); input.classes["A'"][0].dbId = 77;
  assert.deepEqual([...out.ownersByModel.get('m')], [1, 2]);
  assert.equal(out.tables[0].rows[0].dbId, 1);
});

test('ranges are half-open and read back the exact root dbIds and weights', () => {
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 5), root(3, [3], 7), root(8, [8], 2)], [], [])], budget: roomy() });
  const r = { table: 't0', start: 0, end: 3 };
  assert.deepEqual(readRange(plan, r), [1, 3, 8]);
  assert.equal(rangeRootCount(r), 3);
  assert.equal(rangeFragmentWeight(plan, r), 14);
  assert.deepEqual(readRange(plan, { table: 't0', start: 1, end: 2 }), [3]);
  assert.deepEqual(readRange(plan, { table: 't0', start: 1, end: 1 }), []);
  assert.equal(rangeFragmentWeight(plan, { table: 't0', start: 1, end: 3 }), 9);
});

test('a range that does not name a real slice of a real table is refused, never read out of bounds', () => {
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 1), root(3, [3], 1)], [], [])], budget: roomy() });
  for (const bad of [
    { table: 't9', start: 0, end: 1 }, { table: 't0', start: 0, end: 3 }, { table: 't0', start: -1, end: 1 },
    { table: 't0', start: 2, end: 1 }, { table: 't0', start: 0.5, end: 1 }, { table: 't0', start: 0, end: Number.NaN },
  ]) {
    assert.throws(() => readRange(plan, bad), RangeError, JSON.stringify(bad));
    assert.throws(() => rangeFragmentWeight(plan, bad), RangeError, JSON.stringify(bad));
  }
});

test('bisectRanges splits the ordered root sequence in half and never splits a root', () => {
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 1), root(2, [2], 1), root(3, [3], 1)], [], [])], budget: roomy() });
  const [l, r] = bisectRanges(plan, [{ table: 't0', start: 0, end: 3 }]);
  assert.deepEqual(readRange(plan, l[0]), [1]);
  assert.deepEqual(r.flatMap(x => readRange(plan, x)), [2, 3]);
  const [l2, r2] = bisectRanges(plan, [{ table: 't0', start: 0, end: 1 }, { table: 't0', start: 2, end: 3 }]);
  assert.deepEqual(l2.flatMap(x => readRange(plan, x)), [1]);
  assert.deepEqual(r2.flatMap(x => readRange(plan, x)), [3]);
});

test('bisectRanges edge cases: one root is not split (left is the lighter half), empties are dropped', () => {
  const plan = buildRootTables({ models: [model('m', [root(1, [1], 1), root(2, [2], 1)], [], [])], budget: roomy() });
  const [l, r] = bisectRanges(plan, [{ table: 't0', start: 0, end: 1 }]);
  assert.deepEqual([l, r], [[], [{ table: 't0', start: 0, end: 1 }]]);
  const [l0, r0] = bisectRanges(plan, []);
  assert.deepEqual([l0, r0], [[], []]);
  const [l1, r1] = bisectRanges(plan, [{ table: 't0', start: 1, end: 1 }, { table: 't0', start: 0, end: 2 }]);
  assert.deepEqual([l1.flatMap(x => readRange(plan, x)), r1.flatMap(x => readRange(plan, x))], [[1], [2]]);
  assert.ok([...l1, ...r1].every(x => rangeRootCount(x) > 0));
});

test('bisectRanges is an exact weight partition for random range lists (seeded): order kept, sizes floor/ceil, no root split', () => {
  let s = 12345;
  const rnd = (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
  const rows = Array.from({ length: 40 }, (_, i) => root(i + 1, [i + 1], 1 + rnd(9)));
  const plan = buildRootTables({ models: [model('m', rows.slice(0, 25), rows.slice(25, 33), rows.slice(33))], budget: roomy() });
  assert.equal(plan.tables.length, 3);
  for (let iter = 0; iter < 200; iter++) {
    const ranges = [];
    for (const t of plan.tables) {
      if (rnd(3) === 0) continue;
      const a = rnd(t.rows.length + 1), b = rnd(t.rows.length + 1);
      if (a !== b) ranges.push({ table: t.id, start: Math.min(a, b), end: Math.max(a, b) });
    }
    const all = ranges.flatMap(r => readRange(plan, r));
    const [l, r] = bisectRanges(plan, ranges);
    const left = l.flatMap(x => readRange(plan, x)), right = r.flatMap(x => readRange(plan, x));
    assert.deepEqual([...left, ...right], all, 'left ++ right is the input sequence, in order, with no root lost or repeated');
    assert.equal(left.length, Math.floor(all.length / 2));
    assert.equal(right.length, all.length - left.length);
    const w = (xs) => xs.reduce((n, x) => n + rangeFragmentWeight(plan, x), 0);
    assert.equal(w(l) + w(r), w(ranges), 'the two children partition the parent weight exactly');
    for (const x of [...l, ...r]) assert.ok(x.start < x.end && Number.isInteger(x.start) && Number.isInteger(x.end));
  }
});

test('building tables charges the budget per root row and per owner entry', () => {
  const budget = createRecordBudget({ maxPlanReferences: 4, maxLedgerRecords: 100, maxUnitsPerRun: 1 });
  const out = buildRootTables({ models: [model('m', [root(1, [1, 2], 2), root(3, [3], 1)], [], [])], budget });
  assert.equal(out.ok, false);          // 2 rows + 3 owners = 5 > 4
  assert.equal(out.overflowClass, 'root-owner');
  assert.equal(budget.planRecords, 0);  // all-or-nothing: the refused block leaves no ghost accounting (Codex P3 review)
});

test('a fitting build charges exactly rows + owners, across every model and class', () => {
  const budget = roomy();
  const out = buildRootTables({ models: [
    model('a', [root(1, [1, 2], 1)], [root(5, [5], 1)], []),
    model('b', [], [], [root(1, [1], 1), root(2, [2, 3, 4], 1)]),   // the same dbIds in another model are fine
  ], budget });
  assert.equal(out.ok, true);
  assert.equal(budget.planRecords, (1 + 1 + 2) + (2 + 1 + 1 + 3));
});

test('the row block is refused (and charges nothing) when the rows alone overflow', () => {
  const budget = createRecordBudget({ maxPlanReferences: 1, maxLedgerRecords: 100, maxUnitsPerRun: 1 });
  const out = buildRootTables({ models: [model('m', [root(1, [1], 1), root(2, [2], 1)], [], [])], budget });
  assert.equal(out.ok, false);
  assert.equal(out.overflowClass, 'root-table');
  assert.equal(out.cause, 'plan-too-large');
  assert.equal(budget.planRecords, 0);
});

test('a duplicate owner across two roots is an enumerator defect', () => {
  const out = buildRootTables({ models: [model('m', [root(1, [5], 1), root(2, [5], 1)], [], [])], budget: roomy() });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'enumeration-failed');
});

test('a duplicate owner across two CLASSES of one model is an enumerator defect too', () => {
  const out = buildRootTables({ models: [model('m', [root(1, [5], 1)], [], [root(2, [5, 6], 1)])], budget: roomy() });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'enumeration-failed');
});

test('a root listed twice, or rows out of ascending order, are enumerator defects', () => {
  assert.equal(buildRootTables({ models: [model('m', [root(2, [1], 1), root(1, [2], 1)], [], [])], budget: roomy() }).cause,
    'enumeration-failed');
  assert.equal(buildRootTables({ models: [model('m', [root(1, [1], 1), root(1, [2], 1)], [], [])], budget: roomy() }).cause,
    'enumeration-failed');
  assert.equal(buildRootTables({ models: [model('m', [root(1, [2, 1], 1)], [], [])], budget: roomy() }).cause,
    'enumeration-failed');
});

test('a root with no fragments or no owners is phantom pair space, an enumerator defect', () => {
  for (const bad of [root(1, [1], 0), root(1, [], 3)]) {
    const out = buildRootTables({ models: [model('m', [bad], [], [])], budget: roomy() });
    assert.equal(out.ok, false);
    assert.equal(out.cause, 'enumeration-failed');
  }
});

test('programming errors (not data defects) throw: repeated modelKey, unknown class key', () => {
  assert.throws(() => buildRootTables({ models: [model('m', [], [], []), model('m', [], [], [])], budget: roomy() }), TypeError);
  assert.throws(() => buildRootTables({ models: [{ modelKey: 'm', classes: { A: [] } }], budget: roomy() }), TypeError);
});

test('rangeOfClass is the full half-open range of one (model, class) table, null when the class is empty (P3.6)', () => {
  const plan = buildRootTables({ models: [
    model('b', [], [root(4, [4], 1), root(6, [6], 1)], [root(9, [9], 1)]),
    model('a', [root(1, [1], 1)], [], []),
  ], budget: roomy() });
  assert.deepEqual(plan.rangeOfClass('b', 'C'), { table: 't1', start: 0, end: 2 });
  assert.deepEqual(plan.rangeOfClass('b', "B'"), { table: 't2', start: 0, end: 1 });
  assert.deepEqual(plan.rangeOfClass('a', "A'"), { table: 't0', start: 0, end: 1 });
  assert.equal(plan.rangeOfClass('a', 'C'), null);
  assert.equal(plan.rangeOfClass('b', "A'"), null);
  assert.deepEqual(readRange(plan, plan.rangeOfClass('b', 'C')), [4, 6]);
  // A fresh plain object each call: a caller can never alias (or corrupt) the plan's own range.
  assert.notEqual(plan.rangeOfClass('b', 'C'), plan.rangeOfClass('b', 'C'));
  // Asking about a model the plan does not hold, or a class that does not exist, is a caller bug, not "empty".
  assert.throws(() => plan.rangeOfClass('zz', 'C'), RangeError);
  assert.throws(() => plan.rangeOfClass('a', 'X'), TypeError);
});
