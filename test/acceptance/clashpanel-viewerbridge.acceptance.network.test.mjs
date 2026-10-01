// test/acceptance/clashpanel-viewerbridge.acceptance.network.test.mjs
//
// Offline tests for the G2 harness slice C1 (procedure §9.2 RC1 + RC1-C1 + RC1-C2, §10): the passive
// request/response/requestfinished/requestfailed instrumentation (item 7), `requestObservations[]`
// and the recomputed request identity (item 20, test (23)), `classifyRequestFailure` /
// `classifyHttpResponse` with R-1..R-5, the two-stage rule and the frozen EMPTY
// OPTIONAL_RESPONSE_RULES (item 8), the one-to-one fatal-witness correlation and counting (item 18,
// tests (18)-(24)), the ClassifierResult schema and cross-field rules (tests (14), (17)), redaction
// ((6), (16)), the static no-allow-list tests ((8)), seq stamping and cross-collection seq
// uniqueness. Fakes only: no Playwright, no Viewer, no browser. Prefix-source / operation-ledger
// schema tests ((12), (13), (15)) and the slice-C2 wiring live in
// clashpanel-viewerbridge.acceptance.prefix.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OPTIONAL_RESPONSE_RULES, NETWORK_SEVERITY, CLASSIFIER_RESULT_KEYS, LIVE_PATH_WIRED, FATAL_ENTRY_SEQ_REQUIRED, OVERALL_PHASES,
  classifyRequestFailure, classifyHttpResponse, isHttpRuleCandidate, correlateNetworkEvents, createEmptyErrorLedger, syncFatalWitnesses,
  directWitnessEntryAppender, provisionalFinalization, applyProvisionalFinalization, finalizeNetworkLedgerAtCloseout,
  classifierResultProblems, networkLedgerProblems, primarySeqAllocations, maxRecordedSeq, createRunSeqCounter, classifyNetworkUrl,
  createNetworkInstrumentation, wireFatalListeners, createFatalEventSink, recomputeFatalCountAtGate, recordSchemaProblems,
  evaluateOverallRows, computeOverall, createOfflineRunStateFixture, buildBindingRecord, sha256Hex, MODEL_A_URN, MODEL_B_URN,
  G2_VIEWER_SCRIPT_URL, tokenizeJs, locateFunctionSource, derivePrefixes, createOperationLedger, finalizeLoadWindows,
} from './clashpanel-viewerbridge.acceptance.mjs';

/** The non-distinguishing derivation (no load record): nothing can bind (replaces the slice-C1 stand-in). */
const NON_DISTINGUISHING_PREFIX_DERIVATION = derivePrefixes([], []);
const HARNESS_SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));
const h = (s) => sha256Hex(Buffer.from(s, 'utf8'));

const BASE = 'http://localhost:8080';
const CDN = 'https://cdn.derivative.invalid';
const URL_B = `${CDN}/modelB/output/0/geom.bin`;
const URL_A = `${CDN}/modelA/output/0/geom.bin`;
const PREFIX_A = `${CDN}/modelA/output/0`;
const PREFIX_B = `${CDN}/modelB/output/0`;
const BOUND = Object.freeze({ bindingAvailable: true, nonDistinguishingReason: null, candidateKeys: { A: [PREFIX_A], B: [PREFIX_B] }, ambiguousKeys: [], modelPrefixes: { A: [PREFIX_A], B: [PREFIX_B] } });

// ------------------------------------------------------------------------------------------
// Fakes: a Playwright-shaped page (EventEmitter) driven through the REAL listener wiring
// ------------------------------------------------------------------------------------------

function fakeRequest({ url = URL_B, method = 'GET', resourceType = 'fetch', nav = false, errorText = 'net::ERR_FAILED' } = {}) {
  return { url: () => url, method: () => method, resourceType: () => resourceType, isNavigationRequest: () => nav, failure: () => ({ errorText }), redirectedFrom: () => null, frame: () => 'main' };
}

/**
 * A run world: the real sink (node counter), the real instrumentation and the real `wireFatalListeners`
 * over a fake page; `attr` is the node attribution; `seqStart` places the counter.
 */
function world({ seqStart = 100, rules, context, attr = { phase: 'P1', activeCheck: 'C1' } } = {}) {
  const ledger = createEmptyErrorLedger();
  const counter = createRunSeqCounter();
  counter.observe(seqStart);
  const sink = createFatalEventSink(ledger, { nextSeq: counter.next });
  const at = { ...attr };
  let witnessNotes = 0;
  const net = createNetworkInstrumentation({
    ledger, nextSeq: counter.next, sink, baseUrl: BASE, attribution: () => at, mainFrame: () => 'main', onFatalWitness: () => { witnessNotes += 1; },
    ...(rules ? { rules } : {}), ...(context ? { context: () => context(ledger) } : {}),
  });
  const em = new EventEmitter();
  const page = { on: (e, f) => em.on(e, f), off: (e, f) => em.off(e, f) };
  const fatals = [];
  const detach = wireFatalListeners({ page, browser: null, live: { closingIntent: false }, fatal: (k, d) => { fatals.push(k); sink.recordFatal(k, d); }, network: net });
  return {
    ledger, sink, counter, net, at, em, detach, fatals, witnessNotes: () => witnessNotes,
    request: (req) => em.emit('request', req),
    fail: (req) => em.emit('requestfailed', req),
    respond: (req, status) => em.emit('response', { status: () => status, request: () => req }),
    finish: (req) => em.emit('requestfinished', req),
    set: (patch) => Object.assign(at, patch),
  };
}

const W5 = (L) => assert.deepEqual(networkLedgerProblems({ errorLedger: L }), [], 'full §9.2 W-1..W-5 recomputation + witnessCount invariant');

function makeBinding() {
  return buildBindingRecord({
    validation: {
      ok: true,
      record: { path: 'docs/prompts/g2-network-test.md', sha256: h('record'), id: 'network-test-0001' },
      digests: { headSha: h('head').slice(0, 40), procedureSha256: h('procedure'), harnessSha256: h('harness'), urnASha256: h(MODEL_A_URN), urnBSha256: h(MODEL_B_URN) },
    },
    attemptId: randomUUID(),
  });
}
/** An all-PASS §10 state (seqs 1,2,10..25) with the given network ledger (seqs from 100). */
function stateWith(ledger) {
  const s = createOfflineRunStateFixture({ binding: makeBinding() });
  s.errorLedger = { ...ledger, attemptDeadlineExpired: false };
  return s;
}

// ------------------------------------------------------------------------------------------
// Static: frozen empty OPTIONAL_RESPONSE_RULES, no allow-list, no blanket requestfailed => fatal
// ------------------------------------------------------------------------------------------

test('static: OPTIONAL_RESPONSE_RULES is frozen and EMPTY, declared exactly once; LIVE_PATH_WIRED stays false; FATAL_ENTRY_SEQ_REQUIRED is true', () => {
  assert.ok(Object.isFrozen(OPTIONAL_RESPONSE_RULES));
  assert.equal(OPTIONAL_RESPONSE_RULES.length, 0);
  assert.equal(HARNESS_SOURCE.split('const OPTIONAL_RESPONSE_RULES = Object.freeze([]);').length - 1, 1);
  assert.equal(HARNESS_SOURCE.split('const LIVE_PATH_WIRED = false;').length - 1, 1);
  assert.equal(LIVE_PATH_WIRED, false);
  assert.equal(FATAL_ENTRY_SEQ_REQUIRED, true);
});

