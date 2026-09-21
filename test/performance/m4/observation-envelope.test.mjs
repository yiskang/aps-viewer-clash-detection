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

// Per design spec §6.2 ("A repetition with fewer than 5 in-window observations ... is reported
// INDETERMINATE for T-c" -- stated unconditionally): the minimum-observation-count floor is
// checked BEFORE the >=5-only FAILURE/INDETERMINATE precedence logic, so a FAILURE observation
// among fewer than 5 total does not escalate the repetition to FAILURE. This is a distinct rule
// from "FAILURE takes precedence over INDETERMINATE when both are present" above, which only
// governs repetitions that already clear the 5-observation floor.
test('tCDispositionForRepetition: a FAILURE observation does NOT override the <5 minimum-count floor', () => {
  const obs = [{ status: 'OK', delayMs: 10 }, { status: 'OK', delayMs: 20 }, { status: 'FAILURE', delayMs: 150 }];
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'INDETERMINATE');
});

test('tCDispositionForRepetition: an INDETERMINATE observation among fewer than 5 also stays INDETERMINATE (not a distinct code path)', () => {
  const obs = [{ status: 'OK', delayMs: 10 }, { status: 'INDETERMINATE', delayMs: 40 }];
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'INDETERMINATE');
});

test('tCDispositionForRepetition: both a FAILURE and an INDETERMINATE observation among fewer than 5 still stays INDETERMINATE', () => {
  const obs = [{ status: 'INDETERMINATE', delayMs: 40 }, { status: 'FAILURE', delayMs: 150 }];
  const result = tCDispositionForRepetition(obs, 100);
  assert.equal(result.status, 'INDETERMINATE');
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

// Fail-closed validation: a malformed calibration sample must never produce `valid: true`, since
// downstream code trusts `.valid` alone before using the mapping/uncertainty. Table-driven per
// codex-review's recommendation.
const malformedCalibrationCases = [
  {
    name: 'NaN roundTripMs',
    pre: { nodeMs: 0, rendererMs: 0, roundTripMs: NaN },
    post: { nodeMs: 1000, rendererMs: 1000, roundTripMs: 2 },
    reasonMatch: /roundTripMs/,
  },
  {
    name: 'Infinity nodeMs',
    pre: { nodeMs: 0, rendererMs: 0, roundTripMs: 2 },
    post: { nodeMs: Infinity, rendererMs: 1000, roundTripMs: 2 },
    reasonMatch: /nodeMs/,
  },
  {
    name: 'negative roundTripMs',
    pre: { nodeMs: 0, rendererMs: 0, roundTripMs: -1 },
    post: { nodeMs: 1000, rendererMs: 1000, roundTripMs: 2 },
    reasonMatch: /negative/,
  },
  {
    name: 'equal Node timestamps (zero-width interval)',
    pre: { nodeMs: 1000, rendererMs: 200, roundTripMs: 2 },
    post: { nodeMs: 1000, rendererMs: 1200, roundTripMs: 2 },
    reasonMatch: /chronologically ordered/,
  },
  {
    name: 'reversed Node timestamps',
    pre: { nodeMs: 2000, rendererMs: 200, roundTripMs: 2 },
    post: { nodeMs: 1000, rendererMs: 1200, roundTripMs: 2 },
    reasonMatch: /chronologically ordered/,
  },
];

for (const { name, pre, post, reasonMatch } of malformedCalibrationCases) {
  test(`calibrateNodeToRendererClock: rejects malformed input -- ${name}`, () => {
    const calibration = calibrateNodeToRendererClock(pre, post);
    assert.equal(calibration.valid, false);
    assert.match(calibration.reason, reasonMatch);
  });
}

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

// Fail-closed: a malformed uncertaintyMs (e.g. NaN propagated from a caller that forgot to gate
// on calibration.valid) must never let a confident OK/FAILURE slip through untouched, since every
// comparison against NaN is false in JS and would otherwise silently bypass the threshold-band
// check above.
test('applyClockUncertainty: NaN uncertaintyMs fails closed to INDETERMINATE rather than passing an OK through', () => {
  const result = applyClockUncertainty({ status: 'OK', delayMs: 10 }, NaN, 100);
  assert.equal(result.status, 'INDETERMINATE');
});

test('applyClockUncertainty: negative uncertaintyMs fails closed to INDETERMINATE rather than passing a FAILURE through', () => {
  const result = applyClockUncertainty({ status: 'FAILURE', delayMs: 500 }, -1, 100);
  assert.equal(result.status, 'INDETERMINATE');
});
