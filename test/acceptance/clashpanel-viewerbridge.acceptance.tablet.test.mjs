// test/acceptance/clashpanel-viewerbridge.acceptance.tablet.test.mjs
//
// Offline tests for the G2 harness Table T rev-2 constants (procedure §4.7), the §5 phase order
// and dependency gate, and the one-bridge-at-a-time tracker. The expected values below are typed
// independently of the harness (a copy of procedure lines 168-193), so a drifted constant fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TABLE_T,
  T8_CLOSEOUT_STEP_DEADLINE_MS,
  T9_ATTEMPT_CAP_MS,
  OP_DEADLINE_SPECS,
  PHASE_ORDER,
  CHECK_DEPENDENCIES,
  dependencyBlockers,
  createBridgeInstanceTracker,
} from './clashpanel-viewerbridge.acceptance.mjs';

const PROCEDURE = readFileSync(fileURLToPath(new URL('../../docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md', import.meta.url)), 'utf8');

function isDeepFrozen(v) {
  if (v === null || typeof v !== 'object') return true;
  return Object.isFrozen(v) && Object.keys(v).every((k) => isDeepFrozen(v[k]));
}

test('Table T: exactly rows T1..T24, deeply frozen, each value as written in procedure 4.7', () => {
  assert.deepEqual(Object.keys(TABLE_T), Array.from({ length: 24 }, (_, i) => `T${i + 1}`));
  assert.equal(isDeepFrozen(TABLE_T), true);
  const expected = {
    T1: { phase0StepDeadlineMs: 30000, class: 'CA', exception: 'E5' },
    T2: { loadAndReadinessDeadlineMs: 180000, class: 'CA' },
    T3: { treeEnumerationDeadlineMs: 60000, class: 'CA' },
    T4: { cameraSettleDeadlineMs: 5000, settleEpsilonAbs: 1e-9, consecutiveSamples: 2, matrixEntries: 32, class: 'CA', exception: 'E2' },
    T5: { singleOperationDeadlineMs: 15000, class: 'CA' },
    T6: { expectedEventWindowMs: 10000, class: 'CA', exception: 'E4' },
    T7: { screenshotFrameDeadlineMs: 10000, class: 'CA' },
    T8: { cleanupStepDeadlineMs: 15000, closeTimeoutMs: 10000, class: 'CA', exception: 'E5' },
    T9: { wholeAttemptCapMs: 1200000, class: 'CA', exception: 'E5' },
    T10: { c4SamplePerModel: 20, class: 'CA' },
    T11: { c6PairPoolPerModel: 50, class: 'CA' },
    T12: { c3ShowHideRepetitions: 3, c7ReplacementRepetitions: 5, class: 'CA', exception: 'E3' },
    T13: {
      hard: { spheres: 1, outlinesPerLiveSide: 1, totalForTwoSides: 3 },
      soft: { spheres: 2, lines: 1, outlinesPerLiveSide: 1, totalForTwoSides: 5 },
      class: 'CD',
    },
    T14: { loadedModelCount: 2, class: 'CD' },
    T15: { u: 5.960464477539063e-8, passFactor: 16, grossRelative: 0.0009765625, sFloor: 2 ** -126, class: 'mixed', classes: { u: 'RD', sFloor: 'RD', passFactor: 'CA', grossRelative: 'CA', S_a: 'CA' }, exception: 'E1' },
    T16: { frustumEpsilon: 0.0001, class: 'CA', exception: 'E2' },
    T17: { footprintDilationPx: 2, class: 'CA' },
    T18: { sphereEvaluabilityFloorPx: 2, class: 'CA' },
    T19: { frameIdentityToleranceBytes: 0, changedPixelMinimum: 1, postSettleCameraTolerance: 0, deviceScaleFactor: 1, class: 'mixed', classes: { equalityLogic: 'CD', deviceScaleFactor: 'RD' } },
    T20: { offPairAttemptsMax: 2, onPairAttemptsMax: 2, interCaptureWaitRafs: 2, clearFrameCaptures: 1, class: 'CA' },
    T21: { construction: 'D = 2*g*Ms/(1-g)', msTerms: 'Ms = |bMin_x|+|bMax_x|+|rMin_x|+|rMax_x|+sFloor', gSource: 'T15.grossRelative', class: 'mixed', classes: { construction: 'CD', gValue: 'CA' } },
    T22: { perFieldBytes: 4096, spyLedgerBytes: 2097152, verdictCriticalExempt: true, class: 'CD' },
    T23: { exactSha256Equality: true, schemaValidity: true, journalStateReadBack: true, class: 'CD' },
    T24: { c4RangeAbsMax: 2 ** 900, n6DomainAbsMax: 2 ** 897, class: 'CD' },
  };
  for (const [row, value] of Object.entries(expected)) assert.deepEqual(TABLE_T[row], value, row);
});

