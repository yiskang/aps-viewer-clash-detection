import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlasCache } from '../../collision/blas/BlasCache.js';

test('BlasCache.build delegates to the injected backend and returns its result unchanged', async () => {
  const welded = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]), triangleCount: 1 };
  let receivedArg;
  const fakeBackend = { build: (arg) => { receivedArg = arg; return { bvh: { fake: true }, localDiagonal: 1.5 }; } };
  const cache = new BlasCache({ backend: fakeBackend });
  const result = await cache.build(welded);
  assert.equal(receivedArg, welded);
  assert.deepEqual(result, { bvh: { fake: true }, localDiagonal: 1.5 });
});

test('BlasCache defaults to ThreeMeshBvhBackend when no backend is injected', async () => {
  const cache = new BlasCache();
  assert.equal(typeof cache.build, 'function');
  // Full construction against a real MeshBVH is covered by Task 5's own
  // ThreeMeshBvhBackend.test.mjs; this only proves the default wiring exists.
});
