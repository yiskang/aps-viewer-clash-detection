// test/clashtest/planning/rootResolution.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelectionRoots } from '../../../clashtest/planning/rootResolution.js';
import { createRecordBudget } from '../../../clashtest/planning/ledger.js';
import { EnumerationCancelledError } from '../../../clashtest/errors.js';
import { makeSyntheticEnumerator, defOf, snapshotOf, shuffleDefinition } from '../support/syntheticModels.mjs';

const frag = (fragId, ownerDbId, geometryId = 1) => ({ fragId, ownerDbId, geometryId });
// A single-owner root: dbId owns one fragment.
const leafRoot = (dbId) => ({ dbId, owners: [dbId], fragments: [frag(dbId, dbId)] });
const whole = (modelKey) => ({ kind: 'model', modelKey });
const elements = (modelKey, dbIds) => ({ kind: 'elements', modelKey, dbIds });
const noop = () => {};

async function resolve(specs, { A, B }, extra = {}) {
  const { enumerator, binding, bindings } = makeSyntheticEnumerator(specs, extra.enumeratorOptions);
  const keys = specs.map((s) => s.modelKey).sort();
  const out = await resolveSelectionRoots({
    definition: defOf({ A, B }), snapshot: snapshotOf(extra.bindings ?? bindings, keys), enumerator,
    checkpoint: extra.checkpoint ?? noop, budget: extra.budget,
  });
  return { out, enumerator, binding };
}

test('cross-role nesting fails planning with hierarchy-overlap and the first 20 offenders (§5.6.5)', async () => {
  const spec = { modelKey: 'm',
    roots: [{ dbId: 100, owners: [100, 105], fragments: [{ fragId: 0, ownerDbId: 100, geometryId: 1 },
                                                        { fragId: 1, ownerDbId: 105, geometryId: 1 }] }],
    ancestorOf: { 105: 100 } };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [100] }],
                        B: [{ kind: 'elements', modelKey: 'm', dbIds: [105] }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'hierarchy-overlap');
  assert.deepEqual(out.detail.offenders, [{ ancestor: 100, descendant: 105 }]);
  assert.ok(out.detail.offenders.length <= 20);
});

test('hierarchy-overlap records at most the first 20 offenders, ascending by descendant', async () => {
  const descendants = Array.from({ length: 25 }, (_, i) => 101 + i);
  const spec = { modelKey: 'm',
    roots: [{ dbId: 100, owners: [100, ...descendants],
              fragments: [frag(0, 100), ...descendants.map((d, i) => frag(1 + i, d))] }],
    ancestorOf: Object.fromEntries(descendants.map((d) => [d, 100])) };
  const { out } = await resolve([spec], { A: [elements('m', [100])], B: [elements('m', descendants)] });
  assert.equal(out.cause, 'hierarchy-overlap');
  assert.equal(out.detail.offenders.length, 20);
  assert.deepEqual(out.detail.offenders.map((o) => o.descendant), descendants.slice(0, 20));
  assert.ok(out.detail.offenders.every((o) => o.ancestor === 100));
});

test('root-identical same-model overlap is supported and plans (A = B)', async () => {
  const spec = { modelKey: 'm', roots: [
    { dbId: 10, owners: [10], fragments: [{ fragId: 0, ownerDbId: 10, geometryId: 1 }] },
    { dbId: 20, owners: [20, 21], fragments: [{ fragId: 1, ownerDbId: 20, geometryId: 1 },
                                              { fragId: 2, ownerDbId: 21, geometryId: 1 }] }] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {},
  });
  assert.equal(out.ok, true);
  const m = out.models.get('m');
  assert.deepEqual(m.classes["A'"].map(r => r.dbId), []);
  assert.deepEqual(m.classes.C.map(r => r.dbId), [10, 20]);
  assert.deepEqual(m.classes["B'"].map(r => r.dbId), []);
  // R2: every root carries its durable class marker, assigned once, here.
  assert.deepEqual(m.classes.C.map(r => r.cls), ['C', 'C']);
  // §6.6 item 3: only C roots with ≥ 2 distinct fragment owners enter hierarchyInternal.
  assert.deepEqual(out.hierarchyInternal, [{ modelKey: 'm', rootCount: 1, ownerCount: 2,
    examples: [{ rootDbId: 20, ownerDbIds: [20, 21] }] }]);
});

