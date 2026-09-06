// test/CollisionWorld.placementIndex.test.mjs
//
// Task 9 (Batch 3): _placementByEpoch / _placementRevisionByEpoch -- an epoch-scoped,
// write-once-per-fragment placement index populated at the same extraction call sites
// _recordRepresentativeFragments already uses (findClashes, for source and every target group).
// Purely additive: nothing reads this table yet (Task 10's TlasCache is the first consumer),
// so every assertion here inspects the private fields directly, mirroring this repo's own
// established pattern for _instanceCache/_representativeFragmentByGeometry
// (test/CollisionWorld.findClashes.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

function makeFixture(rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: spec.bounds || (spec.geometry ? boundsOf(spec.geometry, at) : { min: at, max: at }),
    });
    if (spec.geometry) rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel, stats } = buildMockModel(rootNodes, fragmentGeometry, modelOptions);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        const geometry = rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { model, viewer, stats };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
function query(model, sourceDbIds, targetDbIds, mode = 'surface-intersection') {
  return { source: { model, dbIds: sourceDbIds }, target: { model, dbIds: targetDbIds }, mode, groupBy: 'dbId' };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

test('a genuinely new fragment is inserted into _placementByEpoch and bumps the revision', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;

  await world.findClashes(query(model, [10], [20]));

  // The revision bumps ONCE PER _recordPlacement CALL that inserted at least one new fragment, not
  // once per new fragment (Batch 3 whole-batch review, Minor finding #10 -- the original comment
  // here implied the latter). This call touches two epoch-scoped call sites (source's own
  // sourceExtracted, then the target group's own bucket), each contributing exactly one fragment
  // and each triggering its own +1 -- landing on 2 here is a coincidence of "one new fragment per
  // call", not evidence of per-fragment counting; see the dedicated call-vs-fragment-count test
  // below for that distinction made explicit.
  assert.equal(world._placementRevisionByEpoch.get(epoch), 2, 'two _recordPlacement calls each contributed exactly one new fragment');
  const placement100 = world._placementByEpoch.get(epoch).get(100);
  assert.ok(placement100, 'fragment 100 must be recorded');
  assert.equal(placement100.ownerDbId, 10);
  assert.equal(placement100.modelId, model.id);
  assert.deepEqual(placement100.worldBounds, { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
  assert.equal(placement100.worldMatrix.length, 16);
});

test('re-requesting an already-present fragmentId does NOT overwrite its placement or bump the revision', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;

  await world.findClashes(query(model, [10], [20]));
  const revisionAfterFirst = world._placementRevisionByEpoch.get(epoch);
  const recordedFirst = world._placementByEpoch.get(epoch).get(100);

  // Second, overlapping call re-extracting the SAME two fragments.
  await world.findClashes(query(model, [10], [20]));

  assert.equal(world._placementRevisionByEpoch.get(epoch), revisionAfterFirst,
    'no genuinely new fragment in the second call -- revision must not advance');
  assert.equal(world._placementByEpoch.get(epoch).get(100), recordedFirst,
    'the exact same placement object -- never replaced by a later extraction of the same fragment');
});

test('_placementByEpoch and _placementRevisionByEpoch are released on evictModel', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;
  await world.findClashes(query(model, [10], [20]));
  assert.ok(world._placementByEpoch.has(epoch));
  assert.ok(world._placementRevisionByEpoch.has(epoch));

  world.evictModel(model);

  assert.equal(world._placementByEpoch.has(epoch), false);
  assert.equal(world._placementRevisionByEpoch.has(epoch), false);
});

test('_placementByEpoch and _placementRevisionByEpoch are cleared wholesale on dispose', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  world.admitModel(model);
  await world.findClashes(query(model, [10], [20]));
  assert.equal(world._placementByEpoch.size, 1);
  assert.equal(world._placementRevisionByEpoch.size, 1);

  world.dispose();

  assert.equal(world._placementByEpoch.size, 0);
  assert.equal(world._placementRevisionByEpoch.size, 0);
});

test('a target group whose model differs from source records its own placement under its own epoch, with its own modelId', async () => {
  const sourceFixture = makeFixture(
    [{ dbId: 1, fragments: [10] }],
    { 10: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] } },
  );
  const targetBaseModel = buildMockModel(
    [{ dbId: 2, fragments: [20] }],
    new Map([[20, { geometryIndex: 0 }]]),
  ).model;
  const targetModel = { ...targetBaseModel, id: 2, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel) {
        return queriedModel === sourceFixture.model ? { geometry: box(1, 1, 1) } : null;
      },
    },
  };
  const world = await freshWorld(viewer, { now: frozenClock() });
  const sourceEpoch = world.admitModel(sourceFixture.model).epoch;
  const targetEpoch = world.admitModel(targetModel).epoch;

  await world.findClashes({
    source: { model: sourceFixture.model, dbIds: [1] },
    target: { model: targetModel, dbIds: [2] },
    mode: 'surface-intersection', groupBy: 'dbId',
  });

  const sourcePlacement = world._placementByEpoch.get(sourceEpoch).get(10);
  const targetPlacement = world._placementByEpoch.get(targetEpoch).get(20);
  assert.equal(sourcePlacement.modelId, sourceFixture.model.id);
  assert.equal(targetPlacement.modelId, targetModel.id);
  assert.equal(targetPlacement.ownerDbId, 2);
});

test('the revision bumps once per _recordPlacement CALL with growth, not once per new fragment within that call', async () => {
  // One target group with THREE new fragments in a SINGLE _recordPlacement call must bump the
  // revision by exactly 1, not 3 -- Batch 3 whole-batch review, Minor finding #10.
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [
      { dbId: 10, fragments: [100] },
      { dbId: 20, children: [{ dbId: 21, fragments: [200] }, { dbId: 22, fragments: [201] }, { dbId: 23, fragments: [202] }] },
    ] }],
    {
      100: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(1, 1, 1), at: [5, 0, 0] },
      201: { geometryIndex: 1, geometry: box(1, 1, 1), at: [6, 0, 0] },
      202: { geometryIndex: 1, geometry: box(1, 1, 1), at: [7, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const epoch = world.admitModel(model).epoch;

  await world.findClashes(query(model, [10], [20])); // target dbId 20's subtree has 3 fragments, one call

  assert.equal(world._placementRevisionByEpoch.get(epoch), 2,
    'source call (1 new fragment) + target call (3 new fragments, one call) = 2 bumps, not 4');
  assert.equal(world._placementByEpoch.get(epoch).size, 4, 'all 4 fragments are still recorded');
});
