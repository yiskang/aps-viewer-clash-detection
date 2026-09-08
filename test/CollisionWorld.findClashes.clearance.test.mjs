// test/CollisionWorld.findClashes.clearance.test.mjs
//
// M3 Task 9: mode:'clearance' end-to-end wiring, under broadPhase:'linear'.
//
// Fixture INTENT is ported from the task brief's Steps 4/6; the mock plumbing is NOT (the brief's
// own inline stubs use `null` placeholders). This file reuses the SAME stub-model idiom
// test/CollisionWorld.findClashes.test.mjs's own `makeFixture` and
// test/CollisionWorld.findClashes.crossModel.test.mjs's own `makeTwoModelFixture` already
// established (buildMockModel-based, one independent copy per test file, per this repo's own
// convention -- see those two files for the pattern this one mirrors).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.test.mjs's makeFixture) ------------

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
        assert.equal(queriedModel, model, 'getRenderProxy must be called with the leased Model object');
        const geometry = rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { model, viewer, stats };
}

// --- fixture plumbing (mirrors test/CollisionWorld.findClashes.crossModel.test.mjs's
// makeTwoModelFixture, for the cross-model fixture only) -------------------------------------------

function makeModelPart(id, rootNodes, fragSpecs = {}, modelOptions = {}) {
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
  const model = { ...baseModel, id, getUnitScale: () => 1 };
  return { model, rawGeometryByFragId, stats };
}

function makeTwoModelFixture(opts = {}) {
  const {
    rootNodesA = [{ dbId: 1, fragments: [] }], fragSpecsA = {}, modelOptionsA = {},
    rootNodesB = [{ dbId: 1, fragments: [] }], fragSpecsB = {}, modelOptionsB = {},
  } = opts;
  const a = makeModelPart(1, rootNodesA, fragSpecsA, modelOptionsA);
  const b = makeModelPart(2, rootNodesB, fragSpecsB, modelOptionsB);
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        let part;
        if (queriedModel === a.model) part = a;
        else if (queriedModel === b.model) part = b;
        else assert.fail('getRenderProxy called with a Model object neither fixture model produced');
        const geometry = part.rawGeometryByFragId.get(fragId);
        return geometry ? { geometry } : null;
      },
    },
  };
  return { modelA: a.model, modelB: b.model, viewer };
}

const OPTIONS = { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' };
function frozenClock() { return () => 0; }
async function freshWorld(viewer = null, extra = {}) {
  return CollisionWorld.fromViewer(viewer, { ...OPTIONS, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// === Step 4: API-validation tests ================================================================

test('mode:"clearance" without a clearance param is rejected', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await assert.rejects(
    () => world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', groupBy: 'dbId' }),
    /clearance/i,
  );
});

for (const bad of [0, -1, NaN, Infinity, 'not-a-number', null]) {
  test(`mode:"clearance" with clearance=${bad} is rejected`, async () => {
    const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
    const world = await freshWorld(viewer, { now: frozenClock() });
    await world.admitModel(model);
    await assert.rejects(() => world.findClashes({
      source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', clearance: bad, groupBy: 'dbId',
    }));
  });
}

test('clearance param on a non-clearance mode is rejected', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await assert.rejects(() => world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', clearance: 1, groupBy: 'dbId',
  }));
});

test('existing three modes are unaffected by the new mode/clearance validation', async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'volume-overlap', groupBy: 'dbId' });
});

test("mode:'clearance' with explicit broadPhase:'tlas' is rejected (no TLAS clearance variant until Task 10)", async () => {
  const { model, viewer } = makeFixture([{ dbId: 1, fragments: [] }]);
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(model);
  await assert.rejects(() => world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [1] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'tlas',
  }), /tlas/i);
});

// === Step 6: end-to-end linear-path tests =========================================================

// Fixture 9: self-exclusion. The model's only fragment is BOTH the source and (via whole-model
// target scope) a candidate target -- it must never appear as its own clearance target.
test('source instance never appears as its own clearance target', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, fragments: [100] }],
    { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [1] }, target: { targets: [{ model }] },
    mode: 'clearance', clearance: 100, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
});

// Fixture 3 (integration level): a real near-miss pair is reported with correct distance/witness.
// Two 2x2x2 boxes at (0,0,0) and (2.5,0,0) -> face gap 0.5.
test('a real near-miss same-model pair is reported under broadPhase:linear', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].type, 'clearance');
  assert.ok(Math.abs(pairs[0].distance - 0.5) < 1e-3);
  assert.equal(pairs[0].clearance, 1);
  assert.ok(pairs[0].witness.sourcePoint && pairs[0].witness.targetPoint);
  assert.equal(statistics.clearanceHits, pairs.length);
  assert.equal(statistics.clearanceExpandedCandidatePairs, 0); // linear path never populates this
});

// Fixture 10: multi-fragment dbId, minimum wins, order-independent. Source dbId 10 owns fragments A
// (gap to target ~0.8) and B (gap to target ~0.3); the surviving winner must be the CLOSER pair (B).
test('fixture 10: multiple fragment pairs for one dbId -> minimum-distance fragment pair wins', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100, 101] }, { dbId: 20, fragments: [200] }] }],
    {
      // target face at x=9 (box centered at 10, half-extent 1)
      200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [10, 0, 0] },
      // fragment A: face at x=8.2 -> gap 0.8
      100: { geometryIndex: 1, geometry: box(2, 2, 2), at: [7.2, 0, 0] },
      // fragment B: face at x=8.7 -> gap 0.3 (the closer one, must win)
      101: { geometryIndex: 2, geometry: box(2, 2, 2), at: [7.7, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.ok(Math.abs(pairs[0].distance - 0.3) < 1e-3, 'must pick the closer fragment pair (B), not A');
});

// Fixture 5/6 (integration level): Hard Clash exclusion.
// I-5 fix: dbId 10/20 here is a PURE Hard Clash -- the single fragment pair between them is a proven
// overlap, so it never reaches the distance query and clearanceCandidateByKey gets NO entry for this
// key. clearanceHardClashExclusions must still count exactly 1, derived from the complete
// excluded-key set (hardClashExcludedKeys), never from iterating clearanceCandidateByKey.
test('fixture 5/6: a pure Hard-Clash pair with no surviving clearance-distance candidate proves clearanceHardClashExclusions === 1', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 1, children: [{ dbId: 10, fragments: [100] }, { dbId: 20, fragments: [200] }] }],
    {
      // Overlapping boxes (source: -1..1, target: 0..2 on x) -- a genuine crossing, proven overlap.
      100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      200: { geometryIndex: 1, geometry: box(2, 2, 2), at: [1, 0, 0] },
    },
  );
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs, statistics } = await world.findClashes({
    source: { model, dbIds: [10] }, target: { model, dbIds: [20] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 0);
  assert.equal(statistics.clearanceHardClashExclusions, 1);
});

// Fixture 8: cross-model federated clearance.
test('fixture 8: cross-model near-miss pair reported with correct provenance', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  const { pairs } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] }, target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear',
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].source.model, sourceModel);
  assert.equal(pairs[0].target.model, targetModel);
});
