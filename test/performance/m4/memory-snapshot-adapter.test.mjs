import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMemorySnapshot } from './memory-snapshot-adapter.mjs';
import { computeMetricM } from './metric-m-calculator.mjs';

test('toMemorySnapshot maps a single-epoch, single-geometry world into computeMetricM\'s expected shape', () => {
  const fakeAccessors = {
    getEpochGeometryDiagnostics: (epoch) => [
      { geometryIndex: 0, buildState: 'ready', weldedPositionBytes: 1000, weldedIndexBytes: 400,
        bvhRootBytes: 200, bvhIndirectBytes: 50, connectivityComponentOfBytes: 30,
        connectivityClosedManifoldLength: 4, oversizedReason: null, activeTriangleCount: 10 },
    ],
    getEpochTlasDiagnostics: (epoch) => ({ state: 'ready', primitiveCount: 3, primitiveBufferBytes: 500, builtAtRevision: 1 }),
    getEpochPlacementDiagnostics: (epoch) => ({ instanceCount: 10, placementCount: 2, placementRevision: 1, invalidatedAtRevision: null }),
  };
  const snapshot = toMemorySnapshot([7], fakeAccessors);
  assert.equal(computeMetricM(snapshot), 1000 + 400 + 200 + 50 + 30 + 4 + (500 + 3 * 104) + (2 * 192) + (10 * 88));
});

test('toMemorySnapshot skips a geometry entry that is not ready (building/oversized contribute zero bytes)', () => {
  const fakeAccessors = {
    getEpochGeometryDiagnostics: () => [
      { geometryIndex: 0, buildState: 'oversized', weldedPositionBytes: null, weldedIndexBytes: null,
        bvhRootBytes: null, bvhIndirectBytes: null, connectivityComponentOfBytes: null,
        connectivityClosedManifoldLength: null, oversizedReason: 'geometry-too-large-for-sync-build', activeTriangleCount: 50000 },
    ],
    getEpochTlasDiagnostics: () => ({ state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null }),
    getEpochPlacementDiagnostics: () => ({ instanceCount: 0, placementCount: 0, placementRevision: 0, invalidatedAtRevision: null }),
  };
  const snapshot = toMemorySnapshot([1], fakeAccessors);
  assert.equal(computeMetricM(snapshot), 0);
});
