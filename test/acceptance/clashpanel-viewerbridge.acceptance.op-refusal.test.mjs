// test/acceptance/clashpanel-viewerbridge.acceptance.op-refusal.test.mjs
//
// Offline tests for the G2 operation-refusal blocking contract (H1 addendum, HIGH 2):
//
//  page  `runAcknowledgedMutation({ops, requireOps, desc, recorder, method, args, invoke})`: with
//        `requireOps:true` (the live page -- g2BuildEnv sets env.requireOps; the cleanup unload steps pass it)
//        a MISSING ops binding, a THROWN / REJECTED begin, a REFUSED begin and a MALFORMED begin response all
//        THROW before any recorder activity and before `invoke()`: the mutation never starts and no operation
//        record exists. `requireOps:false` keeps the old offline behaviour (no ops => runs unrecorded).
//        Covered through the direct export, `guardedUnloadModel` / `createModelCleanupSteps` (+ runCleanup:
//        a blocked cleanup unload leaves ownership unresolved) and the dormant live P9 drivers (C16 hide /
//        C17 unload) driven offline against the repository's fake Viewer + the REAL ViewerBridge.
//  Node  the REAL G2_NODE_OPLEDGER_BINDING body, sliced verbatim out of `runPostReservation` and
//        instantiated over a real authority / operation ledger / fatal sink: a refused begin (phase-mismatch,
//        descriptor 'refused', 'sealed') records EXACTLY ONE violation `op-begin-refused:<reason>` and returns
//        {ok:false, reason}; an ingest refusal keeps its own single violation (no second one); an accepted
//        begin records none; `end` refusals are unchanged (no violation); no mutation record exists after
//        any refusal.
//
// Non-vacuity: the guards are removed in MUTATED COPIES (tmp-sandbox copies of the harness / of the sliced
// binding text) and the guarded behaviour is shown to break. Nothing here imports playwright, launches a
// browser or touches the network; the real harness keeps LIVE_PATH_WIRED=false and
// G2_DUAL_COUNTER_GATE.resolved=false.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from './clashpanel-viewerbridge.acceptance.mjs';
import { createViewerBridge } from '../../clashpanel/viewer/ViewerBridge.js';
import { createViewerApi } from '../../clashpanel/viewer/viewerApi.js';
import { createFakeViewer, createFakeModel, FAKE_EVENTS } from '../clashpanel/support/fakeViewer.mjs';
import { createFakeThree } from '../clashpanel/support/fakeThree.mjs';

const HARNESS_FILE = fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url));
const SOURCE = readFileSync(HARNESS_FILE, 'utf8');
const BASE_ORD = H.PAGE_LOCAL_BASE;

// ------------------------------------------------------------------------------------------
// Mutated copies (tmp sandbox; the real harness is never edited)
// ------------------------------------------------------------------------------------------

const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'g2-oprefusal-'));
after(() => { rmSync(SANDBOX, { recursive: true, force: true }); });
let mutationCount = 0;

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

// Harness anchors the non-vacuity mutations remove (asserted to exist exactly once by `mutate`).
const REFUSED_THROW = "else if (requireOps) throw new Error(`operation-begin refused (";
const FAILED_THROW = "if (requireOps) throw new Error(`operation-begin failed (";
const MISSING_THROW = "} else if (requireOps) throw new Error('operation-ledger binding missing: mutation not started');";
const BINDING_REFUSE_RETURN = "return String(action) === 'begin' && out && out.ok !== true ? authority.refuseOperation(out.reason) : out;";
const BINDING_PHASE_REFUSE = "return authority.refuseOperation('phase-mismatch');";
const AUTHORITY_REFUSE = 'refuseOperation(reason) { violate(`op-begin-refused:${String(reason)}`); return { ok: false, reason }; },';

// ------------------------------------------------------------------------------------------
// The REAL operation-ledger binding body (sliced out of runPostReservation, as crossrealm.test.mjs)
// ------------------------------------------------------------------------------------------

const RPR = H.locateFunctionSource(SOURCE, 'runPostReservation');

function opLedgerBindingText(source) {
  const head = 'await live.page.exposeFunction(G2_NODE_OPLEDGER_BINDING, ';
  assert.equal(source.split(head).length - 1, 1, 'exactly one exposeFunction(G2_NODE_OPLEDGER_BINDING)');
  const i = source.indexOf(head);
  assert.ok(source.slice(i, source.indexOf('\n', i)).endsWith('{'), 'block-bodied binding');
  const j = source.indexOf('\n      });', i);
  assert.ok(j > i);
  return { text: source.slice(i + head.length, j + '\n      }'.length), at: i };
}

function instantiate(text, scope) {
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...names, `'use strict';\nreturn (${text});`)(...names.map((n) => scope[n]));
}

/** runPostReservation's Node wiring (allocator, sink, authority with the fatal onViolation, op ledger) + the real binding. */
function nodeWorld({ M = H, bindingSource = SOURCE } = {}) {
  const runSeq = M.createRunSeqAllocator();
  const state = { errorLedger: M.createEmptyErrorLedger() };
  const nodeAttribution = { phase: 'P0', activeCheck: null, activeControl: null };
  const sink = M.createFatalEventSink(state.errorLedger, { nextSeq: runSeq.next });
  const violations = [];
  const authority = M.createRunAuthority({ allocator: runSeq, attribution: nodeAttribution, onViolation: (reason) => { violations.push(reason); sink.recordFatal('harness-exception', `cross-realm-fence:${reason}`); } });
  const ops = M.createOperationLedger({ ledger: state.errorLedger, nextSeq: runSeq.next, clock: { nowIso: () => '2026-10-02T00:00:00.000Z' } });
  const scope = {
    authority, ops,
    isPlainObject: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    isPageLocalOrdinal: M.isPageLocalOrdinal,
    summarizeThrown: (err) => ({ name: err && typeof err === 'object' && typeof err.name === 'string' ? err.name : typeof err }),
  };
  const ob = instantiate(opLedgerBindingText(bindingSource).text, scope);
  const mutations = () => state.errorLedger.opLedger.filter((o) => o.recordType === 'mutation');
  return { M, runSeq, state, ledger: state.errorLedger, attribution: nodeAttribution, authority, ops, violations, ob, mutations };
}

