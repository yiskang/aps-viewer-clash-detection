// M4 Task 3.2: pure sub-logic for §6.1.7's observation envelope, §6.2's input-probe/rAF rules,
// and the Node<->renderer clock-calibration math those rules depend on. The live rAF cadence
// recorder and CDP Input.dispatchMouseEvent dispatch loop live in browser-probes-m4.mjs /
// run-gate-m4.mjs (this task's live half, deferred until Phase 3 proper) and call into these
// functions only for the disposition/percentile/calibration math, never for anything requiring a
// real clock or DOM.

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