test('a `not-found` explicit dbId fails planning; a `no-fragments` one is a claim-blocking record', async () => {
  const spec = { modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }],
                 missingDbIds: [777], emptyDbIds: [55] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const mk = (dbIds) => resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  const bad = await mk([1, 777]);
  assert.equal(bad.ok, false);
  assert.equal(bad.cause, 'element-unresolvable');
  const soft = await mk([1, 55]);
  assert.equal(soft.ok, true);
  // P5's pinned persisted shape: one row per (selectionRole, modelKey, cause), dbIds ascending.
  assert.deepEqual(soft.unresolvedSelections,
    [{ selectionRole: 'A', modelKey: 'm', cause: 'no-fragments', dbIds: [55] }]);
});

test('a non-zero ownerMismatch fails planning closed (§6.2)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(
    [{ modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }],
       ownerMismatchCount: 3 }]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.equal(out.cause, 'owner-mapping-mismatch');
});

test('unreachable population is recorded orientation-independently with owner classes (AC-2, AC-17 (g))', async () => {
  const spec = { modelKey: 'm',
    roots: [{ dbId: 100, owners: [200, 900], fragments: [{ fragId: 40, ownerDbId: 200, geometryId: 1 },
                                                         { fragId: 41, ownerDbId: 900, geometryId: 1 }] }],
    unreachable: [{ fragId: 42, cls: 'L', ownerDbId: 900, geometryId: 1 },
                  { fragId: 43, cls: 'L', ownerDbId: 950, geometryId: 1 },
                  { fragId: 44, cls: 'N' }, { fragId: 45, cls: 'U' }] };
  const { enumerator, binding } = makeSyntheticEnumerator([spec]);
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'model', modelKey: 'm' }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.deepEqual(out.unreachablePopulation, [{ modelKey: 'm', count: 2, ownerDbIds: [900, 950],
    mixedOwnerDbIds: [900], unattributable: { notLoaded: 1, ownerUnresolvable: 1 } }]);
  // this fixture's whole-model root also owns [900, ...] fragments, so it is a hierarchy-internal candidate too
  assert.deepEqual(out.libraryExclusions, ['hierarchy-internal', 'tree-unreachable-population']);
});

test('the three resolveRoots answers for one model must agree, else enumeration-failed', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator(
    [{ modelKey: 'm', roots: [{ dbId: 1, owners: [1], fragments: [{ fragId: 0, ownerDbId: 1, geometryId: 1 }] }] }],
    { driftOnCall: 3 });   // the 3rd resolveRoots of the run returns a different subtreeDigest
  const out = await resolveSelectionRoots({
    definition: defOf({ A: [{ kind: 'elements', modelKey: 'm', dbIds: [1] }], B: [{ kind: 'model', modelKey: 'm' }] }),
    snapshot: snapshotOf(binding, ['m']), enumerator, checkpoint: () => {} });
  assert.equal(out.cause, 'enumeration-failed');
});

// ---- beyond the plan's excerpt: each pins a rule the stage owns ------------------------------------------------

const twoRoots = { modelKey: 'm', roots: [leafRoot(10), leafRoot(20)] };

test('drift on ANY of the three answers is caught, and only the three answers are asked (one call per non-null scope + union)', async () => {
  for (const driftOnCall of [1, 2, 3]) {
    const { out, enumerator } = await resolve([twoRoots], { A: [elements('m', [10])], B: [whole('m')] }, { enumeratorOptions: { driftOnCall } });
    assert.equal(out.cause, 'enumeration-failed', `drift on call ${driftOnCall}`);
    assert.equal(out.detail.code, 'root-disagreement');
    assert.equal(enumerator.calls.filter((c) => c.kind === 'resolveRoots').length >= 2, true);
  }
  const { enumerator } = await resolve([twoRoots], { A: [elements('m', [10])], B: [whole('m')] });
  assert.deepEqual(enumerator.calls.map((c) => c.scope), [{ dbIds: [10] }, 'whole', 'whole']);
});

test('a model named by one selection asks two answers (its role and the union) and has an empty other role', async () => {
  const { out, enumerator } = await resolve([twoRoots], { A: [elements('m', [20, 10])], B: [] });
  assert.equal(out.ok, true);
  assert.deepEqual(enumerator.calls.map((c) => c.scope), [{ dbIds: [10, 20] }, { dbIds: [10, 20] }]);
  const m = out.models.get('m');
  assert.deepEqual(m.classes["A'"].map((r) => [r.dbId, r.cls]), [[10, 'A'], [20, 'A']]);
  assert.deepEqual([m.classes.C, m.classes["B'"]], [[], []]);
  assert.deepEqual(m.scopeKinds, { A: 'elements', B: null });
  assert.deepEqual([m.wholeA, m.wholeB], [false, false]);
});

