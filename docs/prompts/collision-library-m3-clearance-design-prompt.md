# M3 Design Prompt — Soft Clash / Clearance

Create a focused design spec for the next collision-library milestone:

**M3 — Soft Clash / Clearance**

This is a design/spec task only.

Do NOT implement code.
Do NOT create an implementation plan yet.
Do NOT reopen settled M1, M2, or M2.1 architecture unless this design exposes a concrete contradiction.
Do NOT broaden this milestone into clash-management workflow, penetration-volume computation, physics, or worker/off-main-thread execution.

Use the ACTUAL landed implementation on `main` as the source of truth.

Read and reconcile at minimum:

- the landed collision library under `collision/`
- current `findClashes` public API and target normalization
- current M2 TLAS + permanent linear oracle
- current narrow-phase query modules
- current `ClashPair` and M2.1 `witness` result shape
- `ClashFinderExtension.js`
- current real federated acceptance fixture and performance-gate reports
- current README/CHANGELOG
- the finalized M1/M2/M2.1 design specs only as historical/contract context

Prefer landed code whenever implementation and older design text differ.

Save the new design spec under:

`docs/superpowers/specs/`

Suggested filename:

`2026-09-07-collision-library-milestone3-clearance-design.md`

---

## Product goal

Add **Soft Clash / Clearance** detection.

The user should be able to ask:

> “Which elements are not physically intersecting, but are closer than the required clearance distance?”

M3 must preserve the distinction established in earlier milestones:

- `volume-overlap` = Hard Clash
- `surface-intersection` = surface contact/intersection, **not** Soft Clash
- `containment` = spatial containment
- new `clearance` = Soft Clash / minimum-distance threshold

Do not blur these semantics.

---

## Primary user-facing workflow

Evaluate a Viewer workflow that extends the existing **Find Clashes** interaction without turning it into a dashboard.

A likely M3 flow to evaluate:

1. User selects exactly one source element.
2. Right-click → either:
   - `Find Soft Clashes`, or
   - an additive clearance option integrated cleanly with the existing `Find Clashes` command.
3. Caller supplies a clearance threshold in model/world units.
4. Search covers eligible elements across all currently loaded models.
5. Return every source/target pair whose **true geometric separation distance** is positive and less than or equal to the requested clearance.
6. Existing Hard Clash semantics remain distinct.
7. Results preserve model/dbId provenance and, if useful, a representative closest-point pair / clearance witness suitable for visualization.

Do not assume the exact UX before evaluating the landed extension structure.

---

## Required design decisions

### 1. Exact Soft Clash semantics

Define precisely what qualifies as a Soft Clash.

At minimum decide the relation among:

- positive-volume overlap,
- surface touching (`distance = 0`),
- strictly separated geometry (`distance > 0`),
- clearance threshold.

Strong candidate contract:

```text
Soft Clash iff:
  no positive-volume overlap
  AND geometric separation distance > 0
  AND geometric separation distance <= clearance
```

But evaluate whether touching (`distance == 0`) belongs in Soft Clash or remains exclusively under `surface-intersection`.

Preserve the existing public meanings unless there is a compelling reason to change them.

Explicitly define:

- inclusive vs exclusive threshold (`<= clearance` vs `< clearance`)
- tolerance interaction near zero
- units
- behavior for invalid/zero/negative clearance input
- whether containment/overlap results are excluded from clearance results or separately classified

---

### 2. Distance quantity

Define exactly what distance M3 computes.

Preferred semantic target:

**minimum Euclidean distance between the two transformed collision surfaces in Viewer scene/world coordinates.**

Determine whether this can be computed:

- in one operand's local frame with a relative transform,
- directly in world space,
- via BLAS-to-BLAS traversal,
- using existing `three-mesh-bvh` distance/closest-point primitives,
- or through another existing geometry operation.

Do NOT invent a custom geometric-distance algorithm until the existing vendored library has been evaluated against this exact need.

---

### 3. Evaluate `three-mesh-bvh` capabilities first

Research the exact pinned `three-mesh-bvh` version currently landed in the repo.

Evaluate any relevant existing APIs such as, if actually present in the pinned version:

- closest-point queries,
- geometry-to-geometry distance,
- BVH-to-BVH traversal suitable for distance bounds,
- shapecast-based distance pruning,
- closest-point-to-geometry helpers.

Do not assume method names.

The design must explicitly record:

- what the pinned library actually exposes,
- which API is public vs shipped/internal,
- transform/frame constraints,
- synchronous/atomic traversal implications,
- whether it can return closest points as well as scalar distance,
- whether it supports early-out by threshold.

If a bounded Viewer-independent library research task is needed, keep it separate from Viewer-specific questions.

---

### 4. Broad-phase architecture

M2 introduced TLAS for AABB-overlap candidate reduction.

Soft Clash cannot use strict AABB overlap alone because separated objects within clearance distance may have disjoint AABBs.

Design the M3 broad phase.

Evaluate approaches such as:

- inflate/expand source AABB by `clearance`, then query target TLAS,
- inflate target primitive bounds,
- distance-aware AABB pruning,
- another equivalent conservative method.

Strong default candidate:

> Expand the source instance's world-space AABB by `clearance` in all directions, query the existing target TLAS, then perform an exact AABB-distance or geometry-distance retest.

But verify correctness and false-positive behavior.

Requirements:

- no false negatives within the requested clearance,
- permanent linear oracle remains available,
- no need for a separate second TLAS unless justified,
- existing M2 placement invalidation / federation semantics remain intact,
- source self-exclusion remains correct.

---

### 5. Linear oracle for clearance

Design a permanent `broadPhase:'linear'` clearance path analogous to M2's Hard Clash oracle.

For each source/target instance pair, define the conservative cheap precheck before exact distance work.

Likely candidates:

- exact AABB minimum distance,
- threshold-expanded AABB overlap.

The linear path must provide a differential correctness oracle for the TLAS path.

---

### 6. Narrow-phase distance query

Define the exact narrow-phase query module/API.

Potential shape:

```js
clearanceQuery(sourceInstance, targetInstance, {
  clearance,
  ...
}) -> {
  withinClearance: boolean,
  distance: number,
  witness: ...
}
```

The exact shape is not binding.

Decide:

- whether distance is always computed or threshold-early-out is allowed,
- whether exact closest points are returned,
- whether the returned distance is world-space distance,
- how transforms are handled,
- how degenerate/unsupported geometry is diagnosed,
- how Hard Clash / touching are distinguished from strictly-separated Soft Clash.

Do not reuse M2.1 `witness` semantics blindly if a closest-point pair is the more correct representation.

---

### 7. Clearance result shape

Design the public additive result shape.

Evaluate whether `ClashPair` should gain fields only for `type:'clearance'`, such as:

```js
{
  type: 'clearance',
  distance: number,
  clearance: number,
  witness: {
    sourcePoint: [x, y, z],
    targetPoint: [x, y, z]
  }
}
```

Questions to resolve:

- Should the public type literally be `'clearance'`?
- Should result include both measured `distance` and requested threshold?
- Is one midpoint marker enough for UI, or are two closest points / a connecting segment better?
- Should the witness reuse the existing M2.1 `witness` field name with a new shape, or should clearance use a distinct structure?
- How do we preserve backward compatibility and avoid making `ClashPair.witness` polymorphic in a confusing way?

Prefer a result shape that makes the geometric meaning obvious.

---

### 8. Closest-point / visualization witness

Soft Clash has a naturally different visualization need from Hard Clash.

Evaluate whether the most useful UI is:

- marker at midpoint between closest points,
- two endpoint markers + a line segment,
- one marker on the source/target closest point,
- another minimal representation.

The user should be able to understand **where the clearance violation occurs and roughly how far apart the objects are**.

Do NOT build a full measurement UI unless necessary.

If a line segment is proposed, define:

- world-space endpoint semantics,
- marker/line overlay lifecycle,
- through-occlusion behavior if relevant,
- labels (defer unless clearly useful).

---

### 9. Deterministic dbId-level aggregation

One dbId pair may contain multiple fragment pairs with different separation distances.

Define how fragment-level clearance results aggregate to one dbId-level pair.

Strong candidate:

- keep the **minimum-distance fragment pair**.

The design must make this deterministic and independent of broad-phase traversal order.

Define a total-order tie-break for equal/near-equal distances, likely using canonical fragment identity.

Also define whether a dbId pair can simultaneously have:

- a Hard Clash in one fragment pair,
- a separated-nearby Soft Clash in another fragment pair.

Strong semantic candidate:

> If any contributing fragment pair produces Hard Clash / touching under the applicable semantics, the dbId pair is not reported as a Soft Clash result for the same query.

But evaluate and define explicitly.

---

### 10. Units and Viewer/model alignment

Clearance must remain meaningful across federated aligned models.

Define:

- the coordinate frame used for distance,
- unit assumptions,
- whether Viewer scene units are guaranteed to be directly comparable across loaded models,
- how model alignment transforms affect distance,
- interaction with `invalidateModelPlacement(model)`.

If there is any Viewer-specific unit/placement claim that requires verification, identify it clearly.

Do not silently assume mixed-unit federated models are safe unless current pipeline already normalizes them.

---

### 11. Capacity / budget semantics

M2's `maxTlasCandidatePairs` bounds candidate expansion, while exact narrow-phase work can still be expensive.

M3 must define how clearance queries are bounded.

Evaluate:

- reuse of `maxTlasCandidatePairs`,
- a separate clearance narrow-phase pair budget,
- distance-query atomic-span cost,
- early-out by threshold,
- per-call vs per-model limits.

Do not invent arbitrary new constants unless needed to define the contract.

Separate semantics from tuned numeric values.

---

### 12. Statistics

Define additive statistics needed to understand clearance performance.

Evaluate fields such as:

- candidates surviving expanded-AABB broad phase,
- exact AABB-distance survivors,
- exact geometry-distance queries,
- clearance hits,
- closest-point query time.

