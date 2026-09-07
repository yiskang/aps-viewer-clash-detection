# M2.1 Implementation-Plan Prompt — Clash Witness Marker

Create the implementation plan for:

**M2.1 — Clash Witness Marker**

This is a planning task only.

Do NOT implement code.
Do NOT reopen settled M1/M2 architecture unless the landed M2.1 design exposes a concrete contradiction.
Do NOT broaden scope into M3 / Soft Clash / clearance.

Use these as the source of truth:

- `docs/superpowers/specs/2026-09-07-collision-library-m2.1-clash-witness-marker-design.md`
- the ACTUAL landed M2 implementation on `feature/collision-library-m2`
- current `CHANGELOG.md` / `collision/README.md` only as compatibility/release context

Prefer landed code over stale plan/spec snippets if they differ.

Save the plan under:

`docs/superpowers/plans/`

Suggested filename:

`2026-09-07-collision-library-m2.1-clash-witness-marker-implementation.md`

---

## Goal

Plan the smallest safe implementation that adds a representative clash marker to the existing M2 **Find Clashes** flow.

For a normal, complete, successfully-evaluated `volume-overlap` Hard Clash with valid geometry and transforms:

- `ClashPair.witness` is expected to be non-null,
- `ClashFinderExtension` renders a visible marker at that witness location.

`witness: null` exists only as a diagnosed degraded/fault-tolerance path and must never become an ordinary success outcome.

---

## Public contract to implement

For `type: 'volume-overlap'`:

```js
{
  source: { modelId, dbId, model },
  target: { modelId, dbId, model },
  type: 'volume-overlap',
  witness: {
    kind: 'surface-crossing' | 'containment',
    point: [x, y, z]
  } | null
}
```

Requirements:

- additive only,
- existing fields unchanged,
- plain numeric point array,
- point already expressed in Viewer scene/render coordinates,
- no Three.js object crosses the collision-library ↔ Viewer runtime boundary,
- `witness: null` always carries a corresponding diagnostic,
- positive, well-formed Hard Clash fixtures must assert `witness !== null`.

---

## Planning discipline

Before writing tasks:

1. Inventory the landed implementations of:
   - `ProperCrossingQuery.js`
   - `ContainmentQuery.js`
   - `VolumeOverlapQuery.js`
   - `CollisionWorld._runNarrowPhasePair`
   - `findClashes` dbId-pair aggregation
   - `ClashFinderExtension.js`
   - Viewer overlay APIs actually available in the pinned/live Viewer environment
2. Reconcile exact current interfaces against the M2.1 design.
3. Identify precise code ownership for:
   - witness capture,
   - local→Viewer-scene transform,
   - deterministic aggregation,
   - marker rendering,
   - marker lifecycle.
4. Keep tests with the behavior they introduce.
5. Use small vertical tasks, not broad refactors.
6. Do not change Hard Clash truth semantics.

---

## Required implementation responsibilities

The plan must cover all of the following.

### 1. Surface-crossing witness capture

Plan an additive change to `properCrossingQuery` so a confirmed crossing can return an owned witness point.

Requirements:

- capture the already-computed proven-inside probe at the exact success statement,
- never return a reference to module-level mutable scratch state,
- clone/copy before returning,
- preserve all existing return fields and semantics.

Include tests proving:

- positive crossing returns a witness point,
- later/concurrent scratch mutation cannot change an already-returned witness,
- existing crossing verdict behavior is unchanged.

---

### 2. Containment witness capture

Plan additive witness propagation through:

- `anyComponentInside`,
- `constructedInteriorWitness` where applicable.

Requirements:

- stage 1/2 returns an owned clone of the proven container-local point,
- stage 3 returns an owned clone of the proven container-local constructed witness,
- internal `witnessMethod` may distinguish vertex-sample vs constructed-interior if useful,
- public witness kind remains simply `'containment'`.

Include tests for both containment stages where practical.

---

### 3. `volumeOverlapQuery` as the required composition layer

This is a critical integration point.

Plan how `volumeOverlapQuery`:

- receives leaf-query witness points,
- uses the correct operand/container world matrix,
- transforms the point into Viewer scene/render coordinates,
- validates `[x,y,z]` are finite,
- returns additive `witness: {kind, point} | null` on a positive overlap result,
- leaves negative overlap behavior unchanged.

Explicitly cover all three positive branches:

- proper crossing,
- A in B,
- B in A.

