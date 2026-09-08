// test/CollisionWorld.isValidClearanceTransform.test.mjs — direct unit coverage for
// `isValidClearanceTransform` (test-only export from CollisionWorld.js, not re-exported from
// collision/index.js). Task 8 review finding: this function had zero direct unit test coverage,
// including of the Float64Array fix it was built around -- a regression reintroducing
// `Array.isArray(m)` would have gone completely undetected until Task 9 wires clearance dispatch.
// Test 1 below is that missing coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidClearanceTransform } from '../collision/CollisionWorld.js';

// Column-major identity matrix -- valid, invertible (det = 1), 16 finite numbers.
const IDENTITY_16 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const VALID_BOUNDS = { min: [0, 0, 0], max: [1, 1, 1] };

function validRecord(overrides = {}) {
  return {
    worldMatrix: new Float64Array(IDENTITY_16),
    worldBounds: VALID_BOUNDS,
    ...overrides,
  };
}

test('a genuine Float64Array worldMatrix (matching production shape) is accepted', () => {
  const record = validRecord();
  assert.ok(record.worldMatrix instanceof Float64Array, 'sanity: fixture really is a Float64Array');
  assert.equal(isValidClearanceTransform(record), true);
});

test('a non-finite value anywhere in worldMatrix is rejected (NaN)', () => {
  const m = new Float64Array(IDENTITY_16);
  m[5] = NaN;
  assert.equal(isValidClearanceTransform(validRecord({ worldMatrix: m })), false);
});

test('a non-finite value anywhere in worldMatrix is rejected (Infinity)', () => {
  const m = new Float64Array(IDENTITY_16);
  m[0] = Infinity;
  assert.equal(isValidClearanceTransform(validRecord({ worldMatrix: m })), false);
});

test('a worldMatrix with the wrong length (not 16) is rejected', () => {
  assert.equal(
    isValidClearanceTransform(validRecord({ worldMatrix: new Float64Array(IDENTITY_16.slice(0, 12)) })),
    false,
  );
  assert.equal(
    isValidClearanceTransform(validRecord({ worldMatrix: [...IDENTITY_16, 0] })),
    false,
  );
});

test('a singular (zero-determinant) worldMatrix is rejected', () => {
  // Zero out an entire row -> determinant is exactly 0.
  const singular = [
    0, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  assert.equal(isValidClearanceTransform(validRecord({ worldMatrix: new Float64Array(singular) })), false);
});

test('non-finite bounds are rejected (NaN in min)', () => {
  assert.equal(
    isValidClearanceTransform(validRecord({ worldBounds: { min: [0, NaN, 0], max: [1, 1, 1] } })),
    false,
  );
});

test('non-finite bounds are rejected (Infinity in max)', () => {
  assert.equal(
    isValidClearanceTransform(validRecord({ worldBounds: { min: [0, 0, 0], max: [1, Infinity, 1] } })),
    false,
  );
});

test('misordered bounds (min[i] > max[i] on some axis) are rejected', () => {
  assert.equal(
    isValidClearanceTransform(validRecord({ worldBounds: { min: [0, 5, 0], max: [1, 1, 1] } })),
    false,
  );
});

test('a missing worldBounds is rejected, no throw (undefined)', () => {
  assert.doesNotThrow(() => {
    assert.equal(isValidClearanceTransform(validRecord({ worldBounds: undefined })), false);
  });
});

test('a missing worldBounds is rejected, no throw (null)', () => {
  assert.doesNotThrow(() => {
    assert.equal(isValidClearanceTransform(validRecord({ worldBounds: null })), false);
  });
});

test('a valid plain Array worldMatrix (16 numbers, not a typed array) is also accepted', () => {
  const record = validRecord({ worldMatrix: [...IDENTITY_16] });
  assert.ok(Array.isArray(record.worldMatrix), 'sanity: fixture really is a plain Array');
  assert.equal(isValidClearanceTransform(record), true);
});
