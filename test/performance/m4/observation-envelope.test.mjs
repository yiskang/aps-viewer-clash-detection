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
