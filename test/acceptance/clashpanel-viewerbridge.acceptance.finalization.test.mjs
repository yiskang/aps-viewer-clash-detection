// test/acceptance/clashpanel-viewerbridge.acceptance.finalization.test.mjs
//
// Offline tests for G2 remediation item 24 (gate-time finalization of pending provisional HTTP
// responses on the AUTHORITATIVE Node ledger, exactly as the Node '__g2NodeSync' 'gate' action runs it
// in runPostReservation) and Low L1 (createNetworkInstrumentation.onRequestFinished fails closed
// instead of silently swallowing an exception). Fakes only: no Playwright, no Viewer, no browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  OPTIONAL_RESPONSE_RULES, createEmptyErrorLedger, createFatalEventSink, createNetworkInstrumentation, createRunSeqAllocator,
  createOperationLedger, finalizeLoadWindows, prepareC1Gate, provisionalFinalization, syncFatalWitnesses,
  finalizeNetworkLedgerAtCloseout, networkLedgerProblems, wireFatalListeners, sha256Hex,
} from './clashpanel-viewerbridge.acceptance.mjs';

const BASE = 'http://localhost:8080';
const CDN = 'https://cdn.derivative.invalid';
const URL_A = `${CDN}/modelA/output/0/geom.bin`;
const URL_B = `${CDN}/modelB/output/0/geom.bin`;
const PREFIX_B = `${CDN}/modelB/output/0`;
const RULE = Object.freeze({ ruleId: 'test-only-optional-404', method: 'GET', model: 'B', pathSuffix: 'geom.bin', resourceTypes: ['fetch'], statuses: [404], rationale: 'offline test only' });
const RULES = [RULE];
const AT = '2026-10-01T00:00:00.000Z';
const URN_SHA = sha256Hex(Buffer.from('urn', 'utf8'));

function fakeRequest({ url = URL_B, method = 'GET', resourceType = 'fetch', nav = false, errorText = 'net::ERR_FAILED' } = {}) {
  return { url: () => url, method: () => method, resourceType: () => resourceType, isNavigationRequest: () => nav, failure: () => ({ errorText }), redirectedFrom: () => null, frame: () => 'main' };
}

/** A Node-authority world: the real ledger, counter, sink and instrumentation over a fake page. */
function world({ rules = RULES, nextSeqWrap = null } = {}) {
  const ledger = createEmptyErrorLedger();
  const counter = createRunSeqAllocator();
  const nextSeq = nextSeqWrap ? nextSeqWrap(counter.next) : counter.next;
  const sink = createFatalEventSink(ledger, { nextSeq: counter.next });
  const at = { phase: 'P1', activeCheck: 'C1' };
  const net = createNetworkInstrumentation({ ledger, nextSeq, sink, rules, baseUrl: BASE, attribution: () => at, mainFrame: () => 'main' });
  const em = new EventEmitter();
  const page = { on: (e, f) => em.on(e, f), off: (e, f) => em.off(e, f) };
  const detach = wireFatalListeners({ page, browser: null, live: { closingIntent: false }, fatal: (k, d) => sink.recordFatal(k, d), network: net });
  return {
    ledger, counter, sink, net, em, detach, rules,
    request: (r) => em.emit('request', r),
    fail: (r) => em.emit('requestfailed', r),
    respond: (r, status) => em.emit('response', { status: () => status, request: () => r }),
    finish: (r) => em.emit('requestfinished', r),
  };
}

/**
 * Loads: A then B, both CLOSED, prefix evidence frozen (finalizeLoadWindows) with a uniquely bound
 * model-B prefix. Returns a request started inside B's window but not yet answered, so its response
 * arrives AFTER the windows closed and stays provisional until the gate.
 */
function closedLoadsWorld({ bindB = true } = {}) {
  const w = world();
  const ops = createOperationLedger({ ledger: w.ledger, nextSeq: w.counter.next });
  const fin = (url) => { const r = fakeRequest({ url }); w.request(r); w.respond(r, 200); w.finish(r); };
  const LA = ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA });
  fin(URL_A);
  ops.endLoad(LA, 'ready');
  const LB = ops.beginLoad({ modelId: 'B', modelUrnSha256: URN_SHA });
  if (bindB) fin(`${PREFIX_B}/b.bin`);
  const cand = fakeRequest(); // started inside B's window
  w.request(cand);
  ops.endLoad(LB, 'ready');
  const fl = finalizeLoadWindows(w.ledger, { prefixSources: w.net.prefixSources, appendEntry: (x) => w.sink.recordWitnessEntry(x), rules: RULES });
  assert.equal(fl.finalized, true);
  return { w, ops, LA, LB, cand };
}

