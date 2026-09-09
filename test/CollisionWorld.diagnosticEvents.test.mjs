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

async function runClearance(fragSpecs, clearance) {
  const { model, viewer } = makeFixture([{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }], fragSpecs);
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance, groupBy: 'dbId' });
    return { events, result };
  } finally {
    clearDiagnosticEventRecorder();
  }
}

test('crossing pair -> hard-clash-excluded: crossing event fires, no clearance-distance-query event, geometry-resolve fires for both sides', async () => {
  // Reused fixture -- test/CollisionWorld.clearanceStatistics.test.mjs's own "overlaps the diamond -> excluded".
  const { events, result } = await runClearance(
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] } },
    1,
  );
  assert.equal(result.pairs.length, 0, 'sanity: a Hard-Clash pair produces no clearance pair');
  assert.ok(events.some((e) => e.kind === 'hard-clash-precheck' && e.payload.stage === 'crossing'));
  assert.equal(events.filter((e) => e.kind === 'clearance-distance-query').length, 0, 'excluded pair never reaches the distance query');
  const geometryResolve = events.filter((e) => e.kind === 'geometry-resolve');
  assert.ok(geometryResolve.length >= 2);
  for (const e of geometryResolve) {
    assert.equal(e.payload.stage, 'geometry-resolve');
    assert.ok(Number.isFinite(e.payload.ms));
  }
});

test('AABB-disjoint near-miss (skip-precheck) -> distance query runs, NO hard-clash-precheck subterm/total events fire', async () => {
  // Reused fixture -- test/CollisionWorld.findClashes.clearance.test.mjs's own "near-miss, gap 0.5 <= clearance 1".
  const { events } = await runClearance(
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
    1,
  );
  assert.equal(events.filter((e) => e.kind === 'hard-clash-precheck').length, 0, 'aabb-disjoint never calls classifyHardClashPrecheck\'s own volumeOverlapQuery bracket');
  const distanceQuery = events.filter((e) => e.kind === 'clearance-distance-query');
  assert.equal(distanceQuery.length, 1);
  assert.equal(distanceQuery[0].payload.stage, 'clearance-distance-query');
  assert.ok(['aborted', 'beyond-threshold', 'hit'].includes(distanceQuery[0].payload.outcome));
  assert.equal(typeof distanceQuery[0].payload.anchoredOnSource, 'boolean');
  assert.equal(typeof distanceQuery[0].payload.anchorLocalMaxThreshold, 'number');
  assert.equal(distanceQuery[0].payload.requestedClearance, 1);
});

test('no recorder installed: findClashes behaves exactly as before', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId' });
  assert.ok(Array.isArray(result.pairs));
});

test('narrow-phase-pair events fire for containment/volume-overlap/surface-intersection modes (non-clearance dispatch)', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] } },
  );
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'containment', groupBy: 'dbId' });
    const narrowPhase = events.filter((e) => e.kind === 'narrow-phase-pair');
    assert.ok(narrowPhase.some((e) => e.payload.stage === 'containment'));
    assert.equal(typeof narrowPhase[0].payload.sourceTriangles, 'number');
  } finally {
    clearDiagnosticEventRecorder();
  }
});
