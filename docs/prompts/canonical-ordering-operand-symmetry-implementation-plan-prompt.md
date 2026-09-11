# Prompt — Implementation Plan for Canonical Ordering / Operand Symmetry Fix

Open a **fresh Claude session**.

This is an **implementation-planning task only**.

Do **not** implement code.
Do **not** continue M4 Phase 4.
Do **not** relax §6.4.
Do **not** change the M4 verdict reducer.
Do **not** suppress Viewer reloads as a workaround.
Do **not** widen diagnostic tolerances.
Do **not** fold this into the existing M4 plan as ad hoc tasks.

Use as source of truth:

- `docs/superpowers/specs/2026-09-11-canonical-ordering-operand-symmetry-fix-design.md`
- `docs/research/m4-effect-b-precheck-diagnostic-nondeterminism-investigation.md`
- `docs/superpowers/specs/2026-09-11-proper-crossing-query-deterministic-budget-fix-design.md`
- current M4 design spec
- current M4 implementation plan
- landed current source

Prefer actual source over stale prose when they differ.

Write the implementation plan directly to:

`docs/superpowers/plans/2026-09-11-canonical-ordering-operand-symmetry-fix-implementation.md`

Do not return a long plan only in chat.

## Goal

Create an executable implementation plan that:

1. removes reload-unstable identity from correctness-bearing geometric ordering;
2. introduces the approved canonical `volumeOverlapQuery` wrapper over the directional `properCrossingQuery` kernel;
3. separates deterministic aggregation from geometric predicate semantics;
4. composes correctly with the ProperCrossing deterministic-budget fix;
5. includes a hard **Phase B′ recalibration checkpoint** before semantic rollout continues;
6. restores cross-reload / TLAS-linear / operand-swap determinism;
7. returns M4 to a valid Phase 3 canonical checkpoint;
8. does **not** implement any production worker architecture.

This is a correctness prerequisite discovered by M4, not worker evidence.

## Planning discipline

Before writing tasks:

1. inventory every current call site of:
   - `comparePlacedCanonically`
   - `volumeOverlapQuery`
   - `properCrossingQuery`
   - containment composition
   - dbId-level aggregation/tie-break
2. verify the exact current Phase A instrumentation already landed for ProperCrossing deterministic-budget calibration;
3. verify the current calibration harness path and identify every direct `properCrossingQuery` call;
4. identify all tests/gates covering volume-overlap, Hard-Clash precheck, clearance, aggregation, reload behavior, and TLAS/linear parity;
5. preserve current M1–M3 public schemas unless the finalized design explicitly requires otherwise.

Use RED → GREEN for each behavior change.

## Protected architecture decisions

Preserve these decisions exactly:

- `geometryIndex` is forbidden as correctness-bearing semantic ordering;
- runtime identity/cache keys remain separate from semantic geometric ordering;
- canonical ordering is implemented at the `volumeOverlapQuery` wrapper boundary;
- `properCrossingQuery` remains directional;
- aggregation/tie-breaking is separate from geometric semantics;
- semantic results must be stable across Viewer reloads even when `geometryIndex` changes;
- operand swap must not change symmetric geometric truth/completeness classification;
- §6.4 remains strict;
- timing-diagnostic carve-out is not expanded;
- no Worker / postMessage / production worker path;
- M4 verdict logic untouched.

Use the finalized geometric total-order sequence exactly:

**world diagonal → triangle count → vertex count → world matrix → content digest**

Do not substitute runtime identity fields.

# Required implementation phases

## Phase A — Canonical ordering infrastructure + focused correctness regressions

### A1. Geometry-order key helpers

Plan pure helpers for:

- world diagonal
- triangle count
- vertex count
- world matrix lexicographic comparison
- content digest fallback

Requirements:

- no Viewer runtime identity in the semantic key;
- deterministic across reloads and TLAS/linear arms;
- digest computation explicitly cached;
- no accidental per-pair full-geometry hashing;
- no public API change.

Tests:
- same geometry with different geometryIndex;
- reload stability;
- equal diagonal/counts but different matrices/content;
- total-order antisymmetry/transitivity;
- equal-key handling.

### A2. Canonical `volumeOverlapQuery` wrapper

Plan the wrapper exactly as finalized:

- choose canonical geometric operand orientation;
- call directional `properCrossingQuery`;
- preserve source/target provenance separately;
- compose containment as designed;
- normalize diagnostics/statistics so internal canonical orientation does not corrupt external ownership.

Do not rewrite `properCrossingQuery` into a symmetric kernel unless the design explicitly requires it.

### A3. Remove semantic dependence on `comparePlacedCanonically`

Update only call sites where it affects geometric operand orientation.

Preserve or replace it separately for aggregation if needed.

Do not reuse one comparator for both semantic orientation and aggregation unless the design explicitly permits it.

### A4. Focused Effect B regressions

Cover:

- known unstable Effect B pairs;
- 106-pair operand-swap replay;
- reload stability;
- geometryIndex permutation;
- `conclusive` / disposition;
- `inconclusiveCauses`;
- `clearanceDistanceQueriesRun`;
- `clearanceHardClashExclusions`;
- final pair/distance/witness stability.

No tolerance widening.

## Phase B′ — Production-path recalibration checkpoint

