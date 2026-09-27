// test/clashpanel/viewer/markers.test.mjs — T23 (Tier B; fakes only — overlay rendering and element
// world-bounds correctness are live gates G2 / PG-1 / F7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarkerSet, computeMarkerRadius, validBox,
  MIN_MARKER_RADIUS, MAX_MARKER_RADIUS, MARKER_RADIUS_FRACTION, HARD_MARKER_COLOR, SOFT_MARKER_COLOR, OUTLINE_COLORS,
} from '../../../clashpanel/viewer/markers.js';
import { createBridgeHarness, NAMES } from '../support/viewerFaults.mjs';
import { createFakeThree } from '../support/fakeThree.mjs';

function setup() {
  const h = createBridgeHarness();
  const { THREE, stats } = createFakeThree();
  const set = createMarkerSet({ THREE, overlays: h.api.overlays, names: NAMES });
  return { h, THREE, stats, set };
}

// geometries + materials disposed at least once (T3 stats); overDisposed() must stay empty.
function disposedCount(stats) {
  assert.deepEqual(stats.overDisposed(), [], 'nothing disposed twice');
  return [...stats.created.geometry, ...stats.created.material].filter((x) => x.disposeCount > 0).length;
}

test('the fake is r71-faithful and mesh-first strict (harness self-check)', () => {
  const { h, THREE } = setup();
  assert.equal('setScalar' in new THREE.Vector3(), false);
  h.api.overlays.addScene(NAMES.overlayMarkers);
  assert.throws(() => h.api.overlays.addMesh({}, {}), /scene name must be a string/);
  assert.throws(() => h.api.overlays.addMesh(NAMES.overlayMarkers, {}), /overlays\.addMesh/);
});

test('Hard location: one sphere at the witness point, scene created once, mesh-first addMesh', () => {
  const { h, set } = setup();
  const [mesh] = set.addLocation({ point: [1, 2, 3], radius: 0.5 });
  const [mesh2] = set.addLocation({ point: [4, 5, 6], radius: 0.5 });
  assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z], [1, 2, 3]);
  assert.deepEqual([mesh.scale.x, mesh.scale.y, mesh.scale.z], [0.5, 0.5, 0.5]);
  assert.equal(mesh.material.parameters.color, HARD_MARKER_COLOR);
  assert.equal(mesh.material.parameters.depthTest, false);
  assert.equal(mesh.geometry, mesh2.geometry, 'shared unit sphere');
  assert.equal(h.callsOf('addScene').length, 1);
  assert.deepEqual(h.callsOf('addMesh').map((e) => e.args), [[mesh, NAMES.overlayMarkers], [mesh2, NAMES.overlayMarkers]]);
  assert.deepEqual(h.viewer.overlayMeshes(NAMES.overlayMarkers), [mesh, mesh2]);
});

test('Soft location: two spheres + one line at closestPoints (Soft colour); no point ⇒ nothing, no scene', () => {
  const { h, set, THREE, stats } = setup();
  assert.deepEqual(set.addLocation({ radius: 1 }), []);
  assert.deepEqual(set.addLocation({ point: [1, 2], radius: 1 }), [], 'malformed point');
  assert.equal(h.callsOf('addScene').length, 0);
  const meshes = set.addLocation({ closestPoints: { first: [0, 0, 0], second: [1, 0, 0] }, radius: 1 });
  assert.equal(meshes.length, 3);
  const [a, b, line] = meshes;
  assert.equal(a.material.parameters.color, SOFT_MARKER_COLOR);
  assert.equal(b.material.parameters.color, SOFT_MARKER_COLOR);
  assert.ok(line instanceof THREE.Line);
  assert.equal(line.material.parameters.color, SOFT_MARKER_COLOR);
  assert.deepEqual(line.geometry.points.map((p) => [p.x, p.y, p.z]), [[0, 0, 0], [1, 0, 0]]);
});

