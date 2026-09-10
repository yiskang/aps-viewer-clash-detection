// test/performance/run-gate-m4.mjs
//
// The M4 (Worker-vs-main-thread decision) performance gate. Sibling to test/performance/
// run-gate.mjs (M1), run-gate-m2.mjs (M2), and run-gate-m3.mjs (M3) -- ALL THREE of which are
// UNTOUCHED by this file (protected invariant).
//
// Built up across tasks 3.1-3.7:
//   3.1  §6.1 steps 1-4: launch -> load -> live identity re-confirm -> sacrificial warm-up ->
//        one fresh CollisionWorld per (runtime, case[, level], broadPhase, repetition) tuple.
//   3.2  §6.1.7/§6.2's observation envelope: the rAF cadence recorder, the CDP
//        `Input.dispatchMouseEvent` probe series, and the Node<->renderer clock calibration.
//   3.3  §5.4's unmeasured cohort-profiling pass and the low/typical/high cohorts it feeds.
//   3.4  §5.3.1's S2T bystander facade and its level-to-level mechanical control rule.
//   3.5  §5.2.1's R6 calibration pass and move -> invalidate -> refresh -> restore sequence.
//   3.6  §6.4's canonical TLAS-vs-linear correctness comparator.
//   3.7  THIS TASK: the real R1-R6/S1-S4/S2T dispatch loop wiring all of the above together, plus
//        the live CDP trace capture -> §6.2 stage attribution (BOTH yield rules) -> Rᵢ/Hᵢ -> T-a
//        pipeline that task 3.8's `buildEvidenceRecord` consumes.
//
// Deliberately NOT here: the S1'/S3'/S4' spikes (tasks 3.9/3.10) and Metric M/Metric H memory
// sampling (task 3.11, which interleaves into this file's own per-tuple loop afterwards).
//
// Run: node test/performance/run-gate-m4.mjs   (npm run test:performance:gate:m4)
//      ... --cases=R1,R2 --runtimes=multi-process --repetitions=1   (scoped subset; the flagless
//      invocation always dispatches the complete baseline matrix)

// The fixture: the SAME real 3-discipline federated Revit host+links Audubon package M1-M3's gates
// use (URNs copied verbatim from run-gate-m3.mjs:66-68). See run-gate-m3.mjs's own header for the
// full provenance/fragment-count rationale -- not re-derived here since Task 3.1 makes no new claim
// about the fixture's content, only about the lifecycle around it.
const ARCH_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fQXJjaGl0ZWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const STRUCTURE_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fU3RydWN0dXJlX2NsYXNoX3Rlc3QucnZ0';
const MECHANICAL_URN = 'dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA';
const SOURCE_DB_ID = 3076; // Structure model (index 1) -- see run-gate-m3.mjs's header comment.
const CLEARANCE = 0.05;    // DEFAULT_CLEARANCE (ClashFinderExtension.js:60), model units.
const PORT = process.env.PORT || 8080;
const RESULTS_DIR = 'test/performance/results';

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { RUNTIME_CONFIGS, resolveProxyFromEnv, freshWorldTupleKey, measuredStatesFor } from './m4/fixture-lifecycle.mjs';
import {
  dispositionForObservation, tCDispositionForRepetition, envelopeLimitMs, nearestRankPercentile,
  calibrateNodeToRendererClock, nodeMsToRendererMs, applyClockUncertainty,
} from './m4/observation-envelope.mjs';
import { rankByDensity, selectCohort, labelDensityUnstratified } from './m4/cohort-selection.mjs';
import { S2T_LEVELS, bystanderLayout, syntheticIdRangeAbove } from './m4/s2t-bystander-layout.mjs';
import { R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer, pairSetDelta, matricesEqual } from './m4/r6-calibration.mjs';
import { compareRuns } from './m4/correctness-comparator.mjs';
import {
  M4_CASE_LIST, buildCounterbalancedSchedule, caseOrderForRepetition, toCapacityRejectedRecord,
  recognizeCapacityRejection,
} from './m4/counterbalancing-schedule.mjs';
import { parseTraceAndClock } from './m4/trace-clock-parser.mjs';
import {
  computeResidualAll, computeResidualForBoundary, computeBoundaryOccupancy,
  yieldRecordsToIntervals, splitIntervalAroundYields, classifyStageForScreen,
} from './m4/stage-attribution-engine.mjs';
import { BOUNDARY_TABLE } from './m4/decision-evidence-model.mjs';
import { buildTriangleGrid, translatedGrid } from './m4/s4-synthetic-mesh.mjs';
import { maxSyncTriangleCount } from '../../collision/constants.js';

// ---- §6.1.6 / §7.2 protocol constants ---------------------------------------------------------
const REPETITIONS = 5;                 // §6.1.6
const TA_MAX_TASK_MS = 50;             // §7.2 T-a  (the Long Tasks definition)
const TB1_P95_INTERVAL_MS = 32;        // §7.2 T-b1 (two frames at 60 Hz)
const TB2_MAX_GAP_MS = 100;            // §7.2 T-b2 (RAIL Response budget)
const TC_THRESHOLD_MS = 100;           // §7.2 T-c  (the same RAIL Response budget)
const PROBE_CADENCE_MS = 100;          // §6.2's fixed input-probe cadence -- never derived from a query's own duration
// §6.2 fixes the probe target element: `mousemove` over THE VIEWER CANVAS. A bare `canvas`
// selector is not that -- found empirically on the first live run: the loaded app has TWO canvases
// (the Viewer's own `canvas[data-viewer-canvas="true"]` at 1280x672, and a 170x170 one the Viewer
// creates for its view cube), so Playwright's strict mode rejects the ambiguous locator outright.
// Resolving it by position (`.first()`) would be the same "trust array order as identity" mistake
// this codebase has already been bitten by; the Viewer's own explicit marker attribute is used.
const CANVAS_SELECTOR = 'canvas[data-viewer-canvas="true"]';

// §6.2's pinned trace configuration. The categories are verbatim from the spec; the transfer mode
// is CDP's JSON `ReportEvents` (events arrive as `Tracing.dataCollected` batches).
const TRACE_CATEGORIES = ['toplevel', 'devtools.timeline', 'blink.user_timing', 'disabled-by-default-devtools.timeline'];

// §6.2: "A *task* is a top-level `toplevel`-category task event on the measured renderer's main
// thread (`RunTask`, AND THE BUILD'S EQUIVALENT TOP-LEVEL TASK NAME RECORDED VERBATIM FROM THE
// PINNED VERSION)". Task 2.1's own default is `['RunTask']` alone, which is what the spec names
// generically -- but the Chromium this repo's Playwright actually launches emits its top-level
// tasks as `ThreadControllerImpl::RunTask`. Confirmed empirically with a targeted probe against
// the live browser: a window containing two deliberate ~120 ms synchronous blocks produced
// `toplevel`/`ph:'X'` events named `ThreadControllerImpl::RunTask` (120.34 ms, 119.91 ms) plus
// nested `Receive mojo message` / `BlinkScheduler_PerformMicrotaskCheckpoint` events, and NOTHING
// named bare `RunTask`. With the bare default, `parseTraceAndClock` returned `valid: true` with
// ZERO task intervals -- i.e. a silently empty duty cycle and a T-a that would trivially "pass"
// while measuring nothing. Both names are accepted (never only the build-specific one), and
// `assembleTargetsTa` below additionally refuses to report a numeric T-a for any window that
// produced zero task intervals, so a future Chromium renaming this event again fails loudly as
// UNEVALUABLE instead of silently passing.
const TOP_LEVEL_TASK_NAMES = ['RunTask', 'ThreadControllerImpl::RunTask'];

// §6.3's fixed stage-classification table is keyed by the SPEC's stage names; `collision/`'s own
// span hook reports the LABELS its call sites pass to `reportSpan(label, ms)`. This is the one
// mapping between the two, derived by reading every live `reportSpan` call site on disk:
//   collision/geometry/GeometryRegistry.js:179/209/231  -> 'weld' / 'connectivity' / 'bvh-construction'
//   collision/geometry/createGeometryRegistry.js:67/83/114 -> 'geometry-extraction' / 'geometry-weld'
//   collision/tlas/TlasCache.js:212                     -> 'tlas-build'
//   collision/CollisionWorld.js:1694/2467               -> 'capacity-admission-commit' / 'clearance-distance-query'
// An UNMAPPED label is never guessed at and never silently dropped: `classifyStageForScreen`
// THROWS on an unknown stage name, so an unmapped span is excluded from the Rᵢ inputs and recorded
// by name on the tuple as `unmappedSpanLabels`, which is a reportable gap rather than a crash or a
// silent under-subtraction.
//
// The FIRST live run surfaced eight further labels arriving through the same `(label, ms)` hook.
// They are NOT missing stages -- they are the checkpoint port's own INTER-CHECKPOINT spans
// (`collision/scheduler.js:197`, `reportSpan(label, now - lastSpanAt)` from every
// `checkpoint({ label })` call site). Each measures "synchronous time since this port's previous
// checkpoint", which is §6.2's SCHEDULER-CONFORMANCE metric -- a completely different quantity
// from a §6.3 stage duration, and one that must never be subtracted from a main-thread task as
// transferable stage time (doing so would shrink Rᵢ using a number that is not a stage at all,
// exactly the class of error §6.2's yield-splitting rule exists to prevent). They are therefore
// EXCLUDED from stage attribution by design, and reported separately as §6.2 requires: "the
// maximum inter-checkpoint span across every checkpoint label". Enumerated exhaustively from every
// `checkpoint({ label })` call site on disk, so a genuinely NEW, genuinely unmapped label still
// shows up in `unmappedSpanLabels` rather than being swallowed by a catch-all.
const CHECKPOINT_SPAN_LABELS = new Set([
  'broad-phase-scan', 'clearance-broad-phase-scan', 'clearance-narrow-phase-pair',
  'clearance-tlas-broad-phase-query', 'composed-narrow-phase-stage', 'extraction-node-descend',
  'extraction-node-visit', 'narrow-phase-pair', 'placement-refresh-fragment',
  'tlas-broad-phase-query', 'whole-model-enumeration-start', 'whole-model-fragment-visit',
]);
const SPAN_LABEL_TO_STAGE = {
  'geometry-extraction': 'viewerExtraction',
  'weld': 'compactAndWeld',
  'geometry-weld': 'compactAndWeld',
  'connectivity': 'connectivity',
  'bvh-construction': 'bvhConstruction',
  'tlas-build': 'tlasBuildCacheQuery',
  'clearance-distance-query': 'clearanceDistanceQuery',
  'capacity-admission-commit': 'lifecycleValidationAndPublication',
};

// Task-review fix (Important #2b): `runR6Sequence`'s live "restored transform verified equal to T0"
// gate must actually CALL the real, NaN-safe `matricesEqual` from r6-calibration.mjs rather than
// reimplement the same tolerance logic inline inside its own `page.evaluate` callback -- otherwise
// fix #2a (rejecting non-finite elements) only ever takes effect in the unit-tested pure copy, never
// live. `test/` is not one of server.js's statically-served roots (only `wwwroot` and `/collision`
// are, confirmed by reading server.js), so the pure module cannot be `import()`-ed directly from
// inside the page the way `/collision/index.js` is. `page.exposeFunction` bridges the actual
// imported Node-side function into the browser as a callable (async) global instead, so the SAME
// function object this file imports above is what runs on every call -- not a duplicate. Exposed at
// most once per `page` (Playwright throws if the same name is registered twice on one page), tracked
// via a module-level WeakSet since `runR6Sequence` can be, and in Task 3.7 will be, called many times
// against the same long-lived page.
const pagesWithMatricesEqualExposed = new WeakSet();
async function ensureMatricesEqualExposed(page) {
  if (pagesWithMatricesEqualExposed.has(page)) return;
  await page.exposeFunction('__r6MatricesEqual', matricesEqual);
  pagesWithMatricesEqualExposed.add(page);
}

// §6.1 steps 1-2: identical 3-step load + identity re-confirmation to run-gate-m3.mjs:194-242,
// unchanged in shape (Architecture normal load, Structure/Mechanical as-additional via
// #keep-current-models, isLoadDone() AND getData().instanceTree waited on every model, live
// re-confirmation of model count and source dbId ownership -- "nothing taken on faith").
async function loadFixtureAndReconfirm(page) {
  await page.goto(`http://localhost:${PORT}/#${ARCH_URN}`);
  await page.waitForFunction(() => window.viewer && window.viewer.model && window.viewer.model.isLoadDone(), null, { timeout: 180_000 });

  await page.fill('#urn', STRUCTURE_URN);
  await page.check('#keep-current-models');
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 2 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  await page.fill('#urn', MECHANICAL_URN);
  await page.check('#keep-current-models'); // idempotent -- already checked, re-asserted defensively
  await page.click('#load');
  await page.waitForFunction(() => window.viewer.getAllModels().length === 3 && window.viewer.getAllModels().every((m) => m.isLoadDone()), null, { timeout: 180_000 });
  await page.waitForFunction(() => window.viewer.getAllModels().every((m) => m.getData() && m.getData().instanceTree), null, { timeout: 180_000 });

  // Resolve all three models by their own URN, never by load-order/array-index alone -- the same
  // discipline test/acceptance/clash-finder.acceptance.mjs:597-612 already applies to this EXACT
  // fixture (identical URN constants), because array position is not a stable model identity
  // (codex-review finding #1 on this task: a reordered getAllModels() could otherwise silently
  // pair the wrong discipline model with SOURCE_DB_ID). Order is still asserted below as a
  // secondary sanity check, matching that same file's own convention.
  const identity = await page.evaluate(({ sourceDbId, archUrn, structureUrn, mechanicalUrn }) => {
    const models = window.viewer.getAllModels();
    const modelArch = models.find((m) => m.getData()?.urn === archUrn);
    const modelStructure = models.find((m) => m.getData()?.urn === structureUrn);
    const modelMechanical = models.find((m) => m.getData()?.urn === mechanicalUrn);
    window.__gate = { modelArch, modelStructure, modelMechanical };
    const fragments = [];
    if (modelStructure) {
      modelStructure.getInstanceTree().enumNodeFragments(sourceDbId, (fragId) => { fragments.push(fragId); }, false);
    }
    return {
      modelCount: models.length,
      hasArch: !!modelArch,
      hasStructure: !!modelStructure,
      hasMechanical: !!modelMechanical,
      sourceFragmentCount: fragments.length,
    };
  }, { sourceDbId: SOURCE_DB_ID, archUrn: ARCH_URN, structureUrn: STRUCTURE_URN, mechanicalUrn: MECHANICAL_URN });
  if (identity.modelCount !== 3) {
    throw new Error(`Expected exactly 3 loaded models, got ${identity.modelCount}`);
  }
  if (!identity.hasArch || !identity.hasStructure || !identity.hasMechanical) {
    throw new Error(`Fixture identity mismatch: could not resolve all three discipline models by URN (hasArch=${identity.hasArch}, hasStructure=${identity.hasStructure}, hasMechanical=${identity.hasMechanical})`);
  }
  if (!identity.sourceFragmentCount) {
    throw new Error(`Fixture identity mismatch: source dbId ${SOURCE_DB_ID} in the Structure model owns zero fragments -- cannot exercise the query`);
  }
  return identity;
}

// §6.1 step 3: sacrificial, UNMEASURED warm-up -- identical rationale/shape to
// run-gate-m3.mjs:246-278, extended to both Hard-Clash (volume-overlap) and Soft-Clash
// (clearance) modes, each in its own disposable world, no recorder installed, disposed
// immediately. Warms V8 JIT / module-initialization cost for the shared code path without
// touching any later measured world's cold-start state.
async function sacrificialWarmup(page) {
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
            mode,
            ...(mode === 'clearance' ? { clearance } : {}),
            source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
            target: { targets: allModels.map((m) => ({ model: m })) },
            groupBy: 'dbId',
            broadPhase,
          });
        } catch { /* warm-up only -- any error here is irrelevant to later measured runs */ }
        w.dispose();
      }
    }
  }, { sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE });
}

// M4 Task 3.2's live half: the Node<->renderer clock calibration exchange, the CDP
// Input.dispatchMouseEvent dispatch loop, and the observation envelope bracketing those probes.
// Not yet wired into main()'s dispatch loop (task 3.7's job) -- these functions are added here,
// exported, and exercised only by this task's own manual verification scripts.
//
// Uses page.context().newCDPSession, matching Playwright's documented CDP session API. Uses
// Node's monotonic performance.now() (node:perf_hooks) for all Node-side scheduling and
// measurement -- never Date.now(), which is reserved for CDP's own wall-clock `timestamp`
// protocol field (Input.dispatchMouseEvent's TimeSinceEpoch).

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
async function captureClockCalibrationSample(page, markName = 'm4-input-probe-calibration') {
  const beforeNodeMs = performance.now();
  const rendererMs = await page.evaluate((name) => {
    performance.mark(name);
    // Task 3.7: cleared immediately. This function is called twice per measured query and the
    // real matrix runs many hundreds of them, so leaving every calibration mark in the page's own
    // performance timeline buffer would grow it without bound across one gate run (and, once the
    // buffer's default size is reached, silently start dropping entries -- including, potentially,
    // a later window's ANCHOR marks). Clearing the entry does not retract the trace event already
    // emitted for it; the trace side is unaffected.
    performance.clearMarks(name);
    return performance.now();
  }, markName);
  const afterNodeMs = performance.now();
  return {
    nodeMs: beforeNodeMs + (afterNodeMs - beforeNodeMs) / 2,
    rendererMs,
    roundTripMs: afterNodeMs - beforeNodeMs,
  };
}

