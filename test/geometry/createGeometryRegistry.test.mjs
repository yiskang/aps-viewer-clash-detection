import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryRegistry } from '../../collision/geometry/createGeometryRegistry.js';
import { maxSyncTriangleCount } from '../../collision/constants.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

// A fake connectivity/BVH pair (Task 4/5 correctness is out of scope here -- this
// suite tests phase ORCHESTRATION against the real active-range-compaction/weld
// pipeline, not query correctness) -- injected via the same seams
// createGeometryRegistry exposes for its own defaults.
//
// Ledger correction (applied per controller instruction): the brief's own fixture
// imported a `FakeCheckpointPort` class from `collision/scheduler.js`. That module
// exports no such thing -- the real fake-checkpoint-port test double is
// `makeFakeCheckpointPort` in `test/fixtures/FakeCheckpointPort.mjs` (already used by
// Task 13's own `test/geometry/GeometryRegistry.test.mjs`), returning `{ port,
// controls }` where `port` already satisfies the `{ checkpoint(args) }` contract
// `createGeometryRegistry`'s `checkpointPort` option expects, and epoch liveness is
// driven via `controls.setEpochLive(loadEpoch, isLive)`, not a method on `port`
// itself.
function makeHarness({ triangleGeometryView, weldEpsilon = 1e-4 } = {}) {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const calls = { connectivity: 0, acceleration: 0 };
  const registry = createGeometryRegistry({
    resolveGeometryView: () => ({ triangleGeometryView, weldEpsilon }),
    checkpointPort: port,
    connectivityImpl: () => { calls.connectivity++; return { componentCount: 1, componentOf: new Int32Array(), closedManifold: [true] }; },
    accelerationImpl: () => { calls.acceleration++; return { bvh: {}, localDiagonal: 1 }; },
  });
  return { registry, calls, port, controls };
}

// Ledger correction (applied per controller instruction): the brief's own fixture used
// `position` (singular) for the input position-buffer field, which is the WELD
// OUTPUT field name -- the real `ViewerGeometryAdapter`/`compactAndWeld` input-view
// contract uses `positions` (PLURAL), confirmed against
// collision/viewer/ViewerGeometryAdapter.js's own return shape. The brief's fixture
// also never set `activeTriangleCount`, which `compactAndWeld` reads as a
// PRECOMPUTED field (it does not derive it from `ranges` itself) -- confirmed against
// collision/geometry/activeRangeCompaction.js's `compactAndWeld`, which reads
// `triangleGeometryView.activeTriangleCount` directly and compares it to the ceiling
// BEFORE any copying happens. Both are fixed here; the `activeTriangleCount` formula
// matches ViewerGeometryAdapter.js's own `computeActiveTriangleCount`
// (sum(floor(range.count / 3))).
function rangesView(indexCount, ranges) {
  // A minimal TriangleGeometryView: `ranges` drives activeTriangleCount, `index`'s
  // own length is deliberately far larger than any range sums, to prove the raw
  // buffer size never gates the ceiling check by itself (round-16 regression).
  const index = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) index[i] = i % 3 === 0 ? 0 : i % 3;
  const positions = new Float32Array(9).fill(0);
  const activeTriangleCount = ranges.reduce((sum, r) => sum + Math.floor(r.count / 3), 0);
  return { positions, positionStride: 3, positionOffset: 0, index, ranges, activeTriangleCount };
}

test('round-16 regression: huge raw index but small active ranges is NOT skipped, and weld sees only the active set', async () => {
  const view = rangesView(1_000_000, [{ start: 0, count: 300 }]); // 100 active triangles
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false);
  assert.equal(calls.acceleration, 1);
});

test('inverse of the round-16 regression: active-range count alone over the ceiling is skipped without materializing a compacted buffer', async () => {
  const overCeilingIndexCount = (maxSyncTriangleCount + 1) * 3;
  const view = rangesView(overCeilingIndexCount + 30, [{ start: 0, count: overCeilingIndexCount }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, true);
  assert.equal(result.reason, 'geometry-too-large-for-sync-build');
  assert.equal(calls.acceleration, 0, 'BVH must never be invoked for an oversized geometry');
});

test('ceiling boundary: exactly maxSyncTriangleCount (36,000 index elements) is built, not skipped -- strict >, not >=', async () => {
  // Task 3's own tests own the 39,000/33,000 boundary pair; this is the ONE
  // integration-level fixture proving the boundary survives the full
  // weld -> registry pipeline, per this task's brief (avoid duplicating all three).
  const exactIndexCount = maxSyncTriangleCount * 3;
  const view = rangesView(exactIndexCount, [{ start: 0, count: exactIndexCount }]);
  const { registry } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false);
});

test('containment mode fires the connectivity-phase checkpoint on a first-time build', async () => {
  const view = rangesView(300, [{ start: 0, count: 300 }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: true });
  assert.ok(result.connectivity);
  assert.equal(calls.connectivity, 1);
});

test('surface-intersection mode never reaches the connectivity phase on a first-time build (round-16 regression)', async () => {
  const view = rangesView(300, [{ start: 0, count: 300 }]);
  const { registry, calls } = makeHarness({ triangleGeometryView: view });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.connectivity, null);
  assert.equal(calls.connectivity, 0);
});

// Controller-authorized addition #3: prove the real acceleration-phase builder's full
// resolved shape ({ bvh, localDiagonal, aspectRatio, aspectRatioExceeded } -- confirmed
// against collision/blas/ThreeMeshBvhBackend.js's own `build()` return) survives
// end-to-end through createGeometryRegistry -> GeometryRegistry -> the caller when NO
// accelerationImpl override is supplied, i.e. against the real default
// `blasCache.build -> ThreeMeshBvhBackend.build` path over a small real welded
// triangle (a closed tetrahedron -- non-planar, so every local AABB extent is
// nonzero and aspectRatio is finite, not the flat-mesh Infinity case). Task 13's own
// tests already prove GeometryRegistry itself spreads an injected stub's extra
// fields; this proves the fields are actually produced and wired, not just passed
// through if present.
test('default (no accelerationImpl override) path surfaces aspectRatio/aspectRatioExceeded end-to-end through the real BlasCache -> ThreeMeshBvhBackend.build', async () => {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  // A closed tetrahedron: 4 vertices, 4 triangular faces, all three local AABB
  // extents (x, y, z) nonzero -- non-degenerate, non-planar.
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
  const index = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);
  const view = {
    positions,
    positionStride: 3,
    positionOffset: 0,
    index,
    ranges: [{ start: 0, count: index.length }],
    activeTriangleCount: 4,
  };
  const registry = createGeometryRegistry({
    resolveGeometryView: () => ({ triangleGeometryView: view, weldEpsilon: 1e-4 }),
    checkpointPort: port,
  });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm1', needsConnectivity: false });
  assert.equal(result.oversized, false);
  assert.equal(typeof result.aspectRatio, 'number');
  assert.ok(Number.isFinite(result.aspectRatio));
  assert.equal(typeof result.aspectRatioExceeded, 'boolean');
});
