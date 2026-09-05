// test/scheduler/spanRecorder.test.mjs
//
// Task 23: collision/scheduler.js's setSpanRecorder/clearSpanRecorder/reportSpan hook, and the
// `label`-bracketing behavior createCheckpointPort's returned checkpoint() now performs. This is
// the load-bearing fix for the performance gate's criterion 1 (an external harness cannot
// otherwise observe internal synchronous spans between this library's own yield points) -- see
// test/performance/README.md for the full instrumentation-surface writeup.
//
// Three levels covered here:
//   1. Unit level: createCheckpointPort's checkpoint({ label }) brackets the span since the
//      port's own previous checkpoint call correctly on BOTH the fast (not-due) path and the real
//      -yield path, and is a true no-op (no recorder call at all) when no label is supplied or no
//      recorder is set.
//   2. End-to-end: a real CollisionWorld.findClashes call (via the existing fake-model test
//      scaffolding test/CollisionWorld.findClashes.test.mjs uses) labels every one of the five
//      existing checkpoint call sites this task added a label to, plus the one direct
//      (non-checkpoint) capacity-admission-commit span -- confirming "called from every existing
//      checkpoint call site with a stable, distinct label" is actually true, not just claimed.
//   3. GeometryRegistry phase-label regression: a codex-advisor review during this task caught a
//      real off-by-one bug in an earlier draft, where threading `label` through
//      GeometryRegistry._runPhase's own checkpoint() call meant the 'weld' span actually measured
//      pre-build idle time, 'connectivity' silently received WELD's own duration, and
//      'bvh-construction' received CONNECTIVITY's -- because the checkpoint fires BEFORE
//      builderFn ever runs, so its "span since the previous checkpoint" always reports the
//      PRECEDING phase's work, never the phase named in its own label. Fixed by bracketing
//      builderFn() directly with a local performance.now() timer instead of relying on the
//      checkpoint port's shared baseline. This section proves each label now measures its OWN
//      phase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createCheckpointPort, createFrameBudgetAccumulator, setSpanRecorder, clearSpanRecorder,
} from '../../collision/scheduler.js';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { buildMockModel } from '../fixtures/mockInstanceTree.mjs';

// --- level 1: unit -------------------------------------------------------------------------

// createCheckpointPort's own label-bracketing math reads the REAL performance.now() directly
// (deliberately -- criterion 1 needs genuine wall-clock time, not whatever fake clock a caller
// injects for frame-budget-due testing purposes, which is a SEPARATE clock from this one). To
// assert exact, deterministic span durations here, this fixture temporarily replaces the global
// performance.now() itself with a controllable fake -- restored in every test's own `finally`.
function makeHarness() {
  let mockNow = 0;
  let forcedDue = false;
  // accumulator gets its OWN fake `now` (frame-budget-due decisions), independent of the
  // performance.now() replacement below (span bracketing) -- exactly like production, where
  // CollisionWorld supplies its own `now` to createFrameBudgetAccumulator while
  // createCheckpointPort's span math always uses the real global performance.now().
  const accumulator = createFrameBudgetAccumulator({ now: () => mockNow, budgetMs: 8 });
  const wrappedAccumulator = {
    isDue: () => forcedDue || accumulator.isDue(),
    markCheckpointed: () => { forcedDue = false; accumulator.markCheckpointed(); },
  };
  let yieldResolvers = [];
  // Patch performance.now() BEFORE constructing the port: createCheckpointPort captures its own
  // `lastSpanAt = performance.now()` baseline at construction time, so the fake clock must
  // already be in place for that baseline to be comparable to later fake-clock reads.
  const realPerformanceNow = performance.now.bind(performance);
  let fakePerfNow = 0;
  performance.now = () => fakePerfNow;
  const port = createCheckpointPort({
    isDisposed: () => false,
    isEpochLive: () => true,
    accumulator: wrappedAccumulator,
    yieldToScheduler: () => new Promise((resolve) => { yieldResolvers.push(resolve); }),
  });
  return {
    port,
    advanceClock: (ms) => { mockNow += ms; fakePerfNow += ms; },
    forceDue: () => { forcedDue = true; },
    resolveNextYield: () => { yieldResolvers.shift()?.(); },
    restore: () => { performance.now = realPerformanceNow; },
  };
}

test('setSpanRecorder/clearSpanRecorder: unset is a true no-op (no recorder called at all)', () => {
  const { port, restore } = makeHarness();
  try {
    // No setSpanRecorder call anywhere in this test -- if the hook were NOT gated correctly,
    // calling it would throw (there is no recorder to call), which this test would fail on.
    assert.equal(port.checkpoint({ loadEpoch: 1, label: 'x' }), undefined);
  } finally {
    restore();
  }
});

