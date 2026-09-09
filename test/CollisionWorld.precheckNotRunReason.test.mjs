import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../collision/scheduler.js';
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

test('a provably-disjoint AABB pair reports precheckNotRunReason: aabb-disjoint', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [100, 100, 100] } },
  );
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push(payload));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 500, groupBy: 'dbId' });
    assert.ok(events.some((p) => p.precheckNotRunReason === 'aabb-disjoint'));
  } finally {
    clearDiagnosticEventRecorder();
  }
});
