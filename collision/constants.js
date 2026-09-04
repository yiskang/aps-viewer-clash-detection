// collision/constants.js
//
// Single source of truth for every tolerance/budget constant. Every other module in
// this library imports from here rather than hardcoding a literal a second time.

// ---- Tolerances (spec:1595-1650, 1779-1781) ----
export const barycentricEpsilon = 1e-6;                // dimensionless, frame-free
export const coplanarAngleEpsilon = 1e-6;               // dimensionless (1 - |n·n|), frame-free
export const mergeDistanceFactor = 1e-6;                // × L_target
export const surfaceEpsilonFactor = 1e-6;               // × L_target
export const offsetLadderFactors = [1e-3, 1e-4, 1e-5];  // × L_canonical
export const witnessLadderFactors = [1e-3, 1e-4, 1e-5]; // × L_source
export const crossingProbeFractions = [0.5, 0.1, 0.01]; // dimensionless, × triangle's own in-plane dAvail
export const minPenetrationDepthFactor = 1e-5;          // × L_canonical -- DECLARED detection limit, not a bug
export const weldEpsilonMeters = 1e-4;                  // meters; divide by model.getUnitScale() (fallback: literal 1e-4 if unit scale unavailable)
// M1 disposition (spec Tolerances section, "Single-geometry aspect ratio"): mergeDistanceFactor/
// surfaceEpsilonFactor above both scale off a target's single global localDiagonal, which breaks
// down for an extreme single-geometry aspect ratio -- failure onset (by this file's max/min local
// AABB extent metric) is ~354,000:1 for a two-long-dimension shape (the tighter of two derived
// estimates; a one-long-dimension shape fails later, ~500,000-700,000:1) -- see
// test/query/ContainmentQuery.classifyPoint.test.mjs's `{ todo: true }` fixture (which is actually
// ~2,000,000:1 by this metric, not the ~1,000,000 its box dimensions might suggest by eye).
// 10,000 sits ~35x below the tighter onset estimate and ~10x above the tested realistic-BIM
// fixture (~1000:1) -- a reasoned, not measured, safety margin. Declared unsupported beyond this
// bound for classifyPoint TARGET usage only (option A, scoped at the Task 9/12 call sites, never a
// blanket GeometryRegistry/Task-14 rejection -- surface-intersection mode never calls classifyPoint)
// rather than redesigning the tolerance model (option B), since no M1 acceptance criterion requires
// a target this extreme. This is a conservative proxy, not exact: whole-AABB max/min extent cannot
// detect a thin local feature embedded inside an otherwise roughly-cubic AABB.
export const maxLocalAspectRatio = 10_000;              // max/min local AABB extent, dimensionless

// ---- Budgets (spec:1913-2029, 2312-2497, 2565-2616, Data Flow step 3) ----
export const frameBudgetMs = 8;
export const maxCandidatePairsExamined = 50_000;
export const maxCrossingPairsExamined = 64;
export const maxContainmentSamples = 512;
export const samplesPerComponent = 8;
export const maxWitnessTriangles = 8;
export const maxSyncTriangleCount = 12_000;             // provisional -- revise per performance gate (Task 24)
export const maxFragmentsPerDbId = 5_000;               // provisional
export const maxChildrenPerNode = 10_000;               // provisional
export const maxBroadPhaseInstancePairs = 1_000_000;    // provisional

// maxCollisionInstancesPerEpoch has NO spec-chosen value ("provisional, value not yet
// chosen", spec:1324-1330, 2016-2017). This plan sets a reasoned provisional default:
// ~4x maxFragmentsPerDbId, enough headroom for a multi-dbId query plus repeated
// findClashes calls in one session. MUST be revised by the performance gate (Task 24)
// once real per-epoch retention is measured (spec:4786-4795).
export const maxCollisionInstancesPerEpoch = 20_000;
