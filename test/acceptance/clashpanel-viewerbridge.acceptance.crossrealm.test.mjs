// test/acceptance/clashpanel-viewerbridge.acceptance.crossrealm.test.mjs
//
// Offline tests for the G2 live-readiness remediation of the cross-realm defects (review H1 / H2):
//
//  H1  ONE composite sequence across the page and Node realms (`createRunSeqCounter` node minors,
//      `createPageSeqSource` page majors, `realmOfSeq`, reserved-minor overflow => row-5
//      `seq-not-unique`) and Node-authoritative phase/check/control attribution delivered through the
//      awaited `G2_NODE_SYNC_BINDING` fence (`createRunAuthority.syncPage`), so a C16 hide abort is
//      attributed to P9 and classified EC-hide instead of a stale-P1 fatal.
//  H2  the C1 gate prepared synchronously by Node on the AUTHORITATIVE error ledger (never on the
//      asynchronous page fatal mirror), plus the page-origin fatal id reconciliation.
//
// The cross-realm flows use the REAL page agent bundle (`buildPageAgentSource`, loaded in a node:vm
// context like pageagent.test.mjs) for the page half (`runChecksInPhaseOrder`, `g2NodeSync`,
// `g2NodeOps`, `runAcknowledgedMutation`, `g2AgentReady` fatal forwarding, `g2MarkFatal`) and the REAL
// Node binding bodies, sliced verbatim out of `runPostReservation`'s source and instantiated over the
// same Node objects `runPostReservation` builds (sink, run counter, authority, network instrumentation,
// operation ledger). The page<->Node channel is an artificially DELAYED, JSON-serialising stand-in for
// Playwright's exposeFunction. Non-vacuity: the guarded behaviours are re-run against MUTATED COPIES of
// the harness source (tmp sandbox, as mainflow.test.mjs does) or of the sliced binding text and shown to
// fail. Nothing here imports playwright, launches a browser or touches the network; the real harness
// keeps LIVE_PATH_WIRED=false and G2_DUAL_COUNTER_GATE.resolved=false.

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
const STRIDE = H.SEQ_STRIDE;
const RESERVED = H.SEQ_MINOR_RESERVED;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

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

/** The `(...) => {...}` passed to `live.page.exposeFunction(<name>, ...)` inside runPostReservation. */
function bindingText(source, name) {
  const head = `await live.page.exposeFunction(${name}, `;
  assert.equal(source.split(head).length - 1, 1, `exactly one exposeFunction(${name})`);
  const i = source.indexOf(head);
  const j = source.indexOf('\n      });', i);
  assert.ok(i !== -1 && j > i);
  return { text: source.slice(i + head.length, j + '\n      }'.length), at: i };
}

function instantiate(text, scope) {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `'use strict';\nreturn (${text});`)(...names.map((n) => scope[n]));
}