test('Table T: derived float constants are the exact G1 values and no row carries an AP class', () => {
  assert.equal(TABLE_T.T15.u, 2 ** -24);
  assert.equal(TABLE_T.T15.grossRelative, 2 ** -10);
  assert.equal(TABLE_T.T24.c4RangeAbsMax, 2 ** 900);
  assert.equal(TABLE_T.T24.n6DomainAbsMax, 2 ** 897);
  for (const [row, v] of Object.entries(TABLE_T)) {
    assert.notEqual(v.class, 'AP', row);
    assert.ok(['CD', 'RD', 'CA', 'mixed'].includes(v.class), row);
  }
});

test('Table T: every row id appears in the procedure table, and aliases match', () => {
  for (let n = 1; n <= 24; n += 1) assert.match(PROCEDURE, new RegExp(`^\\| T${n} \\|`, 'm'), `T${n}`);
  assert.equal(T9_ATTEMPT_CAP_MS, 20 * 60 * 1000);
  assert.equal(T8_CLOSEOUT_STEP_DEADLINE_MS, TABLE_T.T8.cleanupStepDeadlineMs);
});

test('deadline specs reference Table T values and classes: only E4/E5 timeouts FAIL', () => {
  assert.equal(OP_DEADLINE_SPECS.load.timeoutMs, 180000);
  assert.equal(OP_DEADLINE_SPECS['camera-settle'].timeoutMs, 5000);
  assert.equal(OP_DEADLINE_SPECS.present.timeoutMs, 15000);
  assert.equal(OP_DEADLINE_SPECS.screenshot.timeoutMs, 10000);
  const failing = Object.entries(OP_DEADLINE_SPECS).filter(([, s]) => s.kind.startsWith('fail')).map(([k]) => k).sort();
  assert.deepEqual(failing, ['attempt', 'expected-event', 'phase0-step']);
  for (const [, s] of Object.entries(OP_DEADLINE_SPECS)) if (s.kind.startsWith('fail') || s.kind === 'cleanup') assert.ok(['E4', 'E5'].includes(s.exception));
});

test('phase order is exactly procedure 5 and contains every check/control once', () => {
  assert.deepEqual(PHASE_ORDER.map((p) => p.id), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5a', 'P5b', 'P6', 'P6b', 'P7', 'P8', 'P9', 'P10', 'P11', 'cleanup', 'closeout']);
  assert.deepEqual(PHASE_ORDER.find((p) => p.id === 'P5a').checks, ['C7alpha', 'C18b']);
  assert.deepEqual(PHASE_ORDER.find((p) => p.id === 'P9').controls, ['N7']);
  const all = PHASE_ORDER.flatMap((p) => [...p.checks, ...p.controls]);
  assert.equal(new Set(all).size, all.length);
  for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18a', 'C19', 'C20', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']) assert.ok(all.includes(id), id);
  assert.equal(Object.isFrozen(PHASE_ORDER), true);
  assert.ok(PHASE_ORDER.every((p) => Object.isFrozen(p) && Object.isFrozen(p.checks)));
});

test('dependency gate: C1 gates everything; C2->C3; C4->C6/C7/C8/C20; C16->C17; C19 needs N1', () => {
  assert.deepEqual(dependencyBlockers('C1', {}), []);
  assert.deepEqual(dependencyBlockers('C2', { C1: 'PASS' }), []);
  assert.deepEqual(dependencyBlockers('C2', { C1: 'BLOCKED' }), ['C1']);
  assert.deepEqual(dependencyBlockers('C3', { C1: 'PASS', C2: 'FAIL' }), ['C2']);
  assert.deepEqual(dependencyBlockers('C20', { C1: 'PASS', C4: 'PASS', C7: 'PASS', C8: 'NOT_EVIDENCED', N8: 'DETECTED' }), ['C8']);
  assert.deepEqual(dependencyBlockers('C6', { C1: 'PASS', C4: 'PASS', N2: 'NOT_DISCRIMINATING' }), ['N2']);
  assert.deepEqual(dependencyBlockers('C17', { C1: 'PASS', C16: 'PASS' }), []);
  assert.deepEqual(dependencyBlockers('C19', { C1: 'PASS', N1: 'NOT_DETECTED' }), ['N1']);
  assert.deepEqual(dependencyBlockers('C19', { C1: 'PASS' }), ['N1']);
  assert.equal(Object.isFrozen(CHECK_DEPENDENCIES), true);
});

test('bridge tracker: at most one bridge instance at any time', () => {
  const t = createBridgeInstanceTracker();
  t.create('bridge2');
  assert.throws(() => t.create('bridge1'), /still exists/);
  assert.throws(() => t.dispose('bridge1'), /active bridge/);
  t.dispose('bridge2');
  t.create('bridge1');
  assert.equal(t.active(), 'bridge1');
  t.dispose('bridge1');
  assert.deepEqual(t.history.map((h) => `${h.event}:${h.name}`), ['create:bridge2', 'dispose:bridge2', 'create:bridge1', 'dispose:bridge1']);
});