/** Exactly the Node '__g2NodeSync' 'gate' action's prepareC1Gate call (runPostReservation). */
function runGate(w, { rules = RULES } = {}) {
  const c1 = { recordType: 'check-run', verdict: 'PASS', reason: null, fields: {}, evidence: {}, finalizedSeq: w.counter.next(), finalizedAt: AT };
  const gate = prepareC1Gate({
    c1, errorLedger: w.ledger, seqOf: w.counter.next,
    finalizeAtGate: (e, { ledger, finalizedSeq }) => provisionalFinalization(e, { ledger, finalizedSeq, rules }),
    rebuildFatalWitnessState: (l) => syncFatalWitnesses(l, { appendEntry: w.sink.recordWitnessEntry }),
  });
  return { c1, gate };
}


/**
 * A diagnostic entry is, by design, always an evidence contradiction against the FROZEN EMPTY
 * OPTIONAL_RESPONSE_RULES (offline synthetic rules only drive the recomputation), so the only legal
 * residue for a non-fatal gate finalization is exactly that, and nothing about witnesses/classification.
 */
const onlyDiagnosticContradictions = (problems, n) => {
  assert.deepEqual(problems, Array.from({ length: n }, (_, i) => `fatal-witness-mismatch:responseFailures[${i}].diagnostic-evidence-contradiction`));
};

const noProvisional = (ledger) => ledger.responseFailures.every((e) => e.stage !== 'provisional' || Number.isInteger(e.finalizedSeq));

test('baseline: with the live-empty OPTIONAL_RESPONSE_RULES an HTTP 500 is immediate-fatal (no provisional entry can exist)', () => {
  assert.equal(OPTIONAL_RESPONSE_RULES.length, 0);
  const w = world({ rules: OPTIONAL_RESPONSE_RULES });
  const r = fakeRequest();
  w.request(r); w.respond(r, 500);
  const e = w.ledger.responseFailures[0];
  assert.deepEqual([e.stage, e.finalizedBy, e.finalizedSeq === e.responseSeq, e.closeout.classification], ['immediate', 'event', true, 'fatal-required-resource']);
  assert.deepEqual([w.ledger.fatalCount, w.ledger.fatalWitnesses.length, w.ledger.entries.length], [1, 1, 1]);
  const r2 = fakeRequest(); w.request(r2); w.respond(r2, 404);
  assert.ok(w.ledger.responseFailures.every((x) => x.stage === 'immediate'));
  assert.equal(w.ledger.fatalCount, 2);
});

test('item 24: a pending provisional response finalizes NON-fatal at the gate (no witness, fatalCountAtGate unchanged)', () => {
  const { w, cand } = closedLoadsWorld();
  w.respond(cand, 404);
  const e = w.ledger.responseFailures[0];
  assert.deepEqual([e.stage, e.finalizedSeq, w.ledger.fatalCount, w.ledger.fatalWitnesses.length], ['provisional', null, 0, 0], 'pending, no effect before the gate');
  const { c1, gate } = runGate(w);
  assert.deepEqual([e.stage, e.finalizedBy, e.closeout.classification, e.requirement, e.agree], ['provisional', 'gate', 'diagnostic-non-required', 'optional', true]);
  assert.equal(e.closeout.rule, RULE.ruleId);
  assert.equal(e.closeout.boundPrefix, PREFIX_B);
  assert.deepEqual([w.ledger.fatalCount, w.ledger.fatalWitnesses.length, w.ledger.entries.length, gate.fatalCountAtGate], [0, 0, 0, 0]);
  assert.equal(gate.outcome, 'OPEN');
  assert.ok(e.responseSeq < e.finalizedSeq && e.finalizedSeq < gate.gateSeq && c1.finalizedSeq < e.finalizedSeq);
  assert.ok(noProvisional(w.ledger));
  onlyDiagnosticContradictions(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), 1);
});

