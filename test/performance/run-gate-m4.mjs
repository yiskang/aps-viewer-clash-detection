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
import { fileURLToPath } from 'node:url';
import { RUNTIME_CONFIGS, resolveProxyFromEnv, freshWorldTupleKey, measuredStatesFor } from './m4/fixture-lifecycle.mjs';
import {
  dispositionForObservation, tCDispositionForRepetition, envelopeLimitMs,
  calibrateNodeToRendererClock, nodeMsToRendererMs, applyClockUncertainty,
} from './m4/observation-envelope.mjs';
import { rankByDensity, selectCohort } from './m4/cohort-selection.mjs';
import { S2T_LEVELS, bystanderLayout, syntheticIdRangeAbove } from './m4/s2t-bystander-layout.mjs';
import { R6_CALIBRATION_SEQUENCE, selectCalibrationMagnitude, pairSetsDiffer, pairSetDelta } from './m4/r6-calibration.mjs';

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

// M4 Task 3.3's manual-verification entry point (`--smoke-cohort-profiler`, a temporary flag task
// 3.7 removes once the profiler is wired into the real matrix scheduler). Runs
// browser-probes-m4.mjs's profileStructureCohortDensity ONCE against the live fixture (§5.4's own
// "profiling pass ... unmeasured" -- no recorder installed here), then feeds the result through
// this task's own pure rankByDensity/selectCohort to build the low/typical/high cohorts, and
// prints exactly the shape the brief's manual-verification step asks for.
//
// Passes an explicit [modelArch, modelStructure, modelMechanical] array (built from the already
// URN-verified window.__gate identities set up by loadFixtureAndReconfirm) rather than
// window.viewer.getAllModels() directly -- profileStructureCohortDensity's own contract indexes
// `models[1]` for the Structure model, and this codebase already has one confirmed real defect
// (Task 3.1's own codex-review finding) from trusting getAllModels()'s array position as model
// identity. Building the array from the URN-resolved identities instead guarantees index 1 really
// is Structure regardless of getAllModels()'s own internal ordering.
async function runSmokeCohortProfiler(page) {
  await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
  const rawProfiles = await page.evaluate(() => {
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    return window.__m4Probes.profileStructureCohortDensity([modelArch, modelStructure, modelMechanical]);
  });
  // Real bug found running this: Playwright's page.evaluate return-value serialization does NOT
  // preserve Set objects (confirmed empirically -- a returned Set comes back as `{}`, every member
  // silently dropped), so profileStructureCohortDensity crosses the boundary with fragmentIds as a
  // plain array. Reconstruct the real Set here, immediately after the evaluate call, to satisfy
  // this task's own documented Produces contract (Array<{dbId, proximity, fragmentIds: Set<number>}>)
  // before anything (rankByDensity/selectCohort) reads .size or iterates it.
  const profiles = rawProfiles.map((p) => ({ ...p, fragmentIds: new Set(p.fragmentIds) }));

  const ranked = rankByDensity(profiles);
  const top5ByDensity = ranked.slice(0, 5).map((r) => ({ dbId: r.dbId, density: r.density, proximity: r.proximity, instances: r.instances }));

  // Representative cohort size for this temporary smoke proof only -- task 3.7 owns wiring the
  // REAL per-case k values (§5.2's table) for R3/R4/R6/S2. 0.25/0.5/0.9 are §5.4's own
  // low/typical/high quantiles; SOURCE_DB_ID is forced into the high cohort per §5.4 step 5.
  const SMOKE_K = 10;
  const low = selectCohort(ranked, 0.25, SMOKE_K);
  const typical = selectCohort(ranked, 0.5, SMOKE_K);
  const high = selectCohort(ranked, 0.9, SMOKE_K, { forceDbId: SOURCE_DB_ID });

  console.log('Cohort profiler smoke result:', JSON.stringify({
    dbIdCount: profiles.length,
    top5ByDensity,
    low: { status: low.status, size: low.requestedDbIds.length, requestedDbIds: low.requestedDbIds },
    typical: { status: typical.status, size: typical.requestedDbIds.length, requestedDbIds: typical.requestedDbIds },
    high: { status: high.status, size: high.requestedDbIds.length, requestedDbIds: high.requestedDbIds },
  }, null, 2));
}

