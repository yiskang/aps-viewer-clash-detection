// test/acceptance/clashpanel-viewerbridge.acceptance.crossrealm.test.mjs
//
// Offline tests for the G2 cross-realm sequencing / attribution contract (review H1 / H2):
//
//  H1  ONE authoritative Node-side allocator (`createRunSeqAllocator`). The page keeps only a
//      NON-authoritative local ordinal (`createPageOrdinalSource`, values > PAGE_LOCAL_BASE) that the
//      Node authority (`createRunAuthority`) INGESTS -- at the awaited fences (attribution, operation
//      begin/end, C1 gate, drain) and through the early best-effort ingest binding -- allocating the
//      authoritative seq at ingestion. Authoritative order = Node ingestion order; no composite or
//      second namespace survives into authoritative state (`rewritePageRun`, `page-ordinal-leaked`).
//      Node-authoritative phase/check/control attribution is delivered through the awaited
//      `G2_NODE_SYNC_BINDING` fence (`syncPage`), so a C16 hide abort is attributed to P9 / EC-hide, a
//      C17 unload abort to P9 / EC-unload and a cleanup teardown abort to cleanup / EC-teardown instead
//      of a stale-P1 fatal; a refused fence throws in the page before the attributed action.
//  H2  the C1 gate prepared synchronously by Node on the AUTHORITATIVE error ledger (never on the
//      asynchronous page fatal mirror), C1's page ordinal translated to its authoritative seq first,
//      plus the page-origin fatal id reconciliation.
//
// The cross-realm flows use the REAL page agent bundle (`buildPageAgentSource`, loaded in a node:vm
// context like pageagent.test.mjs) for the page half (`runChecksInPhaseOrder`, `g2NodeSync`,
// `g2NodeOps`, `g2FenceReport`, `runAcknowledgedMutation`, `g2AgentReady` fatal forwarding,
// `g2MarkFatal`, `createPageOrdinalSource`) and the REAL Node binding bodies, sliced verbatim out of
// `runPostReservation`'s source and instantiated over the same Node objects `runPostReservation` builds
// (sink, run allocator, authority, network instrumentation, operation ledger). The page<->Node channel
// is an artificially DELAYED, JSON-serialising stand-in for Playwright's exposeFunction (the real
// Playwright binding test lives in its own file). Non-vacuity: the guarded behaviours are re-run against
// MUTATED COPIES of the harness source (tmp sandbox, as mainflow.test.mjs does) or of the sliced binding
// text and shown to fail. Nothing here imports playwright, launches a browser or touches the network; the
// real harness keeps LIVE_PATH_WIRED=false and G2_DUAL_COUNTER_GATE.resolved=false.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const BASE_ORD = H.PAGE_LOCAL_BASE;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const P1 = Object.freeze({ phase: 'P1', activeCheck: null, activeControl: null });

// ------------------------------------------------------------------------------------------
// Mutated copies (tmp sandbox; the real harness is never edited)
// ------------------------------------------------------------------------------------------

const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-crossrealm-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });
let mutationCount = 0;

/** Applies exact single-occurrence replacements to `source`. */
function mutate(source, pairs) {
  let s = source;
  for (const [from, to] of pairs) {
    assert.equal(s.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
    s = s.replace(from, () => to);
  }
  assert.notEqual(s, source);
  return s;
}

async function importMutated(pairs) {
  const src = mutate(SOURCE, pairs);
  mutationCount += 1;
  const dir = path.join(SANDBOX, String(mutationCount));
  mkdirSync(dir);
  const file = path.join(dir, 'clashpanel-viewerbridge.acceptance.mjs');
  writeFileSync(file, src);
  return import(pathToFileURL(file).href);
}

// ------------------------------------------------------------------------------------------
// The REAL Node binding bodies, sliced out of runPostReservation
// ------------------------------------------------------------------------------------------

const RPR = (() => { const { start, end } = H.locateFunctionSource(SOURCE, 'runPostReservation'); return { start, end }; })();

/** The function passed to `live.page.exposeFunction(<name>, ...)` inside runPostReservation (block or one-line arrow). */
function bindingText(source, name) {
  const head = `await live.page.exposeFunction(${name}, `;
  assert.equal(source.split(head).length - 1, 1, `exactly one exposeFunction(${name})`);
  const i = source.indexOf(head);
  const eol = source.indexOf('\n', i);
  const first = source.slice(i, eol);
  if (first.endsWith('{')) {
    const j = source.indexOf('\n      });', i);
    assert.ok(i !== -1 && j > i);
    return { text: source.slice(i + head.length, j + '\n      }'.length), at: i };
  }
  assert.ok(first.endsWith(');'), `${name}: one-line binding ends with ');'`);
  return { text: first.slice(head.length, -2), at: i };
}

function instantiate(text, scope) {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `'use strict';\nreturn (${text});`)(...names.map((n) => scope[n]));
}

const BINDINGS = Object.freeze(['G2_NODE_FATAL_BINDING', 'G2_NODE_INGEST_BINDING', 'G2_NODE_OPLEDGER_BINDING', 'G2_NODE_SYNC_BINDING']);

// Exact runPostReservation lines this file's Node world reproduces (asserted below, so the world
// cannot silently drift from the harness).
const RPR_LINES = Object.freeze([
  'const runSeq = createRunSeqAllocator();',
  "const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };",
  'const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });',
  "const authority = createRunAuthority({ allocator: runSeq, attribution: nodeAttribution, onViolation: (reason) => { sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });",
  'ledger: state.errorLedger, nextSeq: runSeq.next, sink, baseUrl, rules: responseRules,',
  'attribution: () => ({ ...nodeAttribution }),',
  'const ops = createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock });',
  "Object.assign(nodeAttribution, { phase: 'P1', activeCheck: null, activeControl: null });",
  'authority.reconcilePageFatals(runOut.value.pageFatalSent);',
  "const run = authority.rewritePageRun(runOut.value, { stage: 'run' });",
  'applyPhaseRunToState(state, run);',
  "Object.assign(nodeAttribution, { phase: 'cleanup', activeCheck: null });",
]);
// g2BuildEnv's page recorder wiring (reproduced by pageRealm below).
const ENV_LINES = Object.freeze([
  'const ingestFn = window[G2_NODE_INGEST_BINDING];',
  "const pageSeq = createPageOrdinalSource({ deliver: typeof ingestFn === 'function' ? (entry) => { Promise.resolve(ingestFn(entry)).catch(() => {}); } : null });",
  'g.seq = pageSeq;',
  'const recorder = createCallRecorder({ nextSeq: pageSeq.next });',
]);

// ------------------------------------------------------------------------------------------
// Node world (mirrors runPostReservation's wiring) + network fakes
// ------------------------------------------------------------------------------------------

const BASE = 'http://localhost:8080';
const CDN = 'https://cdn.derivative.invalid';
const PREFIX_A = `${CDN}/modelA/output/0`;
const PREFIX_B = `${CDN}/modelB/output/0`;
const URN_SHA = H.sha256Hex('urn:test');

function fakeRequest({ url = `${PREFIX_B}/stream.bin`, method = 'GET', resourceType = 'fetch', nav = false, errorText = 'net::ERR_ABORTED' } = {}) {
  return { url: () => url, method: () => method, resourceType: () => resourceType, isNavigationRequest: () => nav, failure: () => ({ errorText }), redirectedFrom: () => null, frame: () => 'main' };
}

/** A passive tap over THE run allocator: records every value it hands out (the allocator itself is unchanged). */
function tappedAllocator(M) {
  const inner = M.createRunSeqAllocator();
  const log = [];
  return { log, allocator: { next: () => { const s = inner.next(); log.push(s); return s; }, peek: () => inner.peek() } };
}

function nodeWorld({ M = H, bindingSource = SOURCE, mirrorDelayMs = 5 } = {}) {
  const ledger = M.createEmptyErrorLedger();
  const state = { errorLedger: ledger };
  const { log: allocLog, allocator: runSeq } = tappedAllocator(M);
  const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const sink = M.createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });
  const violations = [];
  const authority = M.createRunAuthority({ allocator: runSeq, attribution: nodeAttribution, onViolation: (reason) => { violations.push(reason); sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });
  let mirror = null; // the page's g2MarkFatal (Node -> page rpc, asynchronous)
  const mirrorCalls = [];
  const mirrorToPage = (arg) => { mirrorCalls.push(arg); if (mirror) setTimeout(() => mirror(arg), mirrorDelayMs); };
  const clock = { nowIso: () => new Date().toISOString() };
  const net = M.createNetworkInstrumentation({
    ledger: state.errorLedger, nextSeq: runSeq.next, sink, baseUrl: BASE, rules: M.OPTIONAL_RESPONSE_RULES,
    attribution: () => ({ ...nodeAttribution }), mainFrame: () => 'main',
    onFatalWitness: () => mirrorToPage({ kind: M.NETWORK_FATAL_ENTRY_KIND }),
  });
  const ops = M.createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock });
  // runPostReservation's `fatal`: record on the Node ledger, then mirror into the page latch (g2MarkFatal).
  const fatal = (kind, detail) => { const recorded = sink.recordFatal(kind, String(detail)); if (recorded) mirrorToPage({ kind }); return recorded; };
  const em = new EventEmitter();
  const page = { on: (e, f) => em.on(e, f), off: (e, f) => em.off(e, f) };
  M.wireFatalListeners({ page, browser: null, live: { closingIntent: false }, fatal, network: net });
  const scope = {
    authority, fatal, ops, state, runSeq, sink, clock,
    responseRules: M.OPTIONAL_RESPONSE_RULES,
    prepareC1Gate: M.prepareC1Gate, provisionalFinalization: M.provisionalFinalization, syncFatalWitnesses: M.syncFatalWitnesses,
    isPageLocalOrdinal: M.isPageLocalOrdinal,
    isPlainObject: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), // same body as the harness's
    summarizeThrown: (err) => ({ name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err }),
  };
  const bindings = Object.fromEntries(BINDINGS.map((n) => [M[n], instantiate(bindingText(bindingSource, n).text, scope)]));
  const w = {
    M, ledger, state, runSeq, allocLog, attribution: nodeAttribution, sink, authority, violations, net, ops, bindings, mirrorCalls,
    setMirror: (fn) => { mirror = fn; },
    emit: (ev, x) => em.emit(ev, x),
    request: (r) => em.emit('request', r),
    respond: (r, status) => em.emit('response', { status: () => status, request: () => r }),
    finish: (r) => em.emit('requestfinished', r),
    fail: (r) => em.emit('requestfailed', r),
    ok: (url) => { const r = fakeRequest({ url }); w.request(r); w.respond(r, 200); w.finish(r); return r; },
    /** Pre-run: loads A then B (finished 2xx evidence) and closes the load windows => unique prefix binding. */
    loads: () => {
      const LA = ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA });
      w.ok(`${PREFIX_A}/a.bin`);
      ops.endLoad(LA, 'ready');
      const LB = ops.beginLoad({ modelId: 'B', modelUrnSha256: URN_SHA });
      w.ok(`${PREFIX_B}/b.bin`);
      ops.endLoad(LB, 'ready');
      const fin = M.finalizeLoadWindows(ledger, { prefixSources: net.prefixSources, appendEntry: (x) => sink.recordWitnessEntry(x), rules: M.OPTIONAL_RESPONSE_RULES });
      assert.equal(fin.finalized, true);
      assert.equal(ledger.prefixDerivation.bindingAvailable, true);
    },
  };
  return w;
}

// ------------------------------------------------------------------------------------------
// Page realm: the REAL page-agent bundle in a node:vm context
// ------------------------------------------------------------------------------------------

const PAGE_EXPOSE = ['runChecksInPhaseOrder', 'g2NodeSync', 'g2NodeOps', 'g2MarkFatal', 'g2AgentReady', 'g2PageState', 'g2FenceReport', 'createPageOrdinalSource',
  'createCallRecorder', 'runAcknowledgedMutation', 'makeCheckRecord', 'makeControlRecord', 'PHASE_ORDER'];
const exposeBundle = (src) => {
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  assert.equal(src.split(reg).length - 1, 1);
  return src.replace(reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
};
const PAGE_BUNDLE = exposeBundle(H.buildPageAgentSource(SOURCE).source);

function pageRealm({ bundle = PAGE_BUNDLE, early = true } = {}) {
  const listeners = {};
  const window = { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, removeEventListener: () => {} };
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console });
  vm.runInContext(bundle, ctx);
  const t = window.__t;
  const g = t.g2PageState();
  // As g2BuildEnv (ENV_LINES): the recorder draws NON-authoritative page ordinals; the early best-effort
  // hint goes through G2_NODE_INGEST_BINDING when it is connected.
  const deliver = early ? (entry) => { const fn = window[H.G2_NODE_INGEST_BINDING]; if (typeof fn === 'function') Promise.resolve(fn(entry)).catch(() => {}); } : null;
  const pageSeq = t.createPageOrdinalSource({ deliver });
  g.seq = pageSeq;
  const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
  t.g2AgentReady(); // installs the page-origin fatal forwarding (unhandledrejection)
  return {
    window, t, g, pageSeq, recorder,
    /** A page-origin fatal (forwarded to G2_NODE_FATAL_BINDING with {id, hw, pending}). */
    pageFatal: (msg) => { for (const f of listeners.unhandledrejection || []) f({ reason: new Error(msg) }); },
  };
}

/**
 * Connects the page to the Node bindings over a delayed, JSON-serialising channel (Playwright
 * exposeFunction stand-in). Per binding: `delay` (ms), `before(...args)` (runs at Node delivery, before
 * the binding), `after(result, ...args)`, `tamper(args)` (mutates the delivered args), `mapResult`,
 * `drop(...args)` (true => the call never reaches Node; the page promise never settles, like a lost
 * transfer), `absent`.
 */
