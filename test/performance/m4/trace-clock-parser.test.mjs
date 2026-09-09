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

// -- Step 21 tests ----------------------------------------------------------------------------

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

// -- Step 26 tests ----------------------------------------------------------------------------

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

// -- Step 31 tests ----------------------------------------------------------------------------

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

// -- Step 36 tests ----------------------------------------------------------------------------

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
