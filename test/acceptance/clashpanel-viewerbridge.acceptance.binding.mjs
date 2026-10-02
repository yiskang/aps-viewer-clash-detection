// test/acceptance/clashpanel-viewerbridge.acceptance.binding.mjs
//
// H1 local Playwright binding integration test (remediation prompt §6). NON-APS, NON-Viewer, NON-network:
// a real headless Chromium page on about:blank, the REAL Playwright `page.exposeFunction` page<->Node
// binding mechanism, and the REAL harness pieces on both sides:
//
//  page  the shipped page-agent bundle (`buildPageAgentSource`, installed with `page.addInitScript`):
//        `createPageOrdinalSource` (wired by the verbatim g2BuildEnv lines, early-hint deliver included),
//        `createCallRecorder`, `g2FenceReport`/`g2FenceAck`, `g2NodeSync`, `g2NodeOps`;
//  Node  ONE `createRunSeqAllocator`, `createRunAuthority`, `createOperationLedger`, and the binding bodies
//        of G2_NODE_SYNC_BINDING / G2_NODE_OPLEDGER_BINDING / G2_NODE_INGEST_BINDING sliced VERBATIM out of
//        `runPostReservation` and instantiated over those objects.
//
// The only test-owned code is instrumentation around the bindings (Node-side order log, artificial delays,
// throwing/tampering deliveries) plus two test-only bindings: `__testEffect` (the observable effect of a
// simulated attributed page action) and `__testNodeEvent` (a Node-origin event allocated mid-flow).
// Authoritative ordering point = Node ingestion; the namespace invariant checked everywhere is:
// every authoritative seq (page-ingested, Node-origin, operation ledger) is unique, < PAGE_LOCAL_BASE, and
// together they are exactly 1..allocator.peek().
//
// Nothing here loads Autodesk Viewer / APS / fixtures or needs an authorization record. The harness is
// never edited; mutations are applied to in-memory copies of the page bundle.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const BASE = H.PAGE_LOCAL_BASE;
const SYNC = H.G2_NODE_SYNC_BINDING;
const OPS = H.G2_NODE_OPLEDGER_BINDING;
const INGEST = H.G2_NODE_INGEST_BINDING;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ------------------------------------------------------------------------------------------
// Harness slices (verbatim)
// ------------------------------------------------------------------------------------------

function once(source, needle) {
  assert.equal(source.split(needle).length - 1, 1, `exactly one occurrence required: ${needle}`);
  return source.indexOf(needle);
}

/** The `(...) => ...` passed to `live.page.exposeFunction(<name>, ...)` inside runPostReservation. */
function bindingText(name) {
  const head = `await live.page.exposeFunction(${name}, `;
  const i = once(SOURCE, head) + head.length;
  const eol = SOURCE.indexOf('\n', i);
  const line = SOURCE.slice(i, eol);
  if (line.endsWith('));')) return line.slice(0, -2); // one-line binding
  const j = SOURCE.indexOf('\n      });', i);
  assert.ok(j > i);
  return SOURCE.slice(i, j + '\n      }'.length);
}

function instantiate(text, scope) {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `'use strict';\nreturn (${text});`)(...names.map((n) => scope[n]));
}

const { start: ipS, end: ipE } = H.locateFunctionSource(SOURCE, 'isPlainObject');
// eslint-disable-next-line no-new-func
const isPlainObject = new Function(`'use strict';\n${SOURCE.slice(ipS, ipE)}\nreturn isPlainObject;`)();
// summarizeThrown is not exported (and needs the redaction helpers); only reached on a binding-body throw.
const summarizeThrown = (e) => ({ name: e && typeof e.name === 'string' ? e.name : typeof e });

const BINDING_TEXT = Object.freeze({ [SYNC]: bindingText('G2_NODE_SYNC_BINDING'), [OPS]: bindingText('G2_NODE_OPLEDGER_BINDING'), [INGEST]: bindingText('G2_NODE_INGEST_BINDING') });
assert.match(BINDING_TEXT[INGEST], /^\(entry\) => authority\.ingestEarly\(\[entry\]\)$/);

