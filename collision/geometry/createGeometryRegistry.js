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
import { reportSpan, reportSpikeInput, isSpikeInputCaptureActive } from '../scheduler.js';

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
    buildWeld: async (loadEpoch, geometryIndex, ownerModelIdHint, role) => {
      // Bracket (a): extraction. Opens at buildWeld entry, closes AFTER resolveGeometryView
      // returns and (when supported and capture is active) the raw-input capture's own copy
      // has run -- folding the capture into this bracket is what keeps "the two brackets'
      // union covers every line of buildWeld's synchronous body, no gap" true even when
      // capture is active (fixed after an independent review found a gap here). try/finally
      // reports even on a throw (e.g. a real RenderProxyUnavailableError from Viewer wiring).
      //
      // ViewerGeometryAdapter's output holds LIVE references into Viewer's own buffers, not
      // copies, until compactAndWeld copies them -- resolveGeometryView and compactAndWeld MUST
      // run inside the same synchronous span, with no intervening await/yield (Task 14 brief,
      // "Protected invariants").
      const extractionStartedAt = performance.now();
      let triangleGeometryView, weldEpsilon;
      // Shared boundary timestamp (codex-advisor finding on this task's own first draft):
      // captured ONCE, inside extraction's own `finally`, and reused verbatim as bracket (b)'s
      // own start time below -- rather than reading performance.now() a second time after the
      // unsupported-view branch check runs. Two separate reads would leave that branch's own
      // (admittedly tiny) evaluation cost, plus reportSpan's own call overhead, unattributed to
      // either span -- a real, if small, violation of "the brackets' union covers buildWeld's
      // entire synchronous body, zero gap." Reusing one timestamp makes the boundary exact.
      let extractionEndedAt;
      try {
        ({ triangleGeometryView, weldEpsilon } = resolveGeometryView(loadEpoch, geometryIndex));
        if (triangleGeometryView && triangleGeometryView.unsupported !== true && isSpikeInputCaptureActive()) {
          reportSpikeInput('geometry-raw-input', () => ({
            loadEpoch, geometryIndex, role,
            positions: triangleGeometryView.positions.slice(),
            positionStride: triangleGeometryView.positionStride,
            positionOffset: triangleGeometryView.positionOffset,
            index: triangleGeometryView.index ? triangleGeometryView.index.slice() : null,
            ranges: triangleGeometryView.ranges.map((r) => ({ start: r.start, count: r.count })),
            activeTriangleCount: triangleGeometryView.activeTriangleCount,
            weldEpsilon,
          }));
        }
      } finally {
        extractionEndedAt = performance.now();
        reportSpan('geometry-extraction', extractionEndedAt - extractionStartedAt);
      }

      // adaptViewerGeometry (the source of triangleGeometryView) never throws for a raw
      // geometry it cannot parse -- it returns `{ unsupported: true, reason }` instead
      // ('unsupported-geometry-layout' / 'rejected-primitive-range'). compactAndWeld's own
      // contract requires the `unsupported: false` variant ("callers filter oversized/
      // unsupported layout diagnostics upstream of this function"), and would otherwise read
      // undefined positions/ranges and produce corrupt output or throw. Filter here, in the
      // one place every real build funnels through, reusing the exact
      // { oversized, reason, activeTriangleCount } marker shape GeometryRegistry's own
      // `weldResult.oversized === true` branch already recognizes -- so an unparseable
      // geometry produces the documented skip-with-diagnostic outcome, not a crash. This early
      // return is the one documented exception to literal whole-body coverage: `geometry-weld`
      // reports a flat 0 (no welding work was ever attempted), not a measured span.
      if (triangleGeometryView && triangleGeometryView.unsupported === true) {
        reportSpan('geometry-weld', 0);
        return { oversized: true, reason: triangleGeometryView.reason, activeTriangleCount: 0 };
      }

      // Bracket (b): weld. Opens at the EXACT SAME timestamp bracket (a) closed at (see above).
      // compactAndWeld performs BOTH the active-range ceiling classification and the weld
      // itself; the ceiling is checked against activeTriangleCount BEFORE any compacted buffer
      // is materialized (spec :1532-1536), so a geometry whose active ranges alone exceed
      // maxSyncTriangleCount never reaches mergeVertices. The welded-result capture's own
      // `.slice()` copies run INSIDE this bracket, before its `finally` closes -- symmetric with
      // the raw-input capture's placement inside bracket (a) above, and fixed for the identical
      // reason (codex-advisor finding on this task's own first draft: leaving the capture after
      // the `finally` left its real copy cost in an unaccounted-for gap after `geometry-weld`
      // closed, even though the raw-input side had already been fixed for this).
      const weldStartedAt = extractionEndedAt;
      let weldResult;
      try {
        weldResult = compactAndWeld(triangleGeometryView, { weldEpsilon, maxSyncTriangleCount });
        if (weldResult.oversized !== true && isSpikeInputCaptureActive()) {
          // .slice() copies, matching the raw-input point's own discipline: weldResult.position/
          // index are the SAME objects buildConnectivity/buildAcceleration consume next, and
          // Task 1.6's accessor caches them on the registry entry -- a capture consumer must
          // never be able to mutate or ArrayBuffer-transfer production state through its copy
          // (independent review's Critical-4 finding on an earlier draft, which handed these out
          // directly).
          reportSpikeInput('geometry-welded-result', () => ({
            loadEpoch, geometryIndex, role,
            position: weldResult.position.slice(), index: weldResult.index.slice(), triangleCount: weldResult.triangleCount,
          }));
        }
      } finally {
        reportSpan('geometry-weld', performance.now() - weldStartedAt);
      }

      return weldResult;
    },
    buildConnectivity: async (weldedGeometry) => connectivityImpl(weldedGeometry),
    buildAcceleration: async (weldedGeometry) =>
      accelerationImpl ? accelerationImpl(weldedGeometry) : blasCache.build(weldedGeometry),
    checkpointPort,
  });
}