Do not defer coordinate transforms to `CollisionWorld` or `ClashFinderExtension`.

---

### 4. Mixed `_runNarrowPhasePair` return shape

M2.1 intentionally changes only the `volume-overlap` branch.

Plan this carefully.

Expected shape:

- `volume-overlap` → `{ hit, witness }`
- `containment` / `surface-intersection` → existing boolean

The plan must include regression tests preventing a truthy-object bug such as:

```js
if (await _runNarrowPhasePair(...)) { ... }
```

incorrectly treating `{ hit: false, witness: null }` as a hit.

Prefer making the caller normalization explicit and easy to review.

Do not broaden all query modes into structured results unless the landed code proves that is safer and still minimal.

---

### 5. Deterministic dbId-level witness aggregation

Replace current first-discovery-wins behavior for witness selection.

Plan a total-order comparator implementing:

1. valid witness outranks `null`,
2. `'surface-crossing'` outranks `'containment'`,
3. canonical fragment-pair identity breaks ties using the existing stable ordering.

Requirements:

- result independent of linear vs TLAS traversal order,
- reversed candidate order yields the same witness,
- multiple fragment pairs mapping to one dbId pair aggregate deterministically,
- one failed witness capture must not suppress a valid sibling witness,
- emit `witness-unavailable` diagnostic only after full aggregation if the final selected witness is still `null`.

Do not alter pair dedup identity semantics from M2.

---

### 6. Degraded witness behavior

Plan the fault-tolerance path explicitly.

For a confirmed clash where no valid witness survives aggregation:

- return the clash,
- set `witness: null`,
- emit one diagnostic for that dbId pair,
- never silently invent a bbox-center or arbitrary point,
- never downgrade to no clash.

Include a dedicated test fixture for non-finite/invalid transformed witness data.

Normal positive fixtures must not accept `null` as success.

---

## Viewer marker implementation

### 7. Verify Viewer overlay APIs before coding

Implementation planning must include a bounded Viewer-API verification step for the exact overlay mechanism against the actual Viewer version used by this repo.

Verify concrete signatures/behavior for:

- `viewer.impl.createOverlayScene`
- `viewer.impl.addOverlay`
- `viewer.impl.removeOverlay`
- overlay-scene removal/cleanup API
- whether `MeshBasicMaterial({ depthTest: false, ... })` or an equivalent Viewer-safe setting actually renders through model geometry in Viewer 7.124.2
- any invalidate/redraw call required after add/remove

Record the findings before the marker task consumes them.

Do not guess API signatures from memory.

---

### 8. Viewer r71 / collision r185 isolation

Marker code must use only the Viewer's own runtime Three.js global.

Plan hard safeguards:

- `ClashFinderExtension.js` does NOT import `three`,
- marker `Vector3`, `SphereGeometry`, `MeshBasicMaterial`, `Mesh` come from `window.THREE` / Viewer runtime,
- collision result carries only plain numeric coordinates,
- add a regression/runtime-isolation test if the current test infrastructure can detect accidental r185 use.

This boundary is mandatory.

---

### 9. Marker overlay resources

Plan one overlay scene per extension instance.

Plan:

- lazy creation,
- one shared marker geometry,
- one shared material,
- one mesh per witness-bearing `ClashPair`,
- tracked active meshes,
- shared geometry/material disposed once on extension unload,
- no per-marker duplicated geometry/material.

Marker sizing:

- compute one radius per successful Find Clashes action,
- derive from the combined clash-result/isolation scene scale,
- clamp between explicit minimum and maximum world-unit bounds,
- choose exact constants during implementation based on the real fixture/live Viewer behavior.

Do not leave sizing as an unbounded percentage.

---

### 10. Through-occlusion visibility

Witnesses are inside solids.

The marker implementation must be visibly readable through opaque model geometry.

Plan verification for the actual Viewer r71 material/overlay behavior.

Acceptance must prove visual visibility for at least one enclosed/containment witness.

Do not count “mesh exists in overlay scene” as sufficient acceptance.

---

### 11. Marker lifecycle

Plan marker lifecycle to remain lockstep with clash isolation.

Cover:

- successful query: clear old isolation + markers, then apply new isolation + markers,
- zero-clash result: clear previous markers, add none,
- query failure: clear previous markers along with isolation,
- newer stale-action token supersedes older result: stale result never clears or adds markers,
- repeated Find Clashes on another source,
- model unload: clear the entire clash visualization across all participating models,
- extension unload: marker teardown must run even if `_world.dispose()` throws,
- clearing/restoring visualization always handles isolation + markers together.

