// test/clashtest/viewer/digestScope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateDigestScopeResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { compareScopeExpectation } from '../../../clashtest/planning/scopeDigest.js';
import { rootedModel, bindingOf, liveCtx, cancellingCtx } from './support/models.mjs';

const TREE = [{ dbId: 10, fragments: [0, 1] }, { dbId: 20, fragments: [2], children: [{ dbId: 21, fragments: [3] }] }];
const enumerator = createViewerElementEnumerator();
const digest = (model, scope, ctx = liveCtx().ctx) => enumerator.digestScope(bindingOf('k', model), scope, ctx);

test('whole: returns a valid population digest; identical content => identical bytes (no cache)', async () => {
  const a = await digest(rootedModel(TREE).model, 'whole');
  const b = await digest(rootedModel(TREE).model, 'whole');
  assert.deepEqual(validateDigestScopeResult(a, { scope: 'whole' }), { ok: true, issues: [] });
  assert.equal(a.kind, 'population'); assert.equal(a.count, 4);
  assert.equal(a.digest, b.digest);
});

test('whole: sensitive to owner change, loaded<->not-loaded flip, growth, and count-preserving geometry replacement', async () => {
  const base = (await digest(rootedModel(TREE).model, 'whole')).digest;
  const owner = (await digest(rootedModel(TREE, { ownerDbIdOverrides: new Map([[1, 20]]) }).model, 'whole')).digest;
  const flip = (await digest(rootedModel(TREE, { notLoadedFragIds: [1] }).model, 'whole')).digest;
  const grown = (await digest(rootedModel(TREE, { fragmentCount: 5 }).model, 'whole')).digest;
  const m = rootedModel(TREE).model;
  const replaced = { ...m, getFragmentList: () => ({ ...m.getFragmentList(), getGeometryId: (f) => (f === 2 ? 999 : f) }) };
  const geom = (await digest(replaced, 'whole')).digest;
  assert.equal(new Set([base, owner, flip, grown, geom]).size, 5);
});

test('whole: does not need or wait for the object tree', async () => {
  const { model, stats } = rootedModel(TREE, { objectTreeReady: false, settleObjectTree: () => {} });
  const r = await digest(model, 'whole');
  assert.equal(r.kind, 'population');
  assert.equal(stats.getObjectTreeWithCallbacksCalls, 0);
});

test('explicit: per-root digests, ascending, one per distinct existing fragment-owning root; unsorted/duplicate input tolerated', async () => {
  const r = await digest(rootedModel(TREE).model, { dbIds: [20, 10, 20] });
  assert.deepEqual(validateDigestScopeResult(r, { scope: { dbIds: [10, 20] } }), { ok: true, issues: [] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 2], [20, 2]]);
});

test('explicit: a subtree digest is independent of what else the model holds (per-root, not per-call)', async () => {
  const a = (await digest(rootedModel(TREE).model, { dbIds: [10] })).roots[0].subtreeDigest;
  const other = [{ dbId: 10, fragments: [0, 1] }, { dbId: 50, fragments: [9] }];
  const b = (await digest(rootedModel(other).model, { dbIds: [10] })).roots[0].subtreeDigest;
  assert.equal(a, b);
});

test('Review Focus 8 (C1): unknown ids, no-fragment ids and listed descendants are ABSENT from digestScope', async () => {
  const tree = [{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [1], children: [{ dbId: 21, fragments: [2] }] }, { dbId: 30 }];
  const r = await digest(rootedModel(tree).model, { dbIds: [999, 30, 21, 20, 10] });
  assert.deepEqual(r.roots.map((x) => x.dbId), [10, 20]);        // 999 unknown, 30 no fragments, 21 under listed 20
  // (the cross-method equality with resolveRoots is asserted in Task 7, where resolveRoots exists)
});

test('a vanished planned root shows up as drift (root-count mismatch), never as an error', async () => {
  const present = (await digest(rootedModel(TREE).model, { dbIds: [10] })).roots;
  const expectation = { modelKey: 'k', role: 'source', scope: 'roots', roots: present.map(({ dbId, subtreeDigest }) => ({ dbId, subtreeDigest })) };
  const after = await digest(rootedModel([{ dbId: 20, fragments: [2] }]).model, { dbIds: [10] });   // root 10 is gone
  assert.deepEqual(after.roots, []);
  assert.deepEqual(compareScopeExpectation(expectation, after), { modelKey: 'k', role: 'source', status: 'mismatch', detail: 'root-count' });
});

test('explicit: sensitive to a geometry replacement or owner change inside the subtree', async () => {
  const base = (await digest(rootedModel(TREE).model, { dbIds: [20] })).roots[0].subtreeDigest;
  const m = rootedModel(TREE).model;
  const tree = m.getObjectTree();
  const owned = { ...m, getObjectTree: () => ({ ...tree, enumNodeFragments: (id, cb, r) => tree.enumNodeFragments(id === 21 ? 20 : id, cb, r) }) };
  const changed = (await digest(owned, { dbIds: [20] })).roots[0].subtreeDigest;
  assert.notEqual(base, changed);
});

test('D-V9 (same normalizer as resolveRoots): an explicit digest over a root above the existing limits fails, exactly-at-limit succeeds, and the parent pass reads no fragments', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const over = rootedModel([{ dbId: 10, fragments: range(0, 5_001) }]);
  await assert.rejects(digest(over.model, { dbIds: [10] }), (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId');
  const wide = rootedModel([{ dbId: 10, children: Array.from({ length: 10_001 }, (_, i) => ({ dbId: 1_000 + i })) }]);
  await assert.rejects(digest(wide.model, { dbIds: [10] }), (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode');
  const ok = await digest(rootedModel([{ dbId: 10, fragments: range(0, 5_000) }]).model, { dbIds: [10] });
  assert.equal(ok.roots[0].fragmentCount, 5_000);
  const probe = rootedModel(TREE);
  await digest(probe.model, { dbIds: [999] });                     // unknown id: index pass only, no root survives to be walked
  assert.equal(probe.stats.enumNodeFragmentsCalls, 0);
});

test('Review Focus 6: digests read no render-proxy/readiness state (invariant when proxy availability flips)', async () => {
  const m = rootedModel(TREE).model;
  const a = await digest(m, 'whole');
  const flipped = { ...m, getRenderProxy: () => undefined, isLoadDone: () => false };
  assert.equal((await digest(flipped, 'whole')).digest, a.digest);
});

test('Review Focus 9 (C2): the whole-scope path reads the model in the same tick as an undefined-returning checkpoint', async () => {
  const m = rootedModel(TREE).model;
  const order = [];
  queueMicrotask(() => order.push('microtask'));
  const probe = { ...m, getFragmentList() { order.push('read'); return m.getFragmentList(); } };
  const p = enumerator.digestScope(bindingOf('k', probe), 'whole', { checkpoint() { order.push('cp'); } });
  await p;
  assert.deepEqual(order.slice(0, 3), ['cp', 'read', 'microtask']);
});

test('every call checkpoints before reading the model; cancellation propagates unwrapped', async () => {
  const { ctx, calls } = liveCtx();
  await digest(rootedModel(TREE).model, 'whole', ctx);
  assert.ok(calls.n >= 1);
  await assert.rejects(digest(rootedModel(TREE).model, { dbIds: [10] }, cancellingCtx(0)),
    (e) => e.name === 'EnumerationCancelledError');
});
