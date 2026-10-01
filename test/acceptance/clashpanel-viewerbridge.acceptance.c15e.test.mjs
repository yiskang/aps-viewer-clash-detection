// test/acceptance/clashpanel-viewerbridge.acceptance.c15e.test.mjs
//
// Offline tests for procedure §C15(e) (RC1 reconciliation + RC1-C1 `H_iso` correction): the pure
// three-clear oracle `c15eOracle` (F1–F4, S1–S3, Q1–Q5, D1–D3), the hidden-state observable
// `canonicalHidden` + `hiddenEquals` (single `modelKey`), the exact `checks.C15.fields.e` schema
// validator with comparison/predicate recomputation and ordering invariants, and the mandatory
// offline negative control (P-a/P-b PASS fixtures, single-field mutations, M-h1..M-h6, and the RC1
// regression guard that `diagnostics.*` / post-clear `inspectLedger()` is never an oracle input).
// Also pins the harness's accepted procedure digest (RC1-C1 follow-up item 14). No Viewer, no
// browser, no network, no playwright.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  c15eModelKey, canonicalHidden, canonicalIsolation, readCanonicalAggregate, hiddenEquals, canonIsolationEquals,
  c15eDerive, c15eOracle, validateC15eEvidence, C15E_PREDICATE_NAMES, C15E_FAILURE_LABELS, c15eLedgerDTO,
  C15_RESTORE_FAILED_NOTE, evaluateC15, evaluateC13, C15_FIRST_ONLY_NOTE,
  ACCEPTED_PROCEDURE_SHA256, PROCEDURE_REL_PATH, validateResultSchema, CHECK_NAMES, makeCheckRecord,
  checkVerdictLabel as vr,
} from './clashpanel-viewerbridge.acceptance.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ---- procedure digest binding (RC1-C1 follow-up item 14) ---------------------------------------

test('procedure binding: the harness binds exactly the final accepted procedure SHA-256 and the committed procedure bytes match it', () => {
  assert.equal(ACCEPTED_PROCEDURE_SHA256, '5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb');
  const bytes = readFileSync(path.join(REPO, PROCEDURE_REL_PATH));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), ACCEPTED_PROCEDURE_SHA256);
});

// ---- canonical hidden / isolation observable ---------------------------------------------------

const A = { name: 'model-A' };
const B = { name: 'model-B' };
const C = { name: 'model-C' };
const MODELS = { A, B };
const CTX = { models: MODELS, allModels: [A, B] };

test('modelKey: A/B strictly by object identity; anything else is null', () => {
  assert.equal(c15eModelKey(A, MODELS), 'A');
  assert.equal(c15eModelKey(B, MODELS), 'B');
  assert.equal(c15eModelKey({ ...A }, MODELS), null);
  assert.equal(c15eModelKey(C, MODELS), null);
  assert.equal(c15eModelKey(1, MODELS), null);
  assert.equal(c15eModelKey(undefined, MODELS), null);
  assert.equal(c15eModelKey(null, { A: null, B: null }), null);
});

test('canonicalHidden: per-model merge (set union), ascending de-duplicated ids, empty entries dropped, sorted by model key; baseline-empty is exactly []', () => {
  assert.deepEqual(canonicalHidden([], CTX), []);
  assert.deepEqual(canonicalHidden([{ model: A, ids: [] }, { model: B, ids: new Int32Array(0) }], CTX), []);
  assert.deepEqual(canonicalHidden([{ model: B, ids: [5, 3, 3] }, { model: A, ids: new Uint32Array([9]) }, { model: B, ids: [1, 5] }], CTX),
    [{ model: 'A', ids: [9] }, { model: 'B', ids: [1, 3, 5] }]);
  // same canonical form for isolation values
  assert.deepEqual(canonicalIsolation([{ model: B, ids: [2] }, { model: A, ids: [1] }], CTX), [{ model: 'A', ids: [1] }, { model: 'B', ids: [2] }]);
});

