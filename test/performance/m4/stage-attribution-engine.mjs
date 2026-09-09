// M4 Task 2.2: stage-attribution / residual engine. Consumes Task 2.1's frozen interval contract.

export const SCREEN_TRANSFERABLE_STAGES = new Set([
  'compactAndWeld',
  'connectivity',
  'bvhConstruction',
  'tlasBuildCacheQuery',
  'broadPhaseCandidateWork',
  'geometryResolutionPerPair',
  'hardClashPrecheck',
  'exactNarrowPhase',
  'clearanceDistanceQuery',
]);

export const MAIN_ONLY_STAGES = new Set([
  'viewerExtraction',
  'resultAggregation',
  'lifecycleValidationAndPublication',
  'schedulerYieldOverhead',
]);

export function classifyStageForScreen(stageName) {
  if (SCREEN_TRANSFERABLE_STAGES.has(stageName)) return 'transferable';
  if (MAIN_ONLY_STAGES.has(stageName)) return 'main-only';
  throw new Error(`stage-attribution-engine: unknown stage "${stageName}" is not in §6.3's fixed classification table`);
}

function innermostCoveringStage(t, stageIntervals) {
  let winner = null;
  for (const s of stageIntervals) {
    if (s.startMs <= t && t < s.endMs) {
      if (winner === null || s.endMs - s.startMs < winner.endMs - winner.startMs) winner = s;
    }
  }
  return winner;
}

// Longest contiguous main-only (uncovered) sub-interval of `task`. Overlapping stages are counted
// once: only the innermost stage covering an instant decides whether that instant is "covered".
function longestContiguousUncovered(task, stageIntervals, isTransferable) {
  const overlapping = stageIntervals.filter((s) => s.startMs < task.endMs && s.endMs > task.startMs);
  const boundarySet = new Set([task.startMs, task.endMs]);
  for (const s of overlapping) {
    if (s.startMs > task.startMs && s.startMs < task.endMs) boundarySet.add(s.startMs);
    if (s.endMs > task.startMs && s.endMs < task.endMs) boundarySet.add(s.endMs);
  }
  const points = [...boundarySet].sort((a, b) => a - b);

  let longest = 0;
  let runLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segEnd <= segStart) continue;
    const covering = innermostCoveringStage(segStart, overlapping);
    const isCovered = covering !== null && isTransferable(covering.stage);
    if (isCovered) {
      runLength = 0;
    } else {
      runLength += segEnd - segStart;
      longest = Math.max(longest, runLength);
    }
  }
  return longest;
}

function maxOverTasks(taskIntervals, stageIntervals, isTransferable) {
  let max = 0;
  for (const task of taskIntervals) {
    max = Math.max(max, longestContiguousUncovered(task, stageIntervals, isTransferable));
  }
  return max;
}

export function computeResidualAll(taskIntervals, stageIntervals) {
  return maxOverTasks(taskIntervals, stageIntervals, (stage) => classifyStageForScreen(stage) === 'transferable');
}

export function computeResidualForBoundary(taskIntervals, stageIntervals, ownedStageNames) {
  const owned = new Set(ownedStageNames);
  return maxOverTasks(taskIntervals, stageIntervals, (stage) => owned.has(stage));
}

export function hardMaximum(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('hardMaximum: refusing to reduce an empty repetition set (Math.max(...[]) === -Infinity would silently pass every threshold)');
  }
  return Math.max(...values);
}

function intersectionMs(a, b) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

export function computeBoundaryOccupancy(taskIntervals, subMarkIntervals, correlationMarkMs, closingMarkMs) {
  let deliveryTask = null;
  if (correlationMarkMs !== null) {
    deliveryTask = taskIntervals.find((t) => t.startMs <= correlationMarkMs && correlationMarkMs < t.endMs) ?? null;
  }

  let max = 0;
  for (const task of taskIntervals) {
    let sum = 0;
    for (const mark of subMarkIntervals) sum += intersectionMs(task, mark);
    if (deliveryTask !== null && task === deliveryTask) {
      sum += Math.max(0, Math.min(task.endMs, closingMarkMs) - task.startMs);
    }
    max = Math.max(max, sum);
  }
  return { value: max, deliveryTaskIdentified: deliveryTask !== null };
}
