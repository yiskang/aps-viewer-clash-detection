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

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// Codex review finding #3: `typeof x === 'number'` is true for NaN/Infinity/fractional/negative
// values, so a garbage explicit pid/tid (or a corrupt metadata id) would otherwise pass as if it
// were a real identifier. Both the caller-supplied identity and the trace-metadata-resolved
// identity must be valid non-negative integers to count as "supplied"/"resolved" at all.
function isValidId(x) {
  return Number.isInteger(x) && x >= 0;
}

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

function matchesAcceptedTask(e, acceptedCategories, acceptedNames) {
  return e.ph === 'X'
    && acceptedNames.includes(e.name)
    && eventCategories(e.cat).some((c) => acceptedCategories.includes(c));
}

// Codex review finding #1: a candidate task event with a non-finite ts/dur (or a negative dur)
// must never reach the sort/containment/clipping logic below -- NaN comparisons are always false,
// so it would silently corrupt containment tracking (an NaN openEnd makes every subsequent event
// look top-level) and/or surface as a `valid: true` interval with startMs/endMs of NaN. Detected
// separately from selection so the caller can invalidate the whole tuple rather than just drop it
// (dropping would silently undercount main-thread occupancy from what is actually corrupt trace
// data, not an ordinary out-of-window task).
function findMalformedTaskEvent(traceEvents, acceptedCategories, acceptedNames) {
  return traceEvents.find(
    (e) => matchesAcceptedTask(e, acceptedCategories, acceptedNames)
      && (!isFiniteNumber(e.ts) || !isFiniteNumber(e.dur) || e.dur < 0)
  );
}

