// test/acceptance/clashpanel-viewerbridge.acceptance.gate.test.mjs
//
// Offline tests for the G2 harness slice B2 (procedure §7 RC1-C1/RC1-C2, §9.2 test (25), §10): the
// RUNTIME global C1 gate written by `runChecksInPhaseOrder` (truth table; closed gate => no downstream
// execution and exactly one synthetic gate-disposition per C2..C20/N1..N8), the closed-gate evidence
// predicates CG-1..CG-7 (one mutation each) and the exhaustive legal-record list, the attribution fields
// `seq/phase/activeCheck/activeControl` on every spyLedger/eventLog/stateSnapshots entry (one counter,
// wrapper-install/-restore events, the C16 log on the recorder counter), the atomic gate preparation
// (both orderings), and the R1 overall row<->verdict pairing. Pure; no Viewer, no Playwright.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECK_NAMES, CONTROL_NAMES, PHASE_ORDER, OVERALL_PHASES, NRDB_STATE, GATE_OUTCOME, GATE_EVIDENCE_REFS, GATE_CHECK_DISPOSITION,
  GATE_CONTROL_DISPOSITION, DOWNSTREAM_ITEM_NAMES, NRDB_CONTROL_NAMES, CONTROL_DEPENDENCY_IDS, CONTROL_OWNING_PHASE, CONTROL_ACCEPTABLE_STATE,
  DOWNSTREAM_PHASE_IDS, ATTRIBUTION_PHASES, PASSIVE_FATAL_EVENT_KINDS, GATE_C1_REQUIRED, OVERALL_ROW_VERDICT,
  runChecksInPhaseOrder, createCallRecorder, createWrapperRegistry, recordingWrap, installInjectionWrapper, createMonotonicEventLog,
  makeCheckRecord, makeControlRecord, evaluateC1, applyPhaseRunToState, buildInitialRunState, buildBindingRecord, createOfflineRunStateFixture,
  recordSchemaProblems, closedGateEvidenceMatches, closedGateIllegalRecords, attributionFieldProblems, nrdbLegality, computeOverall,
  evaluateOverallRows, prepareC1Gate, gateFinalizationProblems, gateC1Problems, validateResultSchema, buildResultPayload,
  sha256Hex, serializeJson, MODEL_A_URN, MODEL_B_URN, JOURNAL_STATE, tokenizeJs, locateFunctionSource, checkVerdictBase,
  createFatalEventSink, createNetworkInstrumentation, defaultGateFinalization, networkLedgerProblems,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HARNESS_SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const AT = '2026-09-30T00:00:01.000Z';
