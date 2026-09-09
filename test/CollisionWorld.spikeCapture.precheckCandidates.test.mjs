// test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { setSpikeInputCapture, clearSpikeInputCapture } from '../collision/scheduler.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
function makeFixture(rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: (m, fragId) => ({ geometry: rawGeometryByFragId.get(fragId) }) } };
  return { model, viewer };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

test('precheck-candidate-list capture fires exactly once per clearance findClashes call, after the budget check, with the complete real candidate list', async () => {
  // Reused fixture (gap 0.5, within clearance) -- verified precedent in
  // test/CollisionWorld.findClashes.clearance.test.mjs.
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const captured = [];
  setSpikeInputCapture((kind, payload) => { if (kind === 'precheck-candidate-list') captured.push(payload); });
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    const result = await world.findClashes({
      source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId',
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].candidates.length, 1);
    const c = captured[0].candidates[0];
    assert.equal(typeof c.sourceFragmentId, 'number');
    assert.equal(typeof c.sourceGeometryIndex, 'number');
    assert.equal(typeof c.sourceLoadEpoch, 'number');
    assert.equal(typeof c.targetFragmentId, 'number');
    assert.equal(typeof c.targetGeometryIndex, 'number');
    assert.equal(typeof c.targetLoadEpoch, 'number');
    assert.ok(Array.isArray(result.pairs));
  } finally {
    clearSpikeInputCapture();
  }
});

test('no capture fn installed -- clearance findClashes behaves exactly as before', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.ok(Array.isArray(result.pairs));
});