Tests must mirror the existing stale-action-token discipline already landed in `ClashFinderExtension`.

---

### 12. Multiple markers

M2.1 policy:

- one marker per `ClashPair` with non-null witness,
- no interaction,
- no tooltip,
- no list/dashboard,
- no marker-density cap yet.

Document high-density marker UX as a limitation, not a reason to expand scope.

---

## Correctness test plan

At minimum include tasks/fixtures for:

### Witness geometry

- surface-crossing witness,
- containment witness,
- world-transform correctness,
- model alignment + `invalidateModelPlacement` moves witness correctly,
- non-finite transform → clash retained + `witness:null` + diagnostic.

### Traversal equivalence

For identical inputs:

- `broadPhase:'linear'`
- `broadPhase:'tlas'`

must return:

- identical dbId pair set,
- same witness kind,
- same representative witness point within tolerance.

Raw candidate order/count need not match.

### Aggregation determinism

- original candidate order vs reversed order,
- repeated identical queries,
- sibling fragment pair with valid witness outranks null,
- surface-crossing outranks containment,
- canonical fragment identity tie-break is stable.

### Scratch ownership

Explicitly prove returned witnesses do not change when module-level scratch objects are reused/mutated by subsequent work.

### Mixed return-shape regression

Explicit test that a negative `volume-overlap` structured result does not become truthy and accidentally emit a pair.

---

## Live acceptance

Extend the existing real Architecture / Structure / Mechanical federated acceptance.

Plan a live acceptance flow that verifies:

1. known positive Hard Clash still returns the existing expected clash pair(s),
2. every normal positive `volume-overlap` pair has `witness !== null`,
3. a visible marker is rendered for each witness-bearing pair,
4. marker is visibly located in the clash region,
5. at least one enclosed witness remains visible through opaque geometry,
6. known negative source clears previous markers and creates none,
7. model alignment + `invalidateModelPlacement` moves the resulting marker to the new clash location,
8. model unload clears the full clash visualization,
9. zero console errors.

Do not use pixel-perfect screenshot assertions unless existing infrastructure makes them reliable.

---

## Performance

Witness support should remain a small additive narrow-phase/UI cost.

The plan should verify/report:

- witness capture is retain-existing-data, not a new geometric search,
- allocation impact from owned witness clones,
- one comparator per positive fragment-pair aggregation,
- one marker mesh per final witness-bearing dbId pair,
- shared geometry/material reuse.

No new broad performance gate is required unless implementation evidence shows a measurable regression.

A small timing sanity check on the existing real M2 fixture is enough if useful.

---

## Suggested implementation task areas

Derive final task count from actual code dependencies, but the plan should naturally cover something close to:

1. Viewer overlay API evidence verification.
2. Surface-crossing witness capture.
3. Containment witness capture.
4. `volumeOverlapQuery` world-space witness propagation.
5. `_runNarrowPhasePair` result-shape integration.
6. Deterministic dbId-level aggregation + unavailable-witness diagnostics.
7. TLAS/linear witness-equivalence and alignment fixtures.
8. Clash marker overlay implementation.
9. Marker lifecycle / teardown / stale-action tests.
10. Real federated marker acceptance.
11. README/CHANGELOG closeout if appropriate.

Keep tasks vertical and test-backed.

---

## Execution batching strategy

Propose a small number of natural batches.

A reasonable shape to evaluate:

- **Batch 1 — Geometry witness pipeline**
  Leaf capture → composition transform → narrow-phase integration → deterministic aggregation.

- **Batch 2 — Viewer marker**
  Overlay API verification → marker rendering/resources → lifecycle.

- **Batch 3 — Acceptance / closeout**
  Alignment equivalence → live Viewer marker acceptance → docs.

Do not force this exact grouping if actual dependencies suggest a better one.

Use targeted reviews at real batch boundaries, not per-task human stops.

---

## Output format

For each task include:

1. objective,
2. exact/expected files,
3. prerequisites,
4. implementation steps,
5. tests introduced/updated,
6. completion criteria,
7. protected invariants,
8. Viewer/API evidence needed before coding.

Include a cross-task interface reconciliation section.

End with:

- proposed batches,
- live marker acceptance criteria,
- final M2.1 completion criteria,
- explicit verdict that the plan is ready for execution.

Do not implement anything yet.
