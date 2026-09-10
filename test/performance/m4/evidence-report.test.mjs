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

// codex-review finding (Critical, task 3.8 live-wiring round): a partial repetition population
// must never produce a confident PASS -- a hard maximum's FAILURE remains decisive from a partial
// population (§7.2's "fails on ANY repetition"), but a PASS is only trustworthy once every expected
// repetition was determined.
test('evaluateHardMaximum: a partial population that would PASS is downgraded to INSUFFICIENT_POPULATION, not a confident pass', () => {
  const result = evaluateHardMaximum([40], 50, 5); // only 1 of 5 expected repetitions determined
  assert.equal(result.pass, null);
  assert.match(result.reason, /INSUFFICIENT_POPULATION/);
  assert.equal(result.worst, 40); // the computed value is still visible, just not trusted as a PASS
});

test('evaluateHardMaximum: a partial population that already FAILS stays a decisive fail, never upgraded to unevaluable', () => {
  const result = evaluateHardMaximum([61], 50, 5); // only 1 of 5, but one failure is already decisive
  assert.equal(result.pass, false);
  assert.equal(result.worst, 61);
});

test('evaluateHardMaximum: omitting expectedCount preserves prior 2-arg behavior exactly (no completeness check)', () => {
  assert.equal(evaluateHardMaximum([10, 20, 30, 40, 15], 50).pass, true);
});

test('evaluatePercentileMedian: ANY population shortfall is unevaluable, never a pass or a fail (percentile, not a hard maximum)', () => {
  const result = evaluatePercentileMedian([20, 22, 24], 32, 5); // only 3 of 5 expected
  assert.equal(result.pass, null);
  assert.match(result.reason, /INSUFFICIENT_POPULATION/);
  assert.equal(result.median, 22); // still computed and visible, just not trusted
});

test('evaluatePercentileMedian: omitting expectedCount preserves prior 2-arg behavior exactly (no completeness check)', () => {
  assert.equal(evaluatePercentileMedian([20, 22, 24, 26, 28], 32).pass, true);
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
