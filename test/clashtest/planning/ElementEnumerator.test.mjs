// test/clashtest/planning/ElementEnumerator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENUMERATION_SCOPE_WHOLE, PLANNING_CAUSES,
  validateResolveRootsResult, validateDigestScopeResult, checkEnumeratorConformance,
} from '../../../clashtest/planning/ElementEnumerator.js';
import { createHash } from 'node:crypto';
import { EnumerationCancelledError } from '../../../clashtest/errors.js';
import { makeSyntheticEnumerator, conformanceCases } from '../support/syntheticModels.mjs';

const D = (label) => `sha256:${createHash('sha256').update(label).digest('hex')}`;   // a well-formed digest (spec 5.4: sha256:<64 lowercase hex>)
const okWhole = () => ({
  roots: [{ dbId: 1, fragmentCount: 2, ownerDbIds: [1, 5], subtreeDigest: D('aa') }],
  population: { count: 2, digest: D('bb') },
  ownerMismatch: { count: 0, first20: [] },
  unreachable: { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } },
  unresolved: [],
});
const codes = (r) => r.issues.map((i) => i.code);
const WHOLE = { scope: ENUMERATION_SCOPE_WHOLE };

test('accepts a well-formed whole-scope answer', () => {
  const r = validateResolveRootsResult(okWhole(), { scope: ENUMERATION_SCOPE_WHOLE });
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('rejects non-ascending roots, duplicate roots and non-ascending ownerDbIds', () => {
  const a = okWhole(); a.roots = [{ dbId: 5, fragmentCount: 1, ownerDbIds: [5], subtreeDigest: D('c') },
                                  { dbId: 1, fragmentCount: 1, ownerDbIds: [1], subtreeDigest: D('d') }];
  assert.deepEqual(validateResolveRootsResult(a, { scope: ENUMERATION_SCOPE_WHOLE }).issues.map(i => i.code),
    ['roots-not-ascending']);
  const b = okWhole(); b.roots[0].ownerDbIds = [5, 1];
  assert.deepEqual(validateResolveRootsResult(b, { scope: ENUMERATION_SCOPE_WHOLE }).issues.map(i => i.code),
    ['owners-not-ascending']);
});

test('a duplicated root or owner is not "ascending"; the roots issue is reported once however many follow', () => {
  const root = (dbId) => ({ dbId, fragmentCount: 1, ownerDbIds: [dbId], subtreeDigest: D('c') });
  const dup = okWhole(); dup.roots = [root(5), root(5)];
  assert.deepEqual(codes(validateResolveRootsResult(dup, WHOLE)), ['roots-not-ascending']);
  const many = okWhole(); many.roots = [root(5), root(1), root(2), root(3)];
  assert.deepEqual(codes(validateResolveRootsResult(many, WHOLE)), ['roots-not-ascending']);
  const dupOwner = okWhole(); dupOwner.roots[0].ownerDbIds = [1, 1];
  assert.deepEqual(codes(validateResolveRootsResult(dupOwner, WHOLE)), ['owners-not-ascending']);
});

test('per-field shape defects are reported with a path and a code, never thrown', () => {
  for (const bad of [null, undefined, 'x', 7, []]) {
    const r = validateResolveRootsResult(bad, WHOLE);
    assert.equal(r.ok, false);
  }
  assert.deepEqual(validateResolveRootsResult(null, WHOLE).issues, [{ path: '/', code: 'not-an-object' }]);
  const a = okWhole(); a.roots = 'nope';
  assert.deepEqual(validateResolveRootsResult(a, WHOLE).issues, [{ path: '/roots', code: 'not-an-array' }]);
  const b = okWhole(); b.roots[0] = { dbId: -1, fragmentCount: 1.5, ownerDbIds: 'x', subtreeDigest: 'md5:zz' };
  assert.deepEqual(validateResolveRootsResult(b, WHOLE).issues, [
    { path: '/roots/0/dbId', code: 'not-a-dbid' },
    { path: '/roots/0/fragmentCount', code: 'not-a-count' },
    { path: '/roots/0/subtreeDigest', code: 'not-a-digest' },
    { path: '/roots/0/ownerDbIds', code: 'not-an-array' },
  ]);
  const c = okWhole(); c.roots[0].ownerDbIds = [1, 'a'];
  assert.deepEqual(codes(validateResolveRootsResult(c, WHOLE)), ['not-a-dbid']);
  const d = okWhole(); d.roots = [null];
  assert.deepEqual(validateResolveRootsResult(d, WHOLE).issues, [{ path: '/roots/0', code: 'not-an-object' }]);
});

test('whole-only fields are required for whole and forbidden for explicit scopes', () => {
  const noPop = okWhole(); noPop.population = null;
  assert.ok(validateResolveRootsResult(noPop, { scope: ENUMERATION_SCOPE_WHOLE })
    .issues.some(i => i.code === 'population-required'));
  const explicitOk = { roots: okWhole().roots, population: null, ownerMismatch: null, unreachable: null, unresolved: [] };
  assert.equal(validateResolveRootsResult(explicitOk, { scope: { dbIds: [1] } }).ok, true);
  const explicitBad = { ...explicitOk, population: { count: 1, digest: D('x') } };
  assert.ok(validateResolveRootsResult(explicitBad, { scope: { dbIds: [1] } })
    .issues.some(i => i.code === 'population-forbidden'));
});

test('every whole-only field is individually required (whole) and forbidden (explicit)', () => {
  const whole = (mut) => { const r = okWhole(); mut(r); return codes(validateResolveRootsResult(r, WHOLE)); };
  assert.deepEqual(whole((r) => { r.ownerMismatch = null; }), ['required']);
  assert.deepEqual(whole((r) => { r.unreachable = null; }), ['required']);
  assert.deepEqual(whole((r) => { r.unreachable.unattributable = { notLoaded: 1 }; }), ['malformed']);
  assert.deepEqual(whole((r) => { r.unreachable.ownerDbIds = [9, 3]; r.unreachable.count = 2; }), ['owners-not-ascending']);
  assert.deepEqual(whole((r) => { r.ownerMismatch.count = -1; }), ['not-a-count']);
  assert.deepEqual(whole((r) => { r.population.digest = 'plain'; }), ['not-a-digest']);
  assert.deepEqual(whole((r) => { r.unresolved = [{ dbId: 4, reason: 'not-found' }]; }), ['unresolved-forbidden']);
  const explicit = (mut) => {
    const r = { roots: okWhole().roots, population: null, ownerMismatch: null, unreachable: null, unresolved: [] };
    mut(r); return codes(validateResolveRootsResult(r, { scope: { dbIds: [1, 4, 5] } }));
  };
  assert.deepEqual(explicit((r) => { r.ownerMismatch = okWhole().ownerMismatch; }), ['owner-mismatch-forbidden']);
  assert.deepEqual(explicit((r) => { r.unreachable = okWhole().unreachable; }), ['unreachable-forbidden']);
  assert.deepEqual(explicit((r) => { r.unresolved = [{ dbId: 4, reason: 'not-found' }, { dbId: 5, reason: 'no-fragments' }]; }), []);
  assert.deepEqual(explicit((r) => { r.unresolved = [{ dbId: 4, reason: 'gone' }]; }), ['unknown-reason']);
  assert.deepEqual(explicit((r) => { r.unresolved = [null]; }), ['not-a-dbid', 'unknown-reason']);
  assert.deepEqual(explicit((r) => { r.unresolved = 'x'; }), ['not-an-array']);
});

test('validateDigestScopeResult checks both answer shapes against the requested scope', () => {
  const pop = { kind: 'population', count: 3, digest: D('p') };
  const roots = { kind: 'roots', roots: [{ dbId: 1, fragmentCount: 2, subtreeDigest: D('a') },
                                         { dbId: 4, fragmentCount: 1, subtreeDigest: D('b') }] };
  assert.deepEqual(validateDigestScopeResult(pop, WHOLE), { ok: true, issues: [] });
  assert.deepEqual(validateDigestScopeResult(roots, { scope: { dbIds: [1, 4] } }), { ok: true, issues: [] });
  // an extra field such as digestVersion is tolerated (P3.2's digestPopulation adds it)
  assert.equal(validateDigestScopeResult({ ...pop, digestVersion: 1 }, WHOLE).ok, true);
  // wrong kind for the scope
  assert.deepEqual(codes(validateDigestScopeResult(roots, WHOLE)), ['kind-mismatch']);
  assert.deepEqual(codes(validateDigestScopeResult(pop, { scope: { dbIds: [1] } })), ['kind-mismatch']);
  // population defects
  assert.deepEqual(codes(validateDigestScopeResult({ kind: 'population', count: -1, digest: 'x' }, WHOLE)),
    ['not-a-count', 'not-a-digest']);
  // roots defects
  const desc = { kind: 'roots', roots: [...roots.roots].reverse() };
  assert.deepEqual(codes(validateDigestScopeResult(desc, { scope: { dbIds: [1, 4] } })), ['roots-not-ascending']);
  const bad = { kind: 'roots', roots: [{ dbId: 'a', fragmentCount: 1, subtreeDigest: D('a') }] };
  assert.deepEqual(codes(validateDigestScopeResult(bad, { scope: { dbIds: [1] } })), ['not-a-dbid']);
  assert.deepEqual(codes(validateDigestScopeResult({ kind: 'roots', roots: 'x' }, { scope: { dbIds: [1] } })), ['not-an-array']);
  for (const junk of [null, undefined, 4, 'x']) assert.equal(validateDigestScopeResult(junk, WHOLE).ok, false);
});

test('the planning-cause enum is exactly the spec §6.6 list', () => {
  assert.deepEqual([...PLANNING_CAUSES].sort(), [
    'cancelled', 'definition-invalid', 'element-unresolvable', 'enumeration-failed',
    'hierarchy-overlap', 'migration-failed', 'model-not-bound', 'owner-mapping-mismatch',
    'plan-too-large', 'schema-unsupported', 'test-unavailable', 'world-disposed',
  ]);
  assert.equal(Object.isFrozen(PLANNING_CAUSES), true);
  assert.equal(ENUMERATION_SCOPE_WHOLE, 'whole');
});

test('the synthetic fake enumerator passes the conformance suite', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  const { failures } = await checkEnumeratorConformance({ enumerator, binding, cases: conformanceCases() });
  assert.deepEqual(failures, []);
});

test('conformance reports, never throws, for a non-cooperating enumerator', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models, { ignoreCheckpoint: true });
  const { failures } = await checkEnumeratorConformance({ enumerator, binding, cases: conformanceCases() });
  assert.ok(failures.some(f => f.includes('checkpoint')));
  // pinned separately: the per-slice checkpoint COUNT check, not just the cancellation one
  assert.ok(failures.some(f => f.includes('at least once per slice')), failures.join('\n'));
});