test('label bracketing: fast path (not due) reports the span since the previous call immediately', () => {
  const { port, advanceClock, restore } = makeHarness();
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    port.checkpoint({ loadEpoch: 1, label: 'first' }); // baseline: since port construction
    advanceClock(3);
    port.checkpoint({ loadEpoch: 1, label: 'second' }); // should report exactly 3ms since 'first'
    assert.equal(spans.length, 2);
    assert.equal(spans[0].label, 'first');
    assert.equal(spans[1].label, 'second');
    assert.equal(spans[1].ms, 3);
  } finally {
    clearSpanRecorder();
    restore();
  }
});

test('label bracketing: a call with no label reports nothing, but still resets the baseline', () => {
  const { port, advanceClock, restore } = makeHarness();
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    port.checkpoint({ loadEpoch: 1 }); // no label -- no span recorded
    advanceClock(5);
    port.checkpoint({ loadEpoch: 1, label: 'labeled' });
    assert.equal(spans.length, 1);
    assert.equal(spans[0].label, 'labeled');
    assert.equal(spans[0].ms, 5); // baseline still tracked correctly across the unlabeled call
  } finally {
    clearSpanRecorder();
    restore();
  }
});

test('label bracketing: the real-yield branch resets the baseline AFTER the yield completes, not before', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    port.checkpoint({ loadEpoch: 1, label: 'before-yield' });
    advanceClock(4);
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1, label: 'triggers-yield' });
    assert.ok(pending, 'a due checkpoint must return a real Promise');
    assert.equal(spans.at(-1).label, 'triggers-yield');
    assert.equal(spans.at(-1).ms, 4, 'the span up to the yield call itself is reported synchronously');

    // While the yield is still pending, advance the clock a lot -- this time must NOT be
    // attributed to the NEXT span as if it were synchronous work.
    advanceClock(1000);
    resolveNextYield();
    await pending;

    port.checkpoint({ loadEpoch: 1, label: 'after-yield' });
    const afterYieldSpan = spans.find((s) => s.label === 'after-yield');
    assert.equal(afterYieldSpan.ms, 0, 'baseline was reset AFTER the yield resolved, so no paused time leaks into the next span');
  } finally {
    clearSpanRecorder();
    restore();
  }
});

// --- level 2: end-to-end, every real checkpoint call site this task labeled -----------------

function translationMatrix([x, y, z]) { return new THREE.Matrix4().makeTranslation(x, y, z).toArray(); }
function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
function makeFixture(rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, {
      geometryIndex: spec.geometryIndex,
      matrix: translationMatrix(at),
      bounds: boundsOf(spec.geometry, at),
    });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = {
    impl: {
      getRenderProxy(queriedModel, fragId) {
        assert.equal(queriedModel, model);
        return { geometry: rawGeometryByFragId.get(fragId) };
      },
    },
  };
  return { model, viewer };
}
function advancingClock(stepMs = 1000) { let t = 0; return () => (t += stepMs); }

test('every existing checkpoint call site reports a labeled span through a real findClashes call', async () => {
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // dbId 1's own fragment sits one level BELOW the requested dbId (under child 11), so
  // extractFragments's "after pushing a node's children" checkpoint ('extraction-node-descend')
  // gets a chance to fire -- a single childless requested node never reaches that call site
  // (stack.length is 0 right after the push), which is real behavior of the source's own guard,
  // not a gap in this test.
  const { model, viewer } = makeFixture(
    [{
      dbId: 0,
      children: [
        { dbId: 1, children: [{ dbId: 11, fragments: [101] }] },
        { dbId: 2, fragments: [102] },
      ],
    }],
    {
      101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] }, // 'containment' mode needs
      // connectivity, so a real weld/connectivity/bvh-construction geometry build is reached too.
    },
  );

  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    const world = await CollisionWorld.fromViewer(viewer, {
      narrowPhase: 'three-mesh-bvh',
      indexOwnership: 'clone',
      now: advancingClock(), // forces the real-yield branch too, not just the fast path
      yieldToScheduler: async () => {},
    });
    const result = await world.findClashes({
      source: { model, dbIds: [1] },
      target: { model, dbIds: [2] },
      mode: 'containment',
      groupBy: 'dbId',
    });
    assert.equal(result.pairs.length, 1, 'the small box genuinely sits inside the large one');

    const labels = new Set(spans.map((s) => s.label));
    for (const expected of [
      'extraction-node-visit', 'extraction-node-descend', 'broad-phase-scan', 'narrow-phase-pair',
      'capacity-admission-commit', 'weld', 'connectivity', 'bvh-construction',
      // 'containment' mode routes through ContainmentModeQuery's composed sampling/witness
      // stages, which share the per-call port via createComposedStageScheduler -- confirms that
      // checkpoint's own label (fixed alongside the GeometryRegistry bug -- see
      // test/performance/README.md) actually fires, not just that this fixture happens to reach it.
      'composed-narrow-phase-stage',
    ]) {
      assert.ok(labels.has(expected), `expected label '${expected}' to have been reported at least once`);
    }
    for (const span of spans) {
      assert.equal(typeof span.label, 'string');
      assert.ok(Number.isFinite(span.ms) && span.ms >= 0, `${span.label}'s span ms must be a finite non-negative number`);
    }
  } finally {
    clearSpanRecorder();
  }
});

