// test/acceptance/clashpanel-viewerbridge.acceptance.final-transfer.test.mjs
//
// Before-live hardening (2026-10-02), Mediums 1 and 2, cross-realm level:
//
//  M1  the authoritative run `eventLog` is finalized AFTER the last page->Node transfer drain
//      (`g2FinalizeRunTransfer`: a bounded stable-fence loop; the eventLog snapshot, the transfer high-water and
//      `g.runResultHw` are taken in the same synchronous tick as the last stability check).
//  M2  a FAILED phase run (the runner throws) still enters the cleanup phase exactly like the runner's
//      `mark('cleanup')` (`g2EnterCleanupAfterFailure`) and makes the SAME final transfer, so the run's page evidence
//      and the cleanup evidence are retained through the unchanged fences / rewrite / cleanup drain / provenance
//      checks; Node decides the verdict (every check BLOCKED(phase-run-threw), `applyPhaseRunFailureToState`).
//
// The page half is the REAL page-agent bundle (`buildPageAgentSource`) in a node:vm context, running the REAL
// `g2RunPhases` body; the only test substitutions are the Viewer-bound env (`g2BuildEnv` -> a stub env carrying
// the real recorder) and the runner mode ('live' is refused while LIVE_PATH_WIRED=false -> 'offline-fake', which
// still uses the real Node sync fences). The Node half is the REAL sync / ingest / fatal binding bodies sliced out
// of `runPostReservation` and the real authority / allocator / sink, plus the final-transfer lines of
// `runPostReservation` (asserted verbatim below). "Pre-fix" behaviour is reproduced on a page bundle whose
// g2RunPhases is the exact pre-fix (HEAD c0f877a) body. Offline only: no browser, no network, no Viewer.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const P1 = Object.freeze({ phase: 'P1', activeCheck: null, activeControl: null });
const CLEANUP = Object.freeze({ phase: 'cleanup', activeCheck: null, activeControl: null });

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length - 1, 1, `anchor must occur exactly once: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}

// ------------------------------------------------------------------------------------------
// The REAL Node binding bodies (sliced out of runPostReservation) over a real authority
// ------------------------------------------------------------------------------------------

const RPR = H.locateFunctionSource(SOURCE, 'runPostReservation');
const RPR_TEXT = SOURCE.slice(RPR.start, RPR.end);

function bindingText(name) {
  const head = `await live.page.exposeFunction(${name}, `;
  assert.equal(RPR_TEXT.split(head).length - 1, 1, `exactly one exposeFunction(${name})`);
  const i = RPR_TEXT.indexOf(head);
  const first = RPR_TEXT.slice(i, RPR_TEXT.indexOf('\n', i));
  if (first.endsWith('{')) return RPR_TEXT.slice(i + head.length, RPR_TEXT.indexOf('\n      });', i) + '\n      }'.length);
  assert.ok(first.endsWith(');'));
  return first.slice(head.length, -2);
}
// eslint-disable-next-line no-new-func
const instantiate = (text, scope) => new Function(...Object.keys(scope), `'use strict';\nreturn (${text});`)(...Object.values(scope));
const NODE_BINDINGS = Object.freeze(['G2_NODE_SYNC_BINDING', 'G2_NODE_INGEST_BINDING', 'G2_NODE_FATAL_BINDING']);

// runPostReservation's final transfer, reproduced by `nodeFinalTransfer` below (asserted to be the harness's own lines).
const FINAL_TRANSFER_LINES = Object.freeze([
  'authority.reconcilePageFatals(runOut.value.pageFatalSent);',
  "const run = authority.rewritePageRun(runOut.value, { stage: 'run' });",
  'applyPhaseRunToState(state, run);',
  'cleanupEvidence.runApplied = true;',
  "if (isPlainObject(run) && Object.hasOwn(run, 'phaseRunFailure')) { applyPhaseRunFailureToState(state, authenticatedFailureRun(run, authority), { nextSeq: runSeq.next }); tainted = true; }",
  "Object.assign(nodeAttribution, { phase: 'cleanup', activeCheck: null });",
  "const { duplicates } = mergeCleanupDelta(state, authority.rewritePageRun(out.value.delta, { stage: 'cleanup' }));",
  'const problems = authority.pageEvidenceProblems(state);',
]);

function nodeWorld() {
  const ledger = H.createEmptyErrorLedger();
  const state = { errorLedger: ledger, checks: {}, controls: {} };
  const runSeq = H.createRunSeqAllocator();
  const attribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const sink = H.createFatalEventSink(ledger, { nextSeq: runSeq.next });
  const violations = [];
  const authority = H.createRunAuthority({ allocator: runSeq, attribution, onViolation: (reason) => { violations.push(reason); sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });
  const fatal = (kind, detail) => sink.recordFatal(kind, String(detail));
  const scope = {
    authority, fatal, state, runSeq, sink, clock: { nowIso: () => new Date().toISOString() },
    responseRules: H.OPTIONAL_RESPONSE_RULES, prepareC1Gate: H.prepareC1Gate, provisionalFinalization: H.provisionalFinalization, syncFatalWitnesses: H.syncFatalWitnesses,
    isPageLocalOrdinal: H.isPageLocalOrdinal, isPlainObject,
    summarizeThrown: (err) => ({ name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err }),
  };
  const bindings = Object.fromEntries(NODE_BINDINGS.map((n) => [H[n], instantiate(bindingText(n), scope)]));
  ledger.markers.push({ seq: runSeq.next(), name: 'P0' });
  return { ledger, state, runSeq, attribution, sink, violations, authority, bindings };
}

// ------------------------------------------------------------------------------------------
// Page realm: the REAL page-agent bundle; g2RunPhases runs with a stub env (no Viewer) in offline-fake mode
// ------------------------------------------------------------------------------------------

const PAGE_EXPOSE = ['g2RunPhases', 'g2CleanupDrain', 'g2PageState', 'g2NodeSync', 'g2AgentReady', 'g2MarkFatal', 'g2FailureDetail', 'createPageOrdinalSource', 'createCallRecorder', 'makeCheckRecord', 'makeControlRecord', 'PHASE_ORDER'];
const TEST_ENV_SUBST = Object.freeze([
  ['  const env = g2BuildEnv({ nodeLoadOutcomes: arg && isPlainObject(arg.nodeLoadOutcomes) ? arg.nodeLoadOutcomes : null });\n', '  const env = window.__testEnv;\n'],
]);
/** The exact pre-fix (HEAD c0f877a) g2RunPhases: run-result eventLog snapshotted by the runner BEFORE the one final drain. */
const PRE_FIX_G2RUNPHASES = `async function g2RunPhases(arg) {
  const g = g2PageState();
  const env = window.__testEnv;
  const sync = g2NodeSync();
  const run = await runChecksInPhaseOrder({
    drivers: env.drivers,
    mode: 'offline-fake',
    assertPhaseBaseline: null,
    fatalObserved: () => g.fatal.flag === true || g.fatal.abort === true,
    recorder: env.recorder,
    sync,
  });
  if (sync) await sync.drain();
  const { spyInstall, ...extras } = run.extras || {};
  g.runResultHw = g2FenceReport().hw;
  return g2JsonSafe({
    checks: run.checks, controls: run.controls, subchecks: run.subchecks, extras, c1FinalizedEvent: run.c1FinalizedEvent,
    gates: run.gates, markers: run.markers, eventLog: run.eventLog,
    spyInstall: spyInstall || null,
    sessionTainted: run.sessionTainted, taintPhase: run.taintPhase, phaseLog: run.phaseLog,
    spyLedger: env.recorder.records, screenshots: g.screenshots, stateSnapshots: env.state.stateSnapshots || [],
    staleContinuationsDropped: env.quarantine.staleContinuationsDropped,
    cameraHomeCaptured: env.cameraHomeCaptured, bridgeHistory: env.bridgeTracker.history,
    pageHighWater: g2FenceReport().hw, pageFatalSent: g.pageFatalSent,
  });
}`;

function bundleOf(source) {
  let src = H.buildPageAgentSource(source).source;
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  src = replaceOnce(src, reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
  return src;
}
const CURRENT_SOURCE = (() => {
  let s = SOURCE;
  for (const [a, b] of TEST_ENV_SUBST) s = replaceOnce(s, a, b);
  s = replaceOnce(s, "      drivers: createLivePhaseDrivers(env),\n      mode: 'live',\n      assertPhaseBaseline: async (phase) => g2PhaseBaseline(env, phase),", "      drivers: env.drivers,\n      mode: 'offline-fake',\n      assertPhaseBaseline: null,");
  return s;
})();
const PRE_FIX_SOURCE = (() => {
  const { start, end } = H.locateFunctionSource(SOURCE, 'g2RunPhases');
  return `${SOURCE.slice(0, start)}${PRE_FIX_G2RUNPHASES}${SOURCE.slice(end)}`;
})();
const BUNDLE = bundleOf(CURRENT_SOURCE);
const PRE_FIX_BUNDLE = bundleOf(PRE_FIX_SOURCE);

function pageRealm({ bundle = BUNDLE } = {}) {
  const window = { addEventListener: () => {}, removeEventListener: () => {} };
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console });
  vm.runInContext(bundle, ctx);
  const t = window.__t;
  const g = t.g2PageState();
  // As g2BuildEnv: the recorder draws NON-authoritative page ordinals; the early hint goes through the ingest binding.
  const pageSeq = t.createPageOrdinalSource({ deliver: (entry) => { const fn = window[H.G2_NODE_INGEST_BINDING]; if (typeof fn === 'function') Promise.resolve(fn(entry)).catch(() => {}); } });
  g.seq = pageSeq;
  const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
  const env = { recorder, state: { stateSnapshots: [] }, quarantine: { staleContinuationsDropped: 0 }, cameraHomeCaptured: true, bridgeTracker: { history: [] }, drivers: null };
  window.__testEnv = env;
  g.env = env;
  // a page-realm plain object (g2JsonSafe keeps only plain objects of its own realm)
  const inRealm = vm.runInContext('(o) => Object.assign({}, o)', ctx);
  return { window, t, g, recorder, env, inRealm };
}

/** Delayed, JSON-serialising page->Node channel (Playwright exposeFunction stand-in); per binding `before`, `tamper`, `drop`. */
function connect(page, node, opts = {}) {
  for (const name of NODE_BINDINGS.map((n) => H[n])) {
    const o = opts[name] || {};
    const fn = node.bindings[name];
    page.window[name] = (...args) => {
      const a = clone(args);
      if (o.drop && o.drop(...a)) return new Promise(() => {});
      return (async () => {
        await sleep(o.delay ?? 2);
        if (o.tamper) o.tamper(a);
        if (o.before) o.before(...a);
        return clone(fn(...a));
      })();
    };
  }
}

/** Fake phase drivers on the page realm: every runnable unit PASSes; P3 records one run-phase event; `overrides[phaseId]`. */
function drivers(page, overrides = {}) {
  const pass = () => page.t.makeCheckRecord({ verdict: 'PASS' });
  const ok = (n) => page.t.makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
  const d = {};
  for (const p of page.t.PHASE_ORDER) {
    d[p.id] = async (ctx) => {
      if (overrides[p.id]) await overrides[p.id](ctx);
      if (p.id === 'P3') page.recorder.logEvent('p3-run-event', { note: 'an ordinary run-phase event' });
      for (const n of ctx.runnable.controls) await ctx.beginControl(n);
      return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return d;
}

/** Calls the REAL in-page g2RunPhases (Node has acknowledged P1 first, as runPostReservation does). `{status, value|error}`. */
async function runPhases(page, node, drv = drivers(page)) {
  Object.assign(node.attribution, P1);
  page.env.drivers = drv;
  try { return { status: 'completed', value: clone(await page.t.g2RunPhases({})) }; } catch (e) { return { status: 'threw', error: e }; }
}

/** runPostReservation's final transfer (FINAL_TRANSFER_LINES) on a completed page result; then Node enters cleanup. */
function nodeFinalTransfer(node, value) {
  const { authority, state } = node;
  authority.reconcilePageFatals(value.pageFatalSent);
  const run = authority.rewritePageRun(value, { stage: 'run' });
  H.applyPhaseRunToState(state, run);
  authority.assertAllocated(H.maxRecordedSeq(state));
  if (isPlainObject(run) && Object.hasOwn(run, 'phaseRunFailure')) H.applyPhaseRunFailureToState(state, H.authenticatedFailureRun(run, node.authority), { nextSeq: node.runSeq.next });
  Object.assign(node.attribution, { phase: 'cleanup', activeCheck: null });
  return run;
}

/** Page cleanup steps record cleanup evidence; then the REAL g2CleanupDrain; Node rewrites (stage cleanup), merges, checks provenance. */
async function cleanupAndDrain(page, node, { mutateDelta = null } = {}) {
  page.recorder.withOrigin('harness', () => page.recorder.record('overlays.removeScene', ['clash-panel-markers:g2a']));
  page.recorder.logEvent('wrapper-restore', { label: 'viewer.isolate', layer: 'recording', ok: true });
  page.env.state.stateSnapshots.push(page.inRealm({ ...page.recorder.stamp('snapshot'), baselinePhase: 'cleanup', isolationEmpty: true, hiddenEmpty: true }));
  const out = clone(await page.t.g2CleanupDrain());
  assert.equal(out.ok, true, JSON.stringify(out.error));
  const delta = mutateDelta ? mutateDelta(out.delta) : out.delta;
  node.authority.reconcilePageFatals(delta.pageFatalSent);
  const { duplicates } = H.mergeCleanupDelta(node.state, node.authority.rewritePageRun(delta, { stage: 'cleanup' }));
  return { delta, duplicates, problems: node.authority.pageEvidenceProblems(node.state) };
}

const ingestedEventSeqs = (node) => node.authority.ingested().filter((e) => e.kind === 'event').map((e) => e.seq);
/** eventLog seqs: strictly increasing (Node allocation order); the `event`-kind ones are exactly the ingested event ordinals (the C1
 * `check-finalized` event is the runner's `alloc`-kind C1 finalization ordinal, not an independently mandatory record). */
function assertNodeOrderedEventLog(node, eventLog, msg = 'eventLog') {
  const seqs = eventLog.map((e) => e.seq);
  for (let i = 1; i < seqs.length; i += 1) assert.ok(seqs[i] > seqs[i - 1], `${msg}: strictly increasing at ${i}`);
  assert.deepEqual(eventLog.filter((e) => !(e.kind === 'check-finalized' && e.check === 'C1')).map((e) => e.seq), ingestedEventSeqs(node), `${msg}: every ingested page event exactly once, in Node order`);
}
const kindsOf = (log) => log.map((e) => e.kind);

// ==========================================================================================
// static
// ==========================================================================================

test('static: the reproduced Node final-transfer lines are runPostReservation\'s own; the test page bundle differs from the real one ONLY by the env/mode substitution; live stays dormant', () => {
  for (const line of FINAL_TRANSFER_LINES) assert.equal(RPR_TEXT.split(line).length - 1, 1, line);
  // final transfer order: reconcile -> rewrite -> apply -> runApplied -> assertAllocated -> failure verdict
  const at = (l) => RPR_TEXT.indexOf(l);
  assert.ok(at(FINAL_TRANSFER_LINES[0]) < at(FINAL_TRANSFER_LINES[1]) && at(FINAL_TRANSFER_LINES[1]) < at(FINAL_TRANSFER_LINES[2]) && at(FINAL_TRANSFER_LINES[2]) < at(FINAL_TRANSFER_LINES[3]) && at(FINAL_TRANSFER_LINES[3]) < at(FINAL_TRANSFER_LINES[4]));
  const real = H.locateFunctionSource(SOURCE, 'g2RunPhases');
  const test = H.locateFunctionSource(CURRENT_SOURCE, 'g2RunPhases');
  const realText = SOURCE.slice(real.start, real.end);
  const testText = CURRENT_SOURCE.slice(test.start, test.end);
  assert.equal(testText.replace('const env = window.__testEnv;', '').replace("drivers: env.drivers,\n      mode: 'offline-fake',\n      assertPhaseBaseline: null,", ''),
    realText.replace('const env = g2BuildEnv({ nodeLoadOutcomes: arg && isPlainObject(arg.nodeLoadOutcomes) ? arg.nodeLoadOutcomes : null });', '').replace("drivers: createLivePhaseDrivers(env),\n      mode: 'live',\n      assertPhaseBaseline: async (phase) => g2PhaseBaseline(env, phase),", ''));
  for (const n of ['g2FinalizeRunTransfer', 'g2EnterCleanupAfterFailure']) assert.ok(H.buildPageAgentSource(SOURCE).source.includes(`async function ${n}(`), `${n} ships in the page bundle`);
  // LIVE_PATH_WIRED is deliberately not pinned here: the single pin of the real value is in live-path-isolation.test.mjs.
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

// ==========================================================================================
// Medium 1 -- eventLog finalized after the last transfer drain
// ==========================================================================================

/** A page callback that records ONE cleanup-phase event while the FIRST final-transfer drain fence is in flight. */
function lateDrainCallback(page) {
  const seen = { drains: 0, fired: false };
  return {
    seen,
    opts: { [H.G2_NODE_SYNC_BINDING]: { before: (action) => { if (action !== 'drain') return; seen.drains += 1; if (!seen.fired) { seen.fired = true; page.recorder.logEvent('final-drain-callback', { note: 'recorded while the final drain was in flight' }); } } } },
  };
}

test('M1: an event recorded DURING the final transfer drain is in the finalized run eventLog exactly once, Node-sequenced after the cleanup marker; a second stable round carried it; pageEvidenceProblems is []', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  const cb = lateDrainCallback(page);
  connect(page, node, cb.opts);
  const out = await runPhases(page, node);
  assert.equal(out.status, 'completed', out.error && out.error.message);
  assert.equal(cb.seen.drains, 2, 'round 1 raced the callback; round 2 was stable');
  const late = out.value.eventLog.filter((e) => e.kind === 'final-drain-callback');
  assert.equal(late.length, 1, 'in the page result exactly once');
  assert.equal(late[0].phase, 'cleanup');
  assert.equal(out.value.pageHighWater, page.g.seq.highWater(), 'the transfer high-water is the post-drain high-water');
  assert.equal(page.g.runResultHw, page.g.seq.highWater(), 'the cleanup-delta boundary is set after the callback ordinal');
  assert.equal(page.g.seq.pending().length, 0, 'every ordinal fence-acknowledged before finalization');
  nodeFinalTransfer(node, out.value);
  const S = node.state;
  assert.deepEqual(node.violations, []);
  const auth = S.eventLog.filter((e) => e.kind === 'final-drain-callback');
  assert.equal(auth.length, 1);
  assert.ok(!H.isPageLocalOrdinal(auth[0].seq) && auth[0].seq <= node.runSeq.peek());
  const marker = S.errorLedger.markers.filter((m) => m.name === 'cleanup');
  assert.equal(marker.length, 1);
  assert.ok(auth[0].seq > marker[0].seq, 'after the authoritative cleanup marker (provable run-stage cleanup event)');
  // Node-authoritative order: the eventLog is exactly the ingested event ordinals, in ingestion (allocation) order
  assertNodeOrderedEventLog(node, S.eventLog);
  assert.deepEqual(node.authority.pageEvidenceProblems(S), []);
  assert.deepEqual(H.primarySeqAllocations(S).problems, []);
});

test('M1 pre-fix: the SAME scenario on the exact pre-fix g2RunPhases (runner eventLog snapshotted before the one final drain) leaves the drained event out of the run result => page-evidence-missing + cleanup-event-missing (conservative FAIL, payload lost)', async () => {
  const node = nodeWorld();
  const page = pageRealm({ bundle: PRE_FIX_BUNDLE });
  const cb = lateDrainCallback(page);
  connect(page, node, cb.opts);
  const out = await runPhases(page, node);
  assert.equal(out.status, 'completed');
  assert.equal(cb.seen.drains, 1, 'pre-fix: one drain only');
  assert.equal(out.value.eventLog.filter((e) => e.kind === 'final-drain-callback').length, 0, 'the frozen run eventLog misses it');
  await sleep(30); // RPC return latency: the early best-effort hint for the callback ordinal lands first
  nodeFinalTransfer(node, out.value);
  const seq = node.authority.ingested().find((e) => e.label === 'final-drain-callback').seq;
  assert.deepEqual(node.authority.pageEvidenceProblems(node.state), [`page-evidence-missing:event:${seq}`, `cleanup-event-missing:${seq}`]);
  // ... and the later cleanup delta cannot carry it either (its ordinal is at or below runResultHw)
  const { delta } = await cleanupAndDrain(page, node);
  assert.equal(delta.eventLog.filter((e) => e.kind === 'final-drain-callback').length, 0);
});

test('M1: no duplicate merge -- the cleanup delta starts after the finalized boundary (the drained event is carried once, by the run stage); the merge reports 0 duplicates and the complete state has no provenance problem', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  const cb = lateDrainCallback(page);
  connect(page, node, cb.opts);
  const out = await runPhases(page, node);
  nodeFinalTransfer(node, out.value);
  const { delta, duplicates, problems } = await cleanupAndDrain(page, node);
  assert.equal(duplicates, 0);
  assert.deepEqual(kindsOf(delta.eventLog), ['wrapper-restore'], 'the delta holds only the cleanup-step event');
  assert.deepEqual(problems, []);
  assert.deepEqual(node.violations, []);
  const S = node.state;
  assert.equal(S.eventLog.filter((e) => e.kind === 'final-drain-callback').length, 1);
  assert.equal(new Set(S.eventLog.map((e) => e.seq)).size, S.eventLog.length, 'every eventLog seq once');
  assertNodeOrderedEventLog(node, S.eventLog, 'after the cleanup merge');
  // a re-send of the drained event in the cleanup delta is a duplicate merge (fail closed, never silent)
  const node2 = nodeWorld();
  const page2 = pageRealm();
  const cb2 = lateDrainCallback(page2);
  connect(page2, node2, cb2.opts);
  const out2 = await runPhases(page2, node2);
  nodeFinalTransfer(node2, out2.value);
  const again = out2.value.eventLog.find((e) => e.kind === 'final-drain-callback');
  const r2 = await cleanupAndDrain(page2, node2, { mutateDelta: (d) => ({ ...d, eventLog: [...d.eventLog, again] }) });
  assert.equal(r2.duplicates, 1);
});

test('M1: finalization cannot run before the last drain finishes -- while a final drain fence is unanswered nothing is finalized (no result, no runResultHw); a drain that never stabilizes rejects after 8 rounds and finalizes nothing', async () => {
  // (a) the second (stability) round's fence never returns
  {
    const node = nodeWorld();
    const page = pageRealm();
    let drains = 0;
    connect(page, node, { [H.G2_NODE_SYNC_BINDING]: {
      drop: (action) => action === 'drain' && ++drains === 2,
      before: (action) => { if (action === 'drain' && drains === 1) page.recorder.logEvent('final-drain-callback', {}); },
    } });
    let settled = false;
    const p = runPhases(page, node).then(() => { settled = true; });
    // bounded wait for the second round (every phase also awaits its delayed retain fence), then a further settle window
    for (let i = 0; i < 200 && drains < 2; i += 1) await sleep(10);
    await sleep(150);
    assert.equal(drains, 2, 'the second drain round is in flight');
    assert.equal(settled, false, 'g2RunPhases has not returned');
    assert.equal(page.g.runResultHw, undefined, 'no cleanup-delta boundary yet');
    void p;
  }
  // (b) every round races a new callback => never stable => rejects; nothing finalized
  {
    const node = nodeWorld();
    const page = pageRealm();
    let drains = 0;
    connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { before: (action) => { if (action === 'drain') { drains += 1; page.recorder.logEvent('chatty-callback', {}); } } } });
    const out = await runPhases(page, node);
    assert.equal(out.status, 'threw');
    assert.match(out.error.message, /run transfer drain did not stabilize/);
    assert.equal(drains, 8, 'bounded at 8 rounds');
    assert.equal(page.g.runResultHw, undefined);
  }
});

// ==========================================================================================
// Medium 2 -- cleanup evidence retained after a failed phase run
// ==========================================================================================

/** Arms a page fault: the runner's `fatalObserved()` (evaluated at every phase start, outside the driver try) throws from phase `at` on. */
function faultAt(page, at) {
  let armed = false;
  Object.defineProperty(page.g.fatal, 'flag', { configurable: true, get() { if (armed) throw new Error(`injected page fault at ${at}`); return false; } });
  return { [at]: () => {}, arm: () => { armed = true; } };
}

/** Full retained-failure assertions on the Node state after the final transfer + cleanup drain. */
function assertFailureRetained(node, { message, problems, passed }) {
  const S = node.state;
  // POST-C1 failure (Node holds the authoritative gate): truthful history -- already produced check/control records are KEPT,
  // only work that produced no record is BLOCKED(phase-run-threw) / not started, and the gate is Node's own retained gate.
  assert.equal(S.phaseRunFailure.c1Stage, 'post-c1');
  assert.deepEqual(S.gates, { C1: node.state.authoritativeGate });
  for (const [n, c] of Object.entries(S.checks)) {
    const label = H.checkVerdictLabel(c);
    if (label === 'BLOCKED(phase-run-threw)') assert.match(c.evidence.phaseRunFailure.message, message, n);
    else assert.equal(label, 'PASS', `${n}: a retained, already-executed record`);
  }
  assert.deepEqual(Object.entries(S.checks).filter(([, c]) => H.checkVerdictLabel(c) === 'PASS').map(([n]) => n), passed);
  for (const c of Object.values(S.controls)) assert.ok(c.executionRecord.started === true || c.fields.reason === 'phase-run-threw', 'executed control retained or unstarted placeholder');
  assert.deepEqual(problems, []);
  const kinds = kindsOf(S.eventLog);
  assert.ok(kinds.includes('check-finalized'), 'C1 finalization event of the failed run retained (page evidence, not a verdict)');
  assert.ok(kinds.includes('wrapper-restore'), 'cleanup-step event retained');
  assert.equal(S.spyLedger.filter((r) => r.phase === 'cleanup').length, 1, 'cleanup spy record retained');
  assert.equal(S.stateSnapshots.filter((r) => r.baselinePhase === 'cleanup').length, 1, 'cleanup snapshot retained');
  assertNodeOrderedEventLog(node, S.eventLog);
  // the not-started control placeholders carry REAL Node-allocated seqs now (never 0): no collision, no leaked ordinal
  assert.deepEqual(H.primarySeqAllocations(S).problems, []);
  assert.deepEqual(H.phaseRunFailureShapeProblems(S.phaseRunFailure), []);
  assert.ok(Object.values(S.controls).every((c) => c.executionRecord.terminalSeq > 0));
}

test('M2: phase run throws BEFORE the cleanup marker (page fault at P5a) => the page enters cleanup (one marker:cleanup, acknowledged), makes the same final transfer; run + cleanup evidence retained; every check BLOCKED(phase-run-threw) with the exact failure; no fence violation', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const fault = faultAt(page, 'P5a');
  const out = await runPhases(page, node, drivers(page, { P4: () => fault.arm() }));
  assert.equal(out.status, 'completed', 'the failure is TRANSFERRED, not thrown');
  const pf = out.value.phaseRunFailure;
  // exact failure detail: error category/message + the attribution in force when the runner threw + the failure's own page ordinal
  assert.deepEqual({ ...pf, seq: typeof pf.seq }, { name: 'Error', message: 'injected page fault at P5a', phase: 'P5a', activeCheck: null, activeControl: null, operation: null, seq: 'number', cleanupEntry: 'marker-allocated' });
  // F1: EVERY marker emitted before the failure survives the throw (P1..P5a), then the cleanup marker -- not just the cleanup marker
  const phaseIds = page.t.PHASE_ORDER.map((p) => p.id).filter((id) => id !== 'P0'); // P0 is Node's own marker
  assert.deepEqual(out.value.markers.map((m) => m.name), [...phaseIds.slice(0, phaseIds.indexOf('P5a') + 1), 'cleanup']);
  assert.equal(Object.hasOwn(out.value, 'checks'), false, 'a failure transfer carries no page verdicts');
  assert.deepEqual(node.attribution, CLEANUP, 'Node acknowledged the cleanup attribution before any cleanup step');
  assert.ok(kindsOf(out.value.eventLog).includes('p3-run-event'), 'run-phase evidence up to the throw is in the transfer');
  nodeFinalTransfer(node, out.value);
  const { duplicates, problems } = await cleanupAndDrain(page, node);
  assert.equal(duplicates, 0);
  assertFailureRetained(node, { message: /injected page fault at P5a/, problems, passed: ['C1', 'C2', 'C3', 'C4', 'C5'] });
  assert.deepEqual(node.violations, []);
  assert.deepEqual(node.ledger.entries, [], 'no fatal: the root cause is the durable phaseRunFailure record (row 3), not a Node fatal');
  // the root failure record: Node-authoritative failureSeq = the authoritative seq of the page's own ordinal, between the last phase marker and the cleanup marker
  const prf = node.state.phaseRunFailure;
  assert.equal(prf.source, 'page-phase-run');
  assert.equal(prf.seqSource, 'page-alloc');
  assert.equal(prf.failureSeq, node.authority.seqOfOrdinal(pf.seq));
  const mk = node.state.errorLedger.markers;
  assert.deepEqual(mk.map((m) => m.name), ['P0', ...out.value.markers.map((m) => m.name)], 'Node\'s P0 marker + the whole page marker history reach the authoritative state');
  assert.ok(mk.every((m, i) => i === 0 || m.seq > mk[i - 1].seq), 'markers in authoritative Node seq order');
  assert.ok(prf.failureSeq > mk.find((m) => m.name === 'P5a').seq && prf.failureSeq < mk.find((m) => m.name === 'cleanup').seq);
  assert.deepEqual(H.phaseRunFailureShapeProblems(prf), []);
  // the failure marker is the provable cleanup boundary (identity-bound run-stage alloc ordinal)
  const src = node.authority.provenance().find((e) => e.seq === node.state.errorLedger.markers.find((m) => m.name === 'cleanup').seq);
  assert.deepEqual([src.kind, src.label, src.phase, src.stage], ['alloc', 'marker:cleanup', 'cleanup', 'run']);
});

test('M2: phase run throws AFTER the cleanup marker (its own fence refused in transit => one Node violation) => the page REUSES the runner\'s marker:cleanup (no second marker), re-acknowledges, transfers; an event recorded between the two positions is a cleanup event AFTER the boundary; evidence retained; the root-cause violation stays the ONLY fatal; checks BLOCKED(phase-run-threw)', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  let tampered = false;
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => {
    if (a[0] === 'attribution' && a[1].phase === 'cleanup' && !tampered) {
      tampered = true; a[1].hw += 1;
      // an event recorded after the runner's cleanup marker but before the failure path re-enters cleanup (cleanup attribution already in force)
      page.recorder.logEvent('between-cleanup-marker-positions', { note: 'recorded between the runner marker and the failure-path re-entry' });
    }
  } } });
  const out = await runPhases(page, node);
  assert.equal(tampered, true);
  assert.equal(out.status, 'completed');
  assert.equal(out.value.phaseRunFailure.cleanupEntry, 'marker-reused');
  assert.equal(out.value.markers.filter((m) => m.name === 'cleanup').length, 1, 'ONE cleanup marker: the runner\'s is reused');
  assert.match(out.value.phaseRunFailure.message, /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
  nodeFinalTransfer(node, out.value);
  const { problems } = await cleanupAndDrain(page, node);
  assertFailureRetained(node, { message: /ingest-hw-mismatch/, problems, passed: H.CHECK_NAMES });
  assert.deepEqual(node.violations, ['ingest-hw-mismatch'], 'the root cause, exactly once');
  assert.deepEqual(node.ledger.entries.map((e) => e.detail), ['cross-realm-fence:ingest-hw-mismatch']);
  // exactly ONE marker:cleanup alloc ordinal exists (the runner's, reused): the cleanup boundary never moved
  assert.equal(node.authority.ingested().filter((e) => e.label === 'marker:cleanup').length, 1);
  assert.equal(node.state.errorLedger.markers.filter((m) => m.name === 'cleanup').length, 1);
  const between = node.state.eventLog.find((e) => e.kind === 'between-cleanup-marker-positions');
  assert.ok(between && between.phase === 'cleanup', 'the between-markers event is retained as a cleanup event');
  assert.ok(between.seq > node.state.errorLedger.markers.find((m) => m.name === 'cleanup').seq, 'after the (unmoved) cleanup boundary');
  assert.equal(problems.some((p) => p.startsWith('cleanup-event-before-boundary')), false);
});

test('M2: phase throws AND the cleanup evidence has a problem (an omitted cleanup event) => BOTH causes retained: checks BLOCKED(phase-run-threw) with the exact failure + the provenance problem; never PASS', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const fault = faultAt(page, 'P5a');
  const out = await runPhases(page, node, drivers(page, { P4: () => fault.arm() }));
  nodeFinalTransfer(node, out.value);
  const { problems } = await cleanupAndDrain(page, node, { mutateDelta: (d) => ({ ...d, eventLog: [] }) });
  const restore = node.authority.ingested().find((e) => e.label === 'wrapper-restore');
  assert.deepEqual(problems, [`page-evidence-missing:event:${restore.seq}`, `cleanup-event-missing:${restore.seq}`]);
  assert.equal(node.state.phaseRunFailure.message, 'injected page fault at P5a');
  assert.equal(node.state.phaseRunFailure.c1Stage, 'post-c1');
  for (const [n, c] of Object.entries(node.state.checks)) {
    if (H.checkVerdictLabel(c) === 'PASS') continue; // an executed record retained from before the failure
    assert.equal(H.checkVerdictLabel(c), 'BLOCKED(phase-run-threw)', n);
    assert.equal(c.evidence.phaseRunFailure.message, 'injected page fault at P5a');
  }
});

test('M2: nothing transferable (no sync binding / refused cleanup entry / non-stabilizing final drain) => the ORIGINAL failure is rethrown (never replaced by the transfer error); nothing finalized', async () => {
  // refused cleanup entry: the page's run-phase fence is refused in transit and Node never acknowledged that phase's
  // ordinals, so the cleanup entry fence is refused too (ingest-attribution) => the original failure propagates
  {
    const node = nodeWorld();
    const page = pageRealm();
    connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'attribution' && a[1].phase === 'P5a') a[1].hw += 1; } } });
    const out = await runPhases(page, node);
    assert.equal(out.status, 'threw');
    assert.match(out.error.message, /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
    assert.equal(page.g.runResultHw, undefined);
    assert.equal(node.violations[0], 'ingest-hw-mismatch', 'the root cause is the first violation');
  }
  // failure + a final drain that never stabilizes => the ORIGINAL failure, not 'did not stabilize'
  {
    const node = nodeWorld();
    const page = pageRealm();
    connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { before: (action) => { if (action === 'drain') page.recorder.logEvent('chatty-callback', {}); } } });
    const fault = faultAt(page, 'P5a');
    const out = await runPhases(page, node, drivers(page, { P4: () => fault.arm() }));
    assert.equal(out.status, 'threw');
    assert.equal(out.error.message, 'injected page fault at P5a');
    assert.equal(page.g.runResultHw, undefined);
  }
  // no sync binding at all (offline caller): nothing can be transferred with provenance
  {
    const page = pageRealm();
    const fault = faultAt(page, 'P1');
    fault.arm();
    page.env.drivers = drivers(page);
    await assert.rejects(page.t.g2RunPhases({}), /injected page fault at P1/);
  }
});

test('M2 Node verdict: a failure transfer can never PASS -- page-sent PASS checks/controls/gates are ignored (BLOCKED(phase-run-threw)); a non-object phaseRunFailure still fails; the exact failure is redacted/bounded', () => {
  const mk = () => ({ checks: {}, controls: {}, errorLedger: H.createEmptyErrorLedger(), gates: { C1: {} }, n6: { x: 1 } });
  const nextSeq = H.createRunSeqAllocator().next;
  const forged = { phaseRunFailure: { name: 'Error', message: `boom Bearer abc.def.ghi ${'x'.repeat(2000)}` }, eventLog: [{ seq: 3, kind: 'b' }, { seq: 1, kind: 'a' }], checks: { C1: H.makeCheckRecord({ verdict: 'PASS' }) }, gates: { C1: { outcome: 'OPEN' } } };
  const s = mk();
  H.applyPhaseRunFailureToState(s, forged, { nextSeq });
  assert.equal(Object.keys(s.checks).length, H.CHECK_NAMES.length);
  assert.ok(Object.values(s.checks).every((c) => H.checkVerdictLabel(c) === 'BLOCKED(phase-run-threw)'));
  assert.ok(Object.values(s.checks).every((c) => H.validateCheckRecord(c).ok));
  assert.equal(Object.keys(s.controls).length, H.CONTROL_NAMES.length);
  assert.deepEqual([s.gates, s.n6], [null, null]);
  assert.deepEqual(s.eventLog.map((e) => e.seq), [1, 3], 'seq-ordered, kept as transferred');
  const msg = s.checks.C1.evidence.phaseRunFailure.message;
  assert.doesNotMatch(msg, /abc\.def\.ghi/, 'redacted');
  assert.ok(Buffer.byteLength(msg) <= 512, 'bounded');
  for (const bad of [true, 'oops', null, 7]) {
    const t = mk();
    H.applyPhaseRunFailureToState(t, { phaseRunFailure: bad }, { nextSeq });
    assert.ok(Object.values(t.checks).every((c) => H.checkVerdictLabel(c) === 'BLOCKED(phase-run-threw)'), String(bad));
  }
});

// ==========================================================================================
// v2 post-C1 truthful history (real page realm): the C1 stage is decided by NODE's retained gate
// (`state.authoritativeGate`, stored by the real sync `gate` action), never by the page.
// ==========================================================================================

/** The durable failed-run view of the mini Node state (the live path taints the session on a failure). */
const failedView = (node) => ({ ...clone(node.state), sessionTainted: true });

test('v2 post-C1 (real page realm): the page throws in P3 AFTER control N1 ran (P2) => Node\'s own gate kept, C1 PASS + control-run N1 retained with its start/terminal seqs, everything later BLOCKED / unstarted; c1Stage post-c1; failedRunRecordProblems []; erasing N1 to a placeholder over its own history is detected', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const fault = faultAt(page, 'P3');
  const drv = drivers(page);
  // P2 runs control N1 for real (beginControl through the Node attribution fence) and records one N1-attributed event
  drv.P2 = async (ctx) => {
    fault.arm();
    await ctx.beginControl('N1');
    page.recorder.logEvent('n1-probe', { note: 'recorded while N1 executes' });
    return { checks: {}, controls: { N1: page.t.makeControlRecord('N1', 'DETECTED') } };
  };
  const out = await runPhases(page, node, drv);
  assert.equal(out.status, 'completed', out.error && out.error.message);
  assert.ok(isPlainObject(out.value.partial), 'the page transferred its partial history');
  assert.deepEqual(Object.keys(out.value.partial.controls), ['N1']);
  nodeFinalTransfer(node, out.value);
  const { problems } = await cleanupAndDrain(page, node);
  assert.deepEqual(problems, []);
  assert.deepEqual(node.violations, []);
  const S = node.state;
  const gate = S.authoritativeGate;
  assert.ok(isPlainObject(gate) && gate.outcome === 'OPEN', 'Node retained the authoritative OPEN gate');
  assert.deepEqual(S.gates, { C1: gate });
  const f = S.phaseRunFailure;
  assert.deepEqual([f.c1Stage, f.gateSeq, f.gateOutcome, f.phase, f.seqSource, f.source], ['post-c1', gate.gateSeq, 'OPEN', 'P3', 'page-alloc', 'page-phase-run']);
  assert.ok(f.failureSeq > gate.gateSeq);
  assert.equal(H.checkVerdictLabel(S.checks.C1), 'PASS');
  assert.equal(S.checks.C1.finalizedSeq, gate.c1FinalizedSeq);
  const n1 = S.controls.N1;
  assert.deepEqual([n1.recordType, n1.executionRecord.started, n1.state], ['control-run', true, 'DETECTED']);
  assert.ok(n1.executionRecord.startSeq > gate.gateSeq && n1.executionRecord.terminalSeq > n1.executionRecord.startSeq && n1.executionRecord.terminalSeq < f.failureSeq, JSON.stringify(n1.executionRecord));
  assert.ok(!H.isPageLocalOrdinal(n1.executionRecord.startSeq) && !H.isPageLocalOrdinal(n1.executionRecord.terminalSeq), 'authoritative Node seqs');
  for (const n of H.CHECK_NAMES.filter((c) => c !== 'C1')) assert.equal(H.checkVerdictLabel(S.checks[n]), 'BLOCKED(phase-run-threw)', n);
  for (const n of H.CONTROL_NAMES.filter((c) => c !== 'N1')) assert.deepEqual([S.controls[n].executionRecord.started, S.controls[n].fields.reason], [false, 'phase-run-threw'], n);
  assert.deepEqual(H.primarySeqAllocations(S).problems, []);
  assert.deepEqual(H.failedRunRecordProblems(failedView(node)), []);
  // non-vacuity: rewriting the executed N1 to a placeholder (the pre-v2 erasure) contradicts its own attributed history
  const erased = failedView(node);
  erased.controls.N1 = H.notStartedControlRun('N1', 'phase-run-threw', { seq: node.runSeq.next() });
  const n1History = ['spyLedger', 'eventLog', 'stateSnapshots'].some((k) => (Array.isArray(erased[k]) ? erased[k] : []).some((e) => e.activeControl === 'N1'));
  assert.ok(n1History, 'the run produced N1-attributed history (the erasure probe is not vacuous)');
  assert.ok(H.failedRunRecordProblems(erased).includes('failed-run-unstarted-control-has-history:N1'), JSON.stringify(H.failedRunRecordProblems(erased)));
});

test('v2 pre-C1 (real page realm): the page throws at P1 BEFORE the gate => Node holds no gate => c1Stage pre-c1, gates null, every check BLOCKED, every control unstarted, no downstream marker; failedRunRecordProblems []', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const fault = faultAt(page, 'P1');
  fault.arm();
  const out = await runPhases(page, node);
  assert.equal(out.status, 'completed', out.error && out.error.message);
  nodeFinalTransfer(node, out.value);
  const { problems } = await cleanupAndDrain(page, node);
  assert.deepEqual(problems, []);
  const S = node.state;
  assert.equal(S.authoritativeGate, undefined, 'the gate was never established');
  const f = S.phaseRunFailure;
  assert.deepEqual([f.c1Stage, f.gateSeq, f.gateOutcome], ['pre-c1', null, null]);
  assert.equal(S.gates, null);
  assert.ok(H.CHECK_NAMES.every((n) => H.checkVerdictLabel(S.checks[n]) === 'BLOCKED(phase-run-threw)'));
  assert.ok(H.CONTROL_NAMES.every((n) => S.controls[n].executionRecord.started === false));
  assert.equal(S.errorLedger.markers.some((m) => H.DOWNSTREAM_PHASE_IDS.includes(m.name)), false);
  assert.deepEqual(H.failedRunRecordProblems(failedView(node)), []);
});

test('v2 pre-C1 (real page realm): the Node gate REFUSES (gate sync refused in transit) => the runner throws before any downstream phase => pre-c1, all BLOCKED', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'gate') a[1].hw += 1; } } });
  const out = await runPhases(page, node);
  assert.equal(out.status, 'completed', out.error && out.error.message);
  assert.ok(isPlainObject(out.value.phaseRunFailure));
  nodeFinalTransfer(node, out.value);
  const S = node.state;
  assert.equal(S.authoritativeGate, undefined, 'a refused gate is never retained');
  assert.match(S.phaseRunFailure.message, /C1 gate refused by the node authority \(ingest-hw-mismatch\)/);
  assert.deepEqual(node.violations, ['ingest-hw-mismatch']);
  assert.deepEqual(S.errorLedger.markers.map((m) => m.name), ['P0', 'P1', 'cleanup'], 'no downstream marker');
  assert.equal(S.phaseRunFailure.c1Stage, 'pre-c1');
  assert.equal(S.gates, null);
  assert.ok(H.CHECK_NAMES.every((n) => H.checkVerdictLabel(S.checks[n]) === 'BLOCKED(phase-run-threw)'));
  assert.deepEqual(H.failedRunRecordProblems(failedView(node)), []);
});

test('v2 post-c1-untransferred (real page realm): Node holds the gate but the transfer lacks (or contradicts) C1 => untransferred: gate fact kept in gateSeq/gateOutcome, gates null, nothing kept; failedRunRecordProblems []; direct call with no partial agrees', async () => {
  for (const [label, edit] of [['partial removed', (v) => { delete v.partial; }], ['partial C1 contradicts the gate', (v) => { v.partial.checks.C1.verdict = 'FAIL'; v.partial.checks.C1.reason = 'x'; }]]) {
    const node = nodeWorld();
    const page = pageRealm();
    connect(page, node);
    const fault = faultAt(page, 'P3');
    const out = await runPhases(page, node, drivers(page, { P2: () => fault.arm() }));
    assert.equal(out.status, 'completed', out.error && out.error.message);
    edit(out.value);
    nodeFinalTransfer(node, out.value);
    const S = node.state;
    const gate = S.authoritativeGate;
    assert.ok(isPlainObject(gate), label);
    assert.deepEqual([S.phaseRunFailure.c1Stage, S.phaseRunFailure.gateSeq, S.phaseRunFailure.gateOutcome, S.gates], ['post-c1-untransferred', gate.gateSeq, 'OPEN', null], label);
    assert.ok(H.CHECK_NAMES.every((n) => H.checkVerdictLabel(S.checks[n]) === 'BLOCKED(phase-run-threw)'), label);
    assert.ok(H.CONTROL_NAMES.every((n) => S.controls[n].executionRecord.started === false), `${label}: N1 not claimed without a usable transfer`);
    assert.deepEqual(H.failedRunRecordProblems(failedView(node)), [], label);
  }
  // direct: Node gate + no partial at all
  const st = { checks: {}, controls: {}, errorLedger: H.createEmptyErrorLedger(), authoritativeGate: { gateSeq: 4, gateAt: '2026-10-02T00:00:00.000Z', c1Verdict: 'PASS', c1Reason: null, c1FinalizedSeq: 3, fatalCountAtGate: 0, outcome: 'OPEN', notStarted: [] } };
  const seq = H.createRunSeqAllocator();
  for (let i = 0; i < 10; i += 1) seq.next();
  H.applyPhaseRunFailureToState(st, { phaseRunFailure: { name: 'Error', message: 'x', phase: 'P2', seq: 9, cleanupEntry: 'marker-allocated' } }, { nextSeq: seq.next });
  assert.deepEqual([st.phaseRunFailure.c1Stage, st.phaseRunFailure.gateSeq, st.phaseRunFailure.gateOutcome, st.gates], ['post-c1-untransferred', 4, 'OPEN', null]);
  // contrast: without a Node gate the same call is pre-c1
  const pre = { checks: {}, controls: {}, errorLedger: H.createEmptyErrorLedger() };
  H.applyPhaseRunFailureToState(pre, { phaseRunFailure: { name: 'Error', message: 'x', phase: 'P2', seq: 9, cleanupEntry: 'marker-allocated' }, partial: { checks: { C1: H.makeCheckRecord({ verdict: 'PASS' }) }, controls: {} } }, { nextSeq: seq.next });
  assert.equal(pre.phaseRunFailure.c1Stage, 'pre-c1', 'a page partial alone never makes a run post-c1');
});

test('v2 operation detail (real page realm): g2FailureDetail maps an error carrying operationId/operationType/reason to a bounded, redacted `operation`, else null; a runner throw of such an error reaches phaseRunFailure.operation, and Node cross-validates it against the opLedger', async () => {
  const page = pageRealm();
  const fd = page.t.g2FailureDetail;
  assert.deepEqual(clone(fd(Object.assign(new Error('x'), { operationId: 'op-1', operationType: 'mutation', reason: 'rejected' }))), { operation: { operationId: 'op-1', operationType: 'mutation', reason: 'rejected' } });
  assert.deepEqual(clone(fd(Object.assign(new Error('x'), { operationType: 'load' }))), { operation: { operationId: null, operationType: 'load', reason: null } });
  assert.deepEqual(clone(fd(new Error('plain'))), { operation: null });
  for (const v of [null, undefined, 'str', 7]) assert.deepEqual(clone(fd(v)), { operation: null }, String(v));
  assert.deepEqual(clone(fd(Object.assign(new Error('x'), { operationId: 42, reason: {} }))), { operation: null }, 'non-strings are dropped');
  const big = clone(fd(Object.assign(new Error('x'), { operationId: 'o'.repeat(500), reason: 'Bearer abc.def.ghi' })));
  assert.ok(Buffer.byteLength(big.operation.operationId) <= 128, 'bounded');
  assert.doesNotMatch(big.operation.reason, /abc\.def\.ghi/, 'redacted');
  // end to end: the runner throws an operation-carrying error in P3 (after the gate)
  const node = nodeWorld();
  const p2 = pageRealm();
  connect(p2, node);
  let armed = false;
  Object.defineProperty(p2.g.fatal, 'flag', { configurable: true, get() { if (armed) throw Object.assign(new Error('operation refused'), { operationId: 'op-p3', operationType: 'mutation', reason: 'viewer.isolate rejected' }); return false; } });
  const out = await runPhases(p2, node, drivers(p2, { P2: () => { armed = true; } }));
  assert.equal(out.status, 'completed', out.error && out.error.message);
  assert.deepEqual(out.value.phaseRunFailure.operation, { operationId: 'op-p3', operationType: 'mutation', reason: 'viewer.isolate rejected' });
  nodeFinalTransfer(node, out.value);
  const S = failedView(node);
  assert.deepEqual(S.phaseRunFailure.operation, { operationId: 'op-p3', operationType: 'mutation', reason: 'viewer.isolate rejected' });
  assert.ok(H.failedRunRecordProblems(S).includes('failed-run-operation-unknown'), 'no opLedger record => fail closed');
  S.errorLedger.opLedger = [{ recordType: 'mutation', operationId: 'op-p3', operationType: 'mutation', phase: 'P3', invokedBy: 'C2', startSeq: S.phaseRunFailure.failureSeq - 1 }];
  assert.deepEqual(H.failedRunRecordProblems(S), [], 'a matching, earlier-started operation record');
  S.errorLedger.opLedger[0].operationType = 'load';
  assert.ok(H.failedRunRecordProblems(S).includes('failed-run-operation-type-mismatch'));
});

// ==========================================================================================
// Post-C1 review follow-up: the failure attribution/seq are AUTHENTICATED against Node's ingestion provenance;
// failureSeq must follow gateSeq in BOTH post-C1 stages.
// ==========================================================================================

test('v2 review M2: a forged page claim of phase/activeCheck/activeControl/seq is replaced by the attribution Node validated at the failure\'s own ingested ordinal; a seq with no ingested phase-run-failure ordinal is Node-observed', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const fault = faultAt(page, 'P5a');
  const out = await runPhases(page, node, drivers(page, { P4: () => fault.arm() }));
  assert.equal(out.status, 'completed');
  const honest = out.value.phaseRunFailure;
  // (a) forged attribution claim, genuine ordinal
  const forged = { ...out.value, phaseRunFailure: { ...honest, phase: 'P9', activeCheck: 'C16', activeControl: 'N3' } };
  const run = node.authority.rewritePageRun(forged, { stage: 'run' });
  const auth = H.authenticatedFailureRun(run, node.authority).phaseRunFailure;
  assert.deepEqual([auth.phase, auth.activeCheck, auth.activeControl], ['P5a', null, null], 'Node\'s validated attribution, not the page claim');
  assert.equal(auth.seq, run.phaseRunFailure.seq, 'the genuine ordinal keeps its authoritative seq');
  // (b) a seq that is not an ingested phase-run-failure ordinal (e.g. another allocation's seq) is not trusted
  const bogus = H.authenticatedFailureRun({ ...run, phaseRunFailure: { ...run.phaseRunFailure, seq: run.markers[0].seq } }, node.authority).phaseRunFailure;
  assert.deepEqual([bogus.seq, bogus.phase, bogus.activeCheck, bogus.activeControl], [null, null, null, null]);
  const applied = { primaryPhase: null };
  const st = { errorLedger: H.createEmptyErrorLedger(), checks: {}, controls: {} };
  H.applyPhaseRunFailureToState(st, { phaseRunFailure: bogus }, { nextSeq: node.runSeq.next });
  assert.equal(st.phaseRunFailure.seqSource, 'node-observed');
  void applied;
});

test('v2 review M3: failureSeq must follow gateSeq for post-c1-untransferred as well (fabricated gate ordering is a validator problem); gateSeq is a primary allocation', () => {
  const runSeq = H.createRunSeqAllocator();
  const st = { errorLedger: H.createEmptyErrorLedger(), checks: {}, controls: {}, authoritativeGate: { gateSeq: 50, outcome: 'OPEN', c1Verdict: 'PASS', c1Reason: null, c1FinalizedSeq: 49 }, sessionTainted: true };
  for (let i = 0; i < 60; i += 1) runSeq.next(); // node-observed failureSeq > gateSeq
  H.applyPhaseRunFailureToState(st, { phaseRunFailure: { name: 'Error', message: 'x' } }, { nextSeq: runSeq.next, source: 'node-phase-run-transport', status: 'timed-out', attribution: { phase: 'P5a' } });
  assert.equal(st.phaseRunFailure.c1Stage, 'post-c1-untransferred');
  assert.equal(H.failedRunRecordProblems(st).includes('failed-run-seq-before-gate'), false);
  st.phaseRunFailure.failureSeq = 50;
  assert.ok(H.failedRunRecordProblems(st).includes('failed-run-seq-before-gate'));
  st.phaseRunFailure.failureSeq = 40;
  assert.ok(H.failedRunRecordProblems(st).includes('failed-run-seq-before-gate'));
  assert.ok(H.primarySeqAllocations(st).seqs.some((x) => x.label === 'phaseRunFailure.gateSeq'), 'gateSeq of an untransferred failure is a primary allocation');
});
