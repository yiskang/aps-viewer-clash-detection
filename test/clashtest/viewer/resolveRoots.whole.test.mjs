// test/clashtest/viewer/resolveRoots.whole.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateResolveRootsResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';
import { buildMockModel } from '../../fixtures/mockInstanceTree.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }, { dbId: 22, fragments: [4] }] },
];
const enumerator = createViewerElementEnumerator();
const whole = (tree = TREE, opts) => {
  const b = bindingOf('k', rootedModel(tree, opts).model);
  return enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
};

test('roots = topmost fragment-owning nodes, ascending; hierarchy: root 10 owns fragment-owning descendant 11', async () => {
  const r = await whole();
  assert.deepEqual(validateResolveRootsResult(r, { scope: 'whole' }), { ok: true, issues: [] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]),
    [[10, 3, [10, 11]], [21, 1, [21]], [22, 1, [22]]]);
  assert.equal(r.unresolved.length, 0);
  assert.deepEqual(r.ownerMismatch, { count: 0, first20: [] });
  assert.deepEqual(r.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
});

test('population.digest equals digestScope whole for unchanged content (same function, spec 6.2)', async () => {
  const b = bindingOf('k', rootedModel(TREE).model);
  const rr = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  const ds = await enumerator.digestScope(b, 'whole', liveCtx().ctx);
  assert.deepEqual(rr.population, { count: ds.count, digest: ds.digest });
});

test('real owner mismatch: tree owner != fragList owner is counted with first20 ascending by fragId', async () => {
  const r = await whole(TREE, { ownerDbIdOverrides: new Map([[3, 99], [1, 77]]) });
  assert.equal(r.ownerMismatch.count, 2);
  assert.deepEqual(r.ownerMismatch.first20, [
    { fragId: 1, treeOwner: 10, fragListOwner: 77 }, { fragId: 3, treeOwner: 21, fragListOwner: 99 }]);
});

test('first20 is capped at 20 while count is exact', async () => {
  const many = [{ dbId: 10, fragments: Array.from({ length: 30 }, (_, i) => i) }];
  const overrides = new Map(Array.from({ length: 30 }, (_, i) => [i, 999]));
  const r = await whole(many, { ownerDbIdOverrides: overrides });
  assert.equal(r.ownerMismatch.count, 30); assert.equal(r.ownerMismatch.first20.length, 20);
});

test('unreachable: loaded owner-resolvable fragments in no root subtree (tree under-enumeration)', async () => {
  const r = await whole(TREE, { fragmentCount: 8, ownerDbIdOverrides: new Map([[5, 500], [6, 500], [7, 600]]) });
  assert.deepEqual(r.unreachable, { count: 3, ownerDbIds: [500, 600], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
});

test('unattributable: N and U fragments outside every root are counted separately (R12-1)', async () => {
  const r = await whole(TREE, { fragmentCount: 8, notLoadedFragIds: [5], ownerDbIdOverrides: new Map([[6, undefined], [7, [1, 2]]]) });
  assert.deepEqual(r.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 2 } });
});

test('mixed owner: an owner with both a reachable and an unreachable fragment appears in both tables', async () => {
  const r = await whole(TREE, { fragmentCount: 6, ownerDbIdOverrides: new Map([[5, 10]]) });
  assert.deepEqual(r.unreachable.ownerDbIds, [10]);
  assert.ok(r.roots.some((x) => x.ownerDbIds.includes(10)));
});

