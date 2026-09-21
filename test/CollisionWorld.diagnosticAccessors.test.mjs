import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { WorldDisposedError } from '../collision/errors.js';

test('a registry-less/tlas-less world returns empty/absent shapes, never throws', async () => {
  const world = new CollisionWorld({});
  assert.deepEqual(world.getEpochGeometryDiagnostics(1), []);
  assert.deepEqual(world.getEpochTlasDiagnostics(1), { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null });
  assert.deepEqual(world.getEpochPlacementDiagnostics(1), { instanceCount: 0, placementCount: 0, placementRevision: 0, invalidatedAtRevision: null });
});

test('every accessor throws WorldDisposedError once disposed', async () => {
  const world = new CollisionWorld({});
  await world.dispose();
  assert.throws(() => world.getEpochGeometryDiagnostics(1), WorldDisposedError);
  assert.throws(() => world.getEpochTlasDiagnostics(1), WorldDisposedError);
  assert.throws(() => world.getEpochPlacementDiagnostics(1), WorldDisposedError);
});
