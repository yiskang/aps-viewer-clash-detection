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

// Task 3.11 Step 10: `peak` is the maximum Metric M actually OBSERVED across cold/warm/refresh, never
// a fixed alias of `cold` -- run-gate-m4.mjs's `runArmTuple` inlines this exact selection logic
// against its own live `memoryByState` samples; this proves the pure selection rule in isolation.
test('peak sampling: the maximum observed Metric M across cold/warm/refresh, never a fixed alias', () => {
  function selectPeak(cold, warm, refresh) {
    return [cold, warm, refresh].filter(Boolean).reduce((max, s) => (s.metricM > max.metricM ? s : max));
  }
  const cold = { metricM: 1000 };
  const warm = { metricM: 900 }; // warm usually shrinks or holds -- but this test proves refresh can exceed both
  const refresh = { metricM: 1500 }; // R6's placement move admitted new geometry
  const peak = selectPeak(cold, warm, refresh);
  assert.equal(peak, refresh);
  assert.equal(selectPeak(cold, warm, undefined), cold); // no refresh state (every non-R6 case): cold still wins here, but because it was measured larger, not by default
});
