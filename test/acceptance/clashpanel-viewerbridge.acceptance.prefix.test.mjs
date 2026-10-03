// test/acceptance/clashpanel-viewerbridge.acceptance.prefix.test.mjs
//
// Offline tests for the G2 harness slice C2 (procedure §9.2 RC1-C1 "Harness-owned operation ledger",
// "Model binding -- prefix-source ledger and derivation", "Classifier result", §10): the exact disjoint
// `loadOperation` / `mutationOperation` shapes and the operation-ledger writer with its node-side
// acknowledgement barrier (item 9, test (15)); the durable prefix-source ledger, `derivePrefixes`,
// `prefixDerivation` + hashes and the closeout recomputation (item 10, test (12)); ambiguous-prefix
// accounting, binding availability and the `load-windows-closed` finalization (item 11, test (13));
// `boundPrefix` provenance / prefix-source `evidenceRefs` for both classifiers (item 12); redaction
// (test (16)) and the C2 collections being REQUIRED (item 13). Fakes only: no Playwright, no Viewer,
// no browser. The end-to-end wiring through `runPostReservation` lives in the mainflow dry run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LIVE_PATH_WIRED, LOAD_OPERATION_KEYS, MUTATION_OPERATION_KEYS, PREFIX_SOURCE_ENTRY_KEYS, PREFIX_DERIVATION_KEYS, OP_LEDGER_SPY_METHODS,
  G2_DUAL_COUNTER_GATE, locateFunctionSource, createEmptyErrorLedger, createRunSeqAllocator, createFatalEventSink, createNetworkInstrumentation, wireFatalListeners,
  createOperationLedger, opLedgerRecordProblems, derivePrefixes, buildPrefixSourceLedger, refreshPrefixSourceLedger, prefixBindingState,
  finalizeLoadWindows, finalizeNetworkLedgerAtCloseout, networkLedgerProblems, classifyRequestFailure, classifyHttpResponse, classifierResultProblems,
  prefixSupportRefs, isPrefixLedgerFrozen, prefixSnapshotCutoff, runAcknowledgedMutation, guardedUnloadModel, buildCleanupSteps, loadCompletionOutcome,
  createCallRecorder, isVerdictCriticalSpyRecord, primarySeqAllocations, sha256Hex, canonicalJson,
} from './clashpanel-viewerbridge.acceptance.mjs';
import { livePathWiredDeclaration } from './support/g2-harness-copy.mjs';

const HARNESS_SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));
const URN_SHA = sha256Hex('urn:test');

const BASE = 'http://localhost:8080';
const CDN = 'https://cdn.derivative.invalid';
const PREFIX_A = `${CDN}/modelA/output/0`;
const PREFIX_B = `${CDN}/modelB/output/0`;
const PREFIX_S = `${CDN}/shared/output/0`;
const URL_A = `${PREFIX_A}/geom.bin`;
const URL_B = `${PREFIX_B}/geom.bin`;
const RULE = Object.freeze({ ruleId: 'test-only-optional-404', method: 'GET', model: 'B', pathSuffix: 'geom.bin', resourceTypes: ['fetch'], statuses: [404], rationale: 'offline test only' });

// ------------------------------------------------------------------------------------------
// Fakes: the real sink / instrumentation / operation-ledger writer over a fake page
// ------------------------------------------------------------------------------------------

function fakeRequest({ url = URL_B, method = 'GET', resourceType = 'fetch', nav = false, errorText = 'net::ERR_ABORTED' } = {}) {
  return { url: () => url, method: () => method, resourceType: () => resourceType, isNavigationRequest: () => nav, failure: () => ({ errorText }), redirectedFrom: () => null, frame: () => 'main' };
}

function world({ seqStart = 100, rules, attr = { phase: 'P1', activeCheck: 'C1' } } = {}) {
  const ledger = createEmptyErrorLedger();
  const counter = createRunSeqAllocator();
  while (counter.peek() < seqStart) counter.next();
  const sink = createFatalEventSink(ledger, { nextSeq: counter.next });
  const at = { ...attr };
  const net = createNetworkInstrumentation({ ledger, nextSeq: counter.next, sink, baseUrl: BASE, attribution: () => at, mainFrame: () => 'main', ...(rules ? { rules } : {}) });
  const ops = createOperationLedger({ ledger, nextSeq: counter.next });
  const em = new EventEmitter();
  const page = { on: (e, f) => em.on(e, f), off: (e, f) => em.off(e, f) };
  wireFatalListeners({ page, browser: null, live: { closingIntent: false }, fatal: (k, d) => sink.recordFatal(k, d), network: net });
  const w = {
    ledger, counter, sink, net, ops, at,
    set: (patch) => Object.assign(at, patch),
    request: (r) => em.emit('request', r),
    respond: (r, status) => em.emit('response', { status: () => status, request: () => r }),
    finish: (r) => em.emit('requestfinished', r),
    fail: (r) => em.emit('requestfailed', r),
    ok: (url) => { const r = fakeRequest({ url }); w.request(r); w.respond(r, 200); w.finish(r); return r; },
    appendEntry: (x) => sink.recordWitnessEntry(x),
  };
  return w;
}

/** Loads A then B (or overlapping) with finished-2xx evidence; `close()` ends B and runs `load-windows-closed`. */
function withLoads(w, { A = [URL_A], B = [`${PREFIX_B}/b.bin`], overlap = false, inB = null, rules } = {}) {
  const LA = w.ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA });
  for (const u of A) w.ok(u);
  if (!overlap) w.ops.endLoad(LA, 'ready');
  const LB = w.ops.beginLoad({ modelId: 'B', modelUrnSha256: URN_SHA });
  for (const u of B) w.ok(u);
  if (inB) inB(w);
  if (overlap) w.ops.endLoad(LA, 'ready');
  w.ops.endLoad(LB, 'ready');
  const fin = finalizeLoadWindows(w.ledger, { prefixSources: w.net.prefixSources, appendEntry: w.appendEntry, ...(rules ? { rules } : {}) });
  return { LA, LB, fin };
}

/** A P9/cleanup mutation begun through the writer (+ a resolvable harness spy record for P9). */
function spyFor(w, method, seq) {
  return { seq, phase: 'P9', activeCheck: 'C16', activeControl: null, method, origin: 'harness', callIndex: 0, argSummaries: [], argRefIds: [], argsDigest: 'x', at: 'x', atMs: 0, outcome: null, injected: false };
}
const NP = (w, opts) => networkLedgerProblems({ errorLedger: w.ledger, spyLedger: w.spy || [] }, opts);

// ------------------------------------------------------------------------------------------
// Static
// ------------------------------------------------------------------------------------------