test('item 24: a pending provisional response finalizes to an HTTP-failure FATAL at the gate (one witness, one entry, fatalCountAtGate incremented)', () => {
  // bound-to-nothing (no model-B evidence) => ownership unresolved => unknown-fatal, committed at the gate
  const { w, cand } = closedLoadsWorld({ bindB: false });
  w.respond(cand, 404);
  const e = w.ledger.responseFailures[0];
  assert.equal(w.ledger.fatalCount, 0);
  const { gate } = runGate(w);
  assert.deepEqual([e.finalizedBy, e.closeout.classification, e.requirement, e.agree], ['gate', 'unknown-fatal', 'unknown', true]);
  assert.deepEqual([w.ledger.fatalCount, w.ledger.fatalWitnesses.length, w.ledger.entries.length, gate.fatalCountAtGate], [1, 1, 1, 1]);
  assert.equal(w.ledger.entries[0].kind, 'required-resource-failure');
  assert.equal(gate.outcome, 'CLOSED_OTHER');
  assert.deepEqual(gate.notStarted.length > 0, true);
  const wit = w.ledger.fatalWitnesses[0];
  // ordering: responseSeq < finalizedSeq <= witnessSeq < gateSeq
  assert.ok(e.responseSeq < e.finalizedSeq && e.finalizedSeq <= wit.witnessSeq && wit.witnessSeq < gate.gateSeq, JSON.stringify([e.responseSeq, e.finalizedSeq, wit.witnessSeq, gate.gateSeq]));
  assert.equal(w.ledger.entries[0].seq, wit.witnessSeq);
  assert.ok(noProvisional(w.ledger));
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), [], 'recomputed witnesses agree');
});

test('item 24: unresolved ownership at finalization (load windows never closed) => unknown-fatal at the gate', () => {
  const w = world();
  const ops = createOperationLedger({ ledger: w.ledger, nextSeq: w.counter.next });
  ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA });
  const r = fakeRequest(); w.request(r); w.respond(r, 404);
  const e = w.ledger.responseFailures[0];
  assert.deepEqual([e.stage, w.ledger.fatalCount], ['provisional', 0]);
  const { gate } = runGate(w);
  assert.deepEqual([e.finalizedBy, e.closeout.classification, e.closeout.boundPrefix], ['gate', 'unknown-fatal', null]);
  assert.deepEqual([w.ledger.fatalCount, gate.fatalCountAtGate, gate.outcome], [1, 1, 'CLOSED_OTHER']);
  assert.ok(e.responseSeq < e.finalizedSeq && e.finalizedSeq <= w.ledger.fatalWitnesses[0].witnessSeq && w.ledger.fatalWitnesses[0].witnessSeq < gate.gateSeq);
  // the prefix-source snapshot is only frozen at closeout when a load window never closed; closeout leaves the gate-finalized entry untouched
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.sink.recordWitnessEntry, rules: RULES, prefixSources: w.net.prefixSources });
  assert.equal(e.finalizedBy, 'gate');
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), []);
});

test('item 24: duplicate requestfailed + response events for ONE request object yield one witness per trustworthy request identity', () => {
  const { w, cand } = closedLoadsWorld();
  w.respond(cand, 404);   // provisional (pending)
  w.fail(cand);           // same request object: a fatal requestfailed (ERR_FAILED) joins the same identity
  w.respond(cand, 404);   // a duplicate provisional response for the same identity
  assert.equal(w.ledger.responseFailures.length, 2);
  assert.equal(w.ledger.requestFailures.length, 1);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount], [1, 1], 'requestfailed already created the identity\'s single witness');
  const before = w.ledger.fatalWitnesses[0].witnessSeq;
  const { gate } = runGate(w);
  assert.ok(w.ledger.responseFailures.every((e) => e.finalizedBy === 'gate' && e.closeout.classification === 'diagnostic-non-required'), 'both pending responses finalize at the gate');
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.entries.length, w.ledger.fatalCount, gate.fatalCountAtGate], [1, 1, 1, 1], 'still one witness for the one identity');
  assert.equal(w.ledger.fatalWitnesses[0].witnessSeq, before);
  assert.ok(noProvisional(w.ledger));
  onlyDiagnosticContradictions(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), 2);
});