test('(8) static: the classifiers contain no hostname/path/error-text allow-list literal (only the JSON-pointer prefixes they emit and the closed condition constants)', () => {
  for (const fn of ['classifyRequestFailure', 'classifyHttpResponse', 'isHttpRuleCandidate', 'matchingResponseRule', 'prefixBindingOf']) {
    const { start, end } = locateFunctionSource(HARNESS_SOURCE, fn);
    const strings = tokenizeJs(HARNESS_SOURCE.slice(start, end)).filter((t) => t.type === 'string' || t.type === 'template').map((t) => t.value);
    for (const v of strings) {
      assert.ok(!/:\/\//.test(v), `${fn}: URL literal ${v}`);
      assert.ok(!/\.(com|net|io|invalid|js|css|json)\b/i.test(v), `${fn}: host/file literal ${v}`);
      assert.ok(!(v.replace(/^['"`]/, '').startsWith('/') && !v.replace(/^['"`]/, '').startsWith('/errorLedger/')), `${fn}: path literal ${v}`);
      assert.ok(!/ERR_(FAILED|CONNECTION|NAME|TIMED)/.test(v), `${fn}: tolerated error text ${v}`);
    }
  }
  // the only URL constants of the network policy are the bootstrap/harness-endpoint class constants
  const { start, end } = locateFunctionSource(HARNESS_SOURCE, 'classifyNetworkUrl');
  const lits = tokenizeJs(HARNESS_SOURCE.slice(start, end)).filter((t) => t.type === 'string').map((t) => t.value).filter((v) => v.startsWith('/'));
  assert.deepEqual(lits.sort(), ['/api/auth/token', '/clashpanel/']);
});

test('item 7: the committed blanket `requestfailed => fatal` is gone; the four passive listeners are wired through the instrumentation', () => {
  const { start, end } = locateFunctionSource(HARNESS_SOURCE, 'wireFatalListeners');
  const body = HARNESS_SOURCE.slice(start, end);
  assert.doesNotMatch(body, /fatal\('required-resource-failure'/);
  for (const ev of ['request', 'response', 'requestfinished', 'requestfailed']) assert.match(body, new RegExp(`on\\(page, '${ev}'`));
  const w = world();
  assert.deepEqual(['request', 'response', 'requestfinished', 'requestfailed'].map((e) => w.em.listenerCount(e)), [1, 1, 1, 1]);
  w.detach();
  assert.deepEqual(['request', 'response', 'requestfinished', 'requestfailed'].map((e) => w.em.listenerCount(e)), [0, 0, 0, 0]);
});

test('urlClass: bootstrap = pinned viewer script/style, the synthetic page, operator-origin /clashpanel/**; harness-endpoint = /api/auth/token; other = everything else', () => {
  assert.equal(classifyNetworkUrl(G2_VIEWER_SCRIPT_URL, { baseUrl: BASE }), 'bootstrap');
  assert.equal(classifyNetworkUrl(`${BASE}/clashpanel/viewer/ViewerBridge.js`, { baseUrl: BASE }), 'bootstrap');
  assert.equal(classifyNetworkUrl(`${BASE}/__g2-viewerbridge-dockingpanel__`, { baseUrl: BASE }), 'bootstrap');
  assert.equal(classifyNetworkUrl(`${BASE}/api/auth/token`, { baseUrl: BASE }), 'harness-endpoint');
  assert.equal(classifyNetworkUrl('https://elsewhere.invalid/clashpanel/x.js', { baseUrl: BASE }), 'other');
  assert.equal(classifyNetworkUrl(URL_B, { baseUrl: BASE }), 'other');
  assert.equal(classifyNetworkUrl('not a url', { baseUrl: BASE }), 'other');
});

// ------------------------------------------------------------------------------------------
// Item 20 / test (23): request observations and recomputed identity
// ------------------------------------------------------------------------------------------

test('item 20: one observation per Playwright request; reqId = q:+startSeq through the Request-object identity map; later events resolve the same reqId', () => {
  const w = world();
  const r1 = fakeRequest({ url: `${URL_B}?sig=abc` });
  const r2 = fakeRequest({ url: URL_A });
  w.request(r1); w.request(r2); w.request(r1); // a re-emitted request object is a new observation
  assert.deepEqual(w.ledger.requestObservations.map((o) => o.reqId), ['q:101', 'q:102', 'q:103']);
  assert.deepEqual(Object.keys(w.ledger.requestObservations[0]).sort(), ['activeCheck', 'isNavigationRequest', 'method', 'phase', 'reqId', 'resourceType', 'startSeq', 'urlClass', 'urlRedacted']);
  assert.equal(w.ledger.requestObservations[0].urlRedacted, URL_B, 'query dropped');
  w.respond(r2, 404);
  const e = w.ledger.responseFailures[0];
  assert.deepEqual([e.reqId, e.startSeq, e.reqIdValid, e.identityKey], ['q:102', 102, true, 'req:q:102']);
  assert.equal(w.ledger.witnessCount.requestObservations, 3);
  W5(w.ledger);
});

test('(23) missing/invalid identity => reqIdValid false, invalid:<rawEventSeq>, unknown-fatal, exactly one witness per raw event, never suppressed', () => {
  const variants = [
    ['absent (no request event)', (L, e) => { e.reqId = null; e.startSeq = null; }],
    ['null', (L, e) => { e.reqId = null; }],
    ['empty', (L, e) => { e.reqId = ''; }],
    ['non-string', (L, e) => { e.reqId = 7; }],
    ['no matching observation', (L, e) => { e.reqId = 'q:999'; }],
    ['two matching observations', (L) => { L.requestObservations.push({ ...L.requestObservations[0] }); }],
    ['observation differs in startSeq', (L) => { L.requestObservations[0].startSeq = 50; L.requestObservations[0].reqId = 'q:50'; }],
    ['observation differs in method', (L) => { L.requestObservations[0].method = 'POST'; }],
    ['observation differs in resourceType', (L) => { L.requestObservations[0].resourceType = 'xhr'; }],
    ['observation differs in urlRedacted', (L) => { L.requestObservations[0].urlRedacted = URL_A; }],
  ];
  for (const [label, mut] of variants) {
    // pure correlation: the raw event as captured, then its identity recomputed
    const w = world();
    const req = fakeRequest();
    w.request(req); w.respond(req, 500);
    const L = clone(w.ledger);
    mut(L, L.responseFailures[0]);
    const c = correlateNetworkEvents(L);
    assert.deepEqual([c.events[0].reqIdValid, c.events[0].identityKey, c.events[0].effCls], [false, `invalid:${L.responseFailures[0].rawEventSeq}`, 'unknown-fatal'], label);
    assert.equal(c.witnesses.length, 1, label);
    assert.ok(networkLedgerProblems({ errorLedger: L }).some((p) => p.startsWith('fatal-witness-mismatch:') || p.startsWith('request-classification-mismatch:') || p.startsWith('network-schema:')), `${label}: stored values are never trusted`);
  }
  // through the real listener wiring: a requestfailed with no prior request event
  const w = world();
  w.fail(fakeRequest());
  const e = w.ledger.requestFailures[0];
  assert.deepEqual([e.reqId, e.reqIdValid, e.identityKey, e.closeout.classification, e.closeout.reasons], [null, false, 'invalid:101', 'unknown-fatal', ['unclassifiable', 'other']]);
  assert.deepEqual([w.ledger.fatalCount, w.ledger.fatalWitnesses.length], [1, 1]);
  W5(w.ledger);
});

test('(23) mutations => row 5: stored reqIdValid true with the observation deleted; a duplicated observation reqId; a tampered witnessCount.requestObservations', () => {
  const w = world();
  const req = fakeRequest();
  w.request(req); w.respond(req, 500);
  W5(w.ledger);
  const del = clone(w.ledger); del.requestObservations = [];
  assert.ok(networkLedgerProblems({ errorLedger: del }).includes('fatal-witness-mismatch:responseFailures[0].reqIdValid'));
  const dup = clone(w.ledger); dup.requestObservations.push({ ...dup.requestObservations[0], startSeq: 150 });
  assert.ok(networkLedgerProblems({ errorLedger: dup }).some((p) => p === 'fatal-witness-mismatch:requestObservations[1].reqId-duplicated'));
  const cnt = clone(w.ledger); cnt.witnessCount.requestObservations = 5;
  assert.ok(networkLedgerProblems({ errorLedger: cnt }).includes('fatal-witness-mismatch:witnessCount'));
  for (const L of [del, dup, cnt]) assert.equal(evaluateOverallRows(stateWith(L), 'pre-closeout')[4].match, true);
});

test('(23) a P9 HTTP 500 + requestfailed pair sharing a valid observed reqId => ONE witness; the same pair with the observation removed => two invalid: witnesses', () => {
  const w = world({ attr: { phase: 'P9', activeCheck: 'C16' } });
  const req = fakeRequest();
  w.request(req); w.respond(req, 500); w.fail(req);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount], [1, 1]);
  W5(w.ledger);
  const L = clone(w.ledger);
  L.requestObservations = [];
  const c = correlateNetworkEvents(L);
  assert.deepEqual(c.witnesses.map((x) => x.requestIdentityKey), ['invalid:102', 'invalid:103']);
});

// ------------------------------------------------------------------------------------------
// classifyRequestFailure: (1) truth table, (2) per-rule positives / single-condition negatives, (3)
// ------------------------------------------------------------------------------------------

const OPS = {
  none: null,
  hide: { recordType: 'mutation', operationId: 'op:hide', operationType: 'hide', teardownTarget: null, modelId: 'B', phase: 'P9', invokedBy: 'C16' },
  unload: { recordType: 'mutation', operationId: 'op:unload', operationType: 'unload', teardownTarget: null, modelId: 'B', phase: 'P9', invokedBy: 'C17' },
  closePage: { recordType: 'mutation', operationId: 'op:closePage', operationType: 'teardown', teardownTarget: 'closePage', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closePage' },
  closeContext: { recordType: 'mutation', operationId: 'op:closeContext', operationType: 'teardown', teardownTarget: 'closeContext', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closeContext' },
  closeBrowser: { recordType: 'mutation', operationId: 'op:closeBrowser', operationType: 'teardown', teardownTarget: 'closeBrowser', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closeBrowser' },
};
/** Scenario: op starts at 20; request started at 10 (in flight) or 25 (after); fail at 30 (inside) or 45 (after the boundary at 40). */
function scenario({ errorText, urlClass, resourceType, nav, op, phase, inflight, position, checksFinal }) {
  const opLedger = op ? [{ ...op, startSeq: 20 }] : [];
  const markers = [{ seq: 5, name: 'P9' }, ...(checksFinal ? [{ seq: 15, name: 'cleanup' }] : []), { seq: 40, name: 'closeout' }];
  const ev = { reqIdValid: true, startSeq: inflight ? 10 : 25, failSeq: position === 'inside' ? 30 : 45, method: 'GET', resourceType, urlRedacted: urlClass === 'other' ? URL_B : `${BASE}/clashpanel/x.js`, urlClass, errorText, isNavigationRequest: nav, phase };
  return { ev, opLedger, markers };
}
/** Independent oracle of §9.2 C-a..C-e (binding: URL_B is uniquely bound to model B). */
function expectedEC({ errorText, urlClass, resourceType, nav, op, phase, inflight, position, checksFinal }) {
  if (errorText !== 'net::ERR_ABORTED') return false;
  if (urlClass !== 'other' || nav || !['fetch', 'xhr', 'other', 'image'].includes(resourceType)) return false;
  if (!op || !inflight) return false;
  if (position !== 'inside') return false;
  if (op.operationType === 'teardown') return phase === 'cleanup' && checksFinal;
  return phase === 'P9' || phase === 'cleanup';
}

test('(1) classifier truth table: EXPECTED exactly on the satisfying cells, FATAL elsewhere (5760 cells)', () => {
  let expected = 0;
  let cells = 0;
  for (const errorText of ['net::ERR_ABORTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_RESET', 'net::ERR_NAME_NOT_RESOLVED', null]) {
    for (const urlClass of ['bootstrap', 'harness-endpoint', 'other']) for (const resourceType of ['fetch', 'script']) for (const nav of [false, true]) {
      for (const opName of ['none', 'hide', 'unload', 'closePage']) for (const phase of ['P9', 'cleanup', 'P5a']) for (const inflight of [true, false]) {
        for (const position of ['inside', 'after-boundary']) for (const checksFinal of [true, false]) {
          const cell = { errorText, urlClass, resourceType, nav, op: OPS[opName], phase, inflight, position, checksFinal };
          const { ev, opLedger, markers } = scenario(cell);
          const r = classifyRequestFailure(ev, opLedger, markers, BOUND);
          const want = expectedEC(cell);
          cells += 1;
          if (want) expected += 1;
          assert.equal(r.classification === 'expected-cancellation', want, JSON.stringify({ ...cell, op: opName, got: r }));
          assert.deepEqual(classifierResultProblems(r, 'requestfailed'), [], JSON.stringify(r));
          if (!want) assert.equal(r.verdictEffect, 'fatal-row1');
        }
      }
    }
  }
  assert.equal(cells, 5760);
  assert.ok(expected > 0);
});

test('(2) one positive per rule (EC-hide, EC-unload, EC-teardown x3 targets) and one single-condition negative per C-a..C-e and C-c′ -- incl. unrelated in-flight requests', () => {
  const base = { errorText: 'net::ERR_ABORTED', urlClass: 'other', resourceType: 'fetch', nav: false, inflight: true, position: 'inside', checksFinal: true };
  const pos = [['hide', 'P9', 'EC-hide'], ['unload', 'P9', 'EC-unload'], ['closePage', 'cleanup', 'EC-teardown'], ['closeContext', 'cleanup', 'EC-teardown'], ['closeBrowser', 'cleanup', 'EC-teardown']];
  for (const [op, phase, rule] of pos) {
    const { ev, opLedger, markers } = scenario({ ...base, op: OPS[op], phase });
    const r = classifyRequestFailure(ev, opLedger, markers, BOUND);
    assert.deepEqual([r.classification, r.rule, r.operationId, r.opStartSeq, r.reasons], ['expected-cancellation', rule, OPS[op].operationId, 20, []], op);
    if (rule === 'EC-teardown') assert.deepEqual([r.modelId, r.boundPrefix], [null, null]);
    else assert.deepEqual([r.modelId, r.boundPrefix], ['B', PREFIX_B]);
    assert.ok(r.evidenceRefs.includes('/errorLedger/opLedger/0'));
  }
  const neg = [
    ['C-a', { errorText: 'net::ERR_FAILED' }, 'fatal-required-resource'],
    ['C-b', { resourceType: 'script' }, 'fatal-required-resource'],
    ['C-c', { inflight: false }, 'fatal-required-resource'],
    ['C-d', { position: 'after-boundary' }, 'fatal-required-resource'],
    ['C-e', { phase: 'P5a' }, 'fatal-required-resource'],
  ];
  for (const [cond, patch, cls] of neg) {
    const { ev, opLedger, markers } = scenario({ ...base, op: OPS.hide, phase: 'P9', ...patch });
    const r = classifyRequestFailure(ev, opLedger, markers, BOUND);
    assert.equal(r.classification, cls, cond);
    assert.ok(r.reasons.includes(cond), `${cond}: ${JSON.stringify(r.reasons)}`);
    assert.deepEqual([r.rule, r.boundPrefix, r.modelId, r.operationId], [null, null, null, null]);
  }
  // C-c′: an unrelated request that started earlier and aborts with ERR_ABORTED inside each hide/unload window
  for (const op of ['hide', 'unload']) {
    const s = scenario({ ...base, op: OPS[op], phase: 'P9' });
    const other = classifyRequestFailure({ ...s.ev, urlRedacted: URL_A }, s.opLedger, s.markers, BOUND);
    assert.deepEqual([other.classification, other.reasons.includes('C-c′')], ['fatal-required-resource', true], `${op}: bound to the other model`);
    const unbound = classifyRequestFailure({ ...s.ev, urlRedacted: `${CDN}/elsewhere/x.bin` }, s.opLedger, s.markers, BOUND);
    assert.equal(unbound.classification, 'fatal-required-resource', `${op}: unbound`);
    const amb = classifyRequestFailure(s.ev, s.opLedger, s.markers, { ...BOUND, ambiguousKeys: [PREFIX_B], modelPrefixes: { A: [PREFIX_A], B: [] } });
    assert.deepEqual([amb.classification, amb.reasons.includes('prefix-ambiguous')], ['unknown-fatal', true], `${op}: ambiguous`);
    const nd = classifyRequestFailure(s.ev, s.opLedger, s.markers, NON_DISTINGUISHING_PREFIX_DERIVATION);
    assert.deepEqual([nd.classification, nd.reasons.includes('binding-unavailable')], ['unknown-fatal', true], `${op}: non-distinguishing (no load record)`);
  }
});

test('(3) missing/invalid field, reqIdValid false, unknown op kind, classifier exception => FATAL unclassifiable (unknown-fatal)', () => {
  const s = scenario({ errorText: 'net::ERR_ABORTED', urlClass: 'other', resourceType: 'fetch', nav: false, op: OPS.hide, phase: 'P9', inflight: true, position: 'inside', checksFinal: true });
  const cases = [
    ['missing startSeq', { ...s.ev, startSeq: undefined }, s.opLedger],
    ['reqIdValid false', { ...s.ev, reqIdValid: false }, s.opLedger],
    ['urlClass invalid', { ...s.ev, urlClass: 'cdn' }, s.opLedger],
    ['non-boolean navigation', { ...s.ev, isNavigationRequest: 'no' }, s.opLedger],
    ['unknown op kind', s.ev, [{ ...s.opLedger[0], operationType: 'reload' }]],
    ['exception', Object.defineProperty({ ...s.ev }, 'errorText', { get() { throw new Error('boom'); }, enumerable: true }), s.opLedger],
  ];
  for (const [label, ev, ops] of cases) {
    const r = classifyRequestFailure(ev, ops, s.markers, BOUND);
    assert.equal(r.classification, 'unknown-fatal', label);
    assert.ok(r.reasons.includes('unclassifiable'), label);
    assert.deepEqual(classifierResultProblems(r, 'requestfailed'), [], label);
  }
  assert.equal(classifyRequestFailure(null, null, null, null).classification, 'unknown-fatal');
  // a structurally incomplete operation record can never ground a non-fatal result
  for (const strip of ['operationId', 'startSeq', 'operationType']) {
    const op = { ...s.opLedger[0] }; delete op[strip];
    if (strip === 'startSeq') op.startSeq = 20.5;
    const r = classifyRequestFailure(s.ev, [op], s.markers, BOUND);
    assert.deepEqual([r.classification, r.reasons[0]], ['unknown-fatal', 'unclassifiable'], `mutation without ${strip}`);
  }
  const td = scenario({ errorText: 'net::ERR_ABORTED', urlClass: 'other', resourceType: 'fetch', nav: false, op: { ...OPS.closePage, modelId: 'B' }, phase: 'cleanup', inflight: true, position: 'inside', checksFinal: true });
  assert.equal(classifyRequestFailure(td.ev, td.opLedger, td.markers, BOUND).classification, 'unknown-fatal', 'teardown with a model is not a known shape');
  const httpEv = { reqIdValid: true, startSeq: 96, responseSeq: 97, method: 'GET', status: 404, resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: false, phase: 'P1' };
  const rule = { ruleId: 'test-only', method: 'GET', model: 'B', pathSuffix: 'geom.bin', resourceTypes: ['fetch'], statuses: [404], rationale: 'offline test only' };
  const goodLoad = { recordType: 'load', operationId: 'load:B', modelId: 'B', startSeq: 95, expectedRequestWindow: { fromSeqExclusive: 95, toSeqInclusive: 99 } };
  assert.equal(classifyHttpResponse(httpEv, [goodLoad], [], BOUND, [rule]).classification, 'diagnostic-non-required');
  const { operationId, ...noId } = goodLoad; void operationId;
  assert.equal(classifyHttpResponse(httpEv, [noId], [], BOUND, [rule]).classification, 'unknown-fatal', 'a load record without operationId never grounds a diagnostic result');
  assert.equal(classifyHttpResponse(null, null, null, null).classification, 'unknown-fatal');
});

// ------------------------------------------------------------------------------------------
// classifyHttpResponse: (10) required responses, (11) optional-rule two-stage path
// ------------------------------------------------------------------------------------------

test('(10) through the real listener wiring: a required 404/500 on a bootstrap module, the token endpoint and an `other` model resource => fatal-required-resource, required, immediate, fatalCount 1 => row 1', () => {
  for (const status of [404, 500]) {
    for (const [url, cls, reason] of [[`${BASE}/clashpanel/viewer/ViewerBridge.js`, 'bootstrap', 'R-1'], [`${BASE}/api/auth/token`, 'harness-endpoint', 'R-1'], [URL_B, 'other', 'R-2']]) {
      const w = world();
      const req = fakeRequest({ url, resourceType: cls === 'bootstrap' ? 'script' : 'fetch' });
      w.request(req); w.respond(req, status);
      const e = w.ledger.responseFailures[0];
      assert.deepEqual([e.urlClass, e.stage, e.finalizedBy, e.finalizedSeq === e.responseSeq, e.requirement, e.modelBindingObserved.status], [cls, 'immediate', 'event', true, 'required', 'not-evaluated']);
      assert.deepEqual([e.closeout.classification, e.closeout.reasons], ['fatal-required-resource', [reason, cls]]);
      assert.equal(w.ledger.fatalCount, 1);
      assert.equal(w.witnessNotes(), 1, 'the page fatal latch is requested once per created witness');
      W5(w.ledger);
      const st = stateWith(w.ledger);
      assert.deepEqual(recordSchemaProblems(st), []);
      for (const p of OVERALL_PHASES) assert.equal(computeOverall(st, p).row, 1);
    }
  }
});

test('(10) with the live frozen OPTIONAL_RESPONSE_RULES = [] every status >= 400 on every urlClass is fatal and immediate; 2xx/3xx => no failure entry', () => {
  for (const status of [400, 401, 403, 404, 410, 429, 500, 502, 503, 504]) {
    for (const url of [G2_VIEWER_SCRIPT_URL, `${BASE}/api/auth/token`, URL_B]) {
      const w = world();
      const req = fakeRequest({ url });
      w.request(req); w.respond(req, status);
      const e = w.ledger.responseFailures[0];
      assert.equal(e.stage, 'immediate');
      assert.ok(['fatal-required-resource'].includes(e.closeout.classification), `${status} ${url}`);
      assert.equal(w.ledger.fatalCount, 1);
    }
  }
  for (const status of [200, 204, 301, 302, 304, 399]) {
    const w = world();
    const req = fakeRequest();
    w.request(req); w.respond(req, status); w.finish(req);
    assert.deepEqual([w.ledger.responseFailures.length, w.ledger.fatalCount], [0, 0], String(status));
    assert.equal(w.net.terminals.length, 1, 'requestfinished retained as a terminal (slice-C2 prefix-source input)');
    W5(w.ledger);
  }
  // an unreadable status fails closed (an unclassifiable raw event)
  const w = world();
  const req = fakeRequest();
  w.request(req); w.em.emit('response', { status: () => { throw new Error('x'); }, request: () => req });
  assert.deepEqual([w.ledger.responseFailures[0].closeout.classification, w.ledger.fatalCount], ['unknown-fatal', 1]);
});

const RULE = Object.freeze({ ruleId: 'test-only-optional-404', method: 'GET', model: 'B', pathSuffix: 'geom.bin', resourceTypes: ['fetch'], statuses: [404], rationale: 'offline test only' });
const loadOp = (model, from, to) => ({ recordType: 'load', operationId: `load:${model}`, modelId: model, phase: 'P1', startSeq: from, expectedRequestWindow: { fromSeqExclusive: from, toSeqInclusive: to } });

/**
 * Slice C2: a real load-window world -- the operation-ledger writer records load A then B (or
 * overlapping), finished 2xx requests supply the prefix-source evidence, a rule-candidate 404 on
 * URL_B is received during B's open window; `close()` ends B and runs the `load-windows-closed`
 * finalization (frozen prefix-source snapshot + derivation, then provisional finalization).
 */
function loadWorld({ rules = [RULE], evidence = { A: [], B: [] }, overlap = false } = {}) {
  const w = world({ rules });
  const ops = createOperationLedger({ ledger: w.ledger, nextSeq: w.counter.next });
  const sha = h('urn');
  const fin = (url) => { const r = fakeRequest({ url }); w.request(r); w.respond(r, 200); w.finish(r); };
  const LA = ops.beginLoad({ modelId: 'A', modelUrnSha256: sha });
  for (const u of evidence.A) fin(u);
  if (!overlap) ops.endLoad(LA, 'ready');
  const LB = ops.beginLoad({ modelId: 'B', modelUrnSha256: sha });
  for (const u of evidence.B) fin(u);
  const cand = fakeRequest();
  w.request(cand); w.respond(cand, 404);
  if (overlap) ops.endLoad(LA, 'ready');
  return {
    w, ops, LA, LB, cand,
    close: () => { ops.endLoad(LB, 'ready'); return finalizeLoadWindows(w.ledger, { prefixSources: w.net.prefixSources, appendEntry: (x) => w.sink.recordWitnessEntry(x), rules }); },
  };
}

test('(11) optional-rule path, two-stage (synthetic test-only rule): provisional at responseSeq with no verdict effect; finalized at the later load-window close', () => {
  const cases = [
    ['uniquely bound, inside B window => diagnostic', { evidence: { A: [URL_A], B: [`${PREFIX_B}/b.bin`] } }, 'diagnostic-non-required', 'optional', 0],
    ['key ambiguous => unknown-fatal', { evidence: { A: [`${PREFIX_B}/a.bin`], B: [`${PREFIX_B}/b.bin`] } }, 'unknown-fatal', 'unknown', 1],
    ['non-distinguishing (overlapping windows) => unknown-fatal', { overlap: true, evidence: { A: [URL_A], B: [`${PREFIX_B}/b.bin`] } }, 'unknown-fatal', 'unknown', 1],
    ['bound to the other model => unknown-fatal', { evidence: { A: [`${PREFIX_B}/a.bin`], B: [] } }, 'unknown-fatal', 'unknown', 1],
    ['unbound => unknown-fatal', { evidence: { A: [URL_A], B: [] } }, 'unknown-fatal', 'unknown', 1],
  ];
  for (const [label, opts, cls, req, fatal] of cases) {
    const lw = loadWorld(opts);
    const w = lw.w;
    const e = w.ledger.responseFailures[0];
    assert.deepEqual([e.stage, e.finalizedSeq, e.closeout, w.ledger.fatalCount, w.ledger.fatalWitnesses.length], ['provisional', null, null, 0, 0], `${label}: no effect at responseSeq`);
    const fin = lw.close();
    assert.deepEqual([fin.finalized, fin.closeSeq, e.finalizedSeq, e.finalizedBy], [true, lw.LB.endSeq, lw.LB.endSeq, 'load-windows-closed'], label);
    assert.deepEqual([e.closeout.classification, e.requirement, w.ledger.fatalCount], [cls, req, fatal], label);
    if (cls === 'diagnostic-non-required') {
      assert.deepEqual([e.closeout.rule, e.closeout.boundPrefix, e.closeout.operationId, e.closeout.modelId], [RULE.ruleId, PREFIX_B, lw.LB.operationId, 'B']);
      assert.deepEqual(e.modelBindingObserved, { status: 'unique', modelId: 'B', prefixKey: PREFIX_B });
      assert.ok(e.closeout.evidenceRefs.some((p) => p.startsWith('/errorLedger/prefixSourceLedger/')), 'prefix-source entries supporting boundPrefix are evidenceRefs');
      // retained in full; but a rule absent from the FROZEN constant is an evidence contradiction => row 5
      const ps = networkLedgerProblems({ errorLedger: w.ledger });
      assert.ok(ps.includes('fatal-witness-mismatch:responseFailures[0].diagnostic-evidence-contradiction'), JSON.stringify(ps));
      assert.ok(ps.some((p) => p.endsWith('rule-not-in-OPTIONAL_RESPONSE_RULES')));
    } else {
      assert.equal(w.ledger.fatalWitnesses[0].witnessSeq, lw.LB.endSeq, 'fatality committed at finalization, never earlier');
      assert.equal(e.closeout.boundPrefix, null);
      assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: [RULE] }), [], label);
    }
    assert.equal(e.agree, true);
  }
});

test('(11) a bootstrap or harness-endpoint event matching a synthetic rule stays fatal-required-resource (R-1 precedes R-3); a navigation match is fatal; a window that never closes is unknown-fatal at closeout', () => {
  for (const [url, cls] of [[`${BASE}/clashpanel/geom.bin`, 'bootstrap'], [`${BASE}/api/geom.bin`, 'other']]) {
    const ev = { reqIdValid: true, startSeq: 1, responseSeq: 2, method: 'GET', status: 404, resourceType: 'fetch', urlRedacted: url, urlClass: cls === 'bootstrap' ? 'bootstrap' : 'harness-endpoint', isNavigationRequest: false, phase: 'P1' };
    assert.equal(isHttpRuleCandidate(ev, [RULE]), false);
    assert.deepEqual(classifyHttpResponse(ev, [], [], BOUND, [RULE]).reasons[0], 'R-1');
  }
  const navEv = { reqIdValid: true, startSeq: 96, responseSeq: 97, method: 'GET', status: 404, resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: true, phase: 'P1' };
  assert.deepEqual(classifyHttpResponse(navEv, [loadOp('B', 95, 99)], [], BOUND, [RULE]).classification, 'fatal-required-resource');
  // never-closing window: finalized at closeout as unknown-fatal through the sink; recomputation agrees
  const w = world({ rules: [RULE] });
  const r = fakeRequest();
  w.request(r); w.respond(r, 404);
  assert.equal(w.ledger.responseFailures[0].stage, 'provisional');
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: (x) => w.sink.recordWitnessEntry(x), rules: [RULE] });
  const e = w.ledger.responseFailures[0];
  assert.deepEqual([e.finalizedBy, e.closeout.classification, e.agree, w.ledger.fatalCount], ['closeout', 'unknown-fatal', true, 1]);
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: [RULE] }), []);
  // a stored agree differing from the recomputation => row 5
  const bad = clone(w.ledger); bad.responseFailures[0].agree = false;
  assert.ok(networkLedgerProblems({ errorLedger: bad }, { rules: [RULE] }).includes('request-classification-mismatch:responseFailures[0].agree'));
});

