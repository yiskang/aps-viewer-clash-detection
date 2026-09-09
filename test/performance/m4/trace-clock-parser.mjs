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

const DEFAULT_OPENING_MARK_NAME = 'm4-query-window-start';
const DEFAULT_CLOSING_MARK_NAME = 'm4-query-window-end';
const DEFAULT_ACCEPTED_TASK_CATEGORIES = ['toplevel'];
const DEFAULT_ACCEPTED_TASK_NAMES = ['RunTask'];

function eventCategories(catField) {
  return String(catField ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

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

function selectTopLevelTaskEvents(traceEvents, acceptedCategories, acceptedNames) {
  const candidates = dedupeExact(
    traceEvents.filter(
      (e) => e.ph === 'X'
        && acceptedNames.includes(e.name)
        && eventCategories(e.cat).some((c) => acceptedCategories.includes(c))
    )
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

function findAnchorMarkEvent(traceEvents, markName, pid, tid) {
  const matches = traceEvents.filter((e) => e.ph === 'R' && e.name === markName && e.pid === pid && e.tid === tid);
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'duplicate' };
  return { status: 'ok', ts: matches[0].ts };
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
  acceptedTopLevelTaskNames = DEFAULT_ACCEPTED_TASK_NAMES,
  acceptedTaskCategories = DEFAULT_ACCEPTED_TASK_CATEGORIES,
  dataLossOccurred = false,
}) {
  // §6.2: "If the trace reports dataLossOccurred ... the tuple is invalid" -- this is a property
  // of the whole CDP tracing session, never a synthetic event overlapping one task, so it gates
  // the entire tuple before anything else (pid/tid, anchors) is even resolved.
  if (dataLossOccurred) {
    return { valid: false, reason: 'data-loss', intervals: [] };
  }

  const pid = measuredPid;
  const tid = measuredTid;

  const opening = findAnchorMarkEvent(traceEvents, openingMarkName, pid, tid);
  if (opening.status !== 'ok') {
    return { valid: false, reason: opening.status === 'duplicate' ? 'duplicate-opening-mark' : 'missing-opening-mark', intervals: [] };
  }
  const closing = findAnchorMarkEvent(traceEvents, closingMarkName, pid, tid);
  if (closing.status !== 'ok') {
    return { valid: false, reason: closing.status === 'duplicate' ? 'duplicate-closing-mark' : 'missing-closing-mark', intervals: [] };
  }

  const openingSample = (clockSamples ?? []).find((s) => s.markName === openingMarkName);
  const closingSample = (clockSamples ?? []).find((s) => s.markName === closingMarkName);
  if (!openingSample) return { valid: false, reason: 'missing-opening-mark', intervals: [] };
  if (!closingSample) return { valid: false, reason: 'missing-closing-mark', intervals: [] };

  const openingTraceUs = opening.ts;
  const closingTraceUs = closing.ts;
  const toMs = buildLinearClockMap(openingTraceUs, openingSample.performanceNowMs, closingTraceUs, closingSample.performanceNowMs);

  const measuredEvents = traceEvents.filter((e) => e.pid === pid && e.tid === tid);

  const taskIntervals = [];
  for (const e of selectTopLevelTaskEvents(measuredEvents, acceptedTaskCategories, acceptedTopLevelTaskNames)) {
    const clippedStartUs = Math.max(e.ts, openingTraceUs);
    const clippedEndUs = Math.min(e.ts + e.dur, closingTraceUs);
    if (clippedEndUs <= clippedStartUs) continue; // no overlap with the query window at all
    taskIntervals.push({
      startMs: toMs(clippedStartUs),
      endMs: toMs(clippedEndUs),
      source: 'cdp-task',
      stage: null,
      validity: 'valid',
    });
  }

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
