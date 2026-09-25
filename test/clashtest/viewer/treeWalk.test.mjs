// test/clashtest/viewer/treeWalk.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexNodeParents, indexInstanceTree, walkSubtree, topmostFragmentOwningRoots, hasListedAncestor }
  from '../../../clashtest/viewer/treeWalk.js';
import { rootedModel, liveCtx, cancellingCtx } from './support/models.mjs';

const treeOf = (children, opts) => rootedModel(children, opts).model.getObjectTree();
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1000 + i }));
const isBound = (bound) => (e) => e.name === 'EnumerationBoundExceededError' && e.bound === bound;
const SAMPLE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },      // owner 10 with owning descendant
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }, { dbId: 22, fragments: [4] }] }, // non-owning 20 -> two roots
  { dbId: 30 },                                                                    // no fragments anywhere
];

test('indexInstanceTree: nodes, parents, own fragments, children in original order', async () => {
  const idx = await indexInstanceTree(treeOf(SAMPLE), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(idx.rootId, 1);
  assert.deepEqual(idx.nodes.get(10), { parent: 1, own: [0, 1], children: [11] });
  assert.deepEqual(idx.nodes.get(20).children, [21, 22]);
  assert.equal(idx.nodes.get(1).parent, null);
  assert.equal(idx.nodes.size, 7);                                                  // 1, 10, 11, 20, 21, 22, 30
});

test('indexNodeParents: ids and parents only, and it never asks the Viewer for a fragment', async () => {
  const { model, stats } = rootedModel(SAMPLE);
  const idx = await indexNodeParents(model.getObjectTree(), liveCtx().ctx);
  assert.equal(idx.rootId, 1);
  assert.equal(idx.parents.get(1), null); assert.equal(idx.parents.get(11), 10); assert.equal(idx.parents.size, 7);
  assert.equal(stats.enumNodeFragmentsCalls, 0);
  assert.equal(stats.getChildCountCalls, 0);
});

test('walkSubtree: pre-order own-first, first-discovery-wins owner, discovery order', async () => {
  const shared = [{ dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [1, 2] }] }];
  const owners = await walkSubtree(treeOf(shared), 10, liveCtx().ctx);
  assert.deepEqual([...owners], [[0, 10], [1, 10], [2, 11]]);   // fragment 1 stays owned by 10
});

test('walkSubtree on a leaf-less/unknown node returns an empty map', async () => {
  assert.equal((await walkSubtree(treeOf(SAMPLE), 30, liveCtx().ctx)).size, 0);
  assert.equal((await walkSubtree(treeOf(SAMPLE), 999, liveCtx().ctx)).size, 0);
});

test('topmostFragmentOwningRoots: stops at the first owning node; descends through non-owning nodes', async () => {
  const idx = await indexInstanceTree(treeOf(SAMPLE), liveCtx().ctx, { loadEpoch: 1 });
  assert.deepEqual(await topmostFragmentOwningRoots(idx, liveCtx().ctx), [10, 21, 22]); // 11 is inside root 10
});

test('hasListedAncestor: climbs parents, excludes self', async () => {
  const idx = await indexNodeParents(treeOf(SAMPLE), liveCtx().ctx);
  assert.equal(hasListedAncestor(idx, 11, new Set([10, 11])), true);
  assert.equal(hasListedAncestor(idx, 10, new Set([10, 11])), false);
  assert.equal(hasListedAncestor(idx, 21, new Set([10, 21])), false);
});

test('a node reachable twice (DAG) or a cycle is an enumerator defect, never an infinite loop', async () => {
  const dag = [{ dbId: 10, children: [{ dbId: 12, fragments: [0] }] }, { dbId: 11, children: [{ dbId: 12, fragments: [0] }] }];
  for (const index of [(t) => indexNodeParents(t, liveCtx().ctx), (t) => indexInstanceTree(t, liveCtx().ctx, { loadEpoch: 1 })]) {
    await assert.rejects(index(treeOf(dag)),
      (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'node-visited-twice');
  }
  const { model } = rootedModel([{ dbId: 10 }]);
  const tree = model.getObjectTree();
  const cyclic = { ...tree, enumNodeChildren: (id, cb) => { cb(1); } }; // every node's child is the root
  await assert.rejects(walkSubtree(cyclic, 1, liveCtx().ctx), (e) => e.reason === 'node-visited-twice');
});

test('a non-numeric root id fails closed', async () => {
  const tree = { ...treeOf([]), getRootId: () => undefined };
  await assert.rejects(indexNodeParents(tree, liveCtx().ctx), (e) => e.reason === 'root-id-invalid');
  await assert.rejects(indexInstanceTree(tree, liveCtx().ctx, {}), (e) => e.reason === 'root-id-invalid');
});

test('checkpoints: at least one per 64 nodes, cancellation propagates unwrapped, getChildCount is never called', async () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ dbId: 100 + i, fragments: [i] }));
  const { model, stats } = rootedModel(many);
  for (const index of [(t, c) => indexNodeParents(t, c), (t, c) => indexInstanceTree(t, c, { loadEpoch: 1 })]) {
    const { ctx, calls } = liveCtx();
    await index(model.getObjectTree(), ctx);
    assert.ok(calls.n >= 3, `201 nodes => >= 3 checkpoints (got ${calls.n})`);
    await assert.rejects(index(model.getObjectTree(), cancellingCtx(1)), (e) => e.name === 'EnumerationCancelledError');
  }
  assert.equal(stats.getChildCountCalls, 0);
});