function connect(page, node, opts = {}) {
  for (const name of BINDINGS.map((n) => H[n])) {
    const o = opts[name] || {};
    if (o.absent) continue;
    const fn = node.bindings[name];
    page.window[name] = (...args) => {
      const a = clone(args);
      if (o.drop && o.drop(...a)) return new Promise(() => {});
      return (async () => {
        await sleep(o.delay ?? 2);
        if (o.tamper) o.tamper(a);
        if (o.before) o.before(...a);
        let r = clone(fn(...a));
        if (o.mapResult) r = o.mapResult(r, ...a);
        if (o.after) o.after(r, ...a);
        return r;
      })();
    };
  }
  node.setMirror((arg) => page.t.g2MarkFatal(arg));
}

/** Fake phase drivers on the page realm: every runnable unit PASSes; `overrides[phaseId](ctx, pass, ok)`. */
function drivers(page, overrides = {}) {
  const pass = () => page.t.makeCheckRecord({ verdict: 'PASS' });
  const ok = (n) => page.t.makeControlRecord(n, { N1: 'DETECTED', N6: 'DETECTED', N8: 'DETECTED' }[n] || 'DETECTED_RESTORED');
  const d = {};
  for (const p of page.t.PHASE_ORDER) {
    d[p.id] = async (ctx) => {
      if (overrides[p.id]) return overrides[p.id](ctx, pass, ok);
      for (const n of ctx.runnable.controls) await ctx.beginControl(n);
      return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return d;
}

/**
 * g2RunPhases + runPostReservation's final transfer (offline-fake mode; sync from the real g2NodeSync()):
 * run -> drain fence -> JSON transfer {..., spyLedger, pageHighWater, pageFatalSent} -> reconcilePageFatals
 * -> rewritePageRun -> assertAllocated. Returns the REWRITTEN (authoritative) run.
 */
async function runPage(page, node, { drv, errorLedger, drainMs = 0, beforeFinal = null } = {}) {
  Object.assign(node.attribution, { phase: 'P1', activeCheck: null, activeControl: null });
  const sync = page.t.g2NodeSync();
  const run = await page.t.runChecksInPhaseOrder({
    drivers: drv, mode: 'offline-fake', recorder: page.recorder, sync,
    fatalObserved: () => page.g.fatal.flag === true || page.g.fatal.abort === true,
    ...(errorLedger !== undefined ? { errorLedger } : {}),
  });
  if (beforeFinal) await beforeFinal();
  if (drainMs) await sleep(drainMs);
  if (sync) await sync.drain();
  const transferred = clone({ ...run, spyLedger: page.recorder.records, pageHighWater: page.g.seq.highWater(), pageFatalSent: page.g.pageFatalSent });
  node.authority.reconcilePageFatals(transferred.pageFatalSent);
  const rewritten = node.authority.rewritePageRun(transferred);
  // applyPhaseRunToState: the run's markers join the Node ledger's (P0 + P1..P11 + cleanup), so later
  // cleanup-time classification sees the cleanup marker exactly as in runPostReservation.
  if (Array.isArray(rewritten.markers)) node.ledger.markers.push(...clone(rewritten.markers));
  node.authority.assertAllocated(H.maxRecordedSeq(seqStateOf(node, rewritten)));
  return rewritten;
}

/**
 * The P9 driver: C16 hide (a request in flight when the acknowledged hide starts is aborted by it), then
 * -- when `unload` -- C17 unload with its own in-flight request aborted by the acknowledged unload.
 */
function p9Driver(page, node, seen, { unload = false } = {}) {
  return async (ctx, pass, ok) => {
    await ctx.beginCheck('C16');
    seen.attrC16 = { ...node.attribution };
    const r = fakeRequest({ url: `${PREFIX_B}/stream.bin` });
    node.request(r);
    await page.t.runAcknowledgedMutation({
      ops: page.t.g2NodeOps(), desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' },
      recorder: page.recorder, method: 'viewer.hideModel', args: [],
      invoke: () => { node.fail(r); },
    });
    await ctx.beginCheck('C17');
    seen.attrC17 = { ...node.attribution };
    if (unload) {
      const r2 = fakeRequest({ url: `${PREFIX_B}/stream-2.bin` });
      node.request(r2);
      await page.t.runAcknowledgedMutation({
        ops: page.t.g2NodeOps(), desc: { operationType: 'unload', modelId: 'B', phase: 'P9', invokedBy: 'C17' },
        recorder: page.recorder, method: 'viewer.unloadModel', args: [],
        invoke: () => { node.fail(r2); },
      });
    }
    for (const n of ctx.runnable.controls) await ctx.beginControl(n);
    return { checks: { C16: pass(), C17: pass() }, controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
  };
}

function seqStateOf(node, run) {
  return {
    errorLedger: { ...node.ledger, markers: [...node.ledger.markers] }, // run markers already applied by runPage
    spyLedger: clone(run.spyLedger || []), eventLog: clone(run.eventLog || []), gates: clone(run.gates), checks: clone(run.checks), controls: clone(run.controls),
  };
}

/**
 * The single-namespace invariant over a finished world: (1) the run allocator handed out exactly
 * 1..peek, in order (one counter, no gaps, no second source); (2) every ingested page ordinal received
 * a seq from THAT allocator, ingested seqs ascend with the ordinals (ingestion order); (3) every
 * authoritative seq in the state is an allocator value below PAGE_LOCAL_BASE (no page ordinal, no
 * composite major); (4) primarySeqAllocations finds no collision / leak.
 */
function singleNamespaceProblems(node, state) {
  const problems = [];
  const peek = node.runSeq.peek();
  if (node.allocLog.length !== peek || node.allocLog.some((s, i) => s !== i + 1)) problems.push('allocator-not-1..peek');
  const allocated = new Set(node.allocLog);
  const ing = node.authority.ingested();
  for (const e of ing) {
    if (!allocated.has(e.seq)) problems.push(`ingested-not-allocated:${e.seq}`);
    if (e.realm !== 'page' || !H.isPageLocalOrdinal(e.ord)) problems.push(`ingested-shape:${e.seq}`);
  }
  for (let i = 1; i < ing.length; i += 1) if (!(ing[i].seq > ing[i - 1].seq && ing[i].ord === ing[i - 1].ord + 1)) problems.push(`ingestion-order:${i}`);
  if (state) {
    const { seqs, problems: p } = H.primarySeqAllocations(state);
    for (const { seq, label } of seqs) {
      if (!allocated.has(seq)) problems.push(`state-seq-not-allocated:${seq}:${label}`);
      if (seq >= BASE_ORD) problems.push(`state-seq-above-base:${seq}:${label}`);
    }
    problems.push(...p);
  }
  return problems;
}

// ==========================================================================================
// Static: the world above is bound to the harness text; dormancy unchanged; composite API gone
// ==========================================================================================

test('static: Node world lines, g2BuildEnv recorder lines and the four binding bodies are the harness\'s own; final transfer order; live stays dormant', () => {
  const body = SOURCE.slice(RPR.start, RPR.end);
  for (const line of RPR_LINES) assert.equal(body.split(line).length - 1, 1, line);
  const env = H.locateFunctionSource(SOURCE, 'g2BuildEnv');
  const envBody = SOURCE.slice(env.start, env.end);
  for (const line of ENV_LINES) assert.equal(envBody.split(line).length - 1, 1, line);
  for (const n of BINDINGS) {
    const { at } = bindingText(SOURCE, n);
    assert.ok(at > RPR.start && at < RPR.end, `${n} is exposed inside runPostReservation`);
  }
  // final transfer: reconcile -> rewrite -> apply -> assertAllocated (twice: final transfer + before the closeout marker)
  const assertLine = 'authority.assertAllocated(maxRecordedSeq(state));';
  assert.equal(body.split(assertLine).length - 1, 2);
  const iRec = body.indexOf('authority.reconcilePageFatals(runOut.value.pageFatalSent);');
  const iRw = body.indexOf("const run = authority.rewritePageRun(runOut.value, { stage: 'run' });");
  const iApply = body.indexOf('applyPhaseRunToState(state, run);');
  const iAssert = body.indexOf(assertLine);
  const iClose = body.indexOf("state.errorLedger.markers.push({ seq: runSeq.next(), name: 'closeout' });");
  assert.ok(iRec < iRw && iRw < iApply && iApply < iAssert && body.indexOf(assertLine, iAssert + 1) < iClose);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, false);
  assert.deepEqual([H.G2_NODE_SYNC_BINDING, H.G2_NODE_INGEST_BINDING], ['__g2NodeSync', '__g2NodeIngest']);
  assert.equal(BASE_ORD, 2 ** 50);
  for (const removed of ['SEQ_STRIDE', 'SEQ_MINOR_RESERVED', 'realmOfSeq', 'createRunSeqCounter', 'createPageSeqSource']) assert.equal(removed in H, false, `${removed} is no longer exported`);
});

// ==========================================================================================
// H1 -- the single Node allocator and the non-authoritative page ordinal
// ==========================================================================================

test('H1: the run allocator hands out 1,2,3... (peek = last); page ordinals are > PAGE_LOCAL_BASE, queued with their attribution/kind, early-delivered, pruned only by ack', () => {
  const a = H.createRunSeqAllocator();
  assert.equal(a.peek(), 0);
  assert.deepEqual([a.next(), a.next(), a.next(), a.peek()], [1, 2, 3, 3]);
  const delivered = [];
  const src = H.createPageOrdinalSource({ deliver: (e) => { delivered.push(e); throw new Error('a throwing hint is ignored'); } });
  assert.equal(src.highWater(), BASE_ORD);
  const o1 = src.next({ phase: 'P2', activeCheck: null, activeControl: 'N1' }, 'control-start');
  const o2 = src.next(undefined, 7);
  assert.deepEqual([o1, o2, src.highWater()], [BASE_ORD + 1, BASE_ORD + 2, BASE_ORD + 2]);
  assert.ok(H.isPageLocalOrdinal(o1) && !H.isPageLocalOrdinal(BASE_ORD) && !H.isPageLocalOrdinal(3) && !H.isPageLocalOrdinal(o1 + 0.5));
  assert.deepEqual(src.pending(), [
    { ord: o1, kind: 'control-start', phase: 'P2', activeCheck: null, activeControl: 'N1', label: null },
    { ord: o2, kind: 'alloc', phase: 'P0', activeCheck: null, activeControl: null, label: null },
  ]);
  assert.deepEqual(delivered, src.pending());
  src.pending()[0].ord = 1; // pending() hands out copies
  assert.equal(src.pending()[0].ord, o1);
  src.ack(o1);
  assert.deepEqual(src.pending().map((e) => e.ord), [o2]);
  src.ack(o2);
  assert.deepEqual(src.pending(), []);
  // the page recorder passes its attribution context and the allocation kind through to the ordinal source
  const src2 = H.createPageOrdinalSource();
  const rec = H.createCallRecorder({ nextSeq: src2.next });
  rec.setAttribution({ phase: 'P9', activeCheck: 'C16', activeControl: null });
  const r = rec.withOrigin('harness', () => rec.record('viewer.hideModel', []));
  assert.equal(r.seq, BASE_ORD + 1);
  assert.deepEqual(src2.pending(), [{ ord: BASE_ORD + 1, kind: src2.pending()[0].kind, phase: 'P9', activeCheck: 'C16', activeControl: null, label: null }]);
  // an event's ordinal carries the event's own kind as its registered label (cleanup provenance identity check)
  const ev = rec.logEvent('wrapper-restore', { x: 1 });
  const evEntry = src2.pending().find((e) => e.ord === ev.seq);
  assert.deepEqual(evEntry, { ord: ev.seq, kind: 'event', phase: 'P9', activeCheck: 'C16', activeControl: null, label: 'wrapper-restore' });
  assert.equal(src2.next({ phase: 'P0' }, 'event', 7) > 0 && src2.pending().at(-1).label, null, 'a non-string label is normalised to null at the source');
});

test('H1: page ordinal labels (string|null): a non-string label is ingest-entry-invalid on a fence (one violation, nothing ingested) and deferred on the early path; an idempotent resend with a changed label is ingest-conflict', () => {
  const mk = () => { const w = authorityWorld(); w.src.next({ ...P1 }, 'event', 'wrapper-restore'); w.src.next({ ...P1 }, 'spy'); return w; };
  for (const bad of [7, {}, [], true, false]) {
    const w = mk();
    const r = w.authority.ingestFence({ pending: w.src.pending().map((e) => ({ ...e, label: bad })), hw: w.src.highWater() });
    assert.deepEqual(r, { ok: false, reason: 'ingest-entry-invalid' }, JSON.stringify(bad));
    assert.deepEqual(w.violations, ['ingest-entry-invalid']);
    assert.deepEqual(w.authority.ingested(), []);
    const w2 = mk();
    assert.deepEqual(w2.authority.ingestEarly(w2.src.pending().map((e) => ({ ...e, label: bad }))), { ok: true, count: 0, deferred: true, reason: 'ingest-entry-invalid' });
    assert.deepEqual(w2.violations, [], 'early path never violates');
    assert.deepEqual(w2.authority.ingested(), []);
  }
  // string / null / absent are valid; absent normalises to null
  const w = mk();
  const [a, b] = w.src.pending();
  const { label: _dropped, ...bNoLabel } = b;
  assert.equal(w.authority.ingestFence({ pending: [a, bNoLabel], hw: b.ord }).ok, true);
  assert.deepEqual(w.authority.ingested().map((r) => r.label), ['wrapper-restore', null]);
  assert.deepEqual(w.violations, []);
  assert.equal(w.authority.ingestFence({ pending: [a, b], hw: b.ord }).ok, true, 'identical resend (absent == null) is idempotent');
  // a changed label on an already-ingested ordinal is a conflict (event string->other, spy null->string)
  for (const [x, y] of [[{ ...a, label: 'other' }, b], [a, { ...b, label: 'now-set' }]]) {
    const w3 = authorityWorld();
    assert.equal(w3.authority.ingestFence({ pending: [a, b], hw: b.ord }).ok, true);
    assert.deepEqual(w3.authority.ingestFence({ pending: [x, y], hw: b.ord }), { ok: false, reason: 'ingest-conflict' });
    assert.deepEqual(w3.violations, ['ingest-conflict']);
    assert.equal(w3.authority.ingested().length, 2, 'nothing new ingested');
  }
});

test('H1: an `event`-kind ordinal MUST carry a non-empty string label (the event kind): unlabeled (null / absent / empty) is ingest-entry-invalid on a fence (one violation, nothing ingested) and deferred early; spy/alloc may stay unlabeled; string->null on an ingested event is refused', () => {
  const mk = () => { const w = authorityWorld(); w.src.next({ ...P1 }, 'event', 'wrapper-restore'); w.src.next({ ...P1 }, 'spy'); return w; };
  for (const bad of [null, undefined, '']) {
    const strip = (e) => { const { label: _l, ...rest } = e; return bad === undefined ? rest : { ...rest, label: bad }; };
    const w = mk();
    assert.deepEqual(w.authority.ingestFence({ pending: w.src.pending().map((e) => (e.kind === 'event' ? strip(e) : e)), hw: w.src.highWater() }), { ok: false, reason: 'ingest-entry-invalid' }, String(bad));
    assert.deepEqual(w.violations, ['ingest-entry-invalid']);
    assert.deepEqual(w.authority.ingested(), [], 'atomic: the valid spy in the same batch is not ingested either');
    const w2 = mk();
    assert.deepEqual(w2.authority.ingestEarly(w2.src.pending().map((e) => (e.kind === 'event' ? strip(e) : e))), { ok: true, count: 0, deferred: true, reason: 'ingest-entry-invalid' });
    assert.deepEqual(w2.violations, [], 'early path never violates');
    assert.deepEqual(w2.authority.ingested(), []);
  }
  // a labelled event + unlabeled spy/alloc/snapshot kinds are accepted
  const w = mk();
  w.src.next({ ...P1 }, 'alloc');
  assert.equal(w.authority.ingestFence({ pending: w.src.pending(), hw: w.src.highWater() }).ok, true);
  assert.deepEqual(w.authority.ingested().map((r) => [r.kind, r.label]), [['event', 'wrapper-restore'], ['spy', null], ['alloc', null]]);
});

function authorityWorld(M = H, attribution = { ...P1 }) {
  const { log, allocator } = tappedAllocator(M);
  const violations = [];
  const attr = attribution;
  const authority = M.createRunAuthority({ allocator, attribution: attr, onViolation: (r) => violations.push(r) });
  const src = M.createPageOrdinalSource();
  const report = (extra = {}) => ({ pending: src.pending(), hw: src.highWater(), ...extra });
  return { M, allocLog: log, runSeq: allocator, attribution: attr, violations, authority, src, report };
}

test('H1: interleaved Node-origin and page-origin events (randomised, seeded; fences + out-of-order early hints) share ONE namespace: unique, 1..peek, strictly monotone in ingestion order; a fence orders every earlier page event before every later Node event', () => {
  let x = 0x2545f491;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  for (let trial = 0; trial < 25; trial += 1) {
    const w = authorityWorld();
    const order = []; // authoritative allocations in the order they happen: {seq, realm, ord?}
    const nodeEvent = () => { const s = w.runSeq.next(); order.push({ seq: s, realm: 'node' }); return s; };
    const ingested = () => w.authority.ingested().length;
    const take = (fn) => { const n0 = ingested(); fn(); for (const e of w.authority.ingested().slice(n0)) order.push({ seq: e.seq, realm: 'page', ord: e.ord }); };
    for (let i = 0; i < 3; i += 1) nodeEvent();
    for (let i = 0; i < 300; i += 1) {
      const r = rnd();
      if (r < 0.35) w.src.next({ ...P1 }, 'spy');
      else if (r < 0.5) {
        // early hint: a random unacknowledged entry (gaps are deferred, never a violation)
        const p = w.src.pending();
        if (p.length) take(() => assert.equal(w.authority.ingestEarly([p[Math.floor(rnd() * p.length)]]).ok, true));
      } else if (r < 0.65) {
        const rep = w.report();
        const beforeFence = rep.hw;
        take(() => assert.equal(w.authority.ingestFence(rep).ok, true));
        w.src.ack(rep.hw);
        assert.equal(w.authority.lastOrdinal(), beforeFence);
        const s = nodeEvent();
        for (let o = BASE_ORD + 1; o <= beforeFence; o += 1) assert.ok(w.authority.seqOfOrdinal(o) < s, 'post-fence Node seq after every reported page event');
      } else nodeEvent();
    }
    take(() => assert.equal(w.authority.ingestFence(w.report()).ok, true));
    assert.deepEqual(w.violations, []);
    assert.deepEqual(order.map((e) => e.seq), order.map((_, i) => i + 1), 'allocation order == seq order == 1..n');
    assert.equal(w.runSeq.peek(), order.length);
    const pageOrds = order.filter((e) => e.realm === 'page').map((e) => e.ord);
    assert.deepEqual(pageOrds, pageOrds.map((_, i) => BASE_ORD + 1 + i), 'page events ingested exactly once each, in ordinal order');
    assert.equal(pageOrds.length, w.src.highWater() - BASE_ORD);
    assert.deepEqual(singleNamespaceProblems(w, null), []);
  }
  // concrete interleaving: ordering is Node INGESTION order, not observation order (documented)
  const w = authorityWorld();
  const n1 = w.runSeq.next();
  const o1 = w.src.next({ ...P1 }, 'spy');
  const n2 = w.runSeq.next(); // observed after o1 but ingested before it
  assert.equal(w.authority.ingestFence(w.report()).ok, true);
  assert.deepEqual([n1, n2, w.authority.seqOfOrdinal(o1), w.runSeq.next()], [1, 2, 3, 4]);
});

test('H1: ingestion refusals (gap, attribution, conflict, malformed entry/batch, hw mismatch) are ATOMIC (nothing ingested, nothing allocated, attribution unchanged) and exactly one violation each', () => {
  const w = authorityWorld();
  const e1 = w.src.next({ ...P1 }, 'spy');
  const e2 = w.src.next({ ...P1 }, 'spy');
  assert.deepEqual(w.authority.ingestFence(w.report()), { ok: true, count: 2 });
  w.src.ack(e2);
  const next = (o, attr = P1, kind = 'spy', label) => ({ ord: o, kind, ...(label === undefined ? {} : { label }), ...attr });
  const L = e2;
  const cases = [
    ['gap', { pending: [next(L + 2)], hw: L + 2 }, 'ingest-gap'],
    ['valid prefix + gap (atomic)', { pending: [next(L + 1), next(L + 3)], hw: L + 3 }, 'ingest-gap'],
    ['attribution != acknowledged', { pending: [next(L + 1, { phase: 'P2', activeCheck: null, activeControl: null })], hw: L + 1 }, 'ingest-attribution'],
    ['valid prefix + attribution (atomic)', { pending: [next(L + 1), next(L + 2, { phase: 'P1', activeCheck: 'C1', activeControl: null })], hw: L + 2 }, 'ingest-attribution'],
    ['conflicting re-send (kind)', { pending: [next(e1, P1, 'event', 'wrapper-restore')], hw: L }, 'ingest-conflict'],
    ['unlabeled event ordinal (label absent)', { pending: [next(L + 1, P1, 'event')], hw: L + 1 }, 'ingest-entry-invalid'],
    ['unlabeled event ordinal (label null)', { pending: [next(L + 1, P1, 'event', null)], hw: L + 1 }, 'ingest-entry-invalid'],
    ['valid prefix + unlabeled event (atomic)', { pending: [next(L + 1), next(L + 2, P1, 'event')], hw: L + 2 }, 'ingest-entry-invalid'],
    ['conflicting re-send (attribution)', { pending: [next(e2, { phase: 'P1', activeCheck: 'C1', activeControl: null })], hw: L }, 'ingest-conflict'],
    ['re-send of an ordinal never ingested below the high-water', { pending: [next(BASE_ORD - 1 + 1)], hw: L }, 'ingest-entry-invalid'],
    ['entry not an object', { pending: [null], hw: L }, 'ingest-entry-invalid'],
    ['ordinal not an integer', { pending: [next(L + 0.5)], hw: L }, 'ingest-entry-invalid'],
    ['authoritative-range ordinal', { pending: [next(7)], hw: L }, 'ingest-entry-invalid'],
    ['kind not a string', { pending: [{ ...next(L + 1), kind: 3 }], hw: L + 1 }, 'ingest-entry-invalid'],
    ['entry phase invalid', { pending: [next(L + 1, { phase: 'P99', activeCheck: null, activeControl: null })], hw: L + 1 }, 'ingest-entry-invalid'],
    ['entry activeCheck not owned by its phase', { pending: [next(L + 1, { phase: 'P1', activeCheck: 'C16', activeControl: null })], hw: L + 1 }, 'ingest-entry-invalid'],
    ['batch not an array', { pending: { 0: next(L + 1) }, hw: L + 1 }, 'ingest-entries-invalid'],
    ['hw ahead of the entries', { pending: [next(L + 1)], hw: L + 2 }, 'ingest-hw-mismatch'],
    ['hw behind the entries', { pending: [next(L + 1), next(L + 2)], hw: L + 1 }, 'ingest-hw-mismatch'],
    ['hw not an integer', { pending: [], hw: 'x' }, 'ingest-hw-mismatch'],
    ['hw regressed (no entries)', { pending: [], hw: e1 }, 'ingest-hw-mismatch'],
  ];
  for (const [label, rep, reason] of cases) {
    const before = { last: w.authority.lastOrdinal(), peek: w.runSeq.peek(), n: w.authority.ingested().length, attr: { ...w.attribution }, nv: w.violations.length };
    assert.deepEqual(w.authority.ingestFence(clone(rep)), { ok: false, reason }, label);
    assert.deepEqual([w.authority.lastOrdinal(), w.runSeq.peek(), w.authority.ingested().length], [before.last, before.peek, before.n], `${label}: nothing ingested / allocated`);
    assert.equal(w.authority.seqOfOrdinal(L + 1), undefined, `${label}: no partial mapping`);
    assert.deepEqual(w.attribution, before.attr, `${label}: attribution unchanged`);
    assert.deepEqual(w.violations.slice(before.nv), [reason], `${label}: exactly one violation`);
  }
  // the same refusals through syncPage leave the attribution unadopted
  const nv = w.violations.length;
  assert.deepEqual(w.authority.syncPage({ phase: 'P2', activeCheck: null, activeControl: null, pending: [next(L + 2)], hw: L + 2 }), { ok: false, reason: 'ingest-gap' });
  // after the transition allocation every entry must carry the incoming attribution (no switching back)
  const P2 = { phase: 'P2', activeCheck: null, activeControl: null };
  assert.deepEqual(w.authority.syncPage({ ...P2, pending: [next(L + 1, P2), next(L + 2, P1)], hw: L + 2 }), { ok: false, reason: 'ingest-attribution' });
  assert.deepEqual(w.violations.slice(nv), ['ingest-gap', 'ingest-attribution']);
  assert.deepEqual([w.attribution, w.authority.lastOrdinal(), w.authority.isSynced()], [{ ...P1 }, L, false]);
  // a throwing onViolation cannot turn a refusal into an acceptance
  const w3 = H.createRunAuthority({ allocator: H.createRunSeqAllocator(), attribution: { ...P1 }, onViolation: () => { throw new Error('x'); } });
  assert.deepEqual(w3.ingestFence({ pending: [next(BASE_ORD + 2)], hw: BASE_ORD + 2 }), { ok: false, reason: 'ingest-gap' });
});

test('H1: an idempotent re-send of already-ingested ordinals allocates nothing and keeps the mapping; only the new tail is allocated', () => {
  const w = authorityWorld();
  const o = [1, 2, 3].map(() => w.src.next({ ...P1 }, 'spy'));
  const first = w.report({ pending: w.src.pending().slice(0, 2), hw: o[1] });
  assert.deepEqual(w.authority.ingestFence(first), { ok: true, count: 2 });
  const map = o.slice(0, 2).map((x) => w.authority.seqOfOrdinal(x));
  assert.deepEqual(w.authority.ingestFence(first), { ok: true, count: 0 }, 'exact re-send');
  assert.equal(w.runSeq.peek(), 2);
  const n = w.runSeq.next(); // a Node event between the two fences
  assert.deepEqual(w.authority.ingestFence(w.report()), { ok: true, count: 1 }, 're-send + one new entry');
  assert.deepEqual(o.map((x) => w.authority.seqOfOrdinal(x)), [...map, n + 1]);
  assert.deepEqual(w.authority.ingested().map((e) => [e.seq, e.ord]), [[1, o[0]], [2, o[1]], [4, o[2]]]);
  assert.deepEqual(w.violations, []);
});

test('H1: a fence / syncPage WITHOUT a valid high-water (missing, undefined, null, non-object report) is refused atomically with exactly one violation; the early path needs no hw', () => {
  const w = authorityWorld();
  const o1 = w.src.next({ ...P1 }, 'spy');
  const [e1] = w.src.pending();
  const P2 = { phase: 'P2', activeCheck: null, activeControl: null };
  const cases = [
    ['fence: hw missing', () => w.authority.ingestFence({ pending: [e1] })],
    ['fence: hw undefined', () => w.authority.ingestFence({ pending: [e1], hw: undefined })],
    ['fence: hw null', () => w.authority.ingestFence({ pending: [e1], hw: null })],
    ['fence: no entries, no hw', () => w.authority.ingestFence({ pending: [] })],
    ['fence: report not an object', () => w.authority.ingestFence(null)],
    ['fence: report undefined', () => w.authority.ingestFence()],
    ['syncPage: hw missing', () => w.authority.syncPage({ ...P2, pending: [e1] })],
    ['syncPage: no entries, no hw', () => w.authority.syncPage({ ...P2 })],
    ['syncPage: hw null', () => w.authority.syncPage({ ...P2, pending: [], hw: null })],
  ];
  for (const [label, call] of cases) {
    const before = { last: w.authority.lastOrdinal(), peek: w.runSeq.peek(), attr: { ...w.attribution }, nv: w.violations.length, synced: w.authority.isSynced() };
    assert.deepEqual(call(), { ok: false, reason: 'ingest-hw-mismatch' }, label);
    assert.deepEqual([w.authority.lastOrdinal(), w.runSeq.peek(), w.attribution, w.authority.isSynced()], [before.last, before.peek, before.attr, before.synced], `${label}: atomic`);
    assert.deepEqual(w.violations.slice(before.nv), ['ingest-hw-mismatch'], `${label}: exactly one violation`);
  }
  assert.equal(w.authority.seqOfOrdinal(o1), undefined);
  // the early path carries no hw and still ingests
  const nv = w.violations.length;
  assert.deepEqual(w.authority.ingestEarly([e1]), { ok: true, count: 1 });
  assert.equal(w.violations.length, nv);
  // with the hw present the same fence is accepted
  assert.deepEqual(w.authority.syncPage({ ...P2, pending: [e1], hw: o1 }), { ok: true });
});

test('H1: the early path ingests only the longest contiguous prefix carrying the acknowledged attribution and DEFERS the rest (no violation); the next fence ingests the deferred entries; malformed/conflicting early entries are deferred to the fence (never a violation on the early path)', () => {
  const w = authorityWorld();
  const C1 = { phase: 'P1', activeCheck: 'C1', activeControl: null };
  const o1 = w.src.next({ ...P1 }, 'spy');
  const o2 = w.src.next({ ...C1 }, 'spy'); // allocated after the page switched to C1 (not yet acknowledged)
  const o3 = w.src.next({ ...C1 }, 'spy');
  const [e1, e2, e3] = w.src.pending();
  assert.deepEqual(w.authority.ingestEarly([e3]), { ok: true, count: 0 }, 'gap: deferred');
  assert.deepEqual(w.authority.ingestEarly([e1, e2, e3]), { ok: true, count: 1 }, 'prefix only: e2 carries an unacknowledged attribution');
  assert.deepEqual(w.authority.ingestEarly([e2]), { ok: true, count: 0 }, 'deferred until the attribution fence');
  assert.deepEqual(w.authority.ingestEarly(null), { ok: true, count: 0 });
  assert.deepEqual(w.violations, []);
  assert.equal(w.authority.lastOrdinal(), o1);
  // the attribution fence re-sends everything (e1 idempotently) and ingests the deferred entries, then adopts C1
  assert.deepEqual(w.authority.syncPage({ ...C1, ...w.report() }), { ok: true });
  assert.deepEqual([w.authority.lastOrdinal(), w.attribution, w.violations], [o3, C1, []]);
  assert.deepEqual([o1, o2, o3].map((o) => w.authority.seqOfOrdinal(o)), [1, 2, 3]);
  // the early path never records a violation: malformed / conflicting / non-array input is DEFERRED (nothing
  // ingested, whole batch) to the awaited fence, which is the single authority and reports it exactly once
  const peek = w.runSeq.peek();
  const o4 = w.src.next({ ...C1 }, 'spy');
  const [e4] = w.src.pending().filter((e) => e.ord === o4);
  assert.deepEqual(w.authority.ingestEarly([{ ord: 'x', kind: 'spy', ...C1 }]), { ok: true, count: 0, deferred: true, reason: 'ingest-entry-invalid' });
  assert.deepEqual(w.authority.ingestEarly([e4, { ...e4, ord: o4 + 1, kind: 7 }]), { ok: true, count: 0, deferred: true, reason: 'ingest-entry-invalid' }, 'atomic: the valid head is not ingested either');
  assert.deepEqual(w.authority.ingestEarly([{ ...e1, kind: 'other' }]), { ok: true, count: 0, deferred: true, reason: 'ingest-conflict' });
  assert.deepEqual([w.violations, w.runSeq.peek(), w.authority.lastOrdinal()], [[], peek, o3]);
  // the same conflicting entry carried by an awaited fence: one violation, nothing ingested
  assert.deepEqual(w.authority.ingestFence({ pending: [{ ...e1, kind: 'other' }, e4], hw: o4 }), { ok: false, reason: 'ingest-conflict' });
  assert.deepEqual([w.violations, w.authority.lastOrdinal()], [['ingest-conflict'], o3]);
});

test('H1: syncPage accepts forward moves (ingests, then adopts); every invalid attribution is refused with attribution / ordinals / allocator unchanged and exactly one onViolation', () => {
  const w = authorityWorld(H, { phase: 'P0', activeCheck: null, activeControl: null });
  const toP9 = () => {
    assert.equal(w.authority.isSynced(), false);
    w.src.next({ phase: 'P1', activeCheck: 'C1', activeControl: null }, 'marker');
    assert.deepEqual(w.authority.syncPage({ phase: 'P1', activeCheck: 'C1', activeControl: null, ...w.report() }), { ok: true });
    w.src.ack(w.src.highWater());
    assert.deepEqual(w.authority.syncPage({ phase: 'P2', activeCheck: null, activeControl: 'N1', ...w.report() }), { ok: true });
    w.src.next({ phase: 'P2', activeCheck: null, activeControl: 'N1' }, 'spy');
    assert.deepEqual(w.authority.syncPage({ phase: 'P2', activeCheck: null, activeControl: null, ...w.report() }), { ok: true }, 'same phase: allowed');
    w.src.ack(w.src.highWater());
    w.src.next({ phase: 'P9', activeCheck: 'C16', activeControl: null }, 'marker');
    assert.deepEqual(w.authority.syncPage({ phase: 'P9', activeCheck: 'C16', activeControl: null, ...w.report() }), { ok: true });
    w.src.ack(w.src.highWater());
    assert.equal(w.authority.isSynced(), true);
    assert.deepEqual([w.attribution, w.authority.phase(), w.authority.lastOrdinal(), w.runSeq.peek(), w.violations], [{ phase: 'P9', activeCheck: 'C16', activeControl: null }, 'P9', BASE_ORD + 3, 3, []]);
  };
  toP9();
  const refusals = [
    ['phase not in the enum', { phase: 'P99', activeCheck: null, activeControl: null }, 'sync-phase-invalid'],
    ['report not an object', null, 'sync-phase-invalid'],
    ['phase regression', { phase: 'P8', activeCheck: null, activeControl: null }, 'sync-phase-regressed'],
    ['activeCheck not a check', { phase: 'P9', activeCheck: 'C21', activeControl: null }, 'sync-activeCheck-invalid'],
    ['activeCheck not owned by the phase', { phase: 'P9', activeCheck: 'C2', activeControl: null }, 'sync-activeCheck-phase-inconsistent'],
    ['activeCheck in a non-check phase', { phase: 'cleanup', activeCheck: 'C16', activeControl: null }, 'sync-activeCheck-phase-inconsistent'],
    ['activeControl not a control', { phase: 'P9', activeCheck: 'C16', activeControl: 'N9' }, 'sync-activeControl-invalid'],
  ];
  // an entry is pending while each refusal happens: it must NOT be ingested by a refused report
  w.src.next({ phase: 'P9', activeCheck: 'C16', activeControl: null }, 'spy');
  for (const [label, rep, reason] of refusals) {
    const before = { attr: { ...w.attribution }, last: w.authority.lastOrdinal(), peek: w.runSeq.peek(), nv: w.violations.length };
    assert.deepEqual(w.authority.syncPage(rep === null ? null : { ...rep, ...w.report() }), { ok: false, reason }, label);
    assert.deepEqual(w.attribution, before.attr, `${label}: attribution unchanged`);
    assert.deepEqual([w.authority.lastOrdinal(), w.runSeq.peek()], [before.last, before.peek], `${label}: nothing ingested`);
    assert.deepEqual(w.violations.slice(before.nv), [reason], `${label}: exactly one violation`);
  }
  // undefined activeCheck/activeControl normalise to null; a later valid forward report still adopted
  assert.deepEqual(w.authority.syncPage({ phase: 'P10', ...w.report() }), { ok: true });
  assert.deepEqual(w.attribution, { phase: 'P10', activeCheck: null, activeControl: null });
  assert.equal(w.authority.lastOrdinal(), BASE_ORD + 4);
  // a refused FIRST report never marks the authority synced
  const w2 = authorityWorld(H, { phase: 'P0', activeCheck: null, activeControl: null });
  assert.equal(w2.authority.syncPage({ phase: 'nope', ...w2.report() }).ok, false);
  assert.equal(w2.authority.isSynced(), false);
  assert.deepEqual(w2.attribution, { phase: 'P0', activeCheck: null, activeControl: null });
});

test('H1 non-vacuity: removing each syncPage / ingestion guard (mutated copies) lets the corresponding invalid report through', async () => {
  const P9C16 = { phase: 'P9', activeCheck: 'C16', activeControl: null };
  const prime = (w) => {
    w.src.next({ ...P9C16 }, 'marker');
    assert.deepEqual(w.authority.syncPage({ ...P9C16, ...w.report() }), { ok: true });
    w.src.ack(w.src.highWater());
  };
  const L = BASE_ORD + 1;
  const entry = (o, attr = P9C16, kind = 'spy', label = null) => ({ ord: o, kind, label, ...attr });
  const guards = [
    ["if (!ATTRIBUTION_PHASES.includes(r.phase)) return violate('sync-phase-invalid');", (w) => w.authority.syncPage({ phase: 'P99', ...w.report() }), 'sync-phase-regressed'],
    ["if (phaseIndex(r.phase) < phaseIndex(attribution.phase)) return violate('sync-phase-regressed');", (w) => w.authority.syncPage({ phase: 'P8', ...w.report() }), null],
    ["if (activeControl !== null && !CONTROL_NAMES.includes(activeControl)) return violate('sync-activeControl-invalid');", (w) => w.authority.syncPage({ ...P9C16, activeControl: 'N9', ...w.report() }), null],
    ["if (activeCheckPhaseProblem({ phase: r.phase, activeCheck }) !== null) return violate('sync-activeCheck-phase-inconsistent');", (w) => w.authority.syncPage({ phase: 'P9', activeCheck: 'C2', activeControl: null, ...w.report() }), null],
    ["if (e.ord !== expect) { if (early) break; return fail('ingest-gap'); }", (w) => w.authority.ingestFence({ pending: [entry(L + 2)], hw: L + 1 }), null],
    ["else { if (early) break; return fail('ingest-attribution'); }", (w) => w.authority.ingestFence({ pending: [entry(L + 1, { phase: 'P9', activeCheck: 'C17', activeControl: null })], hw: L + 1 }), null],
    ["if (!prev || prev.kind !== e.kind || prev.label !== (e.label === undefined ? null : e.label) || !sameAttr(prev, attrOf(e))) return fail('ingest-conflict');", (w) => w.authority.ingestFence({ pending: [entry(L, P9C16, 'event', 'wrapper-restore')], hw: L }), null],
    // label-specific halves (a label-blind conflict check / a label-blind shape check would pass the kind/attr-only variants above)
    ["prev.label !== (e.label === undefined ? null : e.label) || ", (w) => w.authority.ingestFence({ pending: [entry(L, P9C16, 'marker', 'changed-label')], hw: L }), null],
    ["!(e.label === undefined || e.label === null || typeof e.label === 'string') || ", (w) => w.authority.ingestFence({ pending: [entry(L + 1, P9C16, 'spy', 7)], hw: L + 1 }), null],
    // the event-kind label requirement (an unlabeled event ordinal could otherwise dodge the cleanup identity check)
    ["(e.kind === 'event' && !(typeof e.label === 'string' && e.label.length > 0)) || ", (w) => w.authority.ingestFence({ pending: [entry(L + 1, P9C16, 'event', null)], hw: L + 1 }), null],
    ["(e.kind === 'event' && !(typeof e.label === 'string' && e.label.length > 0)) || ", (w) => w.authority.ingestFence({ pending: [entry(L + 1, P9C16, 'event', '')], hw: L + 1 }), null],
    ["if (!early && (!Number.isSafeInteger(hw) || hw !== expect - 1)) return fail('ingest-hw-mismatch');", (w) => w.authority.ingestFence({ pending: [], hw: L + 5 }), null],
  ];
  for (const [line, attempt, fallback] of guards) {
    // the real harness refuses
    const real = authorityWorld(H, { phase: 'P0', activeCheck: null, activeControl: null });
    prime(real);
    assert.equal(attempt(real).ok, false, `real harness refuses (${line})`);
    const M = await importMutated([[line, '']]);
    const w = authorityWorld(M, { phase: 'P0', activeCheck: null, activeControl: null });
    prime(w);
    const got = attempt(w);
    if (fallback) {
      // defence in depth: an unknown phase has index -1, so the regression guard still refuses it -- but
      // with the wrong attribution of the defect (the enum guard is what names it).
      assert.deepEqual(got, { ok: false, reason: fallback }, line);
      continue;
    }
    assert.equal(got.ok, true, `accepted without its guard: ${line}`);
    assert.deepEqual(w.violations, [], line);
  }
});

// ==========================================================================================
// H1 -- final transfer: rewritePageRun, leaked ordinals, assertAllocated, spyRef translation
// ==========================================================================================

test('H1: rewritePageRun maps every page ordinal (numbers and `spyLedger:seq:<n>` references in strings; other strings, e.g. digests with 16-digit runs, untouched) to its authoritative seq; unmapped => page-ordinal-unmapped; a high-water mismatch => final-ingest-mismatch; non-ordinal numbers untouched', () => {
  const w = authorityWorld();
  const n0 = w.runSeq.next();
  const o1 = w.src.next({ ...P1 }, 'marker');
  const o2 = w.src.next({ ...P1 }, 'spy');
  assert.equal(w.authority.ingestFence(w.report()).ok, true);
  const s1 = w.authority.seqOfOrdinal(o1);
  const s2 = w.authority.seqOfOrdinal(o2);
  assert.deepEqual([n0, s1, s2], [1, 2, 3]);
  const run = { pageHighWater: o2, markers: [{ seq: o1, name: 'P1' }], spyLedger: [{ seq: o2, ref: `spyLedger:seq:${o2}`, at: 1727740800000, n: 42 }], nested: [[o1]], text: `${o1}-${o2}`, digest: `ab${o2}cd` };
  const out = w.authority.rewritePageRun(clone(run));
  assert.deepEqual(out, { pageHighWater: s2, markers: [{ seq: s1, name: 'P1' }], spyLedger: [{ seq: s2, ref: `spyLedger:seq:${s2}`, at: 1727740800000, n: 42 }], nested: [[s1]], text: `${o1}-${o2}`, digest: `ab${o2}cd` });
  assert.deepEqual(w.violations, []);
  // an ordinal Node never ingested
  const leaked = w.authority.rewritePageRun({ pageHighWater: o2, markers: [{ seq: o2 + 1, name: 'P2' }] });
  assert.deepEqual(w.violations, ['page-ordinal-unmapped']);
  assert.equal(leaked.markers[0].seq, o2 + 1, 'unmapped ordinal is left in place (and is then a leak, below)');
  // the page reports a high-water Node has not ingested up to (a missing final fence)
  w.src.next({ ...P1 }, 'spy');
  w.authority.rewritePageRun({ pageHighWater: w.src.highWater() }); // (the high-water itself is then also unmapped)
  w.authority.rewritePageRun(null);
  assert.deepEqual(w.violations, ['page-ordinal-unmapped', 'final-ingest-mismatch', 'page-ordinal-unmapped', 'final-ingest-mismatch']);
  // remapPageOrdinals is the pure core
  const m = H.remapPageOrdinals({ a: [o1, o2 + 9], s: `x${o2}`, r: `spyLedger:seq:${o2}` }, new Map([[o1, 5], [o2, 6]]));
  assert.deepEqual(m, { value: { a: [5, o2 + 9], s: `x${o2}`, r: 'spyLedger:seq:6' }, unmapped: [o2 + 9] });
});

test('H1: a page-local ordinal in authoritative state is reported page-ordinal-leaked by primarySeqAllocations; assertAllocated refuses a seq beyond the allocator', async () => {
  const ledger = H.createEmptyErrorLedger();
  ledger.markers.push({ seq: 1, name: 'P0' }, { seq: BASE_ORD + 7, name: 'P1' });
  const st = { errorLedger: ledger, spyLedger: [{ seq: BASE_ORD + 8, phase: 'P1', activeCheck: null, activeControl: null }] };
  const probs = H.primarySeqAllocations(st).problems;
  assert.ok(probs.includes(`page-ordinal-leaked:${BASE_ORD + 7}:errorLedger.markers[1]`), JSON.stringify(probs));
  assert.ok(probs.some((p) => p.startsWith(`page-ordinal-leaked:${BASE_ORD + 8}:`)), JSON.stringify(probs));
  assert.ok(H.recordSchemaProblems(st).some((p) => p.startsWith('page-ordinal-leaked:')));
  const clean = { errorLedger: { ...H.createEmptyErrorLedger(), markers: [{ seq: 1, name: 'P0' }, { seq: 2, name: 'P1' }] } };
  assert.deepEqual(H.primarySeqAllocations(clean).problems, []);
  // non-vacuity: without the leak check the same state is silently accepted
  const M = await importMutated([['if (isPageLocalOrdinal(x.seq)) problems.push(`page-ordinal-leaked:${x.seq}:${x.label}`);', '']]);
  assert.deepEqual(M.primarySeqAllocations(st).problems, []);
  // assertAllocated
  const w = authorityWorld();
  w.runSeq.next(); w.runSeq.next();
  assert.deepEqual(w.authority.assertAllocated(2), { ok: true });
  assert.deepEqual(w.authority.assertAllocated(-1), { ok: true });
  assert.deepEqual(w.authority.assertAllocated(3), { ok: false, reason: 'seq-beyond-allocator' });
  assert.deepEqual(w.violations, ['seq-beyond-allocator']);
});

test('H1: the operation-ledger binding is a fence (pending ingested before the op allocates), refuses a begin whose phase differs from the authoritative phase once synced, and translates the spyRef ordinal at end (unmapped => spy-ref-unmapped)', () => {
  const node = nodeWorld();
  const ob = node.bindings[H.G2_NODE_OPLEDGER_BINDING];
  const src = H.createPageOrdinalSource();
  const rep = () => ({ pending: src.pending(), hw: src.highWater() });
  const desc = { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' };
  assert.equal(ob('begin', { ...desc, ...rep() }).ok, true, 'unsynced: not phase-checked');
  assert.deepEqual(node.authority.syncPage({ phase: 'P8', activeCheck: null, activeControl: null, ...rep() }), { ok: true });
  assert.deepEqual(ob('begin', { ...desc, ...rep() }), { ok: false, reason: 'phase-mismatch' });
  assert.equal(node.ledger.opLedger.length, 1, 'nothing appended on a phase mismatch');
  const P9C16 = { phase: 'P9', activeCheck: 'C16', activeControl: null };
  assert.deepEqual(node.authority.syncPage({ ...P9C16, ...rep() }), { ok: true });
  const pre = src.next(P9C16, 'spy');
  const begin = ob('begin', { ...desc, ...rep() });
  assert.equal(begin.ok, true);
  src.ack(src.highWater());
  const op = node.ledger.opLedger.find((o) => o.operationId === begin.operationId);
  assert.ok(node.authority.seqOfOrdinal(pre) < op.startSeq && op.startSeq < op.ackSeq, 'the op begin is a fence: the pending ordinal is ingested first');
  // the hide's spy record (page ordinal) is ingested by the end fence and its ref translated
  const spy = src.next(P9C16, 'spy');
  const r = ob('end', { operationId: begin.operationId, terminalOutcome: 'settled', spyRef: `spyLedger:seq:${spy}`, ...rep() });
  assert.deepEqual(r, { ok: true });
  const spySeq = node.authority.seqOfOrdinal(spy);
  assert.ok(spySeq > op.ackSeq && spySeq < op.endSeq);
  assert.equal(op.causalEvidence.spyRef, `spyLedger:seq:${spySeq}`);
  assert.equal(H.isPageLocalOrdinal(spySeq), false);
  // an unmapped spyRef (an ordinal Node never ingested) is refused and the op stays not-settled
  const b2 = ob('begin', { ...desc, ...rep() });
  assert.deepEqual(ob('end', { operationId: b2.operationId, terminalOutcome: 'settled', spyRef: `spyLedger:seq:${spy + 50}`, ...rep() }), { ok: false, reason: 'spy-ref-unmapped' });
  assert.equal(node.ledger.opLedger.find((o) => o.operationId === b2.operationId).terminalOutcome, 'not-settled');
  // translateSpyRef: authoritative refs pass through, malformed => null
  assert.equal(node.authority.translateSpyRef('spyLedger:seq:3'), 'spyLedger:seq:3');
  assert.equal(node.authority.translateSpyRef(42), null);
  assert.equal(node.authority.translateSpyRef('nope'), null);
  // a refused fence (ingestion) refuses the op before anything is allocated
  const peek = node.runSeq.peek();
  assert.deepEqual(ob('begin', { ...desc, pending: [{ ord: src.highWater() + 2, kind: 'spy', ...P9C16 }], hw: src.highWater() + 2 }), { ok: false, reason: 'ingest-gap' });
  assert.equal(node.runSeq.peek(), peek + 1, 'only the violation fatal entry was allocated');
});

test('H1 non-vacuity: an ops binding that does NOT translate the spyRef (mutated binding text) stores a page-local ordinal as causal evidence', () => {
  const mutatedSource = mutate(SOURCE, [["if (String(action) === 'end' && typeof a.spyRef === 'string') {", "if (false) {"]]);
  const node = nodeWorld({ bindingSource: mutatedSource });
  const ob = node.bindings[H.G2_NODE_OPLEDGER_BINDING];
  const src = H.createPageOrdinalSource();
  const P9C16 = { phase: 'P9', activeCheck: 'C16', activeControl: null };
  node.authority.syncPage({ ...P9C16, pending: [], hw: BASE_ORD });
  const b = ob('begin', { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16', pending: [], hw: BASE_ORD });
  const spy = src.next(P9C16, 'spy');
  assert.deepEqual(ob('end', { operationId: b.operationId, terminalOutcome: 'settled', spyRef: `spyLedger:seq:${spy}`, pending: src.pending(), hw: spy }), { ok: true });
  const ref = node.ledger.opLedger.at(-1).causalEvidence.spyRef;
  assert.equal(ref, `spyLedger:seq:${spy}`);
  assert.ok(H.isPageLocalOrdinal(Number(ref.slice('spyLedger:seq:'.length))), 'a non-authoritative ordinal leaked into the Node ledger');
});

test('H1 non-vacuity: a reintroduced second / composite numbering of page events (mutated createRunAuthority) breaks the single-namespace invariant the cross-realm flow satisfies', async () => {
  const script = (w) => {
    // mixed run: Node events, page events, fences, an early hint
    w.runSeq.next();
    const a = w.src.next({ ...P1 }, 'spy');
    w.runSeq.next();
    w.authority.ingestEarly(w.src.pending());
    w.src.next({ ...P1 }, 'spy');
    w.src.next({ ...P1 }, 'event', 'wrapper-restore');
    assert.equal(w.authority.ingestFence(w.report()).ok, true);
    w.runSeq.next();
    w.src.next({ ...P1 }, 'spy');
    assert.equal(w.authority.ingestFence(w.report()).ok, true);
    const ledger = H.createEmptyErrorLedger();
    ledger.markers = w.authority.ingested().map((e) => ({ seq: e.seq, name: `m${e.ord - a}` }));
    return { errorLedger: ledger };
  };
  const good = authorityWorld();
  const st = script(good);
  assert.deepEqual(singleNamespaceProblems(good, st), []);
  const seqs = H.primarySeqAllocations(st).seqs.map((x) => x.seq);
  assert.ok(seqs.every((s) => s >= 1 && s <= good.runSeq.peek() && s < BASE_ORD));
  for (const [label, to] of [
    ['page-major composite numbering', 'const seq = (ordToSeq.size + 1) * 1048576;'],
    ['page ordinal used directly as the authoritative seq', 'const seq = e.ord;'],
    ['a second (page) counter', 'const seq = ordToSeq.size + 1;'],
  ]) {
    const M = await importMutated([['const seq = allocator.next();', to]]);
    const w = authorityWorld(M);
    const p = singleNamespaceProblems(w, script(w));
    assert.ok(p.length > 0, `${label}: detected`);
  }
});

// ==========================================================================================
// H1 -- the real cross-realm flow: hide/unload/teardown attribution
// ==========================================================================================

test('H1 cross-realm flow: runChecksInPhaseOrder (page bundle) + g2NodeSync over a delayed channel => C16 hide abort P9/C16 EC-hide, C17 unload abort P9/C17 EC-unload; no fatal; one namespace; spyRef translated', async () => {
  const node = nodeWorld();
  node.loads();
  assert.deepEqual(node.ledger.requestObservations.map((o) => o.startSeq).slice(0, 2), [2, 6], 'pre-run node seqs (beginLoad 1, request 2, finished 3, endLoad 4, beginLoad 5, request 6)');
  const page = pageRealm();
  const early = [];
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { delay: 4 }, [H.G2_NODE_OPLEDGER_BINDING]: { delay: 1 }, [H.G2_NODE_INGEST_BINDING]: { delay: 3, after: (r) => early.push(r) } });
  const seen = {};
  const run = await runPage(page, node, { drv: drivers(page, { P9: p9Driver(page, node, seen, { unload: true }) }) });
  assert.ok(early.length > 0 && early.every((r) => r.ok === true), 'every early hint answered ok (deferral, never a violation)');
  assert.ok(early.some((r) => r.count > 0) && early.some((r) => r.count === 0), 'the early path both ingested and deferred entries in this run');
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.deepEqual(seen.attrC16, { phase: 'P9', activeCheck: 'C16', activeControl: null }, 'the awaited fence: Node holds P9/C16 before the hide');
  assert.deepEqual(seen.attrC17, { phase: 'P9', activeCheck: 'C17', activeControl: null }, 'and P9/C17 before the unload');
  const rf = node.ledger.requestFailures;
  assert.equal(rf.length, 2);
  assert.deepEqual([rf[0].phase, rf[0].activeCheck, rf[0].closeout.classification, rf[0].closeout.rule, rf[0].closeout.phase], ['P9', 'C16', 'expected-cancellation', 'EC-hide', 'P9']);
  assert.deepEqual([rf[1].phase, rf[1].activeCheck, rf[1].closeout.classification, rf[1].closeout.rule, rf[1].closeout.phase], ['P9', 'C17', 'expected-cancellation', 'EC-unload', 'P9']);
  assert.deepEqual([node.ledger.fatalCount, node.ledger.entries, node.violations], [0, [], []], 'no false fatal from a stale P1; no fence violation');
  const hide = node.ledger.opLedger.find((o) => o.operationType === 'hide');
  const unload = node.ledger.opLedger.find((o) => o.operationType === 'unload');
  assert.deepEqual([hide.phase, hide.invokedBy, hide.terminalOutcome], ['P9', 'C16', 'settled']);
  assert.deepEqual([unload.phase, unload.invokedBy, unload.terminalOutcome], ['P9', 'C17', 'settled']);
  // order at the fences (authoritative = Node ingestion order)
  const p9 = run.markers.find((m) => m.name === 'P9');
  const spy = run.spyLedger.find((r) => r.method === 'viewer.hideModel');
  assert.ok(p9.seq < rf[0].startSeq, 'the P9 marker (ingested at its fence) precedes the P9 request');
  assert.ok(rf[0].startSeq < hide.startSeq && hide.startSeq < hide.ackSeq && hide.ackSeq < rf[0].failSeq && hide.ackSeq < spy.seq && spy.seq < hide.endSeq, 'request < begin < ack < {abort, spy record} < end');
  assert.ok(hide.endSeq < rf[1].startSeq && rf[1].startSeq < unload.startSeq && unload.ackSeq < rf[1].failSeq);
  assert.equal(hide.causalEvidence.spyRef, `spyLedger:seq:${spy.seq}`, 'spyRef translated to the authoritative seq at ops end');
  assert.equal(run.gates.C1.c1FinalizedSeq, run.checks.C1.finalizedSeq, 'gate bound to C1\'s authoritative seq');
  assert.ok(run.gates.C1.gateSeq > run.checks.C1.finalizedSeq);
  assert.equal(run.pageHighWater, node.authority.seqOfOrdinal(page.g.seq.highWater()), 'the transferred high-water itself was remapped');
  const state = seqStateOf(node, run);
  assert.deepEqual(H.primarySeqAllocations(state).problems, [], 'no collision, no leaked ordinal');
  assert.deepEqual(singleNamespaceProblems(node, state), []);
  assert.equal(node.authority.ingested().length, page.g.seq.highWater() - BASE_ORD, 'every page ordinal ingested exactly once');
  assert.deepEqual(node.attribution, { phase: 'cleanup', activeCheck: null, activeControl: null }, 'the last fence is the cleanup marker');
});

test('H1 phase attribution after the run: a cleanup unload (page op) is cleanup/EC-unload; a Node teardown is cleanup/EC-teardown; neither inherits P9; a stale P9 op descriptor is refused AND blocks the mutation', async () => {
  const node = nodeWorld();
  node.loads();
  const page = pageRealm();
  connect(page, node);
  await runPage(page, node, { drv: drivers(page, { P9: p9Driver(page, node, {}) }) });
  assert.deepEqual(node.attribution, { phase: 'cleanup', activeCheck: null, activeControl: null });
  const ops = page.t.g2NodeOps();
  const hidesBefore = node.ledger.opLedger.filter((o) => o.operationType === 'hide').length;
  const spyBefore = page.recorder.records.length;
  // a stale P9 hide after the run (live page: requireOps): refused by the Node phase check => the hide is
  // NOT invoked, no recorder record, no op record, no cancellation window; exactly one violation
  let staleActed = false;
  await assert.rejects(
    page.t.runAcknowledgedMutation({ ops, requireOps: true, desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, recorder: page.recorder, method: 'viewer.hideModel', args: [], invoke: () => { staleActed = true; } }),
    /operation-begin refused \(phase-mismatch\): mutation not started/,
  );
  assert.equal(staleActed, false, 'the stale hide never ran');
  assert.equal(page.recorder.records.length, spyBefore, 'no spy record for a refused begin');
  assert.equal(node.ledger.opLedger.filter((o) => o.operationType === 'hide').length, hidesBefore, 'no op record for a refused begin');
  assert.deepEqual(node.violations, ['op-begin-refused:phase-mismatch']);
  assert.deepEqual(node.ledger.entries.map((e) => [e.kind, e.detail]), [['harness-exception', 'cross-realm-fence:op-begin-refused:phase-mismatch']]);
  // cleanup unload of B through the page's acknowledged mutation (requireOps, accepted => runs)
  const r1 = fakeRequest({ url: `${PREFIX_B}/cleanup-1.bin` });
  node.request(r1);
  await page.t.runAcknowledgedMutation({ ops, requireOps: true, desc: { operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' }, invoke: () => { node.fail(r1); } });
  // Node-owned teardown (buildCleanupSteps): ops.beginMutation + abort + end
  const r2 = fakeRequest({ url: `${PREFIX_A}/cleanup-2.bin` });
  node.request(r2);
  const td = node.ops.beginMutation({ operationType: 'teardown', teardownTarget: 'closePage', phase: 'cleanup', invokedBy: 'cleanup:closePage', cleanupStepRef: '/cleanupStepStatus/closePage' });
  node.fail(r2);
  node.ops.endMutation(td.operationId, 'settled');
  const byUrl = (u) => node.ledger.requestFailures.find((f) => f.urlRedacted.endsWith(u));
  const fu = byUrl('cleanup-1.bin');
  const ft = byUrl('cleanup-2.bin');
  assert.deepEqual([fu.phase, fu.activeCheck, fu.closeout.classification, fu.closeout.rule], ['cleanup', null, 'expected-cancellation', 'EC-unload']);
  assert.deepEqual([ft.phase, ft.activeCheck, ft.closeout.classification, ft.closeout.rule], ['cleanup', null, 'expected-cancellation', 'EC-teardown']);
  assert.equal(node.ledger.fatalCount, 1, 'the only fatal is the refused stale begin (the cleanup aborts are expected cancellations)');
  assert.deepEqual(node.violations, ['op-begin-refused:phase-mismatch']);
});

test('H1 phase attribution: hide phase state does not leak into later unrelated operations (a later P10 abort and a cleanup abort with no mutation are their own phase and FATAL, never EC-hide)', async () => {
  const node = nodeWorld();
  node.loads();
  const page = pageRealm();
  connect(page, node);
  const seen = {};
  await runPage(page, node, {
    drv: drivers(page, {
      P9: p9Driver(page, node, {}),
      P10: async (ctx, pass) => {
        seen.attrP10 = { ...node.attribution };
        const r = fakeRequest({ url: `${PREFIX_B}/p10.bin` });
        node.request(r);
        node.fail(r);
        return { checks: Object.fromEntries(ctx.runnable.checks.map((c) => [c, pass()])) };
      },
    }),
  });
  const p10 = node.ledger.requestFailures.find((f) => f.urlRedacted.endsWith('p10.bin'));
  assert.equal(seen.attrP10.phase, 'P10');
  assert.equal(p10.phase, 'P10');
  assert.notEqual(p10.activeCheck, 'C16');
  assert.equal(p10.closeout.classification, 'fatal-required-resource', JSON.stringify(p10.closeout));
  assert.notEqual(p10.closeout.rule, 'EC-hide');
  // after the run: a cleanup-phase abort with no teardown/unload mutation in flight
  const r = fakeRequest({ url: `${PREFIX_B}/after.bin` });
  node.request(r);
  node.fail(r);
  const late = node.ledger.requestFailures.at(-1);
  assert.deepEqual([late.phase, late.activeCheck, late.closeout.classification], ['cleanup', null, 'fatal-required-resource']);
  assert.ok(node.ledger.fatalCount >= 2);
});

test('H1 contrast: the same abort when the page never synced (no sync binding) stays P1 and is fatal-required-resource (no acknowledged op) -- the fix is the attribution', async () => {
  const node = nodeWorld();
  node.loads();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { absent: true } });
  assert.equal(page.t.g2NodeSync(), null);
  const seen = {};
  const run = await runPage(page, node, { drv: drivers(page, { P9: p9Driver(page, node, seen) }) });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.deepEqual(seen.attrC16, { phase: 'P1', activeCheck: null, activeControl: null });
  const rf = node.ledger.requestFailures;
  assert.deepEqual([rf[0].phase, rf[0].closeout.classification], ['P1', 'fatal-required-resource']);
  assert.notEqual(rf[0].closeout.rule, 'EC-hide');
  // without the attribution fence Node never acknowledged P9: the op-begin fence's page ordinals carry an
  // attribution Node does not hold => refused (fail closed: no op record, no cancellation window)
  assert.ok(node.violations.includes('ingest-attribution'), JSON.stringify(node.violations));
  assert.equal(node.ledger.opLedger.filter((o) => o.operationType === 'hide').length, 0);
  assert.ok(node.ledger.fatalCount >= 1);
});

test('H1 non-vacuity: an authority that acknowledges but does not adopt the attribution (mutated copy) => the op begin is refused and BLOCKS the hide (requireOps); an abort in that window keeps the stale phase and is fatal', async () => {
  const run = async (M) => {
    const node = nodeWorld({ M });
    node.loads();
    const ob = node.bindings[M.G2_NODE_OPLEDGER_BINDING];
    const sb = node.bindings[M.G2_NODE_SYNC_BINDING];
    Object.assign(node.attribution, { ...P1 });
    assert.deepEqual(sb('attribution', { phase: 'P9', activeCheck: 'C16', activeControl: null, pending: [], hw: BASE_ORD }), { ok: true });
    const r = fakeRequest();
    node.request(r);
    const answers = [];
    const ops = {
      begin: async (d) => { const b = ob('begin', { ...d, pending: [], hw: BASE_ORD }); answers.push(b); return b; },
      end: async (a) => ob('end', { ...a, pending: [], hw: BASE_ORD }),
    };
    let acted = false;
    let error = null;
    try {
      await M.runAcknowledgedMutation({ ops, requireOps: true, desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, invoke: () => { acted = true; node.fail(r); } });
    } catch (e) { error = e; }
    if (!acted) node.fail(r); // the same in-flight request aborts anyway (nothing the harness started)
    return { node, b: answers[0], acted, error, rf: node.ledger.requestFailures.at(-1) };
  };
  const good = await run(H);
  assert.equal(good.b.ok, true);
  assert.equal(good.acted, true);
  assert.equal(good.error, null);
  assert.deepEqual([good.rf.phase, good.rf.closeout.classification, good.rf.closeout.rule], ['P9', 'expected-cancellation', 'EC-hide']);
  assert.deepEqual(good.node.violations, []);
  assert.equal(good.node.ledger.fatalCount, 0);
  const bad = await run(await importMutated([['Object.assign(attribution, incoming);', '']]));
  assert.deepEqual(bad.b, { ok: false, reason: 'phase-mismatch' });
  assert.equal(bad.acted, false, 'the refused begin blocked the hide');
  assert.match(String(bad.error && bad.error.message), /operation-begin refused \(phase-mismatch\): mutation not started/);
  assert.equal(bad.node.ledger.opLedger.filter((o) => o.operationType === 'hide').length, 0, 'no op record');
  assert.deepEqual(bad.node.violations, ['op-begin-refused:phase-mismatch']);
  assert.equal(bad.rf.phase, 'P1');
  assert.equal(bad.rf.closeout.classification, 'fatal-required-resource');
  assert.equal(bad.node.ledger.fatalCount, 2, 'the refused-begin violation + the stale-phase abort');
});

test('H1 non-vacuity: a page that fires the attribution sync without awaiting it (mutated page bundle) races the delayed channel => stale attribution => the hide abort is not an expected cancellation', async () => {
  const awaited = 'const syncAttr = async () => { if (sync && typeof sync.attribution === \'function\') await sync.attribution(rec.attribution()); };';
  const mutatedSource = mutate(SOURCE, [[awaited, 'const syncAttr = async () => { if (sync && typeof sync.attribution === \'function\') sync.attribution(rec.attribution()).catch(() => {}); };']]);
  const node = nodeWorld();
  node.loads();
  const page = pageRealm({ bundle: exposeBundle(H.buildPageAgentSource(mutatedSource).source) });
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { delay: 15 }, [H.G2_NODE_OPLEDGER_BINDING]: { delay: 1 } });
  const seen = {};
  await runPage(page, node, { drv: drivers(page, { P9: p9Driver(page, node, seen) }), drainMs: 40 }).catch(() => {});
  assert.notDeepEqual(seen.attrC16, { phase: 'P9', activeCheck: 'C16', activeControl: null });
  const rf = node.ledger.requestFailures.find((f) => f.urlRedacted.endsWith('stream.bin'));
  assert.notEqual(rf.closeout.classification, 'expected-cancellation', JSON.stringify(rf.closeout));
  assert.ok(node.ledger.fatalCount >= 1);
});

test('H1 (phase attribution): a refused attribution sync throws in the page BEFORE the attributed hide runs (driver action not executed; no op; units BLOCKED harness-exception; one violation; attribution unchanged)', async () => {
  const node = nodeWorld();
  node.loads();
  const page = pageRealm();
  // corrupt exactly the C16 begin report in transit (an invalid control) => Node refuses it
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'attribution' && a[1].activeCheck === 'C16') a[1].activeControl = 'N9'; } } });
  let acted = false;
  let nodeAttrAtRefusal = null;
  const run = await runPage(page, node, {
    drv: drivers(page, {
      P9: async (ctx) => {
        try { await ctx.beginCheck('C16'); } catch (e) { nodeAttrAtRefusal = { ...node.attribution }; throw e; }
        acted = true;
        await page.t.runAcknowledgedMutation({ ops: page.t.g2NodeOps(), desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, invoke: () => {} });
        return {};
      },
    }),
  });
  assert.equal(acted, false, 'the action after the refused fence never ran');
  assert.equal(node.ledger.opLedger.filter((o) => o.operationType === 'hide').length, 0, 'no hide operation was begun');
  assert.deepEqual(nodeAttrAtRefusal, { phase: 'P9', activeCheck: null, activeControl: null });
  assert.deepEqual(node.violations, ['sync-activeControl-invalid']);
  assert.deepEqual(node.ledger.entries.map((e) => [e.kind, e.detail]), [['harness-exception', 'cross-realm-fence:sync-activeControl-invalid']]);
  const p9 = run.phaseLog.find((e) => e.phase === 'P9');
  assert.match(p9.error.message, /attribution sync refused by the node authority \(sync-activeControl-invalid\)/);
  assert.equal(run.checks.C16.reason, 'harness-exception:P9');
  assert.equal(run.sessionTainted, true);
});

