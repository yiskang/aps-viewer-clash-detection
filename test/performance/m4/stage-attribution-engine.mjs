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

// ---- Addendum (controller ruling, spec-mandated, not in the original Task 2.2 brief) -----------
// See this file's test suite header comment for the full §6.2/§16.4 rationale: a reconstructed
// interval is never assumed contiguous, so any interval overlapping a recorded yield must be
// split at that yield's boundaries before its sub-segments count as stage-attributed time.

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

// YieldRecord = { receiptMs: number, resumeLatencyMs: number } -- captured the same way a harness
// already captures stageRecords: receiptMs is a performance.now() timestamp taken when
// setYieldRecorder's callback fires; resumeLatencyMs is that callback's own first argument.
export function yieldRecordsToIntervals(yieldRecords) {
  return yieldRecords.map((r) => {
    if (!isFiniteNumber(r.receiptMs)) {
      throw new Error(`yieldRecordsToIntervals: malformed yield record has a non-finite receiptMs (${r.receiptMs}) -- this is a harness-computation bug, not a data anomaly`);
    }
    if (!isFiniteNumber(r.resumeLatencyMs) || r.resumeLatencyMs < 0) {
      throw new Error(`yieldRecordsToIntervals: malformed yield record has a negative or non-finite resumeLatencyMs (${r.resumeLatencyMs}) -- this is a harness-computation bug, not a data anomaly`);
    }
    return { startMs: r.receiptMs - r.resumeLatencyMs, endMs: r.receiptMs };
  });
}