test('static: the slice-C1 non-distinguishing stand-in is gone; LIVE_PATH_WIRED is declared exactly once; the dual-counter gate stays documented (H1 single-allocator remediation), resolved and mechanically coupled to live (M2)', () => {
  assert.equal(HARNESS_SOURCE.includes('NON_DISTINGUISHING_PREFIX_DERIVATION'), false);
  // Not a pin: only that the declaration is single and unambiguous (helper throws otherwise). The real value is pinned once, in live-path-isolation.test.mjs.
  livePathWiredDeclaration(HARNESS_SOURCE);
  assert.equal(G2_DUAL_COUNTER_GATE.resolved, true);
  // Live-readiness remediation: the seqBase stopgap in g2BuildEnv is gone -- page records are numbered by
  // page-local ordinals (createPageOrdinalSource) mapped by the ONE Node allocator, never seeded from a node seqBase.
  assert.equal(HARNESS_SOURCE.includes('G2_DUAL_COUNTER_GATE (unresolved): page records are numbered here'), false, 'the seqBase stopgap label is gone');
  {
    const { start, end } = locateFunctionSource(HARNESS_SOURCE, 'g2BuildEnv');
    const body = HARNESS_SOURCE.slice(start, end);
    assert.equal(body.includes('seqBase'), false, 'g2BuildEnv no longer seeds page numbering from seqBase');
    assert.ok(body.includes('createPageOrdinalSource('), 'g2BuildEnv numbers page records with page-local ordinals');
  }
  // M2: mechanical coupling -- live can never be enabled while the gate is unresolved.
  assert.equal(LIVE_PATH_WIRED && G2_DUAL_COUNTER_GATE.resolved !== true, false, 'LIVE_PATH_WIRED must not be true while G2_DUAL_COUNTER_GATE is unresolved');
  for (const fn of ['main', 'runChecksInPhaseOrder']) {
    const { start, end } = locateFunctionSource(HARNESS_SOURCE, fn);
    const body = HARNESS_SOURCE.slice(start, end);
    const wired = body.indexOf('LIVE_PATH_WIRED');
    const gate = body.indexOf('G2_DUAL_COUNTER_GATE.resolved !== true');
    assert.ok(wired !== -1 && gate > wired, `${fn}: the dual-counter refusal follows the wiring gate`);
    assert.ok(body.includes("'dual-counter-gate-unresolved'"), `${fn}: refusal reason`);
  }
  // M1 (attribution) is named by the same gate's comment -- its history and its remediation.
  const gateDoc = HARNESS_SOURCE.slice(HARNESS_SOURCE.indexOf('BEFORE-LIVE-EXECUTION GATE (`resolved:true`'), HARNESS_SOURCE.indexOf('const G2_DUAL_COUNTER_GATE ='));
  assert.match(gateDoc, /H1 sequencing remediation/);
  assert.match(gateDoc, /ONE Node-owned\s+\*\s+allocator \(`createRunSeqAllocator`\)/);
  assert.match(gateDoc, /NON-AUTHORITATIVE local ordinal \(`createPageOrdinalSource`/);
  assert.match(gateDoc, /no page ordinal and no second counter survives/);
  assert.match(gateDoc, /'dual-counter-gate-unresolved'/);
  assert.deepEqual(derivePrefixes([], []), {
    algorithm: 'g2-prefix-v1', loadOperationIds: { A: null, B: null }, windows: { A: null, B: null }, bindingAvailable: false, nonDistinguishingReason: 'no-load-operation',
    candidateKeys: { A: [], B: [] }, ambiguousKeys: [], modelPrefixes: { A: [], B: [] },
    ledgerSha256: sha256Hex(canonicalJson([])),
    derivationSha256: sha256Hex(canonicalJson({ bindingAvailable: false, candidateKeys: { A: [], B: [] }, ambiguousKeys: [], modelPrefixes: { A: [], B: [] } })),
  });
});

test('item 13: the C2 collections are REQUIRED in the error ledger (opLedger, prefixSourceLedger, prefixDerivation, ambiguousPrefixes, modelPrefixes)', () => {
  const empty = createEmptyErrorLedger();
  assert.deepEqual(networkLedgerProblems({ errorLedger: empty }), []);
  for (const k of ['opLedger', 'prefixSourceLedger', 'ambiguousPrefixes', 'prefixDerivation', 'modelPrefixes']) {
    const L = clone(empty); delete L[k];
    assert.ok(networkLedgerProblems({ errorLedger: L }).some((p) => p.startsWith(`network-schema:${k}-not-`)), k);
  }
});

// ------------------------------------------------------------------------------------------
// Item 9 / test (15): operation ledger
// ------------------------------------------------------------------------------------------

function legalLedger() {
  const w = world();
  const { LA, LB } = withLoads(w);
  w.set({ phase: 'P9', activeCheck: 'C16' });
  const hide = w.ops.beginMutation({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
  w.spy = [spyFor(w, 'viewer.hideModel', hide.ackSeq + 1)];
  w.counter.next();
  w.ops.endMutation(hide.operationId, 'settled', { spyRef: `spyLedger:seq:${hide.ackSeq + 1}` });
  const unload = w.ops.beginMutation({ operationType: 'unload', modelId: 'B', phase: 'P9', invokedBy: 'C17' });
  w.spy.push(spyFor(w, 'viewer.unloadModel', unload.ackSeq + 1));
  w.counter.next();
  w.ops.endMutation(unload.operationId, 'settled', { spyRef: `spyLedger:seq:${unload.ackSeq + 1}` });
  w.ledger.markers.push({ seq: w.counter.next(), name: 'cleanup' });
  w.set({ phase: 'cleanup', activeCheck: null });
  const ua = w.ops.pageOperation('begin', { operationType: 'unload', modelId: 'A', phase: 'cleanup', invokedBy: 'cleanup:unloadModelA' });
  w.ops.pageOperation('end', { operationId: ua.operationId, terminalOutcome: 'settled' });
  const tds = ['closePage', 'closeContext', 'closeBrowser'].map((t) => {
    const r = w.ops.beginMutation({ operationType: 'teardown', teardownTarget: t, phase: 'cleanup', invokedBy: `cleanup:${t}`, cleanupStepRef: `/cleanupStepStatus/${t}` });
    w.ops.endMutation(r.operationId, 'settled');
    return r;
  });
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  w.ops.seal();
  return { w, LA, LB, hide, unload, ua, tds };
}

test('(15) each disjoint shape accepted: load (ready), hide/C16, unload/C17, cleanup unload, teardown x3 -- exact keys, start < ack < end, windows closed by the next boundary', () => {
  const { w, LA, LB, hide, unload, tds } = legalLedger();
  for (const o of w.ledger.opLedger) assert.deepEqual(opLedgerRecordProblems(o), [], o.operationId);
  assert.deepEqual(Object.keys(LA).sort(), [...LOAD_OPERATION_KEYS].sort());
  assert.deepEqual(Object.keys(hide).sort(), [...MUTATION_OPERATION_KEYS].sort());
  assert.deepEqual([LA.completionOutcome, LB.completionOutcome, LA.expectedRequestWindow.toSeqInclusive, LB.expectedRequestWindow.fromSeqExclusive], ['ready', 'ready', LA.endSeq, LB.startSeq]);
  assert.ok(hide.startSeq < hide.ackSeq && hide.ackSeq < hide.endSeq);
  assert.equal(hide.cancellationWindow.toSeqExclusive, unload.startSeq, 'the next opLedger record closes the window');
  assert.equal(tds[2].cancellationWindow.toSeqExclusive, w.ledger.markers.find((m) => m.name === 'closeout').seq, 'the closeout marker closes the last window');
  assert.equal(w.ledger.opLedger.find((o) => o.invokedBy === 'cleanup:unloadModelA').causalEvidence.cleanupStepRef, '/cleanupStepStatus/unloadModelA');
  assert.deepEqual(NP(w), []);
  assert.deepEqual(primarySeqAllocations({ errorLedger: w.ledger }).problems, [], 'start/ack/end are unique allocations of the one counter');
});

test('(15) mixed / incoherent shapes, unknown keys and broken couplings => schema FAIL (row 5)', () => {
  const { w } = legalLedger();
  const idx = (pred) => w.ledger.opLedger.findIndex(pred);
  const iLoad = idx((o) => o.recordType === 'load');
  const iHide = idx((o) => o.operationType === 'hide');
  const iTd = idx((o) => o.operationType === 'teardown');
  const iUa = idx((o) => o.invokedBy === 'cleanup:unloadModelA');
  const iC17 = idx((o) => o.invokedBy === 'C17');
  const cases = [
    ['load carrying cancellationWindow', iLoad, (o) => { o.cancellationWindow = { fromSeqExclusive: o.startSeq, toSeqExclusive: null }; }, 'keys'],
    ['mutation carrying expectedRequestWindow', iHide, (o) => { o.expectedRequestWindow = { fromSeqExclusive: o.startSeq, toSeqInclusive: null }; }, 'keys'],
    ['teardown with non-null modelId', iTd, (o) => { o.modelId = 'A'; }, 'coupling'],
    ['hide with modelId A', iHide, (o) => { o.modelId = 'A'; }, 'coupling'],
    ['C17 unload of model A', iC17, (o) => { o.modelId = 'A'; }, 'coupling'],
    ['cleanup unload of A invoked as unloadModelB', iUa, (o) => { o.invokedBy = 'cleanup:unloadModelB'; }, 'coupling'],
    ['unknown key', iHide, (o) => { o.extra = 1; }, 'keys'],
    ['unknown recordType', iHide, (o) => { o.recordType = 'reload'; }, 'recordType'],
    ['ackSeq not after startSeq', iHide, (o) => { o.ackSeq = o.startSeq; o.causalEvidence.ackSeq = o.startSeq; }, 'ackSeq'],
    ['causalEvidence.ackSeq differs', iHide, (o) => { o.causalEvidence.ackSeq += 1; }, 'causalEvidence'],
    ['P9 record carrying a cleanupStepRef', iHide, (o) => { o.causalEvidence.cleanupStepRef = '/cleanupStepStatus/x'; }, 'causalEvidence-ref'],
    ['cleanup record without cleanupStepRef', iTd, (o) => { o.causalEvidence.cleanupStepRef = null; }, 'causalEvidence-ref'],
    ['endSeq without endedAt', iHide, (o) => { o.endedAt = null; }, 'endedAt'],
    ['settled with endSeq null', iHide, (o) => { o.endSeq = null; o.endedAt = null; }, 'terminalOutcome'],
    ['load window not (startSeq, endSeq]', iLoad, (o) => { o.expectedRequestWindow.toSeqInclusive += 1; }, 'expectedRequestWindow'],
    ['load not-settled with endSeq', iLoad, (o) => { o.completionOutcome = 'not-settled'; }, 'completionOutcome'],
    ['load modelUrnSha256 not hex', iLoad, (o) => { o.modelUrnSha256 = 'urn'; }, 'modelUrnSha256'],
    ['load phase P9', iLoad, (o) => { o.phase = 'P9'; }, 'phase'],
  ];
  for (const [label, i, mutate, want] of cases) {
    const L = clone(w.ledger);
    mutate(L.opLedger[i]);
    const ps = networkLedgerProblems({ errorLedger: L, spyLedger: w.spy });
    assert.ok(ps.includes(`network-schema:opLedger[${i}].${want}`), `${label}: ${JSON.stringify(ps)}`);
  }
  // ledger-level: wrong window end, duplicate operationId, duplicate load record, unresolvable / pre-ack spy evidence
  const L1 = clone(w.ledger); L1.opLedger[iHide].cancellationWindow.toSeqExclusive += 1;
  assert.ok(networkLedgerProblems({ errorLedger: L1, spyLedger: w.spy }).includes(`network-schema:opLedger[${iHide}].cancellationWindow-end`));
  const L2 = clone(w.ledger); L2.opLedger[iTd].operationId = L2.opLedger[iHide].operationId;
  assert.ok(networkLedgerProblems({ errorLedger: L2, spyLedger: w.spy }).includes(`network-schema:opLedger[${iTd}].operationId-duplicated`));
  const L3 = clone(w.ledger); L3.opLedger.splice(iLoad + 1, 0, { ...clone(L3.opLedger[iLoad]), operationId: 'load:A:dup' });
  assert.ok(networkLedgerProblems({ errorLedger: L3, spyLedger: w.spy }).includes('network-schema:opLedger.load-A-duplicated'));
  assert.equal(prefixBindingState(L3.opLedger).bindingAvailable, false, 'duplicate load records are additionally non-distinguishing (fail-safe)');
  assert.ok(networkLedgerProblems({ errorLedger: w.ledger, spyLedger: [] }).includes(`network-schema:opLedger[${iHide}].causalEvidence-unresolved`), 'a spyRef must resolve to the recorded invocation');
  const early = clone(w.spy); early[0].seq = w.ledger.opLedger[iHide].startSeq;
  const L4 = clone(w.ledger); L4.opLedger[iHide].causalEvidence.spyRef = `spyLedger:seq:${early[0].seq}`;
  assert.ok(networkLedgerProblems({ errorLedger: L4, spyLedger: early }).includes(`network-schema:opLedger[${iHide}].causalEvidence-unresolved`), 'a spy record before the ack is not the acknowledged invocation');
  assert.ok(OP_LEDGER_SPY_METHODS.every((m) => isVerdictCriticalSpyRecord({ method: m, origin: 'harness' })), 'the causal spy records are never dropped by the spy-ledger cap');
});

test('(15) the operation-ledger writer: start fields + node-side ack appended BEFORE the caller invokes; coupling enforced (nothing appended); sealed => nothing; page barrier refuses everything but C16/C17/cleanup unload', () => {
  const w = world();
  const before = w.counter.peek();
  const rec = w.ops.beginMutation({ operationType: 'teardown', teardownTarget: 'closePage', phase: 'cleanup', invokedBy: 'cleanup:closePage', cleanupStepRef: '/cleanupStepStatus/closePage' });
  assert.deepEqual([rec.startSeq, rec.ackSeq, rec.endSeq, rec.terminalOutcome], [before + 1, before + 2, null, 'not-settled']);
  assert.equal(w.ledger.opLedger.length, 1);
  assert.throws(() => w.ops.beginMutation({ operationType: 'hide', modelId: 'A', phase: 'P9', invokedBy: 'C16' }), /invalid descriptor/);
  assert.throws(() => w.ops.beginMutation({ operationType: 'teardown', teardownTarget: 'closePage', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:closePage', cleanupStepRef: '/cleanupStepStatus/closePage' }), /invalid descriptor/);
  assert.equal(w.ledger.opLedger.length, 1, 'an invalid descriptor appends nothing');
  for (const bad of [
    { operationType: 'hide', modelId: 'A', phase: 'P9', invokedBy: 'C16' },
    { operationType: 'unload', modelId: 'A', phase: 'P9', invokedBy: 'C17' },
    { operationType: 'unload', modelId: 'A', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' },
    { operationType: 'teardown', teardownTarget: 'closePage', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closePage' },
    { operationType: 'hide', modelId: 'B', phase: 'P5a', invokedBy: 'C16' },
  ]) assert.deepEqual(w.ops.pageOperation('begin', bad), { ok: false, reason: 'refused' }, JSON.stringify(bad));
  assert.deepEqual(w.ops.pageOperation('end', { operationId: rec.operationId, terminalOutcome: 'settled' }), { ok: false, reason: 'unknown-operation' }, 'the page cannot end a node-owned teardown');
  assert.deepEqual(w.ops.pageOperation('nope', {}), { ok: false, reason: 'unknown-action' });
  const ok = w.ops.pageOperation('begin', { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
  assert.equal(ok.ok, true);
  assert.equal(rec.cancellationWindow.toSeqExclusive, w.ledger.opLedger[1].startSeq, 'a new record closes the previous window');
  w.ops.seal();
  assert.equal(w.ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA }), null);
  assert.deepEqual(w.ops.pageOperation('begin', { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }), { ok: false, reason: 'sealed' });
});

test('(15) expected-cancellation evidence: naming a load record or a record whose window does not contain failSeq => row 5; temporal overlap alone (C-a, C-b or C-c′ unmet inside a hide window) => FATAL', () => {
  const w = world();
  withLoads(w);
  w.set({ phase: 'P9', activeCheck: 'C16' });
  const inflight = (url, extra = {}) => { const r = fakeRequest({ url, ...extra }); w.request(r); return r; };
  const okReq = inflight(`${PREFIX_B}/stream.bin`);
  const notAborted = inflight(`${PREFIX_B}/s2.bin`, { errorText: 'net::ERR_FAILED' });
  const script = inflight(`${PREFIX_B}/s3.js`, { resourceType: 'script' });
  const unbound = inflight(`${CDN}/elsewhere/x.bin`);
  const otherModel = inflight(`${PREFIX_A}/x.bin`);
  const hide = w.ops.beginMutation({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
  for (const r of [okReq, notAborted, script, unbound, otherModel]) w.fail(r);
  const cls = w.ledger.requestFailures.map((e) => [e.closeout.classification, e.closeout.rule, e.closeout.reasons]);
  assert.deepEqual(cls[0].slice(0, 2), ['expected-cancellation', 'EC-hide']);
  assert.deepEqual(cls.slice(1).map((c) => c[0]), ['fatal-required-resource', 'fatal-required-resource', 'fatal-required-resource', 'fatal-required-resource']);
  assert.ok(cls[1][2].includes('C-a') && cls[2][2].includes('C-b') && cls[3][2].includes('C-c′') && cls[4][2].includes('C-c′'));
  assert.equal(w.ledger.fatalCount, 4);
  w.ops.endMutation(hide.operationId, 'settled', { spyRef: 'spyLedger:seq:999' });
  w.spy = [spyFor(w, 'viewer.hideModel', 999)];
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, prefixSources: w.net.prefixSources });
  assert.deepEqual(NP(w), []);
  const iLoad = w.ledger.opLedger.findIndex((o) => o.recordType === 'load' && o.modelId === 'B');
  for (const [label, mutate] of [
    ['names a load record', (L) => { L.requestFailures[0].closeout.operationId = L.opLedger[iLoad].operationId; L.requestFailures[0].closeout.opStartSeq = L.opLedger[iLoad].startSeq; }],
    ['window does not contain failSeq', (L) => { const o = L.opLedger.find((x) => x.operationType === 'hide'); o.cancellationWindow.toSeqExclusive = L.requestFailures[0].failSeq; }],
  ]) {
    const L = clone(w.ledger); mutate(L);
    L.requestFailures[0].eventTime = clone(L.requestFailures[0].closeout);
    const ps = networkLedgerProblems({ errorLedger: L, spyLedger: w.spy });
    assert.ok(ps.some((p) => p.startsWith('request-classification-mismatch:requestFailures[0]') || p.includes('cancellationWindow-end')), `${label}: ${JSON.stringify(ps)}`);
  }
});

test('(15) runAcknowledgedMutation: ack before the spy record and the invocation; end carries the spyRef; absent / failing ops => the mutation still runs and nothing is recorded (fail-safe)', async () => {
  const order = [];
  const w = world();
  const recorder = createCallRecorder({ nextSeq: w.counter.next });
  const ops = {
    begin: async (d) => { order.push('begin'); return w.ops.pageOperation('begin', d); },
    end: async (a) => { order.push('end'); return w.ops.pageOperation('end', a); },
  };
  const v = await runAcknowledgedMutation({ ops, desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, recorder, method: 'viewer.hideModel', args: [2], invoke: () => { order.push('invoke'); return 7; } });
  assert.equal(v, 7);
  assert.deepEqual(order, ['begin', 'invoke', 'end']);
  const op = w.ledger.opLedger[0];
  const spy = recorder.records[0];
  assert.deepEqual([spy.method, spy.origin, op.causalEvidence.spyRef, spy.seq > op.ackSeq, op.terminalOutcome], ['viewer.hideModel', 'harness', `spyLedger:seq:${spy.seq}`, true, 'settled']);
  // a throwing invocation ends `threw` and rethrows
  await assert.rejects(runAcknowledgedMutation({ ops, desc: { operationType: 'unload', modelId: 'B', phase: 'P9', invokedBy: 'C17' }, recorder, method: 'viewer.unloadModel', args: [], invoke: async () => { throw new Error('x'); } }), /x/);
  assert.equal(w.ledger.opLedger[1].terminalOutcome, 'threw');
  // absent / rejecting ops: invoked, nothing recorded
  let ran = 0;
  await runAcknowledgedMutation({ ops: null, desc: {}, invoke: () => { ran += 1; } });
  await runAcknowledgedMutation({ ops: { begin: async () => { throw new Error('binding gone'); }, end: async () => {} }, desc: {}, invoke: () => { ran += 1; } });
  assert.deepEqual([ran, w.ledger.opLedger.length], [2, 2]);
});

test('(15) a cleanup unload record exists only around an actual viewer.unloadModel call (already-absent => no record); teardown records only for a present target', async () => {
  const w = world({ attr: { phase: 'cleanup', activeCheck: null } });
  const ops = { begin: async (d) => w.ops.pageOperation('begin', d), end: async (a) => w.ops.pageOperation('end', a) };
  const mA = { id: 'A' };
  const models = [mA];
  const viewer = { getAllModels: () => models.slice(), unloadModel: async (m) => { models.splice(models.indexOf(m), 1); } };
  assert.deepEqual(await guardedUnloadModel({ viewer, model: { id: 'B' }, label: 'unloadModelB', ops, modelId: 'B' }), { outcome: 'already-absent' });
  assert.equal(w.ledger.opLedger.length, 0);
  assert.deepEqual(await guardedUnloadModel({ viewer, model: mA, label: 'unloadModelA', ops, modelId: 'A' }), { outcome: 'unloaded' });
  assert.deepEqual(w.ledger.opLedger.map((o) => [o.operationType, o.modelId, o.invokedBy, o.terminalOutcome]), [['unload', 'A', 'cleanup:unloadModelA', 'settled']]);
  const live = { page: { close: async () => {}, isClosed: () => false }, context: null, browser: { close: async () => {}, isConnected: () => true } };
  const steps = buildCleanupSteps({ live, rpcCall: async () => ({ ok: true }), timers: undefined, ops: w.ops });
  await steps.closePage.run(); await steps.closeContext.run(); await steps.closeBrowser.run();
  assert.deepEqual(w.ledger.opLedger.slice(1).map((o) => [o.teardownTarget, o.terminalOutcome]), [['closePage', 'settled'], ['closeBrowser', 'settled']], 'an absent context is not a teardown operation');
  for (const o of w.ledger.opLedger) assert.deepEqual(opLedgerRecordProblems(o), []);
});

test('(15) loadCompletionOutcome maps the settled load to ready | rejected | timeout:load | harness-exception', () => {
  assert.equal(loadCompletionOutcome({ status: 'completed', value: { doc: { status: 'completed' }, node: { status: 'completed' }, ready: { status: 'ready' } } }), 'ready');
  assert.equal(loadCompletionOutcome({ status: 'completed', value: { doc: { status: 'failed' }, node: null, ready: null } }), 'rejected');
  assert.equal(loadCompletionOutcome({ status: 'completed', value: { doc: { status: 'completed' }, node: { status: 'completed' }, ready: { status: 'timed-out' } } }), 'timeout:load');
  assert.equal(loadCompletionOutcome({ status: 'timed-out' }), 'timeout:load');
  assert.equal(loadCompletionOutcome({ status: 'threw', error: new Error('x') }), 'harness-exception');
});

// ------------------------------------------------------------------------------------------
// Item 10 / test (12): prefix-source derivation
// ------------------------------------------------------------------------------------------

const WINDOWS = {
  disjoint: { A: [10, 20], B: [30, 40] },
  overlapping: { A: [10, 35], B: [30, 40] },
  open: { A: [10, 20], B: [30, null] },
  missing: { A: [10, 20], B: null },
};
const TERMINALS = {
  'finished-2xx': { t: { terminalKind: 'requestfinished', terminalSeq: 33 }, status: 200 },
  'finished-3xx': { t: { terminalKind: 'requestfinished', terminalSeq: 33 }, status: 302 },
  'finished-404': { t: { terminalKind: 'requestfinished', terminalSeq: 33 }, status: 404 },
  requestfailed: { t: { terminalKind: 'requestfailed', terminalSeq: 33 }, status: null },
  'finished-after-window': { t: { terminalKind: 'requestfinished', terminalSeq: 45 }, status: 200 },
  'not-finished': { t: null, status: 200 },
};
const loadRec = (m, w) => (w ? { recordType: 'load', operationId: `load:${m}`, modelId: m, startSeq: w[0], endSeq: w[1] } : null);

/** Independent oracle of the §9.2 entry reason (first applicable exclusion, listed order). */
function oracleReason(e, cfg, ambiguous) {
  if (!['fetch', 'xhr', 'other', 'image'].includes(e.resourceType)) return 'excluded:resource-type';
  if (e.urlClass !== 'other') return 'excluded:url-class';
  if (e.isNavigationRequest) return 'excluded:navigation';
  if (e.terminalKind === 'requestfailed') return 'excluded:failed';
  if (e.status !== null && !(e.status >= 200 && e.status <= 299)) return 'excluded:status';
  const end = WINDOWS[cfg][e.modelId][1];
  if (e.terminalKind !== 'requestfinished' || (end !== null && e.terminalSeq > end)) return 'excluded:not-finished-in-window';
  if (cfg === 'overlapping') return 'excluded:windows-overlap';
  if (cfg !== 'disjoint') return 'excluded:window-open';
  return ambiguous.has(e.prefixKey) ? 'excluded:ambiguous' : 'included';
}

test('(12) derivePrefixes truth table: {2xx, 3xx, >=400, requestfailed, finished after window, not finished} x resourceType x urlClass x navigation x {disjoint, overlapping, open, missing} x {unique, shared key}', () => {
  let cells = 0;
  let bound = 0;
  for (const [tname, term] of Object.entries(TERMINALS)) for (const resourceType of ['fetch', 'script']) for (const urlClass of ['other', 'bootstrap']) for (const nav of [false, true]) {
    for (const cfg of Object.keys(WINDOWS)) for (const shared of [false, true]) {
      const keyB = shared ? PREFIX_S : PREFIX_B;
      const observations = [
        { reqId: 'q:12', startSeq: 12, method: 'GET', resourceType: 'fetch', urlRedacted: `${shared ? PREFIX_S : PREFIX_A}/a.bin`, urlClass: 'other', isNavigationRequest: false },
        { reqId: 'q:32', startSeq: 32, method: 'GET', resourceType, urlRedacted: `${keyB}/b.bin`, urlClass, isNavigationRequest: nav },
      ];
      const terms = { 'q:12': { terminalKind: 'requestfinished', terminalSeq: 15 }, 'q:32': term.t };
      const statuses = { 'q:12': 200, 'q:32': term.status };
      const opLedger = [loadRec('A', WINDOWS[cfg].A), loadRec('B', WINDOWS[cfg].B)].filter(Boolean);
      const built = buildPrefixSourceLedger({ observations, opLedger, terminalOf: (id) => terms[id] || null, statusOf: (id) => (id in statuses ? statuses[id] : null) });
      // expected entries: q:12 in A; q:32 in B (and in A when overlapping); never for a missing load
      const wantIds = ['q:12:load:A', ...(cfg === 'overlapping' ? ['q:32:load:A'] : []), ...(WINDOWS[cfg].B ? ['q:32:load:B'] : [])];
      assert.deepEqual(built.prefixSourceLedger.map((e) => e.entryId), wantIds, `${cfg}`);
      const pre = built.prefixSourceLedger.map((e) => oracleReason(e, cfg, new Set()));
      const candA = new Set(built.prefixSourceLedger.filter((e, i) => e.modelId === 'A' && pre[i] === 'included').map((e) => e.prefixKey));
      const candB = new Set(built.prefixSourceLedger.filter((e, i) => e.modelId === 'B' && pre[i] === 'included').map((e) => e.prefixKey));
      const amb = new Set([...candA].filter((k) => candB.has(k)));
      built.prefixSourceLedger.forEach((e) => {
        const want = oracleReason(e, cfg, amb);
        assert.equal(e.reason, want, JSON.stringify({ tname, resourceType, urlClass, nav, cfg, shared, e }));
        assert.equal(e.disposition, want === 'included' ? 'included' : 'excluded');
      });
      const d = built.prefixDerivation;
      assert.equal(d.bindingAvailable, cfg === 'disjoint');
      assert.equal(d.nonDistinguishingReason, { disjoint: null, overlapping: 'windows-overlap', open: 'window-open', missing: 'no-load-operation' }[cfg]);
      assert.deepEqual(d.ambiguousKeys, [...amb].sort());
      assert.deepEqual(d.modelPrefixes, { A: [...candA].filter((k) => !amb.has(k)).sort(), B: [...candB].filter((k) => !amb.has(k)).sort() });
      if (cfg !== 'disjoint') assert.deepEqual([d.candidateKeys, d.modelPrefixes], [{ A: [], B: [] }, { A: [], B: [] }], 'non-distinguishing => nothing binds');
      // a failing candidate whose key occurs only in its own entry is never bound
      if (tname !== 'finished-2xx') assert.equal(d.modelPrefixes.B.includes(keyB), false, `${tname} never proves its own prefix`);
      if (d.modelPrefixes.B.length) bound += 1;
      assert.deepEqual(derivePrefixes(built.prefixSourceLedger, opLedger), d, 'recomputation is deterministic and equal');
      cells += 1;
    }
  }
  assert.equal(cells, 6 * 2 * 2 * 2 * 4 * 2);
  assert.ok(bound > 0);
});

test('(12) overlapping windows => two entries per affected request with the stated entryIds, byte-identical ledgerSha256 across derivations, no binding', () => {
  const w = world();
  const { LA, LB } = withLoads(w, { overlap: true, B: [`${PREFIX_B}/b.bin`] });
  const entries = w.ledger.prefixSourceLedger.filter((e) => e.urlRedacted === `${PREFIX_B}/b.bin`);
  assert.deepEqual(entries.map((e) => e.entryId), [`${entries[0].reqId}:${LA.operationId}`, `${entries[0].reqId}:${LB.operationId}`]);
  assert.deepEqual(entries.map((e) => e.reason), ['excluded:windows-overlap', 'excluded:windows-overlap']);
  const d1 = derivePrefixes(w.ledger.prefixSourceLedger, w.ledger.opLedger);
  const d2 = derivePrefixes(clone(w.ledger.prefixSourceLedger), clone(w.ledger.opLedger));
  assert.equal(d1.ledgerSha256, d2.ledgerSha256);
  assert.deepEqual([d1.bindingAvailable, d1.nonDistinguishingReason, d1.modelPrefixes], [false, 'windows-overlap', { A: [], B: [] }]);
  assert.deepEqual(LA.prefixSourceRef.entryIds.includes(entries[0].entryId) && LB.prefixSourceRef.entryIds.includes(entries[1].entryId), true);
  assert.deepEqual(NP(w), []);
});

test('(12) closeout recomputation equals the persisted record; a mutated entry, reason, modelPrefixes, hash, ambiguous record or prefixSourceRef => prefix-derivation-mismatch (row 5)', () => {
  const w = world();
  withLoads(w, { A: [URL_A, `${PREFIX_S}/a.bin`], B: [`${PREFIX_B}/b.bin`, `${PREFIX_S}/b.bin`] });
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, prefixSources: w.net.prefixSources });
  assert.deepEqual(NP(w), []);
  const iB = w.ledger.prefixSourceLedger.findIndex((e) => e.urlRedacted === `${PREFIX_B}/b.bin`);
  const muts = [
    ['entry status', (L) => { L.prefixSourceLedger[iB].status = 404; }, `prefixSourceLedger[${iB}].reason`],
    ['entry url (observation)', (L) => { L.prefixSourceLedger[iB].urlRedacted = `${PREFIX_A}/b.bin`; }, `prefixSourceLedger[${iB}].observation`],
    ['entry terminal', (L) => { L.prefixSourceLedger[iB].terminalKind = 'none'; L.prefixSourceLedger[iB].terminalSeq = null; }, 'prefixDerivation'],
    ['reason', (L) => { L.prefixSourceLedger[iB].reason = 'excluded:status'; L.prefixSourceLedger[iB].disposition = 'excluded'; }, `prefixSourceLedger[${iB}].reason`],
    ['modelPrefixes', (L) => { L.modelPrefixes.B.push(`${CDN}/forged`); }, 'modelPrefixes'],
    ['derivation modelPrefixes', (L) => { L.prefixDerivation.modelPrefixes.B = []; }, 'prefixDerivation'],
    ['ledger hash', (L) => { L.prefixDerivation.ledgerSha256 = '0'.repeat(64); }, 'prefixDerivation'],
    ['derivation hash', (L) => { L.prefixDerivation.derivationSha256 = '0'.repeat(64); }, 'prefixDerivation'],
    ['ambiguous record', (L) => { L.ambiguousPrefixes = []; }, 'ambiguousPrefixes'],
    ['dropped entry', (L) => { L.prefixSourceLedger.splice(iB, 1); }, 'prefixSourceLedger.missing:'],
    ['prefixSourceRef', (L) => { L.opLedger.find((o) => o.recordType === 'load').prefixSourceRef.entryIds.pop(); }, 'prefixSourceRef.entryIds'],
    ['entry naming no observation', (L) => { L.prefixSourceLedger[iB].reqId = 'q:99999'; L.prefixSourceLedger[iB].entryId = `q:99999:${L.prefixSourceLedger[iB].loadOperationId}`; }, `prefixSourceLedger[${iB}].observation`],
  ];
  for (const [label, mutate, want] of muts) {
    const L = clone(w.ledger); mutate(L);
    const ps = networkLedgerProblems({ errorLedger: L });
    assert.ok(ps.some((p) => p.startsWith('prefix-derivation-mismatch:') && p.includes(want)), `${label}: ${JSON.stringify(ps)}`);
  }
});

test('(12) the prefix-source snapshot is frozen at the later window close: later terminals are not persisted, closeout never rebuilds ("heals") it, and a requestfailed before the cutoff can never be included', () => {
  const w = world();
  let late;
  const { LB } = withLoads(w, { inB: (x) => { late = fakeRequest({ url: `${PREFIX_B}/late.bin` }); x.request(late); x.respond(late, 200); } });
  assert.equal(isPrefixLedgerFrozen(w.ledger), true);
  assert.equal(prefixSnapshotCutoff(w.ledger), LB.endSeq);
  w.set({ phase: 'P2', activeCheck: null });
  w.finish(late); // after the cutoff
  const e = w.ledger.prefixSourceLedger.find((x) => x.urlRedacted === `${PREFIX_B}/late.bin`);
  assert.deepEqual([e.terminalKind, e.reason], ['none', 'excluded:not-finished-in-window']);
  const frozen = clone(w.ledger.prefixSourceLedger);
  // tamper the persisted snapshot, then run closeout: it must stay tampered (detected, not healed)
  w.ledger.prefixSourceLedger[0].status = 500;
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, prefixSources: w.net.prefixSources });
  assert.equal(w.ledger.prefixSourceLedger[0].status, 500);
  assert.ok(NP(w).some((p) => p.startsWith('prefix-derivation-mismatch:')));
  w.ledger.prefixSourceLedger = frozen;
  assert.deepEqual(NP(w), []);
  // a request that failed before the cutoff: excluded:failed, cross-checked against the retained raw event
  const w2 = world();
  withLoads(w2, { inB: (x) => { const r = fakeRequest({ url: `${PREFIX_B}/f.bin` }); x.request(r); x.fail(r); } });
  const f = w2.ledger.prefixSourceLedger.find((x) => x.urlRedacted === `${PREFIX_B}/f.bin`);
  assert.deepEqual([f.terminalKind, f.reason], ['requestfailed', 'excluded:failed']);
  const L = clone(w2.ledger);
  const i = L.prefixSourceLedger.findIndex((x) => x.urlRedacted === `${PREFIX_B}/f.bin`);
  Object.assign(L.prefixSourceLedger[i], { terminalKind: 'requestfinished', status: 200 });
  assert.ok(networkLedgerProblems({ errorLedger: L }).includes(`prefix-derivation-mismatch:prefixSourceLedger[${i}].terminal-requestfailed`));
});

test('(12) a window that never closes => the snapshot is persisted at closeout (cutoff = closeout marker), non-distinguishing (window-open)', () => {
  const w = world();
  const LA = w.ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA });
  w.ok(URL_A);
  w.ops.endLoad(LA, 'ready');
  w.ops.beginLoad({ modelId: 'B', modelUrnSha256: URN_SHA });
  w.ok(`${PREFIX_B}/b.bin`);
  assert.equal(finalizeLoadWindows(w.ledger, { prefixSources: w.net.prefixSources }).finalized, false);
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, prefixSources: w.net.prefixSources });
  assert.deepEqual([w.ledger.prefixDerivation.bindingAvailable, w.ledger.prefixDerivation.nonDistinguishingReason], [false, 'window-open']);
  assert.ok(w.ledger.prefixSourceLedger.every((e) => e.reason === 'excluded:window-open'));
  assert.deepEqual(NP(w), []);
});