test('H1: a refused phase-marker fence (high-water mismatch in transit) rejects the whole page run (fail-closed, no driver of that phase runs)', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'attribution' && a[1].phase === 'P3') a[1].hw += 1; } } });
  let p3ran = false;
  await assert.rejects(runPage(page, node, { drv: drivers(page, { P3: async () => { p3ran = true; return {}; } }) }), /attribution sync refused by the node authority \(ingest-hw-mismatch\)/);
  assert.equal(p3ran, false);
  assert.deepEqual(node.violations, ['ingest-hw-mismatch']);
  assert.notEqual(node.attribution.phase, 'P3');
});

test('H1: live mode without the Node fences is refused (node-sync-missing) after the wiring/dual-counter guards; the real harness refuses earlier (live-path-not-wired)', async () => {
  await assert.rejects(H.runChecksInPhaseOrder({ mode: 'live', sync: { attribution: async () => {}, gate: async () => ({}) } }), (e) => e instanceof H.G2RefusalError && e.reason === 'live-path-not-wired');
  const { start, end } = H.locateFunctionSource(SOURCE, 'runChecksInPhaseOrder');
  const body = SOURCE.slice(start, end);
  const iw = body.indexOf("'live-path-not-wired'");
  const id = body.indexOf("'dual-counter-gate-unresolved'");
  const is = body.indexOf("'node-sync-missing'");
  assert.ok(iw !== -1 && iw < id && id < is && is < body.indexOf('const rec = '), 'guard order: wiring, dual-counter gate, node sync, then any work');
  const M = await importMutated([
    ['const LIVE_PATH_WIRED = false;', 'const LIVE_PATH_WIRED = true;'],
    ['const G2_DUAL_COUNTER_GATE = Object.freeze({ resolved: false, ', 'const G2_DUAL_COUNTER_GATE = Object.freeze({ resolved: true, '],
  ]);
  let driverCalls = 0;
  const drv = { P1: async () => { driverCalls += 1; return {}; } };
  for (const sync of [undefined, null, {}, { attribution: async () => {} }, { gate: async () => ({}) }, { attribution: 1, gate: 2 }]) {
    await assert.rejects(M.runChecksInPhaseOrder({ mode: 'live', drivers: drv, sync }), (e) => e instanceof M.G2RefusalError && e.reason === 'node-sync-missing', JSON.stringify(sync));
  }
  assert.equal(driverCalls, 0);
  // with both fences present the live run is not refused for node-sync (it runs through the Node gate)
  const node = nodeWorld({ M });
  const sb = node.bindings[M.G2_NODE_SYNC_BINDING];
  const pageSeq = M.createPageOrdinalSource();
  const recorder = M.createCallRecorder({ nextSeq: pageSeq.next });
  const fence = (action, arg) => {
    const rep = { hw: pageSeq.highWater(), pending: pageSeq.pending() };
    const r = sb(action, clone({ ...arg, ...rep, pageFatalSent: 0 }));
    if (!r.ok) throw new Error(r.reason);
    pageSeq.ack(rep.hw);
    return r;
  };
  const sync = { attribution: async (a) => { fence('attribution', a); }, gate: async (c1) => fence('gate', { c1 }).gate };
  const run = await M.runChecksInPhaseOrder({ mode: 'live', recorder, sync, drivers: { P1: async () => ({ checks: { C1: M.makeCheckRecord({ verdict: 'PASS' }) } }) }, phases: M.PHASE_ORDER.filter((p) => p.id === 'P1') });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.equal(run.gates.C1.c1FinalizedSeq, node.authority.seqOfOrdinal(run.checks.C1.finalizedSeq), 'the gate carries C1\'s authoritative seq');
  assert.deepEqual(node.violations, []);
});

