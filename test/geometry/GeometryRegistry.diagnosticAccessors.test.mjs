import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { build as buildBvh } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

function makeRegistry({ buildWeld, buildConnectivity, buildAcceleration } = {}) {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const registry = new GeometryRegistry({
    buildWeld: buildWeld ?? (async () => ({
      position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]), triangleCount: 1,
    })),
    buildConnectivity: buildConnectivity ?? (async () => ({ componentCount: 1, componentOf: new Int32Array([0]), closedManifold: [true] })),
    // Real BVH backend, not a stub -- Metric M's own equation reads bvh._roots/_indirectBuffer,
    // which only a genuine MeshBVH instance carries (independent review's Critical-1 finding).
    buildAcceleration: buildAcceleration ?? (async (welded) => buildBvh(welded)),
    checkpointPort: port,
  });
  return { registry, controls };
}

test('getEpochGeometryEntries returns [] for an epoch never admitted', () => {
  const { registry } = makeRegistry();
  assert.deepEqual(registry.getEpochGeometryEntries(999), []);
  assert.equal(registry.getEpochGeometryEntryCount(999), 0);
});

test('a ready entry reports welded/BVH/connectivity byte accounting matching Metric M\'s own equation terms', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: true });
  const entries = registry.getEpochGeometryEntries(1);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.geometryIndex, 0);
  assert.equal(e.buildState, 'ready');
  assert.equal(e.weldedPositionBytes, 36); // 9 floats * 4 bytes
  assert.equal(e.weldedIndexBytes, 12); // 3 * 4 bytes
  assert.equal(e.triangleCount, 1);
  assert.ok(Number.isFinite(e.bvhRootBytes) && e.bvhRootBytes > 0, 'bvh._roots[*].byteLength summed');
  assert.equal(typeof e.bvhIndirectBytes, 'number', 'bvh._indirectBuffer?.byteLength ?? 0');
  assert.equal(e.connectivityComponentCount, 1);
  assert.equal(e.connectivityComponentOfBytes, 4); // Int32Array(1) -> 4 bytes
  assert.equal(e.connectivityClosedManifoldLength, 1);
  assert.equal(e.oversizedReason, null);
  assert.equal(e.activeTriangleCount, null);
  assert.equal(registry.getEpochGeometryEntryCount(1), 1);
});

test('a ready entry with connectivity never requested reports all three connectivity fields as null', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  const e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.connectivityComponentCount, null);
  assert.equal(e.connectivityComponentOfBytes, null);
  assert.equal(e.connectivityClosedManifoldLength, null);
});

test('an oversized entry reports oversizedReason/activeTriangleCount, nulls elsewhere', async () => {
  const { registry } = makeRegistry({ buildWeld: async () => ({ oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount: 99999 }) });
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  const e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.buildState, 'oversized');
  assert.equal(e.oversizedReason, 'geometry-too-large-for-sync-build');
  assert.equal(e.activeTriangleCount, 99999);
  assert.equal(e.weldedPositionBytes, null);
  assert.equal(e.bvhRootBytes, null);
});

test('releaseEntriesForEpoch removes entries entirely -- no "released" buildState value', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  registry.releaseEntriesForEpoch(1);
  assert.deepEqual(registry.getEpochGeometryEntries(1), []);
});

test('lazy connectivity requested after the entry is already ready still gets cached onto the accessor', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  let e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.buildState, 'ready');
  assert.equal(e.connectivityComponentCount, null);

  // Same (loadEpoch, geometryIndex) cache hit, this time requesting connectivity -- exercises
  // _awaitEntry's lazy _chainConnectivity path against an already-'ready' entry.
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: true });
  e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.connectivityComponentCount, 1);
  assert.equal(e.connectivityComponentOfBytes, 4);
  assert.equal(e.connectivityClosedManifoldLength, 1);
});
