// test/fixtures/geometry.test.mjs
//
// Task A1.2: `testInstance` (the operand factory nearly every test in the collision library uses)
// used to destructure `ThreeMeshBvhBackend.build()`'s return field-by-field, silently dropping the
// `geometryDigest` field Task A1.1 added. Without this test-fixture fix, every test-constructed
// `Instance` would carry `geometryDigest === undefined`, and rank 5 of `orientForCrossing` would
// never fire in any test that uses `testInstance` -- see this file's own module docstring in
// geometry.mjs and Task A1.2's brief for the full rationale.

import test from 'node:test';
import assert from 'node:assert/strict';
import { box, testInstance } from './geometry.mjs';

test('testInstance forwards a real 32-hex-char geometryDigest from buildBvh(), not undefined', () => {
  const instance = testInstance(box(1, 1, 1));
  assert.equal(typeof instance.geometryDigest, 'string');
  assert.equal(instance.geometryDigest.length, 32);
  assert.match(instance.geometryDigest, /^[0-9a-f]{32}$/, 'must be exactly 32 lowercase hex chars');
});

test('testInstance geometryDigest is content-derived: identical geometry -> identical digest, distinct geometry -> distinct digest', () => {
  const a = testInstance(box(1, 1, 1));
  const b = testInstance(box(1, 1, 1));
  const c = testInstance(box(2, 2, 2));
  assert.equal(a.geometryDigest, b.geometryDigest, 'byte-identical welded geometry must digest identically');
  assert.notEqual(a.geometryDigest, c.geometryDigest, 'geometrically distinct meshes must digest differently');
});
