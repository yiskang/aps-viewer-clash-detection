// test/geometry/roleThreading.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

function makeSpyRegistry() {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const calls = [];
  const registry = new GeometryRegistry({
    buildWeld: async (loadEpoch, geometryIndex, ownerModelIdHint, role) => {
      calls.push({ loadEpoch, geometryIndex, ownerModelIdHint, role });
      return { position: new Float32Array(3), index: new Uint32Array([0, 1, 2]), triangleCount: 1 };
    },
    buildConnectivity: async () => ({ componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }),
    buildAcceleration: async () => ({ bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: {} }),
    checkpointPort: port,
  });
  return { registry, calls, controls };
}

test('role reaches the injected buildWeld builder as its exact 4th argument', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
  assert.deepEqual(calls, [{ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', role: 'source' }]);
});

test('role defaults to undefined when omitted -- every existing caller keeps working', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  assert.equal(calls[0].role, undefined);
});

test('capture identity is (loadEpoch, geometryIndex), NOT (loadEpoch, geometryIndex, role): a cache hit under a DIFFERENT role does not re-call buildWeld', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'target' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, 'target');
  // Same (loadEpoch, geometryIndex), now referenced as 'source' -- this is a cache hit.
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
  assert.equal(calls.length, 1, 'no second buildWeld call -- role reflects only the build-triggering call');
});