// ==========================================================================================
// H2 -- authoritativeGateProblems / c1FinalizedSeq translation
// ==========================================================================================

function finalizedC1(verdict = 'PASS', seq = 3) {
  return H.finalizeC1Record(H.makeCheckRecord(verdict === 'PASS' ? { verdict } : { verdict, reason: 'harness-exception:P1' }), { seq, at: '2026-10-01T00:00:00.000Z' }).record;
}

test('H2: authoritativeGateProblems accepts a real prepareC1Gate record and rejects wrong keys, gateSeq <= c1.finalizedSeq, a c1 binding mismatch and an outcome mismatch', () => {
  const c1 = finalizedC1();
  const alloc = H.createRunSeqAllocator();
  for (let i = 0; i < 3; i += 1) alloc.next();
  const gate = H.prepareC1Gate({ c1, errorLedger: H.createEmptyErrorLedger(), seqOf: alloc.next });
  assert.deepEqual(H.authoritativeGateProblems(gate, c1), []);
  assert.deepEqual([gate.outcome, gate.gateSeq], ['OPEN', 4]);
  const bad = (patch, del = null) => { const g = { ...clone(gate), ...patch }; if (del) delete g[del]; return H.authoritativeGateProblems(g, c1); };
  assert.deepEqual(bad({ extra: 1 }), ['keys']);
  assert.deepEqual(bad({}, 'notStarted'), ['keys']);
  assert.deepEqual(bad({ gateSeq: c1.finalizedSeq }), ['gateSeq-order']);
  assert.deepEqual(bad({ gateSeq: c1.finalizedSeq - 1 }), ['gateSeq-order']);
  assert.deepEqual(bad({ gateSeq: 'x' }), ['gateSeq-order']);
  assert.deepEqual(bad({ c1FinalizedSeq: c1.finalizedSeq + 1 }), ['c1-binding']);
  assert.deepEqual(bad({ c1Verdict: 'FAIL' }), ['c1-binding']);
  assert.deepEqual(bad({ c1Reason: 'x' }), ['c1-binding']);
  assert.deepEqual(bad({ outcome: 'CLOSED_OTHER' }), ['outcome']);
  assert.deepEqual(bad({ fatalCountAtGate: 1 }), ['outcome'], 'OPEN with a fatal counted is inconsistent');
  assert.deepEqual(bad({ fatalCountAtGate: -1 }), ['fatalCountAtGate']);
  assert.deepEqual(H.authoritativeGateProblems(null, c1), ['not-an-object']);
  assert.deepEqual(H.authoritativeGateProblems(gate, null), ['not-an-object']);
  // a gate prepared for ANOTHER C1 is refused
  assert.ok(H.authoritativeGateProblems(gate, finalizedC1('PASS', 2)).includes('c1-binding'));
});

