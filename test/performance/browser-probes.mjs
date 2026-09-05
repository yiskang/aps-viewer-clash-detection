// test/performance/browser-probes.mjs -- plain script, NOT an ES module (see header below for why).
// Injected via page.addScriptTag({ path: 'test/performance/browser-probes.mjs' }) against a live
// Viewer page with a model already loaded (window.viewer.model).
//
// All twelve performance-gate pass criteria, enumerated in full so nothing is lost in this
// handoff (verbatim per docs/superpowers/specs/2026-08-06-collision-library-milestone1-design.md:
// 4660-4796), and how each is actually answered:
//
//  1. No single synchronous task exceeds 24.8ms, both cold and warm runs -- answered by
//     `recorder.longestSpan()` after Task 24 wires `setSpanRecorder(recorder.asSpanRecorder())`
//     (collision/scheduler.js) and runs the real cold/warm queries. Not a probe function here.
//  2. Any budget that trips does so with the correct diagnostic, never a freeze/fabricated clash
//     -- answered by inspecting `ClashResult.statistics.diagnostics` from Task 24's real run. Not
//     a probe function here.
//  3. Per-candidate and per-build costs recorded next to measure.mjs's synthetic figures --
//     answered by `ClashStatistics.narrowPhaseMs / narrowPhasePairs` (per-candidate) alongside
//     measure-geometry-phases.mjs's own per-phase figures (per-build), both already produced
//     elsewhere; a reporting/comparison step in Task 24's disposition document, not a new
//     measurement.
//  4. Worst-case cost of one classifyPoint call, one ProperCrossingQuery probe, one
//     SurfaceCrossingWitness in-triangle probe -- probeCosts() below, against a real fragment's
//     already-built GeometryRecord-equivalent pipeline.
//  5. Weld, connectivity, BVH individually at maxSyncTriangleCount -- measure-geometry-phases.mjs.
//  6. Largest-dbId extraction cost, broad-phase total + longest inter-yield span,
//     performance.now()-vs-AABB-test cost, candidate-list size at ceiling --
//     extractionCostAndAabbOverhead() below for the one-off numbers; the "longest inter-yield
//     span" itself comes from `recorder.spansByLabel('broad-phase-scan')` after a real
//     findClashes run, same mechanism as criterion 1.
//  7. One enumNodeChildren call at the fanout ceiling -- widestNodeFanout() below.
//  8. Capacity-admission recompute-and-commit, separate from precheck --
//     `recorder.spansByLabel('capacity-admission-commit')`, plus capacityPrecheckRejects() below
//     for the precheck-rejects-before-mutation assertion.
//  9. One enumNodeFragments call on the densest-fragment node -- widestFragmentOwner() below.
// 10. Epoch registry sweep, from both evictModel and dispose() -- epochSweepCost() below.
// 11. ViewerGeometryAdapter normalization at the most-fragmented geometry --
//     mostFragmentedGeometryNormalization() below.
// 12. CollisionInstance identity-cache retained size after a realistic session --
//     identityCacheRetainedSize() below.
//
// Playwright's `addScriptTag({ path })` reads the file from disk and inlines its text as an
// inline <script> in the page; a same-repo relative `import` inside that inlined text resolves
// against the PAGE's URL, not the local filesystem, and this app's server only exposes
// `collision/` and top-level `wwwroot/` (server.js) -- so `/test/performance/
// checkpoint-recorder.mjs` would 404. Rather than adding a test-only static route to the
// production server.js, this file is self-contained: CheckpointRecorder is duplicated inline
// (kept in sync with checkpoint-recorder.mjs by hand, minus that file's Node-only `report()`
// console-table printer, which has no use in a page context -- a small, explicitly-accepted
// duplication cost, not an oversight) and every probe is a plain function attached to
// window.__perfProbes, no ES module syntax at all.
//
// Real module shapes this file's probes call against (confirmed against source, NOT the plan's
// original guessed names -- see .superpowers/sdd/2026-09-03-collision-library-milestone1-
// implementation/batch5-landed-interfaces-inventory.md):
//   - collision/viewer/ViewerModelAdapter.js: `extractFragments(model, dbIds, loadEpoch, opts)`,
//     NOT `getPlacedGeometry` (does not exist). worldMatrix is a flat Float64Array(16).
//   - collision/viewer/ViewerGeometryAdapter.js: `adaptViewerGeometry(rawGeometry)` (sync), NOT
//     `buildGeometryRecord`/`normalize` (neither exists).
//   - collision/geometry/activeRangeCompaction.js: `compactAndWeld(view, opts)`.
//   - collision/geometry/GeometryConnectivity.js: `computeGeometryConnectivity({ index })`.
//   - collision/blas/ThreeMeshBvhBackend.js: `build(weldedGeometry)`.
//   - collision/query/ContainmentQuery.js: `classifyPoint(point, bvh, localDiagonal)`.
//   - collision/query/ProperCrossingQuery.js: `properCrossingQuery(bvhA, bvhB, matrixBtoA,
//     localDiagonalA, localDiagonalB, options)` -- a plain function, NOT a `.crossing()` method.
//   - collision/query/SurfaceCrossingWitness.js: `surfaceCrossingWitness(sourceBvh, targetBvh,
//     targetToSourceMatrix, sourceLocalDiagonal, targetLocalDiagonal, options)` -- a plain
//     function, NOT a `.probe()` method.
//   - There is no `ViewerModelAdapter.getRangeCount(model, fragId)` accessor, and no
//     `CollisionWorld.getEpochCollisionInstanceCount(epoch)` diagnostic accessor -- both are
//     confirmed absent. Probes that need them fail closed into NOT_EXERCISED rather than
//     guessing at an undocumented internal field.

