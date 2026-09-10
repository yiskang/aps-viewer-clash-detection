import { chromium } from 'playwright';
import { parseTraceAndClock, findMeasuredRendererProcessAndThread } from './test/performance/m4/trace-clock-parser.mjs';

const PORT = process.env.PORT || 8080;
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`);
await page.waitForLoadState('domcontentloaded');

const cdp = await page.context().newCDPSession(page);
const { frameTree } = await cdp.send('Page.getFrameTree');
const pageTargetId = frameTree.frame.id;

const events = [];
let dataLossOccurred = null;
cdp.on('Tracing.dataCollected', ({ value }) => { events.push(...value); });
const complete = new Promise((r) => cdp.on('Tracing.tracingComplete', (p) => { dataLossOccurred = p.dataLossOccurred; r(p); }));

await cdp.send('Tracing.start', {
  transferMode: 'ReportEvents',
  traceConfig: {
    recordMode: 'recordAsMuchAsPossible',
    includedCategories: ['toplevel', 'devtools.timeline', 'blink.user_timing', 'disabled-by-default-devtools.timeline'],
  },
});

const r = await page.evaluate(async () => {
  performance.mark('m4-query-window-start');
  const openingMs = performance.now();
  // Two ~120ms synchronous blocks separated by a real macrotask yield, so the window contains
  // MORE THAN ONE top-level task and a genuine gap between them.
  for (let k = 0; k < 2; k++) {
    const until = performance.now() + 120;
    let x = 0;
    while (performance.now() < until) x += Math.sqrt(x + 1);
    await new Promise((res) => setTimeout(res, 0));
  }
  performance.mark('m4-query-window-end');
  return { openingMs, closingMs: performance.now() };
});

await cdp.send('Tracing.end');
await complete;

const cats = (e) => String(e.cat ?? '').split(',').map((s) => s.trim());
const marks = events.filter((e) => e.name.startsWith('m4-query-window'));
const resolved = findMeasuredRendererProcessAndThread(events, pageTargetId);
const onThread = resolved ? events.filter((e) => e.pid === resolved.pid && e.tid === resolved.tid) : [];
const toplevelOnThread = onThread.filter((e) => cats(e).includes('toplevel') && e.ph === 'X');

const clockSamples = [
  { markName: 'm4-query-window-start', performanceNowMs: r.openingMs },
  { markName: 'm4-query-window-end', performanceNowMs: r.closingMs },
];

const asWritten = parseTraceAndClock({ traceEvents: events, clockSamples, stageRecords: [], pageTargetId, dataLossOccurred });
const fixed = parseTraceAndClock({
  traceEvents: events, clockSamples, stageRecords: [], pageTargetId, dataLossOccurred,
  acceptedTopLevelTaskNames: ['RunTask', 'ThreadControllerImpl::RunTask'],
});

console.log(JSON.stringify({
  pageTargetId,
  resolved,
  dataLossOccurred,
  markPhases: marks.map((m) => ({ name: m.name, ph: m.ph, pid: m.pid, tid: m.tid, ts: m.ts })),
  marksOnMeasuredThread: marks.every((m) => m.pid === resolved?.pid && m.tid === resolved?.tid),
  toplevelNamesOnMeasuredThread: [...new Set(toplevelOnThread.map((e) => e.name))],
  top5TasksOnThread: toplevelOnThread.sort((a, b) => b.dur - a.dur).slice(0, 5).map((e) => ({ name: e.name, durMs: +(e.dur / 1000).toFixed(2) })),
  parse_AS_WRITTEN: { valid: asWritten.valid, reason: asWritten.reason, intervalCount: asWritten.intervals.length },
  parse_WITH_REAL_TASK_NAME: {
    valid: fixed.valid, reason: fixed.reason, intervalCount: fixed.intervals.length,
    durationsMs: fixed.intervals.map((i) => +(i.endMs - i.startMs).toFixed(2)).sort((a, b) => b - a).slice(0, 6),
  },
  windowMs: +(r.closingMs - r.openingMs).toFixed(2),
}, null, 2));

await browser.close();
