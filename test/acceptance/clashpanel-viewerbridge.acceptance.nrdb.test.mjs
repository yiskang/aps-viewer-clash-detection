// test/acceptance/clashpanel-viewerbridge.acceptance.nrdb.test.mjs
//
// Offline tests for the G2 harness RC1-C1/RC1-C2 schema/pure-logic layer (slice B1): procedure §7
// record types (check-run | control-run | gate-disposition, G-a..G-f), the exact executionRecord
// (both shapes) and dependencyBlockedBy, NRDB legality L1-L4 as a pure function, the normalized C1
// reason contract + single check-finalized event, the global-C1-gate equations (validator side), the
// control dependency-id table (N7/N8, acyclic), the §8 worked examples X4 / X20-X29 and the offline
// matrix with a downstream record-type dimension, plus a static guard that no gate-disposition-
// capable path reads a raw `.state`. Pure; no filesystem, no Viewer, no Playwright.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECK_NAMES, CONTROL_NAMES, PHASE_ORDER, CHECK_DEPENDENCIES, JOURNAL_STATE, VERDICT_SEVERITY, OVERALL_PHASES,
  NRDB_STATE, RECORD_TYPE, C1_NORMALIZED_REASONS, GATE_OUTCOME, GATE_EVIDENCE_REFS, GATE_CHECK_DISPOSITION, GATE_C1_REQUIRED,
  FATAL_ENTRY_SEQ_REQUIRED, DOWNSTREAM_ITEM_NAMES, NRDB_CONTROL_NAMES, CONTROL_DEPENDENCY_IDS, CONTROL_OWNING_PHASE,
  CONTROL_NOT_STARTED_STATES, GATE_CONTROL_DISPOSITION, CONTROL_ACCEPTABLE_STATE,
  controlEffectiveState, checkVerdictBase, controlDisposition, executionRecordProblems, dependencyBlockedByShapeProblems,
  dependencyBlockedByReferentialProblems, gateDispositionProblems, recomputeGateOutcome, recomputeFatalCountAtGate, gateC1Problems,
  recordSchemaProblems, nrdbLegality, finalizeC1Record, makeCheckRecord, makeControlRecord, makeControlRunRecord,
  validateControlRunRecord, validateResultSchema, computeOverall, evaluateOverallRows, evaluateC1, renderSummary,
  createOfflineRunStateFixture, buildBindingRecord, sha256Hex, serializeJson, MODEL_A_URN, MODEL_B_URN,
  tokenizeJs, locateFunctionSource, runChecksInPhaseOrder, createCallRecorder,
  createEmptyErrorLedger, createFatalEventSink, createNetworkInstrumentation,
  createRunSeqAllocator, createOperationLedger, finalizeLoadWindows, withNodeLoadOutcomes, c1LoadLedgerProblems,
} from './clashpanel-viewerbridge.acceptance.mjs';
import { livePathWiredDeclaration } from './support/g2-harness-copy.mjs';

