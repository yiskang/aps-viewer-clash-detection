// test/performance/m4/evidence-report.test.mjs
// M4 Task 3.8: prescribed Step 1 tests, verbatim from the task brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHardMaximum, evaluatePercentileMedian, summarizeDurations, buildEvidenceRecord } from './evidence-report.mjs';

test('evaluateHardMaximum: T-a/T-b2 — fails on ANY repetition above threshold, never medianed', () => {
  assert.equal(evaluateHardMaximum([10, 20, 30, 61, 15], 50).pass, false); // one 61ms task fails T-a outright
  assert.equal(evaluateHardMaximum([10, 20, 30, 40, 15], 50).pass, true);
});

test('evaluateHardMaximum: empty-set guard -- NOT_EXERCISED, never a false pass from Math.max(...[])', () => {
  const result = evaluateHardMaximum([], 50);
  assert.equal(result.pass, null);
  assert.match(result.reason, /NOT_EXERCISED/);
});

test('evaluatePercentileMedian: T-b1/T-c — median across 5 reps within threshold AND no single rep over 1.5x', () => {
  assert.equal(evaluatePercentileMedian([20, 22, 24, 26, 28], 32).pass, true);
  assert.equal(evaluatePercentileMedian([20, 22, 24, 26, 50], 32).pass, false, 'one rep at 50 > 1.5*32=48 must fail clause (ii) even if the median passes');
});

test('summarizeDurations: empty-set guard reports zero-count, no NaN/-Infinity leakage', () => {
  const s = summarizeDurations([]);
  assert.equal(s.count, 0);
  assert.equal(s.maxMs, null);
});

test('buildEvidenceRecord: assembles targets + partition + correctness into one record, marked provisional', () => {
  const record = buildEvidenceRecord({
    runtime: 'multiProcess', caseName: 'R1', broadPhase: 'tlas', state: 'cold',
    targets: { Ta: { pass: true }, Tb1: { pass: true }, Tb2: { pass: true }, Tc: { pass: true }, partition: { mainOnlyMs: 1, transferableMs: 2 } },
    correctness: 'PASSED',
  });
  assert.equal(record.case, 'R1');
  assert.equal(record.correctnessGate, 'PASSED');
  assert.equal(record.shapeStatus, 'PROVISIONAL — reconciled by Phase 2 task 2.4');
});
