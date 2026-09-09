// M4 Task 2.1: CDP trace/clock parser.
//
// Produces the frozen interval contract shared with Task 2.2 (stage-attribution-engine.mjs) and
// consumed by Task 2.4/harness code: { startMs, endMs, source, stage, validity } -- see this
// file's header comment in the plan task for the full contract description.
//
// Anchor identification and clock correlation share ONE mechanism (§6.2): the harness's paired
// clock sample for a window edge IS that edge's performance.mark, so this module resolves a
// sample's trace-clock timestamp by finding its named mark event on the measured renderer's main
// thread, rather than trusting an independently-supplied trace-µs value.

const TASK_EVENT_CAT = 'toplevel';
const TASK_EVENT_NAME = 'RunTask';
const DEFAULT_OPENING_MARK_NAME = 'm4-query-window-start';
const DEFAULT_CLOSING_MARK_NAME = 'm4-query-window-end';

function dedupeExact(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.ts}|${e.dur}|${e.name}|${e.pid}|${e.tid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function selectTopLevelTaskEvents(traceEvents) {
  const candidates = dedupeExact(
    traceEvents.filter((e) => e.ph === 'X' && e.cat === TASK_EVENT_CAT && e.name === TASK_EVENT_NAME)
  ).sort((a, b) => a.ts - b.ts || b.dur - a.dur);

  const topLevel = [];
  let openEnd = -Infinity;
  for (const e of candidates) {
    if (e.ts < openEnd) continue; // nested inside the currently-open top-level task
    topLevel.push(e);
    openEnd = e.ts + e.dur;
  }
  return topLevel;
}

// Deliberately naive for now -- Step 26/28 (Group D) hardens this against missing/duplicate marks
// instead of crashing on `undefined.ts`.
function findAnchorMarkTs(traceEvents, markName, pid, tid) {
  const match = traceEvents.find((e) => e.ph === 'R' && e.name === markName && e.pid === pid && e.tid === tid);
  return match.ts;
}

function buildLinearClockMap(openingTraceUs, openingMs, closingTraceUs, closingMs) {
  const spanUs = closingTraceUs - openingTraceUs;
  return (traceUs) => {
    const t = spanUs === 0 ? 0 : (traceUs - openingTraceUs) / spanUs;
    return openingMs + t * (closingMs - openingMs);
  };
}

// Placeholder pending Step 33's real implementation (metadata-based pid/tid resolution). Not
// exercised by any test before Step 31 -- exported now only so this module's named-export
// surface matches the test file's import statement from Step 1 onward (native ESM named imports
// are statically checked; importing a not-yet-exported name throws a SyntaxError at load time,
// not a lazy "is not a function" at call time as an earlier plan draft assumed).
export function findMeasuredRendererProcessAndThread() {
  return null;
}

export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
}) {
  const pid = measuredPid;
  const tid = measuredTid;

  const openingTraceUs = findAnchorMarkTs(traceEvents, openingMarkName, pid, tid);
  const closingTraceUs = findAnchorMarkTs(traceEvents, closingMarkName, pid, tid);
  const openingSample = clockSamples.find((s) => s.markName === openingMarkName);
  const closingSample = clockSamples.find((s) => s.markName === closingMarkName);
  const toMs = buildLinearClockMap(openingTraceUs, openingSample.performanceNowMs, closingTraceUs, closingSample.performanceNowMs);

  const taskIntervals = selectTopLevelTaskEvents(traceEvents).map((e) => ({
    startMs: toMs(e.ts),
    endMs: toMs(e.ts + e.dur),
    source: 'cdp-task',
    stage: null,
    validity: 'valid',
  }));

  const stageIntervals = (stageRecords ?? []).map((r) => ({
    startMs: r.receiptMs - r.durationMs,
    endMs: r.receiptMs,
    source: 'harness-stage',
    stage: r.stage,
    validity: 'valid',
  }));

  const intervals = [...taskIntervals, ...stageIntervals].sort((a, b) => a.startMs - b.startMs);
  return { valid: true, reason: null, intervals };
}