const HARNESS_SOURCE = readFileSync(fileURLToPath(new URL('./clashpanel-viewerbridge.acceptance.mjs', import.meta.url)), 'utf8');
const AT = '2026-09-30T00:00:01.000Z';
const h = (s) => sha256Hex(Buffer.from(s, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------------------------------
// Canonical states
// ------------------------------------------------------------------------------------------

function makeBinding() {
  return buildBindingRecord({
    validation: {
      ok: true,
      record: { path: 'docs/prompts/g2-nrdb-test.md', sha256: h('record'), id: 'nrdb-test-0001' },
      digests: { headSha: h('head').slice(0, 40), procedureSha256: h('procedure'), harnessSha256: h('harness'), urnASha256: h(MODEL_A_URN), urnBSha256: h(MODEL_B_URN) },
    },
    attemptId: randomUUID(),
  });
}

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
function journalWith(binding, states) {
  return { ...binding, transitions: states.map((state, i) => ({ state, at: new Date(T0 + i * 1000).toISOString(), monotonicMs: i * 1000, ...(state === JOURNAL_STATE.CLOSEOUT_STARTED ? { detail: { primaryOverall: 'PASS', primaryRow: 8 } } : {}) })) };
}

/** An all-PASS state (OPEN gate) prepared for one evaluation phase. */
function baseState(phase = 'pre-closeout', binding = makeBinding()) {
  const s = createOfflineRunStateFixture({ binding });
  if (phase === 'pre-closeout') s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']);
  else {
    s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
    const bytes = serializeJson(s.journal);
    s.closeoutFacts = { closeoutStartedVerified: true, r1Verified: true, r2Verified: true, r3Verified: true, kcVerified: true, snapshotEqual: true, quiescenceComplete: true, closeoutFailures: [], journalBytes: bytes, kcJournalSha256: sha256Hex(bytes) };
  }
  return s;
}

const BLOCK_DETAIL = Object.freeze([{ cause: 'classifier', model: 'B', observed: 'CONTRADICTORY' }]);
const TIMEOUT_DETAIL = Object.freeze([{ cause: 'load-deadline', model: 'B', observed: 'timed-out' }]);
const detailFor = (reason) => clone(reason === 'timeout:load' ? TIMEOUT_DETAIL : BLOCK_DETAIL);

function depBlockedBy(reason = 'prerequisite') {
  return { check: 'C1', blockingState: 'BLOCKED', reason, phaseSeq: 1, blockedAt: AT, evidenceRef: '/checks/C1', failedBeforeDependentStarted: true, detail: detailFor(reason) };
}

function notStartedEr(n, terminalState, terminalSeq) {
  return { controlId: n, phase: CONTROL_OWNING_PHASE[n], dependencyIds: [...CONTROL_DEPENDENCY_IDS[n]], started: false, crossedStartBoundary: false, startSeq: null, startedAt: null, terminalSeq, terminalAt: AT, terminalState, result: null, evidenceRefs: [] };
}

/**
 * Closes the C1 gate on `s`. kind: 'cdb' (C1 BLOCKED(prerequisite|timeout:load) => CLOSED_DEPENDENCY_
 * BLOCKED) or 'other' (C1 FAIL => CLOSED_OTHER). Writes the exact gate, the check-finalized event,
 * the cleanup marker and one gate-disposition record per C2..C20, N1..N8 (G-a..G-f hold).
 */
function closeGate(s, kind = 'cdb', reason = 'prerequisite') {
  const cdb = kind === 'cdb';
  const outcome = cdb ? GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED : GATE_OUTCOME.CLOSED_OTHER;
  s.checks.C1 = cdb
    ? { recordType: 'check-run', verdict: 'BLOCKED', reason, fields: { blockDetail: detailFor(reason) }, evidence: {}, finalizedSeq: 1, finalizedAt: AT }
    : { recordType: 'check-run', verdict: 'FAIL', reason: 'harness-exception', fields: {}, evidence: {}, finalizedSeq: 1, finalizedAt: AT };
  if (cdb) s.classifier.B = 'CONTRADICTORY';
  s.eventLog = [{ seq: 1, kind: 'check-finalized', check: 'C1', verdict: s.checks.C1.verdict, reason: s.checks.C1.reason, phase: 'P1', activeCheck: 'C1', activeControl: null }];
  s.gates = { C1: { gateSeq: 2, gateAt: AT, c1Verdict: s.checks.C1.verdict, c1Reason: s.checks.C1.reason, c1FinalizedSeq: 1, fatalCountAtGate: 0, outcome, notStarted: [...DOWNSTREAM_ITEM_NAMES] } };
  s.errorLedger.markers = [{ name: 'cleanup', seq: 100 }];
  DOWNSTREAM_ITEM_NAMES.forEach((id, i) => {
    const isCheck = id.startsWith('C');
    const disposition = isCheck ? GATE_CHECK_DISPOSITION : GATE_CONTROL_DISPOSITION[outcome][id];
    const dispositionSeq = 3 + i;
    const rec = {
      recordType: 'gate-disposition', itemId: id, itemKind: isCheck ? 'check' : 'control', synthetic: true, gateGenerated: true, executed: false,
      gateOutcome: outcome, blockingReason: cdb ? reason : 'closed-other', disposition, dispositionSeq, dispositionAt: AT, startSeq: null, startedAt: null,
      executionRecord: isCheck ? null : notStartedEr(id, disposition, dispositionSeq),
      dependencyBlockedBy: cdb && (isCheck || disposition === NRDB_STATE) ? depBlockedBy(reason) : null,
      evidenceRefs: [...GATE_EVIDENCE_REFS],
    };
    if (isCheck) s.checks[id] = rec; else s.controls[id] = rec;
  });
  return s;
}

function x4State(phase = 'pre-closeout') { return closeGate(baseState(phase), 'cdb'); }
function evalBoth(mutate) {
  return OVERALL_PHASES.map((p) => { const s = closeGate(baseState(p), 'cdb'); mutate(s); return computeOverall(s, p); });
}

// ------------------------------------------------------------------------------------------
// Dependency table (item 17)
// ------------------------------------------------------------------------------------------

test('control dependency ids: exact §7 rows (N7=[C1,C16], N8=[C1,C4,C7,C8]; C20 not in N8), ascending, C1 first, acyclic with the check graph', () => {
  assert.deepEqual(clone(CONTROL_DEPENDENCY_IDS), {
    N1: ['C1'], N2: ['C1', 'C4'], N3: ['C1'], N4: ['C1', 'C9', 'C10'], N5: ['C1', 'C9'], N6: ['C1', 'C4'], N7: ['C1', 'C16'], N8: ['C1', 'C4', 'C7', 'C8'],
  });
  const num = (id) => Number(id.slice(1));
  for (const [n, deps] of Object.entries(CONTROL_DEPENDENCY_IDS)) {
    assert.equal(deps[0], 'C1', n);
    for (let i = 1; i < deps.length; i += 1) assert.ok(num(deps[i - 1]) < num(deps[i]), `${n} ascending`);
    assert.ok(Object.isFrozen(deps), n);
  }
  assert.ok(!CONTROL_DEPENDENCY_IDS.N8.includes('C20'));
  // combined graph: control -> its dependencyIds; check -> C1 + CHECK_DEPENDENCIES (which include N1/N2/N8)
  const edges = {};
  for (const [n, deps] of Object.entries(CONTROL_DEPENDENCY_IDS)) edges[n] = [...deps];
  for (const c of CHECK_NAMES) edges[c] = c === 'C1' ? [] : ['C1', ...(CHECK_DEPENDENCIES[c] || [])];
  const state = {};
  const visit = (v, stack) => {
    if (state[v] === 'done') return;
    assert.notEqual(state[v], 'active', `cycle through ${[...stack, v].join(' -> ')}`);
    state[v] = 'active';
    for (const w of edges[v] || []) visit(w, [...stack, v]);
    state[v] = 'done';
  };
  for (const v of Object.keys(edges)) visit(v, []);
  // the would-be cycle the table avoids
  assert.ok(CHECK_DEPENDENCIES.C20.includes('N8'));
});

test('executionRecord.phase is each control\'s owning §5 phase (drift-checked against PHASE_ORDER)', () => {
  for (const n of CONTROL_NAMES) assert.equal(CONTROL_OWNING_PHASE[n], PHASE_ORDER.find((p) => p.controls.includes(n)).id, n);
});

// ------------------------------------------------------------------------------------------
// Effective state, check-run records, executionRecord (items 3, 15, 23)
// ------------------------------------------------------------------------------------------

test('effective-state accessor: control-run -> state, gate-disposition -> disposition, anything else -> null', () => {
  assert.equal(controlEffectiveState({ recordType: 'control-run', state: 'DETECTED' }), 'DETECTED');
  assert.equal(controlEffectiveState({ recordType: 'gate-disposition', disposition: NRDB_STATE, state: 'DETECTED' }), NRDB_STATE);
  for (const bad of [{ state: 'DETECTED' }, { recordType: 'check-run', state: 'DETECTED' }, null, 'DETECTED', { recordType: 'gate-disposition' }]) assert.equal(controlEffectiveState(bad), null);
});

test('check-run record: bare verdict + reason; BLOCKED(x) is notation only; finalizeC1Record adds the single check-finalized event', () => {
  const r = makeCheckRecord({ verdict: 'BLOCKED', reason: 'timeout:present' });
  assert.deepEqual(Object.keys(r), ['recordType', 'verdict', 'reason', 'fields', 'evidence']);
  assert.deepEqual([r.recordType, r.verdict, r.reason], ['check-run', 'BLOCKED', 'timeout:present']);
  const c1 = evaluateC1({ A: { loaded: false, loadStatus: 'timed-out' }, B: { loaded: false }, loadedCount: 0 });
  const { record, event } = finalizeC1Record(c1, { seq: 7, at: AT });
  assert.deepEqual(event, { seq: 7, kind: 'check-finalized', check: 'C1', verdict: 'BLOCKED', reason: 'timeout:load', phase: 'P1', activeCheck: 'C1', activeControl: null });
  assert.deepEqual([record.finalizedSeq, record.finalizedAt], [7, AT]);
  assert.ok(Object.isFrozen(record));
  assert.throws(() => finalizeC1Record(record, { seq: 8, at: AT }), /already finalized/);
  assert.throws(() => finalizeC1Record(c1, { seq: -1, at: AT }), TypeError);
  assert.throws(() => finalizeC1Record(c1, { seq: 1, at: '2026-09-30T00:00:01Z' }), TypeError); // no milliseconds
});

test('executionRecord: exactly two legal shapes; every other combination is rejected; terminalState must equal the EFFECTIVE state', () => {
  const started = { controlId: 'N3', phase: 'P5a', dependencyIds: ['C1'], started: true, crossedStartBoundary: true, startSeq: 5, startedAt: AT, terminalSeq: 9, terminalAt: AT, terminalState: 'DETECTED_RESTORED', result: { a: 1 }, evidenceRefs: ['/controls/N3/fields'] };
  assert.deepEqual(executionRecordProblems('N3', started, { recordType: 'control-run', effectiveState: 'DETECTED_RESTORED' }), []);
  const ns = notStartedEr('N3', 'NOT_EXECUTABLE', 4);
  assert.deepEqual(executionRecordProblems('N3', ns, { recordType: 'control-run', effectiveState: 'NOT_EXECUTABLE' }), []);
  assert.deepEqual(executionRecordProblems('N3', notStartedEr('N3', NRDB_STATE, 4), { recordType: 'gate-disposition', effectiveState: NRDB_STATE }), []);
  const bad = [
    ['started:false with startSeq', { ...ns, startSeq: 3 }, 'control-run', 'NOT_EXECUTABLE'],
    ['crossed != started', { ...ns, crossedStartBoundary: true }, 'control-run', 'NOT_EXECUTABLE'],
    ['NRDB started', { ...started, terminalState: NRDB_STATE }, 'gate-disposition', NRDB_STATE],
    ['NRDB in control-run', notStartedEr('N3', NRDB_STATE, 4), 'control-run', NRDB_STATE],
    ['started in gate-disposition', started, 'gate-disposition', 'DETECTED_RESTORED'],
    ['startSeq >= terminalSeq', { ...started, startSeq: 9 }, 'control-run', 'DETECTED_RESTORED'],
    ['started without evidenceRefs', { ...started, evidenceRefs: [] }, 'control-run', 'DETECTED_RESTORED'],
    ['started result null', { ...started, result: null }, 'control-run', 'DETECTED_RESTORED'],
    ['not-started with result', { ...ns, result: {} }, 'control-run', 'NOT_EXECUTABLE'],
    ['not-started NOT_DETECTED for N3', notStartedEr('N3', 'NOT_DETECTED', 4), 'control-run', 'NOT_DETECTED'],
    ['terminalState != effective state', ns, 'control-run', 'DETECTED_RESTORED'],
    ['wrong phase', { ...ns, phase: 'P2' }, 'control-run', 'NOT_EXECUTABLE'],
    ['wrong dependencyIds', { ...ns, dependencyIds: ['C1', 'C4'] }, 'control-run', 'NOT_EXECUTABLE'],
    ['wrong controlId', { ...ns, controlId: 'N4' }, 'control-run', 'NOT_EXECUTABLE'],
    ['unknown key', { ...ns, extra: 1 }, 'control-run', 'NOT_EXECUTABLE'],
    ['missing key', (() => { const x = { ...ns }; delete x.result; return x; })(), 'control-run', 'NOT_EXECUTABLE'],
    ['timestamp without ms', { ...ns, terminalAt: '2026-09-30T00:00:01Z' }, 'control-run', 'NOT_EXECUTABLE'],
    ['evidenceRefs not JSON pointers', { ...started, evidenceRefs: ['controls/N3'] }, 'control-run', 'DETECTED_RESTORED'],
  ];
  for (const [label, er, recordType, eff] of bad) assert.notDeepEqual(executionRecordProblems('N3', er, { recordType, effectiveState: eff }), [], label);
});

test('control-run records from makeControlRunRecord: started/not-started shapes validate; a missing start boundary fails closed to not-started', () => {
  for (const n of CONTROL_NAMES) {
    const st = makeControlRunRecord(n, makeControlRecord(n, CONTROL_ACCEPTABLE_STATE[n]), { start: { startSeq: 3, startedAt: AT }, terminalSeq: 4, terminalAt: AT });
    assert.deepEqual(validateControlRunRecord(n, st).errors, [], n);
    // an executed state without a recorded start boundary can never be reported as executed
    const noStart = makeControlRunRecord(n, makeControlRecord(n, CONTROL_ACCEPTABLE_STATE[n]), { start: null, terminalSeq: 4, terminalAt: AT });
    assert.deepEqual(validateControlRunRecord(n, noStart).errors, [], n);
    assert.equal(noStart.executionRecord.started, false, n);
    assert.ok(CONTROL_NOT_STARTED_STATES[n].includes(noStart.state) && noStart.state !== NRDB_STATE, n);
    assert.equal(noStart.fields.reason, 'start-boundary-not-recorded', n);
  }
  // NRDB never in a control-run (schema) -- and never a control outcome
  assert.throws(() => makeControlRecord('N3', NRDB_STATE), TypeError);
  const forged = makeControlRunRecord('N3', makeControlRecord('N3', 'NOT_EXECUTABLE'), { start: null, terminalSeq: 4, terminalAt: AT });
  forged.state = NRDB_STATE; forged.executionRecord.terminalState = NRDB_STATE;
  assert.ok(validateControlRunRecord('N3', forged).errors.includes('nrdb-in-control-run'));
});

// ------------------------------------------------------------------------------------------
// dependencyBlockedBy (items 3, 16)
// ------------------------------------------------------------------------------------------

test('dependencyBlockedBy: exact keys/types; L3 referential constraints against C1, its single check-finalized event and the gate', () => {
  assert.deepEqual(dependencyBlockedByShapeProblems(depBlockedBy()), []);
  for (const [label, mut] of [
    ['unknown key', (d) => { d.extra = 1; }], ['missing key', (d) => { delete d.detail; }], ['check', (d) => { d.check = 'C4'; }],
    ['blockingState', (d) => { d.blockingState = 'FAIL'; }], ['detailed reason', (d) => { d.reason = 'prerequisite:model-not-loaded:B'; }],
    ['phaseSeq', (d) => { d.phaseSeq = '1'; }], ['blockedAt', (d) => { d.blockedAt = 'x'; }], ['evidenceRef', (d) => { d.evidenceRef = '/gates/C1'; }],
    ['failedBeforeDependentStarted type', (d) => { d.failedBeforeDependentStarted = 'yes'; }],
  ]) { const d = depBlockedBy(); mut(d); assert.notDeepEqual(dependencyBlockedByShapeProblems(d), [], label); }
  const s = x4State();
  assert.deepEqual(dependencyBlockedByReferentialProblems(s.controls.N3.dependencyBlockedBy, s, s.controls.N3), []);
  for (const [label, mut] of [
    ['phaseSeq = P1 marker/gateSeq', (d) => { d.phaseSeq = 2; }],
    ['failedBeforeDependentStarted false', (d) => { d.failedBeforeDependentStarted = false; }],
    ['reason != C1', (d) => { d.reason = 'timeout:load'; }],
    ['blockedAt != finalizedAt', (d) => { d.blockedAt = '2026-09-30T00:00:02.000Z'; }],
    ['detail != blockDetail', (d) => { d.detail = []; }],
  ]) { const d = clone(s.controls.N3.dependencyBlockedBy); mut(d); assert.notDeepEqual(dependencyBlockedByReferentialProblems(d, s, s.controls.N3), [], label); }
  // two check-finalized events for C1 => the single-event reference fails
  const s2 = x4State();
  s2.eventLog.push({ ...s2.eventLog[0], seq: 1 });
  assert.notDeepEqual(dependencyBlockedByReferentialProblems(s2.controls.N3.dependencyBlockedBy, s2, s2.controls.N3), []);
});

// ------------------------------------------------------------------------------------------
// Global C1 gate equations (validator side; runtime emission is slice B2)
// ------------------------------------------------------------------------------------------

test('gate outcome rule (recomputed): OPEN iff C1 PASS and no pre-gate fatal; CDB iff BLOCKED with a normalized reason and no fatal; else CLOSED_OTHER', () => {
  assert.equal(recomputeGateOutcome({ c1Verdict: 'PASS', c1Reason: null, fatalCountAtGate: 0 }), 'OPEN');
  assert.equal(recomputeGateOutcome({ c1Verdict: 'PASS', c1Reason: null, fatalCountAtGate: 1 }), 'CLOSED_OTHER');
  for (const r of C1_NORMALIZED_REASONS) assert.equal(recomputeGateOutcome({ c1Verdict: 'BLOCKED', c1Reason: r, fatalCountAtGate: 0 }), 'CLOSED_DEPENDENCY_BLOCKED');
  assert.equal(recomputeGateOutcome({ c1Verdict: 'BLOCKED', c1Reason: 'prerequisite', fatalCountAtGate: 1 }), 'CLOSED_OTHER');
  for (const r of ['harness-exception', 'prerequisite:model-not-loaded:B', 'timeout:present', null]) assert.equal(recomputeGateOutcome({ c1Verdict: 'BLOCKED', c1Reason: r, fatalCountAtGate: 0 }), 'CLOSED_OTHER', String(r));
  for (const v of ['FAIL', 'NOT_EVIDENCED']) assert.equal(recomputeGateOutcome({ c1Verdict: v, c1Reason: 'x', fatalCountAtGate: 0 }), 'CLOSED_OTHER');
});

test('gate equations: canonical OPEN and closed gates validate; each stored field is recomputed, never trusted', () => {
  assert.deepEqual(gateC1Problems(baseState()).problems, []);
  assert.deepEqual(gateC1Problems(x4State()).problems, []);
  assert.deepEqual(gateC1Problems(closeGate(baseState(), 'other')).problems, []);
  const cases = [
    ['c1Verdict != check', (s) => { s.gates.C1.c1Verdict = 'PASS'; }],
    ['c1Reason != check', (s) => { s.gates.C1.c1Reason = 'timeout:load'; }],
    ['c1FinalizedSeq != check', (s) => { s.gates.C1.c1FinalizedSeq = 0; }],
    ['outcome != recomputed', (s) => { s.gates.C1.outcome = 'OPEN'; }],
    ['notStarted != recomputed', (s) => { s.gates.C1.notStarted = s.gates.C1.notStarted.slice(1); }],
    ['c1FinalizedSeq not before gate', (s) => { s.gates.C1.gateSeq = 1; }],
    ['fatalCountAtGate != recomputed (sequenced ledger)', (s) => { s.gates.C1.fatalCountAtGate = 1; }],
    ['pre-gate fatal entry => outcome must be CLOSED_OTHER', (s) => { s.errorLedger.entries = [{ kind: 'pageerror', detail: 'x', seq: 1 }]; s.errorLedger.fatalCount = 1; }],
    ['no check-finalized event', (s) => { s.eventLog = []; }],
    ['two check-finalized events', (s) => { s.eventLog.push({ ...s.eventLog[0] }); }],
    ['event verdict mismatch', (s) => { s.eventLog[0].verdict = 'PASS'; }],
    ['unknown gate key', (s) => { s.gates.C1.extra = 1; }],
    ['unknown gates key', (s) => { s.gates.C2 = {}; }],
    ['c1Verdict out of enum', (s) => { s.gates.C1.c1Verdict = 'BLOCKED(prerequisite)'; s.checks.C1.verdict = 'BLOCKED(prerequisite)'; }],
  ];
  for (const [label, mut] of cases) { const s = x4State(); mut(s); assert.notDeepEqual(gateC1Problems(s).problems, [], label); }
  // a post-gate fatal entry does not count towards fatalCountAtGate
  const post = x4State(); post.errorLedger.entries = [{ kind: 'pageerror', detail: 'x', seq: 50 }]; post.errorLedger.fatalCount = 1;
  assert.deepEqual(gateC1Problems(post).problems, []);
});

test('fatalCountAtGate recomputation interface: network entries count through exactly one witness (seq = witnessSeq); an unsequenced entry is a contradiction since slice C1', () => {
  assert.equal(FATAL_ENTRY_SEQ_REQUIRED, true);
  assert.deepEqual(recomputeFatalCountAtGate({ entries: [{ kind: 'pageerror', seq: 1 }, { kind: 'pageerror', seq: 9 }] }, 5), { count: 1, problems: [] });
  const w = { entries: [{ kind: 'required-resource-failure', seq: 3, witnessId: 'w1' }], fatalWitnesses: [{ witnessId: 'w1', witnessSeq: 3 }] };
  assert.deepEqual(recomputeFatalCountAtGate(w, 5), { count: 1, problems: [] });
  assert.ok(recomputeFatalCountAtGate({ ...w, fatalWitnesses: [{ witnessId: 'w1', witnessSeq: 4 }] }, 5).problems.includes('fatal-entry-witness-mismatch'));
  assert.ok(recomputeFatalCountAtGate({ ...w, fatalWitnesses: [] }, 5).problems.includes('fatal-entry-witness-mismatch'));
  assert.deepEqual(recomputeFatalCountAtGate({ entries: [{ kind: 'pageerror' }] }, 5), { count: null, problems: ['fatal-entry-unsequenced'] });
  assert.deepEqual(recomputeFatalCountAtGate({}, 5).problems, ['fatal-entries-missing']);
});

test('integration boundary: GATE_C1_REQUIRED is true since slice B2 (a state without gates.C1 is a row-5 contradiction); LIVE_PATH_WIRED is declared exactly once', () => {
  assert.equal(GATE_C1_REQUIRED, true);
  // Not a pin: only that the declaration is single and unambiguous (helper throws otherwise). The real value is pinned once, in live-path-isolation.test.mjs.
  livePathWiredDeclaration(HARNESS_SOURCE);
  const s = baseState(); s.gates = null;
  assert.ok(recordSchemaProblems(s).includes('gates-missing'));
  assert.deepEqual([computeOverall(s, 'pre-closeout').overall, computeOverall(s, 'pre-closeout').row], ['FAIL', 5]);
  // C1 without its finalization fields is rejected once the gate is required
  const u = baseState(); delete u.checks.C1.finalizedSeq; delete u.checks.C1.finalizedAt;
  assert.ok(recordSchemaProblems(u).some((p) => p.startsWith('checks.C1:')));
  // ... and without a gate no gate-disposition record and no NRDB can be legal
  const t = x4State(); t.gates = null;
  assert.ok(recordSchemaProblems(t).some((p) => p.endsWith('gate-disposition-without-closed-gate')));
  assert.equal(nrdbLegality('N3', t).legal, false);
});

// ------------------------------------------------------------------------------------------
// Gate-disposition records: G-a..G-f, verdict key, executed:true, run record under a closed gate,
// disposition under an OPEN gate (items 15, 19)
// ------------------------------------------------------------------------------------------

test('gate-disposition: the canonical CDB and CLOSED_OTHER populations validate (record unions + G-a..G-f + equations)', () => {
  assert.deepEqual(recordSchemaProblems(x4State()), []);
  assert.deepEqual(recordSchemaProblems(closeGate(baseState(), 'cdb', 'timeout:load')), []);
  assert.deepEqual(recordSchemaProblems(closeGate(baseState(), 'other')), []);
  assert.deepEqual(recordSchemaProblems(baseState()), []);
});

const G_VIOLATIONS = [
  ['verdict key', 'C7', (r) => { r.verdict = 'BLOCKED'; }, 'gate-disposition-has-verdict'],
  ['state key', 'N3', (r) => { r.state = NRDB_STATE; }, 'gate-disposition-has-state'],
  ['executed:true', 'C7', (r) => { r.executed = true; }, 'executed'],
  ['synthetic:false', 'C7', (r) => { r.synthetic = false; }, 'synthetic'],
  ['gateGenerated:false', 'C7', (r) => { r.gateGenerated = false; }, 'gateGenerated'],
  ['non-null startSeq', 'N3', (r) => { r.startSeq = 4; }, 'start-fields-not-null'],
  ['non-null startedAt', 'C9', (r) => { r.startedAt = AT; }, 'start-fields-not-null'],
  ['unknown key', 'C9', (r) => { r.extra = 1; }, 'keys'],
  ['itemKind inconsistent', 'C9', (r) => { r.itemKind = 'control'; }, 'itemKind'],
  ['itemId != key', 'C9', (r) => { r.itemId = 'C10'; }, 'itemId'],
  ['G-a gateOutcome', 'C9', (r) => { r.gateOutcome = 'CLOSED_OTHER'; }, 'G-a:gateOutcome'],
  ['G-a blockingReason != C1 reason', 'C9', (r) => { r.blockingReason = 'timeout:load'; }, 'G-a:blockingReason'],
  ['G-b check disposition', 'C9', (r) => { r.disposition = 'BLOCKED'; }, 'G-b:disposition'],
  ['G-b control disposition (X20)', 'N3', (r) => { r.disposition = 'NOT_EXECUTABLE'; r.executionRecord.terminalState = 'NOT_EXECUTABLE'; r.dependencyBlockedBy = null; }, 'G-b:disposition'],
  ['G-c missing dependencyBlockedBy', 'C9', (r) => { r.dependencyBlockedBy = null; }, 'G-c:dependency-blocked-by.not-object'],
  ['G-c N6 with dependencyBlockedBy', 'N6', (r) => { r.dependencyBlockedBy = depBlockedBy(); }, 'G-c:dependencyBlockedBy-not-null'],
  ['G-d check executionRecord', 'C9', (r) => { r.executionRecord = notStartedEr('N1', 'NOT_DETECTED', r.dispositionSeq); }, 'G-d:executionRecord-not-null'],
  ['G-d terminalSeq != dispositionSeq', 'N3', (r) => { r.executionRecord.terminalSeq += 1; }, 'G-d:terminalSeq-ne-dispositionSeq'],
  ['G-d started executionRecord (X24)', 'N3', (r) => { Object.assign(r.executionRecord, { started: true, crossedStartBoundary: true, startSeq: 2, startedAt: AT, result: {}, evidenceRefs: ['/controls/N3'] }); }, 'G-d:executionRecord-started'],
  ['G-e dispositionSeq <= gateSeq', 'C2', (r) => { r.dispositionSeq = 2; }, 'G-e:dispositionSeq-not-after-gate'],
  ['G-e dispositionSeq >= cleanup', 'N8', (r) => { r.dispositionSeq = 100; r.executionRecord.terminalSeq = 100; }, 'G-e:dispositionSeq-not-before-cleanup'],
  ['G-f evidenceRefs', 'C7', (r) => { r.evidenceRefs = ['/gates/C1', '/checks/C7']; }, 'G-f:evidenceRefs'],
];

test('gate-disposition: every G-a..G-f / shape violation is rejected with its specific problem (row 5)', () => {
  for (const [label, id, mut, problem] of G_VIOLATIONS) {
    const s = x4State();
    mut(id.startsWith('C') ? s.checks[id] : s.controls[id]);
    const ps = recordSchemaProblems(s);
    const kind = id.startsWith('C') ? 'checks' : 'controls';
    assert.ok(ps.includes(`${kind}.${id}:${problem}`), `${label}: ${JSON.stringify(ps)}`);
  }
  // G-e strict order C2..C20, N1..N8
  const s = x4State();
  [s.checks.C3.dispositionSeq, s.checks.C4.dispositionSeq] = [s.checks.C4.dispositionSeq, s.checks.C3.dispositionSeq];
  assert.ok(recordSchemaProblems(s).includes('G-e:dispositionSeq-not-strictly-increasing'));
  // G-e requires the cleanup marker
  const s2 = x4State(); s2.errorLedger.markers = [];
  assert.ok(recordSchemaProblems(s2).includes('checks.C2:G-e:cleanup-marker-missing'));
  // G-f attribution half: runtime evidence attributed to the item (e.g. a raw network event with activeCheck C7)
  const s3 = x4State(); s3.errorLedger.requestObservations = [{ seq: 5, phase: 'P1', activeCheck: 'C7' }];
  assert.ok(recordSchemaProblems(s3).includes('checks.C7:G-f:attributed-record:errorLedger.requestObservations:C7'));
});

test('run records under a closed gate, dispositions under an OPEN gate, a C1 disposition and the legacy BLOCKED(dependency:C1) encoding are all rejected', () => {
  const s = x4State(); s.checks.C7 = makeCheckRecord({ verdict: 'BLOCKED', reason: 'dependency:C1' });
  const ps = recordSchemaProblems(s);
  assert.ok(ps.includes('checks.C7:run-record-under-closed-gate'));
  assert.ok(ps.includes('checks.C7:legacy-dependency-c1-encoding'));
  const s2 = x4State(); s2.controls.N4 = makeControlRunRecord('N4', makeControlRecord('N4', 'DETECTED_RESTORED'), { start: { startSeq: 30, startedAt: AT }, terminalSeq: 31, terminalAt: AT });
  assert.ok(recordSchemaProblems(s2).includes('controls.N4:run-record-under-closed-gate'));
  const s3 = baseState(); s3.checks.C7 = clone(x4State().checks.C7);
  assert.ok(recordSchemaProblems(s3).includes('checks.C7:gate-disposition-without-closed-gate'));
  const s4 = x4State(); s4.checks.C1 = { ...s4.checks.C2, itemId: 'C1' };
  assert.ok(recordSchemaProblems(s4).includes('checks.C1:record-type'));
  const s5 = baseState(); s5.checks.C9 = makeCheckRecord({ verdict: 'BLOCKED', reason: 'dependency:C1,C4' });
  assert.ok(recordSchemaProblems(s5).includes('checks.C9:legacy-dependency-c1-encoding'));
  // missing / unknown recordType
  const s6 = baseState(); delete s6.checks.C5.recordType; delete s6.controls.N2.recordType;
  assert.ok(recordSchemaProblems(s6).includes('checks.C5:record-type') && recordSchemaProblems(s6).includes('controls.N2:record-type'));
  // validateResultSchema shares the same union validation and knows the `gates` key
  const payload = { checks: x4State().checks, controls: x4State().controls };
  assert.ok(validateResultSchema(payload, 'payload').errors.some((e) => e === 'missing-key:gates'));
});

// ------------------------------------------------------------------------------------------
// NRDB legality L1-L4 (items 3, 16, 22)
// ------------------------------------------------------------------------------------------

test('NRDB legality is exactly L1-L4: legal for N1-N5/N7 in the canonical CDB state, each L-rule failure detected, never for N6/N8', () => {
  const s = x4State();
  for (const n of NRDB_CONTROL_NAMES) assert.deepEqual(nrdbLegality(n, s), { legal: true, failed: [], problems: [] }, n);
  for (const n of ['N6', 'N8']) assert.equal(nrdbLegality(n, s).legal, false, n);
  const cases = [
    ['L1 C1 PASS', 'L1', (x) => { x.checks.C1.verdict = 'PASS'; x.checks.C1.reason = null; }],
    ['L1 detailed reason (X25)', 'L1', (x) => { x.checks.C1.reason = 'prerequisite:model-not-loaded:B'; }],
    ['L1 other BLOCKED cause', 'L1', (x) => { x.checks.C1.reason = 'harness-exception'; }],
    ['L2 control-run record (X21)', 'L2', (x) => { x.controls.N3 = { ...makeControlRunRecord('N3', makeControlRecord('N3', 'NOT_EXECUTABLE'), { start: null, terminalSeq: 30, terminalAt: AT }), state: NRDB_STATE }; }],
    ['L2 started (X24)', 'L2', (x) => { Object.assign(x.controls.N3.executionRecord, { started: true, crossedStartBoundary: true, startSeq: 2, startedAt: AT, result: {}, evidenceRefs: ['/controls/N3'] }); }],
    ['L2 attributed spy record', 'L2', (x) => { x.spyLedger = [{ seq: 5, phase: 'P1', activeCheck: null, activeControl: 'N3' }]; }],
    ['L3 phaseSeq (X26)', 'L3', (x) => { x.controls.N3.dependencyBlockedBy.phaseSeq = 2; }],
    ['L3 failedBeforeDependentStarted false (X26)', 'L3', (x) => { x.controls.N3.dependencyBlockedBy.failedBeforeDependentStarted = false; }],
    ['L3 missing', 'L3', (x) => { x.controls.N3.dependencyBlockedBy = null; }],
    ['L4 not in notStarted (X26)', 'L4', (x) => { x.gates.C1.notStarted = x.gates.C1.notStarted.filter((i) => i !== 'N3'); }],
    ['L4 gate CLOSED_OTHER', 'L4', (x) => { x.gates.C1.outcome = 'CLOSED_OTHER'; }],
    ['L4 terminalSeq not after gate', 'L4', (x) => { x.controls.N3.executionRecord.terminalSeq = 2; }],
  ];
  for (const [label, rule, mut] of cases) {
    const x = x4State(); mut(x);
    const r = nrdbLegality('N3', x);
    assert.equal(r.legal, false, label);
    assert.ok(r.failed.includes(rule), `${label}: ${JSON.stringify(r)}`);
  }
});

test('NRDB legality is a pure function of its inputs and does not read verdict-precedence facts (rows 1-3)', () => {
  const s = x4State();
  const before = JSON.stringify(s);
  s.errorLedger.fatalCount = 3; s.cleanupUnresolvedOwnership = true;
  assert.equal(nrdbLegality('N3', s).legal, true); // rows 1/2 are precedence, not legality
  assert.equal(JSON.stringify({ ...s, errorLedger: { ...s.errorLedger, fatalCount: 0 }, cleanupUnresolvedOwnership: false }), before);
  // the legality result feeds controlDisposition as 'neutral'
  const bases = Object.fromEntries(CHECK_NAMES.map((n) => [n, checkVerdictBase(s.checks[n])]));
  assert.equal(controlDisposition('N3', s.controls.N3, bases, s), 'neutral');
  assert.equal(controlDisposition('N6', s.controls.N6, bases, s), 'partial'); // NOT_APPLICABLE, C4 has no PASS check-run
  for (const n of CHECK_NAMES.slice(1)) assert.equal(bases[n], null, `${n}: a gate-disposition has no verdict`);
});

// ------------------------------------------------------------------------------------------
// §8 worked examples X4, X20-X29 (item 6)
// ------------------------------------------------------------------------------------------

test('X4: C1 BLOCKED(prerequisite) => CLOSED_DEPENDENCY_BLOCKED, synthetic gate-dispositions, legal NRDB => rows 1-5 no match, row 6 BLOCKED', () => {
  for (const p of OVERALL_PHASES) {
    const rows = evaluateOverallRows(x4State(p), p);
    assert.deepEqual(rows.slice(0, 5).map((r) => r.match), [false, false, false, false, false], p);
    const x = computeOverall(x4State(p), p);
    assert.deepEqual([x.overall, x.row], ['BLOCKED', 6], p);
    assert.ok(x.reasons.includes('gate-closed-dependency-blocked:C1'));
    // a gate-disposition is never counted as a runtime BLOCKED check verdict
    assert.ok(!x.reasons.some((r) => /^check-blocked:C(?!1$)/.test(r)), JSON.stringify(x.reasons));
  }
  // the timeout:load variant behaves identically
  const t = closeGate(baseState(), 'cdb', 'timeout:load');
  assert.deepEqual([computeOverall(t, 'pre-closeout').overall, computeOverall(t, 'pre-closeout').row], ['BLOCKED', 6]);
});

test('X20: as X4 but N3 NOT_EXECUTABLE (G-b), N3 NRDB in a control-run, or N3 NRDB with a non-exact executionRecord => row 4 FAIL', () => {
  const variants = [
    (s) => { Object.assign(s.controls.N3, { disposition: 'NOT_EXECUTABLE', dependencyBlockedBy: null }); s.controls.N3.executionRecord.terminalState = 'NOT_EXECUTABLE'; },
    (s) => { s.controls.N3 = { ...makeControlRunRecord('N3', makeControlRecord('N3', 'NOT_EXECUTABLE'), { start: null, terminalSeq: 30, terminalAt: AT }), state: NRDB_STATE, dependencyBlockedBy: depBlockedBy() }; s.controls.N3.executionRecord.terminalState = NRDB_STATE; },
    (s) => { s.controls.N3.executionRecord.evidenceRefs = ['/controls/N3']; },
  ];
  for (const v of variants) for (const x of evalBoth(v)) assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
});

test('X21: C1 PASS (gate OPEN) and N3 NRDB in a control-run => row 4; as a gate-disposition under OPEN it is also a row-5 contradiction', () => {
  for (const p of OVERALL_PHASES) {
    const s = baseState(p);
    s.controls.N3 = { ...s.controls.N3, state: NRDB_STATE };
    s.controls.N3.executionRecord = { ...s.controls.N3.executionRecord, terminalState: NRDB_STATE };
    const x = computeOverall(s, p);
    assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
    const s2 = baseState(p); s2.controls.N3 = clone(x4State(p).controls.N3);
    const rows = evaluateOverallRows(s2, p);
    assert.equal(rows[3].match, true);
    assert.ok(rows[4].reasons.includes('record-schema:controls.N3:gate-disposition-without-closed-gate'));
  }
});

test('X22: C1 PASS; mid-run timeout leaves C12 a check-run BLOCKED(timeout:present) and N4 unrun (control-run NOT_EXECUTABLE) => row 4 before row 6', () => {
  for (const p of OVERALL_PHASES) {
    const s = baseState(p);
    s.checks.C12 = makeCheckRecord({ verdict: 'BLOCKED', reason: 'timeout:present' });
    s.controls.N4 = makeControlRunRecord('N4', makeControlRecord('N4', 'NOT_EXECUTABLE', { fields: { reason: 'session-tainted:P7' } }), { start: null, terminalSeq: 40, terminalAt: AT });
    assert.deepEqual(recordSchemaProblems(s), []);
    const x = computeOverall(s, p);
    assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
    assert.ok(evaluateOverallRows(s, p)[5].reasons.includes('check-blocked:C12'));
  }
});

test('X23/X27: a pre-gate fatal witness (requestfailed, or HTTP 404/500 on a required resource) during the model-B load => CLOSED_OTHER gate => row 1 FAIL', () => {
  for (const kind of ['requestfailed', 'http-404', 'http-500']) {
    for (const p of OVERALL_PHASES) {
      const s = closeGate(baseState(p), 'cdb');
      // the gate is CLOSED_OTHER because of the pre-gate fatal witness (C1 itself is BLOCKED(prerequisite)):
      // a real raw event through the slice-C1 listener bodies (request observed at seq 0, failure at seq 1)
      const seqs = [0, 1];
      const ledger = s.errorLedger;
      const sink = createFatalEventSink(ledger, { nextSeq: () => seqs.shift() });
      const net = createNetworkInstrumentation({ ledger, nextSeq: () => seqs.shift(), sink, attribution: () => ({ phase: 'P1', activeCheck: 'C1' }) });
      const req = { url: () => 'https://cdn.derivative.invalid/B/0/0.svf', method: () => 'GET', resourceType: () => 'fetch', isNavigationRequest: () => false, failure: () => ({ errorText: 'net::ERR_FAILED' }) };
      net.onRequest(req);
      if (kind === 'requestfailed') net.onRequestFailed(req); else net.onResponse({ status: () => (kind === 'http-404' ? 404 : 500), request: () => req });
      assert.equal(ledger.fatalCount, 1);
      assert.deepEqual(ledger.entries.map((e) => [e.kind, e.seq]), [['required-resource-failure', 1]]);
      s.checks.C1.finalizedSeq = 2; s.checks.C1.finalizedAt = AT; s.eventLog[0].seq = 2;
      // re-sequence: witness 1, C1 finalized 2, gate 3, dispositions from 4
      s.gates.C1 = { ...s.gates.C1, c1FinalizedSeq: 2, gateSeq: 3 };
      s.gates.C1.fatalCountAtGate = 1;
      s.gates.C1.outcome = 'CLOSED_OTHER';
      DOWNSTREAM_ITEM_NAMES.forEach((id, i) => {
        const rec = id.startsWith('C') ? s.checks[id] : s.controls[id];
        const isCheck = id.startsWith('C');
        rec.gateOutcome = 'CLOSED_OTHER'; rec.blockingReason = 'closed-other'; rec.dependencyBlockedBy = null; rec.dispositionSeq = 4 + i;
        if (!isCheck) { rec.disposition = GATE_CONTROL_DISPOSITION.CLOSED_OTHER[id]; rec.executionRecord = notStartedEr(id, rec.disposition, 4 + i); }
      });
      assert.deepEqual(recordSchemaProblems(s), [], kind);
      const x = computeOverall(s, p);
      assert.deepEqual([x.overall, x.row], ['FAIL', 1], `${kind} ${p}`);
      // N1/N2 NOT_DETECTED and N3-N5/N7 NOT_EXECUTABLE under CLOSED_OTHER: row 4 also matches (never neutral)
      assert.equal(evaluateOverallRows(s, p)[3].match, true);
    }
  }
});

test('X24: as X4 but N3 NRDB with executionRecord.started:true (control-run or gate-disposition) => row 4 before rows 5/6', () => {
  const started = { started: true, crossedStartBoundary: true, startSeq: 2, startedAt: AT, result: {}, evidenceRefs: ['/controls/N3'] };
  const variants = [
    (s) => { Object.assign(s.controls.N3.executionRecord, started); },
    (s) => { s.controls.N3 = { ...makeControlRunRecord('N3', makeControlRecord('N3', 'NOT_DETECTED'), { start: { startSeq: 20, startedAt: AT }, terminalSeq: 21, terminalAt: AT }), state: NRDB_STATE }; s.controls.N3.executionRecord.terminalState = NRDB_STATE; },
  ];
  for (const v of variants) for (const x of evalBoth(v)) assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
});

test('X25: as X4 but C1 reason is the detailed prerequisite:model-not-loaded:B => L1 false => row 4 (and the gate would be CLOSED_OTHER: row 5 too)', () => {
  for (const p of OVERALL_PHASES) {
    const s = x4State(p);
    const detailed = 'prerequisite:model-not-loaded:B';
    s.checks.C1.reason = detailed; s.eventLog[0].reason = detailed; s.gates.C1.c1Reason = detailed;
    for (const n of NRDB_CONTROL_NAMES) s.controls[n].dependencyBlockedBy.reason = detailed;
    const rows = evaluateOverallRows(s, p);
    assert.equal(rows[3].match, true);
    assert.ok(rows[4].reasons.includes('record-schema:gates.C1.outcome-ne-recomputed'));
    assert.deepEqual([computeOverall(s, p).overall, computeOverall(s, p).row], ['FAIL', 4]);
  }
});

test('X26: as X4 but phaseSeq != finalizedSeq, failedBeforeDependentStarted:false, reason != C1 reason, or control absent from notStarted => row 4', () => {
  const variants = [
    (s) => { s.controls.N3.dependencyBlockedBy.phaseSeq = 2; },
    (s) => { s.controls.N3.dependencyBlockedBy.phaseSeq = 0; },
    (s) => { s.controls.N3.dependencyBlockedBy.failedBeforeDependentStarted = false; },
    (s) => { s.controls.N3.dependencyBlockedBy.reason = 'timeout:load'; },
    (s) => { s.gates.C1.notStarted = s.gates.C1.notStarted.filter((i) => i !== 'N3'); },
  ];
  for (const v of variants) for (const x of evalBoth(v)) assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
});

test('X28: the gate record contradicts its inputs / pre-RC1-C2 BLOCKED(dependency:C1) encoding / a missing disposition / prohibited downstream run record => row 5', () => {
  const variants = [
    ['gate says PASS/OPEN while C1 BLOCKED', (s) => { s.gates.C1.c1Verdict = 'PASS'; s.gates.C1.outcome = 'OPEN'; s.gates.C1.notStarted = []; }],
    ['fatalCountAtGate != recomputed', (s) => { s.gates.C1.fatalCountAtGate = 2; }],
    ['c1FinalizedSeq != finalizedSeq', (s) => { s.gates.C1.c1FinalizedSeq = 0; }],
    ['notStarted != recomputed', (s) => { s.gates.C1.notStarted = ['C2']; }],
    ['C9 check-run BLOCKED(dependency:C1)', (s) => { s.checks.C9 = makeCheckRecord({ verdict: 'BLOCKED', reason: 'dependency:C1' }); }],
    ['missing disposition', (s) => { delete s.checks.C14; }],
    ['started control with acceptable state beside a closed gate', (s) => { s.controls.N5 = makeControlRunRecord('N5', makeControlRecord('N5', 'DETECTED_RESTORED'), { start: { startSeq: 20, startedAt: AT }, terminalSeq: 21, terminalAt: AT }); }],
  ];
  for (const [label, v] of variants) {
    for (const p of OVERALL_PHASES) {
      const s = x4State(p); v(s);
      const rows = evaluateOverallRows(s, p);
      assert.equal(rows[4].match, true, label);
      const x = computeOverall(s, p);
      assert.equal(x.overall, 'FAIL', label);
      assert.ok(x.row <= 5, label);
      assert.notEqual(x.row, 6, label);
    }
  }
});

test('X29: gate-disposition misuse -- (a) a disposition beside an OPEN gate (row 8 unreachable, row 5 selected); (b) each disposition defect => row 5', () => {
  for (const p of OVERALL_PHASES) {
    const s = baseState(p);
    s.checks.C7 = clone(x4State(p).checks.C7);
    const rows = evaluateOverallRows(s, p);
    assert.equal(rows[7].match, false, 'row 8 unreachable while a gate-disposition exists');
    assert.deepEqual([computeOverall(s, p).overall, computeOverall(s, p).row], ['FAIL', 5]);
    for (const [label, id, mut] of G_VIOLATIONS) {
      if (id.startsWith('N') && ['G-b control disposition (X20)', 'G-d started executionRecord (X24)', 'state key'].includes(label)) continue; // row 4 cases covered by X20/X24
      const t = x4State(p);
      mut(id.startsWith('C') ? t.checks[id] : t.controls[id]);
      const x = computeOverall(t, p);
      assert.equal(x.overall, 'FAIL', label);
      assert.equal(evaluateOverallRows(t, p)[4].match, true, label);
    }
  }
});

// ------------------------------------------------------------------------------------------
// §8 offline matrix with a downstream record-type / control-state dimension (items 6, 19)
// ------------------------------------------------------------------------------------------

test('§8 matrix: {fatal} x {cleanup} x {downstream record type: run / CDB dispositions / CLOSED_OTHER dispositions / each G violation / misplaced records} x {check state} x {control state} x {journal} x {integrity} x {tainted}', () => {
  const binding = makeBinding();
  const gViolations = G_VIOLATIONS.map(([label]) => `g:${label}`);
  const dims = {
    fatal: [false, true],
    cleanup: ['clean', 'resolved', 'unresolved'],
    downstream: ['run', 'cdb', 'other', ...gViolations, 'open-with-disposition', 'closed-with-run-record'],
    checks: ['as-is', 'fail', 'blocked', 'not-evidenced'],
    controls: ['as-is', 'n1-not-detected', 'n2-not-discriminating'],
    journal: ['consistent', 'inconsistent'],
    integrity: ['VERIFIED', 'MISMATCH', 'CAPTURE_UNAVAILABLE'],
    tainted: [false, true],
  };
  const keys = Object.keys(dims);
  const G = Object.fromEntries(G_VIOLATIONS.map(([label, id, mut]) => [`g:${label}`, { id, mut }]));
  // violations on an NRDB control record that also break L2/L4 => row 4 precedes row 5
  const ROW4_G = ['g:G-b control disposition (X20)', 'g:G-d started executionRecord (X24)', 'g:G-d terminalSeq != dispositionSeq'];
  const build = (c, phase) => {
    const s = baseState(phase, binding);
    const closed = c.downstream !== 'run' && c.downstream !== 'open-with-disposition';
    if (closed) closeGate(s, c.downstream === 'other' ? 'other' : 'cdb');
    if (G[c.downstream]) { const { id, mut } = G[c.downstream]; mut(id.startsWith('C') ? s.checks[id] : s.controls[id]); }
    if (c.downstream === 'open-with-disposition') s.checks.C7 = clone(x4State().checks.C7);
    if (c.downstream === 'closed-with-run-record') s.checks.C11 = makeCheckRecord({ verdict: 'PASS' });
    if (c.fatal) s.errorLedger.fatalCount = 2; // post-gate (unsequenced: indeterminate, never pre-gate evidence)
    if (c.fatal) s.errorLedger.entries = [{ kind: 'pageerror', detail: 'x', seq: 99 }];
    if (c.cleanup === 'resolved') s.cleanupFailures = [{ step: 'unloadModelA', reason: 'threw', ownership: 'resolved' }];
    if (c.cleanup === 'unresolved') s.cleanupUnresolvedOwnership = true;
    // check-state dimension: applied to run records only (dispositions carry no verdict)
    const target = closed ? null : 'C12';
    if (target && c.checks === 'fail') Object.assign(s.checks[target], { verdict: 'FAIL', reason: 'x' });
    if (target && c.checks === 'blocked') Object.assign(s.checks[target], { verdict: 'BLOCKED', reason: 'timeout:present' });
    if (target && c.checks === 'not-evidenced') Object.assign(s.checks[target], { verdict: 'NOT_EVIDENCED', reason: 'x' });
    if (!closed && c.controls !== 'as-is') {
      const [n, st] = c.controls === 'n1-not-detected' ? ['N1', 'NOT_DETECTED'] : ['N2', 'NOT_DISCRIMINATING'];
      s.controls[n].state = st; s.controls[n].executionRecord.terminalState = st;
    }
    if (c.journal === 'inconsistent') s.attempt.attemptId = randomUUID();
    s.script.integrityResult = c.integrity;
    s.sessionTainted = c.tainted;
    return s;
  };
  const expected = (c) => {
    const closed = c.downstream !== 'run' && c.downstream !== 'open-with-disposition';
    const schemaBad = G[c.downstream] || c.downstream === 'open-with-disposition' || c.downstream === 'closed-with-run-record';
    if (c.fatal) return 1;
    if (c.cleanup === 'unresolved') return 2;
    if (c.downstream === 'other') return 3; // C1 FAIL (CLOSED_OTHER canonical cause)
    if (!closed && c.checks === 'fail') return 3;
    // a downstream run record beside a closed gate is a CG-6 match; CG matches ARE the §7 attribution
    // of L2, so every NRDB control becomes illegal => row 4 precedes row 5 (slice B2)
    if (c.downstream === 'other' || ROW4_G.includes(c.downstream) || c.downstream === 'closed-with-run-record' || (!closed && c.controls === 'n1-not-detected')) return 4;
    if (schemaBad || c.journal === 'inconsistent' || c.integrity === 'MISMATCH') return 5;
    if (c.downstream === 'cdb' || c.integrity === 'CAPTURE_UNAVAILABLE' || (!closed && c.checks === 'blocked') || c.tainted) return 6;
    if (G[c.downstream]) return 6; // (unreachable: schemaBad)
    if ((!closed && (c.checks === 'not-evidenced' || c.controls === 'n2-not-discriminating')) || c.cleanup === 'resolved') return 7;
    return 8;
  };
  let combos = 0;
  const rec = (i, c) => {
    if (i === keys.length) {
      combos += 1;
      const sPre = build(c, 'pre-closeout');
      const sLink = build(c, 'pre-link');
      for (const [s, phase] of [[sPre, 'pre-closeout'], [sLink, 'pre-link']]) {
        const rows = evaluateOverallRows(s, phase);
        // (a) exactly one row: row 8 is the complement of rows 1..7
        assert.equal(rows[7].match, !rows.slice(0, 7).some((r) => r.match), JSON.stringify(c));
        // (a') no row predicate reads a gate-disposition record as a check verdict
        for (const n of CHECK_NAMES) {
          if (s.checks[n] && s.checks[n].recordType === RECORD_TYPE.GATE_DISPOSITION) {
            for (const r of rows) assert.ok(!r.reasons.some((x) => x === `check-fail:${n}` || x === `check-blocked:${n}` || x === `check-not-evidenced:${n}`), `${n} read as a verdict ${JSON.stringify(c)}`);
          }
        }
        // row 8 unreachable while any gate-disposition exists
        const anyDisposition = [...Object.values(s.checks), ...Object.values(s.controls)].some((r) => r && r.recordType === RECORD_TYPE.GATE_DISPOSITION);
        if (anyDisposition) assert.equal(rows[7].match, false);
        // (b) a FAIL row is selected whenever any FAIL-row predicate holds
        const x = computeOverall(s, phase);
        if (rows.slice(0, 5).some((r) => r.match)) assert.equal(x.overall, 'FAIL');
        assert.equal(x.row, expected(c), `${JSON.stringify(c)} ${phase} ${JSON.stringify(x.reasons)}`);
      }
      // (c) pre-link never better than pre-closeout
      assert.ok(VERDICT_SEVERITY[computeOverall(sLink, 'pre-link').overall] >= VERDICT_SEVERITY[computeOverall(sPre, 'pre-closeout').overall]);
      return;
    }
    for (const v of dims[keys[i]]) rec(i + 1, { ...c, [keys[i]]: v });
  };
  rec(0, {});
  assert.equal(combos, 2 * 3 * dims.downstream.length * 4 * 3 * 2 * 3 * 2);
});

// ------------------------------------------------------------------------------------------
// Static guards (items 13, 19, 23)
// ------------------------------------------------------------------------------------------

test('static: no gate-disposition-capable path reads a raw `.state`; every such read goes through controlEffectiveState', () => {
  const fns = [
    'controlDisposition', 'evaluateOverallRows', 'nrdbLegality', 'executionRecordProblems', 'dependencyBlockedByShapeProblems',
    'dependencyBlockedByReferentialProblems', 'gateDispositionProblems', 'gateC1Problems', 'recordSchemaProblems', 'controlRunProblems',
    'summaryCheckCell', 'verdictMapOf', 'itemAttributionProblems', 'recomputeFatalCountAtGate', 'checkVerdictBase',
    'closedGateEvidenceMatches', 'closedGateIllegalRecords', 'attributionFieldProblems', 'makeGateDispositionRecord', 'prepareC1Gate', 'gateFinalizationProblems',
  ];
  for (const name of fns) {
    const { start, end } = locateFunctionSource(HARNESS_SOURCE, name);
    const toks = tokenizeJs(HARNESS_SOURCE.slice(start, end));
    const raw = toks.some((t, i) => t.type === 'ident' && t.value === 'state' && toks[i - 1] && toks[i - 1].type === 'punct' && (toks[i - 1].value === '.' || toks[i - 1].value === '?.'));
    assert.equal(raw, false, `${name} reads a raw .state`);
  }
  // the accessor itself is the single place that reads control-run.state
  const acc = locateFunctionSource(HARNESS_SOURCE, 'controlEffectiveState');
  assert.match(HARNESS_SOURCE.slice(acc.start, acc.end), /rec\.state/);
  // renderSummary's control table uses the accessor too
  const rs = locateFunctionSource(HARNESS_SOURCE, 'renderSummary');
  assert.match(HARNESS_SOURCE.slice(rs.start, rs.end), /controlEffectiveState\(controls\[n\]\)/);
});

test('static: makeCheckRecord stores the bare verdict (no composed BASE(reason) string); a check verdict is never parsed from a string', () => {
  const m = locateFunctionSource(HARNESS_SOURCE, 'makeCheckRecord');
  const src = HARNESS_SOURCE.slice(m.start, m.end);
  assert.doesNotMatch(src, /`\$\{verdict\}\(/);
  const c = locateFunctionSource(HARNESS_SOURCE, 'checkVerdictBase');
  assert.doesNotMatch(HARNESS_SOURCE.slice(c.start, c.end), /indexOf\('\('\)|slice\(0, open\)/);
});

test('summary renders a gate-disposition as such (never as a verdict) and the effective control state', () => {
  const s = x4State();
  const S = { run: { ...s, attempt: { attemptId: s.attempt.attemptId } }, primaryOverall: 'BLOCKED', primaryRow: 6, optional: [], journalTransitions: journalWith(makeBinding(), ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']).transitions, finishedAt: AT };
  const text = renderSummary(S);
  assert.match(text, /\| C7 \| gate-disposition:NOT_RUN_C1_GATE_CLOSED \|/);
  assert.match(text, /\| C1 \| BLOCKED\(prerequisite\) \|/);
  assert.match(text, /\| N3 \| NOT_RUN_DEPENDENCY_BLOCKED \|/);
});

test('runner output (slice B2): C1 BLOCKED(timeout:load) finalized once => CLOSED_DEPENDENCY_BLOCKED gate => dispositions only, schema-valid, row 6 not row 5', async () => {
  const rec = createCallRecorder();
  const r = await runChecksInPhaseOrder({
    recorder: rec,
    drivers: { P1: () => ({ checks: { C1: evaluateC1({ A: { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true }, B: { loaded: false, loadStatus: 'timed-out' }, loadedCount: 1 }) } }) },
  });
  assert.deepEqual([r.checks.C1.verdict, r.checks.C1.reason], ['BLOCKED', 'timeout:load']);
  assert.deepEqual(r.c1FinalizedEvent, { seq: r.checks.C1.finalizedSeq, kind: 'check-finalized', check: 'C1', verdict: 'BLOCKED', reason: 'timeout:load', phase: 'P1', activeCheck: 'C1', activeControl: null });
  assert.equal(r.gates.C1.outcome, 'CLOSED_DEPENDENCY_BLOCKED');
  for (const n of NRDB_CONTROL_NAMES) assert.equal(controlEffectiveState(r.controls[n]), NRDB_STATE, n);
  const st = { checks: r.checks, controls: r.controls, gates: r.gates, eventLog: r.eventLog, errorLedger: { ...createEmptyErrorLedger(), markers: r.markers }, spyLedger: rec.records, stateSnapshots: [], c4Table: [], c17: null, c20: null, n6: null };
  assert.deepEqual(recordSchemaProblems(st), []);
  for (const n of NRDB_CONTROL_NAMES) assert.equal(nrdbLegality(n, st).legal, true, n);
});

test('C1 reason contract coupling: timeout:load iff a load-deadline cause; the deadline takes precedence even over a loaded model', () => {
  const ok = x4State();
  assert.deepEqual(recordSchemaProblems(ok), []);
  const mism = x4State(); mism.checks.C1.reason = 'timeout:load'; mism.eventLog[0].reason = 'timeout:load'; mism.gates.C1.c1Reason = 'timeout:load';
  for (const id of DOWNSTREAM_ITEM_NAMES) { const r = id.startsWith('C') ? mism.checks[id] : mism.controls[id]; if (r.dependencyBlockedBy) r.dependencyBlockedBy.reason = 'timeout:load'; if (id.startsWith('C')) r.blockingReason = 'timeout:load'; }
  assert.ok(recordSchemaProblems(mism).includes('checks.C1:reason-block-detail-mismatch'));
  const pre = closeGate(baseState(), 'cdb', 'prerequisite'); pre.checks.C1.fields.blockDetail = [{ cause: 'load-deadline', model: 'B', observed: 'timed-out' }];
  for (const id of DOWNSTREAM_ITEM_NAMES) { const r = id.startsWith('C') ? pre.checks[id] : pre.controls[id]; if (r.dependencyBlockedBy) r.dependencyBlockedBy.detail = clone(pre.checks.C1.fields.blockDetail); }
  assert.ok(recordSchemaProblems(pre).includes('checks.C1:reason-block-detail-mismatch'));
  const m = { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true };
  const late = evaluateC1({ A: m, B: { ...m, loadStatus: 'timed-out' }, loadedCount: 2 });
  assert.deepEqual([late.verdict, late.reason], ['BLOCKED', 'timeout:load']);
});

test('applyPhaseRunToState retains C1\'s single check-finalized event (only when it matches the finalized C1 record)', async () => {
  const { applyPhaseRunToState, buildInitialRunState } = await import('./clashpanel-viewerbridge.acceptance.mjs');
  const rec = createCallRecorder();
  const r = await runChecksInPhaseOrder({ nextSeq: rec.nextSeq, drivers: { P1: () => ({ checks: { C1: evaluateC1({}) } }) } });
  const binding = makeBinding();
  const st = buildInitialRunState({ binding, validation: { record: null, candidateSet: null }, startedAt: AT });
  applyPhaseRunToState(st, { checks: r.checks, controls: r.controls, extras: {}, c1FinalizedEvent: r.c1FinalizedEvent });
  assert.deepEqual(st.eventLog, [r.c1FinalizedEvent]);
  const st2 = buildInitialRunState({ binding, validation: { record: null, candidateSet: null }, startedAt: AT });
  applyPhaseRunToState(st2, { checks: r.checks, controls: r.controls, extras: {}, c1FinalizedEvent: { ...r.c1FinalizedEvent, verdict: 'PASS' } });
  assert.deepEqual(st2.eventLog, []);
});

// ------------------------------------------------------------------------------------------
// H1 (2026-10-01 follow-up review): node-side P1 load outcomes vs the C1 reason contract.
// Procedure §7 C1 reason contract (line 423): a P1 harness exception "carries its own reason (e.g.
// `harness-exception`) and makes L1 false"; `timeout:load` (T2 deadline) takes precedence over
// `prerequisite`. Line 421: "the absence of any journal/harness exception for P1" is part of the
// evidence that distinguishes dependency loss from a harness defect.
// ------------------------------------------------------------------------------------------

const LOADED = Object.freeze({ loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true, unitScale: 1, unitString: 'm' });

/** Shifts every seq of a closeGate() state by `off` (room for the P1 load records before C1's finalization). */
function shiftClosedState(s, off) {
  s.checks.C1.finalizedSeq += off;
  for (const e of s.eventLog) e.seq += off;
  s.gates.C1.gateSeq += off;
  s.gates.C1.c1FinalizedSeq += off;
  for (const id of DOWNSTREAM_ITEM_NAMES) {
    const r = id.startsWith('C') ? s.checks[id] : s.controls[id];
    r.dispositionSeq += off;
    if (r.executionRecord) r.executionRecord.terminalSeq += off;
    if (r.dependencyBlockedBy) r.dependencyBlockedBy.phaseSeq += off;
  }
  return s;
}

/** Writes the real §9.2 P1 load records (A then B, the given completionOutcomes) through the real writer. */
function withLoadLedger(s, { A = 'ready', B = 'ready' } = {}) {
  shiftClosedState(s, 10);
  const counter = createRunSeqAllocator();
  const ops = createOperationLedger({ ledger: s.errorLedger, nextSeq: counter.next });
  for (const [m, out] of [['A', A], ['B', B]]) { const r = ops.beginLoad({ modelId: m, modelUrnSha256: h(`urn-${m}`) }); ops.endLoad(r, out); }
  assert.equal(finalizeLoadWindows(s.errorLedger, { prefixSources: [] }).finalized, true);
  return s;
}

test('H1 evaluateC1: a node-side P1 harness exception => BLOCKED(harness-exception) (NOT normalized), even when the page facts show both models loaded; it outranks timeout:load', () => {
  const he = evaluateC1({ A: { ...LOADED, nodeLoadOutcome: 'harness-exception' }, B: { ...LOADED, nodeLoadOutcome: 'ready' }, loadedCount: 2 });
  assert.deepEqual([he.verdict, he.reason], ['BLOCKED', 'harness-exception']);
  assert.equal(C1_NORMALIZED_REASONS.includes(he.reason), false);
  assert.equal(he.fields.A.loaded, true, 'the page facts are kept for diagnostics');
  assert.equal(he.fields.A.nodeLoadOutcome, 'harness-exception');
  // not-loaded A (loadStatus null: the page never recorded the load) -- formerly normalized to `prerequisite`
  const he2 = evaluateC1({ A: { loaded: false, loadStatus: null, nodeLoadOutcome: 'harness-exception' }, B: { ...LOADED, nodeLoadOutcome: 'ready' }, loadedCount: 1 });
  assert.deepEqual([he2.verdict, he2.reason], ['BLOCKED', 'harness-exception']);
  const both = evaluateC1({ A: { loaded: false, loadStatus: 'timed-out', nodeLoadOutcome: 'timeout:load' }, B: { loaded: false, nodeLoadOutcome: 'harness-exception' }, loadedCount: 0 });
  assert.deepEqual([both.verdict, both.reason], ['BLOCKED', 'harness-exception']);
  assert.equal(recomputeGateOutcome({ c1Verdict: he.verdict, c1Reason: he.reason, fatalCountAtGate: 0 }), GATE_OUTCOME.CLOSED_OTHER);
});

test('H1 evaluateC1: a node-side T2 expiry (page record still active) => load-deadline cause => BLOCKED(timeout:load); without node outcomes the page-side causes are unchanged', () => {
  const t = evaluateC1({ A: { ...LOADED, nodeLoadOutcome: 'ready' }, B: { loaded: false, loadStatus: 'active', nodeLoadOutcome: 'timeout:load' }, loadedCount: 1 });
  assert.deepEqual([t.verdict, t.reason], ['BLOCKED', 'timeout:load']);
  assert.deepEqual(t.fields.blockDetail, [{ cause: 'load-deadline', model: 'B', observed: 'timeout:load' }, { cause: 'model-count', model: null, observed: '1' }]);
  // legitimate prerequisite paths (node outcomes ready/rejected or absent) are untouched
  const pre = evaluateC1({ A: { ...LOADED, nodeLoadOutcome: 'ready' }, B: { loaded: false, loadStatus: 'failed', nodeLoadOutcome: 'rejected' }, loadedCount: 1 });
  assert.deepEqual([pre.verdict, pre.reason], ['BLOCKED', 'prerequisite']);
  assert.deepEqual(pre.fields.blockDetail[0], { cause: 'load-rejected', model: 'B', observed: 'failed' });
  const legacy = evaluateC1({ A: LOADED, B: { loaded: false, loadStatus: null }, loadedCount: 1 });
  assert.deepEqual([legacy.verdict, legacy.reason], ['BLOCKED', 'prerequisite']);
  const pass = evaluateC1({ A: { ...LOADED, nodeLoadOutcome: 'ready' }, B: { ...LOADED, nodeLoadOutcome: 'ready' }, loadedCount: 2 });
  assert.equal(pass.verdict, 'PASS');
});

test('H1 withNodeLoadOutcomes: merges each enum-valid node outcome as facts[X].nodeLoadOutcome without replacing page facts; invalid -> null; absent -> facts unchanged', () => {
  const facts = { loadedCount: 2, A: { ...LOADED, loadStatus: 'ready' }, B: { loaded: false, loadStatus: null } };
  const merged = withNodeLoadOutcomes(facts, { A: 'ready', B: 'harness-exception' });
  assert.deepEqual(merged, { loadedCount: 2, A: { ...LOADED, loadStatus: 'ready', nodeLoadOutcome: 'ready' }, B: { loaded: false, loadStatus: null, nodeLoadOutcome: 'harness-exception' } });
  assert.equal(facts.A.nodeLoadOutcome, undefined, 'input not mutated');
  assert.equal(withNodeLoadOutcomes(facts, { A: 'bogus', B: 'timeout:load' }).A.nodeLoadOutcome, null);
  assert.deepEqual(withNodeLoadOutcomes(facts, null), facts);
  assert.deepEqual(withNodeLoadOutcomes(facts, undefined), facts);
});

test('H1 runner: a P1 node-side harness exception => C1 BLOCKED(harness-exception) => CLOSED_OTHER gate => no NRDB (controls NOT_DETECTED/NOT_EXECUTABLE) => row 4 FAIL, never BLOCKED', async () => {
  const run = async (A) => {
    const rec = createCallRecorder();
    const r = await runChecksInPhaseOrder({ recorder: rec, drivers: { P1: () => ({ checks: { C1: evaluateC1(withNodeLoadOutcomes({ A, B: { ...LOADED }, loadedCount: 1 }, { A: A.nodeLoadOutcome, B: 'ready' })) } }) } });
    const s = baseState();
    Object.assign(s, { checks: r.checks, controls: r.controls, gates: r.gates, eventLog: r.eventLog, spyLedger: rec.records, stateSnapshots: [] });
    s.errorLedger.markers = r.markers;
    s.classifier.A = 'CONTRADICTORY';
    return { r, s };
  };
  const bad = await run({ loaded: false, loadStatus: null, nodeLoadOutcome: 'harness-exception' });
  assert.deepEqual([bad.r.checks.C1.verdict, bad.r.checks.C1.reason, bad.r.gates.C1.outcome], ['BLOCKED', 'harness-exception', 'CLOSED_OTHER']);
  for (const n of NRDB_CONTROL_NAMES) { assert.notEqual(controlEffectiveState(bad.r.controls[n]), NRDB_STATE, n); assert.equal(nrdbLegality(n, bad.s).legal, false, n); }
  assert.deepEqual(recordSchemaProblems(bad.s), []);
  const o = computeOverall(bad.s, 'pre-closeout');
  assert.equal(o.overall, 'FAIL');
  assert.equal(o.row, 4);
  // control: the same composition with a page-side rejection (node outcome `rejected`) stays the legitimate BLOCKED
  const ok = await run({ loaded: false, loadStatus: 'failed', nodeLoadOutcome: 'rejected' });
  assert.deepEqual([ok.r.checks.C1.reason, ok.r.gates.C1.outcome], ['prerequisite', 'CLOSED_DEPENDENCY_BLOCKED']);
  assert.deepEqual(recordSchemaProblems(ok.s), []);
  assert.deepEqual([computeOverall(ok.s, 'pre-closeout').overall, computeOverall(ok.s, 'pre-closeout').row], ['BLOCKED', 6]);
});

test('H1 c1LoadLedgerProblems: opLedger harness-exception vs a PASS/normalized C1, and opLedger timeout:load vs a PASS/prerequisite C1, are contradictions; legitimate pairs are not', () => {
  const st = (c1, outcomes) => ({ checks: { C1: { recordType: 'check-run', ...c1 } }, errorLedger: { opLedger: outcomes.map((o, i) => ({ recordType: 'load', modelId: i === 0 ? 'A' : 'B', phase: 'P1', completionOutcome: o })) } });
  const P = { verdict: 'PASS', reason: null };
  const PRE = { verdict: 'BLOCKED', reason: 'prerequisite' };
  const TO = { verdict: 'BLOCKED', reason: 'timeout:load' };
  const HE = { verdict: 'BLOCKED', reason: 'harness-exception' };
  const HX = 'c1-load-ledger-mismatch:harness-exception';
  const TX = 'c1-load-ledger-mismatch:timeout:load';
  assert.deepEqual(c1LoadLedgerProblems(st(PRE, ['harness-exception', 'ready'])), [HX]);
  assert.deepEqual(c1LoadLedgerProblems(st(TO, ['harness-exception', 'timeout:load'])), [HX]);
  assert.deepEqual(c1LoadLedgerProblems(st(P, ['ready', 'harness-exception'])), [HX]);
  assert.deepEqual(c1LoadLedgerProblems(st(PRE, ['ready', 'timeout:load'])), [TX]);
  assert.deepEqual(c1LoadLedgerProblems(st(P, ['timeout:load', 'ready'])), [TX]);
  for (const [c1, outs] of [[HE, ['harness-exception', 'ready']], [TO, ['ready', 'timeout:load']], [PRE, ['rejected', 'ready']], [PRE, ['ready', 'ready']], [P, ['ready', 'ready']], [TO, ['ready', 'ready']], [PRE, []]]) {
    assert.deepEqual(c1LoadLedgerProblems(st(c1, outs)), [], `${c1.reason} / ${outs}`);
  }
  assert.deepEqual(c1LoadLedgerProblems({}), []);
});

test('H1 X-row: X4 with a P1 load ledger -- harness-exception or an outer T2 expiry recorded in opLedger but C1 normalized to prerequisite => row 5 FAIL (formerly legal NRDB => BLOCKED); the legitimate prerequisite / timeout:load BLOCKED paths stay row 6', () => {
  for (const phase of OVERALL_PHASES) {
    // legitimate: page-side rejection (node `rejected`) + prerequisite; T2 expiry + timeout:load
    const legit = withLoadLedger(closeGate(baseState(phase), 'cdb', 'prerequisite'), { A: 'rejected' });
    assert.deepEqual(recordSchemaProblems(legit), [], phase);
    for (const n of NRDB_CONTROL_NAMES) assert.equal(nrdbLegality(n, legit).legal, true, `${phase} ${n}`);
    assert.deepEqual([computeOverall(legit, phase).overall, computeOverall(legit, phase).row], ['BLOCKED', 6], phase);
    const legitTo = withLoadLedger(closeGate(baseState(phase), 'cdb', 'timeout:load'), { B: 'timeout:load' });
    assert.deepEqual(recordSchemaProblems(legitTo), [], phase);
    assert.deepEqual([computeOverall(legitTo, phase).overall, computeOverall(legitTo, phase).row], ['BLOCKED', 6], phase);
    // H1(a): node-side harness exception, page never recorded the load => C1 normalized to prerequisite
    const he = withLoadLedger(closeGate(baseState(phase), 'cdb', 'prerequisite'), { A: 'harness-exception' });
    assert.ok(recordSchemaProblems(he).includes('c1-load-ledger-mismatch:harness-exception'), phase);
    const oh = computeOverall(he, phase);
    assert.deepEqual([oh.overall, oh.row], ['FAIL', 5], phase);
    // H1(b): outer T2 expiry recorded node-side, C1 says prerequisite (precedence error)
    const to = withLoadLedger(closeGate(baseState(phase), 'cdb', 'prerequisite'), { B: 'timeout:load' });
    assert.ok(recordSchemaProblems(to).includes('c1-load-ledger-mismatch:timeout:load'), phase);
    assert.deepEqual([computeOverall(to, phase).overall, computeOverall(to, phase).row], ['FAIL', 5], phase);
    // both recorded, C1 timeout:load: the harness exception still forbids a normalized reason
    const both = withLoadLedger(closeGate(baseState(phase), 'cdb', 'timeout:load'), { A: 'harness-exception', B: 'timeout:load' });
    assert.deepEqual([computeOverall(both, phase).overall, computeOverall(both, phase).row], ['FAIL', 5], phase);
  }
});
