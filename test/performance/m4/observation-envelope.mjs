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
//
// The FAILURE-before-INDETERMINATE precedence above applies WITHIN a repetition that already has
// >=5 in-window observations -- it resolves how FAILURE and INDETERMINATE observations interact
// with each other and with the p95 calculation. It does NOT override the antecedent minimum-count
// floor below: per spec (design doc §6.2, "A repetition with fewer than 5 in-window observations
// ... is reported INDETERMINATE for T-c" -- stated unconditionally, with no exception carved out
// for a FAILURE observation being among those few), a repetition with fewer than 5 in-window
// observations is ALWAYS INDETERMINATE, even if one of those few observations is itself a
// FAILURE. This is checked first, before the >=5-only FAILURE/INDETERMINATE logic ever runs.
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
// A malformed calibration sample (a non-finite field, a negative round trip, or samples that
// aren't chronologically ordered) must never silently produce `valid: true` -- a NaN round trip,
// for instance, makes both the round-trip and drift-tolerance comparisons below false (any
// comparison against NaN is false in JS), which would otherwise let corrupted timing data pass as
// a trustworthy calibration and defeat applyClockUncertainty's own protection downstream. These
// checks run BEFORE any arithmetic on the samples, so a malformed input is rejected fail-closed
// rather than laundered into a numeric result that merely happens to look plausible.
function malformedSampleReason(sample, label) {
  for (const field of ['nodeMs', 'rendererMs', 'roundTripMs']) {
    if (typeof sample[field] !== 'number' || !Number.isFinite(sample[field])) {
      return `${label} calibration sample's ${field} is not a finite number (got ${sample[field]})`;
    }
  }
  if (sample.roundTripMs < 0) {
    return `${label} calibration sample's roundTripMs is negative (${sample.roundTripMs}ms) -- a round trip cannot take negative time`;
  }
  return null;
}

export function calibrateNodeToRendererClock(preSample, postSample) {
  const malformedReason = malformedSampleReason(preSample, 'pre') ?? malformedSampleReason(postSample, 'post');
  if (malformedReason) {
    return { valid: false, driftMs: NaN, uncertaintyMs: NaN, reason: malformedReason };
  }
  if (postSample.nodeMs <= preSample.nodeMs) {
    return {
      valid: false, driftMs: NaN, uncertaintyMs: NaN,
      reason: `postSample.nodeMs (${postSample.nodeMs}) is not strictly after preSample.nodeMs (${preSample.nodeMs}) -- calibration samples are not chronologically ordered`,
    };
  }

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
  if (!Number.isFinite(scale) || scale <= 0) {
    return {
      valid: false, driftMs, uncertaintyMs,
      reason: `computed clock scale is not a usable positive finite number (${scale}) -- calibration samples do not describe a valid monotonic mapping`,
    };
  }
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
//
// A malformed uncertaintyMs (non-finite or negative -- e.g. propagated from an invalid
// calibration a caller forgot to gate on `.valid`) can never be trusted to bound anything: every
// comparison against NaN is false in JS, so an un-checked NaN would silently skip the downgrade
// above and let a false-confidence OK/FAILURE through untouched -- the exact failure mode this
// function exists to close. Such an uncertainty fails closed to INDETERMINATE instead.
export function applyClockUncertainty(disposition, uncertaintyMs, thresholdMs) {
  if (disposition.status === 'INDETERMINATE') return disposition;
  if (typeof uncertaintyMs !== 'number' || !Number.isFinite(uncertaintyMs) || uncertaintyMs < 0) {
    return {
      status: 'INDETERMINATE', delayMs: disposition.delayMs,
      reason: `calibration uncertainty is not a finite, non-negative number (got ${uncertaintyMs}) -- cannot be trusted to bound this disposition`,
    };
  }
  if (Math.abs(disposition.delayMs - thresholdMs) <= uncertaintyMs) {
    return {
      status: 'INDETERMINATE', delayMs: disposition.delayMs,
      reason: `delay ${disposition.delayMs}ms is within calibration uncertainty (+-${uncertaintyMs}ms) of the ${thresholdMs}ms threshold`,
    };
  }
  return disposition;
}
