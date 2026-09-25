// test/clashtest/viewer/resolveRoots.explicit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { validateResolveRootsResult } from '../../../clashtest/planning/ElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';

const TREE = [
  { dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [2] }] },
  { dbId: 20, children: [{ dbId: 21, fragments: [3] }] },
  { dbId: 30 },
];
const enumerator = createViewerElementEnumerator();
const resolve = (dbIds, tree = TREE, opts) => enumerator.resolveRoots(bindingOf('k', rootedModel(tree, opts).model), { dbIds }, liveCtx().ctx);

test('a listed node resolves to a root carrying its whole subtree (fragmentCount, ownerDbIds, digest)', async () => {
  const r = await resolve([10]);
  assert.deepEqual(validateResolveRootsResult(r, { scope: { dbIds: [10] } }), { ok: true, issues: [] });
  assert.equal(r.population, null); assert.equal(r.ownerMismatch, null); assert.equal(r.unreachable, null);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]), [[10, 3, [10, 11]]]);
  assert.match(r.roots[0].subtreeDigest, /^sha256:[0-9a-f]{64}$/);
});

test('a listed descendant of a listed ancestor is dropped (no listed ancestor rule), silently', async () => {
  const r = await resolve([10, 11]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10]);
  assert.deepEqual(r.unresolved, []);
});

test('non-owning listed node with an owning descendant resolves to itself as the root (subtree granularity)', async () => {
  const r = await resolve([20]);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount, x.ownerDbIds]), [[20, 1, [21]]]);
});

test('unknown id => not-found; existing node with no fragments => no-fragments; both ascending, never roots', async () => {
  const r = await resolve([999, 30, 10]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10]);
  assert.deepEqual(r.unresolved, [{ dbId: 30, reason: 'no-fragments' }, { dbId: 999, reason: 'not-found' }]);
  assert.deepEqual(validateResolveRootsResult(r, { scope: { dbIds: [10, 30, 999] } }), { ok: true, issues: [] });
});

test('unsorted and duplicated input is normalised; result is strictly ascending', async () => {
  const r = await resolve([21, 10, 21, 10]);
  assert.deepEqual(r.roots.map((x) => x.dbId), [10, 21]);
});

test('Review Focus 1: a fragment shared by two disjoint roots is a defect (planning fails), not a double count', async () => {
  const shared = [{ dbId: 10, fragments: [0] }, { dbId: 20, fragments: [0] }];
  await assert.rejects(resolve([10, 20], shared),
    (e) => e.name === 'EnumerationInconsistencyError' && e.reason === 'fragment-under-multiple-roots');
});

test('Review Focus 7: a node reachable twice makes the whole answer a defect', async () => {
  const dag = [{ dbId: 10, children: [{ dbId: 12, fragments: [0] }] }, { dbId: 11, children: [{ dbId: 12, fragments: [0] }] }];
  await assert.rejects(resolve([10], dag), (e) => e.reason === 'node-visited-twice');
});

test('D-V9 explicit: a root over maxFragmentsPerDbId fails planning; exactly 5,000 succeeds; the failure hands back no partial answer and leaves no state', async () => {
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const over = [{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_001) }] }, { dbId: 20, fragments: [9_000] }];
  await assert.rejects(resolve([10, 20], over),
    (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxFragmentsPerDbId' && e.detail.root === 10);
  const exact = [{ dbId: 10, fragments: range(0, 2_500), children: [{ dbId: 11, fragments: range(2_500, 5_000) }] }, { dbId: 20, fragments: [9_000] }];
  const r = await resolve([10, 20], exact);
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 5_000], [20, 1]]);
  assert.deepEqual(r, await createViewerElementEnumerator().resolveRoots(     // same answer from a never-failed enumerator
    bindingOf('k', rootedModel(exact).model), { dbIds: [10, 20] }, liveCtx().ctx));
});

test('D-V9 explicit: a node with more than maxChildrenPerNode children (10,002) fails planning (abort at limit + 1); exactly 10,000 succeeds', async () => {
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ dbId: 1_000 + i }));
  const { model, stats } = rootedModel([{ dbId: 10, fragments: [0], children: kids(10_002) }]);   // limit + 2, so an abort is distinguishable from a full enumeration
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10] }, liveCtx().ctx),
    (e) => e.name === 'EnumerationBoundExceededError' && e.bound === 'maxChildrenPerNode');
  assert.equal(stats.enumNodeChildrenCallbacks, 10_002);                    // root's 1 child + 10,001 at node 10: aborted at limit + 1 (a full enumeration would be 10,003)
  const ok = await resolve([10], [{ dbId: 10, fragments: [0], children: kids(10_000) }]);
  assert.deepEqual(ok.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 1]]);
});

test('D-V9 explicit: fragments are read only inside the requested subtrees (the existence/ancestor pass reads none)', async () => {
  const { model, stats } = rootedModel(TREE);
  await enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10, 999] }, liveCtx().ctx);
  assert.equal(stats.enumNodeFragmentsCalls, 2);                            // nodes 10 and 11 only; 20, 21, 30 never asked
});

test('Review Focus 10 (D-V6 scope): an explicit root containing a not-loaded fragment resolves like extractFragments (no population witness)', async () => {
  const r = await resolve([10], TREE, { notLoadedFragIds: [1] });
  assert.deepEqual(r.roots.map((x) => [x.dbId, x.fragmentCount]), [[10, 3]]);
});

test('Review Focus 10: a geometry id the digest cannot encode fails closed (TypeError => enumeration-failed at planning)', async () => {
  const m = rootedModel(TREE).model;
  const bad = { ...m, getFragmentList: () => ({ ...m.getFragmentList(), getGeometryId: () => undefined }) };
  await assert.rejects(enumerator.resolveRoots(bindingOf('k', bad), { dbIds: [10] }, liveCtx().ctx), TypeError);
});

test('resolveRoots and digestScope agree byte-for-byte for the SAME RAW scope, incl. unknown / no-fragment / ancestor-descendant ids', async () => {
  const model = rootedModel(TREE).model;
  const b = bindingOf('k', model);
  for (const dbIds of [[10, 21], [999, 20], [10, 11], [30], [30, 10, 11, 999]]) {
    const rr = await enumerator.resolveRoots(b, { dbIds }, liveCtx().ctx);
    const ds = await enumerator.digestScope(b, { dbIds }, liveCtx().ctx);
    assert.deepEqual(ds.roots, rr.roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })), JSON.stringify(dbIds));
  }
});

test('(retained) resolveRoots and digestScope agree byte-for-byte for the same roots (the digest the bracket re-checks)', async () => {
  const model = rootedModel(TREE).model;
  const b = bindingOf('k', model);
  const rr = await enumerator.resolveRoots(b, { dbIds: [10, 21] }, liveCtx().ctx);
  const ds = await enumerator.digestScope(b, { dbIds: rr.roots.map((x) => x.dbId) }, liveCtx().ctx);
  assert.deepEqual(ds.roots, rr.roots.map(({ dbId, fragmentCount, subtreeDigest }) => ({ dbId, fragmentCount, subtreeDigest })));
});

test('two calls over unchanged content are identical (stateless, no cache)', async () => {
  assert.deepEqual(await resolve([10, 21]), await resolve([10, 21]));
});
