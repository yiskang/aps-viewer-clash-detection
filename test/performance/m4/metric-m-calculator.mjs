// M4 Task 2.3: Metric M calculator (§15.1). See this task's "Interfaces: Consumes" note in the
// plan for the full MemorySnapshot contract Phase 1 task 1.6 must match.

const HEADER_BYTES = 32;
const NUMERIC_FIELD_BYTES = 8;

export function bytesForFieldSpec(spec) {
  return spec.reduce((sum, f) => sum + (f.kind === 'header' ? HEADER_BYTES : NUMERIC_FIELD_BYTES), 0);
}

// instanceBytes = 32 (header) + 8 (fragmentId) + 8 (geometryIdentity.loadEpoch)
//               + 8 (geometryIdentity.geometryIndex) + 32 (nested identity header) = 88
export const INSTANCE_FIELD_SPEC = [
  { name: 'header', kind: 'header' },
  { name: 'fragmentId', kind: 'numeric' },
  { name: 'geometryIdentity.loadEpoch', kind: 'numeric' },
  { name: 'geometryIdentity.geometryIndex', kind: 'numeric' },
  { name: 'geometryIdentity.header', kind: 'header' },
];
export const INSTANCE_BYTES = bytesForFieldSpec(INSTANCE_FIELD_SPEC);

// recordBytes = 32 (header) + 8 (epoch) + 8 (fragmentId) + 8 (geometryIndex)
//             + 6 x 8 (the record's own min/max bounds triples) = 104
export const RECORD_FIELD_SPEC = [
  { name: 'header', kind: 'header' },
  { name: 'epoch', kind: 'numeric' },
  { name: 'fragmentId', kind: 'numeric' },
  { name: 'geometryIndex', kind: 'numeric' },
  { name: 'bounds.min.x', kind: 'numeric' },
  { name: 'bounds.min.y', kind: 'numeric' },
  { name: 'bounds.min.z', kind: 'numeric' },
  { name: 'bounds.max.x', kind: 'numeric' },
  { name: 'bounds.max.y', kind: 'numeric' },
  { name: 'bounds.max.z', kind: 'numeric' },
];
export const RECORD_BYTES = bytesForFieldSpec(RECORD_FIELD_SPEC);

// placementBytes = 16x8 (Float64Array(16) matrix) + 6x8 (two 3-arrays) + 16 (scalars) = 192
export const PLACEMENT_FIELD_SPEC = [
  ...Array.from({ length: 16 }, (_, i) => ({ name: `matrix[${i}]`, kind: 'numeric' })),
  ...Array.from({ length: 6 }, (_, i) => ({ name: `vectors[${i}]`, kind: 'numeric' })),
];
const PLACEMENT_SCALAR_BYTES = 16;
export const PLACEMENT_BYTES = bytesForFieldSpec(PLACEMENT_FIELD_SPEC) + PLACEMENT_SCALAR_BYTES;

export function computeMetricM(snapshot) {
  let total = 0;

  for (const g of snapshot.geometryEntries ?? []) {
    total += g.positionByteLength + g.indexByteLength;
    total += g.bvhRootByteLengths.reduce((a, b) => a + b, 0);
    total += g.bvhIndirectBufferByteLength ?? 0;
    total += g.connectivityComponentOfByteLength + g.connectivityClosedManifoldLength;
  }

  for (const e of snapshot.epochs ?? []) {
    total += e.tlasPrimitiveBufferByteLength + e.tlasRecordCount * RECORD_BYTES;
    total += e.placementCount * PLACEMENT_BYTES;
    total += e.instanceCount * INSTANCE_BYTES;
  }

  const dedupedBuffers = new Map();
  let metadataTotal = 0;
  for (const p of snapshot.inflight ?? []) {
    for (const buf of p.backingBuffers ?? []) {
      if (!dedupedBuffers.has(buf.bufferId)) dedupedBuffers.set(buf.bufferId, buf.byteLength);
    }
    metadataTotal += p.payloadMetadataBytes ?? 0;
  }
  for (const byteLength of dedupedBuffers.values()) total += byteLength;
  total += metadataTotal;

  return total;
}