function selectTopLevelTaskEvents(traceEvents, acceptedCategories, acceptedNames) {
  const candidates = dedupeExact(
    traceEvents.filter((e) => matchesAcceptedTask(e, acceptedCategories, acceptedNames))
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

// Codex review finding #2: a duplicate clock sample for the same mark name was previously
// resolved arbitrarily via `.find()`'s first-match semantics, silently picking one of several
// possible pairings. Per §6.2, the paired clock sample IS the anchor mark (one mechanism, not
// two) -- so an ambiguous clock sample is exactly as invalid as an ambiguous trace-side anchor
// mark, and is reported via the same duplicate-opening-mark/duplicate-closing-mark reasons.
function findClockSample(clockSamples, markName) {
  const matches = (clockSamples ?? []).filter((s) => s.markName === markName);
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'duplicate' };
  return { status: 'ok', sample: matches[0] };
}

function buildLinearClockMap(openingTraceUs, openingMs, closingTraceUs, closingMs) {
  const spanUs = closingTraceUs - openingTraceUs;
  return (traceUs) => {
    const t = spanUs === 0 ? 0 : (traceUs - openingTraceUs) / spanUs;
    return openingMs + t * (closingMs - openingMs);
  };
}

export function findMeasuredRendererProcessAndThread(traceEvents, pageTargetId) {
  const startedEvent = traceEvents.find((e) => e.name === 'TracingStartedInBrowser');
  const frames = startedEvent?.args?.data?.frames ?? [];
  const frame = frames.find((f) => f.frame === pageTargetId);
  if (!frame || !isValidId(frame.processId)) return null;

  const pid = frame.processId;
  const threadNameEv = traceEvents.find(
    (e) => e.ph === 'M' && e.name === 'thread_name' && e.pid === pid && e.args?.name === 'CrRendererMain'
  );
  if (!threadNameEv || !isValidId(threadNameEv.tid)) return null;

  return { pid, tid: threadNameEv.tid };
}

export function parseTraceAndClock({
  traceEvents,
  clockSamples,
  stageRecords,
  measuredPid,
  measuredTid,
  pageTargetId,
  openingMarkName = DEFAULT_OPENING_MARK_NAME,
  closingMarkName = DEFAULT_CLOSING_MARK_NAME,
  acceptedTopLevelTaskNames = DEFAULT_ACCEPTED_TASK_NAMES,
  acceptedTaskCategories = DEFAULT_ACCEPTED_TASK_CATEGORIES,
  dataLossOccurred = false,
}) {
  // Codex review finding #3: a missing-identity caller bug must never be masked as an ordinary
  // data-loss report. The identity-presence check is therefore a hard caller-contract check,
  // evaluated BEFORE dataLossOccurred (or anything else) is even looked at -- it throws
  // regardless of what the trace data itself says. A non-finite/fractional/negative explicit
  // pid or tid (`typeof NaN === 'number'` is true) is garbage, not a real identity -- treated as
  // "not supplied" so it falls back to pageTargetId if given, or throws if not, rather than
  // silently propagating into pid/tid filtering and getting misreported as ordinary data loss.
  const hasExplicitIdentity = isValidId(measuredPid) && isValidId(measuredTid);
  if (!hasExplicitIdentity && !pageTargetId) {
    throw new Error(
      'parseTraceAndClock: either { measuredPid, measuredTid } or { pageTargetId } is required to identify the measured renderer'
    );
  }

  // §6.2: "If the trace reports dataLossOccurred ... the tuple is invalid" -- this is a property
  // of the whole CDP tracing session, never a synthetic event overlapping one task, so it gates
  // the entire tuple before anything else (pid/tid, anchors) is even resolved.
  if (dataLossOccurred) {
    return { valid: false, reason: 'data-loss', intervals: [] };
  }

  let pid = measuredPid;
  let tid = measuredTid;
  if (!hasExplicitIdentity) {
    const resolved = findMeasuredRendererProcessAndThread(traceEvents, pageTargetId);
    if (!resolved) {
      return { valid: false, reason: 'measured-renderer-not-found', intervals: [] };
    }
    pid = resolved.pid;
    tid = resolved.tid;
  }

  const opening = findAnchorMarkEvent(traceEvents, openingMarkName, pid, tid);
  if (opening.status !== 'ok') {
    return { valid: false, reason: opening.status === 'duplicate' ? 'duplicate-opening-mark' : 'missing-opening-mark', intervals: [] };
  }
  const closing = findAnchorMarkEvent(traceEvents, closingMarkName, pid, tid);
  if (closing.status !== 'ok') {
    return { valid: false, reason: closing.status === 'duplicate' ? 'duplicate-closing-mark' : 'missing-closing-mark', intervals: [] };
  }

  const openingClock = findClockSample(clockSamples, openingMarkName);
  if (openingClock.status !== 'ok') {
    return { valid: false, reason: openingClock.status === 'duplicate' ? 'duplicate-opening-mark' : 'missing-opening-mark', intervals: [] };
  }
  const closingClock = findClockSample(clockSamples, closingMarkName);
  if (closingClock.status !== 'ok') {
    return { valid: false, reason: closingClock.status === 'duplicate' ? 'duplicate-closing-mark' : 'missing-closing-mark', intervals: [] };
  }
  const openingSample = openingClock.sample;
  const closingSample = closingClock.sample;

  const openingTraceUs = opening.ts;
  const closingTraceUs = closing.ts;

  if (!isFiniteNumber(openingTraceUs) || !isFiniteNumber(closingTraceUs) || closingTraceUs <= openingTraceUs) {
    return { valid: false, reason: 'invalid-window', intervals: [] };
  }
  if (
    !isFiniteNumber(openingSample.performanceNowMs)
    || !isFiniteNumber(closingSample.performanceNowMs)
    || closingSample.performanceNowMs < openingSample.performanceNowMs
  ) {
    return { valid: false, reason: 'invalid-clock-sample', intervals: [] };
  }

  for (const r of stageRecords ?? []) {
    if (!isFiniteNumber(r.receiptMs) || !isFiniteNumber(r.durationMs) || r.durationMs < 0) {
      throw new Error(
        `parseTraceAndClock: malformed stageRecord for stage "${r.stage}" -- receiptMs and durationMs must be finite numbers, and durationMs must be >= 0`
      );
    }
  }

  const toMs = buildLinearClockMap(openingTraceUs, openingSample.performanceNowMs, closingTraceUs, closingSample.performanceNowMs);

  const measuredEvents = traceEvents.filter((e) => e.pid === pid && e.tid === tid);

  // Codex review finding #1: a candidate task event with a non-finite/negative ts or dur must
  // never silently vanish (that would undercount main-thread occupancy from what is actually
  // corrupt trace data) nor leak a NaN interval into `intervals` -- the whole tuple is invalidated
  // instead, the same way a corrupt/missing anchor is.
  if (findMalformedTaskEvent(measuredEvents, acceptedTaskCategories, acceptedTopLevelTaskNames)) {
    return { valid: false, reason: 'invalid-task-event', intervals: [] };
  }

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
