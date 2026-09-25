import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clauseHolds, filterRunner } from '../../../clashtest/derive/filter.js';
import { captureJsonOperand } from '../../../clashtest/derive/validate.js';
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

// ---- remediation M2 (P8 independent review): eq/in operands are OWNED — captured once, during synchronous preparation, into
// detached JSON-safe data. Anything that is not canonical plain data is InvalidOptionsError (never a raw RangeError, and never a
// CorruptResultSetError misattributed to the set); mutating the caller's operand after the call changes nothing.
const HOSTILE = new Error('HOSTILE-TRAP');
const badValue = async (value, op = 'eq', label = JSON.stringify(op)) => {
  const e = await ctx().filter(set, [{ facet: 'elementSecond', op, value }]).then(() => assert.fail(`${label}: accepted`), (x) => x);
  assert.notEqual(e, HOSTILE, `${label}: hostile trap error escaped`);
  assert.ok(!(e instanceof RangeError), `${label}: raw RangeError`);
  assert.ok(e instanceof InvalidOptionsError, `${label}: expected InvalidOptionsError, got ${e?.constructor?.name}: ${e?.message}`);
  assert.deepEqual(e.issues.map((i) => [i.code, i.path]), [['bad-value', 'clauses[0].value']], label);
};
const nest = (depth, leaf, wrap) => { let v = leaf; for (let i = 0; i < depth; i++) v = wrap(v); return v; };

test('M2: a cyclic eq operand is InvalidOptionsError bad-value (not a raw RangeError)', async () => {
  const cyc = { modelKey: 'A', dbId: 2 }; cyc.self = cyc;
  await badValue(cyc, 'eq', 'cyclic object');
  const arr = ['A']; arr.push(arr);
  await badValue(arr, 'eq', 'cyclic array');
});

test('M2: a cyclic in operand (the array itself, or an element) is InvalidOptionsError bad-value', async () => {
  const arr = []; arr.push(arr);
  await badValue(arr, 'in', 'self-containing in array');
  const el = { modelKey: 'A' }; el.me = el;
  await badValue([{ modelKey: 'A', dbId: 2 }, el], 'in', 'cyclic element');
});

// ---- M2 refinement (owner ruling): bounded-resource safety is EXPLICIT. Operand depth is bounded by the §5.3/§13.6 capture
// contract (container depth <= 64, the root container is depth 1 — as P0 captureData and validateResultSet's MAX_DEPTH), and the
// EXPANDED (tree) node count of all operands of one filter call is charged against the resolved §17.1 maxCapturedNodes BEFORE
// anything expanded is built. Over either bound => InvalidOptionsError; nothing is silently made to match nothing.
const refused = async (value, op, code, label, clauseIdx = 0, clauses = null) => {
  const cs = clauses ?? [{ facet: 'elementSecond', op, value }];
  const e = await ctx().filter(set, cs).then(() => assert.fail(`${label}: accepted`), (x) => x);
  assert.ok(e instanceof InvalidOptionsError, `${label}: expected InvalidOptionsError, got ${e?.constructor?.name}: ${e?.message}`);
  assert.deepEqual(e.issues.map((x) => [x.code, x.path]), [[code, `clauses[${clauseIdx}].value`]], label);
};
const ladder = (n, leaf = 1, wrap = (v) => [v, v]) => nest(n, leaf, wrap);   // n containers, each holding its predecessor twice: expanded 2^(n+1)-1 nodes

