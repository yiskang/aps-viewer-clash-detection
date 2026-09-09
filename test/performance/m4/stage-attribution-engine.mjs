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
