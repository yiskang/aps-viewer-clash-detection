# M2 Targeted Design-Resolution Pass Prompt

Perform a targeted design-resolution pass on the current Collision Library Milestone-2 spec.

This is a design/spec task only.

Do NOT:
- implement code,
- create an implementation plan,
- reopen settled Milestone-1 architecture,
- broaden scope into Soft Clash / clearance,
- add worker/off-main-thread execution,
- add explode support,
- add animation support,
- add arbitrary per-fragment dynamic-transform support.

Use the current M2 spec as the source of truth:

`docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`

Resolve only the three remaining implementation-planning blockers below.

---

## 1. Model-alignment / model-transform TLAS invalidation

Human decision is now made:

Milestone 2 MUST support model-level placement changes used for coordination, including:

- model alignment,
- model translation,
- model rotation,
- equivalent model-level transforms used to align federated models before clash detection.

Milestone 2 does NOT need to support:

- Viewer explode,
- animation,
- arbitrary per-fragment dynamic transforms,
- high-frequency visualization-only displacement.

Revise the TLAS placement-freshness contract accordingly.

### Required design

The existing “static placement for the life of a loadEpoch” assumption is no longer acceptable.

Define an explicit model-placement invalidation mechanism, conceptually equivalent to:

`world.invalidateModelPlacement(model)`

The exact API name may differ if a better name fits the landed public surface, but the contract must be explicit and caller-controlled.

The intended workflow is:

1. Model A and Model B are loaded.
2. A model-alignment tool applies a model-level move/rotate/transform.
3. The alignment workflow informs `CollisionWorld` that the model's placement changed.
4. The model's placement revision increments.
5. Any cached TLAS for that epoch becomes stale.
6. The next TLAS-backed query re-reads current world matrices/world bounds and rebuilds before use.

Do not rely on an assumed Viewer transform-change event unless independently verified and intentionally adopted.

### Placement revision semantics

Reconcile the existing `_placementRevisionByEpoch` concept so it represents all placement-affecting changes relevant to M2, including:

- newly admitted placement records,
- explicit model-placement invalidation after alignment/move/rotate.

Define:

- when the revision increments,
- what state is marked stale,
- whether `_placementByEpoch` itself is refreshed eagerly or lazily,
- how a stale TLAS entry is detected,
- when world matrices/world bounds are re-read from Viewer,
- how rebuild sharing/concurrency works.

### Mid-query placement changes

At query entry, snapshot every captured model's:

- exact Model object,
- loadEpoch,
- placementRevision.

During a resumable cross-model query, placement validity must be rechecked at the same lifecycle-sensitive boundaries already required for multi-model liveness, including:

- resumable checkpoints,
- immediately after shared-resource awaits,
- immediately before successful/empty returns.

If a captured model's placement revision changes mid-query, the query must abort rather than return a possibly stale clash result.

Define the error/diagnostic contract. Prefer a dedicated, explicit error such as `ModelPlacementChangedError` if that cleanly fits the current error taxonomy; otherwise justify reuse of an existing error.

The next query should then rebuild/use the current placement normally.

### Compatibility

Preserve:

- exact Model-object identity,
- monotonic loadEpoch,
- eviction/disposal semantics,
- existing placement-revision admission completeness,
- M1 linear broad phase as a placement-fresh fallback/oracle.

Make it explicit that:

- `broadPhase: 'tlas'` supports model-alignment/model-transform workflows through explicit invalidation,
- explode/per-fragment visualization transforms remain unsupported,
- `broadPhase: 'linear'` remains available as a correctness/fallback path.

---

## 2. TLAS candidate-budget semantics

Resolve the current open candidate-budget design.

M1's Cartesian precheck:

`sourceCount × targetCount <= maxBroadPhaseInstancePairs`

must not be copied mechanically into the TLAS path if doing so defeats the purpose of TLAS acceleration.

Define a canonical budget model for `broadPhase: 'tlas'`.

The design must answer:

- what work is actually bounded,
- where counting occurs,
- when the budget is checked,
- what happens on exhaustion,
- which diagnostic/error is surfaced,
- whether limits apply:
  - per source instance,
  - per `(sourceEpoch, targetEpoch)` pair,
  - or per complete `findClashes` call.