// ---------------------------------------------------------------------------
// The helper is only worth having if a defective enumerator is CAUGHT and REPORTED. Each case wraps
// the conforming synthetic enumerator with exactly one defect.
// ---------------------------------------------------------------------------
const conform = async (wrap) => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  return (await checkEnumeratorConformance({ enumerator: wrap(enumerator), binding, cases: conformanceCases() })).failures;
};

test('conformance catches a throwing enumerator, a malformed answer and an unstable answer, without throwing', async () => {
  const thrower = await conform((e) => ({ ...e, resolveRoots: async () => { throw new Error('tree unavailable'); } }));
  assert.ok(thrower.length > 0 && thrower.every((f) => f.startsWith('resolveRoots(')), thrower.join('\n'));
  assert.ok(thrower.some((f) => f.includes('threw Error')));

  const malformed = await conform((e) => ({ ...e, resolveRoots: async (b, s, c) => {
    const r = await e.resolveRoots(b, s, c); return { ...r, roots: [...r.roots].reverse() }; } }));
  assert.ok(malformed.some((f) => f.includes('shape') && f.includes('roots-not-ascending')), malformed.join('\n'));

  let n = 0;
  const unstable = await conform((e) => ({ ...e, resolveRoots: async (b, s, c) => {
    const r = await e.resolveRoots(b, s, c);
    return n++ % 2 === 0 ? r : { ...r, roots: r.roots.map((x) => ({ ...x, subtreeDigest: D('other') })) }; } }));
  assert.ok(unstable.some((f) => f.includes('not stable across calls')), unstable.join('\n'));
});

