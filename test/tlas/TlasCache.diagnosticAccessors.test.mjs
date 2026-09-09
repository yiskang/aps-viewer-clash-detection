import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TlasCache } from '../../collision/tlas/TlasCache.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

// Real record shape -- matches test/tlas/TlasCache.test.mjs's own verified fixture. CollisionInstanceBVH
// requires worldBounds on each record (writePrimitiveBounds); {} placeholders would throw.
function record(fragmentId, at) {
  return { loadEpoch: 1, fragmentId, ownerDbId: fragmentId, modelId: 'm', worldBounds: { min: at, max: at.map((v) => v + 1) } };
}

test('absent/building/ready states report the exact documented shape', async () => {
  const { port, controls } = makeFakeCheckpointPort();
  // makeFakeCheckpointPort validates epoch liveness even on its fast (not-due) path -- unlike
  // test/tlas/TlasCache.test.mjs's own always-fast-path stubCheckpointPort() -- so the epoch must
  // be marked live or checkpoint() throws ModelEvictedError before buildPrimitives is ever called.
  controls.setEpochLive(1, true);
  let resolveBuild;
  const cache = new TlasCache({
    buildPrimitives: () => new Promise((resolve) => { resolveBuild = resolve; }),
    checkpointPort: port,
  });
  assert.deepEqual(cache.getEpochPrimitiveDiagnostics(1), { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null });

  const pending = cache.getEntry(1, 1);
  assert.equal(cache.getEpochPrimitiveDiagnostics(1).state, 'building');
  resolveBuild([record(1, [0, 0, 0]), record(2, [1, 1, 1]), record(3, [2, 2, 2])]);
  await pending;
  const ready = cache.getEpochPrimitiveDiagnostics(1);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.primitiveCount, 3);
  assert.equal(ready.primitiveBufferBytes, 12); // Uint32Array, 3 * 4 bytes
  assert.equal(ready.builtAtRevision, 1);
});
