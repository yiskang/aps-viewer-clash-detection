// test/clashtest/util/capture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as captureModule from '../../../clashtest/util/capture.js';
import { captureData, deepFreeze, deepFreezeSliced, isDeepFrozen } from '../../../clashtest/util/capture.js';

const cap = (v, o = {}) => captureData(v, { maxNodes: 1_000, ...o });
const codes = (r) => r.issues.map((i) => `${i.code}@${i.path}`);

test('maxNodes is required', () => {
  assert.throws(() => captureData({}, {}), TypeError);
  assert.throws(() => captureData({}), TypeError);
});

test('captures a detached deep copy: key order kept, later caller mutation has no effect', () => {
  const src = { b: 1, a: [1, { z: 'x' }], c: null, d: true };
  const r = cap(src);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, src);
  assert.deepEqual(Object.keys(r.value), ['b', 'a', 'c', 'd']);
  assert.notEqual(r.value, src); assert.notEqual(r.value.a, src.a); assert.notEqual(r.value.a[1], src.a[1]);
  src.a[1].z = 'changed'; src.a.push(9); src.b = 2;
  assert.equal(r.value.a[1].z, 'x'); assert.equal(r.value.a.length, 2); assert.equal(r.value.b, 1);
});

test('primitive roots and null-prototype objects are accepted; nodes are counted', () => {
  assert.deepEqual(cap(5), { ok: true, value: 5, nodes: 1 });
  const np = Object.create(null); np.k = 1;
  const r = cap(np);
  assert.equal(r.ok, true); assert.equal(r.value.k, 1); assert.equal(r.nodes, 2);
});

test('a getter is never invoked: accessor property and accessor array index are issues', () => {
  let calls = 0;
  const o = { ok: 1 }; Object.defineProperty(o, 'evil', { enumerable: true, get() { calls++; return 1; } });
  const arr = [1]; Object.defineProperty(arr, 1, { enumerable: true, get() { calls++; return 2; } });
  assert.deepEqual(codes(cap(o)), ['accessor@/evil']);
  assert.deepEqual(codes(cap({ list: arr })), ['accessor@/list/1']);
  assert.equal(calls, 0);
});

test('symbol keys, array holes and extra array keys are issues', () => {
  assert.deepEqual(codes(cap({ [Symbol('s')]: 1 })), ['symbol-key@/s']);
  assert.deepEqual(codes(cap({ a: [1, , 3] })), ['sparse-array@/a/1']); // eslint-disable-line no-sparse-arrays
  const extra = [1, 2]; extra.tag = 'x';
  assert.deepEqual(codes(cap(extra)), ['array-extra-key@']);
});

test('non-plain values are not-plain: Map, Set, Date, class instance, function, undefined, NaN, Infinity, bigint, symbol', () => {
  class Foo { constructor() { this.x = 1; } }
  for (const bad of [new Map(), new Set(), new Date(0), new Foo(), () => 1, undefined, NaN, Infinity, -Infinity, 1n, Symbol('s')]) {
    const r = cap({ v: bad });
    assert.equal(r.ok, false, String(bad));
    assert.deepEqual(codes(r), ['not-plain@/v'], String(bad));
  }
});

test('a revisited object (cycle or shared reference) is cyclic', () => {
  const a = {}; a.self = a;
  assert.deepEqual(codes(cap(a)), ['cyclic@/self']);
  const shared = { s: 1 };
  assert.deepEqual(codes(cap({ x: shared, y: shared })), ['cyclic@/y']);
});

test('depth: 64 levels of nesting are accepted, 65 are rejected', () => {
  const nest = (n) => { let v = 1; for (let i = 0; i < n; i++) v = { c: v }; return v; };
  assert.equal(cap(nest(64)).ok, true);
  assert.equal(codes(cap(nest(65)))[0].split('@')[0], 'depth');
});

test('node ceiling is charged BEFORE elements are read or allocated', () => {
  let reads = 0;
  const big = new Array(1_000_000); // length only; must be rejected in O(1)
  Object.defineProperty(big, 0, { enumerable: true, get() { reads++; return 1; } });
  const r = captureData({ big }, { maxNodes: 100 });
  assert.deepEqual(codes(r), ['too-many-nodes@/big']);
  assert.equal(reads, 0);
  assert.equal(captureData([1, 2, 3], { maxNodes: 4 }).ok, true);
  assert.equal(captureData([1, 2, 3], { maxNodes: 3 }).ok, false);
});