test('conformance catches a throwing second call and a throwing digestScope, still without throwing', async () => {
  let calls = 0;
  const secondCallThrows = await conform((e) => ({ ...e, resolveRoots: async (b, s, c) => {
    if (++calls % 2 === 0) throw new Error('flaky'); return e.resolveRoots(b, s, c); } }));
  assert.ok(secondCallThrows.length > 0);
  const digestThrows = await conform((e) => ({ ...e, digestScope: async () => { throw new Error('nope'); } }));
  assert.ok(digestThrows.some((f) => f.startsWith('digestScope(') && f.includes('threw Error')), digestThrows.join('\n'));
});

test('conformance catches digestScope disagreeing with resolveRoots (population and subtree)', async () => {
  const pop = await conform((e) => ({ ...e, digestScope: async (b, s, c) => {
    const d = await e.digestScope(b, s, c);
    return d.kind === 'population' ? { ...d, digest: D('moved') } : d; } }));
  assert.ok(pop.some((f) => f.includes('disagrees with resolveRoots population')), pop.join('\n'));
  const sub = await conform((e) => ({ ...e, digestScope: async (b, s, c) => {
    const d = await e.digestScope(b, s, c);
    return d.kind === 'roots' ? { ...d, roots: d.roots.map((r) => ({ ...r, subtreeDigest: D('moved') })) } : d; } }));
  assert.ok(sub.some((f) => f.includes('subtreeDigest differs')), sub.join('\n'));
  const dropped = await conform((e) => ({ ...e, digestScope: async (b, s, c) => {
    const d = await e.digestScope(b, s, c);
    return d.kind === 'roots' ? { ...d, roots: d.roots.slice(1) } : d; } }));
  assert.ok(dropped.some((f) => f.includes('roots differ')), dropped.join('\n'));
});