test('outlines: one wireframe per side with bounds, two distinct colours, evidence-gated omission', () => {
  const { h, set } = setup();
  const m1 = h.models[0]; const m2 = h.models[1];
  const boxes = new Map([[1, [0, 0, 0, 1, 2, 3]], [2, [5, 5, 5, 6, 6, 6]]]);
  const { meshes, omitted } = set.addOutlines([{ model: m1, dbId: 1 }, { model: m2, dbId: 2 }], (_m, dbId) => boxes.get(dbId));
  assert.equal(omitted, 0);
  assert.equal(meshes.length, 2);
  assert.equal(meshes[0].material.parameters.color, OUTLINE_COLORS[0]);
  assert.equal(meshes[1].material.parameters.color, OUTLINE_COLORS[1]);
  assert.notEqual(OUTLINE_COLORS[0], OUTLINE_COLORS[1]);
  const corners = new Set(meshes[0].geometry.points.map((p) => `${p.x},${p.y},${p.z}`));
  assert.equal(corners.size, 8, 'the path visits all 8 corners');
  assert.deepEqual(h.viewer.overlayMeshes(NAMES.overlayOutlines), meshes);
  for (const bad of [null, undefined, [0, 0, 0, 1, 1], [NaN, 0, 0, 1, 1, 1], [2, 0, 0, 1, 1, 1], () => { throw new Error('no tree'); }]) {
    const r = set.addOutlines([{ model: m1, dbId: 9 }], typeof bad === 'function' ? bad : () => bad);
    assert.deepEqual(r, { meshes: [], omitted: 1 });
  }
});

test('radius: union bounding sphere × fraction, clamped; empty / zero / NaN boxes fall back to the minimum', () => {
  assert.equal(computeMarkerRadius([]), MIN_MARKER_RADIUS);
  assert.equal(computeMarkerRadius([null, [NaN, 0, 0, 1, 1, 1]]), MIN_MARKER_RADIUS);
  assert.equal(computeMarkerRadius([[1, 1, 1, 1, 1, 1]]), MIN_MARKER_RADIUS, 'zero-size box');
  assert.equal(computeMarkerRadius([[0, 0, 0, 1e6, 1e6, 1e6]]), MAX_MARKER_RADIUS);
  // union [0..100] on x ⇒ bounding-sphere radius 50 ⇒ 50 × fraction (0.1, inside [MIN, MAX])
  assert.equal(computeMarkerRadius([[0, 0, 0, 40, 0, 0], [60, 0, 0, 100, 0, 0]]), 50 * MARKER_RADIUS_FRACTION);
  assert.equal(computeMarkerRadius([[0, 0, 0, 100, 0, 0], [0, 0, 0, Infinity, 1, 1]]), 0.1, 'infinite box skipped');
  assert.equal(validBox(new Float32Array([0, 0, 0, 1, 1, 1])), true);
});

test('removeAll removes ONLY meshes this set created (by reference) and disposes per-object geometry once', () => {
  const { h, set, THREE, stats } = setup();
  const foreignMarker = h.addForeignMesh(NAMES.overlayMarkers);
  const soft = set.addLocation({ closestPoints: { first: [0, 0, 0], second: [1, 1, 1] }, radius: 1 });
  const { meshes: outl } = set.addOutlines([{ model: h.models[0], dbId: 1 }], () => [0, 0, 0, 1, 1, 1]);
  const foreignOutline = h.addForeignMesh(NAMES.overlayOutlines);
  assert.equal(set.remove(foreignMarker), false, 'a foreign mesh is never touched');
  assert.equal(set.removeAll(), 4);
  assert.deepEqual(h.viewer.overlayMeshes(NAMES.overlayMarkers), [foreignMarker]);
  assert.deepEqual(h.viewer.overlayMeshes(NAMES.overlayOutlines), [foreignOutline]);
  assert.equal(soft[2].geometry.disposeCount, 1, 'line geometry disposed at removal');
  assert.equal(outl[0].geometry.disposeCount, 1, 'outline geometry disposed at removal');
  assert.equal(soft[0].geometry.disposeCount, 0, 'shared sphere NOT disposed by removeAll');
  assert.equal(set.removeAll(), 0, 'idempotent');
  assert.ok(h.callsOf('removeMesh').every((e) => typeof e.args[1] === 'string' && e.args[0] !== foreignMarker && e.args[0] !== foreignOutline));
});