test('string, key and array length caps (including per-path overrides)', () => {
  assert.deepEqual(codes(cap({ s: 'abcd' }, { maxStringLength: 3 })), ['string-too-long@/s']);
  assert.deepEqual(codes(cap({ ['k'.repeat(11)]: 1 }, { maxKeyLength: 10 }))[0].startsWith('string-too-long@'), true);
  assert.deepEqual(codes(cap({ a: [1, 2, 3] }, { maxArrayLength: 2 })), ['array-too-long@/a']);
  const r = cap({ a: [1, 2, 3], b: [1, 2, 3] }, { maxArrayLength: 2, arrayLimitFor: (p) => (p === '/a' ? 3 : undefined) });
  assert.deepEqual(codes(r), ['array-too-long@/b']);
  assert.equal(cap({ id: 'x'.repeat(50) }, { maxStringLength: 3, stringLimitFor: (p) => (p === '/id' ? 64 : undefined) }).ok, true);
});

test('__proto__ as an own key is captured as an own data property (never invokes the setter)', () => {
  const src = JSON.parse('{"__proto__": {"polluted": true}, "n": 1}');
  const r = cap(src);
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.value), Object.prototype);
  assert.equal(Object.hasOwn(r.value, '__proto__'), true);
  assert.equal(({}).polluted, undefined);
});

test('a throwing proxy trap or a revoked proxy is reported as unreadable; the thrown value never escapes', () => {
  const secret = new Error('trap secret');
  const hostile = new Proxy({}, { ownKeys() { throw secret; } });
  const r = cap({ h: hostile });
  assert.deepEqual(codes(r), ['unreadable@/h']);
  assert.ok(!JSON.stringify(r).includes('secret'));
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.deepEqual(codes(cap({ p: proxy })), ['unreadable@/p']);
});

test('issues are collected up to maxIssues, then truncated', () => {
  const r = cap({ a: undefined, b: undefined, c: undefined }, { maxIssues: 2 });
  assert.equal(r.ok, false); assert.equal(r.issues.length, 2); assert.equal(r.issuesTruncated, true);
  const exact = cap({ a: undefined, b: undefined }, { maxIssues: 2 });
  assert.equal(exact.issues.length, 2); assert.equal(exact.issuesTruncated, false);
});

test('-0 is captured as-is (normalization is the canonical encoder\'s job)', () => {
  assert.equal(Object.is(cap({ n: -0 }).value.n, -0), true);
});

test('rootGate: the version key is read first and a failing value stops capture before anything else is read', () => {
  let calls = 0;
  const set = { results: [], schemaVersion: 2 };
  Object.defineProperty(set, 'trap', { enumerable: true, get() { calls++; return 1; } });
  const gate = { key: 'schemaVersion', check: (v) => v === 1 };
  const r = cap(set, { rootGate: gate });
  assert.equal(r.ok, false);
  assert.deepEqual(r.gate, { key: 'schemaVersion', value: 2 });
  assert.deepEqual(codes(r), ['gated@/schemaVersion']);
  assert.equal(calls, 0);
  assert.equal(cap({ results: [], schemaVersion: 1 }, { rootGate: gate }).ok, true);
});