test('canonicalHidden: every unreadable shape yields exactly {unreadable:true, error:<string>} which equals nothing', () => {
  const bad = [
    ['not an array', { model: A, ids: [1] }],
    ['entry not object', [null]],
    ['foreign model', [{ model: C, ids: [1] }]],
    ['model id instead of object', [{ model: 1, ids: [1] }]],
    ['missing model', [{ ids: [1] }]],
    ['non-integer id', [{ model: A, ids: [1.5] }]],
    ['ids not array-like', [{ model: A, ids: 7 }]],
  ];
  for (const [label, raw] of bad) {
    const v = canonicalHidden(raw, CTX);
    assert.deepEqual(Object.keys(v).sort(), ['error', 'unreadable'], label);
    assert.equal(v.unreadable, true, label);
    assert.equal(typeof v.error, 'string', label);
    assert.equal(hiddenEquals(v, v), false, label);
    assert.equal(canonIsolationEquals(v, []), false, label);
  }
  // model absent from getAllModels() (e.g. B unloaded) is unreadable
  assert.equal(canonicalHidden([{ model: B, ids: [1] }], { models: MODELS, allModels: [A] }).unreadable, true);
  // a throwing read is unreadable (redacted message, no throw escapes)
  const thrown = readCanonicalAggregate(() => { throw new Error('boom Authorization: Bearer SECRET'); }, CTX);
  assert.equal(thrown.unreadable, true);
  assert.equal(thrown.error.includes('SECRET'), false);
  assert.deepEqual(readCanonicalAggregate(() => [{ model: A, ids: [4, 2] }], CTX), [{ model: 'A', ids: [2, 4] }]);
});

test('hiddenEquals / canonIsolationEquals: exact per-model set equality, no subset/superset tolerance', () => {
  const x = [{ model: 'A', ids: [1, 2] }, { model: 'B', ids: [3] }];
  assert.equal(hiddenEquals(x, JSON.parse(JSON.stringify(x))), true);
  assert.equal(hiddenEquals([], []), true);
  assert.equal(hiddenEquals(x, [{ model: 'A', ids: [1, 2] }]), false);
  assert.equal(hiddenEquals(x, [{ model: 'A', ids: [1, 2, 4] }, { model: 'B', ids: [3] }]), false);
  assert.equal(hiddenEquals(x, [{ model: 'A', ids: [1] }, { model: 'B', ids: [3] }]), false);
  assert.equal(canonIsolationEquals(x, x), true);
  assert.equal(canonIsolationEquals([], x), false);
});

test('LedgerDTO: the only persisted projection of an inspectLedger() value', () => {
  assert.equal(c15eLedgerDTO(null), null);
  assert.deepEqual(c15eLedgerDTO({ markerMeshes: [{}, {}, {}], isolation: { confirmed: true, target: [{ model: A, ids: [1] }] } }), { markerMeshCount: 3, isolationConfirmed: true });
  assert.deepEqual(c15eLedgerDTO({ markerMeshes: [], isolation: null }), { markerMeshCount: 0, isolationConfirmed: null });
});

// ---- recorded-shape fixtures (P-a / P-b) ---------------------------------------------------------

const T_ISO = [{ model: 'A', ids: [101] }, { model: 'B', ids: [202] }];
const H_ISO_NONEMPTY = [{ model: 'A', ids: [7, 8] }, { model: 'B', ids: [9] }];
const NM = 3;

const rec = (seq, method, origin, { thrown = null, returned = 'undefined' } = {}) => ({ seq, method, origin, argDigest: 'd'.repeat(64), thrown, returned: thrown ? null : returned });