// ------------------------------------------------------------------------------------------
// Item 11 / test (13): ambiguous-prefix accounting, load-windows-closed finalization
// ------------------------------------------------------------------------------------------

test('(13) ambiguous-prefix accounting: every key in both candidate sets appears exactly once in ambiguousPrefixes with its source entry ids and in neither modelPrefixes; EC candidates and R-3 responses on it => unknown-fatal, boundPrefix null', () => {
  const w = world({ rules: [RULE] });
  const { fin } = withLoads(w, {
    A: [URL_A, `${PREFIX_S}/a1.bin`, `${PREFIX_S}/a2.bin`], B: [`${PREFIX_B}/b.bin`, `${PREFIX_S}/b.bin`], rules: [RULE],
    inB: (x) => { const r = fakeRequest({ url: `${PREFIX_S}/geom.bin` }); x.request(r); x.respond(r, 404); },
  });
  assert.equal(fin.finalized, true);
  const pd = w.ledger.prefixDerivation;
  assert.deepEqual(pd.ambiguousKeys, [PREFIX_S]);
  assert.deepEqual([pd.modelPrefixes.A.includes(PREFIX_S), pd.modelPrefixes.B.includes(PREFIX_S)], [false, false]);
  const ids = (url) => w.ledger.prefixSourceLedger.filter((e) => e.urlRedacted === url).map((e) => e.entryId);
  assert.deepEqual(w.ledger.ambiguousPrefixes, [{ prefixKey: PREFIX_S, sourceEntryIds: { A: [...ids(`${PREFIX_S}/a1.bin`), ...ids(`${PREFIX_S}/a2.bin`)], B: ids(`${PREFIX_S}/b.bin`) } }]);
  assert.ok(w.ledger.prefixSourceLedger.filter((e) => e.prefixKey === PREFIX_S && e.status === 200).every((e) => e.reason === 'excluded:ambiguous'));
  // the R-3 candidate on the ambiguous key: unknown-fatal at the window close, counted before the gate
  const resp = w.ledger.responseFailures[0];
  assert.deepEqual([resp.finalizedBy, resp.closeout.classification, resp.closeout.boundPrefix, resp.closeout.reasons.includes('prefix-ambiguous'), resp.modelBindingObserved.status], ['load-windows-closed', 'unknown-fatal', null, true, 'ambiguous']);
  // an EC-unload candidate on the ambiguous key (cleanup)
  w.set({ phase: 'cleanup', activeCheck: null });
  w.ledger.markers.push({ seq: w.counter.next(), name: 'cleanup' });
  const r = fakeRequest({ url: `${PREFIX_S}/stream.bin` });
  w.request(r);
  const u = w.ops.pageOperation('begin', { operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' });
  w.fail(r);
  w.ops.pageOperation('end', { operationId: u.operationId, terminalOutcome: 'settled' });
  const ec = w.ledger.requestFailures[0].closeout;
  assert.deepEqual([ec.classification, ec.boundPrefix, ec.modelId, ec.reasons.includes('prefix-ambiguous')], ['unknown-fatal', null, null, true]);
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, rules: [RULE], prefixSources: w.net.prefixSources });
  assert.deepEqual(NP(w, { rules: [RULE] }), []);
  assert.equal(w.ledger.fatalCount, 2);
});

