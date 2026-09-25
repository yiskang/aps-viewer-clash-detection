// test/clashtest/derive/closedOptions.test.mjs — remediation M1 (P8 independent review): every derivation options object
// is a CLOSED bag captured ONCE, descriptor-based and guarded (spec §18 closed options; §5.3/R11-1 reflection rules):
// symbol keys and non-enumerable unknown keys are unknown keys; an accessor is refused and NEVER invoked; a throwing Proxy
// trap is an InvalidOptionsError (the trap's own error never escapes); and the value used is the value validated (a
// detached copy — the caller's object is never re-read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextInternal } from '../../../clashtest/derive/context.js';
import { parseFacetSpec } from '../../../clashtest/derive/facets.js';
import { InvalidOptionsError } from '../../../clashtest/errors.js';
import { makeResultSet, U1 } from './support/makeResultSet.mjs';

const set = makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]] }, { pair: [['M', 100], ['M', 300]] }] });
const ctx = (limits = {}) => createContextInternal({ limits }, {});
const attempt = async (f) => f();   // sync throws and async rejections alike
const HOSTILE = new Error('HOSTILE-TRAP');

/** Resolves to the InvalidOptionsError (asserting it is one, and that no raw/hostile error escaped), or fails. */
async function ioe(f, label) {
  try { await attempt(f); } catch (e) {
    assert.notEqual(e, HOSTILE, `${label}: the hostile trap's own error escaped`);
    assert.ok(e instanceof InvalidOptionsError, `${label}: expected InvalidOptionsError, got ${e?.constructor?.name}: ${e?.message}`);
    return e;
  }
  assert.fail(`${label}: accepted`);
}
const codes = (e) => e.issues.map((i) => i.code);

// Each level: `run(obj)` puts `obj` at that level; `base()` is a VALID bag holding one allowed key `key`.
const signal = new AbortController().signal;
const LEVELS = [
  { name: 'context options', path: 'options', key: 'limits', base: () => ({ limits: {} }), run: (o) => createContextInternal(o, {}) },
  { name: 'context options.limits', path: 'options.limits', key: 'maxFilterClauses', base: () => ({ maxFilterClauses: 5 }), run: (o) => createContextInternal({ limits: o }, {}) },
  { name: 'summarize options', path: 'summarize.options', key: 'signal', base: () => ({ signal }), run: (o) => ctx().summarize(set, o) },
  { name: 'groupBy options', path: 'groupBy.options', key: 'annotations', base: () => ({ annotations: null }), run: (o) => ctx().groupBy(set, ['mode'], o) },
  { name: 'filter options', path: 'filter.options', key: 'annotations', base: () => ({ annotations: null }), run: (o) => ctx().filter(set, [], o) },
  { name: 'compareResultSets options', path: 'compare.options', key: 'distanceTolerance', base: () => ({ distanceTolerance: 0.1 }), run: (o) => ctx().compareResultSets(set, set, o) },
  { name: 'groupBy facet spec', path: 'facets[0]', key: 'size', base: () => ({ facet: 'locationCell', size: 1 }), run: (o) => ctx().groupBy(set, [o]) },
  { name: 'filter clause', path: 'clauses[0]', key: 'value', base: () => ({ facet: 'mode', op: 'eq', value: 'volume-overlap' }), run: (o) => ctx().filter(set, [o]) },
  { name: 'filter clause facet spec', path: 'clauses[0].facet', key: 'size', base: () => ({ facet: 'locationCell', size: 1 }), run: (o) => ctx().filter(set, [{ facet: o, op: 'notNull' }]) },
];

