import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTANCE_BYTES, RECORD_BYTES, PLACEMENT_BYTES,
  INSTANCE_FIELD_SPEC, RECORD_FIELD_SPEC, bytesForFieldSpec,
  computeMetricM,
} from './metric-m-calculator.mjs';

test('INSTANCE_BYTES (88) and RECORD_BYTES (104) match §15.1\'s literal constants', () => {
  assert.equal(INSTANCE_BYTES, 88);
  assert.equal(RECORD_BYTES, 104);
});

test('PLACEMENT_BYTES (192) matches §15.1\'s literal 16×8 + 6×8 + 16', () => {
  assert.equal(PLACEMENT_BYTES, 192);
});

test('a shape change (one more numeric field) invalidates the derived constant, not just the literal', () => {
  const grownSpec = [...INSTANCE_FIELD_SPEC, { name: 'extraNumericField', kind: 'numeric' }];
  assert.equal(bytesForFieldSpec(grownSpec), INSTANCE_BYTES + 8);
  assert.notEqual(bytesForFieldSpec(grownSpec), bytesForFieldSpec(INSTANCE_FIELD_SPEC));
});

test('computeMetricM: sums a single geometry entry\'s welded buffers, BVH roots/indirect buffer, connectivity', () => {
  const snapshot = {
    geometryEntries: [{
      loadEpoch: 1, geometryIndex: 0,
      positionByteLength: 1000, indexByteLength: 400,
      bvhRootByteLengths: [200, 50], bvhIndirectBufferByteLength: 30,
      connectivityComponentOfByteLength: 80, connectivityClosedManifoldLength: 4,
    }],
    epochs: [], inflight: [],
  };
  assert.equal(computeMetricM(snapshot), 1000 + 400 + 200 + 50 + 30 + 80 + 4);
});

test('computeMetricM: sums per-epoch TLAS, placement, and instance contributions using the derived constants', () => {
  const snapshot = {
    geometryEntries: [],
    epochs: [{ loadEpoch: 1, tlasPrimitiveBufferByteLength: 500, tlasRecordCount: 3, placementCount: 2, instanceCount: 10 }],
    inflight: [],
  };
  assert.equal(computeMetricM(snapshot), 500 + 3 * RECORD_BYTES + 2 * PLACEMENT_BYTES + 10 * INSTANCE_BYTES);
});

test('computeMetricM: de-duplicates a backing buffer shared across two in-flight payload entries, sums metadata separately', () => {
  const snapshot = {
    geometryEntries: [], epochs: [],
    inflight: [
      { payloadId: 'a', backingBuffers: [{ bufferId: 'buf-1', byteLength: 1000 }], payloadMetadataBytes: 40 },
      { payloadId: 'b', backingBuffers: [{ bufferId: 'buf-1', byteLength: 1000 }, { bufferId: 'buf-2', byteLength: 200 }], payloadMetadataBytes: 40 },
    ],
  };
  // buf-1 counted once (1000), buf-2 counted once (200); metadata is per-payload, not deduped (40+40)
  assert.equal(computeMetricM(snapshot), 1000 + 200 + 40 + 40);
});
