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
// minSurfaceCrossingProbeFactor is a DISTINCT constant from minPenetrationDepthFactor above
// even though the numeric value happens to match today -- do not collapse the two.
// minPenetrationDepthFactor is documented specifically as 1e-5 x L_canonical for
// VolumeOverlapQuery's four-quadrant offset ladder; this constant instead declares
// SurfaceCrossingWitness's own in-plane probe floor, scaled by L_source (that file's
// probes are stepped in the SOURCE triangle's own local frame), not L_canonical.
// Reusing minPenetrationDepthFactor here would conflate two different declared
// contracts for two different quantities that merely share a value today.
export const minSurfaceCrossingProbeFactor = 1e-5;      // × L_source -- SurfaceCrossingWitness's declared minimum-detectable in-plane probe step
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
// Bounds ProperCrossingQuery's DOMINANT cost tier -- classifyPoint invocations made by its probe
// ladder (docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md,
// Decision 3 / Sec 4.2-4.3 / Sec 14.4 item 5). The value is ARITHMETIC, not measured and not judged:
// maxCrossingPairsExamined x (2 signs x 2 signs x 3 offsetLadderFactors rungs x 2 operands) = 64 x 24
// = 1536 is EXACTLY the structural maximum that file's fixed nested probe loop can already reach
// today. It is therefore NON-BINDING BY CONSTRUCTION -- it can never censor a traversal the shipped
// algorithm would have completed -- which is what makes the design's Phase A (behavior-neutral
// instrumentation) possible at all.
//
// Why it exists despite being non-binding (design Sec 4.3): the 1536 bound is an EMERGENT property of
// a nested loop, invisible at any single site and silently broken by anyone adding an
// offsetLadderFactors rung or a quadrant sign -- as an explicit cap it becomes a checked contract;
// it is the deterministic test seam for probe-budget exhaustion that needs no injected clock; and it
// is the unit any future span-motivated retune would have to be argued in.
//
// Any value BELOW 1536 is explicitly OUT OF SCOPE for that design: it would be a reduction in
// geometric search completeness and needs its own acceptance criteria and compatibility
// classification, never a quiet retune (design Sec 4.3). Derived rather than written as a literal so
// the two can never drift.
//
// The per-pair factor is exported separately because ProperCrossingQuery must be able to re-derive
// the cap from the EFFECTIVE crossing-pair budget, not only from the shipped one. An earlier draft
// defaulted to this fixed 1536 unconditionally, which silently broke the non-binding guarantee for
// any caller that raised options.maxCrossingPairsExamined above 64: such a traversal would newly
// abort on 'point-classifications' having searched LESS geometry than the same override bought
// before the cap existed (found by an independent codex-review of the Phase C diff, reproduced at
// maxCrossingPairsExamined: 200 -- 105 admitted pairs instead of 201). Deriving from the effective
// budget makes "non-binding by construction" true unconditionally, which is what the design claims.
export const maxProbeClassificationsPerCrossingPair = 2 * 2 * offsetLadderFactors.length * 2; // 24
export const maxCrossingPointClassifications = maxCrossingPairsExamined * maxProbeClassificationsPerCrossingPair; // 1536
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

// Bounds primitive-candidate expansion under broadPhase:'tlas' (design spec §9.3). Unlike
// maxBroadPhaseInstancePairs, this cannot be precomputed as a Cartesian product -- traversal
// cost is not known until it runs -- so it is checked incrementally, not as an upfront precheck.
// Provisional: revise per the M2 performance gate (Task 21), same posture constants.js already
// documents for maxCollisionInstancesPerEpoch above.
export const maxTlasCandidatePairs = 200_000;

// M3 — Soft Clash / Clearance. Provisional: revise against the M3 performance gate's real numbers
// (test/performance/run-gate-m3.mjs).
export const maxClearanceNarrowPhasePairs = 20_000;

// SVF2 non-uniform fragment clearance (docs/superpowers/specs/
// 2026-10-07-svf2-nonuniform-fragment-clearance-design.md §5.2): hard per-epoch byte budget for the
// clearance-private derived ("prescaled") geometry cache -- actual retained position + index + BVH
// bytes of its ready entries. Exceeding it (or the entry cap, maxCollisionInstancesPerEpoch) evicts
// least-recently-used entries; eviction only costs a rebuild, never changes a result. Provisional,
// same M3-gate retuning discipline as maxClearanceNarrowPhasePairs above.
export const maxClearanceDerivedGeometryBytesPerEpoch = 256 * 1024 * 1024; // 256 MiB

// M3 — the design spec leaves both qualitative ("a small relative tolerance"); picked here to match
// the existing weld-epsilon order of magnitude. Provisional, same tuning discipline as above.
export const clearanceUniformScaleRelativeTolerance = 1e-4;
export const clearanceDistanceCrossCheckRelativeTolerance = 1e-4;

// ClearanceQuery cross-checks the SAME world distance computed independently from each operand's own
// validated uniform scale factor. `validateUniformScale` accepts each operand at up to
// `clearanceUniformScaleRelativeTolerance` relative scale error, and the two operands can err in
// OPPOSITE directions, so two validator-blessed operands can legitimately disagree by
// (1+t)/(1-t) - 1 = 2t + O(t^2) ~= 2.0002e-4 -- already WIDER than the single-operand 1e-4 figure, so
// cross-checking against 1e-4 spuriously aborts on input the validator itself blessed. Use the
// combined two-operand bound plus one more single-operand allowance on top for the float32 geometry
// and triangle-distance arithmetic that produces the two numbers. Still ~3 orders of magnitude
// tighter than any real distance-computation bug (frame/unit mixups are O(1) relative), so this
// stays a meaningful check rather than a rubber stamp.
export const clearanceDistanceCrossCheckCombinedRelativeTolerance =
  2 * clearanceUniformScaleRelativeTolerance + clearanceDistanceCrossCheckRelativeTolerance; // 3e-4

// ClearanceQuery inflates the pinned BVH's `maxThreshold` by this relative margin before handing it
// to `closestPointToGeometry`. Two independent effects put a candidate whose EXACT distance equals
// `clearance` on the wrong side of the library's own strict `score < maxThreshold` test:
//  1. float32 node-bound padding, ~2^-23 (1.19e-7) relative -- measured: for an exact world gap of 1
//     the bounds-level score comes out at 0.9999998807907106, i.e. exactly one float32 epsilon of
//     padding decides it, not geometry;
//  2. the residual anisotropy `validateUniformScale` deliberately accepts. Two accepted operands can
//     distort a given direction in OPPOSITE senses, so the library's nested (far-local) score can
//     over-state the anchor-local threshold by (1+t)/(1-t) - 1 ~= 2.0002e-4 even when both operands
//     report the SAME scaleFactor.
// 4x the per-operand tolerance covers (2) with ~2x headroom and (1) by ~3300x, while still only
// widening the traversal threshold by 0.04% -- no meaningful change to pruning effectiveness. Safe
// because ClearanceQuery ALWAYS applies its own exact `worldDistance > clearance` post-filter
// afterwards, so a more permissive traversal threshold can only cost a little extra traversal, never
// admit a result beyond `clearance`.
export const clearanceTraversalThresholdSafetyMargin = 4 * clearanceUniformScaleRelativeTolerance; // 4e-4