const HIDE = Object.freeze({ operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' });
const UNLOAD_C17 = Object.freeze({ operationType: 'unload', modelId: 'B', phase: 'P9', invokedBy: 'C17' });
const UNLOAD_CLEANUP_B = Object.freeze({ operationType: 'unload', modelId: 'B', phase: 'cleanup', invokedBy: 'cleanup:unloadModelB' });
const EMPTY_REPORT = Object.freeze({ pending: [], hw: BASE_ORD });
const P9C16 = Object.freeze({ phase: 'P9', activeCheck: 'C16', activeControl: null });

// ------------------------------------------------------------------------------------------
// Fake ops (page side)
// ------------------------------------------------------------------------------------------

/** Fake `ops` whose begin answers with `answer` (value, or function(desc) => value / promise / throw). */
function fakeOps(answer, log = []) {
  return {
    log,
    begin: async (desc) => { log.push(['begin', desc.operationType, desc.invokedBy]); return typeof answer === 'function' ? answer(desc) : answer; },
    end: async (arg) => { log.push(['end', arg.operationId, arg.terminalOutcome, arg.spyRef]); return { ok: true }; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => { setImmediate(r); });

/** Runs a refused/failed case and asserts the mutation never started (no invoke, no recorder record, no end). */
async function assertBlocked(M, { ops, requireOps = true, desc = HIDE, withRecorder = true, error }) {
  const recorder = M.createCallRecorder();
  let invoked = 0;
  await assert.rejects(
    M.runAcknowledgedMutation({ ops, requireOps, desc, recorder: withRecorder ? recorder : null, method: 'viewer.hideModel', args: [2], invoke: () => { invoked += 1; } }),
    error,
  );
  assert.equal(invoked, 0, 'invoke() never called');
  assert.equal(recorder.records.length, 0, 'no recorder.record');
  if (ops && Array.isArray(ops.log)) assert.equal(ops.log.filter((e) => e[0] === 'end').length, 0, 'ops.end never called');
}

// ==========================================================================================
// runAcknowledgedMutation with requireOps (page side)
// ==========================================================================================

test('static: the live page requires the ops binding (g2BuildEnv env.requireOps=true; page cleanup steps requireOps:true; C16/C17 pass env.requireOps); live stays dormant', () => {
  const env = H.locateFunctionSource(SOURCE, 'g2BuildEnv');
  assert.equal(SOURCE.slice(env.start, env.end).split('    requireOps: true,').length - 1, 1);
  const cs = H.locateFunctionSource(SOURCE, 'g2CleanupStepImpls');
  assert.match(SOURCE.slice(cs.start, cs.end), /createModelCleanupSteps\(\{[^\n]*requireOps: true \}\)/);
  const dr = H.locateFunctionSource(SOURCE, 'createLivePhaseDrivers');
  const drv = SOURCE.slice(dr.start, dr.end);
  assert.equal(drv.split('requireOps: env.requireOps === true').length - 1, 2, 'C16 hide + C17 unload');
  assert.equal(drv.split('runAcknowledgedMutation(').length - 1, 2);
  const { at } = opLedgerBindingText(SOURCE);
  assert.ok(at > RPR.start && at < RPR.end);
  assert.equal(H.LIVE_PATH_WIRED, false);
  assert.equal(H.G2_DUAL_COUNTER_GATE.resolved, false);
});

test('hide begin ACCEPTED (requireOps): the action runs after the ack; the harness spy record is created after the ack; ops.end gets the spyRef', async () => {
  const recorder = H.createCallRecorder();
  const order = [];
  const ops = {
    log: [],
    begin: async (d) => { order.push(['begin', recorder.records.length]); await tick(); order.push(['ack']); return { ok: true, operationId: 'op:hide:1', ackSeq: 2 }; },
    end: async (a) => { order.push(['end', a]); return { ok: true }; },
  };
  const value = await H.runAcknowledgedMutation({
    ops, requireOps: true, desc: HIDE, recorder, method: 'viewer.hideModel', args: [2],
    invoke: () => { order.push(['invoke', recorder.records.length]); return 'hidden'; },
  });
  assert.equal(value, 'hidden');
  assert.deepEqual(order.slice(0, 3), [['begin', 0], ['ack'], ['invoke', 1]], 'no record before the ack; the spy record exists when the action runs');
  assert.equal(recorder.records.length, 1);
  const rec = recorder.records[0];
  assert.deepEqual([rec.method, rec.origin, rec.outcome], ['viewer.hideModel', 'harness', { threw: false, returned: null }]);
  assert.deepEqual(order[3], ['end', { operationId: 'op:hide:1', terminalOutcome: 'settled', spyRef: `spyLedger:seq:${rec.seq}` }]);
  // a throwing action after an accepted begin: end('threw') and rethrow (the op is still settled as threw)
  const ops2 = fakeOps({ ok: true, operationId: 'op:hide:9' });
  await assert.rejects(H.runAcknowledgedMutation({ ops: ops2, requireOps: true, desc: HIDE, invoke: () => { throw new Error('viewer boom'); } }), /viewer boom/);
  assert.deepEqual(ops2.log, [['begin', 'hide', 'C16'], ['end', 'op:hide:9', 'threw', null]]);
});

test('hide begin REFUSED ({ok:false, reason}) with requireOps: invoke NOT called, no recorder.record, no ops.end; throws operation-begin refused (<reason>)', async () => {
  for (const reason of ['phase-mismatch', 'refused', 'sealed', 'ingest-gap', 'spy-ref-unmapped']) {
    const ops = fakeOps({ ok: false, reason });
    await assertBlocked(H, { ops, error: new RegExp(`^Error: operation-begin refused \\(${reason}\\): mutation not started$`) });
    assert.deepEqual(ops.log, [['begin', 'hide', 'C16']]);
  }
});

test('unload begin accepted => runs; unload begin refused => not run (C17 and cleanup descriptors)', async () => {
  for (const desc of [UNLOAD_C17, UNLOAD_CLEANUP_B]) {
    const okOps = fakeOps({ ok: true, operationId: `op:unload:${desc.invokedBy}` });
    let ran = 0;
    await H.runAcknowledgedMutation({ ops: okOps, requireOps: true, desc, invoke: () => { ran += 1; } });
    assert.equal(ran, 1);
    assert.deepEqual(okOps.log, [['begin', 'unload', desc.invokedBy], ['end', `op:unload:${desc.invokedBy}`, 'settled', null]]);
    const noOps = fakeOps({ ok: false, reason: 'phase-mismatch' });
    await assertBlocked(H, { ops: noOps, desc, withRecorder: false, error: /operation-begin refused \(phase-mismatch\)/ });
  }
});

test('a THROWN (sync) or REJECTED begin with requireOps: not run; throws operation-begin failed (<message>)', async () => {
  const syncThrow = { log: [], begin: () => { throw new Error('binding gone'); }, end: async () => { syncThrow.log.push(['end']); } };
  await assertBlocked(H, { ops: syncThrow, error: /^Error: operation-begin failed \(binding gone\): mutation not started$/ });
  const rejected = fakeOps(() => Promise.reject(new Error('target closed')));
  await assertBlocked(H, { ops: rejected, error: /operation-begin failed \(target closed\): mutation not started/ });
  const rejectedNoMessage = fakeOps(() => Promise.reject(42)); // eslint-disable-line prefer-promise-reject-errors
  await assertBlocked(H, { ops: rejectedNoMessage, error: /operation-begin failed \(threw\): mutation not started/ });
});

test('a DELAYED begin: invoke only after the begin resolves (accepted) -- and never when it later resolves refused', async () => {
  const d = deferred();
  const recorder = H.createCallRecorder();
  let invoked = 0;
  const ops = fakeOps(() => d.promise);
  const p = H.runAcknowledgedMutation({ ops, requireOps: true, desc: HIDE, recorder, method: 'viewer.hideModel', args: [2], invoke: () => { invoked += 1; } });
  for (let i = 0; i < 5; i += 1) await tick();
  assert.equal(invoked, 0, 'nothing runs while the ack is outstanding');
  assert.equal(recorder.records.length, 0);
  d.resolve({ ok: true, operationId: 'op:hide:7' });
  await p;
  assert.equal(invoked, 1);
  assert.equal(recorder.records.length, 1);
  const d2 = deferred();
  let invoked2 = 0;
  const p2 = H.runAcknowledgedMutation({ ops: fakeOps(() => d2.promise), requireOps: true, desc: HIDE, invoke: () => { invoked2 += 1; } });
  for (let i = 0; i < 5; i += 1) await tick();
  d2.resolve({ ok: false, reason: 'phase-mismatch' });
  await assert.rejects(p2, /operation-begin refused \(phase-mismatch\)/);
  assert.equal(invoked2, 0);
});

test('a MALFORMED begin response with requireOps ({ok:true} without operationId, non-string id, null, undefined, truthy non-true ok, {}): not run', async () => {
  for (const answer of [{ ok: true }, { ok: true, operationId: 42 }, { ok: true, operationId: null }, null, undefined, { ok: 'true', operationId: 'op:x' }, { ok: 1, operationId: 'op:x' }, {}, 'ok', { ok: false }]) {
    const ops = fakeOps(answer);
    await assertBlocked(H, { ops, error: /operation-begin refused \(malformed-response\): mutation not started/ });
  }
});

test('a MISSING ops binding with requireOps (null, undefined, no begin function): throws operation-ledger binding missing; not run', async () => {
  for (const ops of [null, undefined, {}, { begin: 'nope', end: () => {} }]) {
    await assertBlocked(H, { ops, error: /^Error: operation-ledger binding missing: mutation not started$/ });
  }
});

test('requireOps:false (offline callers) keeps the old behaviour: no ops => runs unrecorded (spy record still taken, no end); a refused/thrown begin => still runs, no end', async () => {
  const recorder = H.createCallRecorder();
  let ran = 0;
  await H.runAcknowledgedMutation({ ops: null, requireOps: false, desc: HIDE, recorder, method: 'viewer.hideModel', args: [2], invoke: () => { ran += 1; } });
  await H.runAcknowledgedMutation({ ops: null, desc: HIDE, invoke: () => { ran += 1; } }); // default requireOps=false
  assert.equal(ran, 2);
  assert.equal(recorder.records.length, 1, 'the harness spy record is still taken');
  for (const answer of [{ ok: false, reason: 'refused' }, null, () => { throw new Error('x'); }]) {
    const ops = fakeOps(answer);
    let r = 0;
    await H.runAcknowledgedMutation({ ops, requireOps: false, desc: HIDE, invoke: () => { r += 1; } });
    assert.equal(r, 1);
    assert.equal(ops.log.filter((e) => e[0] === 'end').length, 0, 'no operation => no end');
  }
});

test('non-vacuity: removing each requireOps throw (mutated copies) lets the blocked mutation RUN', async () => {
  const refusedRuns = await importMutated([[REFUSED_THROW, REFUSED_THROW.replace('if (requireOps)', 'if (false)')]]);
  for (const answer of [{ ok: false, reason: 'phase-mismatch' }, { ok: true }]) {
    let ran = 0;
    await refusedRuns.runAcknowledgedMutation({ ops: fakeOps(answer), requireOps: true, desc: HIDE, invoke: () => { ran += 1; } });
    assert.equal(ran, 1, `mutant runs the mutation for ${JSON.stringify(answer)}`);
  }
  const failedRuns = await importMutated([[FAILED_THROW, FAILED_THROW.replace('if (requireOps)', 'if (false)')]]);
  let ran = 0;
  await failedRuns.runAcknowledgedMutation({ ops: fakeOps(() => { throw new Error('gone'); }), requireOps: true, desc: HIDE, invoke: () => { ran += 1; } }).catch(() => {});
  // the thrown begin falls through to the refused check (r=null => malformed-response): still blocked unless that guard is removed too
  assert.equal(ran, 0);
  const bothRemoved = await importMutated([[FAILED_THROW, FAILED_THROW.replace('if (requireOps)', 'if (false)')], [REFUSED_THROW, REFUSED_THROW.replace('if (requireOps)', 'if (false)')]]);
  await bothRemoved.runAcknowledgedMutation({ ops: fakeOps(() => { throw new Error('gone'); }), requireOps: true, desc: HIDE, invoke: () => { ran += 1; } });
  assert.equal(ran, 1, 'without both guards a thrown begin lets the mutation run');
  const missingRuns = await importMutated([[MISSING_THROW, '}']]);
  let ran2 = 0;
  await missingRuns.runAcknowledgedMutation({ ops: null, requireOps: true, desc: HIDE, invoke: () => { ran2 += 1; } });
  assert.equal(ran2, 1, 'mutant runs without the ops binding');
});

// ==========================================================================================
// guardedUnloadModel / createModelCleanupSteps (+ runCleanup)
// ==========================================================================================

function fakeUnloadViewer(models) {
  const loaded = [...models];
  const calls = [];
  return {
    calls,
    getAllModels: () => [...loaded],
    unloadModel: (m) => { calls.push(m); const i = loaded.indexOf(m); if (i >= 0) loaded.splice(i, 1); },
  };
}

test('guardedUnloadModel with requireOps: a refused / malformed / thrown / missing cleanup-unload begin => viewer.unloadModel NOT called, the step throws, the model stays loaded', async () => {
  const B = { id: 2 };
  for (const [ops, re] of [
    [fakeOps({ ok: false, reason: 'phase-mismatch' }), /operation-begin refused \(phase-mismatch\)/],
    [fakeOps({ ok: true }), /operation-begin refused \(malformed-response\)/],
    [fakeOps(() => { throw new Error('closed'); }), /operation-begin failed \(closed\)/],
    [null, /operation-ledger binding missing/],
  ]) {
    const viewer = fakeUnloadViewer([B]);
    await assert.rejects(H.guardedUnloadModel({ viewer, model: B, label: 'unloadModelB', ops, modelId: 'B', requireOps: true }), re);
    assert.deepEqual(viewer.calls, [], 'viewer.unloadModel never called');
    assert.ok(viewer.getAllModels().includes(B));
    if (ops) assert.deepEqual(ops.log.filter((e) => e[0] === 'begin'), [['begin', 'unload', 'cleanup:unloadModelB']]);
  }
  // accepted => unloaded through the barrier
  const viewer = fakeUnloadViewer([B]);
  const ops = fakeOps({ ok: true, operationId: 'op:unload:5' });
  assert.deepEqual(await H.guardedUnloadModel({ viewer, model: B, label: 'unloadModelB', ops, modelId: 'B', requireOps: true }), { outcome: 'unloaded' });
  assert.deepEqual(viewer.calls, [B]);
  assert.deepEqual(ops.log, [['begin', 'unload', 'cleanup:unloadModelB'], ['end', 'op:unload:5', 'settled', null]]);
  // already absent => no begin at all (no operation record around a call that never happens), even with requireOps
  const absentOps = fakeOps({ ok: false, reason: 'refused' });
  assert.deepEqual(await H.guardedUnloadModel({ viewer: fakeUnloadViewer([]), model: B, label: 'unloadModelB', ops: absentOps, modelId: 'B', requireOps: true }), { outcome: 'already-absent' });
  assert.deepEqual(absentOps.log, []);
  // requireOps:false + no ops: old offline behaviour (direct unload)
  const v2 = fakeUnloadViewer([B]);
  assert.deepEqual(await H.guardedUnloadModel({ viewer: v2, model: B, label: 'unloadModelB', modelId: 'B' }), { outcome: 'unloaded' });
  assert.deepEqual(v2.calls, [B]);
});

test('createModelCleanupSteps(requireOps) under runCleanup: a refused unload of B blocks viewer.unloadModel(B); the step throws and ownership stays unresolved; A (accepted) is unloaded', async () => {
  const A = { id: 1 };
  const B = { id: 2 };
  const viewer = fakeUnloadViewer([A, B]);
  const ops = fakeOps((d) => (d.modelId === 'B' ? { ok: false, reason: 'phase-mismatch' } : { ok: true, operationId: `op:unload:${d.modelId}` }));
  const steps = H.createModelCleanupSteps({ viewer, getModelA: () => A, getModelB: () => B, ops, requireOps: true });
  const all = Object.fromEntries(H.CLEANUP_STEP_NAMES.map((n) => [n, () => null]));
  const r = await H.runCleanup({ steps: { ...all, ...steps } });
  assert.deepEqual(viewer.calls, [A], 'B was never unloaded');
  assert.equal(r.cleanupStepStatus.unloadModelA, 'ran');
  assert.equal(r.cleanupStepStatus.unloadModelB, 'threw');
  assert.equal(r.cleanupStepStatus.verifyViewerModelSetEmpty, 'threw');
  const fb = r.cleanupFailures.find((f) => f.step === 'unloadModelB');
  assert.equal(fb.ownership, 'unresolved');
  assert.equal(r.cleanupUnresolvedOwnership, true);
  assert.deepEqual(ops.log.filter((e) => e[0] === 'end'), [['end', 'op:unload:A', 'settled', null]]);
  // missing ops with requireOps: neither model is unloaded
  const v2 = fakeUnloadViewer([A, B]);
  const r2 = await H.runCleanup({ steps: { ...all, ...H.createModelCleanupSteps({ viewer: v2, getModelA: () => A, getModelB: () => B, ops: null, requireOps: true }) } });
  assert.deepEqual(v2.calls, []);
  assert.deepEqual([r2.cleanupStepStatus.unloadModelA, r2.cleanupStepStatus.unloadModelB], ['threw', 'threw']);
  assert.equal(r2.cleanupUnresolvedOwnership, true);
});

// ==========================================================================================
// The dormant live P9 drivers (C16 hide / C17 unload) driven offline with env.requireOps
// ==========================================================================================

// buildFakeEnv: the runner.test.mjs offline-fake environment (fake Viewer + fake THREE + REAL ViewerBridge),
// reproduced here (that file cannot be imported without re-running its tests).
function boxA(k) { return [k * 10, 0, 0, k * 10 + 2, 2, 2]; }
function boxB(k) { return [500 + k * 10, 0, 0, 500 + k * 10 + 2, 2, 2]; }

function buildFakeEnv() {
  const idsA = [1, 2, 3, 4, 5, 6];
  const idsB = [101, 102, 103, 104, 105, 106];
  const boxesA = Object.fromEntries(idsA.map((id) => [id, boxA(id)]));
  const boxesB = Object.fromEntries(idsB.map((id, i) => [id, boxB(i + 1)]));
  const A = createFakeModel({ id: 1, boxes: boxesA });
  const B = createFakeModel({ id: 2, boxes: boxesB });
  const viewer = createFakeViewer({ models: [A, B] });
  viewer[H.OFFLINE_FAKE_TARGET_BRAND] = true;
  viewer.overlays[H.OFFLINE_FAKE_TARGET_BRAND] = true;
  const { THREE } = createFakeThree();
  const events = { BEFORE_MODEL_UNLOAD: FAKE_EVENTS.BEFORE_MODEL_UNLOAD, MODEL_REMOVED: FAKE_EVENTS.MODEL_REMOVED };
  const hidden = [];
  viewer.hide = (dbId, model) => { hidden.push({ model, ids: [dbId] }); viewer.setHiddenNodes(hidden); };
  viewer.show = (dbId, model) => { const i = hidden.findIndex((e) => e.model === model && e.ids.includes(dbId)); if (i >= 0) hidden.splice(i, 1); viewer.setHiddenNodes(hidden); };
  const byId = (id) => [A, B].find((m) => m.id === id);
  // underlying mutation counters (installed BEFORE the P2 spies wrap them)
  const mutationCalls = { hideModel: 0, unloadModel: 0 };
  viewer.hideModel = (id) => { mutationCalls.hideModel += 1; const m = byId(id); viewer.removeModel(m); viewer.dispatch(events.MODEL_REMOVED, { model: m }); };
  viewer.showModel = (id) => { viewer.addModel(byId(id)); };
  viewer.unloadModel = (m) => { mutationCalls.unloadModel += 1; viewer.dispatch(events.BEFORE_MODEL_UNLOAD, { model: m }); viewer.removeModel(m); viewer.dispatch(events.MODEL_REMOVED, { model: m }); };
  const boxOf = (model, id) => (model === A ? boxesA[id] : boxesB[id]);
  const frame = (boxes) => {
    const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b[i + 3])));
    const c = lo.map((v, i) => (v + hi[i]) / 2);
    const half = Math.max(...hi.map((v, i) => (v - lo[i]) / 2), 1e-6);
    const s = 0.3 / half;
    return { matrixWorldInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -c[0], -c[1], -c[2], 1], projectionMatrix: [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1] };
  };
  let camera = frame([[-1, -1, -1, 1, 1, 1]]);
  const origFit = viewer.fitToView;
  viewer.fitToView = function fit(first, second, third) {
    const r = origFit.call(this, first, second, third);
    if (Array.isArray(first) && first[0] && typeof first[0] === 'object' && 'model' in first[0]) camera = frame(first.flatMap((e) => e.selection.map((id) => boxOf(e.model, id))));
    else camera = frame(first.map((id) => boxOf(second, id)));
    return r;
  };
  const recorder = H.createCallRecorder();
  const registry = H.createWrapperRegistry();
  const labelOf = H.createModelLabeler({ A, B });
  const viewerApi = createViewerApi(viewer, { events });
  const candidatesA = H.enumerateCandidates({ leafDbIds: idsA, fragmentCounts: Object.fromEntries(idsA.map((i) => [i, 1])), boxes: boxesA }).candidates;
  const candidatesB = H.enumerateCandidates({ leafDbIds: idsB, fragmentCounts: Object.fromEntries(idsB.map((i) => [i, 1])), boxes: boxesB }).candidates;
  const fit = H.selectFitUnionPair(candidatesA, candidatesB);
  const W = 400; const HGT = 400;
  const project = (p) => {
    const m = camera.matrixWorldInverse; const P = camera.projectionMatrix;
    const v = [p[0] + m[12], p[1] + m[13], p[2] + m[14]];
    return [Math.floor(((v[0] * P[0] + 1) / 2) * W), Math.floor(((1 - v[1] * P[5]) / 2) * HGT)];
  };
  const env = {
    viewer, THREE, eventNames: events, models: { A, B }, labelOf, recorder, registry,
    injection: H.createFailureInjectionController({ registry, allowOfflineFakes: true }),
    bridgeTracker: H.createBridgeInstanceTracker(),
    createBridge: (names) => createViewerBridge({ viewerApi, THREE, names }),
    targets: { a1: candidatesA[0].dbId, b1: candidatesB[0].dbId, fitPair: fit.pair, candidatesA, candidatesB },
    boundsOf: (model, dbId) => viewerApi.getElementWorldBounds(model, dbId),
    fragmentBoxesOf: (model, dbId) => { const b = boxOf(model, dbId); return b ? [b] : []; },
    makeSentinelMesh: () => new THREE.Mesh(new THREE.SphereGeometry(1, 4, 4), new THREE.MeshBasicMaterial({})),
    tick: () => new Promise((r) => setImmediate(r)),
    modelFacts: async () => ({ A: { loaded: true, classification: H.CLASSIFIER_CONFIRMED, inAllModels: true, unitScale: 0.3048, unitString: 'ft' }, B: { loaded: true, classification: H.CLASSIFIER_CONFIRMED, inAllModels: true, unitScale: 0.3048, unitString: 'ft' }, loadedCount: viewer.getAllModels().length }),
    unitFacts: async () => ({ A: { unitScale: 0.3048, unitString: 'ft', nativeExtent: [2, 2, 2] }, B: { unitScale: 0.3048, unitString: 'ft', nativeExtent: [2, 2, 2] } }),
    shellProbe: {
      c2: async () => ({ threw: false, containerFound: true, containerUnderViewer: true, regions: H.C2_REGION_ORDER.map((region) => ({ region, hasHeading: true, hasBody: true })), addVisibilityListenerCalls: 1, bodyChildCount: 1, title: { ok: true }, setVisibleFalseBeforeListener: true, dispatchesDuringConstruction: 0, domainWrites: 0, shellKeys: ['show', 'hide', 'toggle', 'isVisible', 'dispose'] }),
      c3: async () => ({ showHide: [1, 2, 3].map(() => ({ showSetVisibleTrue: true, showDispatches: ['PANEL_SHOWN'], hideDispatches: ['PANEL_HIDDEN'] })), dispose: { uninitializeCalls: 1, containerInDom: false, rootFound: false, byIdFound: false, retainedCallbackDispatches: 0, setVisibleAfterUninitialize: 0, postDisposeSpyCalls: 0, postDisposeIsVisible: false }, residue: [] }),
    },
    camera: { sample: () => camera, waitFrame: () => Promise.resolve(), resetHome: () => { camera = frame([[-1, -1, -1, 1, 1, 1]]); return true; } },
    capture: {
      canvas: async () => ({ W, H: HGT, dsf: 1, shellDisposed: true }),
      waitRafs: async () => {},
      frame: async () => {
        const f = new Uint8Array(W * HGT * 4);
        const meshes = [...viewer.overlayMeshes('clash-panel-markers:g2a'), ...viewer.overlayMeshes('clash-panel-outlines:g2a')];
        for (const m of meshes) {
          const p = m.isLine ? m.geometry.points[0] : m.position;
          const [x, y] = project([p.x, p.y, p.z]);
          if (x >= 0 && x < W && y >= 0 && y < HGT) f[(y * W + x) * 4] = 255;
        }
        return f;
      },
    },
    state: {},
  };
  return { env, viewer, A, B, mutationCalls };
}