// ------------------------------------------------------------------------------------------
// (14) ClassifierResult schema, (17) cross-field rules
// ------------------------------------------------------------------------------------------

test('(14) ClassifierResult schema: every coupling rule violated singly => schema FAIL', () => {
  const fatal = classifyHttpResponse({ reqIdValid: true, startSeq: 1, responseSeq: 2, method: 'GET', status: 500, resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: false, phase: 'P1' }, [], [], BOUND);
  const s = scenario({ errorText: 'net::ERR_ABORTED', urlClass: 'other', resourceType: 'fetch', nav: false, op: OPS.closePage, phase: 'cleanup', inflight: true, position: 'inside', checksFinal: true });
  const ecTeardown = classifyRequestFailure(s.ev, s.opLedger, s.markers, BOUND);
  const sh = scenario({ errorText: 'net::ERR_ABORTED', urlClass: 'other', resourceType: 'fetch', nav: false, op: OPS.hide, phase: 'P9', inflight: true, position: 'inside', checksFinal: true });
  const ecHide = classifyRequestFailure(sh.ev, sh.opLedger, sh.markers, BOUND);
  assert.deepEqual([classifierResultProblems(fatal, 'httpResponse'), classifierResultProblems(ecTeardown, 'requestfailed'), classifierResultProblems(ecHide, 'requestfailed')], [[], [], []]);
  assert.deepEqual(Object.keys(fatal).sort(), [...CLASSIFIER_RESULT_KEYS].sort());
  const muts = [
    ['non-null boundPrefix on EC-teardown', ecTeardown, 'requestfailed', (r) => { r.boundPrefix = PREFIX_B; }, 'boundPrefix-not-null'],
    ['non-null boundPrefix on a fatal result', fatal, 'httpResponse', (r) => { r.boundPrefix = PREFIX_B; }, 'boundPrefix-not-null'],
    ['EC-hide without boundPrefix', ecHide, 'requestfailed', (r) => { r.boundPrefix = null; }, 'boundPrefix'],
    ['non-null status on requestfailed', ecTeardown, 'requestfailed', (r) => { r.status = 500; }, 'status-not-null'],
    ['expected-cancellation on an httpResponse', fatal, 'httpResponse', (r) => { r.classification = 'expected-cancellation'; }, 'classification-for-eventKind'],
    ['diagnostic-non-required on a requestfailed', ecTeardown, 'requestfailed', (r) => { r.classification = 'diagnostic-non-required'; }, 'classification-for-eventKind'],
    ['verdictEffect inconsistent', fatal, 'httpResponse', (r) => { r.verdictEffect = 'none'; }, 'verdictEffect'],
    ['missing key', fatal, 'httpResponse', (r) => { delete r.rule; }, 'keys'],
    ['extra key', fatal, 'httpResponse', (r) => { r.extra = 1; }, 'keys'],
    ['fatal with operationId', fatal, 'httpResponse', (r) => { r.operationId = 'x'; }, 'operationId-not-null'],
    ['non-fatal without evidenceRefs', ecTeardown, 'requestfailed', (r) => { r.evidenceRefs = []; }, 'evidenceRefs'],
    ['fatal with empty reasons', fatal, 'httpResponse', (r) => { r.reasons = []; }, 'reasons'],
    ['failureReason on an httpResponse', fatal, 'httpResponse', (r) => { r.failureReason = 'x'; }, 'failureReason-not-null'],
  ];
  for (const [label, r0, kind, mut, problem] of muts) {
    const r = clone(r0); mut(r);
    assert.ok(classifierResultProblems(r, kind).includes(problem), `${label}: ${JSON.stringify(classifierResultProblems(r, kind))}`);
  }
});