/** A page-side C1 finalized on a page ordinal (as runChecksInPhaseOrder does), plus its fence report. */
function pageC1(src, attr = { phase: 'P1', activeCheck: 'C1', activeControl: null }) {
  const ord = src.next(attr, 'event', 'wrapper-restore');
  return { ord, c1: finalizedC1('PASS', ord) };
}

test('H2: the gate binding translates C1\'s page ordinal to its authoritative seq BEFORE allocating gateSeq; the page validates against that seq; an unreported C1 ordinal is refused (gate-c1-unmapped)', () => {
  const node = nodeWorld();
  const sb = node.bindings[H.G2_NODE_SYNC_BINDING];
  const src = H.createPageOrdinalSource();
  node.authority.syncPage({ phase: 'P1', activeCheck: 'C1', activeControl: null, pending: [], hw: BASE_ORD });
  node.runSeq.next(); // a Node event before the gate
  const { ord, c1 } = pageC1(src);
  const r = sb('gate', clone({ c1, pending: src.pending(), hw: src.highWater(), pageFatalSent: 0 }));
  assert.equal(r.ok, true);
  const seq = node.authority.seqOfOrdinal(ord);
  assert.deepEqual([r.gate.c1FinalizedSeq, r.gate.gateSeq, r.gate.outcome], [seq, seq + 1, 'OPEN']);
  assert.equal(H.isPageLocalOrdinal(r.gate.c1FinalizedSeq), false);
  assert.deepEqual(H.authoritativeGateProblems(r.gate, { ...c1, finalizedSeq: r.gate.c1FinalizedSeq }), [], 'what runChecksInPhaseOrder validates');
  assert.ok(H.authoritativeGateProblems(r.gate, c1).includes('c1-binding'), 'against the raw page ordinal the binding does not hold');
  // a C1 whose ordinal never reached Node
  const node2 = nodeWorld();
  const src2 = H.createPageOrdinalSource();
  const p = pageC1(src2);
  const peek = node2.runSeq.peek();
  assert.deepEqual(node2.bindings[H.G2_NODE_SYNC_BINDING]('gate', clone({ c1: p.c1, pending: [], hw: BASE_ORD, pageFatalSent: 0 })), { ok: false, reason: 'gate-c1-unmapped' });
  assert.equal(node2.runSeq.peek(), peek, 'no gateSeq allocated');
});

