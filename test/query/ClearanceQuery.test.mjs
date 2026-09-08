import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearanceQuery } from '../../collision/query/ClearanceQuery.js';
import { box, at, testInstance } from '../fixtures/geometry.mjs';

// Fixture 1: farther than clearance. Two 2x2x2 boxes, centers 10 apart on X -> exact face gap 8.
test('fixture 1: farther than clearance -> withinClearance:false, distance:null', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 2, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, false);
  assert.equal(result.distance, null);
});

// Fixture 3: slightly within threshold. Boxes at (0,0,0) and (2.5,0,0), clearance=1 -> gap 0.5.
test('fixture 3: slightly within threshold -> withinClearance:true, distance ~ 0.5', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2.5, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 0.5) < 1e-4);
  assert.ok(Array.isArray(result.witness.sourcePoint) && result.witness.sourcePoint.length === 3);
  assert.ok(Array.isArray(result.witness.targetPoint) && result.witness.targetPoint.length === 3);
  // Endpoints must actually be near the two facing faces (x~1 and x~1.5), not swapped/garbled.
  assert.ok(Math.abs(result.witness.sourcePoint[0] - 1) < 1e-3);
  assert.ok(Math.abs(result.witness.targetPoint[0] - 1.5) < 1e-3);
});

// Fixture 2: exactly at threshold (inclusive per spec's (floor, clearance] interval).
test('fixture 2: exactly at threshold -> withinClearance:true', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(3, 0, 0)); // face gap exactly 1
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-9 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-4);
});

// Fixture 4 / 13: surface touching / dead-band -> withinClearance:false.
test('fixture 4: touching surfaces (gap 0) -> withinClearance:false', () => {
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
  assert.ok(Math.abs(result.distance) < 1e-4);
});

test('fixture 13: dead-band gap below toleranceFloor -> withinClearance:false', () => {
  const gap = 1e-7;
  const source = testInstance(box(2, 2, 2), at(0, 0, 0));
  const target = testInstance(box(2, 2, 2), at(2 + gap, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, false);
});

// Fixture 7: rotated geometry, analytically known edge-to-face distance. Rotating the
// half-size-1 source cube's x/z cross-section by 45 deg puts its corner at (x=1,z=1) at local
// (sqrt2, 0) -- since rotation is only around Y, this is a full vertical edge (y in [-1,1]) at
// x=sqrt2, z=0, i.e. the source's maximum +X reach. Target left face sits at (X - 1); true gap is
// (X - 1) - sqrt2. Target center X = 2 + sqrt2 gives gap = 1 (independently confirmed via
// codex-advisor, which also ran this exact fixture and got the same distance). clearance is set
// above 1 (not exactly 1) so the test does not sit on the pinned API's own strict internal
// `score < maxThreshold` pruning boundary.
test('fixture 7: rotated source, analytically known minimum distance', () => {
  const rotated = new THREE.Matrix4().makeRotationY(Math.PI / 4);
  const source = testInstance(box(2, 2, 2), rotated);
  const target = testInstance(box(2, 2, 2), at(2 + Math.SQRT2, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 1.5, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 1) < 1e-3);
});

// Fixture 16: uniform scale correctness, EQUAL scale — reported distance must be world-space.
test('fixture 16a: equal uniform scale, distance converted to world units', () => {
  const scaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), scaled); // local half-size 0.5, world half-size 1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // target half-size 1, face at x=3
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 16b (Critical #2 regression, Codex's own repro): UNEQUAL source/target scale. Source
// scale 2, target scale 1, true world gap 2, clearance 3 -- a naive single-source-derived
// maxThreshold (1.5) would wrongly return null here; the fix must find the real within-clearance hit.
test('fixture 16b: unequal source/target scale, distance still correct and within clearance', () => {
  const sourceScaled = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(0, 0, 0);
  const source = testInstance(box(1, 1, 1), sourceScaled); // world half-size 1, face at x=1
  const target = testInstance(box(2, 2, 2), at(4, 0, 0)); // scale 1, face at x=3 -- world gap 2
  const result = clearanceQuery(source, target, { clearance: 3, toleranceFloor: 1e-6 });
  assert.equal(result.withinClearance, true);
  assert.ok(Math.abs(result.distance - 2) < 1e-3, `expected world-space gap ~2, got ${result.distance}`);
});

// Fixture 15: anisotropic scale rejection.
test('fixture 15: anisotropic source scale -> aborted with clearance-anisotropic-scale-unsupported', () => {
  const aniso = new THREE.Matrix4().makeScale(2, 1, 1);
  const source = testInstance(box(1, 1, 1), aniso);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
  assert.ok(result.diagnostics.some((d) => d.reason === 'clearance-anisotropic-scale-unsupported'));
});

test('non-finite source matrix -> aborted', () => {
  const bad = new THREE.Matrix4();
  bad.elements[0] = NaN;
  const source = testInstance(box(1, 1, 1), bad);
  const target = testInstance(box(2, 2, 2), at(4, 0, 0));
  const result = clearanceQuery(source, target, { clearance: 5, toleranceFloor: 1e-6 });
  assert.equal(result.aborted, true);
});