/** Builds a PASS-shaped `checks.C15.fields.e` fixture; `hIso` selects P-a (non-empty) or P-b ([]). */
function fixture(hIso) {
  const after = (readSeq, isolation, hidden) => ({ readSeq, isolation, hidden, models: ['A', 'B'] });
  const e = {
    nm: NM,
    ledgerBefore: { markerMeshCount: NM, isolationConfirmed: true },
    E0: [], H0: [], T_iso: T_ISO, H_iso: hIso,
    presentSettleSeq: 10, hIsoReadSeq: 12,
    injection: { installSeq: 13, armSeq: 14, disarmSeq: 23, removeSeq: 24, restoredByReference: true, originalInvocationsWhileArmed: 0, thrownInjectedCount: 2 },
    clears: [
      {
        index: 1, injectionArmed: true, startSeq: 15, settleSeq: 22,
        outcome: { isolation: 'failed', markersRemoved: NM, notes: [C15_RESTORE_FAILED_NOTE] },
        spyWindow: [
          rec(16, 'overlays.removeMesh', 'bridge'), rec(17, 'overlays.removeMesh', 'bridge'), rec(18, 'overlays.removeMesh', 'bridge'),
          rec(19, 'viewer.getAggregateIsolation', 'bridge', { returned: 'array' }),
          rec(20, 'viewer.setAggregateIsolation', 'bridge', { thrown: 'injected' }),
          rec(21, 'viewer.setAggregateIsolation', 'bridge', { thrown: 'injected' }),
        ],
        after: after(27, T_ISO, hIso),
      },
      {
        index: 2, injectionArmed: false, startSeq: 28, settleSeq: 31,
        outcome: { isolation: 'restored', markersRemoved: 0, notes: [] },
        spyWindow: [
          rec(25, 'viewer.getAggregateIsolation', 'harness', { returned: 'array' }), rec(26, 'viewer.getAggregateHiddenNodes', 'harness', { returned: 'array' }),
          rec(29, 'viewer.getAggregateIsolation', 'bridge', { returned: 'array' }), rec(30, 'viewer.setAggregateIsolation', 'bridge'),
        ],
        after: after(34, [], []),
      },
      {
        index: 3, injectionArmed: false, startSeq: 35, settleSeq: 36,
        outcome: { isolation: 'none', markersRemoved: 0, notes: [] },
        spyWindow: [
          rec(32, 'viewer.getAggregateIsolation', 'harness', { returned: 'array' }), rec(33, 'viewer.getAggregateHiddenNodes', 'harness', { returned: 'array' }),
        ],
        after: after(39, [], []),
      },
    ],
    comparisons: null, predicates: null, failureLabel: null,
    diagnostics: { inspectLedgerAfterClear1: null, inspectLedgerAfterClear2: null, inspectLedgerAfterClear3: null },
  };
  return refresh(e);
}