// M4 Task 3.4's manual-verification entry point (`--smoke-s2t`, a temporary flag task 3.7 removes
// once S2T is wired into the real matrix). Builds the S2T facade (browser-probes-m4.mjs's
// buildS2TFacade) at S2T_LEVELS[0] (baseline, 0 bystanders -- the real Architecture model
// unchanged) and S2T_LEVELS[1] (10,000 admitted instances), runs an IDENTICAL clearance query
// through each -- same source (Structure dbId 3076), same clearance, same broadPhase, the facade
// as the sole target -- in its own fresh CollisionWorld (disposed before the next level, same
// fresh-world discipline as every other measured tuple in this file), then prints
// checkS2TLevelToLevelControlRule's result plus facade.getCount() at level 1.
//
// Measures the real Architecture model's own fragment AND geometry-id maxima live (never assumes
// the ~5,435 figure documented in run-gate-m3.mjs's header is exactly right for whatever fixture
// state is live right now) and feeds both through syntheticIdRangeAbove, so the synthetic
// fragment/geometry ranges this run hands to bystanderLayout are always genuinely disjoint from
// the real model's own ids -- not just fragment ids (§5.3.1 point 3's own explicit rationale) but
// geometry ids too: two fragments sharing a geometry id are treated as sharing one real mesh
// (createGeometryIdentity is scoped per loadEpoch, and the facade's real and synthetic fragments
// share the same epoch), so a synthetic geometry id that accidentally collided with a real one
// would silently alias a bystander onto a real mesh's cached geometry entry.
async function runSmokeS2T(page) {
  await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });

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
  const syntheticFragmentIdStart = syntheticIdRangeAbove(realFragmentCount - 1);
  const syntheticGeometryIdStart = syntheticIdRangeAbove(realGeometryIdMax);

  const smokeLevels = S2T_LEVELS.slice(0, 2); // baseline (0 bystanders) + level 1 (10,000) is sufficient for this smoke proof
  const levelResults = [];
  let facadeCountAtLevel1 = null;
  for (const level of smokeLevels) {
    const bystanderCount = level - realFragmentCount;
    if (bystanderCount < 0) {
      throw new Error(`S2T smoke: level ${level} is below the live fixture's own real fragment count ${realFragmentCount}`);
    }
    const bystanders = bystanderLayout(bystanderCount, { syntheticFragmentIdStart, syntheticGeometryIdStart });

    const result = await page.evaluate(async ({ sourceDbId, clearance, bystanders }) => {
      const { CollisionWorld } = await import('/collision/index.js');
      const facade = window.__m4Probes.buildS2TFacade(window.__gate.modelArch, bystanders);
      const w = await CollisionWorld.fromViewer(window.viewer);
      w.admitModel(window.__gate.modelStructure);
      w.admitModel(facade);
      try {
        const { pairs, statistics } = await w.findClashes({
          mode: 'clearance',
          clearance,
          source: { model: window.__gate.modelStructure, dbIds: [sourceDbId] },
          target: { targets: [{ model: facade }] },
          groupBy: 'dbId',
          broadPhase: 'tlas',
        });
        // Same keyed-signature convention run-gate-m3.mjs's own TLAS-vs-linear comparator already
        // established (`modelTag` + sorted "source:dbId:target:dbId:type" strings), reused here
        // ACROSS LEVELS instead of across broad-phase arms, per §5.3.1 line 237 ("by §6.4's field
        // rules"). A target dbId < 0 is one of this facade's own synthetic bystander dbIds (see
        // buildS2TFacade's `getDbIds`) -- tagged 'synthetic' in the key itself, never a raw negative
        // number, so checkS2TLevelToLevelControlRule's leak check can name it without re-deriving
        // the synthetic-dbId convention on its own side.
        //
        // Deliberately omits M3's own `modelTag` (`(m) => m === modelArch ? 'arch' : ...`) from the
        // key: this query only ever has two participants, one fixed source (Structure) and one
        // fixed target (the facade) -- unlike M3's three-model cross-product, there is no model
        // ambiguity a dbId alone could introduce here, so the literal `source:`/`target:` prefixes
        // already carry all the disambiguating information a tag would.
        const targetTag = (dbId) => (dbId < 0 ? 'synthetic' : String(dbId));
        const keyOf = (p) => `source:${p.source.dbId}:target:${targetTag(p.target.dbId)}`;
        const sortedPairs = [...pairs].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
        return {
          facadeCount: facade.getCount(),
          facadeId: facade.id,
          clearanceExactAabbSurvivors: statistics.clearanceExactAabbSurvivors,
          narrowPhasePairs: statistics.narrowPhasePairs,
          // Second codex-review pass, Important fix: four more already-public fields off this SAME
          // `statistics` object -- no new instrumentation -- now also carried per level so the
          // control rule can check them for level-to-level equality alongside the two above.
          clearanceOverlapPrechecksRun: statistics.clearanceOverlapPrechecksRun,
          clearanceHardClashExclusions: statistics.clearanceHardClashExclusions,
          clearanceDistanceQueriesRun: statistics.clearanceDistanceQueriesRun,
          clearanceHits: statistics.clearanceHits,
          diagnostics: statistics.diagnostics,
          pairSignatures: sortedPairs.map((p) => `${keyOf(p)}:${p.type}`),
          pairDistances: sortedPairs.map((p) => [keyOf(p), p.distance]),
          pairWitnesses: sortedPairs.map((p) => [keyOf(p), p.witness]),
          // §5.3.1 line 239's own verification counter -- see buildS2TFacade's comment.
          syntheticVizmeshAccessCount: facade.getSyntheticVizmeshAccessCount(),
        };
      } finally {
        w.dispose(); // fresh-world disposed before the next level, per §6.1.4
      }
    }, { sourceDbId: SOURCE_DB_ID, clearance: CLEARANCE, bystanders });

    levelResults.push({
      level,
      realCount: realFragmentCount,
      targetModelId: result.facadeId,
      statistics: {
        clearanceExactAabbSurvivors: result.clearanceExactAabbSurvivors,
        narrowPhasePairs: result.narrowPhasePairs,
        clearanceOverlapPrechecksRun: result.clearanceOverlapPrechecksRun,
        clearanceHardClashExclusions: result.clearanceHardClashExclusions,
        clearanceDistanceQueriesRun: result.clearanceDistanceQueriesRun,
        clearanceHits: result.clearanceHits,
      },
      diagnostics: result.diagnostics,
      pairSignatures: result.pairSignatures,
      pairDistances: result.pairDistances,
      pairWitnesses: result.pairWitnesses,
      syntheticVizmeshAccessCount: result.syntheticVizmeshAccessCount,
    });
    if (level === S2T_LEVELS[1]) facadeCountAtLevel1 = result.facadeCount;
  }

  const controlRuleResult = await page.evaluate(
    (results) => window.__m4Probes.checkS2TLevelToLevelControlRule(results),
    levelResults,
  );
  console.log('S2T smoke result:', JSON.stringify({
    realFragmentCount,
    levelSummaries: levelResults.map((r) => ({
      level: r.level,
      statistics: r.statistics,
      diagnosticCount: r.diagnostics.length,
      finalPairCount: r.pairSignatures.length,
      syntheticVizmeshAccessCount: r.syntheticVizmeshAccessCount,
    })),
    facadeCountAtLevel1,
    controlRuleResult,
  }, null, 2));
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
// individually satisfy "changed". The caller (`runSmokeR6Sequence`) computes the frozen expected
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
    const w0 = await CollisionWorld.fromViewer(window.viewer);
    w0.admitModel(modelArch); w0.admitModel(modelStructure); w0.admitModel(modelMechanical);
    const p0 = await runR3(w0);
    w0.dispose();
    const changedFlags = [];
    let firstChangeP1 = null;
    for (const d of sequence) {
      // Composition order: T_moved = Translation(d) x T0, pre-multiplied (§5.2.1) -- Matrix4#multiply
      // sets `this = this * arg`, so `Translation.multiply(T0)` is exactly `Translation x T0`.
      const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
      window.viewer.impl.setPlacementTransform(modelArch, composed);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // render stabilisation
      const w = await CollisionWorld.fromViewer(window.viewer);
      w.admitModel(modelArch); w.admitModel(modelStructure); w.admitModel(modelMechanical);
      const p1 = await runR3(w);
      w.dispose();
      const changed = JSON.stringify(p0) !== JSON.stringify(p1);
      changedFlags.push(changed);
      if (changed && firstChangeP1 === null) firstChangeP1 = p1; // §5.2.1: take the FIRST change only
      window.viewer.impl.setPlacementTransform(modelArch, new window.THREE.Matrix4().fromArray(T0));
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

// M4 Task 3.5's live half: §5.2.1 steps 1-5, the per-repetition move->invalidate->refresh->
// restore-in-`finally` protocol. `world` is a single, already-admitted CollisionWorld shared across
// this whole sequence's four queries (cold, warm, refresh, reconfirm) -- constructed and disposed by
// the caller (task 3.7's scheduler owns the one-fresh-world-per-tuple lifecycle, §6.1.4), passed in
// here as a Playwright JSHandle to the real in-page CollisionWorld object (confirmed empirically:
// Playwright resolves a JSHandle nested as a field inside page.evaluate's args object to the live
// in-page object reference, not just a bare top-level handle arg).
//
// Real bug found running this task's own manual verification: the brief's own excerpt referenced a
// bare `world` identifier inside the page.evaluate callback body without ever including it in the
// destructured parameter or in the object passed as page.evaluate's second argument. Playwright
// evaluate callbacks are serialized and re-evaluated inside the browser's own execution context --
// they do NOT close over the calling Node scope -- so `world` was an undeclared free variable.
// Confirmed empirically against the real fixture: running the excerpt exactly as written throws
// `ReferenceError: world is not defined` on the very first `world.findClashes(...)` call. Fixed by
// passing `world` explicitly through the same args object as every other value and destructuring it
// alongside them (verified empirically: a JSHandle nested as an object field resolves correctly to
// the live in-page object once actually included).
async function runR6Sequence(page, world, { cohortDbIds, broadPhase, T0, d }) {
  return page.evaluate(async ({ cohortDbIds, broadPhase, T0, d, world }) => {
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    // Codex-review fix (#2, Important): same model-identity-tagged signature convention as
    // calibrateR6Translation above (and M3's own comparator, run-gate-m3.mjs:313) -- see that
    // function's header comment for the dbId-collision rationale, identical here since this
    // sequence's own query targets the same three federated models.
    const modelTag = (m) => (m === modelArch ? 'arch' : m === modelStructure ? 'structure' : m === modelMechanical ? 'mechanical' : 'unknown');
    async function runR3() {
      const r = await world.findClashes({ mode: 'clearance', clearance: 0.05, source: { model: modelStructure, dbIds: cohortDbIds }, target: { targets: window.viewer.getAllModels().map((m) => ({ model: m })) }, groupBy: 'dbId', broadPhase });
      return { pairs: r.pairs.map((p) => `${modelTag(p.source.model)}:${p.source.dbId}:${modelTag(p.target.model)}:${p.target.dbId}:${p.type}`).sort(), tlasBuilds: r.statistics.tlasBuilds };
    }
    const step1Cold = await runR3(); // R6 cold sample
    const step1Warm = await runR3(); // R6 warm sample, records P0
    let refresh;
    let reconfirm;
    try {
      const composed = new window.THREE.Matrix4().makeTranslation(d, 0, 0).multiply(new window.THREE.Matrix4().fromArray(T0));
      window.viewer.impl.setPlacementTransform(modelArch, composed);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      world.invalidateModelPlacement(modelArch);
      refresh = await runR3(); // R6's THIRD measured query, the `refresh` state -- records P1
    } finally {
      window.viewer.impl.setPlacementTransform(modelArch, new window.THREE.Matrix4().fromArray(T0));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      world.invalidateModelPlacement(modelArch);
      const restored = Array.from(modelArch.getPlacementTransform?.()?.elements ?? new window.THREE.Matrix4().elements);
      const restoredOk = restored.every((v, i) => Math.abs(v - T0[i]) <= 1e-9);
      if (!restoredOk) throw new Error('R6 restoration could not be verified — aborting the entire run');
      // Correctness-only, unmeasured (§5.2.1 step 5) -- but its own tlasBuilds is still returned
      // below (not just its pairs) so a caller can assert the arm-specific rebuild-delta rule
      // ("again across restoration") over BOTH invalidations, not just the first (refresh) one.
      reconfirm = await runR3();
      if (JSON.stringify(reconfirm.pairs) !== JSON.stringify(step1Warm.pairs)) {
        throw new Error('R6 restoration verified by matrix but P0 was not recovered — aborting the entire run');
      }
    }
    return { cold: step1Cold, warm: step1Warm, refresh, reconfirm };
  }, { cohortDbIds, broadPhase, T0, d, world });
}

// M4 Task 3.5's manual-verification entry point (`--smoke-r6`, a temporary flag task 3.7 removes
// once R6 is wired into the real matrix). Builds R3's source set (the typical cohort, k=10 per
// §5.2's "target ~10 extracted instances" -- identical k to runSmokeCohortProfiler's own SMOKE_K),
// runs task 3.5's one-time calibration pass, then exercises the full move->invalidate->refresh->
// restore-in-`finally` sequence under both broad-phase arms, each in its own fresh, disposable
// CollisionWorld (§6.1.4), asserting the arm-specific `tlasBuilds` rule and the pair-set-diff rule
// from §5.2.1's own "Asserted" paragraph.
//
// `statistics.tlasBuilds` is a PER-QUERY count of builds performed DURING that one call, never a
// cumulative running total across the world's lifetime (confirmed empirically: the world's first,
// `cold` query reports 3 -- one per target epoch needing its first TLAS -- while the very next,
// `warm` query on the identical unchanged world reports 0). So the "tlasBuilds delta of 1" §5.2.1
// describes is each of `refresh`/`reconfirm`'s own count taken against the steady-state `warm`
// baseline (0, once nothing has changed) -- NOT `reconfirm.tlasBuilds - refresh.tlasBuilds` (which
// would incorrectly demand a SECOND independent rebuild on top of the first).
async function runSmokeR6Sequence(page) {
  await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
  const rawProfiles = await page.evaluate(() => {
    const { modelArch, modelStructure, modelMechanical } = window.__gate;
    return window.__m4Probes.profileStructureCohortDensity([modelArch, modelStructure, modelMechanical]);
  });
  const profiles = rawProfiles.map((p) => ({ ...p, fragmentIds: new Set(p.fragmentIds) }));
  const ranked = rankByDensity(profiles);
  const SMOKE_K = 10; // R3's own "target ~10 extracted instances" (§5.2's table)
  const typical = selectCohort(ranked, 0.5, SMOKE_K);
  if (typical.status !== 'OK') {
    throw new Error(`R6 smoke: typical cohort selection did not reach k=${SMOKE_K} (status=${typical.status})`);
  }
  const cohortDbIds = typical.requestedDbIds;

  const { T0, changedFlags, p0, p1 } = await calibrateR6Translation(page, { cohortDbIds });
  const d = selectCalibrationMagnitude(changedFlags);
  console.log('R6 calibration result:', JSON.stringify({ cohortDbIds, changedFlags, selectedD: d }));
  if (d === null) {
    console.log('R6 NOT EXERCISED: no d in the frozen sequence changed the pair set.');
    return;
  }
  // Codex-review fix (#1, Important): the frozen expected pair delta, computed ONCE from the
  // calibration pass's own p0 (baseline) / p1 (the first-changed set, at this same selected `d`) --
  // every arm's own observed delta below is compared against this SAME expected delta for EXACT
  // equality, not merely checked for non-emptiness (§5.2.1: "the resulting expected pair delta...
  // reused unchanged across every arm, state, and repetition").
  const expectedPairDelta = pairSetDelta(p0, p1);
  console.log('R6 expected pair delta (frozen at calibration):', JSON.stringify(expectedPairDelta));

  const armResults = {};
  for (const broadPhase of ['tlas', 'linear']) {
    const worldHandle = await page.evaluateHandle(async () => {
      const { CollisionWorld } = await import('/collision/index.js');
      const w = await CollisionWorld.fromViewer(window.viewer);
      w.admitModel(window.__gate.modelArch);
      w.admitModel(window.__gate.modelStructure);
      w.admitModel(window.__gate.modelMechanical);
      return w;
    });
    let sequenceResult;
    try {
      sequenceResult = await runR6Sequence(page, worldHandle, { cohortDbIds, broadPhase, T0, d });
    } finally {
      await page.evaluate((w) => w.dispose(), worldHandle); // fresh-world disposed before the next arm, per §6.1.4
    }

    const refreshDelta = sequenceResult.refresh.tlasBuilds - sequenceResult.warm.tlasBuilds;
    const reconfirmDelta = sequenceResult.reconfirm.tlasBuilds - sequenceResult.warm.tlasBuilds;
    const expectedDelta = broadPhase === 'tlas' ? 1 : 0;
    if (refreshDelta !== expectedDelta) {
      throw new Error(`R6 smoke (${broadPhase}): expected tlasBuilds delta ${expectedDelta} across the refresh query, got ${refreshDelta}`);
    }
    if (reconfirmDelta !== expectedDelta) {
      throw new Error(`R6 smoke (${broadPhase}): expected tlasBuilds delta ${expectedDelta} across restoration, got ${reconfirmDelta}`);
    }
    if (broadPhase === 'linear' && [sequenceResult.cold, sequenceResult.warm, sequenceResult.refresh, sequenceResult.reconfirm].some((s) => s.tlasBuilds !== 0)) {
      throw new Error('R6 smoke (linear): tlasBuilds must be 0 throughout the linear arm');
    }
    // Codex-review fix (#1, Important): assert the EXACT frozen delta, not merely "differs".
    const observedRefreshDelta = pairSetDelta(sequenceResult.warm.pairs, sequenceResult.refresh.pairs);
    if (JSON.stringify(observedRefreshDelta) !== JSON.stringify(expectedPairDelta)) {
      throw new Error(`R6 smoke (${broadPhase}): observed refresh pair delta does not match the frozen calibration delta -- expected ${JSON.stringify(expectedPairDelta)}, got ${JSON.stringify(observedRefreshDelta)}`);
    }
    if (pairSetsDiffer(sequenceResult.reconfirm.pairs, sequenceResult.warm.pairs)) {
      throw new Error(`R6 smoke (${broadPhase}): post-restoration reconfirm.pairs must equal warm.pairs (P0 recovered)`);
    }

    armResults[broadPhase] = {
      coldTlasBuilds: sequenceResult.cold.tlasBuilds,
      warmTlasBuilds: sequenceResult.warm.tlasBuilds,
      refreshTlasBuilds: sequenceResult.refresh.tlasBuilds,
      reconfirmTlasBuilds: sequenceResult.reconfirm.tlasBuilds,
      refreshDelta,
      reconfirmDelta,
      observedRefreshDelta,
      warmPairCount: sequenceResult.warm.pairs.length,
      refreshPairCount: sequenceResult.refresh.pairs.length,
      reconfirmPairCount: sequenceResult.reconfirm.pairs.length,
    };
  }

  console.log('R6 smoke result:', JSON.stringify({ cohortDbIds, selectedD: d, expectedPairDelta, arms: armResults }, null, 2));
}

async function main() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const smokeCohortProfiler = process.argv.includes('--smoke-cohort-profiler');
  const smokeS2T = process.argv.includes('--smoke-s2t');
  const smokeR6 = process.argv.includes('--smoke-r6');
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

      if (smokeCohortProfiler) {
        // Task 3.3's manual-verification proof only -- one runtime's live fixture is sufficient to
        // prove the profiling walk + cohort selection work end to end; skip warm-up and the
        // fresh-world tuple proof entirely for this temporary smoke pass.
        await runSmokeCohortProfiler(page);
        return;
      }

      if (smokeS2T) {
        // Task 3.4's manual-verification proof only -- one runtime's live fixture is sufficient to
        // prove the facade + level-to-level control rule work end to end; skip warm-up and the
        // fresh-world tuple proof entirely for this temporary smoke pass.
        await runSmokeS2T(page);
        return;
      }

      if (smokeR6) {
        // Task 3.5's manual-verification proof only -- one runtime's live fixture is sufficient to
        // prove the calibration pass + full move->invalidate->refresh->restore sequence work end to
        // end under both broad-phase arms; skip warm-up and the fresh-world tuple proof entirely for
        // this temporary smoke pass.
        await runSmokeR6Sequence(page);
        return;
      }

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
// script's own browser/page and polluting its console output.
//
// Matches the established sibling pattern (run-gate.mjs:475-494, run-gate-m2.mjs:596-597,
// run-gate-m3.mjs:900-901, test/acceptance/room-locator.acceptance.mjs:381,
// clash-finder.acceptance.mjs:2404) rather than a bare `import.meta.url === file://${argv[1]}`
// check: a bare argv[1] comparison is NOT sufficient on its own -- Node's `node --test` sweep sets
// `process.argv[1]` to THIS file's own path when it imports it as a candidate, identical to a
// direct `node test/performance/run-gate-m4.mjs` invocation (run-gate.mjs's own comment documents
// this, confirmed during that file's Batch-5 review). `scripts/run-tests.mjs` currently scopes
// `node --test` to an explicit list of this repo's own `*.test.mjs` files (this file does not
// match that suffix), which already prevents a sweep from reaching this file today -- the
// `NODE_TEST_CONTEXT` check below is the same defense-in-depth every sibling file carries, in case
// a future change reintroduces a bare, unscoped `node --test`.
const isMainModule = !process.env.NODE_TEST_CONTEXT
  && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