// `shouldStop` (M4 Task 3.7 addition, optional -- omitting it reproduces Task 3.2's original
// behaviour exactly, which is what that task's own manual-verification script still relies on):
// §6.2 requires probes to run "from the pre-query anchor THROUGH the observation envelope", and
// the envelope's real close instant is not known when the schedule is computed -- it depends on
// when the query itself finishes. Rather than guess a duration, the live matrix passes a generous
// `durationMs` upper bound plus a predicate consulted once per scheduled slot; when the envelope
// has genuinely closed the loop stops issuing further slots. This is NOT the forbidden
// "await renderer acknowledgement before issuing the next probe" behaviour §6.2 rules out -- the
// predicate is a pure, synchronous read of Node-side state that never blocks on the renderer, and
// every slot the loop DOES reach is still dispatched on its own fixed, pre-computed instant.
async function dispatchInputProbeSequence(page, cdpSession, { canvasSelector, cadenceMs, startNodeMs, durationMs, shouldStop, onDispatch }) {
  const coords = []; // fixed, recorded sequence -- unique per probe, per §6.2
  const count = Math.ceil(durationMs / cadenceMs);
  for (let i = 0; i < count; i++) coords.push({ x: 100 + (i % 50), y: 100 + Math.floor(i / 50) });
  const box = await page.locator(canvasSelector).boundingBox();
  const dispatched = [];
  const sendPromises = []; // collected, not awaited per-iteration -- see the note below the loop
  // Every scheduled coord gets exactly ONE dispatched entry -- never skipped, even if Node's own
  // event loop falls behind schedule -- so a late slot is still counted and, if never handled,
  // correctly censored rather than silently dropped (dropping would undercount observations and
  // could mask a real stall as "too few samples" instead of a proper FAILURE/INDETERMINATE).
  for (let i = 0; i < coords.length; i++) {
    if (shouldStop && shouldStop()) break;
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
    // Real bug found running this task's own manual verification (b): the brief's own excerpt
    // stored the pre-offset, CANVAS-RELATIVE `coords[i]` here, but the in-page listener
    // (browser-probes-m4.mjs) records `ev.clientX,ev.clientY` -- VIEWPORT-ABSOLUTE coordinates,
    // i.e. exactly `x`/`y` above (box.x/box.y already added). Whenever the canvas isn't flush
    // against the viewport's top-left corner (true of this app -- a header bar pushes the canvas
    // down by its own height), the two coordinate spaces disagree and resolveInputProbeDispositions'
    // registry lookup key (`${d.coord.x},${d.coord.y}`) never matches a real recorded event, so
    // EVERY probe reads as censored (handled: false) regardless of whether it was actually
    // handled -- silently turning a real OK into a false FAILURE/INDETERMINATE. `coord` must carry
    // the same absolute coordinates that were actually dispatched (and thus the same ones the
    // in-page listener will record), not the pre-offset canvas-local ones.
    const entry = { coord: { x, y }, scheduledNodeMs, dispatchNodeMs };
    dispatched.push(entry);
    // M4 Task 3.7 addition: §6.1.7's envelope cannot decide "every dispatched probe has either had
    // its handler run or has exceeded the threshold" without seeing the probes AS THEY ARE ISSUED
    // -- this function only returns its list once the whole series is finished, which is after the
    // envelope needed the answer. `onDispatch` is a pure notification; it never gates the schedule.
    if (onDispatch) onDispatch(entry);
    sendPromises.push(sendPromise);
  }
  // Second real bug found verifying this task's own code (via a targeted empirical repro, not
  // manual verification (b) itself, which doesn't exercise this function): the brief's excerpt
  // did `await sendPromise` INSIDE the loop, immediately after each dispatch. Empirically,
  // `cdpSession.send('Input.dispatchMouseEvent', ...)`'s own promise does NOT resolve until the
  // renderer's main thread is free enough to accept it -- confirmed by direct measurement: during
  // a 500ms busy-loop block, a `send()` issued ~50ms in took ~450ms to resolve (i.e., it blocked
  // for essentially the rest of the stall). Awaiting that inline would have stalled THIS LOOP
  // itself for the same duration, so every subsequent probe's dispatch -- meant to be spread at
  // fixed cadence instants throughout the whole stall -- would instead be pushed out and clustered
  // right after the stall ends. Sample COUNT would still be correct (no coord ever skipped, since
  // `dispatched.push` already ran before any await), but the sample DISTRIBUTION would be
  // corrupted: only the one probe unlucky enough to be in flight when the stall began would
  // capture its true duration, while every later probe would read a small delay because it was
  // never actually dispatched until the renderer had already recovered -- silently understating
  // how bad the stall was to the p95 calculation this whole mechanism exists to feed correctly.
  // Collecting every send's promise and awaiting them all only after the fixed-cadence loop has
  // finished issuing every scheduled dispatch preserves the real-time schedule regardless of any
  // one send's CDP acknowledgement latency, while `Promise.all` below still surfaces a genuine
  // dispatch failure (e.g. a rejected CDP command) rather than silently swallowing it.
  await Promise.all(sendPromises);
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
// M4 Task 3.7 fix (independent-review finding, spec-grounded): the converted instant is the
// probe's INTENDED (scheduled) dispatch time, not the instant Node actually got around to issuing
// the CDP command. §6.2 is explicit -- "with the INTENDED dispatch timestamp taken in Node,
// outside the blocked renderer" -- and separately rules that "a slot whose dispatch could not be
// issued on time ... [is] recorded as censored observations", i.e. Node-side lateness is never
// allowed to quietly shorten the measured delay. Measuring from the late actual instant instead
// understates the delay by exactly however far Node's own event loop had fallen behind, which is
// worst precisely when the renderer is most blocked -- the condition T-c exists to detect. Each
// observation additionally carries `lateByMs` so Node-side scheduling lateness stays visible in
// the report rather than being folded silently into the renderer's score.
async function resolveInputProbeDispositions(page, registryHandle, dispatched, { thresholdMs, calibration }) {
  const rendererDispatched = dispatched.map((d) => ({
    coord: d.coord,
    dispatchedAtRendererMs: nodeMsToRendererMs(d.scheduledNodeMs, calibration),
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
  return raw.map((r, i) => ({
    ...applyClockUncertainty(dispositionForObservation({ ...r, thresholdMs }), calibration.uncertaintyMs, thresholdMs),
    lateByMs: dispatched[i].dispatchNodeMs - dispatched[i].scheduledNodeMs,
  }));
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

// =================================================================================================
// M4 Task 3.7: the real baseline matrix scheduler.
//
// Everything below this line is this task's own: the live CDP trace capture, the observation
// envelope that actually BRACKETS a measured query (Task 3.2 landed the envelope's parts but never
// wrapped a real query in them), §6.2's yield-attribution rules including the second
// ("un-attributable interval") rule, the Rᵢ/Hᵢ -> targets.Ta assembly, the case matrix, and the
// fresh-world dispatch loop that ties tasks 3.1-3.6 together.
// =================================================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- In-page gate helpers ---------------------------------------------------------------------
// Installed ONCE per page. Every later `page.evaluate` resolves a model by a STABLE STRING KEY
// through here rather than re-deriving `window.__gate.modelX` (and, for S2T, the live facade)
// inline in a dozen places -- and, critically, `modelTag` is defined in exactly one spot, so the
// signature convention Task 3.6's `compareRuns` joins on can never drift between two call sites.
// (This codebase has already hit the "signatures need model identity, not just dbId" bug three
// separate times; a single definition is the structural fix.)
async function installGateHelpers(page) {
  await page.evaluate(() => {
    if (window.__m4Gate) return;
    window.__m4Gate = {
      resolveModel(key) {
        const g = window.__gate;
        if (key === 'arch') return g.modelArch;
        if (key === 'structure') return g.modelStructure;
        if (key === 'mechanical') return g.modelMechanical;
        if (key === 's2tFacade') {
          if (!g.s2tFacade) throw new Error('__m4Gate.resolveModel: no S2T facade is installed for this tuple');
          return g.s2tFacade;
        }
        if (key === 's4Source') {
          if (!g.s4Source) throw new Error('__m4Gate.resolveModel: no S4 source facade is installed for this tuple');
          return g.s4Source;
        }
        if (key === 's4Target') {
          if (!g.s4Target) throw new Error('__m4Gate.resolveModel: no S4 target facade is installed for this tuple');
          return g.s4Target;
        }
        throw new Error(`__m4Gate.resolveModel: unknown model key "${key}"`);
      },
      modelTag(m) {
        const g = window.__gate;
        if (m === g.modelArch) return 'arch';
        if (m === g.modelStructure) return 'structure';
        if (m === g.modelMechanical) return 'mechanical';
        if (g.s2tFacade && m === g.s2tFacade) return 's2tFacade';
        if (g.s4Source && m === g.s4Source) return 's4Source';
        if (g.s4Target && m === g.s4Target) return 's4Target';
        return 'unknown';
      },
      // §6.4 joins diagnostics on `modelTag`, explicitly "rather than modelId, which is documented
      // as reused-under-collision-prone". `CollisionWorld`'s own diagnostics carry `modelId`
      // (CollisionWorld.js:107's `fragment: { modelId, dbId, fragId }`), so the translation has to
      // happen HERE, in the page, while the real Model objects are still reachable -- a Node-side
      // remap would have nothing but the collision-prone id to work from.
      tagDiagnostics(diagnostics) {
        const g = window.__gate;
        const idOf = (m) => (m && m.id !== undefined ? m.id : m);
        const byId = new Map();
        for (const [tag, model] of [['arch', g.modelArch], ['structure', g.modelStructure], ['mechanical', g.modelMechanical], ['s2tFacade', g.s2tFacade], ['s4Source', g.s4Source], ['s4Target', g.s4Target]]) {
          if (model) byId.set(idOf(model), tag);
        }
        // `modelId` is KEPT alongside the tag, not replaced by it (independent-review finding,
        // High): §6.4 joins diagnostics on `modelTag`, but §5.3.1's S2T control rule
        // (`checkS2TLevelToLevelControlRule`, browser-probes-m4.mjs) identifies a synthetic-fragment
        // leak by `ref.modelId === lvl.targetModelId`. Dropping `modelId` here made that check
        // compare `undefined === <facade id>` -- always false -- so the leak test could never fire
        // and the control rule would report a clean pass however badly a bystander leaked.
        const retag = (ref) => (ref ? { modelTag: byId.get(ref.modelId) ?? 'unknown', modelId: ref.modelId, dbId: ref.dbId, fragId: ref.fragId } : null);
        return diagnostics.map((d) => ({
          reason: d.reason, scope: d.scope, role: d.role ?? null,
          fragment: retag(d.fragment), sourceFragment: retag(d.sourceFragment), targetFragment: retag(d.targetFragment),
        }));
      },
      // §6.4's witness tolerance is `1e-9 × max(sourceWorldDiagonal, targetWorldDiagonal)` -- a
      // PER-PAIR scale. Task 3.6's `compareRuns` takes one scalar per call, so this returns the
      // diagonal PER MODEL TAG and the caller partitions its pair sets by
      // `(sourceModelTag, targetModelTag)`, calling `compareRuns` once per partition with that
      // partition's own exact `max(diagonalByTag[src], diagonalByTag[tgt])`. A single
      // federation-wide maximum -- the obvious shortcut -- is `>=` every real pairwise scale, so it
      // would admit witness mismatches the canonical comparator forbids; the partitioned form is
      // strictly stricter and needs no change to Task 3.6's reviewed interface.
      //
      // The diagonal is the union of the model's own FRAGMENT WORLD BOUNDS
      // (`fragList.getWorldBounds`), deliberately not `model.getBoundingBox()`: world bounds are
      // unambiguously placement-aware (they are what the collision library's own broad phase reads,
      // and what R6 mutates via `setPlacementTransform`), whereas whether `getBoundingBox()`
      // reflects the live placement transform is not something this harness can assert from the
      // Viewer's public contract. `isNotLoaded` fragments are skipped, matching the profiling
      // pass's own rule.
      worldDiagonalsByTag() {
        const g = window.__gate;
        const out = {};
        const box = new window.THREE.Box3();
        for (const [tag, model] of [['arch', g.modelArch], ['structure', g.modelStructure], ['mechanical', g.modelMechanical], ['s2tFacade', g.s2tFacade], ['s4Source', g.s4Source], ['s4Target', g.s4Target]]) {
          if (!model) continue;
          const fragList = model.getFragmentList();
          const count = fragList.getCount();
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          for (let f = 0; f < count; f++) {
            if (fragList.isNotLoaded && fragList.isNotLoaded(f)) continue;
            fragList.getWorldBounds(f, box);
            for (let i = 0; i < 3; i++) {
              const lo = box.min.getComponent(i);
              const hi = box.max.getComponent(i);
              if (Number.isFinite(lo) && lo < min[i]) min[i] = lo;
              if (Number.isFinite(hi) && hi > max[i]) max[i] = hi;
            }
          }
          const d = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
          out[tag] = Number.isFinite(d) && d > 0 ? d : null;
        }
        return out;
      },
    };
  });
}

// ---- Live CDP trace session (§6.2's pinned configuration) --------------------------------------
// One session per measured query, opened immediately before the envelope's own opening mark and
// closed immediately after its closing mark. Listeners are attached and DETACHED per session: a
// single long-lived `cdp.on` would keep accumulating every later session's events into the first
// session's array (Playwright's CDPSession is an EventEmitter and never de-registers on its own),
// which would silently make every window after the first look like it contained every earlier
// window's tasks.
async function startTraceSession(cdp) {
  const traceEvents = [];
  let dataLossOccurred = null;
  const onData = ({ value }) => { traceEvents.push(...value); };
  let resolveComplete;
  const complete = new Promise((r) => { resolveComplete = r; });
  const onComplete = (params) => { dataLossOccurred = params.dataLossOccurred === true; resolveComplete(); };
  cdp.on('Tracing.dataCollected', onData);
  cdp.on('Tracing.tracingComplete', onComplete);
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATEGORIES },
  });
  return {
    async stop() {
      try {
        await cdp.send('Tracing.end');
        await complete;
      } finally {
        cdp.off('Tracing.dataCollected', onData);
        cdp.off('Tracing.tracingComplete', onComplete);
      }
      return { traceEvents, dataLossOccurred };
    },
  };
}

// ---- §6.2's TWO yield-attribution rules --------------------------------------------------------
//
// Rule 1 (already implemented, pure, Task 2.2's addendum): "any reconstructed interval that
// overlaps a recorded yield is SPLIT at that yield's boundaries, and only the resulting
// sub-segments are treated as stage-attributed time" -- `splitIntervalAroundYields`.
//
// Rule 2 (implemented HERE, no prior task owns it): "Where a stage's span overlaps a yield whose
// own boundaries WERE NOT RECORDED, that stage contributes no attributed interval and the report
// says so, rather than contributing an interval that may be wrong."
//
// The mechanical question rule 2 turns on is: for THIS interval's entire span, was the yield
// recorder continuously installed, so that every yield inside it is guaranteed to be in
// `yieldRecords`? The harness controls that instant exactly -- it calls `setYieldRecorder`
// immediately before the opening mark and `clearYieldRecorder` immediately after the closing mark,
// inside the SAME page.evaluate turn as the query, and returns both instants
// (`recorderInstalledAtMs` / `recorderClearedAtMs`) on the renderer's own clock. So:
//
//   an interval is ATTRIBUTABLE  <=>  installedAtMs <= interval.startMs && interval.endMs <= clearedAtMs
//
// A stage interval reconstructed as `[receiptMs - durationMs, receiptMs]` can genuinely start
// before the install instant, and this is not hypothetical: `GeometryRegistry`'s build phases
// ('weld' / 'connectivity' / 'bvh-construction') are world-scoped and asynchronous, so a build
// triggered by a tuple's COLD query can still be resolving when its WARM query's window opens --
// the span's receipt lands inside the warm window while its reconstructed start lies before that
// window's recorder was installed. Every yield in that earlier portion reported to nobody
// (`collision/scheduler.js`'s `yieldAndRecordResume` only records when a recorder is installed at
// yield START, and its `_yieldRecorderGeneration` guard additionally silences any yield that was
// in flight across an install/clear), so splitting such an interval on the yields we DO have would
// leave the unrecorded ones folded in as if they were synchronous stage time -- exactly the
// "shrink Rᵢ and qualify a boundary that does not deserve it" failure §6.2 names.
//
// The excluded interval is NEVER estimated, interpolated, clipped to the covered part, or allowed
// to contribute unsplit: it is dropped from the Rᵢ input entirely and reported by name.
function partitionStageIntervalsByAttributability(stageIntervals, { recorderInstalledAtMs, recorderClearedAtMs }) {
  const attributable = [];
  const unattributable = [];
  for (const interval of stageIntervals) {
    const covered = recorderInstalledAtMs <= interval.startMs && interval.endMs <= recorderClearedAtMs;
    if (covered) attributable.push(interval);
    else {
      unattributable.push({
        stage: interval.stage,
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMs: interval.endMs - interval.startMs,
        reason: interval.startMs < recorderInstalledAtMs
          ? 'span-starts-before-yield-recorder-install'
          : 'span-ends-after-yield-recorder-clear',
      });
    }
  }
  return { attributable, unattributable };
}

// Exported for direct unit testing: this is §6.2's second yield rule, the one piece of this task's
// logic no earlier task's brief, implementation, or review covers, and it is verdict-bearing (a
// wrongly-INCLUDED interval shrinks Rᵢ and can qualify a worker boundary that does not deserve it;
// a wrongly-EXCLUDED one inflates Rᵢ and can disqualify one that does). See
// test/performance/m4/yield-attribution.test.mjs.
export { partitionStageIntervalsByAttributability, spanRecordsToStageRecords, SPAN_LABEL_TO_STAGE, CHECKPOINT_SPAN_LABELS };

// Maps `collision/`'s own `(label, ms)` span records onto §6.3's stage names, dropping (and
// naming) any label the fixed table does not cover rather than letting `classifyStageForScreen`
// throw mid-run or -- far worse -- silently guessing a classification for it.
function spanRecordsToStageRecords(spanRecords) {
  const stageRecords = [];
  const unmappedSpanLabels = new Set();
  // §6.2's scheduler-conformance metric: "the maximum inter-checkpoint span ACROSS EVERY CHECKPOINT
  // LABEL -- not one primitive, which is what let M3 report 6.10 ms where the same runs' worst
  // bracketed span was 12.2 ms". Reported alongside, never unioned into stage attribution.
  let maxInterCheckpointSpanMs = null;
  let maxInterCheckpointSpanLabel = null;
  for (const s of spanRecords) {
    if (CHECKPOINT_SPAN_LABELS.has(s.label)) {
      if (maxInterCheckpointSpanMs === null || s.ms > maxInterCheckpointSpanMs) {
        maxInterCheckpointSpanMs = s.ms;
        maxInterCheckpointSpanLabel = s.label;
      }
      continue;
    }
    const stage = SPAN_LABEL_TO_STAGE[s.label];
    if (!stage) { unmappedSpanLabels.add(s.label); continue; }
    stageRecords.push({ stage, receiptMs: s.receiptMs, durationMs: s.ms });
  }
  return {
    stageRecords, unmappedSpanLabels: [...unmappedSpanLabels],
    schedulerConformance: { maxInterCheckpointSpanMs, maxInterCheckpointSpanLabel },
  };
}

// ---- §7.3's Rᵢ/Hᵢ -> targets.Ta assembly -------------------------------------------------------
//
// Produces the tuple's T-a evidence, as FOUR SEPARATE AXES rather than one overloaded field.
//
// SHAPE, and why it is this shape (flagged in this task's report): the brief's controller-added
// section asks for "targets.Ta with a numeric Rᵢ/Hᵢ-derived value, or an explicit
// UNEVALUABLE/un-attributable reason", while the ALREADY-LANDED Task 2.4
// (`decision-evidence-model.mjs:72`) requires `targets.tA` to be a BOOLEAN and takes the numerics
// as separate inputs (`screenResidualMs`, `boundaries[].residualMs`/`occupancyMs`). They are
// genuinely different quantities and collapsing them into one field is what an independent review
// of this design flagged first: T-a is decided SOLELY by the maximum CDP main-thread task versus
// 50 ms; the duty cycle is §6.2's X-2; `Rᵢ` is §7.3 condition 3/4(b)'s residual; `Hᵢ` is a
// worker-boundary occupancy. So this returns
//   { tA: {status,pass,maxTaskMs,reason}, dutyCycle: {...}, screenResidualMs, boundaries: [...] }
// and task 3.8 maps them across one-for-one.
//
// **`Hᵢ` is `null` here, never `0`, and that is load-bearing.** Phase 3's baseline gate has no
// worker: no `postMessage`, no `onmessage` correlation mark, no receipt/deserialization sub-marks,
// and therefore no delivery task. `computeBoundaryOccupancy` is still CALLED (the brief requires
// Hᵢ to come from it, and its `deliveryTaskIdentified: false` is the honest answer for a worker-less
// window) and its result is reported as a diagnostic, but the per-boundary `occupancyMs` handed
// forward stays `null`. Writing a numeric `0` there instead would make Task 2.4 evaluate
// `Rᵢ + 0 <= 50 ms` and hand back SUFFICIENT for a boundary whose real crossing cost was never
// measured at all -- manufacturing worker evidence out of a run that contains no worker.
function assembleTargetsTa({
  traceEvents, dataLossOccurred, clockSamples, pageTargetId,
  spanRecords, yieldRecords, recorderInstalledAtMs, recorderClearedAtMs, openingMs, closingMs,
}) {
  const { stageRecords, unmappedSpanLabels, schedulerConformance } = spanRecordsToStageRecords(spanRecords);

  const parsed = parseTraceAndClock({
    traceEvents, clockSamples, stageRecords, pageTargetId, dataLossOccurred,
    acceptedTopLevelTaskNames: TOP_LEVEL_TASK_NAMES,
  });
  const unevaluable = (reason) => ({
    tA: { status: 'UNEVALUABLE', pass: null, maxTaskMs: null, reason },
    dutyCycle: { status: 'UNEVALUABLE', value: null, reason },
    screenResidualMs: null,
    boundaries: Object.entries(BOUNDARY_TABLE).map(([id, meta]) => ({
      id, class: meta.class, residualMs: null, occupancyMs: null, deliveryTaskIdentified: null,
    })),
    unattributableStageIntervals: [],
    unattributableStageTimeMs: 0,
    unmappedSpanLabels,
    schedulerConformance,
    reason,
  });

  if (!parsed.valid) return unevaluable(parsed.reason);

  const taskIntervals = parsed.intervals.filter((i) => i.source === 'cdp-task');
  const rawStageIntervals = parsed.intervals.filter((i) => i.source === 'harness-stage');

  // A window with ZERO top-level task intervals is NOT a window with no main-thread work -- it is
  // a window whose task events this build names something the accepted-name list does not cover
  // (exactly the failure mode `TOP_LEVEL_TASK_NAMES`' own comment documents). Reporting T-a as a
  // confident numeric pass off an empty task set would be the single worst outcome this whole
  // pipeline can produce, so it fails closed instead.
  if (taskIntervals.length === 0) return unevaluable('no-top-level-task-events');

  // (§6.2's "each instant belongs to exactly ONE task" is enforced upstream, inside
  // `parseTraceAndClock`, which now returns `crossing-top-level-tasks` for a non-well-nested
  // candidate pair. It has to be checked there, on the raw candidates: by the time the selected
  // intervals reach here the crossing member has already been dropped and what survives is
  // non-overlapping by construction, so an overlap check on this side could never fire.)

  // §6.2 rule 2, then rule 1 -- in that order. An interval excluded by rule 2 is never split.
  const { attributable, unattributable } = partitionStageIntervalsByAttributability(
    rawStageIntervals, { recorderInstalledAtMs, recorderClearedAtMs },
  );
  const yieldIntervals = yieldRecordsToIntervals(yieldRecords);
  const splitStageIntervals = attributable.flatMap((i) => splitIntervalAroundYields(i, yieldIntervals));

  // Defence in depth against a stage name §6.3's table does not classify reaching the engine (it
  // throws): the mapping table above already guarantees this, but a future label added to
  // SPAN_LABEL_TO_STAGE with a typo would otherwise abort a multi-minute run mid-matrix.
  const classifiable = splitStageIntervals.filter((i) => {
    try { classifyStageForScreen(i.stage); return true; } catch { unmappedSpanLabels.push(i.stage); return false; }
  });

  const windowMs = closingMs - openingMs;
  const maxTaskMs = Math.max(...taskIntervals.map((t) => t.endMs - t.startMs));
  const residualAllMs = computeResidualAll(taskIntervals, classifiable);

  // §7.3 condition 4(b)'s per-boundary residual, for every §8.2 boundary Task 2.4 already tables.
  const perBoundaryResidualMs = {};
  for (const [id, meta] of Object.entries(BOUNDARY_TABLE)) {
    perBoundaryResidualMs[id] = computeResidualForBoundary(taskIntervals, classifiable, meta.ownedStages);
  }

  // Hᵢ -- §7.3 condition 4(b) / §6.2's worker-response delivery-task correlation. Called through
  // the real engine (never a substituted constant) so this run exercises the same code path every
  // later worker-bearing caller will, and so the answer for a worker-less window is stated by the
  // engine itself rather than assumed. With no correlation mark and no sub-marks it necessarily
  // reports `{ value: 0, deliveryTaskIdentified: false }` -- kept as a DIAGNOSTIC only; see this
  // function's header for why the per-boundary `occupancyMs` handed forward is `null`, not that 0.
  const baselineOccupancyProbe = computeBoundaryOccupancy(taskIntervals, [], null, closingMs);

  // §6.2's X-2: "Σ(task durations from the CDP trace within the marked window) ÷ WINDOW DURATION"
  // -- the denominator is the marked query window itself, never the span of the tasks that happen
  // to fall in it (which would report ~1.0 for any window whose first and last tasks bracket it).
  // Every task interval is already clipped to the window by `parseTraceAndClock`.
  const taskSumMs = taskIntervals.reduce((acc, t) => acc + (t.endMs - t.startMs), 0);

  return {
    tA: { status: 'DETERMINED', pass: maxTaskMs <= TA_MAX_TASK_MS, maxTaskMs, reason: null },
    dutyCycle: {
      status: windowMs > 0 ? 'DETERMINED' : 'UNEVALUABLE',
      value: windowMs > 0 ? taskSumMs / windowMs : null,
      reason: windowMs > 0 ? null : 'non-positive-query-window',
    },
    screenResidualMs: residualAllMs,            // §7.3 condition 3's boundary-independent screen, Rᵢ(all,τ)
    boundaries: Object.entries(BOUNDARY_TABLE).map(([id, meta]) => ({
      id, class: meta.class,
      residualMs: perBoundaryResidualMs[id],    // §7.3 condition 4(b)'s Rᵢ(w,τ)
      occupancyMs: null,                        // Hᵢ -- no worker in the baseline; see header
      deliveryTaskIdentified: null,
    })),
    taskCount: taskIntervals.length,
    taskSumMs,
    stageIntervalCount: classifiable.length,
    yieldCount: yieldRecords.length,
    unattributableStageIntervals: unattributable,
    unattributableStageTimeMs: unattributable.reduce((a, u) => a + u.durationMs, 0),
    unmappedSpanLabels,
    schedulerConformance,
    baselineOccupancyProbe,
    windowMs,
    reason: null,
  };
}

// ---- §7.2's T-b1 / T-b2, from the rAF cadence recorder -----------------------------------------
// Measured over §6.1.7's whole observation ENVELOPE (never stopped at the closing mark), so the
// interval that SPANS the query is always among the samples -- that interval is the single most
// important one T-b2 exists to catch.
function summarizeFrameIntervals(frameIntervals, { postQueryFrameObserved }) {
  if (!postQueryFrameObserved) {
    return { status: 'INDETERMINATE', reason: 'no post-query rAF callback fired before the envelope limit', tB1: null, tB2: null, count: frameIntervals.length };
  }
  if (frameIntervals.length === 0) {
    return { status: 'INDETERMINATE', reason: 'no inter-frame intervals observed', tB1: null, tB2: null, count: 0 };
  }
  const sorted = [...frameIntervals].sort((a, b) => a - b);
  const p95Ms = nearestRankPercentile(sorted, 0.95);
  const maxMs = sorted[sorted.length - 1];
  return {
    status: 'DETERMINED', reason: null,
    p95Ms, maxMs, count: sorted.length,
    over32: sorted.filter((v) => v > 32).length,
    over100: sorted.filter((v) => v > 100).length,
    tB1: p95Ms <= TB1_P95_INTERVAL_MS,
    tB2: maxMs <= TB2_MAX_GAP_MS,
  };
}

// ---- §6.4's canonical comparator, applied at the PER-MODEL-PAIR witness scale ------------------
//
// §6.4's witness rule is scale-relative and PER PAIR: `1e-9 × max(sourceWorldDiagonal,
// targetWorldDiagonal)`. Task 3.6's `compareRuns` takes one `worldDiagonalScale` scalar per call,
// which is exactly right for a single-model comparison but cannot express a per-pair scale over a
// three-model federation in one call. Feeding it the federation-wide maximum would be `>=` every
// real pairwise scale -- i.e. a strictly MORE PERMISSIVE tolerance than §6.4 mandates, admitting
// witness disagreements the canonical comparator is supposed to reject.
//
// So the comparison runs twice, and both must hold:
//   1. ONE whole-run `compareRuns` -- authoritative for pairSet / statistics / diagnostics /
//      distances, none of which is scale-dependent. It is passed the federation-wide maximum,
//      which is irrelevant to those four fields (only `witnesses` reads the scale).
//   2. ONE `compareRuns` per `(sourceModelTag, targetModelTag)` partition, each carrying that
//      partition's own EXACT `max(diagonalByTag[src], diagonalByTag[tgt])`; only `fields.witnesses`
//      is taken from these.
// The result is strictly stricter than (1) alone and needs no change to Task 3.6's reviewed
// interface. A partition whose scale cannot be resolved to a finite positive number is a hard
// failure, never a silently-substituted default -- an unknown scale means an unknown tolerance.
function compareRunsAtPairScale(runA, runB, diagonalByTag) {
  const finite = Object.values(diagonalByTag).filter((d) => Number.isFinite(d) && d > 0);
  const federationMax = finite.length ? Math.max(...finite) : null;
  if (federationMax === null) {
    return { valid: false, fields: { worldDiagonalScaleResolved: false }, partitions: [], federationMax: null };
  }
  // Independent-review finding (High): BOTH sides of a partition must have a real scale. §6.4's
  // tolerance is `1e-9 x max(sourceWorldDiagonal, targetWorldDiagonal)`; falling back to whichever
  // single side happens to be known silently substitutes a different, and possibly much smaller,
  // tolerance than the rule specifies -- which for S2T (whose facade extends to coordinate
  // ~1,000,000, so its diagonal dwarfs Structure's ~314) would mean comparing against the SOURCE's
  // scale alone and aborting the run on witness differences that are well inside the required
  // target-relative tolerance. A missing scale is now an explicit failure with a named reason, not
  // a quiet downgrade.

  const whole = compareRuns(runA, runB, { worldDiagonalScale: federationMax });

  const partitionKeys = new Set([...runA.pairs, ...runB.pairs].map((p) => `${p.sourceModelTag}|${p.targetModelTag}`));
  const partitions = [];
  let witnessesOk = true;
  for (const key of partitionKeys) {
    const [sourceTag, targetTag] = key.split('|');
    const sd = diagonalByTag[sourceTag];
    const td = diagonalByTag[targetTag];
    const missing = [[sourceTag, sd], [targetTag, td]].filter(([, d]) => !(Number.isFinite(d) && d > 0)).map(([t]) => t);
    if (missing.length > 0) {
      partitions.push({ key, scale: null, witnesses: false, reason: `no finite positive world diagonal for: ${missing.join(', ')}` });
      witnessesOk = false;
      continue;
    }
    const scale = Math.max(sd, td);
    const subA = { pairs: runA.pairs.filter((p) => `${p.sourceModelTag}|${p.targetModelTag}` === key), statistics: runA.statistics };
    const subB = { pairs: runB.pairs.filter((p) => `${p.sourceModelTag}|${p.targetModelTag}` === key), statistics: runB.statistics };
    const sub = compareRuns(subA, subB, { worldDiagonalScale: scale });
    partitions.push({ key, scale, witnesses: sub.fields.witnesses, pairCount: subA.pairs.length });
    if (!sub.fields.witnesses) witnessesOk = false;
  }

  return {
    valid: whole.fields.pairSet && whole.fields.statistics && whole.fields.diagnostics && whole.fields.distances && witnessesOk,
    fields: { ...whole.fields, witnesses: witnessesOk, witnessesAtFederationScale: whole.fields.witnesses },
    partitions,
    federationMax,
  };
}

// ---- The one measured query, in the page -------------------------------------------------------
//
// EVERYTHING that must be atomic with respect to the query happens inside this single
// `page.evaluate` turn: recorder installation, the opening `performance.mark` and its paired
// `performance.now()` sample, the query itself, the closing mark and its paired sample, and
// recorder teardown. Splitting these across separate Node round trips (the obvious alternative)
// would put a full CDP round trip -- typically 0.5-2 ms, and unboundedly more while the renderer
// is blocked, which is precisely the condition being measured -- between the mark and the query
// on both ends, inflating the window by an amount that grows with the very stall the window
// exists to measure. Node still observes the query concurrently: the input probes go over CDP
// `Input.dispatchMouseEvent` (never through `page.evaluate`) and the trace runs in the browser.
//
// `world` is a Playwright JSHandle to the live in-page CollisionWorld the CALLER constructed and
// will dispose (§6.1.4's one-fresh-world-per-tuple lifecycle) -- the same contract Task 3.5's
// `runR6Sequence` established and this function now generalises to every case.
//
// A `CapacityExceededError` is caught HERE, in the page, and returned as data. It must never be
// allowed to propagate across the evaluate boundary: Playwright reconstructs a thrown in-page
// Error on the Node side from its message and stack ONLY -- every custom own-property is dropped
// -- and `CapacityExceededError` puts its entire payload on own properties
// (`collision/errors.js:121`: `Object.assign(this, details)`), so the `limit`/`attempted`/
// `requested` values §4 requires the report to name by exact value would be silently lost.
async function runQueryInPage(page, world, descriptor) {
  return page.evaluate(async ({ descriptor, world }) => {
    const sched = await import('/collision/scheduler.js');
    const G = window.__m4Gate;
    const sourceModel = G.resolveModel(descriptor.source.modelKey);
    const targets = descriptor.targets === 'all'
      ? window.viewer.getAllModels().map((m) => ({ model: m }))
      : descriptor.targets.map((k) => ({ model: G.resolveModel(k) }));

    const spanRecords = [];
    const yieldRecords = [];
    let diagnosticEventCount = 0;

    // §16.4's already-landed instrumentation, all three hooks, installed for this window only.
    // `receiptMs` is a harness-side `performance.now()` taken AT RECEIPT -- §7.3 condition 3's own
    // prescribed mechanism ("The harness timestamps each recorder callback at receipt with
    // performance.now() ... giving every reported stage the interval [end − ms, end] on the same
    // clock the query's performance.mark pair anchors to the CDP trace"). No library change.
    sched.setSpanRecorder((label, ms) => { spanRecords.push({ label, ms, receiptMs: performance.now() }); });
    sched.setYieldRecorder((resumeLatencyMs) => { yieldRecords.push({ resumeLatencyMs, receiptMs: performance.now() }); });
    sched.setDiagnosticEventRecorder(() => { diagnosticEventCount++; });
    const recorderInstalledAtMs = performance.now();

    // §6.2's paired clock sample IS the anchor mark ("one mechanism, not two"). `performance.mark`
    // RETURNS the PerformanceMark it just created, so `.startTime` is the mark's own instant
    // exactly -- not a `performance.now()` read taken a statement later, which would pair the
    // trace-side event with a very slightly different renderer instant on both ends of every
    // window (a small but entirely avoidable systematic error in the linear clock map Task 2.1
    // fits between the two anchors).
    const openingMs = performance.mark('m4-query-window-start').startTime;

    let raw = null;
    let capacityError = null;
    let otherError = null;
    try {
      raw = await world.findClashes({
        mode: descriptor.mode,
        ...(descriptor.clearance !== undefined ? { clearance: descriptor.clearance } : {}),
        source: { model: sourceModel, dbIds: descriptor.source.dbIds },
        target: { targets },
        groupBy: 'dbId',
        broadPhase: descriptor.broadPhase,
      });
    } catch (err) {
      if (err && err.name === 'CapacityExceededError') {
        capacityError = { name: err.name, kind: err.kind, message: err.message, ...Object.fromEntries(Object.entries(err)) };
      } else {
        otherError = { name: err?.name ?? 'Error', message: err?.message ?? String(err), stack: err?.stack ?? null };
      }
    }

    const closingMs = performance.mark('m4-query-window-end').startTime;

    sched.clearSpanRecorder();
    sched.clearYieldRecorder();
    sched.clearDiagnosticEventRecorder();
    const recorderClearedAtMs = performance.now();
    // The trace events for both anchors have already been emitted; clearing only the page's own
    // performance-timeline entries keeps that buffer from growing across the whole matrix run
    // (hundreds of windows) and, once full, silently dropping a LATER window's anchor entries.
    performance.clearMarks('m4-query-window-start');
    performance.clearMarks('m4-query-window-end');

    const run = raw === null ? null : {
      pairs: raw.pairs.map((p) => ({
        sourceModelTag: G.modelTag(p.source.model), sourceDbId: p.source.dbId,
        targetModelTag: G.modelTag(p.target.model), targetDbId: p.target.dbId,
        type: p.type,
        distance: p.distance ?? null,
        witness: p.witness ?? null,
      })),
      statistics: {
        clearanceExactAabbSurvivors: raw.statistics.clearanceExactAabbSurvivors,
        narrowPhasePairs: raw.statistics.narrowPhasePairs,
        clearanceOverlapPrechecksRun: raw.statistics.clearanceOverlapPrechecksRun,
        clearanceHardClashExclusions: raw.statistics.clearanceHardClashExclusions,
        clearanceDistanceQueriesRun: raw.statistics.clearanceDistanceQueriesRun,
        clearanceHits: raw.statistics.clearanceHits,
        broadPhasePairs: raw.statistics.broadPhasePairs ?? null,
        tlasBuilds: raw.statistics.tlasBuilds ?? null,
        diagnostics: G.tagDiagnostics(raw.statistics.diagnostics ?? []),
      },
      extractedSourceInstances: raw.statistics.sourceInstances ?? null,
    };

    return {
      openingMs, closingMs, recorderInstalledAtMs, recorderClearedAtMs,
      makespanMs: closingMs - openingMs,
      spanRecords, yieldRecords, diagnosticEventCount,
      run, capacityError, otherError,
    };
  }, { descriptor, world });
}

// ---- §6.1.7's observation envelope, wrapped around ONE measured query ---------------------------
//
// Sequence: install observers -> pre-query anchor (one observed rAF callback AND one completed
// input-probe round trip, per §6.1.7) -> pre-window clock calibration -> open the CDP trace session
// -> run the bracketed query (above) while dispatching probes at the fixed 100 ms cadence -> hold
// the envelope open until all of {closing mark passed, >=1 post-query rAF, every probe handled or
// past T-c's threshold} or the envelope's own `max(2 x window, 5 s)` limit -> close the trace ->
// post-window calibration -> resolve dispositions.
async function runMeasuredQueryWindow(page, cdp, { pageTargetId, world, descriptor, label }) {
  const registryHandle = await installInputProbeRegistry(page, CANVAS_SELECTOR);
  const rafHandle = await page.evaluateHandle(() => window.__m4Probes.startRafRecorder());
  const box = await page.locator(CANVAS_SELECTOR).boundingBox();

  const envelope = { limitReached: false, postQueryFrameObserved: false, anchorRafObserved: false, anchorProbeHandled: false };
  let trace = null;
  // Declared OUTSIDE the try (independent-review finding): if the query's own `page.evaluate`
  // rejects, nothing on the normal path ever sets `envelope.closed`, so the unawaited 10-minute
  // probe schedule would keep running long after the registry, the trace session and possibly the
  // browser had been torn down -- keeping the process alive and turning later CDP sends into
  // unhandled rejections. The `finally` below now always closes the envelope and awaits the loop's
  // settlement before disposing anything it touches.
  let probesPromise = null;
  try {
    // -- Pre-query anchor: one observed rAF callback ------------------------------------------
    const anchorDeadline = performance.now() + 2000;
    while (performance.now() < anchorDeadline) {
      const snap = await rafHandle.evaluate((r) => r.snapshot());
      if (snap.frameCount >= 1) { envelope.anchorRafObserved = true; break; }
      await sleep(16);
    }

    // -- Pre-query anchor: one completed input-probe round trip --------------------------------
    const anchorCoord = { x: Math.round(box.x + 10), y: Math.round(box.y + 10) };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: anchorCoord.x, y: anchorCoord.y, timestamp: Date.now() / 1000 });
    const probeAnchorDeadline = performance.now() + 2000;
    while (performance.now() < probeAnchorDeadline) {
      const handled = await page.evaluate(({ h, key }) => window.__m4Probes.getInputProbeRegistry(h).handledAt.has(key), { h: registryHandle, key: `${anchorCoord.x},${anchorCoord.y}` });
      if (handled) { envelope.anchorProbeHandled = true; break; }
      await sleep(10);
    }

    const preSample = await captureClockCalibrationSample(page);
    trace = await startTraceSession(cdp);

    // -- The bracketed query, and the concurrent fixed-cadence probe series --------------------
    let queryDone = false;
    const queryPromise = runQueryInPage(page, world, descriptor).then((r) => { queryDone = true; return r; });

    const probeStartNodeMs = performance.now();
    const dispatchedSoFar = [];
    // `durationMs` is an upper bound only -- `shouldStop` ends the series as soon as the envelope
    // has genuinely closed. 10 minutes is far above any plausible single-query window and exists
    // purely so the pre-computed coordinate schedule is never the thing that runs out first.
    probesPromise = dispatchInputProbeSequence(page, cdp, {
      canvasSelector: CANVAS_SELECTOR, cadenceMs: PROBE_CADENCE_MS, startNodeMs: probeStartNodeMs,
      durationMs: 600_000,
      shouldStop: () => envelope.closed === true,
      onDispatch: (entry) => dispatchedSoFar.push(entry),
    });

    const queryResult = await queryPromise;
    const closingNodeMs = performance.now();
    const windowMs = queryResult.makespanMs;
    // §6.1.7: `max(2 x the query window's own duration, 5 s)`, measured FROM THE CLOSING MARK. It
    // is a TIMEOUT, not a mandatory dwell -- the loop below exits the instant the envelope's three
    // real closing conditions hold, which for a healthy query is within a frame or two. (Sitting
    // out the full limit on every window would add well over an hour to the S2 sweep alone.)
    const limitMs = envelopeLimitMs(windowMs);

    const frameCountAtClose = (await rafHandle.evaluate((r) => r.snapshot())).frameCount;
    // -- Hold the envelope open until §6.1.7's three closing conditions, or its own limit --------
    while (true) {
      if (performance.now() - closingNodeMs >= limitMs) { envelope.limitReached = true; break; }
      const snap = await rafHandle.evaluate((r) => r.snapshot());
      if (snap.frameCount > frameCountAtClose) envelope.postQueryFrameObserved = true;
      // "every dispatched input probe has either had its handler run or has exceeded §7.2's T-c
      // threshold" -- the second clause is a pure Node-side elapsed check against the probe's own
      // INTENDED dispatch instant, so a probe that will never be handled still closes the envelope
      // rather than holding it to the limit.
      const handledKeys = await page.evaluate((h) => [...window.__m4Probes.getInputProbeRegistry(h).handledAt.keys()], registryHandle);
      const handledSet = new Set(handledKeys);
      const nowMs = performance.now();
      const outstanding = dispatchedSoFar.filter(
        (d) => !handledSet.has(`${d.coord.x},${d.coord.y}`) && nowMs - d.scheduledNodeMs <= TC_THRESHOLD_MS,
      );
      if (queryDone && envelope.postQueryFrameObserved && outstanding.length === 0) break;
      await sleep(16);
    }
    envelope.closed = true;

    const issued = await probesPromise;
    // §6.2, verbatim: "A slot whose dispatch could not be issued on time ... [is] recorded as a
    // CENSORED observation at the elapsed delay to the envelope's close -- NOT as 'not dispatched',
    // and never silently dropped, because a probe disappearing under renderer overload is EVIDENCE
    // OF the stall T-c exists to detect, not an absence of evidence."
    //
    // Independent-review finding (Critical): `shouldStop` breaks the dispatch loop the moment the
    // envelope closes, so every slot still due at that instant simply vanished from the sample --
    // and those are exactly the slots a Node-side stall near query completion would eat. Five
    // earlier fast probes could then carry T-c to a pass while the omitted slots held the overload
    // evidence. Every scheduled slot whose INTENDED instant fell at or before the closing mark is
    // materialised here instead, with a coordinate that is deliberately outside the canvas and
    // therefore can never match a recorded handler entry -- so it resolves as censored through the
    // ordinary disposition path rather than through a special case.
    const lastDueIndex = Math.floor((closingNodeMs - probeStartNodeMs) / PROBE_CADENCE_MS);
    const unissued = [];
    for (let i = issued.length; i <= lastDueIndex; i++) {
      unissued.push({
        coord: { x: -1 - i, y: -1 }, // unreachable by construction: no handler can ever record it
        scheduledNodeMs: probeStartNodeMs + i * PROBE_CADENCE_MS,
        // Not a real dispatch instant -- this slot was never issued. Recorded as "now" so the
        // observation's own `lateByMs` states how overdue the slot already was when the harness
        // stopped issuing, which is the honest reading of a slot the schedule could not reach.
        dispatchNodeMs: performance.now(),
        neverIssued: true,
      });
    }
    const dispatched = [...issued, ...unissued];

    const frameIntervals = await rafHandle.evaluate((r) => r.stop());
    const { traceEvents, dataLossOccurred } = await trace.stop();
    trace = null;
    const postSample = await captureClockCalibrationSample(page);
    const calibration = calibrateNodeToRendererClock(preSample, postSample);

    // -- T-c ------------------------------------------------------------------------------------
    let tC;
    let observations = [];
    if (!calibration.valid) {
      tC = { status: 'INDETERMINATE', reason: calibration.reason };
    } else {
      const all = await resolveInputProbeDispositions(page, registryHandle, dispatched, { thresholdMs: TC_THRESHOLD_MS, calibration });
      // §6.2: "Only IN-WINDOW dispatches count toward T-c; probes continue through the envelope's
      // tail so their handlers can be observed, but a probe issued after the closing mark measures
      // an already-unblocked main thread and would flatter the statistic."
      //
      // Membership is decided on the slot's INTENDED instant, never on when Node physically got the
      // CDP command out (independent-review finding, Critical): a probe scheduled inside the window
      // but issued late -- precisely because the machine was overloaded -- belongs in the sample,
      // and filtering on the late actual instant would drop exactly the observations that carry the
      // stall. Both instants are Node-monotonic, so no calibration conversion enters this split
      // (only each observation's own delay is converted, already done above).
      observations = all.filter((_, i) => dispatched[i].scheduledNodeMs <= closingNodeMs);
      tC = tCDispositionForRepetition(observations, TC_THRESHOLD_MS);
    }

    // -- T-a ------------------------------------------------------------------------------------
    const clockSamples = [
      { markName: 'm4-query-window-start', performanceNowMs: queryResult.openingMs },
      { markName: 'm4-query-window-end', performanceNowMs: queryResult.closingMs },
    ];
    const taEvidence = assembleTargetsTa({
      traceEvents, dataLossOccurred, clockSamples, pageTargetId,
      spanRecords: queryResult.spanRecords, yieldRecords: queryResult.yieldRecords,
      recorderInstalledAtMs: queryResult.recorderInstalledAtMs,
      recorderClearedAtMs: queryResult.recorderClearedAtMs,
      openingMs: queryResult.openingMs, closingMs: queryResult.closingMs,
    });

    const frames = summarizeFrameIntervals(frameIntervals, envelope);

    return {
      label,
      makespanMs: windowMs,
      run: queryResult.run,
      capacityError: queryResult.capacityError,
      otherError: queryResult.otherError,
      diagnosticEventCount: queryResult.diagnosticEventCount,
      yieldCount: queryResult.yieldRecords.length,
      cumulativeYieldMs: queryResult.yieldRecords.reduce((a, y) => a + y.resumeLatencyMs, 0),
      spanTotalsMs: queryResult.spanRecords.reduce((acc, s) => { acc[s.label] = (acc[s.label] ?? 0) + s.ms; return acc; }, {}),
      envelope: { ...envelope, limitMs, dataLossOccurred },
      // §7.2's four targets, each `true`/`false` where the measurement is DETERMINED and `null`
      // where it is not. `null` is NEVER collapsed to `false` (which would read as a real,
      // measured failure) nor to `true` (which would read as a pass that was never demonstrated) --
      // task 3.8 owns turning an UNEVALUABLE/INDETERMINATE repetition into the right §7.3
      // disposition, and it can only do that if the distinction survives to it intact.
      targets: {
        tA: taEvidence.tA.status === 'DETERMINED' ? taEvidence.tA.pass : null,
        tB1: frames.tB1, tB2: frames.tB2,
        tC: tC.status === 'DETERMINED' ? tC.p95Ms <= TC_THRESHOLD_MS : null,
      },
      // §6.2/§7.3's four separate evidence axes, kept separate (see assembleTargetsTa's header).
      targetMeasurements: { tA: taEvidence.tA, dutyCycle: taEvidence.dutyCycle, tC, frames },
      screenResidualMs: taEvidence.screenResidualMs,
      boundaries: taEvidence.boundaries,
      unattributableStageIntervals: taEvidence.unattributableStageIntervals,
      unattributableStageTimeMs: taEvidence.unattributableStageTimeMs,
      unmappedSpanLabels: taEvidence.unmappedSpanLabels,
      taDiagnostics: {
        taskCount: taEvidence.taskCount ?? 0, taskSumMs: taEvidence.taskSumMs ?? null,
        stageIntervalCount: taEvidence.stageIntervalCount ?? 0, yieldCount: taEvidence.yieldCount ?? 0,
        baselineOccupancyProbe: taEvidence.baselineOccupancyProbe ?? null,
        schedulerConformance: taEvidence.schedulerConformance ?? null,
      },
      observationCount: observations.length,
    };
  } finally {
    // Order matters. The probe loop is stopped and AWAITED first: it is the only thing here that
    // keeps issuing CDP commands, so letting it outlive the registry/session it targets is what
    // produces the unhandled rejections (and the hung process) this ordering prevents.
    envelope.closed = true;
    if (probesPromise) { try { await probesPromise; } catch { /* a failed dispatch must not mask the original error */ } }
    // The trace session must be closed even on a throw, or the NEXT window's `Tracing.start` fails
    // outright ("Tracing is already started") and every later tuple in the run dies with it.
    if (trace) { try { await trace.stop(); } catch { /* best-effort */ } }
    try { await rafHandle.evaluate((r) => r.stop()); } catch { /* already stopped */ }
    await rafHandle.dispose();
    await disposeInputProbeRegistry(page, registryHandle);
  }
}