/** Recomputes the stored comparisons/predicates/failureLabel (so oracle mutations stay schema-consistent). */
function refresh(e) {
  const d = c15eDerive(e);
  e.comparisons = d.comparisons;
  e.predicates = d.predicates;
  e.failureLabel = d.failureLabel;
  return e;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
/** Single-field mutation of a fixture; `keepStored` leaves stored derived fields untouched (validator tests). */
function mutate(base, fn, { keepStored = false } = {}) {
  const e = clone(base);
  fn(e);
  return keepStored ? e : refresh(e);
}

const PA = fixture(H_ISO_NONEMPTY);
const PB = fixture([]);

function assertFail(e, predicate, label = undefined) {
  const r = c15eOracle(e);
  assert.equal(r.verdict, 'FAIL', JSON.stringify(r));
  assert.ok(r.violated.includes(predicate), `expected ${predicate} in ${JSON.stringify(r.violated)}`);
  if (label !== undefined) assert.equal(r.failureLabel, label);
  assert.ok(r.reason.includes(predicate));
  return r;
}

test('P-a / P-b: both recorded-shape fixtures PASS, are schema-valid, and every predicate is true', () => {
  for (const [name, fx] of [['P-a', PA], ['P-b', PB]]) {
    const r = c15eOracle(fx);
    assert.equal(r.verdict, 'PASS', `${name}: ${JSON.stringify(r)}`);
    assert.equal(r.reason, null);
    assert.equal(r.failureLabel, null);
    assert.deepEqual(r.violated, []);
    assert.deepEqual(Object.keys(fx.predicates).sort(), [...C15E_PREDICATE_NAMES].sort());
    assert.ok(Object.values(fx.predicates).every((v) => v === true), name);
    const v = validateC15eEvidence(fx);
    assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.errors)}`);
  }
});

test('P-a guard: an oracle that expected baseline-empty hidden after the failed clear would FAIL P-a (S3 compares with H_iso, not [])', () => {
  assert.notDeepEqual(PA.clears[0].after.hidden, []);
  assert.equal(c15eOracle(PA).verdict, 'PASS');
  assert.equal(PA.comparisons.clear1.hiddenEqualsHiso, true);
});

test('mutations: stranded isolation / wrong second outcome / oracle conflict / F1 / F4', () => {
  assertFail(mutate(PA, (e) => { e.clears[1].after.isolation = T_ISO; }), 'Q5', 'isolation-stranded');
  assertFail(mutate(PA, (e) => { e.clears[1].outcome.isolation = 'none'; }), 'Q1', 'isolation-stranded');
  assertFail(mutate(PA, (e) => { e.clears[1].outcome.isolation = 'failed'; }), 'Q1', 'isolation-stranded');
  assertFail(mutate(PA, (e) => { e.clears[0].after.isolation = []; }), 'S1', 'oracle-conflict');
  assertFail(mutate(PA, (e) => { e.clears[0].outcome.isolation = 'restored'; }), 'F1');
  assertFail(mutate(PA, (e) => { e.clears[0].spyWindow[5].thrown = null; e.clears[0].spyWindow[5].returned = 'undefined'; }), 'F4');
  assertFail(mutate(PA, (e) => { e.clears[0].spyWindow = e.clears[0].spyWindow.filter((r) => r.method !== 'viewer.setAggregateIsolation'); }), 'F4');
  assertFail(mutate(PA, (e) => { e.clears[0].outcome.notes = []; }), 'F2');
  assertFail(mutate(PA, (e) => { e.clears[0].outcome.markersRemoved = NM - 1; }), 'F3');
  assertFail(mutate(PA, (e) => { e.clears[0].spyWindow = e.clears[0].spyWindow.filter((r) => r.seq !== 18); }), 'S2');
  assertFail(mutate(PA, (e) => { e.clears[1].outcome.markersRemoved = 1; }), 'Q2');
  assertFail(mutate(PA, (e) => { e.clears[1].outcome.notes = [C15_RESTORE_FAILED_NOTE]; }), 'Q2');
  assertFail(mutate(PA, (e) => { e.clears[1].spyWindow[3].thrown = 'Error'; e.clears[1].spyWindow[3].returned = null; }), 'Q3');
});

test('mutations: Q4 -- a harness-origin mutating Viewer call in either gap or inside a clear window', () => {
  // gap first -> second (after clear #1 settles, before clear #2 starts)
  assertFail(mutate(PA, (e) => { e.clears[1].spyWindow.splice(2, 0, rec(27, 'viewer.setAggregateIsolation', 'harness')); e.clears[1].spyWindow.sort((x, y) => x.seq - y.seq); }), 'Q4');
  // gap second -> third
  assertFail(mutate(PA, (e) => { e.clears[2].spyWindow.push(rec(34, 'viewer.fitToView', 'harness')); e.clears[2].spyWindow.sort((x, y) => x.seq - y.seq); }), 'Q4');
  // inside clear #1
  assertFail(mutate(PA, (e) => { e.clears[0].spyWindow.splice(3, 0, rec(18, 'overlays.addScene', 'harness')); }), 'Q4');
  // harness-origin reads are not mutating
  assert.equal(c15eOracle(PA).predicates.Q4, true);
});

test('mutations: third clear behaving as if retry state remained (D1/D2/D3)', () => {
  assertFail(mutate(PA, (e) => { e.clears[2].outcome.isolation = 'restored'; }), 'D1');
  assertFail(mutate(PA, (e) => { e.clears[2].outcome.isolation = 'failed'; }), 'D1');
  assertFail(mutate(PA, (e) => { e.clears[2].spyWindow.push(rec(36, 'viewer.setAggregateIsolation', 'bridge')); e.clears[2].settleSeq = 37; e.clears[2].after.readSeq = 39; }), 'D2');
});

test('M-h1: on P-a, afterClear1.hidden := [] (unexpected hidden-state change after the failed clear) => FAIL(S3)', () => {
  assertFail(mutate(PA, (e) => { e.clears[0].after.hidden = []; }), 'S3', 'hidden-changed-after-failed-clear');
});

test('M-h2: afterClear1.hidden := H_iso plus one extra dbId, and H_iso minus one dbId => FAIL(S3)', () => {
  assertFail(mutate(PA, (e) => { e.clears[0].after.hidden = [{ model: 'A', ids: [7, 8, 99] }, { model: 'B', ids: [9] }]; }), 'S3', 'hidden-changed-after-failed-clear');
  assertFail(mutate(PA, (e) => { e.clears[0].after.hidden = [{ model: 'A', ids: [7] }, { model: 'B', ids: [9] }]; }), 'S3', 'hidden-changed-after-failed-clear');
  assertFail(mutate(PB, (e) => { e.clears[0].after.hidden = [{ model: 'A', ids: [1] }]; }), 'S3', 'hidden-changed-after-failed-clear');
  // S3 also requires the setup model-key list unchanged
  assertFail(mutate(PA, (e) => { e.clears[0].after.models = ['A']; }), 'S3');
});

test('M-h3: clear #2 not restoring the baseline => FAIL(Q5)', () => {
  assertFail(mutate(PA, (e) => { e.clears[1].after.hidden = H_ISO_NONEMPTY; }), 'Q5', 'hidden-not-baseline');
  const r = assertFail(mutate(PA, (e) => { e.clears[1].after.isolation = T_ISO; }), 'Q5', 'isolation-stranded');
  assert.equal(r.predicates.Q1, true); // o2.isolation stays 'restored'
});

test('M-h4: clear #3 behaving as if retry state remained => FAIL(D1/D2/D3)', () => {
  assertFail(mutate(PA, (e) => { e.clears[2].outcome.isolation = 'failed'; }), 'D1');
  assertFail(mutate(PA, (e) => { e.clears[2].outcome.isolation = 'restored'; }), 'D1');
  assertFail(mutate(PA, (e) => { e.clears[2].spyWindow.push(rec(36, 'viewer.setAggregateIsolation', 'bridge')); e.clears[2].settleSeq = 37; e.clears[2].after.readSeq = 39; }), 'D2');
  assertFail(mutate(PA, (e) => { e.clears[2].after.isolation = T_ISO; }), 'D3');
  assertFail(mutate(PA, (e) => { e.clears[2].after.hidden = H_ISO_NONEMPTY; }), 'D3', 'hidden-not-baseline');
});

test('M-h5: any unreadable post-clear read => FAIL(post-clear-read-unreadable); unreadable H_iso => BLOCKED(precondition:c15e), never PASS', () => {
  const U = { unreadable: true, error: 'x' };
  for (const i of [0, 1, 2]) {
    for (const k of ['hidden', 'isolation']) {
      const r = c15eOracle(mutate(PA, (e) => { e.clears[i].after[k] = U; }));
      assert.equal(r.verdict, 'FAIL', `${i}.${k}`);
      assert.equal(r.failureLabel, 'post-clear-read-unreadable', `${i}.${k}`);
      assert.ok(r.reason.startsWith('post-clear-read-unreadable'), r.reason);
    }
  }
  for (const fx of [PA, PB]) {
    const r = c15eOracle(mutate(fx, (e) => { e.H_iso = U; }));
    assert.equal(r.verdict, 'BLOCKED');
    assert.equal(r.reason, 'precondition:c15e');
  }
});

test('M-h6: a stored comparison flipped against its canonical values, or a violated ordering invariant => schema validator FAIL', () => {
  for (const [clear, key] of [['clear1', 'isolationEqualsTiso'], ['clear1', 'hiddenEqualsHiso'], ['clear2', 'isolationEqualsE0'], ['clear2', 'hiddenEqualsH0'], ['clear3', 'isolationEqualsE0'], ['clear3', 'hiddenEqualsH0']]) {
    const v = validateC15eEvidence(mutate(PA, (e) => { e.comparisons[clear][key] = !e.comparisons[clear][key]; }, { keepStored: true }));
    assert.equal(v.ok, false, `${clear}.${key}`);
    assert.ok(v.errors.includes(`comparisons.${clear}.${key}:contradiction`), JSON.stringify(v.errors));
  }
  for (const p of C15E_PREDICATE_NAMES) {
    const v = validateC15eEvidence(mutate(PA, (e) => { e.predicates[p] = !e.predicates[p]; }, { keepStored: true }));
    assert.equal(v.ok, false, p);
    assert.ok(v.errors.includes(`predicates.${p}:contradiction`), JSON.stringify(v.errors));
  }
  assert.ok(validateC15eEvidence(mutate(PA, (e) => { e.failureLabel = 'oracle-conflict'; }, { keepStored: true })).errors.includes('failureLabel:contradiction'));
  assert.ok(validateC15eEvidence(mutate(PA, (e) => { e.injection.thrownInjectedCount = 1; }, { keepStored: true })).errors.includes('injection.thrownInjectedCount:contradiction'));
  // ordering invariants (each link of the chain)
  const orderMutations = [
    (e) => { e.hIsoReadSeq = e.presentSettleSeq; },
    (e) => { e.injection.installSeq = e.hIsoReadSeq - 1; },
    (e) => { e.injection.armSeq = e.injection.installSeq; },
    (e) => { e.clears[0].startSeq = e.injection.armSeq; },
    (e) => { e.injection.disarmSeq = e.clears[0].settleSeq; },
    (e) => { e.injection.removeSeq = e.injection.disarmSeq - 1; },
    (e) => { e.clears[0].after.readSeq = e.injection.removeSeq; },
    (e) => { e.clears[1].startSeq = e.clears[0].after.readSeq; },
    (e) => { e.clears[1].after.readSeq = e.clears[1].settleSeq; },
    (e) => { e.clears[2].startSeq = e.clears[1].after.readSeq - 1; },
    (e) => { e.clears[2].after.readSeq = e.clears[2].settleSeq; },
  ];
  orderMutations.forEach((fn, i) => {
    const v = validateC15eEvidence(mutate(PA, fn, { keepStored: true }));
    assert.equal(v.ok, false, `ordering mutation #${i}`);
    assert.ok(v.errors.includes('ordering'), `ordering mutation #${i}: ${JSON.stringify(v.errors)}`);
  });
  // equal disarmSeq/removeSeq is allowed (<=)
  assert.equal(validateC15eEvidence(mutate(PA, (e) => { e.injection.removeSeq = e.injection.disarmSeq; }, { keepStored: true })).ok, true);
});