test('D-V6 (owner-approved fail-closed): a TREE-REACHABLE fragment that is not-loaded / owner-unresolvable (undefined or array) / outside the population fails planning deterministically', async () => {
  for (const [opts, reason] of [
    [{ notLoadedFragIds: [1] }, 'tree-reachable-fragment-unattributable'],
    [{ ownerDbIdOverrides: new Map([[1, undefined]]) }, 'tree-reachable-fragment-unattributable'],
    [{ ownerDbIdOverrides: new Map([[1, [10, 11]]]) }, 'tree-reachable-fragment-unattributable'],
    [{ fragmentCount: 3 }, 'fragment-outside-population'],           // tree names fragment 4; population is 0..2
  ]) {
    const attempt = whole(TREE, opts);
    await assert.rejects(attempt, (e) => e.name === 'EnumerationInconsistencyError' && e.reason === reason, JSON.stringify(reason));
    await assert.rejects(whole(TREE, opts), (e) => e.reason === reason);   // deterministic: the second call fails the same way
  }
});

test('D-V6: the failure is the ONLY outcome (no partial roots, no population, no diagnostic carrier) and the enumerator is unharmed for the next call', async () => {
  let settled;
  await whole(TREE, { notLoadedFragIds: [1] }).then((v) => { settled = { resolved: v }; }, (e) => { settled = { rejected: e.name }; });
  assert.deepEqual(settled, { rejected: 'EnumerationInconsistencyError' });   // never a resolved-but-partial answer
  assert.deepEqual((await whole(TREE)).roots.map((x) => x.dbId), [10, 21, 22]);
});

test('Review Focus 1: a fragment reachable under two roots fails planning', async () => {
  await assert.rejects(whole([{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [0] }]),
    (e) => e.reason === 'fragment-under-multiple-roots');
});

test('empty tree / no fragments: zero roots, zero-count population, still a valid answer', async () => {
  const r = await whole([{ dbId: 10 }]);
  assert.deepEqual(r.roots, []); assert.equal(r.population.count, 0);
  assert.deepEqual(validateResolveRootsResult(r, { scope: 'whole' }), { ok: true, issues: [] });
});

test('D-V9 whole: population above maxCollisionInstancesPerEpoch fails BEFORE any tree traversal (zero enumNode* calls); exactly 20,000 succeeds', async () => {
  const over = rootedModel(TREE, { fragmentCount: 20_001 });
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', over.model), 'whole', liveCtx().ctx),
    (e) => e.name === 'CapacityExceededError');
  assert.equal(over.stats.enumNodeChildrenCalls, 0);
  assert.equal(over.stats.enumNodeFragmentsCalls, 0);                        // the retained index was never started
  assert.ok(over.stats.getCountCalls >= 1);
  const exact = await whole(TREE, { fragmentCount: 20_000 });                // 5 tree-reachable + 19,995 unclaimed (owner-unresolvable) fragments
  assert.equal(exact.population.count, 20_000);
  assert.equal(exact.unreachable.unattributable.ownerUnresolvable, 19_995);
});

test('D-V9 whole: over-bound TREES fail planning — node over maxChildrenPerNode, node over maxFragmentsPerDbId, a ROOT subtree over maxFragmentsPerDbId, tree-reachable tally over 20,000', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1_000 + i }));
  const five = (perNode) => Array.from({ length: 5 }, (_, i) => ({ dbId: 10 + i, fragments: range(0, perNode) })); // rediscovered ids
  for (const [tree, isExpected] of [
    [[{ dbId: 10, children: kids(10_001) }], (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode'],
    [[{ dbId: 10, fragments: range(0, 5_001) }], (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId'],
    [[{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_001) }] }],      // each node <= 5,000; the ROOT subtree is 5,001
      (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId' && e.detail.root === 10],
    [five(4_001), (e) => e.name === 'CapacityExceededError'],
  ]) {
    await assert.rejects(whole(tree), isExpected);
  }
});

test('D-V9 whole: exactly-at-limit trees succeed (a 10,000-child node, a 5,000-fragment root)', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const wide = await whole([{ dbId: 10, children: Array.from({ length: 10_000 }, (_, i) => ({ dbId: 1_000 + i })) }]);
  assert.deepEqual(wide.roots, []); assert.equal(wide.population.count, 0);
  const full = await whole([{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }]);
  assert.deepEqual(full.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 5_000]]);
});

