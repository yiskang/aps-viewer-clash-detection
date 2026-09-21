// test/clashtest/planning/scopeDigest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POPULATION_CLASS, encodePopulationRecords, digestPopulation, digestSubtree,
  compareScopeExpectation, checkScopeBracket,
} from '../../../clashtest/planning/scopeDigest.js';
import { DIGEST_VERSION, DIGEST_PREFIX } from '../../../clashtest/util/canonical.js';
import { createSlicer } from '../../../clashtest/util/slicer.js';
import { EnumerationCancelledError } from '../../../clashtest/errors.js';
import { makeSyntheticEnumerator, makeSyntheticBinding, conformanceCases } from '../support/syntheticModels.mjs';
import { checkEnumeratorConformance } from '../../../clashtest/planning/ElementEnumerator.js';

const pop = (over = {}) => ({
  count: 4,
  records: [
    { fragId: 0, cls: 'L', ownerDbId: 10, geometryId: 7 },
    { fragId: 1, cls: 'N' },
    { fragId: 2, cls: 'U' },
    { fragId: 3, cls: 'L', ownerDbId: 11, geometryId: 7 },
  ],
  ...over,
});

test('population records encode exactly the three §6.2.1 shapes, ascending', () => {
  assert.deepEqual(encodePopulationRecords(pop().records), [
    [0, 'L', 10, 7], [1, 'N'], [2, 'U'], [3, 'L', 11, 7],
  ]);
  assert.deepEqual(POPULATION_CLASS, { LOADED: 'L', NOT_LOADED: 'N', OWNER_UNRESOLVABLE: 'U' });
  assert.equal(Object.isFrozen(POPULATION_CLASS), true);
});

test('encoding sorts a copy by fragId, drops stray fields on N/U, and rejects malformed records', () => {
  const input = [{ fragId: 9, cls: 'N', ownerDbId: 5, geometryId: 1 }, { fragId: 2, cls: 'L', ownerDbId: 1, geometryId: 1 }];
  assert.deepEqual(encodePopulationRecords(input), [[2, 'L', 1, 1], [9, 'N']]);
  assert.equal(input[0].fragId, 9, 'the caller\'s array is not reordered');
  assert.throws(() => encodePopulationRecords([{ fragId: 0, cls: 'X' }]), TypeError);
  assert.throws(() => encodePopulationRecords([{ fragId: 0, cls: 'L', geometryId: 1 }]), TypeError);
  assert.throws(() => encodePopulationRecords([{ fragId: 0, cls: 'L', ownerDbId: 1 }]), TypeError);
  assert.throws(() => encodePopulationRecords([{ fragId: -1, cls: 'N' }]), TypeError);
});