Do not add fields merely because they are measurable; add only what is needed for correctness/performance analysis.

Preserve existing M2 statistics meanings.

---

### 13. Diagnostics / incomplete results

Define how clearance handles:

- unavailable geometry,
- unsupported geometry layout,
- non-finite transforms,
- inability to compute exact distance,
- exhausted capacity/budget.

Required principle:

**Never silently convert an unverified/incomplete clearance query into “no Soft Clash.”**

Reuse existing diagnostics/error conventions where appropriate.

---

## Viewer UX design

### 14. Context-menu integration

Evaluate the smallest clean extension to `ClashFinderExtension`.

Possible options:

- second context-menu action: `Find Soft Clashes`
- one `Find Clashes` action with Hard/Soft mode selection
- another minimal interaction

Prefer a small M3 addition over redesigning the M2/M2.1 UX.

Define how the clearance threshold is supplied:

- fixed sample default,
- small prompt/input,
- extension setting,
- another minimal mechanism.

Do not build settings/dashboard infrastructure without justification.

---

### 15. Visualization lifecycle

Whatever clearance visualization is chosen must follow the now-landed M2.1 lifecycle discipline:

- stale-action token,
- success clear/apply,
- zero-result clear,
- failure clear,
- model unload,
- extension unload,
- r71/r185 runtime isolation,
- cleanup robustness.

Do not reopen the existing marker lifecycle unless Soft Clash introduces a concrete new requirement.

---

## Correctness fixtures

The design must define synthetic differential fixtures covering at least:

1. separated boxes farther than clearance → no Soft Clash
2. separated boxes exactly at threshold → result according to chosen inclusivity rule
3. separated boxes slightly within threshold → Soft Clash
4. surface touching → classified according to the chosen Hard/Surface/Soft taxonomy
5. positive-volume overlap → not misreported as Soft Clash
6. containment overlap → not Soft Clash
7. rotated/transformed geometry with known minimum distance
8. cross-model federated clearance
9. source self-exclusion
10. multi-fragment dbId pair where the minimum-distance fragment pair must win aggregation
11. linear vs TLAS identical final Soft Clash results and distances/witnesses
12. alignment + `invalidateModelPlacement` updates the measured clearance correctly

Use analytically-simple geometry where expected distances are known.

---

## Live federated acceptance

Extend the current real Architecture / Structure / Mechanical Viewer fixture if it contains a suitable near-miss pair.

Acceptance should prove:

- multiple models loaded,
- one selected source,
- Soft Clash action with known threshold,
- at least one known real clearance violation,
- measured distance is plausible/expected,
- visualization indicates the near-miss location,
- known negative beyond threshold,
- no Hard Clash result incorrectly appears as Soft Clash,
- model provenance correct,
- model alignment changes the clearance result correctly if practical,
- zero unexpected console errors.

If the current fixture does not contain a reliable known near-miss case, define a **bounded fixture-discovery step** and a purpose-built fallback. Do not brute-force an unbounded federation search.

---

## Performance gate

M3 introduces genuinely new geometric work, so define a focused performance gate.

At minimum compare:

- clearance TLAS broad phase vs clearance linear oracle,
- candidate reduction,
- exact distance-query count,
- cold/warm behavior where relevant,
- end-to-end wall clock on a realistic federated case.

Do not presume TLAS improves end-to-end time; report candidate-search and narrow-phase costs separately, following the M2 evidence discipline.

If exact geometry-distance queries dominate, say so plainly.

---

## Non-goals

M3 must NOT add:

- penetration volume,
- clash volume,
- collision manifold,
- CSG,
- physics,
- continuous collision detection,
- worker/off-main-thread rewrite without evidence,
- GPU collision,
- full clash-management dashboard,
- issue tracking/status/approval workflow,
- persistent clash storage,
- arbitrary per-fragment animation/explode support.

---

## Required review

After drafting:

1. Run one independent targeted design review focused on:
   - Soft Clash semantics vs existing Hard/Surface/Containment meanings,
   - exact minimum-distance correctness,
   - broad-phase conservativeness/no false negatives,
   - transform/unit correctness,
   - deterministic dbId aggregation,
   - result/witness shape,
   - Viewer UX/lifecycle compatibility.
2. Fix genuine Critical/High findings in the same pass.
3. Do not reopen unrelated M1/M2/M2.1 architecture.
4. Do not run another comprehensive historical review.

---

## Final report

End the spec with:

- adopted Soft Clash definition,
- threshold inclusivity,
- exact distance definition,
- chosen three-mesh-bvh / distance-query approach,
- TLAS/linear broad-phase design,
- public result shape,
- closest-point/witness visualization design,
- deterministic dbId aggregation rule,
- unit/transform contract,
- budget/statistics model,
- Viewer UX,
- acceptance/performance strategy,
- remaining open questions,
- explicit verdict:

`ready for implementation planning`

or

`not ready for implementation planning`, with precise blockers.

Do not implement anything yet.