test('clearSpanRecorder actually stops further recording', async () => {
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    {
      101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] },
      102: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] },
    },
  );
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  clearSpanRecorder();
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'surface-intersection', groupBy: 'dbId',
  });
  assert.equal(spans.length, 0, 'no spans should be recorded once the recorder was cleared before the call');
});

// --- level 3: GeometryRegistry phase-label regression -----------------------------------------

/** Busy-wait a real, approximate number of milliseconds -- deliberately real wall-clock work
 *  (not a fake clock), since this test's whole point is confirming the fix measures genuine
 *  builderFn duration via a local performance.now() bracket, not the shared checkpoint port's
 *  own (unrelated) baseline. */
function busyWaitMs(ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { /* spin */ }
}

test('GeometryRegistry: weld/connectivity/bvh-construction spans measure their OWN phase, not the preceding one', async () => {
  const spans = [];
  setSpanRecorder((label, ms) => spans.push({ label, ms }));
  try {
    // Deliberately widely-separated durations, so each phase's OWN reported span is clearly,
    // robustly distinguishable from the others' even under heavy system-load jitter. NOTE: this
    // test's stub checkpointPort below (`{ checkpoint: () => undefined }`) ignores whatever ctx
    // it's called with entirely, including a `label` field -- so this test does NOT literally
    // reproduce the original off-by-one bug mechanism if `_runPhase` were reverted to threading
    // `label` through the checkpoint call (that revert would make this stub report NO spans at
    // all, since the stub never calls reportSpan itself, rather than reproducing the specific
    // "connectivity receives weld's duration" mislabeling the real scheduler.js port produced).
    // It IS still a legitimate, non-tautological regression guard: it fails on that revert (via
    // total absence of spans instead of via label-swapped values), and directly asserts the
    // CORRECTED behavior this fix landed on -- each phase's span is reported by a local bracket
    // around its own builderFn(), independent of whatever the checkpointPort does.
    const registry = new GeometryRegistry({
      buildWeld: async () => { busyWaitMs(20); return { position: new Float32Array(3), index: new Uint32Array(3), triangleCount: 1 }; },
      buildConnectivity: async () => { busyWaitMs(2); return { componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }; },
      buildAcceleration: async () => { busyWaitMs(1); return { bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: {} }; },
      checkpointPort: { checkpoint: () => undefined }, // never due -- fast path only, no yields
    });
    await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'x', needsConnectivity: true });

    const weldSpan = spans.find((s) => s.label === 'weld');
    const connSpan = spans.find((s) => s.label === 'connectivity');
    const bvhSpan = spans.find((s) => s.label === 'bvh-construction');
    assert.ok(weldSpan, 'a weld span must be reported');
    assert.ok(connSpan, 'a connectivity span must be reported');
    assert.ok(bvhSpan, 'a bvh-construction span must be reported');

    assert.ok(weldSpan.ms >= 15, `weld span should reflect its own ~20ms busy-wait, got ${weldSpan.ms}`);
    // Guards the corrected direct-reporting behavior: each span should reflect its OWN phase's
    // busy-wait target, not get inflated toward a much larger, unrelated duration. A generous
    // margin below weldSpan.ms is used rather than a tight upper bound on connSpan/bvhSpan
    // themselves, to stay robust to real system-load timing jitter.
    assert.ok(connSpan.ms < weldSpan.ms / 2, `connectivity span (${connSpan.ms}ms) should reflect its own ~2ms busy-wait, not weld's much larger ~20ms (${weldSpan.ms}ms)`);
    assert.ok(bvhSpan.ms < weldSpan.ms / 2, `bvh-construction span (${bvhSpan.ms}ms) should reflect its own ~1ms busy-wait, not weld's much larger ~20ms (${weldSpan.ms}ms)`);
  } finally {
    clearSpanRecorder();
  }
});