test('M2: operand container depth is bounded at 64 (spec §5.3/§13.6 capture contract): 64 accepted, 65 and deeper InvalidOptionsError', async () => {
  const ok = async (op, value) => { const r = await ctx().filter(set, [{ facet: 'elementSecond', op, value }]); return r.matches; };
  assert.deepEqual(await ok('eq', nest(64, 1, (v) => [v])), []);                          // depth exactly 64: accepted (a valid value; equals no facet value)
  assert.deepEqual(await ok('eq', nest(64, 1, (v) => ({ v }))), []);
  assert.deepEqual(await ok('in', [nest(63, 1, (v) => [v]), { modelKey: 'A', dbId: 2 }]), ids(0));   // in list (depth 1) + element depth 63 = 64
  await refused(nest(65, 1, (v) => [v]), 'eq', 'operand-too-deep', 'eq depth 65');
  await refused(nest(65, 1, (v) => ({ v })), 'eq', 'operand-too-deep', 'eq object depth 65');
  await refused([nest(64, 1, (v) => [v])], 'in', 'operand-too-deep', 'in element depth 64 (65 with the list)');
  await refused(nest(129, 1, (v) => [v]), 'eq', 'operand-too-deep', 'eq depth 129');
  await refused(nest(100000, 1, (v) => [v]), 'eq', 'operand-too-deep', 'eq depth 100000 (never a RangeError)');
  await refused([nest(100000, 1, (v) => ({ v }))], 'in', 'operand-too-deep', 'in element depth 100000');
  const deep = nest(40, 1, (v) => [v]);                                                    // a SHARED node's depth is checked on every path, not only its first
  await refused([deep, nest(30, deep, (v) => [v])], 'eq', 'operand-too-deep', 'shared node reached again 30 levels deeper (1 + 30 + 40 = 71)');
  assert.deepEqual(await ok('eq', [deep, nest(23, deep, (v) => [v])]), []);                // 1 + 23 + 40 = 64: accepted
  const cyc = []; cyc.push(cyc);
  await badValue(nest(10, cyc, (v) => [v]), 'eq', 'cycle below 10 levels');                // a cycle is still bad-value (cycle, not depth)
});

