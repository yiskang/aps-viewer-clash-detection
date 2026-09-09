// M4 Task 2.2: stage-attribution / residual engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForScreen, SCREEN_TRANSFERABLE_STAGES, MAIN_ONLY_STAGES, computeResidualAll } from './stage-attribution-engine.mjs';

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