test('(13) bindingAvailable false (open, overlapping or missing load) => every EC-hide/EC-unload candidate is unknown-fatal (binding-unavailable), boundPrefix null', () => {
  for (const mode of ['overlap', 'missing']) {
    const w = world();
    if (mode === 'overlap') withLoads(w, { overlap: true });
    else { const LA = w.ops.beginLoad({ modelId: 'A', modelUrnSha256: URN_SHA }); w.ok(URL_A); w.ops.endLoad(LA, 'ready'); }
    w.set({ phase: 'P9', activeCheck: 'C16' });
    const r = fakeRequest({ url: `${PREFIX_B}/stream.bin` });
    w.request(r);
    w.ops.beginMutation({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
    w.fail(r);
    const c = w.ledger.requestFailures[0].closeout;
    assert.deepEqual([c.classification, c.boundPrefix, c.reasons.includes('binding-unavailable')], ['unknown-fatal', null, true], mode);
  }
});

// ------------------------------------------------------------------------------------------
// Item 12: boundPrefix provenance and ClassifierResult nullability for both classifiers
// ------------------------------------------------------------------------------------------

test('item 12: a bound result names the supporting prefix-source entries in evidenceRefs; boundPrefix/modelId non-null iff the classification depended on a unique binding (both classifiers); event-time deep-equals closeout', () => {
  const w = world({ rules: [RULE] });
  withLoads(w, { B: [`${PREFIX_B}/b1.bin`, `${PREFIX_B}/b2.bin`], rules: [RULE], inB: (x) => { const r = fakeRequest({ url: URL_B }); x.request(r); x.respond(r, 404); } });
  const support = prefixSupportRefs(w.ledger.prefixSourceLedger, 'B', PREFIX_B);
  assert.equal(support.length, 2);
  const diag = w.ledger.responseFailures[0].closeout;
  assert.deepEqual([diag.classification, diag.modelId, diag.boundPrefix], ['diagnostic-non-required', 'B', PREFIX_B]);
  for (const p of support) assert.ok(diag.evidenceRefs.includes(p));
  // EC-unload (bound) and EC-teardown (unbound by design) in cleanup
  w.set({ phase: 'cleanup', activeCheck: null });
  w.ledger.markers.push({ seq: w.counter.next(), name: 'cleanup' });
  const r1 = fakeRequest({ url: `${PREFIX_B}/stream.bin` });
  const r2 = fakeRequest({ url: `${PREFIX_B}/stream2.bin` });
  w.request(r1); w.request(r2);
  const u = w.ops.pageOperation('begin', { operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' });
  w.fail(r1);
  w.ops.pageOperation('end', { operationId: u.operationId, terminalOutcome: 'settled' });
  const td = w.ops.beginMutation({ operationType: 'teardown', teardownTarget: 'closePage', phase: 'cleanup', invokedBy: 'cleanup:closePage', cleanupStepRef: '/cleanupStepStatus/closePage' });
  w.fail(r2);
  w.ops.endMutation(td.operationId, 'settled');
  const [ecU, ecT] = w.ledger.requestFailures.map((e) => e.closeout);
  assert.deepEqual([ecU.classification, ecU.rule, ecU.modelId, ecU.boundPrefix], ['expected-cancellation', 'EC-unload', 'B', PREFIX_B]);
  for (const p of support) assert.ok(ecU.evidenceRefs.includes(p));
  assert.deepEqual([ecT.classification, ecT.rule, ecT.modelId, ecT.boundPrefix, ecT.evidenceRefs.some((p) => p.includes('prefixSourceLedger'))], ['expected-cancellation', 'EC-teardown', null, null, false]);
  for (const e of w.ledger.requestFailures) assert.deepEqual(classifierResultProblems(e.closeout, 'requestfailed'), []);
  w.ledger.markers.push({ seq: w.counter.next(), name: 'closeout' });
  finalizeNetworkLedgerAtCloseout(w.ledger, { nextSeq: w.counter.next, appendEntry: w.appendEntry, rules: [RULE], prefixSources: w.net.prefixSources });
  for (const e of [...w.ledger.requestFailures, ...w.ledger.responseFailures]) assert.equal(e.agree, true);
  const ps = NP(w, { rules: [RULE] });
  assert.deepEqual(ps.filter((p) => !p.includes('responseFailures[0].diagnostic-evidence-contradiction') && !p.endsWith('rule-not-in-OPTIONAL_RESPONSE_RULES')), [], 'only the frozen-constant diagnostic contradiction remains (synthetic rule)');
  // a forged boundPrefix outside modelPrefixes / without support => row 5
  const L = clone(w.ledger);
  L.requestFailures[0].closeout.boundPrefix = `${CDN}/forged`;
  L.requestFailures[0].eventTime = clone(L.requestFailures[0].closeout);
  const ps2 = networkLedgerProblems({ errorLedger: L }, { rules: [RULE] });
  assert.ok(ps2.includes('request-classification-mismatch:requestFailures[0].closeout.boundPrefix-not-in-modelPrefixes'));
  assert.ok(ps2.includes('request-classification-mismatch:requestFailures[0].closeout.boundPrefix-unsupported'));
  // fatal results never carry a binding (both classifiers)
  const fr = classifyRequestFailure({ reqIdValid: true, startSeq: 1, failSeq: 2, method: 'GET', resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', errorText: 'net::ERR_FAILED', isNavigationRequest: false, phase: 'P9' }, w.ledger.opLedger, w.ledger.markers, w.ledger.prefixDerivation, w.ledger.prefixSourceLedger);
  const fh = classifyHttpResponse({ reqIdValid: true, startSeq: 1, responseSeq: 2, method: 'GET', status: 500, resourceType: 'fetch', urlRedacted: URL_B, urlClass: 'other', isNavigationRequest: false, phase: 'P9' }, w.ledger.opLedger, w.ledger.markers, w.ledger.prefixDerivation, [RULE], w.ledger.prefixSourceLedger);
  for (const r of [fr, fh]) assert.deepEqual([r.modelId, r.boundPrefix, r.evidenceRefs], [null, null, []]);
});

// ------------------------------------------------------------------------------------------
// Test (16): redaction of prefixSourceLedger[] / ambiguousPrefixes[]
// ------------------------------------------------------------------------------------------

test('(16) redaction: no query string, fragment or token in any persisted prefixSourceLedger / ambiguousPrefixes / prefixDerivation field', () => {
  const w = world();
  withLoads(w, { A: [`${PREFIX_S}/a.bin?access_token=SECRET`], B: [`${PREFIX_S}/b.bin?token=SECRET#frag`] });
  const text = JSON.stringify([w.ledger.prefixSourceLedger, w.ledger.ambiguousPrefixes, w.ledger.prefixDerivation, w.ledger.opLedger]);
  assert.doesNotMatch(text, /SECRET|access_token|token=|#frag|\?/);
  assert.equal(w.ledger.ambiguousPrefixes.length, 1);
  for (const e of w.ledger.prefixSourceLedger) assert.deepEqual(Object.keys(e).sort(), [...PREFIX_SOURCE_ENTRY_KEYS].sort());
  assert.deepEqual(Object.keys(w.ledger.prefixDerivation).sort(), [...PREFIX_DERIVATION_KEYS].sort());
  const L = clone(w.ledger); L.prefixSourceLedger[0].urlRedacted += '?token=x';
  assert.ok(networkLedgerProblems({ errorLedger: L }).includes('network-schema:prefixSourceLedger[0].urlRedacted-not-redacted'));
});

test('refreshPrefixSourceLedger without terminal sources re-persists from the persisted entries (idempotent)', () => {
  const w = world();
  withLoads(w);
  const before = clone(w.ledger);
  refreshPrefixSourceLedger(w.ledger);
  assert.deepEqual(w.ledger.prefixSourceLedger, before.prefixSourceLedger);
  assert.deepEqual(w.ledger.prefixDerivation, before.prefixDerivation);
});
