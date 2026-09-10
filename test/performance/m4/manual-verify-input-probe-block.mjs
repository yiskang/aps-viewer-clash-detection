// test/performance/m4/manual-verify-input-probe-block.mjs
//
// Proves two things in one run: (1) the full install -> dispatch -> resolve pipeline yields a
// real, non-degenerate OK disposition (not undefined, not a thrown error, not a false censor) for
// a probe dispatched and handled on a free main thread; and (2) a fixed-cadence probe sequence
// dispatched squarely across a DEMONSTRABLY blocked ~500ms main thread produces a repetition-level
// T-c disposition of FAILURE, per the review's required integration test.
//
// This exercises the REAL dispatchInputProbeSequence / resolveInputProbeDispositions /
// tCDispositionForRepetition pipeline (not a hand-rolled two-probe stand-in) for two reasons found
// while actually running this verification against a live app (see task-3.2-report.md for the
// full writeup):
//
//   1. tCDispositionForRepetition unconditionally reports INDETERMINATE for fewer than 5 in-window
//      observations (observation-envelope.mjs's own, already-locked, already-tested rule) -- so a
//      2-probe test can never literally demonstrate a repetition "failing T-c" in the first place.
//      T-c is a REPETITION-level verdict in this codebase's own vocabulary; this test produces the
//      minimum 5 observations needed to make that verdict meaningful.
//   2. dispositionForObservation (also already-locked/tested) returns OK for ANY handled
//      observation regardless of delay magnitude -- FAILURE is reserved for a CENSORED
//      (never-handled-by-close) observation whose elapsed lower bound already exceeds the
//      threshold. A single probe dispatched mid-block and later handled once the block ends is
//      correctly OK with a large delay, not FAILURE. What actually drives FAILURE here is Chrome's
//      own mousemove-coalescing behavior (§6.2's coalescing-detection rule, which
//      browser-probes-m4.mjs's registry exists to detect): when several probes queue up during the
//      SAME stall, most of their in-flight mousemove events get coalesced away and never fire at
//      all, so they're still unhandled at close and correctly censored -- FAILURE if their elapsed
//      lower bound already exceeds threshold. Verified empirically: 5 probes at 100ms cadence
//      dispatched across a 500ms block reliably produced 1 OK (the probe issued just before the
//      block began) and 3-4 FAILUREs (coalesced-away, still-censored probes queued during the
//      block), which is exactly what makes tCDispositionForRepetition report the repetition FAILURE.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  installInputProbeRegistry, disposeInputProbeRegistry, captureClockCalibrationSample,
  dispatchInputProbeSequence, resolveInputProbeDispositions,
} from '../run-gate-m4.mjs';
import { calibrateNodeToRendererClock, tCDispositionForRepetition } from './observation-envelope.mjs';

const CANVAS_SELECTOR = 'canvas'; // adjust to the real app under test
const THRESHOLD_MS = 100;
const CADENCE_MS = 100;
const DURATION_MS = 500; // 5 probes at CADENCE_MS -- the exact minimum tCDispositionForRepetition needs to determine anything

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8080'); // adjust to the running dev server
// This app's canvas (wwwroot/viewer.js's Autodesk.Viewing.Initializer) is created asynchronously,
// well after `goto` resolves (confirmed ~800ms on this machine, network-dependent elsewhere) --
// waiting for the selector here closes a real gap: the brief's original excerpt called
// installInputProbeRegistry immediately after addScriptTag with no wait, which reliably threw
// "no element matches \"canvas\"" when run against this app.
await page.waitForSelector(CANVAS_SELECTOR, { timeout: 30_000 });
await page.addScriptTag({ path: 'test/performance/browser-probes-m4.mjs' });
const cdpSession = await page.context().newCDPSession(page);

const registryHandle = await installInputProbeRegistry(page, CANVAS_SELECTOR);
try {
  const preSample = await captureClockCalibrationSample(page);
  const startNodeMs = performance.now();

  // Busy loop started WITHOUT awaiting it, so Node stays free to dispatch CDP input mid-block; a
  // fixed settle delay lets the block provably start before the probe window's later slots land
  // inside it, while the window's very first (t=0) slot is dispatched before the block begins --
  // that first slot is what proves the round-trip itself works on a free main thread.
  const busyPromise = (async () => {
    await new Promise((r) => setTimeout(r, 50));
    return page.evaluate(() => {
      const busyStart = performance.now();
      while (performance.now() - busyStart < 500) { /* deliberately block the main thread */ }
      return { busyStart, busyEnd: performance.now() };
    });
  })();

  const dispatched = await dispatchInputProbeSequence(page, cdpSession, {
    canvasSelector: CANVAS_SELECTOR, cadenceMs: CADENCE_MS, startNodeMs, durationMs: DURATION_MS,
  });

  const { busyStart, busyEnd } = await busyPromise;
  await new Promise((r) => setTimeout(r, 100)); // let any tail-end coalesced event settle before closing
  const postSample = await captureClockCalibrationSample(page);
  const calibration = calibrateNodeToRendererClock(preSample, postSample);
  assert.ok(calibration.valid, `calibration should be valid on a local run: ${calibration.reason}`);

  const observations = await resolveInputProbeDispositions(page, registryHandle, dispatched, {
    thresholdMs: THRESHOLD_MS, calibration,
  });
  const tC = tCDispositionForRepetition(observations, THRESHOLD_MS);

  console.log('dispatch instants (ms since window start):', dispatched.map((d) => (d.dispatchNodeMs - startNodeMs).toFixed(1)));
  console.log('busy window was', (busyEnd - busyStart).toFixed(1), 'ms');
  console.log('observations:', observations);
  console.log('repetition-level T-c disposition:', tC);

  assert.equal(observations[0].status, 'OK', `expected the first probe (dispatched before the block) handled OK, got ${observations[0].status}`);
  assert.ok(observations[0].delayMs >= 0 && observations[0].delayMs < 100, `expected the first probe's delay to be small, got ${observations[0].delayMs}ms`);

  assert.equal(tC.status, 'FAILURE', `expected the repetition's T-c disposition to be FAILURE, got ${tC.status} (${tC.reason})`);

  console.log('PASS: the real dispatch/resolve/repetition pipeline yields a genuine OK for a free-thread probe, and a genuinely blocked renderer drives the repetition-level T-c disposition to FAILURE');
} finally {
  await disposeInputProbeRegistry(page, registryHandle);
  await browser.close();
}