// ---- §5.4's profiling pass (unmeasured, once per runtime) --------------------------------------
// Task 3.3's live half, promoted out of its temporary `--smoke-cohort-profiler` block into the
// real matrix. Passes an explicit [arch, structure, mechanical] array built from the already
// URN-verified `window.__gate` identities rather than `getAllModels()` directly:
// `profileStructureCohortDensity`'s own contract indexes `models[1]` for Structure, and this
// codebase already has one confirmed real defect (Task 3.1's codex-review finding) from trusting
// `getAllModels()`'s array position as model identity.
async function runCohortProfiling(page) {
  const rawProfiles = await page.evaluate(() => {
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    return window.__m4Probes.profileStructureCohortDensity([modelArch, modelStructure, modelMechanical]);
  });
  // Playwright's page.evaluate return-value serialization does NOT preserve Set objects (Task
  // 3.3's own empirically-confirmed finding -- a returned Set arrives as `{}` with every member
  // silently dropped), so the probe crosses the boundary with `fragmentIds` as a plain array and
  // the real Set is reconstructed here, before anything reads `.size` or iterates it.
  const profiles = rawProfiles.map((p) => ({ ...p, fragmentIds: new Set(p.fragmentIds) }));
  return { profiles, ranked: rankByDensity(profiles) };
}