test('disposeShared: shared sphere + 5 materials disposed once, only the scenes this set added are removed', () => {
  const { h, set, THREE, stats } = setup();
  h.addForeignMesh(NAMES.overlayOutlines);                  // outline scene pre-exists (not ours)
  const [sphere] = set.addLocation({ point: [0, 0, 0], radius: 1 });
  set.addOutlines([{ model: h.models[0], dbId: 1 }], () => [0, 0, 0, 1, 1, 1]);
  set.removeAll();
  set.disposeShared();
  assert.equal(sphere.geometry.disposeCount, 1);
  assert.equal(sphere.material.disposeCount, 1);
  assert.equal(disposedCount(stats), 1 /* outline geometry */ + 1 /* sphere */ + 5 /* materials */);
  assert.equal(h.hasScene(NAMES.overlayMarkers), false, 'scene we added is removed');
  assert.equal(h.hasScene(NAMES.overlayOutlines), true, 'scene we did not add stays');
  set.disposeShared();
  assert.equal(disposedCount(stats), 7, 'idempotent');
});

test('a mesh whose removal failed stays tracked; its scene and the shared resources are KEPT until it is gone', () => {
  const { h, set } = setup();
  const [mesh] = set.addLocation({ point: [0, 0, 0], radius: 1 });
  h.failAt('removeMesh', 'before');
  assert.throws(() => set.remove(mesh), /injected/);
  assert.equal(set.owns(mesh), true);
  assert.equal(set.disposeShared(), false, 'not everything could be released');
  assert.equal(mesh.geometry.disposeCount, 0, 'never dispose what is still drawn');
  assert.equal(h.hasScene(NAMES.overlayMarkers), true, 'never removeScene under a tracked Panel mesh');
  assert.equal(h.callsOf('removeScene').length, 0);
  assert.equal(set.remove(mesh), true);
  assert.equal(set.disposeShared(), true, 'retried: everything released');
  assert.equal(mesh.geometry.disposeCount, 1);
  assert.equal(h.hasScene(NAMES.overlayMarkers), false);
  assert.deepEqual(h.panelMeshes(), []);
});

test('scene creation is write-ahead: an addScene that throws AFTER creating the scene is still removed by disposeShared', () => {
  const { h, set } = setup();
  h.failAt('addScene', 'after');
  assert.throws(() => set.addLocation({ point: [0, 0, 0], radius: 1 }), /injected addScene failure/);
  assert.equal(h.hasScene(NAMES.overlayMarkers), true, 'the Viewer did create it');
  assert.equal(set.size(), 0, 'no mesh was created');
  assert.equal(set.disposeShared(), true);
  assert.equal(h.hasScene(NAMES.overlayMarkers), false, 'no leaked scene');
});

test('beforeAdd runs immediately before each addMesh; a throw there aborts that add (mesh stays tracked for cleanup)', () => {
  const { h, set, THREE, stats } = setup();
  const seen = [];
  const meshes = set.addLocation({ closestPoints: { first: [0, 0, 0], second: [1, 0, 0] }, radius: 1 }, {
    beforeAdd: (mesh, scene) => { seen.push([mesh, scene, h.viewer.overlayMeshes(scene).includes(mesh)]); },
  });
  assert.deepEqual(seen.map(([m, s, inScene]) => [m, s, inScene]), meshes.map((m) => [m, NAMES.overlayMarkers, false]));
  let calls = 0;
  assert.throws(() => set.addLocation({ closestPoints: { first: [0, 0, 0], second: [1, 0, 0] }, radius: 1 }, {
    beforeAdd: () => { if (++calls === 3) throw new Error('stale token'); },
  }), /stale token/);
  assert.equal(h.panelMeshes().length, 5, '3 + 2 added; the line was never added');
  assert.equal(set.size(), 6, 'the aborted line is still tracked');
  set.removeAll();
  assert.deepEqual(h.panelMeshes(), []);
  assert.equal(stats.created.geometry.filter((g) => !(g instanceof THREE.SphereGeometry) && g.disposeCount === 1).length, 2, 'both line geometries disposed');
});
