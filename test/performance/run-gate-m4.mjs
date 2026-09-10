// test/performance/run-gate-m4.mjs
//
// M4 Task 3.1: the runtime/fixture lifecycle skeleton for the M4 (Worker-vs-main-thread decision)
// performance gate. Sibling to test/performance/run-gate.mjs (M1), run-gate-m2.mjs (M2), and
// run-gate-m3.mjs (M3) -- ALL THREE of which are UNTOUCHED by this file (protected invariant).
//
// This file proves §6.1 steps 1-4 (launch -> load -> live re-confirm -> sacrificial warm-up ->
// fresh-world construct/dispose) end to end, over BOTH RUNTIME_CONFIGS entries (`historical` and
// `multiProcess` -- see test/performance/m4/fixture-lifecycle.mjs), with exactly ONE throwaway
// query per runtime. It deliberately does NOT wire the real R1-R6/S1-S4/S2T case matrix (task 3.7)
// or the observation envelope (task 3.2) -- those are later tasks. No span recorder is installed
// anywhere in this file; nothing here is "measured" in the M4 sense yet.
//
// Run: node test/performance/run-gate-m4.mjs   (npm run test:performance:gate:m4)

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
import { RUNTIME_CONFIGS, resolveProxyFromEnv, freshWorldTupleKey, measuredStatesFor } from './m4/fixture-lifecycle.mjs';
import {
  dispositionForObservation, tCDispositionForRepetition, envelopeLimitMs,
  calibrateNodeToRendererClock, nodeMsToRendererMs, applyClockUncertainty,
} from './m4/observation-envelope.mjs';

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
  const sendPromises = []; // collected, not awaited per-iteration -- see the note below the loop
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
    dispatched.push({ coord: { x, y }, scheduledNodeMs, dispatchNodeMs });
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

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  for (const runtime of Object.values(RUNTIME_CONFIGS)) {
    console.log(`\n=== Runtime: ${runtime.label} ===`);
    const browser = await chromium.launch({ args: runtime.args, proxy: resolveProxyFromEnv() });
    try {
      // page creation lives INSIDE the try (codex-review finding #4 on this task): if newPage()
      // itself rejects, browser.close() below must still run rather than leaking the Chromium
      // child process.
      const page = await browser.newPage();
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
          groupBy: 'dbId',
          broadPhase: 'tlas',
        });
        w.dispose(); // fresh-world disposed before the next tuple, per §6.1.4
      }, { sourceDbId: SOURCE_DB_ID });
      console.log('Fresh-world construct/dispose lifecycle OK.');
    } finally {
      await browser.close();
    }
  }
}

// Guarded so Task 3.2's manual-verification scripts (and Task 3.7+ callers) can `import` this
// file's now-exported calibration/dispatch/resolve functions without ALSO triggering the whole
// Task 3.1 fixture-lifecycle main() run as an unwanted side effect of the import. Real bug found
// running this task's own manual verification (b): before this guard, `import ... from
// '../run-gate-m4.mjs'` in manual-verify-input-probe-block.mjs (exactly as the brief's own
// excerpt directs) launched a second, unrelated Chromium instance and started loading the full
// 3-model fixture against the live dev server purely as an import side effect, racing the manual
// script's own browser/page and polluting its console output. `node
// test/performance/run-gate-m4.mjs` (this file's own direct-run / npm script path) is unaffected.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