// Exact runPostReservation lines this file's Node world reproduces (asserted below, so the world
// cannot silently drift from the harness).
const RPR_LINES = Object.freeze([
  'const runSeq = createRunSeqCounter();',
  "const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };",
  'const sink = createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });',
  "const authority = createRunAuthority({ counter: runSeq, attribution: nodeAttribution, onViolation: (reason) => { sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });",
  'ledger: state.errorLedger, nextSeq: runSeq.next, sink, baseUrl, rules: responseRules,',
  'attribution: () => ({ ...nodeAttribution }),',
  'const ops = createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock });',
  "Object.assign(nodeAttribution, { phase: 'P1', activeCheck: null, activeControl: null });",
  'authority.ingestHw(run.pageHighWater);',
  'authority.reconcilePageFatals(run.pageFatalSent);',
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

function nodeWorld({ M = H, bindingSource = SOURCE, mirrorDelayMs = 5 } = {}) {
  const ledger = M.createEmptyErrorLedger();
  const state = { errorLedger: ledger };
  const runSeq = M.createRunSeqCounter();
  const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const sink = M.createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });
  const violations = [];
  const authority = M.createRunAuthority({ counter: runSeq, attribution: nodeAttribution, onViolation: (reason) => { violations.push(reason); sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });
  let mirror = null; // the page's g2MarkFatal (Node -> page rpc, asynchronous)
  const mirrorCalls = [];
  const mirrorToPage = (arg) => { mirrorCalls.push(arg); if (mirror) setTimeout(() => mirror(arg), mirrorDelayMs); };
  const net = M.createNetworkInstrumentation({
    ledger: state.errorLedger, nextSeq: runSeq.next, sink, baseUrl: BASE, rules: M.OPTIONAL_RESPONSE_RULES,
    attribution: () => ({ ...nodeAttribution }), mainFrame: () => 'main',
    onFatalWitness: () => mirrorToPage({ kind: M.NETWORK_FATAL_ENTRY_KIND }),
  });
  const ops = M.createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next });
  // runPostReservation's `fatal`: record on the Node ledger, then mirror into the page latch (g2MarkFatal).
  const fatal = (kind, detail) => { const recorded = sink.recordFatal(kind, String(detail)); if (recorded) mirrorToPage({ kind }); return recorded; };
  const em = new EventEmitter();
  const page = { on: (e, f) => em.on(e, f), off: (e, f) => em.off(e, f) };
  M.wireFatalListeners({ page, browser: null, live: { closingIntent: false }, fatal, network: net });
  const scope = {
    authority, fatal, ops, state, runSeq, sink,
    clock: { nowIso: () => new Date().toISOString() },
    responseRules: M.OPTIONAL_RESPONSE_RULES,
    prepareC1Gate: M.prepareC1Gate, provisionalFinalization: M.provisionalFinalization, syncFatalWitnesses: M.syncFatalWitnesses,
    isPlainObject: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), // same body as the harness's
    summarizeThrown: (err) => ({ name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err }),
  };
  const bindings = {
    [M.G2_NODE_FATAL_BINDING]: instantiate(bindingText(bindingSource, 'G2_NODE_FATAL_BINDING').text, scope),
    [M.G2_NODE_OPLEDGER_BINDING]: instantiate(bindingText(bindingSource, 'G2_NODE_OPLEDGER_BINDING').text, scope),
    [M.G2_NODE_SYNC_BINDING]: instantiate(bindingText(bindingSource, 'G2_NODE_SYNC_BINDING').text, scope),
  };
  const w = {
    M, ledger, state, runSeq, attribution: nodeAttribution, sink, authority, violations, net, ops, bindings, mirrorCalls,
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

const PAGE_EXPOSE = ['runChecksInPhaseOrder', 'g2NodeSync', 'g2NodeOps', 'g2MarkFatal', 'g2AgentReady', 'g2PageState', 'createPageSeqSource',
  'createCallRecorder', 'runAcknowledgedMutation', 'makeCheckRecord', 'makeControlRecord', 'PHASE_ORDER'];
const PAGE_BUNDLE = (() => {
  const src = H.buildPageAgentSource(SOURCE).source;
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  assert.equal(src.split(reg).length - 1, 1);
  return src.replace(reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
})();

function pageRealm({ bundle = PAGE_BUNDLE } = {}) {
  const listeners = {};
  const window = { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); }, removeEventListener: () => {} };
  const ctx = vm.createContext({ window, TextEncoder, TextDecoder, URL, performance, setTimeout, clearTimeout, setInterval, clearInterval, crypto: { randomUUID }, console });
  vm.runInContext(bundle, ctx);
  const t = window.__t;
  const g = t.g2PageState();
  // As g2BuildEnv: the page recorder draws from the page half of the cross-realm sequence.
  const pageSeq = t.createPageSeqSource();
  g.seq = pageSeq;
  const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
  t.g2AgentReady(); // installs the page-origin fatal forwarding (unhandledrejection)
  return {
    window, t, g, pageSeq, recorder,
    /** A page-origin fatal (forwarded to G2_NODE_FATAL_BINDING with {id, hw}). */
    pageFatal: (msg) => { for (const f of listeners.unhandledrejection || []) f({ reason: new Error(msg) }); },
  };
}

/**
 * Connects the page to the Node bindings over a delayed, JSON-serialising channel (Playwright
 * exposeFunction stand-in). Per binding: `delay` (ms), `before(...args)` (runs at Node delivery, before
 * the binding), `after(result, ...args)`, `tamper(args)` (mutates the delivered args), `mapResult`,
 * `drop(...args)` (true => the call never reaches Node; the page promise never settles, like a lost
 * transfer).
 */
function connect(page, node, opts = {}) {
  for (const name of [H.G2_NODE_FATAL_BINDING, H.G2_NODE_OPLEDGER_BINDING, H.G2_NODE_SYNC_BINDING]) {
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

/** g2RunPhases + the runPostReservation post-run fences (offline-fake mode; sync from the real g2NodeSync()). */
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
  node.authority.ingestHw(page.pageSeq.highWater());
  node.authority.reconcilePageFatals(page.g.pageFatalSent);
  return run;
}

/** The C16 hide driver: a request in flight when the acknowledged hide starts is aborted by it. */
function hideDriver(page, node, seen) {
  return async (ctx, pass, ok) => {
    await ctx.beginCheck('C16');
    seen.attrAfterBeginCheck = { ...node.attribution };
    const r = fakeRequest({ url: `${PREFIX_B}/stream.bin` });
    node.request(r);
    await page.t.runAcknowledgedMutation({
      ops: page.t.g2NodeOps(), desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' },
      recorder: page.recorder, method: 'viewer.hideModel', args: [],
      invoke: () => { node.fail(r); },
    });
    await ctx.beginCheck('C17');
    for (const n of ctx.runnable.controls) await ctx.beginControl(n);
    return { checks: { C16: pass(), C17: pass() }, controls: Object.fromEntries(ctx.runnable.controls.map((n) => [n, ok(n)])) };
  };
}

function seqStateOf(node, page, run) {
  return {
    errorLedger: { ...node.ledger, markers: [...node.ledger.markers, ...clone(run.markers)] },
    spyLedger: clone(page.recorder.records), eventLog: clone(run.eventLog), gates: clone(run.gates), checks: clone(run.checks), controls: clone(run.controls),
  };
}

// ==========================================================================================
// Static: the world above is bound to the harness text; dormancy unchanged
// ==========================================================================================

test('static: Node world lines and the three binding bodies are runPostReservation\'s own; live stays dormant; exports present', () => {
  const body = SOURCE.slice(RPR.start, RPR.end);
  for (const line of RPR_LINES) assert.equal(body.split(line).length - 1, 1, line);
  for (const n of ['G2_NODE_FATAL_BINDING', 'G2_NODE_OPLEDGER_BINDING', 'G2_NODE_SYNC_BINDING']) {
    const { at } = bindingText(SOURCE, n);
    assert.ok(at > RPR.start && at < RPR.end, `${n} is exposed inside runPostReservation`);
  }
  // the post-run fences come before any other allocation of the drain
  const iIngest = body.indexOf('authority.ingestHw(run.pageHighWater);');
  const iApply = body.indexOf('applyPhaseRunToState(state, run);');
  const iObserve = body.indexOf('runSeq.observe(maxRecordedSeq(state));');
  assert.ok(iApply < iIngest && iIngest < body.indexOf('authority.reconcilePageFatals(run.pageFatalSent);') && body.indexOf("'cross-realm-fence:seq-minor-overflow'") < iObserve);
  assert.equal(body.includes('seqBase'), false, 'the page numbering is no longer seeded');
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, false);
  assert.equal(H.G2_NODE_SYNC_BINDING, '__g2NodeSync');
  assert.deepEqual([STRIDE, RESERVED], [1048576, 1048575]);
});