// The exact g2BuildEnv wiring of the page ordinal source (early-hint deliver included).
const PAGE_SEQ_WIRING = (() => {
  const a = once(SOURCE, '  const ingestFn = window[G2_NODE_INGEST_BINDING];');
  const b = once(SOURCE, '  g.seq = pageSeq;');
  assert.ok(b > a);
  const text = SOURCE.slice(a, b);
  assert.match(text, /const pageSeq = createPageOrdinalSource\(\{ deliver:/);
  return text;
})();

// The shipped page bundle, plus a test-only handle on the in-page declarations it already contains.
const PAGE_EXPOSE = ['g2NodeSync', 'g2NodeOps', 'g2FenceReport', 'g2FenceAck', 'g2PageState', 'createPageOrdinalSource', 'createCallRecorder', 'runAcknowledgedMutation', 'PAGE_LOCAL_BASE', 'G2_NODE_INGEST_BINDING'];
function exposeIn(bundle) {
  const reg = 'window.__g2HarnessFns = Object.freeze(';
  once(bundle, reg);
  return bundle.replace(reg, `window.__t = { ${PAGE_EXPOSE.join(', ')} };\n${reg}`);
}
const RAW_BUNDLE = H.buildPageAgentSource(SOURCE).source;
const PAGE_BUNDLE = exposeIn(RAW_BUNDLE);

// ------------------------------------------------------------------------------------------
// Browser lifecycle
// ------------------------------------------------------------------------------------------

let browser = null;
before(async () => {
  const { chromium } = await import('playwright'); // as runPostReservation's importBrowserPackage
  browser = await chromium.launch({ headless: true });
});
after(async () => { if (browser) await browser.close(); });

// ------------------------------------------------------------------------------------------
// One world = Node authority + one fresh page connected through the real bindings
// ------------------------------------------------------------------------------------------

/**
 * `opts[bindingName]`: `delay(...args)` ms before the body runs (Node side), `throws(...args)` => the
 * binding rejects, `tamper(args)` mutates the delivered args before the body, `secondAllocator` (Node
 * events drawn from a SECOND counter -- the negative dual-counter case). `bundle` overrides the page bundle.
 */
async function openWorld(opts = {}) {
  const allocator = H.createRunSeqAllocator();
  const nodeAlloc = opts.secondAllocator ? H.createRunSeqAllocator() : allocator;
  const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const violations = [];
  const authority = H.createRunAuthority({ allocator, attribution: nodeAttribution, onViolation: (r) => { violations.push(r); } });
  const ledger = H.createEmptyErrorLedger();
  const ops = H.createOperationLedger({ ledger, nextSeq: allocator.next });
  const scope = { authority, ops, isPlainObject, isPageLocalOrdinal: H.isPageLocalOrdinal, summarizeThrown };
  const bodies = Object.fromEntries(Object.entries(BINDING_TEXT).map(([n, t]) => [n, instantiate(t, scope)]));
  const log = [];
  const t0 = performance.now();
  const note = (what, extra = {}) => { log.push({ i: log.length, at: performance.now() - t0, what, ...extra }); };
  const nodeEvents = [];
  const nodeEvent = (label) => { const e = { seq: nodeAlloc.next(), label }; nodeEvents.push(e); note('node-event', { label, seq: e.seq }); return e; };

  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(String(e && e.message)); });
  for (const name of [SYNC, OPS, INGEST]) {
    const o = opts[name] || {};
    await page.exposeFunction(name, async (...args) => {
      const action = name === INGEST ? 'hint' : String(args[0]);
      const ord = name === INGEST && args[0] ? args[0].ord - BASE : undefined;
      note(`recv:${name}`, { action, ord });
      const d = o.delay ? o.delay(...args) : 0;
      if (d > 0) await sleep(d);
      if (o.throws && o.throws(...args)) { note(`throw:${name}`, { action, ord }); throw new Error(`test: ${name} delivery failed`); }
      if (o.tamper) o.tamper(args);
      const r = bodies[name](...args);
      note(`ack:${name}`, { action, ord, ok: r && r.ok, reason: r && r.reason, count: r && r.count, phase: name === SYNC && args[1] ? args[1].phase : undefined, effectsAtAck: log.filter((x) => x.what === 'effect').length });
      return r;
    });
  }
  await page.exposeFunction('__testEffect', (label, ord) => { note('effect', { label, ord: ord - BASE }); return true; });
  await page.exposeFunction('__testNodeEvent', (label) => nodeEvent(label).seq);
  await page.addInitScript({ content: opts.bundle || PAGE_BUNDLE });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><title>g2 binding test</title><body></body>');
  await page.evaluate((wiring) => {
    const t = window.__t;
    const g = t.g2PageState();
    // eslint-disable-next-line no-new-func
    const pageSeq = new Function('createPageOrdinalSource', 'G2_NODE_INGEST_BINDING', 'window', `${wiring}\nreturn pageSeq;`)(t.createPageOrdinalSource, t.G2_NODE_INGEST_BINDING, window);
    g.seq = pageSeq;
    const recorder = t.createCallRecorder({ nextSeq: pageSeq.next });
    const w = { t, g, pageSeq, recorder, sync: t.g2NodeSync(), ops: t.g2NodeOps(), effects: [] };
    /** A simulated attributed page action, in runChecksInPhaseOrder's order: set attribution, awaited sync, act. */
    w.act = async (label, attr) => {
      recorder.setAttribution(attr);
      recorder.logEvent('transition', { label });
      await w.sync.attribution(recorder.attribution()); // throws on refusal: the action below never starts
      const e = recorder.logEvent('action', { label });
      await window.__testEffect(label, e.seq);
      w.effects.push(label);
      return e.seq;
    };
    window.__w = w;
  }, PAGE_SEQ_WIRING);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  /** Runs `act` in the page; `{ok, ord}` or `{ok:false, message}`. */
  const act = (label, attr) => ev(async ([l, a]) => { try { return { ok: true, ord: await window.__w.act(l, a) }; } catch (e) { return { ok: false, message: String(e && e.message) }; } }, [label, attr]);
  const emit = (n, kind = 'evt') => ev(([k, c]) => Array.from({ length: c }, () => window.__w.recorder.logEvent(k).seq), [kind, n]);
  const drain = () => ev(async () => { try { await window.__w.sync.drain(); return { ok: true }; } catch (e) { return { ok: false, message: String(e && e.message) }; } });
  const pageState = () => ev(() => ({ hw: window.__w.pageSeq.highWater(), pending: window.__w.pageSeq.pending().map((e) => e.ord), effects: window.__w.effects.slice(), events: window.__w.recorder.events.map((e) => e.seq) }));
  const waitLog = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred(log)) { if (Date.now() > end) throw new Error('waitLog timeout'); await sleep(5); } };
  const close = async () => { await context.close().catch(() => {}); };
  return { allocator, nodeAlloc, authority, nodeAttribution, violations, ledger, ops, log, note, nodeEvents, nodeEvent, page, pageErrors, act, emit, drain, pageState, ev, waitLog, close };
}

