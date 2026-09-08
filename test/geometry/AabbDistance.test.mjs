import test from 'node:test';
import assert from 'node:assert/strict';
import { aabbMinDistance } from '../../collision/geometry/AabbDistance.js';

test('separated on one axis: exact gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,0,0], max: [5,1,1] }), 3);
});
test('separated on two axes: exact diagonal-in-plane gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,5,0], max: [5,6,1] }), 5);
});
test('separated on three axes: exact 3D gap', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [4,5,13], max: [5,6,14] }), 13);
});
test('overlapping: exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [2,2,2] }, { min: [1,1,1], max: [3,3,3] }), 0);
});
test('touching (shared face): exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [1,1,1] }, { min: [1,0,0], max: [2,1,1] }), 0);
});
test('containment: exact 0', () => {
  assert.equal(aabbMinDistance({ min: [0,0,0], max: [10,10,10] }, { min: [3,3,3], max: [4,4,4] }), 0);
});
test('is symmetric', () => {
  const a = { min: [0,0,0], max: [1,1,1] }, b = { min: [4,5,13], max: [5,6,14] };
  assert.equal(aabbMinDistance(a, b), aabbMinDistance(b, a));
});