test('H2 non-vacuity: a gate binding that does not ingest first (mutated binding text) cannot map C1 (fail closed); one that also skips the translation hands out gateSeq below C1\'s page ordinal (gateSeq-order) and a page-local c1FinalizedSeq', () => {
  const ingestLines = 'const ing = authority.ingestFence(a);\n            if (!ing.ok) return ing;\n            authority.reconcilePageFatals(a.pageFatalSent);\n            const c1 = ';
  const translate = 'const mapped = c1 && isPageLocalOrdinal(c1.finalizedSeq) ? authority.seqOfOrdinal(c1.finalizedSeq) : (c1 ? c1.finalizedSeq : undefined);';
  const call = (source) => {
    const node = nodeWorld({ bindingSource: source });
    Object.assign(node.attribution, { phase: 'P1', activeCheck: 'C1', activeControl: null });
    const src = H.createPageOrdinalSource();
    const { c1 } = pageC1(src);
    return { c1, r: node.bindings[H.G2_NODE_SYNC_BINDING]('gate', clone({ c1, pending: src.pending(), hw: src.highWater(), pageFatalSent: 0 })) };
  };
  assert.equal(call(SOURCE).r.ok, true);
  const noIngest = mutate(SOURCE, [[ingestLines, 'authority.reconcilePageFatals(a.pageFatalSent);\n            const c1 = ']]);
  assert.deepEqual(call(noIngest).r, { ok: false, reason: 'gate-c1-unmapped' });
  const neither = mutate(noIngest, [[translate, 'const mapped = c1 ? c1.finalizedSeq : undefined;']]);
  const { c1, r } = call(neither);
  assert.equal(r.ok, true);
  assert.ok(H.isPageLocalOrdinal(r.gate.c1FinalizedSeq));
  assert.ok(r.gate.gateSeq < c1.finalizedSeq);
  assert.ok(H.authoritativeGateProblems(r.gate, c1).includes('gateSeq-order'));
});