async function withWorld(opts, fn) {
  const w = await openWorld(opts);
  try { return await fn(w); } finally { await w.close(); }
}

/** Every authoritative seq the world holds (page-ingested, Node-origin, operation ledger). */
function authoritativeSeqs(w) {
  const out = [];
  for (const e of w.authority.ingested()) out.push({ seq: e.seq, src: `page:${e.kind}` });
  for (const e of w.nodeEvents) out.push({ seq: e.seq, src: `node:${e.label}` });
  for (const o of w.ledger.opLedger) for (const k of ['startSeq', 'ackSeq', 'endSeq']) if (o[k] !== null) out.push({ seq: o[k], src: `op:${o.operationId}:${k}` });
  return out;
}

/** Namespace problems: duplicates, page-local leaks, non-contiguity vs the ONE allocator. */
function namespaceProblems(allocator, seqs) {
  const problems = [];
  const seen = new Set();
  for (const { seq, src } of seqs) {
    if (!Number.isSafeInteger(seq) || seq < 1) problems.push(`invalid:${src}`);
    else if (seq >= BASE) problems.push(`page-local-leak:${src}`);
    if (seen.has(seq)) problems.push(`duplicate:${seq}:${src}`);
    seen.add(seq);
  }
  const peek = allocator.peek();
  if (seen.size !== peek) problems.push(`count:${seen.size}!=${peek}`);
  for (let s = 1; s <= peek; s += 1) if (!seen.has(s)) problems.push(`missing:${s}`);
  for (const s of seen) if (s > peek) problems.push(`beyond-allocator:${s}`);
  return problems;
}

/** Page-ingested entries are in ingestion order: seq and ord both strictly increasing, each ord once. */
function assertIngestionOrder(w, expectedOrds) {
  const ing = w.authority.ingested();
  assert.deepEqual(ing.map((e) => e.ord), expectedOrds, 'every page ordinal ingested exactly once, in ordinal order');
  for (let i = 1; i < ing.length; i += 1) assert.ok(ing[i].seq > ing[i - 1].seq, 'authoritative seq strictly increasing in ingestion order');
}

const idx = (log, pred) => log.findIndex(pred);
const P1 = { phase: 'P1', activeCheck: null, activeControl: null };
const P9_C16 = { phase: 'P9', activeCheck: 'C16', activeControl: null };

// ============================================================================================
// Tests
// ============================================================================================

test('bundle contract: the page bundle carries the shipped fence/sync/ordinal helpers; the slices are the real binding bodies', () => {
  for (const n of ['function g2FenceReport()', 'function g2FenceAck(', 'function g2NodeSync()', 'function g2NodeOps()', 'function createPageOrdinalSource(', 'const PAGE_LOCAL_BASE = 2 ** 50;']) once(RAW_BUNDLE, n);
  assert.ok(!RAW_BUNDLE.includes('function createRunSeqAllocator('), 'the Node allocator never ships into the page');
  assert.ok(!RAW_BUNDLE.includes('function createRunAuthority('), 'the Node authority never ships into the page');
  assert.match(BINDING_TEXT[SYNC], /authority\.syncPage\(a\)/);
  assert.match(BINDING_TEXT[OPS], /authority\.ingestFence\(a\)/);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, true);
});

