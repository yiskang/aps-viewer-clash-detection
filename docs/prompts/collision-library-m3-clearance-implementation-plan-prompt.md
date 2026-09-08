# M3 Implementation-Plan Prompt — Soft Clash / Clearance

Create the implementation plan for:

**M3 — Soft Clash / Clearance**

This is a planning task only.

Do NOT implement code.
Do NOT reopen settled M1/M2/M2.1 architecture unless the landed M3 design exposes a concrete contradiction.
Do NOT broaden scope into penetration volume, CSG, physics, worker/off-main-thread execution, or clash-management workflow.

Use as source of truth:

- `docs/superpowers/specs/2026-09-07-collision-library-milestone3-clearance-design.md`
- the ACTUAL landed implementation on `main`
- current `collision/README.md` / `CHANGELOG.md`
- current real federated acceptance/performance harnesses

Prefer landed code over stale snippets in older plans/specs if they differ.

Save the implementation plan under:

`docs/superpowers/plans/`

Suggested filename:

`2026-09-08-collision-library-milestone3-clearance-implementation.md`

---

## Goal

Turn the finalized M3 design into a task-sequenced implementation plan for:

**Soft Clash / Clearance**

Required semantic contract:

```text
Soft Clash iff:
  no Hard Clash for the dbId pair
  AND distance > toleranceFloor
  AND distance <= clearance
```

with:

- `mode: 'clearance'`
- exact minimum surface-to-surface distance
- public `distance`
- echoed requested `clearance`
- public closest-point witness:
  ```js
  witness: {
    sourcePoint: [x, y, z],
    targetPoint: [x, y, z]
  }
  ```
- deterministic minimum-distance aggregation
- TLAS accelerated broad phase
- permanent linear oracle
- independent Viewer action for Soft Clash

---

## Planning discipline

Before writing tasks:

1. Inventory the ACTUAL landed M2/M2.1 implementation interfaces.
2. Reconcile the M3 spec against current source.
3. Identify exact files/modules to create or modify.
4. Preserve every M1/M2/M2.1 invariant unless the M3 spec explicitly changes it.
5. Build vertical, independently verifiable tasks.
6. Put tests/fixtures with the behavior they introduce.
7. Keep code snippets subordinate to landed interfaces; if an interface is uncertain, make verification/research an explicit earlier task instead of guessing.
8. Keep the linear path as a permanent correctness oracle.

Do not insert arbitrary human stops between tasks. Use batch-level reviews at real dependency boundaries.

---

## Required implementation responsibilities

The plan must cover all of the following.

### 1. Public API / validation

Plan additive support for:

- `mode: 'clearance'`
- required `clearance` numeric input
- reject missing / non-finite / `<= 0` clearance
- reject `clearance` if `mode !== 'clearance'`
- preserve shape-dependent `broadPhase` default behavior
- preserve existing modes unchanged

Add tests for validation precedence and backward compatibility.

---

### 2. `boundsTree` production invariant

This is a critical prerequisite.

Plan the required M3 change in `ThreeMeshBvhBackend.build()`:

- assign the built BVH to the geometry as `geometry.boundsTree = bvh`
- do this at the one canonical BLAS construction point
- preserve the existing `indirect: true` build
- ensure production and test fixtures use the SAME backend-returned geometry object

Also update fixture helpers (notably `test/fixtures/geometry.mjs`) so unit tests do not accidentally exercise a different path than production.

Add contract/regression tests proving:

- returned geometry owns the expected `boundsTree`,
- `closestPointToGeometry` takes the accelerated BVH-to-BVH path,
- fixture geometry and production geometry share the same invariant.

Do not attach a second, independently-built tree.

---

### 3. Clearance transform validation

Plan clearance-specific admission/instance validation before broad phase.

For every instance used by a `mode:'clearance'` query, validate:

- finite world matrix,
- invertible world matrix,
- finite correctly-ordered world bounds,
- decomposable scale,
- uniform scale within defined relative tolerance.

Required diagnostics:

- `clearance-invalid-transform`
- `clearance-anisotropic-scale-unsupported`

Do not silently allow NaN bounds to disappear from broad-phase comparisons.