test('conformance catches an enumerator that swallows a checkpoint cancellation, sync or async', async () => {
  const swallow = (e) => ({ ...e,
    resolveRoots: async (b, s, c) => e.resolveRoots(b, s, { checkpoint: async () => { try { await c.checkpoint(); } catch { /* swallowed */ } } }) });
  const failures = await conform(swallow);
  assert.ok(failures.some((f) => f.includes('swallowed EnumerationCancelledError')), failures.join('\n'));
});

test('conformance catches an enumerator that only honours a SYNCHRONOUS checkpoint throw', async () => {
  // drops the promise checkpoint() returned (a fire-and-forget checkpoint), so an async cancellation is lost
  const syncOnly = (e) => ({ ...e, resolveRoots: (b, s, c) => e.resolveRoots(b, s, {
    checkpoint() { const p = c.checkpoint(); if (p && typeof p.catch === 'function') p.catch(() => {}); } }) });
  const failures = await conform(syncOnly);
  assert.ok(failures.some((f) => f.includes('async rejection')), failures.join('\n'));
  assert.ok(!failures.some((f) => f.includes('sync throw')), failures.join('\n'));
});

test('the synthetic enumerator propagates cancellation unwrapped (sync throw and async rejection)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  const boom = new EnumerationCancelledError({ reason: 'cancelled' });
  await assert.rejects(() => enumerator.resolveRoots(binding, 'whole', { checkpoint() { throw boom; } }), (e) => e === boom);
  await assert.rejects(() => enumerator.digestScope(binding, 'whole', { checkpoint: async () => { throw boom; } }), (e) => e === boom);
});

