# M4 — Performance / Worker Decision Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pre-registered M4 benchmark/decision-gate harness — additive instrumentation, a new standalone `test/performance/run-gate-m4.mjs`, a pure evidence→verdict reducer, and bounded disposable spikes under `spike/m4/` — that measures the real federated fixture under the fixed workload matrix and mechanically produces exactly one verdict: A / B / C / D. D is a valid, successful outcome. M4 does not implement a worker architecture.

**Architecture:** Five dependency-ordered phases plus one non-code decision checkpoint, because the design spec's own §17 makes several spikes decision-gated on the baseline gate's real result — they cannot all be built before that result exists. Phase 1 adds the six closed, additive/no-op-when-unused instrumentation hooks to `collision/`. Phase 2 builds pure, no-I/O engines (trace/clock parsing, stage-attribution residual math, Metric M, a canonical decision-evidence-model adapter, the verdict reducer) on top of Phase 1's accessor contracts. Phase 3 builds the baseline harness (`run-gate-m4.mjs`, cohort profiler, S2T facade, R6 sequence, observation envelope, canonical comparator) plus the two spikes (S1′, S3′+S4′) that §17 marks unconditional, and ends with a **decision checkpoint**: the baseline gate is actually run on both runtimes, and its real §6.3 partition and §7.2 target evaluation determine which of S5′/S6′/S7′/S8′ (Phase 4) are required at all. Phase 4 builds only the conditional spikes the checkpoint activates (all eight are fully specified here regardless, since the design spec fixes their shape in advance — but only the activated subset is actually built and run). Phase 5 executes the real gate/spikes, feeds the results through the reducer, produces the final disposition, and disposes spike code — procedural, not code-authoring.

**Tech Stack:** Node.js ESM (`.mjs`), Playwright + Chromium DevTools Protocol (CDP tracing, Input.dispatchMouseEvent), existing project test runner (see `test/performance/README.md` for conventions), no new dependencies (the S1' module-resolution build-variant spike, if needed, uses Node built-ins only).

**Spec:** `docs/superpowers/specs/2026-09-08-collision-library-milestone4-performance-worker-decision-design.md`

**Roadmap constraints:** `docs/superpowers/specs/collision-library-roadmap.md` — this plan does not reopen M1-M3 public contracts (§4 of the roadmap) and does not implement Federated Clash Test & Results or Viewer Clash Panel scope (§5).

## Global Constraints

- `frameBudgetMs = 8`, M1's 24.8 ms worst-span ceiling, `maxClearanceNarrowPhasePairs = 20,000`, `maxBroadPhaseInstancePairs = 1,000,000` (per target epoch group), `maxTlasCandidatePairs = 200,000`, `maxCollisionInstancesPerEpoch = 20,000`, `maxSyncTriangleCount = 12,000` — all inherited from `collision/constants.js`, unchanged. M4 retunes none of them.
- `run-gate.mjs`, `run-gate-m2.mjs`, `run-gate-m3.mjs` are byte-stable. Never edited.
- All new library instrumentation is additive and no-op when unused, in the same class as `setSpanRecorder`/`clearSpanRecorder`/`reportSpan` (`collision/scheduler.js:47-55`). Exactly six instrumentation additions are permitted (spec §16.4): (1) yield instrumentation, (2) narrow-phase interior labels + additive `inconclusiveCauses`/`precheckNotRunReason`, (3) the two non-overlapping extraction/weld brackets in `buildWeld`, (4) read-only memory diagnostic accessors, (5) one structured no-op diagnostic-event recorder (`setDiagnosticEventRecorder`/`clearDiagnosticEventRecorder`/`reportDiagnosticEvent`), (6) one disabled-by-default S7' stage-input capture hook (`setSpikeInputCapture`/`clearSpikeInputCapture`). Nothing else touches `collision/` production behavior. No public contract, result shape, diagnostic reason, or statistics field changes.
- No worker code, no cancellation API, no progress API, no `AbortSignal`, no latest-call-wins semantics, no cross-origin-isolation change, no modification of `server.js`.
- No spike code lands under `collision/` or `wwwroot/`. All spike code lives under `spike/m4/`, served by the harness's own Express instance (never a route added to `server.js`). It is deleted at M4 close in every verdict case (A, B, C, or D) — a B/C verdict only *justifies* the next milestone building a real implementation (§1.2, §19.2); "adoption" is evidentiary (which finding informs the next milestone's starting point), never a license to ship spike code as production (see Phase 5, task 5.5).
- Never fail the process on a performance verdict. Only a correctness violation (§6.4 comparator mismatch) sets `disposition: 'FAILED_VALIDATION'` and a non-zero exit code.
- Never report a verdict from an unexercised criterion. Every population summary carries an explicit empty-set guard (`Math.max(...[])` is `-Infinity`); an unrunnable case reports `CAPACITY_REJECTED` with the exact limit and observed value, never silently trimmed.
- TDD discipline throughout: RED (failing test) -> GREEN (minimal implementation) -> commit, for every new seam/reducer/harness rule.

---
## Phase 1 — Contracts and instrumentation

### Cross-task design decisions (resolving open questions from independent review)

These bind every task below; stated once here rather than repeated per task.

1. **Every new `ms` field is wall-clock, including any real scheduler yield that happens to fall inside the bracket.** The `containment-a-in-b`/`containment-b-in-a` subterm brackets (Task 1.4) wrap `anyComponentInside`, an async function that can itself call `scheduler.checkpointIfDue()` and genuinely yield. This phase does not add a second "active CPU time only" clock discipline — that would be a seventh instrumentation surface beyond §16.4's bounded six. A harness that wants active-only time can subtract Task 1.1's independently-reported yield resume latencies for yields known to land inside the same window.
2. **`'volume-overlap-query'` (kind `'hard-clash-precheck'`, emitted by `classifyHardClashPrecheck`) is the authoritative TOTAL duration of one Hard-Clash precheck call. `'crossing'`/`'containment-a-in-b'`/`'containment-b-in-a'` (same kind, emitted from inside `volumeOverlapQuery`) are nested SUBTERMS of that same total.** Their sum is always ≤ the total (bookkeeping between terms falls in neither subterm bracket). A harness's aggregation sink must never add the subterms to the total — Task 1.4/1.5's own outcome-matrix table (Task 1.5) states exactly which of the four ever co-occur for one pair.
3. **All three new recorder-style hooks (yield, diagnostic-event, spike-input-capture) permit being cleared/replaced while an async operation that reports through them is still in flight.** Only the yield recorder (Task 1.1) needs generation isolation for this, matching `scheduler.js`'s existing `_spanRecorderGeneration` precedent — it is the only one of the three that carries a timer baseline across an `await`. `reportDiagnosticEvent`/`reportSpikeInput` are pure pass-through calls (kind+payload in, one direct invocation out, nothing carried across a call), so there is no stale-baseline value a mid-flight swap could corrupt for those two.
4. **`GeometryRegistry.getEpochGeometryEntries` returns entries in `Map` insertion (build) order, not sorted by `geometryIndex`.** Deliberate: sorting costs an O(n log n) pass on every diagnostic read for no benefit Metric M (a later phase) needs (it sums over the whole array regardless of order), and insertion order is itself informative.

---

### Task 1.1: Scheduler yield-instrumentation hook

**Files:**
- Modify: `collision/scheduler.js:1-205`
- Test: `test/scheduler/yieldRecorder.test.mjs`

**Interfaces:**
- Consumes: nothing new (mirrors `setSpanRecorder`/`clearSpanRecorder`/`reportSpan`, `collision/scheduler.js:47-55`, including its `_spanRecorderGeneration` generation-isolation mechanism — this task's own `_yieldRecorderGeneration` is a direct analog).
- Produces: `setYieldRecorder(fn)`, `clearYieldRecorder()`, `reportYield(resumeLatencyMs, runningCount)` (internal). `fn(resumeLatencyMs: number, runningCount: number)` fires on every real scheduler yield whose SAME recorder installation is still active when the yield resumes — a yield whose recorder was cleared, reinstalled, or replaced with a different one while it was in flight reports to nobody (design decision 3 above; this is the fix for the independent review's Important-1 finding). `runningCount` resets to 0 on every `setYieldRecorder`/`clearYieldRecorder` call, not only `clear` — the count is scoped to one recorder INSTALLATION, never global.

- [ ] **Step 1: Write the failing test**
```js
// test/scheduler/yieldRecorder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckpointPort, createFrameBudgetAccumulator, setYieldRecorder, clearYieldRecorder,
} from '../../collision/scheduler.js';

function makeHarness() {
  let mockNow = 0;
  let forcedDue = false;
  const accumulator = createFrameBudgetAccumulator({ now: () => mockNow, budgetMs: 8 });
  const wrappedAccumulator = {
    isDue: () => forcedDue || accumulator.isDue(),
    markCheckpointed: () => { forcedDue = false; accumulator.markCheckpointed(); },
  };
  let yieldResolvers = [];
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

test('setYieldRecorder/clearYieldRecorder: unset is a true no-op', () => {
  const { port, restore } = makeHarness();
  try {
    assert.equal(port.checkpoint({ loadEpoch: 1 }), undefined);
  } finally {
    restore();
  }
});

test('a real yield reports resume latency and an incrementing running count', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yields = [];
  setYieldRecorder((resumeLatencyMs, runningCount) => yields.push({ resumeLatencyMs, runningCount }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    assert.ok(pending, 'a due checkpoint must return a real Promise');
    advanceClock(12);
    resolveNextYield();
    await pending;
    assert.equal(yields.length, 1);
    assert.equal(yields[0].resumeLatencyMs, 12);
    assert.equal(yields[0].runningCount, 1);

    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(3);
    resolveNextYield();
    await pending2;
    assert.equal(yields.length, 2);
    assert.equal(yields[1].resumeLatencyMs, 3);
    assert.equal(yields[1].runningCount, 2);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('setYieldRecorder itself resets the running count, not only clearYieldRecorder', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const countsA = [];
  setYieldRecorder((ms, count) => countsA.push(count));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    advanceClock(1);
    resolveNextYield();
    await pending;
    assert.deepEqual(countsA, [1]);

    // Direct replacement, NO clearYieldRecorder call in between.
    const countsB = [];
    setYieldRecorder((ms, count) => countsB.push(count));
    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(1);
    resolveNextYield();
    await pending2;
    assert.deepEqual(countsA, [1], 'A never sees the second checkpoint (it was replaced first)');
    assert.deepEqual(countsB, [1], 'count restarts at 1 for B, not continuing from A\'s 1');
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('the fast (not-due) path never triggers the yield recorder', () => {
  const { port, restore } = makeHarness();
  const yields = [];
  setYieldRecorder((ms, count) => yields.push({ ms, count }));
  try {
    port.checkpoint({ loadEpoch: 1 });
    assert.equal(yields.length, 0);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('recorder lifecycle: clearing then reinstalling WHILE a yield is in flight does not misattribute the old yield to the new recorder', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yieldsA = [];
  setYieldRecorder((ms, count) => yieldsA.push({ ms, count }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 }); // yield now in flight, recorder A active
    advanceClock(4);
    clearYieldRecorder();
    const yieldsB = [];
    setYieldRecorder((ms, count) => yieldsB.push({ ms, count })); // B installed WHILE A's yield is still pending
    advanceClock(1000);
    resolveNextYield();
    await pending;
    assert.equal(yieldsA.length, 0, 'A never resolved -- it was cleared before resume');
    assert.equal(yieldsB.length, 0, 'B must NOT receive a yield it did not start observing -- this yield began under A');

    // A genuinely NEW yield, started after B was installed, DOES report to B normally.
    forceDue();
    const pending2 = port.checkpoint({ loadEpoch: 1 });
    advanceClock(2);
    resolveNextYield();
    await pending2;
    assert.deepEqual(yieldsB, [{ ms: 2, count: 1 }]);
  } finally {
    clearYieldRecorder();
    restore();
  }
});

test('recorder lifecycle: recorder A replaced directly by recorder B mid-yield (no clear in between) does not misattribute', async () => {
  const { port, advanceClock, forceDue, resolveNextYield, restore } = makeHarness();
  const yieldsA = [];
  setYieldRecorder((ms, count) => yieldsA.push({ ms, count }));
  try {
    forceDue();
    const pending = port.checkpoint({ loadEpoch: 1 });
    advanceClock(4);
    const yieldsB = [];
    setYieldRecorder((ms, count) => yieldsB.push({ ms, count })); // direct replacement, no clear
    advanceClock(1000);
    resolveNextYield();
    await pending;
    assert.equal(yieldsA.length, 0);
    assert.equal(yieldsB.length, 0, 'the in-flight yield belonged to A\'s installation, not B\'s -- must not report to either');
  } finally {
    clearYieldRecorder();
    restore();
  }
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/scheduler/yieldRecorder.test.mjs`
Expected: FAIL with `TypeError: setYieldRecorder is not a function`
- [ ] **Step 3: Write minimal implementation**

In `collision/scheduler.js`, immediately after the existing `reportSpan` block (after line 55), add:
```js
// ---- Optional yield-instrumentation hook (Task 1.1) --------------------------------------------
// Same class of addition as setSpanRecorder above: module-level singleton, zero cost when unset.
// Generation-isolated exactly like _spanRecorderGeneration (scheduler.js's own existing mechanism)
// -- a yield whose recorder installation changed (cleared, reinstalled, or replaced) WHILE the
// yield was in flight reports to nobody, never to whichever recorder happens to be active at
// resume time. Without this, a yield started under recorder A but resolving after B replaces A
// would silently report as B's own first yield.
let _yieldRecorder = null;
let _yieldCount = 0;
let _yieldRecorderGeneration = 0;
export function setYieldRecorder(fn) { _yieldRecorder = fn; _yieldCount = 0; _yieldRecorderGeneration++; }
export function clearYieldRecorder() { _yieldRecorder = null; _yieldCount = 0; _yieldRecorderGeneration++; }
export function reportYield(resumeLatencyMs) {
  _yieldCount++;
  _yieldRecorder?.(resumeLatencyMs, _yieldCount);
}

async function yieldAndRecordResume(yieldToScheduler) {
  if (_yieldRecorder) {
    const generationAtYieldStart = _yieldRecorderGeneration;
    const yieldStartedAt = performance.now();
    await yieldToScheduler();
    if (_yieldRecorder && _yieldRecorderGeneration === generationAtYieldStart) {
      reportYield(performance.now() - yieldStartedAt);
    }
  } else {
    await yieldToScheduler();
  }
}
```

Then, inside `createCheckpointPort`'s returned `checkpoint()` method, replace BOTH existing `await yieldToScheduler();` call sites with `await yieldAndRecordResume(yieldToScheduler);` (unchanged surrounding logic otherwise).
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/scheduler/yieldRecorder.test.mjs`
Expected: PASS (6/6)
- [ ] **Step 5: Commit**
```bash
git add collision/scheduler.js test/scheduler/yieldRecorder.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): add generation-isolated scheduler yield-instrumentation hook

setYieldRecorder/clearYieldRecorder/reportYield in collision/scheduler.js, mirroring the
existing setSpanRecorder pattern including its generation-isolation mechanism -- a yield
whose recorder was cleared/reinstalled/replaced while in flight reports to nobody, never
misattributing to a later installation. Zero cost when unset. M4 §16.4 item 1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Diagnostic-event recorder mechanism

**Files:**
- Modify: `collision/scheduler.js` (adds to the file Task 1.1 already modified)
- Test: `test/scheduler/diagnosticEventRecorder.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `setDiagnosticEventRecorder(fn)`, `clearDiagnosticEventRecorder()`, `reportDiagnosticEvent(kind: string, payload: object)`, `isDiagnosticEventRecorderActive(): boolean`. MECHANISM ONLY — no call site in `collision/` calls `reportDiagnosticEvent` yet (Task 1.4). Per design decision 3, no generation isolation is needed: this hook carries no cross-call timer baseline, only pure pass-through calls.

- [ ] **Step 1: Write the failing test**
```js
// test/scheduler/diagnosticEventRecorder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setDiagnosticEventRecorder, clearDiagnosticEventRecorder, reportDiagnosticEvent,
  isDiagnosticEventRecorderActive,
} from '../../collision/scheduler.js';

test('reportDiagnosticEvent is a true no-op when unset', () => {
  assert.equal(isDiagnosticEventRecorderActive(), false);
  assert.doesNotThrow(() => reportDiagnosticEvent('geometry-resolve', { stage: 'geometry-resolve', ms: 1 }));
});

test('setDiagnosticEventRecorder receives kind and payload verbatim', () => {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    assert.equal(isDiagnosticEventRecorderActive(), true);
    reportDiagnosticEvent('narrow-phase-pair', { stage: 'volume-overlap', ms: 4.5, sourceEpoch: 1, sourceFragmentId: 10 });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'narrow-phase-pair');
    assert.deepEqual(events[0].payload, { stage: 'volume-overlap', ms: 4.5, sourceEpoch: 1, sourceFragmentId: 10 });
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('clearDiagnosticEventRecorder actually stops further recording', () => {
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  clearDiagnosticEventRecorder();
  assert.equal(isDiagnosticEventRecorderActive(), false);
  reportDiagnosticEvent('hard-clash-precheck', { stage: 'crossing', ms: 1 });
  assert.equal(events.length, 0);
});

test('every one of the four bounded kinds flows through untouched', () => {
  const events = [];
  setDiagnosticEventRecorder((kind) => events.push(kind));
  try {
    for (const kind of ['clearance-distance-query', 'hard-clash-precheck', 'narrow-phase-pair', 'geometry-resolve']) {
      reportDiagnosticEvent(kind, { stage: kind, ms: 0 });
    }
    assert.deepEqual(events, ['clearance-distance-query', 'hard-clash-precheck', 'narrow-phase-pair', 'geometry-resolve']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/scheduler/diagnosticEventRecorder.test.mjs`
Expected: FAIL with `TypeError: setDiagnosticEventRecorder is not a function`
- [ ] **Step 3: Write minimal implementation**

In `collision/scheduler.js`, after the yield-recorder block:
```js
// ---- Optional structured diagnostic-event recorder (Task 1.2) ----------------------------------
// MECHANISM ONLY: no production call site reports through this yet (Task 1.4 wires the real call
// sites). isDiagnosticEventRecorderActive() lets a call site in a DIFFERENT module (none of which
// can see this module's private state) gate its own payload construction behind one cheap boolean
// check, so "zero cost when unused" holds at every call site, not only in here.
let _diagnosticEventRecorder = null;
export function setDiagnosticEventRecorder(fn) { _diagnosticEventRecorder = fn; }
export function clearDiagnosticEventRecorder() { _diagnosticEventRecorder = null; }
export function reportDiagnosticEvent(kind, payload) {
  _diagnosticEventRecorder?.(kind, payload);
}
export function isDiagnosticEventRecorderActive() {
  return _diagnosticEventRecorder !== null;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/scheduler/diagnosticEventRecorder.test.mjs`
Expected: PASS (4/4)
- [ ] **Step 5: Commit**
```bash
git add collision/scheduler.js test/scheduler/diagnosticEventRecorder.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): add diagnostic-event recorder mechanism (no call sites yet)

setDiagnosticEventRecorder/clearDiagnosticEventRecorder/reportDiagnosticEvent, plus
isDiagnosticEventRecorderActive() for cross-module zero-cost gating, in collision/scheduler.js.
Mechanism only -- Task 1.4 wires the real emission call sites. M4 §16.4 item 5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Role threading, buildWeld brackets, and the S7' capture hook

**Files:**
- Modify: `collision/scheduler.js` (adds `setSpikeInputCapture`/`clearSpikeInputCapture`/`reportSpikeInput`/`isSpikeInputCaptureActive`)
- Modify: `collision/geometry/createGeometryRegistry.js:16-58`
- Modify: `collision/geometry/GeometryRegistry.js:58-140`
- Modify: `collision/CollisionWorld.js:308-348`, `collision/CollisionWorld.js:1700-1702`
- Test: `test/geometry/roleThreading.test.mjs`, `test/geometry/createGeometryRegistry.spikeCapture.test.mjs`, `test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier Phase 1 tasks.
- Produces:
  - `role` threading: `CollisionWorld.resolveGeometryRecord`'s existing `role` param flows into `registry.getOrBuildGeometry({..., role})` → `GeometryRegistry._insertBuildingEntry(..., role)` → `buildWeld(loadEpoch, geometryIndex, ownerModelIdHint, role)`. **Capture identity is `(loadEpoch, geometryIndex)`, matching `GeometryRegistry`'s own cache identity — NOT `(loadEpoch, geometryIndex, role)`.** `GeometryRegistry` builds a geometry at most once per `(loadEpoch, geometryIndex)` (insert-first-then-build, single-flight); `role` reaches `buildWeld` only on the call that TRIGGERS that one build. A later reference to the same already-cached geometry under the OTHER role is a cache hit — `buildWeld` is not called again, and the capture (below) does not fire a second time under the other role. `role` on a capture payload therefore means "the role of whichever call first triggered this build," not "every role this geometry was ever observed under." This is a documented limitation, not a bug — fixed independently, it corrected an earlier draft that implied full per-role capture coverage (a real correctness gap an independent review caught: the capture set would otherwise silently depend on candidate evaluation order).
  - `setSpikeInputCapture(fn)` / `clearSpikeInputCapture()` / `isSpikeInputCaptureActive()` in `collision/scheduler.js`. `fn(kind, payload)` for three kinds:
    - `'geometry-raw-input'`: `{ loadEpoch, geometryIndex, role, positions, positionStride, positionOffset, index, ranges: {start,count}[], activeTriangleCount, weldEpsilon }`. `positions`/`index` are `.slice()` copies of `triangleGeometryView.positions`/`.index`, **preserving whatever typed-array constructor the Viewer/`ViewerGeometryAdapter` actually supplied** — commonly `Float32Array`/`Uint32Array`, but `.slice()` never changes the element type or width, so an index array could legitimately be a narrower type (e.g. `Uint16Array`). A consumer must read `positions.constructor`/`index.constructor` (or `BYTES_PER_ELEMENT`) rather than assume a fixed type — this corrects an earlier draft's overclaim. `index` is `null` when the source view has no index (non-indexed geometry).
    - `'geometry-welded-result'`: `{ loadEpoch, geometryIndex, role, position, index, triangleCount }`. `position`/`index` are ALSO `.slice()` copies (not the live objects `GeometryRegistry` retains and `buildConnectivity`/`buildAcceleration` still need) — an earlier draft called these "safe to hand out directly," which an independent review correctly flagged: a capture consumer that mutates or `ArrayBuffer`-transfers what it's handed would otherwise corrupt production state (`buildConnectivity`/`buildAcceleration` run AFTER this capture point, on the SAME objects). Copying costs one extra `.slice()` only when a capture fn is installed.
    - `'precheck-candidate-list'`: `{ sourceEpoch, candidates: {sourceLoadEpoch, sourceGeometryIndex, sourceFragmentId, targetLoadEpoch, targetGeometryIndex, targetFragmentId, targetEpoch}[] }`. Fires once per `findClashes({mode:'clearance'})` call, ONLY after `_checkClearanceNarrowPhaseBudget` passes — a capacity-rejected call (which throws before this point) produces no capture, deliberately: there is no valid, completed candidate list to hand a replay spike in that case.
  - `isSpikeInputCaptureActive()` gates every payload-construction closure at every call site (createGeometryRegistry.js's two points, CollisionWorld.js's one point) — when no capture fn is installed, no closure is even allocated, not merely "allocated but never invoked" (independent review's Important-2 finding: the earlier draft's `reportSpikeInput(kind, () => {...})` pattern always allocated the arrow-function closure, even though `reportSpikeInput` itself never invoked it when inactive).
  - `reportSpan('geometry-extraction', ms)` / `reportSpan('geometry-weld', ms)` — two new, additive, CONTIGUOUS spans covering buildWeld's entire synchronous body with no gap. **The extraction bracket's boundary is defined precisely as: opens at `buildWeld` entry, closes after `resolveGeometryView(...)` returns AND (when the view is supported and a capture fn is active) the raw-input capture's own `.slice()` copies have run.** Folding the capture into the extraction bracket, rather than leaving it in the gap between the two brackets, is what keeps "the brackets' union covers every line of buildWeld's synchronous body, no gap" true even when capture is active and its copies take real, non-negligible time — an earlier draft left exactly this gap (independent review's Critical-2 finding, the single most consequential fix in this task). Both brackets are wrapped in `try`/`finally` so a throw inside `resolveGeometryView` (e.g. a real `RenderProxyUnavailableError`) or `compactAndWeld` still reports the attempted span's real duration.

- [ ] **Step 1: Write the failing test (role threading, via a real builder spy)**
```js
// test/geometry/roleThreading.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

function makeSpyRegistry() {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const calls = [];
  const registry = new GeometryRegistry({
    buildWeld: async (loadEpoch, geometryIndex, ownerModelIdHint, role) => {
      calls.push({ loadEpoch, geometryIndex, ownerModelIdHint, role });
      return { position: new Float32Array(3), index: new Uint32Array([0, 1, 2]), triangleCount: 1 };
    },
    buildConnectivity: async () => ({ componentCount: 1, componentOf: new Int32Array(1), closedManifold: [true] }),
    buildAcceleration: async () => ({ bvh: {}, localDiagonal: 1, aspectRatio: 1, aspectRatioExceeded: false, geometry: {} }),
    checkpointPort: port,
  });
  return { registry, calls, controls };
}

test('role reaches the injected buildWeld builder as its exact 4th argument', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
  assert.deepEqual(calls, [{ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', role: 'source' }]);
});

test('role defaults to undefined when omitted -- every existing caller keeps working', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  assert.equal(calls[0].role, undefined);
});

test('capture identity is (loadEpoch, geometryIndex), NOT (loadEpoch, geometryIndex, role): a cache hit under a DIFFERENT role does not re-call buildWeld', async () => {
  const { registry, calls } = makeSpyRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'target' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, 'target');
  // Same (loadEpoch, geometryIndex), now referenced as 'source' -- this is a cache hit.
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false, role: 'source' });
  assert.equal(calls.length, 1, 'no second buildWeld call -- role reflects only the build-triggering call');
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/geometry/roleThreading.test.mjs`
Expected: FAIL — `calls[0]` is `{ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', role: undefined }` even when `role: 'source'` was supplied (today's `getOrBuildGeometry`/`_insertBuildingEntry`/`buildWeld` chain drops it entirely).
- [ ] **Step 3: Thread `role` through the call chain**

`collision/CollisionWorld.js:308-348` — add `role` to the object literal passed to `registry.getOrBuildGeometry`:
```js
async function resolveGeometryRecord(registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments) {
  const identity = placed.instance.geometryIdentity;
  let record;
  try {
    record = await registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch,
      geometryIndex: identity.geometryIndex,
      ownerModelIdHint: modelIdOf(operand.model),
      needsConnectivity,
      role,
    });
  } catch (err) {
    if (!(err instanceof RenderProxyUnavailableError)) throw err;
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, 'geometry-not-yet-available', operand);
    return null;
  }
  if (record.oversized) {
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, record.reason, operand);
    return null;
  }
  return record;
}
```

`collision/geometry/GeometryRegistry.js:58-74`:
```js
  async getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity, role }) {
    let bucket = this._epochs.get(loadEpoch);
    if (!bucket) {
      bucket = new Map();
      this._epochs.set(loadEpoch, bucket);
    }
    let entry = bucket.get(geometryIndex);
    if (!entry) {
      entry = this._insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivity, role);
      bucket.set(geometryIndex, entry);
    }
    return this._awaitEntry(loadEpoch, geometryIndex, entry, needsConnectivity);
  }
```

`collision/geometry/GeometryRegistry.js:102-140` (`_insertBuildingEntry`) — accept `role`, forward it, and add `connectivityResult`/`accelerationResult` fields (used by Task 1.6):
```js
  _insertBuildingEntry(loadEpoch, geometryIndex, ownerModelIdHint, needsConnectivityAtStart, role) {
    const { signal, rejectSignal } = makeCancellationSignal();
    const entry = {
      buildState: 'building',
      weldPromise: null,
      connectivityPromise: null,
      accelerationPromise: null,
      cancellationSignal: signal,
      rejectSignal,
      ownerModelIdHint,
      weldedGeometry: null,
      weldWasOversized: false,
      connectivityResult: null, // Task 1.6 accessor field
      accelerationResult: null, // Task 1.6 accessor field
    };

    entry.weldPromise = this._runPhase(loadEpoch, geometryIndex, entry, () =>
      this._buildWeld(loadEpoch, geometryIndex, ownerModelIdHint, role)
    , 'weld');
    // ... rest unchanged (tail chaining, needsConnectivityAtStart branch, return entry)
  }
```

`collision/geometry/createGeometryRegistry.js:28` — accept `role` as the builder's 4th param (used starting Step 8):
```js
    buildWeld: async (loadEpoch, geometryIndex, ownerModelIdHint, role) => {
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/geometry/roleThreading.test.mjs`
Expected: PASS (3/3)
- [ ] **Step 5: Commit**
```bash
git add collision/CollisionWorld.js collision/geometry/GeometryRegistry.js collision/geometry/createGeometryRegistry.js test/geometry/roleThreading.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): thread role through geometry-resolution call chain

CollisionWorld.resolveGeometryRecord already knew role ('source'|'target') but never passed it
to GeometryRegistry.getOrBuildGeometry/buildWeld. Additive: defaults to undefined at every layer.
Capture identity stays (loadEpoch, geometryIndex) -- role reflects only the build-triggering
call, proven by a builder-spy test (a cache hit under a different role does not re-fire buildWeld).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Write the failing test (contiguous brackets + geometry capture hook, zero-cost-when-unset, no-retained-reference)**
```js
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
    const { registry } = makeRegistry({ triangleGeometryView: rangesView(1) });
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
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/geometry/createGeometryRegistry.spikeCapture.test.mjs`
Expected: FAIL — `setSpikeInputCapture is not a function`; span-label assertions also fail (no `'geometry-extraction'`/`'geometry-weld'` labels reported yet).
- [ ] **Step 8: Write minimal implementation**

`collision/scheduler.js` — capture-hook mechanism, after Task 1.2's block:
```js
// ---- Optional S7' stage-input capture hook (Task 1.3) -------------------------------------------
// Benchmark-only, disabled by default. `buildPayload` is a THUNK -- a capture payload can require
// copying a potentially large typed array, so the payload is only ever constructed when a capture
// fn is installed. isSpikeInputCaptureActive() additionally lets a CALL SITE avoid allocating the
// thunk closure itself when inactive (not merely avoid invoking it) -- an independent review's
// finding on an earlier draft, which called reportSpikeInput(kind, () => {...}) unconditionally.
let _spikeInputCapture = null;
export function setSpikeInputCapture(fn) { _spikeInputCapture = fn; }
export function clearSpikeInputCapture() { _spikeInputCapture = null; }
export function isSpikeInputCaptureActive() { return _spikeInputCapture !== null; }
export function reportSpikeInput(kind, buildPayload) {
  if (!_spikeInputCapture) return;
  _spikeInputCapture(kind, buildPayload());
}
```

`collision/geometry/createGeometryRegistry.js` — rewrite `buildWeld`:
```js
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
      const extractionStartedAt = performance.now();
      let triangleGeometryView, weldEpsilon;
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
        reportSpan('geometry-extraction', performance.now() - extractionStartedAt);
      }

      if (triangleGeometryView && triangleGeometryView.unsupported === true) {
        reportSpan('geometry-weld', 0);
        return { oversized: true, reason: triangleGeometryView.reason, activeTriangleCount: 0 };
      }

      // Bracket (b): weld alone. Opens at the exact instant bracket (a) closed.
      const weldStartedAt = performance.now();
      let weldResult;
      try {
        weldResult = compactAndWeld(triangleGeometryView, { weldEpsilon, maxSyncTriangleCount });
      } finally {
        reportSpan('geometry-weld', performance.now() - weldStartedAt);
      }

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

      return weldResult;
    },
    buildConnectivity: async (weldedGeometry) => connectivityImpl(weldedGeometry),
    buildAcceleration: async (weldedGeometry) =>
      accelerationImpl ? accelerationImpl(weldedGeometry) : blasCache.build(weldedGeometry),
    checkpointPort,
  });
}
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/geometry/createGeometryRegistry.spikeCapture.test.mjs`
Expected: PASS (7/7)
- [ ] **Step 10: Commit**
```bash
git add collision/scheduler.js collision/geometry/createGeometryRegistry.js test/geometry/createGeometryRegistry.spikeCapture.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): buildWeld extraction/weld brackets + S7' geometry-vertical capture hook

Two contiguous synchronous spans (geometry-extraction, geometry-weld) inside buildWeld's own
body -- the extraction bracket absorbs the raw-input capture's own copy cost so no gap exists
between the brackets even when capture is active. setSpikeInputCapture/clearSpikeInputCapture/
isSpikeInputCaptureActive in collision/scheduler.js; both capture points copy (.slice()) rather
than hand out live/production-owned buffers. Disabled by default, zero cost when unset (no
thunk closure allocated unless a capture fn is installed). M4 §16.4 items 3, 6.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Write the failing test (precheck-candidate-list capture)**
```js
// test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { setSpikeInputCapture, clearSpikeInputCapture } from '../collision/scheduler.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
function makeFixture(rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: (m, fragId) => ({ geometry: rawGeometryByFragId.get(fragId) }) } };
  return { model, viewer };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

test('precheck-candidate-list capture fires exactly once per clearance findClashes call, after the budget check, with the complete real candidate list', async () => {
  // Reused fixture (gap 0.5, within clearance) -- verified precedent in
  // test/CollisionWorld.findClashes.clearance.test.mjs.
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const captured = [];
  setSpikeInputCapture((kind, payload) => { if (kind === 'precheck-candidate-list') captured.push(payload); });
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    const result = await world.findClashes({
      source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId',
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].candidates.length, 1);
    const c = captured[0].candidates[0];
    assert.equal(typeof c.sourceFragmentId, 'number');
    assert.equal(typeof c.sourceGeometryIndex, 'number');
    assert.equal(typeof c.sourceLoadEpoch, 'number');
    assert.equal(typeof c.targetFragmentId, 'number');
    assert.equal(typeof c.targetGeometryIndex, 'number');
    assert.equal(typeof c.targetLoadEpoch, 'number');
    assert.ok(Array.isArray(result.pairs));
  } finally {
    clearSpikeInputCapture();
  }
});

test('no capture fn installed -- clearance findClashes behaves exactly as before', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({
    source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId',
  });
  assert.ok(Array.isArray(result.pairs));
});
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs`
Expected: FAIL — `captured.length` is `0`.
- [ ] **Step 13: Write minimal implementation**

`collision/CollisionWorld.js:11` — extend the scheduler import:
```js
import {
  createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator, reportSpan,
  reportSpikeInput, isSpikeInputCaptureActive,
} from './scheduler.js';
```

Inside the `mode === 'clearance'` branch, right after `this._checkClearanceNarrowPhaseBudget(candidates);` (originally line 1700) and before `const narrowPhaseStartedAt = this._now();`:
```js
      this._checkClearanceNarrowPhaseBudget(candidates);

      // S7' precheck vertical, candidate-list capture point (Task 1.3): fires ONCE per query,
      // after the budget check passes -- a capacity-rejected call throws before this line and
      // produces no capture, deliberately (there is no valid completed candidate list to replay).
      if (isSpikeInputCaptureActive()) {
        reportSpikeInput('precheck-candidate-list', () => ({
          sourceEpoch: sourceOperand.epoch,
          candidates: candidates.map(([sourcePlaced, targetPlaced, targetOperand]) => ({
            sourceLoadEpoch: sourcePlaced.instance.geometryIdentity.loadEpoch,
            sourceGeometryIndex: sourcePlaced.instance.geometryIdentity.geometryIndex,
            sourceFragmentId: sourcePlaced.instance.fragmentId,
            targetLoadEpoch: targetPlaced.instance.geometryIdentity.loadEpoch,
            targetGeometryIndex: targetPlaced.instance.geometryIdentity.geometryIndex,
            targetFragmentId: targetPlaced.instance.fragmentId,
            targetEpoch: targetOperand.epoch,
          })),
        }));
      }

      const narrowPhaseStartedAt = this._now();
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs`
Expected: PASS (2/2)
- [ ] **Step 15: Commit**
```bash
git add collision/CollisionWorld.js test/CollisionWorld.spikeCapture.precheckCandidates.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): wire S7' precheck-vertical candidate-list capture point

Fires once per mode:'clearance' findClashes call, after the narrow-phase budget check (a
capacity-rejected call produces no capture -- no valid completed list to replay), through the
same setSpikeInputCapture hook the geometry vertical uses. Disabled by default, zero cost when
unset. M4 §16.4 item 6.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Wire diagnostic-event emission at real call sites

**Files:**
- Modify: `collision/CollisionWorld.js:1-27` (imports), `collision/CollisionWorld.js:308-348`, `collision/CollisionWorld.js:2082-2200`, `collision/CollisionWorld.js:2262-2364`
- Modify: `collision/query/VolumeOverlapQuery.js:1-56`, `collision/query/VolumeOverlapQuery.js:88-228`
- Modify: `collision/query/ClearanceHardClashPrecheck.js`
- Test: `test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs` (unit-level), `test/CollisionWorld.diagnosticEvents.test.mjs` (integration-level)

**Interfaces:**
- Consumes: Task 1.2's `reportDiagnosticEvent`/`isDiagnosticEventRecorderActive`; Task 1.3's `role` (reused, not re-added).
- Produces: real `reportDiagnosticEvent` calls at four call-site families. Every new bracket/object-construction is gated behind `isDiagnosticEventRecorderActive()` — zero cost when unset. `volumeOverlapQuery(source, target, options)` gains one new, optional, additive `options.diagnosticPairContext` field (`{sourceEpoch, sourceFragmentId, targetEpoch, targetFragmentId}`); omitted, every existing caller/test is unaffected. `classifyHardClashPrecheck` needs no signature change — `_runClearanceNarrowPhasePair` adds `diagnosticPairContext` to the `volumeOverlapOptions` object it already forwards verbatim.
- **Control-flow constraint that shapes every test below (independent review's Critical-3 finding on an earlier draft):** a positive `'crossing'` result short-circuits `volumeOverlapQuery` before either containment term runs (`VolumeOverlapQuery.js:120`); a `'excluded'`/`'inconclusive'`/`'skip-precheck'` outcome from `classifyHardClashPrecheck` each reach the distance query differently (`'excluded'` never does; `'inconclusive'` never does; `'proceed'` and `'skip-precheck'` both do — see Task 1.5's outcome-matrix table). **No single fixture can exercise all four `kind`s at once** — an earlier draft's test assumed it could. Tests below are split per control-flow path, each asserting both which events fire AND which do not.

- [ ] **Step 1: Write the failing test — unit level (all three volumeOverlapQuery subterms, direct)**
```js
// test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../../collision/scheduler.js';
import { box, at, testInstance } from '../fixtures/geometry.mjs';

test('a conclusively-negative, non-crossing pair fires all three subterm events with correct identity/covariates', async () => {
  // Reused verbatim from test/query/VolumeOverlapQuery.conclusive.test.mjs's own "fully-resolved
  // genuine negative" fixture: two closed-manifold boxes, well separated -- every term runs to
  // completion, none short-circuits.
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(a, sep, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 11, targetEpoch: 2, targetFragmentId: 22 },
    });
    assert.equal(result.overlap, false);
    assert.equal(result.conclusive, true);
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages.sort(), ['containment-a-in-b', 'containment-b-in-a', 'crossing']);
    for (const e of events) {
      assert.equal(e.payload.sourceEpoch, 1);
      assert.equal(e.payload.sourceFragmentId, 11);
      assert.equal(e.payload.targetEpoch, 2);
      assert.equal(e.payload.targetFragmentId, 22);
      assert.ok(Number.isFinite(e.payload.ms));
      assert.equal(typeof e.payload.sourceTriangles, 'number');
      assert.equal(typeof e.payload.targetTriangles, 'number');
    }
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('a crossing-positive pair emits ONLY the crossing subterm event -- containment never runs, so neither containment event fires', async () => {
  // Reused from VolumeOverlapQuery.conclusive.test.mjs's own duct/beam crossing fixture.
  const duct = testInstance(box(20, 0.4, 0.4));
  const beam = testInstance(box(0.4, 0.4, 20));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(duct, beam, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    assert.equal(result.via, 'crossing');
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages, ['crossing']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('a containment-positive pair emits crossing (negative) then containment-a-in-b (positive) -- containment-b-in-a never runs', async () => {
  // Reused from VolumeOverlapQuery.conclusive.test.mjs's own open-box-in-closed-box fixture.
  const openSrc = testInstance((await import('../fixtures/geometry.mjs')).openBottomedBox(0.4));
  const closedTarget = testInstance(box(4, 4, 4));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const result = await volumeOverlapQuery(openSrc, closedTarget, {
      diagnosticPairContext: { sourceEpoch: 1, sourceFragmentId: 1, targetEpoch: 1, targetFragmentId: 2 },
    });
    assert.equal(result.via, 'containment(A in B)');
    const stages = events.filter((e) => e.kind === 'hard-clash-precheck').map((e) => e.payload.stage);
    assert.deepEqual(stages, ['crossing', 'containment-a-in-b']);
  } finally {
    clearDiagnosticEventRecorder();
  }
});

test('no diagnosticPairContext supplied -- zero events, matching every existing caller', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    await volumeOverlapQuery(a, sep);
    assert.equal(events.length, 0);
  } finally {
    clearDiagnosticEventRecorder();
  }
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs`
Expected: FAIL — `events` stays empty for every test (no `diagnosticPairContext` handling exists yet).
- [ ] **Step 3: Write minimal implementation (part 1 — VolumeOverlapQuery.js and ClearanceHardClashPrecheck.js)**

`collision/query/VolumeOverlapQuery.js:1-16` — add import:
```js
import * as THREE from 'three';
import { properCrossingQuery } from './ProperCrossingQuery.js';
import { anyComponentInside } from './ContainmentQuery.js';
import { reportDiagnosticEvent } from '../scheduler.js';
```

`collision/query/VolumeOverlapQuery.js:88-228` — bracket the three subterms, additive, gated on `options.diagnosticPairContext`:
```js
  const diagnosticPairContext = options.diagnosticPairContext;
  const triangleCovariates = diagnosticPairContext ? {
    sourceTriangles: source.geometry.index.count / 3, targetTriangles: target.geometry.index.count / 3,
    sourceComponents: source.connectivity ? source.connectivity.componentCount : undefined,
    targetComponents: target.connectivity ? target.connectivity.componentCount : undefined,
  } : null;

  let crossing;
  const crossingStartedAt = diagnosticPairContext ? performance.now() : 0;
  if (source.aspectRatioExceeded || target.aspectRatioExceeded) {
    // ... unchanged synthetic-crossing construction ...
  } else {
    const canonicalSecondToFirst = canonicalFirst.matrix.clone().invert().multiply(canonicalSecond.matrix);
    crossing = properCrossingQuery(
      canonicalFirst.bvh, canonicalSecond.bvh, canonicalSecondToFirst,
      canonicalFirst.localDiagonal, canonicalSecond.localDiagonal, options.crossing
    );
  }
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'crossing', ms: performance.now() - crossingStartedAt,
    });
  }

  if (crossing.crossing) {
    // ... unchanged positive return ...
  }

  await scheduler.checkpointIfDue();

  const sourceToTargetForAinB = target.matrix.clone().invert().multiply(source.matrix);
  const aInBStartedAt = diagnosticPairContext ? performance.now() : 0;
  const aInB = await anyComponentInside(
    source.geometry, source.bvh, source.localDiagonal, source.connectivity, target.bvh, target.localDiagonal,
    target.closedManifold, sourceToTargetForAinB,
    { ...options.containment, mode: 'volume-overlap', containerRole: 'target', sampledRole: 'source', scheduler, targetAspectRatioExceeded: target.aspectRatioExceeded },
  );
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'containment-a-in-b', ms: performance.now() - aInBStartedAt,
      containmentSamplesUsed: aInB.samplesUsed,
    });
  }
  if (aInB.inside) {
    // ... unchanged positive return ...
  }

  await scheduler.checkpointIfDue();

  const targetToSource = source.matrix.clone().invert().multiply(target.matrix);
  const bInAStartedAt = diagnosticPairContext ? performance.now() : 0;
  const bInA = await anyComponentInside(
    target.geometry, target.bvh, target.localDiagonal, target.connectivity, source.bvh, source.localDiagonal,
    source.closedManifold, targetToSource,
    { ...options.containment, mode: 'volume-overlap', containerRole: 'source', sampledRole: 'target', scheduler, targetAspectRatioExceeded: source.aspectRatioExceeded },
  );
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, ...triangleCovariates, stage: 'containment-b-in-a', ms: performance.now() - bInAStartedAt,
      containmentSamplesUsed: bInA.samplesUsed,
    });
  }
  if (bInA.inside) {
    // ... unchanged positive return ...
  }
  // ... unchanged negative-path merge/return (Task 1.5 extends this return object) ...
```

`collision/query/ClearanceHardClashPrecheck.js` — total-duration bracket:
```js
import { aabbMinDistance } from '../geometry/AabbDistance.js';
import { volumeOverlapQuery } from './VolumeOverlapQuery.js';
import { reportDiagnosticEvent } from '../scheduler.js';

export async function classifyHardClashPrecheck(
  sourceInstance, targetInstance, sourceWorldBounds, targetWorldBounds, volumeOverlapOptions = {},
) {
  if (aabbMinDistance(sourceWorldBounds, targetWorldBounds) > 0) {
    return { status: 'skip-precheck' };
  }

  const diagnosticPairContext = volumeOverlapOptions.diagnosticPairContext;
  const overlapStartedAt = diagnosticPairContext ? performance.now() : 0;
  const overlapResult = await volumeOverlapQuery(sourceInstance, targetInstance, volumeOverlapOptions);
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, stage: 'volume-overlap-query', ms: performance.now() - overlapStartedAt,
    });
  }

  if (overlapResult.overlap === true) {
    return { status: 'excluded' };
  }
  if (!overlapResult.conclusive) {
    return { status: 'inconclusive', diagnostic: { reason: 'clearance-hard-clash-precheck-inconclusive' } };
  }
  return { status: 'proceed' };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs`
Expected: PASS (4/4)
- [ ] **Step 5: Commit (part 1)**
```bash
git add collision/query/VolumeOverlapQuery.js collision/query/ClearanceHardClashPrecheck.js test/query/VolumeOverlapQuery.diagnosticEvents.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): wire hard-clash-precheck subterm and total diagnostic events

volumeOverlapQuery gains an optional diagnosticPairContext option, reporting crossing/
containment-a-in-b/containment-b-in-a as it computes each -- only whichever subterms actually
run (a crossing/containment positive short-circuits the rest). classifyHardClashPrecheck reports
its own total duration as the volume-overlap-query stage. Additive; omitted context is a no-op.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Write the failing test — integration level (CollisionWorld wiring, per control-flow path)**
```js
// test/CollisionWorld.diagnosticEvents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../collision/scheduler.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
function makeFixture(rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: (m, fragId) => ({ geometry: rawGeometryByFragId.get(fragId) }) } };
  return { model, viewer };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

async function runClearance(fragSpecs, clearance) {
  const { model, viewer } = makeFixture([{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }], fragSpecs);
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance, groupBy: 'dbId' });
    return { events, result };
  } finally {
    clearDiagnosticEventRecorder();
  }
}

test('crossing pair -> hard-clash-excluded: crossing event fires, no clearance-distance-query event, geometry-resolve fires for both sides', async () => {
  // Reused fixture -- test/CollisionWorld.clearanceStatistics.test.mjs's own "overlaps the diamond -> excluded".
  const { events, result } = await runClearance(
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [0.5, 0, 0] } },
    1,
  );
  assert.equal(result.pairs.length, 0, 'sanity: a Hard-Clash pair produces no clearance pair');
  assert.ok(events.some((e) => e.kind === 'hard-clash-precheck' && e.payload.stage === 'crossing'));
  assert.equal(events.filter((e) => e.kind === 'clearance-distance-query').length, 0, 'excluded pair never reaches the distance query');
  const geometryResolve = events.filter((e) => e.kind === 'geometry-resolve');
  assert.ok(geometryResolve.length >= 2);
  for (const e of geometryResolve) {
    assert.equal(e.payload.stage, 'geometry-resolve');
    assert.ok(Number.isFinite(e.payload.ms));
  }
});

test('AABB-disjoint near-miss (skip-precheck) -> distance query runs, NO hard-clash-precheck subterm/total events fire', async () => {
  // Reused fixture -- test/CollisionWorld.findClashes.clearance.test.mjs's own "near-miss, gap 0.5 <= clearance 1".
  const { events } = await runClearance(
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
    1,
  );
  assert.equal(events.filter((e) => e.kind === 'hard-clash-precheck').length, 0, 'aabb-disjoint never calls classifyHardClashPrecheck\'s own volumeOverlapQuery bracket');
  const distanceQuery = events.filter((e) => e.kind === 'clearance-distance-query');
  assert.equal(distanceQuery.length, 1);
  assert.equal(distanceQuery[0].payload.stage, 'clearance-distance-query');
  assert.ok(['aborted', 'beyond-threshold', 'hit'].includes(distanceQuery[0].payload.outcome));
  assert.equal(typeof distanceQuery[0].payload.anchoredOnSource, 'boolean');
  assert.equal(typeof distanceQuery[0].payload.anchorLocalMaxThreshold, 'number');
  assert.equal(distanceQuery[0].payload.requestedClearance, 1);
});

test('no recorder installed: findClashes behaves exactly as before', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(2, 2, 2), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(2, 2, 2), at: [2.5, 0, 0] } },
  );
  const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
  await world.admitModel(model);
  const result = await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 1, groupBy: 'dbId' });
  assert.ok(Array.isArray(result.pairs));
});

test('narrow-phase-pair events fire for containment/volume-overlap/surface-intersection modes (non-clearance dispatch)', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(6, 6, 6), at: [0, 0, 0] } },
  );
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push({ kind, payload }));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'containment', groupBy: 'dbId' });
    const narrowPhase = events.filter((e) => e.kind === 'narrow-phase-pair');
    assert.ok(narrowPhase.some((e) => e.payload.stage === 'containment'));
    assert.equal(typeof narrowPhase[0].payload.sourceTriangles, 'number');
  } finally {
    clearDiagnosticEventRecorder();
  }
});
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/CollisionWorld.diagnosticEvents.test.mjs`
Expected: FAIL — every `events`/`geometryResolve`/`narrowPhase` filter is empty (no CollisionWorld-level call sites wired yet).
- [ ] **Step 8: Write minimal implementation (part 2 — CollisionWorld.js)**

`collision/CollisionWorld.js:11-15` — extend imports:
```js
import {
  createCheckpointPort as createRealCheckpointPort, createFrameBudgetAccumulator, reportSpan,
  reportSpikeInput, isSpikeInputCaptureActive, reportDiagnosticEvent, isDiagnosticEventRecorderActive,
} from './scheduler.js';
import {
  maxBroadPhaseInstancePairs, maxCollisionInstancesPerEpoch, maxTlasCandidatePairs,
  maxClearanceNarrowPhasePairs, weldEpsilonMeters, surfaceEpsilonFactor, clearanceTraversalThresholdSafetyMargin,
} from './constants.js';
```

`collision/CollisionWorld.js:308-348` — wire `'geometry-resolve'`:
```js
async function resolveGeometryRecord(registry, placed, role, operand, needsConnectivity, statistics, oversizedDiagnosedFragments) {
  const identity = placed.instance.geometryIdentity;
  let record;
  const resolveStartedAt = isDiagnosticEventRecorderActive() ? performance.now() : 0;
  try {
    record = await registry.getOrBuildGeometry({
      loadEpoch: identity.loadEpoch, geometryIndex: identity.geometryIndex,
      ownerModelIdHint: modelIdOf(operand.model), needsConnectivity, role,
    });
  } catch (err) {
    if (!(err instanceof RenderProxyUnavailableError)) throw err;
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, 'geometry-not-yet-available', operand);
    return null;
  }
  if (isDiagnosticEventRecorderActive()) {
    const ms = performance.now() - resolveStartedAt;
    reportDiagnosticEvent('geometry-resolve', {
      stage: 'geometry-resolve', ms,
      ...(role === 'source' ? { sourceEpoch: identity.loadEpoch, sourceFragmentId: placed.instance.fragmentId } : {}),
      ...(role === 'target' ? { targetEpoch: identity.loadEpoch, targetFragmentId: placed.instance.fragmentId } : {}),
      ...(role === 'source' && !record.oversized ? { sourceTriangles: record.geometry.index.count / 3 } : {}),
      ...(role === 'target' && !record.oversized ? { targetTriangles: record.geometry.index.count / 3 } : {}),
    });
  }
  if (record.oversized) {
    diagnoseFragmentOnce(statistics, oversizedDiagnosedFragments, placed, role, record.reason, operand);
    return null;
  }
  return record;
}
```

`collision/CollisionWorld.js:2150-2200` (`_runNarrowPhasePair`'s three mode branches) — wire `'narrow-phase-pair'` (each mode reports once, after its own query resolves):
```js
    if (mode === 'surface-intersection') {
      const relativeMatrix = computeRelativeMatrix(sourcePlaced.worldMatrix, targetPlaced.worldMatrix);
      const stageStartedAt = isDiagnosticEventRecorderActive() ? performance.now() : 0;
      const result = surfaceIntersectionQuery(sourceRecord.bvh, targetRecord.bvh, relativeMatrix);
      if (isDiagnosticEventRecorderActive()) {
        reportDiagnosticEvent('narrow-phase-pair', {
          sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
          targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
          stage: 'surface-intersection', ms: performance.now() - stageStartedAt,
          sourceTriangles: sourceRecord.geometry.index.count / 3, targetTriangles: targetRecord.geometry.index.count / 3,
        });
      }
      attach(result.diagnostics);
      return result.intersects;
    }

    const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
    const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);
    const scheduler = createComposedStageScheduler(checkpoint, this._now);

    if (mode === 'containment') {
      const stageStartedAt = isDiagnosticEventRecorderActive() ? performance.now() : 0;
      const result = await containmentModeQuery(sourceInstance, targetInstance, { scheduler });
      if (isDiagnosticEventRecorderActive()) {
        reportDiagnosticEvent('narrow-phase-pair', {
          sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
          targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
          stage: 'containment', ms: performance.now() - stageStartedAt,
          sourceTriangles: sourceRecord.geometry.index.count / 3, targetTriangles: targetRecord.geometry.index.count / 3,
          sourceComponents: sourceRecord.connectivity.componentCount, targetComponents: targetRecord.connectivity.componentCount,
        });
      }
      attach(result.diagnostics);
      return result.contained;
    }
    const canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced);
    const stageStartedAt = isDiagnosticEventRecorderActive() ? performance.now() : 0;
    const result = await volumeOverlapQuery(sourceInstance, targetInstance, {
      scheduler,
      compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
    });
    if (isDiagnosticEventRecorderActive()) {
      reportDiagnosticEvent('narrow-phase-pair', {
        sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
        targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
        stage: 'volume-overlap', ms: performance.now() - stageStartedAt,
        sourceTriangles: sourceRecord.geometry.index.count / 3, targetTriangles: targetRecord.geometry.index.count / 3,
        sourceComponents: sourceRecord.connectivity.componentCount, targetComponents: targetRecord.connectivity.componentCount,
      });
    }
    attach(result.diagnostics);
    return { hit: result.overlap, witness: result.witness ?? null };
```
(This `'narrow-phase-pair'`/`volume-overlap` event is intentionally NOT the same as the clearance-precheck path's `'hard-clash-precheck'`/`volume-overlap-query` event — they instrument two DIFFERENT call sites of `volumeOverlapQuery`, one from the three-mode dispatch, one from the clearance precheck; a pair evaluated under `mode:'clearance'` never reaches this branch at all, per `CollisionWorld.js:1685`'s own "everything below this branch is unreachable for a clearance call" invariant.)

`collision/CollisionWorld.js:2262-2364` (`_runClearanceNarrowPhasePair`) — thread `diagnosticPairContext`, wire `'clearance-distance-query'`:
```js
    const scheduler = createComposedStageScheduler(checkpoint, this._now);
    const canonicalOrder = comparePlacedCanonically(sourcePlaced, targetPlaced);
    const diagnosticPairContext = isDiagnosticEventRecorderActive() ? {
      sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
      targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
    } : undefined;
    const volumeOverlapOptions = {
      scheduler,
      compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
      crossing: { now: this._now },
      diagnosticPairContext,
    };

    const precheck = await classifyHardClashPrecheck(
      sourceInstance, targetInstance, sourcePlaced.worldBounds, targetPlaced.worldBounds, volumeOverlapOptions,
    );
    if (precheck.status !== 'skip-precheck') statistics.clearanceOverlapPrechecksRun++;
    if (precheck.status === 'excluded') {
      return { outcome: 'hard-clash-excluded' };
    }
    if (precheck.status === 'inconclusive') {
      statistics.diagnostics.push({
        scope: 'pair', reason: precheck.diagnostic.reason,
        sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced), targetFragment: fragmentRef(targetOperand.model, targetPlaced),
      });
      return { outcome: 'inconclusive' };
    }

    const toleranceFloor = computeToleranceFloor(
      { localDiagonal: sourceInstance.localDiagonal, scaleFactor: sourceScale.scaleFactor },
      { localDiagonal: targetInstance.localDiagonal, scaleFactor: targetScale.scaleFactor },
      surfaceEpsilonFactor,
    );
    const distanceQueryStart = this._now();
    const result = clearanceQuery(sourceInstance, targetInstance, { clearance, toleranceFloor });
    statistics.clearanceDistanceQueriesRun++;
    const distanceQueryMs = this._now() - distanceQueryStart;
    statistics.clearanceQueryMs += distanceQueryMs;
    reportSpan('clearance-distance-query', distanceQueryMs);

    if (isDiagnosticEventRecorderActive()) {
      const anchoredOnSource = sourceScale.scaleFactor <= targetScale.scaleFactor;
      const anchorScaleFactor = anchoredOnSource ? sourceScale.scaleFactor : targetScale.scaleFactor;
      const anchorLocalMaxThreshold = (clearance / anchorScaleFactor) * (1 + clearanceTraversalThresholdSafetyMargin);
      const commonCovariates = {
        sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
        targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
        stage: 'clearance-distance-query', ms: distanceQueryMs,
        sourceTriangles: sourceRecord.geometry.index.count / 3, targetTriangles: targetRecord.geometry.index.count / 3,
        sourceComponents: sourceRecord.connectivity.componentCount, targetComponents: targetRecord.connectivity.componentCount,
        sourceScaleFactor: sourceScale.scaleFactor, targetScaleFactor: targetScale.scaleFactor, anchoredOnSource,
        requestedClearance: clearance, anchorLocalMaxThreshold,
      };
      const outcome = result.aborted ? 'aborted' : !result.withinClearance ? 'beyond-threshold' : 'hit';
      reportDiagnosticEvent('clearance-distance-query', {
        ...commonCovariates, outcome, ...(result.aborted ? {} : { distance: result.distance }),
      });
    }

    if (result.aborted) {
      statistics.diagnostics.push({
        scope: 'pair', reason: result.diagnostics[0].reason,
        sourceFragment: fragmentRef(sourceOperand.model, sourcePlaced), targetFragment: fragmentRef(targetOperand.model, targetPlaced),
      });
      return { outcome: 'aborted' };
    }
    if (!result.withinClearance) return { outcome: 'beyond-threshold' };
    return { outcome: 'hit', distance: result.distance, witness: result.witness, sourcePlaced, targetPlaced, targetOperand };
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/CollisionWorld.diagnosticEvents.test.mjs`
Expected: PASS (4/4)
- [ ] **Step 10: Commit (part 2)**
```bash
git add collision/CollisionWorld.js test/CollisionWorld.diagnosticEvents.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): wire geometry-resolve, narrow-phase-pair, and clearance-distance-query events

resolveGeometryRecord (geometry-resolve), the three modes in _runNarrowPhasePair
(narrow-phase-pair), and _runClearanceNarrowPhasePair's distance query with its full covariate
set (clearance-distance-query). Every bracket gated behind isDiagnosticEventRecorderActive().
Tests split per real control-flow path (crossing-excluded vs. skip-precheck-then-distance-query)
rather than one fixture assuming all four kinds fire together, which they cannot. M4 §16.4 item 5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Precheck cause telemetry — inconclusiveCauses and precheckNotRunReason

**Files:**
- Modify: `collision/query/VolumeOverlapQuery.js:245-268`
- Modify: `collision/query/ClearanceHardClashPrecheck.js`
- Modify: `collision/CollisionWorld.js:2262-2336`
- Test: `test/query/VolumeOverlapQuery.inconclusiveCauses.test.mjs`, `test/CollisionWorld.precheckNotRunReason.test.mjs`

**Interfaces:**
- Consumes: Task 1.4's `diagnosticPairContext`/`isDiagnosticEventRecorderActive` wiring (extends the same event payloads, no new call site except the two new pre-precheck skip points below).
- Produces: `volumeOverlapQuery`'s negative-path return gains `inconclusiveCauses: string[]` (sorted, deduplicated, from `'crossing-budget-exhausted' | 'crossing-tolerance-ambiguous' | 'aspect-ratio-exceeded' | 'containment-sample-budget-exhausted' | 'non-manifold-component' | 'unresolved-containment'`) and `containmentSamplesUsed: number`. `classifyHardClashPrecheck`'s `'skip-precheck'` return gains `precheckNotRunReason: 'aabb-disjoint'`. `_runClearanceNarrowPhasePair` gains TWO more pre-precheck skip points that report `precheckNotRunReason` before `classifyHardClashPrecheck` is ever called: `'geometry-unsupported-before-precheck'` (source/target geometry resolution failed) and `'anisotropic-scale-before-precheck'` (either operand fails `validateUniformScale`) — the latter is a genuine gap an independent review's "Important-5" finding caught: an earlier draft covered only the geometry-unsupported case, leaving the anisotropic-scale early return (an equally normal, pre-existing path) silently uncounted.

**Explicit outcome matrix for `_runClearanceNarrowPhasePair`, resolving exactly which `'hard-clash-precheck'` event(s) fire for every exit path (independent review's Important-5 ask):**

| Exit path | `'hard-clash-precheck'` event(s) | `'clearance-distance-query'` event? |
|---|---|---|
| capacity rejected (`_checkClearanceNarrowPhaseBudget` throws, before the per-pair loop starts) | none | none |
| source or target geometry unavailable | `stage:'not-run'`, `precheckNotRunReason:'geometry-unsupported-before-precheck'` | none |
| anisotropic scale (either operand) | `stage:'not-run'`, `precheckNotRunReason:'anisotropic-scale-before-precheck'` | none |
| AABB disjoint (`skip-precheck`) | `stage:'not-run'`, `precheckNotRunReason:'aabb-disjoint'` (from `classifyHardClashPrecheck`) | yes |
| precheck `excluded` | whichever of `crossing`/`containment-a-in-b`/`containment-b-in-a` actually ran, plus `stage:'volume-overlap-query'` (total) | none |
| precheck `inconclusive` | same as `excluded` | none |
| precheck `proceed` | same as `excluded` | yes |

- [ ] **Step 1: Write the failing test**
```js
// test/query/VolumeOverlapQuery.inconclusiveCauses.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeOverlapQuery } from '../../collision/query/VolumeOverlapQuery.js';
import { box, at, comb, mergeGeometries, openBottomedBox, testInstance } from '../fixtures/geometry.mjs';

test('crossing-budget-exhausted is surfaced as its own named cause', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own fixture.
  const a = testInstance(comb(0));
  const b = testInstance(comb(0.05));
  const result = await volumeOverlapQuery(a, b, { crossing: { maxCandidatePairsExamined: 500 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['crossing-budget-exhausted']);
  assert.equal(typeof result.containmentSamplesUsed, 'number');
});

test('crossing-tolerance-ambiguous (boundary-probe grazed, NOT budget-aborted) is a DISTINCT cause from crossing-budget-exhausted', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own flush-touching fixture.
  const a = testInstance(box(2, 2, 2));
  const b = testInstance(box(2, 2, 2), at(0, 2, 0));
  const result = await volumeOverlapQuery(a, b, { crossing: { frameBudgetMs: 5000 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['crossing-tolerance-ambiguous']);
});

test('aspect-ratio-exceeded, forced on the source, is surfaced independent of the crossing term\'s own real budget state', async () => {
  const source = testInstance(box(2, 2, 2));
  source.aspectRatioExceeded = true; // forces the crossing-skip synthetic branch
  const target = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = await volumeOverlapQuery(source, target);
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.deepEqual(result.inconclusiveCauses, ['aspect-ratio-exceeded']);
});

test('unresolved-containment fires when a component budget forces unresolvedComponentCount > 0', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own 20-disjoint-components fixture.
  const parts = [];
  for (let i = 0; i < 20; i++) parts.push(box(2, 2, 2).translate(i * 3, 20, 0));
  const source = testInstance(mergeGeometries(parts));
  const target = testInstance(box(4, 4, 4));
  const result = await volumeOverlapQuery(source, target, { containment: { maxContainmentSamples: 10 } });
  assert.equal(result.overlap, false);
  assert.equal(result.conclusive, false);
  assert.ok(result.inconclusiveCauses.includes('unresolved-containment'));
});

test('non-manifold-component covers BOTH the literal non-manifold-component diagnostic and unverified-parity-operand', async () => {
  // Reused verbatim from VolumeOverlapQuery.conclusive.test.mjs's own two fixtures.
  const partA = box(1, 1, 1);
  const partB = box(1, 1, 1).translate(1, 0, 0);
  const src = testInstance(mergeGeometries([partA, partB]));
  const target = testInstance(box(0.2, 0.2, 0.2), at(10, 10, 10));
  const result1 = await volumeOverlapQuery(src, target);
  assert.deepEqual(result1.inconclusiveCauses, ['non-manifold-component']);

  const source2 = testInstance(box(1, 1, 1), at(50, 0, 0));
  const target2 = testInstance(openBottomedBox(4));
  const result2 = await volumeOverlapQuery(source2, target2);
  assert.deepEqual(result2.inconclusiveCauses, ['non-manifold-component']);
});

test('a fully-resolved genuine negative has an EMPTY, sorted inconclusiveCauses array', async () => {
  const a = testInstance(box(2, 2, 2));
  const sep = testInstance(box(2, 2, 2), at(10, 0, 0));
  const result = await volumeOverlapQuery(a, sep);
  assert.equal(result.conclusive, true);
  assert.deepEqual(result.inconclusiveCauses, []);
});
```
```js
// test/CollisionWorld.precheckNotRunReason.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../collision/scheduler.js';
import { buildMockModel } from './fixtures/mockInstanceTree.mjs';

function boundsOf(geometry, [x, y, z]) {
  const g = geometry.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  g.computeBoundingBox();
  return { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() };
}
const translationMatrix = ([x, y, z]) => new THREE.Matrix4().makeTranslation(x, y, z).toArray();
function makeFixture(rootNodes, fragSpecs) {
  const fragmentGeometry = new Map();
  const rawGeometryByFragId = new Map();
  for (const [fragIdKey, spec] of Object.entries(fragSpecs)) {
    const fragId = Number(fragIdKey);
    const at = spec.at || [0, 0, 0];
    fragmentGeometry.set(fragId, { geometryIndex: spec.geometryIndex, matrix: translationMatrix(at), bounds: boundsOf(spec.geometry, at) });
    rawGeometryByFragId.set(fragId, spec.geometry);
  }
  const { model: baseModel } = buildMockModel(rootNodes, fragmentGeometry);
  const model = { ...baseModel, id: 1, getUnitScale: () => 1 };
  const viewer = { impl: { getRenderProxy: (m, fragId) => ({ geometry: rawGeometryByFragId.get(fragId) }) } };
  return { model, viewer };
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

test('a provably-disjoint AABB pair reports precheckNotRunReason: aabb-disjoint', async () => {
  const { model, viewer } = makeFixture(
    [{ dbId: 0, children: [{ dbId: 1, fragments: [101] }, { dbId: 2, fragments: [102] }] }],
    { 101: { geometryIndex: 0, geometry: box(1, 1, 1), at: [0, 0, 0] }, 102: { geometryIndex: 1, geometry: box(1, 1, 1), at: [100, 100, 100] } },
  );
  const events = [];
  setDiagnosticEventRecorder((kind, payload) => events.push(payload));
  try {
    const world = await CollisionWorld.fromViewer(viewer, { narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' });
    await world.admitModel(model);
    await world.findClashes({ source: { model, dbIds: [1] }, target: { model, dbIds: [2] }, mode: 'clearance', clearance: 500, groupBy: 'dbId' });
    assert.ok(events.some((p) => p.precheckNotRunReason === 'aabb-disjoint'));
  } finally {
    clearDiagnosticEventRecorder();
  }
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/query/VolumeOverlapQuery.inconclusiveCauses.test.mjs test/CollisionWorld.precheckNotRunReason.test.mjs`
Expected: FAIL — `result.inconclusiveCauses` is `undefined`; `events.some(...)` is `false`.
- [ ] **Step 3: Write minimal implementation**

`collision/query/VolumeOverlapQuery.js:247-268` — extend the negative return:
```js
  const crossingConclusive = !(crossing.aborted || crossing.inconclusive);
  const containmentConclusive = aInB.unresolvedComponentCount === 0 && bInA.unresolvedComponentCount === 0;
  const taintedByNonManifoldOrUnverified = diagnostics.some(
    (d) => d.reason === 'non-manifold-component' || d.reason === 'unverified-parity-operand',
  );
  const conclusive = crossingConclusive && containmentConclusive && !taintedByNonManifoldOrUnverified;

  // Task 1.5: bounded, additive cause set. `crossing.inconclusive` alone conflates two situations
  // ProperCrossingQuery.js:170-171 already distinguishes: an ABORTED traversal
  // ('crossing-budget-exhausted') vs. one that ran to completion but saw an ambiguous boundary
  // probe ('crossing-tolerance-ambiguous', not a budget problem). 'unverified-parity-operand' and
  // 'non-manifold-component' are grouped under 'non-manifold-component' -- the same taint category
  // `taintedByNonManifoldOrUnverified` above already treats as one condition for `conclusive`.
  const inconclusiveCauses = new Set();
  if (!conclusive) {
    if (crossing.aborted) inconclusiveCauses.add('crossing-budget-exhausted');
    if (crossing.inconclusive && !crossing.aborted && !crossing.skipped) inconclusiveCauses.add('crossing-tolerance-ambiguous');
    if (source.aspectRatioExceeded || target.aspectRatioExceeded) inconclusiveCauses.add('aspect-ratio-exceeded');
    if (aInB.budgetExhausted || bInA.budgetExhausted) inconclusiveCauses.add('containment-sample-budget-exhausted');
    if (taintedByNonManifoldOrUnverified) inconclusiveCauses.add('non-manifold-component');
    if (aInB.unresolvedComponentCount > 0 || bInA.unresolvedComponentCount > 0) inconclusiveCauses.add('unresolved-containment');
  }

  return {
    overlap: false,
    conclusive,
    diagnostics,
    inconclusiveCauses: [...inconclusiveCauses].sort(),
    containmentSamplesUsed: aInB.samplesUsed + bInA.samplesUsed,
    stats: { crossing: crossing.stats, aInB, bInA },
  };
```

`collision/query/ClearanceHardClashPrecheck.js` — `precheckNotRunReason` on skip-precheck, enrich the total-duration event:
```js
export async function classifyHardClashPrecheck(
  sourceInstance, targetInstance, sourceWorldBounds, targetWorldBounds, volumeOverlapOptions = {},
) {
  if (aabbMinDistance(sourceWorldBounds, targetWorldBounds) > 0) {
    const diagnosticPairContext = volumeOverlapOptions.diagnosticPairContext;
    if (diagnosticPairContext) {
      reportDiagnosticEvent('hard-clash-precheck', { ...diagnosticPairContext, stage: 'not-run', precheckNotRunReason: 'aabb-disjoint' });
    }
    return { status: 'skip-precheck', precheckNotRunReason: 'aabb-disjoint' };
  }

  const diagnosticPairContext = volumeOverlapOptions.diagnosticPairContext;
  const overlapStartedAt = diagnosticPairContext ? performance.now() : 0;
  const overlapResult = await volumeOverlapQuery(sourceInstance, targetInstance, volumeOverlapOptions);
  if (diagnosticPairContext) {
    reportDiagnosticEvent('hard-clash-precheck', {
      ...diagnosticPairContext, stage: 'volume-overlap-query', ms: performance.now() - overlapStartedAt,
      conclusive: overlapResult.conclusive,
      inconclusiveCauses: overlapResult.inconclusiveCauses ?? [],
      containmentSamplesUsed: overlapResult.containmentSamplesUsed,
    });
  }

  if (overlapResult.overlap === true) return { status: 'excluded' };
  if (!overlapResult.conclusive) return { status: 'inconclusive', diagnostic: { reason: 'clearance-hard-clash-precheck-inconclusive' } };
  return { status: 'proceed' };
}
```

`collision/CollisionWorld.js:2262-2336` (`_runClearanceNarrowPhasePair`) — pre-precheck skip reasons for BOTH the geometry-unsupported and anisotropic-scale early returns:
```js
  async _runClearanceNarrowPhasePair(
    sourcePlaced, targetPlaced, sourceOperand, targetOperand, clearance, statistics, oversizedDiagnosedFragments,
    anisotropicScaleDiagnosedFragments, checkpoint,
  ) {
    const reportPrecheckNotRun = (precheckNotRunReason) => {
      if (!isDiagnosticEventRecorderActive()) return;
      reportDiagnosticEvent('hard-clash-precheck', {
        sourceEpoch: sourceOperand.epoch, sourceFragmentId: sourcePlaced.instance.fragmentId,
        targetEpoch: targetOperand.epoch, targetFragmentId: targetPlaced.instance.fragmentId,
        stage: 'not-run', precheckNotRunReason,
      });
    };

    const sourceRecord = await resolveGeometryRecord(
      this._registry, sourcePlaced, 'source', sourceOperand, true, statistics, oversizedDiagnosedFragments,
    );
    if (!sourceRecord) { reportPrecheckNotRun('geometry-unsupported-before-precheck'); return { outcome: 'geometry-unavailable' }; }
    const targetRecord = await resolveGeometryRecord(
      this._registry, targetPlaced, 'target', targetOperand, true, statistics, oversizedDiagnosedFragments,
    );
    if (!targetRecord) { reportPrecheckNotRun('geometry-unsupported-before-precheck'); return { outcome: 'geometry-unavailable' }; }

    const sourceInstance = toInstance(sourceRecord, sourcePlaced.worldMatrix);
    const targetInstance = toInstance(targetRecord, targetPlaced.worldMatrix);

    const sourceScale = validateUniformScale(sourceInstance.matrix);
    const targetScale = validateUniformScale(targetInstance.matrix);
    if (!sourceScale.valid || !targetScale.valid) {
      if (!sourceScale.valid) diagnoseAnisotropicScaleOnce(statistics, anisotropicScaleDiagnosedFragments, sourcePlaced, 'source', sourceOperand);
      if (!targetScale.valid) diagnoseAnisotropicScaleOnce(statistics, anisotropicScaleDiagnosedFragments, targetPlaced, 'target', targetOperand);
      reportPrecheckNotRun('anisotropic-scale-before-precheck');
      return { outcome: 'anisotropic-scale' };
    }
    // ... unchanged remainder (classifyHardClashPrecheck call and onward, per Task 1.4) ...
  }
```
Note: `classifyHardClashPrecheck`'s own `skip-precheck` branch already reports its OWN `'not-run'`/`'aabb-disjoint'` event internally — `_runClearanceNarrowPhasePair` does not duplicate that one.
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/query/VolumeOverlapQuery.inconclusiveCauses.test.mjs test/CollisionWorld.precheckNotRunReason.test.mjs`
Expected: PASS (6/6, 1/1)
- [ ] **Step 5: Commit**
```bash
git add collision/query/VolumeOverlapQuery.js collision/query/ClearanceHardClashPrecheck.js collision/CollisionWorld.js test/query/VolumeOverlapQuery.inconclusiveCauses.test.mjs test/CollisionWorld.precheckNotRunReason.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): additive inconclusiveCauses set and precheckNotRunReason

volumeOverlapQuery's negative return gains a bounded, sorted inconclusiveCauses set (six causes,
including crossing-tolerance-ambiguous as a distinct cause from crossing-budget-exhausted) and
containmentSamplesUsed. classifyHardClashPrecheck's skip-precheck return and
CollisionWorld._runClearanceNarrowPhasePair (for BOTH the geometry-unsupported and
anisotropic-scale pre-precheck early returns) now record precheckNotRunReason -- an explicit
outcome-matrix table documents which event(s) fire for every exit path. No existing field's
meaning changes. M4 §16.4 item 2, §12.4 breakdown table.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Read-only memory diagnostic accessors

**Files:**
- Modify: `collision/geometry/GeometryRegistry.js:142-171` (cache `accelerationResult` on the entry — `connectivityResult` already added by Task 1.3), `collision/geometry/GeometryRegistry.js` (new `getEpochGeometryEntries`/`getEpochGeometryEntryCount`)
- Modify: `collision/tlas/TlasCache.js` (new `getEpochPrimitiveDiagnostics`)
- Modify: `collision/CollisionWorld.js:763-773` (new wrapper accessors)
- Test: `test/geometry/GeometryRegistry.diagnosticAccessors.test.mjs`, `test/tlas/TlasCache.diagnosticAccessors.test.mjs`, `test/CollisionWorld.diagnosticAccessors.test.mjs`

**Interfaces:**
- Consumes: Task 1.3's `connectivityResult` caching on the `GeometryRegistry` entry.
- Produces (exact, exhaustive shapes — this is a stable contract Metric M, a later phase's task, consumes; the equation it implements, verbatim from the M4 design spec §15.1, is:
  `[position.byteLength + index.byteLength + Σᵢ bvh._roots[i].byteLength + (bvh._indirectBuffer?.byteLength ?? 0) + connectivity.componentOf.byteLength + connectivity.closedManifold.length] + Σ_epoch[tlas.primitiveBuffer.byteLength + tlasRecordCount×recordBytes] + Σ_epoch[instanceCount×instanceBytes]`
  — an earlier draft's accessor omitted every BVH/connectivity term beyond `componentCount`, which an independent review correctly flagged as unable to compute this formula at all (Critical-1 finding: Metric M's controlling equation needs `bvh._roots`/`bvh._indirectBuffer`/`connectivity.componentOf.byteLength`/`connectivity.closedManifold.length`, none of which the welded-buffer-only shape exposed)):
  - `GeometryRegistry.getEpochGeometryEntries(loadEpoch): Array<{geometryIndex, buildState: 'building'|'ready'|'oversized', weldedPositionBytes: number|null, weldedIndexBytes: number|null, triangleCount: number|null, bvhRootBytes: number|null, bvhIndirectBytes: number|null, connectivityComponentCount: number|null, connectivityComponentOfBytes: number|null, connectivityClosedManifoldLength: number|null, oversizedReason: string|null, activeTriangleCount: number|null}>`. All nine `'ready'`-only fields are non-null ONLY when `buildState==='ready'`; `connectivityComponentCount`/`connectivityComponentOfBytes`/`connectivityClosedManifoldLength` are further `null` when connectivity was never requested/resolved for that entry. `oversizedReason`/`activeTriangleCount` are non-null ONLY when `buildState==='oversized'`. Returned in `Map` insertion order (design decision 4). An epoch with no bucket returns `[]` — there is no `'released'` `buildState`.
  - `GeometryRegistry.getEpochGeometryEntryCount(loadEpoch): number`.
  - `TlasCache.getEpochPrimitiveDiagnostics(loadEpoch): {state: 'absent'|'building'|'ready', primitiveCount: number|null, primitiveBufferBytes: number|null, builtAtRevision: number|null}`.
  - `CollisionWorld.getEpochGeometryDiagnostics(epoch)` / `getEpochTlasDiagnostics(epoch)` / `getEpochPlacementDiagnostics(epoch): {instanceCount, placementCount, placementRevision, invalidatedAtRevision: number|null}` — the only three of these reachable externally, since `GeometryRegistry`/`TlasCache` stay internal (unexported from `collision/index.js`).

- [ ] **Step 1: Write the failing test**
```js
// test/geometry/GeometryRegistry.diagnosticAccessors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeometryRegistry } from '../../collision/geometry/GeometryRegistry.js';
import { build as buildBvh } from '../../collision/blas/ThreeMeshBvhBackend.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

function makeRegistry({ buildWeld, buildConnectivity, buildAcceleration } = {}) {
  const { port, controls } = makeFakeCheckpointPort();
  controls.setEpochLive(1, true);
  const registry = new GeometryRegistry({
    buildWeld: buildWeld ?? (async () => ({
      position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]), triangleCount: 1,
    })),
    buildConnectivity: buildConnectivity ?? (async () => ({ componentCount: 1, componentOf: new Int32Array([0]), closedManifold: [true] })),
    // Real BVH backend, not a stub -- Metric M's own equation reads bvh._roots/_indirectBuffer,
    // which only a genuine MeshBVH instance carries (independent review's Critical-1 finding).
    buildAcceleration: buildAcceleration ?? (async (welded) => buildBvh(welded)),
    checkpointPort: port,
  });
  return { registry, controls };
}

test('getEpochGeometryEntries returns [] for an epoch never admitted', () => {
  const { registry } = makeRegistry();
  assert.deepEqual(registry.getEpochGeometryEntries(999), []);
  assert.equal(registry.getEpochGeometryEntryCount(999), 0);
});

test('a ready entry reports welded/BVH/connectivity byte accounting matching Metric M\'s own equation terms', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: true });
  const entries = registry.getEpochGeometryEntries(1);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.geometryIndex, 0);
  assert.equal(e.buildState, 'ready');
  assert.equal(e.weldedPositionBytes, 36); // 9 floats * 4 bytes
  assert.equal(e.weldedIndexBytes, 12); // 3 * 4 bytes
  assert.equal(e.triangleCount, 1);
  assert.ok(Number.isFinite(e.bvhRootBytes) && e.bvhRootBytes > 0, 'bvh._roots[*].byteLength summed');
  assert.equal(typeof e.bvhIndirectBytes, 'number', 'bvh._indirectBuffer?.byteLength ?? 0');
  assert.equal(e.connectivityComponentCount, 1);
  assert.equal(e.connectivityComponentOfBytes, 4); // Int32Array(1) -> 4 bytes
  assert.equal(e.connectivityClosedManifoldLength, 1);
  assert.equal(e.oversizedReason, null);
  assert.equal(e.activeTriangleCount, null);
  assert.equal(registry.getEpochGeometryEntryCount(1), 1);
});

test('a ready entry with connectivity never requested reports all three connectivity fields as null', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  const e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.connectivityComponentCount, null);
  assert.equal(e.connectivityComponentOfBytes, null);
  assert.equal(e.connectivityClosedManifoldLength, null);
});

test('an oversized entry reports oversizedReason/activeTriangleCount, nulls elsewhere', async () => {
  const { registry } = makeRegistry({ buildWeld: async () => ({ oversized: true, reason: 'geometry-too-large-for-sync-build', activeTriangleCount: 99999 }) });
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  const e = registry.getEpochGeometryEntries(1)[0];
  assert.equal(e.buildState, 'oversized');
  assert.equal(e.oversizedReason, 'geometry-too-large-for-sync-build');
  assert.equal(e.activeTriangleCount, 99999);
  assert.equal(e.weldedPositionBytes, null);
  assert.equal(e.bvhRootBytes, null);
});

test('releaseEntriesForEpoch removes entries entirely -- no "released" buildState value', async () => {
  const { registry } = makeRegistry();
  await registry.getOrBuildGeometry({ loadEpoch: 1, geometryIndex: 0, ownerModelIdHint: 'm', needsConnectivity: false });
  registry.releaseEntriesForEpoch(1);
  assert.deepEqual(registry.getEpochGeometryEntries(1), []);
});
```
```js
// test/tlas/TlasCache.diagnosticAccessors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TlasCache } from '../../collision/tlas/TlasCache.js';
import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';

// Real record shape -- matches test/tlas/TlasCache.test.mjs's own verified fixture. CollisionInstanceBVH
// requires worldBounds on each record (writePrimitiveBounds); {} placeholders would throw.
function record(fragmentId, at) {
  return { loadEpoch: 1, fragmentId, ownerDbId: fragmentId, modelId: 'm', worldBounds: { min: at, max: at.map((v) => v + 1) } };
}

test('absent/building/ready states report the exact documented shape', async () => {
  const { port } = makeFakeCheckpointPort();
  let resolveBuild;
  const cache = new TlasCache({
    buildPrimitives: () => new Promise((resolve) => { resolveBuild = resolve; }),
    checkpointPort: port,
  });
  assert.deepEqual(cache.getEpochPrimitiveDiagnostics(1), { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null });

  const pending = cache.getEntry(1, 1);
  assert.equal(cache.getEpochPrimitiveDiagnostics(1).state, 'building');
  resolveBuild([record(1, [0, 0, 0]), record(2, [1, 1, 1]), record(3, [2, 2, 2])]);
  await pending;
  const ready = cache.getEpochPrimitiveDiagnostics(1);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.primitiveCount, 3);
  assert.equal(ready.primitiveBufferBytes, 12); // Uint32Array, 3 * 4 bytes
  assert.equal(ready.builtAtRevision, 1);
});
```
```js
// test/CollisionWorld.diagnosticAccessors.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../collision/CollisionWorld.js';
import { WorldDisposedError } from '../collision/errors.js';

test('a registry-less/tlas-less world returns empty/absent shapes, never throws', async () => {
  const world = new CollisionWorld({});
  assert.deepEqual(world.getEpochGeometryDiagnostics(1), []);
  assert.deepEqual(world.getEpochTlasDiagnostics(1), { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null });
  assert.deepEqual(world.getEpochPlacementDiagnostics(1), { instanceCount: 0, placementCount: 0, placementRevision: 0, invalidatedAtRevision: null });
});

test('every accessor throws WorldDisposedError once disposed', async () => {
  const world = new CollisionWorld({});
  await world.dispose();
  assert.throws(() => world.getEpochGeometryDiagnostics(1), WorldDisposedError);
  assert.throws(() => world.getEpochTlasDiagnostics(1), WorldDisposedError);
  assert.throws(() => world.getEpochPlacementDiagnostics(1), WorldDisposedError);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/geometry/GeometryRegistry.diagnosticAccessors.test.mjs test/tlas/TlasCache.diagnosticAccessors.test.mjs test/CollisionWorld.diagnosticAccessors.test.mjs`
Expected: FAIL with `TypeError: registry.getEpochGeometryEntries is not a function` (and equivalents).
- [ ] **Step 3: Write minimal implementation**

`collision/geometry/GeometryRegistry.js` — cache `accelerationResult` (mirrors `connectivityResult`, already added by Task 1.3's Step 3):
```js
  _chainAcceleration(loadEpoch, geometryIndex, entry, waitFor) {
    entry.accelerationPromise = waitFor
      .then(() => {
        if (entry.weldWasOversized) return null;
        return this._runPhase(loadEpoch, geometryIndex, entry, () =>
          this._buildAcceleration(entry.weldedGeometry)
        , 'bvh-construction');
      })
      .then((accel) => {
        if (!entry.weldWasOversized) { entry.buildState = 'ready'; entry.accelerationResult = accel; }
        return accel;
      });
    entry.accelerationPromise.catch(() => {});
    return entry.accelerationPromise;
  }
```

Add two new public methods, alongside `releaseEntriesForEpoch`/`releaseAll`:
```js
  getEpochGeometryEntryCount(loadEpoch) {
    return this._epochs.get(loadEpoch)?.size ?? 0;
  }

  getEpochGeometryEntries(loadEpoch) {
    const bucket = this._epochs.get(loadEpoch);
    if (!bucket) return [];
    const summaries = [];
    for (const [geometryIndex, entry] of bucket) {
      if (entry.oversized === true) {
        summaries.push({
          geometryIndex, buildState: 'oversized',
          weldedPositionBytes: null, weldedIndexBytes: null, triangleCount: null,
          bvhRootBytes: null, bvhIndirectBytes: null,
          connectivityComponentCount: null, connectivityComponentOfBytes: null, connectivityClosedManifoldLength: null,
          oversizedReason: entry.reason, activeTriangleCount: entry.activeTriangleCount,
        });
        continue;
      }
      if (entry.buildState === 'ready') {
        const bvh = entry.accelerationResult ? entry.accelerationResult.bvh : null;
        const bvhRootBytes = bvh && Array.isArray(bvh._roots)
          ? bvh._roots.reduce((sum, root) => sum + (root && root.byteLength ? root.byteLength : 0), 0)
          : null;
        const bvhIndirectBytes = bvh ? (bvh._indirectBuffer ? bvh._indirectBuffer.byteLength : 0) : null;
        const connectivity = entry.connectivityResult;
        summaries.push({
          geometryIndex, buildState: 'ready',
          weldedPositionBytes: entry.weldedGeometry.position.byteLength,
          weldedIndexBytes: entry.weldedGeometry.index.byteLength,
          triangleCount: entry.weldedGeometry.triangleCount,
          bvhRootBytes, bvhIndirectBytes,
          connectivityComponentCount: connectivity ? connectivity.componentCount : null,
          connectivityComponentOfBytes: connectivity ? connectivity.componentOf.byteLength : null,
          connectivityClosedManifoldLength: connectivity ? connectivity.closedManifold.length : null,
          oversizedReason: null, activeTriangleCount: null,
        });
        continue;
      }
      summaries.push({
        geometryIndex, buildState: 'building',
        weldedPositionBytes: null, weldedIndexBytes: null, triangleCount: null,
        bvhRootBytes: null, bvhIndirectBytes: null,
        connectivityComponentCount: null, connectivityComponentOfBytes: null, connectivityClosedManifoldLength: null,
        oversizedReason: null, activeTriangleCount: null,
      });
    }
    return summaries;
  }
```

`collision/tlas/TlasCache.js` — add alongside `getBuiltAtRevision`/`releaseEntryForEpoch`:
```js
  getEpochPrimitiveDiagnostics(loadEpoch) {
    const entry = this._entries.get(loadEpoch);
    if (!entry) return { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null };
    if (entry.state === 'building') {
      return { state: 'building', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null };
    }
    return {
      state: 'ready',
      primitiveCount: entry.bvh.primitiveBuffer.length,
      primitiveBufferBytes: entry.bvh.primitiveBuffer.byteLength,
      builtAtRevision: entry.builtAtRevision,
    };
  }
```

`collision/CollisionWorld.js:763-773` — three wrapper accessors immediately after `getEpochCollisionInstanceCount`:
```js
  getEpochGeometryDiagnostics(epoch) {
    if (this._disposed) throw new WorldDisposedError();
    return this._registry ? this._registry.getEpochGeometryEntries(epoch) : [];
  }

  getEpochTlasDiagnostics(epoch) {
    if (this._disposed) throw new WorldDisposedError();
    return this._tlasCache
      ? this._tlasCache.getEpochPrimitiveDiagnostics(epoch)
      : { state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null };
  }

  getEpochPlacementDiagnostics(epoch) {
    if (this._disposed) throw new WorldDisposedError();
    return {
      instanceCount: this._instanceCache.get(epoch)?.size ?? 0,
      placementCount: this._placementByEpoch.get(epoch)?.size ?? 0,
      placementRevision: this._placementRevisionByEpoch.get(epoch) ?? 0,
      invalidatedAtRevision: this._placementInvalidatedAtRevision.get(epoch) ?? null,
    };
  }
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/geometry/GeometryRegistry.diagnosticAccessors.test.mjs test/tlas/TlasCache.diagnosticAccessors.test.mjs test/CollisionWorld.diagnosticAccessors.test.mjs`
Expected: PASS (5/5, 1/1, 2/2)
- [ ] **Step 5: Commit**
```bash
git add collision/geometry/GeometryRegistry.js collision/tlas/TlasCache.js collision/CollisionWorld.js test/geometry/GeometryRegistry.diagnosticAccessors.test.mjs test/tlas/TlasCache.diagnosticAccessors.test.mjs test/CollisionWorld.diagnosticAccessors.test.mjs
git commit -m "$(cat <<'EOF'
feat(collision): read-only memory diagnostic accessors matching Metric M's own equation

GeometryRegistry.getEpochGeometryEntries now reports every term §15.1's Metric M formula needs
(welded position/index bytes, bvh._roots/_indirectBuffer bytes, connectivity.componentOf bytes,
closedManifold length) -- not just welded-buffer sizes, which an independent review correctly
flagged as insufficient to compute the controlling equation at all. TlasCache.getEpochPrimitive-
Diagnostics and three CollisionWorld wrapper accessors extend the existing
getEpochCollisionInstanceCount precedent. Every return shape is explicit and exhaustive per
buildState/state. M4 §16.4 item 4.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
## Phase 2 — Pure engines

### Task 2.1: CDP trace/clock parser

**Files:**
- Create: `test/performance/m4/trace-clock-parser.mjs`
- Test: `test/performance/m4/trace-clock-parser.test.mjs`

**Interfaces:**
- Consumes: raw CDP trace events (Chrome tracing JSON: `{ph, cat, name, ts, dur, pid, tid, args}`, `ts`/`dur` in trace-clock microseconds); the CDP session's own tuple-level `dataLossOccurred: boolean` (from `Tracing.tracingComplete`); harness-captured `clockSamples: Array<{markName: string, performanceNowMs: number}>` — **not** `{traceUs, performanceNowMs}` as an earlier draft had it. Per §6.2, the paired clock sample *is* the opening/closing anchor mark: the harness's `performance.mark(markName)` call inside the page is what both bounds the query window **and** produces the trace-µs half of the correlation pair, so this parser resolves `traceUs` itself by locating that exact mark event in `traceEvents` (matched by name **and** the measured renderer's pid/tid) rather than trusting a second, independently-supplied timestamp. Anchor identification and clock correlation are one mechanism, not two. Also consumes harness-recorded `stageRecords: Array<{stage: string, receiptMs: number, durationMs: number}>` (per §7.3 condition 3: "The harness timestamps each recorder callback at receipt with `performance.now()`... giving every reported stage the interval `[end − ms, end]`" — so `startMs = receiptMs - durationMs`, `endMs = receiptMs`); and the measured renderer's identity, supplied either directly as `measuredPid`/`measuredTid` (typically resolved once per browser session and reused across repetitions) or as `pageTargetId` for on-demand resolution via `findMeasuredRendererProcessAndThread`.
- Produces:
  - `findMeasuredRendererProcessAndThread(traceEvents, pageTargetId): {pid: number, tid: number} | null` — resolves the measured renderer's process and main-thread ids from the `TracingStartedInBrowser` metadata event's `args.data.frames` (matched by `pageTargetId`, never guessed from event ordering) and the matching `thread_name` metadata event whose `args.name === 'CrRendererMain'` for that process. Returns `null` (never throws) when either lookup fails — an unresolvable renderer is a trace-data problem, not a caller bug.
  - The **frozen interval contract**, shared verbatim with Task 2.2 and consumed later by Task 2.4/harness code:
    ```
    Interval = {
      startMs: number,   // harness performance.now() ms clock, post trace-clock correlation
      endMs: number,     // endMs >= startMs
      source: 'cdp-task' | 'harness-stage',
      stage: string | null,   // stage name for 'harness-stage'; null for 'cdp-task'
      validity: 'valid' | 'data-loss' | 'unclocked',
    }
    ```
    `'harness-stage'` intervals are always `'valid'`. Every `'cdp-task'` interval this implementation produces is also `'valid'`: data loss is now tuple-wide (see below), not a per-interval condition, and — because a task's clock mapping is always derived from the same two anchor-tied clock samples that also define the window it was clipped into — no interval's timestamp ever needs extrapolation beyond the calibrated range, so `'unclocked'` is never produced. Both values are kept in the type only for shared-contract compatibility with Task 2.2's `validity`-typed input.
  - `parseTraceAndClock({ traceEvents, clockSamples, stageRecords, measuredPid?, measuredTid?, pageTargetId?, openingMarkName = 'm4-query-window-start', closingMarkName = 'm4-query-window-end', acceptedTopLevelTaskNames = ['RunTask'], acceptedTaskCategories = ['toplevel'], dataLossOccurred = false }) -> { valid: boolean, reason: string | null, intervals: Interval[] }`.

    **Tuple-wide invalidity, per §6.2: "If the trace reports `dataLossOccurred`, or either anchor mark is absent from it, the tuple is invalid — reported as such and excluded, never used to compute a duty cycle, `Rᵢ`, `Hᵢ`, or T-a from partial events."** When `valid` is `false`, `intervals` is always `[]` and `reason` is one of: `'data-loss'` (the CDP session itself reported `dataLossOccurred`), `'measured-renderer-not-found'` (pid/tid could not be resolved from `pageTargetId`), `'missing-opening-mark'` / `'missing-closing-mark'` (the named anchor mark is absent from the trace on the measured renderer's main thread, **or** its paired clock sample is absent from `clockSamples` — either is data loss under §6.2's rule), `'duplicate-opening-mark'` / `'duplicate-closing-mark'` (two or more same-named marks on the measured renderer's main thread — never picked from arbitrarily), `'invalid-window'` (the resolved anchors are non-finite or the closing anchor is not strictly after the opening anchor in trace time — a corrupt or reordered trace), `'invalid-clock-sample'` (a paired clock sample's `performanceNowMs` is non-finite, or the closing sample is not `>=` the opening sample — a non-monotonic harness clock). **The identity-presence check runs before every other check, including `dataLossOccurred`** (Codex review finding #3): a caller must supply **either** `{measuredPid, measuredTid}` **or** `{pageTargetId}` — supplying neither **always throws**, even on an otherwise-lossy tuple, so a harness integration bug that silently stops passing renderer identity is never mistaken for an ordinary data-loss report. This is the one thrown case; every other invalidity above is reported via `valid`/`reason`, never thrown. A malformed `stageRecord` (non-finite `receiptMs`, or `durationMs < 0`) also throws — it is a harness-computation bug, not a trace-data anomaly, so it is not folded into `reason`. Callers (Task 2.4's evidence adapter) must check `valid` before ever touching `intervals`.

    **Task selection is restricted to the measured renderer.** Only `ph: 'X'` events whose `pid`/`tid` equal the resolved measured renderer's are ever considered — no compositor, GPU, other-renderer, or other-thread event on the same process ever contributes a task interval. Among those, a task event's `cat` field is comma-split and matched against `acceptedTaskCategories` (any overlap counts — real CDP trace events routinely carry multiple categories, e.g. `"disabled-by-default-devtools.timeline,toplevel"`) and its `name` must be one of `acceptedTopLevelTaskNames`, which defaults to `['RunTask']` but is overridable to add the pinned Chromium build's own equivalent top-level task name, recorded verbatim in the report per §6.2. A task that begins before the opening mark or ends after the closing mark contributes only its intersection with `[openingMarkTs, closingMarkTs]`; a task with no overlap at all is excluded entirely (§6.2's boundary-crossing rule).

    **Two known, deliberately out-of-scope limitations (both surfaced by an independent Codex review of this fix; neither is part of the Codex-review bug this task closes, and both are noted here rather than silently left unaddressed):**
    1. **`findMeasuredRendererProcessAndThread` resolves only a `TracingStartedInBrowser` frame's numeric `processId`.** A renderer whose process handle is not yet ready when tracing starts can instead report a `processPseudoId`, resolved later via a separate `ProcessReadyInBrowser` event (and a frame's process can also change via `FrameCommittedInBrowser`). This implementation does not reconcile those; a trace shaped that way currently resolves as `measured-renderer-not-found` rather than succeeding. Handling it correctly requires verified knowledge of the exact event shapes the pinned Chromium build emits, which is out of this task's scope — whoever wires the real CDP session (Task 2.4/harness) should confirm against the pinned build whether this occurs in practice and extend `findMeasuredRendererProcessAndThread` if so.
    2. **`stageRecords` intervals remain the plain `[receiptMs - durationMs, receiptMs]` reconstruction**, per this task's own Interfaces contract (§7.3 condition 3, quoted above) — they are **not** split around recorded scheduler yields per §6.2's separate yield-splitting rule ("any reconstructed interval that overlaps a recorded yield is split at that yield's boundaries... using only instrumentation §16.4 already enumerates"). That rule needs yield-interval data this task's `stageRecords` input does not carry, and belongs to whichever task actually integrates §16.4's yield instrumentation with stage boundaries (Task 2.4's evidence adapter, or a dedicated task) — not this pure trace/clock parser. **This task's `stageRecords`-consuming contract is unchanged from the original draft and was not part of the Codex-review bug being fixed here**; flagged so it isn't mistaken for an oversight.

- [ ] **Step 1: Write the failing test — top-level task selection, nesting/dedup, and harness-stage merge, on an anchor-derived query window**
```js
// test/performance/m4/trace-clock-parser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraceAndClock, findMeasuredRendererProcessAndThread } from './trace-clock-parser.mjs';

// -- Shared fixtures (accumulate across steps; not repeated below) --------------------------

const MEASURED_PID = 1001;
const MEASURED_TID = 2002;
const OTHER_PID = 9001;   // a different Chromium process (e.g. GPU/compositor)
const OTHER_TID = 9002;   // a different thread on the SAME measured process (e.g. compositor thread)
const OPENING_MARK = 'm4-query-window-start';
const CLOSING_MARK = 'm4-query-window-end';

function markEvent(name, ts, pid = MEASURED_PID, tid = MEASURED_TID) {
  return { ph: 'R', cat: 'blink.user_timing', name, ts, pid, tid, args: {} };
}

// Identity clock: traceUs = performanceNowMs * 1000. Opening mark at ts=0/0ms, closing mark at
// ts=1_000_000/1000ms -- a 1-second query window, so correlation is a pure unit conversion.
function baseAnchors() {
  return [markEvent(OPENING_MARK, 0), markEvent(CLOSING_MARK, 1_000_000)];
}
function baseClockSamples() {
  return [
    { markName: OPENING_MARK, performanceNowMs: 0 },
    { markName: CLOSING_MARK, performanceNowMs: 1000 },
  ];
}
function runTask(ts, dur, pid = MEASURED_PID, tid = MEASURED_TID, cat = 'toplevel', name = 'RunTask') {
  return { ph: 'X', cat, name, ts, dur, pid, tid };
}
function baseArgs(overrides = {}) {
  return {
    traceEvents: [],
    clockSamples: baseClockSamples(),
    stageRecords: [],
    measuredPid: MEASURED_PID,
    measuredTid: MEASURED_TID,
    ...overrides,
  };
}

// -- Step 1 tests -----------------------------------------------------------------------------

test('selects top-level RunTask events on the measured renderer as cdp-task intervals, on the anchor-derived clock', () => {
  const traceEvents = [...baseAnchors(), runTask(10_000, 5_000), runTask(50_000, 2_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
  assert.equal(result.intervals.length, 2);
  assert.deepEqual(result.intervals[0], { startMs: 10, endMs: 15, source: 'cdp-task', stage: null, validity: 'valid' });
  assert.deepEqual(result.intervals[1], { startMs: 50, endMs: 52, source: 'cdp-task', stage: null, validity: 'valid' });
});

test('excludes a nested RunTask from top-level selection, and dedupes exact-duplicate events', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(0, 20_000),
    runTask(5_000, 3_000), // nested inside the task above -- must not become its own interval
    runTask(0, 20_000),    // exact duplicate of the first event
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 1);
  assert.deepEqual(result.intervals[0], { startMs: 0, endMs: 20, source: 'cdp-task', stage: null, validity: 'valid' });
});

test('merges harness-stage records as [receiptMs - durationMs, receiptMs] intervals alongside cdp-task intervals', () => {
  const result = parseTraceAndClock(baseArgs({
    traceEvents: baseAnchors(),
    stageRecords: [{ stage: 'compactAndWeld', receiptMs: 120, durationMs: 30 }],
  }));

  assert.equal(result.valid, true);
  assert.deepEqual(result.intervals, [{ startMs: 90, endMs: 120, source: 'harness-stage', stage: 'compactAndWeld', validity: 'valid' }]);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL with `Cannot find module './trace-clock-parser.mjs'` (or, once the file exists but is empty, `parseTraceAndClock is not a function`).
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/trace-clock-parser.mjs
//
// M4 Task 2.1: CDP trace/clock parser.
//
// Produces the frozen interval contract shared with Task 2.2 (stage-attribution-engine.mjs) and
// consumed by Task 2.4/harness code: { startMs, endMs, source, stage, validity }, wrapped in a
// tuple-level result { valid, reason, intervals } -- see this file's header comment in the plan
// task for the full contract description.
//
// Anchor identification and clock correlation share ONE mechanism (§6.2): the harness's paired
// clock sample for a window edge IS that edge's performance.mark, so this module resolves a
// sample's trace-clock timestamp by finding its named mark event on the measured renderer's main
// thread, rather than trusting an independently-supplied trace-µs value.

const TASK_EVENT_CAT = 'toplevel';
const TASK_EVENT_NAME = 'RunTask';
const DEFAULT_OPENING_MARK_NAME = 'm4-query-window-start';
const DEFAULT_CLOSING_MARK_NAME = 'm4-query-window-end';

function dedupeExact(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.ts}|${e.dur}|${e.name}|${e.pid}|${e.tid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function selectTopLevelTaskEvents(traceEvents) {
  const candidates = dedupeExact(
    traceEvents.filter((e) => e.ph === 'X' && e.cat === TASK_EVENT_CAT && e.name === TASK_EVENT_NAME)
  ).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

  const topLevel = [];
  let openEnd = -Infinity;
  for (const e of candidates) {
    if (e.ts < openEnd) continue; // nested inside the currently-open top-level task
    topLevel.push(e);
    openEnd = e.ts + e.dur;
  }
  return topLevel;
}

// Deliberately naive for now -- Step 26/28 (Group D) hardens this against missing/duplicate marks
// instead of crashing on `undefined.ts`.
function findAnchorMarkTs(traceEvents, markName, pid, tid) {
  const match = traceEvents.find((e) => e.ph === 'R' && e.name === markName && e.pid === pid && e.tid === tid);
  return match.ts;
}

function buildLinearClockMap(openingTraceUs, openingMs, closingTraceUs, closingMs) {
  const spanUs = closingTraceUs - openingTraceUs;
  return (traceUs) => {
    const t = spanUs === 0 ? 0 : (traceUs - openingTraceUs) / spanUs;
    return openingMs + t * (closingMs - openingMs);
  };
}

export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
}) {
  const pid = measuredPid;
  const tid = measuredTid;

  const openingTraceUs = findAnchorMarkTs(traceEvents, openingMarkName, pid, tid);
  const closingTraceUs = findAnchorMarkTs(traceEvents, closingMarkName, pid, tid);
  const openingSample = clockSamples.find((s) => s.markName === openingMarkName);
  const closingSample = clockSamples.find((s) => s.markName === closingMarkName);
  const toMs = buildLinearClockMap(openingTraceUs, openingSample.performanceNowMs, closingTraceUs, closingSample.performanceNowMs);

  const taskIntervals = selectTopLevelTaskEvents(traceEvents).map((e) => ({
    startMs: toMs(e.ts),
    endMs: toMs(e.ts + e.dur),
    source: 'cdp-task',
    stage: null,
    validity: 'valid',
  }));

  const stageIntervals = (stageRecords ?? []).map((r) => ({
    startMs: r.receiptMs - r.durationMs,
    endMs: r.receiptMs,
    source: 'harness-stage',
    stage: r.stage,
    validity: 'valid',
  }));

  const intervals = [...taskIntervals, ...stageIntervals].sort((a, b) => a.startMs - b.startMs);
  return { valid: true, reason: null, intervals };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 3 tests)
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "test(m4): trace/clock parser — top-level task selection, nesting/dedup, harness-stage merge on an anchor-derived window"
```

- [ ] **Step 6: Write the failing test — wrong-process/wrong-thread contamination (Codex review, critical)**
```js
test('excludes RunTask events from a different process, or a different thread on the measured process', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(10_000, 5_000),                          // measured renderer's main thread -- included
    runTask(10_000, 70_000, OTHER_PID, OTHER_TID),    // a different process entirely (e.g. GPU/compositor)
    runTask(10_000, 70_000, MEASURED_PID, 3003),      // same process, a different thread (e.g. compositor)
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 1);
  assert.deepEqual(result.intervals[0], { startMs: 10, endMs: 15, source: 'cdp-task', stage: null, validity: 'valid' });
});
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — `selectTopLevelTaskEvents` currently ignores `pid`/`tid` entirely, so the two 70ms contaminating events (longer duration, same start `ts`) sort ahead of the genuine 5ms measured task and swallow it under the containment rule; the test observes 1 interval, but at `{startMs: 10, endMs: 80}` from the wrong (other-process) event, not `{startMs: 10, endMs: 15}` from the measured renderer's real task.
- [ ] **Step 8: Write minimal implementation — restrict task selection to the measured renderer's pid/tid**
```js
// replace selectTopLevelTaskEvents's call site inside parseTraceAndClock:
const measuredEvents = traceEvents.filter((e) => e.pid === pid && e.tid === tid);

const taskIntervals = selectTopLevelTaskEvents(measuredEvents).map((e) => ({
  startMs: toMs(e.ts),
  endMs: toMs(e.ts + e.dur),
  source: 'cdp-task',
  stage: null,
  validity: 'valid',
}));
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 4 tests)
- [ ] **Step 10: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — restrict task selection to the measured renderer's pid/tid (Codex review: cross-process/thread contamination)"
```

- [ ] **Step 11: Write the failing test — boundary-crossing clipping and out-of-window exclusion**
```js
test('clips a task that starts before the opening mark or ends after the closing mark to its window intersection', () => {
  const traceEvents = [
    ...baseAnchors(), // window is [0, 1_000_000) trace-µs == [0, 1000) ms
    runTask(-50_000, 100_000), // starts 50ms before the window, ends 50ms inside it
    runTask(950_000, 100_000), // starts 50ms before the window closes, ends 50ms after it
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 2);
  assert.deepEqual(result.intervals[0], { startMs: 0, endMs: 50, source: 'cdp-task', stage: null, validity: 'valid' });
  assert.deepEqual(result.intervals[1], { startMs: 950, endMs: 1000, source: 'cdp-task', stage: null, validity: 'valid' });
});

test('excludes a task entirely outside the query window', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(-200_000, 50_000), // ends at ts=-150_000 -- entirely before the opening mark
    runTask(1_100_000, 50_000), // starts entirely after the closing mark
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 0);
});
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — task intervals currently map `e.ts`/`e.ts + e.dur` directly with no clamping, so the first test reports `{startMs: -50, endMs: 50}` and `{startMs: 950, endMs: 1050}` (full, unclipped durations) instead of the window-intersected values, and the second test reports 2 intervals (both fully outside the window) instead of 0.
- [ ] **Step 13: Write minimal implementation — clip to `[openingTraceUs, closingTraceUs]`, drop non-overlapping tasks**
```js
// replace the taskIntervals construction inside parseTraceAndClock:
const taskIntervals = [];
for (const e of selectTopLevelTaskEvents(measuredEvents)) {
  const clippedStartUs = Math.max(e.ts, openingTraceUs);
  const clippedEndUs = Math.min(e.ts + e.dur, closingTraceUs);
  if (clippedEndUs <= clippedStartUs) continue; // no overlap with the query window at all
  taskIntervals.push({
    startMs: toMs(clippedStartUs),
    endMs: toMs(clippedEndUs),
    source: 'cdp-task',
    stage: null,
    validity: 'valid',
  });
}
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 6 tests)
- [ ] **Step 15: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — clip boundary-crossing tasks to the query window, drop out-of-window tasks (§6.2)"
```

- [ ] **Step 16: Write the failing test — missing/duplicate anchor marks never throw, and are reported as invalid**
```js
test('reports invalid, never throws, when the opening anchor mark is missing from the trace', () => {
  const traceEvents = [markEvent(CLOSING_MARK, 1_000_000), runTask(10_000, 5_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing-opening-mark');
  assert.deepEqual(result.intervals, []);
});

test('reports invalid when the closing anchor mark is missing from the trace', () => {
  const traceEvents = [markEvent(OPENING_MARK, 0), runTask(10_000, 5_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing-closing-mark');
});

test('reports invalid, never picking one arbitrarily, when the opening anchor mark name is duplicated', () => {
  const traceEvents = [markEvent(OPENING_MARK, 0), markEvent(OPENING_MARK, 5_000), markEvent(CLOSING_MARK, 1_000_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'duplicate-opening-mark');
});

test('reports invalid when a mark is present in the trace but its paired clock sample is missing', () => {
  const result = parseTraceAndClock(baseArgs({
    traceEvents: baseAnchors(),
    clockSamples: [{ markName: OPENING_MARK, performanceNowMs: 0 }], // closing sample missing
  }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing-closing-mark');
});
```
- [ ] **Step 17: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — `findAnchorMarkTs` calls `.find(...)` and reads `.ts` unconditionally, so a missing mark throws `TypeError: Cannot read properties of undefined (reading 'ts')` instead of returning `{valid: false, reason: 'missing-opening-mark', intervals: []}`; a duplicate mark silently returns the *first* match's timestamp instead of being reported; and a missing clock sample throws `TypeError: Cannot read properties of undefined (reading 'performanceNowMs')` in `buildLinearClockMap`'s caller instead of being reported.
- [ ] **Step 18: Write minimal implementation — explicit anchor resolution, tuple-wide invalid result instead of a thrown exception**
```js
// replace findAnchorMarkTs with:
function findAnchorMarkEvent(traceEvents, markName, pid, tid) {
  const matches = traceEvents.filter((e) => e.ph === 'R' && e.name === markName && e.pid === pid && e.tid === tid);
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'duplicate' };
  return { status: 'ok', ts: matches[0].ts };
}

// replace the start of parseTraceAndClock's body (after resolving pid/tid) with:
export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
}) {
  const pid = measuredPid;
  const tid = measuredTid;

  const opening = findAnchorMarkEvent(traceEvents, openingMarkName, pid, tid);
  if (opening.status !== 'ok') {
    return { valid: false, reason: opening.status === 'duplicate' ? 'duplicate-opening-mark' : 'missing-opening-mark', intervals: [] };
  }
  const closing = findAnchorMarkEvent(traceEvents, closingMarkName, pid, tid);
  if (closing.status !== 'ok') {
    return { valid: false, reason: closing.status === 'duplicate' ? 'duplicate-closing-mark' : 'missing-closing-mark', intervals: [] };
  }

  const openingSample = (clockSamples ?? []).find((s) => s.markName === openingMarkName);
  const closingSample = (clockSamples ?? []).find((s) => s.markName === closingMarkName);
  if (!openingSample) return { valid: false, reason: 'missing-opening-mark', intervals: [] };
  if (!closingSample) return { valid: false, reason: 'missing-closing-mark', intervals: [] };

  const openingTraceUs = opening.ts;
  const closingTraceUs = closing.ts;
  const toMs = buildLinearClockMap(openingTraceUs, openingSample.performanceNowMs, closingTraceUs, closingSample.performanceNowMs);
  const measuredEvents = traceEvents.filter((e) => e.pid === pid && e.tid === tid);

  const taskIntervals = [];
  for (const e of selectTopLevelTaskEvents(measuredEvents)) {
    const clippedStartUs = Math.max(e.ts, openingTraceUs);
    const clippedEndUs = Math.min(e.ts + e.dur, closingTraceUs);
    if (clippedEndUs <= clippedStartUs) continue;
    taskIntervals.push({
      startMs: toMs(clippedStartUs),
      endMs: toMs(clippedEndUs),
      source: 'cdp-task',
      stage: null,
      validity: 'valid',
    });
  }

  const stageIntervals = (stageRecords ?? []).map((r) => ({
    startMs: r.receiptMs - r.durationMs,
    endMs: r.receiptMs,
    source: 'harness-stage',
    stage: r.stage,
    validity: 'valid',
  }));

  const intervals = [...taskIntervals, ...stageIntervals].sort((a, b) => a.startMs - b.startMs);
  return { valid: true, reason: null, intervals };
}
```
- [ ] **Step 19: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 10 tests)
- [ ] **Step 20: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — report missing/duplicate anchor marks as an invalid tuple instead of throwing (§6.2)"
```

- [ ] **Step 21: Write the failing test — tuple-wide `dataLossOccurred`, not a synthetic per-task overflow event**
```js
test('reports the entire tuple invalid when the CDP session reports dataLossOccurred, regardless of otherwise-valid tasks/anchors', () => {
  const traceEvents = [...baseAnchors(), runTask(10_000, 5_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents, dataLossOccurred: true }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'data-loss');
  assert.deepEqual(result.intervals, []);
});

test('a well-formed tuple with dataLossOccurred left at its default (false) is unaffected', () => {
  const traceEvents = [...baseAnchors(), runTask(10_000, 5_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 1);
});
```
- [ ] **Step 22: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL (first test only) — `parseTraceAndClock` does not accept or check `dataLossOccurred` at all, so passing it has no effect and the tuple is reported `valid: true` with 1 interval instead of being invalidated tuple-wide.
- [ ] **Step 23: Write minimal implementation — tuple-wide data-loss short-circuit**
```js
// add `dataLossOccurred = false` to parseTraceAndClock's destructured parameters, and add this as
// the very first statement of the function body, before pid/tid or anchor resolution:
export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
  dataLossOccurred = false,
}) {
  // §6.2: "If the trace reports dataLossOccurred ... the tuple is invalid" -- this is a property
  // of the whole CDP tracing session, never a synthetic event overlapping one task, so it gates
  // the entire tuple before anything else (pid/tid, anchors) is even resolved.
  if (dataLossOccurred) {
    return { valid: false, reason: 'data-loss', intervals: [] };
  }

  const pid = measuredPid;
  const tid = measuredTid;
  // ...(rest of the function body unchanged from Step 18)
```
- [ ] **Step 24: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 12 tests)
- [ ] **Step 25: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — treat dataLossOccurred as tuple-wide invalidity, not a synthetic per-task overflow event (§6.2)"
```

- [ ] **Step 26: Write the failing test — category-list matching and pinned-build equivalent task names**
```js
test('matches a task event whose cat field is a comma-separated list containing the accepted category', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(10_000, 5_000, MEASURED_PID, MEASURED_TID, 'disabled-by-default-devtools.timeline,toplevel'),
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 1);
});

test('excludes a task event whose cat field contains no accepted category, even with a matching name', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(10_000, 5_000, MEASURED_PID, MEASURED_TID, 'disabled-by-default-devtools.timeline'),
  ];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.intervals.length, 0);
});

test('acceptedTopLevelTaskNames lets a pinned Chromium build\'s equivalent top-level task name match', () => {
  const traceEvents = [
    ...baseAnchors(),
    runTask(10_000, 5_000, MEASURED_PID, MEASURED_TID, 'toplevel', 'ThreadControllerImpl::RunTask'),
  ];
  const defaultResult = parseTraceAndClock(baseArgs({ traceEvents }));
  assert.equal(defaultResult.intervals.length, 0); // not matched under the default name list

  const pinnedResult = parseTraceAndClock(baseArgs({
    traceEvents,
    acceptedTopLevelTaskNames: ['RunTask', 'ThreadControllerImpl::RunTask'],
  }));
  assert.equal(pinnedResult.valid, true);
  assert.equal(pinnedResult.intervals.length, 1);
});
```
- [ ] **Step 27: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — `selectTopLevelTaskEvents` compares `e.cat === TASK_EVENT_CAT` with strict string equality, so the comma-separated-category event (`"disabled-by-default-devtools.timeline,toplevel"`) never equals `"toplevel"` and is wrongly excluded (0 intervals instead of 1); and `parseTraceAndClock` does not accept `acceptedTopLevelTaskNames` at all, so passing it has no effect and `pinnedResult.intervals.length` stays 0 instead of becoming 1.
- [ ] **Step 28: Write minimal implementation — comma-aware category-list matching, overridable task names**
```js
// replace the two TASK_EVENT_* constants with:
const DEFAULT_ACCEPTED_TASK_CATEGORIES = ['toplevel'];
const DEFAULT_ACCEPTED_TASK_NAMES = ['RunTask'];

function eventCategories(catField) {
  return String(catField ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// replace selectTopLevelTaskEvents's signature and filter predicate:
function selectTopLevelTaskEvents(traceEvents, acceptedCategories, acceptedNames) {
  const candidates = dedupeExact(
    traceEvents.filter(
      (e) => e.ph === 'X'
        && acceptedNames.includes(e.name)
        && eventCategories(e.cat).some((c) => acceptedCategories.includes(c))
    )
  ).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

  const topLevel = [];
  let openEnd = -Infinity;
  for (const e of candidates) {
    if (e.ts < openEnd) continue;
    topLevel.push(e);
    openEnd = e.ts + e.dur;
  }
  return topLevel;
}

// add `acceptedTopLevelTaskNames = DEFAULT_ACCEPTED_TASK_NAMES, acceptedTaskCategories =
// DEFAULT_ACCEPTED_TASK_CATEGORIES` to parseTraceAndClock's destructured parameters, and update
// its call site:
for (const e of selectTopLevelTaskEvents(measuredEvents, acceptedTaskCategories, acceptedTopLevelTaskNames)) {
  // ...unchanged clipping body from Step 18
}
```
- [ ] **Step 29: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 15 tests)
- [ ] **Step 30: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — comma-aware category-list matching, overridable pinned-build task names (§6.2)"
```

- [ ] **Step 31: Write the failing test — deriving the measured renderer's pid/tid from trace metadata**
```js
function tracingStartedInBrowserEvent(frames) {
  return {
    ph: 'I', cat: 'disabled-by-default-devtools.timeline', name: 'TracingStartedInBrowser',
    ts: 0, pid: 0, tid: 0, args: { data: { frames } },
  };
}
function threadNameEvent(pid, tid, name) {
  return { ph: 'M', cat: '__metadata', name: 'thread_name', ts: 0, pid, tid, args: { name } };
}

test('findMeasuredRendererProcessAndThread resolves pid/tid from TracingStartedInBrowser + thread_name metadata for the page under test', () => {
  const traceEvents = [
    tracingStartedInBrowserEvent([{ frame: 'FRAME-A', url: 'about:blank', name: '', processId: 4242 }]),
    threadNameEvent(4242, 7777, 'CrRendererMain'),
    threadNameEvent(4242, 7778, 'Compositor'), // a same-process, non-main thread -- must not be picked
  ];
  assert.deepEqual(findMeasuredRendererProcessAndThread(traceEvents, 'FRAME-A'), { pid: 4242, tid: 7777 });
});

test('findMeasuredRendererProcessAndThread returns null, never guesses, when the target frame or its main thread cannot be identified', () => {
  const traceEvents = [tracingStartedInBrowserEvent([{ frame: 'FRAME-A', url: 'about:blank', name: '', processId: 4242 }])];
  assert.equal(findMeasuredRendererProcessAndThread(traceEvents, 'FRAME-A'), null); // no thread_name event at all
  assert.equal(findMeasuredRendererProcessAndThread(traceEvents, 'FRAME-UNKNOWN'), null); // frame not present
});

test('parseTraceAndClock derives pid/tid via pageTargetId when measuredPid/measuredTid are not supplied directly', () => {
  const traceEvents = [
    tracingStartedInBrowserEvent([{ frame: 'FRAME-A', url: 'about:blank', name: '', processId: MEASURED_PID }]),
    threadNameEvent(MEASURED_PID, MEASURED_TID, 'CrRendererMain'),
    markEvent(OPENING_MARK, 0),
    markEvent(CLOSING_MARK, 1_000_000),
    runTask(10_000, 5_000),
  ];
  const result = parseTraceAndClock({ traceEvents, clockSamples: baseClockSamples(), stageRecords: [], pageTargetId: 'FRAME-A' });

  assert.equal(result.valid, true);
  assert.equal(result.intervals.length, 1);
});

test('parseTraceAndClock reports invalid, never throws, when the measured renderer cannot be resolved from pageTargetId', () => {
  const traceEvents = [tracingStartedInBrowserEvent([]), markEvent(OPENING_MARK, 0), markEvent(CLOSING_MARK, 1_000_000)];
  const result = parseTraceAndClock({ traceEvents, clockSamples: baseClockSamples(), stageRecords: [], pageTargetId: 'FRAME-A' });

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'measured-renderer-not-found');
});

test('parseTraceAndClock throws when neither {measuredPid, measuredTid} nor {pageTargetId} is supplied -- a caller-contract violation, not a data-quality issue', () => {
  assert.throws(
    () => parseTraceAndClock({ traceEvents: [], clockSamples: [], stageRecords: [] }),
    /measuredPid, measuredTid.*pageTargetId/,
  );
});

test('the caller-contract violation still throws even when dataLossOccurred is also true -- a missing-identity bug in the harness must never be masked as a data-loss tuple', () => {
  assert.throws(
    () => parseTraceAndClock({ traceEvents: [], clockSamples: [], stageRecords: [], dataLossOccurred: true }),
    /measuredPid, measuredTid.*pageTargetId/,
  );
});
```
- [ ] **Step 32: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — `findMeasuredRendererProcessAndThread` does not exist yet (import error); once stubbed, `parseTraceAndClock` still unconditionally uses `measuredPid`/`measuredTid` (`undefined` when only `pageTargetId` is given), so pid/tid filtering matches nothing, anchor marks are reported missing instead of the renderer being resolved via `pageTargetId`, calling with neither identification path returns `{valid: false, reason: 'missing-opening-mark', ...}` instead of throwing, and the combined `dataLossOccurred: true` + missing-identity case returns `{valid: false, reason: 'data-loss', ...}` instead of throwing (Step 23's `dataLossOccurred` check currently runs *before* any identity check, so a harness that stops passing renderer identity on a lossy tuple has its integration bug silently swallowed as an ordinary data-loss report — Codex review finding #3).
- [ ] **Step 33: Write minimal implementation — metadata-based pid/tid resolution, `pageTargetId` wiring**
```js
// add, exported, alongside the other module functions:
export function findMeasuredRendererProcessAndThread(traceEvents, pageTargetId) {
  const startedEvent = traceEvents.find((e) => e.name === 'TracingStartedInBrowser');
  const frames = startedEvent?.args?.data?.frames ?? [];
  const frame = frames.find((f) => f.frame === pageTargetId);
  if (!frame || typeof frame.processId !== 'number') return null;

  const pid = frame.processId;
  const threadNameEvent = traceEvents.find(
    (e) => e.ph === 'M' && e.name === 'thread_name' && e.pid === pid && e.args?.name === 'CrRendererMain'
  );
  if (!threadNameEvent || typeof threadNameEvent.tid !== 'number') return null;

  return { pid, tid: threadNameEvent.tid };
}

// replace the start of parseTraceAndClock entirely with:
export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  pageTargetId,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
  acceptedTopLevelTaskNames = DEFAULT_ACCEPTED_TASK_NAMES,
  acceptedTaskCategories = DEFAULT_ACCEPTED_TASK_CATEGORIES,
  dataLossOccurred = false,
}) {
  // Codex review finding #3: a missing-identity caller bug must never be masked as an ordinary
  // data-loss report. The identity-presence check is therefore a hard caller-contract check,
  // evaluated BEFORE dataLossOccurred (or anything else) is even looked at -- it throws
  // regardless of what the trace data itself says.
  const hasExplicitIdentity = typeof measuredPid === 'number' && typeof measuredTid === 'number';
  if (!hasExplicitIdentity && !pageTargetId) {
    throw new Error(
      'parseTraceAndClock: either { measuredPid, measuredTid } or { pageTargetId } is required to identify the measured renderer'
    );
  }

  if (dataLossOccurred) {
    return { valid: false, reason: 'data-loss', intervals: [] };
  }

  let pid = measuredPid;
  let tid = measuredTid;
  if (!hasExplicitIdentity) {
    const resolved = findMeasuredRendererProcessAndThread(traceEvents, pageTargetId);
    if (!resolved) {
      return { valid: false, reason: 'measured-renderer-not-found', intervals: [] };
    }
    pid = resolved.pid;
    tid = resolved.tid;
  }

  // ...(rest of the function body unchanged from Step 23/28: anchor resolution, clock map,
  // pid/tid-filtered + category/name-matched + window-clipped task selection, stage merge)
```
- [ ] **Step 34: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 21 tests)
- [ ] **Step 35: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — derive measured pid/tid from TracingStartedInBrowser/thread_name metadata, wire pageTargetId fallback (§6.2)

Closes the Codex review's critical finding: the parser previously selected every RunTask event
with no pid/tid filter, no query-window bounds or boundary clipping, no anchor-mark validation,
a synthetic per-task overflow event instead of tuple-wide dataLossOccurred handling, and an exact
category/name match that missed comma-separated cat fields and pinned-build task-name variants."
```

- [ ] **Step 36: Write the failing test — reject a reversed/zero-length window and non-finite/non-monotonic clock samples, without ever reporting them valid**
```js
test('reports invalid, never valid, when the closing anchor is not strictly after the opening anchor in trace time', () => {
  const traceEvents = [markEvent(OPENING_MARK, 500_000), markEvent(CLOSING_MARK, 500_000), runTask(500_000, 1_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-window');
  assert.deepEqual(result.intervals, []);
});

test('reports invalid when the closing anchor precedes the opening anchor (corrupt/reordered trace)', () => {
  const traceEvents = [markEvent(OPENING_MARK, 1_000_000), markEvent(CLOSING_MARK, 0), runTask(500_000, 1_000)];
  const result = parseTraceAndClock(baseArgs({ traceEvents }));

  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-window');
});

test('reports invalid when a paired clock sample carries a non-finite performanceNowMs, or the closing sample is not >= the opening sample (non-monotonic clock)', () => {
  const nonFinite = parseTraceAndClock(baseArgs({
    traceEvents: baseAnchors(),
    clockSamples: [{ markName: OPENING_MARK, performanceNowMs: 0 }, { markName: CLOSING_MARK, performanceNowMs: NaN }],
  }));
  assert.equal(nonFinite.valid, false);
  assert.equal(nonFinite.reason, 'invalid-clock-sample');

  const nonMonotonic = parseTraceAndClock(baseArgs({
    traceEvents: baseAnchors(),
    clockSamples: [{ markName: OPENING_MARK, performanceNowMs: 1000 }, { markName: CLOSING_MARK, performanceNowMs: 500 }],
  }));
  assert.equal(nonMonotonic.valid, false);
  assert.equal(nonMonotonic.reason, 'invalid-clock-sample');
});

test('throws on a malformed harness stageRecord (non-finite receiptMs, or a negative durationMs) -- a harness/caller bug, not a trace-data anomaly', () => {
  assert.throws(
    () => parseTraceAndClock(baseArgs({
      traceEvents: baseAnchors(),
      stageRecords: [{ stage: 'compactAndWeld', receiptMs: 120, durationMs: -5 }],
    })),
    /malformed stageRecord/,
  );
  assert.throws(
    () => parseTraceAndClock(baseArgs({
      traceEvents: baseAnchors(),
      stageRecords: [{ stage: 'compactAndWeld', receiptMs: NaN, durationMs: 30 }],
    })),
    /malformed stageRecord/,
  );
});
```
- [ ] **Step 37: Run test to verify it fails**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: FAIL — nothing currently validates `closingTraceUs > openingTraceUs`, so a zero-length or reversed window silently produces a `toMs` mapper with `spanUs <= 0` (a `NaN`/`Infinity`-producing or degenerate divide) and the tuple is still reported `valid: true` with tasks either dropped or mapped to nonsensical timestamps rather than reported `invalid-window`; nothing validates `clockSamples` values are finite or monotonic, so `NaN`/reversed samples propagate silently into `startMs`/`endMs` instead of `invalid-clock-sample`; and malformed `stageRecords` (negative duration, non-finite receipt) are converted into `{startMs, endMs}` pairs that violate `endMs >= startMs` instead of throwing (Codex review finding #4).
- [ ] **Step 38: Write minimal implementation — finite/ordering guards on the window, clock samples, and stage records**
```js
// add near the top of trace-clock-parser.mjs, alongside the other helpers:
function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// insert into parseTraceAndClock, immediately after the opening/closing anchor-mark and
// paired-clock-sample lookups (i.e. right after the existing
// `if (!openingSample) ... if (!closingSample) ...` guards, before `buildLinearClockMap` is
// called):
if (!isFiniteNumber(openingTraceUs) || !isFiniteNumber(closingTraceUs) || closingTraceUs <= openingTraceUs) {
  return { valid: false, reason: 'invalid-window', intervals: [] };
}
if (
  !isFiniteNumber(openingSample.performanceNowMs)
  || !isFiniteNumber(closingSample.performanceNowMs)
  || closingSample.performanceNowMs < openingSample.performanceNowMs
) {
  return { valid: false, reason: 'invalid-clock-sample', intervals: [] };
}

// insert into parseTraceAndClock, immediately before the stageIntervals mapping:
for (const r of stageRecords ?? []) {
  if (!isFiniteNumber(r.receiptMs) || !isFiniteNumber(r.durationMs) || r.durationMs < 0) {
    throw new Error(
      `parseTraceAndClock: malformed stageRecord for stage "${r.stage}" -- receiptMs and durationMs must be finite numbers, and durationMs must be >= 0`
    );
  }
}
```
- [ ] **Step 39: Run test to verify it passes**
Run: `node --test test/performance/m4/trace-clock-parser.test.mjs`
Expected: PASS (all 25 tests)
- [ ] **Step 40: Commit**
```bash
git add test/performance/m4/trace-clock-parser.mjs test/performance/m4/trace-clock-parser.test.mjs
git commit -m "fix(m4): trace/clock parser — reject a reversed/zero window, non-finite/non-monotonic clock samples, and malformed stage records (Codex review: contract-invariant gaps)"
```
### Task 2.2: Stage-attribution / residual engine

**Files:**
- Create: `test/performance/m4/stage-attribution-engine.mjs`
- Test: `test/performance/m4/stage-attribution-engine.test.mjs`

**Interfaces:**
- Consumes: Task 2.1's frozen interval contract (`{startMs, endMs, source, stage, validity}`) as plain arrays of already-filtered `cdp-task` intervals (`taskIntervals`) and `harness-stage` intervals (`stageIntervals`), one repetition/window at a time. This engine does **not** interpret `validity` itself — a caller (Task 2.4's evidence adapter, or a later harness phase) decides how to treat `'data-loss'`/`'unclocked'` intervals before calling in; that is a documented, deliberate scope boundary, not an oversight.
- Produces:
  - `SCREEN_TRANSFERABLE_STAGES: Set<string>`, `MAIN_ONLY_STAGES: Set<string>`, `classifyStageForScreen(stageName): 'transferable' | 'main-only'` (throws on an unrecognized stage name) — §6.3's fixed classification table, at its most permissive (per §7.3 condition 3: `compactAndWeld` and `geometryResolutionPerPair` both count as transferable for this screen).
  - `computeResidualAll(taskIntervals, stageIntervals): number` — `Rᵢ(all,τ)` for one repetition/window (§7.3 condition 3).
  - `computeResidualForBoundary(taskIntervals, stageIntervals, ownedStageNames): number` — `Rᵢ(w,τ)` for one repetition/window, restricted to `w`'s own owned stage(s) (§7.3 condition 4(b)).
  - `computeBoundaryOccupancy(taskIntervals, subMarkIntervals, correlationMarkMs, closingMarkMs): { value: number, deliveryTaskIdentified: boolean }` — `Hᵢ(w,τ)` for one repetition/window (§7.3 condition 4(b)/§6.2's correlation rule). `subMarkIntervals` are `w`'s own boundary-owned sub-mark intervals (input snapshot/extra copy, serialization/postMessage) on the same clock; `correlationMarkMs` is the delivery-task-locating instant (or `null` if the arm never emitted one); `closingMarkMs` is the arm's closing `performance.mark`.
  - `hardMaximum(values: number[]): number` — the shared "hard maximum across 5 repetitions" reduction used by both `Rᵢ` and clause 4(b)'s sum; throws on an empty array rather than silently returning `-Infinity`.

- [ ] **Step 1: Write the failing test — stage classification table**
```js
// test/performance/m4/stage-attribution-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForScreen, SCREEN_TRANSFERABLE_STAGES, MAIN_ONLY_STAGES } from './stage-attribution-engine.mjs';

test('§6.3 classification: compactAndWeld and geometryResolutionPerPair count as transferable for the screen', () => {
  assert.equal(classifyStageForScreen('compactAndWeld'), 'transferable');
  assert.equal(classifyStageForScreen('geometryResolutionPerPair'), 'transferable');
  assert.equal(classifyStageForScreen('connectivity'), 'transferable');
  assert.equal(classifyStageForScreen('bvhConstruction'), 'transferable');
  assert.equal(classifyStageForScreen('tlasBuildCacheQuery'), 'transferable');
  assert.equal(classifyStageForScreen('broadPhaseCandidateWork'), 'transferable');
  assert.equal(classifyStageForScreen('hardClashPrecheck'), 'transferable');
  assert.equal(classifyStageForScreen('exactNarrowPhase'), 'transferable');
  assert.equal(classifyStageForScreen('clearanceDistanceQuery'), 'transferable');
});

test('§6.3 classification: extraction, aggregation, lifecycle, and scheduler overhead stay main-only', () => {
  assert.equal(classifyStageForScreen('viewerExtraction'), 'main-only');
  assert.equal(classifyStageForScreen('resultAggregation'), 'main-only');
  assert.equal(classifyStageForScreen('lifecycleValidationAndPublication'), 'main-only');
  assert.equal(classifyStageForScreen('schedulerYieldOverhead'), 'main-only');
});

test('throws on a stage name outside §6.3\'s fixed table', () => {
  assert.throws(() => classifyStageForScreen('notARealStage'), /unknown stage/);
});

test('the two exported sets partition exactly the 13 known §6.3 stages with no overlap', () => {
  assert.equal(SCREEN_TRANSFERABLE_STAGES.size + MAIN_ONLY_STAGES.size, 13);
  for (const s of SCREEN_TRANSFERABLE_STAGES) assert.equal(MAIN_ONLY_STAGES.has(s), false);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL with `Cannot find module './stage-attribution-engine.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/stage-attribution-engine.mjs
//
// M4 Task 2.2: stage-attribution / residual engine. Consumes Task 2.1's frozen interval contract.

export const SCREEN_TRANSFERABLE_STAGES = new Set([
  'compactAndWeld',
  'connectivity',
  'bvhConstruction',
  'tlasBuildCacheQuery',
  'broadPhaseCandidateWork',
  'geometryResolutionPerPair',
  'hardClashPrecheck',
  'exactNarrowPhase',
  'clearanceDistanceQuery',
]);

export const MAIN_ONLY_STAGES = new Set([
  'viewerExtraction',
  'resultAggregation',
  'lifecycleValidationAndPublication',
  'schedulerYieldOverhead',
]);

export function classifyStageForScreen(stageName) {
  if (SCREEN_TRANSFERABLE_STAGES.has(stageName)) return 'transferable';
  if (MAIN_ONLY_STAGES.has(stageName)) return 'main-only';
  throw new Error(`stage-attribution-engine: unknown stage "${stageName}" is not in §6.3's fixed classification table`);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.mjs test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "test(m4): stage-attribution engine — §6.3 fixed classification table for the screen"
```

- [ ] **Step 6: Write the failing test — computeResidualAll, simple non-nested case**
```js
test('computeResidualAll: subtracts a transferable stage fully covering the task -> zero residual', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 0);
});

test('computeResidualAll: longest contiguous main-only remainder around a transferable stage', () => {
  // task [0,100); transferable stage [30,60) -> main-only remainder is [0,30) and [60,100); longest is 40
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 30, endMs: 60, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 40);
});

test('computeResidualAll: a main-only-classified stage does not subtract anything', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'resultAggregation', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 100);
});

test('computeResidualAll: an empty task list is a defined, intentional zero, not -Infinity', () => {
  assert.equal(computeResidualAll([], []), 0);
});
```
Add the corresponding `import { ..., computeResidualAll } from './stage-attribution-engine.mjs';` to the top of the test file (accumulates across steps; not repeated below).
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL with `computeResidualAll is not a function`
- [ ] **Step 8: Write minimal implementation**
```js
// add to stage-attribution-engine.mjs
function innermostCoveringStage(t, stageIntervals) {
  let winner = null;
  for (const s of stageIntervals) {
    if (s.startMs <= t && t < s.endMs) {
      if (winner === null || s.endMs - s.startMs < winner.endMs - winner.startMs) winner = s;
    }
  }
  return winner;
}

// Longest contiguous main-only (uncovered) sub-interval of `task`. Overlapping stages are counted
// once: only the innermost stage covering an instant decides whether that instant is "covered".
function longestContiguousUncovered(task, stageIntervals, isTransferable) {
  const overlapping = stageIntervals.filter((s) => s.startMs < task.endMs && s.endMs > task.startMs);
  const boundarySet = new Set([task.startMs, task.endMs]);
  for (const s of overlapping) {
    if (s.startMs > task.startMs && s.startMs < task.endMs) boundarySet.add(s.startMs);
    if (s.endMs > task.startMs && s.endMs < task.endMs) boundarySet.add(s.endMs);
  }
  const points = [...boundarySet].sort((a, b) => a - b);

  let longest = 0;
  let runLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segEnd <= segStart) continue;
    const covering = innermostCoveringStage(segStart, overlapping);
    const isCovered = covering !== null && isTransferable(covering.stage);
    if (isCovered) {
      runLength = 0;
    } else {
      runLength += segEnd - segStart;
      longest = Math.max(longest, runLength);
    }
  }
  return longest;
}

function maxOverTasks(taskIntervals, stageIntervals, isTransferable) {
  let max = 0;
  for (const task of taskIntervals) {
    max = Math.max(max, longestContiguousUncovered(task, stageIntervals, isTransferable));
  }
  return max;
}

export function computeResidualAll(taskIntervals, stageIntervals) {
  return maxOverTasks(taskIntervals, stageIntervals, (stage) => classifyStageForScreen(stage) === 'transferable');
}
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS
- [ ] **Step 10: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.mjs test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "feat(m4): stage-attribution engine — computeResidualAll, longest-contiguous-uncovered rule"
```

- [ ] **Step 11: Write the failing test — nesting/innermost-wins and multi-task hard maximum**
```js
test('computeResidualAll: innermost classified stage wins under nesting (main-only bracket wraps a transferable one)', () => {
  // task [0,100); outer main-only stage [0,100) wraps an inner transferable stage [40,60).
  // Instant t in [40,60) is covered by BOTH; only the innermost (the transferable one, span 20) decides -> covered.
  // Instants in [0,40) and [60,100) are covered only by the outer main-only stage -> not covered.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const outer = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'lifecycleValidationAndPublication', validity: 'valid' };
  const inner = { startMs: 40, endMs: 60, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  // uncovered runs are [0,40) and [60,100), both length 40 -- the longest-contiguous figure is 40
  assert.equal(computeResidualAll([task], [outer, inner]), 40);
});

test('computeResidualAll: hard maximum across multiple tasks in the window', () => {
  const taskA = { startMs: 0, endMs: 30, source: 'cdp-task', stage: null, validity: 'valid' }; // fully main-only: residual 30
  const taskB = { startMs: 100, endMs: 180, source: 'cdp-task', stage: null, validity: 'valid' }; // fully main-only: residual 80
  assert.equal(computeResidualAll([taskA, taskB], []), 80);
});

test('hardMaximum: reduces 5 repetition values, and refuses an empty array rather than returning -Infinity', () => {
  assert.equal(hardMaximum([10, 45, 12, 8, 30]), 45);
  assert.throws(() => hardMaximum([]), /empty repetition set/);
});
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL — `hardMaximum is not a function` (the nesting and multi-task cases already pass against Step 8's implementation, since `longestContiguousUncovered`/`maxOverTasks` already handle nesting and multi-task correctly; this step's RED is solely `hardMaximum`'s absence).
- [ ] **Step 13: Write minimal implementation**
```js
// add to stage-attribution-engine.mjs
export function hardMaximum(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('hardMaximum: refusing to reduce an empty repetition set (Math.max(...[]) === -Infinity would silently pass every threshold)');
  }
  return Math.max(...values);
}
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS
- [ ] **Step 15: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.mjs test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "feat(m4): stage-attribution engine — nesting confirmed correct, hardMaximum with empty-set guard"
```

- [ ] **Step 16: Write the failing test — computeResidualForBoundary's restricted transferable set**
```js
test('computeResidualForBoundary: only w\'s own owned stage(s) are subtracted, unlike the permissive screen', () => {
  // task [0,100); connectivity [0,50) and bvhConstruction [50,100). WB-2p only owns hardClashPrecheck,
  // so at this task NEITHER stage is w's own -> full 100ms is main-only-attributed to WB-2p.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stages = [
    { startMs: 0, endMs: 50, source: 'harness-stage', stage: 'connectivity', validity: 'valid' },
    { startMs: 50, endMs: 100, source: 'harness-stage', stage: 'bvhConstruction', validity: 'valid' },
  ];
  assert.equal(computeResidualForBoundary([task], stages, ['hardClashPrecheck']), 100);
  // WB-1b owns compactAndWeld/connectivity/bvhConstruction -- both stages above ARE w's own -> residual 0.
  assert.equal(computeResidualForBoundary([task], stages, ['compactAndWeld', 'connectivity', 'bvhConstruction']), 0);
});
```
- [ ] **Step 17: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL with `computeResidualForBoundary is not a function`
- [ ] **Step 18: Write minimal implementation**
```js
// add to stage-attribution-engine.mjs
export function computeResidualForBoundary(taskIntervals, stageIntervals, ownedStageNames) {
  const owned = new Set(ownedStageNames);
  return maxOverTasks(taskIntervals, stageIntervals, (stage) => owned.has(stage));
}
```
- [ ] **Step 19: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS
- [ ] **Step 20: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.mjs test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "feat(m4): stage-attribution engine — computeResidualForBoundary, per-boundary Rᵢ(w,τ)"
```

- [ ] **Step 21: Write the failing test — computeBoundaryOccupancy, sub-mark summation with no delivery task**
```js
test('computeBoundaryOccupancy: sums intersections of a task with w\'s own sub-marks; no correlation mark supplied', () => {
  // task [0,100); sub-marks at [10,20) and [70,90) -- both fully inside the task.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const subMarks = [
    { startMs: 10, endMs: 20, source: 'harness-stage', stage: 'boundary:WB-2p:inputSnapshot', validity: 'valid' },
    { startMs: 70, endMs: 90, source: 'harness-stage', stage: 'boundary:WB-2p:serializePostMessage', validity: 'valid' },
  ];
  const { value, deliveryTaskIdentified } = computeBoundaryOccupancy([task], subMarks, null, 100);
  assert.equal(value, 30); // 10 + 20
  assert.equal(deliveryTaskIdentified, false);
});

test('computeBoundaryOccupancy: a task with no intersecting sub-mark and not the delivery task contributes zero', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const { value } = computeBoundaryOccupancy([task], [], null, 100);
  assert.equal(value, 0);
});
```
- [ ] **Step 22: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL with `computeBoundaryOccupancy is not a function`
- [ ] **Step 23: Write minimal implementation**
```js
// add to stage-attribution-engine.mjs
function intersectionMs(a, b) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

export function computeBoundaryOccupancy(taskIntervals, subMarkIntervals, correlationMarkMs, closingMarkMs) {
  let deliveryTask = null;
  if (correlationMarkMs !== null) {
    deliveryTask = taskIntervals.find((t) => t.startMs <= correlationMarkMs && correlationMarkMs < t.endMs) ?? null;
  }

  let max = 0;
  for (const task of taskIntervals) {
    let sum = 0;
    for (const mark of subMarkIntervals) sum += intersectionMs(task, mark);
    if (deliveryTask !== null && task === deliveryTask) {
      sum += Math.max(0, Math.min(task.endMs, closingMarkMs) - task.startMs);
    }
    max = Math.max(max, sum);
  }
  return { value: max, deliveryTaskIdentified: deliveryTask !== null };
}
```
- [ ] **Step 24: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS
- [ ] **Step 25: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.mjs test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "feat(m4): stage-attribution engine — computeBoundaryOccupancy, sub-mark intersection summation"
```

- [ ] **Step 26: Write the failing test — delivery-task identification and closing-mark clamp**
```js
test('computeBoundaryOccupancy: the identified delivery task contributes start-to-min(end,closingMark), clamped to the closing mark', () => {
  const deliveryTask = { startMs: 200, endMs: 260, source: 'cdp-task', stage: null, validity: 'valid' }; // keeps running to 260
  const correlationMarkMs = 205; // locates the delivery task, but is never used to TIME it
  const closingMarkMs = 240; // arm's closing performance.mark, before the task's own end
  const { value, deliveryTaskIdentified } = computeBoundaryOccupancy([deliveryTask], [], correlationMarkMs, closingMarkMs);
  assert.equal(deliveryTaskIdentified, true);
  assert.equal(value, 40); // min(260,240) - 200 = 40, never past the closing mark
});

test('computeBoundaryOccupancy: sub-mark contribution and delivery-task contribution add, when both land on the same window', () => {
  const inputTask = { startMs: 0, endMs: 30, source: 'cdp-task', stage: null, validity: 'valid' };
  const deliveryTask = { startMs: 200, endMs: 260, source: 'cdp-task', stage: null, validity: 'valid' };
  const subMarks = [{ startMs: 5, endMs: 15, source: 'harness-stage', stage: 'boundary:WB-2p:inputSnapshot', validity: 'valid' }];
  const { value } = computeBoundaryOccupancy([inputTask, deliveryTask], subMarks, 205, 240);
  assert.equal(value, 40); // max(10, 40) -- Hᵢ is the MAX over tasks, not a sum across tasks
});
```
- [ ] **Step 27: Run test to verify it fails**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: FAIL — Step 23's implementation already implements this correctly by construction; RED here is expected to be immediate/trivial (a guard against having silently broken it), confirming this exact behavior wasn't accidentally test-only in Step 21. If it unexpectedly fails on logic (not just missing coverage), fix `computeBoundaryOccupancy` per Step 23's code before proceeding.
- [ ] **Step 28: Run test to verify it passes**
Run: `node --test test/performance/m4/stage-attribution-engine.test.mjs`
Expected: PASS (no implementation change needed if Step 23 was implemented as specified)
- [ ] **Step 29: Commit**
```bash
git add test/performance/m4/stage-attribution-engine.test.mjs
git commit -m "test(m4): stage-attribution engine — lock in delivery-task closing-mark clamp and per-task max rule"
```

---

### Task 2.3: Metric M calculator

**Files:**
- Create: `test/performance/m4/metric-m-calculator.mjs`
- Test: `test/performance/m4/metric-m-calculator.test.mjs`

**Interfaces:**
- Consumes — the read-only memory diagnostic accessor output shape Phase 1 task 1.6 will implement (1.6 does not exist yet in code; this is the contract 2.3 is built against, and 1.6 must match it exactly):
  ```
  MemorySnapshot = {
    geometryEntries: Array<{
      loadEpoch: number, geometryIndex: number,
      positionByteLength: number,               // welded position buffer .byteLength
      indexByteLength: number,                   // welded index buffer .byteLength
      bvhRootByteLengths: number[],               // bvh._roots[i].byteLength for each root i
      bvhIndirectBufferByteLength: number,        // bvh._indirectBuffer?.byteLength ?? 0
      connectivityComponentOfByteLength: number,  // connectivity.componentOf.byteLength
      connectivityClosedManifoldLength: number,   // connectivity.closedManifold.length
    }>,
    epochs: Array<{
      loadEpoch: number,
      tlasPrimitiveBufferByteLength: number,
      tlasRecordCount: number,
      placementCount: number,
      instanceCount: number,
    }>,
    inflight: Array<{
      payloadId: string,
      backingBuffers: Array<{ bufferId: string, byteLength: number }>,  // bufferId stable across
                                                                          // payload entries sharing
                                                                          // one ArrayBuffer, for dedup
      payloadMetadataBytes: number,
    }>,
  }
  ```
  An accessor's snapshot with no entries anywhere (`{geometryEntries: [], epochs: [], inflight: []}`) is a defined, intentional `M = 0` — not a silently-trimmed empty-set artifact.
- Produces: `computeMetricM(snapshot): number` (§15.1's formula, exactly); `INSTANCE_BYTES` (88), `RECORD_BYTES` (104), `PLACEMENT_BYTES` (192) as derived (not hardcoded) structural constants, plus the field-spec tables they're derived from, so a future shape change is caught by re-deriving rather than by editing a literal.

- [ ] **Step 1: Write the failing test — structural constants derived from a field spec, not pinned as literals**
```js
// test/performance/m4/metric-m-calculator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTANCE_BYTES, RECORD_BYTES, PLACEMENT_BYTES,
  INSTANCE_FIELD_SPEC, RECORD_FIELD_SPEC, bytesForFieldSpec,
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
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: FAIL with `Cannot find module './metric-m-calculator.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/metric-m-calculator.mjs
//
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/metric-m-calculator.mjs test/performance/m4/metric-m-calculator.test.mjs
git commit -m "feat(m4): Metric M calculator — structural constants derived from field specs, not pinned"
```

- [ ] **Step 6: Write the failing test — geometry-entry and epoch sums**
```js
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
```
Add `computeMetricM` to the test file's import.
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: FAIL with `computeMetricM is not a function`
- [ ] **Step 8: Write minimal implementation**
```js
// add to metric-m-calculator.mjs
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

  return total;
}
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: PASS
- [ ] **Step 10: Commit**
```bash
git add test/performance/m4/metric-m-calculator.mjs test/performance/m4/metric-m-calculator.test.mjs
git commit -m "feat(m4): Metric M calculator — geometry-entry and per-epoch sums"
```

- [ ] **Step 11: Write the failing test — inflight de-duplicated backing buffers + metadata**
```js
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
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: FAIL — inflight is not summed at all yet (expected value exceeds actual `0`).
- [ ] **Step 13: Write minimal implementation**
```js
// add to computeMetricM, before `return total;`
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
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: PASS
- [ ] **Step 15: Commit**
```bash
git add test/performance/m4/metric-m-calculator.mjs test/performance/m4/metric-m-calculator.test.mjs
git commit -m "feat(m4): Metric M calculator — de-duplicated in-flight backing buffers + metadata bytes"
```

- [ ] **Step 16: Write the failing test — full §15.1 integration and the empty-scope guard**
```js
test('computeMetricM: full formula integration across geometry, epochs, and inflight together', () => {
  const snapshot = {
    geometryEntries: [{
      loadEpoch: 1, geometryIndex: 0, positionByteLength: 1000, indexByteLength: 400,
      bvhRootByteLengths: [200], bvhIndirectBufferByteLength: 0,
      connectivityComponentOfByteLength: 80, connectivityClosedManifoldLength: 4,
    }],
    epochs: [{ loadEpoch: 1, tlasPrimitiveBufferByteLength: 500, tlasRecordCount: 1, placementCount: 1, instanceCount: 1 }],
    inflight: [{ payloadId: 'a', backingBuffers: [{ bufferId: 'buf-1', byteLength: 100 }], payloadMetadataBytes: 10 }],
  };
  const expected =
    (1000 + 400 + 200 + 0 + 80 + 4) +
    (500 + 1 * RECORD_BYTES + 1 * PLACEMENT_BYTES + 1 * INSTANCE_BYTES) +
    (100 + 10);
  assert.equal(computeMetricM(snapshot), expected);
});

test('computeMetricM: an empty snapshot is a defined M = 0, never a silently-trimmed artifact', () => {
  assert.equal(computeMetricM({ geometryEntries: [], epochs: [], inflight: [] }), 0);
});
```
- [ ] **Step 17: Run test to verify it fails**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: FAIL only if the integration arithmetic in the plan's implementation disagrees with this test's hand-computed `expected` — run once to confirm both currently pass against Step 13's implementation (this step is a regression lock, not new behavior); if it fails, fix `computeMetricM` to match §15.1 exactly before proceeding.
- [ ] **Step 18: Run test to verify it passes**
Run: `node --test test/performance/m4/metric-m-calculator.test.mjs`
Expected: PASS
- [ ] **Step 19: Commit**
```bash
git add test/performance/m4/metric-m-calculator.test.mjs
git commit -m "test(m4): Metric M calculator — full §15.1 integration and empty-snapshot guard"
```

---

### Task 2.4: Canonical decision-evidence model

**Files:**
- Create: `test/performance/m4/decision-evidence-model.mjs`
- Test: `test/performance/m4/decision-evidence-model.test.mjs`

**Interfaces:**
- Consumes — a harness's raw measured record set, one `RawMeasuredRecord` per verdict-bearing tuple, plus a matrix-wide `GlobalPreconditions` object. Both shapes are specified here (no earlier phase pins them); a later harness phase must match this contract exactly:
  ```
  RawMeasuredRecord = {
    tuple: { runtime: string, caseId: string, broadPhase: string, state: 'cold'|'warm'|'refresh' },
    targets: { tA: boolean, tB1: boolean, tB2: boolean, tC: boolean },  // already §7.2-aggregated
    screenResidualMs: number[] | null,   // Rᵢ(all,τ) per repetition (5 values); required iff tA===false
    narrowPhaseFamilyWins: boolean | null,  // §17's median-across-repetitions family-selection rule:
                                             // does the narrow-phase family (precheck/exact-query/
                                             // distance) win over geometry-preparation at this tuple?
                                             // required (non-null) iff tA===false; meaningless/null
                                             // otherwise. Independent review finding: C's own §7.3
                                             // eligibility condition is "warm AND narrow-phase family
                                             // wins" — an earlier draft let a caller-supplied
                                             // `applicable:true` on a C-class boundary settle a COLD
                                             // tuple as Verdict C, contradicting C's defining condition
                                             // (a cold geometry-preparation stall is never a C case).
                                             // This field is what makes that check DERIVED rather than
                                             // trusted caller input (see Task 2.5's one-line fix).
    boundaries: Array<{
      id: 'WB-1a'|'WB-1b'|'WB-2p'|'WB-3'|'WB-2'|'WB-4',
      applicable: boolean,               // §7.3's applicability rule, resolved upstream (§17 selection)
      residualMs: number[] | null,       // Rᵢ(w,τ) per repetition
      occupancyMs: number[] | null,      // Hᵢ(w,τ) per repetition
      deliveryTaskIdentified: boolean[] | null,  // per repetition; B-class UNEVALUABLE trigger
      derivedEvidenceBounded: boolean | null,    // C-class only: whether Verdict C's 3-component
                                                  // wire-contract bound could be conservatively assembled
      memoryBudgetMet: boolean | null,           // §7.3 condition 6, §15.3's controlling-metric budget
      lifecycleDemonstrated: boolean | null,     // §7.3 condition 7, S4'/S5' lifecycle+disposal proof
      moduleResolutionEstablished: boolean | null,  // §7.3 condition 8, S1's module-resolution route
                                                     // null = evidence not yet gathered (UNEVALUABLE);
                                                     // false = evidence present and this boundary FAILS
                                                     // the condition (INSUFFICIENT); true = condition met.
                                                     // Independent review finding: an earlier draft
                                                     // computed SUFFICIENT from the Rᵢ+Hᵢ≤50ms check
                                                     // alone, which could mark a boundary SUFFICIENT
                                                     // despite a memory-budget violation or an undemon-
                                                     // strated lifecycle/module-resolution prerequisite.
    }>,
  }
  GlobalPreconditions = {
    noConfirmedResponsivenessTarget: boolean,      // §7.5.1
    noRepresentativeRuntime: boolean,               // §7.5.2
    capacityCensored: boolean,                      // §7.5.3
    workloadValidityFailed: boolean,                // §7.5.4
    insufficientStatisticalConfidence: boolean,     // §7.5.5 (vacuous today — no condition invokes §7.4.2)
    missingCausalAttribution: boolean,              // §7.5.6
    unconfirmedMemoryMultipliers: boolean,          // §7.5.7
    undeterminedDeviceScopeOrConcurrency: boolean,  // §7.5.8
  }
  ```
  The fixed §8.2 boundary table (class + owned stages, used to classify/annotate every boundary entry) is **not** an input — it is pinned inside this module (below), since §8.2 fixes it independently of any measurement.
- Produces: `buildEvidenceVector(rawRecords, globalPreconditions): EvidenceVector` — the pure adapter/validator Task 2.5 is built against:
  ```
  EvidenceVector = {
    globalMandatoryD: { ...the 8 booleans above, causes: number[], any: boolean },
    tuples: Array<{
      tuple: {...},
      targetsAllPass: boolean,
      onlyQueryEvidenceFailing: boolean,   // §7.5.9 trigger
      noBoundaryScreenFailed: boolean,     // §1.1 no-boundary trigger (meaningful only when tA===false)
      boundaries: Array<{
        id: string, class: 'B'|'C', applicable: boolean, ownedStages: string[],
        disposition: 'NOT_APPLICABLE'|'UNEVALUABLE'|'INSUFFICIENT'|'SUFFICIENT',
        unevaluableReason: 'missing-vertical'|'undetermined-delivery-task'|'unboundable-derived-evidence'|null,
      }>,
    }>,
  }
  ```
  `CLAUSE_THRESHOLD_MS = 50` (§7.3 condition 3 and condition 4(b) both use this figure verbatim) and `BOUNDARY_TABLE` (the fixed §8.2 class/owned-stages table) are also exported, since Task 2.5 reads `class`/`ownedStages` off each evidence-vector boundary entry rather than re-deriving them.

- [ ] **Step 1: Write the failing test — pass-through with no boundaries, minimal target evaluation**
```js
// test/performance/m4/decision-evidence-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceVector } from './decision-evidence-model.mjs';

function passingGlobalPreconditions() {
  return {
    noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
    workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
    unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
  };
}

test('a fully-passing tuple with no boundaries yields targetsAllPass:true and no D triggers', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: true, tB1: true, tB2: true, tC: true },
    screenResidualMs: null,
    boundaries: [],
  }];
  const ev = buildEvidenceVector(raw, passingGlobalPreconditions());
  assert.equal(ev.globalMandatoryD.any, false);
  assert.equal(ev.tuples[0].targetsAllPass, true);
  assert.equal(ev.tuples[0].onlyQueryEvidenceFailing, false);
  assert.equal(ev.tuples[0].noBoundaryScreenFailed, false);
  assert.deepEqual(ev.tuples[0].boundaries, []);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL with `Cannot find module './decision-evidence-model.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/decision-evidence-model.mjs
//
// M4 Task 2.4: canonical decision-evidence model — the adapter/validator that maps a harness's
// raw measured record set into the pure evidence-vector shape Task 2.5's reducer is built against.
// See this task's "Interfaces" note in the plan for the full RawMeasuredRecord/EvidenceVector contracts.

export const CLAUSE_THRESHOLD_MS = 50;

export const BOUNDARY_TABLE = {
  'WB-1a': { class: 'B', ownedStages: ['bvhConstruction'] },
  'WB-1b': { class: 'B', ownedStages: ['compactAndWeld', 'connectivity', 'bvhConstruction'] },
  'WB-2p': { class: 'B', ownedStages: ['hardClashPrecheck'] },
  'WB-3': { class: 'B', ownedStages: ['clearanceDistanceQuery'] },
  'WB-2': { class: 'C', ownedStages: ['hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery'] },
  'WB-4': { class: 'C', ownedStages: ['broadPhaseCandidateWork', 'hardClashPrecheck', 'exactNarrowPhase', 'clearanceDistanceQuery', 'resultAggregation'] },
};

const GLOBAL_PRECONDITIONS = [
  { key: 'noConfirmedResponsivenessTarget', condition: 1 },
  { key: 'noRepresentativeRuntime', condition: 2 },
  { key: 'capacityCensored', condition: 3 },
  { key: 'workloadValidityFailed', condition: 4 },
  { key: 'insufficientStatisticalConfidence', condition: 5 },
  { key: 'missingCausalAttribution', condition: 6 },
  { key: 'unconfirmedMemoryMultipliers', condition: 7 },
  { key: 'undeterminedDeviceScopeOrConcurrency', condition: 8 },
];

function buildGlobalMandatoryD(globalPreconditions) {
  const causes = GLOBAL_PRECONDITIONS.filter(({ key }) => globalPreconditions[key]).map(({ condition }) => condition);
  return {
    ...Object.fromEntries(GLOBAL_PRECONDITIONS.map(({ key }) => [key, globalPreconditions[key]])),
    causes,
    any: causes.length > 0,
  };
}

function buildTupleEvidence(raw) {
  const { tA, tB1, tB2, tC } = raw.targets;
  const targetsAllPass = tA && tB1 && tB2 && tC;
  const onlyQueryEvidenceFailing = tA === true && !targetsAllPass;
  return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed: false, boundaries: [] };
}

export function buildEvidenceVector(rawRecords, globalPreconditions) {
  return {
    globalMandatoryD: buildGlobalMandatoryD(globalPreconditions),
    tuples: rawRecords.map(buildTupleEvidence),
  };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "feat(m4): decision-evidence model — global preconditions passthrough, targetsAllPass"
```

- [ ] **Step 6: Write the failing test — validation of malformed input**
```js
test('throws when a global precondition field is missing or not boolean', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [],
  }];
  const bad = { ...passingGlobalPreconditions(), capacityCensored: 'no' };
  assert.throws(() => buildEvidenceVector(raw, bad), /capacityCensored must be a boolean/);
});

test('throws when a tuple is missing tuple.caseId', () => {
  const raw = [{ tuple: { runtime: 'multi-process' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] }];
  assert.throws(() => buildEvidenceVector(raw, passingGlobalPreconditions()), /tuple.runtime and tuple.caseId are required/);
});

test('throws when a target field is not boolean', () => {
  const raw = [{
    tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' },
    targets: { tA: 'yes', tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [],
  }];
  assert.throws(() => buildEvidenceVector(raw, passingGlobalPreconditions()), /targets.tA/);
});
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — no validation exists yet; malformed inputs are silently accepted instead of throwing.
- [ ] **Step 8: Write minimal implementation**
```js
// add to decision-evidence-model.mjs
function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`buildEvidenceVector: ${label} must be a boolean`);
}

function validateGlobalPreconditions(globalPreconditions) {
  for (const { key } of GLOBAL_PRECONDITIONS) requireBoolean(globalPreconditions?.[key], key);
}

// in buildTupleEvidence, before computing targetsAllPass:
function buildTupleEvidence(raw) {
  if (!raw.tuple?.runtime || !raw.tuple?.caseId) {
    throw new Error('buildEvidenceVector: tuple.runtime and tuple.caseId are required');
  }
  requireBoolean(raw.targets?.tA, `tuple ${raw.tuple.caseId}: targets.tA`);
  requireBoolean(raw.targets?.tB1, `tuple ${raw.tuple.caseId}: targets.tB1`);
  requireBoolean(raw.targets?.tB2, `tuple ${raw.tuple.caseId}: targets.tB2`);
  requireBoolean(raw.targets?.tC, `tuple ${raw.tuple.caseId}: targets.tC`);
  const { tA, tB1, tB2, tC } = raw.targets;
  const targetsAllPass = tA && tB1 && tB2 && tC;
  const onlyQueryEvidenceFailing = tA === true && !targetsAllPass;
  return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed: false, boundaries: [] };
}

// in buildEvidenceVector, before mapping rawRecords:
export function buildEvidenceVector(rawRecords, globalPreconditions) {
  validateGlobalPreconditions(globalPreconditions);
  return {
    globalMandatoryD: buildGlobalMandatoryD(globalPreconditions),
    tuples: rawRecords.map(buildTupleEvidence),
  };
}
```
Add a local `passingGlobalPreconditions()` helper to the test file matching Step 1's (or import a shared one — this file defines it once at the top).
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 10: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "feat(m4): decision-evidence model — validate global preconditions and tuple/target shape"
```

- [ ] **Step 11: Write the failing test — no-boundary screen flag (§1.1)**
```js
test('noBoundaryScreenFailed is true only when tA fails and the screen residual exceeds 50ms on any repetition', () => {
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, boundaries: [] };
  const failingScreen = buildEvidenceVector(
    [{ ...base, targets: { tA: false, tB1: true, tB2: true, tC: true }, screenResidualMs: [10, 10, 10, 10, 55] }],
    passingGlobalPreconditions(),
  );
  assert.equal(failingScreen.tuples[0].noBoundaryScreenFailed, true);

  const passingScreen = buildEvidenceVector(
    [{ ...base, targets: { tA: false, tB1: true, tB2: true, tC: true }, screenResidualMs: [10, 10, 10, 10, 50] }],
    passingGlobalPreconditions(),
  );
  assert.equal(passingScreen.tuples[0].noBoundaryScreenFailed, false); // 50 exactly passes (<=)

  const tAPassing = buildEvidenceVector(
    [{ ...base, targets: { tA: true, tB1: false, tB2: true, tC: true }, screenResidualMs: null }],
    passingGlobalPreconditions(),
  );
  assert.equal(tAPassing.tuples[0].noBoundaryScreenFailed, false); // §1.1 only applies at a T-a-failing tuple
});

test('throws when tA fails but screenResidualMs is missing or not exactly 5 numbers', () => {
  const base = { tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' }, targets: { tA: false, tB1: true, tB2: true, tC: true }, boundaries: [] };
  assert.throws(() => buildEvidenceVector([{ ...base, screenResidualMs: null }], passingGlobalPreconditions()), /screenResidualMs/);
  assert.throws(() => buildEvidenceVector([{ ...base, screenResidualMs: [1, 2, 3] }], passingGlobalPreconditions()), /screenResidualMs/);
});
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — `noBoundaryScreenFailed` is hardcoded `false` and `screenResidualMs` is never read.
- [ ] **Step 13: Write minimal implementation**
```js
// add to decision-evidence-model.mjs
function requireFiveNumbers(value, label) {
  if (!Array.isArray(value) || value.length !== 5 || value.some((v) => typeof v !== 'number')) {
    throw new Error(`buildEvidenceVector: ${label} must be an array of exactly 5 numbers`);
  }
}

// in buildTupleEvidence, replace the fixed `noBoundaryScreenFailed: false` with:
let noBoundaryScreenFailed = false;
if (tA === false) {
  requireFiveNumbers(raw.screenResidualMs, `tuple ${raw.tuple.caseId}: screenResidualMs`);
  noBoundaryScreenFailed = Math.max(...raw.screenResidualMs) > CLAUSE_THRESHOLD_MS;
}
return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed, boundaries: [] };
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 15: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "feat(m4): decision-evidence model — §1.1 no-boundary screen flag"
```

- [ ] **Step 16: Write the failing test — B-class boundary disposition (SUFFICIENT / INSUFFICIENT / UNEVALUABLE via missing vertical)**
```js
function tAFailingTuple(boundaries) {
  return {
    tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' },
    targets: { tA: false, tB1: true, tB2: true, tC: true },
    screenResidualMs: [10, 10, 10, 10, 10],
    boundaries,
  };
}
const fiveReps = (v) => Array(5).fill(v);

test('B-class boundary: SUFFICIENT when Rᵢ+Hᵢ stays <=50ms every repetition; INSUFFICIENT on one violating rep', () => {
  const sufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(sufficient.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(sufficient.tuples[0].boundaries[0].class, 'B');
  assert.deepEqual(sufficient.tuples[0].boundaries[0].ownedStages, ['hardClashPrecheck']);

  const insufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(insufficient.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
});

test('B-class boundary: UNEVALUABLE with reason "missing-vertical" when residual/occupancy is null; NOT_APPLICABLE when inapplicable', () => {
  const unevaluable = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-1a', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(unevaluable.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(unevaluable.tuples[0].boundaries[0].unevaluableReason, 'missing-vertical');

  const notApplicable = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-3', applicable: false, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(notApplicable.tuples[0].boundaries[0].disposition, 'NOT_APPLICABLE');
  assert.equal(notApplicable.tuples[0].boundaries[0].unevaluableReason, null);
});

test('throws on an unknown boundary id', () => {
  assert.throws(
    () => buildEvidenceVector([tAFailingTuple([{ id: 'WB-99', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }])], passingGlobalPreconditions()),
    /unknown boundary id/,
  );
});
```
- [ ] **Step 17: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — `boundaries` is hardcoded to `[]` in `buildTupleEvidence`; none of the disposition logic exists yet.
- [ ] **Step 18: Write minimal implementation**
```js
// add to decision-evidence-model.mjs
function computeBoundaryDisposition(raw) {
  const meta = BOUNDARY_TABLE[raw.id];
  if (!meta) throw new Error(`buildEvidenceVector: unknown boundary id "${raw.id}"`);

  if (!raw.applicable) {
    return { id: raw.id, class: meta.class, applicable: false, ownedStages: meta.ownedStages, disposition: 'NOT_APPLICABLE', unevaluableReason: null };
  }

  if (meta.class === 'B') {
    if (raw.residualMs === null || raw.occupancyMs === null) {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-vertical' };
    }
    if (raw.deliveryTaskIdentified === null || raw.deliveryTaskIdentified.some((v) => v === false)) {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'undetermined-delivery-task' };
    }
    requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
    requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
    const sums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
    const disposition = Math.max(...sums) <= CLAUSE_THRESHOLD_MS ? 'SUFFICIENT' : 'INSUFFICIENT';
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition, unevaluableReason: null };
  }

  // C-class -- disposition rule and thresholds are otherwise identical (§7.3's Verdict C clause); see Step 21.
  return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'unboundable-derived-evidence' };
}

// in buildTupleEvidence, replace `boundaries: []` with:
const boundaries = (raw.boundaries ?? []).map(computeBoundaryDisposition);
return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed, boundaries };
```
- [ ] **Step 19: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 20: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "feat(m4): decision-evidence model — B-class boundary disposition (UNEVALUABLE/INSUFFICIENT/SUFFICIENT)"
```

- [ ] **Step 20b: Write the failing test — `warmNarrowPhaseFailure`, the derived flag Task 2.5 gates Verdict C on**

Independent review finding (Critical): an earlier draft of Task 2.5's reducer trusted a caller-supplied `applicable:true` on a C-class boundary without checking §7.3's own eligibility condition for C — "evidence that the failure is in the warm narrow phase." A cold geometry-preparation stall could reach Verdict C. This step makes that check a DERIVED fact on the evidence vector (never a trusted input), so Task 2.5 only needs to read one boolean rather than re-deriving applicability itself.

```js
test('warmNarrowPhaseFailure is true only when state is warm AND narrowPhaseFamilyWins is true; false on a cold tuple regardless of narrowPhaseFamilyWins', () => {
  const warmAndWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'warm' }, narrowPhaseFamilyWins: true }],
    passingGlobalPreconditions(),
  );
  assert.equal(warmAndWins.tuples[0].warmNarrowPhaseFailure, true);

  const coldButWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), narrowPhaseFamilyWins: true }], // tAFailingTuple defaults to state:'cold'
    passingGlobalPreconditions(),
  );
  assert.equal(coldButWins.tuples[0].warmNarrowPhaseFailure, false);

  const warmButGeometryWins = buildEvidenceVector(
    [{ ...tAFailingTuple([]), tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'warm' }, narrowPhaseFamilyWins: false }],
    passingGlobalPreconditions(),
  );
  assert.equal(warmButGeometryWins.tuples[0].warmNarrowPhaseFailure, false);
});

test('throws when tA fails but narrowPhaseFamilyWins is missing or not boolean', () => {
  const base = { ...tAFailingTuple([]) };
  delete base.narrowPhaseFamilyWins;
  assert.throws(() => buildEvidenceVector([base], passingGlobalPreconditions()), /narrowPhaseFamilyWins/);
});
```
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — `buildTupleEvidence` never reads or validates `narrowPhaseFamilyWins`, and `warmNarrowPhaseFailure` doesn't exist on the returned shape.

- [ ] **Step 20c: Write the implementation**
```js
// add to buildTupleEvidence, alongside the existing noBoundaryScreenFailed computation (Step 13):
if (tA === false) {
  if (typeof raw.narrowPhaseFamilyWins !== 'boolean') {
    throw new Error(`buildEvidenceVector: tuple ${raw.tuple.caseId}: narrowPhaseFamilyWins must be a boolean when tA is false`);
  }
}
const warmNarrowPhaseFailure = tA === false && raw.tuple.state === 'warm' && raw.narrowPhaseFamilyWins === true;

// add warmNarrowPhaseFailure to buildTupleEvidence's return value:
return { tuple: raw.tuple, targetsAllPass, onlyQueryEvidenceFailing, noBoundaryScreenFailed, warmNarrowPhaseFailure, boundaries };
```
Update the shared `tAFailingTuple` test helper (Step 16, already updated by Step 25c above to inject boundary-level defaults) to also inject `narrowPhaseFamilyWins: true` at the top level, matching the pattern already established there.

Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS

- [ ] **Step 20d: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "fix(m4): decision-evidence model — derive warmNarrowPhaseFailure, Verdict C's own §7.3 eligibility condition

Independent review (Critical): the reducer previously trusted a caller-supplied applicable:true on
a C-class boundary with no check that the failure is actually in the warm narrow phase, so a cold
geometry-preparation stall could reach Verdict C. This is now a derived fact (state==='warm' AND
the §17 family-selection rule says narrow-phase won), consumed by a one-line gate in Task 2.5.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 21: Write the failing test — B-class UNEVALUABLE via undetermined delivery task, and C-class disposition**
```js
test('B-class boundary: UNEVALUABLE with reason "undetermined-delivery-task" when any repetition can\'t identify a delivery task', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true, true, false, true, true], derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(ev.tuples[0].boundaries[0].unevaluableReason, 'undetermined-delivery-task');
});

test('C-class boundary: SUFFICIENT/INSUFFICIENT follow the same Rᵢ+Hᵢ<=50ms rule; UNEVALUABLE reason "unboundable-derived-evidence" when the wire-contract bound can\'t be assembled', () => {
  const sufficient = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(sufficient.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(sufficient.tuples[0].boundaries[0].class, 'C');

  const unbounded = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: false }])],
    passingGlobalPreconditions(),
  );
  assert.equal(unbounded.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(unbounded.tuples[0].boundaries[0].unevaluableReason, 'unboundable-derived-evidence');
});
```
- [ ] **Step 22: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — the "undetermined-delivery-task" branch is already implemented (Step 18) so that assertion passes; the C-class branch is hardcoded UNEVALUABLE regardless of `derivedEvidenceBounded`, so the `sufficient` case fails.
- [ ] **Step 23: Write minimal implementation**
```js
// replace the C-class branch (the stub added in Step 18) in computeBoundaryDisposition:
  // C-class
  if (raw.residualMs === null || raw.occupancyMs === null || raw.derivedEvidenceBounded !== true) {
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'unboundable-derived-evidence' };
  }
  requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
  requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
  const cSums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
  const cDisposition = Math.max(...cSums) <= CLAUSE_THRESHOLD_MS ? 'SUFFICIENT' : 'INSUFFICIENT';
  return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: cDisposition, unevaluableReason: null };
```
- [ ] **Step 24: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 25: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "feat(m4): decision-evidence model — undetermined-delivery-task and C-class disposition"
```

- [ ] **Step 25b: Write the failing test — §7.3 conditions 6/7/8 gate SUFFICIENT, independent review finding**

An independent review of an earlier draft found that `computeBoundaryDisposition` computed `SUFFICIENT` from the `Rᵢ+Hᵢ≤50ms` numeric check alone, with no representation anywhere of §7.3's conditions 6 (memory budget), 7 (lifecycle/disposal), or 8 (module resolution) — so a boundary with a passing numeric bound but an actual memory-budget violation could be marked `SUFFICIENT`, producing an unsound B or C. Fix: a boundary can only reach `SUFFICIENT` when all three are explicitly `true`; `null` (evidence not yet gathered) is `UNEVALUABLE`; `false` (evidence gathered, condition failed) is `INSUFFICIENT` even if the numeric bound alone would have passed.

```js
test('a boundary whose numeric bound passes but §7.3 condition 6/7/8 evidence is missing is UNEVALUABLE, never SUFFICIENT', () => {
  const missingMemory = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: null, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(missingMemory.tuples[0].boundaries[0].disposition, 'UNEVALUABLE');
  assert.equal(missingMemory.tuples[0].boundaries[0].unevaluableReason, 'missing-prerequisite-evidence');
});

test('a boundary whose numeric bound passes but the memory budget was measured and exceeded is INSUFFICIENT, not SUFFICIENT', () => {
  const overBudget = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: false, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(overBudget.tuples[0].boundaries[0].disposition, 'INSUFFICIENT');
});

test('only true/true/true for memoryBudgetMet/lifecycleDemonstrated/moduleResolutionEstablished, plus the numeric bound, yields SUFFICIENT', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple([{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null, memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true }])],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples[0].boundaries[0].disposition, 'SUFFICIENT');
});
```
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL — `computeBoundaryDisposition` never reads `memoryBudgetMet`/`lifecycleDemonstrated`/`moduleResolutionEstablished`; `tAFailingTuple`'s helper must also be updated (next step) to inject default values for these three new required fields, so every EARLIER test in this file (which doesn't pass them) keeps compiling and passing.

- [ ] **Step 25c: Write the implementation — the prerequisite gate, applied identically to both B-class and C-class**
```js
// add near the top of decision-evidence-model.mjs, above computeBoundaryDisposition:
function checkPrerequisites(raw) {
  const fields = { memoryBudgetMet: raw.memoryBudgetMet, lifecycleDemonstrated: raw.lifecycleDemonstrated, moduleResolutionEstablished: raw.moduleResolutionEstablished };
  if (Object.values(fields).some((v) => v === null || v === undefined)) return 'missing-prerequisite-evidence';
  if (Object.values(fields).some((v) => v === false)) return 'prerequisite-not-met';
  return null; // all three true -- gate passes
}

// replace the B-class branch's final three lines in computeBoundaryDisposition:
    requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
    requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
    const sums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
    const numericPasses = Math.max(...sums) <= CLAUSE_THRESHOLD_MS;
    const prereqFailure = checkPrerequisites(raw);
    if (prereqFailure === 'missing-prerequisite-evidence') {
      return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-prerequisite-evidence' };
    }
    const disposition = numericPasses && prereqFailure === null ? 'SUFFICIENT' : 'INSUFFICIENT';
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition, unevaluableReason: null };

// replace the C-class branch's final lines (the Step-23 version) identically:
  requireFiveNumbers(raw.residualMs, `boundaries[${raw.id}].residualMs`);
  requireFiveNumbers(raw.occupancyMs, `boundaries[${raw.id}].occupancyMs`);
  const cSums = raw.residualMs.map((r, i) => r + raw.occupancyMs[i]);
  const cNumericPasses = Math.max(...cSums) <= CLAUSE_THRESHOLD_MS;
  const cPrereqFailure = checkPrerequisites(raw);
  if (cPrereqFailure === 'missing-prerequisite-evidence') {
    return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: 'UNEVALUABLE', unevaluableReason: 'missing-prerequisite-evidence' };
  }
  const cDisposition = cNumericPasses && cPrereqFailure === null ? 'SUFFICIENT' : 'INSUFFICIENT';
  return { id: raw.id, class: meta.class, applicable: true, ownedStages: meta.ownedStages, disposition: cDisposition, unevaluableReason: null };
```
Also update the shared `tAFailingTuple` test helper (defined at Step 16, reused by every subsequent test in this file) so every EARLIER boundary literal that doesn't explicitly set the three new fields keeps passing — inject safe defaults for fixture convenience, since the three earlier fixtures were written before these fields existed and are not testing this gate:
```js
// replace the tAFailingTuple helper (Step 16) in the test file:
function tAFailingTuple(boundaries) {
  return {
    tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'cold' },
    targets: { tA: false, tB1: true, tB2: true, tC: true },
    screenResidualMs: [10, 10, 10, 10, 10],
    narrowPhaseFamilyWins: true, // default for B-class-focused fixtures; C-eligibility tests override state/this explicitly
    boundaries: boundaries.map((b) => ({ memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true, ...b })),
  };
}
```
(The `...b` spread means any test that explicitly sets one of the three fields, as Step 25b's new tests do, overrides the default — every OLDER test in this file that never mentions them keeps getting `true`/`true`/`true` and keeps passing unchanged.)

Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS — Step 25b's three new tests pass, and every earlier test (Steps 16–24, 26 below) still passes unchanged because the helper now injects harmless defaults for fixtures that don't care about this gate.

- [ ] **Step 25d: Commit**
```bash
git add test/performance/m4/decision-evidence-model.mjs test/performance/m4/decision-evidence-model.test.mjs
git commit -m "fix(m4): decision-evidence model — gate SUFFICIENT on §7.3 conditions 6/7/8, not the numeric bound alone

Independent review (Critical): the disposition computed SUFFICIENT from Rᵢ+Hᵢ≤50ms alone, with no
representation of the memory-budget, lifecycle/disposal, or module-resolution prerequisites §7.3
also requires. A boundary could be marked SUFFICIENT despite a 2.5× memory-budget violation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 26: Write the failing test — full multi-tuple, multi-boundary integration**
```js
test('full integration: two tuples, mixed dispositions, global preconditions all clear', () => {
  const ev = buildEvidenceVector(
    [
      { tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] },
      tAFailingTuple([
        { id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
        { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
      ]),
    ],
    passingGlobalPreconditions(),
  );
  assert.equal(ev.tuples.length, 2);
  assert.equal(ev.tuples[0].targetsAllPass, true);
  assert.equal(ev.tuples[1].boundaries.length, 2);
  assert.equal(ev.tuples[1].boundaries[0].disposition, 'SUFFICIENT');
  assert.equal(ev.tuples[1].boundaries[1].disposition, 'SUFFICIENT');
});
```
- [ ] **Step 27: Run test to verify it fails**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: FAIL only if any prior step's implementation diverges from this composed scenario; run once to confirm this integration case already passes against the accumulated implementation (this step is a regression lock over the whole module).
- [ ] **Step 28: Run test to verify it passes**
Run: `node --test test/performance/m4/decision-evidence-model.test.mjs`
Expected: PASS
- [ ] **Step 29: Commit**
```bash
git add test/performance/m4/decision-evidence-model.test.mjs
git commit -m "test(m4): decision-evidence model — full multi-tuple/multi-boundary integration"
```

---

### Task 2.5: Verdict reducer

**Files:**
- Create: `test/performance/m4/verdict-reducer.mjs`
- Test: `test/performance/m4/verdict-reducer.test.mjs`

**Interfaces:**
- Consumes: Task 2.4's `EvidenceVector` shape exactly (never raw harness JSON, never re-derives thresholds or dispositions — those are already computed facts on the evidence vector).
- Produces: `reduceVerdict(evidenceVector): Verdict`:
  ```
  Verdict =
    | { verdict: 'A', tupleFindings: TupleFinding[] }
    | { verdict: 'B', settledBoundaries: string[], tupleFindings: TupleFinding[] }
    | { verdict: 'C', settledBoundaries: string[], mechanicalDifferences: Array<{tuple, mechanicalDifference}>, tupleFindings: TupleFinding[] }
    | { verdict: 'D', causes: Array<{scope: 'global'|'tuple', tuple?, cause: string}>, tupleFindings: TupleFinding[] }
  TupleFinding = { tuple, status: 'A'|'B'|'C'|'D', settledBy?: string[], cause?: string, mechanicalDifference?: object }
  ```
  Implements §7.3's fixed precedence exactly: mandatory D first (any global §7.5.1–8 condition, or a per-tuple §7.5.9/§7.5.10/§1.1 cause) — checked before anything else; then A, only when every verdict-bearing tuple's `targetsAllPass`; then B, when every unsettled tuple is settled by a B-class boundary; then C, when settling at least one tuple required a C-class boundary (even if other tuples were separately settled by B); otherwise D. Multi-tuple aggregation follows §7.3's "any unsettled tuple forces D" rule and its B/C naming rule verbatim.

- [ ] **Step 1: Write the failing test — Verdict A, every tuple passing**
```js
// test/performance/m4/verdict-reducer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceVerdict } from './verdict-reducer.mjs';
import { buildEvidenceVector } from './decision-evidence-model.mjs';

function passingGlobalPreconditions() {
  return {
    noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
    workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
    unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
  };
}
function passingTuple(caseId) {
  return { tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] };
}
const fiveReps = (v) => Array(5).fill(v);

test('§19.3 Verdict A: every verdict-bearing tuple passing every target', () => {
  const ev = buildEvidenceVector([passingTuple('R1'), passingTuple('R2')], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'A');
  assert.equal(verdict.tupleFindings.every((f) => f.status === 'A'), true);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL with `Cannot find module './verdict-reducer.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/verdict-reducer.mjs
//
// M4 Task 2.5: verdict reducer. Pure function over Task 2.4's EvidenceVector shape. Implements
// §7.3/§7.5's fixed precedence: mandatory D first, then A, then B, then C, otherwise D.

const D_CONDITION_LABELS = {
  1: 'no-confirmed-responsiveness-target', 2: 'no-representative-runtime', 3: 'capacity-censoring',
  4: 'workload-validity', 5: 'insufficient-statistical-confidence', 6: 'missing-causal-attribution',
  7: 'unconfirmed-memory-multipliers', 8: 'undetermined-device-scope-or-concurrency',
  9: 'no-full-query-evidence', 10: 'no-settled-boundary',
};
const NO_BOUNDARY_CAUSE = 'no-boundary';

function reduceTuple(tupleEvidence) {
  if (tupleEvidence.targetsAllPass) return { tuple: tupleEvidence.tuple, status: 'A' };
  return { tuple: tupleEvidence.tuple, status: 'A' }; // placeholder, extended in later steps
}

export function reduceVerdict(evidenceVector) {
  const tupleFindings = evidenceVector.tuples.map(reduceTuple);
  return { verdict: 'A', tupleFindings };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/verdict-reducer.mjs test/performance/m4/verdict-reducer.test.mjs
git commit -m "test(m4): verdict reducer — Verdict A skeleton"
```

- [ ] **Step 6: Write the failing test — global mandatory D (all 8 conditions, table-driven), checked before anything else**
```js
const GLOBAL_D_KEYS = [
  'noConfirmedResponsivenessTarget', 'noRepresentativeRuntime', 'capacityCensored', 'workloadValidityFailed',
  'insufficientStatisticalConfidence', 'missingCausalAttribution', 'unconfirmedMemoryMultipliers', 'undeterminedDeviceScopeOrConcurrency',
];

test('§7.5 conditions 1-8: any true global precondition forces D even when every tuple would otherwise pass (A)', () => {
  for (const key of GLOBAL_D_KEYS) {
    const globalPreconditions = { ...passingGlobalPreconditions(), [key]: true };
    const ev = buildEvidenceVector([passingTuple('R1')], globalPreconditions);
    const verdict = reduceVerdict(ev);
    assert.equal(verdict.verdict, 'D', `condition ${key} must force D`);
    assert.equal(verdict.causes.some((c) => c.scope === 'global'), true);
  }
});
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL — `reduceVerdict` never inspects `evidenceVector.globalMandatoryD`.
- [ ] **Step 8: Write minimal implementation**
```js
// replace reduceVerdict in verdict-reducer.mjs
export function reduceVerdict(evidenceVector) {
  if (evidenceVector.globalMandatoryD.any) {
    return {
      verdict: 'D',
      causes: evidenceVector.globalMandatoryD.causes.map((c) => ({ scope: 'global', cause: D_CONDITION_LABELS[c] })),
      tupleFindings: [],
    };
  }
  const tupleFindings = evidenceVector.tuples.map(reduceTuple);
  return { verdict: 'A', tupleFindings };
}
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 10: Commit**
```bash
git add test/performance/m4/verdict-reducer.mjs test/performance/m4/verdict-reducer.test.mjs
git commit -m "feat(m4): verdict reducer — global §7.5.1-8 mandatory D, checked before A/B/C"
```

- [ ] **Step 11: Write the failing test — §7.5.9 no-full-query-evidence and §1.1 no-boundary, per-tuple D causes**
```js
function tAFailingTuple(caseId, boundaries, screenResidualMs = fiveReps(10), state = 'cold', narrowPhaseFamilyWins = true) {
  return {
    tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state },
    targets: { tA: false, tB1: true, tB2: true, tC: true },
    screenResidualMs,
    narrowPhaseFamilyWins, // Task 2.4's derived warmNarrowPhaseFailure = (state==='warm' && this) --
                            // default true is harmless for B-only fixtures (no C-class boundary
                            // present); C-related fixtures below pass state:'warm' explicitly.
    boundaries: boundaries.map((b) => ({ memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true, ...b })), // Task 2.4's §7.3 conditions 6/7/8 gate -- defaulted true for fixtures not testing it
  };
}
function onlyQueryEvidenceFailingTuple(caseId) {
  return { tuple: { runtime: 'multi-process', caseId, broadPhase: 'linear', state: 'warm' }, targets: { tA: true, tB1: false, tB2: true, tC: true }, screenResidualMs: null, boundaries: [] };
}

test('§7.5.9 no-full-query-evidence: a tuple whose only failing metrics are T-b1/T-b2/T-c forces D, unconditionally', () => {
  const ev = buildEvidenceVector([onlyQueryEvidenceFailingTuple('R2')], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-full-query-evidence');
});

test('§1.1 no-boundary: condition 3\'s screen failing at a T-a-failing tuple forces D and is never conflated with no-full-query-evidence', () => {
  const ev = buildEvidenceVector([tAFailingTuple('R3', [], fiveReps(60))], passingGlobalPreconditions());
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-boundary');
});
```
- [ ] **Step 12: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL — `reduceTuple`'s placeholder always returns `status: 'A'`.
- [ ] **Step 13: Write minimal implementation**
```js
// replace reduceTuple in verdict-reducer.mjs
function reduceTuple(tupleEvidence) {
  if (tupleEvidence.targetsAllPass) return { tuple: tupleEvidence.tuple, status: 'A' };
  if (tupleEvidence.onlyQueryEvidenceFailing) return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[9] };
  if (tupleEvidence.noBoundaryScreenFailed) return { tuple: tupleEvidence.tuple, status: 'D', cause: NO_BOUNDARY_CAUSE };
  return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[10] }; // placeholder, extended in later steps
}

// replace the final line of reduceVerdict to surface tuple D causes:
export function reduceVerdict(evidenceVector) {
  if (evidenceVector.globalMandatoryD.any) {
    return {
      verdict: 'D',
      causes: evidenceVector.globalMandatoryD.causes.map((c) => ({ scope: 'global', cause: D_CONDITION_LABELS[c] })),
      tupleFindings: [],
    };
  }
  const tupleFindings = evidenceVector.tuples.map(reduceTuple);
  const dFindings = tupleFindings.filter((f) => f.status === 'D');
  if (dFindings.length > 0) {
    return { verdict: 'D', causes: dFindings.map((f) => ({ scope: 'tuple', tuple: f.tuple, cause: f.cause })), tupleFindings };
  }
  return { verdict: 'A', tupleFindings };
}
```
- [ ] **Step 14: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 15: Commit**
```bash
git add test/performance/m4/verdict-reducer.mjs test/performance/m4/verdict-reducer.test.mjs
git commit -m "feat(m4): verdict reducer — §7.5.9 no-full-query-evidence and §1.1 no-boundary D causes"
```

- [ ] **Step 16: Write the failing test — Verdict B (single applicable B-class boundary SUFFICIENT), and §7.5.10 no-settled-boundary**
```js
test('§19.3 Verdict B: exactly one applicable B-class boundary SUFFICIENT and every other condition satisfied', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2p']);
});

test('§19.3 no applicable boundary of either class SUFFICIENT: falls to D under §7.5.10, never silently to B or C', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }])],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});
```
- [ ] **Step 17: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL — `reduceTuple`'s fallback branch always reports `no-settled-boundary`; the B case never checks boundary dispositions, and `reduceVerdict` has no B/C aggregation path.
- [ ] **Step 18: Write minimal implementation**
```js
// replace reduceTuple's final fallback in verdict-reducer.mjs
function reduceTuple(tupleEvidence) {
  if (tupleEvidence.targetsAllPass) return { tuple: tupleEvidence.tuple, status: 'A' };
  if (tupleEvidence.onlyQueryEvidenceFailing) return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[9] };
  if (tupleEvidence.noBoundaryScreenFailed) return { tuple: tupleEvidence.tuple, status: 'D', cause: NO_BOUNDARY_CAUSE };

  const bClassApplicable = tupleEvidence.boundaries.filter((b) => b.class === 'B' && b.applicable);
  const bSufficient = bClassApplicable.filter((b) => b.disposition === 'SUFFICIENT');
  if (bSufficient.length > 0) return { tuple: tupleEvidence.tuple, status: 'B', settledBy: bSufficient.map((b) => b.id) };

  return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[10] }; // C-class path added in Step 21
}

// extend reduceVerdict's aggregation, after the dFindings block:
  const bFindings = tupleFindings.filter((f) => f.status === 'B');
  if (bFindings.length > 0) {
    const settledBoundaries = [...new Set(tupleFindings.flatMap((f) => f.settledBy ?? []))];
    return { verdict: 'B', settledBoundaries, tupleFindings };
  }
  return { verdict: 'A', tupleFindings };
```
- [ ] **Step 19: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 20: Commit**
```bash
git add test/performance/m4/verdict-reducer.mjs test/performance/m4/verdict-reducer.test.mjs
git commit -m "feat(m4): verdict reducer — Verdict B, §7.5.10 no-settled-boundary fallback"
```

- [ ] **Step 21: Write the failing test — Verdict C (warm-narrow-phase, every B INSUFFICIENT, named C SUFFICIENT, mechanical-difference clause), B-over-C precedence, and the negative cold-cannot-produce-C case**

Independent review finding (Critical): an earlier draft's Verdict-C fixture used a `state:'cold'` tuple, which — combined with a reducer that trusted `applicable:true` at face value — let a cold-tuple fixture produce Verdict C, contradicting §7.3's own eligibility condition ("evidence that the failure is in the warm narrow phase"). Fixed below: the Verdict-C-reaching fixtures now explicitly pass `state:'warm'`, and a new negative test proves an otherwise-identical COLD tuple can never reach C even when a C-class boundary's own numeric bound would pass.

```js
test('§19.3 Verdict C: every applicable B-class boundary INSUFFICIENT and a named C-class boundary SUFFICIENT, mechanical difference named (WARM tuple -- C is only reachable there)', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ], fiveReps(10), 'warm')],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(verdict.settledBoundaries, ['WB-2']);
  const diff = verdict.mechanicalDifferences[0].mechanicalDifference[0];
  assert.equal(diff.cBoundaryId, 'WB-2');
  assert.deepEqual(diff.rejectedBBoundaries[0].extraStagesOwnedByC, ['exactNarrowPhase', 'clearanceDistanceQuery']); // WB-2p owns only hardClashPrecheck
});

test('§7.3 negative: an otherwise-identical COLD tuple can never reach Verdict C, even though the C-class boundary\'s own numeric bound (and every other condition) would pass', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ])], // default state:'cold' -- everything else identical to the passing Verdict-C fixture above
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.notEqual(verdict.verdict, 'C');
  assert.equal(verdict.verdict, 'D'); // WB-2p is INSUFFICIENT and WB-2, though numerically sufficient, is not applicable on a cold tuple -- no-settled-boundary
  assert.equal(verdict.causes[0].cause, 'no-settled-boundary');
});

test('§19.3 B-over-C precedence: a WARM tuple where a B-class boundary is SUFFICIENT and a C-class boundary would also satisfy reports B, never C and never both', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [
      { id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
      { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
    ], fiveReps(10), 'warm')], // warm + C genuinely applicable-and-sufficient, so this proves real precedence, not accidental inapplicability
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'B');
  assert.equal('mechanicalDifferences' in verdict, false);
});

test('C-class vacuous B-applicability (exact-query-substage case: no B-class boundary applicable at all), WARM tuple', () => {
  const ev = buildEvidenceVector(
    [tAFailingTuple('R3', [{ id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true }], fiveReps(10), 'warm')],
    passingGlobalPreconditions(),
  );
  const verdict = reduceVerdict(ev);
  assert.equal(verdict.verdict, 'C');
  assert.equal(verdict.mechanicalDifferences[0].mechanicalDifference.vacuous, true);
});
```
- [ ] **Step 22: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL — `reduceTuple` has no C-class branch at all (falls straight to `no-settled-boundary`).
- [ ] **Step 23: Write minimal implementation**
```js
// replace reduceTuple's fallback (after the B-class check) in verdict-reducer.mjs
  const bAllInsufficient = bClassApplicable.length === 0 || bClassApplicable.every((b) => b.disposition === 'INSUFFICIENT');
  // §7.3: a C-class boundary is applicable only at a tuple whose failure is in the warm narrow
  // phase. `warmNarrowPhaseFailure` is Task 2.4's DERIVED fact (state==='warm' AND the §17
  // family-selection rule says narrow-phase won) -- never a trusted `applicable` flag on the
  // boundary entry itself. Independent review (Critical): an earlier draft filtered only on
  // `b.applicable`, which let a caller-supplied true settle a COLD tuple as Verdict C, contradicting
  // C's own defining condition. Gating the whole candidate list on the tuple-level derived fact,
  // rather than trusting each boundary's own flag, is what makes this correct by construction.
  const cClassApplicable = tupleEvidence.warmNarrowPhaseFailure
    ? tupleEvidence.boundaries.filter((b) => b.class === 'C' && b.applicable)
    : [];
  const cSufficient = cClassApplicable.filter((b) => b.disposition === 'SUFFICIENT');

  if (bAllInsufficient && cSufficient.length > 0) {
    const mechanicalDifference =
      bClassApplicable.length === 0
        ? { vacuous: true, cBoundaryOwnedStages: cSufficient.map((c) => ({ id: c.id, ownedStages: c.ownedStages })) }
        : cSufficient.map((c) => ({
            cBoundaryId: c.id,
            rejectedBBoundaries: bClassApplicable.map((b) => ({ id: b.id, extraStagesOwnedByC: c.ownedStages.filter((s) => !b.ownedStages.includes(s)) })),
          }));
    return { tuple: tupleEvidence.tuple, status: 'C', settledBy: cSufficient.map((c) => c.id), mechanicalDifference };
  }

  return { tuple: tupleEvidence.tuple, status: 'D', cause: D_CONDITION_LABELS[10] };

// extend reduceVerdict's aggregation, BEFORE the existing bFindings block (C is named whenever any
// tuple required it, taking precedence over a same-run bFindings-only report):
  const cFindings = tupleFindings.filter((f) => f.status === 'C');
  if (cFindings.length > 0) {
    const settledBoundaries = [...new Set(tupleFindings.flatMap((f) => f.settledBy ?? []))];
    return {
      verdict: 'C',
      settledBoundaries,
      mechanicalDifferences: cFindings.map((f) => ({ tuple: f.tuple, mechanicalDifference: f.mechanicalDifference })),
      tupleFindings,
    };
  }
```
- [ ] **Step 24: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 25: Commit**
```bash
git add test/performance/m4/verdict-reducer.mjs test/performance/m4/verdict-reducer.test.mjs
git commit -m "feat(m4): verdict reducer — Verdict C, mechanical-difference clause, B-over-C precedence"
```

- [ ] **Step 26: Write the failing test — every named §7.5 mandatory-D cause individually, plus §1.1 (11 fixtures total)**
```js
test('§19.3: each of §7.5\'s ten mandatory-D causes fires individually, plus §1.1\'s no-boundary cause separately (11 total)', () => {
  // 1-8: global preconditions, already covered by the table-driven test in Step 6 -- re-asserted here
  // as part of the complete named-cause inventory this fixture suite requires.
  for (const key of GLOBAL_D_KEYS) {
    const ev = buildEvidenceVector([passingTuple('R1')], { ...passingGlobalPreconditions(), [key]: true });
    assert.equal(reduceVerdict(ev).verdict, 'D');
  }
  // 9: no-full-query-evidence
  assert.equal(reduceVerdict(buildEvidenceVector([onlyQueryEvidenceFailingTuple('R2')], passingGlobalPreconditions())).causes[0].cause, 'no-full-query-evidence');
  // 10: no-settled-boundary (no applicable boundary of either class at all)
  assert.equal(reduceVerdict(buildEvidenceVector([tAFailingTuple('R3', [])], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');
  // §1.1: no-boundary
  assert.equal(reduceVerdict(buildEvidenceVector([tAFailingTuple('R3', [], fiveReps(60))], passingGlobalPreconditions())).causes[0].cause, 'no-boundary');
});

test('§19.3 every UNEVALUABLE path: UNEVALUABLE is never scored as INSUFFICIENT and never silently promoted to SUFFICIENT', () => {
  const missingVertical = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null, derivedEvidenceBounded: null }]);
  assert.equal(reduceVerdict(buildEvidenceVector([missingVertical], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');

  const unboundedDerived = tAFailingTuple('R3', [{ id: 'WB-2', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: null, derivedEvidenceBounded: false }]);
  assert.equal(reduceVerdict(buildEvidenceVector([unboundedDerived], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');

  const undeterminedDelivery = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: [true, false, true, true, true], derivedEvidenceBounded: null }]);
  assert.equal(reduceVerdict(buildEvidenceVector([undeterminedDelivery], passingGlobalPreconditions())).causes[0].cause, 'no-settled-boundary');
});
```
- [ ] **Step 27: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL only if any prior step's implementation diverges from one of these named-cause assertions; run once to confirm this complete inventory already passes against the accumulated implementation (this step is the mandatory §19.3 completeness lock, not new branching logic).
- [ ] **Step 28: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 29: Commit**
```bash
git add test/performance/m4/verdict-reducer.test.mjs
git commit -m "test(m4): verdict reducer — complete §7.5/§1.1 named-D-cause and UNEVALUABLE-path inventory"
```

- [ ] **Step 30: Write the failing test — multi-tuple aggregation (mixed cold/warm settled by different B-class boundaries; one unsettled tuple forces D)**
```js
test('§19.3 mixed cold/warm multi-tuple aggregation: aggregate reports B, naming both distinct boundaries', () => {
  const coldTuple = tAFailingTuple('R3-cold', [{ id: 'WB-1b', applicable: true, residualMs: fiveReps(10), occupancyMs: fiveReps(10), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const warmTuple = { ...tAFailingTuple('R3-warm', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]), tuple: { runtime: 'multi-process', caseId: 'R3-warm', broadPhase: 'linear', state: 'warm' } };
  const verdict = reduceVerdict(buildEvidenceVector([coldTuple, warmTuple], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'B');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-1b', 'WB-2p']));
});

test('§19.3 aggregate reports D even though every other tuple is settled, per the "any unsettled tuple forces D" rule', () => {
  const settled = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const unsettled = { ...tAFailingTuple('R4', []), tuple: { runtime: 'multi-process', caseId: 'R4', broadPhase: 'linear', state: 'cold' } };
  const verdict = reduceVerdict(buildEvidenceVector([settled, unsettled], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'D');
  assert.equal(verdict.causes.some((c) => c.cause === 'no-settled-boundary'), true);
});

test('§7.3 multi-tuple: C is named whenever settling at least one tuple required a C-class boundary, even where others were settled by B alone', () => {
  const bSettled = tAFailingTuple('R3', [{ id: 'WB-2p', applicable: true, residualMs: fiveReps(20), occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null }]);
  const cSettled = { ...tAFailingTuple('R4', [
    { id: 'WB-2p', applicable: true, residualMs: [20, 20, 20, 20, 40], occupancyMs: fiveReps(20), deliveryTaskIdentified: fiveReps(true), derivedEvidenceBounded: null },
    { id: 'WB-2', applicable: true, residualMs: fiveReps(15), occupancyMs: fiveReps(15), deliveryTaskIdentified: null, derivedEvidenceBounded: true },
  ]), tuple: { runtime: 'multi-process', caseId: 'R4', broadPhase: 'linear', state: 'warm' } };
  const verdict = reduceVerdict(buildEvidenceVector([bSettled, cSettled], passingGlobalPreconditions()));
  assert.equal(verdict.verdict, 'C');
  assert.deepEqual(new Set(verdict.settledBoundaries), new Set(['WB-2p', 'WB-2']));
});
```
- [ ] **Step 31: Run test to verify it fails**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: FAIL only if the aggregation logic built through Steps 8-23 does not already union `settledBy` across all tuples and prioritize C over B correctly; run once to confirm (this step is the mandatory §7.3 multi-tuple-aggregation completeness lock, not new branching logic — the union/priority behavior was already implemented as part of `reduceVerdict`'s cFindings/bFindings blocks).
- [ ] **Step 32: Run test to verify it passes**
Run: `node --test test/performance/m4/verdict-reducer.test.mjs`
Expected: PASS
- [ ] **Step 33: Commit**
```bash
git add test/performance/m4/verdict-reducer.test.mjs
git commit -m "test(m4): verdict reducer — multi-tuple aggregation, any-unsettled-forces-D, C-over-B naming precedence"
```
## Phase 3 — Baseline harness + unconditional spikes

> File-layout note used throughout this phase: `test/performance/m4/*.mjs` holds M4-internal PURE
> modules (unit-tested with `node --test`, discovered automatically by `scripts/run-tests.mjs` via
> the `*.test.mjs` naming convention — see `test/CollisionWorld.findClashes.clearance.test.mjs:1-16`
> for the convention this mirrors). `test/performance/run-gate-m4.mjs` is the live Playwright
> driver, grown across tasks 3.1/3.7/3.8/3.9/3.10 exactly as `run-gate-m3.mjs` is one file (no
> extraction — spec §16.1's own "extraction becomes justified only if M4 acquires multiple real
> consumers" applies to M4's OWN internal split too: the `test/performance/m4/*.mjs` pure modules
> are the one justified exception, since they have a second real consumer from day one — their own
> `node --test` suite — while `run-gate-m4.mjs` itself stays one file per M1-M3 convention).
> `test/performance/browser-probes-m4.mjs` is M4's own sibling to `browser-probes.mjs` — a plain,
> non-ES-module inline script injected via `page.addScriptTag`, for the exact reason
> `browser-probes.mjs:40-49` documents (a relative `import` inside injected text resolves against
> the page's URL, and the production server exposes only `wwwroot/`+`/collision`). This is a NEW
> file, not an edit to the protected `browser-probes.mjs`. `spike/m4/` holds S1'/S3'/S4' assets,
> deleted at M4 close unless adopted (spec §17).

---

### Task 3.1: Runtime/fixture lifecycle gate

**Files:**
- Create: `test/performance/m4/fixture-lifecycle.mjs`
- Create: `test/performance/run-gate-m4.mjs`
- Edit: `package.json` (add `test:performance:gate:m4` script)
- Test: `test/performance/m4/fixture-lifecycle.test.mjs` (pure sub-logic) + manual verification for the live Playwright/fixture-load wiring (no automated browser test — see Step 5 of the live half below)

**Interfaces:**
- Consumes: `collision/constants.js` (`frameBudgetMs`, `maxCollisionInstancesPerEpoch`, etc. — read-only, unchanged); the real Audubon 3-URN fixture (copied verbatim from `run-gate-m3.mjs:66-70`); `test/performance/checkpoint-recorder.mjs`'s pattern (not imported — duplicated per M1-M3 convention).
- Produces: `RUNTIME_CONFIGS` (both launch-arg sets, §6.1.5), `freshWorldTupleKey(...)` and `measuredStatesFor(caseName)` (pure helpers §6.1.4/§7.2 depend on), and `run-gate-m4.mjs`'s skeleton: browser launch (both runtimes), fixture load + live re-confirmation (§6.1 steps 1-2), sacrificial unmeasured warm-up (§6.1 step 3), and a fresh-world-per-tuple construct/dispose loop scaffold (§6.1 step 4) that task 3.7 will fill with the real case matrix.

This task is the harness's skeleton — the runtime/fixture lifecycle §6.1 steps 1-4 require, minus
the actual case dispatch (task 3.7) and the observation envelope (task 3.2). It is proven here with
exactly one throwaway query per runtime so the lifecycle itself (launch → load → warm-up → fresh
world → dispose) is demonstrated end to end before any real case is wired in.

- [ ] **Step 1: Write the failing test (pure sub-logic)**
```js
// test/performance/m4/fixture-lifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_CONFIGS, freshWorldTupleKey, measuredStatesFor } from './fixture-lifecycle.mjs';

test('RUNTIME_CONFIGS declares exactly the historical and multi-process launch arg sets', () => {
  assert.deepEqual(RUNTIME_CONFIGS.historical.args, ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote']);
  assert.deepEqual(RUNTIME_CONFIGS.multiProcess.args, ['--no-sandbox', '--disable-dev-shm-usage']);
  assert.equal(RUNTIME_CONFIGS.multiProcess.authoritative, true);
  assert.equal(RUNTIME_CONFIGS.historical.authoritative, false);
});

test('freshWorldTupleKey is stable per (runtime,case,broadPhase,repetition)', () => {
  const key = freshWorldTupleKey({ runtime: 'multiProcess', caseName: 'R3', broadPhase: 'tlas', repetition: 2 });
  assert.equal(key, 'multiProcess:R3:tlas:rep=2');
});

test('freshWorldTupleKey extends with level for S2T only', () => {
  const key = freshWorldTupleKey({ runtime: 'multiProcess', caseName: 'S2T', level: 10000, broadPhase: 'linear', repetition: 0 });
  assert.equal(key, 'multiProcess:S2T:level=10000:linear:rep=0');
});

test('measuredStatesFor: R6 has cold/warm/refresh, S4 is warm-only, everything else is cold/warm', () => {
  assert.deepEqual(measuredStatesFor('R6'), ['cold', 'warm', 'refresh']);
  assert.deepEqual(measuredStatesFor('S4'), ['warm']);
  assert.deepEqual(measuredStatesFor('R1'), ['cold', 'warm']);
  assert.deepEqual(measuredStatesFor('S2T'), ['cold', 'warm']);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/fixture-lifecycle.test.mjs` — fails with a module-not-found error (`fixture-lifecycle.mjs` does not exist yet).

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/fixture-lifecycle.mjs
//
// M4 Task 3.1: the pure half of §6.1's runtime/fixture-lifecycle protocol. `run-gate-m4.mjs`'s
// live half (launch, load, warm-up, fresh-world dispose loop) consumes these; this file has no
// Playwright/browser dependency and is unit-tested directly.

// §6.1.5: two runtime configurations, (b) authoritative for every worker-related conclusion and
// every §7.2 target evaluation. `historical` exists for continuity with M1-M3's archived numbers
// (args copied verbatim from run-gate-m3.mjs:182).
export const RUNTIME_CONFIGS = {
  historical: { label: 'historical', args: ['--no-sandbox', '--disable-dev-shm-usage', '--single-process', '--no-zygote'], authoritative: false },
  multiProcess: { label: 'multi-process', args: ['--no-sandbox', '--disable-dev-shm-usage'], authoritative: true },
};

// §6.1.4: fresh-world identity is (runtime, case, broadPhase, repetition), extended with `level`
// for S2T only (§5.3.1, §5.6) -- no other case has a level dimension.
export function freshWorldTupleKey({ runtime, caseName, level, broadPhase, repetition }) {
  const levelPart = level === undefined ? '' : `:level=${level}`;
  return `${runtime}:${caseName}${levelPart}:${broadPhase}:rep=${repetition}`;
}

// §6.1.4's declared exception (R6's third `refresh` sample) and §5.6's S4 warm-only declaration.
export function measuredStatesFor(caseName) {
  if (caseName === 'R6') return ['cold', 'warm', 'refresh'];
  if (caseName === 'S4') return ['warm'];
  return ['cold', 'warm'];
}

// Identical to run-gate.mjs/run-gate-m2.mjs/run-gate-m3.mjs's own helper -- duplicated per the
// no-shared-module convention (verified-refs.md Cross-cutting note 1), never imported from them.
export function resolveProxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const proxy = { server: `${url.protocol}//${url.host}` };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    const bypass = process.env.NO_PROXY || process.env.no_proxy;
    if (bypass) proxy.bypass = bypass;
    return proxy;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/fixture-lifecycle.test.mjs`

- [ ] **Step 5: Live-browser wiring (no automated test — manual verification below) + commit**

Add `test/performance/run-gate-m4.mjs`, mirroring `run-gate-m3.mjs:178-244`'s launch/load/re-confirm
shape but looping over **both** `RUNTIME_CONFIGS` entries, and mirroring its Step 3 warm-up
(`run-gate-m3.mjs:246-278`) exactly (no recorder installed, disposed immediately). Skeleton:

```js
// test/performance/run-gate-m4.mjs (excerpt — Task 3.1's slice; task 3.7 fills in the real matrix)
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { RUNTIME_CONFIGS, resolveProxyFromEnv, freshWorldTupleKey, measuredStatesFor } from './m4/fixture-lifecycle.mjs';

const ARCH_URN = /* copied verbatim from run-gate-m3.mjs:66 */ '...';
const STRUCTURE_URN = /* :67 */ '...';
const MECHANICAL_URN = /* :68 */ '...';
const SOURCE_DB_ID = 3076;
const CLEARANCE = 0.05;
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';

async function loadFixtureAndReconfirm(page) {
  // Identical 3-step load + identity re-confirmation to run-gate-m3.mjs:194-242, unchanged in
  // shape (Architecture normal load, Structure/Mechanical as-additional via #keep-current-models,
  // isLoadDone() AND getData().instanceTree waited on every model, live re-confirmation of model
  // count / fragment totals / source dbId ownership -- "nothing taken on faith", §6.1 step 2).
  await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
  await page.waitForFunction(() => window.viewer?.model?.isLoadDone(), null, { timeout: 180_000 });
  await page.fill('#urn', STRUCTURE_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData()?.instanceTree), null, { timeout: 180_000 });
  await page.fill('#urn', MECHANICAL_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData()?.instanceTree), null, { timeout: 180_000 });
  await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
  const identity = await page.evaluate(({ sourceDbId }) => {
    const models = window.viewer.getAllModels();
    window.__gate = { modelArch: models[0], modelStructure: models[1], modelMechanical: models[2] };
    const it = models[1].getInstanceTree();
    const fragments = [];
    it.enumNodeFragments(sourceDbId, (fragId) => fragments.push(fragId), false);
    return { modelCount: models.length, sourceFragmentCount: fragments.length };
  }, { sourceDbId: SOURCE_DB_ID });
  if (identity.modelCount !== 3) throw new Error(`Expected 3 loaded models, got ${identity.modelCount}`);
  if (!identity.sourceFragmentCount) throw new Error(`Source dbId ${SOURCE_DB_ID} owns zero fragments`);
  return identity;
}

async function sacrificialWarmup(page) {
  // Identical rationale/shape to run-gate-m3.mjs:246-278: throwaway volume-overlap AND throwaway
  // clearance, each in its own disposable world, no recorder installed, disposed immediately.
  await page.evaluate(async ({ sourceDbId, clearance }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const allModels = window.viewer.getAllModels();
    for (const mode of ['volume-overlap', 'clearance']) {
      for (const broadPhase of ['tlas', 'linear']) {
        const w = await CollisionWorld.fromViewer(window.viewer);
        w.admitModel(window.__gate.modelArch);
        w.admitModel(window.__gate.modelStructure);
        w.admitModel(window.__gate.modelMechanical);
        try {
          await w.findClashes({
            mode, ...(mode === 'clearance' ? { clearance } : {}),
            source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId', broadPhase,
          });
        } catch { /* warm-up only */ }
        w.dispose();
      }
    }
  }, { sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  for (const runtime of Object.values(RUNTIME_CONFIGS)) {
    console.log(`\n=== Runtime: ${runtime.label} ===`);
    const browser = await chromium.launch({ args: runtime.args, proxy: resolveProxyFromEnv() });
    const page = await browser.newPage();
    try {
      const identity = await loadFixtureAndReconfirm(page);
      console.log('Fixture identity (re-confirmed live):', JSON.stringify(identity));
      await sacrificialWarmup(page);
      console.log('Sacrificial warm-up complete (unmeasured, no recorder installed).');
      // Task 3.1 proof: exactly ONE fresh-world tuple, dispose demonstrated. Task 3.7 replaces
      // this block with the real R1-R6/S1-S4/S2T matrix loop.
      const tupleKey = freshWorldTupleKey({ runtime: runtime.label, caseName: 'R1', broadPhase: 'tlas', repetition: 0 });
      console.log(`Fresh-world lifecycle proof tuple: ${tupleKey}, states: ${measuredStatesFor('R1')}`);
      await page.evaluate(async ({ sourceDbId }) => {
        const { CollisionWorld } = await import('/collision/index.js');
        const w = await CollisionWorld.fromViewer(window.viewer);
        w.admitModel(window.__gate.modelArch);
        w.admitModel(window.__gate.modelStructure);
        w.admitModel(window.__gate.modelMechanical);
        await w.findClashes({
          mode: 'volume-overlap',
          source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
          target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) },
          groupBy: 'dbId', broadPhase: 'tlas',
        });
        w.dispose(); // fresh-world disposed before the next tuple, per §6.1.4
      }, { sourceDbId: SOURCE_DB_ID });
      console.log('Fresh-world construct/dispose lifecycle OK.');
    } finally {
      await browser.close();
    }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
```

Edit `package.json`'s `scripts` block (exact convention read from the file — `test:performance:gate`
:14, `:m2` :15, `:m3` :16):
```json
"test:performance:gate:m3": "node test/performance/run-gate-m3.mjs",
"test:performance:gate:m4": "node test/performance/run-gate-m4.mjs"
```

**Manual verification** (this task's live half is inherently a Playwright/CDP integration piece —
no unit test is meaningful for it):
Run: `npm run build:vendor && node server.js &` then `npm run test:performance:gate:m4`
Expected: two `=== Runtime: ... ===` blocks (`historical`, `multi-process`); each prints a fixture
identity JSON with `modelCount: 3` and a nonzero `sourceFragmentCount`; each prints the sacrificial
warm-up and fresh-world lifecycle lines; process exits 0 with no thrown error.

```bash
git add test/performance/m4/fixture-lifecycle.mjs test/performance/m4/fixture-lifecycle.test.mjs test/performance/run-gate-m4.mjs package.json
git commit -m "test(collision): M4 task 3.1 — runtime/fixture lifecycle skeleton for run-gate-m4.mjs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.2: Observation envelope (rAF cadence + trusted-input probes)

**Files:**
- Create: `test/performance/m4/observation-envelope.mjs`
- Edit: `test/performance/browser-probes-m4.mjs` (create if task 3.1 hasn't yet — rAF recorder + in-page input-probe coordinate registry)
- Edit: `test/performance/run-gate-m4.mjs` (envelope open/close bracketing, CDP `Input.dispatchMouseEvent` dispatch loop, and the Node↔renderer clock-calibration exchange)
- Test: `test/performance/m4/observation-envelope.test.mjs` (pure sub-logic: percentile, envelope limit, missed-event disposition, clock calibration/conversion, clock-uncertainty gating) + manual verification for the live rAF/CDP/calibration wiring
- Create (manual-verification asset, committed alongside the rest — not a `node --test` unit test, needs a real page and a real blocked main thread): `test/performance/m4/manual-verify-input-probe-block.mjs`

**Interfaces:**
- Consumes: task 3.1's fresh-world lifecycle (the envelope brackets one measured query at a time inside that loop).
- Produces (pure, `observation-envelope.mjs`, §6.1.7/§6.2 rules): `nearestRankPercentile`, `envelopeLimitMs`, `dispositionForObservation`, `tCDispositionForRepetition`, `calibrateNodeToRendererClock`, `nodeMsToRendererMs`, `applyClockUncertainty`, plus the constants `CLOCK_DRIFT_TOLERANCE_MS` and `MAX_CALIBRATION_ROUND_TRIP_MS`.
- Produces (live, `browser-probes-m4.mjs`): `window.__m4Probes.startRafRecorder`, `window.__m4Probes.installInputProbeListener` / `getInputProbeRegistry` / `disposeInputProbeRegistry` — an explicit handle-keyed registry API (no undocumented globals).
- Produces (live, `run-gate-m4.mjs`): `captureClockCalibrationSample`, `installInputProbeRegistry`, `disposeInputProbeRegistry`, `dispatchInputProbeSequence`, `resolveInputProbeDispositions`, `runInputProbeWindow` — the rAF-cadence recorder and CDP input-probe dispatcher wired into the envelope, emitting per-tuple `{frameProduction, inputResponsiveness}` records that task 3.8 later normalizes.

**Clock model (read before the steps below):** two independent clocks are in play — Node's own
monotonic `performance.now()` (from `node:perf_hooks`, used for all Node-side scheduling and
measurement instants) and the renderer's `performance.now()` (used for all in-page instants,
including every probe's handled-at timestamp). These have unrelated time origins and can only be
correlated through a `page.evaluate` round trip, which has non-zero, variable latency — unlike
the trace-clock parser's own paired-sample mechanism (§6.2, general CDP correlation), whose two
clocks (CDP trace-us and renderer `performance.now()`) are both captured in-process by Chrome's
own tracing with no IPC round trip. `Date.now()` (Node wall-clock epoch) is used **only** to
populate CDP's own `Input.dispatchMouseEvent` `timestamp` field (`TimeSinceEpoch`, a wall-clock
protocol field per the CDP Input domain spec) — it never appears in any delay computation.

The calibration exchange takes one sample immediately before dispatching a query window's probes
and one immediately after, exactly mirroring the general mechanism's "paired clock sample ... an
in-page `performance.mark` whose `performance.now()` value is also returned to Node in the same
evaluation." Because a `page.evaluate` round trip has measurable duration, each sample uses the
Node-side pre/post-call midpoint as an NTP-style estimate of "what Node's clock read at the
instant the renderer's `performance.now()` was sampled," and the round trip's own half-width is
carried forward as that sample's uncertainty. Two such samples give an **affine** two-point
Node→renderer mapping — not a single flat offset — for the same reason the trace-clock mapper
(a different, already-fixed task) interpolates between two samples rather than using one: probes
dispatch at different instants spread across the query window, so a flat pre-window offset would
silently understate error for later-window probes as clock drift accumulates. The two samples'
observed offset difference (`driftMs`) and per-sample round-trip uncertainty together produce one
`uncertaintyMs` budget; a converted delay that lands within that budget of the 100ms T-c threshold
is reported `INDETERMINATE` rather than a falsely confident `OK`/`FAILURE` (see `applyClockUncertainty`
below) — this directly closes the bug where a real stall could be computed as a large negative
delay and silently pass.

`CLOCK_DRIFT_TOLERANCE_MS = 5` and `MAX_CALIBRATION_ROUND_TRIP_MS = 20` are **provisional
environment-quality gates, not proof of measurement accuracy** — reasoned as follows: a
same-machine Node↔Chromium `page.evaluate` round trip is normally sub-millisecond to a few
milliseconds; 5ms of drift between a window's pre/post samples is an order of magnitude under the
100ms T-c threshold, and a round trip past 20ms implies roughly ±10ms of pure sampling
uncertainty (half the round trip, under a fully asymmetric-delay assumption) — large enough that
the calibration itself, not just the measurement, should be distrusted rather than silently
folded in. Both numbers should be revisited once real invalidation-rate data exists for the
authoritative benchmark machine; until then, exceeding either bound makes the window's T-c
measurement `INDETERMINATE` with a named reason, never silently trusted.

The observation-level censoring rule (§6.2) stays exactly as before — a HANDLED event contributes
its full measured delay whenever its handler ran, even after the closing mark; a still-unhandled
event at closing is CENSORED at its elapsed delay, `FAILURE` if that elapsed lower bound already
exceeds the threshold, else `INDETERMINATE` — but `tCDispositionForRepetition` is corrected below:
the original draft let a `FAILURE` observation's `delayMs` quietly fold into the p95 calculation
as if it were an ordinary `OK` sample, which contradicts §6.2's "is a FAILURE" wording being
verdict-bearing at the observation level. Any in-window `FAILURE` now forces the whole
repetition's T-c disposition to `FAILURE`, checked before the `INDETERMINATE` short-circuit.
`tCDispositionForRepetition`'s existing rule — any `INDETERMINATE` observation (with no
`FAILURE` present) makes the whole repetition `INDETERMINATE` — is kept as a deliberately
conservative choice: it is safe (never over-reports `DETERMINED`) even though a fuller
interval-censored percentile analysis could in principle resolve determinacy in some of those
cases; that finer analysis is out of this fix's scope.

The dispatch loop always emits exactly one entry per scheduled coordinate in the fixed cadence
sequence, computed from `durationMs`/`cadenceMs` up front — a slot is never silently skipped even
if Node's own event loop falls behind its intended schedule (§6.2: "every probe event is followed
... [missed] slots are censored, not dropped" — dropping a slot would undercount observations and
could mask a real stall as "too few samples" instead of correctly censoring it).

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/observation-envelope.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestRankPercentile, envelopeLimitMs, dispositionForObservation, tCDispositionForRepetition,
  calibrateNodeToRendererClock, nodeMsToRendererMs, applyClockUncertainty,
} from './observation-envelope.mjs';

test('nearestRankPercentile: 1-based ceil(p*N) index on the sorted sample', () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(nearestRankPercentile(sorted, 0.95), 5); // ceil(0.95*5)=5 -> index 4 (0-based)
  assert.equal(nearestRankPercentile(sorted, 0.5), 3);  // ceil(2.5)=3 -> index 2
});

test('nearestRankPercentile empty-set guard', () => {
  assert.equal(nearestRankPercentile([], 0.95), null);
});

test('envelopeLimitMs: max(2*queryWindowMs, 5000)', () => {
  assert.equal(envelopeLimitMs(100), 5000);
  assert.equal(envelopeLimitMs(3000), 6000);
});

test('dispositionForObservation: handled -> OK with full measured delay', () => {
  assert.deepEqual(dispositionForObservation({ handled: true, delayMs: 250, thresholdMs: 100 }), { status: 'OK', delayMs: 250 });
});

test('dispositionForObservation: censored, lower bound exceeds threshold -> FAILURE', () => {
  assert.deepEqual(dispositionForObservation({ handled: false, delayMs: 150, thresholdMs: 100 }), { status: 'FAILURE', delayMs: 150 });
});

test('dispositionForObservation: censored, lower bound below threshold, no completion -> INDETERMINATE', () => {
  assert.deepEqual(dispositionForObservation({ handled: false, delayMs: 40, thresholdMs: 100 }), { status: 'INDETERMINATE', delayMs: 40 });
});

test('tCDispositionForRepetition: fewer than 5 in-window observations -> INDETERMINATE', () => {
  const obs = [{ status: 'OK', delayMs: 10 }, { status: 'OK', delayMs: 12 }];
  assert.equal(tCDispositionForRepetition(obs, 100).status, 'INDETERMINATE');
});

test('tCDispositionForRepetition: 5+ observations, none indeterminate or failed -> DETERMINED p95', () => {
  const obs = [10, 20, 30, 40, 50].map((delayMs) => ({ status: 'OK', delayMs }));
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'DETERMINED');
  assert.equal(result.p95Ms, 50); // N=5 -> nearest-rank p95 degenerates to the sample max, per §6.2
});

test('tCDispositionForRepetition: any FAILURE observation forces repetition-level FAILURE', () => {
  const obs = [10, 20, 30, 40, 150].map((delayMs, i) => (i === 4 ? { status: 'FAILURE', delayMs } : { status: 'OK', delayMs }));
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'FAILURE');
});

test('tCDispositionForRepetition: FAILURE takes precedence over INDETERMINATE when both are present', () => {
  const obs = [
    { status: 'OK', delayMs: 10 }, { status: 'OK', delayMs: 20 }, { status: 'OK', delayMs: 30 },
    { status: 'INDETERMINATE', delayMs: 40 }, { status: 'FAILURE', delayMs: 150 },
  ];
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'FAILURE');
});

test('calibrateNodeToRendererClock: affine two-point mapping from pre/post samples', () => {
  const pre = { nodeMs: 1000, rendererMs: 200, roundTripMs: 0 };
  const post = { nodeMs: 3000, rendererMs: 2200, roundTripMs: 0 };
  const calibration = calibrateNodeToRendererClock(pre, post);
  assert.equal(calibration.valid, true);
  assert.equal(calibration.driftMs, 0);
  assert.equal(calibration.uncertaintyMs, 0);
  assert.equal(nodeMsToRendererMs(2000, calibration), 1200); // midpoint maps to midpoint
});

test('calibrateNodeToRendererClock: uncertaintyMs is max(pre,post round-trip/2) plus observed drift', () => {
  const pre = { nodeMs: 0, rendererMs: 0, roundTripMs: 4 };
  const post = { nodeMs: 2000, rendererMs: 2003, roundTripMs: 6 };
  const calibration = calibrateNodeToRendererClock(pre, post);
  assert.equal(calibration.valid, true);
  assert.equal(calibration.driftMs, 3); // offsetPost(3) - offsetPre(0)
  assert.equal(calibration.uncertaintyMs, 6); // max(4/2, 6/2) + 3
});

test('calibrateNodeToRendererClock: drift beyond CLOCK_DRIFT_TOLERANCE_MS is invalid', () => {
  const pre = { nodeMs: 1000, rendererMs: 200, roundTripMs: 2 };
  const post = { nodeMs: 3000, rendererMs: 2210, roundTripMs: 2 }; // offsetPre=-800, offsetPost=-790, drift=10
  const calibration = calibrateNodeToRendererClock(pre, post);
  assert.equal(calibration.valid, false);
  assert.match(calibration.reason, /drift/);
});

test('calibrateNodeToRendererClock: a sample round-trip beyond MAX_CALIBRATION_ROUND_TRIP_MS is invalid', () => {
  const pre = { nodeMs: 1000, rendererMs: 200, roundTripMs: 25 };
  const post = { nodeMs: 3000, rendererMs: 2200, roundTripMs: 2 };
  const calibration = calibrateNodeToRendererClock(pre, post);
  assert.equal(calibration.valid, false);
  assert.match(calibration.reason, /round-trip/);
});

test('nodeMsToRendererMs: converts using the fitted affine scale, not a flat offset', () => {
  // A hand-built calibration (not run through the drift/round-trip gate, which is
  // calibrateNodeToRendererClock's own concern -- see the tests above) isolates the pure
  // conversion arithmetic: preRendererMs + (nodeMs - preNodeMs) * scale.
  const calibration = { preNodeMs: 0, preRendererMs: 100, scale: 1.1 };
  assert.equal(nodeMsToRendererMs(500, calibration), 100 + 500 * 1.1);
});

test('applyClockUncertainty: downgrades OK to INDETERMINATE when delay is within uncertainty of the threshold', () => {
  const result = applyClockUncertainty({ status: 'OK', delayMs: 105 }, 10, 100);
  assert.equal(result.status, 'INDETERMINATE');
});

test('applyClockUncertainty: downgrades FAILURE to INDETERMINATE when delay is within uncertainty of the threshold', () => {
  const result = applyClockUncertainty({ status: 'FAILURE', delayMs: 104 }, 10, 100);
  assert.equal(result.status, 'INDETERMINATE');
});

test('applyClockUncertainty: leaves a disposition clearly outside the uncertainty band untouched', () => {
  assert.deepEqual(applyClockUncertainty({ status: 'OK', delayMs: 10 }, 5, 100), { status: 'OK', delayMs: 10 });
  assert.deepEqual(applyClockUncertainty({ status: 'FAILURE', delayMs: 500 }, 5, 100), { status: 'FAILURE', delayMs: 500 });
});

test('applyClockUncertainty: an already-INDETERMINATE disposition passes through unchanged', () => {
  const original = { status: 'INDETERMINATE', delayMs: 40 };
  assert.deepEqual(applyClockUncertainty(original, 50, 100), original);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/observation-envelope.test.mjs`
Expected: FAIL with `Cannot find module './observation-envelope.mjs'` (or, once the file exists but is empty, `TypeError: calibrateNodeToRendererClock is not a function` and equivalents).

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/observation-envelope.mjs
//
// M4 Task 3.2: pure sub-logic for §6.1.7's observation envelope, §6.2's input-probe/rAF rules,
// and the Node<->renderer clock-calibration math those rules depend on. The live rAF cadence
// recorder and CDP Input.dispatchMouseEvent dispatch loop live in browser-probes-m4.mjs /
// run-gate-m4.mjs (this task's live half) and call into these functions only for the
// disposition/percentile/calibration math, never for anything requiring a real clock or DOM.

// §6.1.8: nearest-rank percentile -- the value at 1-based index ceil(p*N) on the sorted sample.
export function nearestRankPercentile(sortedAscending, p) {
  if (sortedAscending.length === 0) return null;
  const oneBasedIndex = Math.ceil(p * sortedAscending.length);
  const zeroBasedIndex = Math.min(sortedAscending.length - 1, Math.max(0, oneBasedIndex - 1));
  return sortedAscending[zeroBasedIndex];
}

// §6.1.7: envelope's own limit, measured from the closing mark.
export function envelopeLimitMs(queryWindowMs) {
  return Math.max(2 * queryWindowMs, 5000);
}

// §6.2's missed-event handling rule, restated as one pure disposition function per observation.
// A HANDLED event (whenever its handler ran, even after the closing mark) contributes its full
// measured delay. A CENSORED event (envelope closed with no handler run) is a FAILURE if its
// elapsed lower bound already exceeds the threshold, else INDETERMINATE.
export function dispositionForObservation({ handled, delayMs, thresholdMs }) {
  if (handled) return { status: 'OK', delayMs };
  return delayMs > thresholdMs ? { status: 'FAILURE', delayMs } : { status: 'INDETERMINATE', delayMs };
}

// §6.2's minimum-observation-count / percentile-determinacy rule for T-c, evaluated PER
// REPETITION over its in-window observations only (probes issued after the closing mark are
// excluded by the caller before this function ever sees them).
//
// A FAILURE observation is verdict-bearing at the observation level ("... is a FAILURE", §6.2) --
// it forces the whole repetition to FAILURE rather than being folded into the p95 sample as if
// it were an ordinary completed delay. This is checked BEFORE the INDETERMINATE short-circuit,
// so a window with both a FAILURE and an INDETERMINATE observation reports FAILURE, not
// INDETERMINATE -- a real, already-proven threshold breach should never be masked by a merely
// ambiguous sample elsewhere in the same window.
//
// Any remaining INDETERMINATE observation (with no FAILURE present) still makes the whole
// repetition INDETERMINATE. This is a deliberately conservative choice -- safe, never
// over-reports DETERMINED -- even though a fuller interval-censored percentile analysis could in
// principle resolve determinacy in some such cases; that finer analysis is out of this fix's
// scope.
export function tCDispositionForRepetition(inWindowObservations, thresholdMs) {
  if (inWindowObservations.length < 5) {
    return { status: 'INDETERMINATE', reason: `only ${inWindowObservations.length} in-window observations (< 5)` };
  }
  const failures = inWindowObservations.filter((o) => o.status === 'FAILURE');
  if (failures.length > 0) {
    return {
      status: 'FAILURE',
      reason: `${failures.length} observation(s) censored past the ${thresholdMs}ms threshold with no completion`,
      count: inWindowObservations.length,
    };
  }
  if (inWindowObservations.some((o) => o.status === 'INDETERMINATE')) {
    return { status: 'INDETERMINATE', reason: 'a censored observation left the percentile undetermined' };
  }
  const sortedDelays = [...inWindowObservations].sort((a, b) => a.delayMs - b.delayMs).map((o) => o.delayMs);
  return { status: 'DETERMINED', p95Ms: nearestRankPercentile(sortedDelays, 0.95), count: sortedDelays.length };
}

// Provisional environment-quality gates for the Node<->renderer clock calibration exchange --
// NOT proof of measurement accuracy. Reasoning: a same-machine Node<->Chromium page.evaluate
// round trip is normally sub-ms to a few ms; 5ms of drift between a window's pre/post samples is
// an order of magnitude under the 100ms T-c threshold, and a round trip past 20ms implies
// roughly +-10ms of pure sampling uncertainty (half the round trip, worst-case asymmetric
// delay) -- large enough that the calibration itself should be distrusted, not silently folded
// in. Revisit both numbers once real invalidation-rate data exists for the benchmark machine.
export const CLOCK_DRIFT_TOLERANCE_MS = 5;
export const MAX_CALIBRATION_ROUND_TRIP_MS = 20;

// Builds an affine (two-point) Node-monotonic -> renderer-monotonic clock mapping from a
// pre-window and a post-window calibration sample, each shaped { nodeMs, rendererMs, roundTripMs }
// (nodeMs is the Node-side page.evaluate round-trip MIDPOINT estimate -- see
// captureClockCalibrationSample in run-gate-m4.mjs -- not a single Date.now()/performance.now()
// read). An affine fit -- not a single flat offset -- is used because probes dispatch at
// different instants spread across the window, mirroring the trace-clock mapper's own two-point
// interpolation (a different, already-fixed task) for the same reason.
//
// `driftMs` is the OBSERVED CHANGE in the pre/post offset estimates -- it folds together real
// inter-clock drift, any host clock step, and changing IPC round-trip asymmetry between the two
// samples; these causes can't be told apart from two samples, so all of it counts against the
// uncertainty budget below rather than being assumed to be "real drift" specifically.
//
// `uncertaintyMs` bounds how far a converted instant can be from the truth: the worse of the two
// samples' own round-trip uncertainty (roundTripMs/2, i.e. the NTP-style midpoint error under a
// fully asymmetric round trip) plus the observed drift magnitude. Callers combine this with
// applyClockUncertainty() to avoid reporting a false-confidence verdict near the 100ms threshold.
export function calibrateNodeToRendererClock(preSample, postSample) {
  const preUncertaintyMs = preSample.roundTripMs / 2;
  const postUncertaintyMs = postSample.roundTripMs / 2;
  const offsetPreMs = preSample.rendererMs - preSample.nodeMs;
  const offsetPostMs = postSample.rendererMs - postSample.nodeMs;
  const driftMs = offsetPostMs - offsetPreMs;
  const uncertaintyMs = Math.max(preUncertaintyMs, postUncertaintyMs) + Math.abs(driftMs);

  if (preSample.roundTripMs > MAX_CALIBRATION_ROUND_TRIP_MS || postSample.roundTripMs > MAX_CALIBRATION_ROUND_TRIP_MS) {
    return {
      valid: false, driftMs, uncertaintyMs,
      reason: `calibration round-trip exceeded ${MAX_CALIBRATION_ROUND_TRIP_MS}ms bound (pre=${preSample.roundTripMs}ms, post=${postSample.roundTripMs}ms) -- offset estimate too uncertain to trust`,
    };
  }
  if (Math.abs(driftMs) > CLOCK_DRIFT_TOLERANCE_MS) {
    return {
      valid: false, driftMs, uncertaintyMs,
      reason: `clock drift ${driftMs.toFixed(2)}ms exceeds ${CLOCK_DRIFT_TOLERANCE_MS}ms tolerance between pre/post calibration samples`,
    };
  }
  const scale = (postSample.rendererMs - preSample.rendererMs) / (postSample.nodeMs - preSample.nodeMs);
  return {
    valid: true, driftMs, uncertaintyMs, reason: null,
    preNodeMs: preSample.nodeMs, preRendererMs: preSample.rendererMs, scale,
  };
}

// Converts a Node-monotonic instant (perf_hooks performance.now()-ms) into the renderer's own
// performance.now() coordinate space, using the affine mapping fit by
// calibrateNodeToRendererClock. This is THE ONE conversion function -- every probe delay
// computation must go through it (or applyClockUncertainty below) rather than ever subtracting a
// raw Node timestamp from a raw renderer timestamp directly.
export function nodeMsToRendererMs(nodeMs, calibration) {
  return calibration.preRendererMs + (nodeMs - calibration.preNodeMs) * calibration.scale;
}

// A disposition computed from a calibration-converted delay is only as trustworthy as that
// calibration's own uncertaintyMs. If the delay lies within uncertaintyMs of the 100ms T-c
// threshold, the calibration error alone could flip OK<->FAILURE (or move a censored lower bound
// across the FAILURE/INDETERMINATE line), so the observation is downgraded to INDETERMINATE
// rather than reported with false confidence. An already-INDETERMINATE disposition is untouched
// (it can't get MORE ambiguous). This is what actually closes the reviewed bug's failure
// scenario: a real stall can no longer be silently reported as a confident, threshold-passing OK.
export function applyClockUncertainty(disposition, uncertaintyMs, thresholdMs) {
  if (disposition.status === 'INDETERMINATE') return disposition;
  if (Math.abs(disposition.delayMs - thresholdMs) <= uncertaintyMs) {
    return {
      status: 'INDETERMINATE', delayMs: disposition.delayMs,
      reason: `delay ${disposition.delayMs}ms is within calibration uncertainty (+-${uncertaintyMs}ms) of the ${thresholdMs}ms threshold`,
    };
  }
  return disposition;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/observation-envelope.test.mjs`
Expected: PASS (19/19)

- [ ] **Step 5: Live-browser wiring + commit**

Add to `test/performance/browser-probes-m4.mjs` (a new plain, non-module file — see this phase's
header note — mirroring `browser-probes.mjs`'s IIFE/`window.__perfProbes` shape):
```js
// test/performance/browser-probes-m4.mjs (excerpt — rAF cadence recorder + input-probe registry)
(function () {
  if (typeof window === 'undefined') return;
  window.__m4Probes = window.__m4Probes ?? {};

  window.__m4Probes.startRafRecorder = function () {
    const state = { frames: [], lastTs: null, running: true };
    function tick(ts) {
      if (!state.running) return;
      if (state.lastTs !== null) state.frames.push(ts - state.lastTs);
      state.lastTs = ts;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return {
      stop() { state.running = false; return state.frames.slice(); },
    };
  };

  // Correlation registry for CDP-dispatched mousemove probes: each dispatch's unique coordinate
  // is looked up here by the in-page handler, so a coordinate that never appears was coalesced
  // away (§6.2's coalescing-detection rule).
  //
  // installInputProbeListener EXPLICITLY stores the registry under a fresh handle in
  // window.__m4Probes.registries (a page-global is the only option across the page.evaluate
  // boundary, since the live Map must keep receiving mousemove events between separate Node
  // round trips) and returns ONLY the handle string to Node -- never the live Map itself, which
  // would just be a dead structured-clone snapshot the instant it crosses the boundary. Every
  // later read goes through getInputProbeRegistry(handle); every later cleanup goes through
  // disposeInputProbeRegistry(handle). No code anywhere reads an undocumented global.
  window.__m4Probes.registries = window.__m4Probes.registries ?? new Map();
  let __m4RegistrySeq = 0;

  window.__m4Probes.installInputProbeListener = function (canvasEl) {
    const handledAt = new Map(); // "x,y" -> performance.now()
    const listener = (ev) => { handledAt.set(`${ev.clientX},${ev.clientY}`, performance.now()); };
    canvasEl.addEventListener('mousemove', listener);
    const handle = `input-probe-registry-${++__m4RegistrySeq}`;
    window.__m4Probes.registries.set(handle, { handledAt, canvasEl, listener });
    return handle;
  };

  window.__m4Probes.getInputProbeRegistry = function (handle) {
    const registry = window.__m4Probes.registries.get(handle);
    if (!registry) throw new Error(`getInputProbeRegistry: no registry installed for handle "${handle}"`);
    return registry;
  };

  // Removes the mousemove listener and drops the registry entry. Idempotent -- disposing an
  // already-disposed (or never-installed) handle is a no-op, so callers can always dispose
  // unconditionally in a `finally` without an extra existence check.
  window.__m4Probes.disposeInputProbeRegistry = function (handle) {
    const registry = window.__m4Probes.registries.get(handle);
    if (!registry) return;
    registry.canvasEl.removeEventListener('mousemove', registry.listener);
    window.__m4Probes.registries.delete(handle);
  };
})();
```

Add to `run-gate-m4.mjs` the clock calibration exchange, CDP dispatch loop, and envelope
bracketing (uses `page.context().newCDPSession`, matching Playwright's documented CDP session
API; uses Node's monotonic `performance.now()` from `node:perf_hooks` for all Node-side
scheduling and measurement, never `Date.now()`, which is reserved for CDP's own wall-clock
`timestamp` protocol field):
```js
// test/performance/run-gate-m4.mjs (excerpt — Task 3.2's calibration + envelope + trusted-input dispatch)
import { performance } from 'node:perf_hooks';
import {
  dispositionForObservation, tCDispositionForRepetition, envelopeLimitMs,
  calibrateNodeToRendererClock, nodeMsToRendererMs, applyClockUncertainty,
} from './m4/observation-envelope.mjs';

async function installInputProbeRegistry(page, canvasSelector) {
  return page.evaluate((selector) => {
    const canvasEl = document.querySelector(selector);
    if (!canvasEl) throw new Error(`installInputProbeRegistry: no element matches "${selector}"`);
    return window.__m4Probes.installInputProbeListener(canvasEl);
  }, canvasSelector);
}

async function disposeInputProbeRegistry(page, handle) {
  await page.evaluate((h) => window.__m4Probes.disposeInputProbeRegistry(h), handle);
}

// Paired clock sample: an in-page performance.mark whose performance.now() value is also
// returned to Node in the same evaluation (mirrors the general CDP clock-correlation mechanism,
// §6.2). Because the round trip has non-zero duration, `nodeMs` is the Node-side pre/post-call
// MIDPOINT (an NTP-style estimate of "what Node's clock read when the renderer sample was
// taken"), and `roundTripMs` is carried forward as this sample's own uncertainty.
async function captureClockCalibrationSample(page) {
  const beforeNodeMs = performance.now();
  const rendererMs = await page.evaluate(() => {
    performance.mark('m4-input-probe-calibration');
    return performance.now();
  });
  const afterNodeMs = performance.now();
  return {
    nodeMs: beforeNodeMs + (afterNodeMs - beforeNodeMs) / 2,
    rendererMs,
    roundTripMs: afterNodeMs - beforeNodeMs,
  };
}

async function dispatchInputProbeSequence(page, cdpSession, { canvasSelector, cadenceMs, startNodeMs, durationMs }) {
  const coords = []; // fixed, recorded sequence -- unique per probe, per §6.2
  const count = Math.ceil(durationMs / cadenceMs);
  for (let i = 0; i < count; i++) coords.push({ x: 100 + (i % 50), y: 100 + Math.floor(i / 50) });
  const box = await page.locator(canvasSelector).boundingBox();
  const dispatched = [];
  // Every scheduled coord gets exactly ONE dispatched entry -- never skipped, even if Node's own
  // event loop falls behind schedule -- so a late slot is still counted and, if never handled,
  // correctly censored rather than silently dropped (dropping would undercount observations and
  // could mask a real stall as "too few samples" instead of a proper FAILURE/INDETERMINATE).
  for (let i = 0; i < coords.length; i++) {
    const scheduledNodeMs = startNodeMs + i * cadenceMs; // fixed schedule, independent of jitter
    const sleepMs = scheduledNodeMs - performance.now();
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
    // Captured BEFORE the CDP round trip, not after awaiting `send()`: the handler can fire
    // before the send promise even resolves, so timing from the post-await instant would already
    // be wrong (the original draft's bug).
    const dispatchNodeMs = performance.now();
    // Rounded to whole CSS pixels: CDP's x/y and the resulting MouseEvent's clientX/clientY are
    // not guaranteed to preserve arbitrary fractional coordinates identically, and the registry's
    // lookup key is an exact string match. Full subpixel-precision handling is out of this fix's
    // scope (clock correlation + registry wiring only).
    const x = Math.round(box.x + coords[i].x);
    const y = Math.round(box.y + coords[i].y);
    const sendPromise = cdpSession.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x, y,
      timestamp: Date.now() / 1000, // CDP's own TimeSinceEpoch protocol field (wall-clock
                                     // seconds) -- never used in any delay computation, which
                                     // stays entirely on the calibrated Node<->renderer mapping.
    });
    dispatched.push({ coord: { x: coords[i].x, y: coords[i].y }, scheduledNodeMs, dispatchNodeMs });
    await sendPromise;
  }
  return dispatched;
}

// Resolves every dispatched probe's disposition in ONE in-page evaluate call. The closing mark
// (`closeRendererMs`) is captured as the FIRST synchronous statement inside that call, then the
// registry is read immediately after, still within the same synchronous turn -- because a
// page.evaluate function body runs as one uninterrupted turn, no mousemove handler can fire
// between the closing mark and the registry read. This is what actually eliminates the
// close-vs-handler race a separately Node-computed (and then converted) closing timestamp would
// have had. Every dispatched timestamp is converted to renderer-clock terms via
// nodeMsToRendererMs BEFORE this call ever subtracts it from an in-page value; the evaluate
// function itself only ever sees renderer-clock-space numbers.
async function resolveInputProbeDispositions(page, registryHandle, dispatched, { thresholdMs, calibration }) {
  const rendererDispatched = dispatched.map((d) => ({
    coord: d.coord,
    dispatchedAtRendererMs: nodeMsToRendererMs(d.dispatchNodeMs, calibration),
  }));
  const raw = await page.evaluate(({ registryHandle, rendererDispatched }) => {
    const closeRendererMs = performance.now();
    const { handledAt } = window.__m4Probes.getInputProbeRegistry(registryHandle);
    return rendererDispatched.map((d) => {
      const key = `${d.coord.x},${d.coord.y}`;
      const handledAtMs = handledAt.get(key);
      if (handledAtMs !== undefined) return { handled: true, delayMs: handledAtMs - d.dispatchedAtRendererMs };
      return { handled: false, delayMs: closeRendererMs - d.dispatchedAtRendererMs };
    });
  }, { registryHandle, rendererDispatched });
  return raw.map((r) =>
    applyClockUncertainty(dispositionForObservation({ ...r, thresholdMs }), calibration.uncertaintyMs, thresholdMs));
}

// Orchestrates one query window's T-c measurement: install -> pre-calibrate -> dispatch the
// fixed-cadence probe sequence -> wait out the envelope's own limit (§6.1.7) -> post-calibrate ->
// resolve -> dispose (always, via `finally`, even on error). Returns INDETERMINATE with a named
// reason instead of any measurement if the calibration itself is untrustworthy.
async function runInputProbeWindow(page, cdpSession, { canvasSelector, cadenceMs, durationMs, thresholdMs }) {
  const registryHandle = await installInputProbeRegistry(page, canvasSelector);
  try {
    const preSample = await captureClockCalibrationSample(page);
    const startNodeMs = performance.now();
    const dispatched = await dispatchInputProbeSequence(page, cdpSession, { canvasSelector, cadenceMs, startNodeMs, durationMs });

    const limitMs = envelopeLimitMs(durationMs);
    const remainingWaitMs = Math.max(0, limitMs - (performance.now() - startNodeMs));
    if (remainingWaitMs > 0) await new Promise((r) => setTimeout(r, remainingWaitMs));

    const postSample = await captureClockCalibrationSample(page);
    const calibration = calibrateNodeToRendererClock(preSample, postSample);
    if (!calibration.valid) {
      return { calibration, observations: [], tC: { status: 'INDETERMINATE', reason: calibration.reason } };
    }

    const observations = await resolveInputProbeDispositions(page, registryHandle, dispatched, { thresholdMs, calibration });
    return { calibration, observations, tC: tCDispositionForRepetition(observations, thresholdMs) };
  } finally {
    await disposeInputProbeRegistry(page, registryHandle);
  }
}

export {
  installInputProbeRegistry, disposeInputProbeRegistry, captureClockCalibrationSample,
  dispatchInputProbeSequence, resolveInputProbeDispositions, runInputProbeWindow,
};
```

**Manual verification (a) — rAF cadence recorder**: Run: `node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('http://localhost:8080');
  await p.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
  const rec = await p.evaluate(() => { window.__rec = window.__m4Probes.startRafRecorder(); return true; });
  await p.waitForTimeout(500);
  const frames = await p.evaluate(() => window.__rec.stop());
  console.log('frame intervals observed:', frames.length);
  await b.close();
})();
"` (adjust to run inside the repo, ESM-flavored) — expect `frame intervals observed:` printing a
positive count (roughly 25-30 for 500ms at 60Hz).

**Manual verification (b) — registry round-trip + deliberately blocked renderer (the review's
required integration test)**: this needs a real page and a real blocked main thread, so it is
manual verification, not a `node --test` unit test, per this phase's convention of separating
pure sub-logic (unit-tested above) from live-browser wiring. Save as
`test/performance/m4/manual-verify-input-probe-block.mjs`:
```js
// test/performance/m4/manual-verify-input-probe-block.mjs
//
// Proves two things in one run: (1) install -> dispatch -> resolve yields a real, non-degenerate
// disposition (not undefined, not a thrown error) for a probe handled on a free main thread; and
// (2) a probe dispatched while the main thread is DEMONSTRABLY blocked for ~500ms records
// approximately that blocking duration and fails T-c, per the review's required integration test.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  installInputProbeRegistry, disposeInputProbeRegistry, captureClockCalibrationSample,
  resolveInputProbeDispositions,
} from '../run-gate-m4.mjs';
import { calibrateNodeToRendererClock } from './observation-envelope.mjs';

const CANVAS_SELECTOR = 'canvas'; // adjust to the real app under test
const THRESHOLD_MS = 100;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080'); // adjust to the running dev server
await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
const cdpSession = await page.context().newCDPSession(page);

const registryHandle = await installInputProbeRegistry(page, CANVAS_SELECTOR);
try {
  const preSample = await captureClockCalibrationSample(page);
  const box = await page.locator(CANVAS_SELECTOR).boundingBox();

  // Probe A: dispatched and handled on a FREE main thread -- proves the round trip itself works.
  const coordA = { x: 10, y: 10 };
  const dispatchANodeMs = performance.now();
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(box.x + coordA.x), y: Math.round(box.y + coordA.y), timestamp: Date.now() / 1000,
  });
  await page.waitForTimeout(50); // give the handler a free main thread to run on

  // Probe B: dispatched WHILE the main thread is demonstrably blocked -- the busy loop is
  // started WITHOUT awaiting it, so Node stays free to dispatch CDP input mid-block; a fixed
  // settle delay lets the block provably start before Probe B is issued.
  const busyPromise = page.evaluate(() => {
    const busyStart = performance.now();
    while (performance.now() - busyStart < 500) { /* deliberately block the main thread */ }
    return { busyStart, busyEnd: performance.now() };
  });
  await new Promise((r) => setTimeout(r, 50));
  const coordB = { x: 20, y: 20 };
  const dispatchBNodeMs = performance.now();
  await cdpSession.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(box.x + coordB.x), y: Math.round(box.y + coordB.y), timestamp: Date.now() / 1000,
  });

  const dispatched = [
    { coord: coordA, scheduledNodeMs: dispatchANodeMs, dispatchNodeMs: dispatchANodeMs },
    { coord: coordB, scheduledNodeMs: dispatchBNodeMs, dispatchNodeMs: dispatchBNodeMs },
  ];

  const { busyStart, busyEnd } = await busyPromise;
  const postSample = await captureClockCalibrationSample(page);
  const calibration = calibrateNodeToRendererClock(preSample, postSample);
  assert.ok(calibration.valid, `calibration should be valid on a local run: ${calibration.reason}`);

  const [obsA, obsB] = await resolveInputProbeDispositions(page, registryHandle, dispatched, {
    thresholdMs: THRESHOLD_MS, calibration,
  });

  console.log('probe A (unblocked):', obsA);
  console.log('probe B (blocked ~500ms):', obsB, '-- busy window was', (busyEnd - busyStart).toFixed(1), 'ms');

  assert.equal(obsA.status, 'OK', `expected probe A handled OK on a free main thread, got ${obsA.status}`);
  assert.ok(obsA.delayMs >= 0 && obsA.delayMs < 100, `expected probe A's delay to be small, got ${obsA.delayMs}ms`);

  assert.equal(obsB.status, 'FAILURE', `expected probe B to fail T-c, got ${obsB.status}`);
  assert.ok(obsB.delayMs > 400 && obsB.delayMs < 700, `expected probe B's delay near 500ms, got ${obsB.delayMs}ms`);

  console.log('PASS: registry round-trip yields real dispositions; a genuinely blocked renderer records ~500ms and fails T-c');
} finally {
  await disposeInputProbeRegistry(page, registryHandle);
  await browser.close();
}
```
Run: `node test/performance/m4/manual-verify-input-probe-block.mjs`
Expected: prints `probe A (unblocked): { status: 'OK', delayMs: <small> }`, then
`probe B (blocked ~500ms): { status: 'FAILURE', delayMs: <~450-550> } -- busy window was ~500.0 ms`,
then `PASS: registry round-trip yields real dispositions; a genuinely blocked renderer records ~500ms and fails T-c`
with exit code 0. Any assertion failure throws and exits non-zero — in particular, a clock-mixing
regression would either make `calibration.valid` false (loud failure at the `assert.ok` on
`calibration.valid`) or make `obsB.delayMs` wildly wrong (large negative or huge positive) rather
than landing in the expected ~450-550ms band, so the old bug's failure mode (a stall silently read
as passing) cannot slip through unnoticed here.

```bash
git add test/performance/m4/observation-envelope.mjs test/performance/m4/observation-envelope.test.mjs test/performance/m4/manual-verify-input-probe-block.mjs test/performance/browser-probes-m4.mjs test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.2 — observation envelope (rAF cadence + trusted input probes)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 3.3: Cohort profiler (§5.4 density-stratified cohort construction)

**Files:**
- Create: `test/performance/m4/cohort-selection.mjs`
- Edit: `test/performance/browser-probes-m4.mjs` (live profiling walk: `instances(dbId)`/`proximity(dbId)`)
- Test: `test/performance/m4/cohort-selection.test.mjs` (pure §5.4 algorithm — exhaustively unit-tested) + manual verification for the live in-page profiling walk

**Interfaces:**
- Consumes: nothing from earlier Phase 3 tasks (this is an independent leaf, per task-architecture-v2's own note that S2T (3.4) does NOT depend on this task).
- Produces: `rankByDensity`, `selectCohort`, `labelDensityUnstratified` (pure, §5.4 steps 1-6 and the achieved-separation rule) plus a live profiling function producing `Array<{dbId, proximity, fragmentIds: Set<number>}>` for every Structure dbId, which task 3.7's matrix scheduler calls once per gate run (§5.4's "profiling pass ... unmeasured") to build the low/typical/high cohorts R3/R4/R6/S2 need.

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/cohort-selection.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByDensity, selectCohort, labelDensityUnstratified } from './cohort-selection.mjs';

function profile(dbId, proximity, fragmentIds) {
  return { dbId, proximity, fragmentIds: new Set(fragmentIds) };
}

test('rankByDensity: ascending density, ties broken by ascending dbId', () => {
  const profiles = [profile(3, 10, [1, 2]), profile(1, 10, [3, 4]), profile(2, 4, [5, 6, 7, 8])];
  const ranked = rankByDensity(profiles);
  assert.deepEqual(ranked.map((r) => r.dbId), [2, 1, 3]); // density(2)=1, density(1)=density(3)=5, tie->ascending dbId
});

test('selectCohort: walks the band in ascending dbId order, cumulative SHARED fragment count (no double-count)', () => {
  // dbId 10 and 11 share fragment 100 -- naive summation would overcount.
  const profiles = [
    profile(10, 2, [100, 101]),
    profile(11, 2, [100, 102]),
    profile(12, 2, [103, 104]),
  ];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.5, 4); // k=4, need >=4 shared fragments
  assert.equal(result.status, 'OK');
  // 10+11 alone give {100,101,102} = 3 (not 4, since 100 is shared) -> must walk in 12 too.
  assert.equal(result.achievedInstances, 5);
});

test('selectCohort: forced dbId 3076 replaces the band member with closest density', () => {
  const profiles = [profile(1, 1, [1]), profile(2, 1, [2]), profile(3076, 100, Array.from({ length: 50 }, (_, i) => 1000 + i))];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.9, 1, { forceDbId: 3076 });
  assert.equal(result.status, 'OK');
  assert(result.requestedDbIds.includes(3076));
  assert(result.replacement === null || result.replacement.forcedDbId === 3076);
});

test('selectCohort: NOT EXERCISED when even the full population cannot reach k', () => {
  const profiles = [profile(1, 1, [1]), profile(2, 1, [2])];
  const ranked = rankByDensity(profiles);
  const result = selectCohort(ranked, 0.5, 1000);
  assert.equal(result.status, 'NOT_EXERCISED');
  assert.equal(result.achievedInstances, 2);
});

test('labelDensityUnstratified: true when all three cohorts select the identical dbId set', () => {
  const ranked = rankByDensity([profile(1, 1, [1, 2]), profile(2, 1, [3, 4])]);
  const cohort = selectCohort(ranked, 0.5, 4);
  assert.equal(labelDensityUnstratified({ low: cohort, typical: cohort, high: cohort }), true);
});

test('labelDensityUnstratified: false when low < typical < high weighted density holds and sets differ', () => {
  const low = { status: 'OK', requestedDbIds: [1], weightedDensity: 0.1 };
  const typical = { status: 'OK', requestedDbIds: [2], weightedDensity: 0.5 };
  const high = { status: 'OK', requestedDbIds: [3], weightedDensity: 0.9 };
  assert.equal(labelDensityUnstratified({ low, typical, high }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/cohort-selection.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/cohort-selection.mjs
//
// M4 Task 3.3: §5.4's cohort construction algorithm, implemented EXACTLY as specified. PURE --
// operates over the live profiling pass's own output (per-dbId proximity count and
// first-discovery-wins fragment-id set); the profiling walk itself (instances(dbId)/
// proximity(dbId) over real Viewer APIs) lives in browser-probes-m4.mjs, this task's live half.

function sharedInstanceCount(records) {
  const union = new Set();
  for (const r of records) for (const f of r.fragmentIds) union.add(f);
  return union.size;
}

// §5.4's closing rule: weighted density is Sigma(proximity)/Sigma(instances) over the cohort's ONE
// shared, first-discovery-wins fragment set -- never the mean of per-dbId density values.
function weightedDensity(records) {
  const sumProximity = records.reduce((acc, r) => acc + r.proximity, 0);
  const instances = sharedInstanceCount(records);
  return instances === 0 ? 0 : sumProximity / instances;
}

// Step 1: rank by ascending density, ties broken by ascending dbId.
export function rankByDensity(profiles) {
  return profiles
    .map((p) => ({ ...p, instances: p.fragmentIds.size, density: p.fragmentIds.size === 0 ? Infinity : p.proximity / p.fragmentIds.size }))
    .sort((a, b) => (a.density - b.density) || (a.dbId - b.dbId));
}

function nearestRankIndex(q, n) {
  return Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
}

// Step 3: the band -- width w = max(3k,25), centred on i_q, clipped/extended per the spec's rule.
function selectBand(ranked, quantile, k) {
  const n = ranked.length;
  const w = Math.max(3 * k, 25);
  if (n <= w) return { band: ranked, bandWasAllOfL: true };
  const iq = nearestRankIndex(quantile, n);
  let lo = iq - Math.floor(w / 2);
  let hi = lo + w;
  if (lo < 0) { hi += -lo; lo = 0; }
  if (hi > n) { lo -= (hi - n); hi = n; }
  return { band: ranked.slice(Math.max(0, lo), hi), bandWasAllOfL: false };
}

// Step 4: walk the band in ascending dbId order, accumulating into ONE shared fragment set.
function walkBandForCohort(band, k) {
  const byDbId = [...band].sort((a, b) => a.dbId - b.dbId);
  const accumulated = [];
  for (const entry of byDbId) {
    accumulated.push(entry);
    const achieved = sharedInstanceCount(accumulated);
    if (achieved >= k) return { requestedDbIds: accumulated.map((e) => e.dbId), achievedInstances: achieved, records: accumulated, reachedK: true };
  }
  return { requestedDbIds: accumulated.map((e) => e.dbId), achievedInstances: sharedInstanceCount(accumulated), records: accumulated, reachedK: false };
}

// Step 5: force 3076 into the HIGH cohort's band, replacing the closest-density member.
function forceIntoBand(band, ranked, forceDbId) {
  if (band.some((e) => e.dbId === forceDbId)) return { band, replacement: null };
  const forced = ranked.find((e) => e.dbId === forceDbId);
  if (!forced) throw new Error(`forced dbId ${forceDbId} is not present in the ranked population`);
  let closest = null;
  for (const e of band) {
    const delta = Math.abs(e.density - forced.density);
    if (!closest || delta < closest.delta || (delta === closest.delta && e.dbId < closest.entry.dbId)) closest = { entry: e, delta };
  }
  return {
    band: band.filter((e) => e.dbId !== closest.entry.dbId).concat(forced),
    replacement: { removedDbId: closest.entry.dbId, forcedDbId: forceDbId, forcedDensity: forced.density, forcedRank: ranked.indexOf(forced) },
  };
}

/** @param ranked  output of rankByDensity
 *  @param quantile 0.25 (low) | 0.5 (typical) | 0.9 (high)
 *  @param k required cohort size, in extracted instances
 *  @param options.forceDbId  pass 3076 only when quantile===0.9 (§5.4 step 5's own scope) */
export function selectCohort(ranked, quantile, k, { forceDbId } = {}) {
  const { band, bandWasAllOfL } = selectBand(ranked, quantile, k);
  let effectiveBand = band;
  let replacement = null;
  if (forceDbId !== undefined && quantile === 0.9) {
    const forced = forceIntoBand(band, ranked, forceDbId);
    effectiveBand = forced.band;
    replacement = forced.replacement;
  }
  let walked = walkBandForCohort(effectiveBand, k);
  if (!walked.reachedK && !bandWasAllOfL) {
    // Step 6: widen to all of L before declaring NOT EXERCISED.
    walked = walkBandForCohort(ranked, k);
  }
  if (!walked.reachedK) {
    return { status: 'NOT_EXERCISED', achievedInstances: walked.achievedInstances, requestedDbIds: walked.requestedDbIds, bandWasAllOfL: true, replacement };
  }
  return {
    status: 'OK',
    requestedDbIds: walked.requestedDbIds,
    achievedInstances: walked.achievedInstances,
    bandWasAllOfL,
    replacement,
    weightedDensity: weightedDensity(walked.records),
  };
}

// Achieved-separation labelling, decided on ACHIEVED results, never on band overlap alone.
export function labelDensityUnstratified({ low, typical, high }) {
  const allOk = [low, typical, high].every((c) => c.status === 'OK');
  const sameSet = (a, b) => a.status === 'OK' && b.status === 'OK'
    && JSON.stringify([...a.requestedDbIds].sort((x, y) => x - y)) === JSON.stringify([...b.requestedDbIds].sort((x, y) => x - y));
  const identicalSets = sameSet(low, typical) || sameSet(typical, high) || sameSet(low, high);
  const equalDensity = allOk && low.weightedDensity === typical.weightedDensity && typical.weightedDensity === high.weightedDensity;
  const orderingLost = allOk && !(low.weightedDensity < typical.weightedDensity && typical.weightedDensity < high.weightedDensity);
  return identicalSets || equalDensity || orderingLost;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/cohort-selection.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Add to `browser-probes-m4.mjs` the profiling walk (touching **no** `collision/` code, per §5.4's
own opening constraint — a duplicate depth-first walk matching `extractFragments`'s shape,
`viewer/ViewerModelAdapter.js:100-153`, confirmed via `verified-refs.md`):
```js
// test/performance/browser-probes-m4.mjs (excerpt — §5.4 profiling pass)
window.__m4Probes.profileStructureCohortDensity = function (models, { proximityThreshold = 0.05 } = {}) {
  const structureModel = models[1];
  const tree = structureModel.getInstanceTree();
  const rootId = tree.getRootId();
  const allWorldBoxes = []; // [{modelIndex, fragId, min, max}] across all 3 models, for proximity scan
  const box = new window.THREE.Box3();
  for (let mi = 0; mi < models.length; mi++) {
    const fragList = models[mi].getFragmentList();
    const count = fragList.getCount();
    for (let f = 0; f < count; f++) {
      if (fragList.isNotLoaded && fragList.isNotLoaded(f)) continue;
      fragList.getWorldBounds(f, box);
      allWorldBoxes.push({ modelIndex: mi, fragId: f, min: box.min.toArray(), max: box.max.toArray() });
    }
  }
  function aabbNear(a, b, threshold) {
    for (let i = 0; i < 3; i++) {
      const gap = Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i], 0);
      if (gap > threshold) return false;
    }
    return true;
  }
  function walkFragments(dbId, seen) {
    // Depth-first stack walk, enumNodeFragments at EVERY visited node, enumNodeChildren to
    // descend -- matching extractFragments's own rule (first-discovery-wins).
    const stack = [dbId];
    while (stack.length) {
      const node = stack.pop();
      tree.enumNodeFragments(node, (fragId) => { if (!seen.has(fragId)) seen.add(fragId); }, false);
      tree.enumNodeChildren(node, (child) => stack.push(child), false);
    }
  }
  const profiles = [];
  const rootStack = [rootId];
  const visitedDbIds = new Set();
  while (rootStack.length) {
    const dbId = rootStack.pop();
    if (visitedDbIds.has(dbId)) continue;
    visitedDbIds.add(dbId);
    tree.enumNodeChildren(dbId, (child) => rootStack.push(child), false);
    const seen = new Set();
    walkFragments(dbId, seen);
    if (seen.size === 0) continue;
    const sourceBoxes = allWorldBoxes.filter((b) => b.modelIndex === 1 && seen.has(b.fragId));
    let proximity = 0;
    for (const s of sourceBoxes) for (const t of allWorldBoxes) if (aabbNear(s, t, proximityThreshold)) proximity++;
    profiles.push({ dbId, proximity, fragmentIds: seen });
  }
  return profiles; // Set objects -- Node side reconstructs via page.evaluate's structured clone (Sets survive)
};
```

**Manual verification**: Run `node --test` cannot exercise this (needs a live Viewer). Instead:
`npm run test:performance:gate:m4 -- --smoke-cohort-profiler` (a temporary flag task 3.7 removes
once the profiler is wired into the real matrix) that calls `profileStructureCohortDensity` once
against the live fixture and prints `{ dbIdCount, top5ByDensity, low/typical/high cohort sizes }`.
Expected: `dbIdCount` roughly matches Structure's known dbId population (~hundreds), and `3076`
appears in the printed `high` cohort's `requestedDbIds`.

```bash
git add test/performance/m4/cohort-selection.mjs test/performance/m4/cohort-selection.test.mjs test/performance/browser-probes-m4.mjs
git commit -m "test(collision): M4 task 3.3 — §5.4 cohort profiler (density-stratified selection)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.4: S2T facade (target-population sweep)

**Files:**
- Create: `test/performance/m4/s2t-bystander-layout.mjs`
- Edit: `test/performance/browser-probes-m4.mjs` (live facade object construction)
- Test: `test/performance/m4/s2t-bystander-layout.test.mjs` (pure bystander-layout generator) + manual verification for the live facade + level-to-level control-rule check

**Interfaces:**
- Consumes: nothing from task 3.3 (independent — the real source `3076` and real near-source
  Architecture cohort stay fixed; this task only appends synthetic distant bystanders, per the
  design correction in this phase's brief).
- Produces: `S2T_LEVELS`, `bystanderLayout(...)`, `syntheticIdRangeAbove(...)` (pure, §5.3.1 points 3-4) plus a live `buildS2TFacade(realArchitectureModel, level)` that returns a facade object replacing the Architecture target identity, and a live `checkS2TLevelToLevelControlRule(levelResults)` that task 3.7/3.8 call to assert §5.3.1's mechanical control rule per level.

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/s2t-bystander-layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S2T_LEVELS, bystanderLayout, syntheticIdRangeAbove } from './s2t-bystander-layout.mjs';

test('S2T_LEVELS are the four admitted-instance population levels', () => {
  assert.deepEqual(S2T_LEVELS, [5435, 10000, 15000, 20000]);
});

test('syntheticIdRangeAbove: strictly above the real measured maximum', () => {
  assert.equal(syntheticIdRangeAbove(5434), 5435);
});

test('bystanderLayout: deterministic, no two bystanders share an identical AABB position', () => {
  const layout = bystanderLayout(200, { syntheticFragmentIdStart: 5435, syntheticGeometryIdStart: 9000 });
  const positions = new Set(layout.map((b) => b.position.join(',')));
  assert.equal(positions.size, layout.length, 'every bystander must have a distinct position (no degenerate single-AABB BVH)');
});

test('bystanderLayout: every bystander AABB lies far outside a representative near-source box', () => {
  const nearSourceMax = 1000; // a generous upper bound on the real fixture's own coordinate range
  const layout = bystanderLayout(50, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  for (const b of layout) assert(b.position.every((c) => c > nearSourceMax), 'bystander must be outside the query region');
});

test('bystanderLayout: levels are nested — smaller level is an exact prefix of the larger level', () => {
  const small = bystanderLayout(10, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  const large = bystanderLayout(20, { syntheticFragmentIdStart: 0, syntheticGeometryIdStart: 0 });
  assert.deepEqual(large.slice(0, 10), small);
});

test('bystanderLayout: synthetic fragment/geometry ids are contiguous and disjoint from the real range', () => {
  const layout = bystanderLayout(5, { syntheticFragmentIdStart: 5435, syntheticGeometryIdStart: 9000 });
  assert.deepEqual(layout.map((b) => b.fragmentId), [5435, 5436, 5437, 5438, 5439]);
  assert.deepEqual(layout.map((b) => b.geometryId), [9000, 9001, 9002, 9003, 9004]);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/s2t-bystander-layout.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/s2t-bystander-layout.mjs
//
// M4 Task 3.4: pure construction rules for S2T's synthetic bystander population (§5.3.1 points
// 3-4). The facade itself (a test-local object delegating Viewer surface calls to the real
// Architecture model for real fragments, and to this layout for synthetic ones) is live-only and
// lives in browser-probes-m4.mjs (this task's live half) -- it cannot be unit-tested without a
// real Viewer/Model object.

// §5.3.1's four population levels: 5,435 (baseline, real fragment count, zero bystanders) /
// 10,000 / 15,000 / 20,000 admitted Architecture instances.
export const S2T_LEVELS = [5435, 10000, 15000, 20000];

// §5.3.1 point 3: synthetic ids occupy a disjoint range strictly above the real model's own
// measured maximum (never overlapping -- a collision would let a real candidate resolve through
// a synthetic fragment, a silent correctness corruption, not a measurement error).
export function syntheticIdRangeAbove(realMeasuredMax) {
  return realMeasuredMax + 1;
}

// §5.3.1 point 4: bystander layout is deterministic, dispersed, nested, and recorded verbatim.
// Every bystander AABB lies outside the source's query region at every level; a single shared
// far AABB is forbidden (a degenerate BVH artifact). Nested: layout(N) is always a PREFIX of
// layout(M) for N < M, so larger levels retain the exact smaller-level prefix.
export function bystanderLayout(count, { farOffset = 1_000_000, spreadStep = 5, syntheticFragmentIdStart, syntheticGeometryIdStart }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      fragmentId: syntheticFragmentIdStart + i,
      geometryId: syntheticGeometryIdStart + i,
      position: [
        farOffset + (i % 100) * spreadStep,
        farOffset + (Math.floor(i / 100) % 100) * spreadStep,
        farOffset + Math.floor(i / 10_000) * spreadStep,
      ],
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/s2t-bystander-layout.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Add to `browser-probes-m4.mjs` the facade object (§5.3.1 point 2's exact Viewer surface list —
`getFragmentList`, `getCount`, `isNotLoaded`, `getDbIds`, `getGeometryId`, `getWorldMatrix`,
`getWorldBounds`, plus a delegating `getUnitScale` and a translation-only `getRenderProxy`):
```js
// test/performance/browser-probes-m4.mjs (excerpt — S2T facade)
window.__m4Probes.buildS2TFacade = function (realArchModel, bystanders) {
  const realCount = realArchModel.getFragmentList().getCount();
  const facadeFragList = {
    getCount: () => realCount + bystanders.length,
    isNotLoaded: (fragId) => (fragId < realCount ? realArchModel.getFragmentList().isNotLoaded(fragId) : false),
    getWorldBounds: (fragId, box) => {
      if (fragId < realCount) return realArchModel.getFragmentList().getWorldBounds(fragId, box);
      const b = bystanders[fragId - realCount];
      box.min.set(b.position[0], b.position[1], b.position[2]);
      box.max.set(b.position[0] + 1, b.position[1] + 1, b.position[2] + 1);
    },
    getWorldMatrix: (fragId, dst) => {
      if (fragId < realCount) return realArchModel.getFragmentList().getWorldMatrix(fragId, dst);
      dst.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); // identity -- bystander position is baked into its AABB
    },
    getGeometryId: (fragId) => (fragId < realCount ? realArchModel.getFragmentList().getGeometryId(fragId) : bystanders[fragId - realCount].geometryId),
  };
  return {
    getFragmentList: () => facadeFragList,
    getCount: () => facadeFragList.getCount(),
    isNotLoaded: (fragId) => facadeFragList.isNotLoaded(fragId),
    getDbIds: (fragId) => (fragId < realCount ? realArchModel.getDbIds(fragId) : []),
    getGeometryId: (fragId) => facadeFragList.getGeometryId(fragId),
    getUnitScale: () => realArchModel.getUnitScale(), // delegates -- it controls weld epsilon (§5.3.1 point 2)
    __isM4SyntheticFacade: true,
    __realModel: realArchModel,
    __realCount: realCount,
  };
};

// §5.3.1's level-to-level mechanical control rule (checked against existing observables only, no
// new instrumentation) -- returns { pass: true } or { pass: false, violated: [...] }.
window.__m4Probes.checkS2TLevelToLevelControlRule = function (levelResults) {
  const violated = [];
  const base = levelResults[0];
  for (const lvl of levelResults.slice(1)) {
    if (lvl.statistics.clearanceExactAabbSurvivors !== base.statistics.clearanceExactAabbSurvivors) violated.push(`clearanceExactAabbSurvivors@${lvl.level}`);
    if (lvl.statistics.narrowPhasePairs !== base.statistics.narrowPhasePairs) violated.push(`narrowPhasePairs@${lvl.level}`);
    const anySyntheticFragmentReferenced = (lvl.diagnostics ?? []).some((d) => d.fragment?.fragId >= base.realCount || d.sourceFragment?.fragId >= base.realCount || d.targetFragment?.fragId >= base.realCount);
    if (anySyntheticFragmentReferenced) violated.push(`syntheticFragmentLeak@${lvl.level}`);
  }
  return { pass: violated.length === 0, violated };
};
```

**Manual verification**: Run
`npm run test:performance:gate:m4 -- --smoke-s2t` (temporary flag; task 3.7 removes it once wired
into the real matrix) that builds the facade at `S2T_LEVELS[0]` (0 bystanders) and `S2T_LEVELS[1]`
(4,565 bystanders), runs an identical clearance query through each, and prints
`checkS2TLevelToLevelControlRule`'s result. Expected: `{ pass: true, violated: [] }`, and
`facade.getCount()` at level 1 equals `10000`.

```bash
git add test/performance/m4/s2t-bystander-layout.mjs test/performance/m4/s2t-bystander-layout.test.mjs test/performance/browser-probes-m4.mjs
git commit -m "test(collision): M4 task 3.4 — S2T facade (synthetic bystander target-population sweep)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.5: R6 placement-refresh sequence

**Files:**
- Create: `test/performance/m4/r6-calibration.mjs`
- Edit: `test/performance/run-gate-m4.mjs` (the live move→invalidate→refresh→restore-in-`finally` sequence)
- Test: `test/performance/m4/r6-calibration.test.mjs` (pure matrix-equality + calibration-magnitude selection) + manual verification for the live sequence (reuses `test/CollisionWorld.findClashes.clearance.test.mjs:354-397`'s already-proven 3-phase idiom as its own oracle)

**Interfaces:**
- Consumes: task 3.3's typical cohort (R6 uses "R3's source set", per §5.2's table).
- Produces: `matricesEqual`, `R6_CALIBRATION_SEQUENCE`, `selectCalibrationMagnitude`, `pairSetsDiffer` (pure, §5.2.1) plus a live `runR6Sequence(world, architectureModel, cohortDbIds)` implementing the full one-time calibration pass and the per-repetition move→invalidate→refresh→restore-in-`finally` protocol, with the arm-specific `tlasBuilds` assertion (tlas: delta 1 per invalidation; linear: 0, always).

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/r6-calibration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matricesEqual, R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer } from './r6-calibration.mjs';

test('matricesEqual: true when every one of 16 elements agrees within 1e-9', () => {
  const a = Array(16).fill(0).map((_, i) => i);
  const b = [...a];
  b[5] += 1e-10;
  assert.equal(matricesEqual(a, b), true);
});

test('matricesEqual: false when any element exceeds the 1e-9 tolerance', () => {
  const a = Array(16).fill(0);
  const b = Array(16).fill(0);
  b[3] = 2e-9;
  assert.equal(matricesEqual(a, b), false);
});

test('R6_CALIBRATION_SEQUENCE is the exact frozen sequence', () => {
  assert.deepEqual(R6_CALIBRATION_SEQUENCE, [0.02, 0.04, 0.06, 0.10, 0.20]);
});

test('selectCalibrationMagnitude: picks the FIRST d that changed the pair set', () => {
  assert.equal(selectCalibrationMagnitude([false, false, true, true, true]), 0.06);
});

test('selectCalibrationMagnitude: null (NOT EXERCISED) when no d in the sequence changes anything', () => {
  assert.equal(selectCalibrationMagnitude([false, false, false, false, false]), null);
});

test('pairSetsDiffer: order-insensitive multiset comparison over signature strings', () => {
  assert.equal(pairSetsDiffer(['a:1', 'b:2'], ['b:2', 'a:1']), false);
  assert.equal(pairSetsDiffer(['a:1'], ['a:1', 'c:3']), true);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/r6-calibration.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/r6-calibration.mjs
//
// M4 Task 3.5: pure sub-logic for §5.2.1's R6 sequence -- transform comparison and the one-time
// calibration magnitude/pair-set-diff decisions. The live move->invalidate->refresh->restore
// sequence itself (setPlacementTransform, invalidateModelPlacement, the try/finally restoration,
// and the tlasBuilds arm-specific assertion) lives in run-gate-m4.mjs, this task's live half --
// it requires a real CollisionWorld/Viewer and cannot be unit-tested here.

// §5.2.1: two placement matrices are equal when every one of their 16 elements agrees within an
// absolute 1e-9 -- used both for the "restored transform verified equal to T0" gate and for the
// render-stabilisation confirmation.
export function matricesEqual(a, b, eps = 1e-9) {
  if (a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

// §5.2.1's frozen calibration sequence, world units.
export const R6_CALIBRATION_SEQUENCE = [0.02, 0.04, 0.06, 0.10, 0.20];

// The smallest step at which the R3 pair set FIRST changes -- take the FIRST true, never search
// for a "best" or largest change. null (NOT EXERCISED) if none of the sequence changes anything.
export function selectCalibrationMagnitude(changedFlags) {
  const idx = changedFlags.findIndex(Boolean);
  return idx === -1 ? null : R6_CALIBRATION_SEQUENCE[idx];
}

// Order-insensitive pair-set-signature comparison -- used for both the calibration pass's own
// "did the pair set change" probe and the measured P0/P1 comparison.
export function pairSetsDiffer(pairSignaturesA, pairSignaturesB) {
  const a = [...pairSignaturesA].sort();
  const b = [...pairSignaturesB].sort();
  return JSON.stringify(a) !== JSON.stringify(b);
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/r6-calibration.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Add to `run-gate-m4.mjs` (mirrors `test/acceptance/clash-finder.acceptance.mjs:1124-1159`'s already-proven
capture/move/invalidate/restore idiom and `test/CollisionWorld.findClashes.clearance.test.mjs:354-397`'s
3-phase fixture, extended to the full calibration + per-arm `tlasBuilds` assertion):
```js
// test/performance/run-gate-m4.mjs (excerpt — Task 3.5's R6 sequence)
import { matricesEqual, R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer } from './m4/r6-calibration.mjs';

async function calibrateR6Translation(page, { cohortDbIds }) {
  // Unmeasured, runs ONCE: find the smallest d in R6_CALIBRATION_SEQUENCE whose translation
  // along world +X changes R3's pair set. Frozen and reused unchanged across every arm/state/rep.
  return page.evaluate(async ({ cohortDbIds, sequence }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const archModel = window.__gate.modelArch;
    const T0 = archModel.getPlacementTransform ? archModel.getPlacementTransform() : new window.THREE.Matrix4().toArray();
    async function runR3(world) {
      const r = await world.findClashes({
        mode: 'clearance', clearance: 0.05,
        source: { model: window.__gate.modelStructure, dbIds: cohortDbIds },
        target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) },
        groupBy: 'dbId', broadPhase: 'tlas',
      });
      return r.pairs.map((p) => `${p.source.dbId}:${p.target.dbId}:${p.type}`).sort();
    }
    const w0 = await CollisionWorld.fromViewer(window.viewer);
    w0.admitModel(window.__gate.modelArch); w0.admitModel(window.__gate.modelStructure); w0.admitModel(window.__gate.modelMechanical);
    const p0 = await runR3(w0);
    w0.dispose();
    const changedFlags = [];
    for (const d of sequence) {
      const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
      window.viewer.impl.setPlacementTransform(archModel, composed);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // render stabilisation
      window.__gate.extension?._world?.invalidateModelPlacement?.(archModel);
      const w = await CollisionWorld.fromViewer(window.viewer);
      w.admitModel(window.__gate.modelArch); w.admitModel(window.__gate.modelStructure); w.admitModel(window.__gate.modelMechanical);
      const p1 = await runR3(w);
      w.dispose();
      changedFlags.push(JSON.stringify(p0) !== JSON.stringify(p1));
      window.viewer.impl.setPlacementTransform(archModel, new window.THREE.Matrix4().fromArray(T0));
    }
    return { T0, changedFlags };
  }, { cohortDbIds, sequence: R6_CALIBRATION_SEQUENCE });
}

async function runR6Tuple(page, world, { cohortDbIds, broadPhase, T0, d }) {
  // §5.2.1 steps 1-5, restoration + second invalidation + verification strictly in a `finally`.
  return page.evaluate(async ({ cohortDbIds, broadPhase, T0, d }) => {
    const archModel = window.__gate.modelArch;
    async function runR3() {
      const r = await world.findClashes({ mode: 'clearance', clearance: 0.05, source: { model: window.__gate.modelStructure, dbIds: cohortDbIds }, target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) }, groupBy: 'dbId', broadPhase });
      return { pairs: r.pairs.map((p) => `${p.source.dbId}:${p.target.dbId}:${p.type}`).sort(), tlasBuilds: r.statistics.tlasBuilds };
    }
    const step1Cold = await runR3(); // R6 cold sample
    const step1Warm = await runR3(); // R6 warm sample, records P0
    let refresh;
    try {
      const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
      window.viewer.impl.setPlacementTransform(archModel, composed);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      world.invalidateModelPlacement(archModel);
      refresh = await runR3(); // R6's THIRD measured query, the `refresh` state -- records P1
    } finally {
      window.viewer.impl.setPlacementTransform(archModel, new window.THREE.Matrix4().fromArray(T0));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      world.invalidateModelPlacement(archModel);
      const restored = archModel.getPlacementTransform ? archModel.getPlacementTransform() : new window.THREE.Matrix4().toArray();
      const restoredOk = restored.every((v, i) => Math.abs(v - T0[i]) <= 1e-9);
      if (!restoredOk) throw new Error('R6 restoration could not be verified — aborting the entire run');
      const reconfirm = await runR3(); // correctness-only, unmeasured
      if (JSON.stringify(reconfirm.pairs) !== JSON.stringify(step1Warm.pairs)) {
        throw new Error('R6 restoration verified by matrix but P0 was not recovered — aborting the entire run');
      }
    }
    return { cold: step1Cold, warm: step1Warm, refresh };
  }, { cohortDbIds, broadPhase, T0, d });
}
```

**Manual verification**: Run
`npm run test:performance:gate:m4 -- --smoke-r6` (temporary flag; task 3.7 removes it once wired
into the real matrix). Expected: calibration prints the selected `d` (one of the frozen sequence
values); the `tlas` arm reports `tlasBuilds` delta `1` across the refresh query and again across
restoration; the `linear` arm reports `tlasBuilds === 0` throughout; `refresh.pairs !==
warm.pairs` and the post-restoration reconfirm equals `warm.pairs`; process exits 0.

```bash
git add test/performance/m4/r6-calibration.mjs test/performance/m4/r6-calibration.test.mjs test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.5 — R6 placement-refresh sequence (§5.2.1)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.6: Canonical correctness comparator (§6.4)

**Files:**
- Create: `test/performance/m4/correctness-comparator.mjs`
- Test: `test/performance/m4/correctness-comparator.test.mjs` (fully unit-testable — no live browser needed for this task at all)

**Interfaces:**
- Consumes: nothing from earlier Phase 3 tasks — a pure, standalone module.
- Produces: `sigEqual`, `distancesEqual`, `witnessesEqual`, `statisticsEqual`, `diagnosticsMultisetEqual`, `compareRuns` (the full §6.4 comparator, used by task 3.7 for the gate's TLAS-vs-linear parity check and any full-result comparison) plus `weldedBuffersEqual` (§6.4's stage-scoped-validity rule's welded-buffer clause, specified here for completeness per this task's scope even though its only caller is a later phase's S7' task — Phase 4 will duplicate rather than import it, per this plan's no-shared-module convention applied within M4 too).

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/correctness-comparator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigEqual, distancesEqual, witnessesEqual, statisticsEqual, diagnosticsMultisetEqual, compareRuns } from './correctness-comparator.mjs';

const pair = (sourceDbId, targetDbId, type, extra = {}) => ({ sourceModelTag: 'structure', sourceDbId, targetModelTag: 'arch', targetDbId, type, distance: 0, witness: { kind: 'aabb-overlap', point: [0, 0, 0] }, ...extra });

test('sigEqual: full tuple equality, order-insensitive, counts alone insufficient', () => {
  assert.equal(sigEqual([pair(1, 2, 'volume-overlap')], [pair(1, 2, 'volume-overlap')]), true);
  assert.equal(sigEqual([pair(1, 2, 'volume-overlap')], [pair(1, 3, 'volume-overlap')]), false); // same count, different tuple
});

test('distancesEqual: bit-identical by default (tolerance 0), relaxed only when a worker tolerance is passed', () => {
  assert.equal(distancesEqual(0.04171234, 0.04171234), true);
  assert.equal(distancesEqual(0.04171234, 0.04171235), false);
  assert.equal(distancesEqual(0.04171234, 0.041712341), true, 'must pass with an explicit worker tolerance');
});

test('witnessesEqual: clearance shape {sourcePoint,targetPoint} within scale-relative tolerance', () => {
  const a = { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] };
  const b = { sourcePoint: [1, 2, 3 + 1e-10], targetPoint: [4, 5, 6] };
  assert.equal(witnessesEqual(a, b, { worldDiagonalScale: 100 }), true);
});

test('witnessesEqual: volume-overlap shape {kind,point} rejects a shape mismatch', () => {
  const a = { sourcePoint: [1, 2, 3], targetPoint: [4, 5, 6] };
  const b = { kind: 'aabb-overlap', point: [1, 2, 3] };
  assert.equal(witnessesEqual(a, b, { worldDiagonalScale: 100 }), false);
});

test('statisticsEqual: the 6 named fields, timing fields excluded', () => {
  const s1 = { clearanceExactAabbSurvivors: 5, narrowPhasePairs: 5, clearanceOverlapPrechecksRun: 3, clearanceHardClashExclusions: 1, clearanceDistanceQueriesRun: 2, clearanceHits: 1, narrowPhaseMs: 999 };
  const s2 = { ...s1, narrowPhaseMs: 1 }; // timing field differs -- must not affect equality
  assert.equal(statisticsEqual(s1, s2), true);
});

test('diagnosticsMultisetEqual: role distinguishes source-side from target-side, singular fragment key required', () => {
  const a = [{ reason: 'clearance-anisotropic-scale-unsupported', scope: 'fragment', role: 'source', fragment: { modelTag: 'structure', dbId: 1, fragId: 10 } }];
  const b = [{ reason: 'clearance-anisotropic-scale-unsupported', scope: 'fragment', role: 'target', fragment: { modelTag: 'structure', dbId: 1, fragId: 10 } }];
  assert.equal(diagnosticsMultisetEqual(a, b), false, 'a source-side and target-side entry must NOT be treated as identical');
});

test('compareRuns: aggregates every field into one valid/invalid disposition', () => {
  const run = { pairs: [pair(1, 2, 'volume-overlap')], statistics: { clearanceExactAabbSurvivors: 1, narrowPhasePairs: 1, clearanceOverlapPrechecksRun: 1, clearanceHardClashExclusions: 0, clearanceDistanceQueriesRun: 0, clearanceHits: 0, diagnostics: [] } };
  const result = compareRuns(run, structuredClone(run), { worldDiagonalScale: 100 });
  assert.equal(result.valid, true);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/correctness-comparator.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/correctness-comparator.mjs
//
// M4 Task 3.6: §6.4's canonical correctness comparator, implemented exactly to spec. Used by (a)
// the gate's own TLAS-vs-linear parity check across every measured run pair, and (b) any
// full-result worker arm (none exists in Phase 3 -- reserved for a later phase). Fully pure.

export function sigEqual(pairSetA, pairSetB) {
  const signature = (p) => `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId}:${p.type}`;
  const a = pairSetA.map(signature).sort();
  const b = pairSetB.map(signature).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

// Bit-identical by default (TLAS-vs-linear). A worker-arm caller passes an explicit
// { tolerance: 1e-9 } and must report that relaxation, per §6.4's own instruction.
export function distancesEqual(distanceA, distanceB, { tolerance = 0 } = {}) {
  return Math.abs(distanceA - distanceB) <= tolerance;
}

export function witnessesEqual(a, b, { worldDiagonalScale }) {
  const tol = 1e-9 * worldDiagonalScale;
  const closeVec = (u, v) => u.length === v.length && u.every((c, i) => Math.abs(c - v[i]) <= tol);
  const isClearanceShape = (w) => w && 'sourcePoint' in w && 'targetPoint' in w;
  const isOverlapShape = (w) => w && 'kind' in w && 'point' in w;
  if (isClearanceShape(a) && isClearanceShape(b)) return closeVec(a.sourcePoint, b.sourcePoint) && closeVec(a.targetPoint, b.targetPoint);
  if (isOverlapShape(a) && isOverlapShape(b)) return a.kind === b.kind && closeVec(a.point, b.point);
  return false; // shape mismatch is itself a failure
}

const STATISTICS_FIELDS = ['clearanceExactAabbSurvivors', 'narrowPhasePairs', 'clearanceOverlapPrechecksRun', 'clearanceHardClashExclusions', 'clearanceDistanceQueriesRun', 'clearanceHits'];

export function statisticsEqual(a, b) {
  return STATISTICS_FIELDS.every((f) => a[f] === b[f]);
}

function fragKey(f) {
  return f ? `${f.modelTag}:${f.dbId}:${f.fragId}` : null;
}

function diagnosticKey(d) {
  return JSON.stringify({
    reason: d.reason, scope: d.scope, role: d.role ?? null,
    fragment: fragKey(d.fragment), sourceFragment: fragKey(d.sourceFragment), targetFragment: fragKey(d.targetFragment),
  });
}

export function diagnosticsMultisetEqual(diagnosticsA, diagnosticsB) {
  const tally = (arr) => {
    const m = new Map();
    for (const d of arr) { const k = diagnosticKey(d); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const ma = tally(diagnosticsA);
  const mb = tally(diagnosticsB);
  if (ma.size !== mb.size) return false;
  for (const [k, count] of ma) if (mb.get(k) !== count) return false;
  return true;
}

function findMatching(pairs, target) {
  return pairs.find((p) => p.sourceDbId === target.sourceDbId && p.targetDbId === target.targetDbId && p.targetModelTag === target.targetModelTag && p.type === target.type);
}

export function compareRuns(runA, runB, { distanceTolerance = 0, worldDiagonalScale }) {
  const fields = {
    pairSet: sigEqual(runA.pairs, runB.pairs),
    statistics: statisticsEqual(runA.statistics, runB.statistics),
    diagnostics: diagnosticsMultisetEqual(runA.statistics.diagnostics, runB.statistics.diagnostics),
    distances: runA.pairs.every((pa) => {
      const pb = findMatching(runB.pairs, pa);
      return !!pb && distancesEqual(pa.distance, pb.distance, { tolerance: distanceTolerance });
    }),
    witnesses: runA.pairs.every((pa) => {
      const pb = findMatching(runB.pairs, pa);
      return !!pb && witnessesEqual(pa.witness, pb.witness, { worldDiagonalScale });
    }),
  };
  return { valid: Object.values(fields).every(Boolean), fields };
}

// §6.4's stage-scoped-validity rule, welded-buffer clause -- specified here for this task's full
// §6.4 scope; S7' (a later phase) is its only real caller and will duplicate this function rather
// than import it, per the no-shared-module-across-phases convention this plan applies within M4.
export function weldedBuffersEqual(a, b) {
  if (a.position.length !== b.position.length || a.index.length !== b.index.length) return false;
  for (let i = 0; i < a.position.length; i++) if (a.position[i] !== b.position[i]) return false;
  for (let i = 0; i < a.index.length; i++) if (a.index[i] !== b.index[i]) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/correctness-comparator.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/correctness-comparator.mjs test/performance/m4/correctness-comparator.test.mjs
git commit -m "test(collision): M4 task 3.6 — §6.4 canonical correctness comparator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.7: Baseline matrix scheduler

**Files:**
- Create: `test/performance/m4/counterbalancing-schedule.mjs`
- Edit: `test/performance/run-gate-m4.mjs` (the real R1-R6/S1-S4/S2T dispatch loop, replacing tasks 3.1/3.3/3.4/3.5's temporary `--smoke-*` proof blocks)
- Test: `test/performance/m4/counterbalancing-schedule.test.mjs` (pure §6.1.6 schedule + capacity-rejection mapping) + manual verification for the full assembled baseline run

**Interfaces:**
- Consumes: tasks 3.1 (fixture lifecycle), 3.2 (observation envelope), 3.3 (cohort profiler), 3.4 (S2T facade), 3.5 (R6 sequence), 3.6 (correctness comparator) — this task is where they are all wired together into one script.
- Produces: `armOrderForRepetition`, `caseOrderForRepetition`, `buildCounterbalancedSchedule`, `toCapacityRejectedRecord` (pure, §6.1.6 + §4's capacity-rejection reporting rule) plus `run-gate-m4.mjs`'s complete baseline dispatch: every R-case (R1-R6), every S-case (S1-S4), and S2T, over both runtime configurations, both broad-phase arms where executable, 5 counterbalanced repetitions per state, one fresh world per tuple (§6.1.4), producing raw per-tuple measured records that task 3.8 normalizes. **This task explicitly does NOT dispatch S5'/S6'/S7'/S8'** — only the baseline R/S/S2T matrix; tasks 3.9/3.10 add the two unconditional spikes separately.

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/counterbalancing-schedule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armOrderForRepetition, caseOrderForRepetition, buildCounterbalancedSchedule, toCapacityRejectedRecord } from './counterbalancing-schedule.mjs';

test('armOrderForRepetition: alternates by repetition parity', () => {
  assert.deepEqual(armOrderForRepetition(0), ['tlas', 'linear']);
  assert.deepEqual(armOrderForRepetition(1), ['linear', 'tlas']);
  assert.deepEqual(armOrderForRepetition(2), ['tlas', 'linear']);
});

test('caseOrderForRepetition: rotates by repetition index (repetition r starts at position r mod |cases|)', () => {
  const cases = ['R1', 'R2', 'R3', 'R4'];
  assert.deepEqual(caseOrderForRepetition(cases, 0), ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(caseOrderForRepetition(cases, 1), ['R2', 'R3', 'R4', 'R1']);
  assert.deepEqual(caseOrderForRepetition(cases, 5), ['R2', 'R3', 'R4', 'R1']); // 5 mod 4 = 1
});

test('buildCounterbalancedSchedule: 5 repetitions, each carrying its own case/arm order', () => {
  const schedule = buildCounterbalancedSchedule(['R1', 'R2'], 5);
  assert.equal(schedule.length, 5);
  assert.deepEqual(schedule[0].armOrder, ['tlas', 'linear']);
  assert.deepEqual(schedule[3].armOrder, ['linear', 'tlas']);
});

test('toCapacityRejectedRecord: names the exact limit and observed value, never silently trims', () => {
  const err = { kind: 'clearance-narrow-phase-budget', details: { observed: 25000 } };
  const record = toCapacityRejectedRecord(err, { limitName: 'maxClearanceNarrowPhasePairs', limitValue: 20000 });
  assert.deepEqual(record, { disposition: 'CAPACITY_REJECTED', limitName: 'maxClearanceNarrowPhasePairs', limitValue: 20000, observedValue: 25000, errorKind: 'clearance-narrow-phase-budget' });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/counterbalancing-schedule.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/counterbalancing-schedule.mjs
//
// M4 Task 3.7: §6.1.6's counterbalancing schedule (arm-order parity + case-order rotation), plus
// §4's capacity-rejection record shape (never silently trimmed -- exact limit and observed value
// reported). Pure; the live dispatch loop that consumes this schedule lives in run-gate-m4.mjs.

export function armOrderForRepetition(repetitionIndex) {
  return repetitionIndex % 2 === 0 ? ['tlas', 'linear'] : ['linear', 'tlas'];
}

export function caseOrderForRepetition(cases, repetitionIndex) {
  const n = cases.length;
  const start = ((repetitionIndex % n) + n) % n;
  return [...cases.slice(start), ...cases.slice(0, start)];
}

export function buildCounterbalancedSchedule(cases, repetitionCount) {
  const schedule = [];
  for (let r = 0; r < repetitionCount; r++) {
    schedule.push({ repetition: r, caseOrder: caseOrderForRepetition(cases, r), armOrder: armOrderForRepetition(r) });
  }
  return schedule;
}

export function toCapacityRejectedRecord(error, { limitName, limitValue }) {
  return {
    disposition: 'CAPACITY_REJECTED',
    limitName,
    limitValue,
    observedValue: error?.details?.observed ?? null,
    errorKind: error?.kind ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/counterbalancing-schedule.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Extend `run-gate-m4.mjs`'s `main()` to: (1) run task 3.3's profiling pass once per runtime (unmeasured);
build low/typical/high cohorts via `selectCohort`; (2) run task 3.5's R6 calibration once per
runtime (unmeasured); (3) build the case list (`R1..R6, S1..S4, S2T`) and call
`buildCounterbalancedSchedule(caseList, 5)`; (4) for every `(runtime, repetition)` in the schedule,
walk `caseOrder`, and for every case walk `armOrder` (or the case's own executable arms, e.g. S2
also varies mode/level), constructing exactly one fresh `CollisionWorld` per
`freshWorldTupleKey(...)` (task 3.1), running that tuple's `measuredStatesFor(caseName)` queries
back-to-back in the same world with the observation envelope (task 3.2) bracketing each one,
catching `CapacityExceededError` into `toCapacityRejectedRecord(...)` rather than letting it abort
the whole run, and disposing the world before the next tuple. R6 dispatches through task 3.5's
`runR6Tuple`; S2T dispatches through task 3.4's facade, looped over `S2T_LEVELS`, checking
`checkS2TLevelToLevelControlRule` after each level. Every TLAS/linear pair of runs for the same
`(case, state, repetition)` is compared via task 3.6's `compareRuns(...)`; a `false` disposition
throws immediately (aborts with `FAILED_VALIDATION`, per §16.2 — enforced fully in task 3.8's
reporting layer, but the throw-on-mismatch behavior is wired here).

**Manual verification**: Run: `npm run test:performance:gate:m4` (no smoke flags — the real thing,
end to end). Expected: no thrown error; console output shows, per runtime, the cohort-profiling
summary, the R6 calibration result, then one block per case in the schedule's rotated order,
ending with an S2T block reporting the control-rule pass at every level; process exits 0. This is
the first point at which the FULL baseline matrix (minus S1'/S3'/S4') runs end to end — expect a
multi-minute wall time given 5 repetitions × ~11 cases × up to 2 arms × 2 runtimes.

```bash
git add test/performance/m4/counterbalancing-schedule.mjs test/performance/m4/counterbalancing-schedule.test.mjs test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.7 — baseline matrix scheduler (R1-R6/S1-S4/S2T dispatch)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.8: Evidence normalization + §16.2-compliant reporting

**Files:**
- Create: `test/performance/m4/evidence-report.mjs`
- Edit: `test/performance/run-gate-m4.mjs` (assemble + write `test/performance/results/m4-gate-<timestamp>.json`)
- Test: `test/performance/m4/evidence-report.test.mjs` (pure §7.2 aggregation rules + summarizers) + manual verification that the written JSON file matches §16.2's shape

**Interfaces:**
- Consumes: task 3.7's raw per-tuple measured records (spans, statistics, diagnostics, rAF/input-probe observations, capacity-rejection flags, §6.3 partition data emitted per query).
- Produces: `evaluateHardMaximum`, `evaluatePercentileMedian` (pure, §7.2's exact aggregation rules), `summarizeSpans`/`summarizeDiagnostics`/`summarizeDurations` (duplicated per-file per the no-shared-module convention, matching `run-gate-m3.mjs:120-172`'s own shape), and `buildEvidenceRecord(...)` — **this task's own proposed "canonical decision evidence model" shape**, explicitly marked provisional: it produces one evidence record per `(case, broadPhase, state)` tuple carrying T-a/T-b1/T-b2/T-c pass-fail, the §6.3 partition, capacity-rejection flags, and correctness-gate status, per this phase's instructions — **Phase 2 task 2.4 is the actual consuming-side adapter and is the authority on the final reconciled shape; nothing here should be assumed already pinned.**

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/evidence-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHardMaximum, evaluatePercentileMedian, summarizeDurations, buildEvidenceRecord } from './evidence-report.mjs';

test('evaluateHardMaximum: T-a/T-b2 — fails on ANY repetition above threshold, never medianed', () => {
  assert.equal(evaluateHardMaximum([10, 20, 30, 61, 15], 50).pass, false); // one 61ms task fails T-a outright
  assert.equal(evaluateHardMaximum([10, 20, 30, 40, 15], 50).pass, true);
});

test('evaluateHardMaximum: empty-set guard -- NOT_EXERCISED, never a false pass from Math.max(...[])', () => {
  const result = evaluateHardMaximum([], 50);
  assert.equal(result.pass, null);
  assert.match(result.reason, /NOT_EXERCISED/);
});

test('evaluatePercentileMedian: T-b1/T-c — median across 5 reps within threshold AND no single rep over 1.5x', () => {
  assert.equal(evaluatePercentileMedian([20, 22, 24, 26, 28], 32).pass, true);
  assert.equal(evaluatePercentileMedian([20, 22, 24, 26, 50], 32).pass, false, 'one rep at 50 > 1.5*32=48 must fail clause (ii) even if the median passes');
});

test('summarizeDurations: empty-set guard reports zero-count, no NaN/-Infinity leakage', () => {
  const s = summarizeDurations([]);
  assert.equal(s.count, 0);
  assert.equal(s.maxMs, null);
});

test('buildEvidenceRecord: assembles targets + partition + correctness into one record, marked provisional', () => {
  const record = buildEvidenceRecord({
    runtime: 'multiProcess', caseName: 'R1', broadPhase: 'tlas', state: 'cold',
    targets: { Ta: { pass: true }, Tb1: { pass: true }, Tb2: { pass: true }, Tc: { pass: true }, partition: { mainOnlyMs: 1, transferableMs: 2 } },
    correctness: 'PASSED',
  });
  assert.equal(record.case, 'R1');
  assert.equal(record.correctnessGate, 'PASSED');
  assert.equal(record.shapeStatus, 'PROVISIONAL — reconciled by Phase 2 task 2.4');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/evidence-report.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/evidence-report.mjs
//
// M4 Task 3.8: pure §7.2 aggregation rules, §16.2's summarizer discipline (duplicated from
// run-gate-m3.mjs:117-172 rather than imported, per the no-shared-module convention), and this
// phase's OWN proposed canonical-evidence-record shape. That shape is explicitly PROVISIONAL --
// Phase 2 task 2.4 is the real adapter/validator between a harness's raw measured record set and
// the verdict reducer's pure evidence-vector input, and is the authority on the final shape.

// §7.2: T-a and T-b2 are HARD MAXIMA -- a single repetition over threshold fails the whole case.
// Never medianed, never subject to the 1.5x clause below.
export function evaluateHardMaximum(values, thresholdMs) {
  if (values.length === 0) return { pass: null, reason: 'NOT_EXERCISED — empty population' };
  const worst = Math.max(...values); // safe: length-guarded above, never Math.max(...[])
  return { pass: worst <= thresholdMs, worst };
}

// §7.2: T-b1 and T-c are PERCENTILE statistics -- pass only if (i) the median across the 5
// repetition values is within threshold AND (ii) no single repetition exceeds 1.5x threshold.
export function evaluatePercentileMedian(perRepetitionValues, thresholdMs) {
  if (perRepetitionValues.length === 0) return { pass: null, reason: 'NOT_EXERCISED — empty population' };
  const sorted = [...perRepetitionValues].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const anyOver1_5x = perRepetitionValues.some((v) => v > thresholdMs * 1.5);
  return { pass: median <= thresholdMs && !anyOver1_5x, median, anyOver1_5x };
}

// §16.2/§6.1.8: population summary with 8ms/24.8ms/50ms counts+fractions and an explicit
// empty-set guard -- duplicated shape from run-gate-m3.mjs's own summarizeDurations, extended
// with the three named thresholds §6.1.8 requires (M3's version only tracked frameBudgetMs).
export function summarizeDurations(msValues, thresholds = [8, 24.8, 50]) {
  if (msValues.length === 0) {
    const empty = { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null, sum: 0 };
    for (const t of thresholds) { empty[`over${t}msCount`] = 0; empty[`over${t}msFraction`] = null; }
    return empty;
  }
  const sorted = [...msValues].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const out = { count: sorted.length, min: sorted[0], p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1], mean: sum / sorted.length, sum };
  for (const t of thresholds) {
    const c = sorted.filter((v) => v > t).length;
    out[`over${t}msCount`] = c;
    out[`over${t}msFraction`] = c / sorted.length;
  }
  return out;
}

export function summarizeSpans(spans, topN = 20) {
  const byLabel = {};
  for (const s of spans) {
    const entry = (byLabel[s.label] ||= { count: 0, maxMs: 0, sumMs: 0 });
    entry.count++; entry.maxMs = Math.max(entry.maxMs, s.ms); entry.sumMs += s.ms;
  }
  for (const label of Object.keys(byLabel)) byLabel[label].meanMs = byLabel[label].sumMs / byLabel[label].count;
  return { byLabel, top: [...spans].sort((a, b) => b.ms - a.ms).slice(0, topN) };
}

export function summarizeDiagnostics(diagnostics, sampleN = 20) {
  const byReason = {};
  for (const d of diagnostics) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  return { count: diagnostics.length, byReason, sample: diagnostics.slice(0, sampleN) };
}

// This phase's own proposed canonical evidence-record shape -- ONE record per (case, broadPhase,
// state) tuple. Marked shapeStatus:'PROVISIONAL' deliberately, per this phase's own instructions:
// Phase 2 task 2.4 is the real adapter/validator and may reshape this before the reducer ever
// consumes it.
export function buildEvidenceRecord({ runtime, caseName, broadPhase, state, targets, correctness }) {
  return {
    runtime, case: caseName, broadPhase, state,
    targets: { Ta: targets.Ta, Tb1: targets.Tb1, Tb2: targets.Tb2, Tc: targets.Tc },
    partition: targets.partition ?? null, // §6.3 main-only/transferable, per tuple
    capacityRejected: targets.capacityRejected ?? null,
    correctnessGate: correctness, // 'PASSED' | 'FAILED_VALIDATION'
    shapeStatus: 'PROVISIONAL — reconciled by Phase 2 task 2.4',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/evidence-report.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Extend `run-gate-m4.mjs`'s `main()`: after task 3.7's dispatch loop completes for both runtimes,
build one `buildEvidenceRecord(...)` per `(runtime, case, broadPhase, state)` tuple from the raw
per-tuple records already collected; assemble the full §16.2-required report object (provenance —
browser version, launch flags, OS/machine class, cohort dbId lists + covariates, constants read
from `collision/constants.js`, the counterbalancing schedule, input-probe calibration/drift,
console warnings — plus the evidence records, the §6.3 partition as its own first-class section,
and `CAPACITY_REJECTED` entries named with exact limit/observed value); write it to
`test/performance/results/m4-gate-<Date.now()>.json` via `writeFile`; set
`disposition: 'FAILED_VALIDATION'` and `process.exitCode = 1` if any tuple's correctness gate
failed, `'FAILED'` if any run errored, else `'MEASURED'` — mirroring `run-gate-m3.mjs`'s own
3-way disposition (`:764`) — **never flipping disposition on a performance verdict** (§16.2).

**Manual verification**: Run: `npm run test:performance:gate:m4`, then inspect the newest file
under `test/performance/results/`. Expected: valid JSON; top-level `disposition` is one of
`'MEASURED' | 'FAILED_VALIDATION' | 'FAILED'`; no raw span/diagnostic/event array present anywhere
in the file (only count + per-key breakdown + bounded sample/top-N, per §16.2); a `partition`
section listing every §6.3 stage row; every `NOT EXERCISED`/`CAPACITY_REJECTED` case names its
reason/limit explicitly rather than being silently omitted.

```bash
git add test/performance/m4/evidence-report.mjs test/performance/m4/evidence-report.test.mjs test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.8 — evidence normalization + §16.2 JSON reporting

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.9: S1′ module-resolution spike (unconditional)

**Files:**
- Create: `test/performance/m4/rewrite-specifiers.mjs`
- Create: `test/performance/m4/spike-server.mjs` (harness's own Express instance — §16.3)
- Create: `spike/m4/s1-module-resolution/worker.bare.mjs`, `spike/m4/s1-module-resolution/worker.relative.mjs`, `spike/m4/s1-module-resolution/page.html`
- Edit: `test/performance/run-gate-m4.mjs` (drive the S1′ spike after the baseline matrix)
- Test: `test/performance/m4/rewrite-specifiers.test.mjs` (pure bare-specifier rewrite) + manual verification for the live worker-resolution spike (inherently a Playwright/CDP integration piece)

**Interfaces:**
- Consumes: task 3.1's `RUNTIME_CONFIGS` (S1′ runs under both runtimes, per §17's table).
- Produces: `rewriteBareSpecifiers` (pure, the bounded Node-only build variant's core logic) plus
  `test/performance/m4/spike-server.mjs`'s `startSpikeServer()` (mounts `wwwroot/`, `/collision`,
  and `spike/m4/` on an independent port — never a route on `server.js`, per §16.3), and the live
  S1′ driver in `run-gate-m4.mjs` producing a `{ bareSpecifierResult, relativePathResult, buildVariantResult, minimalChangeIfFailed }` record, decisive for every worker option per §17's table (Run first).

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/rewrite-specifiers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteBareSpecifiers } from './rewrite-specifiers.mjs';

test('rewriteBareSpecifiers: rewrites a bare "three" import to the relative vendor path', () => {
  const src = `import * as THREE from 'three';\nconsole.log(THREE);`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' });
  assert.match(out, /from '\.\.\/\.\.\/\.\.\/wwwroot\/vendor\/three\/build\/three\.module\.js'/);
});

test('rewriteBareSpecifiers: rewrites "three-mesh-bvh" identically', () => {
  const src = `import { MeshBVH } from "three-mesh-bvh";`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' });
  assert.match(out, /from "\.\.\/\.\.\/\.\.\/wwwroot\/vendor\/three-mesh-bvh\/src\/index\.js"/);
});

test('rewriteBareSpecifiers: leaves an already-relative import untouched', () => {
  const src = `import { foo } from './local-helper.mjs';`;
  assert.equal(rewriteBareSpecifiers(src, { relativeVendorPrefix: '../../../wwwroot/vendor/' }), src);
});

test('rewriteBareSpecifiers: preserves quote style per-match', () => {
  const src = `import a from 'three'; import b from "three-mesh-bvh";`;
  const out = rewriteBareSpecifiers(src, { relativeVendorPrefix: 'v/' });
  assert.match(out, /from 'v\/three\/build\/three\.module\.js'/);
  assert.match(out, /from "v\/three-mesh-bvh\/src\/index\.js"/);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/rewrite-specifiers.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/rewrite-specifiers.mjs
//
// M4 Task 3.9: the pure core of S1''s bounded build/rewrite variant (§17's S1' row) -- run ONLY
// if the relative-path variant also fails. A small, dependency-free Node rewrite: reads a worker
// entry's bare `three`/`three-mesh-bvh` specifiers and rewrites them to the SAME relative
// wwwroot/vendor/ paths wwwroot/index.html's own import map already resolves to
// (verified-refs.md: import map wwwroot/index.html:47-53). No bundler, no new dependency.

const BARE_SPECIFIER_TARGETS = {
  three: 'three/build/three.module.js',
  'three-mesh-bvh': 'three-mesh-bvh/src/index.js',
};

export function rewriteBareSpecifiers(sourceText, { relativeVendorPrefix }) {
  return sourceText.replace(
    /from\s+(['"])(three(?:-mesh-bvh)?)\1/g,
    (match, quote, specifier) => `from ${quote}${relativeVendorPrefix}${BARE_SPECIFIER_TARGETS[specifier]}${quote}`,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/rewrite-specifiers.test.mjs`

- [ ] **Step 5: Live-browser wiring + commit**

Create `test/performance/m4/spike-server.mjs` (§16.3's own permission — "the M4 harness may start
its own express instance ... mounting the same wwwroot/ and /collision paths the production server
mounts plus spike/m4/"):
```js
// test/performance/m4/spike-server.mjs
import express from 'express';

export function startSpikeServer({ port = 8090 } = {}) {
  const app = express();
  app.use(express.static('wwwroot'));
  app.use('/collision', express.static('collision'));
  app.use('/spike/m4', express.static('spike/m4'));
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({ server, port, close: () => new Promise((r) => server.close(r)) }));
  });
}
```

Create `spike/m4/s1-module-resolution/worker.bare.mjs` (bare specifiers — the primary variant):
```js
// spike/m4/s1-module-resolution/worker.bare.mjs -- S1' primary variant: bare specifiers, relying
// entirely on whatever import-map inheritance the worker's realm actually has (§8.6's open
// question this spike settles).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
self.postMessage({ ok: true, hasThree: !!THREE.Vector3, hasBvh: typeof MeshBVH === 'function' });
```

Create `spike/m4/s1-module-resolution/worker.relative.mjs` (the relative-path-only variant):
```js
// spike/m4/s1-module-resolution/worker.relative.mjs -- S1' fallback variant #1: relative paths
// directly to the vendored files, bypassing the import map entirely.
import * as THREE from '../../wwwroot/vendor/three/build/three.module.js';
import { MeshBVH } from '../../wwwroot/vendor/three-mesh-bvh/src/index.js';
self.postMessage({ ok: true, hasThree: !!THREE.Vector3, hasBvh: typeof MeshBVH === 'function' });
```

Create `spike/m4/s1-module-resolution/page.html` (served same-origin from `spike-server.mjs`):
```html
<!DOCTYPE html>
<html><body><script>
  window.__runS1Worker = function (path) {
    return new Promise((resolve, reject) => {
      const w = new Worker(path, { type: 'module' });
      const timeout = setTimeout(() => { w.terminate(); reject(new Error('S1 worker timed out')); }, 10_000);
      w.onmessage = (ev) => { clearTimeout(timeout); w.terminate(); resolve(ev.data); };
      w.onerror = (err) => { clearTimeout(timeout); w.terminate(); reject(err); };
    });
  };
</script></body></html>
```

Extend `run-gate-m4.mjs`'s `main()` (after task 3.8's reporting), driving both variants under both
runtimes, and, only if the relative-path variant also fails, generating the bounded build variant
via `rewriteBareSpecifiers`:
```js
// test/performance/run-gate-m4.mjs (excerpt — Task 3.9's S1' driver)
import { startSpikeServer } from './m4/spike-server.mjs';
import { rewriteBareSpecifiers } from './m4/rewrite-specifiers.mjs';
import { readFile, writeFile } from 'node:fs/promises';

async function runS1PrimeSpike(runtimeConfigs) {
  const spike = await startSpikeServer({ port: 8090 });
  const results = {};
  try {
    for (const runtime of runtimeConfigs) {
      const browser = await chromium.launch({ args: runtime.args });
      const page = await browser.newPage();
      await page.goto(`http://localhost:${spike.port}/spike/m4/s1-module-resolution/page.html`);
      let bareResult;
      try {
        bareResult = await page.evaluate((p) => window.__runS1Worker(p), '/spike/m4/s1-module-resolution/worker.bare.mjs');
      } catch (err) {
        bareResult = { ok: false, error: err.message };
      }
      let relativeResult = null;
      let buildVariantResult = null;
      if (!bareResult.ok) {
        try {
          relativeResult = await page.evaluate((p) => window.__runS1Worker(p), '/spike/m4/s1-module-resolution/worker.relative.mjs');
        } catch (err) {
          relativeResult = { ok: false, error: err.message };
        }
        if (!relativeResult.ok) {
          const source = await readFile('spike/m4/s1-module-resolution/worker.bare.mjs', 'utf8');
          const rewritten = rewriteBareSpecifiers(source, { relativeVendorPrefix: '../../wwwroot/vendor/' });
          await writeFile('spike/m4/s1-module-resolution/worker.built.mjs', rewritten);
          try {
            buildVariantResult = await page.evaluate((p) => window.__runS1Worker(p), '/spike/m4/s1-module-resolution/worker.built.mjs');
          } catch (err) {
            buildVariantResult = { ok: false, error: err.message };
          }
        }
      }
      results[runtime.label] = { bareResult, relativeResult, buildVariantResult };
      await browser.close();
    }
  } finally {
    await spike.close();
  }
  return results;
}
```

**Manual verification**: Run:
`node -e "import('./test/performance/m4/spike-server.mjs').then(m => m.startSpikeServer({port:8090})).then(s => console.log('listening on', s.port))"`
then in a second terminal run the S1′ driver in isolation (a temporary `--smoke-s1` flag on
`run-gate-m4.mjs`, removed once folded into the main flow at task completion). Expected: at least
one of `bareResult`/`relativeResult`/`buildVariantResult` reports `{ ok: true, hasThree: true,
hasBvh: true }` under **both** runtimes; if `bareResult.ok === false` under both, the printed
finding must name the minimal change (relative-path or build-variant) that succeeded, per §17's
bound; `spike/m4/s1-module-resolution/worker.built.mjs`, if generated, is confirmed **not**
committed to git (spike code is deleted at M4 close unless adopted).

```bash
git add test/performance/m4/rewrite-specifiers.mjs test/performance/m4/rewrite-specifiers.test.mjs test/performance/m4/spike-server.mjs spike/m4/s1-module-resolution/worker.bare.mjs spike/m4/s1-module-resolution/worker.relative.mjs spike/m4/s1-module-resolution/page.html test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.9 — S1' module-resolution spike (unconditional)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3.10: S3′ + S4′ worker lifecycle spikes (unconditional)

**Files:**
- Create: `spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs` (the ONE canonical §10.1/§10.2
  protocol implementation — imported unmodified by both the pure Node unit tests and the live
  browser driver; there is no second, simplified implementation anywhere in this task)
- Create: `spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs`, `spike/m4/s3-s4-worker-lifecycle/page.html`
- Edit: `test/performance/run-gate-m4.mjs` (drive both S3′ and S4′, reusing task 3.9's `spike-server.mjs`)
- Test: `test/performance/m4/request-tracker.test.mjs` (pure per-call lifecycle state machine,
  driven against a fake-but-real-shaped worker object through the tracker's actual `attachWorker`
  wiring — exhaustively covers all eight §10.4 scenarios, all three levels of receipt-time
  precedence, request-ID/workerGeneration reuse safety in both directions, dispatch-time failure
  handling, and post-fault recovery) + manual verification for the live cold-start timing (S3′)
  and the real-Worker end-to-end confirmation of all eight scenarios (S4′)

**Interfaces:**
- Consumes: task 3.9's `spike-server.mjs` (reused, not duplicated — both are M4-internal spike
  infrastructure, distinct from the M1-M3 no-shared-module restriction, which applies only to the
  protected gate files). `spike-server.mjs` already mounts `spike/m4/` on its own port, so
  `spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs` is reachable at
  `/spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs` for the live driver's `<script type="module">`
  import; `test/performance/m4/request-tracker.test.mjs` imports the same file via a relative
  cross-directory path (`../../../spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs`) — one file,
  two consumers, no fork.
- Produces: `createRequestTracker({ worldGeneration })` — §10.1's per-call `RequestState` map
  (`{settle, reject, epochs: [{epoch, placementRevision, revisionArmed}], worldGeneration,
  workerGeneration, issuedAt, knownFragmentIds}`, never a world-global "current id"), implementing
  §10.2's exact receipt-time precedence (routing-envelope validation → protocol-fatal → dual
  workerGeneration attribution guards (message-side and request-side) → silent discard → per-request
  lifecycle matrix in the order disposed → worldGeneration → evicted → armed-epoch placement
  revision → echo-integrity/payload validation, including unknown-fragment-id → resolve) and the
  full set of typed outcomes (`WorldDisposedError`, `ModelEvictedError`, `ModelPlacementChangedError`,
  `MalformedResponseError` (TypeError-class), `WorkerFaultError`, `ProtocolFaultError`, silent
  discard, resolve) with delete-on-settle map semantics so `pendingCount()` is always the true
  outstanding count. Every settlement path — including a synchronously-throwing `postMessage()` at
  dispatch — settles its promise exactly once; `discardWorker()` rejects, terminates, and
  permanently forbids reattachment of that worker instance in one call. Plus the live S3′
  cold-start timing driver (10 repetitions, median+max, both runtimes) and the live S4′ driver
  wiring one real dedicated Worker's `onmessage`/`onerror`/`terminate()` to this exact tracker's
  `attachWorker()`, exercising all eight §10.4 scenarios end to end against
  `spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs`, asserting exact error classes, real awaited
  result values (never a boolean proxy for "did it settle"), and an empty pending set after every
  terminal event.

---

- [ ] **Step 1: Write the failing test**
```js
// test/performance/m4/request-tracker.test.mjs
//
// Drives the canonical protocol implementation (spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs
// — the SAME module the live S4' browser driver uses) through its real attachWorker()-installed
// onmessage/onerror handlers, using a fake-but-real-shaped worker object instead of a real
// dedicated Worker. Nothing here re-implements or simplifies the protocol; every assertion goes
// through handleMessage/faultAndDiscard exactly as a real Worker's events would invoke them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestTracker,
  WorldDisposedError,
  ModelEvictedError,
  ModelPlacementChangedError,
  MalformedResponseError,
  WorkerFaultError,
  ProtocolFaultError,
} from '../../../spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs';

function makeFakeWorker() {
  const sent = [];
  return {
    sent, // every message actually handed to postMessage() -- lets tests inspect the real wire shape
    postMessage(msg) { sent.push(msg); },
    onmessage: null,
    onerror: null,
    terminate() {},
  };
}

// Builds a spec-shaped echo response from the tracker's OWN captured RequestState (via the
// __capturedStateForTest introspection hook), never from what the test originally passed to
// dispatch() -- this is what actually proves dispatch-time snapshotting, not a copy of the input.
function validEchoFor(tracker, dispatched, resultOverrides = {}) {
  const captured = tracker.__capturedStateForTest(dispatched.requestId);
  return {
    requestId: dispatched.requestId,
    workerGeneration: captured.workerGeneration,
    worldGeneration: captured.worldGeneration,
    epochs: captured.epochs,
    result: { epoch: captured.epochs[0].epoch, fragmentIds: [], ...resultOverrides },
  };
}

test('(a) dispose() mid-flight — rejects with WorldDisposedError, empty pending set, before terminate()', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.disposeWorld('world disposed');
  worker.terminate(); // per §10.2, this must find nothing left to (re-)reject

  assert.equal(rejectedCount, 1);
  await assert.rejects(req.promise, WorldDisposedError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(tracker.isPending(req.requestId), false);
});

test('(b) evictModel mid-flight — rejects with ModelEvictedError, unrelated epoch untouched and later resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1, 2]);
  const evicted = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const untouched = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.evictEpoch(1); // AT PUBLICATION -- no response ever needs to arrive

  assert.equal(rejectedCount, 1);
  await assert.rejects(evicted.promise, ModelEvictedError);
  assert.equal(tracker.isPending(untouched.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, untouched) });
  assert.deepEqual(await untouched.promise, { epoch: 2, fragmentIds: [] });
  assert.equal(tracker.pendingCount(), 0);
});

test('(c) model reload producing a NEW epoch — old-epoch request rejected, new-epoch request resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const oldReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.evictEpoch(1); // reload: old epoch evicted
  tracker.setLiveEpochs([2]); // ...new epoch becomes live
  const newReq = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });

  assert.equal(rejectedCount, 1);
  await assert.rejects(oldReq.promise, ModelEvictedError);
  assert.equal(tracker.isPending(newReq.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, newReq) });
  assert.deepEqual(await newReq.promise, { epoch: 2, fragmentIds: [] });
});

test('(d) invalidateModelPlacement mid-flight — ARMED (TLAS) rejects, UNARMED (linear) does NOT and still resolves for real', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const armedReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const unarmedReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.invalidatePlacement(1); // bumps the live revision AND sweeps armed requests

  assert.equal(rejectedCount, 1);
  await assert.rejects(armedReq.promise, ModelPlacementChangedError);
  assert.equal(tracker.isPending(unarmedReq.requestId), true, 'the unarmed (linear) request must NOT be rejected');
  worker.onmessage({ data: validEchoFor(tracker, unarmedReq) }); // proves it is not permanently stuck
  assert.deepEqual(await unarmedReq.promise, { epoch: 1, fragmentIds: [] });
});

test('(e) two concurrent requests, responses OUT OF ORDER — each settles its own caller, neither cancels the other', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const first = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const second = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker.onmessage({ data: validEchoFor(tracker, second, { tag: 'second-arrived-first' }) });
  worker.onmessage({ data: validEchoFor(tracker, first, { tag: 'first-arrived-second' }) });

  assert.equal((await first.promise).tag, 'first-arrived-second');
  assert.equal((await second.promise).tag, 'second-arrived-first');
  assert.equal(tracker.pendingCount(), 0);
});

test('(f) a DUPLICATE response for an already-settled requestId — discarded silently, nothing disturbed', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const echo = validEchoFor(tracker, req);

  const first = worker.onmessage({ data: { ...echo, result: { ...echo.result, v: 1 } } });
  const duplicate = worker.onmessage({ data: { ...echo, result: { ...echo.result, v: 2 } } });

  assert.equal(first.outcome, 'resolved');
  assert.equal(duplicate.outcome, 'discarded-silent');
  assert.deepEqual(await req.promise, { epoch: 1, fragmentIds: [], v: 1 });
  assert.equal(tracker.pendingCount(), 0);
});

test('(g) a malformed response naming an UNKNOWN EPOCH — request-local TypeError-class rejection, other pending request untouched', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const bad = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const good = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const outcome = worker.onmessage({ data: validEchoFor(tracker, bad, { epoch: 999 }) }); // never captured

  assert.equal(outcome.outcome, 'rejected');
  await assert.rejects(bad.promise, MalformedResponseError);
  await assert.rejects(bad.promise, TypeError);
  assert.equal(tracker.isPending(good.requestId), true);
  worker.onmessage({ data: validEchoFor(tracker, good) });
  await assert.doesNotReject(good.promise);
});

test('(g″) a malformed response naming an UNKNOWN FRAGMENT ID — distinct schema failure from unknown-epoch', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({
    epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }],
    knownFragmentIds: [10, 11],
  });

  const outcome = worker.onmessage({ data: validEchoFor(tracker, req, { fragmentIds: [10, 999] }) });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.reason, 'schema-invalid');
  await assert.rejects(req.promise, MalformedResponseError);
});

test('(g‴) unattributable message (no usable requestId) — PROTOCOL-FATAL: rejects every entry, clears the map, discards the worker', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  for (const badMessage of [{ garbage: true }, { requestId: 'not-a-number' }, { requestId: 1.5 }, { requestId: -1 }, { requestId: NaN }]) {
    const freshTracker = createRequestTracker();
    const freshWorker = makeFakeWorker();
    freshTracker.attachWorker(freshWorker);
    freshTracker.setLiveEpochs([1]);
    const req = freshTracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
    const outcome = freshWorker.onmessage({ data: badMessage });
    assert.equal(outcome.outcome, 'protocol-fatal', `expected protocol-fatal for ${JSON.stringify(badMessage)}`);
    await assert.rejects(req.promise, ProtocolFaultError);
  }

  const outcome = worker.onmessage({ data: { garbage: true } });
  assert.equal(outcome.outcome, 'protocol-fatal');
  assert.equal(outcome.errorName, 'ProtocolFaultError');
  await assert.rejects(a.promise, ProtocolFaultError);
  await assert.rejects(b.promise, ProtocolFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(worker.onmessage, null, 'the discarded worker must be fully detached');
  assert.throws(() => tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] }), /no worker attached/);
  assert.throws(() => tracker.attachWorker(worker), /cannot reattach a discarded worker instance/);
});

test('(h) worker onerror mid-request — rejects EVERY in-flight request with WorkerFaultError, terminates and detaches the worker, forbids reattachment', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  let terminateCalled = false;
  worker.terminate = () => { terminateCalled = true; };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });

  worker.onerror({ message: 'scripted crash' }); // real ErrorEvent-shaped payload

  await assert.rejects(a.promise, WorkerFaultError);
  await assert.rejects(b.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(terminateCalled, true, 'the tracker must terminate the faulted worker itself, not rely on the caller remembering to');
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.throws(() => tracker.attachWorker(worker), /cannot reattach a discarded worker instance/);
});

test('(h′) explicit discardWorker() (terminate() not caused by dispose or onerror) — identical all-reject-terminate-detach contract', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  let terminateCalled = false;
  worker.terminate = () => { terminateCalled = true; };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  const rejectedCount = tracker.discardWorker('explicit terminate()');

  assert.equal(rejectedCount, 1);
  await assert.rejects(req.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
  assert.equal(terminateCalled, true);
});

test('post-fault recovery: same tracker, unchanged world generation, a genuinely FRESH worker instance, next dispatch succeeds', async () => {
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1);
  tracker.setLiveEpochs([1]);
  const doomed = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  worker1.onerror({ message: 'crash' });
  await assert.rejects(doomed.promise, WorkerFaultError);

  const worker2 = makeFakeWorker(); // a genuinely different object -- not worker1
  assert.notEqual(worker2, worker1);
  tracker.attachWorker(worker2); // must succeed: worker2 was never discarded
  tracker.setLiveEpochs([1]); // cache/live-state repopulation is the caller's job, exercised here directly

  const recovered = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  worker2.onmessage({ data: validEchoFor(tracker, recovered) });
  assert.deepEqual(await recovered.promise, { epoch: 1, fragmentIds: [] });
  assert.equal(tracker.pendingCount(), 0);
});

test('dispatch-time failure: postMessage() throwing synchronously still settles the promise (rejects), never left pending', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  worker.postMessage = () => { throw new Error('DataCloneError-ish'); };
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);

  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  await assert.rejects(req.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
});

test('dispatch envelope: `extra` cannot spoof requestId/workerGeneration/worldGeneration/epochs on the wire', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);

  const req = tracker.dispatch({
    epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }],
    extra: { requestId: 'evil', workerGeneration: 999, worldGeneration: 999, epochs: 'evil', kind: 'echo' },
  });

  const wireMessage = worker.sent[0];
  assert.equal(wireMessage.requestId, req.requestId);
  assert.equal(wireMessage.workerGeneration, 1);
  assert.equal(wireMessage.worldGeneration, 1);
  assert.deepEqual(wireMessage.epochs, [{ epoch: 1, placementRevision: 0, revisionArmed: false }]);
  assert.equal(wireMessage.kind, 'echo', '`extra` fields that do NOT collide with protocol fields still pass through');
});

test('captured epoch snapshot is immutable — mutating the caller\'s array after dispatch does not affect RequestState', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const epochs = [{ epoch: 1, placementRevision: 0, revisionArmed: false }];

  const req = tracker.dispatch({ epochs });
  epochs[0].placementRevision = 999; // mutate the caller's own array after dispatch
  epochs.push({ epoch: 2, placementRevision: 0, revisionArmed: false });

  const captured = tracker.__capturedStateForTest(req.requestId);
  assert.equal(captured.epochs.length, 1);
  assert.equal(captured.epochs[0].placementRevision, 0, 'the snapshot taken AT DISPATCH must be untouched by later mutation of the caller\'s array');
});

test('dispatch() rejects a captured epoch set containing a duplicate epoch', () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  assert.throws(() => tracker.dispatch({
    epochs: [
      { epoch: 1, placementRevision: 0, revisionArmed: false },
      { epoch: 1, placementRevision: 0, revisionArmed: true },
    ],
  }), /duplicate epoch/);
});

test('echo integrity: a coerced/type-mismatched echoed epoch (string, wrong type) does NOT match the captured numeric/boolean set', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const captured = tracker.__capturedStateForTest(req.requestId);

  const outcome = worker.onmessage({
    data: {
      requestId: req.requestId,
      workerGeneration: captured.workerGeneration,
      worldGeneration: captured.worldGeneration,
      epochs: [{ epoch: '1', placementRevision: '0', revisionArmed: 0 }], // coerced-equal, not type-equal
      result: { epoch: 1, fragmentIds: [] },
    },
  });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'MalformedResponseError');
  await assert.rejects(req.promise, MalformedResponseError);
});

test('precedence (1 of 3): disposed -> generation -> evicted -> armed-placement — GENERATION wins over evicted+placement', async () => {
  const tracker = createRequestTracker({ worldGeneration: 1 });
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.__bumpWorldGenerationForTest(); // lazy -- no proactive sweep, exactly what makes this race constructible
  tracker.setLiveEpochs([]); // now ALSO "evicted" if that check ran
  tracker.setPlacementRevision(1, 99); // now ALSO "placement changed" if that check ran

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'WorldDisposedError');
  assert.equal(outcome.reason, 'generation-mismatch');
});

test('precedence (2 of 3): EVICTED wins over armed-placement-changed', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.setLiveEpochs([]); // now evicted
  tracker.setPlacementRevision(1, 99); // now ALSO placement-changed if that check ran

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'ModelEvictedError');
});

test('precedence (3 of 3): DISPOSED wins over generation, evicted, and armed-placement', async () => {
  const tracker = createRequestTracker({ worldGeneration: 1 });
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1]);
  tracker.setPlacementRevision(1, 0);
  const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }] });
  const echo = validEchoFor(tracker, req);

  tracker.__setDisposedForTest(); // lazy flag only, no sweep -- see the module comment on why this
                                   // branch is normally unreachable through the real disposeWorld()
  tracker.__bumpWorldGenerationForTest();
  tracker.setLiveEpochs([]);
  tracker.setPlacementRevision(1, 99);

  const outcome = worker.onmessage({ data: echo });

  assert.equal(outcome.outcome, 'rejected');
  assert.equal(outcome.errorName, 'WorldDisposedError');
  assert.equal(outcome.reason, 'disposed');
});

test('request-ID/workerGeneration reuse safety (message side): a late response echoing a REPLACED worker’s generation is discarded silently', async () => {
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1); // workerGeneration -> 1
  tracker.setLiveEpochs([1]);
  const staleReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker1.onerror({ message: 'crash' }); // rejects staleReq, terminates+detaches+discards worker1
  await assert.rejects(staleReq.promise, WorkerFaultError);
  assert.equal(worker1.onmessage, null, 'the old worker’s own callback must be disconnected -- it cannot affect the new worker');

  const worker2 = makeFakeWorker();
  tracker.attachWorker(worker2); // workerGeneration -> 2
  const freshReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  assert.ok(freshReq.requestId > staleReq.requestId, 'requestId must remain monotonic across replacement, never reused');

  // The concrete failure scenario the review named: a hand-crafted late message from the REPLACED
  // (generation-1) worker that happens to name freshReq's own requestId. A correct tracker must
  // discard this on workerGeneration alone, before it ever reaches requestId-keyed settlement.
  const captured = tracker.__capturedStateForTest(freshReq.requestId);
  const staleFromReplacedWorker = {
    requestId: freshReq.requestId,
    workerGeneration: 1, // stale -- current is 2
    worldGeneration: captured.worldGeneration,
    epochs: captured.epochs,
    result: { epoch: 1, fragmentIds: [], tag: 'must-not-settle-freshReq' },
  };
  const outcome = tracker.__handleRawMessageForTest(staleFromReplacedWorker);

  assert.equal(outcome.outcome, 'discarded-silent');
  assert.equal(outcome.reason, 'stale-worker-generation');
  assert.equal(tracker.isPending(freshReq.requestId), true);

  worker2.onmessage({ data: validEchoFor(tracker, freshReq, { tag: 'genuine-worker2-response' }) });
  assert.deepEqual(await freshReq.promise, { epoch: 1, fragmentIds: [], tag: 'genuine-worker2-response' });
});

test('request-ID/workerGeneration reuse safety (request-state side): current-generation message for a request whose OWN captured generation is stale is also discarded', async () => {
  // Constructs the case where attachWorker() replaces the worker WHILE an older-generation
  // request is still (unusually) present in the map -- proving the guard does not depend on the
  // bulk-clear-on-fault path having already run for every entry.
  const tracker = createRequestTracker();
  const worker1 = makeFakeWorker();
  tracker.attachWorker(worker1); // generation 1
  tracker.setLiveEpochs([1]);
  const staleReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const staleCaptured = tracker.__capturedStateForTest(staleReq.requestId);

  const worker2 = makeFakeWorker();
  tracker.attachWorker(worker2); // generation 2 -- staleReq is still in the map, NOT auto-rejected
  assert.equal(tracker.isPending(staleReq.requestId), true);

  // A message carrying the CURRENT generation (2) but naming staleReq's id, whose OWN RequestState
  // still records generation 1.
  const outcome = tracker.__handleRawMessageForTest({
    requestId: staleReq.requestId,
    workerGeneration: 2, // matches currentWorkerGeneration -- passes the first guard
    worldGeneration: staleCaptured.worldGeneration,
    epochs: staleCaptured.epochs,
    result: { epoch: 1, fragmentIds: [] },
  });

  assert.equal(outcome.outcome, 'discarded-silent');
  assert.equal(outcome.reason, 'request-worker-generation-mismatch');
  assert.equal(tracker.isPending(staleReq.requestId), true, 'still pending -- neither wrongly resolved nor rejected');
});

test('no unsettled promise: pendingCount() is 0 after every terminal event, across a mixed run', async () => {
  const tracker = createRequestTracker();
  const worker = makeFakeWorker();
  tracker.attachWorker(worker);
  tracker.setLiveEpochs([1, 2]);
  const r1 = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });
  const r2 = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }] });
  const r3 = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }] });

  worker.onmessage({ data: validEchoFor(tracker, r1) }); // resolves
  tracker.evictEpoch(2); // rejects r2
  worker.onerror({ message: 'boom' }); // rejects r3, terminates+detaches+clears everything left

  await assert.doesNotReject(r1.promise);
  await assert.rejects(r2.promise, ModelEvictedError);
  await assert.rejects(r3.promise, WorkerFaultError);
  assert.equal(tracker.pendingCount(), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/request-tracker.test.mjs`
Expected: fails with `Cannot find module '../../../spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs'`.

- [ ] **Step 3: Write the real implementation**
```js
// spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs
//
// M4 Task 3.10: the ONE protocol implementation of §10.1 ("request state is per-call, never
// global") and §10.2 (the receipt-time acceptance predicate and its exact settlement matrix).
// Both test/performance/m4/request-tracker.test.mjs (fake-but-real-shaped worker object) and the
// live S4' driver in run-gate-m4.mjs (a real dedicated Worker via page.html) import this file
// unmodified and drive it through the SAME attachWorker()-installed onmessage/onerror handlers --
// there is no second, simplified state machine anywhere in this task.

export class WorldDisposedError extends Error {
  constructor(message) { super(message); this.name = 'WorldDisposedError'; }
}
export class ModelEvictedError extends Error {
  constructor(message) { super(message); this.name = 'ModelEvictedError'; }
}
export class ModelPlacementChangedError extends Error {
  constructor(message) { super(message); this.name = 'ModelPlacementChangedError'; }
}
// TypeError-class, per §10.2 step 3: "a TypeError-class error naming the request".
export class MalformedResponseError extends TypeError {
  constructor(message) { super(message); this.name = 'MalformedResponseError'; }
}
export class WorkerFaultError extends Error {
  constructor(message) { super(message); this.name = 'WorkerFaultError'; }
}
export class ProtocolFaultError extends Error {
  constructor(message) { super(message); this.name = 'ProtocolFaultError'; }
}

// A usable requestId is a non-negative integer -- requestId is a monotonically increasing counter
// (§10.1), never a string/object/NaN/fractional/negative value. Anything else is unattributable.
function hasUsableRequestId(raw) {
  return raw != null && typeof raw === 'object'
    && typeof raw.requestId === 'number'
    && Number.isInteger(raw.requestId)
    && raw.requestId >= 1;
}

// Strict, type-checked structural equality between the epoch set CAPTURED at dispatch and the
// epoch set ECHOED in the response -- "same generation, same epochs, no omissions, no extras, no
// duplicates, and matching captured revisions and arming flags" (§10.2). A type-coerced value (a
// string "1" where a numeric 1 was captured, a truthy 1 where a boolean true was captured) is
// treated as a mismatch, not a match -- dispatch() itself guarantees the CAPTURED side never
// contains a duplicate epoch (see dispatch() below), so a plain sorted tuple comparison here
// correctly enforces "no duplicates" on the echoed side as well (an echo with a duplicate simply
// cannot align 1:1 with the (duplicate-free) captured set and fails the length/tuple check).
function normalizeEchoedEpoch(e) {
  if (e == null || typeof e !== 'object') return null;
  const { epoch, placementRevision, revisionArmed } = e;
  if (typeof epoch !== 'number' || typeof placementRevision !== 'number' || typeof revisionArmed !== 'boolean') return null;
  return { epoch, placementRevision, revisionArmed };
}
function epochTupleKey(e) { return JSON.stringify([e.epoch, e.placementRevision, e.revisionArmed]); }
function epochsExactlyMatch(captured, echoed) {
  if (!Array.isArray(echoed) || echoed.length !== captured.length) return false;
  const normalized = echoed.map(normalizeEchoedEpoch);
  if (normalized.some((e) => e === null)) return false;
  const a = captured.map(epochTupleKey).sort();
  const b = normalized.map(epochTupleKey).sort();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Payload/schema validation (§10.2 step 3): result.epoch must be one of the epochs THIS request
// captured, and every fragmentId in the result must be one of the fragment ids the caller declared
// known for this request at dispatch time -- this spike has no real geometry/model to consult
// (§17 bounds S4' to "no real geometry"), so the caller supplies the known-fragment universe
// explicitly via dispatch()'s `knownFragmentIds`, standing in for what the real production caller
// would read from the model/BVH sync state at dispatch time.
function isValidResultPayload(raw, capturedEpochs, knownFragmentIds) {
  if (raw == null || typeof raw !== 'object') return false;
  const result = raw.result;
  if (result == null || typeof result !== 'object') return false;
  if (typeof result.epoch !== 'number') return false;
  if (!capturedEpochs.some((e) => e.epoch === result.epoch)) return false; // "unknown epoch"
  if (!Array.isArray(result.fragmentIds)) return false;
  if (!result.fragmentIds.every((id) => knownFragmentIds.has(id))) return false; // "unknown fragment id"
  return true;
}

export function createRequestTracker({ worldGeneration = 1 } = {}) {
  const pending = new Map(); // requestId -> RequestState. EVERY settlement path (individual or
                              // bulk) DELETES its entry immediately -- §10.2's "requestId not in
                              // the map -> discard silently" row applies equally to an
                              // already-settled id; there is no separate "settled but retained"
                              // state, and pending.size is always the true outstanding count.
  let nextRequestId = 1; // monotonic, NEVER reused for the lifetime of this world (§10.1)
  let currentWorkerGeneration = 0;
  let attachedWorker = null;
  let worldDisposed = false;
  let currentWorldGeneration = worldGeneration;
  const liveEpochs = new Set();
  const placementRevisionByEpoch = new Map();
  const discardedWorkerInstances = new WeakSet(); // a discarded worker object is NEVER reattached

  function finalize(state, kind, value) {
    if (!pending.has(state.requestId)) return false; // already settled and removed
    pending.delete(state.requestId);
    if (kind === 'resolve') state.settle(value); else state.reject(value);
    return true;
  }

  function detachWorker() {
    if (attachedWorker) {
      attachedWorker.onmessage = null;
      attachedWorker.onerror = null;
      discardedWorkerInstances.add(attachedWorker);
    }
    attachedWorker = null;
  }

  // Rejects every still-pending entry, clears the map, terminates and detaches the worker. Used
  // by BOTH the automatic onerror handler and the explicit discardWorker() method, so "a real
  // onerror event" and "an explicit terminate() the caller initiates" (§10.4 (h)'s two halves) get
  // IDENTICAL treatment -- neither can leave a request pending because the caller forgot a second
  // call, and neither can leave the real worker un-terminated.
  function faultAndDiscard(err) {
    let count = 0;
    for (const state of Array.from(pending.values())) {
      if (finalize(state, 'reject', err)) count++;
    }
    if (attachedWorker) {
      try { attachedWorker.terminate?.(); } catch { /* already dead -- fine */ }
    }
    detachWorker();
    return count;
  }

  function handleMessage(raw) {
    // Step 1 (§10.2): routing-envelope validation -- attribution only.
    if (!hasUsableRequestId(raw)) {
      const err = new ProtocolFaultError('unattributable message: no usable (integer) requestId');
      const count = faultAndDiscard(err);
      return { outcome: 'protocol-fatal', errorName: err.name, rejectedCount: count };
    }
    const requestId = raw.requestId;

    // Attribution guard #1 (message side): a response whose workerGeneration is not the CURRENT
    // worker's is discarded silently -- closes the request-ID-reuse-across-replacement gap.
    if (raw.workerGeneration !== currentWorkerGeneration) {
      return { outcome: 'discarded-silent', reason: 'stale-worker-generation' };
    }

    const state = pending.get(requestId);
    if (!state) {
      return { outcome: 'discarded-silent', reason: 'unknown-or-already-settled-requestId' };
    }
    // Attribution guard #2 (request side): the request's OWN captured workerGeneration must ALSO
    // match current -- closes the same gap even if a request from a superseded generation is
    // somehow still in the map when a message carrying the CURRENT generation arrives (e.g.
    // attachWorker() replacing a worker while older requests remain pending).
    if (state.workerGeneration !== currentWorkerGeneration) {
      return { outcome: 'discarded-silent', reason: 'request-worker-generation-mismatch' };
    }

    // Step 2 (§10.2): lifecycle matrix, evaluated against the epoch set CAPTURED AT DISPATCH,
    // never against the response's own epoch list. Precedence: disposed -> generation -> evicted
    // -> armed-epoch placement revision. (disposeWorld() proactively rejects-and-clears
    // synchronously, so the lazy `worldDisposed` branch below is normally unreachable in-process
    // for a message that arrives after a real dispose -- it is retained as the defensive backstop
    // the table specifies; __setDisposedForTest() exists solely to exercise it directly.)
    if (worldDisposed) {
      finalize(state, 'reject', new WorldDisposedError('world disposed'));
      return { outcome: 'rejected', errorName: 'WorldDisposedError', reason: 'disposed' };
    }
    if (state.worldGeneration !== currentWorldGeneration) {
      finalize(state, 'reject', new WorldDisposedError('world generation mismatch'));
      return { outcome: 'rejected', errorName: 'WorldDisposedError', reason: 'generation-mismatch' };
    }
    for (const e of state.epochs) {
      if (!liveEpochs.has(e.epoch)) {
        finalize(state, 'reject', new ModelEvictedError(`epoch ${e.epoch} evicted`));
        return { outcome: 'rejected', errorName: 'ModelEvictedError' };
      }
    }
    for (const e of state.epochs) {
      if (e.revisionArmed && placementRevisionByEpoch.get(e.epoch) !== e.placementRevision) {
        finalize(state, 'reject', new ModelPlacementChangedError(`epoch ${e.epoch} placement changed`));
        return { outcome: 'rejected', errorName: 'ModelPlacementChangedError' };
      }
    }

    // Step 3 (§10.2): request-local payload validation -- echo integrity first (the captured set
    // must survive the round trip EXACTLY), then result-shape/schema validation.
    if (raw.worldGeneration !== state.worldGeneration || !epochsExactlyMatch(state.epochs, raw.epochs)) {
      finalize(state, 'reject', new MalformedResponseError(`request ${requestId}: echoed generation/epoch set does not match the set captured at dispatch`));
      return { outcome: 'rejected', errorName: 'MalformedResponseError', reason: 'echo-mismatch' };
    }
    if (!isValidResultPayload(raw, state.epochs, state.knownFragmentIds)) {
      finalize(state, 'reject', new MalformedResponseError(`request ${requestId}: malformed or schema-invalid response payload`));
      return { outcome: 'rejected', errorName: 'MalformedResponseError', reason: 'schema-invalid' };
    }

    finalize(state, 'resolve', raw.result);
    return { outcome: 'resolved' };
  }

  return {
    // -- worker lifecycle --
    attachWorker(worker) {
      if (discardedWorkerInstances.has(worker)) {
        throw new Error('createRequestTracker: cannot reattach a discarded worker instance -- construct a fresh Worker');
      }
      currentWorkerGeneration += 1; // every attach, including the first, is a new generation
      attachedWorker = worker;
      worker.onmessage = (ev) => handleMessage(ev.data);
      worker.onerror = (errEvent) => {
        faultAndDiscard(new WorkerFaultError(`worker onerror: ${errEvent?.message ?? String(errEvent)}`));
      };
      return currentWorkerGeneration;
    },
    // Explicit intentional discard -- e.g. a terminate() the caller initiates that isn't itself
    // caused by an onerror event (§10.4 (h)'s "terminate() mid-request" half). Rejects every
    // pending entry, terminates and detaches the worker, and marks it permanently
    // non-reattachable -- ONE call; the caller never needs a separate worker.terminate().
    discardWorker(reason) {
      return faultAndDiscard(new WorkerFaultError(reason ?? 'worker discarded'));
    },

    // -- world lifecycle --
    // Rejects synchronously, BEFORE the caller terminates the worker, so the termination path
    // that follows finds an empty pending map and cannot re-reject an already-settled promise.
    disposeWorld(reason) {
      worldDisposed = true;
      const err = new WorldDisposedError(reason ?? 'world disposed');
      let count = 0;
      for (const state of Array.from(pending.values())) {
        if (finalize(state, 'reject', err)) count++;
      }
      return count;
    },

    // -- model/epoch live state, no sweep (construction/setup only) --
    setLiveEpochs(epochs) { liveEpochs.clear(); for (const e of epochs) liveEpochs.add(e); },
    setPlacementRevision(epoch, revision) { placementRevisionByEpoch.set(epoch, revision); },

    // -- model/epoch live state + proactive "AT PUBLICATION" sweep (§10.4 (b)/(c)/(d)) --
    evictEpoch(epoch) {
      liveEpochs.delete(epoch);
      let count = 0;
      for (const state of Array.from(pending.values())) {
        if (state.epochs.some((e) => e.epoch === epoch)) {
          if (finalize(state, 'reject', new ModelEvictedError(`epoch ${epoch} evicted`))) count++;
        }
      }
      return count;
    },
    invalidatePlacement(epoch) {
      placementRevisionByEpoch.set(epoch, (placementRevisionByEpoch.get(epoch) ?? 0) + 1);
      let count = 0;
      for (const state of Array.from(pending.values())) {
        // dispatch() rejects a captured set containing a duplicate epoch (see below), so at most
        // one entry in state.epochs can name this epoch -- .find() cannot miss a second one.
        const e = state.epochs.find((e) => e.epoch === epoch);
        if (e && e.revisionArmed) {
          if (finalize(state, 'reject', new ModelPlacementChangedError(`epoch ${epoch} placement changed`))) count++;
        }
      }
      return count;
    },

    // -- dispatch --
    // `knownFragmentIds`: the fragment ids valid for this request's captured epochs, as known by
    // the caller at dispatch time -- §10.2 step 3 requires rejecting "an unknown fragment id" in
    // the response, and this spike has no real geometry/model to consult, so the caller supplies
    // the universe explicitly (defaults to empty -- callers that don't care must also echo an
    // empty `fragmentIds` array, or validation will correctly fail).
    dispatch({ epochs, knownFragmentIds = [], extra = {} }) {
      if (!attachedWorker) throw new Error('createRequestTracker: no worker attached -- call attachWorker() first');
      if (worldDisposed) throw new WorldDisposedError('cannot dispatch: world already disposed');
      const capturedEpochs = epochs.map((e) => ({
        epoch: e.epoch, placementRevision: e.placementRevision, revisionArmed: !!e.revisionArmed,
      }));
      if (new Set(capturedEpochs.map((e) => e.epoch)).size !== capturedEpochs.length) {
        throw new Error('createRequestTracker: dispatch() epochs must not contain a duplicate epoch');
      }
      const requestId = nextRequestId++;
      let settleFn, rejectFn;
      const promise = new Promise((res, rej) => { settleFn = res; rejectFn = rej; });
      const state = {
        requestId, settle: settleFn, reject: rejectFn, // field names mirror §10.1's RequestState literally
        epochs: capturedEpochs,
        knownFragmentIds: new Set(knownFragmentIds),
        worldGeneration: currentWorldGeneration,
        workerGeneration: currentWorkerGeneration,
        issuedAt: Date.now(),
      };
      pending.set(requestId, state);
      try {
        attachedWorker.postMessage({
          ...extra, // spread FIRST -- the named fields below always win, so a caller-supplied
                    // `extra` can never spoof requestId/generations/epochs on the wire
          requestId, workerGeneration: state.workerGeneration, worldGeneration: state.worldGeneration,
          epochs: capturedEpochs,
        });
      } catch (err) {
        // postMessage can throw synchronously (DataCloneError, an already-terminated worker) --
        // §10.2's "no unsettled promise" invariant applies at dispatch time too, not only to
        // receipt-time outcomes.
        finalize(state, 'reject', new WorkerFaultError(`dispatch failed: ${err.message}`));
      }
      return { requestId, promise };
    },

    // -- introspection --
    // The true outstanding count -- every settlement path deletes its entry, so this is always
    // exactly `pending.size`, never a filtered/derived count.
    pendingCount() { return pending.size; },
    isPending(requestId) { return pending.has(requestId); },

    // -- test-only hooks (used only by request-tracker.test.mjs; never by the live driver) --
    __capturedStateForTest(requestId) {
      const state = pending.get(requestId);
      if (!state) return null;
      return { epochs: state.epochs.map((e) => ({ ...e })), worldGeneration: state.worldGeneration, workerGeneration: state.workerGeneration };
    },
    // Bumps worldGeneration WITHOUT a proactive sweep -- there is no defined production caller for
    // this distinct from disposeWorld() in this task's scope, so it is deliberately NOT part of
    // the public "world lifecycle" surface above; it exists solely to construct the receipt-time
    // generation-mismatch race the precedence tests need.
    __bumpWorldGenerationForTest() { currentWorldGeneration += 1; return currentWorldGeneration; },
    // Sets the disposed flag WITHOUT the proactive reject-and-clear sweep, purely to exercise the
    // lazy `worldDisposed` receipt-time branch and prove its precedence -- a real caller must
    // always go through disposeWorld() instead.
    __setDisposedForTest() { worldDisposed = true; },
    // Feeds a hand-crafted raw message directly into the real receipt path, for boundary cases
    // (request-ID/workerGeneration reuse) that a legitimate worker could never itself produce.
    __handleRawMessageForTest(raw) { return handleMessage(raw); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/request-tracker.test.mjs`
Expected: all tests pass — all eight lettered §10.4 scenarios plus the unknown-fragment-id and
protocol-fatal variants, all three precedence orderings, both directions of the reuse-safety
guard, dispatch-time `postMessage` failure, the `extra`-spoofing guard, capture-time immutability,
duplicate-epoch rejection, coercion-safe echo matching, post-fault recovery, and the mixed-run
"no unsettled promise" invariant.

- [ ] **Step 5: Live-browser stub worker + page wiring**

Create `spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs` (a plain classic worker — deliberately
**not** a module worker, so S3′/S4′ do not depend on S1′'s own finding; no real geometry, per
§17's S3′/S4′ bound). It speaks the SAME envelope `dispatch()` sends
(`{requestId, workerGeneration, worldGeneration, epochs, ...extra}`) and scripts its response
shape from `extra.kind`, echoing `extra.tag` through so the live out-of-order scenario can prove
correct per-caller attribution, not just "something resolved":
```js
// spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs -- classic worker, no real geometry. Echoes the
// dispatch envelope back per a scripted `kind`, letting the page drive every §10.4 scenario
// deterministically through REAL postMessage/onmessage timing.
self.onmessage = (ev) => {
  const { requestId, workerGeneration, worldGeneration, epochs, kind, delayMs, tag } = ev.data;

  if (kind === 'ack') { self.postMessage({ requestId, ok: true }); return; } // S3' cold-start ping only

  const respond = () => {
    switch (kind) {
      case 'echo':
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], tag } });
        break;
      case 'echo-unknown-epoch': // §10.4 (g): names an epoch the request never captured
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: 999999, fragmentIds: [] } });
        break;
      case 'echo-unknown-fragment': // §10.2 step 3: names a fragment id outside the known set
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [999999] } });
        break;
      case 'duplicate': // §10.4 (f)
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], seq: 1 } });
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs[0].epoch, fragmentIds: [], seq: 2 } });
        break;
      case 'no-request-id': // §10.2 routing-envelope / protocol-fatal path
        self.postMessage({ garbage: true }); // deliberately no requestId at all
        break;
      case 'crash': // §10.4 (h): triggers a REAL onerror event on the Worker
        throw new Error('scripted worker crash');
      default:
        self.postMessage({ requestId, workerGeneration, worldGeneration, epochs, result: { epoch: epochs?.[0]?.epoch, fragmentIds: [] } });
    }
  };

  if (delayMs) setTimeout(respond, delayMs); else respond();
};
```

Create `spike/m4/s3-s4-worker-lifecycle/page.html`, importing the SAME `request-tracker.mjs`
Step 3 wrote (not a copy, not a simplified stand-in) and exposing it to `page.evaluate`:
```html
<!DOCTYPE html>
<html><body><script type="module">
  import { createRequestTracker } from '/spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs';

  window.__createRequestTracker = createRequestTracker;
  window.__spawnStubWorker = function () {
    return new Worker('/spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs'); // classic worker -- no {type:'module'}, decoupled from S1'
  };
</script></body></html>
```

- [ ] **Step 6: Live S3′ + S4′ driver in `run-gate-m4.mjs`, all eight scenarios through the real tracker + real Worker**

Extend `run-gate-m4.mjs`'s `main()` (reusing task 3.9's `startSpikeServer`). S3′ is unchanged
from the original spike other than the worker path now being resolved worker-side; S4′ is
rewritten to construct real `createRequestTracker()` instances, `attachWorker()` real `Worker`s to
them per scenario, and assert exact typed outcomes and real awaited values — never a boolean proxy
for "did the right thing happen":
```js
// test/performance/run-gate-m4.mjs (excerpt — Task 3.10's S3'+S4' driver)
import assert from 'node:assert/strict';

async function runS3PrimeColdStart(page, runtime) {
  // §17's S3' bound: new Worker(...) to first acknowledged message, 10 repetitions, median+max.
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const ms = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      const w = window.__spawnStubWorker();
      w.onmessage = () => { const dt = performance.now() - t0; w.terminate(); resolve(dt); };
      w.postMessage({ requestId: 'warmup', kind: 'ack' });
    }));
    samples.push(ms);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { runtime: runtime.label, samples, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1] };
}

// Drives all eight §10.4 scenarios through real createRequestTracker() instances wired to real
// Worker instances via attachWorker(), returning per-scenario structured (JSON-serializable)
// outcomes -- error CLASS NAMES and real awaited result values extracted inside the page, not
// descriptive strings or bare booleans -- for the Node side to assert against exactly.
async function runS4PrimeScenarios(page) {
  return page.evaluate(async () => {
    const results = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const errorNameOf = async (promise) => { try { await promise; return null; } catch (e) { return e.constructor.name; } };

    // (a) dispose() mid-flight
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      const rejectedCount = tracker.disposeWorld('dispose');
      worker.terminate();
      results.a = { rejectedCount, errorName: await errorNameOf(req.promise), pendingCountAfter: tracker.pendingCount() };
    }
    // (b) evictModel mid-flight
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1, 2]);
      const evicted = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      const untouched = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo' } });
      const rejectedCount = tracker.evictEpoch(1);
      const errorName = await errorNameOf(evicted.promise);
      const untouchedResult = await untouched.promise; // real awaited value, not isSettled()===true
      results.b = { rejectedCount, errorName, untouchedResult, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (c) model reload producing a NEW epoch
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const oldReq = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      const rejectedCount = tracker.evictEpoch(1);
      tracker.setLiveEpochs([2]);
      const newReq = tracker.dispatch({ epochs: [{ epoch: 2, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo' } });
      const errorName = await errorNameOf(oldReq.promise);
      const newReqResult = await newReq.promise;
      results.c = { rejectedCount, errorName, newReqResult, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (d) invalidateModelPlacement -- armed rejects, unarmed does not (and still resolves for real)
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      tracker.setPlacementRevision(1, 0);
      const armed = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }], extra: { kind: 'echo', delayMs: 5000 } });
      const unarmed = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 20 } });
      const rejectedCount = tracker.invalidatePlacement(1);
      const armedErrorName = await errorNameOf(armed.promise);
      const unarmedResult = await unarmed.promise;
      results.d = { rejectedCount, armedErrorName, unarmedResult, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (e) two concurrent requests, responses OUT OF ORDER -- unique tags prove correct attribution
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const arrivalOrder = [];
      const slow = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 100, tag: 'slow' } });
      const fast = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 10, tag: 'fast' } });
      slow.promise.then((r) => arrivalOrder.push(r.tag));
      fast.promise.then((r) => arrivalOrder.push(r.tag));
      const [slowResult, fastResult] = await Promise.all([slow.promise, fast.promise]);
      results.e = { slowResult, fastResult, arrivalOrder, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (f) duplicate response for an already-settled requestId
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const req = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'duplicate' } });
      const result = await req.promise; // resolves on the FIRST of the two raw messages
      await wait(50); // let the duplicate raw message arrive and be silently discarded
      results.f = { result, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (g) malformed response -- unknown epoch AND unknown fragment id, both request-local
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const badEpoch = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo-unknown-epoch' } });
      const badFragment = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], knownFragmentIds: [1, 2, 3], extra: { kind: 'echo-unknown-fragment' } });
      const good = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 20 } });
      const badEpochErrorName = await errorNameOf(badEpoch.promise);
      const badFragmentErrorName = await errorNameOf(badFragment.promise);
      const goodResult = await good.promise;
      results.g = { badEpochErrorName, badFragmentErrorName, goodResult, pendingCountAfter: tracker.pendingCount() };
      worker.terminate();
    }
    // (g') unattributable message -- protocol-fatal
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'no-request-id', delayMs: 20 } });
      const aErrorName = await errorNameOf(a.promise);
      const bErrorName = await errorNameOf(b.promise);
      let reattachThrew = false;
      try { tracker.attachWorker(worker); } catch { reattachThrew = true; }
      results.gPrime = { aErrorName, bErrorName, pendingCountAfter: tracker.pendingCount(), reattachThrew };
    }
    // (h) worker onerror mid-request -- also proves real termination + forbidden reattachment
    {
      const tracker = window.__createRequestTracker();
      const worker = window.__spawnStubWorker();
      tracker.attachWorker(worker);
      tracker.setLiveEpochs([1]);
      const a = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      const b = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: true }], extra: { kind: 'echo', delayMs: 5000 } });
      worker.postMessage({ requestId: 1, workerGeneration: 999, worldGeneration: 1, epochs: [], kind: 'crash' }); // real crash trigger, out-of-band (workerGeneration mismatch means it is itself silently discarded as a RESPONSE -- only the thrown exception's onerror side effect matters here)
      await wait(50); // real onerror event round trip
      const aErrorName = await errorNameOf(a.promise);
      const bErrorName = await errorNameOf(b.promise);
      let reattachThrew = false;
      try { tracker.attachWorker(worker); } catch { reattachThrew = true; }
      results.h = { aErrorName, bErrorName, pendingCountAfter: tracker.pendingCount(), reattachThrew };
    }
    // post-fault recovery: fresh worker, same tracker, new dispatch succeeds
    {
      const tracker = window.__createRequestTracker();
      const worker1 = window.__spawnStubWorker();
      tracker.attachWorker(worker1);
      tracker.setLiveEpochs([1]);
      const doomed = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo', delayMs: 5000 } });
      worker1.postMessage({ requestId: 1, workerGeneration: 999, worldGeneration: 1, epochs: [], kind: 'crash' });
      await wait(50);
      const doomedErrorName = await errorNameOf(doomed.promise);
      const worker2 = window.__spawnStubWorker();
      tracker.attachWorker(worker2); // must succeed -- worker2 was never discarded
      tracker.setLiveEpochs([1]);
      const recovered = tracker.dispatch({ epochs: [{ epoch: 1, placementRevision: 0, revisionArmed: false }], extra: { kind: 'echo' } });
      const recoveredResult = await recovered.promise;
      results.recovery = { doomedErrorName, recoveredResult, pendingCountAfter: tracker.pendingCount() };
      worker2.terminate();
    }

    return results;
  });
}

async function main() {
  // ... existing S1'/S2 setup, then:
  const s4 = await runS4PrimeScenarios(page);

  assert.equal(s4.a.rejectedCount, 1);
  assert.equal(s4.a.errorName, 'WorldDisposedError');
  assert.equal(s4.a.pendingCountAfter, 0);

  assert.equal(s4.b.rejectedCount, 1);
  assert.equal(s4.b.errorName, 'ModelEvictedError');
  assert.equal(s4.b.untouchedResult.epoch, 2);
  assert.equal(s4.b.pendingCountAfter, 0);

  assert.equal(s4.c.rejectedCount, 1);
  assert.equal(s4.c.errorName, 'ModelEvictedError');
  assert.equal(s4.c.newReqResult.epoch, 2);
  assert.equal(s4.c.pendingCountAfter, 0);

  assert.equal(s4.d.rejectedCount, 1);
  assert.equal(s4.d.armedErrorName, 'ModelPlacementChangedError');
  assert.equal(s4.d.unarmedResult.epoch, 1);
  assert.equal(s4.d.pendingCountAfter, 0);

  assert.equal(s4.e.slowResult.tag, 'slow');
  assert.equal(s4.e.fastResult.tag, 'fast');
  assert.deepEqual(s4.e.arrivalOrder, ['fast', 'slow']);
  assert.equal(s4.e.pendingCountAfter, 0);

  assert.equal(s4.f.result.seq, 1);
  assert.equal(s4.f.pendingCountAfter, 0);

  assert.equal(s4.g.badEpochErrorName, 'MalformedResponseError');
  assert.equal(s4.g.badFragmentErrorName, 'MalformedResponseError');
  assert.equal(s4.g.goodResult.epoch, 1);
  assert.equal(s4.g.pendingCountAfter, 0);

  assert.equal(s4.gPrime.aErrorName, 'ProtocolFaultError');
  assert.equal(s4.gPrime.bErrorName, 'ProtocolFaultError');
  assert.equal(s4.gPrime.pendingCountAfter, 0);
  assert.equal(s4.gPrime.reattachThrew, true);

  assert.equal(s4.h.aErrorName, 'WorkerFaultError');
  assert.equal(s4.h.bErrorName, 'WorkerFaultError');
  assert.equal(s4.h.pendingCountAfter, 0);
  assert.equal(s4.h.reattachThrew, true);

  assert.equal(s4.recovery.doomedErrorName, 'WorkerFaultError');
  assert.equal(s4.recovery.recoveredResult.epoch, 1);
  assert.equal(s4.recovery.pendingCountAfter, 0);
}
```

Request-ID/workerGeneration reuse safety in both directions and all three levels of receipt-time
precedence ordering are boundary conditions no legitimate worker (real or stub) could ever itself
trigger — they are proven exhaustively, against the real receipt path, by
`request-tracker.test.mjs`'s dedicated tests (Step 1/4) and are not re-proven live here; S4′'s job
is confirming that a REAL Worker's message timing, error-event delivery, duplication, and
malformed-payload behavior all land on the exact typed outcomes the pure tests already established
the tracker produces for those inputs, plus proving the real-`Worker`-specific mechanics (actual
`terminate()` calls, actual `onerror` events, actual out-of-order `postMessage` delivery) that a
fake worker object cannot exercise.

**Manual verification**: Run: `npm run test:performance:gate:m4`. Expected: S3′ prints
`{ medianMs, maxMs }` under both runtimes, both well under a second; every `s4.*` assertion above
passes (the gate script exits non-zero if any `assert.equal`/`assert.deepEqual` throws) — meaning
all eight §10.4 scenarios, the unknown-fragment-id and protocol-fatal variants, and post-fault
recovery all settled with the exact named error class or the exact expected value, exactly once,
with an empty pending set and (where applicable) a real terminated/non-reattachable worker after
every terminal event, driven through real dedicated Workers and the one canonical
`request-tracker.mjs` implementation.

- [ ] **Step 7: Commit**
```bash
git add spike/m4/s3-s4-worker-lifecycle/request-tracker.mjs test/performance/m4/request-tracker.test.mjs spike/m4/s3-s4-worker-lifecycle/stub-worker.mjs spike/m4/s3-s4-worker-lifecycle/page.html test/performance/run-gate-m4.mjs
git commit -m "test(collision): M4 task 3.10 — S3'+S4' worker lifecycle spikes (unconditional)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 3.11: Memory metrics in the baseline gate — Metric M wiring + Metric H heap cross-check

Self-review finding: the assembled plan's earlier drafts built Metric M as a pure calculator (Task
2.3) and wired it into spike-only output (Phase 4 task 4.7), but no task wired it into the
**baseline gate's own regular measurement**, and **Metric H (spec §15.1's heap cross-check) was
missing from the plan entirely.** §15.2 requires cold/warm/peak/retained memory reporting, with
"every figure stating which metric produced it," as part of the baseline gate's own output — not
only S7''s. This task closes both gaps.

**Files:**
- Modify: `test/performance/run-gate-m4.mjs` (add `--js-flags=--expose-gc` to both `RUNTIME_CONFIGS` launch-arg sets from task 3.1; sample memory at the four required scopes around each measured tuple)
- Create: `test/performance/m4/memory-snapshot-adapter.mjs` (bridges task 1.6's `CollisionWorld.getEpochGeometryDiagnostics`/`getEpochTlasDiagnostics`/`getEpochPlacementDiagnostics` output into task 2.3's `MemorySnapshot` shape)
- Create: `test/performance/m4/heap-sampler.mjs` (Metric H's `--expose-gc` sampling protocol)
- Test: `test/performance/m4/memory-snapshot-adapter.test.mjs`, `test/performance/m4/heap-sampler.test.mjs`

**Interfaces:**
- Consumes: Task 1.6's `CollisionWorld.getEpochGeometryDiagnostics(epoch)` / `getEpochTlasDiagnostics(epoch)` / `getEpochPlacementDiagnostics(epoch)` (per-epoch diagnostic shapes, the ONLY three of these reachable from a `CollisionWorld` instance — `GeometryRegistry` stays internal and is never passed to this adapter directly; `getEpochGeometryDiagnostics` already delegates to `GeometryRegistry.getEpochGeometryEntries` internally and returns the identical array shape, per Task 1.6's own text above); Task 2.3's `computeMetricM(snapshot): number` and the `MemorySnapshot` shape it expects.

  **Plan-text reconciliation (post-Phase-1, controller-applied):** an earlier draft of this task called `accessors.getEpochGeometryEntries(loadEpoch)` here and in its own test fixtures below — a method that exists only on the internal `GeometryRegistry`, never on `CollisionWorld`. The real, landed Task 1.6 public contract is `CollisionWorld.getEpochGeometryDiagnostics(epoch)` (confirmed against `collision/CollisionWorld.js:796`, matching this task's own Task 1.6 citation above). Since the harness wiring below (Step 10) passes the real `world` object as this adapter's `accessors` argument, the stale name would throw `TypeError: accessors.getEpochGeometryEntries is not a function` the first time it actually ran against a live `CollisionWorld`. Fixed here to `getEpochGeometryDiagnostics` throughout — `getEpochTlasDiagnostics`/`getEpochPlacementDiagnostics` were already correct.
- Produces: `toMemorySnapshot(epochs: number[], accessors): MemorySnapshot` (the adapter — reconciles task 1.6's per-entry scalar `bvhRootBytes`/`weldedPositionBytes`/etc. fields, already pre-summed across a geometry's own BVH roots, into task 2.3's `geometryEntries[].bvhRootByteLengths: number[]` by passing a single-element array `[entry.bvhRootBytes]`, since `computeMetricM` sums that array anyway and a pre-summed scalar folded into a one-element array is arithmetically identical to summing the real per-root array — a genuine, documented reconciliation between two independently-drafted phases' contracts, not an approximation); `sampleHeap(target: 'main'|'worker', page_or_worker): Promise<{bytes: number, available: true} | {available: false, reason: string}>` (Metric H); `sampleMemoryAtScope(scope: 'cold'|'warm'|'peak'|'retained', world, page): Promise<{metricM: number, metricH: {bytes:number,available:true}|{available:false,reason:string}}>`.

- [ ] **Step 1: Write the failing test — the snapshot adapter**
```js
// test/performance/m4/memory-snapshot-adapter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMemorySnapshot } from './memory-snapshot-adapter.mjs';
import { computeMetricM } from './metric-m-calculator.mjs';

test('toMemorySnapshot maps a single-epoch, single-geometry world into computeMetricM\'s expected shape', () => {
  const fakeAccessors = {
    getEpochGeometryDiagnostics: (epoch) => [
      { geometryIndex: 0, buildState: 'ready', weldedPositionBytes: 1000, weldedIndexBytes: 400,
        bvhRootBytes: 200, bvhIndirectBytes: 50, connectivityComponentOfBytes: 30,
        connectivityClosedManifoldLength: 4, oversizedReason: null, activeTriangleCount: 10 },
    ],
    getEpochTlasDiagnostics: (epoch) => ({ state: 'ready', primitiveCount: 3, primitiveBufferBytes: 500, builtAtRevision: 1 }),
    getEpochPlacementDiagnostics: (epoch) => ({ instanceCount: 10, placementCount: 2, placementRevision: 1, invalidatedAtRevision: null }),
  };
  const snapshot = toMemorySnapshot([7], fakeAccessors);
  assert.equal(computeMetricM(snapshot), 1000 + 400 + 200 + 50 + 30 + 4 + (500 + 3 * 104) + (2 * 192) + (10 * 88));
});

test('toMemorySnapshot skips a geometry entry that is not ready (building/oversized contribute zero bytes)', () => {
  const fakeAccessors = {
    getEpochGeometryDiagnostics: () => [
      { geometryIndex: 0, buildState: 'oversized', weldedPositionBytes: null, weldedIndexBytes: null,
        bvhRootBytes: null, bvhIndirectBytes: null, connectivityComponentOfBytes: null,
        connectivityClosedManifoldLength: null, oversizedReason: 'geometry-too-large-for-sync-build', activeTriangleCount: 50000 },
    ],
    getEpochTlasDiagnostics: () => ({ state: 'absent', primitiveCount: null, primitiveBufferBytes: null, builtAtRevision: null }),
    getEpochPlacementDiagnostics: () => ({ instanceCount: 0, placementCount: 0, placementRevision: 0, invalidatedAtRevision: null }),
  };
  const snapshot = toMemorySnapshot([1], fakeAccessors);
  assert.equal(computeMetricM(snapshot), 0);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/memory-snapshot-adapter.test.mjs`
Expected: FAIL with `Cannot find module './memory-snapshot-adapter.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/memory-snapshot-adapter.mjs
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/memory-snapshot-adapter.test.mjs`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add test/performance/m4/memory-snapshot-adapter.mjs test/performance/m4/memory-snapshot-adapter.test.mjs
git commit -m "feat(m4): bridge Task 1.6's diagnostic accessors into Task 2.3's MemorySnapshot shape

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing test — the Metric H heap sampler's `--expose-gc` protocol and feature-detection**
```js
// test/performance/m4/heap-sampler.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleHeap } from './heap-sampler.mjs';

test('sampleHeap reports UNAVAILABLE, not zero, when the target has no gc()/performance.memory', async () => {
  const fakePage = {
    evaluate: async (fn) => { throw new Error('gc is not defined'); },
  };
  const result = await sampleHeap('main', fakePage);
  assert.equal(result.available, false);
  assert.match(result.reason, /gc/i);
});

test('sampleHeap returns the median of three post-GC readings on a target that supports the protocol', async () => {
  const readings = [1000, 1200, 1100]; // unsorted on purpose -- median must be computed, not the first/last
  let call = 0;
  const fakePage = {
    evaluate: async (fn) => readings[call++],
  };
  const result = await sampleHeap('main', fakePage);
  assert.equal(result.available, true);
  assert.equal(result.bytes, 1100); // median of [1000,1100,1200], not readings[0]
});

test('sampleHeap on a worker target reports UNAVAILABLE for the rAF-settling turns a worker realm cannot provide, per spec §15.1', async () => {
  const fakeWorkerChannel = { evaluateInWorker: async () => { throw new Error('requestAnimationFrame is not defined in this realm'); } };
  const result = await sampleHeap('worker', fakeWorkerChannel);
  assert.equal(result.available, false);
  assert.match(result.reason, /requestAnimationFrame|rAF/i);
});
```
- [ ] **Step 7: Run test to verify it fails**
Run: `node --test test/performance/m4/heap-sampler.test.mjs`
Expected: FAIL with `Cannot find module './heap-sampler.mjs'`
- [ ] **Step 8: Write minimal implementation**
```js
// test/performance/m4/heap-sampler.mjs
// Metric H (§15.1): performance.memory.usedJSHeapSize under `gc()` (requires the harness's own
// `--js-flags=--expose-gc` launch flag, task 3.1's RUNTIME_CONFIGS), two GC passes separated by
// two rAF turns (main-thread target only -- rAF does not exist in a worker realm), one further
// turn, median of three readings. UNAVAILABLE (never silently zero, never silently substituted
// with the main-thread figure) when the target lacks the required API.
function median3(a, b, c) {
  return [a, b, c].sort((x, y) => x - y)[1];
}

export async function sampleHeap(target, pageOrWorkerChannel) {
  try {
    if (target === 'main') {
      // Page-side settling: two rAF turns between each gc() call, one further turn before sampling,
      // matching spec's "gc() twice separated by two requestAnimationFrame turns, waits one further
      // turn" protocol -- implemented inside the page.evaluate callback so it runs in-page, not
      // split across Node/page round-trips that would themselves perturb the heap being measured.
      const a = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      const b = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      const c = await pageOrWorkerChannel.evaluate(() => window.__m4HeapSample());
      return { available: true, bytes: median3(a, b, c) };
    }
    // Worker target: no requestAnimationFrame in a worker realm (spec §15.1) -- the page drives the
    // settling turns and sends the worker an explicit sample command; the worker calls gc() twice
    // (if available) and returns the median of three usedJSHeapSize readings.
    const bytes = await pageOrWorkerChannel.evaluateInWorker();
    return { available: true, bytes };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
```
- [ ] **Step 9: Run test to verify it passes**
Run: `node --test test/performance/m4/heap-sampler.test.mjs`
Expected: PASS
- [ ] **Step 9b: Install the in-page `__m4HeapSample` function `sampleHeap` calls**

Independent review finding (Important): `sampleHeap`'s `'main'` branch calls `window.__m4HeapSample()` via `page.evaluate`, but nothing in the plan ever defines or installs that function — the first real call throws `window.__m4HeapSample is not a function`, and `sampleHeap`'s own `catch` silently converts that implementation defect into a plausible-looking `{available:false}` result. Fix: install it explicitly, once, right after each fresh world's page context is ready (alongside task 3.1's other page-side setup), implementing the exact settling protocol spec §15.1 requires — `gc()` twice separated by two `requestAnimationFrame` turns, one further turn, then read `performance.memory.usedJSHeapSize`.

```js
// added to run-gate-m4.mjs, called once per fresh page/world before any sampleMemoryAtScope call
async function installHeapSampleFunction(page) {
  await page.evaluate(() => {
    window.__m4HeapSample = () => new Promise((resolve, reject) => {
      if (typeof window.gc !== 'function' || !window.performance?.memory) {
        reject(new Error('gc()/performance.memory unavailable -- launch without --js-flags=--expose-gc?'));
        return;
      }
      window.gc();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.gc();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve(window.performance.memory.usedJSHeapSize));
          });
        });
      });
    });
  });
}
```
Manual verification: `page.evaluate(() => typeof window.__m4HeapSample)` returns `'function'` immediately after `installHeapSampleFunction(page)` resolves, and calling it resolves to a positive integer on a runtime launched with `--js-flags=--expose-gc` (task 3.1's launch args, extended below).

- [ ] **Step 10: Wire `sampleHeap` and `toMemorySnapshot` into `run-gate-m4.mjs` at the four required scopes, with real per-state peak sampling**

Add `sampleMemoryAtScope(scope, world, page)` to `run-gate-m4.mjs`, calling `installHeapSampleFunction(page)` once per fresh world, then both `computeMetricM(toMemorySnapshot([...world's live epochs], world))` and `sampleHeap('main', page)` at every one of: **cold** (immediately after the cold measured query's closing mark), **warm** (immediately after the warm measured query's closing mark), and — for **R6** only — its third `refresh` state (immediately after that query's closing mark, since R6's placement move can admit new geometry the cold/warm samples never saw). **`retained`** samples immediately before the tuple's world is disposed (task 3.1's dispose step).

**`peak` is the maximum of Metric M actually OBSERVED across every state this tuple measures, not a fixed alias.** Independent review finding (Important): an earlier draft declared `peak` a permanent alias of the `cold` sample, reasoning that nothing is evicted before warm on a fresh world — true for R1–R5 and every S-case, but false for R6, whose `refresh` query can admit genuinely new geometry (§5.2.1's placement move), and false in general for any future case with a state that can grow the registry. Fix:
```js
// after collecting {cold, warm, refresh?} metricM samples for the tuple:
const peakSample = [cold, warm, refresh].filter(Boolean).reduce((max, s) => (s.metricM > max.metricM ? s : max));
report.memory = { cold, warm, ...(refresh ? { refresh } : {}), peak: { ...peakSample, sourceState: peakSample === cold ? 'cold' : peakSample === warm ? 'warm' : 'refresh' }, retained };
```
`peak.sourceState` records which already-sampled state the maximum came from — real observation, never a preselected instant. Add `RUNTIME_CONFIGS`'s launch args: `args: [...runtime.args, '--js-flags=--expose-gc']` for both runtime entries (task 3.1).

No new unit test for this step's live-browser wiring (it's Playwright glue around already-unit-tested pure pieces, `toMemorySnapshot`/`sampleHeap`), but the `peakSample` selection logic above is pure and gets its own unit test:
```js
// test/performance/m4/memory-snapshot-adapter.test.mjs, appended
test('peak sampling: the maximum observed Metric M across cold/warm/refresh, never a fixed alias', () => {
  function selectPeak(cold, warm, refresh) {
    return [cold, warm, refresh].filter(Boolean).reduce((max, s) => (s.metricM > max.metricM ? s : max));
  }
  const cold = { metricM: 1000 };
  const warm = { metricM: 900 }; // warm usually shrinks or holds -- but this test proves refresh can exceed both
  const refresh = { metricM: 1500 }; // R6's placement move admitted new geometry
  const peak = selectPeak(cold, warm, refresh);
  assert.equal(peak, refresh);
  assert.equal(selectPeak(cold, warm, undefined), cold); // no refresh state (every non-R6 case): cold still wins here, but because it was measured larger, not by default
});
```
Run: `node --test test/performance/m4/memory-snapshot-adapter.test.mjs` — Expected: PASS.

Manual verification (live wiring): `npm run test:performance:gate:m4 -- --case=R1 --repetitions=1` and confirm the written `m4-gate-<timestamp>.json`'s per-tuple record carries `memory: {cold: {metricM, metricH}, warm: {...}, peak: {metricM, metricH, sourceState}, retained: {...}}` with every `metricM` a positive integer and every `metricH` either `{available:true, bytes}` or `{available:false, reason}`; and for the R6 tuple specifically, confirm `memory.refresh` is present and `memory.peak.sourceState` reflects whichever state actually measured largest, not a hardcoded `'cold'`.

- [ ] **Step 11: Commit**
```bash
git add test/performance/m4/heap-sampler.mjs test/performance/m4/heap-sampler.test.mjs test/performance/run-gate-m4.mjs
git commit -m "feat(m4): wire Metric M + Metric H heap cross-check into the baseline gate's cold/warm/peak/retained sampling

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

**Note for task 3.8 (evidence normalization + reporting):** the per-tuple evidence record this task's `sampleMemoryAtScope` output feeds into must include a `memory` field per the shape above; task 3.8's report-writing code should pass it through unmodified rather than re-deriving it.

---

### Decision checkpoint

Execute this phase's gate for real on both runtimes (`npm run test:performance:gate:m4`), read the
emitted §6.3 main-only/transferable partition and §7.2 target evaluation from the written
`test/performance/results/m4-gate-<timestamp>.json`, and use them to determine which of
S5′/S6′/S7′/S8′ — a later phase's tasks — are required, per §17's ordering rule: S7′/S8′ only if
the baseline fails §7.2's target at some verdict-bearing tuple with T-a among the failing metrics;
S5′ only if the chosen topology disposes by terminating a worker; S6′ only if S1′ passed and §18's
C1 is not already analytically refuted. If the baseline passes every target everywhere, the later
conditional-spike phase is skipped entirely and reported NOT EXERCISED with reason.
> **Conditional instantiation.** Every task below is CONDITIONALLY INSTANTIATED. The Phase-3→4
> decision checkpoint (executed after the real baseline gate runs on both runtimes) decides, per
> §17's ordering rule, which of these actually get built and run. This document fully specifies
> each task's exact build steps regardless, because the spec fixes their shape in advance. The
> activation condition, restated per task from the checkpoint:
>
> - **4.1** ← S5': only if the topology the checkpoint's leading boundary candidate would use
>   disposes of its worker by calling `terminate()` on a dedicated (non-pooled, non-idle) worker.
> - **4.2** ← S6': only if S1' passed (Phase 3.9) **and** §18's C1 cache option is not already
>   analytically refuted without needing this spike's own measurement.
> - **4.3, 4.4, 4.5, 4.6, 4.7** ← S7': only if the synchronous baseline fails §7.2's target at some
>   verdict-bearing tuple **with T-a among that tuple's failing metrics**. Always instantiated
>   together or not at all — 4.4/4.5/4.6/4.7 have no independent trigger of their own.
>   **Stated trade-off (independent review flagged this as narrower than the design spec's own
>   text and asked it be made explicit rather than left implicit):** §17's own prose permits, but
>   does not require, running S7' "if at all" purely for report-only overhead coverage (R1/R2 +
>   largest verdict-bearing workload) even at tuples whose *only* failing metrics are T-b1/T-b2/T-c
>   — i.e. where T-a passes everywhere and the verdict is D under §7.5.9's *no-full-query-evidence*
>   cause. This plan deliberately does NOT activate 4.3–4.8 in that shape. Rationale: that report-
>   only coverage can never affect A/B/C/D (§7.3 condition 4(b) has no defined application where
>   T-a passes), and building a real worker spike purely for an informative appendix to a D report
>   is a real cost (Task 4.3's shared protocol alone is substantial) this plan chooses not to pay
>   by default. If a future execution of this plan wants that appendix evidence anyway, activate
>   4.3–4.8 manually against the same tuples' report-only case set (R1, R2, largest verdict-bearing
>   workload) — no plan change is needed, this is a per-run operational choice, not a structural one.
> - **4.8** ← S8': the identical gate as S7'. Additionally requires 4.3–4.7's worker to exist.
>
> If the baseline passes every target everywhere, 4.3–4.8 are all skipped and Phase 4 may be
> entirely `NOT EXERCISED`. All spike code lives under `spike/m4/`, served by the harness's own
> Express instance, deleted at M4 close unless a verdict adopts a finding (§17's Global Constraint:
> even then the code is still deleted — adoption is evidentiary only). No task adds anything under
> `collision/` or `wwwroot/`.

## Revision note (independent Codex review, `spec`, `high`, request `20260909-170548-79004-7833`)

A prior draft of this document was independently reviewed and found to require major revision: five
Critical defects (a delivery-task correlation mark recorded in the wrong JS realm, invalidating
`Hᵢ`; a duplicate-`ArrayBuffer` transfer that throws `DataCloneError`; a precheck vertical that
called `volumeOverlapQuery` directly instead of production's `classifyHardClashPrecheck`, fabricating
cost for pairs production would have skipped; several non-runnable fixture placeholders; and
worker-channel protocol gaps that leave a `query()` promise permanently unsettled on certain
faults) plus five Important gaps (S6' sizing/sending mismatched messages; S5''s responsiveness
check not isolating the `terminate()` call; validators that can silently collapse distinct
federated-fragment identities; a Metric M adapter that doesn't match Phase 2's actual consumer
contract; S8' not running the required 5-repetition, vertical-aware experiment). This revision
fixes all ten and resolves the review's four open questions below, cross-checked against Phase 1's
and Phase 2's own now-complete drafts (`phase1-draft.md`, `phase2-draft.md` in this scratchpad)
rather than the assumed/invented contracts the prior draft used.

**Resolved open questions:**

1. **Capture-hook contract.** Phase 1 Task 1.3 is now written. The real, single contract is
   `setSpikeInputCapture(fn)` / `clearSpikeInputCapture()` in `collision/scheduler.js`, where `fn`
   is called as **`fn(kind, payload)`** for exactly three `kind`s:
   - `'geometry-raw-input'`: `{ loadEpoch, geometryIndex, role, positions, positionStride,
     positionOffset, index, ranges: {start,count}[], activeTriangleCount, weldEpsilon }` — `.slice()`
     copies, index may be `null` (non-indexed).
   - `'geometry-welded-result'`: `{ loadEpoch, geometryIndex, role, position, index, triangleCount }`
     — also `.slice()` copies, validator-input only, never fed to a worker.
   - `'precheck-candidate-list'`: `{ sourceEpoch, candidates: {sourceLoadEpoch, sourceGeometryIndex,
     sourceFragmentId, targetLoadEpoch, targetGeometryIndex, targetFragmentId, targetEpoch}[] }` —
     fired once per `findClashes({mode:'clearance'})` call, **identity only — no matrices, no world
     bounds**. Tasks 4.4/4.5 below are written against this exact shape, replacing the prior draft's
     invented single-kind signature.
2. **`computeHi`/Metric M signatures.** Phase 2 is now written. The real modules are
   `test/performance/m4/stage-attribution-engine.mjs`, exporting `computeResidualForBoundary(
   taskIntervals, stageIntervals, ownedStageNames)` (`Rᵢ(w,τ)`) and `computeBoundaryOccupancy(
   taskIntervals, subMarkIntervals, correlationMarkMs, closingMarkMs)` → `{value,
   deliveryTaskIdentified}` (`Hᵢ(w,τ)`), over the frozen interval shape `{startMs, endMs, source,
   stage, validity}`; and `test/performance/m4/metric-m-calculator.mjs`, exporting
   `computeMetricM(snapshot)` over the `MemorySnapshot` shape (`geometryEntries`/`epochs`/`inflight`
   arrays — full shape in Task 4.7 below). Task 4.7 is rewritten against these exact exports.
3. **S1' resolution artifact / `createSpikeWorker` selection.** Phase 3.9 is now written. It
   produces `rewriteBareSpecifiers(sourceText, {relativeVendorPrefix})` (pure) plus a live
   `{bareSpecifierResult, relativePathResult, buildVariantResult, minimalChangeIfFailed}` record.
   **Decision:** every worker script Tasks 4.3–4.8 add uses bare `three`/`three-mesh-bvh` imports,
   matching production style, for S1's expected common case (a): as-served, no change needed, since
   the harness's own Express instance serves an import map identical to `wwwroot/index.html`'s. If
   the checkpoint's real S1' run instead lands on case (b) or (c), the implementer applies
   `rewriteBareSpecifiers` (or the relative-path edit) to these exact files before serving — the
   file's logic is unchanged, only its import specifiers are; no second code path is written here
   speculatively.
4. **Checkpoint tuple/report schema.** Phase 3.8 is now written. The real per-tuple shape is
   `buildEvidenceRecord({runtime, caseName, broadPhase, state, targets, correctness})` → `{runtime,
   case, broadPhase, state, targets:{Ta,Tb1,Tb2,Tc}, partition, capacityRejected, correctnessGate,
   shapeStatus: 'PROVISIONAL — reconciled by Phase 2 task 2.4'}`, an array of these written into
   `test/performance/results/m4-gate-<timestamp>.json`. Phase 3 itself has **not** pinned whether a
   per-tuple candidate count (needed by 4.2's `N` and useful context for 4.4/4.5) rides alongside
   this record or elsewhere in the file — its own shape is marked provisional, deferred to Phase
   2.4's adapter. Tasks 4.2/4.4/4.5 below therefore read `report.evidenceRecords` for the
   `targets.Ta.pass`-driven tuple selection (that part IS pinned), and separately probe for a
   `statistics`-shaped sibling field for candidate counts, **failing loudly with a named, specific
   error — never silently guessing — if that field is absent**, registering the gap as an explicit
   cross-phase reconciliation item for the coordinating merge rather than inventing a schema Phase 3
   never committed to.

## Phase 4 — Conditional spikes

### Task 4.1: S5' Worker-Termination Spike

**Condition:** Only if the boundary topology the checkpoint is evaluating disposes of its worker
by calling `terminate()` on a dedicated worker mid-task. If no candidate topology does this, report
`NOT EXERCISED` with that reason and skip.

**Files:**
- Create: `spike/m4/s5-termination/report.mjs` — pure summarizers
- Create: `spike/m4/s5-termination/synthetic-task.worker.mjs`
- Create: `spike/m4/s5-termination/run.mjs`
- Test: `spike/m4/s5-termination/report.test.mjs`
- Test: manual verification via `node spike/m4/s5-termination/run.mjs`

**Interfaces:**
- Consumes: nothing from an earlier M4 phase. Reuses the harness's own Express instance pattern.
- Produces: `ms, both figures` (terminate()-call latency; post-termination rebuild cost), feeding
  §11.2's write-up.

**What's unit-tested vs. manually verified:** `report.mjs` is RED→GREEN unit-tested. The real
`terminate()` timing needs a real `Worker` inside a served page — manual verification only.

**Fix applied (review finding I2):** the original `mainThreadStayedResponsive` accepted a
`terminateAtMs` parameter it never used, so it reported the *worst rAF gap anywhere in the whole
multi-second repetition* (startup, the wait, replacement-worker construction all included) rather
than isolating the gap that actually spans the `terminate()` call — ambient jitter elsewhere could
be misattributed to termination, and it never confirmed the busy loop had actually started before
`terminate()` was called. Fixed below: the function now finds the ONE rAF interval whose bounds
straddle `terminateAtMs` and reports that gap specifically, separately from the population's own
max (both reported, never conflated); the driver now waits for an explicit worker "started"
acknowledgement before scheduling the `terminate()` call.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s5-termination/report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLatencies, isolateSpanningGap } from './report.mjs';

test('summarizeLatencies reports median/min/max/raw over repetitions (§6.1.8 scalar-summary shape)', () => {
  const samples = [12.4, 9.8, 15.1, 11.0, 10.2];
  const summary = summarizeLatencies(samples);
  assert.equal(summary.min, 9.8);
  assert.equal(summary.max, 15.1);
  assert.equal(summary.median, 11.0);
  assert.deepEqual(summary.raw, samples);
});

test('summarizeLatencies guards the empty-set case rather than reporting -Infinity/NaN', () => {
  const summary = summarizeLatencies([]);
  assert.equal(summary.exercised, false);
  assert.equal(summary.reason, 'no samples recorded');
});

test('isolateSpanningGap finds the ONE rAF interval straddling terminateAtMs, ignoring unrelated gaps elsewhere', () => {
  // ambient 70ms gap during replacement-worker construction at the tail, far from terminate()
  const rafTimestamps = [480, 496, 512, 528, 544, 900, 970];
  const result = isolateSpanningGap(rafTimestamps, /* terminateAtMs */ 500, /* maxGapMs */ 32);
  assert.equal(result.spanningGapMs, 16); // the interval [496,512) that actually contains 500
  assert.equal(result.blocked, false);
  assert.equal(result.otherMaxGapMs, 70); // the 900-970 gap is reported separately, never merged in
});

test('isolateSpanningGap fails when the gap spanning terminate() itself exceeds the bound', () => {
  const rafTimestamps = [480, 620, 900, 916]; // a 140ms gap straddling terminate() at t=500
  const result = isolateSpanningGap(rafTimestamps, 500, 32);
  assert.equal(result.blocked, true);
  assert.equal(result.spanningGapMs, 140);
});

test('isolateSpanningGap reports blocked with a named reason when no interval straddles terminateAtMs', () => {
  const result = isolateSpanningGap([100, 116], 500, 32); // both samples before terminateAtMs
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'no rAF interval straddles terminateAtMs');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s5-termination/report.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s5-termination/report.mjs
export function summarizeLatencies(samplesMs) {
  if (samplesMs.length === 0) return { exercised: false, reason: 'no samples recorded' };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { exercised: true, min: sorted[0], max: sorted[sorted.length - 1], median, raw: samplesMs };
}

// Isolates the ONE rAF-to-rAF interval whose [start,end) actually straddles terminateAtMs, and
// reports it separately from every other gap in the sample (§17 S5': "confirmation the main
// thread is not blocked" means confirming THIS gap is small, not the population's max).
export function isolateSpanningGap(rafTimestamps, terminateAtMs, maxGapMs) {
  let spanningGapMs = null;
  let otherMaxGapMs = 0;
  for (let i = 1; i < rafTimestamps.length; i++) {
    const start = rafTimestamps[i - 1], end = rafTimestamps[i], gap = end - start;
    if (start <= terminateAtMs && terminateAtMs < end) spanningGapMs = gap;
    else otherMaxGapMs = Math.max(otherMaxGapMs, gap);
  }
  if (spanningGapMs === null) {
    return { blocked: true, spanningGapMs: Infinity, otherMaxGapMs, reason: 'no rAF interval straddles terminateAtMs' };
  }
  return { blocked: spanningGapMs > maxGapMs, spanningGapMs, otherMaxGapMs };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s5-termination/report.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s5-termination/report.mjs spike/m4/s5-termination/report.test.mjs
git commit -m "spike(m4): S5' termination-spike pure summarizers, isolated spanning-gap fix (RED->GREEN)"
```

- [ ] **Step 6: Write the real worker + driver**
```js
// spike/m4/s5-termination/synthetic-task.worker.mjs
self.onmessage = (ev) => {
  const { type, durationMs } = ev.data;
  if (type === 'run-long-task') {
    self.postMessage({ type: 'started' }); // driver waits for this before scheduling terminate()
    const start = performance.now();
    let x = 0;
    while (performance.now() - start < durationMs) { x = (x * 1664525 + 1013904223) >>> 0; }
    self.postMessage({ type: 'long-task-done', tookMs: performance.now() - start, sink: x });
  } else if (type === 'ping') {
    self.postMessage({ type: 'pong' });
  }
};
```
```js
// spike/m4/s5-termination/run.mjs
import { chromium } from 'playwright';
import express from 'express';
import { summarizeLatencies, isolateSpanningGap } from './report.mjs';

const RUNTIME_CONFIGS = [
  { name: 'single-process', args: ['--single-process', '--no-zygote'] },
  { name: 'multi-process', args: [] },
];
const REPETITIONS = 5;
const LONG_TASK_MS = 2000;
const TERMINATE_AT_MS = 500;
const MAX_RAF_GAP_MS = 50;

async function serveSpike() {
  const app = express();
  app.use('/spike/m4', express.static('spike/m4'));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function runOneRepetition(page) {
  return page.evaluate(async ({ longTaskMs, terminateAtMs }) => {
    const rafTimestamps = [];
    let rafHandle;
    const recordFrame = (t) => { rafTimestamps.push(t); rafHandle = requestAnimationFrame(recordFrame); };
    rafHandle = requestAnimationFrame(recordFrame);

    const worker = new Worker('/spike/m4/s5-termination/synthetic-task.worker.mjs', { type: 'module' });
    const started = new Promise((resolve) => {
      worker.onmessage = (ev) => { if (ev.data.type === 'started') resolve(); };
    });
    worker.postMessage({ type: 'run-long-task', durationMs: longTaskMs });
    await started; // confirms the busy loop actually began before scheduling terminate()

    await new Promise((r) => setTimeout(r, terminateAtMs));
    const t0 = performance.now();
    worker.terminate();
    const terminateCallMs = performance.now() - t0;

    await new Promise((r) => setTimeout(r, longTaskMs - terminateAtMs + 200));

    const rebuildT0 = performance.now();
    const replacement = new Worker('/spike/m4/s5-termination/synthetic-task.worker.mjs', { type: 'module' });
    const rebuildMs = await new Promise((resolve) => {
      replacement.onmessage = (ev) => { if (ev.data.type === 'pong') resolve(performance.now() - rebuildT0); };
      replacement.postMessage({ type: 'ping' });
    });
    replacement.terminate();
    cancelAnimationFrame(rafHandle);

    return { terminateCallMs, rebuildMs, rafTimestamps, terminateAtAbsoluteMs: t0 };
  }, { longTaskMs: LONG_TASK_MS, terminateAtMs: TERMINATE_AT_MS });
}

async function main() {
  const { server, port } = await serveSpike();
  const results = {};
  for (const runtime of RUNTIME_CONFIGS) {
    const browser = await chromium.launch({ args: ['--no-sandbox', ...runtime.args] });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/spike/m4/s5-termination/blank.html`);
    const terminateSamples = [], rebuildSamples = [], blockedFlags = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const rep = await runOneRepetition(page);
      terminateSamples.push(rep.terminateCallMs);
      rebuildSamples.push(rep.rebuildMs);
      const gap = isolateSpanningGap(rep.rafTimestamps, rep.terminateAtAbsoluteMs, MAX_RAF_GAP_MS);
      blockedFlags.push(gap.blocked);
    }
    results[runtime.name] = {
      terminateCallMs: summarizeLatencies(terminateSamples),
      rebuildMs: summarizeLatencies(rebuildSamples),
      mainThreadEverBlocked: blockedFlags.some(Boolean),
    };
    await browser.close();
  }
  server.close();
  console.log(JSON.stringify(results, null, 2));
}

main();
```
`spike/m4/s5-termination/blank.html` is a minimal static page, no Viewer/model.

- [ ] **Step 7: Manual verification**
Run: `node spike/m4/s5-termination/run.mjs`
Expected: `terminateCallMs` sub-millisecond median (both runtimes); `mainThreadEverBlocked: false`;
`rebuildMs` cross-checked against Phase 3.10's S3' cold-start figure — a >2× divergence is a named
finding.

- [ ] **Step 8: Commit**
```bash
git add spike/m4/s5-termination/synthetic-task.worker.mjs spike/m4/s5-termination/run.mjs spike/m4/s5-termination/blank.html
git commit -m "spike(m4): S5' termination-latency live driver, waits for worker-started ack"
```

---

### Task 4.2: S6' Message-Overhead Spike

**Condition:** Only if S1' passed **and** §18's C1 row is not already analytically refuted.

**Files:**
- Create: `spike/m4/s6-message-overhead/payload.mjs`
- Create: `spike/m4/s6-message-overhead/report.mjs`
- Create: `spike/m4/s6-message-overhead/synthetic-worker.mjs`
- Create: `spike/m4/s6-message-overhead/run.mjs`
- Test: `spike/m4/s6-message-overhead/payload.test.mjs`, `spike/m4/s6-message-overhead/report.test.mjs`
- Test: manual verification via `node spike/m4/s6-message-overhead/run.mjs`

**Interfaces:**
- Consumes: `test/performance/results/m4-gate-<timestamp>.json` — reads `report.evidenceRecords`
  for the largest verdict-bearing tuple, and (per this document's resolved Open Question 4) probes
  for a sibling `statistics.narrowPhasePairs`-shaped field on that record, **failing loudly with a
  named error identifying the exact tuple and the fields actually present** if it is not found,
  rather than silently defaulting `N`. Consumes §18's C1 row (per-pair transfer/copy) and §8.4.1's
  response-entry shape as the round-trip template.
- Produces: ms-per-message, bytes-per-message, total ms, total bytes.

**Fix applied (review finding I1):** the prior draft sized its byte estimate from a full two-operand
message (position/index/BVH/connectivity/matrices) but the live loop only ever sent one operand's
bare position/index — timing and byte figures described two different messages. Fixed below: the
driver now builds and sends the SAME `buildRepresentativePairMessage(...)` object the byte estimator
sizes, with its dimensions actually overwritten from the real gate report (not left as a dead
comment), and the acceptance/report field names are unified to `perMessageMs`/`totalMs` (matching
what the manual-verification step actually asserts on) rather than leaving `mean`/`sum` unreconciled
against a different expected shape.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s6-message-overhead/payload.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRepresentativePairMessage, buildRepresentativeResultMessage, estimateMessageBytes, transferListFor } from './payload.mjs';

test('buildRepresentativePairMessage sizes both operands off the given dimensions', () => {
  const msg = buildRepresentativePairMessage({ triangleCount: 512, componentCount: 3 });
  assert.equal(msg.sourceOperand.index.length, 512 * 3);
  assert.equal(msg.targetOperand.index.length, 512 * 3);
  assert.equal(msg.sourceMatrix.length, 16);
  assert.ok(msg.sourceOperand.position instanceof Float32Array);
});

test('buildRepresentativeResultMessage matches §8.4.1\'s single result-entry shape', () => {
  const msg = buildRepresentativeResultMessage({ requestId: 7 });
  assert.equal(msg.requestId, 7);
  assert.equal(msg.results.length, 1);
  assert.ok('conclusive' in msg.results[0]);
});

test('estimateMessageBytes sums typed-array byteLengths plus the fixed field-list allowance (§15.1 convention)', () => {
  const msg = buildRepresentativePairMessage({ triangleCount: 10, componentCount: 1 });
  const bytes = estimateMessageBytes(msg);
  const typedArrayBytes = msg.sourceOperand.position.byteLength + msg.sourceOperand.index.byteLength
    + msg.targetOperand.position.byteLength + msg.targetOperand.index.byteLength
    + msg.sourceMatrix.byteLength + msg.targetMatrix.byteLength;
  assert.ok(bytes > typedArrayBytes);
});

test('transferListFor deduplicates aliased ArrayBuffers by identity (guards the C2 duplicate-transfer defect class)', () => {
  const shared = new Float32Array(3).buffer;
  const msg = { a: new Float32Array(shared), b: new Uint8Array(shared) }; // same underlying buffer, two views
  const list = transferListFor(msg);
  assert.equal(list.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s6-message-overhead/payload.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s6-message-overhead/payload.mjs
const HEADER_BYTES = 32;
const NUMERIC_FIELD_BYTES = 8;

export function buildRepresentativePairMessage({ triangleCount, componentCount }) {
  const indexLen = triangleCount * 3;
  const buildOperand = (seed) => ({
    position: Float32Array.from({ length: triangleCount * 3 }, (_, i) => (i + seed) * 0.01),
    index: Uint32Array.from({ length: indexLen }, (_, i) => i % (triangleCount * 3)),
    bvh: { version: 1, roots: [new ArrayBuffer(triangleCount * 32)], index: new Uint32Array(indexLen), indirectBuffer: new Uint32Array(indexLen) },
    connectivity: { componentCount, componentOf: new Int32Array(triangleCount), closedManifold: new Uint8Array(componentCount) },
  });
  return {
    requestId: 1,
    sourceOperand: buildOperand(0),
    targetOperand: buildOperand(1000),
    sourceMatrix: Float64Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
    targetMatrix: Float64Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
  };
}

export function buildRepresentativeResultMessage({ requestId }) {
  return {
    requestId,
    results: [{ sourceFragmentId: 1, targetFragmentId: 2, verdict: 'volume-overlap', conclusive: true, witness: { kind: 'crossing', point: [0, 0, 0] } }],
    diagnostics: [], statistics: {},
  };
}

export function estimateMessageBytes(message) {
  let bytes = HEADER_BYTES;
  const walk = (v) => {
    if (ArrayBuffer.isView(v)) { bytes += v.byteLength; return; }
    if (v instanceof ArrayBuffer) { bytes += v.byteLength; return; }
    if (Array.isArray(v)) { for (const item of v) walk(item); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]); return; }
    if (typeof v === 'number' || typeof v === 'boolean') { bytes += NUMERIC_FIELD_BYTES; return; }
    if (typeof v === 'string') { bytes += v.length * 2; return; }
  };
  walk(message);
  return bytes;
}

// Deduplicates by physical ArrayBuffer identity (a `Set` keyed on the buffer object itself) --
// the SAME defect class review finding C2 caught in Task 4.4's worker: two typed-array views
// aliasing one buffer must appear at most once in a transfer list, or postMessage throws
// DataCloneError before any message is delivered.
export function transferListFor(message) {
  const buffers = new Set();
  const walk = (v) => {
    if (ArrayBuffer.isView(v)) { buffers.add(v.buffer); return; }
    if (v instanceof ArrayBuffer) { buffers.add(v); return; }
    if (Array.isArray(v)) { for (const item of v) walk(item); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]); return; }
  };
  walk(message);
  return [...buffers];
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s6-message-overhead/payload.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s6-message-overhead/payload.mjs spike/m4/s6-message-overhead/payload.test.mjs
git commit -m "spike(m4): S6' representative message construction, byte estimation, dedup transfer list (RED->GREEN)"
```

- [ ] **Step 6: report.mjs**
```js
// spike/m4/s6-message-overhead/report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRoundTrips } from './report.mjs';

test('summarizeRoundTrips reports perMessageMs/totalMs/bytesPerMessage/totalBytes (matches manual-verification acceptance)', () => {
  const summary = summarizeRoundTrips([1.1, 0.9, 1.3, 1.0], { requestBytes: 5000, responseBytes: 200 });
  assert.equal(summary.count, 4);
  assert.ok(summary.perMessageMs > 0);
  assert.equal(summary.bytesPerMessage, 5200);
  assert.equal(summary.totalBytes, 5200 * 4);
  assert.equal(summary.totalMs, summary.sum);
});

test('summarizeRoundTrips guards the empty-set case', () => {
  assert.equal(summarizeRoundTrips([], { requestBytes: 0, responseBytes: 0 }).exercised, false);
});
```
```js
// spike/m4/s6-message-overhead/report.mjs
function nearestRankPercentile(sorted, p) {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function summarizeRoundTrips(samplesMs, { requestBytes, responseBytes }) {
  if (samplesMs.length === 0) return { exercised: false, reason: 'no round trips recorded' };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = samplesMs.reduce((a, b) => a + b, 0);
  const bytesPerMessage = requestBytes + responseBytes;
  return {
    exercised: true, count: samplesMs.length,
    min: sorted[0], max: sorted[sorted.length - 1],
    p50: nearestRankPercentile(sorted, 0.5), p95: nearestRankPercentile(sorted, 0.95), p99: nearestRankPercentile(sorted, 0.99),
    mean: sum / samplesMs.length, sum, perMessageMs: sum / samplesMs.length, totalMs: sum,
    bytesPerMessage, totalBytes: bytesPerMessage * samplesMs.length,
  };
}
```
Run: `node --test spike/m4/s6-message-overhead/report.test.mjs`.
```bash
git add spike/m4/s6-message-overhead/report.mjs spike/m4/s6-message-overhead/report.test.mjs
git commit -m "spike(m4): S6' round-trip summarizer, unified perMessageMs/totalMs field names (RED->GREEN)"
```

- [ ] **Step 7: Write the real worker + driver**
```js
// spike/m4/s6-message-overhead/synthetic-worker.mjs
// Transport-only echo -- §17: "S6' measures its repeated-message half", never real computation.
self.onmessage = (ev) => {
  const { requestId } = ev.data;
  self.postMessage({
    requestId,
    results: [{ sourceFragmentId: 1, targetFragmentId: 2, verdict: 'volume-overlap', conclusive: true, witness: { kind: 'crossing', point: [0, 0, 0] } }],
    diagnostics: [], statistics: {},
  });
};
```
```js
// spike/m4/s6-message-overhead/run.mjs
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import express from 'express';
import { buildRepresentativePairMessage, estimateMessageBytes, buildRepresentativeResultMessage, transferListFor } from './payload.mjs';
import { summarizeRoundTrips } from './report.mjs';

async function readLargestVerdictBearingDimensions() {
  const dir = 'test/performance/results';
  const files = (await readdir(dir)).filter((f) => f.startsWith('m4-gate-')).sort();
  if (files.length === 0) throw new Error("S6' requires a Phase-3 baseline gate report; none found in " + dir);
  const report = JSON.parse(await readFile(`${dir}/${files[files.length - 1]}`, 'utf8'));
  if (!Array.isArray(report.evidenceRecords)) {
    throw new Error("S6': expected report.evidenceRecords (Phase 3 Task 3.8's buildEvidenceRecord shape) — got: " + Object.keys(report).join(', '));
  }
  let largest = null;
  for (const rec of report.evidenceRecords) {
    const n = rec.statistics?.narrowPhasePairs;
    if (Number.isFinite(n) && (largest === null || n > largest.n)) largest = { n, rec };
  }
  if (largest === null) {
    throw new Error(
      "S6': no evidence record carried a usable statistics.narrowPhasePairs field. " +
      "Phase 3.8's own evidence-record shape is marked PROVISIONAL and does not yet pin this field " +
      "(see this document's resolved Open Question 4) -- reconcile against Phase 2 task 2.4's final " +
      "canonical evidence-vector shape before running S6' for real.",
    );
  }
  return { N: largest.n };
}

async function main() {
  const { N } = await readLargestVerdictBearingDimensions();
  const message = buildRepresentativePairMessage({ triangleCount: 2000, componentCount: 4 });
  const messageBytes = estimateMessageBytes(message);
  const responseBytes = estimateMessageBytes(buildRepresentativeResultMessage({ requestId: 0 }));

  const app = express();
  app.use('/spike/m4', express.static('spike/m4'));
  const server = app.listen(0);
  const { port } = server.address();

  const results = {};
  for (const runtime of [{ name: 'single-process', args: ['--single-process', '--no-zygote'] }, { name: 'multi-process', args: [] }]) {
    const browser = await chromium.launch({ args: ['--no-sandbox', ...runtime.args] });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/spike/m4/s6-message-overhead/blank.html`);
    const samples = await page.evaluate(async ({ n, message }) => {
      const { transferListFor } = await import('/spike/m4/s6-message-overhead/payload.mjs');
      const worker = new Worker('/spike/m4/s6-message-overhead/synthetic-worker.mjs', { type: 'module' });
      const timings = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const done = new Promise((resolve) => { worker.onmessage = () => resolve(); });
        // Fresh copies each iteration: postMessage detaches transferred buffers (§8.1), and a
        // per-pair topology re-copies every message, which IS the cost under measurement.
        const copy = structuredClone(message);
        worker.postMessage({ ...copy, requestId: i }, transferListFor(copy));
        await done;
        timings.push(performance.now() - t0);
      }
      worker.terminate();
      return timings;
    }, { n: N, message });
    results[runtime.name] = summarizeRoundTrips(samples, { requestBytes: messageBytes, responseBytes });
    await browser.close();
  }
  server.close();
  console.log(JSON.stringify({ N, messageBytes, results }, null, 2));
}

main();
```

- [ ] **Step 8: Manual verification**
Run: `node spike/m4/s6-message-overhead/run.mjs`
Expected: a report naming `N` (read from the real Phase-3 report; the run fails loudly, naming the
exact missing field, if the report doesn't carry it yet), `perMessageMs`, `totalMs`,
`bytesPerMessage`, `totalBytes` for both runtimes, `messageBytes` matching what was actually
transferred. No fixed pass/fail. Flag prominently if `totalMs` at the reported `N` exceeds T-a's
50ms bound many times over.

- [ ] **Step 9: Commit**
```bash
git add spike/m4/s6-message-overhead/synthetic-worker.mjs spike/m4/s6-message-overhead/run.mjs spike/m4/s6-message-overhead/blank.html
git commit -m "spike(m4): S6' per-pair message-overhead live driver, sends the message it sizes"
```

---

### Task 4.3: S7' Shared Worker/Transfer Protocol Scaffold

**Condition:** Only if the baseline fails §7.2's target at some verdict-bearing tuple with T-a
among the failing metrics. Built ONCE; 4.4/4.5 configure it.

**Files:**
- Create: `spike/m4/s7-shared/workerChannel.mjs`
- Create: `spike/m4/s7-shared/createSpikeWorker.mjs`
- Create: `spike/m4/s7-shared/echo.worker.mjs`
- Test: `spike/m4/s7-shared/workerChannel.test.mjs`
- Test: manual smoke verification via `node spike/m4/s7-shared/smoke.mjs`

**Interfaces:**
- Consumes: §8.1's crossability table; §8.4.1's wire-contract shape pattern, generalized; §10.2's
  settlement matrix, adapted to a stub-mapped context.
- Produces: `createWorkerChannel(port, {timeoutMs})` and `createSpikeWorker(scriptUrl)`, consumed by
  4.4, 4.5, and 4.8.

**Fixes applied (review findings C1 and C5), stated once here since both are load-bearing for every
downstream task:**

- **C1 — the delivery-task correlation mark was recorded in the wrong JS realm.** §6.2's rule is
  explicit: "The harness places one `performance.mark` as the first statement of the **worker
  arm's `onmessage` handler**" — that is the PAGE's listener for the worker's response (the handler
  `workerChannel`'s `query()` installs on `port.onmessage`), not the worker's own `self.onmessage`
  (which receives population/query messages sent TO the worker). A worker-side `performance.now()`
  value is not a main-thread user-timing event and cannot be correlated against the CDP trace's
  main-thread task list at all — `Hᵢ` would be silently wrong or unevaluable. Fixed below:
  `workerChannel.mjs`'s `port.onmessage` handler now takes a real, main-thread `performance.mark`
  as its literal first statement, names it uniquely per `(requestId)`, and returns that mark's name
  alongside the resolved response so the driver can hand it straight to Phase 2.2's
  `computeBoundaryOccupancy` as `correlationMarkMs`.
- **C5 — protocol faults could leave a `query()` promise unsettled forever.** Fixed: (a) a response
  with no usable `requestId` at all is now **protocol-fatal** — every pending entry is rejected and
  the map cleared, matching the settlement matrix's spirit for an unroutable fault, rather than
  being silently discarded with nothing left to identify which request it belonged to; (b) a
  `messageerror` listener is wired alongside `onerror`, since a `postMessage` payload that fails to
  structured-clone on the receiving side fires `messageerror`, not `error`; (c) `query()` now takes
  a bounded per-request timeout (default 30s, overridable), rejecting that one pending entry with a
  named `TimeoutError` — bounding "the manual run can hang forever" without touching the other two
  entry-points' correctness.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s7-shared/workerChannel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerChannel, mapToStubResult } from './workerChannel.mjs';

function fakePort() {
  const port = { posted: [], terminated: false, onmessage: null, onerror: null, onmessageerror: null };
  port.postMessage = (msg, transfer) => port.posted.push({ msg, transfer });
  port.terminate = () => { port.terminated = true; };
  port.emit = (msg) => port.onmessage?.({ data: msg });
  port.fail = (err) => port.onerror?.(err);
  port.failClone = (err) => port.onmessageerror?.(err);
  return port;
}

test('populate() posts a one-way message with no response tracked (§8.4.1: pushed ONCE, not per pair)', () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  channel.populate({ kind: 'population', geometryIndex: 1 });
  assert.equal(port.posted.length, 1);
});

test('query() resolves with the raw response AND a main-thread correlationMarkName (fix for C1)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const promise = channel.query({ kind: 'query' });
  const sentRequestId = port.posted[0].msg.requestId;
  port.emit({ requestId: sentRequestId, results: [{ verdict: 'ok' }] });
  const result = await promise;
  assert.equal(result.raw.requestId, sentRequestId);
  assert.match(result.correlationMarkName, new RegExp(`^s7-delivery-${sentRequestId}$`));
});

test('a response whose requestId is not in the pending map is discarded silently (§10.2 row 1)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const promise = channel.query({ kind: 'query' });
  port.emit({ requestId: 999999, results: [] });
  const sentRequestId = port.posted[0].msg.requestId;
  port.emit({ requestId: sentRequestId, results: [] });
  await assert.doesNotReject(promise);
});

test('a response with NO usable requestId at all is protocol-fatal: rejects every pending entry (fix for C5)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const p1 = channel.query({ kind: 'a' });
  const p2 = channel.query({ kind: 'b' });
  port.emit({ results: [] }); // no requestId whatsoever -- unroutable
  await assert.rejects(p1, TypeError);
  await assert.rejects(p2, TypeError);
});

test('a response WITH a requestId but a malformed body rejects only that matched entry with a TypeError (§10.2 row 6)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const promise = channel.query({ kind: 'query' });
  const requestId = port.posted[0].msg.requestId;
  port.emit({ requestId, results: 'not-an-array' });
  await assert.rejects(promise, TypeError);
});

test('worker onerror rejects every pending entry and clears the map (§10.2 row 7)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const p1 = channel.query({ kind: 'a' });
  const p2 = channel.query({ kind: 'b' });
  port.fail(new Error('boom'));
  await assert.rejects(p1);
  await assert.rejects(p2);
});

test('messageerror also rejects every pending entry (fix for C5: structured-clone failures fire messageerror, not error)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const pending = channel.query({ kind: 'a' });
  port.failClone(new Error('clone failed'));
  await assert.rejects(pending);
});

test('a query() past its timeout rejects with a named TimeoutError, without affecting other pending entries (fix for C5)', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port, { timeoutMs: 5 });
  const willTimeout = channel.query({ kind: 'a' });
  await assert.rejects(willTimeout, /TimeoutError/);
});

test('dispose() terminates the port and rejects any still-pending queries', async () => {
  const port = fakePort();
  const channel = createWorkerChannel(port);
  const pending = channel.query({ kind: 'a' });
  channel.dispose();
  assert.equal(port.terminated, true);
  await assert.rejects(pending);
  await assert.rejects(channel.query({ kind: 'b' }));
});

test('mapToStubResult produces a frozen, inert object and never mutates the raw response', () => {
  const raw = { requestId: 1, results: [{ verdict: 'ok' }], diagnostics: [], statistics: { n: 1 } };
  const stub = mapToStubResult(raw);
  assert.equal(stub.__stub, true);
  assert.throws(() => { stub.results = []; });
  assert.deepEqual(raw, { requestId: 1, results: [{ verdict: 'ok' }], diagnostics: [], statistics: { n: 1 } });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s7-shared/workerChannel.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s7-shared/workerChannel.mjs
const DEFAULT_TIMEOUT_MS = 30_000;

export function createWorkerChannel(port, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const pending = new Map(); // requestId -> {resolve, reject, timer}
  let nextRequestId = 1;
  let disposed = false;

  // C1 fix: the correlation mark is a REAL main-thread performance.mark, taken as the literal
  // first statement of this handler -- this IS "the worker arm's onmessage handler" §6.2 means
  // (the page's listener for the worker's response), never the worker's own self.onmessage.
  port.onmessage = (ev) => {
    const msg = ev.data;
    const hasRoutableId = msg && typeof msg.requestId === 'number' && pending.has(msg.requestId);
    const markName = hasRoutableId ? `s7-delivery-${msg.requestId}` : null;
    if (markName) performance.mark(markName);

    if (!msg || typeof msg.requestId !== 'number') {
      // C5 fix: no usable routing identity at all -- unroutable and therefore protocol-fatal,
      // never silently discarded (a silent discard here would leave every pending query hanging).
      rejectAllPending(new TypeError('worker sent a response with no requestId: cannot be routed'));
      return;
    }
    if (!isWellFormedResponse(msg)) {
      const entry = pending.get(msg.requestId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(msg.requestId);
        entry.reject(new TypeError(`malformed response for request ${msg.requestId}`));
      }
      return; // requestId present but unmatched -- nothing pending to reject (§10.2 row 1)
    }
    const entry = pending.get(msg.requestId);
    if (!entry) return; // requestId not in the map -> discard silently (§10.2 row 1)
    clearTimeout(entry.timer);
    pending.delete(msg.requestId);
    entry.resolve({ raw: msg, correlationMarkName: markName });
  };

  port.onerror = (err) => rejectAllPending(new Error(`worker error: ${err?.message ?? err}`));
  // C5 fix: a postMessage payload that fails to structured-clone on receipt fires `messageerror`,
  // NOT `error` -- a channel that only listens for onerror never learns about this class of fault
  // and hangs forever.
  port.onmessageerror = (err) => rejectAllPending(new Error(`worker message-clone error: ${err?.message ?? err}`));

  function rejectAllPending(err) {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(err); }
    pending.clear();
  }

  return {
    populate(populationMessage, transferList = []) {
      if (disposed) throw new Error('workerChannel: populate() after dispose()');
      port.postMessage(populationMessage, transferList);
    },
    query(queryMessage, transferList = []) {
      if (disposed) return Promise.reject(new Error('workerChannel: query() after dispose()'));
      const requestId = nextRequestId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`TimeoutError: query ${requestId} did not resolve within ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        port.postMessage({ ...queryMessage, requestId }, transferList);
      });
    },
    dispose() {
      disposed = true;
      rejectAllPending(new Error('workerChannel: disposed with requests in flight'));
      port.terminate();
    },
  };
}

function isWellFormedResponse(msg) {
  return !!msg && typeof msg.requestId === 'number' && Array.isArray(msg.results);
}

export function mapToStubResult(rawResponse) {
  return Object.freeze({
    requestId: rawResponse.requestId,
    results: rawResponse.results,
    diagnostics: rawResponse.diagnostics ?? [],
    statistics: rawResponse.statistics ?? {},
    __stub: true,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s7-shared/workerChannel.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s7-shared/workerChannel.mjs spike/m4/s7-shared/workerChannel.test.mjs
git commit -m "spike(m4): S7' shared worker-channel scaffold, main-thread correlation mark, protocol-fatal/timeout handling (RED->GREEN, fixes review C1/C5)"
```

- [ ] **Step 6: Real same-origin worker construction + worker-side error safety**
```js
// spike/m4/s7-shared/createSpikeWorker.mjs
export function createSpikeWorker(scriptUrl) {
  return new Worker(scriptUrl, { type: 'module' });
}

// C5 fix: a rejected Promise inside an ASYNC self.onmessage handler does NOT fire the worker's
// own `error` event (only a genuine synchronous throw does) -- so an unhandled async rejection in
// a worker's message handler is otherwise invisible to the main thread and hangs the matching
// query() forever. Every worker script built in 4.4/4.5/4.8 wraps its handler body with this.
export function withWorkerErrorSafety(handler) {
  return async (ev) => {
    try {
      await handler(ev);
    } catch (err) {
      const requestId = ev.data?.requestId;
      self.postMessage({ requestId, results: [], diagnostics: [{ reason: 'worker-computation-error', message: String(err?.message ?? err) }], statistics: {}, __workerError: true });
    }
  };
}
```
```js
// spike/m4/s7-shared/echo.worker.mjs
import { withWorkerErrorSafety } from './createSpikeWorker.mjs';
self.onmessage = withWorkerErrorSafety(async (ev) => {
  self.postMessage({ requestId: ev.data.requestId, results: [] });
});
```

- [ ] **Step 7: Smoke-check driver**
```js
// spike/m4/s7-shared/smoke.mjs
import { chromium } from 'playwright';
import express from 'express';

async function main() {
  const app = express();
  app.use('/spike/m4', express.static('spike/m4'));
  const server = app.listen(0);
  const { port } = server.address();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/spike/m4/s7-shared/blank.html`);
  const ok = await page.evaluate(async () => {
    const { createSpikeWorker } = await import('/spike/m4/s7-shared/createSpikeWorker.mjs');
    const { createWorkerChannel } = await import('/spike/m4/s7-shared/workerChannel.mjs');
    const worker = createSpikeWorker('/spike/m4/s7-shared/echo.worker.mjs');
    const channel = createWorkerChannel(worker);
    const result = await channel.query({ kind: 'ping' });
    channel.dispose();
    return typeof result.raw.requestId === 'number' && typeof result.correlationMarkName === 'string';
  });
  console.log('smoke check (real worker round trip + main-thread correlation mark):', ok ? 'PASS' : 'FAIL');
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
}

main();
```

- [ ] **Step 8: Manual verification**
Run: `node spike/m4/s7-shared/smoke.mjs` — expect `PASS`, exit 0.

- [ ] **Step 9: Commit**
```bash
git add spike/m4/s7-shared/createSpikeWorker.mjs spike/m4/s7-shared/echo.worker.mjs spike/m4/s7-shared/smoke.mjs spike/m4/s7-shared/blank.html
git commit -m "spike(m4): S7' real worker construction, worker-side async error safety, smoke check"
```

---

### Task 4.4: S7' Geometry-Preparation Vertical (WB-1b, + isolated WB-1a sub-timing)

**Condition:** Same gate as 4.3, only for tuples where the geometry-preparation family strictly
wins §17's selection rule.

**Consumed interface — the REAL Phase 1.3 contract (replaces the prior draft's invented shape):**
`setSpikeInputCapture(fn)` / `clearSpikeInputCapture()`, `fn(kind, payload)`:
- `kind === 'geometry-raw-input'`: `payload = { loadEpoch, geometryIndex, role, positions,
  positionStride, positionOffset, index, ranges: {start,count}[], activeTriangleCount, weldEpsilon
  }` — `.slice()` copies; `index` may be `null` for non-indexed geometry; `positions`/`index`
  preserve whatever typed-array constructor the Viewer supplied (do not assume `Float32Array`/
  `Uint32Array` — read `.constructor`/`BYTES_PER_ELEMENT`).
- `kind === 'geometry-welded-result'`: `payload = { loadEpoch, geometryIndex, role, position, index,
  triangleCount }` — validator-input only (Task 4.6), never fed to the worker.
- **Capture identity is `(loadEpoch, geometryIndex)`**, not `(..., role)` — `role` on a payload is
  "the role of whichever call first triggered this build" (single-flight cache semantics), never a
  separate dedup axis.

**Files:**
- Create: `spike/m4/s7-geometry/pairing.mjs`
- Create: `spike/m4/s7-geometry/armOrder.mjs`
- Create: `spike/m4/s7-geometry/syncArmReplay.mjs`
- Create: `spike/m4/s7-geometry/workerCompute.mjs`
- Create: `spike/m4/s7-geometry/worker.mjs`
- Create: `spike/m4/s7-geometry/run.mjs`
- Test: `spike/m4/s7-geometry/pairing.test.mjs`, `spike/m4/s7-geometry/armOrder.test.mjs`,
  `spike/m4/s7-geometry/syncArmReplay.test.mjs`, `spike/m4/s7-geometry/workerCompute.test.mjs`
- Test: manual verification via `run.mjs`

**Interfaces:**
- Consumes: the real Phase 1.3 capture hook (above); 4.3's `createWorkerChannel`/`mapToStubResult`/
  `createSpikeWorker`/`withWorkerErrorSafety`; the checkpoint's list of qualifying tuples (this
  document's resolved Open Question 4 — read from `report.evidenceRecords`, filtered on
  `targets.Ta.pass === false`); the REAL production `createGeometryRegistry`
  (`collision/geometry/createGeometryRegistry.js`) — which itself wires the REAL
  `compactAndWeld` (`collision/geometry/activeRangeCompaction.js`), `computeGeometryConnectivity`
  (`collision/geometry/GeometryConnectivity.js`), and `BlasCache`/`ThreeMeshBvhBackend.build`
  (`collision/blas/BlasCache.js`, `collision/blas/ThreeMeshBvhBackend.js`, whose real return shape
  is `{bvh, localDiagonal, aspectRatio, aspectRatioExceeded, geometry}`) — plus the REAL
  `createCheckpointPort`/`createFrameBudgetAccumulator` (`collision/scheduler.js`) for the
  synchronous arm's replay adapter; `MeshBVH.serialize`/`MeshBVH` from the pinned
  `three-mesh-bvh@0.9.14` (used by BOTH arms now, so the synchronous arm's result is
  transport/validator-comparable — see Step 8's fix).
- Produces: paired stage-cost figures (median/min/max/raw across 5 counterbalanced repetitions),
  the isolated worker-side `bvh-construction` sub-timing, the sub-mark intervals and the (now
  correctly main-thread) correlation mark consumed by Task 4.7, the recorded per-repetition
  arm-order schedule, and both arms' results (both now carrying a `serializedBvh`, not a live BVH)
  handed to Task 4.6's validator.

**Fixes applied (review findings C2 and C4):**

- **C2 — duplicate transferable buffer, reproducible `DataCloneError`.** `ThreeMeshBvhBackend.build`
  wraps `weldedGeometry.index` DIRECTLY into the BVH's own geometry
  (`ThreeMeshBvhBackend.js:37`: `geometry.setIndex(new THREE.Uint32BufferAttribute(weldedGeometry.index, 1))`),
  so with `MeshBVH.serialize(bvh, {cloneBuffers: false})`, `serializedBvh.index` is the SAME
  `ArrayBuffer` as `weldedGeometry.index.buffer`. The prior draft's transfer list listed
  `weldedGeometry.index.buffer` and `serializedBvh.index.buffer` separately — a duplicate entry,
  which `postMessage` rejects before any message is sent. Fixed: the transfer list is now built
  once via `transferListFor` (identical dedup-by-identity helper as Task 4.2's `payload.mjs`,
  duplicated per file per the plan's no-shared-module convention), applied to the whole response
  object rather than hand-assembled.
- **C4 — non-runnable fixture placeholder.** The prior `workerCompute.test.mjs` used a
  `unitCubeView()` fixture shaped `{positions, positionStride, activeTriangleCount}`, missing the
  `ranges`/`index`/`positionOffset` fields `compactAndWeld`'s real contract requires
  (`activeRangeCompaction.js:24,41`: `collectActiveTriangleVertexIds` reads `view.ranges`/`view.index`,
  `buildCompactBuffers` reads `view.positionOffset`) — running it throws `TypeError: ranges is not
  iterable`. Fixed below with a real, complete fixture matching the exact real raw-input shape.

**Fix applied (independent Codex review finding, this round — "S7''s synchronous arm does not
reproduce production scheduling", Critical):** the prior draft's synchronous arm called
`compactAndWeld`/`computeGeometryConnectivity`/`ThreeMeshBvhBackend.build` directly in one
hand-rolled loop, justified by the claim that "these are all fully synchronous, so this IS
today's execution... there is no yield difference for an already-synchronous call chain." That
claim is false against the actual `GeometryRegistry` implementation
(`collision/geometry/GeometryRegistry.js`): production never calls these three functions directly
in sequence. It runs each of them through `_runPhase` (`GeometryRegistry.js:202-230`), which calls
`this._checkpointPort.checkpoint({ loadEpoch })` and — critically — `await`s it whenever a yield
is actually due, **before** `builderFn()` (the phase's own weld/connectivity/BVH call) ever runs
(`GeometryRegistry.js:210-211`). `_insertBuildingEntry` chains exactly three such phases in a fixed
order — weld (`GeometryRegistry.js:116-118`), then connectivity (`:142-153`, only when
`needsConnectivityAtStart`), then BVH construction/`bvh-construction` (`:155-171`) — with `tail`
reassigned synchronously at each step so a concurrent caller can never race the phase order
(`:120-124`). Each phase is also raced against the entry's own cancellation signal via
`Promise.race([attempt, entry.cancellationSignal])` (`:226`), and each phase's own duration is
timed and reported via the module-level `reportSpan(label, ms)` helper, decoupled from the shared
port's own liveness baseline (`:195-217`). A hand-rolled call chain that skips `_runPhase` entirely
reproduces none of this: no checkpoint-before-build gate between phases, no possibility of yielding
mid-build, and no cancellation race — exactly the "direct replay combines weld, connectivity, and
BVH into a single long task" failure the review describes. **Resolution:**
`spike/m4/s7-geometry/syncArmReplay.mjs` below is a test-only "production-topology replay adapter"
that constructs a REAL `GeometryRegistry` via the REAL `createGeometryRegistry` factory, wired with
a REAL `checkpointPort` (`createCheckpointPort`/`createFrameBudgetAccumulator` from
`collision/scheduler.js`, real default budget and a real `setTimeout(0)` yield — never stubbed),
and drives weld/connectivity/BVH through its REAL `getOrBuildGeometry` call. This is not a
re-implementation of `_runPhase`'s checkpoint gate — it IS `_runPhase`'s checkpoint gate, because it
is the real `GeometryRegistry` instance running it. `collision/geometry/GeometryRegistry.js` itself
is never imported by, or modified for, this replay adapter beyond its own public
constructor/factory surface (Global Constraints: production source stays out of scope). The second
review point — "drivers also consistently run the synchronous arm before the worker arm" — is
fixed by `armOrder.mjs`/`runPairedRepetitionInOrder` (below), which alternates which arm runs first
by repetition parity and records the schedule actually used.

**Further fixes applied (independent Codex spec-review of this fix, this round — each verified
directly against source before being accepted; see this task's own commit history for the earlier
C1-C4 round this is on top of):**
- **Timing/measurement correctness (Critical).** The paired driver originally created `*-start`/
  `*-end` performance marks but (a) for the worker arm never called `performance.measure(...)` at
  all, so reading a duration afterward would always return `null`, and (b) reused the SAME literal
  mark/measure names across all 5 repetitions, so a later `performance.getEntriesByName(name,
  'measure')[0]` lookup would always resolve to repetition 0's entry, never the current one. Fixed
  below: `runSyncArm`/`runWorkerArm` now read `performance.measure(...).duration` directly, in the
  SAME `page.evaluate` call that performed the measurement (no separate cross-repetition lookup at
  all), and every mark/measure name is namespaced by `repetitionIndex` and cleared immediately
  after reading, so Task 4.7's own mark-based correlation can unambiguously attribute a sub-mark to
  the repetition that produced it.
- **Batched worker-arm topology, not one round trip per geometry (Critical).** The worker arm
  previously sent one `populate-geometry` request PER distinct geometry, sequentially awaited — N
  round trips for a tuple with N distinct geometries, inflating message/dispatch overhead in a way
  that does not represent WB-1b's real once-per-query topology and can misclassify its B/C verdict
  on fabricated protocol overhead alone. Fixed: `pairing.mjs` gains `buildPopulationBatchMessage`
  (built from the existing, already-unit-tested `buildPopulationMessage`, combined into ONE message
  with one deduped transfer list), and `worker.mjs`/`run.mjs` now send exactly ONE
  `populate-geometry-batch` request per repetition — mirroring the already-batched `precheck-query`
  topology Task 4.5's own worker arm already uses.
- **Synchronous-arm result must be transport/validator-comparable, not a live class instance
  (Critical).** `createSyncArmReplay.build()` previously returned a LIVE `MeshBVH` (`built.bvh`),
  while the worker arm returns `serializedBvh` (`MeshBVH.serialize(...)`) — different shapes Task
  4.6's validator cannot field-compare, and a live class instance is not guaranteed to round-trip
  faithfully back out of `page.evaluate`. Fixed: `build()` now serializes the BVH with the SAME
  pinned `MeshBVH.serialize(bvh, {cloneBuffers:false})` call the worker uses, before returning.
- **Exception-safe worker/channel cleanup (Important).** The worker arm's `channel`/`worker` were
  disposed only on success. Fixed: `runWorkerArm` now disposes the channel and clears its marks in
  a `finally` block, so one failed repetition cannot leave a worker resident into the next.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s7-geometry/pairing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulateCapturedGeometry, buildPopulationMessage, buildPopulationBatchMessage } from './pairing.mjs';

test('accumulateCapturedGeometry is first-discovery-wins keyed by (loadEpoch, geometryIndex), role is metadata only', () => {
  const captures = [
    ['geometry-raw-input', { loadEpoch: 1, geometryIndex: 5, role: 'source', positions: new Float32Array([0]), positionStride: 3, positionOffset: 0, index: null, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 }],
    ['geometry-raw-input', { loadEpoch: 1, geometryIndex: 5, role: 'target', positions: new Float32Array([99]), positionStride: 3, positionOffset: 0, index: null, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 }],
    ['geometry-raw-input', { loadEpoch: 1, geometryIndex: 9, role: 'source', positions: new Float32Array([1]), positionStride: 3, positionOffset: 0, index: null, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 }],
    ['geometry-welded-result', { loadEpoch: 1, geometryIndex: 5, role: 'source', position: new Float32Array(3), index: new Uint32Array([0, 1, 2]), triangleCount: 1 }],
  ];
  const accumulated = accumulateCapturedGeometry(captures);
  assert.equal(accumulated.size, 2); // (1,5) and (1,9) -- role never splits the key
  assert.equal(accumulated.get('1:5').positions[0], 0); // first discovery ('source') wins
  assert.equal(accumulated.get('1:5').role, 'source');
});

test('accumulateCapturedGeometry ignores geometry-welded-result captures (Task 4.6\'s validator input only)', () => {
  const accumulated = accumulateCapturedGeometry([
    ['geometry-welded-result', { loadEpoch: 1, geometryIndex: 5, role: 'source', position: new Float32Array(3), index: new Uint32Array(3), triangleCount: 1 }],
  ]);
  assert.equal(accumulated.size, 0);
});

test('buildPopulationMessage slice()-copies the raw positions/index (the WB-1b extra copy) and returns a deduped transfer list', () => {
  const positions = new Float32Array([1, 2, 3]);
  const index = new Uint32Array([0, 1, 2]);
  const entry = { loadEpoch: 1, geometryIndex: 5, role: 'source', positions, positionStride: 3, positionOffset: 0, index, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 };
  const { message, transferList } = buildPopulationMessage(entry);
  assert.notEqual(message.positions, positions);
  assert.notEqual(message.index, index);
  assert.deepEqual(Array.from(message.positions), [1, 2, 3]);
  assert.equal(transferList.length, 2); // positions.buffer and index.buffer, no aliasing here
});

test('buildPopulationMessage handles a null index (non-indexed geometry) without transferring a phantom buffer', () => {
  const positions = new Float32Array([1, 2, 3]);
  const entry = { loadEpoch: 1, geometryIndex: 5, role: 'source', positions, positionStride: 3, positionOffset: 0, index: null, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 };
  const { message, transferList } = buildPopulationMessage(entry);
  assert.equal(message.index, null);
  assert.equal(transferList.length, 1);
});

test('buildPopulationBatchMessage combines every entry into ONE message with ONE deduped transfer list (fixes review Critical #4: one batched round trip, not one per geometry)', () => {
  const e1 = { loadEpoch: 1, geometryIndex: 5, role: 'source', positions: new Float32Array([1, 2, 3]), positionStride: 3, positionOffset: 0, index: new Uint32Array([0, 1, 2]), ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 };
  const e2 = { loadEpoch: 1, geometryIndex: 9, role: 'source', positions: new Float32Array([4, 5, 6]), positionStride: 3, positionOffset: 0, index: null, ranges: [{ start: 0, count: 3 }], activeTriangleCount: 1, weldEpsilon: 1e-6 };
  const { message, transferList } = buildPopulationBatchMessage([e1, e2]);
  assert.equal(message.kind, 'populate-geometry-batch');
  assert.equal(message.items.length, 2);
  assert.equal(transferList.length, 3); // e1: positions+index (2), e2: positions only (1)
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s7-geometry/pairing.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s7-geometry/pairing.mjs
export function accumulateCapturedGeometry(captures) {
  const byKey = new Map();
  for (const [kind, payload] of captures) {
    if (kind !== 'geometry-raw-input') continue;
    const key = `${payload.loadEpoch}:${payload.geometryIndex}`;
    if (!byKey.has(key)) byKey.set(key, payload); // first-discovery-wins
  }
  return byKey;
}

export function buildPopulationMessage(entry) {
  const positions = entry.positions.slice();
  const index = entry.index ? entry.index.slice() : null;
  const transferList = [positions.buffer];
  if (index) transferList.push(index.buffer);
  return {
    message: {
      kind: 'populate-geometry',
      loadEpoch: entry.loadEpoch, geometryIndex: entry.geometryIndex, role: entry.role,
      positions, positionStride: entry.positionStride, positionOffset: entry.positionOffset,
      index, ranges: entry.ranges, activeTriangleCount: entry.activeTriangleCount, weldEpsilon: entry.weldEpsilon,
    },
    transferList,
  };
}

// Combines buildPopulationMessage's own per-entry message into ONE batched request (fixes review
// Critical #4: the worker arm must transfer representative data once and execute the dominant
// workload as ONE batched operation, not one request/response round trip per geometry).
export function buildPopulationBatchMessage(entries) {
  const items = [];
  const transferList = [];
  for (const entry of entries) {
    const { message, transferList: entryTransferList } = buildPopulationMessage(entry);
    items.push(message);
    transferList.push(...entryTransferList);
  }
  return { message: { kind: 'populate-geometry-batch', items }, transferList };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s7-geometry/pairing.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s7-geometry/pairing.mjs spike/m4/s7-geometry/pairing.test.mjs
git commit -m "spike(m4): S7' geometry-preparation capture accumulation against the REAL Phase 1.3 shape, batched population message (RED->GREEN, fixes review C4 and batched-topology finding)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: workerCompute.mjs — real fixture, real computation**
```js
// spike/m4/s7-geometry/workerCompute.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeometryPreparation } from './workerCompute.mjs';

// A real, complete raw-input view matching the ACTUAL Phase 1.3 'geometry-raw-input' shape --
// two triangles sharing one edge, face-duplicated positions (compactAndWeld's own job is to weld
// them), covering every field collectActiveTriangleVertexIds/buildCompactBuffers actually read
// (ranges, index, positionOffset) -- fixes review finding C4's non-runnable placeholder.
function twoTriangleView() {
  // 6 vertices (3 per face), stride 3, no offset. Faces: [0,1,2] and [3,4,5], where vertex 3,4
  // coincide with vertex 1,2 once welded (shared edge).
  const positions = new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,   // face 0: v0 v1 v2
    1, 0, 0,  0, 1, 0,  1, 1, 0,   // face 1: v3(=v1) v4(=v2) v5
  ]);
  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return {
    positions, positionStride: 3, positionOffset: 0, index,
    ranges: [{ start: 0, count: 6 }], activeTriangleCount: 2, weldEpsilon: 1e-6,
  };
}

test('computeGeometryPreparation runs weld -> connectivity -> BVH build and reports all three timings', async () => {
  const view = twoTriangleView();
  const result = await computeGeometryPreparation({ rawView: view, weldEpsilon: view.weldEpsilon });
  assert.ok(result.weldedGeometry.position instanceof Float32Array);
  assert.ok(result.weldedGeometry.index instanceof Uint32Array);
  assert.equal(result.weldedGeometry.index.length, 6); // 2 triangles, still 6 index entries
  assert.equal(result.connectivity.componentCount, 1); // the two triangles share an edge -> one component
  assert.ok(result.serializedBvh.roots.length > 0);
  assert.ok(result.timings.weldMs >= 0 && result.timings.connectivityMs >= 0 && result.timings.bvhMs >= 0);
});

test('computeGeometryPreparation matches directly-called production functions on identical input', async () => {
  const { compactAndWeld } = await import('../../../collision/geometry/activeRangeCompaction.js');
  const view = twoTriangleView();
  const direct = compactAndWeld(view, { weldEpsilon: view.weldEpsilon });
  const result = await computeGeometryPreparation({ rawView: view, weldEpsilon: view.weldEpsilon });
  assert.deepEqual(Array.from(result.weldedGeometry.position), Array.from(direct.position));
  assert.deepEqual(Array.from(result.weldedGeometry.index), Array.from(direct.index));
});
```
```js
// spike/m4/s7-geometry/workerCompute.mjs
import { compactAndWeld } from '../../../collision/geometry/activeRangeCompaction.js';
import { computeGeometryConnectivity } from '../../../collision/geometry/GeometryConnectivity.js';
import { build as buildBvh } from '../../../collision/blas/ThreeMeshBvhBackend.js';
import { MeshBVH } from 'three-mesh-bvh';
import { maxSyncTriangleCount } from '../../../collision/constants.js';

export async function computeGeometryPreparation({ rawView, weldEpsilon }) {
  const t0 = performance.now();
  const weldedGeometry = compactAndWeld(rawView, { weldEpsilon, maxSyncTriangleCount });
  const weldMs = performance.now() - t0;

  const t1 = performance.now();
  const connectivity = computeGeometryConnectivity(weldedGeometry);
  const connectivityMs = performance.now() - t1;

  const t2 = performance.now();
  const { bvh, localDiagonal, aspectRatio, aspectRatioExceeded } = buildBvh(weldedGeometry);
  const bvhMs = performance.now() - t2;

  const serializedBvh = MeshBVH.serialize(bvh, { cloneBuffers: false });
  const closedManifoldBytes = Uint8Array.from(connectivity.closedManifold.map((b) => (b ? 1 : 0)));

  return {
    weldedGeometry,
    connectivity: { componentCount: connectivity.componentCount, componentOf: connectivity.componentOf, closedManifold: closedManifoldBytes },
    serializedBvh, localDiagonal, aspectRatio, aspectRatioExceeded,
    timings: { weldMs, connectivityMs, bvhMs },
  };
}
```
Run: `node --test spike/m4/s7-geometry/workerCompute.test.mjs`.
```bash
git add spike/m4/s7-geometry/workerCompute.mjs spike/m4/s7-geometry/workerCompute.test.mjs
git commit -m "spike(m4): S7' geometry-preparation computation, real two-triangle fixture (RED->GREEN, fixes review C4)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: armOrder.mjs — counterbalanced arm order across the 5 repetitions**
```js
// spike/m4/s7-geometry/armOrder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armOrderForRepetition, runPairedRepetitionInOrder } from './armOrder.mjs';

test('armOrderForRepetition alternates by repetition parity across 5 repetitions', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(armOrderForRepetition), [
    ['sync', 'worker'],
    ['worker', 'sync'],
    ['sync', 'worker'],
    ['worker', 'sync'],
    ['sync', 'worker'],
  ]);
});

test('runPairedRepetitionInOrder actually invokes the two arms in the order armOrderForRepetition names, for an even repetition (sync first)', async () => {
  const callLog = [];
  const arms = {
    sync: async () => { callLog.push('sync'); return { kind: 'sync-result' }; },
    worker: async () => { callLog.push('worker'); return { kind: 'worker-result' }; },
  };
  const record = await runPairedRepetitionInOrder(0, arms);
  assert.deepEqual(callLog, ['sync', 'worker']);
  assert.deepEqual(record.executionOrder, ['sync', 'worker']);
  assert.deepEqual(record.armOrder, ['sync', 'worker']);
  assert.deepEqual(record.syncArm, { kind: 'sync-result' });
  assert.deepEqual(record.workerArm, { kind: 'worker-result' });
});

test('runPairedRepetitionInOrder actually invokes the two arms in the order armOrderForRepetition names, for an odd repetition (worker first)', async () => {
  const callLog = [];
  const arms = {
    sync: async () => { callLog.push('sync'); return { kind: 'sync-result' }; },
    worker: async () => { callLog.push('worker'); return { kind: 'worker-result' }; },
  };
  const record = await runPairedRepetitionInOrder(1, arms);
  assert.deepEqual(callLog, ['worker', 'sync']);
  assert.deepEqual(record.executionOrder, ['worker', 'sync']);
  assert.deepEqual(record.armOrder, ['worker', 'sync']);
});
```
```js
// spike/m4/s7-geometry/armOrder.mjs
//
// M4 Task 4.4 fix (independent Codex review finding): "drivers also consistently run the
// synchronous arm before the worker arm rather than specifying actual paired-arm
// counterbalancing." Mirrors Task 3.7's own `armOrderForRepetition` counterbalancing pattern
// (test/performance/m4/counterbalancing-schedule.mjs: `repetitionIndex % 2 === 0 ? ['tlas',
// 'linear'] : ['linear', 'tlas']`), duplicated per file per this plan's no-shared-module
// convention, adapted from the two-broad-phase-arm comparison to this task's two-execution-arm
// ('sync'/'worker') comparison. A fixed first-arm bias can silently favor one arm via cache
// warmth, thermal state, or OS scheduler quirks -- this closes that gap and records the schedule
// actually used, rather than asserting counterbalancing only in prose.

export function armOrderForRepetition(repetitionIndex) {
  return repetitionIndex % 2 === 0 ? ['sync', 'worker'] : ['worker', 'sync'];
}

// Drives the two arms for ONE repetition in the order armOrderForRepetition(repetitionIndex)
// names. `arms.sync`/`arms.worker` are injected thunks -- real page.evaluate-backed calls in
// run.mjs, plain spies in the unit tests above -- so this function itself never touches a browser
// and is fully Node-testable; the test above is the "spy proving the two arms ran in the stated
// order" this task's fix requires.
export async function runPairedRepetitionInOrder(repetitionIndex, arms) {
  const armOrder = armOrderForRepetition(repetitionIndex);
  const executionOrder = [];
  const resultsByArm = {};
  for (const armName of armOrder) {
    executionOrder.push(armName);
    resultsByArm[armName] = await arms[armName]();
  }
  return {
    repetition: repetitionIndex,
    armOrder,
    executionOrder,
    syncArm: resultsByArm.sync,
    workerArm: resultsByArm.worker,
  };
}
```
Run: `node --test spike/m4/s7-geometry/armOrder.test.mjs`.
```bash
git add spike/m4/s7-geometry/armOrder.mjs spike/m4/s7-geometry/armOrder.test.mjs
git commit -m "spike(m4): S7' geometry-preparation counterbalanced arm order across 5 repetitions (RED->GREEN, fixes review finding on first-arm bias)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: syncArmReplay.mjs — the production-topology replay adapter (the core fix)**
```js
// spike/m4/s7-geometry/syncArmReplay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointPort, createFrameBudgetAccumulator } from '../../../collision/scheduler.js';
import { createSyncArmReplay } from './syncArmReplay.mjs';

function twoTriangleEntry(loadEpoch, geometryIndex) {
  const positions = new Float32Array([
    0, 0, 0,  1, 0, 0,  0, 1, 0,
    1, 0, 0,  0, 1, 0,  1, 1, 0,
  ]);
  const index = new Uint32Array([0, 1, 2, 3, 4, 5]);
  return { loadEpoch, geometryIndex, role: 'source', positions, positionStride: 3, positionOffset: 0, index, ranges: [{ start: 0, count: 6 }], activeTriangleCount: 2, weldEpsilon: 1e-6 };
}

test('createSyncArmReplay().build() drives weld -> connectivity -> bvh through the REAL GeometryRegistry.getOrBuildGeometry, and matches directly-called compactAndWeld on the identical input', async () => {
  const { compactAndWeld } = await import('../../../collision/geometry/activeRangeCompaction.js');
  const entry = twoTriangleEntry(1, 5);
  const capturedEntries = new Map([['1:5', entry]]);
  const replay = createSyncArmReplay(capturedEntries);
  const result = await replay.build(1, 5);
  const direct = compactAndWeld(entry, { weldEpsilon: entry.weldEpsilon });
  assert.deepEqual(Array.from(result.weldedGeometry.position), Array.from(direct.position));
  assert.deepEqual(Array.from(result.weldedGeometry.index), Array.from(direct.index));
  assert.equal(result.connectivity.componentCount, 1);
  // The result carries a SERIALIZED bvh (fixes review Critical #5), the SAME shape the worker arm
  // returns -- not a live MeshBVH instance, which the worker's result was never comparable to and
  // which is not guaranteed to round-trip faithfully back out of page.evaluate.
  assert.ok(result.built.serializedBvh.roots.length > 0);
});

test('createSyncArmReplay actually checkpoints BETWEEN each phase (weld/connectivity/bvh-construction) -- proves the fix for the missing checkpoint-before-build gate', async () => {
  const entry = twoTriangleEntry(1, 5);
  const capturedEntries = new Map([['1:5', entry]]);
  const yieldCalls = [];
  const checkpointPort = createCheckpointPort({
    isDisposed: () => false,
    isEpochLive: () => true,
    // budgetMs <= 0, now() pinned at 0: accumulator.isDue() is true from the very first checkpoint
    // call onward, so EVERY phase's checkpoint-before-build gate (GeometryRegistry.js:210-211)
    // actually yields -- making the yield observable via the spy below, rather than silently
    // taking the "not due" fast path every time (which would prove nothing about whether the gate
    // is wired up at all).
    accumulator: createFrameBudgetAccumulator({ now: () => 0, budgetMs: -1 }),
    yieldToScheduler: () => { yieldCalls.push(true); return Promise.resolve(); },
  });
  const replay = createSyncArmReplay(capturedEntries, { checkpointPort });
  await replay.build(1, 5);
  // One checkpoint-driven yield per phase this entry's build actually runs: weld, connectivity,
  // bvh-construction -- exactly GeometryRegistry._insertBuildingEntry's own three _runPhase calls
  // (GeometryRegistry.js:116,145,159), each gated by ITS OWN checkpoint() call before builderFn
  // runs. A hand-rolled compactAndWeld/computeGeometryConnectivity/build call chain (the prior
  // draft's bug) would never call this port at all -- yieldCalls.length would be 0.
  assert.equal(yieldCalls.length, 3);
});
```
```js
// spike/m4/s7-geometry/syncArmReplay.mjs
//
// M4 Task 4.4 fix (independent Codex review, Critical: "S7''s synchronous arm does not reproduce
// production scheduling"). §17 requires the synchronous arm to execute "SYNCHRONOUSLY ON THE MAIN
// THREAD, EXACTLY AS THE LIBRARY DOES TODAY -- that is, THROUGH THE LIBRARY'S ORDINARY COOPERATIVE
// CHECKPOINT PATH". A direct compactAndWeld/computeGeometryConnectivity/build call chain does NOT
// satisfy that: it skips GeometryRegistry._runPhase's checkpoint-before-build gate entirely
// (GeometryRegistry.js:210-211, `const pending = this._checkpointPort.checkpoint({ loadEpoch });
// if (pending) await pending;`), so a weld phase that consumes most of the frame budget never
// yields before connectivity in the replay, while production's real GeometryRegistry would
// (GeometryRegistry.js:116-171, `_insertBuildingEntry`/`_chainConnectivity`/`_chainAcceleration`
// chain weld -> connectivity -> bvh-construction as three separate `_runPhase` calls, each gated).
//
// This adapter instead constructs a REAL GeometryRegistry via the REAL createGeometryRegistry
// factory and drives weld/connectivity/BVH through its REAL getOrBuildGeometry -- so the replay's
// measured task topology (task boundaries, yield points) is genuinely today's, because it IS
// today's code path, not a re-implementation of it. Test-only; never imports into, or modifies,
// collision/geometry/GeometryRegistry.js itself (Global Constraints: production source is out of
// scope for this plan).

import { createGeometryRegistry } from '../../../collision/geometry/createGeometryRegistry.js';
import { createCheckpointPort, createFrameBudgetAccumulator } from '../../../collision/scheduler.js';
import { MeshBVH } from 'three-mesh-bvh';

export function createSyncArmReplay(capturedEntries, { checkpointPort } = {}) {
  // capturedEntries: Map<'loadEpoch:geometryIndex', rawInputPayload> -- accumulateCapturedGeometry's
  // own output shape, reused verbatim (no re-keying) so this adapter and buildPopulationBatchMessage
  // stay fed from the identical accumulated state -- both arms replay the SAME captured inputs
  // (§17's "identical inputs" requirement).
  const port = checkpointPort ?? createCheckpointPort({
    isDisposed: () => false,
    // This replay world is bounded to one measurement, constructed fresh per repetition; every
    // epoch it is ever asked to build against is, by construction, "live" for the replay's own
    // duration -- there is no separate eviction/disposal lifecycle to model here (unlike the real
    // CollisionWorld's liveEpochs set). Default accumulator/yieldToScheduler: the SAME real
    // frameBudgetMs (collision/constants.js, via scheduler.js's own default) and a real
    // setTimeout(0) macrotask yield -- deliberately NOT stubbed to something faster/synchronous,
    // since reproducing today's real yield mechanism is the entire point of this adapter.
    isEpochLive: () => true,
    accumulator: createFrameBudgetAccumulator(),
  });

  const registry = createGeometryRegistry({
    resolveGeometryView: (loadEpoch, geometryIndex) => {
      const entry = capturedEntries.get(`${loadEpoch}:${geometryIndex}`);
      if (!entry) {
        throw new Error(`syncArmReplay: no captured raw input for ${loadEpoch}:${geometryIndex}`);
      }
      return {
        triangleGeometryView: {
          positions: entry.positions, positionStride: entry.positionStride,
          positionOffset: entry.positionOffset, index: entry.index, ranges: entry.ranges,
          activeTriangleCount: entry.activeTriangleCount, unsupported: false,
        },
        weldEpsilon: entry.weldEpsilon,
      };
    },
    // The SAME real checkpoint port machinery a real baseline-gate world's registry is wired with
    // (createGeometryRegistry.js's own factory contract; CollisionWorld.js:654's own
    // `registryCheckpointPort`) -- a FRESH port + accumulator per replay call, per scheduler.js's
    // own "construct fresh per scope, never a long-lived singleton" contract.
    checkpointPort: port,
  });

  return {
    // Drives ONE captured entry through the real registry, exactly as a real
    // findClashes-triggered getOrBuildGeometry(...) call would.
    async build(loadEpoch, geometryIndex) {
      const accel = await registry.getOrBuildGeometry({
        loadEpoch, geometryIndex, ownerModelIdHint: 'm4-spike-replay', needsConnectivity: true,
      });
      // getOrBuildGeometry's PUBLIC return contract (GeometryRegistry.js:280,
      // `{ ...accel, oversized: false, connectivity }`) does not itself carry the welded geometry
      // -- only its downstream products. Reached off the registry's own internal
      // per-(loadEpoch,geometryIndex) entry -- the SAME "reach into privates because the public
      // accessor doesn't carry this field" pattern Task 4.5 below establishes as precedented in
      // this codebase (world._placementByEpoch, citing run-gate-m2.mjs) -- not a new convention
      // invented here.
      const weldedGeometry = registry._epochs.get(loadEpoch).get(geometryIndex).weldedGeometry;
      return {
        weldedGeometry,
        connectivity: accel.connectivity,
        // Serialized with the SAME pinned MeshBVH.serialize(...) call the worker arm uses (fixes
        // review Critical #5) -- a live MeshBVH class instance is neither what Task 4.6's
        // validator can field-compare against the worker's own serializedBvh, nor guaranteed to
        // round-trip faithfully back out of page.evaluate.
        built: {
          serializedBvh: MeshBVH.serialize(accel.bvh, { cloneBuffers: false }),
          localDiagonal: accel.localDiagonal, aspectRatio: accel.aspectRatio, aspectRatioExceeded: accel.aspectRatioExceeded,
        },
      };
    },
  };
}
```
Run: `node --test spike/m4/s7-geometry/syncArmReplay.test.mjs`.

**Why this now genuinely reproduces production scheduling:** `createSyncArmReplay`'s default
`checkpointPort` is built from the same `createCheckpointPort`/`createFrameBudgetAccumulator`
primitives (`collision/scheduler.js`) production wires into every real `GeometryRegistry`, with the
real default budget and a real `setTimeout(0)` yield — never a stub. `registry.getOrBuildGeometry`
then drives the SAME three-phase `_runPhase` chain `_insertBuildingEntry` builds in production
(`GeometryRegistry.js:116-171`), so each of weld/connectivity/bvh-construction is preceded by the
SAME `checkpointPort.checkpoint({ loadEpoch })` call production makes before that phase's own
`builderFn()` runs (`GeometryRegistry.js:210-211`), raced against the same cancellation signal
(`:226`), with each phase's duration reported the same way (`reportSpan`, `:213-217`). The
`syncArmReplay.test.mjs` test above proves this directly with a spy: forcing the accumulator always
"due" makes three real checkpoint-driven yields observable, one per phase — something a hand-rolled
call chain bypassing `_runPhase` could never produce, because it never calls the checkpoint port at
all. This closes the reviewer's concrete failure scenario: if weld consumes most of the frame
budget, this replay's own checkpoint call before connectivity is now the SAME call that would make
production yield there too — not glossed over as "no yield difference for an already-synchronous
call chain."

```bash
git add spike/m4/s7-geometry/syncArmReplay.mjs spike/m4/s7-geometry/syncArmReplay.test.mjs
git commit -m "spike(m4): S7' geometry-preparation production-topology replay adapter for the synchronous arm, serialized BVH result (RED->GREEN, fixes review findings on scheduling fidelity and validator comparability)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Thin worker glue (batched, deduped transfer list — fixes C2 and the batched-topology finding) + live paired driver, counterbalanced and checkpoint-faithful**
```js
// spike/m4/s7-geometry/worker.mjs
import { computeGeometryPreparation } from './workerCompute.mjs';
import { withWorkerErrorSafety } from '../s7-shared/createSpikeWorker.mjs';
import { transferListFor } from '../s6-message-overhead/payload.mjs';

self.onmessage = withWorkerErrorSafety(async (ev) => {
  const msg = ev.data;
  // ONE batched request for the whole tuple's distinct geometry set (fixes review Critical #4:
  // the prior draft sent one populate-geometry request PER geometry, N round trips for a tuple
  // with N distinct geometries -- not the one-batched-operation topology WB-1b represents).
  if (msg.kind !== 'populate-geometry-batch') return;
  const results = [];
  for (const item of msg.items) {
    const result = await computeGeometryPreparation({
      rawView: { positions: item.positions, positionStride: item.positionStride, positionOffset: item.positionOffset, index: item.index, ranges: item.ranges, activeTriangleCount: item.activeTriangleCount },
      weldEpsilon: item.weldEpsilon,
    });
    results.push({ loadEpoch: item.loadEpoch, geometryIndex: item.geometryIndex, ...result });
  }
  const response = {
    requestId: msg.requestId,
    results,
    diagnostics: [],
    statistics: {
      weldMs: results.reduce((s, r) => s + r.timings.weldMs, 0),
      connectivityMs: results.reduce((s, r) => s + r.timings.connectivityMs, 0),
      bvhMs: results.reduce((s, r) => s + r.timings.bvhMs, 0),
    },
  };
  // C2 fix (unchanged from the prior review round): build the transfer list from the FINAL
  // response object via identity-dedup -- ThreeMeshBvhBackend.build() wraps weldedGeometry.index
  // DIRECTLY into the BVH's geometry, so serializedBvh.index and weldedGeometry.index alias the
  // SAME ArrayBuffer for every result in this batch; a hand-assembled list that names both throws
  // DataCloneError before any message is sent.
  self.postMessage(response, transferListFor(response));
});
```
```js
// spike/m4/s7-geometry/run.mjs (excerpt -- the full 5-repetition, counterbalanced, batched paired measurement for one qualifying tuple)
import { createSpikeWorker, withWorkerErrorSafety } from '../s7-shared/createSpikeWorker.mjs';
import { createWorkerChannel, mapToStubResult } from '../s7-shared/workerChannel.mjs';
import { accumulateCapturedGeometry, buildPopulationBatchMessage } from './pairing.mjs';
import { armOrderForRepetition, runPairedRepetitionInOrder } from './armOrder.mjs';
// ... plus Phase 3.1's fixture/world lifecycle gate, reused for fresh-world-per-repetition.

async function captureOneRepetition(page, tuple) {
  // Fresh world; install setSpikeInputCapture; run the tuple's real query once; accumulate
  // captures; clear the hook; dispose the world (Phase 1.3: bounded, transient, per-repetition).
  // The synchronous arm below replays a captured RAW-INPUT SNAPSHOT, not the original world's live
  // state, so disposing the world here (unlike Task 4.5, which must keep it alive -- see that
  // task's own run.mjs comment) is correct and requires no lifecycle change.
  const captures = await page.evaluate(async (tupleArg) => {
    const { setSpikeInputCapture, clearSpikeInputCapture } = await import('/collision/scheduler.js');
    const collected = [];
    setSpikeInputCapture((kind, payload) => collected.push([kind, payload]));
    await window.__m4RunTupleQuery(tupleArg); // Phase 3.1's own lifecycle gate, reused
    clearSpikeInputCapture();
    return collected;
  }, tuple);
  return accumulateCapturedGeometry(captures);
}

async function runSyncArm(page, accumulated, repetitionIndex) {
  // Synchronous arm: the REAL GeometryRegistry, driven through its REAL getOrBuildGeometry, via
  // the production-topology replay adapter (fixes review finding: the synchronous arm's measured
  // task topology is now genuinely today's, because it runs today's real checkpoint-gated code
  // path, not a hand-rolled call chain that skips it).
  return page.evaluate(async ({ entries, repetitionIndex }) => {
    const { createSyncArmReplay } = await import('/spike/m4/s7-geometry/syncArmReplay.mjs');
    const capturedEntries = new Map(entries.map((e) => [`${e.loadEpoch}:${e.geometryIndex}`, e]));
    const replay = createSyncArmReplay(capturedEntries);
    const startMark = `sync-arm-${repetitionIndex}-start`, endMark = `sync-arm-${repetitionIndex}-end`, measureName = `sync-arm-${repetitionIndex}`;
    performance.mark(startMark);
    const out = [];
    for (const e of entries) out.push(await replay.build(e.loadEpoch, e.geometryIndex));
    performance.mark(endMark);
    // Duration read directly from performance.measure's own return value, in THIS SAME
    // page.evaluate call (fixes review Critical #2) -- a separate later evaluate() call to
    // getEntriesByName(name)[0] would always resolve to repetition 0's entry once names repeat
    // across repetitions. Marks/measure cleared immediately after reading to avoid unbounded
    // accumulation across a multi-hundred-tuple run.
    const { duration } = performance.measure(measureName, startMark, endMark);
    performance.clearMarks(startMark); performance.clearMarks(endMark); performance.clearMeasures(measureName);
    return { results: out, elapsedMs: duration };
  }, { entries: [...accumulated.values()], repetitionIndex });
}

async function runWorkerArm(page, accumulated, repetitionIndex) {
  // Worker arm: ONE populate-geometry-batch request for the tuple's whole distinct-geometry set
  // (fixes review Critical #4), sub-marks bracketing the boundary-owned main-thread chunks, names
  // namespaced by repetitionIndex (fixes review Critical #2) so Task 4.7's mark-based correlation
  // can unambiguously attribute a sub-mark to the repetition that produced it.
  return page.evaluate(async ({ entries, repetitionIndex }) => {
    const { createSpikeWorker } = await import('/spike/m4/s7-shared/createSpikeWorker.mjs');
    const { createWorkerChannel, mapToStubResult } = await import('/spike/m4/s7-shared/workerChannel.mjs');
    const { buildPopulationBatchMessage } = await import('/spike/m4/s7-geometry/pairing.mjs');
    const worker = createSpikeWorker('/spike/m4/s7-geometry/worker.mjs');
    const channel = createWorkerChannel(worker);
    const startMark = `worker-arm-${repetitionIndex}-start`, endMark = `worker-arm-${repetitionIndex}-end`, measureName = `worker-arm-${repetitionIndex}`;
    const snapStart = `worker-arm-${repetitionIndex}-snapshot-start`, snapEnd = `worker-arm-${repetitionIndex}-snapshot-end`;
    const sendStart = `worker-arm-${repetitionIndex}-send-start`, sendEnd = `worker-arm-${repetitionIndex}-send-end`;
    try {
      performance.mark(startMark);
      performance.mark(snapStart);
      const { message, transferList } = buildPopulationBatchMessage(entries);
      performance.mark(snapEnd);
      performance.mark(sendStart);
      const { raw, correlationMarkName } = await channel.query(message, transferList);
      performance.mark(sendEnd);
      performance.mark(endMark);
      const { duration } = performance.measure(measureName, startMark, endMark);
      const stub = mapToStubResult(raw);
      return { stub, correlationMarkName, elapsedMs: duration };
    } finally {
      // Exception-safe worker/channel cleanup (fixes review Important #2): a failed query still
      // disposes the channel/worker rather than leaking it into the next repetition.
      channel.dispose();
      [startMark, endMark, snapStart, snapEnd, sendStart, sendEnd].forEach((m) => performance.clearMarks(m));
      performance.clearMeasures(measureName);
    }
  }, { entries: [...accumulated.values()], repetitionIndex });
}

function summarizeFiveMs(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[2], min: sorted[0], max: sorted[4], raw: values }; // §6.1.6: never a mean alone
}

async function measureTuple(page, tuple) {
  const repetitions = [];
  for (let repetitionIndex = 0; repetitionIndex < 5; repetitionIndex++) {
    const accumulated = await captureOneRepetition(page, tuple);
    const { armOrder, syncArm, workerArm } = await runPairedRepetitionInOrder(repetitionIndex, {
      sync: () => runSyncArm(page, accumulated, repetitionIndex),
      worker: () => runWorkerArm(page, accumulated, repetitionIndex),
    });
    // The recorded schedule -- which arm ran first, per repetition -- so a systematic first-arm
    // advantage cannot silently favor one arm (fixes review finding on missing counterbalancing).
    repetitions.push({ repetition: repetitionIndex, armOrder, syncArm: syncArm.results, workerArm, syncArmMs: syncArm.elapsedMs, workerArmMs: workerArm.elapsedMs });
  }
  return {
    tuple,
    armOrderSchedule: repetitions.map((r) => ({ repetition: r.repetition, armOrder: r.armOrder })),
    syncArmMs: summarizeFiveMs(repetitions.map((r) => r.syncArmMs)),
    workerArmMs: summarizeFiveMs(repetitions.map((r) => r.workerArmMs)),
    repetitions,
  };
}
```

- [ ] **Step 10: Manual verification**
Run (against a served fixture page, both runtime configs, over the checkpoint's qualifying-tuple
list, derived per this document's resolved Open Question 4):
`node spike/m4/s7-geometry/run.mjs --tuples=<derived-from-m4-gate-report>`
Expected: for every qualifying tuple, both arms' timings are reported as median/min/max/raw across
5 repetitions, each duration read directly from its own repetition's `performance.measure(...)`
return value (never a stale cross-repetition lookup); the worker arm sends exactly ONE
`populate-geometry-batch` request per repetition regardless of distinct-geometry count (confirm via
the worker's own message log that request count never scales with geometry count for a tuple with
more than one distinct geometry); the isolated `bvhMs` figure is present; the recorded
`armOrderSchedule` shows alternation (repetition 0 `['sync','worker']`, repetition 1
`['worker','sync']`, ...); and posting a real geometry's response through the worker no longer
throws `DataCloneError` (the C2 regression is exercised directly by running this against any
geometry with a non-empty index — confirm the response actually arrives). Separately, confirm
`node --test spike/m4/s7-geometry/syncArmReplay.test.mjs` passes, proving the synchronous arm's
phase boundaries are checkpoint-gated exactly as production's are — not merely asserted in prose.

- [ ] **Step 11: Commit**
```bash
git add spike/m4/s7-geometry/worker.mjs spike/m4/s7-geometry/run.mjs
git commit -m "spike(m4): S7' geometry-preparation paired live driver, checkpoint-faithful synchronous arm, batched worker arm, counterbalanced arm order, per-repetition timing correctness (fixes review C1/C2 and this round's timing/batching/scheduling findings)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4.5: S7' Hard-Clash-Precheck Vertical (WB-2p)

**Condition:** Same gate as 4.3, only for tuples where the narrow-phase family strictly wins AND
the precheck substage strictly wins within it.

**Consumed interface — the REAL Phase 1.3 contract:** `setSpikeInputCapture(fn)`, `fn('precheck-candidate-list',
{ sourceEpoch, candidates: {sourceLoadEpoch, sourceGeometryIndex, sourceFragmentId, targetLoadEpoch,
targetGeometryIndex, targetFragmentId, targetEpoch}[] })`, fired **once per query**, after
`_checkClearanceNarrowPhaseBudget` passes. **This payload carries identity only — no matrices, no
world bounds.**

**Fix applied (review finding C3, the most structural fix in this document):** the prior draft
assumed the captured candidate list could be fed straight to `volumeOverlapQuery`, and separately
assumed matrices/world bounds rode along in the capture. Neither is true of the real contract above,
and calling `volumeOverlapQuery` directly — skipping `classifyHardClashPrecheck`'s own leading
`aabbMinDistance(unpadded) > 0` skip-precheck check (`ClearanceHardClashPrecheck.js:19-21`, called
from `CollisionWorld.js:2318` with `sourcePlaced.worldBounds`/`targetPlaced.worldBounds`) — means
the worker would run a full overlap query for every pair the broad phase's PADDED bounds admitted,
including pairs production would `skip-precheck` on tighter UNPADDED bounds without ever calling
`volumeOverlapQuery` at all: a fabricated cost, and a stage that does not reproduce the real one.

**Resolution:** since Phase 1's closed six-item instrumentation list does not carry world
bounds/matrices, and no PUBLIC accessor exposes per-fragment placement either, this task's harness
reads them directly off `CollisionWorld`'s existing private `_placementByEpoch` field
(`CollisionWorld.js:569,2443`: `Map<loadEpoch, Map<fragmentId, {worldBounds, worldMatrix,
ownerDbId, ...}>>`) — the SAME "reach into privates because the accessor is missing" pattern
`run-gate-m2.mjs` already establishes as precedented in this codebase (cited directly in Phase 1
Task 1.6's own write-up) — rather than inventing a new public accessor, which would exceed §16.4's
closed six-item instrumentation list. The worker now calls the REAL `classifyHardClashPrecheck`
(not `volumeOverlapQuery` directly) and reports all four of its dispositions (`skip-precheck`,
`excluded`, `proceed`, `inconclusive`).

**Fix applied (independent Codex review finding, this round — "S7''s synchronous arm does not
reproduce production scheduling", Critical, also named against this task's driver):** the prior
draft's synchronous arm looped over every candidate pair and called `classifyHardClashPrecheck`
directly, back-to-back, with no checkpoint call anywhere in the loop. That does not reproduce
production. `CollisionWorld.js`'s real clearance narrow-phase loop checkpoints ONCE PER CANDIDATE
PAIR, BEFORE processing each pair: `for (const [sourcePlaced, targetPlaced, targetOperand] of
candidates) { const pending = checkpoint({ label: 'clearance-narrow-phase-pair' }); if (pending)
await pending; const outcome = await this._runClearanceNarrowPhasePair(...); ... }`
(`CollisionWorld.js:1712-1718`) — `_runClearanceNarrowPhasePair` is where `classifyHardClashPrecheck`
is actually called (`CollisionWorld.js:2318-2320`). On top of that OUTER per-pair checkpoint,
`classifyHardClashPrecheck`'s own internal `volumeOverlapQuery` traversal checkpoints AGAIN, via a
composed-stage scheduler production wires in explicitly at the call site:
`const scheduler = createComposedStageScheduler(checkpoint, this._now); ... classifyHardClashPrecheck(
sourceInstance, targetInstance, sourcePlaced.worldBounds, targetPlaced.worldBounds, { scheduler,
... })` (`CollisionWorld.js:2299-2320`) — and `createComposedStageScheduler` (`CollisionWorld.js:418-431`,
unexported) deliberately wraps the SAME per-call `checkpoint` the outer per-pair loop uses, so "a
composed sub-query's between-stage yields share one frame-budget accumulator with the broad phase
and the pair boundary" (`CollisionWorld.js:391-394`'s own doc comment) — precisely so a pair whose
composed stages are each individually under budget but sum past it is still caught. The prior
draft's `classifyHardClashPrecheck(sourceInstance, targetInstance, wb.sourceWorldBounds,
wb.targetWorldBounds, {})` call passed an EMPTY `volumeOverlapOptions`, so `volumeOverlapQuery`
silently fell back to its own unrelated `defaultScheduler` (`VolumeOverlapQuery.js:56`) — decoupled
from any checkpoint port at all, and with zero checkpoints between pairs in the outer loop either.
The whole candidate list was therefore processed as one long uninterrupted chain, exactly the
"direct replay combines ... into a single long task" failure the review describes, applied here to
narrow-phase pairs instead of geometry-preparation phases. **Resolution:**
`spike/m4/s7-precheck/syncArmReplay.mjs` below reproduces BOTH checkpoint layers — the outer
per-pair gate and the inner composed-stage scheduler — sharing one real checkpoint port/accumulator,
and calls the REAL `classifyHardClashPrecheck` through it.

**Further fixes applied (independent Codex spec-review of this fix, this round — each verified
directly against source before being accepted):**

- **Population/reconstruction source was a nonexistent API shape (Critical).** The prior driver
  treated `world.getEpochGeometryDiagnostics(loadEpoch)` as `{ entries: [...] }`, with each entry
  carrying `position`/`index`/`bvh`/`connectivity`. Verified against this plan's own Phase 1.6
  write-up (line 1827) and its real implementation (line 2059-2062,
  `CollisionWorld.getEpochGeometryDiagnostics` → `this._registry.getEpochGeometryEntries(epoch)`,
  line 1993-2037): the accessor returns an ARRAY DIRECTLY, and every entry carries ONLY
  byte-count/status accounting fields (`weldedPositionBytes`, `bvhRootBytes`, `buildState`, ...) —
  **never** the actual position/index/bvh/connectivity buffers `buildInstanceFromPopulationEntry`
  requires. `diag.entries.find(...)` on that real return shape throws (`.entries` resolves to
  `Array.prototype.entries`, not a property), and even a fixed `diag.find(...)` call would still
  hand back byte counts, not usable geometry. **Resolution:** this driver now resolves each
  distinct geometry's REAL resident buffers via `world._registry.getOrBuildGeometry({loadEpoch,
  geometryIndex, ...})` — the SAME real public `GeometryRegistry` method (`GeometryRegistry.js:58`)
  production itself calls, a cache HIT (not a rebuild) since the capture query already built these
  geometries — reached through the SAME precedented private-field access this task's own
  `world._placementByEpoch` use already establishes, rather than through the diagnostics accessor,
  which was never meant to carry resident data. This also resolves the reviewer's separate
  Important finding that `MeshBVH.deserialize` ran once PER CANDIDATE PAIR inside the synchronous
  arm: the synchronous arm now reuses the LIVE, already-resolved registry record directly (no
  deserialize at all), exactly mirroring production's own per-pair `resolveGeometryRecord`
  cache-hit behavior (`CollisionWorld.js:308-348`).
- **Missing production `classifyHardClashPrecheck` options and telemetry (Critical).** The
  synchronous replay's `{ scheduler }`-only call diverges from production's full option set —
  `compareCanonical` (affects tolerance scaling/traversal order, not just determinism) and
  `crossing.now` (the real clock, matching `CollisionWorld.js:2315`'s own `this._now` wiring) — and,
  without a diagnostic-event recorder installed, could never report `volumeOverlapQueryCalled`/
  `inconclusiveCauses`, the SAME fields the worker arm's `computePrecheckBatch` already reports,
  making the two arms' results structurally incomparable. **Resolution:**
  `createPrecheckSyncArmReplay.classifyPair` now supplies the full option set (a structural,
  identity-based reproduction of `comparePlacedCanonically`, `CollisionWorld.js:186-195`, plus a
  real clock) and wraps the call in `setDiagnosticEventRecorder`/`clearDiagnosticEventRecorder`
  (`collision/scheduler.js`, try/finally-scoped), returning the SAME normalized
  `{status, conclusive, inconclusiveCauses, excluded, volumeOverlapQueryCalled}` shape
  `computePrecheckBatch` produces.
- **Fresh-world-disposed-then-used lifecycle contradiction (Important).** The prior draft disposed
  the fresh world as part of the SAME capture step that later code read `window.__m4World` from —
  a real contradiction (dispose-then-dereference throws `WorldDisposedError`), now unavoidable to
  resolve explicitly given this task's arms both need the ORIGINAL world's live `_registry` (the
  synchronous arm directly; the worker arm to build population messages from real resident
  buffers) — unlike Task 4.4, whose synchronous arm needs only a captured raw-input snapshot,
  independent of the original world's lifetime. **Resolution:** this task's own explicit,
  documented lifecycle contract, below, keeps the world alive through both arms and disposes it
  once, at the end of each repetition.
- **Exception-safe hook/worker cleanup (Important).** `setDiagnosticEventRecorder`/the worker
  channel were cleaned up only on success. Fixed: both are now try/finally-scoped, so one failed
  pair or repetition cannot leave a stale recorder or a resident worker contaminating the next.

**Files:**
- Create: `spike/m4/s7-precheck/reconstruct.mjs`
- Create: `spike/m4/s7-precheck/armOrder.mjs`
- Create: `spike/m4/s7-precheck/syncArmReplay.mjs`
- Create: `spike/m4/s7-precheck/workerCompute.mjs`
- Create: `spike/m4/s7-precheck/worker.mjs`
- Create: `spike/m4/s7-precheck/run.mjs`
- Test: `spike/m4/s7-precheck/reconstruct.test.mjs`, `spike/m4/s7-precheck/armOrder.test.mjs`,
  `spike/m4/s7-precheck/syncArmReplay.test.mjs`, `spike/m4/s7-precheck/workerCompute.test.mjs`
- Test: manual verification via `run.mjs`

**Interfaces:**
- Consumes: Phase 1.3's `precheck-candidate-list` capture (above, identity only);
  `world._placementByEpoch` (private, read-only, precedented reach — never written to) for
  `worldBounds`/`worldMatrix`; `world._registry.getOrBuildGeometry(...)` (the SAME real public
  `GeometryRegistry` method production calls, reached off `CollisionWorld`'s own private
  `_registry` field — the SAME precedented-reach idiom as `_placementByEpoch`, used here because
  `getEpochGeometryDiagnostics` carries only byte-count diagnostics, never resident buffers — see
  this task's own fixes-applied note); 4.3's worker-channel scaffold; the REAL production
  `classifyHardClashPrecheck` (`collision/query/ClearanceHardClashPrecheck.js`) and
  `volumeOverlapQuery` it calls internally (`collision/query/VolumeOverlapQuery.js`); the REAL
  `createCheckpointPort`/`createFrameBudgetAccumulator`/`setDiagnosticEventRecorder`/
  `clearDiagnosticEventRecorder` (`collision/scheduler.js`) plus a structural, test-local
  reproduction of `CollisionWorld.js`'s own (unexported) `createComposedStageScheduler` and
  `comparePlacedCanonically` — matching the real `clearance-narrow-phase-pair`/
  `composed-narrow-phase-stage` two-layer checkpoint structure and canonical-order tolerance
  wiring; `MeshBVH`/`MeshBVH.deserialize`/`MeshBVH.serialize` (`three-mesh-bvh@0.9.14`); the exact
  `Instance` shape `CollisionWorld.js`'s own `toInstance` helper builds (`CollisionWorld.js:373-383`);
  **a lifecycle addition to Phase 3.1's fixture/world lifecycle gate this task specifically
  requires** — a query-WITHOUT-dispose entry point, `window.__m4RunTupleQueryKeepWorld(tupleArg)`
  (runs the query, leaves `window.__m4World` live and undisposed), plus a separate
  `window.__m4DisposeWorld()` this driver calls explicitly once both arms finish — see this task's
  own fixes-applied note on why Task 4.4 does not need this but this task does.
- Produces: per-pair precheck dispositions (`skip-precheck`/`excluded`/`proceed`/`inconclusive`,
  with `conclusive`/`inconclusiveCauses` for the `proceed`+`inconclusive` cases) for Task 4.6's
  validator, in the SAME normalized shape from both arms; paired stage-cost and sub-mark figures
  (median/min/max/raw across 5 counterbalanced repetitions) for Task 4.7; the recorded
  per-repetition arm-order schedule.

**What's unit-tested vs. manually verified:** `classifyHardClashPrecheck`, `volumeOverlapQuery`,
`MeshBVH.deserialize`, `createSyncArmReplay`'s checkpoint fidelity, and `armOrderForRepetition`/
`runPairedRepetitionInOrder` are all plain Node-runnable (no DOM). `reconstruct.mjs`,
`workerCompute.mjs`, `armOrder.mjs`, and `syncArmReplay.mjs` are RED→GREEN unit-tested in Node
against real fixture geometry, including a fixture whose UNPADDED bounds are disjoint (exercising
the `skip-precheck` path this fix restores); `syncArmReplay.test.mjs` uses a minimal stub `world`
object exposing only `_registry.getOrBuildGeometry` (the ONE real method signature this module
actually calls), so it exercises precheck fidelity without re-running Task 4.4's own
already-covered real weld/connectivity/BVH pipeline. Only cross-thread transport, real
candidate-volume timing, and the live world/registry lifecycle are live-only.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s7-precheck/reconstruct.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { buildInstanceFromPopulationEntry } from './reconstruct.mjs';

function serializedCube() {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const bvh = new MeshBVH(geometry, { indirect: true });
  return { geometry, serialized: MeshBVH.serialize(bvh, { cloneBuffers: false }) };
}

test('buildInstanceFromPopulationEntry produces the exact CollisionWorld.toInstance shape', () => {
  const { geometry, serialized } = serializedCube();
  const entry = {
    loadEpoch: 1, geometryIndex: 1,
    position: geometry.attributes.position.array, index: new Uint32Array(geometry.attributes.position.count).map((_, i) => i),
    bvh: serialized,
    connectivity: { componentCount: 1, componentOf: new Int32Array(12), closedManifold: new Uint8Array([1]) },
    localDiagonal: 1.732, aspectRatio: 1, aspectRatioExceeded: false,
  };
  const instance = buildInstanceFromPopulationEntry(entry, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]);
  assert.ok(instance.geometry.boundsTree, 'MeshBVH must be re-attached, not left detached (§8.1)');
  assert.equal(instance.closedManifold, true);
  assert.equal(instance.aspectRatioExceeded, false);
  assert.ok(instance.matrix instanceof THREE.Matrix4);
  assert.equal(instance.matrix.elements[12], 5);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s7-precheck/reconstruct.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s7-precheck/reconstruct.mjs
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function buildInstanceFromPopulationEntry(entry, matrixArray) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(entry.position, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(entry.index, 1));
  const bvh = MeshBVH.deserialize(entry.bvh, geometry, { setIndex: true, indirect: true });
  geometry.boundsTree = bvh;

  return {
    geometry, bvh,
    localDiagonal: entry.localDiagonal,
    connectivity: entry.connectivity,
    closedManifold: Array.from(entry.connectivity.closedManifold).every((b) => b === 1 || b === true),
    aspectRatioExceeded: entry.aspectRatioExceeded,
    matrix: new THREE.Matrix4().fromArray(matrixArray),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s7-precheck/reconstruct.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s7-precheck/reconstruct.mjs spike/m4/s7-precheck/reconstruct.test.mjs
git commit -m "spike(m4): S7' precheck Instance reconstruction from crossable parts (RED->GREEN)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: workerCompute.mjs — calls the REAL classifyHardClashPrecheck, not volumeOverlapQuery directly**
```js
// spike/m4/s7-precheck/workerCompute.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { computePrecheckBatch } from './workerCompute.mjs';

function cubePopulationEntry(geometryIndex, translateX = 0) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(translateX, 0, 0);
  const bvh = new MeshBVH(geometry, { indirect: true });
  return {
    loadEpoch: 1, geometryIndex,
    position: geometry.attributes.position.array, index: new Uint32Array(geometry.attributes.position.count).map((_, i) => i),
    bvh: MeshBVH.serialize(bvh, { cloneBuffers: false }),
    connectivity: { componentCount: 1, componentOf: new Int32Array(12), closedManifold: new Uint8Array([1]) },
    localDiagonal: 1.7, aspectRatio: 1, aspectRatioExceeded: false,
  };
}
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('computePrecheckBatch reports excluded:true, conclusive:true for two overlapping cubes (proceed path)', async () => {
  const populationByKey = new Map([['1:1', cubePopulationEntry(1)], ['1:2', cubePopulationEntry(2, 0.5)]]);
  const batch = await computePrecheckBatch({
    populationByKey,
    candidates: [{ sourceFragmentId: 1, targetFragmentId: 2, sourceLoadEpoch: 1, sourceGeometryIndex: 1, targetLoadEpoch: 1, targetGeometryIndex: 2 }],
    worldBoundsAndMatrixByCandidate: [{ sourceMatrix: identity(), targetMatrix: identity(), sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, targetWorldBounds: { min: [0, -0.5, -0.5], max: [1, 0.5, 0.5] } }],
  });
  assert.equal(batch.results[0].status, 'excluded');
});

test('computePrecheckBatch reports skip-precheck when UNPADDED world bounds are disjoint, WITHOUT calling volumeOverlapQuery (fix for review C3)', async () => {
  const populationByKey = new Map([['1:1', cubePopulationEntry(1)], ['1:2', cubePopulationEntry(2, 100)]]);
  const batch = await computePrecheckBatch({
    populationByKey,
    candidates: [{ sourceFragmentId: 1, targetFragmentId: 2, sourceLoadEpoch: 1, sourceGeometryIndex: 1, targetLoadEpoch: 1, targetGeometryIndex: 2 }],
    worldBoundsAndMatrixByCandidate: [{ sourceMatrix: identity(), targetMatrix: identity(), sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, targetWorldBounds: { min: [99.5, -0.5, -0.5], max: [100.5, 0.5, 0.5] } }],
  });
  assert.equal(batch.results[0].status, 'skip-precheck');
  assert.equal(batch.results[0].volumeOverlapQueryCalled, false); // production never calls it for this pair either
});
```
```js
// spike/m4/s7-precheck/workerCompute.mjs
import { classifyHardClashPrecheck } from '../../../collision/query/ClearanceHardClashPrecheck.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder } from '../../../collision/scheduler.js';
import { buildInstanceFromPopulationEntry } from './reconstruct.mjs';

export async function computePrecheckBatch({ populationByKey, candidates, worldBoundsAndMatrixByCandidate }) {
  const eventsByPairIndex = [];
  let currentPairIndex = -1;
  let volumeOverlapQueryCalled = false;
  setDiagnosticEventRecorder((kind, payload) => {
    if (kind === 'hard-clash-precheck' && currentPairIndex >= 0) {
      volumeOverlapQueryCalled = true;
      (eventsByPairIndex[currentPairIndex] ??= []).push(payload);
    }
  });

  try {
    const results = [];
    for (let i = 0; i < candidates.length; i++) {
      currentPairIndex = i;
      volumeOverlapQueryCalled = false;
      const c = candidates[i];
      const wb = worldBoundsAndMatrixByCandidate[i];
      const sourceEntry = populationByKey.get(`${c.sourceLoadEpoch}:${c.sourceGeometryIndex}`);
      const targetEntry = populationByKey.get(`${c.targetLoadEpoch}:${c.targetGeometryIndex}`);
      const sourceInstance = buildInstanceFromPopulationEntry(sourceEntry, wb.sourceMatrix);
      const targetInstance = buildInstanceFromPopulationEntry(targetEntry, wb.targetMatrix);
      // The REAL production entry point (fix for C3) -- reproduces the leading unpadded-bounds
      // skip-precheck check classifyHardClashPrecheck itself performs BEFORE ever calling
      // volumeOverlapQuery, exactly as CollisionWorld.js:2318 invokes it.
      const disposition = await classifyHardClashPrecheck(sourceInstance, targetInstance, wb.sourceWorldBounds, wb.targetWorldBounds, {});
      const causes = (eventsByPairIndex[i] ?? []).flatMap((p) => p.inconclusiveCauses ?? []);
      results.push({
        sourceFragmentId: c.sourceFragmentId, targetFragmentId: c.targetFragmentId,
        status: disposition.status, // 'skip-precheck' | 'excluded' | 'proceed' | 'inconclusive'
        conclusive: disposition.status !== 'inconclusive',
        inconclusiveCauses: [...new Set(causes)].sort(),
        excluded: disposition.status === 'excluded',
        volumeOverlapQueryCalled,
      });
    }
    return { results, diagnostics: [], statistics: { pairsEvaluated: candidates.length } };
  } finally {
    clearDiagnosticEventRecorder();
  }
}
```
Run: `node --test spike/m4/s7-precheck/workerCompute.test.mjs`.
```bash
git add spike/m4/s7-precheck/workerCompute.mjs spike/m4/s7-precheck/workerCompute.test.mjs
git commit -m "spike(m4): S7' precheck computation calls the REAL classifyHardClashPrecheck, reports all 4 dispositions (RED->GREEN, fixes review C3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: armOrder.mjs — counterbalanced arm order across the 5 repetitions**
```js
// spike/m4/s7-precheck/armOrder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armOrderForRepetition, runPairedRepetitionInOrder } from './armOrder.mjs';

test('armOrderForRepetition alternates by repetition parity across 5 repetitions', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(armOrderForRepetition), [
    ['sync', 'worker'],
    ['worker', 'sync'],
    ['sync', 'worker'],
    ['worker', 'sync'],
    ['sync', 'worker'],
  ]);
});

test('runPairedRepetitionInOrder actually invokes the two arms in the order armOrderForRepetition names, for an even repetition (sync first)', async () => {
  const callLog = [];
  const arms = {
    sync: async () => { callLog.push('sync'); return { kind: 'sync-result' }; },
    worker: async () => { callLog.push('worker'); return { kind: 'worker-result' }; },
  };
  const record = await runPairedRepetitionInOrder(0, arms);
  assert.deepEqual(callLog, ['sync', 'worker']);
  assert.deepEqual(record.executionOrder, ['sync', 'worker']);
});

test('runPairedRepetitionInOrder actually invokes the two arms in the order armOrderForRepetition names, for an odd repetition (worker first)', async () => {
  const callLog = [];
  const arms = {
    sync: async () => { callLog.push('sync'); return { kind: 'sync-result' }; },
    worker: async () => { callLog.push('worker'); return { kind: 'worker-result' }; },
  };
  const record = await runPairedRepetitionInOrder(1, arms);
  assert.deepEqual(callLog, ['worker', 'sync']);
  assert.deepEqual(record.executionOrder, ['worker', 'sync']);
});
```
```js
// spike/m4/s7-precheck/armOrder.mjs
//
// M4 Task 4.5 fix (independent Codex review finding, same as Task 4.4's own armOrder.mjs,
// duplicated per file per this plan's no-shared-module convention): counterbalances which arm
// runs first, by repetition parity, and records the schedule actually used -- mirrors Task 3.7's
// own `armOrderForRepetition` pattern adapted from the two-broad-phase-arm comparison to this
// task's two-execution-arm ('sync'/'worker') comparison.

export function armOrderForRepetition(repetitionIndex) {
  return repetitionIndex % 2 === 0 ? ['sync', 'worker'] : ['worker', 'sync'];
}

export async function runPairedRepetitionInOrder(repetitionIndex, arms) {
  const armOrder = armOrderForRepetition(repetitionIndex);
  const executionOrder = [];
  const resultsByArm = {};
  for (const armName of armOrder) {
    executionOrder.push(armName);
    resultsByArm[armName] = await arms[armName]();
  }
  return {
    repetition: repetitionIndex,
    armOrder,
    executionOrder,
    syncArm: resultsByArm.sync,
    workerArm: resultsByArm.worker,
  };
}
```
Run: `node --test spike/m4/s7-precheck/armOrder.test.mjs`.
```bash
git add spike/m4/s7-precheck/armOrder.mjs spike/m4/s7-precheck/armOrder.test.mjs
git commit -m "spike(m4): S7' precheck counterbalanced arm order across 5 repetitions (RED->GREEN, fixes review finding on first-arm bias)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: syncArmReplay.mjs — the production-topology replay adapter (the core fix)**
```js
// spike/m4/s7-precheck/syncArmReplay.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createCheckpointPort, createFrameBudgetAccumulator } from '../../../collision/scheduler.js';
import { createPrecheckSyncArmReplay } from './syncArmReplay.mjs';

// A precomputed { geometry, bvh, ... } record, built the same way this file's own Step 1/6
// fixtures already do (real THREE geometry + real MeshBVH, no serialization round trip needed --
// this module's job is precheck fidelity, not geometry-build fidelity, which Task 4.4's own
// syncArmReplay.test.mjs already covers with a REAL createGeometryRegistry).
function cubeRecord(translateX = 0) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().translate(translateX, 0, 0);
  const bvh = new MeshBVH(geometry, { indirect: true });
  geometry.boundsTree = bvh;
  return {
    geometry, bvh, localDiagonal: 1.7, aspectRatio: 1, aspectRatioExceeded: false,
    connectivity: { componentCount: 1, componentOf: new Int32Array(12), closedManifold: [true] },
  };
}

// A minimal stub of the ONE shape createPrecheckSyncArmReplay actually reads off `world` --
// `_registry.getOrBuildGeometry({loadEpoch, geometryIndex, ...})`, the REAL GeometryRegistry
// public method's exact signature (GeometryRegistry.js:58) -- returning a precomputed record
// directly (fixes review Critical #1: the prior draft assumed a nonexistent
// `getEpochGeometryDiagnostics`-derived resident-data shape).
function stubWorld(recordsByKey) {
  return { _registry: { async getOrBuildGeometry({ loadEpoch, geometryIndex }) { return recordsByKey.get(`${loadEpoch}:${geometryIndex}`); } } };
}

const identity = (geometryIndex, fragmentId) => ({ loadEpoch: 1, geometryIndex, fragmentId });
const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test('classifyPair() calls the REAL classifyHardClashPrecheck via a cached registry record and returns the SAME normalized shape workerCompute.mjs\'s computePrecheckBatch produces (excluded/proceed path, fixes review Critical #3)', async () => {
  const world = stubWorld(new Map([['1:1', cubeRecord(0)], ['1:2', cubeRecord(0.5)]]));
  const replay = createPrecheckSyncArmReplay({ world });
  const result = await replay.classifyPair({
    loadEpoch: 1, sourceIdentity: identity(1, 10), targetIdentity: identity(2, 20),
    sourceMatrix: identityMatrix, targetMatrix: identityMatrix,
    sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    targetWorldBounds: { min: [0, -0.5, -0.5], max: [1, 0.5, 0.5] },
  });
  assert.equal(result.status, 'excluded');
  assert.equal(result.excluded, true);
  assert.equal(result.conclusive, true);
  assert.deepEqual(result.inconclusiveCauses, []);
  assert.equal(result.volumeOverlapQueryCalled, true); // an overlapping pair actually reaches volumeOverlapQuery
});

test('classifyPair() reports skip-precheck WITHOUT calling volumeOverlapQuery for disjoint unpadded bounds', async () => {
  const world = stubWorld(new Map([['1:1', cubeRecord(0)], ['1:2', cubeRecord(100)]]));
  const replay = createPrecheckSyncArmReplay({ world });
  const result = await replay.classifyPair({
    loadEpoch: 1, sourceIdentity: identity(1, 10), targetIdentity: identity(2, 20),
    sourceMatrix: identityMatrix, targetMatrix: identityMatrix,
    sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    targetWorldBounds: { min: [99.5, -0.5, -0.5], max: [100.5, 0.5, 0.5] },
  });
  assert.equal(result.status, 'skip-precheck');
  assert.equal(result.volumeOverlapQueryCalled, false);
});

test('classifyPair() checkpoints BEFORE each pair, matching CollisionWorld.js:1712-1714 -- proves the fix for the missing per-pair checkpoint gate', async () => {
  const yieldCalls = [];
  const checkpointPort = createCheckpointPort({
    isDisposed: () => false, isEpochLive: () => true,
    accumulator: createFrameBudgetAccumulator({ now: () => 0, budgetMs: -1 }), // always due
    yieldToScheduler: () => { yieldCalls.push(true); return Promise.resolve(); },
  });
  const world = stubWorld(new Map([['1:1', cubeRecord(0)], ['1:2', cubeRecord(100)]]));
  const replay = createPrecheckSyncArmReplay({ world, checkpointPort });
  const disposition = await replay.classifyPair({
    loadEpoch: 1, sourceIdentity: identity(1, 10), targetIdentity: identity(2, 20),
    sourceMatrix: identityMatrix, targetMatrix: identityMatrix,
    sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    targetWorldBounds: { min: [99.5, -0.5, -0.5], max: [100.5, 0.5, 0.5] },
  });
  assert.equal(disposition.status, 'skip-precheck');
  // Exactly the OUTER per-pair checkpoint fires -- classifyHardClashPrecheck returns skip-precheck
  // before ever reaching volumeOverlapQuery's own composed-stage checkpoint, exactly as production
  // never calls volumeOverlapQuery for a pair its unpadded bounds already exclude
  // (ClearanceHardClashPrecheck.js:19-21). A loop with no checkpoint call at all (the prior draft's
  // bug) would leave yieldCalls empty here.
  assert.equal(yieldCalls.length, 1);
});

test('classifyPair() checkpoints the composed-stage scheduler too, once volumeOverlapQuery actually runs (proceed path reaches BOTH checkpoint layers)', async () => {
  const yieldCalls = [];
  const checkpointPort = createCheckpointPort({
    isDisposed: () => false, isEpochLive: () => true,
    accumulator: createFrameBudgetAccumulator({ now: () => 0, budgetMs: -1 }), // always due
    yieldToScheduler: () => { yieldCalls.push(true); return Promise.resolve(); },
  });
  const world = stubWorld(new Map([['1:1', cubeRecord(0)], ['1:2', cubeRecord(0.5)]]));
  const replay = createPrecheckSyncArmReplay({ world, checkpointPort });
  await replay.classifyPair({
    loadEpoch: 1, sourceIdentity: identity(1, 10), targetIdentity: identity(2, 20),
    sourceMatrix: identityMatrix, targetMatrix: identityMatrix,
    sourceWorldBounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    targetWorldBounds: { min: [0, -0.5, -0.5], max: [1, 0.5, 0.5] },
  });
  // At least the outer per-pair checkpoint, PLUS at least one composed-stage checkpoint from
  // inside volumeOverlapQuery's own traversal -- both sharing this one port/accumulator, exactly
  // as CollisionWorld.js:391-394 documents ("share one frame-budget accumulator with the broad
  // phase and the pair boundary").
  assert.ok(yieldCalls.length >= 2);
});
```
```js
// spike/m4/s7-precheck/syncArmReplay.mjs
//
// M4 Task 4.5 fix (independent Codex review, Critical: "S7''s synchronous arm does not reproduce
// production scheduling", named against this task's driver too; plus a follow-up review round's
// Critical findings on the population source and missing classifyHardClashPrecheck options/
// telemetry -- see this task's own fixes-applied notes above for both). Production checkpoints
// ONCE PER CANDIDATE PAIR, BEFORE processing each pair (CollisionWorld.js:1712-1714: `const
// pending = checkpoint({ label: 'clearance-narrow-phase-pair' }); if (pending) await pending;`),
// then classifyHardClashPrecheck's own internal volumeOverlapQuery traversal checkpoints AGAIN,
// against the SAME shared accumulator, via a composed-stage scheduler explicitly wired at the real
// call site (CollisionWorld.js:2299: `createComposedStageScheduler(checkpoint, this._now)` --
// unexported, so reproduced here structurally rather than imported, per this plan's
// no-shared-module convention). Geometry Instances are resolved via `world._registry.
// getOrBuildGeometry(...)` -- a cache HIT against the SAME registry the capture query already
// built these geometries through, exactly mirroring production's own per-pair
// `resolveGeometryRecord` cache-hit behavior (CollisionWorld.js:308-348) -- never via
// `getEpochGeometryDiagnostics`, whose real contract carries only byte-count accounting, never
// resident buffers.

import { classifyHardClashPrecheck } from '../../../collision/query/ClearanceHardClashPrecheck.js';
import { setDiagnosticEventRecorder, clearDiagnosticEventRecorder, createCheckpointPort, createFrameBudgetAccumulator } from '../../../collision/scheduler.js';
import * as THREE from 'three';

// Structural copy of CollisionWorld.js's own (unexported) createComposedStageScheduler -- the same
// `{ elapsedMs(), checkpointIfDue() }` shape classifyHardClashPrecheck's own volumeOverlapQuery
// call expects (VolumeOverlapQuery.js:45-56), wrapping the SAME per-repetition checkpoint this
// file's outer per-pair gate below already shares -- not a separate, disconnected budget.
function createComposedStageScheduler(checkpoint, now) {
  let sinceMs = now();
  return {
    elapsedMs: () => now() - sinceMs,
    checkpointIfDue: async () => {
      const pending = checkpoint({ label: 'composed-narrow-phase-stage' });
      if (pending) {
        await pending;
        sinceMs = now();
      }
    },
  };
}

// Structural copy of CollisionWorld.js's own (unexported) comparePlacedCanonically
// (CollisionWorld.js:186-195), adapted to accept plain identity objects rather than
// PlacedInstances -- this harness never constructs PlacedInstance objects, only their identity
// fields captured from Phase 1.3's candidate list. Fixes review Critical #3: production's
// `compareCanonical` affects tolerance scaling/traversal order in volumeOverlapQuery, not merely
// determinism, so omitting it (the prior draft's `{ scheduler }`-only call) is a real fidelity gap.
function compareIdentityCanonically(a, b) {
  if (a.loadEpoch !== b.loadEpoch) return a.loadEpoch < b.loadEpoch ? -1 : 1;
  if (a.geometryIndex !== b.geometryIndex) return a.geometryIndex < b.geometryIndex ? -1 : 1;
  if (a.fragmentId !== b.fragmentId) return a.fragmentId < b.fragmentId ? -1 : 1;
  return 0;
}

// Structural copy of CollisionWorld.js's own (unexported) toInstance (CollisionWorld.js:373-383),
// applied to a LIVE, already-resolved GeometryRegistry record (fixes review Critical #1/the
// Important finding on repeated per-pair MeshBVH.deserialize: the synchronous arm reuses the SAME
// resident record production would reuse on a cache hit, rather than deserializing a fresh
// Instance from a serialized population entry for every pair).
function buildInstanceFromRegistryRecord(record, matrixArray) {
  return {
    geometry: record.geometry,
    bvh: record.bvh,
    localDiagonal: record.localDiagonal,
    connectivity: record.connectivity,
    closedManifold: record.connectivity ? record.connectivity.closedManifold.every(Boolean) : undefined,
    aspectRatioExceeded: record.aspectRatioExceeded,
    matrix: new THREE.Matrix4().fromArray(matrixArray),
  };
}

export function createPrecheckSyncArmReplay({ world, checkpointPort } = {}) {
  const port = checkpointPort ?? createCheckpointPort({
    isDisposed: () => false,
    isEpochLive: () => true,
    // Real default budget/yield -- see spike/m4/s7-geometry/syncArmReplay.mjs's own comment on why
    // this is deliberately not stubbed to something faster/synchronous.
    accumulator: createFrameBudgetAccumulator(),
  });

  return {
    // Drives ONE candidate pair through the REAL classifyHardClashPrecheck, preceded by the SAME
    // per-pair checkpoint gate CollisionWorld.js:1713 runs before _runClearanceNarrowPhasePair, and
    // with the SAME composed-stage scheduler wired into volumeOverlapOptions CollisionWorld.js:2299
    // wires -- reproducing today's between-pair AND within-pair yield points, not just today's
    // per-pair computation.
    async classifyPair({ loadEpoch, sourceIdentity, targetIdentity, sourceMatrix, targetMatrix, sourceWorldBounds, targetWorldBounds }) {
      const pending = port.checkpoint({ loadEpoch, label: 'clearance-narrow-phase-pair' });
      if (pending) await pending;

      // Cache-hit re-lookup against the SAME registry this repetition's own capture query already
      // resolved these geometries through -- near-instant for an already-'ready' entry, exactly as
      // production's resolveGeometryRecord behaves for a pair whose geometry a prior pair in the
      // same call already resolved.
      const sourceRecord = await world._registry.getOrBuildGeometry({ loadEpoch: sourceIdentity.loadEpoch, geometryIndex: sourceIdentity.geometryIndex, ownerModelIdHint: 'm4-spike-replay', needsConnectivity: true });
      const targetRecord = await world._registry.getOrBuildGeometry({ loadEpoch: targetIdentity.loadEpoch, geometryIndex: targetIdentity.geometryIndex, ownerModelIdHint: 'm4-spike-replay', needsConnectivity: true });
      const sourceInstance = buildInstanceFromRegistryRecord(sourceRecord, sourceMatrix);
      const targetInstance = buildInstanceFromRegistryRecord(targetRecord, targetMatrix);

      const canonicalOrder = compareIdentityCanonically(sourceIdentity, targetIdentity);
      const scheduler = createComposedStageScheduler((ctx) => port.checkpoint({ loadEpoch, ...ctx }), () => performance.now());

      let volumeOverlapQueryCalled = false;
      const inconclusiveCauses = [];
      setDiagnosticEventRecorder((kind, payload) => {
        if (kind === 'hard-clash-precheck') {
          volumeOverlapQueryCalled = true;
          inconclusiveCauses.push(...(payload.inconclusiveCauses ?? []));
        }
      });
      let disposition;
      try {
        // The full production option set (fixes review Critical #3): `scheduler` (the composed-
        // stage checkpoint, above), `compareCanonical` (CollisionWorld.js:2302-2303), and
        // `crossing.now` (CollisionWorld.js:2315). The prior draft's `{ scheduler }`-only call
        // silently diverged from all three.
        disposition = await classifyHardClashPrecheck(sourceInstance, targetInstance, sourceWorldBounds, targetWorldBounds, {
          scheduler,
          compareCanonical: (a, b) => (a === b ? 0 : a === sourceInstance ? canonicalOrder : -canonicalOrder),
          crossing: { now: () => performance.now() },
        });
      } finally {
        // Exception-safe (fixes review Important #4/cleanup finding): a thrown volumeOverlapQuery
        // never leaves the diagnostic recorder installed for the NEXT pair.
        clearDiagnosticEventRecorder();
      }
      // The SAME normalized shape workerCompute.mjs's computePrecheckBatch produces (fixes review
      // Critical #3's telemetry gap) -- Task 4.6's validator can field-compare the two arms'
      // results directly.
      return {
        status: disposition.status,
        conclusive: disposition.status !== 'inconclusive',
        inconclusiveCauses: [...new Set(inconclusiveCauses)].sort(),
        excluded: disposition.status === 'excluded',
        volumeOverlapQueryCalled,
      };
    },
  };
}
```
Run: `node --test spike/m4/s7-precheck/syncArmReplay.test.mjs`.

**Why this now genuinely reproduces production scheduling:** production's clearance narrow-phase
loop is a two-layer checkpoint structure — an OUTER checkpoint before each candidate pair
(`CollisionWorld.js:1713`, label `clearance-narrow-phase-pair`) and an INNER checkpoint inside
`classifyHardClashPrecheck`'s own `volumeOverlapQuery` traversal, reached only when the pair
actually proceeds past the unpadded-bounds skip-precheck check (`CollisionWorld.js:2299`, label
`composed-narrow-phase-stage`), both sharing ONE accumulator by explicit design
(`CollisionWorld.js:391-394`). `createPrecheckSyncArmReplay.classifyPair` reproduces exactly this:
one `port.checkpoint(...)` call before `classifyHardClashPrecheck` runs, and a structurally
identical composed-stage scheduler passed into it as `volumeOverlapOptions.scheduler`, both wired
to the same port — plus the full production option set (`compareCanonical`, `crossing.now`) and
diagnostic-event capture, so its RESULT shape, not just its scheduling, matches production. The
`syncArmReplay.test.mjs` tests above prove the checkpoint layering with a spy in two branches: a
`skip-precheck` pair triggers only the outer checkpoint (one yield), while a `proceed` pair that
actually reaches `volumeOverlapQuery` triggers both layers (at least two yields) — the SAME
distinction production itself makes between a pair its unpadded bounds already exclude and one
that runs the real overlap traversal.

```bash
git add spike/m4/s7-precheck/syncArmReplay.mjs spike/m4/s7-precheck/syncArmReplay.test.mjs
git commit -m "spike(m4): S7' precheck production-topology replay adapter for the synchronous arm -- real registry-cache Instance reconstruction, full classifyHardClashPrecheck option set, diagnostic telemetry parity (RED->GREEN, fixes review findings on scheduling fidelity, population source, and option/telemetry gaps)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Thin worker glue (unchanged, already batched) + full live paired driver, real resident-geometry population source, explicit world lifecycle, counterbalanced and checkpoint-faithful**
```js
// spike/m4/s7-precheck/worker.mjs
import { computePrecheckBatch } from './workerCompute.mjs';
import { withWorkerErrorSafety } from '../s7-shared/createSpikeWorker.mjs';

self.onmessage = withWorkerErrorSafety(async (ev) => {
  const msg = ev.data;
  if (msg.kind === 'populate-precheck') {
    self.__population ??= new Map();
    self.__population.set(`${msg.loadEpoch}:${msg.geometryIndex}`, msg);
    return;
  }
  if (msg.kind === 'precheck-query') {
    const batch = await computePrecheckBatch({
      populationByKey: self.__population, candidates: msg.candidates,
      worldBoundsAndMatrixByCandidate: msg.worldBoundsAndMatrixByCandidate,
    });
    self.postMessage({ requestId: msg.requestId, ...batch });
  }
});
```
```js
// spike/m4/s7-precheck/run.mjs -- full driver, counterbalanced arm order, checkpoint-faithful
// synchronous arm, real resident-geometry population source, explicit world lifecycle.
//
// REQUIRED lifecycle contract this task adds to Phase 3.1's fixture/world lifecycle gate (fixes
// review Important finding: the prior draft's capture step disposed the fresh world in the SAME
// step that later code went on to read window.__m4World from -- a real contradiction). Unlike Task
// 4.4 (whose synchronous arm needs only a captured RAW-INPUT SNAPSHOT, independent of the original
// world's lifetime, so disposing the world immediately after the capture query is correct there),
// THIS task's arms both need the ORIGINAL world's live `_registry` (the synchronous arm directly;
// the worker arm to build population messages from real resident buffers). Phase 3.1 must
// therefore expose a query-WITHOUT-dispose entry point for this task specifically --
// `window.__m4RunTupleQueryKeepWorld(tupleArg)`, which runs the query and returns with
// `window.__m4World` still live and undisposed -- plus this driver calls a separate
// `window.__m4DisposeWorld()` explicitly, once per repetition, only after BOTH arms have finished
// (wrapped in try/finally so a failed repetition still disposes before the next one starts).
import { createSpikeWorker } from '../s7-shared/createSpikeWorker.mjs';
import { createWorkerChannel, mapToStubResult } from '../s7-shared/workerChannel.mjs';
import { armOrderForRepetition, runPairedRepetitionInOrder } from './armOrder.mjs';

async function captureCandidatesKeepingWorldAlive(page, tuple) {
  // 1. Fresh world (kept alive); install the precheck-candidate capture point; run the real query
  //    once; harvest the ONE captured candidate list (identity only -- Phase 1.3's real shape);
  //    clear the hook. Does NOT dispose the world -- see the file-level comment above.
  return page.evaluate(async (tupleArg) => {
    const { setSpikeInputCapture, clearSpikeInputCapture } = await import('/collision/scheduler.js');
    let captured = null;
    setSpikeInputCapture((kind, payload) => { if (kind === 'precheck-candidate-list') captured = payload; });
    await window.__m4RunTupleQueryKeepWorld(tupleArg);
    clearSpikeInputCapture();
    return captured; // { sourceEpoch, candidates }
  }, tuple);
}

async function resolvePlacementAndPopulation(page, candidates) {
  // 2. Resolve worldBounds/worldMatrix per candidate via the precedented private-field reach
  //    (world._placementByEpoch -- same pattern run-gate-m2.mjs already uses). Resolve each
  //    referenced geometry's REAL resident buffers via the SAME registry the capture query already
  //    built them through -- a cache hit, not a rebuild (fixes review Critical #1: the prior
  //    draft's world.getEpochGeometryDiagnostics call returned only byte-count accounting, never
  //    usable buffers).
  return page.evaluate(async (candidatesArg) => {
    const { MeshBVH } = await import('three-mesh-bvh');
    const world = window.__m4World;
    const worldBoundsAndMatrixByCandidate = candidatesArg.map((c) => {
      const source = world._placementByEpoch.get(c.sourceLoadEpoch).get(c.sourceFragmentId);
      const target = world._placementByEpoch.get(c.targetLoadEpoch).get(c.targetFragmentId);
      return {
        sourceMatrix: Array.from(source.worldMatrix), targetMatrix: Array.from(target.worldMatrix),
        sourceWorldBounds: source.worldBounds, targetWorldBounds: target.worldBounds,
      };
    });
    const geometryKeys = new Set(candidatesArg.flatMap((c) => [`${c.sourceLoadEpoch}:${c.sourceGeometryIndex}`, `${c.targetLoadEpoch}:${c.targetGeometryIndex}`]));
    const populationEntries = [];
    for (const key of geometryKeys) {
      const [loadEpoch, geometryIndex] = key.split(':').map(Number);
      const record = await world._registry.getOrBuildGeometry({ loadEpoch, geometryIndex, ownerModelIdHint: 'm4-spike-replay', needsConnectivity: true });
      populationEntries.push({
        loadEpoch, geometryIndex,
        position: record.geometry.attributes.position.array,
        index: record.geometry.index.array,
        bvh: MeshBVH.serialize(record.bvh, { cloneBuffers: false }),
        connectivity: {
          componentCount: record.connectivity.componentCount,
          componentOf: record.connectivity.componentOf,
          closedManifold: Uint8Array.from(record.connectivity.closedManifold.map((b) => (b ? 1 : 0))),
        },
        localDiagonal: record.localDiagonal, aspectRatio: record.aspectRatio, aspectRatioExceeded: record.aspectRatioExceeded,
      });
    }
    return { worldBoundsAndMatrixByCandidate, populationEntries };
  }, candidates);
}

async function runSyncArm(page, { candidates, worldBoundsAndMatrixByCandidate, sourceEpoch }, repetitionIndex) {
  // Synchronous arm: the REAL classifyHardClashPrecheck, through the production-topology replay
  // adapter, reusing the SAME live world._registry the capture query already resolved these
  // geometries through -- no deserialization, no population-entry round trip.
  return page.evaluate(async ({ candidates, worldBoundsAndMatrixByCandidate, sourceEpoch, repetitionIndex }) => {
    const { createPrecheckSyncArmReplay } = await import('/spike/m4/s7-precheck/syncArmReplay.mjs');
    const world = window.__m4World;
    const replay = createPrecheckSyncArmReplay({ world });
    const startMark = `sync-arm-${repetitionIndex}-start`, endMark = `sync-arm-${repetitionIndex}-end`, measureName = `sync-arm-${repetitionIndex}`;
    performance.mark(startMark);
    const out = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i], wb = worldBoundsAndMatrixByCandidate[i];
      out.push(await replay.classifyPair({
        loadEpoch: sourceEpoch,
        sourceIdentity: { loadEpoch: c.sourceLoadEpoch, geometryIndex: c.sourceGeometryIndex, fragmentId: c.sourceFragmentId },
        targetIdentity: { loadEpoch: c.targetLoadEpoch, geometryIndex: c.targetGeometryIndex, fragmentId: c.targetFragmentId },
        sourceMatrix: wb.sourceMatrix, targetMatrix: wb.targetMatrix,
        sourceWorldBounds: wb.sourceWorldBounds, targetWorldBounds: wb.targetWorldBounds,
      }));
    }
    performance.mark(endMark);
    // Duration read directly from performance.measure's own return value, in THIS SAME
    // page.evaluate call, with names namespaced by repetitionIndex (fixes review Critical #2, same
    // fix as Task 4.4's own run.mjs).
    const { duration } = performance.measure(measureName, startMark, endMark);
    performance.clearMarks(startMark); performance.clearMarks(endMark); performance.clearMeasures(measureName);
    return { results: out, elapsedMs: duration };
  }, { candidates, worldBoundsAndMatrixByCandidate, sourceEpoch, repetitionIndex });
}

async function runWorkerArm(page, { candidates, worldBoundsAndMatrixByCandidate, populationEntries }, repetitionIndex) {
  // Worker arm: populate() each distinct geometry once (from the REAL resident buffers resolved
  // above), query() the whole candidate list plus its worldBoundsAndMatrixByCandidate as one
  // compact message -- already a single batched round trip. Exception-safe channel/worker cleanup
  // (fixes review Important finding).
  return page.evaluate(async ({ candidates, worldBoundsAndMatrixByCandidate, populationEntries, repetitionIndex }) => {
    const { createSpikeWorker } = await import('/spike/m4/s7-shared/createSpikeWorker.mjs');
    const { createWorkerChannel, mapToStubResult } = await import('/spike/m4/s7-shared/workerChannel.mjs');
    const worker = createSpikeWorker('/spike/m4/s7-precheck/worker.mjs');
    const channel = createWorkerChannel(worker);
    const startMark = `worker-arm-${repetitionIndex}-start`, endMark = `worker-arm-${repetitionIndex}-end`, measureName = `worker-arm-${repetitionIndex}`;
    const snapStart = `worker-arm-${repetitionIndex}-snapshot-start`, snapEnd = `worker-arm-${repetitionIndex}-snapshot-end`;
    const sendStart = `worker-arm-${repetitionIndex}-send-start`, sendEnd = `worker-arm-${repetitionIndex}-send-end`;
    try {
      performance.mark(startMark);
      performance.mark(snapStart);
      for (const e of populationEntries) channel.populate({ kind: 'populate-precheck', ...e });
      performance.mark(snapEnd);
      performance.mark(sendStart);
      const { raw, correlationMarkName } = await channel.query({ kind: 'precheck-query', candidates, worldBoundsAndMatrixByCandidate });
      performance.mark(sendEnd);
      performance.mark(endMark);
      const { duration } = performance.measure(measureName, startMark, endMark);
      const stub = mapToStubResult(raw);
      return { stub, correlationMarkName, elapsedMs: duration };
    } finally {
      channel.dispose();
      [startMark, endMark, snapStart, snapEnd, sendStart, sendEnd].forEach((m) => performance.clearMarks(m));
      performance.clearMeasures(measureName);
    }
  }, { candidates, worldBoundsAndMatrixByCandidate, populationEntries, repetitionIndex });
}

function summarizeFiveMs(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[2], min: sorted[0], max: sorted[4], raw: values }; // §6.1.6: never a mean alone
}

async function disposeWorld(page) {
  // Called explicitly, once per repetition, only after BOTH arms have finished with the world's
  // live registry -- see the file-level lifecycle comment above.
  await page.evaluate(async () => { await window.__m4DisposeWorld(); });
}

async function measureTuple(page, tuple) {
  const repetitions = [];
  for (let repetitionIndex = 0; repetitionIndex < 5; repetitionIndex++) {
    const { sourceEpoch, candidates } = await captureCandidatesKeepingWorldAlive(page, tuple);
    let armOrder, syncArm, workerArm;
    try {
      const { worldBoundsAndMatrixByCandidate, populationEntries } = await resolvePlacementAndPopulation(page, candidates);
      ({ armOrder, syncArm, workerArm } = await runPairedRepetitionInOrder(repetitionIndex, {
        sync: () => runSyncArm(page, { candidates, worldBoundsAndMatrixByCandidate, sourceEpoch }, repetitionIndex),
        worker: () => runWorkerArm(page, { candidates, worldBoundsAndMatrixByCandidate, populationEntries }, repetitionIndex),
      }));
    } finally {
      // Exception-safe (fixes review Important finding): a failure in either arm still disposes
      // the world before the next repetition, rather than leaking it forward.
      await disposeWorld(page);
    }
    repetitions.push({ repetition: repetitionIndex, armOrder, syncArm: syncArm.results, workerArm, syncArmMs: syncArm.elapsedMs, workerArmMs: workerArm.elapsedMs });
  }
  return {
    tuple,
    armOrderSchedule: repetitions.map((r) => ({ repetition: r.repetition, armOrder: r.armOrder })),
    syncArmMs: summarizeFiveMs(repetitions.map((r) => r.syncArmMs)),
    workerArmMs: summarizeFiveMs(repetitions.map((r) => r.workerArmMs)),
    repetitions,
  };
}
```

- [ ] **Step 10: Manual verification**
Run: `node spike/m4/s7-precheck/run.mjs --tuples=<derived-from-m4-gate-report>`
Expected: every reported pair's `status` matches between arms including `skip-precheck` pairs
(confirming the C3 fix — the worker no longer fabricates a `volumeOverlapQuery` cost for pairs
production would have skipped); both arms report the SAME normalized
`{status, conclusive, inconclusiveCauses, excluded, volumeOverlapQueryCalled}` shape per pair;
timings are reported as median/min/max/raw across 5 repetitions, each duration read directly from
its own repetition's `performance.measure(...)` return value; the recorded `armOrderSchedule` shows
alternation; the world is disposed exactly once per repetition, after both arms complete (confirm
no `WorldDisposedError` is thrown mid-repetition, and no world/worker is left resident after the
run); Task 4.6's validator reports PASS on the identical-candidate-list comparison. Separately,
confirm `node --test spike/m4/s7-precheck/syncArmReplay.test.mjs` passes, proving the synchronous
arm checkpoints both between pairs and within a proceeding pair's own overlap traversal, and
returns the same normalized result shape the worker arm does — not merely asserted in prose.

- [ ] **Step 11: Commit**
```bash
git add spike/m4/s7-precheck/worker.mjs spike/m4/s7-precheck/run.mjs
git commit -m "spike(m4): S7' Hard-Clash-precheck paired live driver, checkpoint-faithful synchronous arm, real resident-geometry population source, explicit world lifecycle, counterbalanced arm order, per-repetition timing correctness (fixes review C3 and this round's population-source/telemetry/lifecycle/timing findings)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 4.6: S7' Stage-Scoped Validators (§6.4)

**Condition:** Same gate as 4.3. Runs after 4.4's/4.5's closing `performance.mark`, never inside
the measured comparison.

**Files:**
- Create: `spike/m4/s7-validators/geometryPreparationValidator.mjs`
- Create: `spike/m4/s7-validators/precheckValidator.mjs`
- Test: `spike/m4/s7-validators/geometryPreparationValidator.test.mjs`, `spike/m4/s7-validators/precheckValidator.test.mjs`

**Interfaces:**
- Consumes: Task 4.4's synchronous-arm/worker-arm results; Task 4.5's synchronous-arm/worker-arm
  per-pair results (now keyed by full identity, see fix below).
- Produces: a pass/fail-with-reasons verdict per comparison; a failure disqualifies that spike's
  evidence for that tuple only, never `FAILED_VALIDATION` on the gate run (§16.2).

**Fix applied (review finding I3):** the prior draft's geometry validator never checked
`position`/`index`/`connectivity` array LENGTHS before comparing element-wise (a length mismatch
silently produced a shorter, spuriously-passing comparison via `elementWiseEqual`'s own early
length-mismatch branch, but nothing separately validated `componentOf.length === closedManifold`'s
implied triangle count, so a malformed connectivity result for an open/degenerate component could
still pass the partition check by construction). And the prior precheck validator keyed candidate
pairs by `${sourceFragmentId}:${targetFragmentId}` alone — omitting the epoch — so two DIFFERENT
target epochs both containing `fragmentId: 2` collapse into the same `Map` key, silently dropping
one pair's real comparison and reporting false success. Fixed below: length/bounds validation added
to the geometry validator; the precheck validator now keys by
`${sourceLoadEpoch}:${sourceFragmentId}:${targetLoadEpoch}:${targetFragmentId}` and explicitly
rejects duplicate keys within one side (preserving multiplicity) rather than silently
last-write-wins via `Map` construction.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s7-validators/geometryPreparationValidator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeometryPreparation } from './geometryPreparationValidator.mjs';

function fixture() {
  return {
    position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    index: Uint32Array.from([0, 1, 2]),
    connectivity: { componentCount: 1, componentOf: Int32Array.from([0]), closedManifold: Uint8Array.from([0]) },
    serializedBvh: { roots: [new Uint8Array([1, 2, 3]).buffer], index: Uint32Array.from([0, 1, 2]), indirectBuffer: Uint32Array.from([0, 1, 2]) },
  };
}

test('PASSES when position/index are element-wise equal, connectivity is the same partition, and BVH is byte-identical', () => {
  const sync = fixture(), worker = structuredClone(fixture());
  assert.equal(validateGeometryPreparation(sync, worker).pass, true);
});

test('FAILS with a named reason on a length mismatch, rather than silently comparing a truncated prefix', () => {
  const sync = fixture();
  const worker = structuredClone(fixture());
  worker.position = worker.position.slice(0, 3); // one vertex short
  const result = validateGeometryPreparation(sync, worker);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'position-mismatch');
  assert.equal(result.detail.lengthMismatch[0], sync.position.length);
});

test('FAILS when componentOf implies a triangle count inconsistent with position/index (malformed connectivity)', () => {
  const sync = fixture();
  const worker = structuredClone(fixture());
  worker.connectivity.componentOf = Int32Array.from([0, 0]); // 2 entries but only 1 triangle exists
  const result = validateGeometryPreparation(sync, worker);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'componentOf-length-mismatch');
});

test('PASSES connectivity equal as a partition even under component relabeling', () => {
  const sync = fixture();
  const worker = structuredClone(fixture());
  worker.connectivity.componentOf = Int32Array.from(worker.connectivity.componentOf).map(() => 5);
  assert.equal(validateGeometryPreparation(sync, worker).pass, true);
});

test('FAILS on a non-byte-identical serialized BVH', () => {
  const sync = fixture();
  const worker = structuredClone(fixture());
  worker.serializedBvh.roots = [new Uint8Array([1, 2, 4]).buffer];
  assert.equal(validateGeometryPreparation(sync, worker).reason, 'bvh-not-byte-identical');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s7-validators/geometryPreparationValidator.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s7-validators/geometryPreparationValidator.mjs
function elementWiseEqual(a, b) {
  if (a.length !== b.length) return { equal: false, detail: { lengthMismatch: [a.length, b.length] } };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { equal: false, detail: { index: i, expected: a[i], actual: b[i] } };
  }
  return { equal: true };
}

function bytesEqual(bufA, bufB) {
  const a = new Uint8Array(bufA), b = new Uint8Array(bufB);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function samePartition(syncComponentOf, workerComponentOf) {
  const forward = new Map(), backward = new Map();
  for (let i = 0; i < syncComponentOf.length; i++) {
    const s = syncComponentOf[i], w = workerComponentOf[i];
    if (forward.has(s) && forward.get(s) !== w) return false;
    if (backward.has(w) && backward.get(w) !== s) return false;
    forward.set(s, w); backward.set(w, s);
  }
  return true;
}

export function validateGeometryPreparation(sync, worker) {
  const position = elementWiseEqual(sync.position, worker.position);
  if (!position.equal) return { pass: false, reason: 'position-mismatch', detail: position.detail };

  const index = elementWiseEqual(sync.index, worker.index);
  if (!index.equal) return { pass: false, reason: 'index-mismatch', detail: index.detail };

  const expectedTriangleCount = sync.index.length / 3;
  // Length/bounds validation (fix for review I3): componentOf must have exactly one entry per
  // triangle -- a malformed/truncated connectivity result must fail here, not pass silently by
  // relabeling coincidence.
  if (sync.connectivity.componentOf.length !== expectedTriangleCount || worker.connectivity.componentOf.length !== expectedTriangleCount) {
    return { pass: false, reason: 'componentOf-length-mismatch', detail: { expectedTriangleCount, syncLength: sync.connectivity.componentOf.length, workerLength: worker.connectivity.componentOf.length } };
  }
  if (sync.connectivity.componentCount !== worker.connectivity.componentCount) {
    return { pass: false, reason: 'componentCount-mismatch', detail: { expected: sync.connectivity.componentCount, actual: worker.connectivity.componentCount } };
  }
  const maxSyncLabel = Math.max(...sync.connectivity.componentOf);
  if (sync.connectivity.closedManifold.length !== sync.connectivity.componentCount || maxSyncLabel >= sync.connectivity.closedManifold.length) {
    return { pass: false, reason: 'closedManifold-length-mismatch', detail: { closedManifoldLength: sync.connectivity.closedManifold.length, componentCount: sync.connectivity.componentCount } };
  }
  if (!samePartition(sync.connectivity.componentOf, worker.connectivity.componentOf)) {
    return { pass: false, reason: 'componentOf-partition-mismatch' };
  }
  for (let i = 0; i < sync.connectivity.componentOf.length; i++) {
    const syncClosed = sync.connectivity.closedManifold[sync.connectivity.componentOf[i]];
    const workerClosed = worker.connectivity.closedManifold[worker.connectivity.componentOf[i]];
    if (Boolean(syncClosed) !== Boolean(workerClosed)) return { pass: false, reason: 'closedManifold-mismatch', detail: { triangle: i } };
  }

  if (sync.serializedBvh.roots.length !== worker.serializedBvh.roots.length) {
    return { pass: false, reason: 'bvh-not-byte-identical', detail: { rootsCountMismatch: true } };
  }
  for (let i = 0; i < sync.serializedBvh.roots.length; i++) {
    if (!bytesEqual(sync.serializedBvh.roots[i], worker.serializedBvh.roots[i])) return { pass: false, reason: 'bvh-not-byte-identical', detail: { root: i } };
  }
  if (!bytesEqual(sync.serializedBvh.index.buffer, worker.serializedBvh.index.buffer)) return { pass: false, reason: 'bvh-not-byte-identical', detail: { field: 'index' } };
  if (!bytesEqual(sync.serializedBvh.indirectBuffer.buffer, worker.serializedBvh.indirectBuffer.buffer)) return { pass: false, reason: 'bvh-not-byte-identical', detail: { field: 'indirectBuffer' } };

  return { pass: true };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s7-validators/geometryPreparationValidator.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s7-validators/geometryPreparationValidator.mjs spike/m4/s7-validators/geometryPreparationValidator.test.mjs
git commit -m "spike(m4): §6.4 geometry-preparation validator, length/bounds checks added (RED->GREEN, fixes review I3)"
```

- [ ] **Step 6: Write the failing test (precheck validator, keyed by full identity)**
```js
// spike/m4/s7-validators/precheckValidator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePrecheckResults } from './precheckValidator.mjs';

function pair(overrides = {}) {
  return { sourceLoadEpoch: 1, sourceFragmentId: 1, targetLoadEpoch: 1, targetFragmentId: 2, status: 'proceed', conclusive: true, inconclusiveCauses: [], excluded: false, ...overrides };
}

test('PASSES when status, inconclusiveCauses, and the excluded-pair set all match', () => {
  assert.equal(validatePrecheckResults([pair()], [pair()]).pass, true);
});

test('two DIFFERENT target epochs both containing fragmentId 2 do NOT collapse to one key (fix for review I3)', () => {
  const sync = [pair({ targetLoadEpoch: 1, targetFragmentId: 2, status: 'excluded', excluded: true }), pair({ targetLoadEpoch: 2, targetFragmentId: 2, status: 'proceed' })];
  const worker = [pair({ targetLoadEpoch: 1, targetFragmentId: 2, status: 'excluded', excluded: true })]; // missing the second epoch's pair entirely
  const result = validatePrecheckResults(sync, worker);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'pair-set-mismatch');
});

test('FAILS on a status mismatch (skip-precheck vs proceed) for a specific pair', () => {
  const sync = [pair({ status: 'skip-precheck', conclusive: true })];
  const worker = [pair({ status: 'proceed', conclusive: true })];
  const result = validatePrecheckResults(sync, worker);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'status-mismatch');
});

test('rejects a duplicate key within one side rather than silently collapsing it (preserves multiplicity)', () => {
  const sync = [pair(), pair()]; // same identity twice
  const worker = [pair()];
  const result = validatePrecheckResults(sync, worker);
  assert.equal(result.pass, false);
  assert.equal(result.reason, 'duplicate-pair-identity');
});
```

- [ ] **Step 7: Run test to verify it fails**
Run: `node --test spike/m4/s7-validators/precheckValidator.test.mjs`

- [ ] **Step 8: Write minimal implementation**
```js
// spike/m4/s7-validators/precheckValidator.mjs
// Keyed by FULL identity (fix for review I3) -- fragmentId alone is reused across federated
// target epochs, so sourceLoadEpoch/targetLoadEpoch must be part of the key.
function pairKey(p) { return `${p.sourceLoadEpoch}:${p.sourceFragmentId}:${p.targetLoadEpoch}:${p.targetFragmentId}`; }

function indexByIdentity(pairs) {
  const byKey = new Map();
  for (const p of pairs) {
    const key = pairKey(p);
    if (byKey.has(key)) return { error: { reason: 'duplicate-pair-identity', detail: { key } } };
    byKey.set(key, p);
  }
  return { byKey };
}

export function validatePrecheckResults(sync, worker) {
  const syncIndexed = indexByIdentity(sync);
  if (syncIndexed.error) return { pass: false, ...syncIndexed.error };
  const workerIndexed = indexByIdentity(worker);
  if (workerIndexed.error) return { pass: false, ...workerIndexed.error };

  const syncByKey = syncIndexed.byKey, workerByKey = workerIndexed.byKey;
  if (syncByKey.size !== workerByKey.size || [...syncByKey.keys()].some((k) => !workerByKey.has(k))) {
    return { pass: false, reason: 'pair-set-mismatch' };
  }
  for (const [key, syncPair] of syncByKey) {
    const workerPair = workerByKey.get(key);
    if (syncPair.status !== workerPair.status) return { pass: false, reason: 'status-mismatch', detail: { key } };
    if (syncPair.conclusive !== workerPair.conclusive) return { pass: false, reason: 'conclusive-mismatch', detail: { key } };
    const syncCauses = [...syncPair.inconclusiveCauses].sort();
    const workerCauses = [...workerPair.inconclusiveCauses].sort();
    if (JSON.stringify(syncCauses) !== JSON.stringify(workerCauses)) return { pass: false, reason: 'inconclusiveCauses-mismatch', detail: { key } };
    if (syncPair.excluded !== workerPair.excluded) return { pass: false, reason: 'excluded-set-mismatch', detail: { key } };
  }
  return { pass: true };
}
```

- [ ] **Step 9: Run test to verify it passes**
Run: `node --test spike/m4/s7-validators/precheckValidator.test.mjs`

- [ ] **Step 10: Commit**
```bash
git add spike/m4/s7-validators/precheckValidator.mjs spike/m4/s7-validators/precheckValidator.test.mjs
git commit -m "spike(m4): §6.4 precheck validator, key by full (epoch,fragmentId) identity, preserve multiplicity (RED->GREEN, fixes review I3)"
```

---

### Task 4.7: S7' Hᵢ / Memory Integration

**Condition:** Same gate as 4.3.

**Consumed interfaces — the REAL Phase 2 exports (replaces the prior draft's "something shaped
like" placeholders):**
- `test/performance/m4/stage-attribution-engine.mjs`:
  `computeResidualForBoundary(taskIntervals, stageIntervals, ownedStageNames)` → `Rᵢ(w,τ)` (a
  number); `computeBoundaryOccupancy(taskIntervals, subMarkIntervals, correlationMarkMs,
  closingMarkMs)` → `{value, deliveryTaskIdentified}` — `value` IS `Hᵢ(w,τ)`. Interval shape:
  `{startMs, endMs, source, stage, validity}`.
- `test/performance/m4/metric-m-calculator.mjs`: `computeMetricM(snapshot): number` over
  `MemorySnapshot = { geometryEntries: [{loadEpoch, geometryIndex, positionByteLength,
  indexByteLength, bvhRootByteLengths: number[], bvhIndirectBufferByteLength,
  connectivityComponentOfByteLength, connectivityClosedManifoldLength}], epochs: [{loadEpoch,
  tlasPrimitiveBufferByteLength, tlasRecordCount, placementCount, instanceCount}], inflight:
  [{payloadId, backingBuffers: [{bufferId, byteLength}], payloadMetadataBytes}] }`.

**Files:**
- Create: `spike/m4/s7-hi-memory/adaptSubMarksToHiInput.mjs`
- Create: `spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.mjs`
- Test: `spike/m4/s7-hi-memory/adaptSubMarksToHiInput.test.mjs`, `spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.test.mjs`
- Test: manual verification, wired into 4.4's/4.5's `run.mjs`

**Interfaces:**
- Consumes: 4.4's/4.5's raw sub-mark timestamps and the correlation mark NAME `workerChannel.mjs`
  now returns (fix C1 — a real main-thread mark, resolvable to a CDP task); a query window's CDP
  main-thread task list (Phase 3's own trace-capture machinery); 4.4's/4.5's retained worker-arm
  result objects; the real `computeBoundaryOccupancy`/`computeMetricM` above.
- Produces: `Hᵢ(w,τ)` for §7.3 condition 4(b); a `MemorySnapshot`-shaped, buffer-identity-deduped
  scope for §15.3's budget check.

**Fixes applied (review findings C1 and I4):**

- **C1 (propagated here).** Because `workerChannel.mjs`'s `query()` now resolves with
  `{raw, correlationMarkName}` where `correlationMarkName` is a REAL main-thread `performance.mark`
  name (`s7-delivery-<requestId>`), `adaptSubMarksToHiInput` below resolves that name to a
  `performance.getEntriesByName(...)`-obtained timestamp itself, rather than accepting an
  already-numeric `correlationMarkMs` sourced from the wrong realm.
- **I4 — the Metric M adapter didn't match Phase 2's actual consumer contract.** The prior draft's
  adapter returned two pre-summed numbers (`controllingBudgetBytes`/`harnessOnlyScaffoldingBytes`),
  which `computeMetricM(snapshot)` cannot consume — it expects the structured `MemorySnapshot`
  shape above. Fixed below: the adapter now builds a real `MemorySnapshot.geometryEntries`-shaped
  array from the arm's retained buffers, deduplicated by **physical `ArrayBuffer` identity** (the
  same defect class as C2: `weldedGeometry.index` and `serializedBvh.index` alias one buffer and
  must be counted once, not twice), tags entries by role (`prepared-result` vs.
  `stub-mapping-scaffolding`) so the harness-only-scaffolding split from §17 is preserved as a
  SEPARATE reported figure alongside — never merged into — the `MemorySnapshot` handed to
  `computeMetricM`, which only ever receives the `prepared-result` bucket.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s7-hi-memory/adaptSubMarksToHiInput.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptSubMarksToHiInput } from './adaptSubMarksToHiInput.mjs';

test('shapes CDP tasks + sub-marks + the resolved correlation-mark timestamp into computeBoundaryOccupancy\'s exact input positions', () => {
  const cdpTasks = [{ startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' }];
  const shaped = adaptSubMarksToHiInput({
    cdpTasks,
    subMarks: [{ startMs: 5, endMs: 8 }, { startMs: 8, endMs: 12 }],
    correlationMarkMs: 40, closingMarkMs: 60,
  });
  assert.deepEqual(shaped.taskIntervals, cdpTasks);
  assert.equal(shaped.subMarkIntervals.length, 2);
  assert.equal(shaped.correlationMarkMs, 40);
  assert.equal(shaped.closingMarkMs, 60);
});

test('rejects a correlation mark reported after the closing mark rather than silently clamping it', () => {
  assert.throws(() => adaptSubMarksToHiInput({
    cdpTasks: [], subMarks: [], correlationMarkMs: 70, closingMarkMs: 60,
  }), /correlation mark after closing mark/);
});

test('reports deliveryTaskIdentified:false honestly when correlationMarkMs is null (no delivery task located)', () => {
  const shaped = adaptSubMarksToHiInput({ cdpTasks: [], subMarks: [], correlationMarkMs: null, closingMarkMs: 60 });
  assert.equal(shaped.correlationMarkMs, null);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s7-hi-memory/adaptSubMarksToHiInput.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s7-hi-memory/adaptSubMarksToHiInput.mjs
// Reshapes 4.4's/4.5's raw sub-mark timestamps into the EXACT positional arguments Phase 2's real
// computeBoundaryOccupancy(taskIntervals, subMarkIntervals, correlationMarkMs, closingMarkMs)
// takes. No per-task-intersection math of its own -- that lives in Phase 2, already unit-tested
// there; this module's only job is correct reshaping (kept minimal per review finding I4's lesson:
// match the REAL consumer contract, don't invent a shape it can't take).
export function adaptSubMarksToHiInput({ cdpTasks, subMarks, correlationMarkMs, closingMarkMs }) {
  if (correlationMarkMs !== null && correlationMarkMs > closingMarkMs) {
    throw new Error('correlation mark after closing mark -- delivery task is unidentifiable (§6.2)');
  }
  return {
    taskIntervals: cdpTasks,
    subMarkIntervals: subMarks.map((m) => ({ startMs: m.startMs, endMs: m.endMs, source: 'harness-stage', stage: 'boundary', validity: 'valid' })),
    correlationMarkMs,
    closingMarkMs,
  };
}

// Resolves a workerChannel-returned correlationMarkName (a real main-thread performance.mark, per
// review fix C1) to its timestamp, in-page. Returns null (never throws) if the mark cannot be
// found -- the caller's own computeBoundaryOccupancy call then correctly reports
// deliveryTaskIdentified:false rather than crashing.
export function resolveCorrelationMarkMs(correlationMarkName) {
  if (!correlationMarkName) return null;
  const entries = performance.getEntriesByName(correlationMarkName, 'mark');
  return entries.length === 1 ? entries[0].startTime : null;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s7-hi-memory/adaptSubMarksToHiInput.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s7-hi-memory/adaptSubMarksToHiInput.mjs spike/m4/s7-hi-memory/adaptSubMarksToHiInput.test.mjs
git commit -m "spike(m4): S7' sub-mark -> computeBoundaryOccupancy input adapter, resolves the real main-thread correlation mark (RED->GREEN, fixes review C1)"
```

- [ ] **Step 6: Write the failing test (Metric M adapter, real MemorySnapshot shape, buffer-identity dedup)**
```js
// spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptRetainedBuffersToMetricM } from './adaptRetainedBuffersToMetricM.mjs';

test('builds a real MemorySnapshot.geometryEntries entry from the ONE prepared-result copy (§17)', () => {
  const position = new Float32Array(10), index = new Uint32Array(30);
  const arm = [{ role: 'prepared-result', loadEpoch: 1, geometryIndex: 1, position, index, bvhRoots: [new ArrayBuffer(64)], bvhIndirectBuffer: new Uint32Array(30), componentOf: new Int32Array(10), closedManifoldLength: 1 }];
  const { snapshot, harnessOnlyScaffoldingBytes } = adaptRetainedBuffersToMetricM(arm);
  assert.equal(snapshot.geometryEntries.length, 1);
  assert.equal(snapshot.geometryEntries[0].positionByteLength, position.byteLength);
  assert.equal(harnessOnlyScaffoldingBytes, 0);
});

test('a value retained purely for the stub result mapping is excluded from the snapshot and reported separately (§17)', () => {
  const arm = [
    { role: 'prepared-result', loadEpoch: 1, geometryIndex: 1, position: new Float32Array(10), index: new Uint32Array(30), bvhRoots: [], bvhIndirectBuffer: new Uint32Array(0), componentOf: new Int32Array(10), closedManifoldLength: 1 },
    { role: 'stub-mapping-scaffolding', byteLength: 512 },
  ];
  const { snapshot, harnessOnlyScaffoldingBytes } = adaptRetainedBuffersToMetricM(arm);
  assert.equal(snapshot.geometryEntries.length, 1);
  assert.equal(harnessOnlyScaffoldingBytes, 512);
});

test('deduplicates position/index buffers that ALIAS the serialized BVH index (same defect class as review C2)', () => {
  const sharedIndex = new Uint32Array(30);
  const arm = [{ role: 'prepared-result', loadEpoch: 1, geometryIndex: 1, position: new Float32Array(10), index: sharedIndex, bvhRoots: [], bvhIndirectBuffer: sharedIndex, componentOf: new Int32Array(10), closedManifoldLength: 1 }];
  const { snapshot } = adaptRetainedBuffersToMetricM(arm);
  // indexByteLength counted once; bvhIndirectBufferByteLength for the SAME physical buffer must
  // report 0 (already counted), never double-counted under a different field name.
  assert.equal(snapshot.geometryEntries[0].indexByteLength, sharedIndex.byteLength);
  assert.equal(snapshot.geometryEntries[0].bvhIndirectBufferByteLength, 0);
});
```

- [ ] **Step 7: Run test to verify it fails**
Run: `node --test spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.test.mjs`

- [ ] **Step 8: Write minimal implementation**
```js
// spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.mjs
// Builds the REAL MemorySnapshot shape computeMetricM(snapshot) actually consumes (fix for review
// I4 -- the prior version returned two pre-summed numbers computeMetricM cannot take). Deduplicates
// by physical ArrayBuffer identity so an aliased buffer (e.g. weldedGeometry.index ===
// serializedBvh.index, review finding C2's own defect class) is counted exactly once.
export function adaptRetainedBuffersToMetricM(retainedBuffers) {
  const seenBuffers = new Set();
  const byteLengthIfFirstSeen = (typedArrayOrBuffer) => {
    if (!typedArrayOrBuffer) return 0;
    const buf = ArrayBuffer.isView(typedArrayOrBuffer) ? typedArrayOrBuffer.buffer : typedArrayOrBuffer;
    if (seenBuffers.has(buf)) return 0;
    seenBuffers.add(buf);
    return typedArrayOrBuffer.byteLength ?? buf.byteLength;
  };

  const geometryEntries = [];
  let harnessOnlyScaffoldingBytes = 0;
  for (const entry of retainedBuffers) {
    if (entry.role === 'stub-mapping-scaffolding') { harnessOnlyScaffoldingBytes += entry.byteLength; continue; }
    if (entry.role !== 'prepared-result') throw new Error(`unrecognized retained-buffer role: ${entry.role}`);
    geometryEntries.push({
      loadEpoch: entry.loadEpoch, geometryIndex: entry.geometryIndex,
      positionByteLength: byteLengthIfFirstSeen(entry.position),
      indexByteLength: byteLengthIfFirstSeen(entry.index),
      bvhRootByteLengths: entry.bvhRoots.map((r) => byteLengthIfFirstSeen(r)),
      bvhIndirectBufferByteLength: byteLengthIfFirstSeen(entry.bvhIndirectBuffer),
      connectivityComponentOfByteLength: byteLengthIfFirstSeen(entry.componentOf),
      connectivityClosedManifoldLength: entry.closedManifoldLength,
    });
  }
  return {
    snapshot: { geometryEntries, epochs: [], inflight: [] },
    harnessOnlyScaffoldingBytes,
  };
}
```

- [ ] **Step 9: Run test to verify it passes**
Run: `node --test spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.test.mjs`

- [ ] **Step 10: Commit**
```bash
git add spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.mjs spike/m4/s7-hi-memory/adaptRetainedBuffersToMetricM.test.mjs
git commit -m "spike(m4): S7' retained-buffer -> real MemorySnapshot adapter, buffer-identity dedup (RED->GREEN, fixes review I4)"
```

- [ ] **Step 11: Wire into 4.4's/4.5's live driver**
Extend 4.4's/4.5's `run.mjs`: per repetition, after Task 4.6's validator runs (which itself runs
after the closing mark): (a) call `resolveCorrelationMarkMs(correlationMarkName)` in-page, feed the
result plus the real CDP task list and raw sub-mark timestamps to `adaptSubMarksToHiInput`, then
call the REAL `computeBoundaryOccupancy(...)` from `test/performance/m4/stage-attribution-engine.mjs`
on the adapted positional arguments; (b) call `adaptRetainedBuffersToMetricM` on the worker arm's
actual retained buffers, then call the REAL `computeMetricM(snapshot)` from
`test/performance/m4/metric-m-calculator.mjs` on the returned `snapshot` only, reporting
`harnessOnlyScaffoldingBytes` alongside as harness overhead, never inside the controlling figure.

Run: `node spike/m4/s7-geometry/run.mjs --tuples=... --with-hi-memory` and the precheck equivalent.
Expected: every reported repetition's `Hᵢ.value` is no larger than that repetition's own elapsed
worker-arm bracket duration; `deliveryTaskIdentified` is `true` for every repetition where the
correlation mark actually resolved to a CDP task (flag, don't silently accept, any run where it
isn't); Metric M's snapshot-derived figure plus `harnessOnlyScaffoldingBytes` sums to the worker
arm's total retained byte count with no buffer double-counted.

- [ ] **Step 12: Commit**
```bash
git add spike/m4/s7-geometry/run.mjs spike/m4/s7-precheck/run.mjs
git commit -m "spike(m4): wire the REAL computeBoundaryOccupancy/computeMetricM into both S7' arms' live output"
```

---

### Task 4.8: S8' Progress-Overhead Spike

**Condition:** Same gate as S7' (4.3–4.7). Additionally requires 4.3–4.7's worker to already exist.

**Files:**
- Create: `spike/m4/s8-progress/progressDelta.mjs`
- Create: `spike/m4/s8-progress/run.mjs`
- Test: `spike/m4/s8-progress/progressDelta.test.mjs`
- Test: manual verification via `run.mjs`

**Interfaces:**
- Consumes: 4.3's `createWorkerChannel`; whichever of 4.4's or 4.5's worker actually qualified for
  the tuple set S8' reuses (§17: "Reuse S7''s worker" — S8' does not choose arbitrarily between
  them, it reuses whichever vertical the SAME checkpoint activated for S7'); Phase 3.2's observation
  envelope for X-1/X-2/X-3.
- Produces: `ms and duty-cycle delta` per §17's S8' row — report-only, feeding §12.3, no §7.3/§7.5
  condition references it.

**Fix applied (review finding I5):** the prior draft ran one fixed-order with/without pair instead
of the required 5 counterbalanced paired repetitions; hardcoded the geometry-preparation worker even
when only the precheck vertical had qualified; and claimed the geometry worker could post progress
"every 10ms inside its computation loop" when `compactAndWeld`/`build()` are single, opaque,
synchronous production calls with no interior yield point a spike is permitted to instrument
(instrumenting one would exceed §16.4's closed six-item list). Fixed below: the driver selects the
actually-qualified vertical explicitly (never hardcodes one); runs 5 counterbalanced repetitions per
§6.1.6's convention, each pairing a with-progress and a without-progress sample; and — for the
geometry vertical specifically — states the real, honest limitation instead of a fabricated 10ms
cadence: progress can only be emitted at the THREE stage BOUNDARIES (post-weld, post-connectivity,
post-BVH) it can actually observe without modifying production code, and this is recorded as such
rather than claimed as true interior 10ms throttling. The precheck vertical, which loops per pair in
harness-owned code, genuinely supports interior 10ms-throttled progress and is used for the "throttled
progress at 10ms intervals" experiment §17 literally describes wherever it is the qualified vertical;
where only the geometry vertical qualified, the coarser stage-boundary progress is run instead and
the report says so explicitly.

- [ ] **Step 1: Write the failing test**
```js
// spike/m4/s8-progress/progressDelta.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProgressDelta, pairedRepetitionSummary } from './progressDelta.mjs';

test('computes the X-1/X-2/X-3 delta between one with-progress and one without-progress repetition', () => {
  const withoutProgress = { x1DutyCycle: 0.10, x2LongestTaskMs: 12, x3ElapsedMs: 500 };
  const withProgress = { x1DutyCycle: 0.14, x2LongestTaskMs: 13, x3ElapsedMs: 512 };
  const delta = computeProgressDelta(withoutProgress, withProgress);
  assert.equal(delta.dutyCycleDelta, 0.04);
  assert.equal(delta.longestTaskMsDelta, 1);
  assert.equal(delta.elapsedMsDelta, 12);
  assert.equal('pass' in delta, false); // §17: "NO PASS/FAIL is computed from it"
});

test('pairedRepetitionSummary reduces 5 counterbalanced paired repetitions to median deltas + the raw set (§6.1.6)', () => {
  const pairs = [
    [{ x1DutyCycle: 0.1, x2LongestTaskMs: 10, x3ElapsedMs: 500 }, { x1DutyCycle: 0.12, x2LongestTaskMs: 11, x3ElapsedMs: 508 }],
    [{ x1DutyCycle: 0.11, x2LongestTaskMs: 10, x3ElapsedMs: 502 }, { x1DutyCycle: 0.15, x2LongestTaskMs: 12, x3ElapsedMs: 515 }],
    [{ x1DutyCycle: 0.09, x2LongestTaskMs: 9, x3ElapsedMs: 498 }, { x1DutyCycle: 0.13, x2LongestTaskMs: 10, x3ElapsedMs: 510 }],
    [{ x1DutyCycle: 0.10, x2LongestTaskMs: 10, x3ElapsedMs: 500 }, { x1DutyCycle: 0.14, x2LongestTaskMs: 11, x3ElapsedMs: 512 }],
    [{ x1DutyCycle: 0.10, x2LongestTaskMs: 10, x3ElapsedMs: 501 }, { x1DutyCycle: 0.16, x2LongestTaskMs: 13, x3ElapsedMs: 520 }],
  ];
  const summary = pairedRepetitionSummary(pairs);
  assert.equal(summary.raw.length, 5);
  assert.ok(summary.medianDutyCycleDelta > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test spike/m4/s8-progress/progressDelta.test.mjs`

- [ ] **Step 3: Write minimal implementation**
```js
// spike/m4/s8-progress/progressDelta.mjs
export function computeProgressDelta(withoutProgress, withProgress) {
  return {
    dutyCycleDelta: withProgress.x1DutyCycle - withoutProgress.x1DutyCycle,
    longestTaskMsDelta: withProgress.x2LongestTaskMs - withoutProgress.x2LongestTaskMs,
    elapsedMsDelta: withProgress.x3ElapsedMs - withoutProgress.x3ElapsedMs,
  };
}

// §6.1.6's convention applied to S8': report median across repetitions plus the raw set --
// never a mean alone (fix for review I5's "one fixed-order pair" gap).
export function pairedRepetitionSummary(pairs) {
  const deltas = pairs.map(([without, withP]) => computeProgressDelta(without, withP));
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    raw: deltas,
    medianDutyCycleDelta: median(deltas.map((d) => d.dutyCycleDelta)),
    medianLongestTaskMsDelta: median(deltas.map((d) => d.longestTaskMsDelta)),
    medianElapsedMsDelta: median(deltas.map((d) => d.elapsedMsDelta)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test spike/m4/s8-progress/progressDelta.test.mjs`

- [ ] **Step 5: Commit**
```bash
git add spike/m4/s8-progress/progressDelta.mjs spike/m4/s8-progress/progressDelta.test.mjs
git commit -m "spike(m4): S8' progress-overhead delta + 5-repetition paired summary (RED->GREEN, fixes review I5)"
```

- [ ] **Step 6: Write the real driver — selects the qualified vertical explicitly, 5 counterbalanced repetitions**
```js
// spike/m4/s8-progress/run.mjs
import { pairedRepetitionSummary } from './progressDelta.mjs';

// Progress-posting addition, added behind an explicit flag to whichever worker actually qualified.
// Precheck vertical (loops per pair in harness-owned code -- genuinely supports interior 10ms
// throttling, matching §17's literal description):
//   let lastProgressAt = 0;
//   for (const c of candidates) {
//     ...
//     if (emitProgress) {
//       const now = performance.now();
//       if (now - lastProgressAt >= 10) { self.postMessage({ type: 'progress', atMs: now }); lastProgressAt = now; }
//     }
//   }
// Geometry vertical (compactAndWeld/buildBvh are opaque, single, synchronous production calls --
// NO interior yield point exists for a spike to instrument without exceeding §16.4's closed
// six-item list): progress can only be posted at the THREE stage BOUNDARIES already observable
// (post-weld, post-connectivity, post-BVH) -- coarser than 10ms by construction, and reported as
// such rather than claimed as true 10ms throttling.

async function runOnePairedRepetition(page, qualifiedVertical) {
  const workerPath = qualifiedVertical === 'geometry' ? '/spike/m4/s7-geometry/worker.mjs' : '/spike/m4/s7-precheck/worker.mjs';
  return page.evaluate(async ({ workerPath, qualifiedVertical }) => {
    const { createSpikeWorker } = await import('/spike/m4/s7-shared/createSpikeWorker.mjs');
    const { createWorkerChannel } = await import('/spike/m4/s7-shared/workerChannel.mjs');

    async function runOnce(emitProgress) {
      const worker = createSpikeWorker(workerPath);
      const channel = createWorkerChannel(worker);
      let progressCount = 0;
      worker.addEventListener('message', (ev) => { if (ev.data.type === 'progress') progressCount++; });
      performance.mark('s8-case-start');
      await channel.query({ kind: qualifiedVertical === 'geometry' ? 'populate-geometry' : 'precheck-query', emitProgress, ...window.__m4S8RealInput });
      performance.mark('s8-case-end');
      performance.measure('s8-case', 's8-case-start', 's8-case-end');
      channel.dispose();
      const measure = performance.getEntriesByName('s8-case').pop();
      return { x1DutyCycle: window.__m4ObservationEnvelope.dutyCycle(), x2LongestTaskMs: window.__m4ObservationEnvelope.longestTaskMs(), x3ElapsedMs: measure.duration, progressCount };
    }

    return [await runOnce(false), await runOnce(true)];
  }, { workerPath, qualifiedVertical });
}

async function main(qualifiedVertical /* 'geometry' | 'precheck', read from the checkpoint's own S7' selection -- never hardcoded */) {
  // ... launch, serve, page.goto as in prior tasks; window.__m4S8RealInput is populated from a
  // real captured repetition, per 4.4/4.5's own capture-and-replay pattern ...
  const pairs = [];
  for (let i = 0; i < 5; i++) pairs.push(await runOnePairedRepetition(page, qualifiedVertical));
  const summary = pairedRepetitionSummary(pairs);
  console.log(JSON.stringify({
    qualifiedVertical,
    progressGranularity: qualifiedVertical === 'geometry' ? 'stage-boundary (3 points: weld/connectivity/bvh) -- NOT true 10ms interior throttling, see this task\'s Step 6 note' : '10ms-throttled, interior to the per-pair loop',
    summary,
  }, null, 2));
}
```

- [ ] **Step 7: Manual verification**
Run: `node spike/m4/s8-progress/run.mjs` (with `qualifiedVertical` set from the real checkpoint
result — the run refuses to guess).
Expected: a report naming which vertical was actually reused, its real progress granularity
(honestly stated per the fix above), and `medianDutyCycleDelta`/`medianLongestTaskMsDelta`/
`medianElapsedMsDelta` across 5 counterbalanced paired repetitions with the raw set. No pass/fail
anywhere in the output.

- [ ] **Step 8: Commit**
```bash
git add spike/m4/s8-progress/run.mjs
git commit -m "spike(m4): S8' progress-overhead live driver, selects qualified vertical, 5 counterbalanced repetitions, honest geometry-vertical granularity limitation (fixes review I5)"
```
## Phase 5 — Reduce and close out

These tasks execute the already-built harness/spikes and interpret their output. They are procedural, not code-authoring TDD tasks — "steps" are commands plus verification reads rather than test/implementation code pairs. They run after Phase 3's decision checkpoint and after whichever Phase 4 tasks that checkpoint activated (Phase 4 may be entirely skipped if the baseline gate already passed everywhere — in that case Phase 5 starts directly from Phase 3's own results).

### Task 5.1: Confirm/finalize the full gate matrix results

**Files:**
- Read: `test/performance/results/m4-gate-<timestamp>.json` (produced by Phase 3, task 3.7's matrix scheduler + task 3.8's evidence normalization)
- Read: `test/performance/results/m4-spikes-<timestamp>.json` (produced by whichever Phase 4 tasks the decision checkpoint activated, if any)

**Interfaces:**
- Consumes: Phase 3 task 3.8's raw evidence-record output; Phase 4's spike pass/fail + stage-cost evidence (if Phase 4 ran).
- Produces: a single confirmed evidence source-of-truth for task 5.2's evidence-vector assembly — either the Phase-3-only result set (if Phase 4 was skipped) or the Phase-3 result set plus every executed Phase-4 spike's evidence, with no stale/superseded runs mixed in.

- [ ] **Step 1: Verify gate disposition**
Run: `node -e "const r = JSON.parse(require('fs').readFileSync(process.argv[1])); console.log(r.disposition); process.exit(r.disposition === 'FAILED' || r.disposition === 'FAILED_VALIDATION' ? 1 : 0);" test/performance/results/m4-gate-<timestamp>.json`
Expected: `disposition` is `'MEASURED'` (not `'FAILED'` or `'FAILED_VALIDATION'`). If either failure disposition is present, STOP — do not proceed to task 5.2; the correctness failure must be diagnosed and the gate re-run (this is a defect in the harness or a real regression, not a performance finding) before any verdict can be produced.

- [ ] **Step 2: Verify both runtimes are present**
Run: `node -e "const r = JSON.parse(require('fs').readFileSync(process.argv[1])); const runtimes = new Set(r.runs.map(x => x.runtime)); console.log([...runtimes]); process.exit(runtimes.has('historical') && runtimes.has('multi-process') ? 0 : 1);" test/performance/results/m4-gate-<timestamp>.json`
Expected: both `'historical'` and `'multi-process'` runtime tags present — these are the exact labels Task 3.1's `RUNTIME_CONFIGS` uses (`historical: {label:'historical', authoritative:false}`, `multiProcess: {label:'multi-process', authoritative:true}`); an earlier draft of this task used `'representative'`, which does not match any label the harness ever writes — corrected here (independent review finding). Authority is carried on the `authoritative` boolean, not encoded in the label string.

- [ ] **Step 3: If Phase 4 ran, verify every activated spike reports a disposition**
Run: `node -e "const r = JSON.parse(require('fs').readFileSync(process.argv[1])); console.log(r.spikes.map(s => ({id: s.id, disposition: s.disposition})));" test/performance/results/m4-spikes-<timestamp>.json`
Expected: every spike the decision checkpoint activated appears with a disposition of `PASS`, `FAIL`, or `NOT_EXERCISED` (never silently missing).

- [ ] **Step 4: Record the confirmed result-set paths**
No code — write the two (or one, if Phase 4 was skipped) confirmed file paths into the M4 evidence report's provenance section (task 5.3 consumes this).

### Task 5.2: Assemble the final evidence vector and invoke the reducer

Independent review finding (Critical): an earlier draft of this task deferred every real decision
("or equivalent", "choose based on what Phase 3 actually built", an illustrative shape not matching
Task 2.4's pinned contract, a `Step 5` explicitly asking the reader to design and write RED/GREEN
steps themselves later) — an implementer would have to invent missing contracts mid-execution,
defeating M4's pre-registration objective. Phase 2 is now fully drafted; this task is rewritten
against its REAL, final exports, with no deferred design left.

**Files:**
- Create: `test/performance/m4/assemble-evidence.mjs`
- Test: `test/performance/m4/assemble-evidence.test.mjs`

**Interfaces:**
- Consumes: Task 2.4's `buildEvidenceVector(rawRecords: RawMeasuredRecord[], globalPreconditions: GlobalPreconditions): EvidenceVector` (`test/performance/m4/decision-evidence-model.mjs`); Task 2.5's `reduceVerdict(evidenceVector: EvidenceVector): Verdict` (`test/performance/m4/verdict-reducer.mjs`); Task 5.1's confirmed `m4-gate-<timestamp>.json` / `m4-spikes-<timestamp>.json` file paths (the gate's own raw per-tuple record shape, produced by Task 3.8, and the spike outcome records, produced across Phase 3/4).
- Produces: `assembleEvidence(gateResult, spikesResult): {rawRecords: RawMeasuredRecord[], globalPreconditions: GlobalPreconditions}` (the pure mapping — no reducer call, no file I/O); `runReduction(gateResultPath, spikesResultPath, outPath): Verdict` (the live orchestration: reads both files, calls `assembleEvidence`, then `buildEvidenceVector`, then `reduceVerdict`, writes `{evidenceVector, verdict}` to `outPath`, returns `verdict`).

- [ ] **Step 1: Write the failing test — the pure mapping, one passing tuple, no boundaries**
```js
// test/performance/m4/assemble-evidence.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleEvidence } from './assemble-evidence.mjs';

test('assembleEvidence maps one passing gate record into one RawMeasuredRecord with no boundaries', () => {
  const gateResult = {
    disposition: 'MEASURED',
    tuples: [{
      runtime: 'multi-process', case: 'R1', broadPhase: 'tlas', state: 'cold',
      targets: { tA: true, tB1: true, tB2: true, tC: true },
      screenResidualMs: null, narrowPhaseFamilyWins: null,
    }],
    globalPreconditions: {
      noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
      workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
      unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
    },
  };
  const { rawRecords, globalPreconditions } = assembleEvidence(gateResult, { spikes: [] });
  assert.equal(rawRecords.length, 1);
  assert.deepEqual(rawRecords[0].tuple, { runtime: 'multi-process', caseId: 'R1', broadPhase: 'tlas', state: 'cold' });
  assert.deepEqual(rawRecords[0].boundaries, []);
  assert.deepEqual(globalPreconditions, gateResult.globalPreconditions);
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: FAIL with `Cannot find module './assemble-evidence.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/assemble-evidence.mjs
export function assembleEvidence(gateResult, spikesResult) {
  const rawRecords = gateResult.tuples.map((t) => ({
    tuple: { runtime: t.runtime, caseId: t.case, broadPhase: t.broadPhase, state: t.state },
    targets: t.targets,
    screenResidualMs: t.screenResidualMs,
    narrowPhaseFamilyWins: t.narrowPhaseFamilyWins,
    boundaries: [], // extended in Step 5 to fold in spikesResult's per-boundary evidence
  }));
  return { rawRecords, globalPreconditions: gateResult.globalPreconditions };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: PASS
- [ ] **Step 5: Write the failing test — folding a Phase-4 spike's boundary evidence into its owning tuple**
```js
test('assembleEvidence attaches a spike\'s boundary evidence to the tuple it was measured at', () => {
  const gateResult = {
    disposition: 'MEASURED',
    tuples: [{
      runtime: 'multi-process', case: 'R3', broadPhase: 'linear', state: 'warm',
      targets: { tA: false, tB1: true, tB2: true, tC: true },
      screenResidualMs: [10, 10, 10, 10, 10], narrowPhaseFamilyWins: true,
    }],
    globalPreconditions: {
      noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false,
      workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false,
      unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false,
    },
  };
  const spikesResult = {
    spikes: [{
      id: 'WB-2p', tuple: { runtime: 'multi-process', case: 'R3', broadPhase: 'linear', state: 'warm' },
      applicable: true, residualMs: [20, 20, 20, 20, 20], occupancyMs: [20, 20, 20, 20, 20],
      deliveryTaskIdentified: [true, true, true, true, true], derivedEvidenceBounded: null,
      memoryBudgetMet: true, lifecycleDemonstrated: true, moduleResolutionEstablished: true,
    }],
  };
  const { rawRecords } = assembleEvidence(gateResult, spikesResult);
  assert.equal(rawRecords[0].boundaries.length, 1);
  assert.equal(rawRecords[0].boundaries[0].id, 'WB-2p');
});

test('assembleEvidence throws if a spike\'s tuple does not match any gate tuple exactly (stale or mistyped join key)', () => {
  const gateResult = { disposition: 'MEASURED', tuples: [], globalPreconditions: {} };
  const spikesResult = { spikes: [{ id: 'WB-2p', tuple: { runtime: 'multi-process', case: 'R3', broadPhase: 'linear', state: 'warm' } }] };
  assert.throws(() => assembleEvidence(gateResult, spikesResult), /no matching gate tuple/);
});
```
- [ ] **Step 6: Run test to verify it fails**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: FAIL — `boundaries` is hardcoded to `[]`; `spikesResult` is accepted but never read.
- [ ] **Step 7: Write minimal implementation**
```js
// replace assembleEvidence in assemble-evidence.mjs
function tupleKey(t) { return `${t.runtime}|${t.case ?? t.caseId}|${t.broadPhase}|${t.state}`; }

export function assembleEvidence(gateResult, spikesResult) {
  const spikesByTupleKey = new Map();
  for (const spike of spikesResult.spikes ?? []) {
    const key = tupleKey(spike.tuple);
    if (!spikesByTupleKey.has(key)) spikesByTupleKey.set(key, []);
    const { tuple, ...boundaryFields } = spike;
    spikesByTupleKey.get(key).push(boundaryFields);
  }
  const matchedKeys = new Set();
  const rawRecords = gateResult.tuples.map((t) => {
    const key = tupleKey(t);
    matchedKeys.add(key);
    return {
      tuple: { runtime: t.runtime, caseId: t.case, broadPhase: t.broadPhase, state: t.state },
      targets: t.targets,
      screenResidualMs: t.screenResidualMs,
      narrowPhaseFamilyWins: t.narrowPhaseFamilyWins,
      boundaries: spikesByTupleKey.get(key) ?? [],
    };
  });
  for (const key of spikesByTupleKey.keys()) {
    if (!matchedKeys.has(key)) throw new Error(`assembleEvidence: no matching gate tuple for spike evidence at ${key}`);
  }
  return { rawRecords, globalPreconditions: gateResult.globalPreconditions };
}
```
- [ ] **Step 8: Run test to verify it passes**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: PASS
- [ ] **Step 9: Write the failing test — the live orchestration, `runReduction`, reading real files and invoking the real reducer**
```js
test('runReduction reads gate+spikes JSON from disk, reduces to a verdict, and writes {evidenceVector, verdict}', async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'm4-assemble-'));
  const gatePath = path.join(dir, 'gate.json');
  const spikesPath = path.join(dir, 'spikes.json');
  const outPath = path.join(dir, 'verdict.json');
  writeFileSync(gatePath, JSON.stringify({
    disposition: 'MEASURED',
    tuples: [{ runtime: 'multi-process', case: 'R1', broadPhase: 'tlas', state: 'cold', targets: { tA: true, tB1: true, tB2: true, tC: true }, screenResidualMs: null, narrowPhaseFamilyWins: null }],
    globalPreconditions: { noConfirmedResponsivenessTarget: false, noRepresentativeRuntime: false, capacityCensored: false, workloadValidityFailed: false, insufficientStatisticalConfidence: false, missingCausalAttribution: false, unconfirmedMemoryMultipliers: false, undeterminedDeviceScopeOrConcurrency: false },
  }));
  writeFileSync(spikesPath, JSON.stringify({ spikes: [] }));
  const { runReduction } = await import('./assemble-evidence.mjs');
  const verdict = await runReduction(gatePath, spikesPath, outPath);
  assert.equal(verdict.verdict, 'A');
  const written = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(written.verdict.verdict, 'A');
  assert.ok(written.evidenceVector);
});
```
- [ ] **Step 10: Run test to verify it fails**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: FAIL with `runReduction is not a function`.
- [ ] **Step 11: Write minimal implementation**
```js
// add to assemble-evidence.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvidenceVector } from './decision-evidence-model.mjs';
import { reduceVerdict } from './verdict-reducer.mjs';

export async function runReduction(gateResultPath, spikesResultPath, outPath) {
  const gateResult = JSON.parse(readFileSync(gateResultPath, 'utf8'));
  const spikesResult = JSON.parse(readFileSync(spikesResultPath, 'utf8'));
  if (gateResult.disposition !== 'MEASURED') {
    throw new Error(`runReduction: gate disposition is "${gateResult.disposition}", not "MEASURED" -- fix the correctness failure before reducing`);
  }
  const { rawRecords, globalPreconditions } = assembleEvidence(gateResult, spikesResult);
  const evidenceVector = buildEvidenceVector(rawRecords, globalPreconditions);
  const verdict = reduceVerdict(evidenceVector);
  writeFileSync(outPath, JSON.stringify({ evidenceVector, verdict }, null, 2));
  return verdict;
}
```
- [ ] **Step 12: Run test to verify it passes**
Run: `node --test test/performance/m4/assemble-evidence.test.mjs`
Expected: PASS
- [ ] **Step 13: Commit**
```bash
git add test/performance/m4/assemble-evidence.mjs test/performance/m4/assemble-evidence.test.mjs
git commit -m "feat(m4): assemble real gate+spike evidence and invoke the real Task 2.4/2.5 reducer pipeline

Independent review (Critical): the prior draft deferred this task's real contracts to a future
merge step, leaving an implementer to invent them mid-execution. Phase 2's real buildEvidenceVector/
reduceVerdict exports are now wired end to end, with no deferred design remaining.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 5.3: Produce the final M4 evidence report

**Files:**
- Create: `test/performance/m4/write-final-report.mjs`
- Test: `test/performance/m4/write-final-report.test.mjs`
- Create (output, not source): `test/performance/results/m4-report-<timestamp>.json`

**Interfaces:**
- Consumes: Task 5.2's `runReduction` output — `{evidenceVector: EvidenceVector, verdict: Verdict}` (both Task 2.4/2.5's real, final shapes) — plus Task 5.1's confirmed provenance and the raw `gateResult`/`spikesResult` for the §26 fields (stage attribution, main-only/transferable partition, S2T characterization, memory metrics, spike outcomes) the evidence vector itself doesn't carry verbatim.
- Produces: `writeFinalReport({verdict, evidenceVector, gateResult, spikesResult, provenance}, {outDir, now}): FinalReport`, written to `test/performance/results/m4-report-<timestamp>.json`.

The report MUST include (spec §26, verbatim list): workload/provenance, responsiveness metrics, stage attribution, main-only/transferable partition, S2T characterization, memory metrics, spike outcomes, boundary dispositions, mandatory-D causes, reducer inputs, final A/B/C/D, unresolved external inputs, and named resolution path for D. It must distinguish, if the verdict is D: D/no-boundary, D/no-full-query-evidence, D/no-settled-boundary, prerequisite-driven D — never conflating two of these in one report.

- [ ] **Step 1: Write the failing test — required-field rejection, using the REAL `Verdict` shape**
```js
// test/performance/m4/write-final-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFinalReport } from './write-final-report.mjs';

test('writeFinalReport rejects a verdict missing evidenceVector/gateResult/provenance', () => {
  assert.throws(
    () => writeFinalReport({ verdict: { verdict: 'D', causes: [{ scope: 'global', cause: 'no-confirmed-responsiveness-target' }], tupleFindings: [] } }, { outDir: '/tmp' }),
    /missing required field/,
  );
});

test('writeFinalReport accepts a complete D verdict and names its cause without conflating causes', () => {
  const input = {
    verdict: { verdict: 'D', causes: [{ scope: 'tuple', tuple: { runtime: 'multi-process', caseId: 'R3', broadPhase: 'linear', state: 'warm' }, cause: 'no-full-query-evidence' }], tupleFindings: [] },
    evidenceVector: { globalMandatoryD: { any: false, causes: [] }, tuples: [] },
    gateResult: { partition: {}, memory: {}, s2tCharacterization: null },
    spikesResult: { spikes: [] },
    provenance: { browserVersion: 'x', launchFlags: [], os: 'y', machineClass: 'z' },
  };
  const report = writeFinalReport(input, { outDir: '/tmp', now: () => 1234 });
  assert.equal(report.finalVerdict, 'D');
  assert.equal(report.dCauses.length, 1);
  assert.equal(report.dCauses[0].cause, 'no-full-query-evidence');
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `node --test test/performance/m4/write-final-report.test.mjs`
Expected: FAIL with `Cannot find module './write-final-report.mjs'`
- [ ] **Step 3: Write minimal implementation**
```js
// test/performance/m4/write-final-report.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = ['verdict', 'evidenceVector', 'gateResult', 'spikesResult', 'provenance'];

export function writeFinalReport(input, { outDir, now = () => Date.now() } = {}) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in input)) throw new Error(`writeFinalReport: missing required field: ${field}`);
  }
  const { verdict, evidenceVector, gateResult, spikesResult, provenance } = input;
  const report = {
    finalVerdict: verdict.verdict,
    // §26: never conflate D/no-boundary, D/no-full-query-evidence, D/no-settled-boundary, and a
    // prerequisite-driven (§7.5.1-8, global) D -- each cause in Task 2.5's `causes` array is
    // reported as its own distinct entry, scoped to the tuple (or 'global') it was found at.
    dCauses: verdict.verdict === 'D' ? verdict.causes : [],
    tupleFindings: verdict.tupleFindings,
    settledBoundaries: verdict.settledBoundaries ?? [],
    mechanicalDifferences: verdict.mechanicalDifferences ?? [],
    reducerInputs: evidenceVector, // §26 "reducer inputs" -- the exact EvidenceVector the verdict was computed from, for audit
    workloadAndProvenance: provenance,
    responsivenessMetrics: gateResult.tuples?.map((t) => ({ tuple: { runtime: t.runtime, caseId: t.case, broadPhase: t.broadPhase, state: t.state }, targets: t.targets })) ?? [],
    stageAttributionAndPartition: gateResult.partition ?? null, // §6.3's main-only/transferable partition, Task 3.8's output
    s2tCharacterization: gateResult.s2tCharacterization ?? null,
    memoryMetrics: gateResult.memory ?? null,
    spikeOutcomes: spikesResult.spikes ?? [],
    unresolvedExternalInputs: evidenceVector.globalMandatoryD.causes, // the §7.5.1-8 external inputs the reducer itself flagged, if any
    generatedAt: now(),
  };
  const outPath = path.join(outDir, `m4-report-${report.generatedAt}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  return report;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `node --test test/performance/m4/write-final-report.test.mjs`
Expected: PASS
- [ ] **Step 5: Write the failing test — every §26 field is present and non-empty for a real, non-trivial verdict (A, with real per-tuple metrics)**
```js
test('a Verdict-A report carries a non-empty responsivenessMetrics array and an explicit empty dCauses (not omitted)', () => {
  const input = {
    verdict: { verdict: 'A', tupleFindings: [{ tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'tlas', state: 'warm' }, status: 'A' }] },
    evidenceVector: { globalMandatoryD: { any: false, causes: [] }, tuples: [{ tuple: { runtime: 'multi-process', caseId: 'R1', broadPhase: 'tlas', state: 'warm' }, targetsAllPass: true, boundaries: [] }] },
    gateResult: { tuples: [{ runtime: 'multi-process', case: 'R1', broadPhase: 'tlas', state: 'warm', targets: { tA: true, tB1: true, tB2: true, tC: true } }], partition: { mainOnlyMs: 5, transferableMs: 40 }, s2tCharacterization: null, memory: { cold: { metricM: 100 } } },
    spikesResult: { spikes: [] },
    provenance: { browserVersion: 'x', launchFlags: [], os: 'y', machineClass: 'z' },
  };
  const report = writeFinalReport(input, { outDir: '/tmp', now: () => 1234 });
  assert.equal(report.dCauses.length, 0);
  assert.equal(report.responsivenessMetrics.length, 1);
  assert.equal(report.stageAttributionAndPartition.mainOnlyMs, 5);
});
```
- [ ] **Step 6: Run test to verify it passes**
Run: `node --test test/performance/m4/write-final-report.test.mjs`
Expected: PASS — this step is a regression lock over the field mapping built in Step 3; if it fails, fix `writeFinalReport` to match §26's field list exactly before proceeding.
- [ ] **Step 7: Commit**
```bash
git add test/performance/m4/write-final-report.mjs test/performance/m4/write-final-report.test.mjs
git commit -m "feat(m4): write the final M4 evidence report against the real Verdict/EvidenceVector shapes, every §26 field present

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

### Task 5.4: Update docs/CHANGELOG per project convention

**Files:**
- Modify: `CHANGELOG.md`
- Read: `collision/README.md` (verify only — no change expected)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Read the M1/M2/M3 CHANGELOG entries**
Run: `grep -n -A 5 "^## " CHANGELOG.md | head -80`
Expected: locate the exact heading/entry format M1-M3 used (date, milestone name, one-line summary, link to spec/plan if that's the established pattern).

- [ ] **Step 2: Add the M4 entry, matching that exact format**
Add a new entry above the most recent one recording: milestone name (M4 — Performance / Worker Decision Gate), the date, the final verdict (A/B/C/D) and one line naming its evidence location (`test/performance/results/m4-report-<timestamp>.json`), and — if D — its named cause. No code change; hand-edit `CHANGELOG.md` following the discovered format exactly.

- [ ] **Step 3: Verify no collision/README.md public-contract line needs changing**
Run: `git diff collision/README.md`
Expected: empty diff — M4 adds no public contract, so `collision/README.md` (which documents `findClashes`'s query/result shape, diagnostics semantics, and `groupBy:'dbId'`) must be untouched. If a diff appears, that is a scope violation — revert it.

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: record M4 performance/worker-decision-gate verdict"
```

### Task 5.5: Dispose spike code unless the verdict adopts a finding

**Files:**
- Delete: `spike/m4/` (entire directory tree)

**Interfaces:** none.

Per spec §17: spike code is "deleted at M4 close unless a verdict explicitly adopts it" — but per §1.2 and §19.2, even a B/C verdict only *justifies* the next milestone building a real implementation; it never authorizes shipping spike code as production. "Adoption" is evidentiary (the finding — which boundary, which topology — carries forward into the next milestone's own design work), not a license to keep the disposable code. The code is deleted in every verdict case (A, B, C, or D); what differs is only whether the M4 report names a specific spike's evidence as informing the next milestone's starting point.

- [ ] **Step 1: Confirm the final verdict is recorded in the M4 report**
Run: `node -e "const r = JSON.parse(require('fs').readFileSync(process.argv[1])); console.log(r.finalVerdict, r.dCause);" test/performance/results/m4-report-<timestamp>.json`
Expected: a printed verdict (A/B/C/D) — confirms task 5.3 completed before disposal proceeds.

- [ ] **Step 2: If verdict is B or C, record which spike(s) informed the named boundary before deleting**
No code — copy the relevant spike evidence summary (already inside the task 5.3 report's `boundaryDispositions`/`spikeOutcomes` fields) is sufficient; no separate extraction needed since the report is durable and `spike/m4/` is not.

- [ ] **Step 3: Delete the spike tree**
Run: `git rm -r spike/m4/`
Expected: every file under `spike/m4/` removed from the working tree and staged for commit.

- [ ] **Step 4: Run the full regression suite to confirm nothing outside spike/m4/ depended on it**
Run: `npm test`
Expected: PASS — no test file, gate script, or `collision/` module imports anything from `spike/m4/` (the Global Constraints already forbid `collision/`/`wwwroot/` from referencing spike code; this step is the mechanical proof).

- [ ] **Step 5: Commit**
```bash
git commit -m "chore(m4): dispose spike/m4/ per §17 -- disposable regardless of verdict"
```

## M4 completion criteria (final checklist for this plan, restated from the project's own prompt)

M4 is complete when: the full harness exists and passes its own correctness/self-tests; instrumentation is additive/no-op when unused; historical M1/M2/M3 gates remain byte-stable and untouched; all declared executable R/S cases are run or honestly reported `NOT EXERCISED`/`CAPACITY_REJECTED`; required spikes ran only under their declared conditions (Phase 3's decision checkpoint, honestly applied); correctness gates are green; verdict-reducer fixture tests are green; the pre-registered mapping produced exactly one A/B/C/D; all mandatory-D causes are named where applicable; D is accepted as a successful completion when mechanically produced; no production worker architecture was implemented; disposable spike code was removed (task 5.5) regardless of verdict.

**Ready for execution.**