for (const L of LEVELS) {
  test(`M1 ${L.name}: the valid base bag is accepted (control)`, async () => { await attempt(() => L.run(L.base())); });

  test(`M1 ${L.name}: a symbol-keyed unknown key is InvalidOptionsError unknown-key`, async () => {
    const e = await ioe(() => L.run({ ...L.base(), [Symbol('x')]: 1 }), L.name);
    assert.deepEqual(codes(e), ['unknown-key']);
  });

  test(`M1 ${L.name}: a NON-ENUMERABLE unknown string key is InvalidOptionsError unknown-key (path names it)`, async () => {
    const e = await ioe(() => L.run(Object.defineProperty(L.base(), 'bogus', { value: 1, enumerable: false })), L.name);
    assert.deepEqual(e.issues.map((i) => [i.code, i.path]), [['unknown-key', `${L.path}.bogus`]]);
  });

  test(`M1 ${L.name}: a non-enumerable ALLOWED key is refused (data properties must be ordinary enumerable ones)`, async () => {
    const b = L.base(); const v = b[L.key]; delete b[L.key];
    const e = await ioe(() => L.run(Object.defineProperty(b, L.key, { value: v, enumerable: false })), L.name);
    assert.deepEqual(codes(e), ['bad-shape']);
  });

  test(`M1 ${L.name}: an accessor is refused and its getter is NEVER invoked`, async () => {
    let calls = 0; const v = L.base()[L.key];
    const b = L.base(); delete b[L.key];
    Object.defineProperty(b, L.key, { get() { calls += 1; return v; }, enumerable: true, configurable: true });
    const e = await ioe(() => L.run(b), L.name);
    assert.deepEqual(codes(e), ['bad-shape']);
    assert.equal(calls, 0, 'getter invoked');
    const s = L.base(); delete s[L.key];
    Object.defineProperty(s, L.key, { set() { calls += 1; }, enumerable: true });   // setter-only accessor: also not a data property
    await ioe(() => L.run(s), `${L.name} (setter-only)`);
    assert.equal(calls, 0);
  });

  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    test(`M1 ${L.name}: a Proxy whose ${trap} trap throws is InvalidOptionsError bad-shape; the trap's error never escapes`, async () => {
      const p = new Proxy(L.base(), { [trap]() { throw HOSTILE; } });
      const e = await ioe(() => L.run(p), `${L.name} ${trap}`);
      assert.deepEqual(codes(e), ['bad-shape']);
    });
  }

  test(`M1 ${L.name}: a revoked Proxy is InvalidOptionsError (never a raw TypeError)`, async () => {
    const { proxy, revoke } = Proxy.revocable(L.base(), {}); revoke();
    await ioe(() => L.run(proxy), L.name);
  });

  test(`M1 ${L.name}: a Proxy's get trap is never used — values are read once from own data descriptors`, async () => {
    let gets = 0;
    const p = new Proxy(L.base(), { get() { gets += 1; throw HOSTILE; } });
    await attempt(() => L.run(p));    // accepted: the descriptors are ordinary data properties
    assert.equal(gets, 0, 'get trap invoked');
    const q = new Proxy({ ...L.base(), bogus: 1 }, { get() { gets += 1; throw HOSTILE; } });
    const e = await ioe(() => L.run(q), L.name);
    assert.deepEqual(codes(e), ['unknown-key']);
    assert.equal(gets, 0, 'get trap invoked');
  });
}

// ---- the value USED is the value VALIDATED: a detached copy, never a re-read of the caller's object --------------------------
// A Proxy that reports one value through its own data descriptor and ANOTHER through `get` exposes any re-read.
const twoFaced = (target, lie) => new Proxy(target, { get: (t, k) => (Object.hasOwn(lie, k) ? lie[k] : Reflect.get(t, k)) });

test('M1 detached copy: compare tolerances are the captured values (descriptor), not a later read', async () => {
  const w = (p) => ({ evidence: { witness: { kind: 'surface-crossing', point: p } } });
  const base = makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]], ...w([1, 1, 1]) }] });
  const next = makeResultSet({ units: [U1], results: [{ pair: [['M', 100], ['M', 200]], ...w([1, 1, 1.5]) }] });
  const r = await ctx().compareResultSets(base, next, twoFaced({ pointTolerance: 1 }, { pointTolerance: 0 }));
  assert.equal(r.unchanged.length, 1, 'tolerance 1 (the validated value) must be the one used');
  const opts = { pointTolerance: 1 };
  const pending = ctx().compareResultSets(base, next, opts); opts.pointTolerance = 0;   // mutated right after the call
  assert.equal((await pending).unchanged.length, 1);
});

