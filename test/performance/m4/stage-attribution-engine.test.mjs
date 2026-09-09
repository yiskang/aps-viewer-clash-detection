// M4 Task 2.2: stage-attribution / residual engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForScreen, SCREEN_TRANSFERABLE_STAGES, MAIN_ONLY_STAGES } from './stage-attribution-engine.mjs';

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