// §5.4's three quantiles at one required cohort size `k` (in EXTRACTED INSTANCES, never dbIds).
// `3076` is forced into the HIGH cohort only (§5.4 step 5's own scope). The achieved-separation
// label is decided on ACHIEVED results via Task 3.3's `labelDensityUnstratified`, never on band
// overlap -- a `DENSITY_UNSTRATIFIED` level is a source-count-only arm and no finding at it may be
// attributed to density.
function buildCohorts(ranked, k) {
  const low = selectCohort(ranked, 0.25, k);
  const typical = selectCohort(ranked, 0.5, k);
  const high = selectCohort(ranked, 0.9, k, { forceDbId: SOURCE_DB_ID });
  return { low, typical, high, densityUnstratified: labelDensityUnstratified({ low, typical, high }) };
}

// ---- §5.3.1's S2T facade, installed per LEVEL --------------------------------------------------
// Task 3.4's live half, promoted out of its temporary `--smoke-s2t` block. The facade REPLACES the
// Architecture target's Model identity for the duration of one tuple (§5.3.1 point 1: "one
// Architecture-equivalent Model object and one target epoch group per run" -- admitting a facade
// ALONGSIDE the real Architecture model would create a fourth target epoch group, the exact
// confound that makes R2-vs-R5 uninterpretable).
//
// Both synthetic ranges are measured LIVE against whatever fixture state is actually loaded, never
// assumed from the ~5,435 figure documented in run-gate-m3.mjs's header: fragment ids AND geometry
// ids both, because two fragments sharing a geometry id are treated as sharing one real mesh and a
// colliding synthetic geometry id would silently alias a bystander onto a real mesh's cached entry.
async function installS2TFacade(page, level) {
  const { realFragmentCount, realGeometryIdMax } = await page.evaluate(() => {
    const fragList = window.__gate.modelArch.getFragmentList();
    const count = fragList.getCount();
    let geometryIdMax = -1;
    for (let f = 0; f < count; f++) {
      const gid = fragList.getGeometryId(f);
      if (typeof gid === 'number' && gid > geometryIdMax) geometryIdMax = gid;
    }
    return { realFragmentCount: count, realGeometryIdMax: geometryIdMax };
  });
  const bystanderCount = level - realFragmentCount;
  if (bystanderCount < 0) {
    throw new Error(`S2T: level ${level} is below the live fixture's own real Architecture fragment count ${realFragmentCount}`);
  }
  const bystanders = bystanderLayout(bystanderCount, {
    syntheticFragmentIdStart: syntheticIdRangeAbove(realFragmentCount - 1),
    syntheticGeometryIdStart: syntheticIdRangeAbove(realGeometryIdMax),
  });
  await page.evaluate((b) => {
    window.__gate.s2tFacade = window.__m4Probes.buildS2TFacade(window.__gate.modelArch, b);
  }, bystanders);
  return { realFragmentCount, bystanderCount };
}