test('(17) cross-field rules (i)-(v), each violated singly => schema FAIL (row 5)', () => {
  const w = world({ attr: { phase: 'P1', activeCheck: 'C1' } });
  const req = fakeRequest();
  w.request(req); w.respond(req, 500);
  W5(w.ledger);
  const muts = [
    ['(i) stored agree != recomputation', (L) => { L.responseFailures[0].agree = false; }, 'request-classification-mismatch:responseFailures[0].agree'],
    ['(i) eventTime != closeout', (L) => { L.responseFailures[0].eventTime.reasons = ['R-1', 'other']; }, 'request-classification-mismatch:responseFailures[0].agree'],
    ['(ii) immediate with finalizedBy gate', (L) => { L.responseFailures[0].finalizedBy = 'gate'; }, 'network-schema:responseFailures[0].stage-immediate-finalization'],
    ['(ii) provisional with finalizedSeq <= responseSeq', (L) => { const e = L.responseFailures[0]; e.stage = 'provisional'; e.finalizedBy = 'gate'; }, 'network-schema:responseFailures[0].stage-provisional-finalization'],
    ['(iii) fatal-required-resource with optional', (L) => { L.responseFailures[0].requirement = 'optional'; }, 'network-schema:responseFailures[0].requirement-ne-classification'],
    ['(iii) fatal-required-resource with unknown', (L) => { L.responseFailures[0].requirement = 'unknown'; }, 'network-schema:responseFailures[0].requirement-ne-classification'],
    ['(iv) immediate evaluated binding', (L) => { L.responseFailures[0].modelBindingObserved = { status: 'unique', modelId: 'B', prefixKey: PREFIX_B }; }, 'network-schema:responseFailures[0].modelBindingObserved-immediate'],
    ['(iv) unknown binding status', (L) => { const e = L.responseFailures[0]; e.stage = 'provisional'; e.finalizedBy = 'closeout'; e.finalizedSeq = 200; e.modelBindingObserved = { status: 'maybe', modelId: null, prefixKey: PREFIX_B }; }, 'network-schema:responseFailures[0].modelBindingObserved-status'],
    ['(iv) unbound while the binding is unavailable', (L) => { const e = L.responseFailures[0]; e.stage = 'provisional'; e.finalizedBy = 'closeout'; e.finalizedSeq = 200; e.modelBindingObserved = { status: 'unbound', modelId: null, prefixKey: PREFIX_B }; }, 'network-schema:responseFailures[0].modelBindingObserved-unbound'],
    ['(v) activeCheck outside C1..C20', (L) => { L.responseFailures[0].activeCheck = 'C21'; }, 'network-schema:responseFailures[0].activeCheck-enum'],
    ['(v) activeCheck inconsistent with phase', (L) => { L.responseFailures[0].activeCheck = 'C7'; }, 'network-schema:responseFailures[0].activeCheck-phase-inconsistent'],
    ['(v) activeCheck in cleanup', (L) => { L.responseFailures[0].phase = 'cleanup'; }, 'network-schema:responseFailures[0].activeCheck-in-non-check-phase'],
    ['shape: unknown key', (L) => { L.responseFailures[0].extra = 1; }, 'network-schema:responseFailures[0].keys'],
    ['shape: rawEventId', (L) => { L.responseFailures[0].rawEventId = 'hr:1'; }, 'network-schema:responseFailures[0].rawEventId'],
  ];
  for (const [label, mut, problem] of muts) {
    const L = clone(w.ledger); mut(L);
    const ps = networkLedgerProblems({ errorLedger: L });
    assert.ok(ps.includes(problem), `${label}: ${JSON.stringify(ps)}`);
    assert.equal(evaluateOverallRows(stateWith(L), 'pre-closeout')[4].match, true, label);
  }
  // C7/C18 may appear in either of their phases
  const L = clone(w.ledger); L.responseFailures[0].phase = 'P5b'; L.responseFailures[0].activeCheck = 'C7';
  assert.ok(!networkLedgerProblems({ errorLedger: L }).some((p) => p.startsWith('network-schema:') && p.includes('activeCheck')));
});