test('every mutation class changes the population digest', async () => {
  const base = (await digestPopulation(pop())).digest;
  const mutations = {
    'status flip': (p) => { p.records[1] = { fragId: 1, cls: 'L', ownerDbId: 10, geometryId: 7 }; },
    'owner change': (p) => { p.records[0].ownerDbId = 12; },
    'count-preserving geometry replacement': (p) => { p.records[0].geometryId = 8; },
    growth: (p) => { p.records.push({ fragId: 4, cls: 'L', ownerDbId: 12, geometryId: 9 }); p.count = 5; },
    shrink: (p) => { p.records.pop(); p.count = 3; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = pop(); mutate(p);
    assert.notEqual((await digestPopulation(p)).digest, base, name);
  }
});

test('the population digest is fixed on content: order-insensitive on input, and a durable format', async () => {
  const a = await digestPopulation(pop());
  const b = await digestPopulation(pop({ records: [...pop().records].reverse() }));
  assert.equal(a.digest, b.digest);
  assert.equal(a.kind, 'population');
  assert.equal(a.count, 4);
  assert.equal(a.digestVersion, DIGEST_VERSION);
  assert.ok(a.digest.startsWith(DIGEST_PREFIX));
  // `count` is part of what is digested (spec 6.2.1: the digest covers count AND the record list)
  assert.notEqual((await digestPopulation(pop({ count: 5 }))).digest, a.digest);
  // an N record and a U record at the same fragId are different classes
  const n = await digestPopulation({ count: 1, records: [{ fragId: 0, cls: 'N' }] });
  const u = await digestPopulation({ count: 1, records: [{ fragId: 0, cls: 'U' }] });
  assert.notEqual(n.digest, u.digest);
});

test('subtree digest is order-insensitive on input but fixed on content', async () => {
  const recs = [{ fragId: 5, ownerDbId: 2, geometryId: 1 }, { fragId: 4, ownerDbId: 2, geometryId: 1 }];
  const a = await digestSubtree(recs);
  const b = await digestSubtree([...recs].reverse());
  assert.equal(a.digest, b.digest);
  assert.equal(a.digestVersion, 1);
  const c = await digestSubtree([{ fragId: 5, ownerDbId: 3, geometryId: 1 }, recs[1]]);
  assert.notEqual(c.digest, a.digest);
});

test('every subtree mutation class changes the subtree digest, and a subtree never equals a population', async () => {
  const recs = () => [{ fragId: 4, ownerDbId: 2, geometryId: 1 }, { fragId: 5, ownerDbId: 2, geometryId: 1 }];
  const base = (await digestSubtree(recs())).digest;
  const mutations = {
    'geometry replacement': (r) => { r[0].geometryId = 2; },
    'owner change': (r) => { r[1].ownerDbId = 3; },
    'fragment id change': (r) => { r[1].fragId = 6; },
    growth: (r) => { r.push({ fragId: 6, ownerDbId: 2, geometryId: 1 }); },
    shrink: (r) => { r.pop(); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const r = recs(); mutate(r);
    assert.notEqual((await digestSubtree(r)).digest, base, name);
  }
  // domain separation: identical row lists under the two kinds never collide
  const asPopulation = await digestPopulation({ count: 2, records: recs().map((r) => ({ ...r, cls: 'L' })) });
  assert.notEqual(asPopulation.digest, base);
});

test('the sliced path is byte-identical to the synchronous one and really slices', async () => {
  const records = Array.from({ length: 900 }, (_, i) => ({ fragId: i, cls: 'L', ownerDbId: 100 + (i % 7), geometryId: i % 13 }));
  const plain = await digestPopulation({ count: records.length, records });
  let ticks = 0; const labels = new Set();
  const slicer = { tick(label) { ticks++; labels.add(label); return undefined; } };
  const sliced = await digestPopulation({ count: records.length, records }, { slicer });
  assert.deepEqual(sliced, plain);
  assert.ok(ticks > 0, 'a large population ticks the slicer');
  assert.deepEqual([...labels], ['digest-population']);
  const subRecords = records.map(({ fragId, ownerDbId, geometryId }) => ({ fragId, ownerDbId, geometryId }));
  ticks = 0; labels.clear();
  assert.deepEqual(await digestSubtree(subRecords, { slicer }), await digestSubtree(subRecords));
  assert.ok(ticks > 0);
  assert.deepEqual([...labels], ['digest-subtree']);
  // a real P0 slicer also works, and a due tick (a Promise) is awaited
  let yields = 0;
  const real = createSlicer({ yieldToScheduler: async () => { yields++; }, maxItemsPerSlice: 1 });
  assert.deepEqual(await digestPopulation({ count: records.length, records }, { slicer: real }), plain);
  assert.ok(yields > 0);
});

test('compareScopeExpectation brackets whole-model and root scopes', () => {
  const expect = { modelKey: 'm', role: 'target', scope: 'whole', population: { count: 2, digest: 'sha256:a' } };
  assert.equal(compareScopeExpectation(expect, { kind: 'population', count: 2, digest: 'sha256:a' }).status, 'equal');
  assert.equal(compareScopeExpectation(expect, { kind: 'population', count: 2, digest: 'sha256:b' }).status, 'mismatch');
  assert.equal(compareScopeExpectation(expect, null).status, 'unverifiable');
  const rootsExpect = { modelKey: 'm', role: 'source', scope: 'roots',
    roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }, { dbId: 2, subtreeDigest: 'sha256:y' }] };
  assert.equal(compareScopeExpectation(rootsExpect,
    { kind: 'roots', roots: [{ dbId: 2, subtreeDigest: 'sha256:y' }, { dbId: 1, subtreeDigest: 'sha256:x' }] }).status,
    'equal');
  assert.equal(compareScopeExpectation(rootsExpect,
    { kind: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }] }).status, 'mismatch');
});

