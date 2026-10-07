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

// A well-formed, FINITE, INVERTIBLE worldMatrix (translate(2.5,0,0) * scale(1,2,1)). Reused verbatim
// from test/CollisionWorld.clearanceAdmissionValidation.test.mjs's own ANISOTROPIC_MATRIX/
// ANISOTROPIC_BOUNDS fixture. Since the SVF2 non-uniform fragment clearance design
// (docs/superpowers/specs/2026-10-07-svf2-nonuniform-fragment-clearance-design.md §8 T0) an
// axis-aligned anisotropic scale is SUPPORTED (derived prescaled mesh), so the two
// anisotropic-scale-before-precheck tests below were re-pointed at SHEARED_MATRIX (still outside the
// supported class), each with a sibling asserting this scale(1,2,1) case now runs the precheck path.
const ANISOTROPIC_MATRIX = new THREE.Matrix4()
  .compose(new THREE.Vector3(2.5, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 2, 1))
  .toArray();
const ANISOTROPIC_BOUNDS = { min: [1.5, -2, -1], max: [3.5, 2, 1] };

// translate(2.5,0,0) * shear (x += 0.25*y): non-orthogonal far beyond the 1e-4 gate -> classified
// 'unsupported'/'non-orthogonal' before the precheck. Bounds by hand for box(2,2,2). Its AABB
// (x from 1.25) does not overlap the source box (x up to 1) -- if this transform ever reached
// classifyHardClashPrecheck, the aabb-disjoint event would fire, which the tests below forbid.
const SHEARED_MATRIX = new THREE.Matrix4().set(
  1, 0.25, 0, 2.5,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
).toArray();
const SHEARED_BOUNDS = { min: [1.25, -1, -1], max: [3.75, 1, 1] };

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
// SHEARED_MATRIX/SHEARED_BOUNDS is a well-formed, finite, invertible transform that survives
// admission-time validation but lies outside the supported clearance transform class right before
// the composed Hard-Clash precheck -- taking _runClearanceNarrowPhasePair's own early-out BEFORE
// classifyHardClashPrecheck is ever reached (never the AABB-disjoint path).
test('a sheared (unsupported-transform) target reports precheckNotRunReason: anisotropic-scale-before-precheck', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    {
      101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(2, 2, 2), matrix: SHEARED_MATRIX, bounds: SHEARED_BOUNDS },
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

// Sibling (design §8 T0): the scale(1,2,1) target is now supported -- no
// anisotropic-scale-before-precheck event; the pair reaches classifyHardClashPrecheck (its AABB is
// disjoint from the source's, so aabb-disjoint fires) and the derived distance query (gap 0.5).
test('sibling: a scale(1,2,1) target reaches the precheck (aabb-disjoint) and the derived distance query', async () => {
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
    const { pairs } = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' });
    const precheckEvents = events.filter((p) => p.stage === 'not-run');
    assert.equal(precheckEvents.filter((p) => p.precheckNotRunReason === 'anisotropic-scale-before-precheck').length, 0);
    assert.ok(precheckEvents.some((p) => p.precheckNotRunReason === 'aabb-disjoint'));
    const distanceEvents = events.filter((p) => p.stage === 'clearance-distance-query');
    assert.equal(distanceEvents.length, 1);
    assert.equal(distanceEvents[0].targetTransformPath, 'derived');
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].distance, 0.5);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

// Phase 1 whole-phase review fix (Important #1): `reportPrecheckNotRun` is now `null` (not a
// no-op closure) on the no-recorder path -- `_runClearanceNarrowPhasePair`'s own pre-precheck skip
// points call it via `reportPrecheckNotRun?.(...)`. These two tests exercise EXACTLY those skip
// points with NO recorder installed at all, so a regression that dropped the `?.` (calling `null`
// as a function) would throw a TypeError and fail these tests, rather than only being caught by
// code review or a performance profile.
test('no recorder installed: geometry-unsupported-before-precheck skip point does not throw', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] } },
  );
  const realGetRenderProxy = viewer.impl.getRenderProxy;
  viewer.impl.getRenderProxy = (queriedModel, fragId) => (fragId === 102 ? null : realGetRenderProxy(queriedModel, fragId));
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 5, groupBy: 'dbId' });
  assert.ok(Array.isArray(result.pairs));
});

test('no recorder installed: anisotropic-scale-before-precheck skip point does not throw', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    {
      101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(2, 2, 2), matrix: SHEARED_MATRIX, bounds: SHEARED_BOUNDS },
    },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' });
  assert.ok(Array.isArray(result.pairs));
  assert.ok(result.statistics.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'), 'the skip point was genuinely taken');
});

// Sibling (design §8 T0): with no recorder, the scale(1,2,1) target is measured (no skip point).
test('sibling: no recorder installed, a scale(1,2,1) target is measured (gap 0.5)', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    {
      101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(2, 2, 2), matrix: ANISOTROPIC_MATRIX, bounds: ANISOTROPIC_BOUNDS },
    },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId', broadPhase: 'linear' });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].distance, 0.5);
  assert.deepEqual(result.statistics.diagnostics, []);
});