test('two explicit lists are merged ascending-unique into the union scope', async () => {
  const spec = { modelKey: 'm', roots: [leafRoot(10), leafRoot(20), leafRoot(30)] };
  const { out, enumerator } = await resolve([spec], { A: [elements('m', [30, 10])], B: [elements('m', [20, 10])] });
  assert.equal(out.ok, true);
  assert.deepEqual(enumerator.calls.map((c) => c.scope), [{ dbIds: [10, 30] }, { dbIds: [10, 20] }, { dbIds: [10, 20, 30] }]);
});

test('the class arithmetic and the durable cls marker: A\' -> A, C -> C, B\' -> B (ruling R2, D9)', async () => {
  const spec = { modelKey: 'm', roots: [leafRoot(1), leafRoot(2), leafRoot(3), leafRoot(4)] };
  const { out } = await resolve([spec], { A: [elements('m', [1, 2, 3])], B: [elements('m', [2, 3, 4])] });
  const m = out.models.get('m');
  assert.deepEqual(m.classes["A'"].map((r) => [r.dbId, r.cls]), [[1, 'A']]);
  assert.deepEqual(m.classes.C.map((r) => [r.dbId, r.cls]), [[2, 'C'], [3, 'C']]);
  assert.deepEqual(m.classes["B'"].map((r) => [r.dbId, r.cls]), [[4, 'B']]);
  // rootOwners: one row per root, ascending by rootDbId across the classes, carrying cls.
  assert.deepEqual(m.rootOwners, [
    { rootDbId: 1, ownerDbIds: [1], cls: 'A' }, { rootDbId: 2, ownerDbIds: [2], cls: 'C' },
    { rootDbId: 3, ownerDbIds: [3], cls: 'C' }, { rootDbId: 4, ownerDbIds: [4], cls: 'B' },
  ]);
  assert.deepEqual(m.scopeDigests.roots.map((r) => r.dbId), [1, 2, 3, 4]);
  assert.equal(m.scopeDigests.population, null);          // both roles explicit: no whole-scope witness
  assert.equal(m.unreachable, null);
});

test('class rows carry the fields buildRootTables reads, straight from the union answer', async () => {
  const { out } = await resolve([twoRoots], { A: [whole('m')], B: [elements('m', [20])] });
  const m = out.models.get('m');
  assert.deepEqual(Object.keys(m.classes.C[0]).sort(), ['cls', 'dbId', 'fragmentCount', 'ownerDbIds', 'subtreeDigest']);
  assert.match(m.classes.C[0].subtreeDigest, /^sha256:/);
  assert.equal(m.classes.C[0].fragmentCount, 1);
});

test('whole selections record the population, and scopeKinds/wholeA/wholeB per role', async () => {
  const { out } = await resolve([twoRoots], { A: [whole('m')], B: [elements('m', [10])] });
  const m = out.models.get('m');
  assert.deepEqual(m.scopeKinds, { A: 'model', B: 'elements' });
  assert.deepEqual([m.wholeA, m.wholeB], [true, false]);
  assert.equal(m.scopeDigests.population.count, 2);
  assert.match(m.scopeDigests.population.digest, /^sha256:/);
});

test('models are resolved in ascending modelKey order, with a checkpoint at least once per model', async () => {
  const specs = [{ modelKey: 'b', roots: [leafRoot(1)] }, { modelKey: 'a', roots: [leafRoot(1)] }, { modelKey: 'c', roots: [leafRoot(1)] }];
  let checkpoints = 0;
  const { out, enumerator } = await resolve(specs, { A: [whole('c'), whole('a')], B: [whole('b')] }, { checkpoint: () => { checkpoints += 1; } });
  assert.deepEqual([...out.models.keys()], ['a', 'b', 'c']);
  assert.deepEqual([...new Set(enumerator.calls.map((c) => c.modelKey))], ['a', 'b', 'c']);
  assert.ok(checkpoints >= 3);
});