test('the optional `checkpoint` hook is invoked by every counted checkpoint and may be async', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  let hits = 0;
  const { failures } = await checkEnumeratorConformance({ enumerator, binding, cases: conformanceCases(),
    checkpoint: async () => { hits++; } });
  assert.deepEqual(failures, []);
  assert.ok(hits > 0);
});

// ---------------------------------------------------------------------------
// The synthetic fixture is what every later P3 test plans over, so its own semantics are pinned here.
// ---------------------------------------------------------------------------
test('synthetic enumerator: whole scope answers roots, population, unreachable and ownerMismatch per the spec shapes', async () => {
  const cases = conformanceCases();
  const spec = { ...cases.models[0], ownerMismatchCount: 25 };
  const { enumerator, binding, bindings } = makeSyntheticEnumerator([spec, { modelKey: 'other', roots: [] }]);
  assert.equal(binding.modelKey, 'conf');
  assert.deepEqual([...bindings.keys()], ['conf', 'other']);
  const res = await enumerator.resolveRoots(binding, 'whole', { checkpoint() {} });
  assert.equal(validateResolveRootsResult(res, WHOLE).ok, true);
  assert.deepEqual(res.roots.map((r) => [r.dbId, r.fragmentCount, r.ownerDbIds]), [[10, 2, [10, 11]], [20, 1, [20]], [30, 1, [30]]]);
  assert.equal(res.population.count, 7);                                    // 4 root fragments + 3 unreachable records
  // unreachable: count = class-L entries with a numeric owner; N / U are counted only, unattributably
  assert.deepEqual(res.unreachable, { count: 1, ownerDbIds: [11], unattributable: { notLoaded: 1, ownerUnresolvable: 1 } });
  assert.equal(res.ownerMismatch.count, 25);
  assert.equal(res.ownerMismatch.first20.length, 20);
  assert.deepEqual(res.unresolved, []);
  // an empty model resolves too
  const empty = await enumerator.resolveRoots(bindings.get('other'), 'whole', { checkpoint() {} });
  assert.deepEqual([empty.roots, empty.population.count, empty.unreachable.count], [[], 0, 0]);
});

test('synthetic enumerator: explicit lists reduce to an antichain and split unresolved into not-found / no-fragments', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(conformanceCases().models);
  const ask = (dbIds) => enumerator.resolveRoots(binding, { dbIds }, { checkpoint() {} });
  // a listed dbId with a listed ancestor is dropped
  assert.deepEqual((await ask([11, 10])).roots.map((r) => r.dbId), [10]);
  // a nested node listed alone is its own root, over exactly its own fragments
  const nested = (await ask([11])).roots;
  assert.deepEqual(nested.map((r) => [r.dbId, r.fragmentCount, r.ownerDbIds]), [[11, 1, [11]]]);
  // its digest is that of the whole-scope root 10's fragments for owner 11 only
  const whole = await enumerator.resolveRoots(binding, 'whole', { checkpoint() {} });
  assert.notEqual(nested[0].subtreeDigest, whole.roots.find((r) => r.dbId === 10).subtreeDigest);
  const mixed = await ask([777, 55, 20]);
  assert.deepEqual(mixed.unresolved, [{ dbId: 55, reason: 'no-fragments' }, { dbId: 777, reason: 'not-found' }]);
  assert.deepEqual(mixed.roots.map((r) => r.dbId), [20]);
  assert.deepEqual([mixed.population, mixed.ownerMismatch, mixed.unreachable], [null, null, null]);
  // a dbId the spec never mentions is not a node
  assert.deepEqual((await ask([4242])).unresolved, [{ dbId: 4242, reason: 'not-found' }]);
  // digestScope reads the same roots, without the unresolved list
  assert.deepEqual(await enumerator.digestScope(binding, { dbIds: [11, 10] }, { checkpoint() {} }),
    { kind: 'roots', roots: (await ask([10])).roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })) });
});

