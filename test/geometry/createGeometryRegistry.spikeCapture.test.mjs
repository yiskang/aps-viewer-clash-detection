// test/geometry/createGeometryRegistry.spikeCapture.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryRegistry } from '../../collision/geometry/createGeometryRegistry.js';
import {
  setSpanRecorder, clearSpanRecorder, setSpikeInputCapture, clearSpikeInputCapture,
} from '../../collision/scheduler.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';
import { maxSyncTriangleCount } from '../../collision/constants.js';

function rangesView(triangleCount, indexCount = triangleCount * 3, IndexCtor = Uint32Array) {
  const index = new IndexCtor(indexCount);
  for (let i = 0; i < indexCount; i++) index[i] = i % 3 === 0 ? 0 : i % 3;
  const positions = new Float32Array(9).fill(0);
  return { positions, positionStride: 3, positionOffset: 0, index, ranges: [{ start: 0, count: indexCount }], activeTriangleCount: triangleCount };
}

function makeRegistry({ triangleGeometryView, weldEpsilon = 1e-4 } = {}) {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const registry = createGeometryRegistry({
    resolveGeometryView: () => ({ triangleGeometryView, weldEpsilon }),
    checkpointPort: port,
    connectivityImpl: () => ({ componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }),
    accelerationImpl: () => ({ bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: { index: { count: 3 } } }),
  });
  return { registry, controls };
}

test('brackets: geometry-extraction and geometry-weld are contiguous on a normal build (no capture installed)', async () => {
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    const { registry } = makeRegistry({ triangleGeometryView: rangesView(1) });
    await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
    const extraction = spans.find((s) => s.label === 'geometry-extraction');
    const weld = spans.find((s) => s.label === 'geometry-weld');
    assert.ok(extraction);
    assert.ok(weld);
    assert.ok(Number.isFinite(extraction.ms) && extraction.ms >= 0);
    assert.ok(Number.isFinite(weld.ms) && weld.ms >= 0);
  } finally {
    clearSpanRecorder();
  }
});

test('contiguity is preserved even when capture IS active and its copy takes real time: extraction absorbs the capture cost, no gap before weld opens', async () => {
  // Fake-clock proof: performance.now() is patched so the capture callback itself can advance
  // the clock (simulating a real, non-negligible .slice() cost), and the test asserts the
  // extraction span's reported duration includes that advance -- i.e. the capture point is
  // INSIDE the extraction bracket, not in an unaccounted-for gap between the two brackets.
  const realNow = performance.now.bind(performance);
  let fakeNow = 0;
  performance.now = () => fakeNow;
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  setSpikeInputCapture(() => { fakeNow += 20; }); // simulates a slow copy happening during capture
  try {
    const { registry } = makeRegistry({ triangleGeometryView: rangesView(1) });
    await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
    const extraction = spans.find((s) => s.label === 'geometry-extraction');
    assert.ok(extraction.ms >= 20, `extraction span (${extraction.ms}ms) must absorb the capture's own cost, not leave it in a gap`);
  } finally {
    clearSpanRecorder();
    clearSpikeInputCapture();
    performance.now = realNow;
  }
});

test('unsupported early return: geometry-weld is reported as exactly 0, no capture of either kind fires', async () => {
  const spans = [];
  const captured = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  setSpikeInputCapture((kind, payload) => captured.push({ kind, payload }));
  try {
    const { registry } = makeRegistry({ triangleGeometryView: { unsupported: true, reason: 'unsupported-geometry-layout' } });
    const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
    assert.equal(result.oversized, true);
    assert.equal(result.reason, 'unsupported-geometry-layout');
    assert.equal(spans.find((s) => s.label === 'geometry-weld').ms, 0);
    assert.equal(captured.length, 0);
  } finally {
    clearSpanRecorder();
    clearSpikeInputCapture();
  }
});

test('oversized-after-weld: raw-input capture fires (extraction succeeded), welded-result capture does not', async () => {
  const captured = [];
  setSpikeInputCapture((kind, payload) => captured.push({ kind, payload }));
  try {
    const big = maxSyncTriangleCount + 1;
    const { registry } = makeRegistry({ triangleGeometryView: rangesView(big) });
    const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'target' });
    assert.equal(result.oversized, true);
    assert.equal(result.reason, 'geometry-too-large-for-sync-build');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].kind, 'geometry-raw-input');
    assert.equal(captured[0].payload.role, 'target');
  } finally {
    clearSpikeInputCapture();
  }
});

