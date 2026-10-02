// test/acceptance/clashpanel-viewerbridge.acceptance.op-refusal-detail.test.mjs
//
// Before-live hardening, Medium 3 -- the EXACT operation-begin refusal detail is durable. The fail-safe block of
// `runAcknowledgedMutation(requireOps)` is unchanged (the mutation never starts; no spy record; no ops.end; the
// generic `harness-exception:P9` unit block stays the summary; Node keeps its single `op-begin-refused:<reason>`
// violation for an explicit Node refusal and records none for a page-observed failure). In addition every block
// appends ONE page-origin `operation-begin-refused` eventLog entry (recorder.logEvent; the thrown error carries
// the same detail as `operationRefusal`) with: category, sourceRealm, reason, operationType / modelId /
// operationPhase / invokedBy, operationId, response (bounded text of a malformed answer), error {name, message},
// at (ISO) + the recorder's seq/phase/activeCheck/activeControl. Being a page-origin event it is Node-sequenced
// by the single allocator at the next fence, is mandatory page evidence (pageEvidenceProblems), is retained by
// applyPhaseRunToState and survives into the persisted R1 payload (closeoutProtocol on the recording fake fs).
//
// Covered: explicit refused begin, thrown/rejected begin, malformed answer, empty operation id, missing binding,
// delayed (late refused / late rejected) begin, the cleanup-unload path, cross-realm (REAL page bundle in node:vm
// + REAL Node binding bodies sliced out of runPostReservation, as crossrealm.test.mjs) and closeout persistence;
// non-vacuity on a mutated harness copy. Offline only: no browser, no network; LIVE_PATH_WIRED stays false.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const BASE_ORD = H.PAGE_LOCAL_BASE;
const KIND = 'operation-begin-refused';
const HIDE = Object.freeze({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const DETAIL_KEYS = Object.freeze(['category', 'sourceRealm', 'reason', 'operationType', 'modelId', 'operationPhase', 'invokedBy', 'operationId', 'response', 'error', 'at']);
const HIDE_FIELDS = Object.freeze({ operationType: 'hide', modelId: 'B', operationPhase: 'P9', invokedBy: 'C16' });
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tick = () => new Promise((r) => { setImmediate(r); });

const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-oprefusal-detail-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });
let mutations = 0;
function mutate(source, pairs) {
  let s = source;
  for (const [from, to] of pairs) {
    assert.equal(s.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
    s = s.replace(from, () => to);
  }
  return s;
}
async function importMutated(pairs) {
  mutations += 1;
  const file = path.join(SANDBOX, String(mutations), 'clashpanel-viewerbridge.acceptance.mjs');
  mkdirSync(path.dirname(file));
  writeFileSync(file, mutate(SOURCE, pairs));
  return import(pathToFileURL(file).href);
}
const LOG_EVENT_LINE = "if (recorder && typeof recorder.logEvent === 'function') { try { recorder.logEvent(OPERATION_REFUSAL_EVENT_KIND, detail); }";

// ------------------------------------------------------------------------------------------
// Page side: runAcknowledgedMutation(requireOps) with a real recorder
// ------------------------------------------------------------------------------------------

function fakeOps(answer, log = []) {
  return {
    log,
    begin: async (desc) => { log.push(['begin', desc.operationType, desc.invokedBy]); return typeof answer === 'function' ? answer(desc) : answer; },
    end: async (arg) => { log.push(['end', arg.operationId]); return { ok: true }; },
  };
}

function p9Recorder(M = H) {
  const recorder = M.createCallRecorder();
  recorder.setAttribution({ phase: 'P9', activeCheck: 'C16', activeControl: null });
  return recorder;
}

async function blockedRun({ ops, desc = HIDE, M = H, recorder = p9Recorder(M) }) {
  let invoked = 0;
  let err = null;
  try {
    await M.runAcknowledgedMutation({ ops, requireOps: true, desc, recorder, method: 'viewer.hideModel', args: [2], invoke: () => { invoked += 1; } });
  } catch (e) { err = e; }
  return { recorder, invoked, err, events: recorder.events.filter((e) => e.kind === KIND) };
}

/** One block: thrown, nothing invoked, no spy record, no ops.end, exactly ONE refusal event equal to err.operationRefusal. */
function assertOneDetail(r, expected, { attribution = ['P9', 'C16', null] } = {}) {
  assert.ok(r.err instanceof Error, 'the mutation is blocked by a throw');
  assert.equal(r.invoked, 0, 'invoke() never called');
  assert.equal(r.recorder.records.length, 0, 'no spy record for a blocked mutation');
  assert.equal(r.events.length, 1, 'exactly one refusal event');
  const ev = r.events[0];
  assert.deepEqual(Object.keys(ev).sort(), [...DETAIL_KEYS, 'seq', 'phase', 'activeCheck', 'activeControl', 'kind'].sort());
  assert.deepEqual([ev.phase, ev.activeCheck, ev.activeControl], attribution, 'phase/check stamped by the recorder');
  assert.ok(Number.isInteger(ev.seq), 'seq from the recorder counter');
  assert.match(ev.at, ISO_RE, 'timestamp');
  const { seq, phase, activeCheck, activeControl, kind, ...detail } = ev; // eslint-disable-line no-unused-vars
  assert.deepEqual(detail, r.err.operationRefusal, 'the thrown error carries the same detail');
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(detail[k], v, k);
  return ev;
}

test('static: the refusal event is logged inside runAcknowledgedMutation BEFORE the throw and never as a spy record; live stays dormant', () => {
  const f = H.locateFunctionSource(SOURCE, 'runAcknowledgedMutation');
  const t = SOURCE.slice(f.start, f.end);
  assert.equal(t.split(LOG_EVENT_LINE).length - 1, 1);
  assert.equal(t.split('throw blocked(').length - 1, 3, 'all three requireOps blocks go through blocked()');
  assert.ok(t.indexOf(LOG_EVENT_LINE) < t.indexOf('recorder.withOrigin('));
  assert.equal(H.OPERATION_REFUSAL_EVENT_KIND, KIND);
  assert.deepEqual([...H.OPERATION_REFUSAL_CATEGORIES], ['refused', 'begin-threw', 'malformed-response', 'empty-operation-id', 'binding-missing']);
  const cs = H.locateFunctionSource(SOURCE, 'g2CleanupStepImpls');
  assert.match(SOURCE.slice(cs.start, cs.end), /createModelCleanupSteps\(\{ viewer, recorder: env \? env\.recorder : null, /);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

test('explicit REFUSED begin ({ok:false, reason}): one event {category refused, sourceRealm node, reason, attempted op}; message unchanged', async () => {
  for (const reason of ['phase-mismatch', 'refused', 'sealed', 'ingest-gap']) {
    const ops = fakeOps({ ok: false, reason });
    const r = await blockedRun({ ops });
    assert.equal(r.err.message, `operation-begin refused (${reason}): mutation not started`);
    assertOneDetail(r, { category: 'refused', sourceRealm: 'node', reason, ...HIDE_FIELDS, operationId: null, response: null, error: null });
    assert.deepEqual(ops.log, [['begin', 'hide', 'C16']], 'no ops.end');
  }
});

test('THROWN / REJECTED begin: one event {category begin-threw, sourceRealm page, error {name, message}}', async () => {
  const sync = { log: [], begin: () => { throw new TypeError('binding gone'); }, end: async () => {} };
  assertOneDetail(await blockedRun({ ops: sync }), { category: 'begin-threw', sourceRealm: 'page', reason: null, error: { name: 'TypeError', message: 'binding gone' }, ...HIDE_FIELDS });
  const rejected = await blockedRun({ ops: fakeOps(() => Promise.reject(new Error('Target page, context or browser has been closed'))) });
  assert.match(rejected.err.message, /^operation-begin failed \(Target page, context or browser has been closed\)/);
  assertOneDetail(rejected, { category: 'begin-threw', sourceRealm: 'page', error: { name: 'Error', message: 'Target page, context or browser has been closed' }, response: null });
  assertOneDetail(await blockedRun({ ops: fakeOps(() => Promise.reject(42)) }), { category: 'begin-threw', error: { name: 'number', message: '42' } }); // eslint-disable-line prefer-promise-reject-errors
});

test('MALFORMED begin answer: one event {category malformed-response, sourceRealm page, response = bounded JSON text of the answer}', async () => {
  for (const [answer, shown, reason] of [
    [{ ok: true }, '{"ok":true}', null], [{ ok: true, operationId: 42 }, '{"ok":true,"operationId":42}', null], [null, 'null', null],
    [undefined, 'undefined', null], [{ ok: 'true', operationId: 'op:x' }, '{"ok":"true","operationId":"op:x"}', null], [{}, '{}', null],
    ['ok', '"ok"', null], [{ ok: false }, '{"ok":false}', null], [{ ok: false, reason: '' }, '{"ok":false,"reason":""}', ''],
  ]) {
    const r = await blockedRun({ ops: fakeOps(answer) });
    assert.equal(r.err.message, 'operation-begin refused (malformed-response): mutation not started');
    assertOneDetail(r, { category: 'malformed-response', sourceRealm: 'page', response: shown, reason, error: null, ...HIDE_FIELDS });
  }
  // a truthy-ok answer carrying an id string is retained as the attempted operation id
  assertOneDetail(await blockedRun({ ops: fakeOps({ ok: 1, operationId: 'op:hide:9' }) }), { category: 'malformed-response', operationId: 'op:hide:9' });
});

test('EMPTY operation id ({ok:true, operationId:\'\'}): one event {category empty-operation-id, operationId \'\'}', async () => {
  const r = await blockedRun({ ops: fakeOps({ ok: true, operationId: '' }) });
  assert.equal(r.err.message, 'operation-begin refused (malformed-response): mutation not started');
  assertOneDetail(r, { category: 'empty-operation-id', sourceRealm: 'page', operationId: '', response: '{"ok":true,"operationId":""}', reason: null, ...HIDE_FIELDS });
});

test('MISSING binding: one event {category binding-missing, sourceRealm page}', async () => {
  for (const ops of [null, {}, { begin: 'nope' }]) {
    assertOneDetail(await blockedRun({ ops }), { category: 'binding-missing', sourceRealm: 'page', reason: null, operationId: null, response: null, error: null, ...HIDE_FIELDS });
  }
});

test('DELAYED begin: no event while the ack is outstanding; one event when it resolves refused / rejects late; none when it resolves accepted', async () => {
  for (const [settle, expected] of [
    [(d) => d.resolve({ ok: false, reason: 'phase-mismatch' }), { category: 'refused', sourceRealm: 'node', reason: 'phase-mismatch' }],
    [(d) => d.reject(new Error('channel closed')), { category: 'begin-threw', sourceRealm: 'page', error: { name: 'Error', message: 'channel closed' } }],
  ]) {
    let d;
    const p = new Promise((resolve, reject) => { d = { resolve, reject }; });
    const recorder = p9Recorder();
    const run = blockedRun({ ops: fakeOps(() => p), recorder });
    for (let i = 0; i < 5; i += 1) await tick();
    assert.equal(recorder.events.length, 0, 'nothing recorded while pending');
    settle(d);
    assertOneDetail(await run, expected);
  }
  const recorder = p9Recorder();
  let ran = 0;
  await H.runAcknowledgedMutation({ ops: fakeOps(async () => { await sleep(5); return { ok: true, operationId: 'op:hide:3' }; }), requireOps: true, desc: HIDE, recorder, method: 'viewer.hideModel', args: [], invoke: () => { ran += 1; } });
  assert.equal(ran, 1);
  assert.equal(recorder.events.filter((e) => e.kind === KIND).length, 0, 'an accepted begin records no refusal');
});

test('no refusal event without a block: accepted begin, and requireOps:false (offline) refused/thrown begins that still run', async () => {
  for (const answer of [{ ok: false, reason: 'refused' }, null, () => { throw new Error('x'); }]) {
    const recorder = p9Recorder();
    let ran = 0;
    await H.runAcknowledgedMutation({ ops: fakeOps(answer), requireOps: false, desc: HIDE, recorder, invoke: () => { ran += 1; } });
    assert.equal(ran, 1);
    assert.equal(recorder.events.length, 0);
  }
});

test('bounded + redacted detail: a 2 KiB reason / error message is truncated (<=256 / 512 bytes); a requireOps block without a recorder still carries err.operationRefusal', async () => {
  const long = 'r'.repeat(2048);
  const r = await blockedRun({ ops: fakeOps({ ok: false, reason: long }) });
  const ev = assertOneDetail(r, { category: 'refused' });
  assert.ok(Buffer.byteLength(ev.reason) <= 256 && ev.reason.startsWith('rrr'));
  const t = await blockedRun({ ops: fakeOps(() => Promise.reject(new Error('m'.repeat(4000)))) });
  assert.ok(Buffer.byteLength(assertOneDetail(t, { category: 'begin-threw' }).error.message) <= 512);
  let err = null;
  try { await H.runAcknowledgedMutation({ ops: fakeOps({ ok: true, operationId: '' }), requireOps: true, desc: HIDE, invoke: () => {} }); } catch (e) { err = e; }
  assert.equal(err.operationRefusal.category, 'empty-operation-id');
});

test('cleanup unload path (createModelCleanupSteps(recorder, requireOps) under runCleanup): a refused unload of B logs ONE cleanup-phase refusal event; viewer.unloadModel(B) not called; the step still fails', async () => {
  const A = { id: 1 };
  const B = { id: 2 };
  const loaded = [A, B];
  const calls = [];
  const viewer = { getAllModels: () => [...loaded], unloadModel: (m) => { calls.push(m); loaded.splice(loaded.indexOf(m), 1); } };
  const recorder = H.createCallRecorder();
  recorder.setAttribution({ phase: 'cleanup', activeCheck: null, activeControl: null });
  const ops = fakeOps((d) => (d.modelId === 'B' ? { ok: false, reason: 'sealed' } : { ok: true, operationId: 'op:unload:1' }));
  const steps = H.createModelCleanupSteps({ viewer, recorder, getModelA: () => A, getModelB: () => B, ops, requireOps: true });
  await steps.unloadModelA.run();
  await assert.rejects(steps.unloadModelB.run(), /operation-begin refused \(sealed\)/);
  assert.deepEqual(calls, [A], 'B never unloaded');
  const evs = recorder.events.filter((e) => e.kind === KIND);
  assert.equal(evs.length, 1);
  assert.deepEqual([evs[0].phase, evs[0].activeCheck, evs[0].activeControl], ['cleanup', null, null]);
  assert.deepEqual([evs[0].category, evs[0].sourceRealm, evs[0].reason, evs[0].operationType, evs[0].modelId, evs[0].operationPhase, evs[0].invokedBy], ['refused', 'node', 'sealed', 'unload', 'B', 'cleanup', 'cleanup:unloadModelB']);
  assert.equal(recorder.records.length, 0, 'no spy record (cleanup unloads pass no method)');
});

test('non-vacuity: without the logEvent line (mutated harness copy) a block leaves NO durable refusal event (only the thrown error) -- the real harness records exactly one', async () => {
  const M = await importMutated([[LOG_EVENT_LINE, LOG_EVENT_LINE.replace("if (recorder && typeof recorder.logEvent === 'function')", 'if (false)')]]);
  for (const ops of [fakeOps({ ok: false, reason: 'sealed' }), fakeOps({ ok: true, operationId: '' }), fakeOps(() => Promise.reject(new Error('x'))), null]) {
    const r = await blockedRun({ ops, M });
    assert.ok(r.err instanceof Error);
    assert.equal(r.invoked, 0, 'still blocked');
    assert.equal(r.events.length, 0, 'detail lost in the mutant');
  }
  assert.equal((await blockedRun({ ops: fakeOps({ ok: false, reason: 'sealed' }) })).events.length, 1);
});

// ------------------------------------------------------------------------------------------
// Cross-realm: REAL page bundle (node:vm) + REAL Node bindings (sliced out of runPostReservation)
// ------------------------------------------------------------------------------------------

const BINDINGS = Object.freeze(['G2_NODE_FATAL_BINDING', 'G2_NODE_INGEST_BINDING', 'G2_NODE_OPLEDGER_BINDING', 'G2_NODE_SYNC_BINDING']);

function bindingText(source, name) {
  const head = `await live.page.exposeFunction(${name}, `;
  assert.equal(source.split(head).length - 1, 1, `exactly one exposeFunction(${name})`);
  const i = source.indexOf(head);
  const first = source.slice(i, source.indexOf('\n', i));
  if (first.endsWith('{')) {
    const j = source.indexOf('\n      });', i);
    assert.ok(j > i);
    return source.slice(i + head.length, j + '\n      }'.length);
  }
  assert.ok(first.endsWith(');'));
  return first.slice(head.length, -2);
}

function instantiate(text, scope) {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `'use strict';\nreturn (${text});`)(...names.map((n) => scope[n]));
}

/** runPostReservation's Node wiring (allocator, sink, authority with the fatal onViolation, op ledger) + the four real bindings. */
function nodeWorld() {
  const ledger = H.createEmptyErrorLedger();
  const state = { errorLedger: ledger };
  const runSeq = H.createRunSeqAllocator();
  const attribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const sink = H.createFatalEventSink(ledger, { nextSeq: runSeq.next });
  const violations = [];
  const authority = H.createRunAuthority({ allocator: runSeq, attribution, onViolation: (reason) => { violations.push(reason); sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });
  const clock = { nowIso: () => new Date().toISOString() };
  const ops = H.createOperationLedger({ ledger, nextSeq: runSeq.next, clock });
  const fatal = (kind, detail) => sink.recordFatal(kind, String(detail));
  const scope = {
    authority, fatal, ops, state, runSeq, sink, clock,
    responseRules: H.OPTIONAL_RESPONSE_RULES,
    prepareC1Gate: H.prepareC1Gate, provisionalFinalization: H.provisionalFinalization, syncFatalWitnesses: H.syncFatalWitnesses,
    isPageLocalOrdinal: H.isPageLocalOrdinal,
    isPlainObject: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    summarizeThrown: (err) => ({ name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err }),
  };
  const bindings = Object.fromEntries(BINDINGS.map((n) => [H[n], instantiate(bindingText(SOURCE, n), scope)]));
  return { ledger, state, runSeq, attribution, sink, authority, violations, ops, bindings };
}

const PAGE_EXPOSE = ['runChecksInPhaseOrder', 'g2NodeSync', 'g2NodeOps', 'g2MarkFatal', 'g2AgentReady', 'g2PageState', 'createPageOrdinalSource',
  'createCallRecorder', 'runAcknowledgedMutation', 'makeCheckRecord', 'makeControlRecord', 'PHASE_ORDER'];
const PAGE_BUNDLE = (() => {
  const src = H.buildPageAgentSource(SOURCE).source;
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  assert.equal(src.split(reg).length - 1, 1);
  return src.replace(reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
})();

function pageRealm() {
  const window = { addEventListener: () => {}, removeEventListener: () => {} };
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console });
  vm.runInContext(PAGE_BUNDLE, ctx);
  const t = window.__t;
  const g = t.g2PageState();
  const pageSeq = t.createPageOrdinalSource({ deliver: null });
  g.seq = pageSeq;
  const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
  t.g2AgentReady();
  return { window, t, g, recorder };
}

/** Delayed, JSON-serialising exposeFunction stand-in; per binding `delay`, `mapResult(r, ...args)` (may throw => the page call rejects). */
function connect(page, node, opts = {}) {
  for (const name of BINDINGS.map((n) => H[n])) {
    const o = opts[name] || {};
    const fn = node.bindings[name];
    page.window[name] = (...args) => (async () => {
      const a = clone(args);
      await sleep(o.delay ?? 1);
      let r = clone(fn(...a));
      if (o.mapResult) r = o.mapResult(r, ...a);
      return r;
    })();
  }
  node.setMirror = () => {};
}

/** Every unit PASSes except P9, whose C16 hide goes through runAcknowledgedMutation(requireOps) with the given descriptor. */
function drivers(page, desc) {
  const pass = () => page.t.makeCheckRecord({ verdict: 'PASS' });
  const ok = (n) => page.t.makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
  const d = {};
  for (const p of page.t.PHASE_ORDER) {
    d[p.id] = async (ctx) => {
      if (p.id === 'P9') {
        await ctx.beginCheck('C16');
        await page.t.runAcknowledgedMutation({ ops: page.t.g2NodeOps(), requireOps: true, desc, recorder: page.recorder, method: 'viewer.hideModel', args: [], invoke: () => { page.acted = true; } });
      }
      for (const n of ctx.runnable.controls) await ctx.beginControl(n);
      return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return d;
}

/**
 * g2RunPhases + runPostReservation's run-stage transfer: run -> drain fence -> JSON transfer -> reconcilePageFatals ->
 * rewritePageRun(stage run) -> applyPhaseRunToState -> assertAllocated. Returns {run, state} (authoritative).
 */
async function crossRealmRun({ desc = HIDE, opledger = {}, prepare = null } = {}) {
  const node = nodeWorld();
  if (prepare) prepare(node);
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_OPLEDGER_BINDING]: opledger });
  Object.assign(node.attribution, { phase: 'P1', activeCheck: null, activeControl: null });
  const sync = page.t.g2NodeSync();
  const out = await page.t.runChecksInPhaseOrder({ drivers: drivers(page, desc), mode: 'offline-fake', recorder: page.recorder, sync, fatalObserved: () => false });
  await sync.drain();
  const transferred = clone({ ...out, spyLedger: page.recorder.records, pageHighWater: page.g.seq.highWater(), pageFatalSent: page.g.pageFatalSent });
  node.authority.reconcilePageFatals(transferred.pageFatalSent);
  const run = node.authority.rewritePageRun(transferred, { stage: 'run' });
  const state = { checks: {}, controls: {}, errorLedger: node.ledger };
  H.applyPhaseRunToState(state, run);
  assert.deepEqual(node.authority.assertAllocated(H.maxRecordedSeq(state)), { ok: true });
  return { node, page, out, run, state };
}

/** The persisted R1 payload builder used by the live closeout (caps + redaction), over the authoritative state. */
function persisted(state) {
  return H.buildCappedResultPayload({ run: state, primaryOverall: 'FAIL', primaryRow: 1, optional: [], journalTransitions: [], finishedAt: '2026-10-02T00:00:00.000Z' });
}

function assertCrossRealm(w, expected, { violations }) {
  assert.equal(w.page.acted, undefined, 'the hide never ran');
  assert.equal(H.checkVerdictLabel(w.state.checks.C16), 'BLOCKED(harness-exception:P9)', 'generic summary unchanged');
  assert.equal(w.run.sessionTainted, true);
  assert.deepEqual(w.node.violations, violations, 'authoritative violations unchanged (no second one for the same root cause)');
  assert.equal(w.node.ledger.fatalCount, violations.length);
  // the authoritative state holds exactly one refusal event, Node-sequenced, attributed P9/C16
  const evs = w.state.eventLog.filter((e) => e.kind === KIND);
  assert.equal(evs.length, 1);
  const ev = evs[0];
  assert.ok(Number.isInteger(ev.seq) && ev.seq > 0 && ev.seq < BASE_ORD, 'authoritative seq from the single Node allocator');
  assert.ok(ev.seq <= w.node.runSeq.peek());
  assert.deepEqual([ev.phase, ev.activeCheck, ev.activeControl], ['P9', 'C16', null]);
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(ev[k], v, k);
  assert.match(ev.at, ISO_RE);
  // its ingested page ordinal is a labelled `event` (mandatory page evidence), and completeness holds
  const row = w.node.authority.provenance().find((p) => p.seq === ev.seq);
  assert.deepEqual([row.kind, row.label, row.phase, row.activeCheck, row.stage], ['event', KIND, 'P9', 'C16', 'run']);
  assert.deepEqual(w.node.authority.pageEvidenceProblems(w.state), []);
  assert.deepEqual(H.primarySeqAllocations(w.state).problems, []);
  // dropping the event from the authoritative state is detected (it cannot vanish silently)
  const dropped = { ...w.state, eventLog: w.state.eventLog.filter((e) => e !== ev) };
  assert.deepEqual(w.node.authority.pageEvidenceProblems(dropped), [`page-evidence-missing:event:${ev.seq}`]);
  // the page-side phaseLog (not retained) still only has the generic message; the persisted payload has the detail
  const p = persisted(w.state);
  const pe = p.eventLog.filter((e) => e.kind === KIND);
  assert.deepEqual(pe, [ev], 'the exact detail survives into the persisted R1 payload');
  assert.equal(p.checks.C16.reason, 'harness-exception:P9');
  return ev;
}

test('cross-realm: explicit Node refusal (stale descriptor phase P8 during P9) => ONE op-begin-refused violation + ONE refusal event (sourceRealm node), seq after the violation, persisted', async () => {
  const w = await crossRealmRun({ desc: { ...HIDE, phase: 'P8' } });
  const ev = assertCrossRealm(w, { category: 'refused', sourceRealm: 'node', reason: 'phase-mismatch', operationType: 'hide', modelId: 'B', operationPhase: 'P8', invokedBy: 'C16', error: null }, { violations: ['op-begin-refused:phase-mismatch'] });
  const fatal = w.node.ledger.entries.find((e) => e.detail === 'cross-realm-fence:op-begin-refused:phase-mismatch');
  assert.ok(fatal.seq < ev.seq, 'the Node violation precedes the page event in authoritative order (correlated by reason + attribution)');
  assert.equal(w.node.ledger.opLedger.filter((o) => o.recordType === 'mutation').length, 0, 'no operation record');
});

test('cross-realm: a DELAYED Node refusal (sealed ledger behind a slow binding) => ONE op-begin-refused:sealed violation + one persisted event; control: the same slow binding unsealed => the hide runs, no event', async () => {
  const w = await crossRealmRun({ opledger: { delay: 25 }, prepare: (node) => node.ops.seal() });
  assertCrossRealm(w, { category: 'refused', sourceRealm: 'node', reason: 'sealed', ...HIDE_FIELDS }, { violations: ['op-begin-refused:sealed'] });
  const ok = await crossRealmRun({ opledger: { delay: 25 } });
  assert.equal(ok.page.acted, true);
  assert.equal(ok.state.eventLog.filter((e) => e.kind === KIND).length, 0);
  assert.deepEqual(ok.node.violations, []);
  assert.equal(ok.state.checks.C16.verdict, 'PASS');
});

test('cross-realm: a page-observed failure (binding call REJECTS / MALFORMED answer / EMPTY id) => no Node violation added, one refusal event (sourceRealm page), persisted', async () => {
  const threw = await crossRealmRun({ opledger: { mapResult: (r, action) => { if (action === 'begin') throw new Error('Execution context was destroyed'); return r; } } });
  assertCrossRealm(threw, { category: 'begin-threw', sourceRealm: 'page', reason: null, error: { name: 'Error', message: 'Execution context was destroyed' }, ...HIDE_FIELDS }, { violations: [] });
  const malformed = await crossRealmRun({ opledger: { mapResult: (r, action) => (action === 'begin' ? { ok: true } : r) } });
  assertCrossRealm(malformed, { category: 'malformed-response', sourceRealm: 'page', response: '{"ok":true}', operationId: null }, { violations: [] });
  const empty = await crossRealmRun({ opledger: { mapResult: (r, action) => (action === 'begin' ? { ...r, operationId: '' } : r) } });
  assertCrossRealm(empty, { category: 'empty-operation-id', sourceRealm: 'page', operationId: '' }, { violations: [] });
});

// ------------------------------------------------------------------------------------------
// Closeout: the detail survives closeoutProtocol into the persisted R1 (recording fake fs)
// ------------------------------------------------------------------------------------------

test('closeout: the refusal event survives closeoutProtocol (buildCappedResultPayload) into the persisted R1 verbatim, next to the ONE Node violation; the attempt is never PASS', async () => {
  const CHAIN = H.resolveAttemptsChain('/repo');
  const fs = H.createRecordingFakeFs({ seedDirs: ['/repo/test/acceptance'] });
  const { handle, binding } = H.createOfflineAttemptFixture({ fs, chain: CHAIN });
  const state = H.createOfflineRunStateFixture({ binding });
  let seq = H.maxRecordedSeq(state);
  const next = () => { seq += 1; return seq; };
  const sink = H.createFatalEventSink(state.errorLedger, { nextSeq: next });
  // Node: the single authoritative violation of an explicit refusal (createRunAuthority.refuseOperation's fatal entry)
  sink.recordFatal('harness-exception', 'cross-realm-fence:op-begin-refused:phase-mismatch');
  // page: the blocked C16 hide's refusal event, Node-sequenced after the violation (the next fence)
  const r = await blockedRun({ ops: fakeOps({ ok: false, reason: 'phase-mismatch' }) });
  const ev = { ...clone(r.events[0]), seq: next() };
  state.eventLog = [...state.eventLog, ev];
  state.checks.C16 = H.makeCheckRecord({ verdict: 'BLOCKED', reason: 'harness-exception:P9' });
  const out = await H.closeoutProtocol({ state, handle, fs, chain: CHAIN, sink, commitFs: { linkSync: H.brandSyncLinkForTest((a, b) => fs.link(a, b)) }, allowTestLinkPrimitive: true, buildPayload: H.buildCappedResultPayload });
  assert.notEqual(out.finalOverall, 'PASS');
  const map = H.readArtifactFileMap({ fs: fs.processCrashView(), chain: CHAIN });
  const r1 = JSON.parse(map.results[H.R1_NAME].toString('utf8'));
  assert.deepEqual(r1.eventLog.filter((e) => e.kind === KIND), [ev], 'exact detail persisted');
  assert.deepEqual(r1.errorLedger.entries.filter((e) => /op-begin-refused/.test(String(e.detail))).map((e) => e.detail), ['cross-realm-fence:op-begin-refused:phase-mismatch'], 'still exactly one violation');
  assert.equal(r1.checks.C16.reason, 'harness-exception:P9', 'the generic summary stays');
  assert.deepEqual([ev.category, ev.sourceRealm, ev.reason, ev.operationType, ev.invokedBy, ev.phase, ev.activeCheck], ['refused', 'node', 'phase-mismatch', 'hide', 'C16', 'P9', 'C16']);
});