test('synthetic enumerator: cooperates by default (one awaited checkpoint per call), ignores ctx when told to, rejects unknown models', async () => {
  const cases = conformanceCases();
  const coop = makeSyntheticEnumerator(cases.models);
  let n = 0;
  await coop.enumerator.resolveRoots(coop.binding, 'whole', { checkpoint: async () => { n++; } });
  assert.equal(n, 1);
  const rude = makeSyntheticEnumerator(cases.models, { ignoreCheckpoint: true });
  n = 0;
  await rude.enumerator.resolveRoots(rude.binding, 'whole', { checkpoint: () => { n++; } });
  assert.equal(n, 0);
  await assert.rejects(() => coop.enumerator.resolveRoots({ modelKey: 'nope' }, 'whole', { checkpoint() {} }), /unknown model nope/);
  // replaceModel simulates a change between planning and execution
  const before = await coop.enumerator.digestScope(coop.binding, 'whole', { checkpoint() {} });
  coop.enumerator.replaceModel({ ...cases.models[0], unreachable: [] });
  assert.notEqual((await coop.enumerator.digestScope(coop.binding, 'whole', { checkpoint() {} })).digest, before.digest);
});

test('an explicit answer is about the requested dbIds only (root-not-requested, unresolved-not-requested, resolved-and-unresolved)', () => {
  const answer = (roots, unresolved = []) => ({ roots, population: null, ownerMismatch: null, unreachable: null, unresolved });
  const root = (dbId) => ({ dbId, fragmentCount: 1, ownerDbIds: [dbId], subtreeDigest: D('r') });
  const scope = { scope: { dbIds: [1, 4] } };
  assert.deepEqual(codes(validateResolveRootsResult(answer([root(2)]), scope)), ['root-not-requested']);
  assert.deepEqual(codes(validateResolveRootsResult(answer([root(1)], [{ dbId: 9, reason: 'not-found' }]), scope)), ['unresolved-not-requested']);
  assert.deepEqual(codes(validateResolveRootsResult(answer([root(1)], [{ dbId: 1, reason: 'not-found' }]), scope)), ['resolved-and-unresolved']);
  assert.deepEqual(codes(validateResolveRootsResult(answer([root(1)], [{ dbId: 4, reason: 'no-fragments' }]), scope)), []);
});

test('a whole answer that lists unreachable owners without counting fragments is self-contradicting, and digests must be sha256:<64 hex>', () => {
  const w = (mut) => { const r = okWhole(); mut(r); return codes(validateResolveRootsResult(r, WHOLE)); };
  assert.deepEqual(w((r) => { r.unreachable = { count: 0, ownerDbIds: [99], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }; }), ['owners-exceed-count']);
  assert.deepEqual(w((r) => { r.unreachable = { count: 1, ownerDbIds: [99], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } }; }), []);
  assert.deepEqual(w((r) => { r.population.digest = 'sha256:x'; }), ['not-a-digest']);
  assert.deepEqual(w((r) => { r.roots[0].subtreeDigest = `sha256:${'A'.repeat(64)}`; }), ['not-a-digest']);
  assert.deepEqual(w((r) => { r.ownerMismatch = { count: 0, first20: [{ dbId: 1 }] }; }), ['malformed']);
});