test('M2: a heavily shared DAG (ladder of 60 shared doubles, expanded 2^61-1 nodes) is InvalidOptionsError without being expanded', async () => {
  await refused(ladder(60), 'eq', 'operand-too-large', 'ladder 60 eq');                  // would hang (or exhaust memory) if expanded
  await refused([ladder(60, { modelKey: 'A', dbId: 2 }, (v) => ({ a: v, b: v }))], 'in', 'operand-too-large', 'ladder 60 in element');
  await refused(ladder(30), 'eq', 'operand-too-large', 'ladder 30: 2^31-1 > the default maxCapturedNodes 16,000,000');
  // capture visits each distinct container ONCE (linear), counted through a Proxy's ownKeys trap on every container
  let opens = 0; const counted = (v) => new Proxy(v, { ownKeys(t) { opens += 1; return Reflect.ownKeys(t); } });
  assert.throws(() => captureJsonOperand(ladder(60, 1, (v) => counted([v, v])), 'v', 1000), (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'operand-too-large');
  assert.ok(opens <= 60, `container visits ${opens} > 60`);
  opens = 0;
  const { value, nodes } = captureJsonOperand(ladder(9, 1, (v) => counted([v, v])), 'v', 1023);
  assert.equal(nodes, 1023); assert.equal(opens, 9);                                       // expanded 2^10-1 nodes, 9 container visits
  assert.equal(JSON.stringify(value), JSON.stringify(structuredClone(ladder(9))));        // tree value semantics
});

test('M2: expanded-size budget is exact — expanded size == budget accepted, budget+1 rejected (tree and shared DAG)', () => {
  const tooLarge = (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'operand-too-large' && e.issues[0].path === 'v';
  assert.equal(captureJsonOperand([1, 2], 'v', 3).nodes, 3);                               // container + 2 leaves
  assert.throws(() => captureJsonOperand([1, 2], 'v', 2), tooLarge);
  assert.equal(captureJsonOperand({ a: [1, { b: 'x' }] }, 'v', 5).nodes, 5);             // object, array, 1, object, 'x'
  assert.throws(() => captureJsonOperand({ a: [1, { b: 'x' }] }, 'v', 4), tooLarge);
  const r = [1, 1];                                                                        // 3 nodes, shared twice: [r, r] expands to 1 + 3 + 3 = 7
  assert.equal(captureJsonOperand([r, r], 'v', 7).nodes, 7);
  assert.throws(() => captureJsonOperand([r, r], 'v', 6), tooLarge);
  const d = { x: 1 }; const diamond = { l: { d }, r: { d } };                               // 1 + (1 + 2) + (1 + 2) = 7
  assert.equal(captureJsonOperand(diamond, 'v', 7).nodes, 7);
  assert.throws(() => captureJsonOperand(diamond, 'v', 6), tooLarge);
  assert.equal(captureJsonOperand('s', 'v', 1).nodes, 1);                                  // a primitive is one node
  assert.throws(() => captureJsonOperand('s', 'v', 0), tooLarge);
});

test('M2: the node budget is SHARED across all clauses of one filter call', () => {
  const limits = { maxFilterClauses: 10 };
  const c = (v, op = 'eq') => ({ facet: 'elementSecond', op, value: v });
  const prep = (clauses, budget) => filterRunner.prepare({ clauses }, {}, limits, { maxCapturedNodes: budget });
  assert.equal(prep([c([1, 2, 3, 4]), c([5, 6, 7, 8], 'in')], 10).clauses.length, 2);      // 5 + 5 = 10: accepted
  assert.throws(() => prep([c([1, 2, 3, 4]), c([5, 6, 7, 8], 'in')], 9),                    // each fits alone; together over
    (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'operand-too-large' && e.issues[0].path === 'clauses[1].value');
  assert.equal(prep([c([1, 2, 3, 4]), { facet: 'mode', op: 'notNull' }, c('x')], 6).clauses.length, 3);   // non-operand clauses are free
});

test('M2: a small shared DAG operand is ACCEPTED and matches exactly like its tree-expanded equivalent', async () => {
  const f = async (op, value, facet = 'elementSecond') => (await ctx().filter(set, [{ facet, op, value }])).matches;
  const r = { modelKey: 'A', dbId: 2 };
  assert.deepEqual(await f('in', [r, r]), await f('in', structuredClone([r, r])));
  assert.deepEqual(await f('in', [r, r]), ids(0));
  const leaf = { modelKey: 'A', dbId: 3 }; const mid = [leaf, leaf];
  assert.deepEqual(await f('in', [...mid, { modelKey: 'B', dbId: 1 }]), ids(1, 2));
  const a = 'A'; const pm = [a, a];
  assert.deepEqual(await f('eq', pm, 'pairModels'), await f('eq', ['A', 'A'], 'pairModels'));
  const d = [0, 0, 0]; const cells = [d, d];                                                // shared cell coordinates
  assert.deepEqual(await f('in', cells, { facet: 'locationCell', size: 1 }), await f('in', [[0, 0, 0], [0, 0, 0]], { facet: 'locationCell', size: 1 }));
  // the owned copy of a DAG serialises to the same canonical key as its expansion
  const dag = [{ s: r }, { s: r }];
  assert.equal(JSON.stringify(captureJsonOperand(dag, 'v', 100).value), JSON.stringify(structuredClone(dag)));
});

test('M2: mutating a SHARED sub-object of the caller\'s operand after the call changes nothing', async () => {
  const f = (value) => ctx().filter(set, [{ facet: 'elementSecond', op: 'in', value }]);
  const control = await f([{ modelKey: 'A', dbId: 2 }, { modelKey: 'A', dbId: 2 }]);
  const r = { modelKey: 'A', dbId: 2 }; const arr = [r, r];
  const p = f(arr); r.dbId = 999; arr.push({ modelKey: 'B', dbId: 1 });
  assert.equal(control.count, 1); assert.deepEqual(await p, control);
});

test('M2: accessor operands are refused and the getter is NEVER invoked', async () => {
  let calls = 0;
  await badValue(Object.defineProperty({ modelKey: 'A' }, 'dbId', { get() { calls += 1; return 2; }, enumerable: true }), 'eq', 'accessor property');
  await badValue(Object.defineProperty([], 0, { get() { calls += 1; return 'x'; }, enumerable: true }), 'in', 'accessor element');
  await badValue([Object.defineProperty({}, 'dbId', { get() { calls += 1; return 2; }, enumerable: true })], 'in', 'accessor in element');
  assert.equal(calls, 0);
});

test('M2: hostile / unreadable / non-plain operands are InvalidOptionsError (the trap error never escapes)', async () => {
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    await badValue(new Proxy({ modelKey: 'A', dbId: 2 }, { [trap]() { throw HOSTILE; } }), 'eq', `object ${trap}`);
    if (trap !== 'getPrototypeOf') await badValue(new Proxy([{ modelKey: 'A', dbId: 2 }], { [trap]() { throw HOSTILE; } }), 'in', `array ${trap}`);
  }
  const { proxy, revoke } = Proxy.revocable({ modelKey: 'A', dbId: 2 }, {}); revoke();
  await badValue(proxy, 'eq', 'revoked');
  await badValue([proxy], 'in', 'revoked element');
  for (const [v, label] of [[new Date(0), 'Date'], [new Map(), 'Map'], [{ a: undefined }, 'undefined member'], [{ a: NaN }, 'NaN member'], [[Infinity], 'Infinity element'],
    [{ [Symbol('s')]: 1, modelKey: 'A', dbId: 2 }, 'symbol key'], [Object.defineProperty({ modelKey: 'A', dbId: 2 }, 'x', { value: 1 }), 'non-enumerable member'],
    [[1, , 3], 'sparse array'], [Object.assign([1], { extra: 2 }), 'array with a named property'], [() => 1, 'function'], [10n, 'bigint']]) await badValue(v, 'eq', label);   // eslint-disable-line no-sparse-arrays
  await badValue([new Date(0)], 'in', 'non-plain in element');
});

test('M2: a Proxy operand get trap is never used; the operand is read once from own data descriptors', async () => {
  let gets = 0;
  const r = await ctx().filter(set, [{ facet: 'elementSecond', op: 'eq', value: new Proxy({ modelKey: 'A', dbId: 2 }, { get() { gets += 1; throw HOSTILE; } }) }]);
  assert.equal(r.count, 1); assert.equal(gets, 0);
});

test('M2: post-call mutation of the caller\'s eq object, eq array and in array does not change the result', async () => {
  const f = (clause) => ctx().filter(set, [clause]);
  const obj = { modelKey: 'A', dbId: 2 };
  const control1 = await f({ facet: 'elementSecond', op: 'eq', value: { modelKey: 'A', dbId: 2 } });
  const p1 = f({ facet: 'elementSecond', op: 'eq', value: obj }); obj.dbId = 999;
  assert.equal(control1.count, 1); assert.deepEqual(await p1, control1);

  const pm = ['A', 'B'];
  const control2 = await f({ facet: 'pairModels', op: 'eq', value: ['A', 'B'] });
  const p2 = f({ facet: 'pairModels', op: 'eq', value: pm }); pm[1] = 'A';
  assert.equal(control2.count, 1); assert.deepEqual(await p2, control2);

  const inArr = [{ modelKey: 'A', dbId: 2 }, { modelKey: 'B', dbId: 1 }];
  const control3 = await f({ facet: 'elementSecond', op: 'in', value: [{ modelKey: 'A', dbId: 2 }, { modelKey: 'B', dbId: 1 }] });
  const p3 = f({ facet: 'elementSecond', op: 'in', value: inArr }); inArr[0].dbId = 999; inArr.length = 0;
  assert.equal(control3.count, 2); assert.deepEqual(await p3, control3);
});

test('M2 regression: accepted operand values behave exactly as before (refs, arrays, primitives, null, shared non-cyclic references, null-prototype objects)', async () => {
  const f = async (facet, op, value) => (await ctx().filter(set, [{ facet, op, value }])).matches;
  assert.deepEqual(await f('elementSecond', 'eq', { modelKey: 'A', dbId: 2 }), ids(0));
  assert.deepEqual(await f('elementSecond', 'eq', { dbId: 2, modelKey: 'A' }), ids(0));                          // key order is irrelevant (canonical JSON)
  assert.deepEqual(await f('elementSecond', 'eq', Object.assign(Object.create(null), { modelKey: 'A', dbId: 2 })), ids(0));
  assert.deepEqual(await f('pairModels', 'eq', ['A', 'A']), ids(0, 2));
  assert.deepEqual(await f('pairModels', 'eq', ['A']), []);
  assert.deepEqual(await f('crossModel', 'eq', true), ids(1));
  assert.deepEqual(await f('mode', 'eq', 'clearance'), ids(0, 1, 2));
  assert.deepEqual(await f('mode', 'eq', null), []);
  assert.deepEqual(await f({ facet: 'distanceBucket', width: 0.1 }, 'eq', 3), ids(2));
  assert.deepEqual(await f({ facet: 'distanceBucket', width: 0.1 }, 'eq', -0), ids(1));                         // -0 == 0 canonically
  const shared = { modelKey: 'A', dbId: 3 };
  assert.deepEqual(await f('elementSecond', 'in', [shared, shared, null, { modelKey: 'B', dbId: 1 }]), ids(1, 2)); // a DAG is not a cycle
  assert.deepEqual(await f('elementSecond', 'in', []), []);
  assert.deepEqual(await f('elementSecond', 'in', [null]), []);
  assert.deepEqual(await f({ facet: 'locationCell', size: 1 }, 'in', [[0, 0, 0]]), ids(0, 1, 2));
});