// ==========================================================================================
// H1 -- the composite cross-realm sequence
// ==========================================================================================

test('H1: pre-run Node seqs are 1,2,3 (major 0); realmOfSeq derives the realm from the seq alone', () => {
  const c = H.createRunSeqCounter();
  assert.deepEqual([c.next(), c.next(), c.next()], [1, 2, 3]);
  assert.deepEqual([c.peek(), c.pageMajor(), c.overflowed()], [3, 0, false]);
  assert.deepEqual([1, 3, STRIDE, STRIDE + 1, 7 * STRIDE, 7 * STRIDE + RESERVED].map(H.realmOfSeq), ['node', 'node', 'page', 'node', 'page', 'node']);
  for (const bad of [-1, 1.5, null, undefined, '3', NaN]) assert.equal(H.realmOfSeq(bad), null, String(bad));
});

test('H1: interleaved Node/page allocations (randomised, seeded) never collide; each realm strictly monotone; a Node allocation after a fence follows every reported page allocation', () => {
  let x = 0x2545f491;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  for (let trial = 0; trial < 20; trial += 1) {
    const c = H.createRunSeqCounter();
    const p = H.createPageSeqSource();
    const all = new Set();
    const nodeSeqs = [];
    const pageSeqs = [];
    for (const s of [c.next(), c.next(), c.next()]) { all.add(s); nodeSeqs.push(s); }
    for (let i = 0; i < 400; i += 1) {
      const r = rnd();
      if (r < 0.35) { const s = p.next(); assert.equal(H.realmOfSeq(s), 'page'); pageSeqs.push(s); assert.ok(!all.has(s)); all.add(s); }
      else if (r < 0.55) {
        // fence: Node ingests the page high-water; its next allocation follows every reported page seq
        assert.equal(c.ingestPage(p.highWater()), true);
        const s = c.next();
        assert.ok(pageSeqs.every((q) => q < s), 'post-fence node seq after every page seq');
        assert.ok(!all.has(s)); all.add(s); nodeSeqs.push(s);
      } else { const s = c.next(); assert.equal(H.realmOfSeq(s), 'node'); assert.ok(!all.has(s)); all.add(s); nodeSeqs.push(s); }
    }
    for (let i = 1; i < nodeSeqs.length; i += 1) assert.ok(nodeSeqs[i] > nodeSeqs[i - 1], 'node strictly monotone');
    for (let i = 1; i < pageSeqs.length; i += 1) assert.ok(pageSeqs[i] > pageSeqs[i - 1], 'page strictly monotone');
    assert.ok(nodeSeqs.every((s) => H.realmOfSeq(s) === 'node'));
  }
  // concrete interleaving
  const c = H.createRunSeqCounter();
  const p = H.createPageSeqSource();
  const seq = [c.next(), p.next(), c.next()];
  assert.deepEqual(seq, [1, STRIDE, 2], 'inside one fence epoch a Node event is ordered only after the page\'s last REPORTED allocation (documented limitation)');
  c.ingestPage(p.highWater());
  assert.deepEqual([c.next(), c.next(), p.next(), c.next()], [STRIDE + 1, STRIDE + 2, 2 * STRIDE, STRIDE + 3]);
  c.ingestPage(2);
  assert.equal(c.next(), 2 * STRIDE + 1, 'a new page major restarts the minor');
});

test('H1: ingestPage never regresses (lower / invalid high-water refused, equal is a no-op keeping the minor)', () => {
  const c = H.createRunSeqCounter();
  assert.equal(c.ingestPage(3), true);
  assert.equal(c.next(), 3 * STRIDE + 1);
  assert.equal(c.next(), 3 * STRIDE + 2);
  for (const bad of [2, 0, -1, 3.5, '4', null, undefined, NaN]) assert.equal(c.ingestPage(bad), false, String(bad));
  assert.equal(c.pageMajor(), 3);
  assert.equal(c.ingestPage(3), true);
  assert.equal(c.next(), 3 * STRIDE + 3, 'equal high-water does not reset the minor');
  assert.equal(c.observe(2 * STRIDE), 3 * STRIDE + 3, 'observe never moves backwards');
});