test('D-V9 whole: a failed planning pass leaves no retained index or cache — the next in-bounds call equals a never-failed enumerator', async () => {
  const kids = Array.from({ length: 10_001 }, (_, i) => ({ dbId: 1_000 + i }));
  await assert.rejects(whole([{ dbId: 10, children: kids }]), (e) => e.name === 'EnumerationBoundExceededError');
  assert.deepEqual(await whole(), await createViewerElementEnumerator().resolveRoots(
    bindingOf('k', rootedModel(TREE).model), 'whole', liveCtx().ctx));
});

test('three consecutive calls over unchanged content agree exactly (the planner requires this, spec 6.2)', async () => {
  const b = bindingOf('k', rootedModel(TREE).model);
  const a1 = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  const a2 = await enumerator.resolveRoots(b, 'whole', liveCtx().ctx);
  assert.deepEqual(a1, a2);
});

// 2026-10-07 (owner-authorized): an unreachable, intentionally omitted null-geometry fragment (not loaded AND geometry
// id 0, populationScan's `nullGeometry` flag) is informational -- it is not counted as unattributable, so on its own it
// produces no unreachable population (no `tree-unreachable-population` exclusion, no rule-7 caveat). A not-loaded
// fragment with a real geometry id is still counted. A TREE-REACHABLE null-geometry fragment now plans (D-V6 bounded
// exception, owner-authorized 2026-10-07 after the normal-app Architecture failure).
test('unattributable: an unreachable null-geometry N fragment is not counted; a not-loaded fragment with a real geometry id still is', async () => {
  const geoms = new Map([[0, { geometryIndex: 10 }], [1, { geometryIndex: 11 }], [2, { geometryIndex: 12 }],
    [3, { geometryIndex: 13 }], [4, { geometryIndex: 14 }], [5, { geometryIndex: 0 }], [6, { geometryIndex: 16 }]]);
  const run = (fragmentCount, notLoadedFragIds) => {
    const { model } = buildMockModel([{ dbId: 1, children: TREE }], geoms, { fragmentCount, notLoadedFragIds });
    return enumerator.resolveRoots(bindingOf('k', { ...model, id: 'm1' }), 'whole', liveCtx().ctx);
  };
  const onlyNull = await run(6, [5]);
  assert.deepEqual(validateResolveRootsResult(onlyNull, { scope: 'whole' }), { ok: true, issues: [] });
  assert.deepEqual(onlyNull.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  const both = await run(7, [5, 6]);
  assert.deepEqual(both.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 1, ownerUnresolvable: 0 } });
  const reachableNull = buildMockModel([{ dbId: 1, children: TREE }], new Map([[1, { geometryIndex: 0 }]]), { notLoadedFragIds: [1] });
  // D-V6 bounded exception (owner-authorized 2026-10-07): a TREE-REACHABLE null-geometry fragment plans successfully
  // (informational, never an unattributable/unreachable count); a tree-reachable not-loaded fragment with a real
  // geometry id still fails closed.
  const reached = await enumerator.resolveRoots(bindingOf('k', { ...reachableNull.model, id: 'm1' }), 'whole', liveCtx().ctx);
  assert.deepEqual(validateResolveRootsResult(reached, { scope: 'whole' }), { ok: true, issues: [] });
  assert.deepEqual(reached.unreachable, { count: 0, ownerDbIds: [], unattributable: { notLoaded: 0, ownerUnresolvable: 0 } });
  assert.equal(reached.ownerMismatch.count, 0);
  const reachableReal = buildMockModel([{ dbId: 1, children: TREE }], new Map([[1, { geometryIndex: 11 }]]), { notLoadedFragIds: [1] });
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', { ...reachableReal.model, id: 'm1' }), 'whole', liveCtx().ctx),
    (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'tree-reachable-fragment-unattributable');
});