test('a throwing getter on schemaVersion or runId is never invoked: accessor issues, the gate is not consulted, no get trap fires (P5 metadata rule)', () => {
  let getterCalls = 0;
  let gateCalls = 0;
  const boom = () => { getterCalls += 1; throw new Error('getter must never run'); };
  const set = { results: [] };
  Object.defineProperty(set, 'schemaVersion', { enumerable: true, get: boom });
  Object.defineProperty(set, 'runId', { enumerable: true, get: boom });
  const gate = { key: 'schemaVersion', check: () => { gateCalls += 1; return true; } };
  const r = cap(set, { rootGate: gate, maxIssues: 10 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r).sort(), ['accessor@/runId', 'accessor@/schemaVersion']);
  assert.equal(getterCalls, 0);
  assert.equal(gateCalls, 0);                                     // the gate only ever sees a primitive read from a DATA descriptor
  assert.equal(r.value, undefined);                               // a failed capture returns no value at all
  assert.ok(!JSON.stringify(r).includes('must never run'));

  // even a proxy whose `get` trap would throw is never asked for a property value
  let gets = 0;
  const spy = new Proxy({ schemaVersion: 1, runId: 'r1', results: [] }, { get() { gets += 1; throw new Error('get trap'); } });
  assert.equal(cap(spy, { rootGate: gate }).ok, true);
  assert.equal(gets, 0);
  assert.equal(gateCalls, 1);                                     // data descriptor: consulted exactly once

  // the ONLY sanctioned way to learn a diagnostic runId: from the captured copy, after a successful capture
  const runIdOf = (result) => (result.ok && typeof result.value?.runId === 'string' ? result.value.runId : null);
  assert.equal(runIdOf(r), null);
  assert.equal(runIdOf(cap({ schemaVersion: 1, runId: 'r1', results: [] }, { rootGate: gate })), 'r1');
  // a non-primitive schemaVersion is not gated (the caller must validate the copy); a missing one is not gated either
  assert.equal(cap({ schemaVersion: { n: 1 }, results: [] }, { rootGate: { key: 'schemaVersion', check: () => false } }).ok, true);
  assert.equal(cap({ results: [] }, { rootGate: { key: 'schemaVersion', check: () => false } }).ok, true);
});

test('there is ONE node ceiling and one issue code (P5 maps it); a second, softer ceiling option is ignored, not honoured', () => {
  const doc = { a: [1, 2, 3] };                                   // root + array + 3 elements = 5 nodes
  assert.deepEqual(codes(captureData(doc, { maxNodes: 4 })), ['too-many-nodes@/a']);
  const ok = captureData(doc, { maxNodes: 5, softMaxNodes: 2, unknownFieldByteBudget: 1, onRootKey() { throw new Error('unused'); } });
  assert.equal(ok.ok, true);
  assert.equal(ok.nodes, 5);
});

// ---- openFieldBudget: the spec 13.6 unknown-field byte budget, enforced DURING capture ----
const budget = (isOpenPath, maxBytes) => ({ openFieldBudget: { isOpenPath, maxBytes } });
const openAt = (...segs) => (p) => p.length >= segs.length && segs.every((s, i) => p[i] === s);