async function disposeS2TFacade(page) {
  await page.evaluate(() => { window.__gate.s2tFacade = null; });
}

// Reads the level-scoped observables §5.3.1's control rule needs that the measured-query path does
// not already carry (the facade's own synthetic-geometry-access counter and its model id).
async function readS2TFacadeControls(page) {
  return page.evaluate(() => {
    const f = window.__gate.s2tFacade;
    return {
      targetModelId: f.id,
      syntheticVizmeshAccessCount: f.getSyntheticVizmeshAccessCount(),
      facadeCount: f.getCount(),
      // §5.3.1's leak check scopes 'is this a synthetic fragment id' as `fragId >= realCount`, so
      // the REAL Architecture fragment count has to travel with every level record.
      realFragmentCount: f.__realCount,
    };
  });
}

// ---- §5.3's S4 (synthetic pathological dense-mesh pair) facade, installed per (variant, mode) ----
// M4 Task 3.12's live half. §5.3's S4 row requires "two large, densely-tessellated SYNTHETIC meshes
// at/near maxSyncTriangleCount (12,000 triangles) with broadly overlapping bounds" -- built here as
// two INDEPENDENT single-fragment synthetic models (never one shared two-fragment facade like S2T's;
// see s4-synthetic-mesh.mjs's own header and browser-probes-m4.mjs's buildS4SyntheticModel for why).
//
// A grid sized to land exactly at maxSyncTriangleCount (spec: "at/near" the ceiling) -- 200 cols x 60
// rows... no: 200 cols x 30 rows = 12,000 triangles exactly (200*30*2). S4_GRID_ROWS must come out an
// integer -- assert it rather than silently floor/truncate if maxSyncTriangleCount ever changes to a
// value not evenly divisible this way.
const S4_GRID_COLS = 200;
const S4_GRID_ROWS = maxSyncTriangleCount / (S4_GRID_COLS * 2);
if (!Number.isInteger(S4_GRID_ROWS)) throw new Error(`S4 grid dims no longer divide maxSyncTriangleCount (${maxSyncTriangleCount}) exactly`);

// MODE-SPECIFIC Z placement -- a real, empirically-forced deviation from a single shared placement
// for both modes, found running this task's own manual verification and confirmed via an independent
// codex-advisor consultation that directly re-ran the experiment against this repo's pinned BVH
// backend. See s4-synthetic-mesh.mjs's own header for the full causal chain (the aspect-ratio gate on
// a perfectly flat mesh, and why `buildTriangleGrid` now tilts each grid by TILT_SLOPE*(col-row)).
// Given that intrinsic per-mesh tilt (~2.3-unit local Z extent over this 200x30 grid), the two modes
// need OPPOSITE Z-gap regimes to each reach real narrow-phase work:
//  - volume-overlap needs the two meshes' BVH LEAF AABBs to keep overlapping so the real crossing
//    (hard-clash) traversal engages broadly -- a gap smaller than the tilt's own per-cell Z variation.
//  - clearance needs the two meshes' WORLD-SPACE AABBs to be fully DISJOINT so
//    classifyHardClashPrecheck (collision/query/ClearanceHardClashPrecheck.js:20) takes its
//    'skip-precheck'/'aabb-disjoint' fast path straight into the real clearanceQuery -- an
//    AABB-OVERLAPPING pair of these open (non-closed-manifold) meshes can never resolve
//    volumeOverlapQuery's negative path as `conclusive:true` (ContainmentQuery.js's own unconditional
//    'unverified-parity-operand' diagnostic for a non-closed container permanently taints it), so it
//    would get stuck at 'inconclusive' and never reach the distance query at all -- confirmed live.
// Empirically confirmed (this task's own manual verification, live against the running app):
//  - volume-overlap, gap=0.005: real crossing traversal engages and hits its own internal budget
//    (`crossing-budget-exhausted`, collision/query/ProperCrossingQuery.js's 8ms/50k-candidate/
//    64-crossing ceiling) at a ~47ms measured atomic-call duration (linear broad phase; ~51ms tlas).
//  - clearance, gap=2.5 (> the ~2.3 local Z extent, guaranteeing AABB disjointness), clearance
//    threshold widened to S4_CLEARANCE_GENEROUS (comfortably above the resulting constant ~2.5 real
//    gap, so the query finds a genuine within-threshold hit requiring a real closest-point
//    confirmation rather than an early BVH-pruned rejection): `clearanceDistanceQueriesRun: 1`,
//    `clearanceHits: 1`, at a ~716ms measured atomic-call duration (linear; ~736ms tlas) -- both
//    dramatically over the spec's 8ms/24.8ms ceilings this row exists to find.
const S4_VOLUME_OVERLAP_Z_GAP = 0.005;
const S4_CLEARANCE_Z_GAP = 2.5;
// "a generous clearance" (spec) -- wide enough that the pair is never hard-clash-excluded before
// reaching the narrow phase / distance query this case exists to time. NOT the brief's own original
// placeholder (1.0): that value predates this task's mode-specific-Z-placement fix and would leave
// the real ~2.5 constant gap OUTSIDE the threshold, which still exercises the real distance query
// (clearanceDistanceQueriesRun still increments regardless of hit/no-hit) but risks the query's own
// maxDistance-bounded BVH traversal pruning early once it can prove nothing is within a much smaller
// threshold -- widened here so the traversal must do a real closest-point CONFIRMATION instead.
const S4_CLEARANCE_GENEROUS = 3.0;

async function installS4Facades(page, mode) {
  const sourceGrid = buildTriangleGrid(S4_GRID_COLS, S4_GRID_ROWS);
  const zGap = mode === 'clearance' ? S4_CLEARANCE_Z_GAP : S4_VOLUME_OVERLAP_Z_GAP;
  const targetGrid = translatedGrid(sourceGrid, [5, 5, zGap]);
  await page.evaluate(({ sourceGrid, targetGrid }) => {
    window.__gate.s4Source = window.__m4Probes.buildS4SyntheticModel('source', sourceGrid);
    window.__gate.s4Target = window.__m4Probes.buildS4SyntheticModel('target', targetGrid);
  }, { sourceGrid, targetGrid });
}

async function disposeS4Facades(page) {
  await page.evaluate(() => { window.__gate.s4Source = null; window.__gate.s4Target = null; });
}

// M4 Task 3.5's live half: §5.2.1's R6 one-time calibration pass. Unmeasured, runs ONCE per
// runtime -- finds the smallest d in R6_CALIBRATION_SEQUENCE whose translation of the Architecture
// model along world +X changes R3's pair set (R3's source set == the typical cohort, per §5.2's
// table), then restores T0 before returning. Every calibration query is run in its own disposable,
// freshly-constructed CollisionWorld (never a shared/reused world) -- §5.2.1 requires no
// invalidateModelPlacement call here: a brand-new world has no prior cached placement for this
// model to go stale, so it always extracts whatever transform is live on the Viewer at admission
// time (confirmed empirically against the real fixture: a fresh world picks up a placement change
// applied moments earlier with zero invalidation calls in between).
//
// Real bug found running this task's own manual verification: the brief's own excerpt captured T0
// as `archModel.getPlacementTransform ? archModel.getPlacementTransform() : new
// window.THREE.Matrix4().toArray()` -- the truthy branch returns the LIVE THREE.Matrix4 OBJECT
// (getPlacementTransform()'s real return type, per @types/forge-viewer/index.d.ts:757), never an
// array, while the falsy branch returns a plain array from Matrix4#toArray(). Confirmed empirically
// against the real fixture: the Architecture model's own getPlacementTransform() returns a Matrix4
// whose `rawIsArray` is `false`. Every downstream use of T0 needs a plain 16-element array (T0[i]
// indexing, Matrix4#fromArray(T0)), so the untyped ternary would silently hand later code a Matrix4
// object under the (normal, common) truthy branch -- `Matrix4#fromArray` reads `array[0..15]`
// positionally, and a Matrix4 object has no such numeric indices, so `fromArray(T0)` would silently
// build a matrix of `undefined`s (coerced to NaN) rather than throwing. Fixed here to the same
// `Array.from(model.getPlacementTransform()?.elements ?? identity.elements)` idiom
// test/acceptance/clash-finder.acceptance.mjs:1124-1128's own already-proven
// readStructPlacementElements() uses, which always yields a plain array regardless of which branch
// is live.
//
// Second real bug found the same way: the brief's own excerpt additionally called
// `window.__gate.extension?._world?.invalidateModelPlacement?.(archModel)` after each translation.
// `window.__gate` (set by loadFixtureAndReconfirm) never carries an `extension` property -- only
// `modelArch`/`modelStructure`/`modelMechanical` -- so `window.__gate.extension` is always
// `undefined` and the whole optional-chained call was unreachable dead code, confirmed empirically.
// Since every calibration query already uses a brand-new world (see above), no invalidation call
// was ever needed here in the first place; removed rather than wired to a real accessor that would
// make it fire but still change nothing observable.
//
// Codex-review fixes (post-commit round):
//
// (#2, Important) Pair signatures now carry the SAME source/target model-identity tag M3's own
// comparator already uses (run-gate-m3.mjs:313: `(m) => m === modelArch ? 'arch' : m ===
// modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown'`) rather than
// dbId+type alone. R6's target is `window.viewer.getAllModels()` -- all three federated models --
// exactly the multi-model-target shape M3's own comparator was built to disambiguate; dbId
// numbering is per-model, not global, so a real dbId collision across two of the three discipline
// models (e.g. a pair leaving Architecture dbId 42 and, at the same calibration step, an unrelated
// pair entering Mechanical also at dbId 42) would otherwise be indistinguishable in the sorted
// signature multiset and could silently cancel out of a set-difference comparison. Matched to the
// existing convention rather than inventing a new one, per this project's own established pattern.
//
// (#1, Important) The calibration pass now also returns the EXACT baseline pair set `p0` and the
// FIRST changed pair set `firstChangeP1` (captured only once, at the same index
// `selectCalibrationMagnitude` itself would pick via `changedFlags.findIndex(Boolean)` -- never
// recomputed independently, so the two can never disagree on which `d` "the" change came from).
// §5.2.1 requires the calibration pass to record "the exact set of pairs entering and leaving...
// reused unchanged across every arm, state, and repetition" -- a boolean "did it change" alone
// (the pre-fix `changedFlags`) cannot catch two arms producing DIFFERENT non-empty deltas that both
// individually satisfy "changed". The caller (main(), below) computes the frozen expected
// entering/leaving sets from `p0`/`firstChangeP1` via `pairSetDelta` and compares every arm's own
// observed delta against them for exact equality, not mere non-emptiness.
async function calibrateR6Translation(page, { cohortDbIds }) {
  return page.evaluate(async ({ cohortDbIds, sequence }) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    const modelTag = (m) => (m === modelArch ? 'arch' : m === modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown');
    const T0 = Array.from(modelArch.getPlacementTransform?.()?.elements ?? new window.THREE.Matrix4().elements);
    async function runR3(world) {
      const r = await world.findClashes({
        mode: 'clearance', clearance: 0.05,
        source: { model: modelStructure, dbIds: cohortDbIds },
        target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) },
        groupBy: 'dbId', broadPhase: 'tlas',
      });
      return r.pairs.map((p) => `${modelTag(p.source.model)}:${p.source.dbId}:${modelTag(p.target.model)}:${p.target.dbId}:${p.type}`).sort();
    }
    // Task-review fix (Important #1): the initial (never-displaced) baseline query also now runs
    // inside try/finally purely for world-disposal hygiene -- no placement mutation has happened
    // yet at this point, so there is no "displaced model" risk here, only a potential world leak if
    // `findClashes` itself threw before the pre-fix, unconditional `w0.dispose()` ran.
    let w0;
    let p0;
    try {
      w0 = await CollisionWorld.fromViewer(window.viewer);
      w0.admitModel(modelArch); w0.admitModel(modelStructure); w0.admitModel(modelMechanical);
      p0 = await runR3(w0);
    } finally {
      try { w0?.dispose(); } catch { /* best-effort; must not mask the original error, if any */ }
    }
    const changedFlags = [];
    let firstChangeP1 = null;
    for (const d of sequence) {
      // Task-review fix (Important #1): the ENTIRE per-iteration construct -> admit -> query ->
      // dispose sequence now runs inside try/finally, with T0 restoration moved into the `finally`
      // clause. Before this fix, any throw between `setPlacementTransform(composed)` and the
      // unconditional restore at the bottom of the loop body (e.g. `CollisionWorld.fromViewer`,
      // `admitModel`, or `findClashes` itself throwing) would leave BOTH the temp world `w`
      // undisposed AND the Architecture model permanently displaced at `composed` -- and since Task
      // 3.7 calls this function once per runtime, ahead of every later measured tuple on the SAME
      // live page, every subsequent case in that runtime would then silently measure against a
      // displaced model. Mirrors the same discipline `runR6Sequence` (below) already applies to its
      // own move/restore dance.
      //
      // Composition order: T_moved = Translation(d) x T0, pre-multiplied (§5.2.1) -- Matrix4#multiply
      // sets `this = this * arg`, so `Translation.multiply(T0)` is exactly `Translation x T0`.
      const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
      window.viewer.impl.setPlacementTransform(modelArch, composed);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // render stabilisation
      let w;
      try {
        w = await CollisionWorld.fromViewer(window.viewer);
        w.admitModel(modelArch); w.admitModel(modelStructure); w.admitModel(modelMechanical);
        const p1 = await runR3(w);
        const changed = JSON.stringify(p0) !== JSON.stringify(p1);
        changedFlags.push(changed);
        if (changed && firstChangeP1 === null) firstChangeP1 = p1; // §5.2.1: take the FIRST change only
      } finally {
        try { w?.dispose(); } catch { /* best-effort disposal; must not block T0 restoration below */ }
        window.viewer.impl.setPlacementTransform(modelArch, new window.THREE.Matrix4().fromArray(T0));
      }
    }
    // Codex-review fix (#3, Minor): the render-stabilisation wait after EVERY setPlacementTransform
    // call, including this final restore, is §5.2.1's own fixed rule ("two consecutive
    // requestAnimationFrame turns observed ... before the next query is issued") -- the pre-fix code
    // restored T0 on the loop's last iteration and returned immediately, so a caller building its
    // first MEASURED world right after this call could read the Architecture model before its
    // restored placement had actually stabilised.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { T0, changedFlags, p0, p1: firstChangeP1 };
  }, { cohortDbIds, sequence: R6_CALIBRATION_SEQUENCE });
}

