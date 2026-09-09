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

// -- Step 6 tests -----------------------------------------------------------------------------

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

// -- Step 11 tests ----------------------------------------------------------------------------

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

// -- Step 16 tests ----------------------------------------------------------------------------

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