test('H1: minor exhaustion => the single reserved minor is repeated (overflowed()) => primarySeqAllocations / recordSchemaProblems report seq-not-unique', () => {
  const c = H.createRunSeqCounter();
  c.ingestPage(1);
  let last = null;
  for (let i = 0; i < RESERVED - 1; i += 1) last = c.next();
  assert.equal(last, STRIDE + RESERVED - 1, 'the last ordinary minor is STRIDE-2');
  assert.equal(c.overflowed(), false);
  const o1 = c.next();
  const o2 = c.next();
  assert.deepEqual([o1, o2], [STRIDE + RESERVED, STRIDE + RESERVED]);
  assert.equal(c.overflowed(), true);
  assert.equal(H.realmOfSeq(o1), 'node', 'the reserved value never collides with a page seq');
  const p = H.createPageSeqSource();
  p.next();
  assert.ok(p.next() > o1);
  const ledger = H.createEmptyErrorLedger();
  ledger.markers.push({ seq: o1, name: 'x' }, { seq: o2, name: 'y' });
  const st = { errorLedger: ledger };
  const probs = H.primarySeqAllocations(st).problems;
  assert.ok(probs.some((q) => q.startsWith(`seq-not-unique:${o1}:`)), JSON.stringify(probs));
  assert.ok(H.recordSchemaProblems(st).some((q) => q.startsWith(`seq-not-unique:${o1}:`)));
  // a later page fence restarts the minors (overflow stays latched for the closeout fatal)
  c.ingestPage(2);
  assert.equal(c.next(), 2 * STRIDE + 1);
  assert.equal(c.overflowed(), true);
});

test('H1 non-vacuity: with the reserved-minor clamp removed the counter walks into the next page major (silent collision with a page seq)', async () => {
  const M = await importMutated([['if (minor >= SEQ_MINOR_RESERVED - 1) { overflowed = true; minor = SEQ_MINOR_RESERVED; return value(); }', '']]);
  const c = M.createRunSeqCounter();
  c.ingestPage(1);
  let last = null;
  for (let i = 0; i < STRIDE; i += 1) last = c.next();
  assert.equal(last, 2 * STRIDE, 'collides with the page\'s next allocation');
  assert.equal(M.realmOfSeq(last), 'page');
  assert.equal(c.overflowed(), false);
});

// ==========================================================================================
// H1 -- createRunAuthority.syncPage (the attribution fence)
// ==========================================================================================

function authorityWorld(M = H) {
  const counter = M.createRunSeqCounter();
  const attribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const violations = [];
  const authority = M.createRunAuthority({ counter, attribution, onViolation: (r) => violations.push(r) });
  return { counter, attribution, violations, authority };
}

const REFUSALS = Object.freeze([
  ['hw regression', { hw: 2, phase: 'P9', activeCheck: 'C16', activeControl: null }, 'sync-hw-invalid'],
  ['hw not an integer', { hw: 4.5, phase: 'P9', activeCheck: null, activeControl: null }, 'sync-hw-invalid'],
  ['hw missing (not an object)', null, 'sync-hw-invalid'],
  ['phase not in the enum', { hw: 4, phase: 'P99', activeCheck: null, activeControl: null }, 'sync-phase-invalid'],
  ['phase regression', { hw: 4, phase: 'P8', activeCheck: null, activeControl: null }, 'sync-phase-regressed'],
  ['activeCheck not a check', { hw: 4, phase: 'P9', activeCheck: 'C21', activeControl: null }, 'sync-activeCheck-invalid'],
  ['activeCheck not owned by the phase', { hw: 4, phase: 'P9', activeCheck: 'C2', activeControl: null }, 'sync-activeCheck-phase-inconsistent'],
  ['activeCheck in a non-check phase', { hw: 4, phase: 'cleanup', activeCheck: 'C16', activeControl: null }, 'sync-activeCheck-phase-inconsistent'],
  ['activeControl not a control', { hw: 4, phase: 'P9', activeCheck: 'C16', activeControl: 'N9' }, 'sync-activeControl-invalid'],
]);

/** Brings an authority to {P9, C16, null} at page major 3. */
function toP9(w) {
  assert.equal(w.authority.isSynced(), false);
  for (const rep of [
    { hw: 0, phase: 'P1', activeCheck: 'C1', activeControl: null },
    { hw: 1, phase: 'P2', activeCheck: null, activeControl: 'N1' },
    { hw: 1, phase: 'P2', activeCheck: null, activeControl: null }, // same phase, same hw: allowed
    { hw: 3, phase: 'P9', activeCheck: 'C16', activeControl: null },
  ]) assert.deepEqual(w.authority.syncPage(rep), { ok: true }, JSON.stringify(rep));
  assert.equal(w.authority.isSynced(), true);
  assert.deepEqual([w.attribution, w.counter.pageMajor(), w.authority.phase(), w.violations], [{ phase: 'P9', activeCheck: 'C16', activeControl: null }, 3, 'P9', []]);
}

