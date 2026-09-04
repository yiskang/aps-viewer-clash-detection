// collision/geometry/createGeometryRegistry.js
//
// Wires GeometryRegistry (Task 13) to the real weld/connectivity/BVH implementations.
// Kept separate from GeometryRegistry.js so that file stays builder-agnostic and
// testable in isolation. A later task (CollisionWorld's own `fromViewer` construction
// path) calls this factory with the real checkpointPort and resolveGeometryView at
// runtime, then attaches the result to CollisionWorld via its registry constructor
// option -- this file never imports CollisionWorld itself.

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
      // adaptViewerGeometry (the source of triangleGeometryView) never throws for a raw
      // geometry it cannot parse -- it returns `{ unsupported: true, reason }` instead
      // ('unsupported-geometry-layout' / 'rejected-primitive-range'). compactAndWeld's own
      // contract requires the `unsupported: false` variant ("callers filter oversized/
      // unsupported layout diagnostics upstream of this function"), and would otherwise read
      // undefined positions/ranges and produce corrupt output or throw. Filter here, in the
      // one place every real build funnels through, reusing the exact
      // { oversized, reason, activeTriangleCount } marker shape GeometryRegistry's own
      // `weldResult.oversized === true` branch already recognizes -- so an unparseable
      // geometry produces the documented skip-with-diagnostic outcome, not a crash.
      if (triangleGeometryView && triangleGeometryView.unsupported === true) {
        return { oversized: true, reason: triangleGeometryView.reason, activeTriangleCount: 0 };
      }
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
