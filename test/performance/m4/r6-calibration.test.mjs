// test/performance/m4/r6-calibration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matricesEqual, R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer, pairSetDelta } from './r6-calibration.mjs';

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

// Task review fix (Important #2a): NaN - NaN is NaN, and `NaN > eps` is false, so the naive
// `Math.abs(a[i]-b[i]) > eps` check would previously treat a NaN element as "within tolerance" --
// silently passing the one guarantee this function exists to provide.
test('matricesEqual: false when the SAME element is NaN on both sides (NaN is never equal to itself)', () => {
  const a = Array(16).fill(0);
  const b = Array(16).fill(0);
  a[7] = NaN;
  b[7] = NaN;
  assert.equal(matricesEqual(a, b), false);
});

test('matricesEqual: false when one side has a non-finite element (NaN or Infinity), even if only one side does', () => {
  const a = Array(16).fill(0);
  const bNaN = Array(16).fill(0);
  bNaN[0] = NaN;
  assert.equal(matricesEqual(a, bNaN), false);
  const bInfinity = Array(16).fill(0);
  bInfinity[15] = Infinity;
  assert.equal(matricesEqual(a, bInfinity), false);
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

// Codex-review fix (Important #1): calibration must freeze the EXACT expected pair delta (the
// specific pairs entering and leaving), not merely a boolean "did something change" -- §5.2.1's own
// "the resulting expected pair delta -- the exact set of pairs entering and leaving -- recorded
// verbatim ... reused unchanged across every arm, state, and repetition". pairSetDelta computes that
// delta between a baseline (P0) and a comparison (P1) set of pair-signature strings, order-
// insensitively, so both the calibration pass and every later measured arm can compute it identically
// and compare for exact equality.
test('pairSetDelta: identical sets produce no entering/leaving pairs', () => {
  assert.deepEqual(pairSetDelta(['a:1', 'b:2'], ['b:2', 'a:1']), { entering: [], leaving: [] });
});

test('pairSetDelta: entering is present in B but not A; leaving is present in A but not B', () => {
  assert.deepEqual(pairSetDelta(['a:1', 'b:2'], ['b:2', 'c:3']), { entering: ['c:3'], leaving: ['a:1'] });
});

test('pairSetDelta: entering/leaving are each sorted, for stable exact-equality comparison', () => {
  assert.deepEqual(pairSetDelta([], ['c:3', 'a:1', 'b:2']), { entering: ['a:1', 'b:2', 'c:3'], leaving: [] });
});
