// test/performance/m4/yield-attribution.test.mjs
//
// M4 Task 3.7: unit tests for §6.2's SECOND yield-attribution rule and the span-label taxonomy that
// feeds it. Both live in run-gate-m4.mjs (the live half) because they are only meaningful against
// the recorder-lifecycle instants that file's own measured-query evaluate produces -- but both are
// pure functions over plain data, they are verdict-bearing, and no earlier task's brief,
// implementation, or review covers either, so they are tested directly here rather than resting
// entirely on the live matrix's own manual verification.
//
// §6.2, verbatim: "Where a stage's span overlaps a yield whose own boundaries were not recorded,
// that stage contributes no attributed interval and the report says so, rather than contributing
// an interval that may be wrong."
//
// Importing run-gate-m4.mjs does NOT start a gate run: that file guards `main()` behind an
// `isMainModule` check that also rejects `NODE_TEST_CONTEXT`, which `node --test` sets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partitionStageIntervalsByAttributability, spanRecordsToStageRecords,
  SPAN_LABEL_TO_STAGE, CHECKPOINT_SPAN_LABELS,
} from '../run-gate-m4.mjs';

const COVERAGE = { recorderInstalledAtMs: 100, recorderClearedAtMs: 200 };
const interval = (startMs, endMs, stage = 'compactAndWeld') => ({ startMs, endMs, stage, source: 'harness-stage', validity: 'valid' });

test('an interval fully inside the recorder lifetime is attributable', () => {
  const { attributable, unattributable } = partitionStageIntervalsByAttributability([interval(120, 180)], COVERAGE);
  assert.equal(attributable.length, 1);
  assert.deepEqual(unattributable, []);
});

test('boundary-touching intervals are attributable (the recorder WAS installed for the whole span)', () => {
  const { attributable, unattributable } = partitionStageIntervalsByAttributability([interval(100, 200)], COVERAGE);
  assert.equal(attributable.length, 1);
  assert.equal(unattributable.length, 0);
});

// The real, named scenario: a GeometryRegistry build phase ('weld'/'connectivity'/
// 'bvh-construction') triggered by a tuple's COLD query is still resolving when its WARM query's
// window opens, so its reconstructed `[receiptMs - durationMs, receiptMs]` span starts before the
// warm window's yield recorder was installed. Every yield in that earlier portion reported to
// nobody, so splitting on the yields we DO have would fold the unrecorded ones in as if they were
// synchronous stage time.
test('an interval starting before the recorder was installed is EXCLUDED, with a named reason', () => {
  const { attributable, unattributable } = partitionStageIntervalsByAttributability([interval(80, 150, 'bvhConstruction')], COVERAGE);
  assert.deepEqual(attributable, []);
  assert.equal(unattributable.length, 1);
  assert.equal(unattributable[0].reason, 'span-starts-before-yield-recorder-install');
  assert.equal(unattributable[0].stage, 'bvhConstruction');
  assert.equal(unattributable[0].durationMs, 70);
});

test('an interval ending after the recorder was cleared is EXCLUDED, with a named reason', () => {
  const { unattributable } = partitionStageIntervalsByAttributability([interval(150, 260)], COVERAGE);
  assert.equal(unattributable.length, 1);
  assert.equal(unattributable[0].reason, 'span-ends-after-yield-recorder-clear');
});

// The rule is "contributes NO attributed interval" -- not "contributes its covered part". Clipping
// an excluded interval to [installedAt, end] would be exactly the estimation §6.2 forbids: the
// clipped remainder is still a guess about where the unrecorded yield fell.
test('an excluded interval is dropped ENTIRELY -- never clipped to its covered portion', () => {
  const { attributable, unattributable } = partitionStageIntervalsByAttributability([interval(80, 150)], COVERAGE);
  assert.equal(attributable.length, 0);
  assert.equal(unattributable[0].startMs, 80);
  assert.equal(unattributable[0].endMs, 150);
});

test('a mixed set partitions independently -- one bad interval never suppresses a good one', () => {
  const { attributable, unattributable } = partitionStageIntervalsByAttributability(
    [interval(110, 120, 'connectivity'), interval(80, 190, 'compactAndWeld'), interval(150, 160, 'clearanceDistanceQuery')],
    COVERAGE,
  );
  assert.deepEqual(attributable.map((i) => i.stage), ['connectivity', 'clearanceDistanceQuery']);
  assert.deepEqual(unattributable.map((i) => i.stage), ['compactAndWeld']);
});

test('an empty input yields empty partitions, never a throw', () => {
  assert.deepEqual(partitionStageIntervalsByAttributability([], COVERAGE), { attributable: [], unattributable: [] });
});

// ---- Span-label taxonomy ----------------------------------------------------------------------

test('spanRecordsToStageRecords: maps every §6.3 stage label onto its spec stage name', () => {
  const records = Object.keys(SPAN_LABEL_TO_STAGE).map((label, i) => ({ label, ms: 1, receiptMs: 10 + i }));
  const { stageRecords, unmappedSpanLabels } = spanRecordsToStageRecords(records);
  assert.equal(stageRecords.length, records.length);
  assert.deepEqual(unmappedSpanLabels, []);
  assert.deepEqual(stageRecords.map((r) => r.stage).sort(), Object.values(SPAN_LABEL_TO_STAGE).sort());
});

// A checkpoint span measures "synchronous time since this port's previous checkpoint" -- §6.2's
// SCHEDULER-CONFORMANCE metric, not a stage duration. Subtracting one from a main-thread task as
// transferable stage time would shrink Rᵢ using a quantity that is not a stage at all.
test('spanRecordsToStageRecords: inter-checkpoint spans NEVER become stage records', () => {
  const records = [...CHECKPOINT_SPAN_LABELS].map((label) => ({ label, ms: 5, receiptMs: 50 }));
  const { stageRecords, unmappedSpanLabels } = spanRecordsToStageRecords(records);
  assert.deepEqual(stageRecords, []);
  assert.deepEqual(unmappedSpanLabels, [], 'a known checkpoint label is deliberately excluded, not reported as an unmapped gap');
});

test('spanRecordsToStageRecords: reports §6.2\'s max inter-checkpoint span ACROSS EVERY label', () => {
  const { schedulerConformance } = spanRecordsToStageRecords([
    { label: 'broad-phase-scan', ms: 6.1, receiptMs: 10 },
    { label: 'clearance-narrow-phase-pair', ms: 12.2, receiptMs: 20 },
    { label: 'weld', ms: 999, receiptMs: 30 }, // a STAGE span -- must never win the conformance max
  ]);
  assert.equal(schedulerConformance.maxInterCheckpointSpanMs, 12.2);
  assert.equal(schedulerConformance.maxInterCheckpointSpanLabel, 'clearance-narrow-phase-pair');
});

test('spanRecordsToStageRecords: a genuinely unknown label is reported by name, never swallowed', () => {
  const { stageRecords, unmappedSpanLabels } = spanRecordsToStageRecords([{ label: 'some-future-label', ms: 3, receiptMs: 9 }]);
  assert.deepEqual(stageRecords, []);
  assert.deepEqual(unmappedSpanLabels, ['some-future-label']);
});

test('spanRecordsToStageRecords: no span at all reports a null conformance max, never -Infinity or 0', () => {
  const { schedulerConformance } = spanRecordsToStageRecords([]);
  assert.equal(schedulerConformance.maxInterCheckpointSpanMs, null);
});