// ------------------------------------------------------------------------------------------
// Fatal-witness tests (18)-(24): real listener wiring AND the pure correlation; full invariant
// ------------------------------------------------------------------------------------------

test('(18) one requestfailed (FATAL) => one raw event, one identity, ONE witness, fatalCount 1, one required-resource-failure entry', () => {
  const w = world();
  const req = fakeRequest();
  w.request(req); w.fail(req);
  const L = w.ledger;
  assert.deepEqual([L.requestFailures.length, L.correlatedRequests.length, L.fatalWitnesses.length, L.fatalCount], [1, 1, 1, 1]);
  assert.deepEqual(L.entries, [{ kind: 'required-resource-failure', seq: 102, witnessId: 'w:req:q:101' }]);
  assert.deepEqual(L.fatalWitnesses[0].ledgerEntryRef, '/errorLedger/entries/0');
  assert.deepEqual(L.witnessCount, { requestObservations: 1, rawEvents: 1, correlatedIdentities: 1, fatalIdentities: 1, fatalWitnesses: 1, requiredResourceFailureEntries: 1, nonNetworkFatalEntries: 0, fatalCount: 1 });
  W5(L);
  const c = correlateNetworkEvents(L);
  assert.deepEqual(c.witnessCount, L.witnessCount);
});