// ---- §5.2.1's R6 sequence, DECOMPOSED into individually-bracketed measured queries -------------
//
// REAL CONTRACT FINDING against Task 3.5's landed `runR6Sequence`, reported in this task's own
// write-up. As landed, that function ran all four of R6's queries (cold, warm, refresh, and the
// unmeasured reconfirm) inside ONE `page.evaluate`. Two things follow that make it unusable
// verbatim by the real matrix, neither visible until a real consumer wired it up:
//
//   1. §6.1.7 requires EVERY observer to be "started and reset immediately before each individual
//      measured query, bracketed by `performance.mark` pairs naming the tuple", and "no observer
//      spans two measured queries". Four queries inside one evaluate turn cannot be individually
//      bracketed by anything -- there is no point between them at which Node can open a trace
//      session, place an anchor mark pair, or reset the rAF/probe observers. R6's cold, warm and
//      `refresh` states are verdict-bearing in their own right (§6.1.4's declared exception, §7.2),
//      so leaving all three unbracketed would have made R6 the one case with no T-a/T-b/T-c at all.
//   2. It returns each state's pairs as SORTED SIGNATURE STRINGS plus `tlasBuilds` -- there are no
//      pair objects, no distances, no witnesses, no statistics and no diagnostics in its return
//      value, so Task 3.6's `compareRuns` (which the brief directs this task to use for R6's own
//      TLAS-vs-linear parity check, "same as every other case") structurally cannot be called on
//      its output.
//
// Both are resolved here rather than worked around, and WITHOUT weakening any of §5.2.1's
// assertions: the sequence is decomposed into separate steps against the SAME long-lived
// CollisionWorld JSHandle (exactly the cross-evaluate contract Task 3.5 itself established and
// proved), so each of R6's three measured queries now goes through the standard, fully-bracketed
// `runMeasuredQueryWindow` path and produces a full comparator-shaped run record, while the
// placement move / invalidate / restore / verify steps keep their own try-finally discipline.
//
// The `finally` still carries BOTH halves §5.2.1 requires (restore `T0`, then a SECOND
// `invalidateModelPlacement`), still verifies the restored matrix against `T0` through the real
// NaN-safe `matricesEqual`, and still re-confirms `P0` -- and it now does so around a sequence
// that can throw at more points than before, which makes that discipline more load-bearing, not
// less: the Architecture model is shared by every later case in the runtime, so any exit with it
// still displaced would silently contaminate the whole remainder of the run.
async function r6ApplyMove(page, world, { T0, d }) {
  await page.evaluate(async ({ T0, d, world }) => {
    const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
    window.viewer.impl.setPlacementTransform(window.__gate.modelArch, composed);
    // §5.2.1's fixed "render stabilisation": two consecutive requestAnimationFrame turns observed
    // after the setPlacementTransform call, before the next query is issued.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    world.invalidateModelPlacement(window.__gate.modelArch);
  }, { T0, d, world });
}

async function r6RestoreAndVerify(page, world, { T0 }) {
  await ensureMatricesEqualExposed(page);
  return page.evaluate(async ({ T0, world }) => {
    window.viewer.impl.setPlacementTransform(window.__gate.modelArch, new window.THREE.Matrix4().fromArray(T0));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    world.invalidateModelPlacement(window.__gate.modelArch);
    const restored = Array.from(window.__gate.modelArch.getPlacementTransform?.()?.elements ?? new window.THREE.Matrix4().elements);
    // The REAL, NaN-safe `matricesEqual` from r6-calibration.mjs, bridged in via
    // `ensureMatricesEqualExposed` -- never an inline reimplementation of the same tolerance check,
    // which is how the non-finite-element hole this function exists to close got in once already.
    return { restoredOk: await window.__r6MatricesEqual(restored, T0), restored };
  }, { T0, world });
}

// R6's own pair signature convention -- model-identity-tagged exactly as `calibrateR6Translation`
// and M3's own comparator (run-gate-m3.mjs:313) already are. Derived here from the SAME normalized
// pair records `compareRuns` consumes, so R6's calibration-consistency check and its parity check
// can never disagree about what a pair is.
function r6PairSignatures(run) {
  return run.pairs.map((p) => `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId}:${p.type}`).sort();
}

// ---- The case matrix (§5.2 R-cases, §5.3 S-cases, §5.3.1 S2T) ----------------------------------
//
// Each entry expands to one or more VARIANTS. A variant is the unit that gets its own fresh world
// per (runtime, broadPhase, repetition) -- §6.1.4's tuple identity extended by the `level`
// dimension the spec already defines for S2T, reused here for every case that has more than one
// executable configuration (S1's three clearances, S2's cohort x size x mode grid, S3's two modes).
// Giving each variant its own world is strictly MORE conservative than sharing one: sharing would
// let the first variant's queries warm the world that the second variant's "cold" sample is
// supposed to measure, which is the one thing §6.1.4 exists to prevent.
const S2_INSTANCE_LEVELS = [10, 50, 100, 183]; // §5.3's S2 row, in EXTRACTED SOURCE INSTANCES
const S1_CLEARANCES = [0.02, 0.05, 0.25];      // §5.3's S1 row
const R_COHORT_K = 10;                         // §5.2's "target ~10 extracted instances" for R3/R4/R6

function caseVariantsFor(caseName, ctx) {
  const all = 'all';
  const src = (dbIds) => ({ modelKey: 'structure', dbIds });
  const single = src([SOURCE_DB_ID]);
  const typical = ctx.rCohorts.typical;

  switch (caseName) {
    case 'R1': return [{ key: null, descriptor: { mode: 'volume-overlap', source: single, targets: all } }];
    case 'R2': return [{ key: null, descriptor: { mode: 'clearance', clearance: CLEARANCE, source: single, targets: all } }];
    case 'R3': return [{ key: null, descriptor: { mode: 'clearance', clearance: CLEARANCE, source: src(typical.requestedDbIds), targets: all } }];
    // §5.2's R4 row: "the same dbId set as R3" -- literally the same array, never re-selected, so
    // R3-vs-R4 isolates MODE at identical source and target.
    case 'R4': return [{ key: null, descriptor: { mode: 'volume-overlap', source: src(typical.requestedDbIds), targets: all } }];
    case 'R5': return [{ key: null, descriptor: { mode: 'clearance', clearance: CLEARANCE, source: single, targets: ['structure'] } }];
    case 'R6': return [{ key: null, r6: true, descriptor: { mode: 'clearance', clearance: CLEARANCE, source: src(typical.requestedDbIds), targets: all } }];
    case 'S1':
      return S1_CLEARANCES.map((c) => ({
        key: `clearance=${c}`,
        descriptor: { mode: 'clearance', clearance: c, source: src(typical.requestedDbIds), targets: all },
      }));
    case 'S2': {
      const variants = [];
      for (const k of S2_INSTANCE_LEVELS) {
        const cohorts = ctx.s2CohortsByK.get(k);
        for (const band of ['low', 'typical', 'high']) {
          const cohort = cohorts[band];
          for (const mode of ['volume-overlap', 'clearance']) {
            variants.push({
              key: `k=${k}:${band}:${mode}`,
              // §5.4 step 6: a band that cannot reach `k` even after widening to all of L is
              // recorded NOT EXERCISED with the achieved count -- never silently run at a smaller
              // size, which would report a k=183 figure measured at whatever it actually reached.
              notExercised: cohort.status !== 'OK'
                ? { reason: 'cohort-not-exercised', achievedInstances: cohort.achievedInstances, requestedK: k, band }
                : null,
              cohort,
              densityUnstratified: cohorts.densityUnstratified,
              descriptor: {
                mode, ...(mode === 'clearance' ? { clearance: CLEARANCE } : {}),
                source: src(cohort.requestedDbIds), targets: all,
              },
            });
          }
        }
      }
      return variants;
    }
    case 'S3':
      // §5.3's S3 row names the source ("whole-model-scale") but states no MODE, unlike every other
      // S-case row. Both modes are run, mirroring S2's own explicit both-modes rule for the same
      // source-scale axis, rather than silently picking one -- flagged in this task's report as a
      // spec gap rather than resolved by assumption.
      return ['volume-overlap', 'clearance'].map((mode) => ({
        key: `whole-model:${mode}`,
        descriptor: {
          mode, ...(mode === 'clearance' ? { clearance: CLEARANCE } : {}),
          source: src(ctx.allStructureDbIds), targets: all,
        },
      }));
    case 'S4':
      // §5.3's S4 row requires "two large, densely-tessellated SYNTHETIC meshes at/near
      // maxSyncTriangleCount (12,000 triangles) with broadly overlapping bounds". Task 3.12 closes
      // the fixture-construction gap Task 3.7 correctly reported as NOT_EXERCISED (no earlier
      // Phase-3 task was ever assigned to build it). Both modes, per spec's "under both modes" --
      // mirrors S1/S2's own explicit both-modes handling. Warm-only per §5.6
      // (measuredStatesFor('S4') already returns ['warm'] only, confirmed against
      // fixture-lifecycle.mjs -- no cold state here).
      //
      // `source`/`targets` use descriptor shapes the harness already supports unchanged: a
      // dbId-scoped source ({modelKey, dbIds}) and a whole-model targets array -- a 1-fragment
      // model IS "the whole model", so no new per-target dbId-scoping is needed anywhere. `s4: true`
      // drives runArmTuple's admit list and the per-variant loop's install/dispose lifecycle below.
      return ['volume-overlap', 'clearance'].map((mode) => ({
        key: `pathological-pair:${mode}`,
        s4: true,
        descriptor: {
          mode, ...(mode === 'clearance' ? { clearance: S4_CLEARANCE_GENEROUS } : {}),
          source: { modelKey: 's4Source', dbIds: [1] },
          targets: ['s4Target'],
        },
      }));
    case 'S2T':
      // §5.6: S2T's population-level order is counterbalanced ALONGSIDE arm order and case order,
      // by the same rotation rule -- so the level order is rotated per repetition by the caller.
      return S2T_LEVELS.map((level) => ({
        key: `level=${level}`, s2tLevel: level,
        descriptor: { mode: 'clearance', clearance: CLEARANCE, source: src([SOURCE_DB_ID]), targets: ['s2tFacade'] },
      }));
    default:
      throw new Error(`caseVariantsFor: unknown case "${caseName}"`);
  }
}

// §5.6: "Only the representative multi-process runtime is required" for S2T -- the historical
// `--single-process` configuration exists purely for continuity with M1-M3's archived numbers and
// S2T has no archived counterpart, so running it there would produce numbers comparable to nothing.
function caseRunsUnderRuntime(caseName, runtime) {
  if (caseName === 'S2T') return runtime.authoritative === true;
  return true;
}

// ---- One fresh world, one arm, all of that tuple's measured states ------------------------------
async function runArmTuple(page, cdp, ctx, { caseName, variant, broadPhase, repetition, runtimeLabel }) {
  const tupleKey = freshWorldTupleKey({ runtime: runtimeLabel, caseName, level: variant.key ?? undefined, broadPhase, repetition });
  const admit = variant.s2tLevel
    // §5.3.1 point 1: the facade REPLACES the Architecture Model identity -- the real Architecture
    // model is deliberately NOT admitted alongside it, or the run would carry a fourth target epoch
    // group and the population sweep would measure the wrong thing entirely.
    ? ['structure', 's2tFacade']
    : variant.s4
    // S4 is spec's one fully-synthetic case -- zero delegation to any real Viewer model, so neither
    // real discipline model is admitted alongside the two synthetic facades.
    ? ['s4Source', 's4Target']
    : ['arch', 'structure', 'mechanical'];

  const world = await page.evaluateHandle(async (keys) => {
    const { CollisionWorld } = await import('/collision/index.js');
    const w = await CollisionWorld.fromViewer(window.viewer);
    for (const k of keys) w.admitModel(window.__m4Gate.resolveModel(k));
    return w;
  }, admit);

  const states = {};
  try {
    if (variant.r6) {
      Object.assign(states, await runR6ArmStates(page, cdp, ctx, { world, variant, broadPhase, tupleKey }));
    } else {
      for (const state of measuredStatesFor(caseName)) {
        const window_ = await runMeasuredQueryWindow(page, cdp, {
          pageTargetId: ctx.pageTargetId, world,
          descriptor: { ...variant.descriptor, broadPhase },
          label: `${tupleKey}:${state}`,
        });
        states[state] = window_;
        // A capacity rejection (§4) is a FINDING, not an abort: it is recorded with its exact limit
        // and observed value and the run continues. But the REST of this tuple's states are not
        // measured after one -- a world that has just rejected a query may still have background
        // geometry work in flight whose spans would report into the next window's recorder without
        // that window being able to prove the yield recorder covered them (§6.2's second rule), and
        // a warm sample taken after a failed cold one is not the warm sample §6.1.4 defines anyway.
        if (window_.capacityError || window_.otherError) {
          ctx.attributionPoisoned = true;
          // Independent-review finding (Critical): a NON-capacity exception is a harness/runtime
          // failure, not a §4 finding, and must never leave the process exiting 0. Before this,
          // every unexpected throw (say, a `TypeError` from a changed `findClashes` signature)
          // became an `otherError`, the tuple stopped, parity was recorded as "not compared", and
          // the run still printed "Baseline matrix complete" and exited successfully -- a CI-green
          // gate that measured nothing. It is surfaced, kept verbatim in the record, and the run
          // exits non-zero. Recognized capacity rejections are the ONLY tolerated failure.
          if (window_.otherError && !recognizeCapacityRejection(window_.otherError)) {
            ctx.harnessFailures.push({ tupleKey, state, error: window_.otherError });
          }
          break;
        }
      }
    }
  } finally {
    await page.evaluate((w) => w.dispose(), world); // §6.1.4: disposed before the next tuple's world exists
    await world.dispose();
  }
  return { tupleKey, states };
}

// R6's three measured states, each individually bracketed -- see the decomposition note above.
async function runR6ArmStates(page, cdp, ctx, { world, variant, broadPhase, tupleKey }) {
  const { T0, d } = ctx.r6;
  const descriptor = { ...variant.descriptor, broadPhase };
  const measure = (state) => runMeasuredQueryWindow(page, cdp, {
    pageTargetId: ctx.pageTargetId, world, descriptor, label: `${tupleKey}:${state}`,
  });

  const cold = await measure('cold');   // §5.2.1 step 1's first query
  const warm = await measure('warm');   // §5.2.1 step 1's second query -- records P0
  let refresh = null;
  let reconfirm = null;
  let restoration = null;
  try {
    await r6ApplyMove(page, world, { T0, d });   // §5.2.1 steps 2-3
    refresh = await measure('refresh');          // §5.2.1 step 4 -- records P1, verdict-bearing
  } finally {
    // §5.2.1 step 5: restore T0, invalidate a SECOND time, verify, re-confirm P0. Both halves,
    // both in the `finally`, because the Architecture model is shared by every later case.
    restoration = await r6RestoreAndVerify(page, world, { T0 });
    if (!restoration.restoredOk) {
      throw new Error('R6 restoration could not be verified — aborting the entire run');
    }
    // Correctness-only and explicitly UNMEASURED (§5.2.1 step 5), so it deliberately does NOT go
    // through runMeasuredQueryWindow -- bracketing it would put a fourth "measured" window on a
    // case the spec says has exactly three.
    reconfirm = await runQueryInPage(page, world, descriptor);
  }

  if (warm.run && reconfirm?.run && pairSetsDiffer(r6PairSignatures(reconfirm.run), r6PairSignatures(warm.run))) {
    throw new Error('R6 restoration verified by matrix but P0 was not recovered — aborting the entire run');
  }
  return { cold, warm, refresh, r6: { restoration, reconfirm } };
}