async function runLive(env) {
  return H.runChecksInPhaseOrder({ drivers: H.createLivePhaseDrivers(env), mode: 'offline-fake', recorder: env.recorder });
}

const p9Error = (r) => (r.phaseLog.find((e) => e.phase === 'P9') || {}).error;

test('live C16 driver with env.requireOps + a REFUSING env.ops: viewer.hideModel (and C17 unloadModel) never called; P9 units BLOCKED harness-exception by the runner', async () => {
  const { env, mutationCalls } = buildFakeEnv();
  env.requireOps = true;
  env.ops = fakeOps({ ok: false, reason: 'phase-mismatch' });
  const r = await runLive(env);
  assert.equal(r.gates.C1.outcome, 'OPEN');
  assert.deepEqual(mutationCalls, { hideModel: 0, unloadModel: 0 });
  assert.equal(env.recorder.records.filter((x) => x.method === 'viewer.hideModel' || x.method === 'viewer.unloadModel').length, 0, 'no harness spy record for the blocked mutation');
  assert.deepEqual(env.ops.log, [['begin', 'hide', 'C16']], 'only the C16 begin was attempted; nothing ended');
  assert.match(p9Error(r).message, /operation-begin refused \(phase-mismatch\): mutation not started/);
  assert.equal(H.checkVerdictLabel(r.checks.C16), 'BLOCKED(harness-exception:P9)');
  assert.equal(H.checkVerdictLabel(r.checks.C17), 'BLOCKED(harness-exception:P9)');
  assert.equal(r.sessionTainted, true);
});