Prefer a budget tied to real emitted/validated candidate work rather than theoretical Cartesian population.

At minimum distinguish these stages:

1. TLAS leaf/range emissions,
2. primitive candidates after leaf/range expansion,
3. candidates surviving the exact M1 AABB retest,
4. unique fragment pairs admitted to narrow phase.

Define where candidate dedup occurs so duplicate TLAS traversal emissions cannot cause duplicate narrow-phase work.

Requirements:

- deterministic exhaustion behavior,
- no silent truncation reported as “no clash,”
- lifecycle/checkpoint semantics remain valid,
- linear-oracle mode retains its existing M1 budget semantics unless an explicit compatibility reason requires otherwise.

Do not invent a new provisional ceiling value unless necessary to define the contract. Separate the semantic rule from the eventual tuned numeric constant.

---

## 3. `Statistics` candidate-count semantics

Finalize the TLAS-path statistics contract.

The current spec uses “candidate count” ambiguously across multiple stages. Replace that ambiguity with explicit fields.

Define additive statistics fields for the TLAS path that distinguish, at minimum:

- TLAS traversal/leaf-range emissions,
- primitive candidate pairs produced from those ranges,
- exact-AABB-retest survivors,
- unique narrow-phase input pairs.

Also preserve/define:

- existing M1 `broadPhasePairs` semantics,
- linear-vs-TLAS comparability,
- dedup accounting,
- cold/warm TLAS build/query timing fields where already specified.

Requirements:

- field names must have one canonical meaning,
- performance-gate criteria must refer to exact field names, not the generic phrase “candidate count,”
- differential correctness compares final result sets, not raw candidate counters,
- statistics differences between linear and TLAS must be explainable from the field definitions.

Do not redefine an existing M1 field incompatibly unless absolutely necessary; prefer additive M2 fields.

---

## Accepted / no longer blocking

Treat the current source self-exclusion rule as accepted:

- source self-exclusion is based on the source operand's entire extracted `(loadEpoch, fragmentId)` set,
- do not reopen this unless a concrete contradiction is discovered.

Federated fixture sourcing remains an implementation/acceptance logistics item, not an architecture blocker.

Do not reopen the settled choices for:

- per-source-instance TLAS querying,
- generic `three-mesh-bvh` `BVH` adapter direction,
- additive `ClashPair.model` provenance,
- `getAggregateSelection()` for federated selection,
- `getAllModels()` for loaded-model enumeration,
- `keepCurrentModels: true` as the required federated app-wiring change,
- legacy target shape defaulting to `broadPhase: 'linear'`.

---

## Viewer evidence discipline

Where this pass makes Viewer-specific claims, use the updated APS Viewer Agent Kit naturally.

Do not force Viewer skills onto generic BVH/math questions.

Any load-bearing Viewer API/behavior claim introduced or relied upon by this pass must be verified to the evidence level required by the current Agent Kit workflow.

---

## After editing

1. Update only the M2 design spec and any directly-required design disposition/research note.
2. Do NOT implement code.
3. Do NOT create the implementation plan yet.
4. Run a narrow consistency check covering only:
   - placement revision / model-alignment invalidation,
   - multi-model liveness interaction,
   - TLAS candidate-budget semantics,
   - candidate dedup,
   - `Statistics` field meanings,
   - M1 compatibility.
5. Fix genuine contradictions found by that narrow check in the same pass.
6. Do not run another general comprehensive review.

Write a short design-resolution disposition report to:

`docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md`

The disposition must report:

- placement-invalidation design adopted,
- mid-query placement-change behavior,
- candidate-budget semantics,
- finalized Statistics fields,
- Critical/High regressions,
- remaining open items,
- whether the M2 spec is now ready for implementation planning.

## Success criteria

- model alignment / model-level move/rotate is explicitly supported by TLAS invalidation/rebuild,
- explode/per-fragment dynamic transforms remain explicitly unsupported,
- no unresolved TLAS candidate-budget semantics,
- no ambiguous candidate-count Statistics terminology,
- 0 Critical regressions,
- 0 High regressions,
- explicit verdict: `ready for implementation planning` or a precise list of remaining blockers.