// §5.2.1's R6-SPECIFIC assertions, run in addition to (never instead of) §6.4's general comparator.
// The tlasBuilds rule is stated PER ARM because the two arms genuinely differ: a `linear` call
// consults no TLAS and passes no armed epochs, so its `tlasBuilds` is 0 by construction, and
// asserting a delta of 1 there would force a conforming harness to fail on correct library
// behaviour. The pair delta is compared for EXACT equality against the frozen calibration delta,
// never merely for non-emptiness -- two arms producing different non-empty deltas both satisfy
// "changed" while disagreeing about what actually moved.
function checkR6ArmRules({ states, broadPhase, expectedPairDelta }) {
  const violations = [];
  const { cold, warm, refresh, r6 } = states;
  if (!cold?.run || !warm?.run || !refresh?.run) return ['r6-states-missing'];

  const tb = (w) => w.run.statistics.tlasBuilds;
  const expectedDelta = broadPhase === 'tlas' ? 1 : 0;
  // `tlasBuilds` is a PER-QUERY count, never a cumulative total (Task 3.5's own empirical finding:
  // the world's first `cold` query reports 3, the immediately following unchanged `warm` reports 0)
  // -- so §5.2.1's "delta of 1" is each of refresh/reconfirm's own count against the steady-state
  // warm baseline, not `reconfirm - refresh`.
  if (tb(refresh) - tb(warm) !== expectedDelta) violations.push(`r6-refresh-tlasBuilds-delta=${tb(refresh) - tb(warm)}(want ${expectedDelta})`);
  const reconfirmBuilds = r6?.reconfirm?.run?.statistics?.tlasBuilds ?? null;
  if (reconfirmBuilds !== null && reconfirmBuilds - tb(warm) !== expectedDelta) {
    violations.push(`r6-reconfirm-tlasBuilds-delta=${reconfirmBuilds - tb(warm)}(want ${expectedDelta})`);
  }
  if (broadPhase === 'linear' && [cold, warm, refresh].some((s) => tb(s) !== 0)) violations.push('r6-linear-tlasBuilds-nonzero');

  const observed = pairSetDelta(r6PairSignatures(warm.run), r6PairSignatures(refresh.run));
  if (JSON.stringify(observed) !== JSON.stringify(expectedPairDelta)) {
    violations.push(`r6-pair-delta-mismatch: observed ${JSON.stringify(observed)} != frozen ${JSON.stringify(expectedPairDelta)}`);
  }
  return violations;
}

// ---- main() -------------------------------------------------------------------------------------
function parseListFlag(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  return raw.slice(name.length + 3).split(',').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });

  // Scoping flags. The full matrix is a multi-hour run (5 repetitions x 11 cases, several of which
  // expand to many variants, x up to 2 arms x 2 runtimes), so these exist so a targeted subset can
  // be exercised end to end -- for this task's own manual verification, and for any later debugging
  // of one case -- without ever changing what a flagless `npm run test:performance:gate:m4`
  // dispatches, which remains the complete baseline matrix.
  const selectedCases = parseListFlag('cases', M4_CASE_LIST).filter((c) => M4_CASE_LIST.includes(c));
  const selectedRuntimes = parseListFlag('runtimes', null);
  const repArg = process.argv.find((a) => a.startsWith('--repetitions='));
  const repetitionCount = repArg ? Number(repArg.split('=')[1]) : REPETITIONS;
  if (!Number.isInteger(repetitionCount) || repetitionCount <= 0) throw new Error(`--repetitions must be a positive integer (got ${repArg})`);
  if (selectedCases.length === 0) throw new Error('--cases selected no known case');

  const results = { startedAt: new Date().toISOString(), runtimes: [] };
  let failedValidation = null;
  // §6.4's diagnostics rule vs. the one wall-clock-dependent diagnostic reason -- see
  // TIME_BUDGET_DEPENDENT_DIAGNOSTIC_REASONS. Collected across the whole run and reported at the
  // end, never discarded.
  const timeBudgetDivergences = [];
  // Unexpected (non-capacity) query failures. Any one of these fails the whole run non-zero.
  const harnessFailures = [];

  for (const runtime of Object.values(RUNTIME_CONFIGS)) {
    if (selectedRuntimes && !selectedRuntimes.includes(runtime.label)) continue;
    console.log(`\n=== Runtime: ${runtime.label} ===`);
    const browser = await chromium.launch({ args: runtime.args, proxy: resolveProxyFromEnv() });
    const runtimeReport = { runtime: runtime.label, authoritative: runtime.authoritative, cases: [] };
    try {
      const page = await browser.newPage();
      const identity = await loadFixtureAndReconfirm(page);
      console.log('Fixture identity (re-confirmed live):', JSON.stringify(identity));
      await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
      await installGateHelpers(page);

      const cdp = await page.context().newCDPSession(page);
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const pageTargetId = frameTree.frame.id;
      // §6.2: the exact Chromium version is "recorded verbatim in the report along with" the trace
      // categories, "since event naming is version-dependent and is pinned to the build actually
      // tested" -- this run has already had to work around exactly that (see TOP_LEVEL_TASK_NAMES).
      runtimeReport.chromiumVersion = browser.version();
      runtimeReport.traceCategories = TRACE_CATEGORIES;
      runtimeReport.acceptedTopLevelTaskNames = TOP_LEVEL_TASK_NAMES;

      await sacrificialWarmup(page);
      console.log('Sacrificial warm-up complete (unmeasured, no recorder installed).');

      // §5.4's profiling pass -- ONCE per runtime, unmeasured, no recorder installed.
      const { profiles, ranked } = await runCohortProfiling(page);
      const rCohorts = buildCohorts(ranked, R_COHORT_K);
      const s2CohortsByK = new Map(S2_INSTANCE_LEVELS.map((k) => [k, buildCohorts(ranked, k)]));
      if (rCohorts.typical.status !== 'OK') {
        throw new Error(`Cohort profiling could not build the typical cohort at k=${R_COHORT_K} (status=${rCohorts.typical.status}) -- R3/R4/R6/S1 have no source set`);
      }
      console.log('Cohort profiling:', JSON.stringify({
        dbIdCount: profiles.length,
        typical: { dbIds: rCohorts.typical.requestedDbIds, achieved: rCohorts.typical.achievedInstances, weightedDensity: rCohorts.typical.weightedDensity },
        densityUnstratifiedAtK: [...s2CohortsByK].map(([k, c]) => ({ k, densityUnstratified: c.densityUnstratified })),
      }));
      runtimeReport.cohorts = {
        profiledDbIdCount: profiles.length,
        r: rCohorts,
        s2ByK: Object.fromEntries([...s2CohortsByK].map(([k, c]) => [k, c])),
      };

      const diagonalByTag = await page.evaluate(() => window.__m4Gate.worldDiagonalsByTag());
      runtimeReport.worldDiagonalsByTag = diagonalByTag;
      // §6.4 requires the witness tolerance's "numeric value for the fixture actually used" to be
      // computed and printed. It is per model pair, so every pair's value is printed, not one.
      console.log('§6.4 witness tolerances (1e-9 x world diagonal), per model:',
        JSON.stringify(Object.fromEntries(Object.entries(diagonalByTag).map(([t, d]) => [t, d === null ? null : 1e-9 * d]))));

      // §5.2.1's ONE-TIME, unmeasured R6 calibration pass -- once per runtime, before any measured
      // tuple, and frozen thereafter ("reused unchanged across every arm, state, and repetition").
      let r6 = null;
      if (selectedCases.includes('R6')) {
        const { T0, changedFlags, p0, p1 } = await calibrateR6Translation(page, { cohortDbIds: rCohorts.typical.requestedDbIds });
        const d = selectCalibrationMagnitude(changedFlags);
        console.log('R6 calibration:', JSON.stringify({ changedFlags, selectedD: d }));
        r6 = d === null
          // §5.2.1: "If no `d` in the sequence changes the pair set, R6 is reported NOT EXERCISED
          // with the sequence tried, rather than the sequence being extended ad hoc."
          ? { notExercised: { reason: 'no-calibration-magnitude-changed-the-pair-set', sequenceTried: R6_CALIBRATION_SEQUENCE } }
          : { T0, d, expectedPairDelta: pairSetDelta(p0, p1) };
        runtimeReport.r6Calibration = r6.notExercised ? r6 : { selectedD: d, expectedPairDelta: r6.expectedPairDelta, changedFlags };
      }

      const allStructureDbIds = profiles.map((p) => p.dbId);
      const ctx = { pageTargetId, rCohorts, s2CohortsByK, allStructureDbIds, r6, attributionPoisoned: false, harnessFailures: [] };

      const activeCases = selectedCases.filter((c) => caseRunsUnderRuntime(c, runtime));
      const schedule = buildCounterbalancedSchedule(activeCases, repetitionCount);
      const caseReports = new Map(activeCases.map((c) => [c, { caseName: c, variants: new Map() }]));

      for (const { repetition, caseOrder, armOrder } of schedule) {
        console.log(`\n-- repetition ${repetition} (arms ${armOrder.join('>')}, cases ${caseOrder.join(',')}) --`);
        for (const caseName of caseOrder) {
          if (caseName === 'R6' && ctx.r6?.notExercised) {
            caseReports.get(caseName).notExercised = ctx.r6.notExercised;
            continue;
          }
          let variants = caseVariantsFor(caseName, ctx);
          // §5.6: S2T's population-LEVEL order is counterbalanced alongside arm and case order --
          // higher levels run longer, so a fixed level order would correlate the population factor
          // with thermal and runtime drift. Same rotation rule, reused rather than re-derived.
          if (caseName === 'S2T') variants = caseOrderForRepetition(variants, repetition);

          for (const variant of variants) {
            const caseReport = caseReports.get(caseName);
            const vKey = variant.key ?? '(single)';
            if (!caseReport.variants.has(vKey)) caseReport.variants.set(vKey, { key: vKey, repetitions: [], notExercised: variant.notExercised ?? null });
            const variantReport = caseReport.variants.get(vKey);
            if (variant.notExercised) continue; // recorded by name above; never silently skipped

            // §6.4's witness tolerance needs the TARGET's world diagonal too, and for S2T the
            // target is the facade -- which does not exist when the federation's diagonals are
            // measured once per runtime above (independent-review finding, High). Re-measured per
            // level, since each level appends more distant bystanders and therefore genuinely
            // changes the facade's own world extent.
            let scales = diagonalByTag;
            if (variant.s2tLevel !== undefined) {
              await installS2TFacade(page, variant.s2tLevel);
              scales = await page.evaluate(() => window.__m4Gate.worldDiagonalsByTag());
            } else if (variant.s4) {
              // S4's facades don't change per-repetition the way S2T's bystander count changes per
              // level, but they still don't exist when the federation-wide `diagonalByTag` was
              // captured once at the top of the run, so the same re-measurement is required.
              // Mode-specific Z placement (installS4Facades's own header comment): `variant.descriptor.mode`
              // decides which Z gap regime this variant's facades use.
              await installS4Facades(page, variant.descriptor.mode);
              scales = await page.evaluate(() => window.__m4Gate.worldDiagonalsByTag());
            }
            try {
              const arms = {};
              for (const broadPhase of armOrder) {
                arms[broadPhase] = await runArmTuple(page, cdp, ctx, { caseName, variant, broadPhase, repetition, runtimeLabel: runtime.label });
              }

              // §6.4: every TLAS/linear pair of runs for the same (case, state, repetition) is
              // compared. A `false` disposition is FAILED_VALIDATION and aborts -- "a performance
              // verdict never fails the process; a correctness violation always does."
              const parity = {};
              for (const state of measuredStatesFor(caseName)) {
                const a = arms.tlas?.states?.[state];
                const b = arms.linear?.states?.[state];
                if (!a?.run || !b?.run) { parity[state] = { compared: false, reason: 'one or both arms produced no result set' }; continue; }
                const cmp = compareRunsAtPairScale(a.run, b.run, scales);
                // A bare `diagnostics: false` (or `pairSet: false`) is not actionable evidence --
                // §16.2 aborts the whole run on it, so the record has to say WHAT differed, or the
                // next person has to reproduce a multi-minute matrix run to find out.
                const diff = cmp.valid ? null : describeRunDifference(a.run, b.run);
                const divergence = diff ? classifyDiagnosticsDivergence(diff) : { kind: 'none' };
                // See TIME_BUDGET_DEPENDENT_DIAGNOSTIC_REASONS above: a divergence confined to the
                // wall-clock-dependent diagnostic reasons is a NAMED, reported finding rather than
                // FAILED_VALIDATION. Every other field, and every other diagnostic reason, still
                // aborts the run exactly as §6.4 requires.
                const onlyDiagnosticsDiffer = diff !== null
                  && cmp.fields.pairSet && cmp.fields.statistics && cmp.fields.distances && cmp.fields.witnesses
                  && !cmp.fields.diagnostics;
                const tolerated = onlyDiagnosticsDiffer && divergence.kind === 'TIME_BUDGET_DIAGNOSTIC_DIVERGENCE';
                parity[state] = { ...cmp, diff, divergence, tolerated };
                if (tolerated) {
                  timeBudgetDivergences.push({ caseName, variant: vKey, state, repetition, broadPhaseArms: armOrder, divergence });
                  console.log(`   ~ TIME_BUDGET_DIAGNOSTIC_DIVERGENCE at ${caseName}[${vKey}]/${state}: ${JSON.stringify(divergence.reasons)} (${divergence.diagnosticCounts.a} vs ${divergence.diagnosticCounts.b} diagnostics; every other §6.4 field equal)`);
                }
                if (!cmp.valid && !tolerated && !failedValidation) {
                  failedValidation = {
                    runtime: runtime.label, caseName, variant: vKey, state, repetition,
                    fields: cmp.fields, partitions: cmp.partitions, diff, divergence,
                  };
                }
              }

              const r6Violations = variant.r6 && arms.tlas && arms.linear
                ? Object.fromEntries(armOrder.map((bp) => [bp, checkR6ArmRules({ states: arms[bp].states, broadPhase: bp, expectedPairDelta: ctx.r6.expectedPairDelta })]))
                : null;
              if (r6Violations && Object.values(r6Violations).some((v) => v.length) && !failedValidation) {
                failedValidation = { runtime: runtime.label, caseName, variant: vKey, repetition, r6Violations };
              }

              const s2tControls = variant.s2tLevel !== undefined ? await readS2TFacadeControls(page) : null;
              // Captured HERE, where `arms` still holds the raw windows. `summarizeArmTuple` below
              // deliberately strips each window's full `run` (thousands of pair objects per tuple
              // would otherwise be retained for the whole matrix), so a control rule reconstructed
              // from the summary later finds no result set at all -- which is exactly what happened
              // on the first run of this code, reporting a vacuous NOT_EXERCISED for a sweep whose
              // four levels had all measured cleanly.
              const s2tLevelRecords = variant.s2tLevel === undefined ? null : Object.entries(arms).flatMap(([broadPhase, tuple]) =>
                Object.entries(tuple.states)
                  .filter(([state, w]) => state !== 'r6' && w?.run)
                  .map(([state, w]) => ({
                    group: `rep=${repetition}:${broadPhase}:${state}`,
                    record: buildS2TLevelRecord(w.run, { level: variant.s2tLevel, controls: s2tControls }),
                  })));
              variantReport.repetitions.push({
                repetition, armOrder,
                arms: Object.fromEntries(Object.entries(arms).map(([bp, t]) => [bp, summarizeArmTuple(t)])),
                parity, r6Violations, s2tControls, s2tLevel: variant.s2tLevel ?? null,
                s2tLevelRecords, worldDiagonalsByTag: scales,
                cohort: variant.cohort ? { status: variant.cohort.status, requestedDbIds: variant.cohort.requestedDbIds, achievedInstances: variant.cohort.achievedInstances, weightedDensity: variant.cohort.weightedDensity ?? null } : null,
                densityUnstratified: variant.densityUnstratified ?? null,
              });
              logTupleLine(runtime.label, caseName, vKey, repetition, arms, parity);
            } finally {
              if (variant.s2tLevel !== undefined) await disposeS2TFacade(page);
              if (variant.s4) await disposeS4Facades(page);
            }

            if (failedValidation || ctx.harnessFailures.length) break;
            // The attribution-poisoning rule (independent-review finding): after a capacity
            // rejection or any other early failure, background collision work may still be in
            // flight whose spans would report into a LATER window's recorder through a call site
            // that is not generation-bound (collision/README.md:829 documents exactly this for the
            // direct `reportSpan` sites). Rather than let that silently corrupt a later tuple's
            // stage attribution -- or poison the whole remaining run -- the page is rebuilt, which
            // replaces the module realm those recorders live in outright.
            if (ctx.attributionPoisoned) {
              console.log('   ! rebuilding the page: an earlier query failed and background work may still be in flight');
              ctx.attributionPoisoned = false;
              await page.reload();
              await loadFixtureAndReconfirm(page);
              await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
              await installGateHelpers(page);
              await sacrificialWarmup(page);
            }
          }
          if (failedValidation || ctx.harnessFailures.length) break;
        }
        if (failedValidation || ctx.harnessFailures.length) break;
      }

      // §5.3.1's level-to-level mechanical control rule, over the FULL level set. The optional
      // `expectedLevels` argument is passed deliberately: without it the checker accepts any two
      // or more levels, and this is the real sweep, not Task 3.4's two-level smoke proof.
      if (caseReports.has('S2T')) {
        runtimeReport.s2tControlRule = await checkS2TControlRule(page, caseReports.get('S2T'));
      }

      runtimeReport.harnessFailures = ctx.harnessFailures;
      if (ctx.harnessFailures.length) harnessFailures.push(...ctx.harnessFailures.map((f) => ({ runtime: runtime.label, ...f })));
      runtimeReport.cases = [...caseReports.values()].map((c) => ({
        caseName: c.caseName, notExercised: c.notExercised ?? null,
        variants: [...c.variants.values()],
      }));
    } finally {
      await browser.close();
    }
    results.runtimes.push(runtimeReport);
    if (failedValidation || harnessFailures.length) break;
  }

  results.finishedAt = new Date().toISOString();
  results.failedValidation = failedValidation;
  results.timeBudgetDivergences = timeBudgetDivergences;
  results.harnessFailures = harnessFailures;
  console.log('\n=== Baseline matrix complete ===');
  console.log(JSON.stringify(summarizeRun(results), null, 2));

  if (failedValidation) {
    console.error('FAILED_VALIDATION:', JSON.stringify(failedValidation, null, 2));
    throw new Error('FAILED_VALIDATION — a §6.4 correctness comparison or a §5.2.1 R6 rule failed; see the record above');
  }
  if (harnessFailures.length) {
    console.error('HARNESS_FAILURE:', JSON.stringify(harnessFailures, null, 2));
    throw new Error(`HARNESS_FAILURE — ${harnessFailures.length} measured quer(ies) threw an unexpected, non-capacity error; the matrix is incomplete and its numbers must not be read as a result`);
  }
  return results;
}

