// M4 Task 2.2: stage-attribution / residual engine tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStageForScreen, SCREEN_TRANSFERABLE_STAGES, MAIN_ONLY_STAGES, computeResidualAll, hardMaximum, computeResidualForBoundary, computeBoundaryOccupancy } from './stage-attribution-engine.mjs';

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

test('computeResidualForBoundary: only w\'s own owned stage(s) are subtracted, unlike the permissive screen', () => {
  // task [0,100); connectivity [0,50) and bvhConstruction [50,100). WB-2p only owns hardClashPrecheck,
  // so at this task NEITHER stage is w's own -> full 100ms is main-only-attributed to WB-2p.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const stages = [
    { startMs: 0, endMs: 50, source: 'harness-stage', stage: 'connectivity', validity: 'valid' },
    { startMs: 50, endMs: 100, source: 'harness-stage', stage: 'bvhConstruction', validity: 'valid' },
  ];
  assert.equal(computeResidualForBoundary([task], stages, ['hardClashPrecheck']), 100);
  // WB-1b owns compactAndWeld/connectivity/bvhConstruction -- both stages above ARE w's own -> residual 0.
  assert.equal(computeResidualForBoundary([task], stages, ['compactAndWeld', 'connectivity', 'bvhConstruction']), 0);
});

test('computeBoundaryOccupancy: sums intersections of a task with w\'s own sub-marks; no correlation mark supplied', () => {
  // task [0,100); sub-marks at [10,20) and [70,90) -- both fully inside the task.
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const subMarks = [
    { startMs: 10, endMs: 20, source: 'harness-stage', stage: 'boundary:WB-2p:inputSnapshot', validity: 'valid' },
    { startMs: 70, endMs: 90, source: 'harness-stage', stage: 'boundary:WB-2p:serializePostMessage', validity: 'valid' },
  ];
  const { value, deliveryTaskIdentified } = computeBoundaryOccupancy([task], subMarks, null, 100);
  assert.equal(value, 30); // 10 + 20
  assert.equal(deliveryTaskIdentified, false);
});

test('computeBoundaryOccupancy: a task with no intersecting sub-mark and not the delivery task contributes zero', () => {
  const task = { startMs: 0, endMs: 100, source: 'cdp-task', stage: null, validity: 'valid' };
  const { value } = computeBoundaryOccupancy([task], [], null, 100);
  assert.equal(value, 0);
});

test('computeBoundaryOccupancy: the identified delivery task contributes start-to-min(end,closingMark), clamped to the closing mark', () => {
  const deliveryTask = { startMs: 200, endMs: 260, source: 'cdp-task', stage: null, validity: 'valid' }; // keeps running to 260
  const correlationMarkMs = 205; // locates the delivery task, but is never used to TIME it
  const closingMarkMs = 240; // arm's closing performance.mark, before the task's own end
  const { value, deliveryTaskIdentified } = computeBoundaryOccupancy([deliveryTask], [], correlationMarkMs, closingMarkMs);
  assert.equal(deliveryTaskIdentified, true);
  assert.equal(value, 40); // min(260,240) - 200 = 40, never past the closing mark
});

test('computeBoundaryOccupancy: sub-mark contribution and delivery-task contribution add, when both land on the same window', () => {
  const inputTask = { startMs: 0, endMs: 30, source: 'cdp-task', stage: null, validity: 'valid' };
  const deliveryTask = { startMs: 200, endMs: 260, source: 'cdp-task', stage: null, validity: 'valid' };
  const subMarks = [{ startMs: 5, endMs: 15, source: 'harness-stage', stage: 'boundary:WB-2p:inputSnapshot', validity: 'valid' }];
  const { value } = computeBoundaryOccupancy([inputTask, deliveryTask], subMarks, 205, 240);
  assert.equal(value, 40); // max(10, 40) -- Hᵢ is the MAX over tasks, not a sum across tasks
});