Do not retroactively change extraction behavior for other modes unless a concrete shared helper is justified and does not alter their semantics.

---

### 4. World-unit tolerance floor

Implement the M3 tolerance contract:

```text
toleranceFloor =
  surfaceEpsilonFactor *
  max(
    source.localDiagonal * sourceUniformScale,
    target.localDiagonal * targetUniformScale
  )
```

Plan tests for:

- rigid transforms,
- uniform scale,
- near-zero dead band,
- exactly-at-floor,
- slightly-above-floor.

Do not compare local-frame and world-frame quantities directly.

---

### 5. Exact AABB distance helper

Plan one canonical exact/unpadded AABB-to-AABB minimum-distance helper reused by:

- clearance linear broad phase,
- TLAS candidate exact retest,
- Hard-Clash-precheck branch decision.

The helper must:

- return exact box separation lower bound,
- return 0 for overlap/touch,
- work in world coordinates,
- be deterministic and allocation-conscious.

Add focused tests with analytically known boxes.

---

### 6. Clearance broad phase — linear oracle

Plan a new permanent clearance-specific linear broad phase.

For every source/target instance pair:

- self-exclude as today,
- compute exact AABB minimum distance,
- keep candidate iff `aabbDistance <= clearance`,
- apply existing capacity semantics where appropriate,
- preserve call-scoped lifecycle/liveness checkpoints.

The linear path is the differential oracle for TLAS.

Do not route clearance through the existing strict-overlap-only Hard Clash broad-phase predicate.

---

### 7. Clearance broad phase — TLAS

Plan TLAS reuse with no new acceleration structure:

1. inflate source world AABB by `clearance`,
2. query existing `CollisionInstanceBVH.queryBox`,
3. apply existing target-scope membership filter,
4. source self-exclusion,
5. exact unpadded AABB-distance retest,
6. pass survivors to clearance narrow phase.

Reuse:

- `TlasCache`
- placement invalidation
- candidate-budget discipline
- lifecycle checks
- existing generic TLAS statistics where semantics still match.

Explicitly define where the new `clearance*` statistics increment.

Do not add a second TLAS.

---

### 8. Hard Clash exclusion precheck — tri-state

This is a correctness-critical task.

For any clearance candidate whose exact unpadded AABBs overlap or touch:

- run the existing `volumeOverlapQuery`
- classify the precheck as:
  - proven overlap
  - proven no-overlap
  - inconclusive

Rules:

#### Proven overlap
- mark the dbId pair as Hard-Clash-excluded
- do not compute clearance distance for that fragment pair

#### Proven no-overlap
- proceed to exact clearance distance

#### Inconclusive
- do not compute clearance distance
- do not emit a Soft Clash result for that fragment pair
- emit `clearance-hard-clash-precheck-inconclusive`

Do not treat `overlap:false` as proof of no overlap if diagnostics indicate incomplete/inconclusive evaluation.

Plan a helper/return normalization so this logic cannot drift into boolean-only truthiness.

Add targeted regression tests.

---

### 9. `ClearanceQuery.js`

Plan the new narrow-phase module:

`collision/query/ClearanceQuery.js`

Use pinned `MeshBVH.closestPointToGeometry`.

Required contract:

- source/target use the existing `Instance` shape
- relative transform:
  `targetToSource = inverse(source.matrix) * target.matrix`
- validate uniform scale
- call:
  `source.bvh.closestPointToGeometry(target.geometry, targetToSource, target1, target2, 0, clearance/sourceScale)`
- do NOT use `toleranceFloor` as `minThreshold`
- `maxThreshold` uses source-local clearance (`clearance/sourceScale`)
- convert returned local distance to world units via `sourceScale`
- cross-check target distances for sanity
- convert each closest point with its OWN operand world matrix
- return exact public world-space points
- handle `indirect:true` face-index resolution if any downstream use needs face indices
- if no result within max threshold, return a verified "beyond clearance" outcome, not an error
- if expected recoverable evaluation fails, return diagnostic-bearing aborted/incomplete outcome
- unexpected programming errors propagate

Add tests for:

- exact known box gap,
- rotated geometry,
- cross-model relative transform,
- uniform scale,
- anisotropic rejection,
- non-finite transform,
- beyond-threshold null result,
- exact threshold,
- dead-band exclusion.