test('(1)-(4) awaited page events + interleaved Node-origin events share ONE allocator: unique, monotonic, contiguous 1..peek', async () => {
  await withWorld({}, async (w) => {
    w.nodeEvent('P0-marker'); // Node-origin before the page does anything
    const a = await w.act('enter-P1', P1);
    assert.equal(a.ok, true, a.message);
    const evOrds = await w.emit(3); // page-origin events (early hints fire)
    w.nodeEvent('net-request'); // Node-origin, interleaved
    const fromPage = await w.ev(async () => window.__testNodeEvent('net-response-from-page-flow'));
    assert.ok(fromPage > 0 && fromPage < BASE);
    evOrds.push(...await w.emit(2));
    // operation ledger fences (Node allocates startSeq/ackSeq/endSeq from the same allocator)
    const b = await w.act('enter-P9', P9_C16);
    assert.equal(b.ok, true, b.message);
    const op = await w.ev(async () => {
      const ww = window.__w;
      const beg = await ww.ops.begin({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
      if (!beg.ok) return { beg };
      const spy = ww.recorder.logEvent('spy:hide').seq;
      await window.__testEffect('hide', spy);
      const end = await ww.ops.end({ operationId: beg.operationId, terminalOutcome: 'settled', spyRef: `spyLedger:seq:${spy}` });
      return { beg, end, spy };
    });
    assert.equal(op.beg.ok, true, JSON.stringify(op));
    assert.equal(op.end.ok, true, JSON.stringify(op));
    w.nodeEvent('after-op');
    const d = await w.drain();
    assert.equal(d.ok, true, d.message);

    assert.deepEqual(w.violations, []);
    assert.deepEqual(w.pageErrors, []);
    const st = await w.pageState();
    assert.deepEqual(st.pending, [], 'every page ordinal acknowledged after the drain fence');
    assert.equal(w.authority.lastOrdinal(), st.hw);
    const expected = Array.from({ length: st.hw - BASE }, (_, i) => BASE + 1 + i);
    assertIngestionOrder(w, expected);
    for (const o of evOrds) assert.ok(H.isPageLocalOrdinal(o), 'page values are page-local ordinals, never authoritative-looking');
    assert.deepEqual(namespaceProblems(w.allocator, authoritativeSeqs(w)), []);
    // Operation record ordering against the ingested spy record (Node ingestion order).
    const rec = w.ledger.opLedger[0];
    const spySeq = w.authority.seqOfOrdinal(op.spy);
    assert.ok(rec.startSeq < rec.ackSeq && rec.ackSeq < spySeq && spySeq < rec.endSeq, JSON.stringify({ rec, spySeq }));
    assert.equal(rec.causalEvidence.spyRef, `spyLedger:seq:${spySeq}`, 'the end fence translated the page ordinal to the authoritative seq');
    // Final mapping: the page run rewrites through the ordinal map with no unmapped ordinal.
    const run = w.authority.rewritePageRun({ pageHighWater: st.hw, events: st.events });
    assert.deepEqual(w.violations, []);
    assert.deepEqual(run.events, expected.filter((o) => st.events.includes(o)).map((o) => w.authority.seqOfOrdinal(o)));
    assert.ok(run.events.every((s) => s < BASE));
    assert.equal(w.authority.assertAllocated(Math.max(...run.events)).ok, true);
  });
});

test('(5) the awaited phase-sync is acknowledged by Node before the page action proceeds (even when the ack is slow)', async () => {
  await withWorld({ [SYNC]: { delay: (action) => (action === 'attribution' ? 150 : 0) } }, async (w) => {
    const pending = w.act('enter-P9', P9_C16);
    await sleep(80);
    assert.equal(w.log.filter((x) => x.what === 'effect').length, 0, 'no action effect while the sync ack is outstanding');
    assert.equal(w.authority.phase(), 'P0', 'Node has not adopted the attribution yet');
    const r = await pending;
    assert.equal(r.ok, true, r.message);
    const ack = idx(w.log, (x) => x.what === `ack:${SYNC}` && x.phase === 'P9');
    const eff = idx(w.log, (x) => x.what === 'effect' && x.label === 'enter-P9');
    assert.ok(ack !== -1 && eff > ack, JSON.stringify(w.log));
    assert.equal(w.log[ack].effectsAtAck, 0);
    assert.ok(w.log[eff].at > w.log[ack].at);
    assert.equal(w.authority.phase(), 'P9');
    // The action's own record is attributed against the acknowledged (P9/C16) state once ingested.
    assert.equal((await w.drain()).ok, true);
    const actionEntry = w.authority.ingested().find((e) => e.ord === r.ord);
    assert.deepEqual({ kind: actionEntry.kind, phase: actionEntry.phase, activeCheck: actionEntry.activeCheck }, { kind: 'event', phase: 'P9', activeCheck: 'C16' });
    assert.deepEqual(w.violations, []);
  });
});

test('(6) a rejected phase-sync (regressed phase / inconsistent attribution) prevents the page action and is exactly one violation', async () => {
  await withWorld({}, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const before = w.allocator.peek();
    const r = await w.act('regress-to-P1', P1);
    assert.equal(r.ok, false);
    assert.match(r.message, /attribution sync refused by the node authority \(sync-phase-regressed\)/);
    assert.deepEqual(w.violations, ['sync-phase-regressed']);
    assert.equal(w.authority.phase(), 'P9', 'nothing adopted');
    assert.equal(w.allocator.peek(), before, 'a refused fence ingests nothing');
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'regress-to-P1'));
    assert.ok(!(await w.pageState()).effects.includes('regress-to-P1'));
  });
  // Invalid attribution, early hints disabled: the refused sync itself is exactly one violation.
  await withWorld({ [INGEST]: { throws: () => true } }, async (w) => {
    const r = await w.act('bad-attr', { phase: 'P3', activeCheck: 'C16', activeControl: null });
    assert.equal(r.ok, false);
    assert.match(r.message, /\(sync-activeCheck-phase-inconsistent\)/);
    assert.deepEqual(w.violations, ['sync-activeCheck-phase-inconsistent']);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    assert.equal(w.authority.phase(), 'P0');
    assert.equal(w.allocator.peek(), 0);
  });
  // Same, with the real early hint: the transition ordinal recorded under the invalid attribution is
  // DEFERRED by ingestEarly (never a violation) -- the refused fence is still exactly one violation.
  await withWorld({}, async (w) => {
    const r = await w.act('bad-attr', { phase: 'P3', activeCheck: 'C16', activeControl: null });
    assert.equal(r.ok, false);
    await w.waitLog((l) => l.some((x) => x.what === `ack:${INGEST}`));
    const hint = w.log.find((x) => x.what === `ack:${INGEST}`);
    assert.deepEqual({ ok: hint.ok, count: hint.count }, { ok: true, count: 0 }, 'the malformed hint is deferred to the fence');
    assert.deepEqual(w.violations, ['sync-activeCheck-phase-inconsistent']);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    assert.equal(w.authority.phase(), 'P0');
    assert.equal(w.allocator.peek(), 0);
  });
  // ops begin with a phase that disagrees with the acknowledged authority: refused before the mutation.
  await withWorld({}, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const r = await w.ev(async () => { const b = await window.__w.ops.begin({ operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadB' }); if (b.ok) await window.__testEffect('unload', 0); return b; });
    assert.deepEqual(r, { ok: false, reason: 'phase-mismatch' });
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'unload'));
    assert.equal(w.ledger.opLedger.length, 0);
  });
});