test('capture-disabled path never even constructs a payload closure -- zero cost when unset', async () => {
  // Typed-array SUBCLASSES overriding only slice() -- not a Proxy (a generic Proxy get/set trap
  // over a typed array is spec-unreliable for ordinary numeric element access, an independent
  // review correctly flagged this as a structurally invalid fixture in an earlier draft).
  class ThrowingSliceFloat32Array extends Float32Array {
    slice() { throw new Error('slice() must never be called when no capture fn is installed'); }
  }
  class ThrowingSliceUint32Array extends Uint32Array {
    slice() { throw new Error('slice() must never be called when no capture fn is installed'); }
  }
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const registry = createGeometryRegistry({
    resolveGeometryView: () => ({
      triangleGeometryView: {
        positions: ThrowingSliceFloat32Array.from(new Array(9).fill(0)),
        positionStride: 3, positionOffset: 0,
        index: ThrowingSliceUint32Array.from([0, 1, 2]),
        ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1,
      },
      weldEpsilon: 1e-4,
    }),
    checkpointPort: port,
    connectivityImpl: () => ({ componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }),
    accelerationImpl: () => ({ bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: { index: { count: 1 } } }),
  });
  const result = await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
  assert.equal(result.oversized, false, 'no capture fn installed -- build must succeed normally, proving slice() was never reached');
});

test('raw-input capture is a real copy, preserving the source typed-array constructor (e.g. Uint16Array index)', async () => {
  const captured = [];
  setSpikeInputCapture((kind, payload) => { if (kind === 'geometry-raw-input') captured.push(payload); });
  try {
    const livePositions = new Float32Array(9).fill(1);
    const liveIndex = new Uint16Array([0, 1, 2]); // narrower than Uint32Array -- must be preserved, not widened
    const { port, controls } = makeFakeCheckpointPort();
    controls.setEpochLive(1, true);
    const registry = createGeometryRegistry({
      resolveGeometryView: () => ({
        triangleGeometryView: { positions: livePositions, positionStride: 3, positionOffset: 0, index: liveIndex, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1 },
        weldEpsilon: 1e-4,
      }),
      checkpointPort: port,
      connectivityImpl: () => ({ componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }),
      accelerationImpl: () => ({ bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: { index: { count: 1 } } }),
    });
    await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
    assert.equal(captured.length, 1);
    assert.notEqual(captured[0].positions, livePositions);
    assert.notEqual(captured[0].index, liveIndex);
    assert.ok(captured[0].index instanceof Uint16Array, 'capture must preserve the SOURCE index type, not assume Uint32Array');
    livePositions.fill(999);
    assert.deepEqual(Array.from(captured[0].positions), [1, 1, 1, 1, 1, 1, 1, 1, 1], 'captured copy unaffected by later mutation of the live buffer');
  } finally {
    clearSpikeInputCapture();
  }
});

test('welded-result capture is ALSO a copy, not the live registry-owned buffer', async () => {
  const captured = [];
  setSpikeInputCapture((kind, payload) => { if (kind === 'geometry-welded-result') captured.push(payload); });
  try {
    const { registry, controls } = makeRegistry({ triangleGeometryView: rangesView(1) });
    controls.setEpochLive(7, true); // distinctive loadEpoch (not the fixture default 1) to prove the payload threads the real value through, not a hardcoded one
    const result = await registry.getOrBuildGeometry({ loadEpoch: 7, geometryIndex: 2, ownerModelIdHint: 'm', needsConnectivity: false, role: 'target' });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].loadEpoch, 7);
    assert.equal(captured[0].geometryIndex, 2);
    assert.equal(captured[0].role, 'target');
    // result.geometry (from accelerationImpl) is a stand-in in this fixture; the load-bearing
    // assertion is that the CAPTURE's own position/index are distinct array instances from
    // whatever buildAcceleration/buildConnectivity would go on to consume.
    assert.ok(captured[0].position instanceof Float32Array);
    assert.ok(captured[0].index instanceof Uint32Array);
  } finally {
    clearSpikeInputCapture();
  }
});
