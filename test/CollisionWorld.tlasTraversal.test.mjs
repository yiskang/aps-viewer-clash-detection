// test/CollisionWorld.tlasTraversal.test.mjs
//
// Task 12 (M2 Batch 4): target-scope membership filter. Task 13 extends this same file with the
// atomic TLAS traversal integration tests.
//
// `CollisionWorld._addToTargetScopeFilter(filterByModel, model, dbIds, records)` is the plan's own
// `buildTargetScopeFilter` reworked to consume records findClashes's EXISTING per-targets-entry
// extraction loop already produces, rather than re-extracting a second time (per the plan's own
// note: "reuse the SAME extraction result Task 8 already computed... adjust this helper's
// signature accordingly once the real call site is in hand"). It is additive here -- not yet
// consumed by any broad-phase path (Task 13's job) -- so every test below calls it directly, using
// REAL extractFragments/extractAllFragments output as `records` for the assembly-rooted/whole-model
// cases, exactly like test/CollisionWorld.placementIndex.test.mjs's own established pattern of
// testing a purely-additive private method by reaching into it directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { extractFragments, extractAllFragments } from '../collision/viewer/ViewerModelAdapter.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function makeFixture(rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  return { ...baseModel, id: 1, getUnitScale: () => 1 };
}

function noopCheckpoint() { return undefined; }

async function freshWorld() {
  return CollisionWorld.fromViewer(null, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
}

test('an explicit-dbIds targets entry filters TLAS candidates to that entry\'s extracted fragment set', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const records = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, [10], records);
  const scope = filterByModel.get(model);
  assert.ok(scope instanceof Set, 'a narrow dbIds entry produces a real membership Set, not whole-model');
  assert.deepEqual([...scope], [100], 'only fragment 100 (under requested dbId 10) is in scope');
});

test('an assembly-rooted targets entry does NOT false-negative-exclude its own descendant fragments', async () => {
  // The exact bug the targeted design-resolution pass found and fixed in already-accepted text
  // (spec §7.1a): a filter comparing ownerDbId directly against requested dbIds would wrongly
  // exclude every descendant fragment of an assembly-rooted target request.
  const model = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 11, fragments: [101] }] }],
    { 100: { geometryIndex: 0 }, 101: { geometryIndex: 0 } },
  );
  const records = await extractFragments(model, [1], 1, { checkpoint: noopCheckpoint }); // requested dbId is the ASSEMBLY root
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, [1], records);
  const scope = filterByModel.get(model);
  assert.deepEqual([...scope].sort(), [100, 101],
    'both descendant fragments (owned by child dbIds 10/11, not the requested root 1) are in scope');
});

test('two targets entries naming the same model union their extracted-fragment-membership sets', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const world = await freshWorld();
  const filterByModel = new Map();
  const recordsA = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel, model, [10], recordsA);
  const recordsB = await extractFragments(model, [20], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel, model, [20], recordsB);
  assert.deepEqual([...filterByModel.get(model)].sort(), [100, 200]);
});

test('if ANY duplicate targets entry for a model omits dbIds, whole-model scope wins for that epoch', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const world = await freshWorld();

  // Order 1: narrow entry processed FIRST, whole-model SECOND -- whole-model must still win.
  const filterByModel1 = new Map();
  const recordsNarrow = await extractFragments(model, [10], 1, { checkpoint: noopCheckpoint });
  world._addToTargetScopeFilter(filterByModel1, model, [10], recordsNarrow);
  world._addToTargetScopeFilter(filterByModel1, model, undefined, new Map());
  assert.equal(filterByModel1.get(model), 'whole-model');

  // Order 2: whole-model processed FIRST -- a later narrower entry must NOT override it back to a Set.
  const filterByModel2 = new Map();
  world._addToTargetScopeFilter(filterByModel2, model, undefined, new Map());
  world._addToTargetScopeFilter(filterByModel2, model, [10], recordsNarrow);
  assert.equal(filterByModel2.get(model), 'whole-model');
});

test('a targets entry with dbIds omitted applies no filter at all (every matched primitive is in scope)', async () => {
  const model = makeFixture(
    [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }],
    { 100: { geometryIndex: 0 }, 200: { geometryIndex: 0 } },
  );
  const { records } = await extractAllFragments(model, 1, { checkpoint: noopCheckpoint });
  const world = await freshWorld();
  const filterByModel = new Map();
  world._addToTargetScopeFilter(filterByModel, model, undefined, records);
  assert.equal(filterByModel.get(model), 'whole-model',
    'the sentinel, not a Set built from the whole-model records -- callers treat this as "no filter"');
});
