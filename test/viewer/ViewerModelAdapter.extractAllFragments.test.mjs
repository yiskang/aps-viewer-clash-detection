import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAllFragments, extractFragments } from '../../collision/viewer/ViewerModelAdapter.js';
import { CapacityExceededError } from '../../collision/errors.js'; // Task 1's relocation
import { maxCollisionInstancesPerEpoch } from '../../collision/constants.js';
// Importing this fixture also sets globalThis.THREE (if not already set) as a side effect, so
// extractAllFragments's default `THREE = globalThis.THREE` resolves in this headless test process --
// see the comment at the top of mockInstanceTree.mjs.
import { buildMockModel } from '../fixtures/mockInstanceTree.mjs';

const LOAD_EPOCH = 7;

// Accessor names and diagnostic reasons below are binding per
// docs/superpowers/specs/m2-extractAllFragments-viewer-evidence.md's "Resolved for Task 5" section --
// NOT the plan's own stale `instanceTree.findNodeForFragId` scaffold text.

test('enumerates every fragment the model holds, independent of tree structure, with no diagnostics for a clean model', async () => {
  const { model } = buildMockModel(
    [
      { dbId: 1, fragments: [0] },
      { dbId: 2, fragments: [1] },
    ],
    new Map([[0, { geometryIndex: 5 }], [1, { geometryIndex: 6 }]]),
  );
  const { records, diagnostics } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.deepEqual([...records.keys()].sort(), [0, 1]);
  assert.deepEqual(diagnostics, []);
  assert.equal(records.get(0).ownerDbId, 1);
  assert.equal(records.get(1).ownerDbId, 2);
});

test('a not-loaded fragment is excluded from records and diagnosed with dbId: null', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [0, 1] }],
    new Map(),
    { notLoadedFragIds: [1] },
  );
  const { records, diagnostics } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.deepEqual([...records.keys()], [0]);
  assert.deepEqual(diagnostics, [
    { scope: 'fragment', reason: 'fragment-not-loaded', role: 'target', fragment: { modelId: model, dbId: null, fragId: 1 } },
  ]);
});

test('an unresolvable owner (getDbIds returns undefined) is excluded from records and diagnosed, never guessed', async () => {
  // fragId 1 is in-range (fragmentCount explicitly set to 2) but owned by no node in the tree --
  // fragId2dbId.get(1) is undefined, exactly like a real Viewer's sparse fragId2dbId lookup miss.
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [0] }],
    new Map(),
    { fragmentCount: 2 },
  );
  const { records, diagnostics } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.deepEqual([...records.keys()], [0]);
  assert.deepEqual(diagnostics, [
    { scope: 'fragment', reason: 'fragment-owner-unresolvable', role: 'target', fragment: { modelId: model, dbId: null, fragId: 1 } },
  ]);
});

test('I-3: a hidden fragment remains eligible -- included in records, no diagnostic, isNodeHidden never consulted', async () => {
  const { model, stats } = buildMockModel(
    [
      { dbId: 1, fragments: [0] },
      { dbId: 2, fragments: [1] },
    ],
    new Map(),
    { hiddenDbIds: [2] },
  );
  const { records, diagnostics } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.deepEqual([...records.keys()].sort(), [0, 1]);
  assert.equal(records.get(1).ownerDbId, 2);
  assert.deepEqual(diagnostics, []);
  assert.equal(stats.isNodeHiddenCalls, 0, 'extractAllFragments must never call isNodeHidden -- hidden is not a checked state');
});

test('I-3: extractFragments and extractAllFragments converge on the same hidden-fragment eligibility', async () => {
  const { model } = buildMockModel(
    [{ dbId: 2, fragments: [1] }],
    new Map(),
    { hiddenDbIds: [2] },
  );
  const viaAll = await extractAllFragments(model, LOAD_EPOCH, {});
  const viaExplicit = await extractFragments(model, [2], LOAD_EPOCH);
  assert.ok(viaAll.records.has(1), 'whole-model scope must include the hidden fragment');
  assert.ok(viaExplicit.has(1), 'explicit-dbIds scope must include the hidden fragment (protected M1 behavior)');
  assert.equal(viaAll.records.get(1).ownerDbId, viaExplicit.get(1).ownerDbId);
});

test('a 2D-style array-returning getDbIds is excluded and diagnosed via fragment-owner-unresolvable, never crashes', async () => {
  const { model } = buildMockModel(
    [{ dbId: 1, fragments: [0] }],
    new Map(),
    { ownerDbIdOverrides: new Map([[0, [5, 6]]]) },
  );
  const { records, diagnostics } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.equal(records.size, 0);
  assert.deepEqual(diagnostics, [
    { scope: 'fragment', reason: 'fragment-owner-unresolvable', role: 'target', fragment: { modelId: model, dbId: null, fragId: 0 } },
  ]);
});

