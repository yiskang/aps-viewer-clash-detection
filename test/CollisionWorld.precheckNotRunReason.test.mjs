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
    // `spec.matrix`/`spec.bounds`, when present, are used VERBATIM instead of the `at`-derived
    // translation -- same override idiom as test/CollisionWorld.clearanceAdmissionValidation.test.mjs's
    // own makeModelPart, needed to inject a non-uniformly-scaled worldMatrix directly.
    const matrix = spec.matrix || translationMatrix(at);
    const bounds = spec.bounds || boundsOf(spec.geometry, at);
    fragmentGeometry.set(fragId, { geometryIndex: spec.geometryIndex, matrix, bounds });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: (m, fragId) => ({ geometry: rawGeometryByFragId.get(fragId) }) } };
  return { model, viewer };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A well-formed, FINITE, INVERTIBLE worldMatrix (translate(2.5,0,0) * scale(1,2,1)) that still admits
// cleanly at admission time but is NOT uniform scale -- validateUniformScale's own finer-grained gate
// rejects it. Reused verbatim from test/CollisionWorld.clearanceAdmissionValidation.test.mjs's own
// ANISOTROPIC_MATRIX/ANISOTROPIC_BOUNDS fixture (same box(2,2,2) source geometry, so the bounds by-hand
// computation matches exactly).
const ANISOTROPIC_MATRIX = new THREE.Matrix4()
  .compose(new THREE.Vector3(2.5, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 1))
  .toArray();
const ANISOTROPIC_BOUNDS = { min: [1.5, -2, -1], max: [3.5, 2, 1] };

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

// Task 1.5 fix round (Important finding #2): the geometry-unsupported-before-precheck pre-precheck
// skip point had no test coverage of its own -- only verified by code inspection. Same
// "permanently missing render proxy" shape test/CollisionWorld.findClashes.dispatch.test.mjs's own
// RenderProxyUnavailableError fixture uses: getRenderProxy returns null for one fragment, driving
// resolveGeometryRecord to return null for that side, taking _runClearanceNarrowPhasePair's
// `if (!targetRecord) { reportPrecheckNotRun(...); return ...; }` early-out -- BEFORE
// classifyHardClashPrecheck (and therefore its own AABB-disjoint check) is ever reached.
test('a pair whose target render proxy never resolves reports precheckNotRunReason: geometry-unsupported-before-precheck', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] } },
  );
  const realGetRenderProxy = viewer.impl.getRenderProxy;
  viewer.impl.getRenderProxy = (queriedModel, fragId) => (fragId === 102 ? null : realGetRenderProxy(queriedModel, fragId));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push(payload));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 5, groupBy: 'dbId' });
    const precheckEvents = events.filter((p) => p.stage === 'not-run');
    assert.ok(precheckEvents.some((p) => p.precheckNotRunReason === 'geometry-unsupported-before-precheck'));
    // No AABB-disjoint or volume-overlap-query event must ALSO fire for this pair -- geometry
    // resolution fails strictly before classifyHardClashPrecheck is ever called.
    assert.equal(precheckEvents.filter((p) => p.precheckNotRunReason === 'aabb-disjoint').length, 0);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

// Task 1.5 fix round (Important finding #2): same gap for anisotropic-scale-before-precheck.
// ANISOTROPIC_MATRIX/ANISOTROPIC_BOUNDS is a well-formed, finite, invertible transform that survives
// admission-time validation but fails validateUniformScale's own finer-grained gate right before the
// composed Hard-Clash precheck -- taking _runClearanceNarrowPhasePair's own early-out BEFORE
// classifyHardClashPrecheck is ever reached (never the AABB-disjoint path, since the two operands'
// bounds do overlap here).
test('a non-uniformly-scaled target reports precheckNotRunReason: anisotropic-scale-before-precheck', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    {
      101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(2, 2, 2), matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS },
    },
  );
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push(payload));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' });
    const precheckEvents = events.filter((p) => p.stage === 'not-run');
    assert.ok(precheckEvents.some((p) => p.precheckNotRunReason === 'anisotropic-scale-before-precheck'));
    assert.equal(precheckEvents.filter((p) => p.precheckNotRunReason === 'aabb-disjoint').length, 0);
  } finally {
    clearDiagnosticEventRecorder();
  }
});
