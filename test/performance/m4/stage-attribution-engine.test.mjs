// M4 Task 2.2: stage-attribution / residual engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForScreen, SCREEN_TRANSFERABLE_STAGES, MAIN_ONLY_STAGES, computeResidualAll, hardMaximum } from './stage-attribution-engine.mjs';

test('§6.3 classification: compactAndWeld and geometryResolutionPerPair count as transferable for the screen', () => {
  assert.equal(classifyStageForScreen('compactAndWeld'), 'transferable');
  assert.equal(classifyStageForScreen('geometryResolutionPerPair'), 'transferable');
  assert.equal(classifyStageForScreen('connectivity'), 'transferable');
  assert.equal(classifyStageForScreen('bvhConstruction'), 'transferable');
  assert.equal(classifyStageForScreen('tlasBuildCacheQuery'), 'transferable');
  assert.equal(classifyStageForScreen('broadPhaseCandidateWork'), 'transferable');
  assert.equal(classifyStageForScreen('hardClashPrecheck'), 'transferable');
  assert.equal(classifyStageForScreen('exactNarrowPhase'), 'transferable');
  assert.equal(classifyStageForScreen('clearanceDistanceQuery'), 'transferable');
});

test('§6.3 classification: extraction, aggregation, lifecycle, and scheduler overhead stay main-only', () => {
  assert.equal(classifyStageForScreen('viewerExtraction'), 'main-only');
  assert.equal(classifyStageForScreen('resultAggregation'), 'main-only');
  assert.equal(classifyStageForScreen('lifecycleValidationAndPublication'), 'main-only');
  assert.equal(classifyStageForScreen('schedulerYieldOverhead'), 'main-only');
});

test('throws on a stage name outside §6.3\'s fixed table', () => {
  assert.throws(() => classifyStageForScreen('notARealStage'), /unknown stage/);
});

test('the two exported sets partition exactly the 13 known §6.3 stages with no overlap', () => {
  assert.equal(SCREEN_TRANSFERABLE_STAGES.size + MAIN_ONLY_STAGES.size, 13);
  for (const s of SCREEN_TRANSFERABLE_STAGES) assert.equal(MAIN_ONLY_STAGES.has(s), false);
});

test('computeResidualAll: subtracts a transferable stage fully covering the task -> zero residual', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 0);
});

test('computeResidualAll: longest contiguous main-only remainder around a transferable stage', () => {
  // task [0,100); transferable stage [30,60) -> main-only remainder is [0,30) and [60,100); longest is 40
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 30, endMs: 60, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 40);
});

test('computeResidualAll: a main-only-classified stage does not subtract anything', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stage = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'resultAggregation', validity: 'valid' };
  assert.equal(computeResidualAll([task], [stage]), 100);
});

test('computeResidualAll: an empty task list is a defined, intentional zero, not -Infinity', () => {
  assert.equal(computeResidualAll([], []), 0);
});

test('computeResidualAll: innermost classified stage wins under nesting (main-only bracket wraps a transferable one)', () => {
  // task [0,100); outer main-only stage [0,100) wraps an inner transferable stage [40,60).
  // Instant t in [40,60) is covered by BOTH; only the innermost (the transferable one, span 20) decides -> covered.
  // Instants in [0,40) and [60,100) are covered only by the outer main-only stage -> not covered.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const outer = { startMs: 0, endMs: 100, source: 'harness-stage', stage: 'lifecycleValidationAndPublication', validity: 'valid' };
  const inner = { startMs: 40, endMs: 60, source: 'harness-stage', stage: 'connectivity', validity: 'valid' };
  // uncovered runs are [0,40) and [60,100), both length 40 -- the longest-contiguous figure is 40
  assert.equal(computeResidualAll([task], [outer, inner]), 40);
});

test('computeResidualAll: hard maximum across multiple tasks in the window', () => {
  const taskA = { startMs: 0, endMs: 30, source: 'cdp-task', stage: null, validity: 'valid' }; // fully main-only: residual 30
  const taskB = { startMs: 100, endMs: 180, source: 'cdp-task', stage: null, validity: 'valid' }; // fully main-only: residual 80
  assert.equal(computeResidualAll([taskA, taskB], []), 80);
});

test('hardMaximum: reduces 5 repetition values, and refuses an empty array rather than returning -Infinity', () => {
  assert.equal(hardMaximum([10, 45, 12, 8, 30]), 45);
  assert.throws(() => hardMaximum([]), /empty repetition set/);
});
