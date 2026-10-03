// test/acceptance/clashpanel-viewerbridge.acceptance.verdict.test.mjs
//
// Offline tests for the G2 harness overall verdict model (procedure §8): computeOverall with
// exactly two operational phases ('pre-closeout' | 'pre-link'), row precedence, the mandatory
// worked examples X1-X14 as computeOverall tests (X9-X12 also as closeout runs in the closeout
// test file), the §8 offline product matrix with properties (a)-(d), fail-closed inputs, and the
// "no K-dependent read before K" rule (throwing `closeoutComplete` getter). Pure; no filesystem.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  OVERALL_PHASES,
  VERDICT_SEVERITY,
  CHECK_NAMES,
  CONTROL_NAMES,
  JOURNAL_STATE,
  computeOverall,
  evaluateOverallRows,
  exitCodeForVerdict,
  controlDisposition,
  checkVerdictBase,
  createOfflineRunStateFixture,
  buildBindingRecord,
  serializeJson,
  sha256Hex,
  MODEL_A_URN,
  MODEL_B_URN,
} from './clashpanel-viewerbridge.acceptance.mjs';

// ------------------------------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------------------------------

const h = (s) => sha256Hex(Buffer.from(s, 'utf8'));

function makeBinding(attemptId = randomUUID()) {
  return buildBindingRecord({
    validation: {
      ok: true,
      record: { path: 'docs/prompts/g2-verdict-test.md', sha256: h('record'), id: 'verdict-test-0001' },
      digests: { headSha: h('head').slice(0, 40), procedureSha256: h('procedure'), harnessSha256: h('harness'), urnASha256: h(MODEL_A_URN), urnBSha256: h(MODEL_B_URN) },
    },
    attemptId,
  });
}

const T0 = Date.parse('2026-09-30T10:00:00.000Z');
function journalWith(binding, states) {
  return {
    ...binding,
    transitions: states.map((state, i) => {
      const t = { state, at: new Date(T0 + i * 1000).toISOString(), monotonicMs: i * 1000 };
      if (state === JOURNAL_STATE.CLOSEOUT_STARTED) t.detail = { primaryOverall: 'PASS', primaryRow: 8 };
      return t;
    }),
  };
}

function preLinkFacts(journal, overrides = {}) {
  const bytes = serializeJson(journal);
  return {
    closeoutStartedVerified: true, r1Verified: true, r2Verified: true, r3Verified: true, kcVerified: true,
    snapshotEqual: true, quiescenceComplete: true, closeoutFailures: [], journalBytes: bytes, kcJournalSha256: sha256Hex(bytes),
    ...overrides,
  };
}

/** A throwing getter: any evaluation that touches the post-K predicate fails the test loudly. */
function armClosureTrap(state) {
  Object.defineProperty(state, 'closeoutComplete', { enumerable: false, get() { throw new Error('closeoutComplete read before K exists'); } });
  return state;
}

/** State prepared for one phase: pre-closeout journal ends at ATTEMPT_CONSUMED, pre-link at CLOSEOUT_STARTED. */
function stateFor(phase, mutate = () => {}, { binding = makeBinding(), closeout = {} } = {}) {
  const s = createOfflineRunStateFixture({ binding });
  if (phase === 'pre-closeout') s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']);
  else {
    s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']);
    s.closeoutFacts = preLinkFacts(s.journal, closeout);
  }
  mutate(s);
  return armClosureTrap(s);
}

/** Sets a control-run record's state AND its executionRecord.terminalState (they must agree, §7). */
function setControlState(s, n, st) {
  s.controls[n].state = st;
  s.controls[n].executionRecord.terminalState = st;
}

function both(mutate, closeout) {
  return { pre: computeOverall(stateFor('pre-closeout', mutate), 'pre-closeout'), link: computeOverall(stateFor('pre-link', mutate, { closeout }), 'pre-link') };
}

// ------------------------------------------------------------------------------------------
// Phases: exactly two, no third ('final') phase
// ------------------------------------------------------------------------------------------

test('phases: OVERALL_PHASES is exactly [pre-closeout, pre-link]; any other phase (incl. a "final" phase) throws', () => {
  assert.deepEqual([...OVERALL_PHASES], ['pre-closeout', 'pre-link']);
  assert.ok(Object.isFrozen(OVERALL_PHASES));
  const s = stateFor('pre-link');
  for (const bad of ['final', 'FINAL', 'post-link', 'post-commit', 'closeout', '', undefined, null, 1]) {
    assert.throws(() => computeOverall(s, bad), /unknown phase/, String(bad));
    assert.throws(() => evaluateOverallRows(s, bad), /unknown phase/, String(bad));
  }
});

test('X5 all PASS: PASS-eligible (row 8) at both phases with K absent and closeoutComplete a throwing getter', () => {
  const r = both(() => {});
  assert.deepEqual([r.pre.overall, r.pre.row], ['PASS', 8]);
  assert.deepEqual([r.link.overall, r.link.row], ['PASS', 8]);
  assert.ok(Object.isFrozen(r.link));
});

test('X5 pre-link journal predicate: history must be exactly AUTH_BOUND -> ATTEMPT_CONSUMED -> CLOSEOUT_STARTED and match the Kc hash', () => {
  const binding = makeBinding();
  // pre-link over a journal that stops at ATTEMPT_CONSUMED -> row 5
  const s1 = stateFor('pre-link', (s) => { s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']); }, { binding });
  const r1 = computeOverall(s1, 'pre-link');
  assert.deepEqual([r1.overall, r1.row], ['FAIL', 5]);
  assert.ok(r1.reasons.includes('journal-history-not-exact'));
  // journal bytes differ from those hashed for Kc -> row 5
  const s2 = stateFor('pre-link', () => {}, { binding, closeout: { kcJournalSha256: h('other') } });
  const r2 = computeOverall(s2, 'pre-link');
  assert.deepEqual([r2.overall, r2.row], ['FAIL', 5]);
  assert.ok(r2.reasons.includes('journal-bytes-differ-from-kc'));
  // pre-closeout over a journal already at CLOSEOUT_STARTED -> row 5 (last durable state must be ATTEMPT_CONSUMED)
  const s3 = stateFor('pre-closeout', (s) => { s.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'CLOSEOUT_STARTED']); }, { binding });
  assert.deepEqual(computeOverall(s3, 'pre-closeout').row, 5);
  // illegal histories (second ATTEMPT_CONSUMED, PREFLIGHT_FAILED then consumed) -> row 5
  for (const states of [['AUTH_BOUND', 'ATTEMPT_CONSUMED', 'ATTEMPT_CONSUMED'], ['AUTH_BOUND', 'PREFLIGHT_FAILED', 'ATTEMPT_CONSUMED'], ['AUTH_BOUND']]) {
    const s = stateFor('pre-closeout', (x) => { x.journal = journalWith(binding, states); }, { binding });
    assert.equal(computeOverall(s, 'pre-closeout').row, 5, states.join('>'));
  }
});

test('pre-link requires every closeout prerequisite; each missing one (or a recorded failure) is row 5', () => {
  const names = ['closeoutStartedVerified', 'r1Verified', 'r2Verified', 'r3Verified', 'kcVerified', 'snapshotEqual', 'quiescenceComplete'];
  for (const n of names) {
    const r = computeOverall(stateFor('pre-link', () => {}, { closeout: { [n]: false } }), 'pre-link');
    assert.deepEqual([r.overall, r.row], ['FAIL', 5], n);
    assert.ok(r.reasons.includes(`closeout-prerequisite:${n}`), n);
  }
  for (const cause of ['closeout-started-write', 'r1-write', 'r2-verify', 'r3-write', 'kc-verify', 'r1-mutated', 'late-verdict-change(fatal-event)']) {
    const r = computeOverall(stateFor('pre-link', () => {}, { closeout: { closeoutFailures: [cause] } }), 'pre-link');
    assert.deepEqual([r.overall, r.row], ['FAIL', 5], cause);
  }
  // closeout facts are NOT consulted at pre-closeout
  const s = stateFor('pre-closeout', (x) => { x.closeoutFacts = { garbage: true }; });
  assert.deepEqual(computeOverall(s, 'pre-closeout').row, 8);
});

// ------------------------------------------------------------------------------------------
// Mandatory worked examples X1-X14 (computeOverall level)
// ------------------------------------------------------------------------------------------

test('X1: C7 FAIL + C1 BLOCKED(prerequisite) => row 3 before row 6 => FAIL', () => {
  const r = both((s) => { s.checks.C7.verdict = 'FAIL'; Object.assign(s.checks.C1, { verdict: 'BLOCKED', reason: 'prerequisite' }); });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 3]);
});