test('H1: syncPage accepts forward moves (adopts attribution, ingests the high-water); every invalid report is refused with attribution and counter unchanged and exactly one onViolation', () => {
  const w = authorityWorld();
  toP9(w);
  assert.equal(w.counter.next(), 3 * STRIDE + 1);
  for (const [label, rep, reason] of REFUSALS) {
    const before = { attr: { ...w.attribution }, major: w.counter.pageMajor(), peek: w.counter.peek(), nv: w.violations.length };
    assert.deepEqual(w.authority.syncPage(rep), { ok: false, reason }, label);
    assert.deepEqual(w.attribution, before.attr, `${label}: attribution unchanged`);
    assert.deepEqual([w.counter.pageMajor(), w.counter.peek()], [before.major, before.peek], `${label}: counter unchanged`);
    assert.deepEqual(w.violations.slice(before.nv), [reason], `${label}: exactly one violation`);
  }
  // undefined activeCheck/activeControl normalise to null; a later valid forward report still adopted
  assert.deepEqual(w.authority.syncPage({ hw: 5, phase: 'P10' }), { ok: true });
  assert.deepEqual(w.attribution, { phase: 'P10', activeCheck: null, activeControl: null });
  // a refused FIRST report never marks the authority synced
  const w2 = authorityWorld();
  assert.equal(w2.authority.syncPage({ hw: 0, phase: 'nope' }).ok, false);
  assert.equal(w2.authority.isSynced(), false);
  assert.deepEqual(w2.attribution, { phase: 'P0', activeCheck: null, activeControl: null });
  // a throwing onViolation cannot turn a refusal into an acceptance
  const w3 = H.createRunAuthority({ counter: H.createRunSeqCounter(), attribution: { phase: 'P0', activeCheck: null, activeControl: null }, onViolation: () => { throw new Error('x'); } });
  assert.deepEqual(w3.syncPage({ hw: -1, phase: 'P1' }), { ok: false, reason: 'sync-hw-invalid' });
});

test('H1 non-vacuity: removing each syncPage guard (mutated copies) lets the corresponding invalid report through', async () => {
  const guards = [
    ["if (!Number.isInteger(r.hw) || r.hw < counter.pageMajor()) return violate('sync-hw-invalid');", 'hw regression'],
    ["if (!ATTRIBUTION_PHASES.includes(r.phase)) return violate('sync-phase-invalid');", 'phase not in the enum'],
    ["if (phaseIndex(r.phase) < phaseIndex(attribution.phase)) return violate('sync-phase-regressed');", 'phase regression'],
    ["if (activeControl !== null && !CONTROL_NAMES.includes(activeControl)) return violate('sync-activeControl-invalid');", 'activeControl not a control'],
    ["if (activeCheckPhaseProblem({ phase: r.phase, activeCheck }) !== null) return violate('sync-activeCheck-phase-inconsistent');", 'activeCheck not owned by the phase'],
  ];
  for (const [line, label] of guards) {
    const M = await importMutated([[line, '']]);
    const w = authorityWorld(M);
    toP9(w);
    const rep = REFUSALS.find((r) => r[0] === label)[1];
    const got = w.authority.syncPage(rep);
    if (label === 'phase not in the enum') {
      // defence in depth: an unknown phase has index -1, so the regression guard still refuses it --
      // but with the wrong attribution of the defect (the enum guard is what names it).
      assert.deepEqual(got, { ok: false, reason: 'sync-phase-regressed' }, label);
      continue;
    }
    assert.equal(got.ok, true, `${label}: accepted without its guard`);
    assert.deepEqual(w.violations, [], label);
  }
});

// ==========================================================================================
// H1 -- the real cross-realm flow: hide/unload attribution
// ==========================================================================================