test('H2: runChecksInPhaseOrder refuses (throws) an authoritative gate that fails authoritativeGateProblems', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { mapResult: (r, action) => (action === 'gate' ? { ...r, gate: { ...r.gate, gateSeq: r.gate.c1FinalizedSeq } } : r) } });
  await assert.rejects(runPage(page, node, { drv: drivers(page) }), /authoritative gate refused \(gateSeq-order\)/);
});

// ==========================================================================================
// H2 -- the authoritative gate on the Node ledger (real flow)
// ==========================================================================================

test('H2: a Node fatal immediately before the gate is counted by the Node gate (CLOSED_OTHER), while the page mirror has not seen it yet; gateSeq > c1.finalizedSeq and > the fatal; a Node fatal after the gate gets seq > gateSeq', async () => {
  const node = nodeWorld({ mirrorDelayMs: 200 });
  const page = pageRealm();
  const atGate = {};
  connect(page, node, {
    [H.G2_NODE_SYNC_BINDING]: {
      before: (action) => { if (action === 'gate') atGate.mirrorKinds = [...page.g.fatal.kinds]; },
      after: (r, action) => { if (action === 'gate') { node.sink.recordFatal('pageerror', 'after the gate'); atGate.afterSeq = node.ledger.entries.at(-1).seq; } },
    },
  });
  let p2ran = false;
  const run = await runPage(page, node, {
    drv: drivers(page, {
      P1: async (ctx, pass) => {
        const r = fakeRequest({ url: `${BASE}/clashpanel/viewer/viewerApi.js`, resourceType: 'script' });
        node.request(r);
        node.respond(r, 500); // Node-side fatal (R-1), the last thing before C1 finalization + gate
        return { checks: { C1: pass() } };
      },
      P2: async () => { p2ran = true; return {}; },
    }),
  });
  const gate = run.gates.C1;
  const fatalEntry = node.ledger.entries[0];
  assert.equal(fatalEntry.kind, H.NETWORK_FATAL_ENTRY_KIND);
  assert.deepEqual(atGate.mirrorKinds, [], 'the page mirror had not received the fatal when the gate was prepared');
  assert.deepEqual([gate.fatalCountAtGate, gate.outcome, gate.c1Verdict], [1, 'CLOSED_OTHER', 'PASS']);
  assert.ok(gate.gateSeq > run.checks.C1.finalizedSeq && gate.gateSeq > fatalEntry.seq);
  assert.equal(H.recomputeFatalCountAtGate(node.ledger, gate.gateSeq).count, 1, 'the Node ledger recount agrees');
  assert.ok(atGate.afterSeq > gate.gateSeq, 'post-gate Node fatal ordered after the gate');
  assert.equal(p2ran, false, 'closed gate: no downstream phase');
  assert.equal(run.checks.C2.recordType, 'gate-disposition');
  assert.deepEqual(node.violations, []);
  assert.deepEqual(singleNamespaceProblems(node, seqStateOf(node, run)), []);
});