test('live C17 driver with env.requireOps: hide accepted (runs once) but the unload begin refused => viewer.unloadModel never called; C17 BLOCKED harness-exception', async () => {
  const { env, mutationCalls } = buildFakeEnv();
  env.requireOps = true;
  env.ops = fakeOps((d) => (d.invokedBy === 'C16' ? { ok: true, operationId: 'op:hide:1' } : { ok: false, reason: 'sealed' }));
  const r = await runLive(env);
  assert.deepEqual(mutationCalls, { hideModel: 1, unloadModel: 0 });
  assert.equal(env.recorder.records.filter((x) => x.method === 'viewer.unloadModel' && x.origin === 'harness').length, 0);
  assert.deepEqual(env.ops.log.map((e) => e.slice(0, 3)), [['begin', 'hide', 'C16'], ['end', 'op:hide:1', 'settled'], ['begin', 'unload', 'C17']]);
  assert.match(p9Error(r).message, /operation-begin refused \(sealed\)/);
  assert.equal(H.checkVerdictLabel(r.checks.C17), 'BLOCKED(harness-exception:P9)');
});

test('live P9 with env.requireOps and NO ops binding => blocked (operation-ledger binding missing); control: env.requireOps + an accepting ops => C16/C17 PASS', async () => {
  const blocked = buildFakeEnv();
  blocked.env.requireOps = true;
  blocked.env.ops = null;
  const r = await runLive(blocked.env);
  assert.deepEqual(blocked.mutationCalls, { hideModel: 0, unloadModel: 0 });
  assert.match(p9Error(r).message, /operation-ledger binding missing/);
  assert.equal(H.checkVerdictLabel(r.checks.C16), 'BLOCKED(harness-exception:P9)');
  const good = buildFakeEnv();
  good.env.requireOps = true;
  let n = 0;
  good.env.ops = fakeOps((d) => { n += 1; return { ok: true, operationId: `op:${d.operationType}:${n}` }; });
  const r2 = await runLive(good.env);
  assert.deepEqual(good.mutationCalls, { hideModel: 1, unloadModel: 1 });
  assert.equal(r2.checks.C16.verdict, 'PASS');
  assert.equal(r2.checks.C17.verdict, 'PASS');
  assert.equal(p9Error(r2), null);
});

