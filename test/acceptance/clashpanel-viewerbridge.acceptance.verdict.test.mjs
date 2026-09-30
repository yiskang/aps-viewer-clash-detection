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
  const r = both((s) => { s.checks.C7.verdict = 'FAIL'; s.checks.C1.verdict = 'BLOCKED(prerequisite)'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 3]);
});

test('X2: N3 NOT_DETECTED + integrity CAPTURE_UNAVAILABLE => row 4 before row 6 => FAIL', () => {
  const r = both((s) => { s.controls.N3.state = 'NOT_DETECTED'; s.script.integrityResult = 'CAPTURE_UNAVAILABLE'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 4]);
});

test('X3: cleanupUnresolvedOwnership + integrity PROVENANCE_AMBIGUOUS => row 2 before row 6 => FAIL', () => {
  const r = both((s) => { s.cleanupUnresolvedOwnership = true; s.script.integrityResult = 'PROVENANCE_AMBIGUOUS'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['FAIL', 2]);
});

test('X4: classifier CONTRADICTORY for B, all dependents BLOCKED, nothing else wrong => row 6 BLOCKED', () => {
  const r = both((s) => {
    s.classifier.B = 'CONTRADICTORY';
    for (const n of ['C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20']) s.checks[n].verdict = 'BLOCKED(prerequisite)';
  });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['BLOCKED', 6]);
});

test('X6: C6 NOT_EVIDENCED with N2 NOT_DISCRIMINATING, everything else PASS => row 7 PARTIAL', () => {
  const r = both((s) => { s.checks.C6.verdict = 'NOT_EVIDENCED(not-discriminating)'; s.controls.N2.state = 'NOT_DISCRIMINATING'; });
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
    s.checks.C4.verdict = 'FAIL(not-contained)';
    s.sessionTainted = true;
    for (const n of ['C5', 'C6', 'C7']) s.checks[n].verdict = 'BLOCKED(session-tainted)';
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
  const pre = computeOverall(stateFor('pre-closeout', (x) => { x.checks.C20.verdict = 'NOT_EVIDENCED(unstable-frame)'; }), 'pre-closeout');
  assert.deepEqual([pre.overall, pre.row], ['PARTIAL', 7]);
  const link = computeOverall(stateFor('pre-link', (x) => { x.checks.C20.verdict = 'NOT_EVIDENCED(unstable-frame)'; }, { closeout: { closeoutFailures: ['r1-write'], r1Verified: false } }), 'pre-link');
  assert.deepEqual([link.overall, link.row], ['FAIL', 5]);
});

test('X13: all PASS; optional artifacts are not an input of computeOverall (O1 absent / O2 failed never matter)', () => {
  const x = both((s) => { s.screenshots = []; s.limitations = ['O1 raw log absent (external)']; });
  assert.deepEqual([x.pre.row, x.link.row], [8, 8]);
});

test('X14: all PASS except C20 NOT_EVIDENCED(unstable-frame) => row 7 PARTIAL (never PASS)', () => {
  const r = both((s) => { s.checks.C20.verdict = 'NOT_EVIDENCED(unstable-frame)'; });
  for (const x of [r.pre, r.link]) assert.deepEqual([x.overall, x.row], ['PARTIAL', 7]);
});

// ------------------------------------------------------------------------------------------
// Controls (§7) and fail-closed inputs
// ------------------------------------------------------------------------------------------

test('controls: §7 allowed/acceptable states; NOT_APPLICABLE is partial only while its check is not PASS', () => {
  const pass = Object.fromEntries(CHECK_NAMES.map((n) => [n, 'PASS']));
  assert.equal(controlDisposition('N1', { state: 'DETECTED' }, pass), 'acceptable');
  assert.equal(controlDisposition('N1', { state: 'NOT_DETECTED' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N2', { state: 'NOT_DISCRIMINATING' }, pass), 'partial');
  assert.equal(controlDisposition('N3', { state: 'NOT_DISCRIMINATING' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N6', { state: 'NOT_APPLICABLE' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N6', { state: 'NOT_APPLICABLE' }, { ...pass, C4: 'NOT_EVIDENCED' }), 'partial');
  assert.equal(controlDisposition('N8', { state: 'NOT_APPLICABLE' }, pass), 'unacceptable');
  assert.equal(controlDisposition('N8', { state: 'NOT_APPLICABLE' }, { ...pass, C20: 'NOT_EVIDENCED' }), 'partial');
  assert.equal(controlDisposition('N8', { state: 'NOT_DISCRIMINATING' }, pass), 'partial');
  for (const n of CONTROL_NAMES) {
    assert.equal(controlDisposition(n, { state: 'BOGUS' }, pass), 'unacceptable', n);
    assert.equal(controlDisposition(n, undefined, pass), 'unacceptable', n);
  }
  for (const st of ['RESTORE_FAILED', 'TIMED_OUT', 'NOT_EXECUTABLE']) assert.equal(controlDisposition('N4', { state: st }, pass), 'unacceptable', st);
  // N6 NOT_APPLICABLE while C4 PASS => row 4; while C4 NOT_EVIDENCED => row 7
  assert.equal(computeOverall(stateFor('pre-closeout', (s) => { s.controls.N6.state = 'NOT_APPLICABLE'; }), 'pre-closeout').row, 4);
  assert.equal(computeOverall(stateFor('pre-closeout', (s) => { s.controls.N6.state = 'NOT_APPLICABLE'; s.checks.C4.verdict = 'NOT_EVIDENCED(near-tolerance)'; }), 'pre-closeout').row, 7);
});

test('check verdict parsing: bare or parameterised enum values only', () => {
  assert.equal(checkVerdictBase({ verdict: 'BLOCKED(timeout:load)' }), 'BLOCKED');
  assert.equal(checkVerdictBase('NOT_EVIDENCED(unstable-frame)'), 'NOT_EVIDENCED');
  assert.equal(checkVerdictBase({ verdict: 'PASS' }), 'PASS');
  for (const bad of ['pass', 'OK', 'FAIL(', 'BLOCKED(x', '', null, undefined, 3, {}]) assert.equal(checkVerdictBase(typeof bad === 'string' ? { verdict: bad } : bad), null, String(bad));
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
    ['cleanup step failed but resolved', (s) => { s.cleanupFailures = ['closePage']; }, 7],
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
    if (c.cleanup === 'resolved') s.cleanupFailures = ['unloadModelA'];
    if (c.cleanup === 'unresolved') s.cleanupUnresolvedOwnership = true;
    if (c.checks === 'fail') s.checks.C7.verdict = 'FAIL';
    if (c.checks === 'blocked') s.checks.C1.verdict = 'BLOCKED(timeout:load)';
    if (c.checks === 'not-evidenced') s.checks.C20.verdict = 'NOT_EVIDENCED(no-change-observed)';
    if (c.controls === 'n1-not-detected') s.controls.N1.state = 'NOT_DETECTED';
    if (c.controls === 'n2-not-discriminating') s.controls.N2.state = 'NOT_DISCRIMINATING';
    if (c.controls === 'n6-na-while-c4-pass') s.controls.N6.state = 'NOT_APPLICABLE';
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