test('(19) one HTTP 500 (immediate) => one witness, fatalCount 1', () => {
  const w = world();
  const req = fakeRequest();
  w.request(req); w.respond(req, 500);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount, w.ledger.fatalWitnesses[0].witnessSeq], [1, 1, 102]);
  W5(w.ledger);
});

test('(20) both events for one reqId (either order; requestfailed FATAL or EXPECTED) => two raw events, ONE witness, fatalCount 1, witnessSeq = first fatal effective seq; across the gate fatalCountAtGate counts once', () => {
  for (const order of [['respond', 'fail'], ['fail', 'respond']]) {
    const w = world();
    const req = fakeRequest();
    w.request(req);
    for (const op of order) if (op === 'respond') w.respond(req, 500); else w.fail(req);
    const L = w.ledger;
    assert.deepEqual([L.requestFailures.length + L.responseFailures.length, L.correlatedRequests.length, L.fatalWitnesses.length, L.fatalCount], [2, 1, 1, 1], order.join('>'));
    assert.equal(L.fatalWitnesses[0].witnessSeq, 102);
    assert.deepEqual(L.correlatedRequests[0].eventKinds, ['httpResponse', 'requestfailed']);
    W5(L);
    // first event before the gate (gateSeq 102.5 => 103 here), second after: counted once
    assert.deepEqual(recomputeFatalCountAtGate(L, 103), { count: 1, problems: [] });
  }
  // EXPECTED requestfailed (EC-teardown) + a fatal 500 for the same request: one witness (the 500)
  const w = world({ attr: { phase: 'cleanup', activeCheck: null } });
  w.ledger.markers = [{ seq: 90, name: 'cleanup' }];
  const ops = createOperationLedger({ ledger: w.ledger, nextSeq: w.counter.next });
  const req = fakeRequest({ errorText: 'net::ERR_ABORTED' });
  w.request(req); // 101
  ops.beginMutation({ operationType: 'teardown', teardownTarget: 'closePage', phase: 'cleanup', invokedBy: 'cleanup:closePage', cleanupStepRef: '/cleanupStepStatus/closePage' }); // start 102, ack 103
  w.respond(req, 500); // 104
  w.fail(req); // 105
  const L = w.ledger;
  assert.deepEqual(L.requestFailures[0].closeout.classification, 'expected-cancellation');
  assert.deepEqual([L.fatalWitnesses.length, L.fatalCount, L.fatalWitnesses[0].fatalRawEventRefs, L.fatalWitnesses[0].rawEventRefs], [1, 1, ['hr:104'], ['hr:104', 'rf:105']]);
  W5(L);
});

