import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { box, weld, testInstance } from '../fixtures/geometry.mjs';

function weldedFromBox(w, h, d) {
  const welded = weld(box(w, h, d));
  return { position: welded.attributes.position.array, index: welded.index.array, triangleCount: welded.index.count / 3 };
}

test('build() assigns geometry.boundsTree to the same MeshBVH instance it returns', () => {
  const { bvh, geometry } = build(weldedFromBox(2, 2, 2));
  assert.strictEqual(geometry.boundsTree, bvh);
});

test('testInstance() fixtures share the same boundsTree invariant as production', () => {
  const instance = testInstance(box(2, 2, 2));
  assert.equal(instance.geometry.boundsTree, instance.bvh,
    'fixture geometry and production geometry must share the same invariant');
});
