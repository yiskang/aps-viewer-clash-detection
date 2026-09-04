// collision/geometry/createGeometryRegistry.js
//
// Wires GeometryRegistry (Task 13) to the real weld/connectivity/BVH implementations.
// Kept separate from GeometryRegistry.js so that file stays builder-agnostic and
// testable in isolation. Task 17 (CollisionWorld) calls this factory with the real
// checkpointPort and resolveGeometryView at runtime -- this file never imports
// CollisionWorld itself.

import { GeometryRegistry } from './GeometryRegistry.js';
import { compactAndWeld } from './activeRangeCompaction.js';
import { computeGeometryConnectivity as defaultConnectivity } from './GeometryConnectivity.js';
import { BlasCache } from '../blas/BlasCache.js';
import { maxSyncTriangleCount } from '../constants.js';

export function createGeometryRegistry({
  resolveGeometryView,
  checkpointPort,
  blasCache = new BlasCache(),
  connectivityImpl = defaultConnectivity,
  accelerationImpl,
} = {}) {
  if (typeof resolveGeometryView !== 'function') {
    throw new TypeError('createGeometryRegistry requires resolveGeometryView(loadEpoch, geometryIndex)');
  }

  return new GeometryRegistry({
    buildWeld: async (loadEpoch, geometryIndex /*, ownerModelIdHint */) => {
      // ViewerGeometryAdapter's output holds LIVE references into Viewer's own
      // buffers, not copies, until compactAndWeld copies them -- resolveGeometryView
      // and compactAndWeld MUST run inside the same synchronous span, with no
      // intervening await/yield (Task 14 brief, "Protected invariants").
      const { triangleGeometryView, weldEpsilon } = resolveGeometryView(loadEpoch, geometryIndex);
      // compactAndWeld performs BOTH the active-range ceiling classification and the
      // weld itself; the ceiling is checked against activeTriangleCount BEFORE any
      // compacted buffer is materialized (spec :1532-1536), so a geometry whose
      // active ranges alone exceed maxSyncTriangleCount never reaches mergeVertices.
      return compactAndWeld(triangleGeometryView, { weldEpsilon, maxSyncTriangleCount });
    },
    buildConnectivity: async (weldedGeometry) => connectivityImpl(weldedGeometry),
    buildAcceleration: async (weldedGeometry) =>
      accelerationImpl ? accelerationImpl(weldedGeometry) : blasCache.build(weldedGeometry),
    checkpointPort,
  });
}