// ==========================================================================================
// Node side: the REAL operation-ledger binding
// ==========================================================================================

test('Node binding: a begin refused for phase-mismatch records EXACTLY ONE violation op-begin-refused:phase-mismatch (one fatal entry) and returns {ok:false, reason}; no mutation record', () => {
  const w = nodeWorld();
  assert.deepEqual(w.authority.syncPage({ phase: 'P8', activeCheck: null, activeControl: null, ...EMPTY_REPORT }), { ok: true });
  const peek = w.runSeq.peek();
  assert.deepEqual(w.ob('begin', { ...HIDE, ...EMPTY_REPORT }), { ok: false, reason: 'phase-mismatch' });
  assert.deepEqual(w.violations, ['op-begin-refused:phase-mismatch']);
  assert.deepEqual(w.ledger.entries.map((e) => [e.kind, e.detail]), [['harness-exception', 'cross-realm-fence:op-begin-refused:phase-mismatch']]);
  assert.equal(w.ledger.fatalCount, 1);
  assert.deepEqual(w.mutations(), [], 'nothing claims the mutation started');
  assert.deepEqual(w.ops.openMutations(), []);
  assert.equal(w.runSeq.peek(), peek + 1, 'only the fatal entry was allocated');
});

test('Node binding: a descriptor the ledger refuses (reason refused) and a sealed ledger (reason sealed) are exactly one violation each; nothing recorded', () => {
  const w = nodeWorld();
  assert.deepEqual(w.ob('begin', { ...HIDE, modelId: 'A', ...EMPTY_REPORT }), { ok: false, reason: 'refused' });
  assert.deepEqual(w.violations, ['op-begin-refused:refused']);
  assert.deepEqual(w.ob('begin', { operationType: 'teardown', teardownTarget: 'closePage', modelId: null, phase: 'cleanup', invokedBy: 'cleanup:closePage', ...EMPTY_REPORT }), { ok: false, reason: 'refused' });
  assert.deepEqual(w.violations, ['op-begin-refused:refused', 'op-begin-refused:refused']);
  assert.deepEqual(w.mutations(), []);
  const s = nodeWorld();
  s.ops.seal();
  assert.deepEqual(s.ob('begin', { ...HIDE, ...EMPTY_REPORT }), { ok: false, reason: 'sealed' });
  assert.deepEqual(s.violations, ['op-begin-refused:sealed']);
  assert.equal(s.ledger.fatalCount, 1);
  assert.deepEqual(s.mutations(), []);
  // a cleanup unload refused after the closeout seal
  assert.deepEqual(s.ob('begin', { ...UNLOAD_CLEANUP_B, ...EMPTY_REPORT }), { ok: false, reason: 'sealed' });
  assert.deepEqual(s.violations, ['op-begin-refused:sealed', 'op-begin-refused:sealed']);
  assert.deepEqual(s.mutations(), []);
});