test('(21) duplicate raw events of one valid reqId => all retained, duplicateOf set, one witness; with an invalid reqId => two invalid: identities, two witnesses (fail-safe)', () => {
  for (const kind of ['fail', 'respond']) {
    const w = world();
    const req = fakeRequest();
    w.request(req);
    if (kind === 'fail') { w.fail(req); w.fail(req); } else { w.respond(req, 503); w.respond(req, 503); }
    const list = kind === 'fail' ? w.ledger.requestFailures : w.ledger.responseFailures;
    assert.deepEqual(list.map((e) => e.duplicateOf), [null, kind === 'fail' ? 'rf:102' : 'hr:102']);
    assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount], [1, 1]);
    W5(w.ledger);
    // the same duplication with an invalid reqId (no request event observed)
    const v = world();
    const r2 = fakeRequest();
    if (kind === 'fail') { v.fail(r2); v.fail(r2); } else { v.respond(r2, 503); v.respond(r2, 503); }
    assert.deepEqual(v.ledger.fatalWitnesses.map((x) => x.requestIdentityKey), ['invalid:101', 'invalid:102']);
    assert.equal(v.ledger.fatalCount, 2);
    W5(v.ledger);
  }
});

/** A synthetic raw requestfailed entry (pure correlation input) with a given closeout result. */
function rawRf(seq, reqSeq, closeout, extra = {}) {
  return {
    reqId: `q:${reqSeq}`, reqIdValid: true, rawEventId: `rf:${seq}`, rawEventSeq: seq, identityKey: `req:q:${reqSeq}`, duplicateOf: null, startSeq: reqSeq,
    method: 'GET', resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: false, frameIsMain: true, redirected: false, phase: 'P9', activeCheck: null,
    eventTime: closeout, closeout, agree: true, failSeq: seq, errorText: 'net::ERR_ABORTED', ...extra,
  };
}
const obsOf = (reqSeq) => ({ reqId: `q:${reqSeq}`, startSeq: reqSeq, method: 'GET', resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: false, phase: 'P9', activeCheck: null });
const resultOf = (classification, extra = {}) => ({ eventKind: 'requestfailed', url: URL_B, method: 'GET', status: null, failureReason: 'net::ERR_ABORTED', resourceType: 'fetch', phase: 'P9', modelId: null, boundPrefix: null, operationId: null, opStartSeq: null, classification, rule: null, reasons: classification.includes('fatal') ? ['C-a', 'other'] : [], evidenceRefs: [], verdictEffect: classification.includes('fatal') ? 'fatal-row1' : 'none', ...extra });

test('(22) conflicting classification within one identity => one witness with the worse classification by W-2; phase/activeCheck-only differences are no conflict', () => {
  const ec = (model) => resultOf('expected-cancellation', { modelId: model, boundPrefix: model === 'A' ? PREFIX_A : PREFIX_B, operationId: 'op', opStartSeq: 3, rule: 'EC-hide', evidenceRefs: ['/errorLedger/opLedger/0'] });
  const cases = [
    ['expected + fatal-required-resource', [ec('B'), resultOf('fatal-required-resource')], 'fatal-required-resource'],
    ['fatal-required-resource + unknown-fatal', [resultOf('fatal-required-resource'), resultOf('unknown-fatal')], 'unknown-fatal'],
    ['two non-fatal members bound to different models', [ec('A'), ec('B')], 'unknown-fatal'],
  ];
  for (const [label, [r1, r2], worst] of cases) {
    const L = { ...createEmptyErrorLedger(), requestObservations: [obsOf(1)], requestFailures: [rawRf(5, 1, r1), rawRf(6, 1, r2, { duplicateOf: 'rf:5' })] };
    syncFatalWitnesses(L, { appendEntry: directWitnessEntryAppender(L) });
    assert.deepEqual([L.fatalWitnesses.length, L.fatalWitnesses[0].worstClassification, L.fatalCount], [1, worst, 1], label);
    if (label.startsWith('two non-fatal')) {
      assert.deepEqual([L.correlatedRequests[0].ownership, L.fatalWitnesses[0].fatalRawEventRefs, L.fatalWitnesses[0].witnessSeq], [{ status: 'conflicting', modelIds: ['A', 'B'] }, [], 6]);
    }
  }
  const L = { ...createEmptyErrorLedger(), requestObservations: [obsOf(1)], requestFailures: [rawRf(5, 1, resultOf('fatal-required-resource')), rawRf(6, 1, resultOf('fatal-required-resource', { phase: 'cleanup' }), { duplicateOf: 'rf:5', phase: 'cleanup' })] };
  syncFatalWitnesses(L, { appendEntry: directWitnessEntryAppender(L) });
  assert.deepEqual([L.correlatedRequests[0].ownership.status, L.fatalWitnesses.length], ['consistent', 1]);
  // a worse later member worsens the existing witness in place, never re-counts
  const w = world();
  const req = fakeRequest();
  w.request(req); w.respond(req, 500);
  assert.equal(w.ledger.fatalWitnesses[0].worstClassification, 'fatal-required-resource');
  w.ledger.requestObservations[0].method = 'GET'; // unchanged
  const rf = fakeRequest(); // a different object => unknown identity => its own witness
  w.fail(rf);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount], [2, 2]);
  assert.ok(NETWORK_SEVERITY['unknown-fatal'] > NETWORK_SEVERITY['fatal-required-resource']);
});

test('(24) two-stage witness timing (synthetic rule): no witness at responseSeq; at finalizedSeq iff FATAL; none if diagnostic', () => {
  // bound (B evidence) => diagnostic, no witness; non-distinguishing (overlapping windows) => one witness at finalizedSeq
  for (const [opts, witnesses] of [[{ evidence: { A: [URL_A], B: [`${PREFIX_B}/b.bin`] } }, 0], [{ overlap: true, evidence: { A: [URL_A], B: [`${PREFIX_B}/b.bin`] } }, 1]]) {
    const lw = loadWorld(opts);
    const w = lw.w;
    assert.equal(w.ledger.fatalWitnesses.length, 0);
    lw.close();
    const fs = lw.LB.endSeq;
    assert.equal(w.ledger.fatalWitnesses.length, witnesses);
    if (witnesses) assert.equal(w.ledger.fatalWitnesses[0].witnessSeq, fs);
  }
});

test('(24) recomputation mutation set => fatal-witness-mismatch => row 5', () => {
  const w = world();
  const a = fakeRequest();
  const b = fakeRequest({ url: URL_A });
  w.request(a); w.request(b); w.respond(a, 500); w.fail(a); w.fail(b);
  W5(w.ledger);
  assert.deepEqual([w.ledger.fatalWitnesses.length, w.ledger.fatalCount], [2, 2]);
  const muts = [
    ['a second witness for one identity', (L) => { L.fatalWitnesses.push({ ...clone(L.fatalWitnesses[0]) }); }],
    ['a second entry for one identity', (L) => { L.entries.push({ ...L.entries[0] }); L.fatalCount += 1; }],
    ['fatalCount equal to the raw-event count', (L) => { L.fatalCount = 3; }],
    ['a dropped raw event', (L) => { L.requestFailures.splice(1, 1); }],
    ['a missing witness', (L) => { L.fatalWitnesses.pop(); }],
    ['an improved worstClassification', (L) => { L.fatalWitnesses[0].worstClassification = 'diagnostic-non-required'; }],
    ['a tampered witnessCount field', (L) => { L.witnessCount.fatalIdentities = 1; }],
    ['a broken witness <-> entry bijection', (L) => { L.fatalWitnesses[0].ledgerEntryRef = '/errorLedger/entries/1'; }],
    ['stored witness agree != recomputation', (L) => { L.fatalWitnesses[0].agree = false; }],
    ['a witnessSeq mismatch', (L) => { L.fatalWitnesses[0].witnessSeq = 104; L.entries[0].seq = 104; }],
    ['a stored identityKey differing from the recomputation', (L) => { L.requestFailures[0].identityKey = 'invalid:104'; }],
    ['a raw event counted directly (extra entry without witness)', (L) => { L.entries.push({ kind: 'required-resource-failure', seq: 105, witnessId: 'w:rf:105' }); L.fatalCount += 1; }],
  ];
  for (const [label, mut] of muts) {
    const L = clone(w.ledger); mut(L);
    const ps = networkLedgerProblems({ errorLedger: L });
    assert.ok(ps.some((p) => p.startsWith('fatal-witness-mismatch:')), `${label}: ${JSON.stringify(ps)}`);
    assert.equal(evaluateOverallRows(stateWith(L), 'pre-closeout')[4].match, true, label);
  }
});