test('schema: exact keys at every level, plain JSON, closed enums and shapes; unknown/missing keys rejected', () => {
  const bad = [
    ['unknown top-level key', (e) => { e.extra = 1; }],
    ['missing top-level key', (e) => { delete e.hIsoReadSeq; }],
    ['unknown injection key', (e) => { e.injection.x = 1; }],
    ['unknown clear key', (e) => { e.clears[1].x = 1; }],
    ['unknown outcome key', (e) => { e.clears[1].outcome.superseded = false; }],
    ['unknown after key', (e) => { e.clears[1].after.ledger = null; }],
    ['unknown spy key', (e) => { e.clears[0].spyWindow[0].callIndex = 3; }],
    ['unknown diagnostics key', (e) => { e.diagnostics.extra = null; }],
    ['ledgerBefore not LedgerDTO', (e) => { e.ledgerBefore = { markerMeshCount: 3, isolationConfirmed: true, target: [] }; }],
    ['diagnostics not LedgerDTO', (e) => { e.diagnostics.inspectLedgerAfterClear1 = { markerMeshes: [] }; }],
    ['two clears', (e) => { e.clears.pop(); }],
    ['wrong index', (e) => { e.clears[1].index = 3; }],
    ['injectionArmed on #2', (e) => { e.clears[1].injectionArmed = true; }],
    ['outcome enum', (e) => { e.clears[1].outcome.isolation = 'ok'; }],
    ['non-canonical ids order', (e) => { e.T_iso = [{ model: 'A', ids: [2, 1] }]; }],
    ['non-canonical model key', (e) => { e.T_iso = [{ model: 'C', ids: [1] }]; }],
    ['empty ids entry', (e) => { e.H_iso = [{ model: 'A', ids: [] }]; }],
    ['unsorted models', (e) => { e.T_iso = [{ model: 'B', ids: [1] }, { model: 'A', ids: [1] }]; }],
    ['malformed unreadable', (e) => { e.H_iso = { unreadable: true }; }],
    ['models not strings', (e) => { e.clears[0].after.models = [1]; }],
    ['non-integer seq', (e) => { e.presentSettleSeq = 1.5; }],
    ['spy window out of its range', (e) => { e.clears[0].spyWindow[0].seq = 14; }],
    ['spy window not ascending', (e) => { e.clears[0].spyWindow.reverse(); }],
    ['originalInvocationsWhileArmed != 0', (e) => { e.injection.originalInvocationsWhileArmed = 1; }],
    ['predicate missing', (e) => { delete e.predicates.D3; }],
    ['failureLabel unknown', (e) => { e.failureLabel = 'whatever'; }],
  ];
  for (const [label, fn] of bad) {
    const v = validateC15eEvidence(mutate(PA, fn, { keepStored: true }));
    assert.equal(v.ok, false, label);
  }
  // non-plain-JSON value (a Map / a model object) anywhere is rejected
  const withObj = clone(PA); withObj.clears[0].outcome.notes = [new Map()];
  assert.equal(validateC15eEvidence(withObj).ok, false);
  const withUndef = clone(PA); withUndef.clears[0].after.models = [undefined];
  assert.equal(validateC15eEvidence(withUndef).ok, false);
  assert.equal(validateC15eEvidence(null).ok, false);
  // unreadable values are schema-legal CanonHidden/CanonIso values
  assert.equal(validateC15eEvidence(mutate(PA, (e) => { e.clears[2].after.hidden = { unreadable: true, error: 'e' }; })).ok, true);
  assert.deepEqual(C15E_FAILURE_LABELS.slice().sort(), ['hidden-changed-after-failed-clear', 'hidden-not-baseline', 'isolation-stranded', 'oracle-conflict', 'post-clear-read-unreadable']);
});