test('Node binding: an ingest refusal at the begin fence (bad hw / gap) keeps its OWN single violation -- no second op-begin-refused; nothing ingested or recorded', () => {
  for (const [label, report, reason] of [
    ['hw mismatch', { pending: [], hw: BASE_ORD + 1 }, 'ingest-hw-mismatch'],
    ['gap', { pending: [{ ord: BASE_ORD + 2, kind: 'spy', ...P9C16 }], hw: BASE_ORD + 2 }, 'ingest-gap'],
    ['missing hw', { pending: [] }, null],
  ]) {
    const w = nodeWorld();
    const r = w.ob('begin', { ...HIDE, ...report });
    assert.equal(r.ok, false, label);
    if (reason) assert.equal(r.reason, reason, label);
    assert.equal(w.violations.length, 1, `${label}: exactly one violation (${w.violations.join(',')})`);
    assert.ok(!w.violations[0].startsWith('op-begin-refused:'), label);
    assert.equal(w.ledger.fatalCount, 1, label);
    assert.deepEqual(w.authority.ingested(), [], label);
    assert.deepEqual(w.mutations(), [], label);
  }
});

test('Node binding: an accepted begin records no violation; end refusals stay unchanged (no violation, record not-settled); unknown action is no violation', () => {
  const w = nodeWorld();
  assert.deepEqual(w.authority.syncPage({ ...P9C16, ...EMPTY_REPORT }), { ok: true });
  const b = w.ob('begin', { ...HIDE, ...EMPTY_REPORT });
  assert.equal(b.ok, true);
  assert.equal(typeof b.operationId, 'string');
  assert.deepEqual(w.violations, []);
  assert.equal(w.mutations().length, 1);
  assert.deepEqual(w.ob('end', { operationId: 'op:nope:1', terminalOutcome: 'settled', spyRef: null, ...EMPTY_REPORT }), { ok: false, reason: 'unknown-operation' });
  assert.deepEqual(w.ob('end', { operationId: b.operationId, terminalOutcome: 'settled', spyRef: `spyLedger:seq:${BASE_ORD + 9}`, ...EMPTY_REPORT }), { ok: false, reason: 'spy-ref-unmapped' });
  assert.deepEqual(w.ob('frobnicate', { ...EMPTY_REPORT }), { ok: false, reason: 'unknown-action' });
  assert.deepEqual(w.violations, [], 'end / unknown-action refusals are not op-begin violations');
  assert.equal(w.mutations()[0].terminalOutcome, 'not-settled');
});

