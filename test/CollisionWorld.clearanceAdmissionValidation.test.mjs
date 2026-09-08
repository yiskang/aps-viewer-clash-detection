// test/CollisionWorld.clearanceAdmissionValidation.test.mjs
//
// M3 Task 8 wrote these three tests as `{ todo: true }` scaffolds (before clearance dispatch
// existed to actually run them end-to-end); M3 Task 9 wires that dispatch. This file fills in the
// brief's own `null` stub-model placeholders with real fixtures (same buildMockModel-based idiom
// test/CollisionWorld.findClashes.test.mjs's own `makeFixture` and
// test/CollisionWorld.findClashes.crossModel.test.mjs's own `makeTwoModelFixture` already
// established), un-skips all three, and gets them passing.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

// --- fixture plumbing (mirrors makeTwoModelFixture in test/CollisionWorld.findClashes.crossModel.test.mjs,
// extended with a per-fragment `matrix` override so a corrupted worldMatrix can be injected directly
// -- the `at`-only translation helper the other clearance test files use cannot express a
// non-finite/singular transform) --------------------------------------------------------------------

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}

const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();

function makeModelPart(id, rootNodes, fragSpecs = {}, modelOptions = {}) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    // `spec.matrix`, when present, is used VERBATIM (a raw 16-element array) instead of the
    // `at`-derived translation -- this is how a corrupted (non-finite/singular) worldMatrix reaches
    // extraction, exactly the shape readWorldMatrix's own contract hands back.
    const matrix = spec.matrix || translationMatrix(at);
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix,
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

// A non-finite worldMatrix: identity with one element replaced by NaN.
const NAN_MATRIX = (() => {
  const m = new THREE.Matrix4().toArray();
  m[5] = NaN;
  return m;
})();

// A singular (zero-determinant) worldMatrix: an entire row zeroed out.
const SINGULAR_MATRIX = [
  0, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

// Fixture 17: non-finite/invalid transform -> clearance-invalid-transform diagnostic, pair excluded,
// never silently dropped with zero diagnostics.
test('fixture 17: non-finite worldMatrix on a target instance -> clearance-invalid-transform diagnostic, no crash', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0], matrix: NAN_MATRIX } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const { pairs, statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });

  assert.equal(pairs.length, 0);
  const diag = statistics.diagnostics.find((d) => d.reason === 'clearance-invalid-transform');
  assert.ok(diag, 'expected a clearance-invalid-transform diagnostic');
  assert.equal(diag.scope, 'fragment');
  assert.equal(diag.role, 'target');
});

test('singular (non-invertible) worldMatrix -> clearance-invalid-transform diagnostic', async () => {
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [{ dbId: 1, fragments: [200] }],
    fragSpecsB: { 200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0], matrix: SINGULAR_MATRIX } },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);
  const { statistics } = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 5, groupBy: 'dbId',
  });
  assert.ok(statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform'));
});

test('an invalid instance is never admitted into shared placement state for a clearance call', async () => {
  // Regression guard for the fix's own rationale: a subsequent, unrelated call against the same
  // models must not observe any lingering effect from the earlier invalid record (e.g. a corrupted
  // TLAS/placement entry) -- run a second, valid clearance query against the same models afterward
  // and assert it behaves exactly as if the invalid fragment had never existed.
  //
  // targetModel owns TWO dbIds: dbId 2 (a well-formed fragment, real near-miss gap 0.5 from source)
  // and dbId 3 (a corrupted, non-finite worldMatrix). The FIRST call sweeps the whole target model
  // (picking up both); the SECOND call re-queries ONLY the well-formed dbId 2, through the legacy
  // {model, dbIds} shape, and must reproduce the IDENTICAL clean result (same single pair, same
  // distance, and -- critically -- zero diagnostics of any kind), proving nothing the first call's
  // invalid fragment touched (representative-fragment map, placement table, instance cache) leaked
  // into this second, unrelated query.
  const { modelA: sourceModel, modelB: targetModel, viewer } = makeTwoModelFixture({
    rootNodesA: [{ dbId: 1, fragments: [100] }],
    fragSpecsA: { 100: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] } },
    rootNodesB: [
      { dbId: 2, fragments: [200] },
      { dbId: 3, fragments: [300] },
    ],
    fragSpecsB: {
      200: { geometryIndex: 0, geometry: box(2, 2, 2), at: [2.5, 0, 0] }, // valid, gap 0.5
      300: { geometryIndex: 1, geometry: box(2, 2, 2), at: [10, 0, 0], matrix: NAN_MATRIX }, // corrupted
    },
  });
  const world = await freshWorld(viewer, { now: frozenClock() });
  await world.admitModel(sourceModel);
  await world.admitModel(targetModel);

  const first = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { targets: [{ model: targetModel }] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.equal(first.pairs.length, 1, 'the well-formed dbId 2 pair still surfaces');
  assert.equal(first.pairs[0].target.dbId, 2);
  assert.ok(Math.abs(first.pairs[0].distance - 0.5) < 1e-3);
  assert.ok(first.statistics.diagnostics.some((d) => d.reason === 'clearance-invalid-transform' && d.fragment.dbId === 3));

  const second = await world.findClashes({
    source: { model: sourceModel, dbIds: [1] },
    target: { model: targetModel, dbIds: [2] },
    mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.equal(second.pairs.length, 1);
  assert.equal(second.pairs[0].target.dbId, 2);
  assert.ok(Math.abs(second.pairs[0].distance - 0.5) < 1e-3);
  assert.deepEqual(second.statistics.diagnostics, [], 'no lingering effect from the earlier invalid fragment');
});
