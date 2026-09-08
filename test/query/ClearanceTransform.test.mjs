import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { validateUniformScale, computeToleranceFloor } from '../../collision/query/ClearanceTransform.js';

test('rigid transform (no scale): valid, scaleFactor 1', () => {
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 4).setPosition(1, 2, 3);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 1) < 1e-9);
});

test('uniform scale: valid, scaleFactor matches', () => {
  const m = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(5, 0, 0);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 2) < 1e-9);
});

test('anisotropic scale: invalid', () => {
  assert.equal(validateUniformScale(new THREE.Matrix4().makeScale(2, 1, 1)).valid, false);
});

test('scale uniform within relative tolerance: valid', () => {
  const m = new THREE.Matrix4().makeScale(2, 2 * (1 + 1e-5), 2); // well inside 1e-4 tolerance
  assert.equal(validateUniformScale(m).valid, true);
});

test('scale drift beyond relative tolerance: invalid', () => {
  const m = new THREE.Matrix4().makeScale(2, 2 * (1 + 1e-2), 2); // 1% drift, well beyond 1e-4
  assert.equal(validateUniformScale(m).valid, false);
});

test('sheared matrix (equal-length, non-orthogonal basis columns): invalid', () => {
  // Three basis columns with equal magnitude (all ~1.0) but not mutually orthogonal:
  // A = (1, 0, 0), B = (0.5, sqrt(3)/2, 0), C = (0, 0, 1).
  // Magnitude check alone would accept this (scale ≈ 1,1,1). Orthogonality check must reject it.
  const sqrt3_2 = Math.sqrt(3) / 2;
  const m = new THREE.Matrix4().set(
    1, 0.5, 0, 0,
    0, sqrt3_2, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  assert.equal(validateUniformScale(m).valid, false);
});

test('reflected (negative) scale: invalid', () => {
  assert.equal(validateUniformScale(new THREE.Matrix4().makeScale(-2, 2, 2)).valid, false);
});

test('tiny but legitimate uniform scale is not rejected by an absolute determinant cutoff', () => {
  const m = new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6).setPosition(1, 1, 1);
  const result = validateUniformScale(m);
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.scaleFactor - 1e-6) < 1e-12);
});

test('non-finite matrix: invalid, not a thrown exception', () => {
  const m = new THREE.Matrix4();
  m.elements[0] = NaN;
  assert.equal(validateUniformScale(m).valid, false);
});

test('toleranceFloor: rigid transforms, world units equal local units', () => {
  const floor = computeToleranceFloor({ localDiagonal: 10, scaleFactor: 1 }, { localDiagonal: 6, scaleFactor: 1 }, 1e-6);
  assert.ok(Math.abs(floor - 1e-6 * 10) < 1e-12); // max(10*1, 6*1) = 10
});

test('toleranceFloor: uniform scale converts local diagonal to world units before max()', () => {
  const floor = computeToleranceFloor({ localDiagonal: 10, scaleFactor: 0.5 }, { localDiagonal: 6, scaleFactor: 2 }, 1e-6);
  assert.ok(Math.abs(floor - 1e-6 * 12) < 1e-12); // max(5, 12) = 12, not max(10, 6) = 10
});