test('the checkpoint is awaited: a slow checkpoint delays the stage and is not raced', async () => {
  const order = [];
  const { out } = await resolve([twoRoots], { A: [whole('m')], B: [whole('m')] },
    { checkpoint: async () => { order.push('cp:start'); await Promise.resolve(); order.push('cp:end'); } });
  assert.equal(out.ok, true);
  for (let i = 0; i < order.length; i += 2) assert.deepEqual(order.slice(i, i + 2), ['cp:start', 'cp:end']);
});

test('cancellation from the checkpoint propagates unwrapped (never laundered into a planning cause)', async () => {
  const boom = new EnumerationCancelledError({ reason: 'cancelled' });
  await assert.rejects(resolve([twoRoots], { A: [whole('m')], B: [whole('m')] }, { checkpoint: () => { throw boom; } }), (e) => e === boom);
  await assert.rejects(resolve([twoRoots], { A: [whole('m')], B: [whole('m')] }, { checkpoint: async () => { throw boom; } }), (e) => e === boom);
});

test('an enumerator that throws propagates unwrapped for the run layer to map', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  const err = new Error('tree not ready');
  err.name = 'ObjectTreeUnavailableError';
  const throwing = { ...enumerator, resolveRoots: async () => { throw err; } };
  await assert.rejects(resolveSelectionRoots({ definition: defOf({ A: [whole('m')], B: [whole('m')] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: throwing, checkpoint: noop }), (e) => e === err);
});

test('a null binding fails model-not-bound BEFORE any enumeration, naming every unbound model', async () => {
  const specs = [{ modelKey: 'a', roots: [leafRoot(1)] }, { modelKey: 'b', roots: [leafRoot(1)] }, { modelKey: 'c', roots: [leafRoot(1)] }];
  const { enumerator, bindings } = makeSyntheticEnumerator(specs);
  const map = new Map([['a', bindings.get('a')], ['b', null]]);         // 'c' is absent: also unbound
  const out = await resolveSelectionRoots({ definition: defOf({ A: [whole('a'), whole('c')], B: [whole('b')] }),
    snapshot: snapshotOf(map, ['a', 'b', 'c']), enumerator, checkpoint: noop });
  assert.deepEqual(out, { ok: false, cause: 'model-not-bound', detail: { modelKeys: ['b', 'c'] } });
  assert.equal(enumerator.calls.length, 0);
});

test('the snapshot is positional over the ascending key union: a misaligned snapshot is a caller defect, not a guess', async () => {
  const { enumerator, bindings } = makeSyntheticEnumerator([{ modelKey: 'a', roots: [leafRoot(1)] }, { modelKey: 'b', roots: [leafRoot(1)] }]);
  const definition = defOf({ A: [whole('a')], B: [whole('b')] });
  const swapped = { registryRevision: 1, bindings: [bindings.get('b'), bindings.get('a')] };
  await assert.rejects(resolveSelectionRoots({ definition, snapshot: swapped, enumerator, checkpoint: noop }), TypeError);
  await assert.rejects(resolveSelectionRoots({ definition, snapshot: snapshotOf(bindings, ['a']), enumerator, checkpoint: noop }), TypeError);
  assert.equal(enumerator.calls.length, 0);
});

test('an invalid enumerator answer fails enumeration-failed with the boundary issues', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  const bad = { ...enumerator, resolveRoots: async (b, s, c) => ({ ...(await enumerator.resolveRoots(b, s, c)), roots: [{ dbId: 10 }] }) };
  const out = await resolveSelectionRoots({ definition: defOf({ A: [whole('m')], B: [whole('m')] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: bad, checkpoint: noop });
  assert.equal(out.cause, 'enumeration-failed');
  assert.equal(out.detail.code, 'invalid-answer');
  assert.ok(out.detail.issues.length > 0 && out.detail.issues.length <= 20);
});

test('roots that are not an antichain are an enumerator defect (enumeration-failed), not hierarchy-overlap', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  // Root 30 is nested under root 10 (owner subset) in EVERY answer: the three agree, but the antichain does not hold.
  const nested = { ...enumerator, resolveRoots: async (b, s, c) => {
    const a = await enumerator.resolveRoots(b, s, c);
    const inner = { dbId: 30, fragmentCount: 1, ownerDbIds: [10], subtreeDigest: `sha256:${'a'.repeat(64)}` };
    return { ...a, roots: [...a.roots, inner] };
  } };
  const out = await resolveSelectionRoots({ definition: defOf({ A: [whole('m')], B: [whole('m')] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: nested, checkpoint: noop });
  assert.equal(out.cause, 'enumeration-failed');
  assert.equal(out.detail.code, 'roots-not-an-antichain');
});

test('populations that disagree between two whole answers fail enumeration-failed', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  let n = 0;
  const flaky = { ...enumerator, resolveRoots: async (b, s, c) => {
    const a = await enumerator.resolveRoots(b, s, c);
    n += 1;
    return n === 2 ? { ...a, population: { count: a.population.count, digest: `sha256:${'b'.repeat(64)}` } } : a;
  } };
  const out = await resolveSelectionRoots({ definition: defOf({ A: [whole('m')], B: [whole('m')] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: flaky, checkpoint: noop });
  assert.equal(out.cause, 'enumeration-failed');
  assert.equal(out.detail.code, 'population-disagreement');
});

test('not-found offenders are the first 20, role A before B then ascending dbId; nothing else is reported', async () => {
  const missing = Array.from({ length: 30 }, (_, i) => 1000 + i);
  const spec = { modelKey: 'm', roots: [leafRoot(1)], missingDbIds: missing };
  const { out } = await resolve([spec], { A: [elements('m', [1, ...missing.slice(20)])], B: [elements('m', missing.slice(0, 15))] });
  assert.equal(out.cause, 'element-unresolvable');
  assert.equal(out.detail.offenders.length, 20);
  assert.deepEqual(out.detail.offenders.slice(0, 10).map((o) => [o.selectionRole, o.modelKey, o.dbId]),
    missing.slice(20).map((d) => ['A', 'm', d]));
  assert.deepEqual(out.detail.offenders[10], { selectionRole: 'B', modelKey: 'm', dbId: 1000 });
});

test('no-fragments rows are one per (selectionRole, modelKey, cause), dbIds ascending, in canonical order', async () => {
  const spec = { modelKey: 'm', roots: [leafRoot(1), leafRoot(2)], emptyDbIds: [55, 66, 77] };
  const { out } = await resolve([spec], { A: [elements('m', [1, 77, 55])], B: [elements('m', [2, 66])] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.unresolvedSelections, [
    { selectionRole: 'A', modelKey: 'm', cause: 'no-fragments', dbIds: [55, 77] },
    { selectionRole: 'B', modelKey: 'm', cause: 'no-fragments', dbIds: [66] },
  ]);
});

test('hierarchyInternal: exact rootCount/ownerCount, examples bounded to 20 roots x 8 owners, ascending', async () => {
  const roots = Array.from({ length: 25 }, (_, i) => {
    const dbId = 100 * (i + 1);
    const owners = Array.from({ length: 10 }, (_, k) => dbId + k);
    return { dbId, owners, fragments: owners.map((o, k) => frag(dbId + k, o)) };
  });
  const { out } = await resolve([{ modelKey: 'm', roots: [...roots, leafRoot(9999)] }], { A: [whole('m')], B: [whole('m')] });
  assert.equal(out.hierarchyInternal.length, 1);
  const row = out.hierarchyInternal[0];
  assert.equal(row.rootCount, 25);
  assert.equal(row.ownerCount, 250);
  assert.equal(row.examples.length, 20);
  assert.deepEqual(row.examples[0], { rootDbId: 100, ownerDbIds: [100, 101, 102, 103, 104, 105, 106, 107] });
  assert.deepEqual(row.examples.map((e) => e.rootDbId), roots.slice(0, 20).map((r) => r.dbId));
  // spec 6.6 item 3: provenance declares `hierarchy-internal` iff the table is non-empty (Codex P3 review M2).
  assert.deepEqual(out.libraryExclusions, ['hierarchy-internal']);
});

test('hierarchyInternal ignores single-owner C roots and multi-owner roots that are not in A n B', async () => {
  const multi = { dbId: 20, owners: [20, 21], fragments: [frag(1, 20), frag(2, 21)] };
  const { out } = await resolve([{ modelKey: 'm', roots: [leafRoot(10), multi] }], { A: [elements('m', [10, 20])], B: [elements('m', [10])] });
  assert.deepEqual(out.hierarchyInternal, []);
  assert.deepEqual(out.models.get('m').classes.C.map((r) => r.dbId), [10]);
});

test('unreachable population needs a whole-scope answer and a non-empty record; per model, ascending', async () => {
  const reach = (modelKey, unreachable) => ({ modelKey, roots: [leafRoot(1)], unreachable });
  const specs = [reach('a', [{ fragId: 50, cls: 'N' }]), reach('b', []), reach('c', [{ fragId: 51, cls: 'L', ownerDbId: 1, geometryId: 1 }])];
  const { out } = await resolve(specs, { A: [whole('a'), whole('b'), elements('c', [1])], B: [whole('a'), whole('b'), elements('c', [1])] });
  assert.deepEqual(out.unreachablePopulation.map((r) => r.modelKey), ['a']);      // 'c' has no whole answer: no witness, no row
  assert.deepEqual(out.unreachablePopulation[0], { modelKey: 'a', count: 0, ownerDbIds: [], mixedOwnerDbIds: [],
    unattributable: { notLoaded: 1, ownerUnresolvable: 0 } });
  assert.equal(out.models.get('a').unreachable, out.unreachablePopulation[0]);
  assert.equal(out.models.get('b').unreachable, null);
  assert.deepEqual(out.libraryExclusions, ['tree-unreachable-population']);
});

test('no unreachable rows means no library exclusion', async () => {
  const { out } = await resolve([twoRoots], { A: [whole('m')], B: [whole('m')] });
  assert.deepEqual([out.unreachablePopulation, out.libraryExclusions], [[], []]);
});

test('the result does not depend on the order the definition lists models or dbIds', async () => {
  const specs = [{ modelKey: 'a', roots: [leafRoot(1), leafRoot(2), leafRoot(3)] }, { modelKey: 'b', roots: [leafRoot(4), leafRoot(5)] }];
  const definition = defOf({ A: [elements('a', [1, 2]), whole('b')], B: [elements('a', [2, 3]), elements('b', [5])] });
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const run = async (def) => {
    const { enumerator, bindings } = makeSyntheticEnumerator(specs);
    const out = await resolveSelectionRoots({ definition: def, snapshot: snapshotOf(bindings, ['a', 'b']), enumerator, checkpoint: noop });
    return JSON.stringify({ ...out, models: [...out.models] });
  };
  const base = await run(definition);
  for (let i = 0; i < 5; i++) assert.equal(await run(shuffleDefinition(definition, rng)), base);
});

test('rows are admitted through the budget before they are recorded; a refusal is plan-too-large naming the class', async () => {
  const spec = { modelKey: 'm', roots: [leafRoot(1), leafRoot(2)], unreachable: [{ fragId: 50, cls: 'N' }] };
  const limits = (maxPlanReferences) => ({ maxPlanReferences, maxLedgerRecords: 10_000, maxUnitsPerRun: 10 });
  const roomy = createRecordBudget(limits(100));
  const ok = (await resolve([spec], { A: [whole('m')], B: [whole('m')] }, { budget: roomy })).out;
  assert.equal(ok.ok, true);
  // scope-digest: 1 population + 2 roots; unreachable-population: 1 row (no owners); nothing else recorded.
  assert.equal(roomy.planRecords, 3 + 1);
  const tight = createRecordBudget(limits(3));
  const refused = (await resolve([spec], { A: [whole('m')], B: [whole('m')] }, { budget: tight })).out;
  assert.deepEqual(refused, { ok: false, cause: 'plan-too-large', overflowClass: 'unreachable-population' });
  const tighter = createRecordBudget(limits(2));
  const first = (await resolve([spec], { A: [whole('m')], B: [whole('m')] }, { budget: tighter })).out;
  assert.equal(first.overflowClass, 'scope-digest');
});

test('a union that names a root neither role has, or that drops a root nothing contains, is an inconsistent enumerator (not hierarchy-overlap)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  const wrapUnion = (edit) => ({ ...enumerator, resolveRoots: async (b, s, c) => {
    const a = await enumerator.resolveRoots(b, s, c);
    return s.dbIds && s.dbIds.length === 2 ? { ...a, roots: edit(a.roots) } : a;   // only the merged-list (union) call
  } });
  const run = (edited) => resolveSelectionRoots({ definition: defOf({ A: [elements('m', [10])], B: [elements('m', [20])] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: edited, checkpoint: noop });
  const extra = await run(wrapUnion((roots) => [...roots, { dbId: 30, fragmentCount: 1, ownerDbIds: [30], subtreeDigest: `sha256:${'c'.repeat(64)}` }]));
  assert.equal(extra.cause, 'enumeration-failed');
  assert.equal(extra.detail.code, 'invalid-answer');   // a root nobody requested is rejected at the port boundary (root-not-requested)
  assert.ok(extra.detail.issues.some((i) => i.code === 'root-not-requested'));
  const dropped = await run(wrapUnion((roots) => roots.filter((r) => r.dbId !== 10)));
  assert.equal(dropped.cause, 'enumeration-failed');
  assert.equal(dropped.detail.code, 'root-union-inconsistent');
  assert.deepEqual(dropped.detail.offenders, [{ ancestor: null, descendant: 10 }]);
});

test('two answers to the SAME scope must return the same root set: a role/union split is enumeration-failed, never hierarchy-overlap', async () => {
  const spec = { modelKey: 'm', roots: [{ dbId: 100, owners: [100, 105], fragments: [frag(0, 100), frag(1, 105)] }], ancestorOf: { 105: 100 } };
  const twoIndependent = { modelKey: 'm', roots: [{ dbId: 100, owners: [100], fragments: [frag(0, 100)] }, { dbId: 200, owners: [200], fragments: [frag(1, 200)] }] };
  const { enumerator, binding } = makeSyntheticEnumerator([twoIndependent]);
  // The model "changed" between two calls with the same scope: the first answer drops root 200, the second keeps both.
  // (Both answers stay within the requested ids, so this is the agreement rule, not the port boundary check.)
  const flaky = (definition) => {
    let n = 0;
    return resolveSelectionRoots({ definition, snapshot: snapshotOf(binding, ['m']), checkpoint: noop,
      enumerator: { ...enumerator, resolveRoots: async (b, s, c) => {
        const a = await enumerator.resolveRoots(b, s, c);
        n += 1;
        return n === 1 ? { ...a, roots: a.roots.filter((r) => r.dbId === 100), unresolved: a.unresolved } : a;
      } } });
  };
  for (const [A, B] of [[[elements('m', [100, 200])], []], [[], [elements('m', [100, 200])]]]) {
    const out = await flaky(defOf({ A, B }));
    assert.equal(out.cause, 'enumeration-failed');
    assert.equal(out.detail.code, 'root-set-disagreement');
  }
  // Both roles whole (identical scopes): same rule.
  const whole2 = await flaky(defOf({ A: [whole('m')], B: [whole('m')] }));
  assert.equal(whole2.cause, 'enumeration-failed');
  assert.equal(whole2.detail.code, 'root-set-disagreement');
  // Genuinely different scopes are still judged by the cross-role rule, not by this one.
  const nested = await resolve([spec], { A: [elements('m', [100])], B: [elements('m', [105])] });
  assert.equal(nested.out.cause, 'hierarchy-overlap');
});

test('an enumerator that answers an explicit scope with a root nobody requested fails planning closed (never plans the wrong element set)', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  const lying = { ...enumerator, resolveRoots: async (b, scope, c) => {
    const a = await enumerator.resolveRoots(b, scope, c);
    if (scope === 'whole') return a;
    return { ...a, roots: [{ dbId: 20, fragmentCount: 1, ownerDbIds: [20], subtreeDigest: a.roots[0]?.subtreeDigest ?? `sha256:${'a'.repeat(64)}` }] };   // asked for 10, answered 20
  } };
  const out = await resolveSelectionRoots({ definition: defOf({ A: [elements('m', [10])], B: [elements('m', [20])] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: lying, checkpoint: noop });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'enumeration-failed');
  assert.equal(out.detail.code, 'invalid-answer');
  assert.ok(out.detail.issues.some((i) => i.code === 'root-not-requested'));
});

test('a whole answer that lists unreachable owners under count 0 cannot suppress the unreachable exclusion', async () => {
  const { enumerator, binding } = makeSyntheticEnumerator([twoRoots]);
  const lying = { ...enumerator, resolveRoots: async (b, scope, c) => {
    const a = await enumerator.resolveRoots(b, scope, c);
    return scope === 'whole' ? { ...a, unreachable: { count: 0, ownerDbIds: [99], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } } } : a;
  } };
  const out = await resolveSelectionRoots({ definition: defOf({ A: [whole('m')], B: [whole('m')] }),
    snapshot: snapshotOf(binding, ['m']), enumerator: lying, checkpoint: noop });
  assert.equal(out.ok, false);
  assert.equal(out.cause, 'enumeration-failed');
  assert.ok(out.detail.issues.some((i) => i.code === 'owners-exceed-count'));
});
