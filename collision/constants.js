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