test('compareScopeExpectation is exact, never collapses mismatch into unverifiable, and echoes model and role', () => {
  const whole = { modelKey: 'm', role: 'target', scope: 'whole', population: { count: 2, digest: 'sha256:a' } };
  // count alone differing (same digest string) is still a mismatch: no counts-only or digest-only shortcut
  assert.deepEqual(compareScopeExpectation(whole, { kind: 'population', count: 3, digest: 'sha256:a' }),
    { modelKey: 'm', role: 'target', status: 'mismatch', detail: 'population' });
  assert.deepEqual(compareScopeExpectation(whole, { kind: 'population', count: 2, digest: 'sha256:a' }),
    { modelKey: 'm', role: 'target', status: 'equal', detail: null });
  assert.deepEqual(compareScopeExpectation(whole, undefined),
    { modelKey: 'm', role: 'target', status: 'unverifiable', detail: 'no-observation' });
  // the wrong KIND of observation cannot prove or disprove anything
  assert.equal(compareScopeExpectation(whole, { kind: 'roots', roots: [] }).status, 'unverifiable');
  const roots = { modelKey: 'm', role: 'source', scope: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }] };
  assert.equal(compareScopeExpectation(roots, { kind: 'population', count: 1, digest: 'sha256:x' }).status, 'unverifiable');
  // a same-length observation with a different root set or a different digest mismatches, naming the root
  assert.deepEqual(compareScopeExpectation(roots, { kind: 'roots', roots: [{ dbId: 2, subtreeDigest: 'sha256:x' }] }),
    { modelKey: 'm', role: 'source', status: 'mismatch', detail: 'root:1' });
  assert.deepEqual(compareScopeExpectation(roots, { kind: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:MOVED' }] }),
    { modelKey: 'm', role: 'source', status: 'mismatch', detail: 'root:1' });
  assert.equal(compareScopeExpectation(roots, { kind: 'roots', roots: [] }).detail, 'root-count');
  // a duplicated observed root cannot stand in for a missing one
  const two = { ...roots, roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }, { dbId: 2, subtreeDigest: 'sha256:y' }] };
  assert.equal(compareScopeExpectation(two, { kind: 'roots', roots: [
    { dbId: 1, subtreeDigest: 'sha256:x' }, { dbId: 1, subtreeDigest: 'sha256:x' }] }).status, 'mismatch');
  // garbage in the observation fails closed as unverifiable rather than throwing
  assert.equal(compareScopeExpectation(roots, { kind: 'roots', roots: 'x' }).status, 'unverifiable');
  assert.equal(compareScopeExpectation(roots, { kind: 'roots', roots: [null] }).status, 'unverifiable');
  assert.equal(compareScopeExpectation(roots, 'population').status, 'unverifiable');
});

test('role is an opaque label: any string flows through identical code paths (P6 O8)', () => {
  for (const role of ['source', 'target', 'recorded', 'anything']) {
    const e = { modelKey: 'm', role, scope: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }] };
    const ok = compareScopeExpectation(e, { kind: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x' }] });
    assert.deepEqual([ok.status, ok.role], ['equal', role]);
    assert.equal(compareScopeExpectation(e, { kind: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:y' }] }).status, 'mismatch');
  }
});

// ---------------------------------------------------------------------------
// checkScopeBracket — the four cases inherited from P6's deleted
// test/clashtest/run/scopeBracket.test.mjs (duplicate-ownership D1).
// `bindings` is a `Map<modelKey, Binding|null>` the CALLER builds from P1's
// positional `snapshotBindings(keys).bindings` array (R7): P4 passes
// `resolved.byKey`, P6 passes `new Map(keys.map((k, i) => [k, snap.bindings[i]]))`.
// Per reconciliation N10 a Binding has NO `dead` flag — dead, unregistered and
// lease-invalid all read as `null`, which is the only fail-closed reading, and an
// absent key reads as `null` too.
// ---------------------------------------------------------------------------

const scopedEnumerator = (state) => ({
  state,
  setState(next) { this.state = next; },
  async digestScope(binding, scope, ctx) {
    ctx.checkpoint();
    const m = this.state[binding.modelKey];
    if (m?.throws) throw m.throws;
    return scope === 'whole'
      ? { kind: 'population', count: m.population.count, digest: m.population.digest }
      : { kind: 'roots', roots: m.roots.filter((r) => scope.dbIds.includes(r.dbId)) };
  },
});
const bindingOf = (modelKey) => ({ modelKey, model: {}, modelVersion: 'v1',
  lease: { model: {}, epoch: 1 }, bindingGeneration: 1, placementGeneration: 1 });
// The caller-built `Map<modelKey, Binding|null>` every `checkScopeBracket` call takes.
const bindingsOf = (entries) => new Map(Object.entries(entries));

test('an all-equal bracket reports equal and names no model', async () => {
  const expect = [{ modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] }];
  const enumerator = scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] } });
  const got = await checkScopeBracket(expect, { enumerator, bindings: bindingsOf({ M: bindingOf('M') }), ctx: { checkpoint() {} } });
  assert.deepEqual(got, { proof: 'equal', modelKeys: [] });
});