test('X2: N3 NOT_DETECTED + integrity CAPTURE_UNAVAILABLE => row 4 before row 6 => FAIL', () => {
  const r = both((s) => { setControlState(s, 'N3', 'NOT_DETECTED'); s.script.integrityResult = 'CAPTURE_UNAVAILABLE'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
});

test('X3: cleanupUnresolvedOwnership + integrity PROVENANCE_AMBIGUOUS => row 2 before row 6 => FAIL', () => {
  const r = both((s) => { s.cleanupUnresolvedOwnership = true; s.script.integrityResult = 'PROVENANCE_AMBIGUOUS'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 2]);
});

// The procedure's X4 (C1 BLOCKED(prerequisite) => CLOSED_DEPENDENCY_BLOCKED gate + gate-disposition
// records) is in the nrdb test file; this is the row-6 classifier/runtime-BLOCKED clause under an OPEN gate.
test('row 6 classifier clause: classifier CONTRADICTORY for B, runtime check-run BLOCKED records, nothing else wrong => row 6 BLOCKED', () => {
  const r = both((s) => {
    s.classifier.B = 'CONTRADICTORY';
    for (const n of ['C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20']) Object.assign(s.checks[n], { verdict: 'BLOCKED', reason: 'prerequisite' });
  });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['BLOCKED', 6]);
});

test('X6: C6 NOT_EVIDENCED with N2 NOT_DISCRIMINATING, everything else PASS => row 7 PARTIAL', () => {
  const r = both((s) => { Object.assign(s.checks.C6, { verdict: 'NOT_EVIDENCED', reason: 'not-discriminating' }); setControlState(s, 'N2', 'NOT_DISCRIMINATING'); });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['PARTIAL', 7]);
});

test('X7: journal attemptId differs from result attempt.attemptId, all checks PASS => row 5 FAIL', () => {
  const r = both((s) => { s.attempt.attemptId = randomUUID(); });
  for (const x of [r.pre, r.link]) {
    assert.deepEqual([x.overall, x.row], ['FAIL', 5]);
    assert.ok(x.reasons.includes('binding-differs:attemptId'));
  }
  // every other bound digest is compared too
  for (const [label, mut] of [
    ['authorization.sha256', (s) => { s.authorization.sha256 = h('x'); }],
    ['headSha', (s) => { s.harnessIntegrity.headSha = h('y').slice(0, 40); }],
    ['procedure.sha256', (s) => { s.procedure.sha256 = h('z'); }],
    ['harness.sha256', (s) => { s.harnessIntegrity.sha256 = h('w'); }],
    ['fixtures.B.urnSha256', (s) => { s.runtimeEnvelope.urnSha256.B = h('v'); }],
  ]) {
    const x = computeOverall(stateFor('pre-closeout', mut), 'pre-closeout');
    assert.deepEqual([x.row, x.reasons.includes(`binding-differs:${label}`)], [5, true], label);
  }
});

test('X8: C4 FAIL + sessionTainted + later checks BLOCKED(session-tainted) => row 3 FAIL', () => {
  const r = both((s) => {
    Object.assign(s.checks.C4, { verdict: 'FAIL', reason: 'not-contained' });
    s.sessionTainted = true;
    for (const n of ['C5', 'C6', 'C7']) Object.assign(s.checks[n], { verdict: 'BLOCKED', reason: 'session-tainted' });
  });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 3]);
});

test('X9/X10: primaryOverall PASS, then any R1/R2/R3/Kc write or verification failure => pre-link row 5 FAIL', () => {
  const primary = computeOverall(stateFor('pre-closeout'), 'pre-closeout');
  assert.equal(primary.overall, 'PASS');
  for (const [cause, flag] of [['r1-write', 'r1Verified'], ['r1-verify', 'r1Verified'], ['r2-write', 'r2Verified'], ['r3-verify', 'r3Verified'], ['kc-write', 'kcVerified'], ['kc-verify', 'kcVerified']]) {
    const x = computeOverall(stateFor('pre-link', () => {}, { closeout: { closeoutFailures: [cause], [flag]: false } }), 'pre-link');
    assert.deepEqual([x.overall, x.row], ['FAIL', 5], cause);
  }
});

test('X11: C7 FAIL and a result-JSON write failure => FAIL; rows 3 and 5 both match (both causes retained)', () => {
  const s = stateFor('pre-link', (x) => { x.checks.C7.verdict = 'FAIL'; }, { closeout: { closeoutFailures: ['r1-write'], r1Verified: false } });
  const rows = evaluateOverallRows(s, 'pre-link');
  assert.equal(rows[2].match, true);
  assert.equal(rows[4].match, true);
  const x = computeOverall(s, 'pre-link');
  assert.deepEqual([x.overall, x.row], ['FAIL', 3]);
});

test('X12: primaryOverall PARTIAL (C20 NOT_EVIDENCED) and a result-JSON write failure => row 5 outranks row 7 => FAIL', () => {
  const pre = computeOverall(stateFor('pre-closeout', (x) => { Object.assign(x.checks.C20, { verdict: 'NOT_EVIDENCED', reason: 'unstable-frame' }); }), 'pre-closeout');
  assert.deepEqual([pre.overall, pre.row], ['PARTIAL', 7]);
  const link = computeOverall(stateFor('pre-link', (x) => { Object.assign(x.checks.C20, { verdict: 'NOT_EVIDENCED', reason: 'unstable-frame' }); }, { closeout: { closeoutFailures: ['r1-write'], r1Verified: false } }), 'pre-link');
  assert.deepEqual([link.overall, link.row], ['FAIL', 5]);
});

test('X13: all PASS; optional artifacts are not an input of computeOverall (O1 absent / O2 failed never matter)', () => {
  const x = both((s) => { s.screenshots = []; s.limitations = ['O1 raw log absent (external)']; });
  assert.deepEqual([x.pre.row, x.link.row], [8, 8]);
});

test('X14: all PASS except C20 NOT_EVIDENCED(unstable-frame) => row 7 PARTIAL (never PASS)', () => {
  const r = both((s) => { Object.assign(s.checks.C20, { verdict: 'NOT_EVIDENCED', reason: 'unstable-frame' }); });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['PARTIAL', 7]);
});

// ------------------------------------------------------------------------------------------
// Controls (§7) and fail-closed inputs
// ------------------------------------------------------------------------------------------

