# M2 Implementation-Plan Prompt

Create the Milestone-2 implementation plan for the APS Viewer collision library.

This is a planning task only.

Do NOT:
- implement code,
- reopen settled M1 architecture,
- reopen the finalized M2 design unless the plan exposes a concrete contradiction,
- start Milestone 3,
- add Soft Clash / clearance,
- add explode / animation / arbitrary per-fragment dynamic-transform support,
- add worker/off-main-thread execution unless the M2 design explicitly makes it implementation work.

Use these documents as the source of truth:

- `docs/superpowers/specs/2026-09-05-collision-library-milestone2-design.md`
- `docs/superpowers/specs/collision-library-m2-targeted-design-resolution-disposition.md`

Use the ACTUAL landed M1 code interfaces as the implementation baseline. Do not copy stale snippets from older plans/spec revisions without reconciling them against the current repository.

Save the implementation plan under:

`docs/superpowers/plans/`

Suggested filename:

`2026-09-06-collision-library-milestone2-implementation.md`

---

## Planning goal

Turn the finalized M2 design into a task-sequenced implementation plan for:

**Milestone 2 — Federated Clash Finder**

Primary user-facing acceptance flow:

1. multiple Viewer models are loaded simultaneously,
2. user selects exactly one element,
3. right-click → `Find Clashes`,
4. the selected `{ model, dbId }` is the source,
5. targets cover eligible elements across all loaded models,
6. `volume-overlap` is used as the Hard Clash mode,
7. TLAS broad phase reduces candidates,
8. M1 narrow-phase logic remains unchanged,
9. results preserve correct model + dbId provenance,
10. Viewer isolates/highlights/fits the clash results,
11. UI reports either `<N> clashes found` or `No clashes found`,
12. incomplete/unsupported geometry surfaces diagnostics rather than silently becoming a negative result.

The context-menu extension remains UI glue only.

---

## Required planning discipline

Before writing tasks:

1. Inventory the actual M1 implementation interfaces that M2 will extend.
2. Reconcile the M2 spec against the landed code.
3. Identify exact files/modules/types to create or modify where derivable.
4. Preserve all stabilized M1 invariants unless the M2 spec explicitly changes them.
5. Build tasks around vertical, independently verifiable increments rather than large horizontal phases.
6. Put tests/fixtures with the task that introduces the behavior.
7. Keep implementation-plan code snippets subordinate to actual landed interfaces; if an interface is uncertain, make verification/research an explicit earlier task instead of guessing.

Use the updated APS Viewer Agent Kit naturally for Viewer-specific research or lifecycle/API verification.
Do not force Viewer skills onto generic BVH/math work.

---

## M2 invariants the plan must protect

### Cross-model identity / provenance

- exact Viewer `Model` object remains the correctness-bearing model identity,
- `loadEpoch` stays global, monotonic, and never reused,
- `GeometryIdentity = (loadEpoch, geometryIndex)` remains unchanged,
- `ClashPair` gains additive `model` references per operand while retaining `modelId` for diagnostics,
- result/diagnostic dedup keys become epoch-aware,
- source and target operands may belong to different Viewer models,
- source self-exclusion uses the source operand's extracted `(loadEpoch, fragmentId)` set.

### Federated Viewer APIs

The implementation must use/verify the finalized Viewer-side M2 workflow:

- `viewer.getAggregateSelection()` for model-aware selection,
- `viewer.getAllModels()` for currently loaded models,
- `keepCurrentModels: true` in the app loading path for federated sessions.

Do not regress to `viewer.getSelection()` for the M2 source-resolution path.

### TLAS architecture

- use the already-vendored `three-mesh-bvh@0.9.14` generic `BVH` base class,
- implement the complete `CollisionInstanceBVH` adapter contract from the spec,
- do not invent a custom BVH,
- one TLAS cache entry per `loadEpoch`,
- TLAS primitives come from the new epoch-scoped placement index, not `_instanceCache`,
- M1 BLAS / GeometryRegistry / query modules remain unchanged unless an actual integration defect proves otherwise,
- M1 linear broad phase remains a correctness oracle and fallback.

### Placement / model alignment

M2 MUST support model-level alignment / translation / rotation.

Plan for:

- `invalidateModelPlacement(model)`,
- `_placementRevisionByEpoch`,
- `_placementInvalidatedAtRevision`,
- staged refresh into a private replacement map,
- atomic compare-and-publish,
- lazy TLAS rebuild after invalidation,
- query-local expected placement revisions,
- pre-insertion revision checks so a query does not absorb external writes,
- `ModelPlacementChangedError`,
- placement revalidation at lifecycle-sensitive boundaries.

M2 does NOT support:

- Viewer explode,
- animation,
- arbitrary per-fragment dynamic transforms.

### Multi-model liveness

A cross-model query snapshots/adopts all participating models up front.

Any captured-model eviction aborts the whole query.

For TLAS-backed operands, an externally-caused placement revision change also aborts the whole query.

Validation must occur:

- at existing resumable checkpoints,
- after shared/cross-caller awaits,
- before every successful or empty return.

Preserve validation precedence:

1. `WorldDisposedError`
2. `ModelEvictedError`
3. `ModelPlacementChangedError`

### Candidate budget

For `broadPhase:'tlas'`:

- do NOT apply M1's Cartesian `maxBroadPhaseInstancePairs` precheck,
- introduce semantic support for `maxTlasCandidatePairs`,
- count primitive candidates incrementally at expansion time,
- scope the budget to the entire `findClashes` call,
- permit exactly the limit and fail on attempted `limit + 1`,
- terminate traversal callback-safely,
- throw only after traversal returns,
- reuse `CapacityExceededError` with `kind: 'tlas-candidate-budget'`,
- never silently return truncated results.

Numeric tuning belongs to implementation/performance-gate evidence, not arbitrary planning guesses.

### TLAS statistics

Plan the finalized additive fields:

- `tlasLeafRangeEmissions`
- `tlasPrimitiveCandidatePairs`
- `tlasExactRetestSurvivors`
- `tlasNarrowPhaseInputPairs`
- `tlasBuilds`
- `tlasCacheHits`
- `tlasSharedBuildWaits`
- `tlasBuildMs`
- `tlasQueryMs`

Preserve the canonical meaning of:

- `broadPhasePairs`
- `narrowPhasePairs`
- `broadPhaseMs`

Include tests for the finalized inequality/consistency relationships.

---

## Important implementation areas the plan must include

At minimum, plan tasks covering:

1. M2 constants/errors/statistics extensions.
2. `CollisionInstanceBVH` contract adapter over vendored `BVH`.
3. TLAS runtime-contract tests against `three-mesh-bvh@0.9.14`.
4. Epoch-scoped placement index + placement revision state.
5. `TlasCache` lazy build / single-flight / cancellation / release lifecycle.
6. `invalidateModelPlacement(model)` and staged placement refresh.
7. Whole-model fragment extraction (`extractAllFragments`) with:
   - authoritative fragment enumeration,
   - fragment → owner dbId resolution,
   - holes/unavailable/unresolvable diagnostics,
   - capacity enforcement during enumeration.
8. Cross-model `findClashes` operand normalization / lease capture.
9. Explicit target-dbId fragment-membership filters, including assembly-rooted targets.
10. TLAS per-source-instance traversal.
11. Exact M1 AABB retest before narrow phase.
12. TLAS candidate-budget enforcement.
13. Cross-model pair/diagnostic provenance + dedup.
14. Multi-model liveness and placement-revision revalidation.
15. Cross-model linear oracle support.
16. `ClashFinderExtension`.
17. Federated app wiring (`keepCurrentModels: true`).
18. `getAggregateSelection()` / `getAllModels()` UI flow.
19. Synthetic TLAS-vs-linear differential fixtures.
20. Placement-invalidation/model-alignment fixtures.
21. Candidate-budget/statistics fixtures.
22. Real federated Viewer acceptance.
23. M2 performance instrumentation/gate.
24. Final M2 packaging/docs updates if appropriate.

You may choose a different task count or grouping if the actual code dependencies justify it, but preserve these implementation responsibilities.

---

## Acceptance / fixture planning

The plan must explicitly include:

### Differential correctness

For the same query:

`broadPhase:'tlas'`

and

`broadPhase:'linear'`

must produce identical final clash-result sets.

Candidate/statistics counts do not need to match.

### Hard Clash UI acceptance

Use a real federated Viewer setup with at least two simultaneously loaded models.

Verify:

- exactly one aggregate-selected source element,
- right-click → `Find Clashes`,
- same-model and/or cross-model Hard Clash results,
- correct concrete `Model` provenance,
- no duplicate results,
- source excluded,
- correct isolate/highlight/fit behavior,
- zero-clash negative case,
- visible diagnostic caveats for incomplete results.

### Model-alignment acceptance

Include an acceptance or integration test where:

1. models are loaded,
2. one model is aligned/moved/rotated,
3. `invalidateModelPlacement(model)` is called,
4. the next TLAS query rebuilds using current world placement,
5. TLAS and linear oracle agree after alignment.

Explode is not part of this acceptance.

### Performance gate

Plan measurements for:

- TLAS cold build,
- warm TLAS reuse,
- TLAS query time,
- linear broad-phase time,
- candidate counts at all finalized TLAS stages,
- TLAS cache/build attribution,
- fragment/instance counts,
- retained memory/cache behavior.

Do not accept TLAS complexity unless there is measurable benefit on a realistic federated/fragment-dense case.

Fixture/model sourcing remains a logistics task and may proceed during implementation; it is not a design blocker.

---

## Output format

For each implementation task include:

1. objective,
2. exact or expected files/modules,
3. prerequisite tasks,
4. implementation steps,
5. tests/fixtures introduced in that task,
6. completion criteria,
7. protected invariants / regressions to watch,
8. any Viewer/API evidence verification required before coding.

Include a cross-task interface reconciliation section at the end.

Also include a proposed execution batching strategy.

Prefer natural technical boundaries such as:

- foundation / TLAS adapter,
- placement/cache/lifecycle,
- cross-model query integration,
- Viewer UI/federation,
- acceptance/performance,

but derive the final batches from actual dependencies rather than forcing this exact grouping.

Do NOT insert arbitrary review stops between every task.
Use batch-level targeted reviews at real dependency boundaries.

End the plan with:

- live federated acceptance,
- model-alignment acceptance,
- M2 performance gate,
- final implementation-readiness/completion criteria.

Do not implement anything yet.