test('unchanged root subtrees with a MOVED population report drift naming the model (R20-1)', async () => {
  // The exact R20-1 shape: every source-root subtreeDigest is unchanged; only the population moved.
  const expect = [
    { modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] },
    { modelKey: 'M', role: 'source', scope: 'whole', population: { count: 12, digest: 'sha256:pM' } },
  ];
  const enumerator = scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }],   // UNCHANGED
                                             population: { count: 13, digest: 'sha256:pM-grown' } } }); // CHANGED
  const got = await checkScopeBracket(expect, { enumerator, bindings: bindingsOf({ M: bindingOf('M') }), ctx: { checkpoint() {} } });
  assert.equal(got.proof, 'drift');
  assert.deepEqual(got.modelKeys, ['M']);
});

test('unverifiable absorbs equal, while drift dominates both', async () => {
  const expect = [
    { modelKey: 'M', role: 'source', scope: 'roots', roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] },
    { modelKey: 'X', role: 'target', scope: 'roots', roots: [{ dbId: 1, subtreeDigest: 'sha256:x1' }] },
  ];
  const equalM = { roots: [{ dbId: 7, subtreeDigest: 'sha256:r7' }] };
  // equal + unverifiable -> unverifiable
  const a = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: equalM, X: { throws: new Error('tree unavailable') } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: bindingOf('X') }), ctx: { checkpoint() {} } });
  assert.equal(a.proof, 'unverifiable');
  assert.deepEqual(a.modelKeys, ['X']);
  // drift + unverifiable -> drift (a demonstrated change is never downgraded to "could not tell")
  const b = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: { roots: [{ dbId: 7, subtreeDigest: 'sha256:MOVED' }] },
                                   X: { throws: new Error('tree unavailable') } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: bindingOf('X') }), ctx: { checkpoint() {} } });
  assert.equal(b.proof, 'drift');
  assert.deepEqual(b.modelKeys, ['M']);
  // a null binding is unverifiable, never equal (N10: dead/unregistered/lease-invalid all read as null)
  const c = await checkScopeBracket(expect, {
    enumerator: scopedEnumerator({ M: equalM, X: { roots: [{ dbId: 1, subtreeDigest: 'sha256:x1' }] } }),
    bindings: bindingsOf({ M: bindingOf('M'), X: null }), ctx: { checkpoint() {} } });
  assert.equal(c.proof, 'unverifiable');
  assert.deepEqual(c.modelKeys, ['X']);
});

test('a population that grows and REVERTS between pre- and post-check is still caught', async () => {
  const expect = [{ modelKey: 'M', role: 'source', scope: 'whole', population: { count: 12, digest: 'sha256:pM' } }];
  const enumerator = scopedEnumerator({ M: { population: { count: 12, digest: 'sha256:pM' } } });
  const bindings = bindingsOf({ M: bindingOf('M') });
  const pre = await checkScopeBracket(expect, { enumerator, bindings, ctx: { checkpoint() {} } });
  assert.equal(pre.proof, 'equal');
  enumerator.setState({ M: { population: { count: 13, digest: 'sha256:pM-grown' } } });   // grows DURING the call
  const post = await checkScopeBracket(expect, { enumerator, bindings, ctx: { checkpoint() {} } });
  assert.equal(post.proof, 'drift', 'both sides compare against the PLANNING-TIME expectation, not against each other');
});

