// M4 Task 3.11 (Steps 1-5): bridges Task 1.6's CollisionWorld diagnostic accessors
// (getEpochGeometryDiagnostics/getEpochTlasDiagnostics/getEpochPlacementDiagnostics) into Task
// 2.3's computeMetricM's expected MemorySnapshot shape. See this task's plan text "Interfaces"
// section for the full reconciliation between the two independently-drafted phases' contracts.
export function toMemorySnapshot(loadEpochs, accessors) {
  const geometryEntries = [];
  const epochs = [];
  for (const loadEpoch of loadEpochs) {
    for (const entry of accessors.getEpochGeometryDiagnostics(loadEpoch)) {
      if (entry.buildState !== 'ready') continue; // oversized/building geometries retain no welded/BVH/connectivity bytes yet
      geometryEntries.push({
        loadEpoch, geometryIndex: entry.geometryIndex,
        positionByteLength: entry.weldedPositionBytes,
        indexByteLength: entry.weldedIndexBytes,
        bvhRootByteLengths: [entry.bvhRootBytes],
        bvhIndirectBufferByteLength: entry.bvhIndirectBytes,
        connectivityComponentOfByteLength: entry.connectivityComponentOfBytes ?? 0,
        connectivityClosedManifoldLength: entry.connectivityClosedManifoldLength ?? 0,
      });
    }
    const tlas = accessors.getEpochTlasDiagnostics(loadEpoch);
    const placement = accessors.getEpochPlacementDiagnostics(loadEpoch);
    epochs.push({
      loadEpoch,
      tlasPrimitiveBufferByteLength: tlas.state === 'ready' ? tlas.primitiveBufferBytes : 0,
      tlasRecordCount: tlas.state === 'ready' ? tlas.primitiveCount : 0,
      placementCount: placement.placementCount,
      instanceCount: placement.instanceCount,
    });
  }
  return { geometryEntries, epochs, inflight: [] }; // in-flight payload bytes are the baseline gate's own concern only when a worker exists (Phase 4); the baseline gate itself never has an in-flight transfer, so this is always []
}