test('H2 contrast: the same Node fatal with the pre-remediation page-mirror gate (sync absent, errorLedger = page latch) opens the gate -- the defect the authoritative gate removes', async () => {
  const node = nodeWorld({ mirrorDelayMs: 200 });
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { absent: true } });
  const run = await runPage(page, node, {
    errorLedger: () => ({ fatalCount: page.g.fatal.kinds.length, entries: page.g.fatal.kinds.map((kind) => ({ kind })) }),
    drv: drivers(page, {
      P1: async (ctx, pass) => {
        const r = fakeRequest({ url: `${BASE}/clashpanel/viewer/viewerApi.js`, resourceType: 'script' });
        node.request(r);
        node.respond(r, 500);
        return { checks: { C1: pass() } };
      },
    }),
    drainMs: 0,
  });
  assert.ok(node.ledger.entries.some((e) => e.kind === H.NETWORK_FATAL_ENTRY_KIND));
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN'], 'mirror-based gate misses the Node fatal');
});

test('H2: the gate ignores a supplied page errorLedger -- only the Node ledger is counted (clean Node ledger + dirty mirror => OPEN); gateSeq comes from the Node allocator', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const run = await runPage(page, node, { errorLedger: { fatalCount: 2, entries: [{ kind: 'x', seq: 1 }, { kind: 'y', seq: 2 }] }, drv: drivers(page) });
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN']);
  assert.ok(node.allocLog.includes(run.gates.C1.gateSeq) && !node.authority.ingested().some((e) => e.seq === run.gates.C1.gateSeq), 'the gateSeq was allocated by Node, not ingested from the page');
});

test('H2: a page fatal forwarded immediately before the gate (delivered first) is counted; ids reconcile; no violation', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_FATAL_BINDING]: { delay: 1 }, [H.G2_NODE_SYNC_BINDING]: { delay: 6 } });
  const run = await runPage(page, node, { drv: drivers(page, { P1: async (ctx, pass) => { page.pageFatal('boom'); return { checks: { C1: pass() } }; } }) });
  assert.equal(page.g.pageFatalSent, 1);
  assert.deepEqual(node.ledger.entries.map((e) => e.kind), ['unhandledrejection']);
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [1, 'CLOSED_OTHER']);
  assert.ok(node.ledger.entries[0].seq < run.gates.C1.gateSeq);
  assert.deepEqual(node.violations, []);
});

test('H2: a page fatal whose transfer is LATE (arrives after the gate) => the gate fails closed (mismatch fatal counted, CLOSED_OTHER); the late fatal is reconciled at final without a second violation', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_FATAL_BINDING]: { delay: 150 }, [H.G2_NODE_SYNC_BINDING]: { delay: 1 } });
  const run = await runPage(page, node, { drv: drivers(page, { P1: async (ctx, pass) => { page.pageFatal('late'); return { checks: { C1: pass() } }; } }), drainMs: 200 });
  const gate = run.gates.C1;
  assert.deepEqual([gate.fatalCountAtGate, gate.outcome], [1, 'CLOSED_OTHER']);
  assert.deepEqual(node.ledger.entries.map((e) => [e.kind, e.kind === 'harness-exception' ? e.detail : null]), [['harness-exception', 'cross-realm-fence:page-fatal-transfer-mismatch'], ['unhandledrejection', null]]);
  assert.ok(node.ledger.entries[0].seq < gate.gateSeq && node.ledger.entries[1].seq > gate.gateSeq);
  assert.deepEqual(node.violations, ['page-fatal-transfer-mismatch'], 'exactly one violation');
  assert.equal(node.authority.reconcilePageFatals(1), true, 'final transfer complete');
});

test('H2 non-vacuity: a gate binding that does NOT reconcile the page fatals before preparing the gate (mutated binding text) opens the gate on the late-transfer scenario', async () => {
  const mutatedSource = mutate(SOURCE, [['authority.reconcilePageFatals(a.pageFatalSent);\n            const c1 = isPlainObject(a.c1)', 'const c1 = isPlainObject(a.c1)']]);
  const node = nodeWorld({ bindingSource: mutatedSource });
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_FATAL_BINDING]: { delay: 150 }, [H.G2_NODE_SYNC_BINDING]: { delay: 1 } });
  const run = await runPage(page, node, { drv: drivers(page, { P1: async (ctx, pass) => { page.pageFatal('late'); return { checks: { C1: pass() } }; } }), drainMs: 200 });
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN']);
});

test('H2: a gate request whose high-water does not match its entries is refused by Node (ingest-hw-mismatch) and the page run throws', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'gate') a[1].hw -= 1; } } });
  await assert.rejects(runPage(page, node, { drv: drivers(page) }), /C1 gate refused by the node authority \(ingest-hw-mismatch\)/);
  assert.equal(node.ledger.markers.length, 0);
  assert.deepEqual(node.violations, ['ingest-hw-mismatch']);
});

test('H2: a page fatal during the drain (after the gate, before final) is reconciled at final; a dropped one fails closed exactly once at final', async () => {
  for (const drop of [false, true]) {
    const node = nodeWorld();
    const page = pageRealm();
    connect(page, node, { [H.G2_NODE_FATAL_BINDING]: { delay: 1, drop: () => drop } });
    const run = await runPage(page, node, { drv: drivers(page), beforeFinal: async () => { page.pageFatal('drain'); await sleep(5); } });
    assert.deepEqual([run.gates.C1.outcome, run.gates.C1.fatalCountAtGate], ['OPEN', 0], 'the drain fatal is not a pre-gate fatal');
    assert.equal(page.g.pageFatalSent, 1);
    if (!drop) {
      assert.deepEqual([node.violations, node.ledger.entries.map((e) => e.kind)], [[], ['unhandledrejection']]);
      assert.ok(node.ledger.entries[0].seq > run.gates.C1.gateSeq);
    } else {
      assert.deepEqual(node.violations, ['page-fatal-transfer-mismatch'], 'one violation although final and the post-run fence both reconcile');
      assert.deepEqual(node.ledger.entries.map((e) => e.detail), ['cross-realm-fence:page-fatal-transfer-mismatch']);
    }
  }
});

test('H2: a Node-originated fatal mirrored into the page latch (g2MarkFatal) is NOT a page-origin fatal: counted once, no reconciliation mismatch', async () => {
  const node = nodeWorld({ mirrorDelayMs: 1 });
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { delay: 2 } });
  const run = await runPage(page, node, {
    drv: drivers(page, { P1: async (ctx, pass) => { node.emit('pageerror', new Error('node saw it')); await sleep(10); return { checks: { C1: pass() } }; } }),
  });
  assert.deepEqual(clone(page.g.fatal.kinds), ['pageerror'], 'the mirror reached the page latch before the gate');
  assert.equal(page.g.pageFatalSent, 0);
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [1, 'CLOSED_OTHER']);
  assert.deepEqual(node.ledger.entries.map((e) => e.kind), ['pageerror']);
  assert.deepEqual(node.violations, []);
});

test('H2: page-fatal id reconciliation -- duplicate id, gap, missing, unnumbered (ambiguous) and invalid counts all fail closed exactly once; exact 1..n passes; the fatal binding early-ingests the reported ordinals', () => {
  const fresh = () => {
    const node = nodeWorld();
    return { node, fwd: (meta) => node.bindings[H.G2_NODE_FATAL_BINDING]('unhandledrejection', 'x', meta) };
  };
  // exact (+ the reported pending ordinals are early-ingested)
  let { node, fwd } = fresh();
  Object.assign(node.attribution, { ...P1 });
  const src = H.createPageOrdinalSource();
  src.next({ ...P1 }, 'spy');
  fwd({ id: 1, hw: src.highWater(), pending: src.pending() });
  fwd({ id: 2, hw: src.highWater(), pending: src.pending() });
  assert.equal(node.authority.lastOrdinal(), BASE_ORD + 1);
  assert.equal(node.authority.reconcilePageFatals(2), true);
  assert.deepEqual([node.violations, node.ledger.fatalCount], [[], 2]);
  assert.equal(node.authority.reconcilePageFatals(0), false, 'a count lower than received is a mismatch');
  assert.deepEqual(node.violations, ['page-fatal-transfer-mismatch']);
  for (const [label, metas, sent] of [
    ['duplicate id 1', [{ id: 1 }, { id: 1 }], 1],
    ['duplicate id 1 (sent 2)', [{ id: 1 }, { id: 1 }], 2],
    ['missing id 2', [{ id: 1 }], 2],
    ['gap: ids 1,3', [{ id: 1 }, { id: 3 }], 2],
    ['unnumbered transfer', [undefined], 0],
    ['id 0', [{ id: 0 }], 0],
    ['invalid count', [{ id: 1 }], '1'],
    ['negative count', [], -1],
  ]) {
    ({ node, fwd } = fresh());
    for (const m of metas) fwd(m);
    assert.equal(node.authority.reconcilePageFatals(sent), false, label);
    assert.equal(node.authority.reconcilePageFatals(sent), false, `${label} (again)`);
    assert.deepEqual(node.violations, ['page-fatal-transfer-mismatch'], `${label}: exactly once`);
    assert.equal(node.ledger.entries.filter((e) => e.detail === 'cross-realm-fence:page-fatal-transfer-mismatch').length, 1, label);
    assert.equal(node.ledger.entries.filter((e) => e.kind === 'unhandledrejection').length, metas.length, `${label}: every forwarded fatal is still recorded`);
  }
  // via the gate binding: missing transfer => the mismatch fatal is IN the gate count
  ({ node } = fresh());
  const src2 = H.createPageOrdinalSource();
  node.authority.syncPage({ phase: 'P1', activeCheck: 'C1', activeControl: null, pending: [], hw: BASE_ORD });
  const { c1 } = pageC1(src2);
  const r = node.bindings[H.G2_NODE_SYNC_BINDING]('gate', clone({ c1, pending: src2.pending(), hw: src2.highWater(), pageFatalSent: 1 }));
  assert.equal(r.ok, true);
  assert.deepEqual([r.gate.fatalCountAtGate, r.gate.outcome], [1, 'CLOSED_OTHER']);
  assert.deepEqual(H.authoritativeGateProblems(r.gate, { ...c1, finalizedSeq: r.gate.c1FinalizedSeq }), []);
  assert.ok(r.gate.gateSeq > r.gate.c1FinalizedSeq && r.gate.gateSeq > node.ledger.entries[0].seq);
});

test('H2: the sync binding fails closed on unknown actions, an unmapped/absent C1 and a throwing gate preparation (never a silent ok)', () => {
  const node = nodeWorld();
  const sb = node.bindings[H.G2_NODE_SYNC_BINDING];
  assert.deepEqual(sb('nope', {}), { ok: false, reason: 'unknown-action' });
  const fence = { pending: [], hw: BASE_ORD };
  assert.deepEqual(sb('gate', { c1: { verdict: 'PASS' }, pageFatalSent: 0, ...fence }), { ok: false, reason: 'gate-c1-unmapped' });
  assert.deepEqual(sb('gate', { pageFatalSent: 0, ...fence }), { ok: false, reason: 'gate-c1-unmapped' });
  assert.deepEqual(sb('gate', { c1: { verdict: 'PASS', finalizedSeq: 1 }, pageFatalSent: 0, ...fence }), { ok: false, reason: 'threw:TypeError' }, 'an unfinalized C1 cannot be gated');
  // a hw-less gate / drain request is refused at the fence before anything else
  const peek = node.runSeq.peek();
  assert.deepEqual(sb('gate', { c1: finalizedC1('PASS', 1), pageFatalSent: 0 }), { ok: false, reason: 'ingest-hw-mismatch' });
  assert.deepEqual(sb('drain', { pageFatalSent: 0 }), { ok: false, reason: 'ingest-hw-mismatch' });
  assert.equal(node.runSeq.peek(), peek + 2, 'only the two violation fatal entries were allocated (no gateSeq)');
  assert.deepEqual(node.violations, ['ingest-hw-mismatch', 'ingest-hw-mismatch']);
  assert.equal(sb('drain', { pageFatalSent: 0, pending: [], hw: BASE_ORD }).ok, true);
  assert.deepEqual(sb('drain', { pageFatalSent: 0, pending: [], hw: BASE_ORD + 1 }), { ok: false, reason: 'ingest-hw-mismatch' });
});