test('(7) delayed/out-of-order early hints and slow fences never create a second namespace: idempotent, nothing ingested twice, ingestion order', async () => {
  const N = 6;
  // Early hints arrive in REVERSE ordinal order and well after the fences; fences are slow too; Node keeps
  // allocating its own events while every page delivery is in flight.
  const hintDelay = (entry) => 40 + (N + 3 - (entry.ord - BASE)) * 25;
  await withWorld({ [INGEST]: { delay: hintDelay }, [SYNC]: { delay: () => 30 } }, async (w) => {
    const ticker = setInterval(() => { w.nodeEvent('tick'); }, 7);
    try {
      const a = await w.act('enter-P1', P1); // its transition ordinal (new attribution) is hinted late
      assert.equal(a.ok, true, a.message);
      const ords = await w.emit(N);
      // a duplicate hint of an entry, sent by the page itself (as a retry would)
      await w.ev(async (o) => { const e = window.__w.pageSeq.pending().find((x) => x.ord === o); await Promise.all([window.__g2NodeIngest(e), window.__g2NodeIngest(e)]); }, ords[0]);
      // concurrency: the page keeps allocating while the drain fence is in flight
      const res = await w.ev(async () => {
        const p = window.__w.sync.drain().then(() => ({ ok: true }), (e) => ({ ok: false, message: String(e.message) }));
        const more = [window.__w.recorder.logEvent('during-fence').seq];
        return { r: await p, more };
      });
      assert.equal(res.r.ok, true, res.r.message);
      assert.equal((await w.drain()).ok, true);
      const totalHints = (await w.pageState()).hw - BASE + 2; // one deliver per ordinal + the two duplicates
      await w.waitLog((l) => l.filter((x) => x.what === `ack:${INGEST}`).length >= totalHints);
    } finally { clearInterval(ticker); }
    const hints = w.log.filter((x) => x.what === `ack:${INGEST}`);
    assert.ok(hints.every((x) => x.ok === true), 'late / duplicate / out-of-order hints are deferred or idempotent, never violations');
    assert.ok(hints.some((x) => x.count === 0), 'some hints arrived after their ordinal was already ingested (idempotent)');
    const firstFenceAck = idx(w.log, (x) => x.what === `ack:${SYNC}`);
    const lastHintAck = w.log.reduce((m, x) => (x.what === `ack:${INGEST}` ? x.i : m), -1);
    assert.ok(lastHintAck > firstFenceAck, 'hints really did arrive after the fences');
    assert.deepEqual(w.violations, []);
    const st = await w.pageState();
    assert.deepEqual(st.pending, []);
    assertIngestionOrder(w, Array.from({ length: st.hw - BASE }, (_, i) => BASE + 1 + i));
    assert.ok(w.nodeEvents.length > 3, 'Node-origin events really interleaved');
    assert.deepEqual(namespaceProblems(w.allocator, authoritativeSeqs(w)), []);
  });
  // Early hints first, fence later: the fence re-sends already-ingested entries (idempotent path).
  await withWorld({ [SYNC]: { delay: () => 80 } }, async (w) => {
    assert.equal((await w.act('enter-P1', P1)).ok, true);
    await w.emit(4);
    await w.waitLog((l) => l.filter((x) => x.what === `ack:${INGEST}` && x.count === 1).length >= 4);
    const peekBefore = w.allocator.peek();
    assert.equal((await w.drain()).ok, true);
    assert.equal(w.allocator.peek(), peekBefore, 'the re-sent entries allocate nothing');
    assert.deepEqual(w.violations, []);
    assertIngestionOrder(w, Array.from({ length: 6 }, (_, i) => BASE + 1 + i));
  });
});