test('H1 cross-realm flow: runChecksInPhaseOrder (page bundle) + g2NodeSync over a delayed channel => the C16 hide abort is attributed P9/C16 and classified EC-hide; no fatal; seqs unique across realms', async () => {
  const node = nodeWorld();
  node.loads();
  assert.deepEqual(node.ledger.requestObservations.map((o) => o.startSeq).slice(0, 2), [2, 6], 'pre-run node seqs are major 0 (beginLoad 1, request 2, finished 3, endLoad 4, beginLoad 5, request 6)');
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { delay: 4 }, [H.G2_NODE_OPLEDGER_BINDING]: { delay: 1 } });
  const seen = {};
  const run = await runPage(page, node, { drv: drivers(page, { P9: hideDriver(page, node, seen) }) });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.deepEqual(seen.attrAfterBeginCheck, { phase: 'P9', activeCheck: 'C16', activeControl: null }, 'the awaited fence: Node holds P9/C16 before the driver acts');
  const rf = node.ledger.requestFailures;
  assert.equal(rf.length, 1);
  assert.deepEqual([rf[0].phase, rf[0].activeCheck, rf[0].closeout.classification, rf[0].closeout.rule, rf[0].closeout.phase], ['P9', 'C16', 'expected-cancellation', 'EC-hide', 'P9']);
  assert.deepEqual([node.ledger.fatalCount, node.ledger.entries, node.violations], [0, [], []], 'no false fatal from a stale P1');
  const op = node.ledger.opLedger.find((o) => o.operationType === 'hide');
  assert.deepEqual([op.phase, op.invokedBy, op.terminalOutcome], ['P9', 'C16', 'settled']);
  // cross-realm order at the fences
  const p9 = run.markers.find((m) => m.name === 'P9');
  const spy = page.recorder.records.find((r) => r.method === 'viewer.hideModel');
  assert.equal(H.realmOfSeq(p9.seq), 'page');
  assert.ok(p9.seq < node.ledger.requestObservations.at(-1).startSeq, 'the P9 request starts after the P9 marker');
  assert.ok(rf[0].startSeq < op.startSeq && op.startSeq < op.ackSeq && op.ackSeq < spy.seq && op.ackSeq < rf[0].failSeq, 'request < begin < ack < {spy record, abort}');
  assert.equal(op.causalEvidence.spyRef, `spyLedger:seq:${spy.seq}`);
  assert.deepEqual([H.realmOfSeq(op.startSeq), H.realmOfSeq(spy.seq), H.realmOfSeq(run.gates.C1.gateSeq), H.realmOfSeq(run.checks.C1.finalizedSeq)], ['node', 'page', 'node', 'page']);
  assert.ok(run.gates.C1.gateSeq > run.checks.C1.finalizedSeq);
  assert.deepEqual(H.primarySeqAllocations(seqStateOf(node, page, run)).problems, [], 'no collision between realms');
  assert.deepEqual(node.attribution, { phase: 'cleanup', activeCheck: null, activeControl: null }, 'the last fence is the cleanup marker');
  assert.equal(node.runSeq.overflowed(), false);
});

test('H1 contrast: the same abort when the page never synced (no sync binding) stays P1 and is fatal-required-resource (C-e) -- the fix is the attribution', async () => {
  const node = nodeWorld();
  node.loads();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { absent: true } });
  assert.equal(page.t.g2NodeSync(), null);
  const seen = {};
  const run = await runPage(page, node, { drv: drivers(page, { P9: hideDriver(page, node, seen) }) });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.deepEqual(seen.attrAfterBeginCheck, { phase: 'P1', activeCheck: null, activeControl: null });
  const rf = node.ledger.requestFailures;
  assert.deepEqual([rf[0].phase, rf[0].closeout.classification], ['P1', 'fatal-required-resource']);
  assert.ok(rf[0].closeout.reasons.includes('C-e'), JSON.stringify(rf[0].closeout.reasons));
  assert.equal(node.ledger.fatalCount, 1);
});

test('H1 non-vacuity: an authority that acknowledges but does not adopt the attribution (mutated copy) => the abort is fatal again', async () => {
  const M = await importMutated([['Object.assign(attribution, { phase: r.phase, activeCheck, activeControl });', '']]);
  const node = nodeWorld({ M });
  node.loads();
  const page = pageRealm();
  connect(page, node);
  const run = await runPage(page, node, { drv: drivers(page, { P9: hideDriver(page, node, {}) }) });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  const rf = node.ledger.requestFailures;
  assert.equal(rf[0].phase, 'P1');
  assert.equal(rf[0].closeout.classification, 'fatal-required-resource');
  assert.equal(node.ledger.fatalCount, 1);
});