test('an ABSENT binding key reads as null (unverifiable) and never reaches the enumerator', async () => {
  const expect = [{ modelKey: 'Z', role: 'source', scope: 'whole', population: { count: 1, digest: 'sha256:z' } }];
  let calls = 0;
  const enumerator = { digestScope: async () => { calls++; return { kind: 'population', count: 1, digest: 'sha256:z' }; } };
  assert.deepEqual(await checkScopeBracket(expect, { enumerator, bindings: new Map(), ctx: { checkpoint() {} } }),
    { proof: 'unverifiable', modelKeys: ['Z'] });
  assert.equal(calls, 0);
});

test('the bracket asks for exactly the scopes the expectation lists, and names winners ascending and unique', async () => {
  const asked = [];
  const enumerator = { digestScope: async (binding, scope, ctx) => {
    asked.push([binding.modelKey, scope]);
    return scope === 'whole' ? { kind: 'population', count: 0, digest: 'sha256:other' } : { kind: 'roots', roots: [] };
  } };
  const expect = [
    { modelKey: 'b', role: 'source', scope: 'roots', roots: [{ dbId: 3, subtreeDigest: 'sha256:3' }, { dbId: 9, subtreeDigest: 'sha256:9' }] },
    { modelKey: 'a', role: 'target', scope: 'whole', population: { count: 5, digest: 'sha256:a' } },
    { modelKey: 'b', role: 'target', scope: 'whole', population: { count: 5, digest: 'sha256:b' } },
  ];
  const got = await checkScopeBracket(expect, { enumerator,
    bindings: bindingsOf({ a: bindingOf('a'), b: bindingOf('b') }), ctx: { checkpoint() {} } });
  assert.deepEqual(asked, [['b', { dbIds: [3, 9] }], ['a', 'whole'], ['b', 'whole']]);
  assert.deepEqual(got, { proof: 'drift', modelKeys: ['a', 'b'] });
});

test('a non-cancellation failure (sync throw, rejection, or junk) is unverifiable, never equal', async () => {
  const expect = [{ modelKey: 'M', role: 'target', scope: 'whole', population: { count: 1, digest: 'sha256:m' } }];
  const bindings = bindingsOf({ M: bindingOf('M') });
  for (const digestScope of [
    () => { throw new Error('sync'); },
    async () => { throw new Error('async'); },
    async () => ({ kind: 'roots', roots: [] }),
    async () => null,
    async () => undefined,
  ]) {
    assert.deepEqual(await checkScopeBracket(expect, { enumerator: { digestScope }, bindings, ctx: { checkpoint() {} } }),
      { proof: 'unverifiable', modelKeys: ['M'] });
  }
});

test('EnumerationCancelledError propagates unwrapped and is never laundered into unverifiable', async () => {
  const expect = [{ modelKey: 'M', role: 'source', scope: 'whole', population: { count: 1, digest: 'sha256:m' } }];
  const bindings = bindingsOf({ M: bindingOf('M') });
  const boom = new EnumerationCancelledError({ reason: 'lease-dead' });
  await assert.rejects(() => checkScopeBracket(expect, { bindings,
    enumerator: { digestScope: async () => { throw boom; } }, ctx: { checkpoint() {} } }), (e) => e === boom);
  // and the same when the error only carries the class name (structured-clone / cross-realm safe)
  const named = Object.assign(new Error('x'), { name: 'EnumerationCancelledError' });
  await assert.rejects(() => checkScopeBracket(expect, { bindings,
    enumerator: { digestScope: () => { throw named; } }, ctx: { checkpoint() {} } }), (e) => e === named);
});