test('(8) late / failing binding delivery fails closed: the page throws before acting and the final mapping reports a violation', async () => {
  // (a) the sync binding rejects (delivery failure): the action never starts; the final transfer refuses.
  await withWorld({ [SYNC]: { throws: (action) => action === 'attribution' } }, async (w) => {
    await w.emit(2); // already early-hinted under P0 and ingested
    const r = await w.act('enter-P9', P9_C16);
    assert.equal(r.ok, false);
    assert.match(r.message, /test: __g2NodeSync delivery failed/);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    assert.equal(w.authority.phase(), 'P0');
    const st = await w.pageState();
    assert.ok(st.pending.length > 0 && w.authority.lastOrdinal() < st.hw, 'the transition ordinal was never ingested');
    w.authority.rewritePageRun({ pageHighWater: st.hw, events: st.events });
    assert.deepEqual(w.violations, ['final-ingest-mismatch', 'page-ordinal-unmapped']);
  });
  // (b) early hints all fail (binding throws) and the fence omits the first pending ordinal => ingest-gap.
  await withWorld({ [INGEST]: { throws: () => true }, [SYNC]: { tamper: (args) => { args[1].pending.shift(); } } }, async (w) => {
    await w.emit(3);
    const r = await w.act('enter-P1', P1);
    assert.equal(r.ok, false);
    assert.match(r.message, /\(ingest-gap\)/);
    assert.deepEqual(w.violations, ['ingest-gap']);
    assert.equal(w.authority.ingested().length, 0, 'atomic: nothing ingested');
    assert.equal(w.allocator.peek(), 0);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    assert.ok((await w.pageState()).pending.length === 4, 'nothing acknowledged on the page');
  });
  // (c) the fence omits the LAST pending ordinal => ingest-hw-mismatch.
  await withWorld({ [INGEST]: { throws: () => true }, [SYNC]: { tamper: (args) => { args[1].pending.pop(); } } }, async (w) => {
    await w.emit(3);
    const r = await w.act('enter-P1', P1);
    assert.equal(r.ok, false);
    assert.match(r.message, /\(ingest-hw-mismatch\)/);
    assert.deepEqual(w.violations, ['ingest-hw-mismatch']);
    assert.equal(w.authority.ingested().length, 0);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
  });
  // (d) the operation-ledger binding rejects: the mutation never starts, nothing allocated for it.
  await withWorld({ [OPS]: { throws: () => true } }, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const r = await w.ev(async () => { try { await window.__w.ops.begin({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }); await window.__testEffect('hide', 0); return { ok: true }; } catch (e) { return { ok: false, message: String(e.message) }; } });
    assert.equal(r.ok, false);
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'hide'));
    assert.equal(w.ledger.opLedger.length, 0);
  });
  // (e) a conflicting duplicate hint (same ordinal, different kind) is deferred: no violation, no second
  // record. A FENCE carrying the same conflict is refused (exactly one violation) and the action is blocked.
  await withWorld({ [SYNC]: { tamper: (args) => { if (args[1].phase === 'P1') args[1].pending[0].kind = 'forged'; } } }, async (w) => {
    const [o] = await w.emit(1);
    await w.waitLog((l) => l.some((x) => x.what === `ack:${INGEST}` && x.count === 1));
    const r = await w.ev(async (ord) => window.__g2NodeIngest({ ord, kind: 'forged', phase: 'P0', activeCheck: null, activeControl: null }), o);
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
    assert.equal(r.deferred, true);
    assert.deepEqual(w.violations, [], 'the early path never records a violation');
    assert.equal(w.authority.ingested().length, 1);
    assert.equal(w.authority.ingested()[0].kind, 'event');
    const peek = w.allocator.peek();
    const a = await w.act('enter-P1', P1); // the fence re-sends ordinal o, tampered to the conflicting kind
    assert.equal(a.ok, false);
    assert.match(a.message, /\(ingest-conflict\)/);
    assert.deepEqual(w.violations, ['ingest-conflict']);
    assert.equal(w.allocator.peek(), peek, 'nothing ingested by the refused fence');
    assert.equal(w.authority.ingested().length, 1);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
  });
  // (e2) a gap carried by early hints alone is deferred; the fence that carries the same gap reports it once.
  await withWorld({ [INGEST]: { tamper: (args) => { args[0] = { ...args[0], ord: args[0].ord + 1 }; } }, [SYNC]: { tamper: (args) => { args[1].pending.shift(); } } }, async (w) => {
    await w.emit(2);
    await w.waitLog((l) => l.filter((x) => x.what === `ack:${INGEST}`).length >= 2);
    assert.ok(w.log.filter((x) => x.what === `ack:${INGEST}`).every((x) => x.ok === true && x.count === 0));
    assert.deepEqual(w.violations, []);
    const a = await w.act('enter-P1', P1);
    assert.equal(a.ok, false);
    assert.match(a.message, /\(ingest-gap\)/);
    assert.deepEqual(w.violations, ['ingest-gap']);
    assert.equal(w.authority.ingested().length, 0);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
  });
  // (f) stale fence: a fence report overtaken by a newer one is refused (fail closed), never re-ingested.
  await withWorld({ [INGEST]: { throws: () => true }, [SYNC]: { delay: (action, arg) => (arg.hw - BASE === 1 ? 120 : 0) } }, async (w) => {
    await w.emit(1);
    const r = await w.ev(async () => {
      const ww = window.__w;
      const first = ww.sync.drain().then(() => 'ok', (e) => String(e.message));
      ww.recorder.logEvent('later');
      const second = ww.sync.drain().then(() => 'ok', (e) => String(e.message));
      const effectAfterStale = first.then(async (m) => { if (m === 'ok') await window.__testEffect('after-stale', 0); return m; });
      return { first: await effectAfterStale, second: await second };
    });
    assert.equal(r.second, 'ok');
    assert.match(r.first, /\(ingest-hw-mismatch\)/);
    assert.deepEqual(w.violations, ['ingest-hw-mismatch']);
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    assertIngestionOrder(w, [BASE + 1, BASE + 2]);
  });
});

