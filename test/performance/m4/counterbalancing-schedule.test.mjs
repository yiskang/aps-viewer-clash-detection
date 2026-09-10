// test/performance/m4/counterbalancing-schedule.test.mjs
//
// M4 Task 3.7: unit tests for §6.1.6's counterbalancing schedule (arm-order parity + case-order
// rotation), §5.6's S2T population-level counterbalancing (same rotation rule, applied to the
// level dimension), and §4's capacity-rejection record shape. The live dispatch loop these feed
// lives in run-gate-m4.mjs and is covered by that file's own manual verification, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armOrderForRepetition, caseOrderForRepetition, buildCounterbalancedSchedule, toCapacityRejectedRecord,
  M4_CASE_LIST,
} from './counterbalancing-schedule.mjs';

test('armOrderForRepetition: alternates by repetition parity', () => {
  assert.deepEqual(armOrderForRepetition(0), ['tlas', 'linear']);
  assert.deepEqual(armOrderForRepetition(1), ['linear', 'tlas']);
  assert.deepEqual(armOrderForRepetition(2), ['tlas', 'linear']);
});

test('caseOrderForRepetition: rotates by repetition index (repetition r starts at position r mod |cases|)', () => {
  const cases = ['R1', 'R2', 'R3', 'R4'];
  assert.deepEqual(caseOrderForRepetition(cases, 0), ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(caseOrderForRepetition(cases, 1), ['R2', 'R3', 'R4', 'R1']);
  assert.deepEqual(caseOrderForRepetition(cases, 5), ['R2', 'R3', 'R4', 'R1']); // 5 mod 4 = 1
});

test('buildCounterbalancedSchedule: 5 repetitions, each carrying its own case/arm order', () => {
  const schedule = buildCounterbalancedSchedule(['R1', 'R2'], 5);
  assert.equal(schedule.length, 5);
  assert.deepEqual(schedule[0].armOrder, ['tlas', 'linear']);
  assert.deepEqual(schedule[3].armOrder, ['linear', 'tlas']);
});

test('toCapacityRejectedRecord: names the exact limit and observed value, never silently trims', () => {
  const err = { kind: 'clearance-narrow-phase-budget', details: { observed: 25000 } };
  const record = toCapacityRejectedRecord(err, { limitName: 'maxClearanceNarrowPhasePairs', limitValue: 20000 });
  assert.deepEqual(record, { disposition: 'CAPACITY_REJECTED', limitName: 'maxClearanceNarrowPhasePairs', limitValue: 20000, observedValue: 25000, errorKind: 'clearance-narrow-phase-budget' });
});

// ---- Beyond the brief's own four assertions --------------------------------------------------
// Each of the following covers a way the live scheduler in run-gate-m4.mjs actually calls these
// functions that the brief's own test does not reach.

test('caseOrderForRepetition: never mutates or aliases its input', () => {
  const cases = ['R1', 'R2', 'R3'];
  const rotated = caseOrderForRepetition(cases, 1);
  rotated[0] = 'MUTATED';
  assert.deepEqual(cases, ['R1', 'R2', 'R3']);
});

test('caseOrderForRepetition: the rotated list is always a permutation of the input', () => {
  const cases = M4_CASE_LIST;
  for (let r = 0; r < 5; r++) {
    const rotated = caseOrderForRepetition(cases, r);
    assert.equal(rotated.length, cases.length);
    assert.deepEqual([...rotated].sort(), [...cases].sort());
  }
});

// §5.6 counterbalances S2T's POPULATION LEVEL alongside arm order and case order, by the same
// rotation rule -- the live scheduler reuses caseOrderForRepetition for that dimension rather than
// duplicating the rotation, so the rule is pinned here on a numeric level list too.
test('caseOrderForRepetition: works as §5.6\'s S2T level-order counterbalancer', () => {
  const levels = [5435, 10000, 15000, 20000];
  assert.deepEqual(caseOrderForRepetition(levels, 0), [5435, 10000, 15000, 20000]);
  assert.deepEqual(caseOrderForRepetition(levels, 2), [15000, 20000, 5435, 10000]);
});

test('buildCounterbalancedSchedule: every repetition carries its own rotated case order', () => {
  const schedule = buildCounterbalancedSchedule(['R1', 'R2', 'R3'], 5);
  assert.deepEqual(schedule.map((s) => s.repetition), [0, 1, 2, 3, 4]);
  assert.deepEqual(schedule[0].caseOrder, ['R1', 'R2', 'R3']);
  assert.deepEqual(schedule[1].caseOrder, ['R2', 'R3', 'R1']);
  assert.deepEqual(schedule[2].caseOrder, ['R3', 'R1', 'R2']);
  assert.deepEqual(schedule[3].caseOrder, ['R1', 'R2', 'R3']); // 3 mod 3 = 0
});

test('buildCounterbalancedSchedule: rejects an empty case list rather than emitting empty rotations', () => {
  assert.throws(() => buildCounterbalancedSchedule([], 5), /at least one case/);
});

test('buildCounterbalancedSchedule: rejects a non-positive repetition count', () => {
  assert.throws(() => buildCounterbalancedSchedule(['R1'], 0), /repetitionCount/);
});

// §4's own reporting rule: a capacity rejection is a FINDING, never a silently-trimmed workload.
// A real CapacityExceededError need not carry `details.observed` at all, and `?? null` must not be
// allowed to turn a legitimately-zero observed value into null.
test('toCapacityRejectedRecord: a missing observed value reports null, never 0 or undefined', () => {
  const record = toCapacityRejectedRecord({ kind: 'source-fragment-budget' }, { limitName: 'maxSourceFragments', limitValue: 100 });
  assert.equal(record.observedValue, null);
  assert.equal(record.errorKind, 'source-fragment-budget');
  assert.equal(record.disposition, 'CAPACITY_REJECTED');
});

test('toCapacityRejectedRecord: a zero observed value is preserved, not coerced to null', () => {
  const record = toCapacityRejectedRecord({ kind: 'k', details: { observed: 0 } }, { limitName: 'l', limitValue: 1 });
  assert.equal(record.observedValue, 0);
});

test('toCapacityRejectedRecord: a non-CapacityExceededError-shaped input still yields a well-formed record', () => {
  const record = toCapacityRejectedRecord(new Error('boom'), { limitName: 'unknown', limitValue: null });
  assert.deepEqual(record, { disposition: 'CAPACITY_REJECTED', limitName: 'unknown', limitValue: null, observedValue: null, errorKind: null });
});

test('M4_CASE_LIST: exactly §5.2/§5.3\'s baseline matrix -- R1-R6, S1-S4, S2T, no spikes', () => {
  assert.deepEqual(M4_CASE_LIST, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'S1', 'S2', 'S3', 'S4', 'S2T']);
  // The four unconditional spikes (S1'/S2'/S3'/S4') belong to tasks 3.9/3.10, never to this list.
  assert.ok(!M4_CASE_LIST.some((c) => c.endsWith("'")));
});