test('controls: §7 allowed/acceptable states; NOT_APPLICABLE is partial only while its check is not PASS', () => {
  const pass = Object.fromEntries(CHECK_NAMES.map((n) => [n, 'PASS']));
  assert.equal(controlDisposition('N1', { recordType: 'control-run', state: 'DETECTED' }, pass), 'acceptable');
  assert.equal(controlDisposition('N1', { recordType: 'control-run', state: 'NOT_DETECTED' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N2', { recordType: 'control-run', state: 'NOT_DISCRIMINATING' }, pass), 'partial');
  assert.equal(controlDisposition('N3', { recordType: 'control-run', state: 'NOT_DISCRIMINATING' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N6', { recordType: 'control-run', state: 'NOT_APPLICABLE' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N6', { recordType: 'control-run', state: 'NOT_APPLICABLE' }, { ...pass, C4: 'NOT_EVIDENCED' }), 'partial');
  assert.equal(controlDisposition('N8', { recordType: 'control-run', state: 'NOT_APPLICABLE' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N8', { recordType: 'control-run', state: 'NOT_APPLICABLE' }, { ...pass, C20: 'NOT_EVIDENCED' }), 'partial');
  assert.equal(controlDisposition('N8', { recordType: 'control-run', state: 'NOT_DISCRIMINATING' }, pass), 'partial');
  for (const n of CONTROL_NAMES) {
    assert.equal(controlDisposition(n, { recordType: 'control-run', state: 'BOGUS' }, pass), 'unacceptable', n);
    assert.equal(controlDisposition(n, undefined, pass), 'unacceptable', n);
  }
  for (const st of ['RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE']) assert.equal(controlDisposition('N4', { recordType: 'control-run', state: st }, pass), 'unacceptable', st);
  // a legacy record without recordType never reads as a state (effective-state accessor fails closed)
  assert.equal(controlDisposition('N1', { state: 'DETECTED' }, pass), 'unacceptable');
  // NRDB is never neutral without L1-L4 (here: control-run record, no gate)
  assert.equal(controlDisposition('N3', { recordType: 'control-run', state: 'NOT_RUN_DEPENDENCY_BLOCKED' }, pass, {}), 'unacceptable');
  // N6 NOT_APPLICABLE while C4 PASS => row 4; while C4 NOT_EVIDENCED => row 7
  assert.equal(computeOverall(stateFor('pre-closeout', (s) => { setControlState(s, 'N6', 'NOT_APPLICABLE'); }), 'pre-closeout').row, 4);
  assert.equal(computeOverall(stateFor('pre-closeout', (s) => { setControlState(s, 'N6', 'NOT_APPLICABLE'); Object.assign(s.checks.C4, { verdict: 'NOT_EVIDENCED', reason: 'near-tolerance' }); }), 'pre-closeout').row, 7);
});

test('check verdict reading: bare base of a check-run record only (BLOCKED(x) is notation, never stored)', () => {
  assert.equal(checkVerdictBase({ recordType: 'check-run', verdict: 'BLOCKED', reason: 'timeout:load' }), 'BLOCKED');
  assert.equal(checkVerdictBase({ recordType: 'check-run', verdict: 'PASS' }), 'PASS');
  for (const bad of ['BLOCKED(timeout:load)', 'NOT_EVIDENCED(unstable-frame)', 'pass', 'OK', 'FAIL(', '']) assert.equal(checkVerdictBase({ recordType: 'check-run', verdict: bad }), null, bad);
  // no recordType / a gate-disposition record (no verdict) / non-objects => null
  assert.equal(checkVerdictBase({ verdict: 'PASS' }), null);
  assert.equal(checkVerdictBase({ recordType: 'gate-disposition', verdict: 'PASS' }), null);
  for (const bad of ['PASS', null, undefined, 3, {}]) assert.equal(checkVerdictBase(bad), null, String(bad));
});

test('fail-closed inputs: missing/garbage fields never yield PASS', () => {
  const cases = [
    ['error ledger missing', (s) => { delete s.errorLedger; }, 1],
    ['fatal count', (s) => { s.errorLedger.fatalCount = 1; }, 1],
    ['fatal count non-integer', (s) => { s.errorLedger.fatalCount = '0'; }, 1],
    ['cleanup ownership undefined', (s) => { delete s.cleanupUnresolvedOwnership; }, 2],
    ['check missing', (s) => { delete s.checks.C13; }, 5],
    ['check out-of-enum', (s) => { s.checks.C2.verdict = 'MAYBE'; }, 5],
    ['control missing', (s) => { delete s.controls.N7; }, 4],
    ['integrity out-of-enum', (s) => { s.script.integrityResult = 'OK'; }, 5],
    ['integrity MISMATCH', (s) => { s.script.integrityResult = 'MISMATCH'; }, 5],
    ['integrity FETCH_FAILED', (s) => { s.script.integrityResult = 'FETCH_FAILED'; }, 5],
    ['ATTEMPT_DEADLINE', (s) => { s.errorLedger.attemptDeadlineExpired = true; }, 5],
    ['attempt deadline flag missing', (s) => { delete s.errorLedger.attemptDeadlineExpired; }, 5],
    ['cleanupFailures not array', (s) => { s.cleanupFailures = null; }, 5],
    ['journal missing', (s) => { delete s.journal; }, 5],
    ['classifier A', (s) => { s.classifier.A = 'NOT_SVF2'; }, 6],
    ['model B unloadable', (s) => { s.runtime.B.loaded = false; }, 6],
    ['runtime missing', (s) => { delete s.runtime; }, 6],
    ['sessionTainted undefined', (s) => { delete s.sessionTainted; }, 6],
    ['sessionTainted true', (s) => { s.sessionTainted = true; }, 6],
    ['cleanup step failed but resolved', (s) => { s.cleanupFailures = [{ step: 'closePage', reason: 'threw', ownership: 'resolved' }]; }, 7],
  ];
  for (const [label, mut, row] of cases) {
    for (const phase of OVERALL_PHASES) {
      const x = computeOverall(stateFor(phase, mut), phase);
      assert.equal(x.row, row, `${label} @ ${phase}`);
      assert.notEqual(x.overall, 'PASS', `${label} @ ${phase}`);
    }
  }
  assert.equal(computeOverall(null, 'pre-closeout').overall, 'FAIL');
  assert.equal(computeOverall(armClosureTrap({}), 'pre-link').overall, 'FAIL');
});

test('G-8: cleanup-failure ownership boundary -- row 7 PARTIAL only when every failed step is resolved; anything else is row 2 FAIL', () => {
  const f = (step, ownership) => ({ step, reason: 'threw', ownership });
  const run = (failures, unresolved = false) => OVERALL_PHASES.map((phase) => computeOverall(stateFor(phase, (s) => { s.cleanupFailures = failures; s.cleanupUnresolvedOwnership = unresolved; }), phase));
  for (const x of run([f('closePage', 'resolved'), f('showHiddenNodes', 'resolved')])) { assert.equal(x.row, 7); assert.equal(x.overall, 'PARTIAL'); }
  // Defensive: the boolean is false (a PARTIAL-eligible state) but a failed step is not proven resolved => FAIL, never PARTIAL.
  for (const bad of [[f('closeContext', 'indeterminate')], [f('closePage', 'unresolved')], [f('closePage', 'resolved'), f('closeContext', 'indeterminate')], [f('closePage', undefined)], ['closePage'], [null]]) {
    for (const x of run(bad)) { assert.equal(x.row, 2, JSON.stringify(bad)); assert.equal(x.overall, 'FAIL'); }
  }
  // Boolean true alone => FAIL even with only resolved failures listed.
  for (const x of run([f('closePage', 'resolved')], true)) { assert.equal(x.row, 2); assert.equal(x.overall, 'FAIL'); }
});

test('G-8: C20 NOT_EVIDENCED alone remains row 7 PARTIAL (semantics unchanged)', () => {
  for (const phase of OVERALL_PHASES) {
    const x = computeOverall(stateFor(phase, (s) => { Object.assign(s.checks.C20, { verdict: 'NOT_EVIDENCED', reason: 'no-change-observed' }); }), phase);
    assert.equal(x.row, 7);
    assert.equal(x.overall, 'PARTIAL');
  }
});

test('computeOverall is pure: never mutates the state', () => {
  const s = stateFor('pre-link', (x) => { x.checks.C3.verdict = 'NOT_EVIDENCED'; });
  const before = JSON.stringify(s);
  computeOverall(s, 'pre-link');
  computeOverall(s, 'pre-link');
  assert.equal(JSON.stringify(s), before);
});

test('exit codes: PASS 0, FAIL 1, BLOCKED 2, PARTIAL 3, anything else 4', () => {
  assert.deepEqual(['PASS', 'FAIL', 'BLOCKED', 'PARTIAL', 'PASS-UNCONFIRMED', undefined, 'pass'].map(exitCodeForVerdict), [0, 1, 2, 3, 4, 4, 4]);
});

// ------------------------------------------------------------------------------------------
// §8 offline product matrix
// ------------------------------------------------------------------------------------------

test('§8 product matrix: exactly one row, FAIL rows win over BLOCKED/NOT_EVIDENCED, pre-link never better than pre-closeout, no K read', () => {
  const dims = {
    fatal: [false, true],
    cleanup: ['clean', 'resolved', 'unresolved'],
    checks: ['all-pass', 'fail', 'blocked', 'not-evidenced'],
    controls: ['ok', 'n1-not-detected', 'n2-not-discriminating', 'n6-na-while-c4-pass'],
    journal: ['consistent', 'inconsistent'],
    integrity: ['VERIFIED', 'MISMATCH', 'FETCH_FAILED', 'PROVENANCE_AMBIGUOUS', 'CAPTURE_UNAVAILABLE', 'BOGUS'],
    tainted: [false, true],
    closeout: ['ok', 'closeout-started', 'r1', 'r2', 'r3', 'kc', 'r1-mutated'],
    optional: ['present', 'absent'],
  };
  const binding = makeBinding();
  const closeoutOverride = {
    ok: {}, 'closeout-started': { closeoutStartedVerified: false, closeoutFailures: ['closeout-started-write'] },
    r1: { r1Verified: false, closeoutFailures: ['r1-verify'] }, r2: { r2Verified: false, closeoutFailures: ['r2-write'] },
    r3: { r3Verified: false, closeoutFailures: ['r3-verify'] }, kc: { kcVerified: false, closeoutFailures: ['kc-verify'] },
    'r1-mutated': { snapshotEqual: false, closeoutFailures: ['r1-mutated'] },
  };
  const apply = (s, c) => {
    if (c.fatal) s.errorLedger.fatalCount = 2;
    if (c.cleanup === 'resolved') s.cleanupFailures = [{ step: 'unloadModelA', reason: 'threw', ownership: 'resolved' }];
    if (c.cleanup === 'unresolved') s.cleanupUnresolvedOwnership = true;
    if (c.checks === 'fail') s.checks.C7.verdict = 'FAIL';
    if (c.checks === 'blocked') Object.assign(s.checks.C12, { verdict: 'BLOCKED', reason: 'timeout:present' });
    if (c.checks === 'not-evidenced') Object.assign(s.checks.C20, { verdict: 'NOT_EVIDENCED', reason: 'no-change-observed' });
    if (c.controls === 'n1-not-detected') setControlState(s, 'N1', 'NOT_DETECTED');
    if (c.controls === 'n2-not-discriminating') setControlState(s, 'N2', 'NOT_DISCRIMINATING');
    if (c.controls === 'n6-na-while-c4-pass') setControlState(s, 'N6', 'NOT_APPLICABLE');
    if (c.journal === 'inconsistent') s.attempt.attemptId = randomUUID();
    s.script.integrityResult = c.integrity;
    s.sessionTainted = c.tainted;
    if (c.optional === 'present') s.screenshots = [{ frame: 'F_on', sha256: h('png') }];
  };
  const oracle = (c, phase) => {
    if (c.fatal) return 1;
    if (c.cleanup === 'unresolved') return 2;
    if (c.checks === 'fail') return 3;
    if (c.controls === 'n1-not-detected' || c.controls === 'n6-na-while-c4-pass') return 4;
    if (c.journal === 'inconsistent' || ['MISMATCH', 'FETCH_FAILED', 'BOGUS'].includes(c.integrity) || (phase === 'pre-link' && c.closeout !== 'ok')) return 5;
    if (['PROVENANCE_AMBIGUOUS', 'CAPTURE_UNAVAILABLE'].includes(c.integrity) || c.checks === 'blocked' || c.tainted) return 6;
    if (c.checks === 'not-evidenced' || c.controls === 'n2-not-discriminating' || c.cleanup === 'resolved') return 7;
    return 8;
  };
  const keys = Object.keys(dims);
  let combos = 0;
  const rec = (i, c) => {
    if (i === keys.length) {
      combos += 1;
      const sPre = stateFor('pre-closeout', (s) => apply(s, c), { binding });
      const sLink = stateFor('pre-link', (s) => apply(s, c), { binding, closeout: closeoutOverride[c.closeout] });
      const rowsPre = evaluateOverallRows(sPre, 'pre-closeout');
      const rowsLink = evaluateOverallRows(sLink, 'pre-link');
      for (const [rows, phase] of [[rowsPre, 'pre-closeout'], [rowsLink, 'pre-link']]) {
        // (a) exactly one row is selected: row 8 is exactly the complement of rows 1..7
        const anyEarlier = rows.slice(0, 7).some((r) => r.match);
        assert.equal(rows[7].match, !anyEarlier, `row 8 complement ${JSON.stringify(c)} ${phase}`);
        // (b) whenever a FAIL-row predicate holds, a FAIL row is selected
        const r = computeOverall(phase === 'pre-closeout' ? sPre : sLink, phase);
        if (rows.slice(0, 5).some((x) => x.match)) assert.equal(r.overall, 'FAIL');
        assert.equal(r.row, oracle(c, phase), `${JSON.stringify(c)} ${phase}`);
      }
      // (c) the pre-link verdict (and so the assigned finalOverall) is never better than primaryOverall
      const pre = computeOverall(sPre, 'pre-closeout');
      const link = computeOverall(sLink, 'pre-link');
      assert.ok(VERDICT_SEVERITY[link.overall] >= VERDICT_SEVERITY[pre.overall], `${JSON.stringify(c)}`);
      // (d) no evaluation read closeoutComplete (the throwing getter would have thrown)
      return;
    }
    for (const v of dims[keys[i]]) rec(i + 1, { ...c, [keys[i]]: v });
  };
  rec(0, {});
  assert.equal(combos, 2 * 3 * 4 * 4 * 2 * 6 * 2 * 7 * 2);
});

// ==========================================================================================
// FAILED-RUN CLOSEOUT (owner-authorized 2026-10-02): §8 row 3 `phase-run-failed`, row 8 `phaseRunFailure === null`,
// and the failed-run variant of the R1 record rules (waives ONLY gates-missing / C1 finalization).
// ==========================================================================================

// (imports are hoisted; kept here so this section stays self-contained)
import { applyPhaseRunFailureToState, recordSchemaProblems, failedRunRecordProblems, notStartedControlRun, primarySeqAllocations } from './clashpanel-viewerbridge.acceptance.mjs';

const FR_PAGE = Object.freeze({ name: 'TypeError', message: 'runner threw after P11 (verdict fixture)', phase: 'P11', activeCheck: null, activeControl: null, operation: null, seq: 90, cleanupEntry: 'marker-allocated' });
/** The failed-run state Node builds (real applyPhaseRunFailureToState) on top of the PASS fixture. */
function failRun(s) {
  let n = 100;
  // POST-C1 failure at the very end of the run (every check/control already produced): Node's retained gate + the page's partial history
  s.authoritativeGate = s.gates.C1;
  s.errorLedger.markers.push({ seq: 80, name: 'P11' }, { seq: 95, name: 'cleanup' });
  applyPhaseRunFailureToState(s, { phaseRunFailure: { ...FR_PAGE }, partial: { checks: s.checks, controls: s.controls, extras: {} }, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
/** The record alone (a PASS-eligible state carrying ONLY a non-null phaseRunFailure). */
const recordOnly = (() => { const s = stateFor('pre-closeout', failRun); return JSON.parse(JSON.stringify(s.phaseRunFailure)); })();

test('FAILED-RUN CLOSEOUT verdict: a valid failed-run state is schema-clean and lands on row 3 (phase-run-failed) at BOTH phases -- never row 4/5 by accident, never row 8', () => {
  for (const phase of ['pre-closeout', 'pre-link']) {
    const s = stateFor(phase, failRun);
    assert.deepEqual(recordSchemaProblems(s), [], phase);
    const o = computeOverall(s, phase);
    assert.deepEqual([o.overall, o.row, [...o.reasons]], ['FAIL', 3, ['phase-run-failed']], phase);
    const rows = evaluateOverallRows(s, phase);
    assert.equal(rows.find((r) => r.row === 5).match, false, `${phase}: no record-schema contradiction`);
    assert.equal(rows.find((r) => r.row === 8).match, false, phase);
  }
});

test('FAILED-RUN CLOSEOUT verdict: an otherwise PASS-eligible state with a non-null phaseRunFailure => FAIL row 3 (phase-run-failed) at pre-closeout AND pre-link; row 8 does not match; the same state without it is PASS row 8', () => {
  for (const phase of ['pre-closeout', 'pre-link']) {
    const ctrl = stateFor(phase);
    assert.deepEqual([computeOverall(ctrl, phase).overall, computeOverall(ctrl, phase).row], ['PASS', 8], `${phase} control`);
    const s = stateFor(phase, (x) => { x.phaseRunFailure = JSON.parse(JSON.stringify(recordOnly)); });
    const o = computeOverall(s, phase);
    assert.deepEqual([o.overall, o.row], ['FAIL', 3], phase);
    assert.ok(o.reasons.includes('phase-run-failed'), JSON.stringify(o.reasons));
    const rows = evaluateOverallRows(s, phase);
    assert.deepEqual(rows.find((r) => r.row === 8), { row: 8, overall: 'PASS', match: false, reasons: [] }, phase);
    // `null` / absent are the same: not a failed run
    const n = stateFor(phase, (x) => { x.phaseRunFailure = null; });
    assert.deepEqual([computeOverall(n, phase).overall, computeOverall(n, phase).row], ['PASS', 8], `${phase} null`);
  }
});


// ------------------------------------------------------------------------------------------
// v2 (post-C1 truthful history): stage builders. Every builder runs the REAL Node verdict function
// (`applyPhaseRunFailureToState`) on the offline PASS fixture (C1 finalizedSeq 1, gate OPEN at gateSeq 2,
// controls N1..N8 started/terminal at 10/11 .. 24/25).
// ------------------------------------------------------------------------------------------

import {
  makeCheckRecord, checkVerdictLabel, phaseRunFailureShapeProblems, GATE_OUTCOME, DOWNSTREAM_ITEM_NAMES, evaluateC1,
  runChecksInPhaseOrder, buildInitialRunState, applyPhaseRunToState, createCallRecorder, PHASE_ORDER, makeControlRecord, CONTROL_ACCEPTABLE_STATE,
} from './clashpanel-viewerbridge.acceptance.mjs';

const frClone = (v) => JSON.parse(JSON.stringify(v));
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
const FR_PRE = Object.freeze({ name: 'TypeError', message: 'runner threw in P1 before the gate (verdict fixture)', phase: 'P1', activeCheck: null, activeControl: null, operation: null, seq: 5, cleanupEntry: 'marker-allocated' });
/** PRE-C1 failure: Node holds NO gate (no `authoritativeGate`); markers P1 + cleanup only; the page's partial (all PASS) must be ignored. */
function preC1Run(s, over = {}) {
  let n = 100;
  delete s.authoritativeGate;
  s.errorLedger.markers.push({ seq: 0, name: 'P1' }, { seq: 6, name: 'cleanup' });
  applyPhaseRunFailureToState(s, { phaseRunFailure: { ...FR_PRE, ...over }, partial: { checks: frClone(s.checks), controls: frClone(s.controls), extras: {} }, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
/**
 * POST-C1 failure with a PARTIAL history: Node holds the OPEN gate; the page transferred only the records the run had produced
 * (`checks` / `controls` of the fixture); `markers` are the page's marker log; `fail` the page failure (failure `seq` = page-alloc).
 */
function postC1Run(s, { checks = ['C1'], controls = [], markers, fail, partialEdit = () => {} }) {
  let n = 100;
  s.authoritativeGate = frClone(s.gates.C1);
  s.errorLedger.markers.push(...markers);
  const partial = { checks: frClone(pick(s.checks, checks)), controls: frClone(pick(s.controls, controls)), extras: {} };
  partialEdit(partial);
  applyPhaseRunFailureToState(s, { phaseRunFailure: { name: 'TypeError', message: 'runner threw after the gate (verdict fixture)', activeCheck: null, activeControl: null, operation: null, cleanupEntry: 'marker-allocated', ...fail }, partial, eventLog: s.eventLog, spyLedger: s.spyLedger, screenshots: [], stateSnapshots: s.stateSnapshots }, { nextSeq: () => n++ });
  s.sessionTainted = true;
}
/** (2) immediately after the gate opened: only C1 exists; the runner threw still in P1 (seq 3), cleanup marker allocated at 4. */
const postGateOnly = (s) => postC1Run(s, { markers: [{ seq: 0, name: 'P1' }, { seq: 4, name: 'cleanup' }], fail: { phase: 'P1', seq: 3 } });
/** (3)/(4) after P2..P4 ran: C1..C5 + N1 (P2, 10/11) and N6 (P4, 20/21) produced; the runner threw in P4 (seq 30) -- C3 FAIL, C5 NOT_EVIDENCED kept verbatim. */
const P4_MARKERS = Object.freeze([{ seq: 0, name: 'P1' }, { seq: 3, name: 'P2' }, { seq: 12, name: 'P3' }, { seq: 13, name: 'P4' }, { seq: 31, name: 'cleanup' }]);
const postP4 = (s, fail = {}) => postC1Run(s, {
  checks: ['C1', 'C2', 'C3', 'C4', 'C5'], controls: ['N1', 'N6'], markers: frClone(P4_MARKERS), fail: { phase: 'P4', seq: 30, ...fail },
  partialEdit: (p) => { p.checks.C3 = makeCheckRecord({ verdict: 'FAIL', reason: 'ii' }); p.checks.C5 = makeCheckRecord({ verdict: 'NOT_EVIDENCED', reason: 'values-not-captured' }); },
});
const STAGE_BUILDERS = Object.freeze([['pre-c1', (s) => preC1Run(s)], ['post-c1 gate only', postGateOnly], ['post-c1 after P4', (s) => postP4(s)], ['post-c1 all produced', failRun]]);
const blockedByFailure = (c, message) => checkVerdictLabel(c) === 'BLOCKED(phase-run-threw)' && c.evidence.phaseRunFailure.message === message;
const unstartedByFailure = (c) => c.recordType === 'control-run' && c.executionRecord.started === false && c.fields.reason === 'phase-run-threw';
const placeholderSeqs = (s) => CONTROL_NAMES.filter((n) => unstartedByFailure(s.controls[n])).map((n) => s.controls[n].executionRecord.terminalSeq);
/** One defect => its specific problem, via recordSchemaProblems AND failedRunRecordProblems, row 5 record-schema, FAIL. */
function expectDefect(builder, label, mut, expected, { viaFailedRun = typeof expected === 'string' && !expected.startsWith('seq-') } = {}) {
  const s = stateFor('pre-closeout', (x) => { builder(x); mut(x); });
  const probs = recordSchemaProblems(s);
  const hit = typeof expected === 'string' ? probs.includes(expected) : probs.some((p) => expected.test(p));
  assert.ok(hit, `${label}: ${JSON.stringify(probs)}`);
  if (viaFailedRun) assert.ok(failedRunRecordProblems(s).includes(expected), `${label} via failedRunRecordProblems: ${JSON.stringify(failedRunRecordProblems(s))}`);
  assert.equal(computeOverall(s, 'pre-closeout').overall, 'FAIL', label);
  assert.ok(evaluateOverallRows(s, 'pre-closeout').find((r) => r.row === 5).reasons.some((r) => r.startsWith('record-schema:')), label);
  return s;
}

test('FAILED-RUN v2 verdict: every stage builder is the clean baseline its negative cases mutate (schema-clean, failedRunRecordProblems [], row 3 phase-run-failed at both phases, never row 8)', () => {
  for (const [label, b] of STAGE_BUILDERS) {
    for (const phase of ['pre-closeout', 'pre-link']) {
      const s = stateFor(phase, b);
      assert.deepEqual(recordSchemaProblems(s), [], `${label} ${phase}`);
      assert.deepEqual(failedRunRecordProblems(s), [], `${label} ${phase}`);
      assert.deepEqual(primarySeqAllocations(s).problems, [], `${label} ${phase}`);
      const o = computeOverall(s, phase);
      assert.deepEqual([o.overall, o.row], ['FAIL', 3], `${label} ${phase}`);
      assert.ok(o.reasons.includes('phase-run-failed'), `${label}: ${JSON.stringify(o.reasons)}`);
      assert.equal(evaluateOverallRows(s, phase).find((r) => r.row === 8).match, false, `${label} ${phase}`);
    }
  }
});

test('FAILED-RUN v2 verdict: post-C1 record defects (shape / combination / taint / seq uniqueness) each yield their specific problem; a present gate is VALID post-C1', () => {
  assert.deepEqual(recordSchemaProblems(stateFor('pre-closeout', failRun)), [], 'post-c1: gates present is the truthful history, not a violation');
  assert.equal(stateFor('pre-closeout', failRun).gates.C1.outcome, 'OPEN');
  const cases = [
    ['unknown phaseRunFailure key', (s) => { s.phaseRunFailure.extra = 1; }, 'phaseRunFailure.keys'],
    ['missing phaseRunFailure key', (s) => { delete s.phaseRunFailure.cleanupEntry; }, 'phaseRunFailure.keys'],
    ['missing c1Stage key', (s) => { delete s.phaseRunFailure.c1Stage; }, 'phaseRunFailure.keys'],
    ['unknown c1Stage', (s) => { s.phaseRunFailure.c1Stage = 'post-c2'; }, 'phaseRunFailure.c1Stage'],
    ['post-c1 without a gate fact', (s) => { s.phaseRunFailure.gateOutcome = null; }, 'phaseRunFailure.post-c1-gate-fact'],
    ['message > 512 chars', (s) => { s.phaseRunFailure.message = 'm'.repeat(513); }, 'phaseRunFailure.message'],
    ['sessionTainted false', (s) => { s.sessionTainted = false; }, 'failed-run-not-tainted'],
    ['source/realm mismatch', (s) => { s.phaseRunFailure.realm = 'node'; }, 'phaseRunFailure.realm'],
    ['transport source with page-alloc seqSource', (s) => { Object.assign(s.phaseRunFailure, { source: 'node-phase-run-transport', realm: 'node', seqSource: 'page-alloc', cleanupEntry: 'not-entered' }); }, 'phaseRunFailure.transport-combination'],
    ['page source with cleanupEntry not-entered', (s) => { s.phaseRunFailure.cleanupEntry = 'not-entered'; }, 'phaseRunFailure.page-combination'],
    ['failureSeq colliding with a retained control seq', (s) => { s.phaseRunFailure.failureSeq = s.controls.N8.executionRecord.terminalSeq; }, /^seq-not-unique:\d+:/],
  ];
  for (const [label, mut, expected] of cases) expectDefect(failRun, label, mut, expected);
});

test('FAILED-RUN v2 verdict: pre-C1 record defects (gate present / check not blocked / evidence / started control / placeholder reason / seq 0 collision) each yield their specific problem', () => {
  const pass = createOfflineRunStateFixture({ binding: makeBinding() });
  const cases = [
    ['gates present', (s) => { s.gates = frClone(pass.gates); }, 'failed-run-gate-present'],
    ['control terminalSeq 0 collision (pre-fix placeholders)', (s) => { for (const n of CONTROL_NAMES) s.controls[n] = notStartedControlRun(n, 'phase-run-threw'); }, /^seq-not-unique:0:/],
    ['check reason != phase-run-<status>', (s) => { s.checks.C5.reason = 'phase-run-timed-out'; }, 'failed-run-check-not-blocked:C5'],
    ['record status changed (checks still phase-run-threw)', (s) => { s.phaseRunFailure.status = 'timed-out'; }, 'failed-run-check-not-blocked:C1'],
    ['a retained PASS check', (s) => { s.checks.C2 = frClone(pass.checks.C2); }, 'failed-run-check-not-blocked:C2'],
    ['check evidence.phaseRunFailure mismatching', (s) => { s.checks.C9.evidence.phaseRunFailure.message = 'another failure'; }, 'failed-run-check-evidence-mismatch:C9'],
    ['check evidence.phaseRunFailure missing', (s) => { s.checks.C2.evidence = {}; }, 'failed-run-check-evidence-mismatch:C2'],
    ['a started control', (s) => { s.controls.N3 = frClone(pass.controls.N3); }, 'failed-run-control-not-unstarted:N3'],
    ['control placeholder reason mismatching the failure', (s) => { s.controls.N2.fields.reason = 'phase-run-timed-out'; }, 'failed-run-control-reason-mismatch:N2'],
    ['failureSeq colliding with a control placeholder seq', (s) => { s.phaseRunFailure.failureSeq = s.controls.N1.executionRecord.terminalSeq; }, /^seq-not-unique:\d+:/],
    ['pre-c1 carrying a gate fact', (s) => { s.phaseRunFailure.gateSeq = 2; }, 'phaseRunFailure.pre-c1-gate-fact'],
  ];
  for (const [label, mut, expected] of cases) expectDefect((x) => preC1Run(x), label, mut, expected);
  // the seq collision is a real primary-allocation collision, not a schema technicality
  const z = stateFor('pre-closeout', (x) => { preC1Run(x); for (const n of CONTROL_NAMES) x.controls[n] = notStartedControlRun(n, 'phase-run-threw'); });
  assert.ok(primarySeqAllocations(z).problems.filter((p) => p.startsWith('seq-not-unique:0:')).length >= CONTROL_NAMES.length - 1);
});

test('FAILED-RUN CLOSEOUT verdict: the gate waiver is NOT global -- a non-failed state without gates still yields gates-missing (and C1 finalization stays required); a PRE-C1 failed state waives only those and still reports every other record problem; a POST-C1 failed state waives nothing (C1 finalization required)', () => {
  const nonFailed = stateFor('pre-closeout', (s) => { s.gates = null; });
  assert.ok(recordSchemaProblems(nonFailed).includes('gates-missing'));
  const nullFailure = stateFor('pre-closeout', (s) => { s.gates = null; s.phaseRunFailure = null; });
  assert.ok(recordSchemaProblems(nullFailure).includes('gates-missing'), 'phaseRunFailure: null is not a failed run');
  const noFinal = stateFor('pre-closeout', (s) => { delete s.checks.C1.finalizedSeq; delete s.checks.C1.finalizedAt; });
  assert.ok(recordSchemaProblems(noFinal).some((p) => p.startsWith('checks.C1:')), JSON.stringify(recordSchemaProblems(noFinal)));
  const failed = stateFor('pre-closeout', (s) => preC1Run(s));
  assert.equal(failed.gates, null);
  assert.equal(recordSchemaProblems(failed).includes('gates-missing'), false);
  assert.equal(recordSchemaProblems(failed).some((p) => p.startsWith('checks.C1:')), false, 'C1 finalization waived for the pre-C1 failed run');
  // ... but nothing else is waived: an attribution defect and an unknown check are still reported
  const attr = stateFor('pre-closeout', (s) => { preC1Run(s); s.eventLog.push({ seq: 500, kind: 'x' }); s.checks.C99 = s.checks.C2; });
  const probs = recordSchemaProblems(attr);
  assert.ok(probs.includes('checks.unknown:C99'), JSON.stringify(probs));
  assert.ok(probs.some((p) => /eventLog/.test(p)), JSON.stringify(probs));
  // post-C1: the gate is present, so the retained C1 must be finalized like on any gated run
  const post = stateFor('pre-closeout', (s) => { postGateOnly(s); delete s.checks.C1.finalizedSeq; delete s.checks.C1.finalizedAt; });
  assert.ok(recordSchemaProblems(post).some((p) => p.startsWith('checks.C1:')), JSON.stringify(recordSchemaProblems(post)));
});

test('FAILED-RUN v2 (1) pre-C1: truthful pre-C1 evidence -- c1Stage pre-c1, no gate fact, gates null, every check BLOCKED(phase-run-threw) with the exact failure, every control a not-started placeholder with a unique real Node seq, the page partial (all PASS) ignored; schema-clean; row 3', () => {
  const s = stateFor('pre-closeout', (x) => preC1Run(x));
  const f = s.phaseRunFailure;
  assert.deepEqual([f.c1Stage, f.gateSeq, f.gateOutcome, f.failureSeq, f.seqSource, f.phase], ['pre-c1', null, null, 5, 'page-alloc', 'P1']);
  assert.equal(s.gates, null);
  assert.ok(CHECK_NAMES.every((n) => blockedByFailure(s.checks[n], FR_PRE.message)), 'every check BLOCKED, the PASS partial was ignored');
  assert.ok(CONTROL_NAMES.every((n) => unstartedByFailure(s.controls[n])));
  const seqs = placeholderSeqs(s);
  assert.equal(new Set(seqs).size, CONTROL_NAMES.length);
  assert.ok(seqs.every((q) => q >= 100), 'real Node seqs, never 0');
  assert.deepEqual(phaseRunFailureShapeProblems(f), []);
  assert.deepEqual(recordSchemaProblems(s), []);
  assert.deepEqual([computeOverall(s, 'pre-closeout').overall, computeOverall(s, 'pre-closeout').row], ['FAIL', 3]);
});

test('FAILED-RUN v2 (1) pre-C1 contradictions: a downstream marker (P2) => failed-run-pre-c1-downstream-marker; downstream-attributed eventLog / spyLedger / stateSnapshots history => failed-run-pre-c1-downstream-history; a gate => failed-run-gate-present; P1 / cleanup history stays legal', () => {
  const A = (o) => ({ phase: 'P1', activeCheck: null, activeControl: null, ...o });
  expectDefect((x) => preC1Run(x), 'P2 marker', (s) => { s.errorLedger.markers.splice(1, 0, { seq: 4, name: 'P2' }); }, 'failed-run-pre-c1-downstream-marker');
  expectDefect((x) => preC1Run(x), 'P3 event', (s) => { s.eventLog.push(A({ seq: 3, kind: 'x', phase: 'P3' })); }, 'failed-run-pre-c1-downstream-history');
  expectDefect((x) => preC1Run(x), 'P7 spy', (s) => { s.spyLedger.push(A({ seq: 3, method: 'viewer.isolate', phase: 'P7' })); }, 'failed-run-pre-c1-downstream-history');
  expectDefect((x) => preC1Run(x), 'P2 snapshot', (s) => { s.stateSnapshots.push(A({ seq: 3, phase: 'P2' })); }, 'failed-run-pre-c1-downstream-history');
  expectDefect((x) => preC1Run(x), 'gate', (s) => { s.gates = frClone(createOfflineRunStateFixture({ binding: makeBinding() }).gates); }, 'failed-run-gate-present');
  // non-vacuity controls: the same additions attributed to P1 / cleanup are legal pre-C1 history
  const ok = stateFor('pre-closeout', (s) => { preC1Run(s); s.eventLog.push(A({ seq: 3, kind: 'x' })); s.spyLedger.push(A({ seq: 4, method: 'viewer.isolate' })); s.stateSnapshots.push(A({ seq: 7, phase: 'cleanup' })); });
  assert.deepEqual(failedRunRecordProblems(ok), []);
  assert.deepEqual(recordSchemaProblems(ok), []);
});

test('FAILED-RUN v2 (2) post-C1 immediately after the gate opened: only C1 retained (verbatim), gates == Node authoritativeGate, gate fact recorded, every other check BLOCKED(phase-run-threw), every control unstarted with a unique real seq; schema-clean; row 3; a partial C1 contradicting the gate => post-c1-untransferred (gates null, nothing kept)', () => {
  const pass = createOfflineRunStateFixture({ binding: makeBinding() });
  const s = stateFor('pre-closeout', postGateOnly);
  const f = s.phaseRunFailure;
  assert.deepEqual([f.c1Stage, f.gateSeq, f.gateOutcome, f.failureSeq], ['post-c1', 2, 'OPEN', 3]);
  assert.deepEqual(s.gates, { C1: s.authoritativeGate });
  assert.deepEqual(s.gates.C1, pass.gates.C1);
  assert.deepEqual(s.checks.C1, pass.checks.C1, 'C1 kept verbatim');
  assert.ok(CHECK_NAMES.filter((n) => n !== 'C1').every((n) => blockedByFailure(s.checks[n], 'runner threw after the gate (verdict fixture)')));
  assert.ok(CONTROL_NAMES.every((n) => unstartedByFailure(s.controls[n])));
  assert.equal(new Set(placeholderSeqs(s)).size, CONTROL_NAMES.length);
  assert.ok(placeholderSeqs(s).every((q) => q > f.failureSeq));
  assert.deepEqual(recordSchemaProblems(s), []);
  assert.deepEqual([computeOverall(s, 'pre-closeout').overall, computeOverall(s, 'pre-closeout').row], ['FAIL', 3]);
  // a transferred C1 that contradicts Node's gate (verdict / finalizedSeq) or is missing: NOT usable => untransferred, nothing kept
  for (const [label, edit] of [['C1 verdict', (p) => { p.checks.C1.verdict = 'FAIL'; p.checks.C1.reason = 'x'; }], ['C1 finalizedSeq', (p) => { p.checks.C1.finalizedSeq = 9; }], ['no C1', (p) => { delete p.checks.C1; }]]) {
    const u = stateFor('pre-closeout', (x) => postC1Run(x, { markers: [{ seq: 0, name: 'P1' }, { seq: 4, name: 'cleanup' }], fail: { phase: 'P1', seq: 3 }, partialEdit: edit }));
    assert.deepEqual([u.phaseRunFailure.c1Stage, u.phaseRunFailure.gateSeq, u.phaseRunFailure.gateOutcome, u.gates], ['post-c1-untransferred', 2, 'OPEN', null], label);
    assert.ok(CHECK_NAMES.every((n) => blockedByFailure(u.checks[n], 'runner threw after the gate (verdict fixture)')), label);
    assert.deepEqual(recordSchemaProblems(u), [], label);
  }
});

test('FAILED-RUN v2 (3) post-C1 after checks ran: every check-run the run had produced is kept VERBATIM incl. its verdict (C1..C2 PASS, C3 FAIL, C4 PASS, C5 NOT_EVIDENCED); only the rest are BLOCKED(phase-run-threw); an INVALID transferred record is never kept (fail closed)', () => {
  const pass = createOfflineRunStateFixture({ binding: makeBinding() });
  const s = stateFor('pre-closeout', (x) => postP4(x));
  assert.equal(s.phaseRunFailure.c1Stage, 'post-c1');
  assert.deepEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map((n) => checkVerdictLabel(s.checks[n])), ['PASS', 'PASS', 'FAIL(ii)', 'PASS', 'NOT_EVIDENCED(values-not-captured)']);
  assert.deepEqual(s.checks.C1, pass.checks.C1);
  assert.deepEqual(s.checks.C3, makeCheckRecord({ verdict: 'FAIL', reason: 'ii' }));
  assert.ok(CHECK_NAMES.slice(5).every((n) => blockedByFailure(s.checks[n], 'runner threw after the gate (verdict fixture)')), 'C6..C20 blocked');
  assert.deepEqual(recordSchemaProblems(s), []);
  const o = computeOverall(s, 'pre-closeout');
  assert.deepEqual([o.overall, o.row], ['FAIL', 3]);
  assert.ok(o.reasons.includes('phase-run-failed'), JSON.stringify(o.reasons));
  // an invalid transferred record (unknown verdict) is replaced by the failure's BLOCKED record, never kept / never PASS
  const bad = stateFor('pre-closeout', (x) => postC1Run(x, { checks: ['C1', 'C2'], markers: frClone(P4_MARKERS), fail: { phase: 'P4', seq: 30 }, partialEdit: (p) => { p.checks.C2.verdict = 'MAYBE'; } }));
  assert.ok(blockedByFailure(bad.checks.C2, 'runner threw after the gate (verdict fixture)'));
  assert.deepEqual(recordSchemaProblems(bad), []);
});

test('FAILED-RUN v2 (4) post-C1 after a control ran: executed control-runs N1 / N6 kept with their start/terminal seqs and states; the others are unstarted placeholders with unique real seqs (no collision with the kept ones); executed control terminal after failureSeq => failed-run-control-after-failure', () => {
  const pass = createOfflineRunStateFixture({ binding: makeBinding() });
  const s = stateFor('pre-closeout', (x) => postP4(x));
  for (const n of ['N1', 'N6']) {
    assert.deepEqual(s.controls[n], pass.controls[n], `${n} kept verbatim`);
    assert.equal(s.controls[n].executionRecord.started, true);
  }
  assert.deepEqual([s.controls.N1.executionRecord.startSeq, s.controls.N1.executionRecord.terminalSeq, s.controls.N6.executionRecord.startSeq, s.controls.N6.executionRecord.terminalSeq], [10, 11, 20, 21]);
  const others = CONTROL_NAMES.filter((n) => n !== 'N1' && n !== 'N6');
  assert.ok(others.every((n) => unstartedByFailure(s.controls[n])));
  const seqs = placeholderSeqs(s);
  assert.equal(seqs.length, others.length);
  assert.equal(new Set([...seqs, 10, 11, 20, 21]).size, seqs.length + 4);
  assert.deepEqual(primarySeqAllocations(s).problems, []);
  assert.deepEqual(recordSchemaProblems(s), []);
  // negative: the failure is placed before N6 terminated (its retained terminalSeq 21)
  expectDefect((x) => postP4(x), 'failure before N6 terminal', (x) => { x.phaseRunFailure.failureSeq = 15; x.phaseRunFailure.phase = 'P4'; }, 'failed-run-control-after-failure:N6');
  // non-vacuity: Node never rewrites an executed control to a placeholder (pre-fix v1 behaviour) -- that would be a schema-valid lie, so assert identity
  assert.notDeepEqual(s.controls.N1, notStartedControlRun('N1', 'phase-run-threw', { seq: s.controls.N1.executionRecord.terminalSeq, at: s.controls.N1.executionRecord.terminalAt }));
});

test('FAILED-RUN v2 (5) not-yet-started work gets only the legal representation: a blocked check / unstarted control must carry no attributed history (except the in-flight activeCheck / activeControl before failureSeq); evidence must be the failure', () => {
  const A = (o) => ({ seq: 25, kind: 'x', phase: 'P4', activeCheck: null, activeControl: null, ...o });
  expectDefect((x) => postP4(x), 'C9 blocked with history', (s) => { s.eventLog.push(A({ activeCheck: 'C9' })); }, 'failed-run-blocked-check-has-history:C9');
  expectDefect((x) => postP4(x), 'N4 unstarted with spy history', (s) => { s.spyLedger.push(A({ method: 'viewer.isolate', activeControl: 'N4' })); }, 'failed-run-unstarted-control-has-history:N4');
  expectDefect((x) => postP4(x), 'C9 blocked evidence mismatch', (s) => { s.checks.C9.evidence.phaseRunFailure.message = 'another failure'; }, 'failed-run-check-evidence-mismatch:C9');
  // the in-flight items: history BEFORE the failure is legal; history AFTER it is a provenance contradiction
  const inFlight = stateFor('pre-closeout', (x) => { postP4(x, { activeCheck: 'C6', activeControl: 'N2' }); x.eventLog.push(A({ activeCheck: 'C6', activeControl: 'N2' })); });
  assert.deepEqual(failedRunRecordProblems(inFlight), []);
  assert.deepEqual(recordSchemaProblems(inFlight), []);
  expectDefect((x) => postP4(x, { activeCheck: 'C6' }), 'in-flight check history after failure', (s) => { s.eventLog.push(A({ seq: 40, phase: 'cleanup', activeCheck: 'C6' })); }, 'failed-run-seq-before-referenced-start');
  expectDefect((x) => postP4(x, { activeControl: 'N2' }), 'in-flight control history after failure', (s) => { s.stateSnapshots.push(A({ seq: 40, phase: 'cleanup', activeControl: 'N2' })); }, 'failed-run-seq-before-referenced-start');
});

/** A REAL closed-gate run (runner + B classifier CONTRADICTORY => C1 BLOCKED(prerequisite) => CLOSED_DEPENDENCY_BLOCKED), merged into a full state. */
async function closedGateState() {
  const M = { loaded: true, classification: 'CONFIRMED_SVF2', inAllModels: true };
  const c1 = evaluateC1({ A: M, B: { ...M, classification: 'CONTRADICTORY' }, loadedCount: 2 });
  const d = {};
  for (const p of PHASE_ORDER) {
    d[p.id] = async ({ runnable, beginControl }) => {
      if (p.id === 'P1') return { checks: { C1: c1 } };
      for (const n of runnable.controls) beginControl(n);
      return { checks: Object.fromEntries(runnable.checks.map((c) => [c, makeCheckRecord({ verdict: 'PASS' })])), controls: Object.fromEntries(runnable.controls.map((n) => [n, makeControlRecord(n, CONTROL_ACCEPTABLE_STATE[n])])) };
    };
  }
  const recorder = createCallRecorder();
  const r = await runChecksInPhaseOrder({ drivers: d, recorder });
  const binding = makeBinding();
  const st = buildInitialRunState({ binding, validation: { record: null, candidateSet: null }, startedAt: '2026-09-30T00:00:01.000Z' });
  applyPhaseRunToState(st, { checks: r.checks, controls: r.controls, extras: r.extras, c1FinalizedEvent: r.c1FinalizedEvent, gates: r.gates, markers: r.markers, eventLog: r.eventLog, spyLedger: recorder.records, stateSnapshots: [] });
  st.journal = journalWith(binding, ['AUTH_BOUND', 'ATTEMPT_CONSUMED']);
  return st;
}

test('FAILED-RUN v2 (5) CLOSED gate: a failure after a CLOSED C1 gate is post-c1-untransferred (Node-made gate-dispositions cannot satisfy G-e) -- gate fact kept in gateSeq/gateOutcome, gates null, every check BLOCKED, every control unstarted, NO gate-disposition record; schema-clean; row 3', async () => {
  const st = await closedGateState();
  assert.deepEqual(recordSchemaProblems(st), [], 'the closed-gate baseline is clean');
  const gate = frClone(st.gates.C1);
  assert.equal(gate.outcome, GATE_OUTCOME.CLOSED_DEPENDENCY_BLOCKED);
  assert.ok(DOWNSTREAM_ITEM_NAMES.every((n) => (st.checks[n] || st.controls[n]).recordType === 'gate-disposition'), 'baseline: the runner emitted its dispositions');
  const cleanupSeq = st.errorLedger.markers.find((m) => m.name === 'cleanup').seq;
  let n = 1000;
  st.authoritativeGate = gate;
  // the page partial carries C1 (agreeing with the gate) AND the runner's own dispositions: neither may be kept
  applyPhaseRunFailureToState(st, { phaseRunFailure: { name: 'Error', message: 'threw after the closed gate', phase: 'cleanup', activeCheck: null, activeControl: null, operation: null, seq: cleanupSeq + 1, cleanupEntry: 'marker-reused' }, partial: { checks: frClone(st.checks), controls: frClone(st.controls), extras: {} }, eventLog: st.eventLog, spyLedger: st.spyLedger, screenshots: [], stateSnapshots: st.stateSnapshots }, { nextSeq: () => n++ });
  st.sessionTainted = true;
  const f = st.phaseRunFailure;
  assert.deepEqual([f.c1Stage, f.gateSeq, f.gateOutcome], ['post-c1-untransferred', gate.gateSeq, 'CLOSED_DEPENDENCY_BLOCKED']);
  assert.equal(st.gates, null);
  assert.ok(CHECK_NAMES.every((c) => blockedByFailure(st.checks[c], 'threw after the closed gate')));
  assert.ok(CONTROL_NAMES.every((c) => unstartedByFailure(st.controls[c])));
  assert.equal([...Object.values(st.checks), ...Object.values(st.controls)].filter((r) => r.recordType === 'gate-disposition').length, 0);
  assert.deepEqual(recordSchemaProblems(st), []);
  assert.deepEqual(failedRunRecordProblems(st), []);
  assert.deepEqual([computeOverall(st, 'pre-closeout').overall, computeOverall(st, 'pre-closeout').row], ['FAIL', 3]);
  // contradiction: claiming post-c1 over that untransferred state (no gate) is rejected
  const forged = frClone(st);
  forged.phaseRunFailure.c1Stage = 'post-c1';
  assert.ok(failedRunRecordProblems(forged).includes('failed-run-post-c1-without-gate'));
});

test('FAILED-RUN v2 (6) the failure references an invalid control: unknown name N9 => phaseRunFailure.activeControl; a control that does not exist in the record set => failed-run-active-control-missing; an already-terminal executed control => failed-run-active-control-already-terminal; an unfinished control is legal', () => {
  expectDefect((x) => postP4(x), 'N9', (s) => { s.phaseRunFailure.activeControl = 'N9'; }, 'phaseRunFailure.activeControl');
  expectDefect((x) => postP4(x), 'N1 already terminal', (s) => { s.phaseRunFailure.activeControl = 'N1'; }, 'failed-run-active-control-already-terminal');
  expectDefect((x) => postP4(x), 'N6 already terminal', (s) => { s.phaseRunFailure.activeControl = 'N6'; }, 'failed-run-active-control-already-terminal');
  expectDefect((x) => postP4(x, { activeControl: 'N3' }), 'N3 missing', (s) => { delete s.controls.N3; }, 'failed-run-active-control-missing');
  // the page-side value is never trusted: Node maps an unknown name to null on the record
  const coerced = stateFor('pre-closeout', (x) => postP4(x, { activeControl: 'N9' }));
  assert.equal(coerced.phaseRunFailure.activeControl, null);
  const legal = stateFor('pre-closeout', (x) => postP4(x, { activeControl: 'N3' }));
  assert.equal(legal.phaseRunFailure.activeControl, 'N3');
  assert.deepEqual(failedRunRecordProblems(legal), []);
});

test('FAILED-RUN v2 (7) operation provenance: operationId unknown to opLedger => failed-run-operation-unknown; a different operationType => failed-run-operation-type-mismatch; failureSeq not after the operation startSeq => failed-run-seq-before-operation-start; a matching record is clean', () => {
  const OP = { operationId: 'op-7', operationType: 'mutation', reason: 'viewer.isolate rejected' };
  const withOp = (ledger) => stateFor('pre-closeout', (x) => { postP4(x, { operation: { ...OP } }); x.errorLedger.opLedger = ledger; });
  const rec = (o) => ({ recordType: 'mutation', operationId: 'op-7', operationType: 'mutation', phase: 'P4', invokedBy: 'C4', startSeq: 22, ...o });
  const op = withOp([rec()]);
  assert.deepEqual(op.phaseRunFailure.operation, OP, 'the thrown operation detail is retained on the record');
  assert.deepEqual(failedRunRecordProblems(op), [], 'matching opLedger record');
  assert.ok(failedRunRecordProblems(withOp([])).includes('failed-run-operation-unknown'));
  assert.ok(failedRunRecordProblems(withOp([rec({ operationId: 'op-8' })])).includes('failed-run-operation-unknown'));
  assert.ok(failedRunRecordProblems(withOp([rec({ operationType: 'load' })])).includes('failed-run-operation-type-mismatch'));
  assert.ok(failedRunRecordProblems(withOp([rec({ startSeq: 30 })])).includes('failed-run-seq-before-operation-start'), 'start == failureSeq');
  assert.ok(failedRunRecordProblems(withOp([rec({ startSeq: 35 })])).includes('failed-run-seq-before-operation-start'));
  // an operation without an id is not cross-validated (nothing to look up); a null operation neither
  const noId = stateFor('pre-closeout', (x) => postP4(x, { operation: { operationType: 'mutation', reason: 'x' } }));
  assert.deepEqual(failedRunRecordProblems(noId), []);
});

test('FAILED-RUN v2 (8) invalid failureSeq provenance: before the gate, before an executed control terminal, a phase marker after the failure, cleanup-marker order (allocated vs reused), a closeout marker before the failure, page-alloc phase != last marker, cleanup marker count', () => {
  expectDefect(failRun, 'failureSeq before gateSeq', (s) => { s.phaseRunFailure.failureSeq = 1; }, 'failed-run-seq-before-gate');
  expectDefect((x) => postP4(x), 'failureSeq before N1 terminal', (s) => { s.phaseRunFailure.failureSeq = 9; s.phaseRunFailure.phase = 'P2'; }, 'failed-run-control-after-failure:N1');
  expectDefect(failRun, 'phase marker after failure', (s) => { s.errorLedger.markers.splice(1, 0, { seq: 92, name: 'P10' }); }, 'failed-run-marker-after-failure:P10');
  expectDefect(failRun, 'marker-allocated but cleanup marker before failure', (s) => { s.errorLedger.markers.find((m) => m.name === 'cleanup').seq = 85; }, 'failed-run-cleanup-marker-order');
  expectDefect(failRun, 'marker-reused but cleanup marker after failure', (s) => { s.phaseRunFailure.cleanupEntry = 'marker-reused'; }, 'failed-run-cleanup-marker-order');
  expectDefect(failRun, 'closeout marker before failure', (s) => { s.errorLedger.markers.push({ seq: 89, name: 'closeout' }); }, 'failed-run-closeout-marker-before-failure');
  expectDefect(failRun, 'page-alloc phase != last marker', (s) => { s.phaseRunFailure.phase = 'P10'; }, 'failed-run-phase-marker-mismatch');
  expectDefect(failRun, 'second cleanup marker', (s) => { s.errorLedger.markers.push({ seq: 96, name: 'cleanup' }); }, 'failed-run-cleanup-marker-count');
  expectDefect(failRun, 'no cleanup marker', (s) => { s.errorLedger.markers = s.errorLedger.markers.filter((m) => m.name !== 'cleanup'); }, 'failed-run-cleanup-marker-count');
  // valid controls for the same rules: marker-reused with the cleanup marker BEFORE the failure; closeout after it
  const reused = stateFor('pre-closeout', (s) => { failRun(s); s.phaseRunFailure.cleanupEntry = 'marker-reused'; s.errorLedger.markers.find((m) => m.name === 'cleanup').seq = 85; s.phaseRunFailure.phase = 'cleanup'; s.errorLedger.markers.push({ seq: 200, name: 'closeout' }); });
  assert.deepEqual(failedRunRecordProblems(reused), []);
  // the phase rule binds only page-alloc failures: a node-observed transport record is not phase-checked against page markers
  const transport = stateFor('pre-closeout', (s) => { failRun(s); Object.assign(s.phaseRunFailure, { source: 'node-phase-run-transport', realm: 'node', seqSource: 'node-observed', cleanupEntry: 'not-entered', phase: 'P10', c1Stage: 'post-c1-untransferred' }); });
  assert.equal(failedRunRecordProblems(transport).includes('failed-run-phase-marker-mismatch'), false);
});

test('FAILED-RUN v2 (9) stage flag vs history contradictions: post-c1 with gates null => failed-run-post-c1-without-gate; post-c1 record gate fact != gates.C1 => failed-run-gate-mismatch; pre-c1 / post-c1-untransferred with a gate => failed-run-gate-present; untransferred claims nothing downstream', () => {
  expectDefect(failRun, 'post-c1, gates nulled', (s) => { s.gates = null; }, 'failed-run-post-c1-without-gate');
  expectDefect(failRun, 'post-c1, gateSeq mismatch', (s) => { s.phaseRunFailure.gateSeq = 3; }, 'failed-run-gate-mismatch');
  expectDefect(failRun, 'post-c1, gateOutcome mismatch', (s) => { s.phaseRunFailure.gateOutcome = 'CLOSED_OTHER'; }, 'failed-run-gate-mismatch');
  expectDefect(failRun, 'post-c1 flipped to pre-c1 (gate kept)', (s) => { Object.assign(s.phaseRunFailure, { c1Stage: 'pre-c1', gateSeq: null, gateOutcome: null }); }, 'failed-run-gate-present');
  const flipped = stateFor('pre-closeout', (s) => { failRun(s); s.phaseRunFailure.c1Stage = 'post-c1-untransferred'; });
  for (const p of ['failed-run-gate-present', 'failed-run-check-not-blocked:C2', 'failed-run-control-not-unstarted:N1']) assert.ok(failedRunRecordProblems(flipped).includes(p), `${p}: ${JSON.stringify(failedRunRecordProblems(flipped))}`);
  expectDefect((x) => preC1Run(x), 'pre-c1 flipped to post-c1 (no gate)', (s) => { Object.assign(s.phaseRunFailure, { c1Stage: 'post-c1', gateSeq: 2, gateOutcome: 'OPEN' }); }, 'failed-run-post-c1-without-gate');
  // Node decides the stage from ITS gate only: a gate without any transfer (no partial) => untransferred, schema-clean
  const u = stateFor('pre-closeout', (x) => { x.authoritativeGate = frClone(x.gates.C1); x.errorLedger.markers.push({ seq: 0, name: 'P1' }, { seq: 4, name: 'cleanup' }); let n = 100; applyPhaseRunFailureToState(x, { phaseRunFailure: { ...FR_PRE, seq: 3 }, eventLog: x.eventLog, spyLedger: x.spyLedger, screenshots: [], stateSnapshots: x.stateSnapshots }, { nextSeq: () => n++ }); x.sessionTainted = true; });
  assert.deepEqual([u.phaseRunFailure.c1Stage, u.phaseRunFailure.gateSeq, u.gates], ['post-c1-untransferred', 2, null]);
  assert.deepEqual(recordSchemaProblems(u), []);
  const withGate = frClone(u);
  withGate.gates = { C1: frClone(u.authoritativeGate) };
  assert.ok(failedRunRecordProblems(withGate).includes('failed-run-gate-present'), 'untransferred must not carry the gate in gates');
  assert.ok(recordSchemaProblems(withGate).includes('failed-run-gate-present'));
});

test('FAILED-RUN v2: post-C1 rejects a check / control carrying a FOREIGN phase-run-<x> reason, a flipped status, and a post-c1 record whose gate is not OPEN', () => {
  const probs = (mut) => failedRunRecordProblems(stateFor('pre-closeout', (x) => { postP4(x); mut(x); }));
  assert.ok(probs((s) => { s.phaseRunFailure.status = 'timed-out'; }).some((p) => p.startsWith('failed-run-check-foreign-reason:')), 'status flipped, items still phase-run-threw');
  assert.ok(probs((s) => { s.checks.C9.reason = 'phase-run-timed-out'; }).includes('failed-run-check-foreign-reason:C9'), 'check with a foreign phase-run reason');
  assert.ok(probs((s) => { s.controls.N3.fields.reason = 'phase-run-timed-out'; }).includes('failed-run-control-foreign-reason:N3'), 'placeholder with a foreign phase-run reason');
  assert.ok(probs((s) => { s.phaseRunFailure.gateOutcome = 'CLOSED_OTHER'; }).includes('failed-run-post-c1-gate-not-open'), 'post-c1 can only describe an OPEN gate');
  assert.deepEqual(probs(() => {}), [], 'baseline clean');
});