// §5.3.1's control rule, evaluated on the LEVELS ACTUALLY MEASURED. Reported as PARTIALLY_VERIFIED
// rather than as a clean pass, because Task 3.4's own report records two of §5.3.1's six required
// conditions as deliberately unimplemented (exact `clearanceExactAabbSurvivors` PAIR-SET equality,
// and the four-way narrow-phase outcome mix) -- neither is derivable from `findClashes`'s current
// public contract without new `collision/` instrumentation, which is a Global Constraint this task
// must not cross. Reporting `pass: true` from the existing checker alone would overstate
// conformance with a rule whose full form was never checked.
const S2T_UNVERIFIED_CONDITIONS = [
  'clearanceExactAabbSurvivors pair-set identity (only its COUNT is checkable from the public contract)',
  'four-way narrow-phase outcome mix, count-for-count (no existing statistic exposes those four buckets)',
];

// Independent-review finding (High), fixed here: the level-to-level comparison is run for EVERY
// (repetition, arm, state) group, not only for repetition 0's TLAS warm sample. A synthetic-fragment
// leak or a survivor-count divergence that first appears in repetition 2, on the linear arm, or in
// a cold sample is exactly as much a control-rule violation as one in the first group -- and the
// single-group form would have reported a clean pass over all of them.
//
// Pairs, distances and witnesses are all keyed and SORTED by ONE canonical full pair key. The
// previous unsorted `run.pairs` order made distance/witness equality depend on traversal order,
// which is not contractual: the TLAS and linear arms can legitimately return identical pairs in
// different orders, which would have produced a false level-to-level mismatch.
function buildS2TLevelRecord(run, { level, controls }) {
  const key = (p) => `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId < 0 ? 'synthetic' : p.targetDbId}:${p.type}`;
  const sorted = [...run.pairs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return {
    level,
    realCount: controls?.realFragmentCount ?? 0,
    targetModelId: controls?.targetModelId,
    statistics: run.statistics,
    diagnostics: run.statistics.diagnostics,
    pairSignatures: sorted.map(key),
    pairDistances: sorted.map((p) => [key(p), p.distance]),
    pairWitnesses: sorted.map((p) => [key(p), p.witness]),
    syntheticVizmeshAccessCount: controls?.syntheticVizmeshAccessCount ?? 0,
  };
}

async function checkS2TControlRule(page, s2tCaseReport) {
  // Group every measured S2T window by (repetition, arm, state); each such group is one complete
  // level-to-level comparison across whatever levels that group actually covered.
  const groups = new Map();
  for (const variant of s2tCaseReport.variants.values()) {
    for (const rep of variant.repetitions) {
      for (const { group, record } of rep.s2tLevelRecords ?? []) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(record);
      }
    }
  }
  if (groups.size === 0) {
    return { coverage: 'NOT_EXERCISED', reason: 'no S2T window produced a result set', unverifiedConditions: S2T_UNVERIFIED_CONDITIONS };
  }

  const perGroup = [];
  for (const [gk, levelResults] of groups) {
    if (levelResults.length < 2) {
      perGroup.push({ group: gk, coverage: 'NOT_EXERCISED', reason: 'fewer than two S2T levels measured in this group' });
      continue;
    }
    const measuredLevels = levelResults.map((l) => l.level).sort((a, b) => a - b);
    // `expectedLevels` is passed deliberately: without it the checker accepts ANY two or more
    // levels, and this is the real sweep, not Task 3.4's two-level smoke proof.
    const checked = await page.evaluate(
      ({ results, expected }) => window.__m4Probes.checkS2TLevelToLevelControlRule(results, expected),
      { results: levelResults, expected: measuredLevels },
    );
    perGroup.push({
      group: gk, coverage: 'PARTIALLY_VERIFIED', checked, levelsMeasured: measuredLevels,
      allLevelsMeasured: JSON.stringify(measuredLevels) === JSON.stringify([...S2T_LEVELS].sort((a, b) => a - b)),
    });
  }

  return {
    coverage: 'PARTIALLY_VERIFIED',
    groupsChecked: perGroup.length,
    allGroupsPass: perGroup.every((g) => g.coverage !== 'PARTIALLY_VERIFIED' || g.checked.pass),
    violations: perGroup.filter((g) => g.checked && !g.checked.pass).map((g) => ({ group: g.group, violated: g.checked.violated })),
    perGroup,
    fullLevelSet: S2T_LEVELS,
    unverifiedConditions: S2T_UNVERIFIED_CONDITIONS,
  };
}

// ---- §6.4's diagnostics rule vs. a WALL-CLOCK-dependent diagnostic ------------------------------
//
// REAL FINDING, empirically demonstrated by this task's own first full S2 sweep and escalated for a
// controller ruling in this task's report. §6.4 requires MULTISET equality of `diagnostics` between
// the TLAS and linear arms, and makes any difference `FAILED_VALIDATION`. One diagnostic reason
// cannot satisfy that by construction:
//
//   `crossing-budget-exhausted` is emitted when `now() - traversalStart > timeBudgetMs`
//   (collision/query/ProperCrossingQuery.js:85, :130) -- a WALL-CLOCK budget on a private,
//   traversal-local clock (§6.2's own note that ProperCrossingQuery/SurfaceIntersectionQuery
//   deliberately do NOT share the frame-budget accumulator). Whether a given candidate pair aborts
//   therefore depends on how fast the machine happened to be at that instant, not on geometry and
//   not on which broad phase produced the pair.
//
// Observed directly: two consecutive `--cases=S2` runs aborted at DIFFERENT variants
// (`k=10:low:volume-overlap` and `k=50:low:volume-overlap`), each time with `pairSet`,
// `statistics`, `distances` and `witnesses` ALL equal and the ONLY difference being a single
// `crossing-budget-exhausted` entry (108 diagnostics vs 107) on one pair. The two arms agreed
// perfectly about every clash; they disagreed about how long one traversal took.
//
// `inconclusive-crossing` is included because it is the SAME timing decision seen from the other
// side: `ProperCrossingQuery.js:167` computes `inconclusive = !aborted && ...`, so an abort
// suppresses an `inconclusive-crossing` that the non-aborting arm reports.
//
// Handling, deliberately conservative in both directions:
//   - A diagnostics divergence confined ENTIRELY to these reasons is reported as its own named
//     finding, `TIME_BUDGET_DIAGNOSTIC_DIVERGENCE`, carried verbatim on the tuple. It is NOT
//     silently dropped and NOT folded into a "pass".
//   - A diagnostics divergence involving ANY other reason remains `FAILED_VALIDATION`, exactly as
//     §6.4 requires -- this narrows the rule to one demonstrably non-deterministic signal, it does
//     not relax the rule.
// Treating it as FAILED_VALIDATION instead would make the gate unable to complete a single full
// matrix run on a real machine, for a reason that is not a correctness defect; that is why this is
// escalated rather than either enforced blindly or quietly ignored.
const TIME_BUDGET_DEPENDENT_DIAGNOSTIC_REASONS = new Set(['crossing-budget-exhausted', 'inconclusive-crossing']);

function classifyDiagnosticsDivergence(diff) {
  if (diff.diagnosticsDiff.length === 0) return { kind: 'none', entries: [] };
  const reasons = diff.diagnosticsDiff.map((d) => { try { return JSON.parse(d.key).reason; } catch { return null; } });
  const allTimeBudget = reasons.length > 0 && reasons.every((r) => r !== null && TIME_BUDGET_DEPENDENT_DIAGNOSTIC_REASONS.has(r));
  return {
    kind: allTimeBudget ? 'TIME_BUDGET_DIAGNOSTIC_DIVERGENCE' : 'REAL',
    reasons: [...new Set(reasons)],
    entries: diff.diagnosticsDiff,
    diagnosticCounts: diff.diagnosticCounts,
  };
}

// Names exactly which pair signatures and which diagnostic entries differ between two arms, using
// the SAME keys §6.4 (and Task 3.6's comparator) join on -- never a narrower key, or the diff would
// describe a different disagreement from the one that failed the gate.
function describeRunDifference(runA, runB) {
  const pairSig = (p) => `${p.sourceModelTag}:${p.sourceDbId}:${p.targetModelTag}:${p.targetDbId}:${p.type}`;
  const diagKey = (d) => JSON.stringify({
    reason: d.reason, scope: d.scope, role: d.role ?? null,
    fragment: d.fragment, sourceFragment: d.sourceFragment, targetFragment: d.targetFragment,
  });
  const tally = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = key(x); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const diffTally = (ma, mb) => {
    const out = [];
    for (const k of new Set([...ma.keys(), ...mb.keys()])) {
      const ca = ma.get(k) ?? 0;
      const cb = mb.get(k) ?? 0;
      if (ca !== cb) out.push({ key: k, inA: ca, inB: cb });
    }
    return out;
  };
  const diagDiff = diffTally(tally(runA.statistics.diagnostics, diagKey), tally(runB.statistics.diagnostics, diagKey));
  return {
    pairSetDiff: diffTally(tally(runA.pairs, pairSig), tally(runB.pairs, pairSig)).slice(0, 20),
    diagnosticsDiff: diagDiff.slice(0, 20),
    diagnosticsDiffCount: diagDiff.length,
    diagnosticCounts: { a: runA.statistics.diagnostics.length, b: runB.statistics.diagnostics.length },
    statisticsDiff: Object.fromEntries(
      Object.entries(runA.statistics)
        .filter(([k, v]) => k !== 'diagnostics' && v !== runB.statistics[k])
        .map(([k, v]) => [k, { a: v, b: runB.statistics[k] }]),
    ),
  };
}

// §4's capacity-rejection classification, over BOTH error channels -- see the note at its call
// site for why the plain-`Error` linear ceiling makes this necessary.
function capacityRejectionOf(w) {
  if (w.capacityError) return toCapacityRejectedRecord(w.capacityError);
  if (w.otherError && recognizeCapacityRejection(w.otherError)) return toCapacityRejectedRecord(w.otherError);
  return null;
}

function summarizeArmTuple(tuple) {
  const out = { tupleKey: tuple.tupleKey, states: {} };
  for (const [state, w] of Object.entries(tuple.states)) {
    if (state === 'r6' || !w) continue;
    out.states[state] = {
      makespanMs: w.makespanMs,
      targets: w.targets,
      targetMeasurements: w.targetMeasurements,
      screenResidualMs: w.screenResidualMs,
      boundaries: w.boundaries,
      unattributableStageIntervals: w.unattributableStageIntervals,
      unattributableStageTimeMs: w.unattributableStageTimeMs,
      unmappedSpanLabels: w.unmappedSpanLabels,
      taDiagnostics: w.taDiagnostics,
      envelope: w.envelope,
      yieldCount: w.yieldCount,
      cumulativeYieldMs: w.cumulativeYieldMs,
      spanTotalsMs: w.spanTotalsMs,
      diagnosticEventCount: w.diagnosticEventCount,
      observationCount: w.observationCount,
      pairCount: w.run ? w.run.pairs.length : null,
      statistics: w.run ? { ...w.run.statistics, diagnostics: undefined, diagnosticCount: w.run.statistics.diagnostics.length } : null,
      // §4: a capacity rejection is reported with its exact limit and observed value, never trimmed.
      //
      // `otherError` is classified too, not just `capacityError` -- found on the first live S3 run:
      // the §9.3.1 LINEAR broad-phase ceiling is thrown as a PLAIN `Error`
      // (collision/CollisionWorld.js:1598), not a `CapacityExceededError`, so the in-page catch
      // routes it to `otherError` and it was being reported as an anonymous run failure instead of
      // the §4 capacity FINDING it actually is. `recognizeCapacityRejection` reads its limit and
      // observed value out of the message, which is the only place that error carries them.
      capacityRejection: capacityRejectionOf(w),
      error: capacityRejectionOf(w) ? null : (w.otherError ?? null),
    };
  }
  return out;
}

function logTupleLine(runtimeLabel, caseName, vKey, repetition, arms, parity) {
  const parts = [];
  for (const [bp, tuple] of Object.entries(arms)) {
    for (const [state, s] of Object.entries(summarizeArmTuple(tuple).states)) {
      const ta = s.targetMeasurements?.tA;
      const taStr = ta?.status === 'DETERMINED' ? `maxTask=${ta.maxTaskMs.toFixed(1)}ms${ta.pass ? '' : ' !T-a'}` : `T-a ${ta?.status ?? '?'}(${ta?.reason ?? '-'})`;
      const cap = s.capacityRejection ? ` CAPACITY_REJECTED(${s.capacityRejection.limitName} ${s.capacityRejection.observedValue}>${s.capacityRejection.limitValue})` : '';
      parts.push(`${bp}/${state} ${s.makespanMs?.toFixed(0)}ms ${taStr} Ri=${s.screenResidualMs === null ? '-' : s.screenResidualMs.toFixed(1)} pairs=${s.pairCount ?? '-'}${cap}`);
    }
  }
  const parityStr = Object.entries(parity).map(([st, p]) => `${st}:${p.compared === false ? 'n/a' : (p.valid ? 'OK' : 'MISMATCH')}`).join(' ');
  console.log(`  [${runtimeLabel}] ${caseName}${vKey === '(single)' ? '' : `[${vKey}]`} rep${repetition} | ${parts.join(' | ')} | parity ${parityStr}`);
}

// Aggregate HEALTH signals across every measured window in a runtime. These are the things that,
// left un-surfaced, would let a green-looking multi-hour run hide the fact that its central
// evidence was never actually produced -- every T-a UNEVALUABLE for one reason, or every stage
// interval discarded as un-attributable, or a span label silently outside §6.3's table.
function healthCounters(runtimeReport) {
  const taStatus = {};
  const tcStatus = {};
  const framesStatus = {};
  const unevaluableReasons = {};
  const unmappedSpanLabels = new Set();
  let windows = 0;
  let unattributableIntervals = 0;
  let unattributableMs = 0;
  let envelopeLimitReached = 0;
  let capacityRejections = 0;
  let errors = 0;

  for (const c of runtimeReport.cases ?? []) {
    for (const v of c.variants ?? []) {
      for (const rep of v.repetitions ?? []) {
        for (const arm of Object.values(rep.arms ?? {})) {
          for (const s of Object.values(arm.states ?? {})) {
            windows++;
            const ta = s.targetMeasurements?.tA;
            taStatus[ta?.status ?? 'MISSING'] = (taStatus[ta?.status ?? 'MISSING'] ?? 0) + 1;
            if (ta?.status === 'UNEVALUABLE') unevaluableReasons[ta.reason] = (unevaluableReasons[ta.reason] ?? 0) + 1;
            tcStatus[s.targetMeasurements?.tC?.status ?? 'MISSING'] = (tcStatus[s.targetMeasurements?.tC?.status ?? 'MISSING'] ?? 0) + 1;
            framesStatus[s.targetMeasurements?.frames?.status ?? 'MISSING'] = (framesStatus[s.targetMeasurements?.frames?.status ?? 'MISSING'] ?? 0) + 1;
            unattributableIntervals += (s.unattributableStageIntervals ?? []).length;
            unattributableMs += s.unattributableStageTimeMs ?? 0;
            for (const l of s.unmappedSpanLabels ?? []) unmappedSpanLabels.add(l);
            if (s.envelope?.limitReached) envelopeLimitReached++;
            if (s.capacityRejection) capacityRejections++;
            if (s.error) errors++;
          }
        }
      }
    }
  }
  return {
    measuredWindows: windows, taStatus, tcStatus, frameRecorderStatus: framesStatus,
    taUnevaluableReasons: unevaluableReasons,
    unattributableStageIntervals: unattributableIntervals,
    unattributableStageTimeMs: Number(unattributableMs.toFixed(3)),
    unmappedSpanLabels: [...unmappedSpanLabels],
    envelopeLimitReached, capacityRejections, errors,
  };
}

function summarizeRun(results) {
  return {
    runtimes: results.runtimes.map((r) => ({
      health: healthCounters(r),
      runtime: r.runtime, chromiumVersion: r.chromiumVersion,
      acceptedTopLevelTaskNames: r.acceptedTopLevelTaskNames,
      worldDiagonalsByTag: r.worldDiagonalsByTag,
      s2tControlRule: r.s2tControlRule ?? null,
      cases: r.cases.map((c) => ({
        caseName: c.caseName,
        notExercised: c.notExercised,
        variants: c.variants.map((v) => ({
          key: v.key, notExercised: v.notExercised, repetitions: v.repetitions.length,
        })),
      })),
    })),
    failedValidation: results.failedValidation,
    harnessFailures: results.harnessFailures ?? [],
    timeBudgetDiagnosticDivergences: {
      count: (results.timeBudgetDivergences ?? []).length,
      tuples: (results.timeBudgetDivergences ?? []).map((d) => `${d.caseName}[${d.variant}]/${d.state}#${d.repetition}`),
    },
  };
}

// `node --test` to an explicit list of this repo's own `*.test.mjs` files (this file does not
// match that suffix), which already prevents a sweep from reaching this file today -- the
// `NODE_TEST_CONTEXT` check below is the same defense-in-depth every sibling file carries, in case
// a future change reintroduces a bare, unscoped `node --test`.
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