test('(9) operation-begin refusal over the real binding BLOCKS the page mutation (requireOps); a delayed begin runs the mutation only after the ack', async () => {
  /** In-page runAcknowledgedMutation(requireOps) whose invoke is the observable `__testEffect(label)`. */
  const mutate = (w, label, desc) => w.ev(async ([l, d]) => {
    const ww = window.__w;
    try {
      await ww.t.runAcknowledgedMutation({ ops: ww.ops, requireOps: true, desc: d, recorder: ww.recorder, method: `viewer.${l}`, args: [], invoke: async () => { await window.__testEffect(l, 0); ww.effects.push(l); } });
      return { ok: true };
    } catch (e) { return { ok: false, message: String(e && e.message) }; }
  }, [label, desc]);
  // (a) refused begin (the Node phase check: P9 acknowledged, a cleanup descriptor) => no effect, one violation, no record
  await withWorld({}, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const spyBefore = await w.ev(() => window.__w.recorder.records.length);
    const r = await mutate(w, 'unloadModel', { operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' });
    assert.equal(r.ok, false);
    assert.match(r.message, /operation-begin refused \(phase-mismatch\): mutation not started/);
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'unloadModel'), 'the page action never ran');
    assert.ok(!(await w.pageState()).effects.includes('unloadModel'));
    assert.equal(await w.ev(() => window.__w.recorder.records.length), spyBefore, 'no spy record for the blocked mutation');
    assert.deepEqual(w.violations, ['op-begin-refused:phase-mismatch']);
    assert.equal(w.ledger.opLedger.length, 0);
    assert.deepEqual(w.pageErrors, []);
  });
  // (b) a descriptor the ledger refuses (hide of A) => blocked likewise, one violation 'op-begin-refused:refused'
  await withWorld({}, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const r = await mutate(w, 'hideModel', { operationType: 'hide', modelId: 'A', phase: 'P9', invokedBy: 'C16' });
    assert.equal(r.ok, false);
    assert.match(r.message, /operation-begin refused \(refused\)/);
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'hideModel'));
    assert.deepEqual(w.violations, ['op-begin-refused:refused']);
    assert.equal(w.ledger.opLedger.length, 0);
  });
  // (c) a slow begin ack: the mutation's effect follows the ack (never while it is outstanding); end translates the spyRef
  await withWorld({ [OPS]: { delay: (action) => (action === 'begin' ? 150 : 0) } }, async (w) => {
    assert.equal((await w.act('enter-P9', P9_C16)).ok, true);
    const pending = mutate(w, 'hideModel', { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
    await sleep(80);
    assert.ok(!w.log.some((x) => x.what === 'effect' && x.label === 'hideModel'), 'no effect while the begin ack is outstanding');
    const r = await pending;
    assert.equal(r.ok, true, r.message);
    const ack = idx(w.log, (x) => x.what === `ack:${OPS}` && x.action === 'begin');
    const eff = idx(w.log, (x) => x.what === 'effect' && x.label === 'hideModel');
    assert.ok(ack !== -1 && eff > ack, JSON.stringify(w.log));
    assert.ok(w.log[eff].at > w.log[ack].at);
    assert.deepEqual(w.violations, []);
    const rec = w.ledger.opLedger[0];
    assert.deepEqual([rec.operationType, rec.phase, rec.invokedBy, rec.terminalOutcome], ['hide', 'P9', 'C16', 'settled']);
    assert.match(rec.causalEvidence.spyRef, /^spyLedger:seq:\d+$/);
    assert.ok(!H.isPageLocalOrdinal(Number(rec.causalEvidence.spyRef.slice('spyLedger:seq:'.length))), 'the spyRef is authoritative');
  });
});