test('M1 detached copy: context limits are the captured values (descriptor), not a later read', async () => {
  const two = [{ facet: 'mode', op: 'notNull' }, { facet: 'mode', op: 'notNull' }];
  await assert.rejects(createContextInternal({ limits: twoFaced({ maxFilterClauses: 1 }, { maxFilterClauses: 100 }) }, {}).filter(set, two), InvalidOptionsError);
  await assert.rejects(createContextInternal(twoFaced({ limits: { maxFilterClauses: 1 } }, { limits: {} }), {}).filter(set, two), InvalidOptionsError);
  const limits = { maxFilterClauses: 1 }; const c = createContextInternal({ limits }, {}); limits.maxFilterClauses = 100;
  await assert.rejects(c.filter(set, two), InvalidOptionsError);
});

test('M1 detached copy: a facet spec param is the captured value (descriptor), not a later read', async () => {
  const control = await ctx().groupBy(set, [{ facet: 'locationCell', size: 1 }]);
  const lied = await ctx().groupBy(set, [twoFaced({ facet: 'locationCell', size: 1 }, { size: 1000 })]);
  assert.deepEqual(lied, control);
  assert.deepEqual(parseFacetSpec(twoFaced({ facet: 'distanceBucket', width: 2 }, { width: -1, facet: 'mode' })).params, { width: 2 });
  const spec = { facet: 'locationCell', size: 1 }; const pending = ctx().groupBy(set, [spec]); spec.size = 1000;
  assert.deepEqual(await pending, control);
});

test('M1 detached copy: a filter clause is the captured value (descriptor), not a later read', async () => {
  const r = await ctx().filter(set, [twoFaced({ facet: 'mode', op: 'eq', value: 'volume-overlap' }, { value: 'clearance', op: 'isNull' })]);
  assert.equal(r.count, 2);
  const clause = { facet: 'mode', op: 'eq', value: 'volume-overlap' }; const pending = ctx().filter(set, [clause]); clause.value = 'clearance';
  assert.equal((await pending).count, 2);
});

test('M1 detached copy: a method option signal is the captured AbortSignal reference, not a later read', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(ctx().summarize(set, twoFaced({ signal: ac.signal }, { signal: undefined })), (e) => e?.constructor?.name === 'DerivationAbortedError');
});

// ---- the argument ARRAYS (facets, clauses) are captured the same way ----------------------------------------------------------
for (const [name, run, path, good] of [
  ['groupBy facets', (a) => ctx().groupBy(set, a), 'facets', ['mode']],
  ['filter clauses', (a) => ctx().filter(set, a), 'clauses', [{ facet: 'mode', op: 'notNull' }]],
]) {
  for (const trap of ['ownKeys', 'getOwnPropertyDescriptor']) {   // arrays: no prototype test (as P0 canonicalJson), so no getPrototypeOf trap
    test(`M1 ${name}: an array Proxy whose ${trap} trap throws is InvalidOptionsError; the trap's error never escapes`, async () => {
      await ioe(() => run(new Proxy([...good], { [trap]() { throw HOSTILE; } })), `${name} ${trap}`);
    });
  }
  test(`M1 ${name}: a revoked array Proxy is InvalidOptionsError`, async () => {
    const { proxy, revoke } = Proxy.revocable([...good], {}); revoke();
    await ioe(() => run(proxy), name);
  });
  test(`M1 ${name}: an accessor element is refused and never invoked; the get trap is never used`, async () => {
    let calls = 0;
    const a = Object.defineProperty([], 0, { get() { calls += 1; return good[0]; }, enumerable: true });
    const e = await ioe(() => run(a), name);
    assert.deepEqual(e.issues.map((i) => [i.code, i.path]), [['bad-shape', `${path}[0]`]]);
    assert.equal(calls, 0);
    let gets = 0;
    await attempt(() => run(new Proxy([...good], { get() { gets += 1; throw HOSTILE; } })));
    assert.equal(gets, 0, 'get trap invoked');
  });
  test(`M1 ${name}: the array is captured once — emptying it right after the call changes nothing`, async () => {
    const control = await run([...good]);
    const a = [...good]; const pending = run(a); a.length = 0;
    assert.deepEqual(await pending, control);
  });
}
