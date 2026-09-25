import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clauseHolds } from '../../../clashtest/derive/filter.js';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { InvalidOptionsError } from '../../../clashtest/errors.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';
import { makeHarness } from './support/harness.mjs';

// [op, value list, operand, expected] — the §14.4 truth rules (existential over the value list; null never satisfies eq/in/ordering)
const T = [
  ['eq', ['a'], 'a', true], ['eq', ['a', 'b'], 'b', true], ['eq', ['a', 'b'], 'c', false], ['eq', [null], null, false], ['eq', [], 'a', false],
  ['eq', [[1, 2, 3]], [1, 2, 3], true], ['eq', [[1, 2, 3]], [1, 2, 4], false],                       // whole-array canonical-JSON equality
  ['in', ['a'], ['a', 'b'], true], ['in', ['c'], ['a', 'b'], false], ['in', [null], [null, 'a'], false], ['in', ['a', 'z'], ['z'], true], ['in', [[0, 0, 0]], [[0, 0, 0]], true],
  ['lt', [1, 5], 2, true], ['lt', [5], 2, false], ['lt', [null], 2, false], ['lt', ['x', 1], 2, true], ['lt', ['x'], 2, false], ['lte', [2], 2, true],
  ['gt', [3, null], 2, true], ['gt', [2], 2, false], ['gte', [2], 2, true], ['gte', [], 0, false],
  ['isNull', [null], undefined, true], ['isNull', [], undefined, true], ['isNull', [null, 'a'], undefined, false], ['isNull', ['a'], undefined, false],
  ['notNull', [null, 'a'], undefined, true], ['notNull', [null], undefined, false], ['notNull', [], undefined, false],
];
for (const [op, values, operand, expected] of T) test(`clauseHolds ${op} ${JSON.stringify(values)} ${JSON.stringify(operand)} => ${expected}`, () => assert.equal(clauseHolds(op, values, operand), expected));

test('isNull and notNull are exact complements over every value list', () => {
  for (const values of [[], [null], [null, null], ['a'], [null, 'a'], [0], [[1, 2, 3]]]) assert.notEqual(clauseHolds('isNull', values), clauseHolds('notNull', values));
});

const models = [{ modelKey: 'A', modelVersion: 'v', roots: [1, 2, 3].map((d) => ({ dbId: d, ownerDbIds: [d] })) }, { modelKey: 'B', modelVersion: 'v', roots: [{ dbId: 1, ownerDbIds: [1] }] }];
const unit = { unitId: 'u', source: { modelKey: 'A', roots: [1, 2, 3] }, targets: [{ modelKey: 'B', whole: true }, { modelKey: 'A', roots: [1, 2, 3] }] };
const clr = (d) => ({ distance: d, clearance: 0.5, closestPoints: { first: [0, 0, 0], second: [d, 0, 0] } });
const set = makeResultSet({ mode: 'clearance', clearance: 0.5, models, units: [unit],
  results: [{ pair: [['A', 1], ['B', 1]], evidence: clr(0.05) }, { pair: [['A', 1], ['A', 2]], evidence: clr(0.15) }, { pair: [['A', 2], ['A', 3]], evidence: clr(0.35) }] });
const ctx = (limits = {}) => createContextInternal({ limits }, {});
// canonical order of `set.results`: 0=(A1,A2) d0.15, 1=(A1,B1) d0.05, 2=(A2,A3) d0.35
const ids = (...i) => i.map((k) => set.results[k].resultId);

test('filter: conjunction, ordering on distanceBucket, eq/in on crossModel and element, isNull on locationCell', async () => {
  const f = (clauses) => ctx().filter(set, clauses);
  assert.deepEqual((await f([{ facet: 'crossModel', op: 'eq', value: true }])).matches, ids(1));
  assert.deepEqual((await f([{ facet: { facet: 'distanceBucket', width: 0.1 }, op: 'gte', value: 1 }, { facet: 'crossModel', op: 'eq', value: false }])).matches, ids(0, 2));   // buckets 1 (0.15) and 3 (0.35); the cross-model 0.05 is bucket 0
  assert.deepEqual((await f([{ facet: 'element', op: 'eq', value: { modelKey: 'A', dbId: 3 } }])).matches, ids(2)); // existential over the two members
  assert.deepEqual((await f([{ facet: { facet: 'locationCell', size: 1 }, op: 'in', value: [[0, 0, 0]] }])).matches, ids(0, 1, 2)); // every midpoint lies in cell [0,0,0]
  assert.deepEqual((await f([])).matches, ids(0, 1, 2));                                                                  // empty conjunction
  const r = await f([{ facet: 'mode', op: 'eq', value: 'clearance' }]); assert.equal(r.count, 3); assert.equal(r.total, 3);
});

test('unavailable facets: the clause is FALSE for every result (never ignored) and is reported', async () => {
  const r = await ctx().filter(set, [{ facet: 'mode', op: 'eq', value: 'clearance' }, { facet: 'attrFirst:level', op: 'eq', value: 'L1' }]);
  assert.deepEqual(r.matches, []);
  assert.deepEqual(r.unavailable, [{ facetId: 'attrFirst:level', reason: 'annotation-absent' }]);
  const n = await ctx().filter(set, [{ facet: 'attrFirst:level', op: 'isNull' }]);              // still false, not "everything is null"
  assert.deepEqual(n.matches, []);
});

test('clause validation is closed and bounded', async () => {
  const bad = [
    [{ facet: 'mode', op: 'lt', value: 1 }], [{ facet: { facet: 'locationCell', size: 1 }, op: 'gt', value: 0 }], [{ facet: 'element', op: 'gte', value: 1 }],
    [{ facet: 'mode', op: 'isNull', value: 1 }], [{ facet: 'mode', op: 'eq' }], [{ facet: 'mode', op: 'in', value: 'x' }], [{ facet: 'mode', op: 'like', value: 'x' }],
    [{ facet: 'mode', op: 'eq', value: NaN }], [{ facet: 'mode', op: 'eq', value: 'x', extra: 1 }], [{ op: 'eq', value: 1 }], [{ facet: { facet: 'distanceBucket', width: 1 }, op: 'lt', value: Infinity }],
  ];
  for (const c of bad) await assert.rejects(ctx().filter(set, c), InvalidOptionsError, JSON.stringify(c));
  await assert.rejects(ctx({ maxFilterClauses: 2 }).filter(set, Array.from({ length: 3 }, () => ({ facet: 'mode', op: 'notNull' }))), InvalidOptionsError);
  await assert.rejects(ctx().filter(set, 'nope'), InvalidOptionsError);
});

test('filter is sliced and abortable', async () => {
  const h = makeHarness(); const c = createContextInternal({ limits: { aggregationSliceMaxItems: 1 }, now: h.now, yieldToScheduler: () => h.yieldToScheduler() }, {});
  await c.filter(set, [{ facet: 'mode', op: 'notNull' }]); assert.ok(h.yields >= 2);
});