test('NEGATIVE: a reintroduced page-authoritative counter or a second Node counter is detected', async () => {
  // (a) mutated copy of the shipped page helper that stamps authoritative-looking seqs itself (old design:
  // the page numbers its records 1,2,3 from its own counter). Node refuses the entries, the action is
  // blocked, and taken at face value those numbers would collide with the Node allocator's namespace.
  const MUTANT = exposeIn(RAW_BUNDLE.replace(
    (() => { once(RAW_BUNDLE, 'let last = PAGE_LOCAL_BASE;\n  const pending = [];'); return 'let last = PAGE_LOCAL_BASE;\n  const pending = [];'; })(),
    'let last = 0;\n  const pending = [];',
  ));
  await withWorld({ bundle: MUTANT }, async (w) => {
    w.nodeEvent('n1');
    w.nodeEvent('n2');
    const pageSeqs = await w.emit(2);
    assert.deepEqual(pageSeqs, [1, 2], 'the mutant page stamps authoritative-looking seqs');
    const r = await w.act('enter-P1', P1);
    assert.equal(r.ok, false);
    assert.match(r.message, /ingest-entry-invalid/);
    assert.ok(w.violations.includes('ingest-entry-invalid'));
    assert.ok(!w.log.some((x) => x.what === 'effect'));
    const merged = [...w.nodeEvents.map((e) => ({ seq: e.seq, src: 'node' })), ...pageSeqs.map((s) => ({ seq: s, src: 'page-counter' }))];
    assert.ok(namespaceProblems(w.allocator, merged).some((p) => p.startsWith('duplicate:')), 'a page counter collides with the Node allocator');
  });
  // (b) a second Node-side counter for Node-origin events (dual-counter): the namespace check catches it.
  await withWorld({ secondAllocator: true }, async (w) => {
    assert.equal((await w.act('enter-P1', P1)).ok, true);
    w.nodeEvent('net-request');
    await w.emit(2);
    assert.equal((await w.drain()).ok, true);
    assert.deepEqual(w.violations, [], 'the authority alone cannot see the second counter');
    const problems = namespaceProblems(w.allocator, authoritativeSeqs(w));
    assert.ok(problems.some((p) => p.startsWith('duplicate:')), problems.join(','));
  });
  // (c) control: the real wiring passes the very same check.
  await withWorld({}, async (w) => {
    assert.equal((await w.act('enter-P1', P1)).ok, true);
    w.nodeEvent('net-request');
    await w.emit(2);
    assert.equal((await w.drain()).ok, true);
    assert.deepEqual(namespaceProblems(w.allocator, authoritativeSeqs(w)), []);
  });
});