test('RC1 regression guard: diagnostics.inspectLedgerAfterClear1 null and non-null both leave an otherwise-PASS fixture PASS (ledger is not an oracle input)', () => {
  for (const fx of [PA, PB]) {
    for (const v of [null, { markerMeshCount: 0, isolationConfirmed: true }, { markerMeshCount: 0, isolationConfirmed: null }]) {
      const e = mutate(fx, (x) => { x.diagnostics.inspectLedgerAfterClear1 = v; x.diagnostics.inspectLedgerAfterClear2 = v; x.diagnostics.inspectLedgerAfterClear3 = v; });
      assert.equal(c15eOracle(e).verdict, 'PASS');
      assert.equal(validateC15eEvidence(e).ok, true);
    }
  }
});

test('oracle preconditions and injection verification are fail-closed (never PASS)', () => {
  const blocked = (fn, reason) => { const r = c15eOracle(mutate(PA, fn)); assert.equal(r.verdict, 'BLOCKED', JSON.stringify(r)); assert.equal(r.reason, reason); };
  blocked((e) => { e.E0 = T_ISO; }, 'precondition:c15e');
  blocked((e) => { e.H0 = H_ISO_NONEMPTY; }, 'precondition:c15e');
  blocked((e) => { e.T_iso = []; }, 'precondition:c15e');
  blocked((e) => { e.ledgerBefore = { markerMeshCount: 2, isolationConfirmed: true }; }, 'precondition:c15e');
  blocked((e) => { e.ledgerBefore = { markerMeshCount: NM, isolationConfirmed: false }; }, 'precondition:c15e');
  blocked((e) => { e.injection.restoredByReference = false; }, 'session-tainted');
  blocked((e) => { e.injection.originalInvocationsWhileArmed = 1; }, 'injection-not-verified');
  assert.equal(c15eOracle(null).verdict, 'BLOCKED');
});