---

### 10. Pair-count budget

Plan a new call-scoped narrow-phase budget:

`maxClearanceNarrowPhasePairs`

Semantics:

- bounds actual clearance narrow-phase work
- applies per `findClashes` call, not per model
- checked before executing another expensive pair-level operation
- failure throws `CapacityExceededError` with new kind:
  `clearance-narrow-phase-budget`
- never silently truncates
- preserve callback-safe / throw-after-traversal discipline where relevant

Numeric value is provisional and must be tuned against M3 performance evidence.

Separate semantic implementation from final tuning.

---

### 11. Clearance statistics

Plan the seven additive statistics fields from the spec:

- `clearanceExpandedCandidatePairs`
- `clearanceExactAabbSurvivors`
- `clearanceOverlapPrechecksRun`
- `clearanceHardClashExclusions`
- `clearanceDistanceQueriesRun`
- `clearanceHits`
- `clearanceQueryMs`

Requirements:

- always present, default `0`
- existing M2 generic TLAS fields remain unchanged
- exact increment points match the design
- linear path semantics are clearly defined
- `clearanceExpandedCandidatePairs` stays 0 under linear
- `clearanceHits === pairs.length` for clearance calls

Add consistency/inequality tests where useful.

---

### 12. Deterministic dbId aggregation

Plan minimum-distance aggregation.

For each dbId-level key:

- track whether ANY contributing fragment pair is a proven Hard Clash
- if so, exclude the entire dbId pair from clearance output
- otherwise choose the fragment-pair candidate with smallest world-space distance
- exact ties use canonical fragment ordering
- traversal order must not affect the result

Preserve M2/M2.1 pair identity keys.

Add tests for:

- multiple fragment pairs, minimum wins
- reversed candidate order
- linear vs TLAS equality
- Hard Clash in one fragment pair suppressing a near-miss on another fragment pair
- inconclusive fragment pair not being misreported

---

### 13. Clearance diagnostics

Plan explicit handling for only these recoverable conditions:

- `clearance-distance-unavailable`
- `clearance-anisotropic-scale-unsupported`
- `clearance-invalid-transform`
- `clearance-hard-clash-precheck-inconclusive`

Do not introduce an open-ended catch-all.

All clearance incompleteness diagnostics must trigger the UI's "result may be incomplete" caveat.

Do NOT apply M2.1's presentation-only `witness-unavailable` carve-out to clearance.

---

## Viewer UX

### 14. `Find Soft Clashes` action

Plan a second context-menu action in `ClashFinderExtension`.

Keep the existing Hard Clash action unchanged.

Plan:

- `DEFAULT_CLEARANCE = 0.05` provisional default
- extension option `defaultClearance`
- validate at extension load (finite, > 0)
- action invokes `findClashes({mode:'clearance', clearance:this._clearance, ...})`
- same aggregate-selection / all-loaded-model flow as existing Find Clashes
- same stale-action-token discipline

Do not add prompt/modal/settings UI.

---

### 15. Clearance visualization

Plan the minimal Soft Clash visualization:

- source closest-point marker
- target closest-point marker
- connecting line segment

Use Viewer r71 only (`window.THREE`).

Reuse M2.1 overlay scene/resource/lifecycle machinery wherever practical.

Decide whether:
- Hard Clash and Soft Clash share one overlay scene or use logically separate tracked object groups
- endpoint materials need distinct colors
- line material is through-occlusion / depth-disabled
- marker sizing reuses current radius logic

Keep the representation visual-only.

No labels/tooltips/dashboard.

---

### 16. Visualization lifecycle

Clearance visualization must obey the existing landed M2.1 lifecycle:

- success clear/apply
- zero result clear
- failure clear
- stale-action token
- model unload clears entire clash visualization
- extension unload cleans resources
- r71/r185 isolation
- cleanup exception-safety

Do not reopen known deferred cleanup-resilience improvements unless Soft Clash requires a concrete change.

---

## Required correctness fixtures

The plan must include all 17 M3 fixtures from the design:

1. farther than clearance
2. exactly at threshold
3. slightly within threshold
4. surface touching
5. positive-volume overlap excluded
6. containment excluded
7. rotated/transformed known distance
8. cross-model federated clearance
9. self-exclusion
10. multi-fragment minimum-distance aggregation
11. linear vs TLAS parity
12. placement invalidation
13. dead-band
14. inconclusive Hard-Clash precheck
15. anisotropic scale rejection
16. uniform scale correctness
17. invalid/non-finite transform

Use analytically simple synthetic geometry wherever possible.

---

## Live federated acceptance

Plan a bounded discovery step using the existing Architecture / Structure / Mechanical real fixture.

Requirements:

- bounded search only
- no unbounded federation brute-force
- try to find a real near-miss pair and record measured distance/dbIds
- if none is found, the design-authorized fallback is acceptable:
  - synthetic correctness remains authoritative for true distance semantics
  - live acceptance still proves Viewer integration via a known negative / no-false-positive path

If a real near-miss is found, acceptance should verify:

- Soft Clash action
- measured distance
- world-space closest-point visualization
- model provenance
- Hard Clash exclusion
- negative beyond threshold
- alignment update if practical
- zero console errors

---

## Performance gate

Plan a new:

`test/performance/run-gate-m3.mjs`

Mirror the M2 gate's evidence discipline.

Measure:

1. TLAS vs linear clearance candidate counts
2. candidate reduction ratio
3. overlap-precheck count
4. distance-query count
5. `clearanceQueryMs / totalMs`
6. cold/warm wall-clock
7. worst individual `closestPointToGeometry` span

The gate must include an explicit go/no-go disposition for the worst single-call synchronous span.

If one realistic `closestPointToGeometry` call substantially and consistently exceeds `frameBudgetMs`, record that honestly.

Do not hide narrow-phase dominance behind a broad-phase candidate win.

---

## Important implementation-plan guardrails

### Do not weaken the `boundsTree` requirement

Production and test fixtures must both use the accelerated target-side path.

### Do not weaken the tri-state Hard-Clash precheck

An inconclusive precheck is not equivalent to false.

### Do not hide scale correctness

Uniform scale conversion must be explicit; anisotropic scale remains diagnosed unsupported.

### Do not weaken the single-call performance gate

The pair-count budget does not protect against one pathological synchronous distance call.

---

## Suggested task areas

Derive the final task count from actual dependencies, but the plan should naturally cover something close to:

1. constants/errors/statistics/API validation
2. BLAS `geometry.boundsTree` invariant + fixture parity
3. clearance transform/admission validation
4. exact AABB-distance helper
5. `ClearanceQuery`
6. clearance linear oracle
7. clearance TLAS broad phase
8. tri-state Hard-Clash precheck
9. budgets/statistics
10. deterministic aggregation
11. synthetic differential fixtures
12. `Find Soft Clashes` Viewer action
13. endpoint-marker + line visualization
14. lifecycle/tests
15. bounded real-fixture discovery/live acceptance
16. M3 performance gate
17. README/CHANGELOG closeout

Use a different count if actual code dependencies justify it.

---

## Execution batching strategy

Propose natural batches, for example:

### Batch 1 — Distance foundation
API/validation → boundsTree invariant → transform/scale validation → AABB distance → ClearanceQuery

### Batch 2 — Query integration
linear oracle → TLAS clearance broad phase → tri-state Hard-Clash exclusion → budget/statistics → aggregation

### Batch 3 — Viewer UX
Find Soft Clashes action → closest-point markers/line → lifecycle

### Batch 4 — Acceptance/performance/closeout
synthetic full fixture set → bounded live discovery → live acceptance → performance gate → docs

Do not force this exact grouping if real dependencies suggest better boundaries.

Use targeted reviews at real batch boundaries.

---

## Output format

For every task include:

1. objective
2. exact/expected files
3. prerequisite tasks
4. implementation steps
5. tests/fixtures introduced
6. completion criteria
7. protected invariants / regressions to watch
8. Viewer/API or library evidence required before coding

Include:

- cross-task interface reconciliation
- proposed execution batches
- acceptance strategy
- performance-gate strategy
- final M3 completion criteria

End with explicit verdict:

**Ready for execution**

Do not implement anything yet.