test('(4) purity/determinism + event-time vs closeout equivalence over random interleavings; a tampered closeout => request-classification-mismatch (row 5)', () => {
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let trial = 0; trial < 60; trial += 1) {
    const w = world({ attr: { phase: ['P1', 'P9', 'cleanup'][rnd(3)], activeCheck: null } });
    const reqs = Array.from({ length: 4 }, (_, i) => fakeRequest({ url: `${CDN}/m${i}/f.bin`, errorText: ['net::ERR_ABORTED', 'net::ERR_FAILED'][rnd(2)] }));
    for (let k = 0; k < 10; k += 1) {
      const r = reqs[rnd(4)];
      const op = rnd(5);
      if (op === 0) w.request(r); else if (op === 1) w.respond(r, [404, 500, 200][rnd(3)]); else if (op === 2) w.fail(r); else if (op === 3) w.finish(r);
      else w.ledger.markers.push({ seq: w.counter.next(), name: 'P9' });
    }
    const before = clone(w.ledger);
    w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
    finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: (x) => w.sink.recordWitnessEntry(x) });
    for (const k of ['requestFailures', 'responseFailures']) w.ledger[k].forEach((e) => assert.equal(e.agree, true, `trial ${trial}`));
    assert.equal(w.ledger.fatalCount, before.fatalCount, 'closeout never re-counts an already-witnessed identity');
    W5(w.ledger);
    // purity: re-running a classifier on the same inputs is deep-equal and does not mutate them
    for (const e of w.ledger.requestFailures) {
      const input = { reqIdValid: e.reqIdValid, startSeq: e.startSeq, failSeq: e.failSeq, method: e.method, resourceType: e.resourceType, urlRedacted: e.urlRedacted, urlClass: e.urlClass, errorText: e.errorText, isNavigationRequest: e.isNavigationRequest, phase: e.phase };
      const frozen = clone(input);
      assert.deepEqual(classifyRequestFailure(input, [], w.ledger.markers, NON_DISTINGUISHING_PREFIX_DERIVATION), classifyRequestFailure(input, [], w.ledger.markers, NON_DISTINGUISHING_PREFIX_DERIVATION));
      assert.deepEqual(input, frozen);
    }
  }
  const w = world();
  const req = fakeRequest();
  w.request(req); w.fail(req);
  const L = clone(w.ledger);
  L.requestFailures[0].closeout.reasons = ['C-c', 'bootstrap'];
  L.requestFailures[0].eventTime = clone(L.requestFailures[0].closeout);
  assert.ok(networkLedgerProblems({ errorLedger: L }).includes('request-classification-mismatch:requestFailures[0].closeout'));
});

// ------------------------------------------------------------------------------------------
// (6)/(16) redaction; sink seq stamping and latch; seq uniqueness; closeout finalization
// ------------------------------------------------------------------------------------------

test('(6)/(16) redaction: no query string, fragment or token in any persisted observation / raw event / result field', () => {
  const w = world();
  const req = fakeRequest({ url: `${URL_B}?access_token=SECRET&x=1#frag` });
  const req2 = fakeRequest({ url: `${BASE}/api/auth/token?token=SECRET` });
  w.request(req); w.respond(req, 404); w.fail(req); w.request(req2); w.fail(req2);
  const text = JSON.stringify(w.ledger);
  assert.doesNotMatch(text, /SECRET|access_token|token=|#frag|\?/);
  for (const k of ['requestObservations', 'requestFailures', 'responseFailures']) for (const e of w.ledger[k]) assert.doesNotMatch(e.urlRedacted, /[?#]/);
  const tampered = clone(w.ledger); tampered.requestObservations[0].urlRedacted += '?token=x';
  assert.ok(networkLedgerProblems({ errorLedger: tampered }).includes('network-schema:requestObservations[0].urlRedacted-not-redacted'));
});

test('instrumentation fail-closed: an internal exception while handling a failure event is recorded as a harness-exception fatal, never dropped', () => {
  const w = world({ context: () => { throw new Error('context exploded'); } });
  const req = fakeRequest();
  w.request(req); w.fail(req); w.respond(req, 500);
  assert.deepEqual(w.ledger.entries.map((e) => [e.kind, e.detail]), [['harness-exception', 'network-instrumentation:requestfailed'], ['harness-exception', 'network-instrumentation:response']]);
  assert.equal(w.ledger.fatalCount, 2);
});

test('sink: every fatal entry stamped from the run counter; the witness entry is the only network increment; nothing after the commit latch (instrumentation included)', () => {
  const w = world();
  w.sink.recordFatal('pageerror', 'x');
  assert.deepEqual(w.ledger.entries[0], { kind: 'pageerror', detail: 'x', seq: 101 });
  assert.deepEqual([w.ledger.witnessCount.nonNetworkFatalEntries, w.ledger.witnessCount.fatalCount], [1, 1]);
  const req = fakeRequest();
  w.request(req); w.fail(req);
  assert.deepEqual([w.ledger.fatalCount, w.ledger.entries.length], [2, 2]);
  W5(w.ledger);
  w.sink.markCommitted();
  const snapshot = clone(w.ledger);
  w.request(fakeRequest()); w.fail(fakeRequest()); w.respond(fakeRequest(), 500); w.sink.recordFatal('pageerror', 'late');
  assert.deepEqual(w.ledger, snapshot, 'events after the terminal commit are ignored');
  assert.equal(w.sink.recordWitnessEntry({ seq: 999, witnessId: 'w:x' }), -1);
});

test('seq uniqueness across collections: a duplicated primary allocation => seq-not-unique (row 5); references (witness entries, C1 finalizedSeq) are not allocations', () => {
  const w = world();
  const req = fakeRequest();
  w.request(req); w.fail(req);
  const st = stateWith(w.ledger);
  assert.deepEqual(primarySeqAllocations(st).problems, []);
  assert.deepEqual(recordSchemaProblems(st), []);
  assert.equal(maxRecordedSeq(st), 102);
  const dup = clone(st); dup.errorLedger.markers = [{ seq: 101, name: 'P0' }];
  assert.ok(recordSchemaProblems(dup).includes('seq-not-unique:101:errorLedger.markers[0]|errorLedger.requestObservations[0]'));
  assert.equal(evaluateOverallRows(dup, 'pre-closeout')[4].match, true);
  const c = createRunSeqCounter();
  assert.deepEqual([c.next(), c.next(), c.observe(10), c.next(), c.observe(3), c.peek()], [1, 2, 10, 11, 11, 11]);
});

test('closeout: a still-provisional response is finalized at closeout (finalizedBy closeout, fresh seq) and counted through the sink before step 1; recomputation agrees', () => {
  const w = world({ rules: [RULE] });
  const r = fakeRequest();
  w.request(r); w.respond(r, 404);
  assert.equal(w.ledger.fatalCount, 0);
  const marker = w.counter.next();
  w.ledger.markers.push({ seq: marker, name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: (x) => w.sink.recordWitnessEntry(x), rules: [RULE] });
  const e = w.ledger.responseFailures[0];
  assert.ok(e.finalizedSeq > marker);
  assert.deepEqual([e.finalizedBy, w.ledger.fatalCount, w.ledger.fatalWitnesses[0].witnessSeq], ['closeout', 1, e.finalizedSeq]);
  assert.deepEqual(networkLedgerProblems({ errorLedger: w.ledger }, { rules: [RULE] }), []);
  // under the frozen empty constant the same provisional entry is a contradiction (no candidate can exist)
  assert.ok(networkLedgerProblems({ errorLedger: w.ledger }).some((p) => p.startsWith('request-classification-mismatch:')));
});
