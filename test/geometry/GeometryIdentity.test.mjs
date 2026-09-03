import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryIdentity, sameGeometryIdentity } from '../../collision/geometry/GeometryIdentity.js';

test('GeometryIdentity: fields and frozen-ness', () => {
  const id = createGeometryIdentity(3, 7);
  assert.equal(id.loadEpoch, 3);
  assert.equal(id.geometryIndex, 7);
  assert.ok(Object.isFrozen(id));
  assert.throws(() => { id.loadEpoch = 99; }, TypeError);
});

test('GeometryIdentity: same identity iff both fields ===', () => {
  const a = createGeometryIdentity(3, 7);
  const b = createGeometryIdentity(3, 7);
  const c = createGeometryIdentity(3, 8);
  assert.equal(sameGeometryIdentity(a, b), true);
  assert.equal(sameGeometryIdentity(a, c), false);
  assert.notEqual(a, b, 'distinct objects, same value -- identity value type, not reference type');
});

test('GeometryIdentity: rejects non-integer/negative inputs', () => {
  assert.throws(() => createGeometryIdentity(-1, 0), TypeError);
  assert.throws(() => createGeometryIdentity(0, 1.5), TypeError);
});