// ---- D-V9: bounded planning (RED first: no bound exists until the code below is written) ----

test('D-V9 fanout: a node with MORE than maxChildrenPerNode children (10,002) aborts at exactly limit + 1 callbacks (all three passes)', async () => {
  for (const [run, expectedCallbacks] of [
    [(t) => indexNodeParents(t, liveCtx().ctx), 10_002],                       // root's 1 child + 10,001 at node 10
    [(t) => indexInstanceTree(t, liveCtx().ctx, { loadEpoch: 1 }), 10_002],
    [(t) => walkSubtree(t, 10, liveCtx().ctx), 10_001],
  ]) {
    const { model, stats } = rootedModel([{ dbId: 10, children: kids(10_002) }]);   // limit + 2: an abort and a natural end differ
    await assert.rejects(run(model.getObjectTree()), isBound('maxChildrenPerNode'));
    assert.equal(stats.enumNodeChildrenCallbacks, expectedCallbacks);          // aborted at limit + 1; ignoring `return true` would yield one more callback than expected
  }
});

test('D-V9 fanout: exactly maxChildrenPerNode children succeeds', async () => {
  const { model } = rootedModel([{ dbId: 10, children: kids(10_000) }]);
  const idx = await indexNodeParents(model.getObjectTree(), liveCtx().ctx);
  assert.equal(idx.parents.size, 10_002);                                      // root, 10, and the 10,000 children
  assert.equal((await walkSubtree(model.getObjectTree(), 10, liveCtx().ctx)).size, 0);
});

test('D-V9 subtree tally: 5,001 own-fragment callbacks in one root subtree throw BEFORE the over-limit node\'s children are read', async () => {
  const over = rootedModel([{ dbId: 10, fragments: range(0, 2_500), children: [
    { dbId: 11, fragments: range(2_500, 5_001), children: [{ dbId: 12, fragments: [9_999] }] }] }]);
  await assert.rejects(walkSubtree(over.model.getObjectTree(), 10, liveCtx().ctx), isBound('maxFragmentsPerDbId'));
  assert.equal(over.stats.enumNodeChildrenCalls, 1);                           // node 10's children were read; node 11's were not
});

test('D-V9 subtree tally: exactly maxFragmentsPerDbId (5,000) succeeds', async () => {
  const ok = rootedModel([{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }]);
  assert.equal((await walkSubtree(ok.model.getObjectTree(), 10, liveCtx().ctx)).size, 5_000);
});

test('D-V9 subtree tally: rediscovered fragments count (library semantics), so 3,000 + 3,000 duplicates is over the limit', async () => {
  const { model } = rootedModel([{ dbId: 10, fragments: range(0, 3_000), children: [{ dbId: 11, fragments: range(0, 3_000) }] }]);
  await assert.rejects(walkSubtree(model.getObjectTree(), 10, liveCtx().ctx), isBound('maxFragmentsPerDbId'));
});

test('D-V9 whole index: a node listing 5,001 own fragments is refused (the Viewer call is not abortable, recording stops at the limit); exactly 5,000 succeeds', async () => {
  const over = rootedModel([{ dbId: 10, fragments: range(0, 5_001) }]);
  await assert.rejects(indexInstanceTree(over.model.getObjectTree(), liveCtx().ctx, { loadEpoch: 1 }), isBound('maxFragmentsPerDbId'));
  assert.equal(over.stats.enumNodeFragmentsCallbacks, 5_001);                  // the burst ran to its end; nothing beyond the limit was kept
  const ok = await indexInstanceTree(treeOf([{ dbId: 10, fragments: range(0, 5_000) }]), liveCtx().ctx, { loadEpoch: 1 });
  assert.equal(ok.nodes.get(10).own.length, 5_000);
});

test('D-V9 whole index: tree-reachable tally above maxCollisionInstancesPerEpoch (20,000) trips CapacityExceededError; exactly 20,000 succeeds', async () => {
  const five = (perNode) => Array.from({ length: 5 }, (_, i) => ({ dbId: 10 + i, fragments: range(0, perNode) })); // ids rediscovered
  await assert.rejects(indexInstanceTree(treeOf(five(4_001)), liveCtx().ctx, { loadEpoch: 7 }),
    (e) => e.name === 'CapacityExceededError');
  const ok = await indexInstanceTree(treeOf(five(4_000)), liveCtx().ctx, { loadEpoch: 7 });
  assert.equal(ok.nodes.size, 6);
});

test('D-V9: a failed pass hands back nothing and leaves nothing behind (a following in-bounds pass equals a never-failed one)', async () => {
  const bad = rootedModel([{ dbId: 10, children: kids(10_002) }]).model.getObjectTree();
  await assert.rejects(indexNodeParents(bad, liveCtx().ctx), isBound('maxChildrenPerNode'));
  const good = () => treeOf(SAMPLE);
  assert.deepEqual([...(await indexNodeParents(good(), liveCtx().ctx)).parents],
    [...(await indexNodeParents(good(), liveCtx().ctx)).parents]);
});