test('item 24: a response finalizing fatal at the gate joins an identity already witnessed by requestfailed (still one witness)', () => {
  const { w, cand } = closedLoadsWorld({ bindB: false });
  w.respond(cand, 404);
  w.fail(cand);
  assert.equal(w.ledger.fatalCount, 1);
  const { gate } = runGate(w);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.entries.length, w.ledger.fatalCount, gate.fatalCountAtGate], [1, 1, 1, 1]);
  assert.equal(w.ledger.responseFailures[0].closeout.classification, 'unknown-fatal');
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), []);
});

test('item 24: after the gate no provisional entry remains and closeout finalization is a no-op for it', () => {
  const { w, cand } = closedLoadsWorld({ bindB: false });
  w.respond(cand, 404);
  const { gate } = runGate(w);
  const e = w.ledger.responseFailures[0];
  const snap = JSON.stringify([e.finalizedSeq, e.finalizedBy, e.eventTime, e.closeout, e.agree, w.ledger.fatalCount, w.ledger.entries]);
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  const seqBefore = w.counter.peek();
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.sink.recordWitnessEntry, rules: RULES });
  assert.equal(JSON.stringify([e.finalizedSeq, e.finalizedBy, e.eventTime, e.closeout, e.agree, w.ledger.fatalCount, w.ledger.entries]), snap);
  assert.equal(e.finalizedBy, 'gate');
  assert.equal(w.counter.peek(), seqBefore, 'no seq allocated for the already-finalized entry');
  assert.ok(e.finalizedSeq < gate.gateSeq);
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: RULES }), []);
});

test('item 24 (non-vacuity): without the gate finalization the pending entry is still provisional and the ledger stays unfinalized', () => {
  const { w, cand } = closedLoadsWorld({ bindB: false });
  w.respond(cand, 404);
  assert.equal(noProvisional(w.ledger), false);
  assert.equal(w.ledger.fatalCount, 0);
});

test('L1: onRequestFinished fails closed (harness-exception, network-instrumentation:requestfinished) when its body throws; a normal requestfinished records a terminal and no fatal', () => {
  // normal path
  const ok = world();
  const r = fakeRequest();
  ok.request(r); ok.finish(r);
  assert.equal(ok.ledger.fatalCount, 0);
  assert.equal(ok.ledger.entries.length, 0);
  assert.deepEqual(ok.net.terminals.map((t) => [t.reqId, t.terminalKind]), [['q:1', 'requestfinished']]);

  // throwing path: a nextSeq that throws once, only on the requestfinished allocation
  let armed = false;
  const bad = world({ nextSeqWrap: (next) => () => { if (armed) { armed = false; throw new Error('seq boom'); } return next(); } });
  const r2 = fakeRequest();
  bad.request(r2);
  armed = true;
  assert.doesNotThrow(() => bad.finish(r2));
  assert.deepEqual(bad.net.terminals, [], 'no terminal recorded when the body threw');
  const ents = bad.ledger.entries;
  assert.equal(ents.length, 1, JSON.stringify(ents));
  assert.equal(ents[0].kind, 'harness-exception');
  assert.equal(ents[0].detail, 'network-instrumentation:requestfinished');
  assert.equal(bad.ledger.fatalCount, 1);
});

// Internal-review finding (medium): the response rules must be resolved ONCE in runPostReservation and
// passed to every finalization path (event time, load-window close, gate, closeout).
test('runPostReservation resolves deps.responseRules once and passes the same rules to instrumentation, load-window close, gate and closeout finalization', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url), 'utf8');
  const a = src.indexOf('async function runPostReservation(');
  const body = src.slice(a, src.indexOf('\n}\n', a));
  assert.equal(body.split('deps.responseRules').length - 1, 1, 'resolved exactly once');
  assert.equal(body.split('rules: responseRules').length - 1, 4, 'instrumentation + gate finalization + load-window close + closeout');
  assert.ok(/provisionalFinalization\(e, \{ ledger, finalizedSeq, rules: responseRules \}\)/.test(body));
  assert.ok(/finalizeLoadWindows\([^;]*rules: responseRules/.test(body));
  assert.ok(/finalizeNetworkLedgerAtCloseout\([^;]*rules: responseRules/.test(body));
});