(function () {
  // This file is meant to be injected into a live Viewer page via Playwright's
  // page.addScriptTag -- it is not a node:test test file. It nonetheless lives under
  // test/performance/ (this task's specified location, alongside the brief's other three
  // deliverables), and Node's `node --test` default discovery sweeps in every .js/.mjs/.cjs file
  // under any directory literally named `test`, regardless of its own filename or whether it
  // matches the repo's own `*.test.mjs` convention -- confirmed empirically: `npm test` was
  // executing this file's top-level `window.__CheckpointRecorder = ...` assignment and throwing
  // `ReferenceError: window is not defined`, since window genuinely does not exist under Node.
  // A no-op bail-out here (rather than trying to fight Node's discovery glob, which has no
  // per-file opt-out) keeps `npm test` green while changing nothing about this file's real,
  // browser-only behavior.
  if (typeof window === 'undefined') return;

  // --- CheckpointRecorder, duplicated verbatim from test/performance/checkpoint-recorder.mjs ---
  class CheckpointRecorder {
    constructor() {
      this.spans = [];
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          this._observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              this.spans.push({ label: '(unattributed longtask)', ms: entry.duration, source: 'longtask' });
            }
          });
          this._observer.observe({ entryTypes: ['longtask'] });
        } catch {
          this._observer = null;
        }
      }
    }
    start(label) {
      const t0 = performance.now();
      return {
        end: () => {
          const ms = performance.now() - t0;
          this.spans.push({ label, ms, source: 'manual' });
          return ms;
        },
      };
    }
    async around(label, fn) {
      const h = this.start(label);
      const result = await fn();
      return [h.end(), result];
    }
    asSpanRecorder() {
      return (label, ms) => this.spans.push({ label, ms, source: 'manual' });
    }
    longestSpan(filterLabel) {
      const pool = filterLabel ? this.spans.filter((s) => s.label === filterLabel) : this.spans;
      return pool.reduce((max, s) => (s.ms > (max?.ms ?? -1) ? s : max), null);
    }
    spansByLabel(label) {
      return this.spans.filter((s) => s.label === label);
    }
    dispose() {
      this._observer?.disconnect();
    }
  }
  window.__CheckpointRecorder = CheckpointRecorder;

  // criteria 6,7,9,10,11,12's escape hatch (docs/...:4744-4795: "recording that limitation is
  // itself a gate finding, not a pass").
  const NOT_EXERCISED = (why) => ({ exercised: false, reason: why });

  /** Walk the whole instance tree, calling `visit(dbId)` on every node (root included). */
  function walkTree(model, visit) {
    const tree = model.getInstanceTree();
    (function walk(dbId) {
      visit(dbId);
      tree.enumNodeChildren(dbId, walk, false);
    })(tree.getRootId());
  }

  window.__perfProbes = {
    /** Criterion 4: worst-case single-call cost of the three named primitives, against a real
     *  fragment's own local-frame geometry + BVH -- this model's own triangle density/BVH depth
     *  is the point (docs/...:4695-4697). Re-derives CollisionWorld._resolveGeometryView's own
     *  pipeline using only public collision/ exports (there is no single "getPlacedGeometry"/
     *  "buildGeometryRecord" helper -- both were assumed by the plan's original snippet and
     *  confirmed not to exist).
     *
     *  @param modules { extractFragments, adaptViewerGeometry, compactAndWeld,
     *    computeGeometryConnectivity, build, classifyPoint, properCrossingQuery,
     *    surfaceCrossingWitness, weldEpsilonMeters, THREE } -- the caller imports these real
     *    collision/ exports (via dynamic `import()` inside `page.evaluate`, matching
     *    test/acceptance/room-locator.acceptance.mjs's own Tier 2 pattern) and hands them in here,
     *    since this file itself carries no ES module imports (see header).
     *
     *    `THREE` here MUST be the real, modern (r185) `three` package -- NOT `window.THREE`, the
     *    Viewer's own bundled r71 global. properCrossingQuery/surfaceCrossingWitness call
     *    `.clone().invert()` on the matrix they're given, a modern-only API (r71's equivalent is
     *    `.getInverse()`); r71's THREE would throw inside those calls. It is also needed for
     *    `classifyPoint`'s sample point: three-mesh-bvh's `closestPointToPoint` calls
     *    `.distanceToSquared(...)` directly on the point it's given, so a plain `{x,y,z}` object
     *    throws -- a real `THREE.Vector3` is required. `window.THREE` is used ONLY for
     *    extractFragments's own `THREE` option below, per ViewerModelAdapter.js's contract that
     *    its extraction scratch Matrix4/Box3 must be a genuine Viewer-side object (see
     *    test/acceptance/room-locator.acceptance.mjs's own header comment on this exact split).
     */
    async probeCosts(model, sampleDbId, modules) {
      const {
        extractFragments, adaptViewerGeometry, compactAndWeld, computeGeometryConnectivity, build,
        classifyPoint, properCrossingQuery, surfaceCrossingWitness, weldEpsilonMeters, THREE,
      } = modules;
      const rec = new CheckpointRecorder();

      const loadEpoch = 0; // diagnostic-only probe, not a real CollisionWorld lease -- no admission/eviction involved.
      const extracted = await extractFragments(model, [sampleDbId], loadEpoch, { checkpoint: undefined, THREE: window.THREE });
      const firstRecord = extracted.values().next().value;
      if (!firstRecord) {
        return NOT_EXERCISED(`sampleDbId ${sampleDbId} owns no fragments directly -- pick a dbId with at least one fragment`);
      }
      // getRenderProxy returns null/undefined for a fragment with no live mesh (that is exactly
      // why collision/errors.js declares RenderProxyUnavailableError) -- fail closed rather than
      // deref a null proxy, matching test/acceptance/room-locator.acceptance.mjs's own guard.
      const renderProxy = window.viewer.impl.getRenderProxy(model, firstRecord.fragmentId);
      if (!renderProxy || !renderProxy.geometry) {
        return NOT_EXERCISED(`no live render proxy for fragment ${firstRecord.fragmentId} of dbId ${sampleDbId}`);
      }
      const view = adaptViewerGeometry(renderProxy.geometry);
      if (view.unsupported) {
        return NOT_EXERCISED(`fragment ${firstRecord.fragmentId}'s geometry is unsupported: ${view.reason}`);
      }
      // Same weldEpsilon derivation CollisionWorld.js's own resolveWeldEpsilon(model) uses --
      // compactAndWeld({}) (no options) would silently use the raw, un-scaled weldEpsilonMeters,
      // producing a different weld (different vertex count, different BVH) than production ever
      // actually builds for a non-meter model.
      const unitScale = typeof model.getUnitScale === 'function' ? model.getUnitScale() : undefined;
      const weldEpsilon = (typeof unitScale === 'number' && Number.isFinite(unitScale) && unitScale > 0)
        ? weldEpsilonMeters / unitScale
        : weldEpsilonMeters;
      const welded = compactAndWeld(view, { weldEpsilon });
      if (welded.oversized) {
        return NOT_EXERCISED(`fragment ${firstRecord.fragmentId}'s geometry is oversized: ${welded.reason}`);
      }
      const { bvh, localDiagonal } = build(welded);
      const samplePoint = new THREE.Vector3(welded.position[0], welded.position[1], welded.position[2]);

      const [classifyMs] = await rec.around('classifyPoint-single-call', () => classifyPoint(samplePoint, bvh, localDiagonal));

      // ProperCrossingQuery/SurfaceCrossingWitness are plain composed-query functions, not objects
      // with a standalone single-probe method (properCrossingQuery/surfaceCrossingWitness are the
      // named exports themselves) -- time the smallest available invocation (self-pair, identity
      // matrix) rather than inventing a granularity these modules don't expose.
      const identityMatrix = new THREE.Matrix4();
      let crossingMs = null;
      let witnessMs = null;
      if (typeof properCrossingQuery === 'function') {
        [crossingMs] = await rec.around('proper-crossing-smallest-call', () =>
          properCrossingQuery(bvh, bvh, identityMatrix, localDiagonal, localDiagonal, {}));
      }
      if (typeof surfaceCrossingWitness === 'function') {
        [witnessMs] = await rec.around('surface-crossing-witness-smallest-call', () =>
          surfaceCrossingWitness(bvh, bvh, identityMatrix, localDiagonal, localDiagonal, {}));
      }
      return { exercised: true, classifyMs, crossingMs, witnessMs };
    },

    /** Criterion 6: extraction cost for the largest requested dbId, plus broad-phase's own
     *  numbers that AREN'T already captured by the shared span log (candidate-list size at the
     *  ceiling, and performance.now()-vs-AABB-test relative cost). The broad-phase scan's own
     *  total cost and its longest inter-yield span come from
     *  recorder.spansByLabel('broad-phase-scan') after a real findClashes run -- this function
     *  supplies the two numbers that mechanism can't.
     *
     *  @param THREE the real, modern (r185) `three` package, NOT `window.THREE` (the Viewer's own
     *    bundled r71 global) -- r71's Box3 does not reliably expose the same modern API
     *    (`.intersectsBox`) this probe relies on; see probeCosts's own doc comment for the full
     *    rationale behind this split. */
    extractionCostAndAabbOverhead(model, THREE) {
      let widest = { dbId: null, fragmentCount: 0 };
      const tree = model.getInstanceTree();
      walkTree(model, (dbId) => {
        let n = 0;
        tree.enumNodeFragments(dbId, () => { n++; }, false);
        if (n > widest.fragmentCount) widest = { dbId, fragmentCount: n };
      });
      const rec = new CheckpointRecorder();
      const h1 = rec.start('extraction-largest-dbid');
      let extracted = 0;
      tree.enumNodeFragments(widest.dbId, () => { extracted++; }, false);
      const extractionMs = h1.end();

      // performance.now() vs one AABB-overlap test, relative cost.
      const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
      const other = new THREE.Box3(new THREE.Vector3(0.5, 0.5, 0.5), new THREE.Vector3(1.5, 1.5, 1.5));
      const N = 100_000;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) performance.now();
      const perfNowCostEach = (performance.now() - t0) / N;
      const t1 = performance.now();
      for (let i = 0; i < N; i++) box.intersectsBox(other);
      const aabbCostEach = (performance.now() - t1) / N;

      return {
        exercised: true,
        widestDbId: widest.dbId,
        fragmentCount: widest.fragmentCount,
        extractionMs,
        perfNowCostMicros: perfNowCostEach * 1000,
        aabbTestCostMicros: aabbCostEach * 1000,
      };
    },

    /** Criterion 7: one enumNodeChildren call at the fanout ceiling, on the widest node the model
     *  offers. */
    widestNodeFanout(model, maxChildrenPerNode) {
      const tree = model.getInstanceTree();
      let widest = { dbId: null, count: 0 };
      walkTree(model, (dbId) => {
        let count = 0;
        tree.enumNodeChildren(dbId, () => { count++; }, false);
        if (count > widest.count) widest = { dbId, count };
      });
      if (widest.count < maxChildrenPerNode) {
        return NOT_EXERCISED(`widest node (dbId ${widest.dbId}) has only ${widest.count} children, ceiling is ${maxChildrenPerNode}`);
      }
      const rec = new CheckpointRecorder();
      let invocations = 0;
      const h = rec.start('enumNodeChildren-at-ceiling');
      tree.enumNodeChildren(widest.dbId, () => {
        invocations++;
        return invocations > maxChildrenPerNode; // observe whether a truthy return actually aborts --
      }, false);                                  // installed typings say void; must be OBSERVED
      const ms = h.end();
      return { exercised: true, dbId: widest.dbId, invocations, ms, abortObserved: invocations <= maxChildrenPerNode + 1 };
    },

    /** Criterion 8 (precheck half): assert the call-wide precheck rejects before any bucket
     *  lookup/CollisionInstance construction, at/near maxCollisionInstancesPerEpoch. Requires
     *  CollisionWorld to expose a way to observe "was any CollisionInstance constructed" -- it
     *  does not (confirmed: no getEpochCollisionInstanceCount or equivalent accessor exists), so
     *  this records that gap rather than guessing at an undocumented internal counter. */
    async capacityPrecheckRejects(world, overCapacityQuery) {
      if (typeof world.getEpochCollisionInstanceCount !== 'function') {
        return NOT_EXERCISED('CollisionWorld exposes no diagnostic accessor to confirm zero CollisionInstance constructions occurred before rejection -- see criterion 12 note in this same file');
      }
      const before = world.getEpochCollisionInstanceCount(overCapacityQuery.epoch);
      let rejected = false;
      try { await world.findClashes(overCapacityQuery); } catch { rejected = true; }
      const after = world.getEpochCollisionInstanceCount(overCapacityQuery.epoch);
      return { exercised: true, rejected, bucketUnchanged: before === after };
    },

    /** Criterion 9: one enumNodeFragments(node, cb, false) call on the node owning the most
     *  fragments. */
    widestFragmentOwner(model, maxFragmentsPerDbId) {
      const tree = model.getInstanceTree();
      let widest = { dbId: null, count: 0 };
      walkTree(model, (dbId) => {
        let count = 0;
        tree.enumNodeFragments(dbId, () => { count++; }, false);
        if (count > widest.count) widest = { dbId, count };
      });
      if (widest.count === 0) return NOT_EXERCISED('no node in this model directly owns any fragments at the top level');
      const rec = new CheckpointRecorder();
      const h = rec.start('enumNodeFragments-widest-owner');
      let n = 0;
      tree.enumNodeFragments(widest.dbId, () => { n++; }, false);
      const ms = h.end();
      return { exercised: true, dbId: widest.dbId, fragmentCount: n, ms, fractionOfCeiling: n / maxFragmentsPerDbId };
    },

    /** Criterion 10: releaseEpochScopedState sweep cost, from evictModel and from dispose(), the
     *  latter varying simultaneously-live epoch count (caller admits N models first for that
     *  case). */
    epochSweepCost(world, model, { viaDispose = false } = {}) {
      const rec = new CheckpointRecorder();
      const label = viaDispose ? 'dispose-epoch-sweep' : 'evictModel-epoch-sweep';
      const h = rec.start(label);
      if (viaDispose) world.dispose(); else world.evictModel(model);
      const ms = h.end();
      return { exercised: true, ms, mode: viaDispose ? 'dispose' : 'evictModel' };
    },

    /** Criterion 11: ViewerGeometryAdapter normalization at the model's most fragmented geometry
     *  (many small TriangleRange groups; O(ranges) is this step's only unceilinged term,
     *  docs/...:4778-4785). There is no ViewerModelAdapter.getRangeCount(model, fragId) accessor
     *  and no ViewerGeometryAdapter.normalize(model, dbId) function (both were assumed by the
     *  plan's original snippet and confirmed not to exist) -- this derives an equivalent range
     *  count from adaptViewerGeometry's own `ranges` field after running the real adapter on
     *  each fragment's raw render-proxy geometry.
     *
     *  @param modules { adaptViewerGeometry } */
    async mostFragmentedGeometryNormalization(model, modules) {
      const { adaptViewerGeometry } = modules;
      if (typeof adaptViewerGeometry !== 'function') {
        return NOT_EXERCISED('no adaptViewerGeometry function was supplied to this probe');
      }
      const tree = model.getInstanceTree();
      let mostRanges = { dbId: null, fragId: null, rangeCount: 0 };
      walkTree(model, (dbId) => {
        tree.enumNodeFragments(dbId, (fragId) => {
          // getRenderProxy returns null/undefined for a fragment with no live mesh (a partially-
          // streamed fragment, especially likely at MEP scale) -- skip it rather than deref a null
          // proxy; a missing fragment here just can't compete for "most fragmented", it is not a
          // reason to abort the whole scan.
          const proxy = window.viewer.impl.getRenderProxy(model, fragId);
          if (!proxy || !proxy.geometry) return;
          const view = adaptViewerGeometry(proxy.geometry);
          const rangeCount = view.unsupported ? 0 : view.ranges.length;
          if (rangeCount > mostRanges.rangeCount) mostRanges = { dbId, fragId, rangeCount };
        }, false);
      });
      if (mostRanges.rangeCount < 8) {
        return NOT_EXERCISED(`most-fragmented geometry found has only ${mostRanges.rangeCount} ranges, too flat to exercise O(ranges) scaling`);
      }
      const rec = new CheckpointRecorder();
      const h = rec.start('viewer-geometry-adapter-normalize');
      const proxy = window.viewer.impl.getRenderProxy(model, mostRanges.fragId);
      adaptViewerGeometry(proxy.geometry);
      const ms = h.end();
      return { exercised: true, dbId: mostRanges.dbId, fragId: mostRanges.fragId, rangeCount: mostRanges.rangeCount, ms };
    },

    /** Criterion 12: CollisionInstance identity-cache retained size after a realistic session.
     *  Caller drives N findClashes calls first; this just reads back the resulting bucket size.
     *  No such accessor exists on CollisionWorld today (confirmed) -- fails closed per the spec's
     *  own instruction for exactly this situation (docs/...:4793-4795) rather than reaching into
     *  an undocumented internal Map by guessing a field name. */
    identityCacheRetainedSize(world, epoch) {
      if (typeof world.getEpochCollisionInstanceCount !== 'function') {
        return NOT_EXERCISED('CollisionWorld exposes no diagnostic accessor for per-epoch CollisionInstance bucket size -- add a minimal read-only accessor (e.g. world.getEpochCollisionInstanceCount(epoch)) as part of a later task, the same way collision/scheduler.js gained setSpanRecorder in Task 23, rather than reaching into an undocumented internal Map by guessing a field name');
      }
      return { exercised: true, epoch, retainedCount: world.getEpochCollisionInstanceCount(epoch) };
    },
  };
})();