// ---- C15 / C13 evaluators consume the three-clear evidence --------------------------------------

const GOOD_AD = {
  a: { injectedFired: true, allAddedRemoved: true, ledgerNull: true, marked: false, failedNote: true, globalOk: true },
  b: { injectedFired: true, isolationUnchanged: true, noMarkerLeak: true, globalOk: true },
  c: { injectedFired: true, finalIsolationEmpty: true, globalOk: true },
  d: { injectedFired: true, fitted: true, notes: [C15_FIRST_ONLY_NOTE], globalOk: true },
};

test('evaluateC15: (e) is decided by c15eOracle over fields.e plus the scenario-end global assertion; fields.e is the exact evidence', () => {
  const ok = evaluateC15({ ...GOOD_AD, e: { evidence: PA, blocked: null, globalOk: true } });
  assert.equal(ok.verdict, 'PASS');
  assert.deepEqual(ok.fields.e, PA);
  assert.equal(validateC15eEvidence(ok.fields.e).ok, true);
  assert.equal(vr(evaluateC15({ ...GOOD_AD, e: { evidence: PA, blocked: null, globalOk: false } })), 'FAIL(e)');
  const stranded = evaluateC15({ ...GOOD_AD, e: { evidence: mutate(PA, (x) => { x.clears[1].after.isolation = T_ISO; }), blocked: null, globalOk: true } });
  assert.equal(vr(stranded), 'FAIL(e)');
  assert.equal(stranded.fields.eOracle.failureLabel, 'isolation-stranded');
  assert.equal(vr(evaluateC15({ ...GOOD_AD, e: { evidence: null, blocked: 'precondition:c15e', globalOk: true } })), 'BLOCKED(precondition:c15e)');
  assert.equal(vr(evaluateC15({ ...GOOD_AD, e: { evidence: null, blocked: 'timeout:clear', globalOk: false } })), 'BLOCKED(timeout:clear)');
  assert.equal(vr(evaluateC15({ ...GOOD_AD, e: { evidence: mutate(PA, (x) => { x.H_iso = { unreadable: true, error: 'x' }; }), blocked: null, globalOk: true } })), 'BLOCKED(precondition:c15e)');
  // a FAIL in (a)-(d) dominates a blocked (e)
  assert.equal(vr(evaluateC15({ ...GOOD_AD, a: { ...GOOD_AD.a, globalOk: false }, e: { evidence: null, blocked: 'precondition:c15e', globalOk: true } })), 'FAIL(a)');
  // the old inspectLedger()-based observation shape is no longer accepted as (e) evidence
  assert.equal(evaluateC15({ ...GOOD_AD, e: { injectedFired: true, clear1: { isolation: 'failed', notes: [C15_RESTORE_FAILED_NOTE] }, ledgerIsolationConfirmedRetained: true, markersRemoved: true, wrapperRemoved: true, clear2: { isolation: 'restored' }, recordDropped: true, finalIsolationEmpty: true, globalOk: true } }).verdict.startsWith('PASS'), false);
});