// ---------------------------------------------------------------------------
// H4 (P3 independent review): an explicit answer's `unresolved` ids are strictly ascending and unique, exactly like
// its `roots` -- P3's own plan says "ascending" and P5's pinned `UnresolvedSelection.dbIds` is `dbId[] unique`.
// ---------------------------------------------------------------------------
test('H4: unresolved ids must be strictly ascending and unique, reported once per list (explicit scopes)', () => {
  const scope = { scope: { dbIds: [1, 4, 5, 9] } };
  const explicit = (unresolved, roots = []) => codes(validateResolveRootsResult(
    { roots, population: null, ownerMismatch: null, unreachable: null, unresolved }, scope));
  const nf = (dbId) => ({ dbId, reason: 'not-found' });
  const nofrag = (dbId) => ({ dbId, reason: 'no-fragments' });
  // the accepted shapes: empty, one, strictly ascending (either reason, mixed)
  assert.deepEqual(explicit([]), []);
  assert.deepEqual(explicit([nofrag(4)]), []);
  assert.deepEqual(explicit([nf(4), nofrag(5), nf(9)]), []);
  // a duplicate id, whatever its reason
  assert.deepEqual(explicit([nofrag(4), nofrag(4)]), ['unresolved-not-ascending']);
  assert.deepEqual(explicit([nf(4), nofrag(4)]), ['unresolved-not-ascending']);
  // a descent
  assert.deepEqual(explicit([nofrag(5), nofrag(4)]), ['unresolved-not-ascending']);
  // several defects in the same list still add ONE issue for the list (not one per following row), at the list path
  const many = validateResolveRootsResult({ roots: [], population: null, ownerMismatch: null, unreachable: null,
    unresolved: [nf(9), nf(5), nf(5), nf(4), nf(1)] }, scope);
  assert.deepEqual(many.issues, [{ path: '/unresolved', code: 'unresolved-not-ascending' }]);
  assert.equal(many.ok, false);
  // rows that are already reported as not-a-dbid do not additionally read as unordered
  assert.deepEqual(explicit([nf(4), { dbId: 'x', reason: 'not-found' }, nf(5)]), ['not-a-dbid']);
  // it is independent of the other explicit-scope rules (root-not-requested etc. still fire alongside)
  assert.deepEqual(explicit([nf(9), nf(4)], [{ dbId: 1, fragmentCount: 1, ownerDbIds: [1], subtreeDigest: D('r') }]),
    ['unresolved-not-ascending']);
});

test('H4: a whole answer is untouched (unresolved must be empty there)', () => {
  const w = okWhole(); w.unresolved = [{ dbId: 4, reason: 'no-fragments' }, { dbId: 4, reason: 'no-fragments' }];
  assert.deepEqual(codes(validateResolveRootsResult(w, WHOLE)), ['unresolved-forbidden']);
});

test('H4: conformance reports (never throws for) an enumerator whose explicit answer repeats or misorders an unresolved id', async () => {
  const dup = await conform((e) => ({ ...e, resolveRoots: async (b, s, c) => {
    const r = await e.resolveRoots(b, s, c);
    return r.unresolved.length > 0 ? { ...r, unresolved: [...r.unresolved, ...r.unresolved] } : r; } }));
  assert.ok(dup.some((f) => f.includes('shape') && f.includes('/unresolved:unresolved-not-ascending')), dup.join('\n'));
  const reversedTwo = await conform((e) => ({ ...e, resolveRoots: async (b, s, c) => {
    const r = await e.resolveRoots(b, s, c);
    return r.unresolved.length > 0 ? { ...r, unresolved: [{ dbId: 900, reason: 'not-found' }, ...r.unresolved] } : r; } }));
  assert.ok(reversedTwo.some((f) => f.includes('/unresolved:unresolved-not-ascending')), reversedTwo.join('\n'));
  // and the conforming synthetic enumerator is still clean
  assert.deepEqual(await conform((e) => e), []);
});