This is a **hard execution checkpoint**.

The previous ProperCrossing calibration cannot be reused automatically because production call flow changes.

The corrected calibration must exercise the **real production wrapper path**.

Important:

> The old harness called `properCrossingQuery` directly; B′ must not.

Measure:

- worst synchronous span across synthetic and real-model tiers;
- canonical-ordering overhead;
- content-digest overhead/cache hit rate;
- operation counters;
- deterministic-budget utilization;
- real-model worst;
- pathological synthetic worst.

Report:

- `S_worst`
- real-model worst
- count over 8 ms
- count over 24.8 ms
- deterministic cap max/percentile
- digest computation vs reuse counts
- comparison with previous Phase B calibration

Use the finalized design's exact pre-registered decision rule.

**Stop after B′ and wait for owner approval before Phase C.**

No later phase may auto-run before approval.

## Phase C — ProperCrossing deterministic semantic correction

Only after B′ approval.

Plan integration with the deterministic-budget design:

- wall-clock threshold becomes telemetry-only;
- semantic termination uses deterministic operation counters;
- approved structural cap retained unless B′ requires re-adjudication;
- `aborted` / inconclusive depend only on deterministic exhaustion or true inability to conclude;
- wall-clock threshold cannot flip semantic crossing truth;
- no `frameBudgetMs` retuning.

Tests:

- original hard-clash-precheck blocker pair;
- same-arm repeat stability;
- fake/frozen-clock independence;
- deterministic cap exhaustion;
- telemetry threshold crossing with unchanged semantics.

## Phase D — Composition regressions and compatibility

### D1. S2 k=100 focused parity

Re-run `S2[k=100:typical:clearance]`.

Require full §6.4 parity:
- pairs
- distances
- witnesses
- statistics
- diagnostics except only the already-approved narrow timing diagnostic exception
- exclusions
- distance-query counts

### D2. Same-arm repeated stability

Run focused workload repeatedly under TLAS-only and linear-only.

Require semantic/statistical stability.

### D3. Cross-reload parity

Reproduce the harness pattern that reloads between comparable runs.

Allow geometryIndex to change; semantic evidence must not.

### D4. M1/M2/M2.1/M3 compatibility

Run affected suites/gates.

Classify changed behavior as:
- intended correctness correction;
- telemetry-only;
- regression.

Do not silently update golden expectations if old expectations encoded buggy behavior.

### D5. Aggregation determinism

Equal-distance/equal-priority candidates must choose stable dbId-level winners independent of traversal order.

## Phase E — Return to M4 Phase 3 canonical matrix

Only after focused validation is green.

Plan:

1. full Phase 3 canonical matrix;
2. both runtime configs as required;
3. complete §6.4 validation;
4. valid population only;
5. recompute checkpoint evidence from scratch.

Previous failed runs and provisional D remain diagnostic-only.

At the checkpoint report:

- fixture/runtime validity
- §6.4 status
- R-case T-a/T-b/T-c
- main-only/transferable attribution
- active mandatory-D conditions
- T-a-failing tuples
- T-b/T-c-only failures
- authorized Phase 4 spikes
- provisional reducer result from the new VALID population only

Stop there. Do not start Phase 4 automatically.

# Implementation details that must be explicit

## 1. Content digest lifecycle

Define:

- exact input bytes;
- position/index participation;
- normalized active ranges;
- digest algorithm;
- compute timing;
- cache location/key;
- invalidation/eviction;
- memory overhead;
- unsupported geometry behavior.

Do not recompute full hashes per pair.

Align digest cache lifecycle with geometry registry lifetime.

## 2. World-matrix ordering

Define exact lexicographic ordering:

- element order;
- numeric comparison;
- treatment of `-0`;
- NaN/invalid matrix behavior;
- no fuzzy tolerance that breaks transitivity.

## 3. Equal-key fallback

If all geometric-order fields compare equal, define deterministic behavior.

Do not fall back to reload-unstable identity.

## 4. Provenance remapping

If internal canonical orientation swaps operands, preserve external source/target provenance for:

- diagnostics;
- witnesses;
- pair results;
- statistics/event records.

Plan explicit remapping tests.

## 5. Performance instrumentation

Canonical-order helper cost should be measurable but not correctness-bearing.

No unbounded event volume.

# Review strategy

At each phase boundary:

- targeted review only;
- fix genuine Critical/High findings;
- run focused tests;
- full regression only when shared production behavior changed;
- main orchestrator independently verifies subagent claims.

Mandatory checkpoint:

**B′ results require owner approval before Phase C starts.**

Do not create extra arbitrary checkpoints.

# Completion criteria

The implementation plan is complete when it defines a path to:

1. no correctness-bearing use of reload-unstable `geometryIndex`;
2. deterministic operand orientation / symmetric semantics across reloads;
3. Effect B focused regressions green;
4. production-path B′ recalibration;
5. deterministic ProperCrossing semantic fix;
6. S2 k=100 §6.4 parity;
7. same-arm repeat stability;
8. cross-reload parity;
9. M1/M2/M2.1/M3 compatibility;
10. full Phase 3 canonical matrix VALID;
11. return to M4 decision checkpoint;
12. no production worker architecture.

End with:

**Ready for execution**

Do not implement anything yet.
Do not commit.