test('H1 non-vacuity: a page that fires the attribution sync without awaiting it (mutated page bundle) races the delayed channel => stale attribution => fatal', async () => {
  const awaited = 'const syncAttr = async () => { if (sync && typeof sync.attribution === \'function\') await sync.attribution(rec.attribution()); };';
  const mutatedSource = mutate(SOURCE, [[awaited, 'const syncAttr = async () => { if (sync && typeof sync.attribution === \'function\') sync.attribution(rec.attribution()).catch(() => {}); };']]);
  const src = H.buildPageAgentSource(mutatedSource).source;
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  const node = nodeWorld();
  node.loads();
  const page = pageRealm({ bundle: src.replace(reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`) });
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { delay: 15 }, [H.G2_NODE_OPLEDGER_BINDING]: { delay: 1 } });
  const seen = {};
  await runPage(page, node, { drv: drivers(page, { P9: hideDriver(page, node, seen) }), drainMs: 40 });
  assert.notDeepEqual(seen.attrAfterBeginCheck, { phase: 'P9', activeCheck: 'C16', activeControl: null });
  const rf = node.ledger.requestFailures;
  assert.notEqual(rf[0].closeout.classification, 'expected-cancellation', JSON.stringify(rf[0].closeout));
  assert.ok(node.ledger.fatalCount >= 1);
});

test('H1: the operation-ledger binding refuses a begin whose phase differs from the authoritative phase once synced; before any sync it is not phase-checked', () => {
  const node = nodeWorld();
  const begin = node.bindings[H.G2_NODE_OPLEDGER_BINDING];
  const desc = { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16', hw: 0 };
  assert.equal(begin('begin', desc).ok, true, 'unsynced: legacy behaviour');
  assert.deepEqual(node.authority.syncPage({ hw: 2, phase: 'P8', activeCheck: null, activeControl: null }), { ok: true });
  assert.deepEqual(begin('begin', { ...desc, hw: 2 }), { ok: false, reason: 'phase-mismatch' });
  assert.equal(node.ledger.opLedger.length, 1, 'nothing appended on a phase mismatch');
  node.authority.syncPage({ hw: 3, phase: 'P9', activeCheck: 'C16', activeControl: null });
  const ok = begin('begin', { ...desc, hw: 5 });
  assert.equal(ok.ok, true);
  assert.equal(node.runSeq.pageMajor(), 5, 'the op begin is a fence (high-water ingested first)');
  assert.ok(node.ledger.opLedger.at(-1).startSeq > 5 * STRIDE);
});

test('H1: a refused attribution sync throws in the page BEFORE the attributed action runs (driver action not executed; units BLOCKED harness-exception; one violation; attribution unchanged)', async () => {
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
        return {};
      },
    }),
  });
  assert.equal(acted, false, 'the action after the refused fence never ran');
  assert.deepEqual(nodeAttrAtRefusal, { phase: 'P9', activeCheck: null, activeControl: null });
  assert.deepEqual(node.violations, ['sync-activeControl-invalid']);
  assert.deepEqual(node.ledger.entries.map((e) => [e.kind, e.detail]), [['harness-exception', 'cross-realm-fence:sync-activeControl-invalid']]);
  const p9 = run.phaseLog.find((e) => e.phase === 'P9');
  assert.match(p9.error.message, /attribution sync refused by the node authority \(sync-activeControl-invalid\)/);
  assert.equal(run.checks.C16.reason, 'harness-exception:P9');
  assert.equal(run.sessionTainted, true);
});

test('H1: a refused phase marker sync rejects the whole page run (fail-closed, no driver of that phase runs)', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'attribution' && a[1].phase === 'P3') a[1].hw = -1; } } });
  let p3ran = false;
  await assert.rejects(runPage(page, node, { drv: drivers(page, { P3: async () => { p3ran = true; return {}; } }) }), /attribution sync refused by the node authority \(sync-hw-invalid\)/);
  assert.equal(p3ran, false);
  assert.deepEqual(node.violations, ['sync-hw-invalid']);
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
  const pageSeq = M.createPageSeqSource();
  const recorder = M.createCallRecorder({ nextSeq: pageSeq.next });
  const sync = {
    attribution: async (a) => { const r = sb('attribution', clone({ hw: pageSeq.highWater(), ...a })); if (!r.ok) throw new Error(r.reason); },
    gate: async (c1) => { const r = sb('gate', clone({ hw: pageSeq.highWater(), c1, pageFatalSent: 0 })); if (!r.ok) throw new Error(r.reason); return r.gate; },
  };
  const run = await M.runChecksInPhaseOrder({ mode: 'live', recorder, sync, drivers: { P1: async () => ({ checks: { C1: M.makeCheckRecord({ verdict: 'PASS' }) } }) }, phases: M.PHASE_ORDER.filter((p) => p.id === 'P1') });
  assert.equal(run.gates.C1.outcome, 'OPEN');
  assert.deepEqual(node.violations, []);
});

// ==========================================================================================
// H2 -- authoritativeGateProblems
// ==========================================================================================

function finalizedC1(verdict = 'PASS', seq = 3 * STRIDE) {
  return H.finalizeC1Record(H.makeCheckRecord(verdict === 'PASS' ? { verdict } : { verdict, reason: 'harness-exception:P1' }), { seq, at: '2026-10-01T00:00:00.000Z' }).record;
}

test('H2: authoritativeGateProblems accepts a real prepareC1Gate record and rejects wrong keys, gateSeq <= c1.finalizedSeq, a c1 binding mismatch and an outcome mismatch', () => {
  const c1 = finalizedC1();
  const counter = H.createRunSeqCounter();
  counter.ingestPage(3);
  const gate = H.prepareC1Gate({ c1, errorLedger: H.createEmptyErrorLedger(), seqOf: counter.next });
  assert.deepEqual(H.authoritativeGateProblems(gate, c1), []);
  assert.equal(gate.outcome, 'OPEN');
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
  assert.ok(H.authoritativeGateProblems(gate, finalizedC1('PASS', 2 * STRIDE)).includes('c1-binding'));
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
  assert.equal(node.ledger.fatalCount, 1);
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN'], 'mirror-based gate misses the Node fatal');
});

test('H2: the gate ignores a supplied page errorLedger -- only the Node ledger is counted (clean Node ledger + dirty mirror => OPEN)', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node);
  const run = await runPage(page, node, { errorLedger: { fatalCount: 2, entries: [{ kind: 'x', seq: 1 }, { kind: 'y', seq: 2 }] }, drv: drivers(page) });
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN']);
  assert.equal(H.realmOfSeq(run.gates.C1.gateSeq), 'node', 'the gateSeq was allocated by Node');
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
  const mutatedSource = mutate(SOURCE, [['authority.reconcilePageFatals(a.pageFatalSent);\n            const gate = prepareC1Gate({', 'const gate = prepareC1Gate({']]);
  const node = nodeWorld({ bindingSource: mutatedSource });
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_FATAL_BINDING]: { delay: 150 }, [H.G2_NODE_SYNC_BINDING]: { delay: 1 } });
  const run = await runPage(page, node, { drv: drivers(page, { P1: async (ctx, pass) => { page.pageFatal('late'); return { checks: { C1: pass() } }; } }), drainMs: 200 });
  assert.deepEqual([run.gates.C1.fatalCountAtGate, run.gates.C1.outcome], [0, 'OPEN']);
});

test('H2 non-vacuity: a gate binding that does not ingest the page high-water first (mutated binding text) allocates gateSeq below the page high-water the gate request reports', () => {
  // The attribution fences already report the high-water, so the gate fence is the SECOND line of defence:
  // exercise it directly with a high-water that advanced after the last fence.
  const c1 = { recordType: H.RECORD_TYPE.CHECK_RUN, verdict: 'PASS', reason: null, finalizedSeq: 5 * STRIDE };
  const good = nodeWorld();
  const g = good.bindings[H.G2_NODE_SYNC_BINDING]('gate', { hw: 5, c1, pageFatalSent: 0 });
  assert.equal(g.ok, true);
  assert.ok(g.gate.gateSeq > c1.finalizedSeq);
  assert.deepEqual(H.authoritativeGateProblems(g.gate, c1), []);
  const mutatedSource = mutate(SOURCE, [["if (!authority.ingestHw(a.hw)) return { ok: false, reason: 'gate-hw-invalid' };", '']]);
  const bad = nodeWorld({ bindingSource: mutatedSource });
  const r = bad.bindings[H.G2_NODE_SYNC_BINDING]('gate', { hw: 5, c1, pageFatalSent: 0 });
  assert.ok(r.gate.gateSeq < c1.finalizedSeq);
  assert.ok(H.authoritativeGateProblems(r.gate, c1).includes('gateSeq-order'));
});

test('H2: a gate request whose high-water regressed is refused by Node (gate-hw-invalid) and the page run throws', async () => {
  const node = nodeWorld();
  const page = pageRealm();
  connect(page, node, { [H.G2_NODE_SYNC_BINDING]: { tamper: (a) => { if (a[0] === 'gate') a[1].hw = 0; } } });
  await assert.rejects(runPage(page, node, { drv: drivers(page) }), /C1 gate refused by the node authority \(gate-hw-invalid\)/);
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

test('H2: page-fatal id reconciliation -- duplicate id, gap, missing, unnumbered (ambiguous) and invalid counts all fail closed exactly once; exact 1..n passes', () => {
  const fresh = () => {
    const node = nodeWorld();
    return { node, fwd: (meta) => node.bindings[H.G2_NODE_FATAL_BINDING]('unhandledrejection', 'x', meta) };
  };
  // exact
  let { node, fwd } = fresh();
  fwd({ id: 1, hw: 0 }); fwd({ id: 2, hw: 1 });
  assert.equal(node.authority.reconcilePageFatals(2), true);
  assert.deepEqual([node.violations, node.ledger.fatalCount, node.runSeq.pageMajor()], [[], 2, 1]);
  assert.equal(node.authority.reconcilePageFatals(0), false, 'a count lower than received is a mismatch');
  assert.deepEqual(node.violations, ['page-fatal-transfer-mismatch']);
  for (const [label, metas, sent] of [
    ['duplicate id 1', [{ id: 1, hw: 0 }, { id: 1, hw: 0 }], 1],
    ['duplicate id 1 (sent 2)', [{ id: 1, hw: 0 }, { id: 1, hw: 0 }], 2],
    ['missing id 2', [{ id: 1, hw: 0 }], 2],
    ['gap: ids 1,3', [{ id: 1, hw: 0 }, { id: 3, hw: 0 }], 2],
    ['unnumbered transfer', [undefined], 0],
    ['id 0', [{ id: 0, hw: 0 }], 0],
    ['invalid count', [{ id: 1, hw: 0 }], '1'],
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
  node.authority.syncPage({ hw: 2, phase: 'P1', activeCheck: 'C1', activeControl: null });
  const c1 = finalizedC1('PASS', 3 * STRIDE);
  const r = node.bindings[H.G2_NODE_SYNC_BINDING]('gate', clone({ hw: 3, c1, pageFatalSent: 1 }));
  assert.equal(r.ok, true);
  assert.deepEqual([r.gate.fatalCountAtGate, r.gate.outcome], [1, 'CLOSED_OTHER']);
  assert.deepEqual(H.authoritativeGateProblems(r.gate, c1), []);
  assert.ok(r.gate.gateSeq > c1.finalizedSeq && r.gate.gateSeq > node.ledger.entries[0].seq);
});

test('H2: the sync binding fails closed on unknown actions and on a throwing gate preparation (never a silent ok)', () => {
  const node = nodeWorld();
  const sb = node.bindings[H.G2_NODE_SYNC_BINDING];
  assert.deepEqual(sb('nope', {}), { ok: false, reason: 'unknown-action' });
  const r = sb('gate', { hw: 0, c1: { verdict: 'PASS' }, pageFatalSent: 0 });
  assert.deepEqual(r, { ok: false, reason: 'threw:TypeError' }, 'an unfinalized C1 cannot be gated');
  assert.equal(sb('drain', { hw: 0, pageFatalSent: 0 }).ok, true);
});