const h = (s) => sha256Hex(Buffer.from(s, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

function makeBinding() {
  return buildBindingRecord({
    validation: {
      ok: true,
      record: { path: 'docs/prompts/g2-gate-test.md', sha256: h('record'), id: 'gate-test-0001' },
      digests: { headSha: h('head').slice(0, 40), procedureSha256: h('procedure'), harnessSha256: h('harness'), urnASha256: h(MODEL_A_URN), urnBSha256: h(MODEL_B_URN) },
    },
    attemptId: randomUUID(),
  });
}
const T0 = Date.parse('2026-09-30T10:00:00.000Z');
function journalWith(binding, states) {
  return { ...binding, transitions: states.map((state, i) => ({ state, at: new Date(T0 + i * 1000).toISOString(), monotonicMs: i * 1000, ...(state === JOURNAL_STATE.CLOSEOUT_STARTED ? { detail: { primaryOverall: 'PASS', primaryRow: 8 } } : {}) })) };
}

const M = { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true };
const FACTS = {
  PASS: { A: M, B: M, loadedCount: 2 },
  prerequisite: { A: M, B: { ...M, classification: 'CONTRADICTORY' }, loadedCount: 2 },
  'timeout:load': { A: M, B: { loaded: false, loadStatus: 'timed-out' }, loadedCount: 1 },
};

const pass = () => makeCheckRecord({ verdict: 'PASS' });
const ok = (n) => makeControlRecord(n, CONTROL_ACCEPTABLE_STATE[n]);
/** Fake drivers: P1 evaluates C1 from `c1` (a record or facts); P2..P11 PASS every runnable unit; every call is logged. */
function drivers(log, c1Record) {
  const d = {};
  for (const p of PHASE_ORDER) {
    d[p.id] = async ({ runnable, beginControl }) => {
      log.push(p.id);
      if (p.id === 'P1') return { checks: { C1: c1Record } };
      for (const n of runnable.controls) beginControl(n);
      return { checks: Object.fromEntries(runnable.checks.map((c) => [c, pass()])), controls: Object.fromEntries(runnable.controls.map((n) => [n, ok(n)])) };
    };
  }
  return d;
}

/** Runs the runner and merges its result into a full §10 run state (as the live path does). */
async function runToState(c1Record, opts = {}) {
  const log = [];
  const recorder = createCallRecorder();
  const r = await runChecksInPhaseOrder({ drivers: drivers(log, c1Record), recorder, ...opts });
  const binding = makeBinding();
  const st = buildInitialRunState({ binding, validation: { record: null, candidateSet: null }, startedAt: AT });
  applyPhaseRunToState(st, { checks: r.checks, controls: r.controls, extras: r.extras, c1FinalizedEvent: r.c1FinalizedEvent, gates: r.gates, markers: r.markers, eventLog: r.eventLog, spyLedger: recorder.records, stateSnapshots: [] });
  return { r, st, log, recorder };
}

// ------------------------------------------------------------------------------------------
// Item 5/15: runtime global C1 gate -- truth table
// ------------------------------------------------------------------------------------------

const TRUTH_TABLE = [
  ['C1 PASS', () => evaluateC1(FACTS.PASS), {}, 'OPEN'],
  ['C1 BLOCKED(prerequisite)', () => evaluateC1(FACTS.prerequisite), {}, 'CLOSED_DEPENDENCY_BLOCKED'],
  ['C1 BLOCKED(timeout:load)', () => evaluateC1(FACTS['timeout:load']), {}, 'CLOSED_DEPENDENCY_BLOCKED'],
  ['C1 BLOCKED(<other>)', () => makeCheckRecord({ verdict: 'BLOCKED', reason: 'harness-exception' }), {}, 'CLOSED_OTHER'],
  ['C1 FAIL', () => makeCheckRecord({ verdict: 'FAIL', reason: 'x' }), {}, 'CLOSED_OTHER'],
  ['C1 PASS + fatal event before the gate', () => evaluateC1(FACTS.PASS), { errorLedger: { fatalCount: 1, entries: [{ kind: 'pageerror', detail: 'x', seq: 1 }] } }, 'CLOSED_OTHER'],
  ['C1 BLOCKED(prerequisite) + fatal before the gate', () => evaluateC1(FACTS.prerequisite), { fatalObserved: () => true }, 'CLOSED_OTHER'],
];

test('gate truth table: the runner records gates.C1 with the exact recomputed outcome / notStarted for every C1 cause', async () => {
  for (const [label, c1, opts, outcome] of TRUTH_TABLE) {
    const { r } = await runToState(c1(), opts);
    const g = r.gates.C1;
    assert.equal(g.outcome, outcome, label);
    assert.deepEqual(g.notStarted, outcome === 'OPEN' ? [] : [...DOWNSTREAM_ITEM_NAMES], label);
    assert.equal(g.c1Verdict, r.checks.C1.verdict, label);
    assert.equal(g.c1Reason, r.checks.C1.reason, label);
    assert.equal(g.c1FinalizedSeq, r.checks.C1.finalizedSeq, label);
    assert.ok(g.c1FinalizedSeq < g.gateSeq, label);
    // (with only a fatalObserved() signal the persisted node-side ledger is the recomputation authority -- slice C)
    if (!opts.fatalObserved) assert.deepEqual(gateC1Problems({ checks: r.checks, gates: r.gates, eventLog: r.eventLog, errorLedger: opts.errorLedger || { entries: [] } }).problems, [], label);
  }
});

test('gate OPEN: P2..P11 run after the gate; every downstream record is a run record; no gate-disposition; markers P1..P11 + cleanup in seq order', async () => {
  const { r, st, log } = await runToState(evaluateC1(FACTS.PASS));
  assert.deepEqual(log, ['P1', 'P2', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P6b', 'P7', 'P8', 'P9', 'P10', 'P11']);
  const gs = r.gates.C1.gateSeq;
  for (const n of CHECK_NAMES) assert.equal(r.checks[n].recordType, 'check-run', n);
  for (const n of CONTROL_NAMES) { assert.equal(r.controls[n].recordType, 'control-run', n); assert.ok(r.controls[n].executionRecord.startSeq > gs, `${n} starts after the gate`); }
  assert.deepEqual(r.markers.map((m) => m.name), ['P1', ...DOWNSTREAM_PHASE_IDS, 'cleanup']);
  const p2 = r.markers.find((m) => m.name === 'P2');
  assert.ok(r.checks.C1.finalizedSeq < gs && gs < p2.seq, 'C1 finalized < gateSeq < P2 marker');
  for (let i = 1; i < r.markers.length; i += 1) assert.ok(r.markers[i - 1].seq < r.markers[i].seq);
  assert.deepEqual(recordSchemaProblems(st), []);
});

for (const reason of ['prerequisite', 'timeout:load']) {
  test(`gate CLOSED_DEPENDENCY_BLOCKED (C1 BLOCKED(${reason})): no driver after P1, no P2 spies/N1, no downstream marker; one gate-disposition per C2..C20/N1..N8; row 6 BLOCKED`, async () => {
    const recorder = createCallRecorder();
    const log = [];
    let spyInstalled = false;
    const d = drivers(log, evaluateC1(FACTS[reason]));
    d.P2 = async () => { spyInstalled = true; return {}; };
    const r = await runChecksInPhaseOrder({ drivers: d, recorder });
    assert.deepEqual(log, ['P1']);
    assert.equal(spyInstalled, false, 'P2 spy installation / N1 never runs under a closed gate');
    assert.deepEqual(r.markers.map((m) => m.name), ['P1', 'cleanup']);
    const g = r.gates.C1;
    let prev = g.gateSeq;
    for (const id of DOWNSTREAM_ITEM_NAMES) {
      const rec = id.startsWith('C') ? r.checks[id] : r.controls[id];
      assert.equal(rec.recordType, 'gate-disposition', id);
      assert.ok(!('verdict' in rec) && !('state' in rec), id);
      assert.ok(rec.dispositionSeq > prev, `${id} dispositionSeq strictly increasing after gateSeq`);
      prev = rec.dispositionSeq;
      assert.equal(rec.blockingReason, reason, id);
      assert.equal(rec.disposition, id.startsWith('C') ? GATE_CHECK_DISPOSITION : GATE_CONTROL_DISPOSITION.CLOSED_DEPENDENCY_BLOCKED[id], id);
      assert.deepEqual(rec.evidenceRefs, [...GATE_EVIDENCE_REFS]);
      if (id.startsWith('C') || rec.disposition === NRDB_STATE) assert.equal(rec.dependencyBlockedBy.phaseSeq, r.checks.C1.finalizedSeq, id);
      else assert.equal(rec.dependencyBlockedBy, null, id);
    }
    assert.ok(prev < r.markers.find((m) => m.name === 'cleanup').seq, 'last disposition < cleanup marker');
    assert.equal(recorder.records.length, 0, 'no spy record');
    // the whole state through the live merge path: schema-valid, NRDB legal (L1-L4), row 6 BLOCKED (X4)
    const { st } = await runToState(evaluateC1(FACTS[reason]));
    assert.deepEqual(recordSchemaProblems(st), []);
    for (const n of NRDB_CONTROL_NAMES) assert.deepEqual(nrdbLegality(n, st), { legal: true, failed: [], problems: [] }, n);
    assert.equal(st.c17, null); assert.equal(st.c20, null); assert.equal(st.n6, null); assert.deepEqual(st.c4Table, []);
    Object.assign(st, { classifier: { A: 'CONFIRMED_SVF2', B: reason === 'prerequisite' ? 'CONTRADICTORY' : 'CONFIRMED_SVF2' }, runtime: { A: { loaded: true }, B: { loaded: reason !== 'timeout:load' } }, script: { integrityResult: 'VERIFIED' } });
    const b = makeBinding();
    Object.assign(st, { attempt: { attemptId: b.attemptId }, authorization: { id: b.authorization.id, sha256: b.authorization.sha256 }, harnessIntegrity: { headSha: b.headSha, sha256: b.harness.sha256 }, procedure: { sha256: b.procedure.sha256 }, runtimeEnvelope: { urnSha256: { A: b.fixtures.A.urnSha256, B: b.fixtures.B.urnSha256 } }, journal: journalWith(b, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']) });
    const x = computeOverall(st, 'pre-closeout');
    assert.deepEqual([x.overall, x.row], ['BLOCKED', 6], JSON.stringify(x.reasons));
  });
}

test('gate CLOSED_OTHER (C1 FAIL / non-normalized BLOCKED / pre-gate fatal): dispositions closed-other, N1/N2 NOT_DETECTED, N3-N5/N7 NOT_EXECUTABLE, N6/N8 NOT_APPLICABLE; schema-valid; never NRDB', async () => {
  for (const [label, c1, opts] of TRUTH_TABLE.filter((t) => t[3] === 'CLOSED_OTHER')) {
    const { r, st, log } = await runToState(c1(), opts);
    assert.ok(log.every((p) => p === 'P1'), label); // (a fatal observed from the start also fatal-skips P1 itself)
    for (const id of DOWNSTREAM_ITEM_NAMES) {
      const rec = id.startsWith('C') ? r.checks[id] : r.controls[id];
      assert.equal(rec.blockingReason, 'closed-other', label);
      assert.equal(rec.dependencyBlockedBy, null, label);
      if (!id.startsWith('C')) assert.equal(rec.disposition, GATE_CONTROL_DISPOSITION.CLOSED_OTHER[id], `${label} ${id}`);
    }
    if (!opts.errorLedger && !opts.fatalObserved) assert.deepEqual(recordSchemaProblems(st), [], label);
  }
});

test('the old runtime BLOCKED(dependency:C1) downstream encoding is never produced; a runtime BLOCKED after an OPEN gate stays a check-run record', async () => {
  for (const [, c1, opts] of TRUTH_TABLE) {
    const { r } = await runToState(c1(), opts);
    for (const n of CHECK_NAMES.slice(1)) {
      const rec = r.checks[n];
      assert.ok(!(rec.recordType === 'check-run' && typeof rec.reason === 'string' && /dependency:.*C1/.test(rec.reason)), n);
    }
  }
  // OPEN gate, then a fatal event: later checks are runtime BLOCKED(fatal-skip) check-run records (never dispositions)
  let fatal = false;
  const d = drivers([], evaluateC1(FACTS.PASS));
  const p5b = d.P5b;
  d.P5b = async (ctx) => { fatal = true; return p5b(ctx); };
  const r = await runChecksInPhaseOrder({ drivers: d, fatalObserved: () => fatal });
  assert.equal(r.gates.C1.outcome, 'OPEN');
  assert.deepEqual([r.checks.C9.recordType, r.checks.C9.verdict, r.checks.C9.reason], ['check-run', 'BLOCKED', 'fatal-skip']);
  assert.equal(r.controls.N4.recordType, 'control-run');
});

test('GATE_C1_REQUIRED is true: a runner result without gates.C1 (e.g. a failed page run) is row 5', async () => {
  assert.equal(GATE_C1_REQUIRED, true);
  // LIVE_PATH_WIRED is deliberately not pinned here: the single pin of the real value is in live-path-isolation.test.mjs.
  const { st } = await runToState(evaluateC1(FACTS.PASS));
  st.gates = null;
  assert.ok(recordSchemaProblems(st).includes('gates-missing'));
});

// ------------------------------------------------------------------------------------------
// Item 21: attribution fields, one counter, wrapper events, C16 log unification
// ------------------------------------------------------------------------------------------

test('recorder: every spy record carries seq/phase/activeCheck/activeControl from the single counter; wrapper-install/-restore are eventLog entries', () => {
  const rec = createCallRecorder();
  const reg = createWrapperRegistry();
  rec.setAttribution({ phase: 'P2', activeCheck: null, activeControl: null });
  const obj = { f(x) { return x; } };
  recordingWrap(obj, 'f', { recorder: rec, registry: reg, label: 'obj.f' });
  rec.setAttribution({ phase: 'P8', activeCheck: 'C15', activeControl: null });
  const inj = installInjectionWrapper(obj, 'f', (prev) => function inj(...a) { return Reflect.apply(prev, this, a); }, { registry: reg });
  rec.withOrigin('harness', () => obj.f(1));
  inj.remove();
  rec.setAttribution({ phase: 'cleanup', activeCheck: null, activeControl: null });
  reg.restoreAll();
  assert.deepEqual(rec.records.map((r) => [r.phase, r.activeCheck, r.activeControl]), [['P8', 'C15', null]]);
  assert.deepEqual(rec.events.map((e) => [e.kind, e.phase, e.activeCheck, e.layer]), [
    ['wrapper-install', 'P2', null, 'recording'], ['wrapper-install', 'P8', 'C15', 'injection'], ['wrapper-restore', 'P8', 'C15', 'injection'], ['wrapper-restore', 'cleanup', null, 'recording'],
  ]);
  const seqs = [...rec.records, ...rec.events].map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [...new Set(seqs)], 'one counter: no seq shared by two entries');
  assert.throws(() => rec.setAttribution({ bogus: 1 }), TypeError);
});

test('C16 monotonic event log: with a recorder its seq comes from the run counter (unified with spy seq) and entries carry the attribution fields', () => {
  const rec = createCallRecorder();
  rec.setAttribution({ phase: 'P9', activeCheck: 'C16', activeControl: null });
  rec.record('viewer.hideModel', []);
  const log = createMonotonicEventLog({ recorder: rec });
  const e = log.push({ kind: 'listener-entry', eventName: 'x' });
  assert.equal(e.seq, rec.records[0].seq + 1);
  assert.deepEqual([e.phase, e.activeCheck, e.activeControl], ['P9', 'C16', null]);
  assert.ok(rec.events.includes(e));
  // legacy (no recorder) numbering unchanged for pure oracle tests
  assert.equal(createMonotonicEventLog().push({ kind: 'listener-entry' }).seq, 0);
});

test('runner attribution: P1 is attributed to C1, beginCheck/beginControl set activeCheck/activeControl, phase-end and cleanup entries carry null items', async () => {
  const rec = createCallRecorder();
  const d = drivers([], evaluateC1(FACTS.PASS));
  d.P1 = async () => { rec.record('p1.read', []); return { checks: { C1: evaluateC1(FACTS.PASS) } }; };
  d.P7 = async ({ runnable, beginCheck, beginControl }) => {
    beginCheck('C9'); rec.record('c9.read', []);
    beginControl('N5'); rec.record('n5.act', []);
    return { checks: Object.fromEntries(runnable.checks.map((c) => [c, pass()])), controls: { N4: ok('N4'), N5: ok('N5') } };
  };
  const r = await runChecksInPhaseOrder({ drivers: d, recorder: rec, assertPhaseBaseline: () => { rec.record('baseline', []); return { ok: true }; } });
  const by = (m) => rec.records.filter((x) => x.method === m).map((x) => [x.phase, x.activeCheck, x.activeControl]);
  assert.deepEqual(by('p1.read'), [['P1', 'C1', null]]);
  assert.deepEqual(by('c9.read'), [['P7', 'C9', null]]);
  assert.deepEqual(by('n5.act'), [['P7', 'C9', 'N5']]);
  assert.ok(by('baseline').every(([, c, n]) => c === null && n === null));
  assert.deepEqual(rec.attribution(), { phase: 'cleanup', activeCheck: null, activeControl: null }, 'left at cleanup for the caller');
  assert.deepEqual(attributionFieldProblems({ spyLedger: rec.records, eventLog: r.eventLog, stateSnapshots: [] }), []);
});

test('attribution fields are required on every spyLedger/eventLog/stateSnapshots entry (any gate); eventLog must be monotonic', () => {
  const b = makeBinding();
  const base = () => createOfflineRunStateFixture({ binding: b });
  assert.deepEqual(attributionFieldProblems(base()), []);
  const cases = [
    ['spy entry without phase', (s) => { s.spyLedger = [{ seq: 5, activeCheck: null, activeControl: null }]; }, 'attribution:spyLedger[0]'],
    ['snapshot with unknown phase', (s) => { s.stateSnapshots = [{ seq: 5, phase: 'P12', activeCheck: null, activeControl: null }]; }, 'attribution:stateSnapshots[0]'],
    ['event with bad activeControl', (s) => { s.eventLog.push({ seq: 9, kind: 'x', phase: 'P2', activeCheck: null, activeControl: 'N9' }); }, 'attribution:eventLog[1]'],
    ['event without seq', (s) => { s.eventLog.push({ kind: 'x', phase: 'P2', activeCheck: null, activeControl: null }); }, 'attribution:eventLog[1]'],
    ['non-monotonic eventLog', (s) => { s.eventLog.unshift({ seq: 7, kind: 'x', phase: 'P1', activeCheck: null, activeControl: null }); }, 'attribution:eventLog-not-monotonic[1]'],
    ['capped spyLedger {records}', (s) => { s.spyLedger = { records: [{ seq: 1 }] }; }, 'attribution:spyLedger[0]'],
  ];
  for (const [label, mut, problem] of cases) {
    const s = base(); mut(s);
    assert.ok(recordSchemaProblems(s).includes(problem), `${label}: ${JSON.stringify(recordSchemaProblems(s))}`);
  }
  assert.deepEqual([...ATTRIBUTION_PHASES], ['P0', 'P1', ...DOWNSTREAM_PHASE_IDS, 'cleanup', 'closeout']);
  assert.deepEqual([...DOWNSTREAM_PHASE_IDS], PHASE_ORDER.map((p) => p.id).slice(PHASE_ORDER.findIndex((p) => p.id === 'P2'), PHASE_ORDER.findIndex((p) => p.id === 'cleanup')), 'drift vs PHASE_ORDER');
});

// ------------------------------------------------------------------------------------------
// Item 21: closed-gate evidence predicates CG-1..CG-7 (one mutation each) + legal records
// ------------------------------------------------------------------------------------------

async function closedState(reason = 'prerequisite') {
  const { st } = await runToState(evaluateC1(FACTS[reason]));
  return st;
}
const cleanupSeqOf = (s) => s.errorLedger.markers.find((m) => m.name === 'cleanup').seq;
const A0 = (o) => ({ phase: 'P1', activeCheck: null, activeControl: null, ...o });

const CG_MUTATIONS = [
  ['CG-1 a P2 marker', (s) => { s.errorLedger.markers.splice(1, 0, { seq: s.gates.C1.gateSeq + 1, name: 'P2' }); }, 'CG-1:'],
  ['CG-2 a post-gate non-cleanup spy-ledger entry', (s) => { s.spyLedger.push(A0({ seq: s.gates.C1.gateSeq + 1, method: 'viewer.fitToView' })); }, 'CG-2:spyLedger'],
  ['CG-2 a post-gate state snapshot', (s) => { s.stateSnapshots.push(A0({ seq: s.gates.C1.gateSeq + 1 })); }, 'CG-2:stateSnapshots'],
  ['CG-2 a cleanup spy entry with activeCheck', (s) => { s.spyLedger.push(A0({ seq: cleanupSeqOf(s) + 1, phase: 'cleanup', activeCheck: 'C1' })); }, 'CG-2:spyLedger'],
  ['CG-3 an eventLog entry with non-null activeControl', (s) => { s.eventLog.push(A0({ seq: cleanupSeqOf(s) + 2, phase: 'cleanup', activeControl: 'N1', kind: 'wrapper-restore' })); }, 'CG-3:eventLog'],
  ['CG-3 a non-C1 check-finalized event', (s) => { s.eventLog.push(A0({ seq: cleanupSeqOf(s) + 2, phase: 'cleanup', kind: 'check-finalized', check: 'C7' })); }, 'CG-3:eventLog'],
  ['CG-3 a post-gate wrapper-install', (s) => { s.eventLog.push(A0({ seq: cleanupSeqOf(s) + 2, phase: 'cleanup', kind: 'wrapper-install' })); }, 'CG-3:eventLog'],
  ['CG-4 a P9 opLedger record', (s) => { s.errorLedger.opLedger = [{ recordType: 'mutation', phase: 'P9', invokedBy: 'cleanup:unloadModelB', startSeq: cleanupSeqOf(s) + 1 }]; }, 'CG-4:'],
  ['CG-4 an invokedBy C16 opLedger record', (s) => { s.errorLedger.opLedger = [{ recordType: 'mutation', phase: 'cleanup', invokedBy: 'C16', startSeq: cleanupSeqOf(s) + 1 }]; }, 'CG-4:'],
  ['CG-4 a load record after the gate', (s) => { s.errorLedger.opLedger = [{ recordType: 'load', phase: 'P1', invokedBy: 'P1', startSeq: s.gates.C1.gateSeq + 1 }]; }, 'CG-4:'],
  ['CG-5 a raw network event with activeCheck C7', (s) => { s.errorLedger.responseFailures = [{ rawEventSeq: 1, phase: 'P1', activeCheck: 'C7' }]; }, 'CG-5:errorLedger.responseFailures'],
  ['CG-5 a request observation with activeCheck C7', (s) => { s.errorLedger.requestObservations = [{ startSeq: 1, phase: 'P1', activeCheck: 'C7' }]; }, 'CG-5:errorLedger.requestObservations'],
  ['CG-6 a control-run record', (s) => { s.controls.N4 = clone((makeOpenStateControls()).N4); }, 'CG-6:controls.N4:control-run'],
  ['CG-6 an executionRecord.started:true', (s) => { Object.assign(s.controls.N6.executionRecord, { started: true, crossedStartBoundary: true, startSeq: s.gates.C1.gateSeq + 1, startedAt: AT, result: {}, evidenceRefs: ['/controls/N6'] }); }, 'CG-6:controls.N6:executionRecord-started'],
  ['CG-7 a non-null c17', (s) => { s.c17 = {}; }, 'CG-7:c17'],
  ['CG-7 a non-null c20', (s) => { s.c20 = {}; }, 'CG-7:c20'],
  ['CG-7 a non-null n6', (s) => { s.n6 = {}; }, 'CG-7:n6'],
  ['CG-7 a non-empty c4Table', (s) => { s.c4Table = [{ dbId: 1 }]; }, 'CG-7:c4Table'],
];
let openControls = null;
function makeOpenStateControls() { return openControls; }

test('CG-1..CG-7: each single mutation beside a closed gate is detected (row 5 via closed-gate-evidence; NRDB L2 false => row 4 first)', async () => {
  openControls = (await runToState(evaluateC1(FACTS.PASS))).st.controls;
  const canonical = await closedState();
  assert.deepEqual(closedGateEvidenceMatches(canonical), []);
  for (const [label, mut, prefix] of CG_MUTATIONS) {
    for (const phase of OVERALL_PHASES) {
      const s = clone(canonical); mut(s);
      const matches = closedGateEvidenceMatches(s);
      assert.ok(matches.some((m) => m.startsWith(prefix)), `${label}: ${JSON.stringify(matches)}`);
      const ps = recordSchemaProblems(s);
      assert.ok(ps.some((p) => p.startsWith(`closed-gate-evidence:${prefix}`)), `${label} listed once by recordSchemaProblems`);
      assert.ok(ps.includes('checks.C2:G-f:closed-gate-evidence'), `${label}: G-f violated for every disposition`);
      assert.equal(nrdbLegality('N3', s).legal, false, `${label}: CG match = attribution (L2)`);
      assert.ok(nrdbLegality('N3', s).failed.includes('L2'), label);
      const rows = evaluateOverallRows(s, phase);
      assert.equal(rows[4].match, true, `${label}: row 5 predicate`);
      void phase;
    }
  }
});

/**
 * Drives the real slice-C1 listener bodies over `s.errorLedger` with scripted seqs/attribution:
 * `steps = [[op, seq, phase, activeCheck, req?]]`, op in request|requestfailed|response500|fatal:<kind>.
 */
function driveNetwork(s, steps) {
  let next = null;
  let attr = { phase: 'P1', activeCheck: null };
  const sink = createFatalEventSink(s.errorLedger, { nextSeq: () => next });
  const net = createNetworkInstrumentation({ ledger: s.errorLedger, nextSeq: () => next, sink, attribution: () => attr });
  const reqs = {};
  const mk = (id) => (reqs[id] ||= { url: () => `https://cdn.derivative.invalid/res/${id}.bin?token=SECRET`, method: () => 'GET', resourceType: () => 'fetch', isNavigationRequest: () => false, failure: () => ({ errorText: 'net::ERR_FAILED' }) });
  for (const [op, seq, phase, activeCheck, id = 'r'] of steps) {
    next = seq; attr = { phase, activeCheck };
    if (op === 'request') net.onRequest(mk(id));
    else if (op === 'requestfailed') net.onRequestFailed(mk(id));
    else if (op === 'response500') net.onResponse({ status: () => 500, request: () => mk(id) });
    else if (op.startsWith('fatal:')) sink.recordFatal(op.slice(6), 'x');
  }
  return sink;
}

test('legal under a closed gate (exhaustive list): passive P1 network/fatal records between gate and cleanup, cleanup/closeout records -- accepted', async () => {
  const s = await closedState();
  const gs = s.gates.C1.gateSeq;
  // room for the passive window records after the contiguous dispositions (single counter: no collision)
  const lastDisposition = Math.max(...DOWNSTREAM_ITEM_NAMES.map((id) => (id.startsWith('C') ? s.checks[id] : s.controls[id]).dispositionSeq));
  const W = lastDisposition + 1;
  s.errorLedger.markers.find((m) => m.name === 'cleanup').seq = W + 50;
  const cs = cleanupSeqOf(s);
  driveNetwork(s, [
    ['request', W, 'P1', null, 'a'], ['requestfailed', W + 1, 'P1', null, 'a'],
    ['request', cs + 1, 'cleanup', null, 'b'], ['response500', cs + 2, 'closeout', null, 'b'],
  ]);
  for (const kind of PASSIVE_FATAL_EVENT_KINDS) s.eventLog.push(A0({ seq: W + 3 + PASSIVE_FATAL_EVENT_KINDS.indexOf(kind), kind }));
  driveNetwork(s, [['fatal:pageerror', W + 3, 'P1', null]]); // the ledger record of the passive pageerror event (same seq)
  s.eventLog.push(A0({ seq: cs + 3, phase: 'cleanup', kind: 'wrapper-restore' }));
  s.spyLedger.push(A0({ seq: cs + 4, phase: 'cleanup', method: 'overlays.removeScene' }));
  s.stateSnapshots.push(A0({ seq: cs + 5, phase: 'cleanup' }));
  // slice C2: an exact cleanup-unload mutationOperation (start, node-side ack, end; window closed by the closeout marker)
  s.errorLedger.opLedger = [{
    recordType: 'mutation', operationId: 'op:cleanup-unloadA', operationType: 'unload', teardownTarget: null, modelId: 'A', phase: 'cleanup', invokedBy: 'cleanup:unloadModelA',
    startSeq: cs + 6, startedAt: '2026-10-01T00:00:00.000Z', ackSeq: cs + 7, endSeq: cs + 8, endedAt: '2026-10-01T00:00:01.000Z',
    cancellationWindow: { fromSeqExclusive: cs + 6, toSeqExclusive: cs + 9 }, causalEvidence: { spyRef: null, cleanupStepRef: '/cleanupStepStatus/unloadModelA', ackSeq: cs + 7 }, terminalOutcome: 'settled',
  }];
  s.errorLedger.markers.push({ seq: cs + 9, name: 'closeout' });
  driveNetwork(s, [['fatal:page-crash', cs + 10, 'cleanup', null]]);
  assert.deepEqual(s.errorLedger.entries.map((e) => [e.kind, e.seq]), [['required-resource-failure', W + 1], ['required-resource-failure', cs + 2], ['pageerror', W + 3], ['page-crash', cs + 10]]);
  assert.equal(s.errorLedger.fatalCount, 4);
  assert.doesNotMatch(JSON.stringify(s.errorLedger), /SECRET|token/);
  s.eventLog.sort((a, b) => a.seq - b.seq);
  assert.deepEqual(closedGateEvidenceMatches(s), []);
  assert.deepEqual(closedGateIllegalRecords(s), []);
  assert.deepEqual(recordSchemaProblems(s), []);
  for (const n of NRDB_CONTROL_NAMES) assert.equal(nrdbLegality(n, s).legal, true, n);
});

test('closed-gate legal-record list rejects records that match no CG predicate but are not on the list', async () => {
  const base = await closedState();
  const gs = base.gates.C1.gateSeq;
  const cs = cleanupSeqOf(base);
  const cases = [
    ['P1 non-fatal eventLog kind in the gate window', (s) => { s.eventLog.push(A0({ seq: gs + 1, kind: 'listener-entry' })); }, 'eventLog'],
    ['P1 fatal kind with activeCheck C1 in the window', (s) => { s.eventLog.push(A0({ seq: gs + 1, kind: 'pageerror', activeCheck: 'C1' })); }, 'eventLog'],
    ['window request observation with activeCheck C1', (s) => { s.errorLedger.requestObservations = [{ startSeq: gs + 1, phase: 'P1', activeCheck: 'C1' }]; }, 'errorLedger.requestObservations'],
    ['P1 spy entry after cleanup', (s) => { s.spyLedger.push(A0({ seq: cs + 1, phase: 'P1' })); }, 'spyLedger'],
    ['cleanup opLedger without cleanup:<step>', (s) => { s.errorLedger.opLedger = [{ recordType: 'mutation', phase: 'cleanup', invokedBy: 'harness', startSeq: cs + 1 }]; }, 'errorLedger.opLedger'],
    ['P1 marker after the gate', (s) => { s.errorLedger.markers.push({ seq: cs + 1, name: 'P1' }); }, 'errorLedger.markers'],
    ['unsequenced network record', (s) => { s.errorLedger.requestFailures = [{ phase: 'P1', activeCheck: null }]; }, 'errorLedger.requestFailures'],
    ['non-fatal-kind ledger entry between gate and cleanup', (s) => { s.errorLedger.entries = [{ kind: 'harness-note', detail: 'x', seq: gs + 1 }]; }, 'errorLedger.entries'],
    ['pre-gate cleanup-labelled event', (s) => { s.eventLog.unshift(A0({ seq: 0, phase: 'cleanup', kind: 'wrapper-restore' })); }, 'eventLog'],
    ['pre-gate cleanup marker', (s) => { s.errorLedger.markers.unshift({ seq: 0, name: 'closeout' }); }, 'errorLedger.markers'],
    ['pre-gate cleanup mutation', (s) => { s.errorLedger.opLedger = [{ recordType: 'mutation', phase: 'cleanup', invokedBy: 'cleanup:unloadModelA', startSeq: 0 }]; }, 'errorLedger.opLedger'],
  ];
  for (const [label, mut, coll] of cases) {
    const s = clone(base); mut(s); s.eventLog.sort((a, b) => a.seq - b.seq);
    const ps = recordSchemaProblems(s);
    assert.ok(ps.some((p) => p.startsWith(`closed-gate-illegal-record:${coll}[`)), `${label}: ${JSON.stringify(ps)}`);
  }
  // an OPEN gate does not apply the closed-gate list
  const { st } = await runToState(evaluateC1(FACTS.PASS));
  assert.deepEqual(recordSchemaProblems(st).filter((p) => p.startsWith('closed-gate')), []);
});

// ------------------------------------------------------------------------------------------
// Item 24: atomic gate preparation (§9.2 test (25))
// ------------------------------------------------------------------------------------------

// A provisional rule-candidate HTTP 404 (full §9.2 shape) for the request observed at `seq - 1`, plus
// its observation; a synthetic test-only rule (never the frozen constant) makes it a candidate.
const URL404 = 'https://cdn.derivative.invalid/m/B/x.json';
const provisional = (seq, reqSeq = seq - 1) => ({
  reqId: `q:${reqSeq}`, reqIdValid: true, rawEventId: `hr:${seq}`, rawEventSeq: seq, identityKey: `req:q:${reqSeq}`, duplicateOf: null, startSeq: reqSeq,
  method: 'GET', resourceType: 'fetch', urlRedacted: URL404, urlClass: 'other', isNavigationRequest: false, frameIsMain: true, redirected: false, phase: 'P1', activeCheck: null,
  responseSeq: seq, stage: 'provisional', finalizedSeq: null, finalizedBy: null, status: 404, requirement: null, modelBindingObserved: null, eventTime: null, closeout: null, agree: null,
});
const observation = (reqSeq) => ({ reqId: `q:${reqSeq}`, startSeq: reqSeq, method: 'GET', resourceType: 'fetch', urlRedacted: URL404, urlClass: 'other', isNavigationRequest: false, phase: 'P1', activeCheck: null });
const SYNTH_RULES = Object.freeze([Object.freeze({ ruleId: 'test-only-404', method: 'GET', model: 'B', pathSuffix: 'x.json', resourceTypes: ['fetch'], statuses: [404], rationale: 'offline test only' })]);
const synthFinalize = (e, ctx) => defaultGateFinalization(e, { ...ctx, rules: SYNTH_RULES });
const ledgerWith = (...entries) => ({ fatalCount: 0, entries: [], requestObservations: [...new Set(entries.map((e) => e.startSeq))].sort((a, b) => a - b).map(observation), requestFailures: [], responseFailures: entries, correlatedRequests: [], fatalWitnesses: [] });

test('(25) positive: a provisional candidate whose load window never closes is finalized IN gate preparation as unknown-fatal; finalizedSeq = witnessSeq < gateSeq; fatalCountAtGate 1; CLOSED_OTHER', () => {
  let n = 10;
  const seqOf = () => { n += 1; return n; };
  const c1 = { recordType: 'check-run', verdict: 'BLOCKED', reason: 'prerequisite', fields: { blockDetail: [{ cause: 'classifier', model: 'B', observed: 'x' }] }, evidence: {}, finalizedSeq: 9, finalizedAt: AT };
  const ledger = ledgerWith(provisional(5));
  const g = prepareC1Gate({ c1, errorLedger: ledger, seqOf, finalizeAtGate: synthFinalize });
  const e = ledger.responseFailures[0];
  assert.deepEqual([e.finalizedBy, e.closeout.classification, e.requirement], ['gate', 'unknown-fatal', 'unknown']);
  assert.deepEqual(e.closeout.reasons, ['R-4', 'binding-unavailable', 'other'], 'unresolved ownership at finalization => unknown-fatal');
  assert.deepEqual(e.modelBindingObserved, { status: 'ambiguous', modelId: null, prefixKey: 'https://cdn.derivative.invalid/m/B' });
  assert.equal(ledger.fatalWitnesses[0].witnessSeq, e.finalizedSeq);
  assert.ok(e.responseSeq < e.finalizedSeq && e.finalizedSeq < g.gateSeq, 'responseSeq < finalizedSeq = witnessSeq < gateSeq');
  assert.deepEqual([g.fatalCountAtGate, g.outcome, ledger.fatalCount], [1, 'CLOSED_OTHER', 1]);
  assert.deepEqual(ledger.entries, [{ kind: 'required-resource-failure', seq: e.finalizedSeq, witnessId: ledger.fatalWitnesses[0].witnessId }]);
  assert.deepEqual(gateFinalizationProblems(ledger, g.gateSeq), []);
  const st = { checks: { C1: c1 }, gates: { C1: g }, eventLog: [{ seq: 9, kind: 'check-finalized', check: 'C1', verdict: 'BLOCKED', reason: 'prerequisite' }], errorLedger: ledger };
  assert.deepEqual(gateC1Problems(st).problems, []);
  assert.deepEqual(networkLedgerProblems({ errorLedger: ledger }, { rules: SYNTH_RULES }), [], 'the gate-finalized entry and its witness recompute exactly');
  // a second provisional member of the same identity (the same >= 400 response delivered twice): one witness
  const l2 = ledgerWith(provisional(5), { ...provisional(6, 4), duplicateOf: 'hr:5' });
  prepareC1Gate({ c1, errorLedger: l2, seqOf, finalizeAtGate: synthFinalize });
  assert.deepEqual([l2.fatalWitnesses.length, l2.entries.length, l2.fatalCount], [1, 1, 1]);
  assert.deepEqual(l2.fatalWitnesses[0].rawEventRefs, ['hr:5', 'hr:6']);
});

test('(25) negative: gateSeq allocated first and the entry finalized afterwards (finalizedBy gate, finalizedSeq > gateSeq), fatalCountAtGate 0, gate CDB => row 5; a pre-gate witness omitted from fatalCountAtGate => row 5', async () => {
  const { st } = await runToState(evaluateC1(FACTS.prerequisite));
  const gs = st.gates.C1.gateSeq;
  const s = clone(st);
  s.errorLedger.responseFailures = [{ ...provisional(2), stage: 'provisional', finalizedBy: 'gate', finalizedSeq: gs + 1 }];
  assert.equal(s.gates.C1.fatalCountAtGate, 0);
  assert.equal(s.gates.C1.outcome, 'CLOSED_DEPENDENCY_BLOCKED');
  assert.ok(recordSchemaProblems(s).some((p) => p.startsWith('gates.C1.gate-finalized-after-gate')), JSON.stringify(recordSchemaProblems(s)));
  assert.equal(evaluateOverallRows(s, 'pre-closeout')[4].match, true);
  // finalizedSeq === gateSeq is equally illegal (strict <)
  const eq = clone(st); eq.errorLedger.responseFailures = [{ ...provisional(2), finalizedBy: 'gate', finalizedSeq: gs }];
  assert.ok(gateFinalizationProblems(eq.errorLedger, gs).length === 1);
  // a witness with witnessSeq < gateSeq but no entry (omitted from fatalCountAtGate)
  const w = clone(st); w.errorLedger.fatalWitnesses = [{ witnessId: 'w:req:q:1', requestIdentityKey: 'req:q:1', witnessSeq: 1 }];
  assert.ok(recordSchemaProblems(w).includes('gates.C1.fatal-witness-without-single-entry'));
});

test('gate preparation is synchronous: a thenable from a hook throws; the function body contains no await/yield/then', () => {
  const c1 = { recordType: 'check-run', verdict: 'PASS', reason: null, fields: {}, evidence: {}, finalizedSeq: 1, finalizedAt: AT };
  let n = 1;
  const seqOf = () => { n += 1; return n; };
  assert.throws(() => prepareC1Gate({ c1, errorLedger: { entries: [], responseFailures: [provisional(2)] }, seqOf, finalizeAtGate: async () => ({}) }), /synchronous/);
  assert.throws(() => prepareC1Gate({ c1, errorLedger: { entries: [] }, seqOf, rebuildFatalWitnessState: () => Promise.resolve() }), /synchronous/);
  const { start, end } = locateFunctionSource(HARNESS_SOURCE, 'prepareC1Gate');
  const toks = tokenizeJs(HARNESS_SOURCE.slice(start, end));
  assert.ok(!toks.some((t) => t.type === 'ident' && ['await', 'yield', 'setTimeout', 'setImmediate', 'queueMicrotask'].includes(t.value)));
  assert.ok(!/\.then\(/.test(HARNESS_SOURCE.slice(start, end)));
  // gateSeq is allocated after every finalization/witness seq
  const ledger = ledgerWith(provisional(1, 0));
  const g = prepareC1Gate({ c1, errorLedger: ledger, seqOf, finalizeAtGate: synthFinalize });
  assert.ok(ledger.responseFailures[0].finalizedSeq < g.gateSeq);
});

test('runner: the gate preparation runs between C1 finalization and the gate record with the run\'s single counter (no second counter)', async () => {
  const rec = createCallRecorder();
  const ledger = ledgerWith(provisional(1, 0));
  const r = await runChecksInPhaseOrder({ drivers: drivers([], evaluateC1(FACTS.PASS)), recorder: rec, errorLedger: () => ledger, gateHooks: { finalizeAtGate: synthFinalize } });
  const e = ledger.responseFailures[0];
  assert.ok(r.checks.C1.finalizedSeq < e.finalizedSeq && e.finalizedSeq < r.gates.C1.gateSeq);
  assert.equal(r.gates.C1.outcome, 'CLOSED_OTHER', 'the gate-finalized unknown-fatal witness closes the gate');
  await assert.rejects(runChecksInPhaseOrder({ drivers: {}, recorder: rec, nextSeq: () => 1 }), TypeError);
});

// ------------------------------------------------------------------------------------------
// Item 4: R1 overall row <-> verdict pairing (§8 table, §10 "primaryOverall with the matching row")
// ------------------------------------------------------------------------------------------

test('validateResultSchema: overall.verdict must be the §8 verdict of overall.row (and the same for closeout.primary*)', () => {
  const b = makeBinding();
  const s = createOfflineRunStateFixture({ binding: b });
  const S = (verdict, row) => ({ run: { ...s }, primaryOverall: verdict, primaryRow: row, optional: [], journalTransitions: journalWith(b, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']).transitions, finishedAt: AT });
  const errs = (verdict, row) => validateResultSchema(buildResultPayload(S(verdict, row)), 'payload').errors;
  for (const [row, verdict] of Object.entries(OVERALL_ROW_VERDICT)) assert.ok(!errs(verdict, Number(row)).some((e) => e.includes('row-verdict')), `${verdict}/${row}`);
  assert.ok(errs('PASS', 3).includes('overall.row-verdict-mismatch'));
  assert.ok(errs('PASS', 3).includes('closeout.row-verdict-mismatch'));
  assert.ok(errs('BLOCKED', 5).includes('overall.row-verdict-mismatch'));
  assert.ok(errs('FAIL', 8).includes('overall.row-verdict-mismatch'));
  // overall vs closeout disagreement stays its own error
  const p = buildResultPayload(S('PASS', 8)); p.closeout.primaryRow = 7; p.closeout.primaryOverall = 'PARTIAL';
  assert.ok(validateResultSchema(p, 'payload').errors.includes('overall-differs-from-closeout'));
  assert.equal(checkVerdictBase(null), null);
});