test('Node -> page: the refused begin answer of the real binding blocks runAcknowledgedMutation(requireOps) -- invoke never called, one violation, no record', async () => {
  const w = nodeWorld();
  assert.deepEqual(w.authority.syncPage({ phase: 'cleanup', activeCheck: null, activeControl: null, ...EMPTY_REPORT }), { ok: true });
  const ops = {
    begin: async (d) => JSON.parse(JSON.stringify(w.ob('begin', { ...d, ...EMPTY_REPORT }))),
    end: async (a) => JSON.parse(JSON.stringify(w.ob('end', { ...a, ...EMPTY_REPORT }))),
  };
  let ran = 0;
  await assert.rejects(H.runAcknowledgedMutation({ ops, requireOps: true, desc: HIDE, invoke: () => { ran += 1; } }), /operation-begin refused \(phase-mismatch\)/);
  assert.equal(ran, 0);
  assert.deepEqual(w.violations, ['op-begin-refused:phase-mismatch']);
  assert.deepEqual(w.mutations(), []);
  // the matching cleanup unload is accepted and runs (one settled record, still exactly one violation)
  await H.runAcknowledgedMutation({ ops, requireOps: true, desc: UNLOAD_CLEANUP_B, invoke: () => { ran += 1; } });
  assert.equal(ran, 1);
  assert.deepEqual(w.mutations().map((o) => [o.operationType, o.phase, o.terminalOutcome]), [['unload', 'cleanup', 'settled']]);
  assert.deepEqual(w.violations, ['op-begin-refused:phase-mismatch']);
});

