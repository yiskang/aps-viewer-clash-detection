Create the Milestone-2 design spec for the APS Viewer collision library.

This is a design/spec task only.
Do NOT implement code.
Do NOT reopen settled Milestone-1 architecture unless M2 genuinely requires an extension point.
Use the current M1 implementation/spec as the source of truth.

Save the spec under:

`docs/superpowers/specs/`

Suggested filename:

`2026-09-05-collision-library-milestone2-design.md`

## Milestone-2 theme

**Federated Clash Finder**

User-facing goal:

A user selects an element in the APS Viewer, right-clicks, chooses:

`Find Clashes`

and the system finds other elements that have a **Hard Clash** with the selected element.

Canonical BIM/query terminology:

- `volume-overlap` = **Hard Clash**
- `surface-intersection` = **Surface Contact / Surface Intersection**
- `containment` = **Spatial Containment**
- future `clearance` = **Soft Clash** — NOT part of M2

The M2 context-menu workflow must use `volume-overlap` by default.

## Primary M2 acceptance workflow

Support this real Viewer workflow:

1. one or more Viewer Models are loaded,
2. user selects one element,
3. right-click → `Find Clashes`,
4. selected `{ model, dbId }` becomes the source,
5. target search covers eligible elements across all currently-supported loaded models:
   - same model,
   - other federated models,
6. source element itself is excluded,
7. scalable broad phase finds candidate fragment-instance pairs,
8. existing M1 `volume-overlap` narrow phase determines Hard Clashes,
9. results aggregate back to `{ model, dbId }`,
10. Viewer highlights/isolate/selects the colliding elements,
11. UI reports:
    - `<N> clashes found`, or
    - `No clashes found`,
12. skipped/unsupported/inconclusive geometry must surface diagnostics rather than silently appearing as “no clash.”

The context-menu extension is UI glue only.
Collision logic remains in the collision library.

## Required engine scope

### 1. Cross-model clash queries

Extend the existing M1 API/data model so `findClashes` can correctly operate when source and target belong to different Viewer `Model` objects.

Preserve:
- exact Model-object lifecycle identity,
- monotonic loadEpoch,
- model-aware ElementRef/dbId provenance,
- existing query semantics,
- M1 cancellation/dispose/error contracts.

Define deterministic handling for:
- same-model pairs,
- cross-model pairs,
- model ordering,
- duplicate dbId/fragment pairs,
- source-self exclusion.

### 2. Packed TLAS

Introduce the next broad-phase layer above M1 BLAS.

Conceptually:

`CollisionInstance`
→ world-space AABB
→ packed TLAS

Preserve the existing M1 leaf concept and BLAS ownership wherever possible.

Specify:
- TLAS leaf representation,
- model/epoch ownership,
- build/update lifecycle,
- cache identity,
- lazy construction,
- concurrent build sharing,
- eviction/disposal cleanup,
- transform/bounds snapshot rules,
- invalidation rules.

Do not invent a custom BVH implementation unless justified.
Evaluate an appropriate existing packed-BVH representation first.

### 3. TLAS-vs-TLAS / TLAS query broad phase

Support scalable candidate discovery for:

- selected source element vs. one model,
- selected source element vs. multiple models,
- model-vs-model where useful to the architecture.

The TLAS layer must only generate candidate fragment-instance pairs.
Exact collision semantics remain delegated to M1 BLAS/query algorithms.

M1 linear AABB broad phase should remain available as:
- correctness oracle,
- fallback where appropriate,
- differential-test reference.

Required invariant:

`TLAS candidate/result semantics == linear oracle semantics`

for equivalent inputs.

### 4. Candidate ownership/dedup

Define:
- deterministic candidate ordering,
- pair canonicalization,
- no duplicate narrow-phase work,
- correct `{ model, dbId }` provenance through fragment hits,
- same-model self-pair exclusion,
- cross-model result aggregation.

Do not regress the M1 frozen-identity + call-local-placement design.

### 5. Lifecycle and federation

Explicitly reconcile M2 with the verified Viewer 7.124.2 lifecycle behavior:

- Viewer replacement may destroy and reconstruct extension/world instances,
- M1 does not guarantee state continuity across replacement,
- M2 should not silently introduce such a guarantee unless deliberately designed.

Define supported M2 behavior for:
- multiple simultaneously loaded models,
- individual model unload,
- model eviction,
- world disposal,
- TLAS cleanup,
- queries racing model unload.

Do NOT turn general Viewer document replacement continuity into an M2 requirement unless required by the federated acceptance workflow.

### 6. Scheduling / performance

Extend the existing M1 synchronous-work taxonomy rather than replacing it.

Specify:
- TLAS build scheduling class,
- TLAS traversal scheduling class,
- candidate-budget behavior,
- cancellation/checkpoint behavior,
- accepted atomic risks,
- diagnostics for budget exhaustion.

Do not claim `frameBudgetMs` preempts synchronous atomic work.

Worker/off-main-thread execution remains deferred unless benchmarks demonstrate it is necessary.

## Viewer sample / extension

Design a `Find Clashes` context-menu workflow, either by extending the current sample extension cleanly or adding a focused Clash Finder extension.

Define UX for:
- exactly one selected source element,
- no selection,
- multiple selection if unsupported,
- result highlight/isolation,
- clearing/restoring result visualization,
- same-model and cross-model result identification,
- diagnostics/caveats.

Do not couple the engine to Viewer UI state.

## Acceptance requirements

M2 must have at least:

### Functional acceptance

A federated Viewer scenario with at least two loaded models.

Known source element with:
- at least one Hard Clash in the same model and/or another model,
- known expected `{ model, dbId }` result set.

Run:

select source
→ right-click
→ `Find Clashes`

Verify:
- exact expected elements returned,
- correct model provenance,
- correct Viewer visualization,
- no duplicate results,
- source excluded from results.

Also include a known negative element:

`Find Clashes`
→ `No clashes found`

### Differential correctness

For acceptance and synthetic fixtures:

`TLAS broad phase + M1 narrow phase`

must produce the same final clash result as:

`M1 linear broad-phase oracle + M1 narrow phase`.

### Performance acceptance

Use a realistic federated / fragment-dense case.

Demonstrate that TLAS provides measurable candidate-search benefit over the M1 linear broad phase.

Do not accept architectural complexity without measurable gain.

Record:
- fragment/instance counts,
- TLAS build cost,
- warm/cold query cost,
- candidate counts,
- linear oracle cost,
- TLAS cost,
- memory/cache behavior.

## Explicit M2 non-goals

Do NOT include:

- Soft Clash / clearance queries
- configurable clearance distances
- penetration volume
- CSG result geometry
- GPU collision
- physics / continuous collision
- custom BVH unless unavoidable
- worker/off-main-thread rewrite without benchmark justification
- full clash-management dashboard/workflow
- Milestone-3 coordination semantics

## Design discipline

Before proposing changes:
1. inventory the actual M1 landed interfaces,
2. identify which interfaces can be extended without breaking M1,
3. preserve all stabilized M1 invariants,
4. verify Viewer-specific behavior where load-bearing,
5. distinguish architectural requirements from tuning constants.

Use the updated APS Viewer Agent Kit naturally where relevant.
Do not force a Viewer skill onto generic BVH/geometry/math questions.

## Output

The spec should contain:

1. M2 goals and non-goals
2. user-facing `Find Clashes` workflow
3. public API changes
4. cross-model identity/provenance model
5. TLAS architecture
6. TLAS build/cache/lifecycle
7. TLAS traversal and candidate generation
8. narrow-phase integration with M1
9. scheduling/budget model
10. diagnostics/error behavior
11. Viewer extension/sample design
12. correctness fixtures
13. federated live acceptance
14. performance gate
15. risks/open questions
16. explicit M1 → M2 compatibility/invariant table

Do not create an implementation plan yet.

At the end, report:
- proposed M2 architecture,
- any design decisions that require human confirmation,
- any M1 contract that would need to change,
- whether the spec is ready for review.