test('openFieldBudget: many individually legal 4 KiB strings exceed 64 KiB, and capture stops before the offending copy (later elements are never read or copied)', () => {
  const reads = [];
  const list = new Proxy(Array.from({ length: 100 }, () => 'x'.repeat(4096)), {
    getOwnPropertyDescriptor(t, k) { reads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = cap({ x: list, after: 1 }, { maxStringLength: 4096, ...budget(openAt('x'), 64 * 1024) });
  // charged: key 'x' (1) + the array (8) + 15 strings (61,440) = 61,449; the 16th string would make 65,545 > 65,536
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['unknown-field-bytes@/x/15']);
  assert.equal(r.value, undefined);
  assert.equal(r.nodes, 17);                                      // root + array + 15 strings: nothing after the offending value was copied
  assert.equal(r.openFieldBytes, 61_449);
  assert.deepEqual(reads.filter((k) => k !== 'length'), Array.from({ length: 16 }, (_, i) => String(i))); // index 16.. never read
  // the same document without the option is captured whole (each string is individually legal)
  const all = cap({ x: Array.from({ length: 100 }, () => 'x'.repeat(4096)) }, { maxStringLength: 4096 });
  assert.equal(all.ok, true); assert.equal(all.nodes, 102);
});

test('openFieldBudget: a below-budget open subtree copies fine; accounting is exact and the boundary is inclusive', () => {
  const doc = { a: { b: 'héllo', n: 1, t: true, z: null, arr: [1] }, closed: 'c'.repeat(500) };
  // key a 1 + container 8 + (b: 1 + 6 bytes) + (n: 1 + 8) + (t: 1 + 8) + (z: 1 + 8) + (arr: 3 + 8 + 8) = 62
  const ok = cap(doc, budget(openAt('a'), 62));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, doc);
  assert.equal(ok.openFieldBytes, 62);
  assert.equal(ok.nodes, 9);                                       // root, a, b, n, t, z, arr, arr[0], closed
  const over = cap(doc, budget(openAt('a'), 61));
  assert.equal(over.ok, false);
  assert.deepEqual(codes(over), ['unknown-field-bytes@/a/arr/0']);
  assert.equal(over.nodes, 7);                                     // root, a, b, n, t, z, arr: the element that broke the budget was not copied, and 'closed' was never reached
});

test('openFieldBudget: closed paths are never charged; isOpenPath receives frozen unescaped segments (indices as strings, root as [])', () => {
  const seen = [];
  const doc = { closed: 's'.repeat(1_000_000), 'we/ird~': [{ deep: 1 }] };
  const r = cap(doc, { maxNodes: 1_000, ...budget((p) => { seen.push([...p]); assert.equal(Object.isFrozen(p), true); return p[0] === 'we/ird~' && p.length >= 1; }, 100) });
  assert.equal(r.ok, true);
  assert.equal(r.openFieldBytes, 7 + 8 + 8 + 4 + 8);              // key 'we/ird~' (7) + array (8) + object (8) + key 'deep' (4) + number (8)
  assert.deepEqual(seen[0], []);                                   // the root itself is asked first
  assert.ok(seen.some((p) => p.join('|') === 'closed'));
  assert.equal(seen.some((p) => p.length > 1), false);             // everything below an open path is open: the predicate is not asked again
  const idx = [];
  const only = cap({ l: [1, 2, 3] }, budget((p) => { idx.push([...p]); return p.length === 2 && p[0] === 'l' && p[1] === '1'; }, 100));
  assert.equal(only.openFieldBytes, 8);                            // only l[1] is open; an array index is the decimal STRING '1'
  assert.deepEqual(idx, [[], ['l'], ['l', '0'], ['l', '1'], ['l', '2']]);
  // everything closed: nothing is charged even with a zero budget
  const none = cap(doc, { maxNodes: 1_000, ...budget(() => false, 0) });
  assert.equal(none.ok, true); assert.equal(none.openFieldBytes, 0);
});

test('openFieldBudget omitted: behaviour identical to before (no accounting, no extra result field, isOpenPath never needed)', () => {
  const src = { b: 1, a: ['x', { z: 'y' }], k: null };
  const plain = cap(src);
  assert.deepEqual(plain, { ok: true, value: src, nodes: 7 });
  assert.equal('openFieldBytes' in plain, false);
  const withClosed = cap(src, budget(() => false, 0));
  assert.deepEqual(withClosed.value, plain.value); assert.equal(withClosed.nodes, plain.nodes);
  const big = cap({ s: 'x'.repeat(1_000_000) });                   // no budget => a huge string is fine
  assert.equal(big.ok, true);
  assert.equal('openFieldBytes' in big, false);
  assert.deepEqual(codes(cap({ a: undefined })), ['not-plain@/a']);
});

test('openFieldBudget: a failure stops everything; a throwing getter or sibling deeper than the failure point is never read, let alone invoked', () => {
  let getterCalls = 0;
  const rootReads = [];
  const items = ['p'.repeat(100), 'q'.repeat(100), 0];
  Object.defineProperty(items, 2, { enumerable: true, get() { getterCalls++; return 1; } });
  const itemReads = [];
  const spyItems = new Proxy(items, { getOwnPropertyDescriptor(t, k) { itemReads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const doc = { open: spyItems };
  Object.defineProperty(doc, 'after', { enumerable: true, get() { getterCalls++; return 1; } });
  const spyDoc = new Proxy(doc, { getOwnPropertyDescriptor(t, k) { rootReads.push(k); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const r = cap(spyDoc, { maxIssues: 5, ...budget(openAt('open'), 150) });
  assert.deepEqual(codes(r), ['unknown-field-bytes@/open/1']);     // 4 (key) + 8 + 100 = 112; +100 > 150
  assert.equal(getterCalls, 0);
  assert.deepEqual(itemReads.filter((k) => k !== 'length'), ['0', '1']);   // index 2 (the getter) never even had its descriptor read
  assert.deepEqual(rootReads, ['open']);                                    // 'after' (the getter) was never read
  // without the budget the same graph is walked further (proving the stop is the budget's doing) and the getter is still not invoked
  const walked = cap(doc, { maxIssues: 5 });
  assert.deepEqual(codes(walked).sort(), ['accessor@/after', 'accessor@/open/2']);
  assert.equal(getterCalls, 0);
});

test('openFieldBudget: property keys are charged too, before the property is read', () => {
  const keyed = {};
  for (const n of ['a', 'b', 'c', 'd']) keyed[n.repeat(1000)] = null;
  const reads = [];
  const spy = new Proxy(keyed, { getOwnPropertyDescriptor(t, k) { reads.push(k.length); return Reflect.getOwnPropertyDescriptor(t, k); } });
  const r = cap(spy, budget(() => true, 2 * 1008 + 8 + 500));      // root 8 + two (1000 + 8) entries fit; the third key does not
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), [`unknown-field-bytes@/${'c'.repeat(1000)}`]);
  assert.equal(r.nodes, 3);                                        // root + two null values
  assert.deepEqual(reads, [1000, 1000]);                           // the offending key's (and every later key's) descriptor was never read
  assert.equal(r.openFieldBytes, 8 + 2 * 1008);
});

test('openFieldBudget: strings are measured in UTF-8 bytes (2/3/4-byte characters, a lone surrogate is 3), without copying', () => {
  const at = (s, max) => cap(s, budget(() => true, max));
  for (const [s, bytes] of [['abc', 3], ['éé', 4], ['€', 3], ['😀', 4], ['😀😀😀', 12], ['\ud800', 3], ['a\udc00b', 5], ['', 0]]) {
    assert.equal(bytes, Buffer.byteLength(s, 'utf8'), 'the table itself agrees with Buffer');
    const ok = at(s, bytes);
    assert.equal(ok.ok, true, JSON.stringify(s)); assert.equal(ok.openFieldBytes, bytes);
    if (bytes > 0) assert.deepEqual(codes(at(s, bytes - 1)), ['unknown-field-bytes@'], JSON.stringify(s));
  }
  // a string longer (in code units) than the whole budget is refused without being scanned
  assert.deepEqual(codes(at('z'.repeat(10_000_000), 100)), ['unknown-field-bytes@']);
});

test('openFieldBudget: the option shape is validated (TypeError, like maxNodes); a bad budget never reaches the traversal', () => {
  for (const bad of [null, {}, { isOpenPath: () => true }, { isOpenPath: () => true, maxBytes: -1 }, { isOpenPath: () => true, maxBytes: Infinity },
    { isOpenPath: 'no', maxBytes: 10 }]) {
    assert.throws(() => captureData({}, { maxNodes: 10, openFieldBudget: bad }), TypeError);
  }
  // a throwing predicate is the caller's bug, but it is reported as `unreadable`, never thrown out of captureData
  assert.deepEqual(codes(cap({ a: 1 }, budget(() => { throw new Error('predicate'); }, 10))), ['unreadable@']);
});

test('export surface: exactly five names; the per-caller adapters live in P2 (captureAndValidate) and P5 (captureResultSet), not here (N29)', () => {
  assert.deepEqual(Object.keys(captureModule).sort(), ['CAPTURE_CODES', 'captureData', 'deepFreeze', 'deepFreezeSliced', 'isDeepFrozen']);
  for (const absent of ['captureResultSet', 'captureDefinition', 'captureDetached', 'ownKeysOf', 'readOwnValue', 'prototypeIsPlain']) {
    assert.equal(absent in captureModule, false, absent);
  }
});

test('deepFreeze / isDeepFrozen / deepFreezeSliced', async () => {
  const v = { a: [1, { b: 2 }], c: { d: [3] } };
  assert.equal(isDeepFrozen(v), false);
  assert.equal(deepFreeze(v), v);
  assert.equal(isDeepFrozen(v), true);
  assert.throws(() => { 'use strict'; v.a[1].b = 9; }, TypeError);
  let ticks = 0;
  const w = { a: [1, { b: 2 }], c: { d: [3] } };
  await deepFreezeSliced(w, { tick: () => { ticks++; } });
  assert.equal(isDeepFrozen(w), true);
  assert.equal(ticks, 5); // w, w.a, w.a[1], w.c, w.c.d
});

test('every own key list and every own property descriptor is read exactly once (spy on the reflection traps)', () => {
  const seen = new Map(); let ownKeysCalls = 0;
  const spy = (target) => new Proxy(target, {
    ownKeys(t) { ownKeysCalls++; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { seen.set(k, (seen.get(k) ?? 0) + 1); return Reflect.getOwnPropertyDescriptor(t, k); },
  });
  const r = cap(spy({ a: 1, c: 2 }));
  assert.equal(r.ok, true);
  assert.equal(ownKeysCalls, 1);
  assert.deepEqual([...seen.entries()], [['a', 1], ['c', 1]]);
  seen.clear(); ownKeysCalls = 0;
  assert.equal(cap(spy([10, 20])).ok, true);          // array: length + each index, once each
  assert.equal(ownKeysCalls, 1);
  assert.deepEqual([...seen.entries()].sort(), [['0', 1], ['1', 1], ['length', 1]]);
});

test('an object with 100,000 unknown own keys is rejected before any key is copied (the ownKeys enumeration cost itself is not bounded, spec 5.3)', () => {
  const wide = {};
  for (let i = 0; i < 100_000; i++) wide[`k${i}`] = 1;
  const r = captureData(wide, { maxNodes: 1_000 });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ['too-many-nodes@']);
});

test('malformed limit options throw before the root is read (no fail-open: maxIssues 0 must not return ok for a truncated capture)', () => {
  let read = 0;
  const root = new Proxy({}, { ownKeys() { read++; return []; }, getPrototypeOf() { read++; return Object.prototype; } });
  const bad = [
    { maxIssues: 0 }, { maxIssues: NaN }, { maxIssues: 1.5 }, { maxDepth: NaN }, { maxDepth: 0 }, { maxKeyLength: NaN },
    { maxKeyLength: -1 }, { maxStringLength: NaN }, { maxArrayLength: NaN }, { maxStringLength: -1 },
    { stringLimitFor: 3 }, { arrayLimitFor: 'x' }, { rootGate: null }, { rootGate: {} },
    { rootGate: { check: () => true } }, { rootGate: { key: 42, check: () => true } }, { rootGate: { key: undefined, check: () => true } },
  ];
  for (const extra of bad) {
    assert.throws(() => captureData(root, { maxNodes: 10, ...extra }), TypeError, JSON.stringify(extra));
  }
  assert.equal(read, 0);
  assert.equal(captureData({ a: 1 }, { maxNodes: 10, maxIssues: 1, maxDepth: 64, maxKeyLength: 1024, maxStringLength: Infinity }).ok, true);
});

test('an over-long or hostile key is never copied whole into a diagnostic path', () => {
  const huge = '/~'.repeat(50_000);
  const r = captureData({ [huge]: 1 }, { maxNodes: 10, maxKeyLength: 10 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((i) => `${i.code}@${i.path}`), ['string-too-long@']);
  const r2 = captureData({ a: { [huge]: 1 } }, { maxNodes: 10, maxKeyLength: 10 });
  assert.deepEqual(r2.issues.map((i) => `${i.code}@${i.path}`), ['string-too-long@/a']);
  const sym = captureData({ [Symbol('x'.repeat(100_000))]: 1 }, { maxNodes: 10 });
  assert.equal(sym.issues[0].code, 'symbol-key');
  assert.ok(sym.issues[0].path.length <= 1 + 64);
});

test('per-path limit callbacks: a non-number, NaN or negative result fails CLOSED (ok:false, never silently disables a bound); undefined defers to the fixed cap', () => {
  const root = { s: 'x'.repeat(50), a: [1, 2, 3] };
  for (const bad of [NaN, -1, '5', null, {}, true]) {
    for (const opt of ['stringLimitFor', 'arrayLimitFor']) {
      const r = cap(root, { [opt]: () => bad });
      assert.equal(r.ok, false, `${opt} -> ${String(bad)}`);
      assert.equal(r.issues[0].code, 'unreadable', `${opt} -> ${String(bad)}`);
    }
  }
  // valid results are honoured: 0 rejects, Infinity admits, undefined falls back to maxStringLength / maxArrayLength
  assert.equal(cap(root, { stringLimitFor: () => 0 }).issues[0].code, 'string-too-long');
  assert.equal(cap(root, { arrayLimitFor: () => 0 }).issues[0].code, 'array-too-long');
  assert.equal(cap(root, { stringLimitFor: () => Infinity, arrayLimitFor: () => Infinity }).ok, true);
  assert.equal(cap(root, { stringLimitFor: () => undefined, maxStringLength: 10 }).issues[0].code, 'string-too-long');
  assert.equal(cap(root, { arrayLimitFor: () => undefined, maxArrayLength: 2 }).issues[0].code, 'array-too-long');
});