test('a malformed expectation entry is unverifiable rather than a crash or a false equal', async () => {
  const bindings = bindingsOf({ M: bindingOf('M') });
  const enumerator = scopedEnumerator({ M: { roots: [], population: { count: 0, digest: 'sha256:0' } } });
  for (const bad of [
    { modelKey: 'M', role: 'source', scope: 'roots' },                // no roots array
    { modelKey: 'M', role: 'source', scope: 'whole' },                // no population
    { modelKey: 'M', role: 'source', scope: 'galaxy' },               // unknown scope
  ]) {
    const got = await checkScopeBracket([bad], { enumerator, bindings, ctx: { checkpoint() {} } });
    assert.deepEqual(got, { proof: 'unverifiable', modelKeys: ['M'] });
  }
});

test('an empty expectation is trivially equal', async () => {
  assert.deepEqual(await checkScopeBracket([], { enumerator: {}, bindings: new Map(), ctx: { checkpoint() {} } }),
    { proof: 'equal', modelKeys: [] });
});

// ---------------------------------------------------------------------------
// The digest functions and the synthetic enumerator agree (P3.2 Step 5): the fixture now emits the
// PRODUCTION digests, so a planning-time expectation built from one enumerator answer brackets
// against the same enumerator, and every mutation class of a live model is drift.
// ---------------------------------------------------------------------------
test('the synthetic enumerator emits the production digests and passes conformance with them', async () => {
  const cases = conformanceCases();
  const { enumerator, binding } = makeSyntheticEnumerator(cases.models);
  assert.deepEqual((await checkEnumeratorConformance({ enumerator, binding, cases })).failures, []);
  const res = await enumerator.resolveRoots(binding, 'whole', { checkpoint() {} });
  const r10 = res.roots.find((r) => r.dbId === 10);
  assert.equal(r10.subtreeDigest, (await digestSubtree([
    { fragId: 0, ownerDbId: 10, geometryId: 1 }, { fragId: 1, ownerDbId: 11, geometryId: 1 }])).digest);
  const records = [
    ...cases.models[0].roots.flatMap((r) => r.fragments.map((f) => ({ ...f, cls: 'L' }))),
    ...cases.models[0].unreachable,
  ];
  assert.deepEqual(res.population, { count: records.length, digest: (await digestPopulation({ count: records.length, records })).digest });
});

test('each live-model mutation class is drift against a planning-time expectation from the same enumerator', async () => {
  const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });
  const base = () => ({ modelKey: 'M', roots: [
    { dbId: 1, owners: [1], fragments: [frag(0, 1), frag(1, 1)] },
    { dbId: 2, owners: [2], fragments: [frag(2, 2)] },
  ], unreachable: [{ fragId: 3, cls: 'L', ownerDbId: 9, geometryId: 1 }] });
  const mutations = {
    'geometry replaced under the same fragId': (m) => { m.roots[0].fragments[0].geometryId = 5; },
    'owner change': (m) => { m.roots[1].fragments[0].ownerDbId = 8; m.roots[1].owners = [8]; },
    'fragment added': (m) => { m.roots[1].fragments.push(frag(4, 2)); },
    'fragment removed': (m) => { m.roots[0].fragments.pop(); },
    'unreachable fragment turns not-loaded': (m) => { m.unreachable[0] = { fragId: 3, cls: 'N' }; },
    'unreachable fragment gone': (m) => { m.unreachable.pop(); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const { enumerator, binding } = makeSyntheticEnumerator([base()]);
    const ctx = { checkpoint() {} };
    const whole = await enumerator.resolveRoots(binding, 'whole', ctx);
    const expect = [
      { modelKey: 'M', role: 'source', scope: 'roots', roots: whole.roots.map(({ dbId, subtreeDigest }) => ({ dbId, subtreeDigest })) },
      { modelKey: 'M', role: 'source', scope: 'whole', population: whole.population },
    ];
    const bindings = new Map([['M', binding]]);
    assert.equal((await checkScopeBracket(expect, { enumerator, bindings, ctx })).proof, 'equal', `${name}: before`);
    const next = base(); mutate(next); enumerator.replaceModel(next);
    assert.equal((await checkScopeBracket(expect, { enumerator, bindings, ctx })).proof, 'drift', name);
  }
  assert.equal(makeSyntheticBinding('Q').modelKey, 'Q');
});
