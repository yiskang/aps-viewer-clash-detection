// test/clashtest/viewer/differential.test.mjs  (spec 6.2.1 "Conformance", AC-2: adapter == library extraction)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../fixtures/mockInstanceTree.mjs'; // installs globalThis.THREE for the library functions (test-only)
import { extractFragments, extractAllFragments } from '../../../collision/viewer/ViewerModelAdapter.js';
import { digestPopulation, digestSubtree } from '../../../clashtest/planning/scopeDigest.js';
import { createViewerElementEnumerator } from '../../../clashtest/viewer/ViewerElementEnumerator.js';
import { rootedModel, bindingOf, liveCtx } from './support/models.mjs';

const enumerator = createViewerElementEnumerator();
const SHAPES = {
  plain: [{ dbId: 10, fragments: [0, 1] }, { dbId: 20, fragments: [2] }],
  hierarchy: [{ dbId: 10, fragments: [0], children: [{ dbId: 11, fragments: [1, 2] }, { dbId: 12, fragments: [3] }] }],
  nonOwningParent: [{ dbId: 20, children: [{ dbId: 21, fragments: [0] }, { dbId: 22, fragments: [1] }] }],
  rediscovery: [{ dbId: 10, fragments: [0, 1], children: [{ dbId: 11, fragments: [1, 2] }] }],
};

for (const [name, tree] of Object.entries(SHAPES)) {
  test(`differential[${name}]: every root's records and digest equal what extractFragments produces`, async () => {
    const { model } = rootedModel(tree);
    const fragList = model.getFragmentList();
    const rr = await enumerator.resolveRoots(bindingOf('k', model), 'whole', liveCtx().ctx);
    for (const root of rr.roots) {
      const lib = await extractFragments(model, [root.dbId], 0, { checkpoint: undefined, THREE: globalThis.THREE });
      assert.equal(lib.size, root.fragmentCount);
      assert.deepEqual([...new Set([...lib.values()].map((r) => r.ownerDbId))].sort((a, b) => a - b), root.ownerDbIds);
      const libRows = [...lib.values()].map((r) => ({ fragId: r.fragmentId, ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(r.fragmentId) }));
      assert.equal((await digestSubtree(libRows)).digest, root.subtreeDigest);
    }
  });

  test(`differential[${name}]: the population digest equals the one built from extractAllFragments' records + its two dropped classes`, async () => {
    const { model } = rootedModel(tree, { fragmentCount: 6, notLoadedFragIds: [4], ownerDbIdOverrides: new Map([[5, undefined]]) });
    const fragList = model.getFragmentList();
    const { records, diagnostics } = await extractAllFragments(model, 0, { checkpoint: undefined, THREE: globalThis.THREE });
    const dropped = new Map(diagnostics.map((d) => [d.fragment.fragId, d.reason === 'fragment-not-loaded' ? 'N' : 'U']));
    const rows = [];
    for (let f = 0; f < fragList.getCount(); f++) {
      if (dropped.has(f)) rows.push({ fragId: f, cls: dropped.get(f) });
      else { const r = records.get(f); rows.push({ fragId: f, cls: 'L', ownerDbId: r.ownerDbId, geometryId: fragList.getGeometryId(f) }); }
    }
    const expected = await digestPopulation({ count: fragList.getCount(), records: rows });
    const got = await enumerator.digestScope(bindingOf('k', model), 'whole', liveCtx().ctx);
    assert.equal(got.digest, expected.digest);
  });
}

test('differential: an explicit multi-root call agrees with the library called with the same roots (first-discovery across roots)', async () => {
  const { model } = rootedModel(SHAPES.plain);
  const lib = await extractFragments(model, [10, 20], 0, { checkpoint: undefined, THREE: globalThis.THREE });
  const rr = await enumerator.resolveRoots(bindingOf('k', model), { dbIds: [10, 20] }, liveCtx().ctx);
  assert.equal(lib.size, rr.roots.reduce((n, r) => n + r.fragmentCount, 0));
});