test('non-vacuity: removing refuseOperation from the binding / from the authority (mutated copies) => a refused begin records NO violation', async () => {
  // (a) binding text without the refused-begin violation (ledger refusal) and without the phase-mismatch one
  const noRefuse = mutate(SOURCE, [[BINDING_REFUSE_RETURN, 'return out;'], [BINDING_PHASE_REFUSE, "return { ok: false, reason: 'phase-mismatch' };"]]);
  const a = nodeWorld({ bindingSource: noRefuse });
  assert.deepEqual(a.ob('begin', { ...HIDE, modelId: 'A', ...EMPTY_REPORT }), { ok: false, reason: 'refused' });
  a.ops.seal();
  assert.deepEqual(a.ob('begin', { ...HIDE, ...EMPTY_REPORT }), { ok: false, reason: 'sealed' });
  const a2 = nodeWorld({ bindingSource: noRefuse });
  a2.authority.syncPage({ phase: 'P8', activeCheck: null, activeControl: null, ...EMPTY_REPORT });
  assert.deepEqual(a2.ob('begin', { ...HIDE, ...EMPTY_REPORT }), { ok: false, reason: 'phase-mismatch' });
  assert.deepEqual([a.violations, a2.violations], [[], []], 'the refusal goes unrecorded without refuseOperation');
  assert.equal(a.ledger.fatalCount + a2.ledger.fatalCount, 0);
  // (b) an authority whose refuseOperation does not violate (mutated harness copy)
  const M = await importMutated([[AUTHORITY_REFUSE, 'refuseOperation(reason) { return { ok: false, reason }; },']]);
  const b = nodeWorld({ M });
  assert.deepEqual(b.ob('begin', { ...HIDE, modelId: 'A', ...EMPTY_REPORT }), { ok: false, reason: 'refused' });
  assert.deepEqual(b.violations, []);
  // control: the real binding + authority on the same inputs record one violation each
  const c = nodeWorld();
  c.ob('begin', { ...HIDE, modelId: 'A', ...EMPTY_REPORT });
  assert.deepEqual(c.violations, ['op-begin-refused:refused']);
});

test('requireOps: an EMPTY operationId is not an acknowledgement (ledger schema needs a non-empty id) and a cleanup unload without a ledgered model id is blocked', async () => {
  let invoked = 0;
  await assert.rejects(
    H.runAcknowledgedMutation({ ops: { begin: async () => ({ ok: true, operationId: '' }), end: async () => ({ ok: true }) }, requireOps: true, desc: { operationType: 'hide', modelId: 'B', phase: 'P9', invokedBy: 'C16' }, invoke: async () => { invoked += 1; } }),
    /operation-begin refused \(malformed-response\)/,
  );
  assert.equal(invoked, 0);
  const model = {};
  let unloaded = 0;
  const viewer = { getAllModels: () => [model], unloadModel: () => { unloaded += 1; } };
  await assert.rejects(H.guardedUnloadModel({ viewer, model, label: 'unloadModelX', ops: { begin: async () => ({ ok: true, operationId: 'x' }), end: async () => ({ ok: true }) }, modelId: 'C', requireOps: true }), /barrier required/);
  assert.equal(unloaded, 0);
});
