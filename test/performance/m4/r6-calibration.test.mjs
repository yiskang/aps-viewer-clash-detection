// test/performance/m4/r6-calibration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matricesEqual, R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer } from './r6-calibration.mjs';

test('matricesEqual: true when every one of 16 elements agrees within 1e-9', () => {
  const a = Array(16).fill(0).map((_, i) => i);
  const b = [...a];
  b[5] += 1e-10;
  assert.equal(matricesEqual(a, b), true);
});

test('matricesEqual: false when any element exceeds the 1e-9 tolerance', () => {
  const a = Array(16).fill(0);
  const b = Array(16).fill(0);
  b[3] = 2e-9;
  assert.equal(matricesEqual(a, b), false);
});

test('R6_CALIBRATION_SEQUENCE is the exact frozen sequence', () => {
  assert.deepEqual(R6_CALIBRATION_SEQUENCE, [0.02, 0.04, 0.06, 0.10, 0.20]);
});

test('selectCalibrationMagnitude: picks the FIRST d that changed the pair set', () => {
  assert.equal(selectCalibrationMagnitude([false, false, true, true, true]), 0.06);
});

test('selectCalibrationMagnitude: null (NOT EXERCISED) when no d in the sequence changes anything', () => {
  assert.equal(selectCalibrationMagnitude([false, false, false, false, false]), null);
});

test('pairSetsDiffer: order-insensitive multiset comparison over signature strings', () => {
  assert.equal(pairSetsDiffer(['a:1', 'b:2'], ['b:2', 'a:1']), false);
  assert.equal(pairSetsDiffer(['a:1'], ['a:1', 'c:3']), true);
});