test('maxCollisionInstancesPerEpoch is enforced BEFORE the enumeration loop touches any fragment', async () => {
  // fragmentCount set directly above the ceiling -- no need to materialize a 20,000+ entry tree.
  const { model, stats } = buildMockModel([], new Map(), { fragmentCount: maxCollisionInstancesPerEpoch + 1 });
  await assert.rejects(
    () => extractAllFragments(model, LOAD_EPOCH, {}),
    (err) => {
      assert.ok(err instanceof CapacityExceededError);
      assert.equal(err.kind, 'whole-model-enumeration');
      assert.equal(err.loadEpoch, LOAD_EPOCH);
      assert.equal(err.requested, maxCollisionInstancesPerEpoch + 1);
      assert.equal(err.limit, maxCollisionInstancesPerEpoch);
      return true;
    },
  );
  // Proof the loop never started: getCount() was read exactly once (for the precheck itself), and
  // no per-fragment accessor was ever touched.
  assert.equal(stats.getCountCalls, 1);
  assert.equal(stats.isNotLoadedCalls, 0);
  assert.equal(stats.getDbIdsCalls, 0);
  assert.equal(stats.isNodeHiddenCalls, 0);
});

test('the preflight checkpoint validates liveness BEFORE any model accessor is touched', async () => {
  class FakeModelEvictedError extends Error {}
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [0] }], new Map());
  const checkpoint = () => { throw new FakeModelEvictedError('model evicted'); };
  await assert.rejects(() => extractAllFragments(model, LOAD_EPOCH, { checkpoint }), FakeModelEvictedError);
  assert.equal(stats.getCountCalls, 0, 'fragList.getCount() must never be read if the preflight checkpoint rejects');
  assert.equal(stats.isNotLoadedCalls, 0);
  assert.equal(stats.getDbIdsCalls, 0);
});

test('a synchronous checkpoint fast path (checkpoint returns undefined) still lets the walk run to completion synchronously up to its first await', async () => {
  // Mirrors extractFragments's own "Item ordering" regression test (ViewerModelAdapter.test.mjs) --
  // a bare `await checkpoint(...)` on an `undefined` return would still force a microtask boundary
  // before this module's own first model read. Proof strategy: a synchronous checkpoint that always
  // returns undefined must let getCount() (and thus the capacity check) happen in the SAME tick as
  // the call, before extractAllFragments(...) even returns control to this line.
  const { model, stats } = buildMockModel([{ dbId: 1, fragments: [0] }], new Map());
  const syncCheckpoint = () => undefined;
  const promise = extractAllFragments(model, LOAD_EPOCH, { checkpoint: syncCheckpoint });
  assert.equal(stats.getCountCalls, 1, 'getCount() must have already run synchronously, before this line');
  await promise;
});

test('a resolvable owner dbId comes from the reverse lookup, never from enumeration order', async () => {
  const { model } = buildMockModel(
    [
      { dbId: 100, fragments: [0] },
      { dbId: 200, fragments: [1] },
    ],
    new Map(),
  );
  const { records } = await extractAllFragments(model, LOAD_EPOCH, {});
  assert.equal(records.get(0).ownerDbId, 100);
  assert.equal(records.get(1).ownerDbId, 200);
});

test('records use the exact same ExtractedFragmentRecord shape extractFragments produces', async () => {
  const { model } = buildMockModel([{ dbId: 1, fragments: [0] }], new Map([[0, { geometryIndex: 9 }]]));
  const { records } = await extractAllFragments(model, LOAD_EPOCH, {});
  const rec = records.get(0);
  assert.deepEqual(
    Object.keys(rec).sort(),
    ['fragmentId', 'geometryIdentity', 'worldMatrix', 'worldBounds', 'ownerDbId'].sort(),
  );
  assert.ok(Object.isFrozen(rec));
  assert.equal(rec.fragmentId, 0);
  assert.equal(rec.geometryIdentity.loadEpoch, LOAD_EPOCH);
  assert.equal(rec.geometryIdentity.geometryIndex, 9);
  assert.equal(rec.worldMatrix.length, 16);
  assert.deepEqual(rec.worldBounds, { min: [0, 0, 0], max: [1, 1, 1] });

  // Cross-check against extractFragments's own record shape for the identical fragment, using the
  // SAME model -- proves the two primitives really do produce byte-identical record shapes rather
  // than two independently-drifted ones.
  const viaExtractFragments = await extractFragments(model, [1], LOAD_EPOCH);
  assert.deepEqual(Object.keys(rec).sort(), Object.keys(viaExtractFragments.get(0)).sort());
});