test('evaluateC13: C15(e) expects failed -> restored -> none over its three clear() calls', () => {
  const base = { C10: { isolation: 'restored' }, C12: { isolation: 'skipped-external' }, C15b: { isolation: 'restored' }, C15c: { isolation: 'restored' } };
  assert.equal(evaluateC13({ ...base, C15e: { isolation: 'failed', clear2: 'restored', clear3: 'none' } }).verdict, 'PASS');
  assert.equal(vr(evaluateC13({ ...base, C15e: { isolation: 'failed', clear2: 'none', clear3: 'none' } })), 'FAIL(mismatch:C15e)');
  assert.equal(vr(evaluateC13({ ...base, C15e: { isolation: 'failed', clear2: 'restored', clear3: 'restored' } })), 'FAIL(mismatch:C15e)');
  assert.equal(vr(evaluateC13({ ...base, C15e: { isolation: 'failed' } })), 'BLOCKED(scenario-missing:C15e)');
});

test('validateResultSchema recomputes a persisted checks.C15.fields.e (contradiction => schema error, §8 row 5)', () => {
  const checksWith = (e) => {
    const checks = Object.fromEntries(CHECK_NAMES.map((n) => [n, makeCheckRecord({ verdict: 'PASS' })]));
    checks.C15 = { ...makeCheckRecord({ verdict: 'PASS' }), fields: { e } };
    // GATE_C1_REQUIRED (slice B2): C1 always carries its finalization fields
    checks.C1 = { ...checks.C1, finalizedSeq: 1, finalizedAt: '2026-09-30T00:00:01.000Z' };
    return { checks };
  };
  const errs = (e) => validateResultSchema(checksWith(e), 'payload').errors.filter((x) => x.startsWith('checks.'));
  assert.deepEqual(errs(PA), []);
  assert.deepEqual(errs(null), []);
  const flipped = mutate(PA, (e) => { e.predicates.Q5 = false; }, { keepStored: true });
  assert.deepEqual(errs(flipped), ['checks.C15.fields.e:predicates.Q5:contradiction']);
  assert.ok(errs(mutate(PA, (e) => { e.extra = 1; }, { keepStored: true })).includes('checks.C15.fields.e:keys'));
});
