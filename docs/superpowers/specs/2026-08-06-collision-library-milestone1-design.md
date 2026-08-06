# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: revised after three rounds of codex review (see `review-coments.md`,
`review-comments-v2.md`, `review-comments-v3.md` in this directory), pending user re-review
Date: 2026-08-06
Related: [`docs/ideas/aps-viewer-clash-detection-library-idea.md`](../../ideas/aps-viewer-clash-detection-library-idea.md)

## Revision Notes (post-review)

### Round 1 (4 P1, 3 P2 — all confirmed valid)

- Room discovery moved from extension `load()` (before any model exists) to a lazily-built,
  per-model cache.
- The containment algorithm was replaced: the old two-step "surface-intersection-then-bbox-center"
  approach was both non-symmetric and capable of false positives/negatives.
- The Viewer geometry adapter started normalizing primitive ranges (`groups`/`drawRange`).
- Cross-model queries are explicitly rejected in Milestone 1 rather than silently allowed with an
  undefined coordinate convention.
- `ClashResult.statistics` is always populated, and skipped fragments became a structured
  diagnostic instead of a console warning only.
- BLAS construction was called out as synchronous/blocking, with a yield-between-builds rule added.

### Round 2 (2 P1, 2 P2 — all confirmed valid)

Round 1's fix for the containment algorithm overcorrected: dropping the surface-crossing check
entirely (to fix its "touching gets promoted to overlap" bug) reintroduced a worse bug — pure
vertex-sampling misses genuine interpenetration when neither solid's vertices land inside the other
(e.g. a duct crossing through a beam mid-span, both thin enough that no corner of either lands
inside the other — precisely the idea doc's own first benchmark scenario, "MEP models with many
low-poly fragments"). This revision:

- Reinstates a real triangle-triangle crossing test (`MeshBVH.intersectsGeometry`) as one of two
  `volume-overlap` conditions, OR'd with bidirectional containment sampling — fixing the false
  negative without reverting to the single-direction, non-symmetric original bug.
- Gives `surface-intersection` mode its own real, tested definition (it was listed but never
  designed) — it's now precisely `MeshBVH.intersectsGeometry`, sharing the same primitive
  `volume-overlap` uses for its crossing check.
- Specifies the ray-parity containment test in enough detail to actually be correct:
  `THREE.DoubleSide`, coincident-hit deduplication, a concrete retry rule, and defined epsilon units.
- Fixes three real bugs in geometry-range normalization (wrong index property path, missing
  `InterleavedBufferAttribute` support, `drawRange`/`groups` treated as either/or instead of
  intersected) and now explicitly rejects legacy `offsets` layouts instead of silently guessing.
- Restricts vertex sampling to vertices actually referenced by active ranges, and spreads the sample
  budget across ranges rather than blindly striding the raw buffer, to reduce (not fully eliminate)
  the risk of missing small disconnected sub-parts.
- Replaces per-fragment `skippedFragments: FragmentRef[]` with pair-scoped `ClashDiagnostic`s
  carrying a reason code.
- Commits to a concrete synchronous-build size threshold with a defined fallback, instead of leaving
  the blocking budget as an open question.

### Round 3 (3 P1, 3 P2 — all confirmed valid)

Round 2 fixed the false *negative* (duct-through-beam) by OR-ing in a raw surface-intersection test,
but resolved the resulting false *positive* — zero-volume contact counting as overlap — only by
documenting it. That wasn't good enough: the idea doc defines volume overlap as two solids **sharing
volume**, with touching as a separate mode
([idea:1061](../../ideas/aps-viewer-clash-detection-library-idea.md#L1061)), and the CSG code being
replaced already excluded touching (a BSP intersect of face-touching solids yields no polygons). So
"documented touching-inclusive `volume-overlap`" was a silent behavioral regression against the very
implementation this milestone replaces. This revision:

- **Classifies proper crossings** instead of accepting any surface hit: a new `ProperCrossingQuery`
  enumerates intersecting triangle pairs via `bvhcast` and tests whether the two solids actually
  share volume near the intersection curve. `volume-overlap` regains its idea-doc meaning;
  `surface-intersection` remains the (correctly-named) touching-inclusive mode.
- **Replaces capped vertex sampling with per-connected-component sampling**, which makes the
  containment step *exact* rather than approximate — see `ContainmentQuery` for why the component
  decomposition removes the false negative entirely rather than just making it less likely. This
  also resolves a real arithmetic contradiction in the previous draft ("up to 64 samples" vs. "at
  least 8 per range" with more than 8 ranges).
- **Splits the single mixed-unit epsilon** into a dimensionless barycentric tolerance and a
  scale-relative local-space distance tolerance, and pins ray direction/hit-sorting to the target
  BVH's own local frame.
- Uses `model.search(...)` rather than `viewer.search(...)` — the latter is declared without the
  `options` argument and isn't scoped to the model the cache is keyed by.
- Makes diagnostics role-aware, and emits them for *partially* inconclusive negatives, not only
  totally inconclusive ones.
- Drops `firstHitOnly` from the Milestone 1 API rather than shipping an undefined option.

## Purpose

Replace the CSG-based collision logic (`ThreeCSG`/BSP boolean operations) in the reference
[`RoomLocatorExtension.js`](https://gist.githubusercontent.com/yiskang/c568db634e48c917d258716982eb89ba/raw/0c2920e75c2bfb5d39a82ce2ccfbddeeac5f709c/RoomLocatorExtension.js)
with a real, non-CSG collision engine, and begin implementing the general-purpose client-side
clash-detection library described in the idea doc. This is **Milestone 1**: the smallest slice of
that library that is architecturally real (not a bespoke hack) and sufficient to power room
containment queries in this sandbox app.

The extension keeps **zero collision logic of its own**. All broad-phase filtering, geometry
normalization, BVH construction, and containment semantics live in the library. The extension is a
thin Viewer-facing consumer.

## Background

The original extension does two-phase detection: a `THREE.Box3.containsBox()` coarse bbox check,
then a fine check that builds a `ThreeCSG`/`ThreeBSP` mesh for the element and each candidate room
and calls `bsp.intersect(bsp)`, treating a non-empty polygon result as "room contains element."
That CSG intersect is expensive (BSP tree construction, polygon splitting) to answer what is
functionally a boolean containment question, and it's dynamically loaded from an uncontrolled CDN
(`cdn.jsdelivr.net`).

Revit Room geometry, as tessellated by Model Derivative, represents the enclosed air volume of the
room (an extrusion of the room boundary polygon from floor to ceiling). Furniture/fixtures placed
in a room normally sit **fully inside** that volume without their surfaces ever crossing the room's
own solid boundary. So what the original CSG intersect is actually testing is **volume overlap**,
not surface crossing — this shapes the containment algorithm below.

Two properties of that CSG predicate are worth naming explicitly, because the replacement has to
match both and earlier drafts of this spec broke each in turn:
1. It is **symmetric** — `intersect` doesn't privilege one operand.
2. It **excludes zero-volume contact** — two solids meeting exactly at a face produce no polygons,
   so touching is not overlap.

## Milestone Scope

This spec covers a deliberately bounded slice of the idea doc's full architecture:

**Included:**
- Viewer geometry adapter with capability detection (not a hard-coded layout assumption)
- Unique-geometry deduplication (model-local)
- `three-mesh-bvh`-backed BLAS, one per unique geometry, lazily built
- Runtime isolation: separate `three`/`three-mesh-bvh` from Viewer's bundled THREE, via import map,
  self-hosted vendor files
- Single-pair and small-batch queries: `surface-intersection`, `volume-overlap`
- `RoomLocatorExtension` rewritten as a thin `CollisionWorld` consumer

**Excluded (future milestones):**
- TLAS-vs-TLAS scene-wide broad-phase (this milestone uses a plain linear bbox scan — room counts
  are small, tens not thousands)
- Worker offloading
- Serialization / persistent BLAS caching
- `touching` / `clearance` query modes
- Full benchmark suite
- Cross-model geometry deduplication
- Cross-model queries of any kind — `findClashes` requires `source.model === target.model` in
  Milestone 1 and rejects otherwise. Placement-transform/global-offset/unit normalization across
  models is real work the idea doc explicitly calls out ([idea:1130-1136]) and is undefined until a
  later milestone designs it.

The public `CollisionWorld` API is designed to be forward-compatible with these — later milestones
extend the same method signatures rather than replacing them.

## Architecture

**Runtime split.** Two isolated THREE.js worlds, per the idea doc. Viewer keeps its bundled THREE
(`Autodesk.Viewing.Private.THREE`) for rendering. The collision library uses its own modern `three`
+ `three-mesh-bvh`, loaded via a browser import map, and never assigns to `window.THREE` /
`globalThis.THREE` / `Autodesk.Viewing.Private.THREE`, and never patches Viewer THREE prototypes.
The two sides exchange only TypedArrays, plain numeric matrices, and packed bounds — never shared
class instances (`Mesh`, `Vector3`, `Matrix4`, `Box3`).

**Repo layout** (this is a single-app sandbox with no bundler — plain `<script type="module">`,
no monorepo):

```text
wwwroot/
├─ vendor/                          # self-hosted, npm-installed, copied here
│  ├─ three/three.module.js
│  └─ three-mesh-bvh/index.module.js
├─ collision/                       # the CollisionWorld library (Milestone 1 slice)
│  ├─ viewer/
│  │  ├─ ViewerModelAdapter.js
│  │  └─ ViewerGeometryAdapter.js
│  ├─ geometry/
│  │  ├─ GeometryRegistry.js
│  │  ├─ GeometryIdentity.js
│  │  └─ GeometryConnectivity.js    # connected-component decomposition, cached per geometry
│  ├─ blas/
│  │  ├─ ThreeMeshBvhBackend.js
│  │  └─ BlasCache.js
│  ├─ query/
│  │  ├─ SurfaceIntersectionQuery.js  # any triangle contact, touching included
│  │  ├─ ProperCrossingQuery.js       # contact that actually shares volume
│  │  ├─ ContainmentQuery.js          # per-component point-in-mesh sampling
│  │  └─ VolumeOverlapQuery.js        # ProperCrossing OR Containment (either direction)
│  ├─ CollisionWorld.js
│  └─ index.js
├─ extensions/
│  └─ RoomLocatorExtension.js       # thin consumer, registered in viewer.js
├─ viewer.js                        # adds RoomLocatorExtension to extensions list
└─ index.html                       # gains a <script type="importmap">
```

`package.json` gains `three` and `three-mesh-bvh` as real, pinned dependencies. A small
`scripts/sync-vendor.mjs` copies their built ESM files from `node_modules` into `wwwroot/vendor/`
(no bundler — just a copy step), matching the idea doc's self-hosted deployment recommendation.

## Components

**`ViewerModelAdapter`** — turns a `(model, dbId)` into the raw ingredients for a
`CollisionInstance`:
- Leaf fragments: `model.getInstanceTree().enumNodeFragments(dbId, cb, true)`. This is the real
  Viewer API — `getLeafFragIds` (used by the original gist) is not a built-in method, it's a
  community convention wrapping this call. `recursive: true` is required to cover assembly/parent
  dbIds, not just true leaf nodes.
- World matrix: `fragList.getWorldMatrix(fragId, matrix)`.
- World bounds: `fragList.getWorldBounds(fragId, box)` (available directly on `FragmentList`, no
  need to go through the render proxy).
- Geometry dedup key: `fragList.getGeometryId(fragId)` combined with `modelId`. Confirmed
  (via direct inspection of the shipped Viewer source) to be **model-local only** — the key must
  always be `(modelId, geometryIndex)`, never the bare index.

**`ViewerGeometryAdapter`** — normalizes `viewer.impl.getRenderProxy(model, fragId).geometry` into
the idea doc's `TriangleGeometryView`, **including its `ranges: TriangleRange[]` field** — the
earlier version of this spec described position/index handling but silently dropped ranges, which
the idea doc requires ([idea:198](../../ideas/aps-viewer-clash-detection-library-idea.md#L198),
[idea:266](../../ideas/aps-viewer-clash-detection-library-idea.md#L266)).

- Positions — checked in this order:
  1. `geometry.vb` + `geometry.vbstride` + `geometry.vblayout.position.offset` (Viewer-internal
     interleaved) — confirmed universal across SVF/SVF2/OTG in Viewer 7.124.2, wrapped zero-copy
     into a library-side `InterleavedBuffer`/`InterleavedBufferAttribute` over the *same* TypedArray.
  2. `geometry.attributes.position.data.array` (a real, standard three.js
     `InterleavedBufferAttribute`) — a review pass correctly pointed out the previous draft omitted
     this genuine three.js layout, which the research agent's "no evidence in 7.124.2" finding never
     ruled out for non-LMV geometry the fallback path might legitimately receive.
  3. `geometry.attributes.position.array` (a standard, non-interleaved `BufferAttribute`), stride 3.
- Index — `geometry.ib` (Viewer-internal), then `geometry.index?.array`. **Not**
  `geometry.attributes.index.array`, which the previous draft used — standard three.js
  `BufferGeometry` stores its index as a top-level `geometry.index` property, never inside
  `attributes` (which holds only per-vertex attributes like position/normal/uv). That was a real bug,
  carried over uncritically from the original gist's own (non-standard) fallback code. If neither is
  present, treat as non-indexed (`vertexCount / 3` triangles).
- Ranges — normalized into `TriangleRange[]`, matching how `WebGLRenderer` actually resolves what
  gets drawn (per its source, group and draw ranges are **intersected**, not treated as either/or):
  - If `geometry.groups` is present, each group's `{start, count}` is clipped to
    `geometry.drawRange` when a draw range is also present (`effectiveRange = intersect(group,
    drawRange)`; a group with an empty intersection contributes zero triangles, not an error). The
    previous draft only applied `drawRange` when `groups` was *absent*, which silently produced
    wrong ranges whenever a real fallback-path geometry had both.
  - If `groups` is absent, synthesize a single range covering the full index/vertex count (clipped to
    `drawRange` if present) — the `geometry.groups || [{start: 0, count: indices.length, index: 0}]`
    fallback pattern was directly observed in the shipped Viewer 7.124.2 source's own
    vertex-enumeration utilities, so it's a grounded default for the no-groups case.
  - No `drawRange` field was observed on the Viewer's internal `LeanBufferGeometry` class itself in
    this version — the intersection logic above only matters for the fallback (non-LMV) path.
  - **Legacy `offsets` layouts are explicitly rejected**, not silently normalized. The previous draft
    defaulted `baseVertex: 0` for every range regardless of layout, which a review pass correctly
    flagged as guessing rather than normalizing — there's no confirmed rule for what `offsets`'
    `index`/base-vertex field should map to, and no evidence this layout appears in Viewer 7.124.2 in
    the first place, so a fragment using it is treated as an unsupported geometry layout (skipped,
    recorded as a diagnostic — see Public API) rather than risking a silently wrong triangle range
    that could produce false clashes.

The adapter still does runtime capability detection rather than hard-coding any of the above as the
only possible layout — the research just tells us which branch fires in practice for this Viewer
version.

**`GeometryRegistry` / `GeometryIdentity`** — one `GeometryRecord` per unique
`(modelId, geometryIndex)`, with a `referenceCount`, a lazy `accelerationPromise` (the BLAS), and a
lazy `connectivity` (the `GeometryConnectivity` component decomposition). Both derived structures are
computed at most once per unique geometry and reused by every fragment instancing it — the same
amortization argument that motivates per-geometry BLAS applies unchanged to connectivity.
Cross-model geometry sharing is out of scope for this milestone.

**`ThreeMeshBvhBackend` / `BlasCache`** — builds one `MeshBVH` per `GeometryRecord`, lazily, on
first use. Position: shared/zero-copy interleaved buffer. Index: **cloned**
(`viewerIndex.slice()`), not indirect — the idea doc's own first-version recommendation, simplest
to reason about without a benchmark suite yet to justify indirect mode. The private collision
`BufferGeometry` handed to `MeshBVH` must have its `groups` (or `drawRange`) set from the adapter's
normalized `ranges`, not just the raw index buffer — `MeshBVH` only excludes out-of-range triangles
when the geometry it's given is configured with the correct range, so skipping this would let
triangles from unrelated material groups produce false clashes. `BlasCache` dedupes concurrent
build requests via `accelerationPromise` so two simultaneous queries never build the same BVH twice
— but **that promise does not make the underlying `MeshBVH` constructor non-blocking**: it's
synchronous, and dedup alone doesn't prevent one `findClashes` call from freezing the Viewer while
it builds several room BLASes back to back. `CollisionWorld`'s narrow phase (below) is responsible
for yielding between builds; `BlasCache` only owns not-building-the-same-thing-twice.

Yielding between *separate* builds doesn't help if a single build is itself large enough to freeze
the Viewer, and a review pass correctly pointed out the earlier draft deferred that risk entirely
rather than bounding it. Milestone 1 commits to a concrete (if provisional) limit:
`maxSyncTriangleCount = 20_000`. A geometry at or above that triangle count is **not** built
synchronously — `GeometryRegistry` marks the record oversized and emits one fragment-scoped
`geometry-too-large-for-sync-build` diagnostic (see Public API) rather than risking a
multi-hundred-millisecond freeze; every pair that would have needed that geometry is skipped. This is a deliberate scope boundary, not a
solved problem — true incremental (multi-frame) or Worker-based construction for large geometries is
explicitly out of scope for Milestone 1 (see Milestone Scope), so oversized geometries degrade to
"can't verify this pair" rather than "block the UI." `20_000` is a provisional default reasoned from
typical `three-mesh-bvh` build costs, not a benchmarked figure — Model Derivative-tessellated Revit
rooms and fixtures are expected to be well under this in practice (to be confirmed against the given
URN during implementation), but the threshold itself should be revisited once real measurements
exist.

### Tolerances

Three separate tolerances, because the previous draft used one world-space `coplanarEpsilon` for
quantities living in different spaces and different units — a review pass correctly flagged that
`MeshBVH` raycast distances are in the **target BVH's local space** (not Viewer world space) and
that barycentric coordinates are **dimensionless** and cannot take a distance tolerance at all:

| Tolerance | Units | Milestone 1 default | Used for |
|---|---|---|---|
| `barycentricEpsilon` | dimensionless (0-1) | `1e-6` | Deciding a ray hit is too close to a triangle's edge/vertex to trust |
| `mergeDistance` | target BVH local-space distance | `1e-6 × localBoundsDiagonal` | Collapsing coincident ray hits before parity counting |
| `interiorOffset` | local-space distance | `1e-4 × localBoundsDiagonal` | Stepping off the intersection curve in `ProperCrossingQuery` |

Both distance tolerances are **scale-relative** (a fraction of the geometry's own local bounding-box
diagonal) rather than absolute. This sidesteps the world↔local conversion problem entirely under
scaled or non-uniform instance transforms: the tolerance is defined in the same space as the numbers
it's compared against, and never needs converting. Absolute world-space tolerances, model units, and
global offsets remain an open question inherited from the idea doc's own "Tolerance" section — this
milestone deliberately avoids depending on them.

**`GeometryConnectivity`** (new) — decomposes a normalized geometry into connected components via
union-find over triangles that share a vertex index, restricted to the active triangle ranges.
Computed **once per unique `GeometryRecord`** and cached alongside the BLAS (not per query, not per
pair), so its cost amortizes exactly like BVH construction does. Output: a list of components, each
with a set of representative vertex indices. Two caveats, both stated rather than assumed away:
- Tessellated output often duplicates vertices at seams, so index-sharing can *over*-segment a
  visually-connected mesh. That's conservative — more components means more sampling, never less
  correctness — but it can inflate sample counts, which `maxContainmentSamples` caps.
- Two genuinely separate solids that share a single vertex index would be *under*-segmented into one
  component. Such solids touch, so `ProperCrossingQuery`/`SurfaceIntersectionQuery` see them as
  contacting geometry and the containment path isn't what decides the result.

**`SurfaceIntersectionQuery`** — precisely `MeshBVH.intersectsGeometry(otherGeometry,
relativeMatrix)`, early-exiting on the first intersecting triangle pair. **True iff any triangle
pair from A and B has a non-empty geometric intersection**, including zero-volume coincident contact
(face-face, edge-edge, vertex-face). This mode is *correctly named* for that behavior — it reports
surface intersection, which is what touching is. It's the right primitive for "do these two things
touch at all," and it is deliberately **not** what `volume-overlap` returns.

**`ProperCrossingQuery`** (new) — answers "do these two solids share positive volume near their
contact," which is what `volume-overlap` actually needs and what round 2's draft wrongly conflated
with any surface hit. A review pass correctly refused the "document the conflation" response: the
idea doc defines volume overlap as solids *sharing volume* with touching as a separate mode, and the
CSG implementation being replaced already excluded touching (a BSP intersect of face-touching solids
produces no polygons), so accepting contact-as-overlap was a regression against the code this
milestone replaces, not merely an imprecision.

1. Enumerate intersecting triangle pairs with `MeshBVH.bvhcast(otherBvh, relativeMatrix, {
   intersectsTriangles(triA, triB) { … } })` — a real `three-mesh-bvh` traversal API (the idea doc
   lists `bvhcast` among the reasons for choosing this backend). Returning `true` from the callback
   early-exits the traversal.
2. For each intersecting pair, compute the intersection segment via
   `ExtendedTriangle.intersectsTriangle(other, targetLine)` and take its midpoint `M`.
3. Classify by stepping off the intersection curve into each of the four quadrants the two surfaces
   locally divide space into: for each sign combination `(s₁, s₂) ∈ {+1,−1}²`, form
   `candidate = M + interiorOffset × normalize(s₁·nA + s₂·nB)`, skipping combinations where
   `s₁·nA + s₂·nB` is near-zero (which is exactly the coplanar/parallel case). The pair is a proper
   crossing iff **some candidate is strictly inside both A and B** (tested with `ContainmentQuery`'s
   point-in-mesh routine).
   - This is winding-independent: it never assumes outward-facing normals, only that the two normals
     span the local quadrants. Round 2's draft would have needed a consistent-winding assumption that
     Viewer tessellation doesn't guarantee.
   - For coplanar face-on-face touching, `nA` and `nB` are (anti)parallel, so the non-degenerate
     candidates lie strictly on one side or the other — inside exactly one solid, never both.
     Correctly classified as *not* a crossing.
   - For a genuine crossing (the duct-through-beam case), the transversal surfaces do divide space
     into four quadrants, one of which is interior to both — correctly classified as a crossing.
4. Early-exit `true` on the first proper crossing. Examine at most `maxCrossingPairsExamined = 64`
   intersecting pairs; if that cap is reached with every examined pair classified as mere touching,
   stop and emit an `inconclusive-crossing` diagnostic rather than asserting a negative — a bounded
   examination cannot prove the absence of a crossing among unexamined pairs.

**`ContainmentQuery`** — point-in-mesh testing by ray-casting parity. It exposes **two layers**, and
keeping them distinct is what stops the design from being circular:

- `isPointInside(point, targetBvh)` — the low-level parity primitive. `ProperCrossingQuery` uses
  only this, on its own synthesized candidate points.
- `anyComponentInside(source, target)` — the per-component sampling wrapper below.
  `VolumeOverlapQuery` uses this, and only *after* `ProperCrossingQuery` has returned false.

So the exactness argument below (which assumes no proper crossing) never depends on a result that
depends on it: the primitive has no such precondition, and only the wrapper does.

- **Sampling is per connected component, not a global cap.** The previous draft's "up to 64 points"
  had a real false negative a review pass correctly identified: an unsampled component of A could be
  contained in B while every sampled component sits outside, with no surface intersection anywhere
  and no diagnostic emitted. It also contradicted itself arithmetically ("up to 64" vs. "at least 8
  per range" with more than 8 ranges). The fix isn't a bigger cap — it's using the right
  decomposition:

  > **Why per-component sampling is exact here.** `ContainmentQuery` only decides the outcome after
  > `ProperCrossingQuery` has already returned false — i.e. **no proper crossing exists**. Without a
  > proper crossing, no component of A can be partly inside and partly outside B: passing from
  > interior to exterior would require transversally crossing B's boundary, which *is* a proper
  > crossing. So every component is wholly inside or wholly outside (possibly with zero-volume
  > boundary contact), and **one conclusive sample per component determines that component exactly.**
  > Covering every component therefore makes the containment step exact, not merely
  > better-sampled — no vertex scan and no connectivity-blind cap can claim the same.
  >
  > The "possibly with boundary contact" caveat is why `samplesPerComponent` is 4 rather than 1: on a
  > touching-but-not-crossing pair, a sample that happens to sit exactly on the shared interface reads
  > inconclusive, and the remaining samples of that component are what resolve it.

  Concretely: take up to `samplesPerComponent = 4` vertices from each component (fewer if the
  component has fewer), drawn only from vertices referenced by active triangle ranges. Extra samples
  beyond the first exist purely to survive inconclusive geometry, not for coverage — coverage is
  already guaranteed by construction. A global `maxContainmentSamples = 512` bounds pathological
  over-segmented geometry; hitting it emits `incomplete-component-coverage` (see Public API) so an
  unsampled-component negative is never reported as a clean negative.
- **Parity test**, in the target BVH's own local space throughout:
  - Cast with `THREE.DoubleSide` explicitly. `MeshBVH.raycast` defaults to front-face-only, which
    silently breaks parity counting — a back-facing crossing simply wouldn't register.
  - Ray directions are **local-frame axes of the target BVH** (local +X first, local +Y on retry),
    not world axes. The previous draft said "world axis," which would need transforming into the
    target's frame under any rotated or scaled instance transform; picking the direction in the
    target's own frame avoids the conversion rather than specifying it.
  - **Sort hits by distance, then** collapse runs closer together than `mergeDistance` into a single
    crossing before counting parity — so a ray through an edge shared by two adjacent triangles isn't
    double-counted. Sorting must precede deduplication; `MeshBVH.raycast` does not guarantee ordered
    hits.
  - A hit whose barycentric coordinates put it within `barycentricEpsilon` of a triangle edge or
    vertex is inconclusive for that attempt. Retry that sample point once with the alternate local
    axis (2 attempts total). If still inconclusive, that sample is unresolved — move to the next
    sample of the same component.
  - A component whose samples are all unresolved is an unresolved component; a pair with any
    unresolved component emits `inconclusive-containment` whenever the pair's result is negative
    (see Error Handling — a negative built on unresolved components is not a verified negative).

**`VolumeOverlapQuery`** — the direct replacement for `ThreeBSP.intersect()`, composed from the
above. Three review rounds shaped it; the two rejected shapes are worth keeping in view because each
fixed the other's bug and reintroduced its own:

- **Round 1**: surface-intersection, then a single bbox-center point test. A bbox center isn't even
  guaranteed to lie inside its own solid (a torus's center sits in its hole) — false negatives on
  off-center containment, false positives elsewhere, and non-symmetric.
- **Round 2**: dropped the surface test entirely, bidirectional vertex sampling only. This lost
  genuine interpenetration where neither solid has a *vertex* inside the other — a duct crossing a
  beam mid-span shares real volume, but the overlap region is bounded by edges crossing faces, far
  from any vertex. No amount of vertex sampling finds it.
- **Round 3 (current)**: keep a real triangle-level test for the crossing case, but *classify* it
  instead of accepting any contact, and make the containment case exact via components:

```text
volume-overlap(A, B) :=
      ProperCrossingQuery(A, B)              // shares volume through a surface crossing
   OR ContainmentQuery(anyComponentOf(A) inside B)
   OR ContainmentQuery(anyComponentOf(B) inside A)
```

Evaluated in that order with early exit. The containment terms are *any component*, not "the whole
of A" — a two-part fixture with one part inside the room overlaps that room, and requiring total
containment would miss it.

Both directions are required for symmetry: a small fixture inside a large room and a large room
enclosing a small fixture are the same predicate viewed from either side, but only one direction has
a witness point to find. Pure touching now correctly returns **false** — it yields no proper
crossing, and a solid resting on another's face is outside it. If every component on both sides is
unresolved, the result is reported as negative *with* an `inconclusive-containment` diagnostic rather
than as a clean negative.

**`CollisionWorld`** — the facade. Broad phase is a plain linear AABB scan over
`CollisionInstance.worldBounds` (no TLAS yet — candidate counts are small). Narrow phase calls
`VolumeOverlapQuery` or `SurfaceIntersectionQuery` per candidate pair depending on `query.mode`.

## Data Flow — Room Locate Query

1. On `load()`, the extension only calls `CollisionWorld.fromViewer(viewer, options)` — this just
   constructs the world, it does not resolve rooms, build `CollisionInstance`s, or build any BLAS.
   **Room discovery does not happen here.** The original version of this spec resolved room dbIds
   during `load()` and cached them for the extension's lifetime, but in this app extensions start
   with the Viewer itself (`wwwroot/viewer.js`), well before any model is loaded — `wwwroot/main.js`
   only calls `loadModel()` after later async user interaction (URN entry, translation-status
   polling), and the user can load a different model afterward. A `load()`-time cache would either
   run against no model at all or go stale the moment a new model loads.
   - Instead, room dbIds are resolved **lazily, keyed by `model.id`**, in a `Map<number, Promise<number[]>>`
     owned by the extension. The first `locateElementByRoom` call for a given model triggers
     `model.search(roomCategoryName, onSuccess, onError, ['Category'], { searchHidden: true })` and
     caches the resulting promise; later calls for the same `model.id` reuse it. The cache entry for
     a model is dropped when that model is unloaded (the extension listens for the Viewer's
     model-removal notification) so a stale room list can never outlive its model.
   - **`model.search`, not `viewer.search`** — a review pass correctly caught the previous draft
     using the latter. Per the installed typings, `Viewer3D.search` is declared with four arguments
     and no `options` parameter (`index.d.ts:1247`), so the `{ searchHidden: true }` argument would
     have been silently dropped; `Model.search` is the five-argument form that actually honors it
     (`index.d.ts:835`). It also scopes results to one model, which a cache keyed by `model.id`
     requires to be correct in the first place.
2. On a locate request: `world.findClashes({ source: { model, dbIds: [dbId] }, target: { model,
   dbIds: roomDbIds }, mode: 'volume-overlap', groupBy: 'dbId' })`, where `roomDbIds` comes from the
   per-model cache above (resolving it first if this is the first call for that model).
3. Inside `CollisionWorld.findClashes`:
   - Reject immediately if `source.model !== target.model` (cross-model queries are out of scope —
     see Milestone Scope).
   - Build/get `CollisionInstance`s for the source dbId and every target room dbId via
     `ViewerModelAdapter` (one instance per fragment — either side may have more than one fragment).
   - **Broad phase**: linear AABB scan of source instances against target instances.
   - **Narrow phase**: for each candidate pair, check both geometries' triangle counts against
     `maxSyncTriangleCount` (20,000) first — if either exceeds it, skip the pair and record a
     `geometry-too-large-for-sync-build` diagnostic against the offending fragment. That diagnostic
     is **fragment-scoped and deduplicated**: being oversized is a property of the geometry alone,
     not of the pairing, so one entry is emitted per oversized fragment no matter how many candidate
     pairs it appears in. Otherwise lazily get/build BLAS via `GeometryRegistry`/`BlasCache`, then run
     `VolumeOverlapQuery` (or `SurfaceIntersectionQuery` for that mode) with the pair's relative
     matrix. Because `MeshBVH`
     construction is synchronous, the narrow phase `await`s a scheduling yield (e.g.
     `requestAnimationFrame`/`setTimeout(0)`) between each *new* BLAS build within one `findClashes`
     call — cached BLAS hits don't yield, only builds do — so a query that touches many
     not-yet-built rooms doesn't freeze the Viewer in one synchronous burst.
   - Aggregate fragment-pair hits into dbId-level `ClashPair`s (`groupBy: 'dbId'`), deduping so a
     room with multiple fragments isn't reported twice.
4. The extension maps `result.pairs[].target.dbId` back to room dbIds and returns them — the same
   return contract as the original `locateElementByRoom(dbId)`.

## Public API

```ts
CollisionWorld.fromViewer(viewer, options): Promise<CollisionWorld>
// options: { model?, narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' }
// narrowPhase/indexOwnership are accepted for forward compatibility with the idea doc's
// eventual multi-backend API, but only one value each is implemented in Milestone 1 —
// passing any other value throws.

world.findClashes(query): Promise<ClashResult>
// query.source.model must === query.target.model — cross-model queries reject in Milestone 1
// query.mode: 'volume-overlap' | 'surface-intersection'
//   'volume-overlap'       — solids share positive volume; pure touching is NOT overlap
//   'surface-intersection' — any triangle contact, touching included
//   ('touching' / 'clearance' deferred to a later milestone)
// query.groupBy: 'dbId'
//   ('fragment' / 'externalId' deferred)
//
// No firstHitOnly in Milestone 1. It sat in this API from the first draft with no defined
// semantics — stop at the first fragment pair? the first aggregated dbId pair? the first pair
// per source? — and no story for how truncated statistics/diagnostics would be reported. The
// room-locator wants every matching room, so nothing in this milestone needs it. Deferred to
// whichever milestone has a caller that can pin down its meaning.

world.dispose(): void   // frees cached BLAS/geometry records
```

```ts
class RoomLocatorExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options)      // options.roomCategoryName default 'Revit Rooms'
  async load()                      // constructs the CollisionWorld only; no room resolution here
                                     // (see Data Flow step 1) and no eager BLAS building
  unload()                          // world.dispose(), unregisters context menu + model-removal
                                     // listener, clears the per-model room cache
  async locateElementByRoom(dbId): Promise<number[]>
  onContextMenu(menu, status)       // adds "Locate Room" item, same UX as the original extension
}
```

`ClashPair`, `ClashResult`, `ClashStatistics`, `ElementRef`, `FragmentRef` reuse the shapes already
defined in the idea doc's "Proposed Types" section, with one addition for this milestone:
`ClashStatistics` gains `diagnostics: ClashDiagnostic[]`.

Two earlier shapes were rejected in review. A flat `skippedFragments: FragmentRef[]` couldn't say
*why* a fragment was skipped. Replacing it with a required `sourceFragment` plus optional
`targetFragment` fixed that but introduced a new gap a review pass caught: a normalization failure on
a **target room's** fragment had nowhere to go — it would have to masquerade as a `sourceFragment`,
misreporting which side of the query actually failed. Milestone 1 uses a role-tagged union instead:

```ts
type FragmentDiagnosticReason =
  | 'unsupported-geometry-layout'        // no usable position/index source
  | 'rejected-primitive-range'           // legacy `offsets` layout, not normalized on a guess
  | 'geometry-too-large-for-sync-build'; // over maxSyncTriangleCount

type PairDiagnosticReason =
  | 'inconclusive-containment'        // unresolved component(s) under a negative result
  | 'incomplete-component-coverage'   // maxContainmentSamples hit before covering all components
  | 'inconclusive-crossing';          // maxCrossingPairsExamined hit, all examined pairs touching

type ClashDiagnostic =
  // Discovered during geometry normalization or the size check, independent of any pairing.
  // `role` says which side of the query the fragment was playing — a target room fragment that
  // fails to normalize is reported as such, not disguised as a source.
  | { scope: 'fragment'; reason: FragmentDiagnosticReason; role: 'source' | 'target';
      fragment: FragmentRef }
  // Discovered while evaluating one specific pair; both sides are always known here.
  | { scope: 'pair'; reason: PairDiagnosticReason;
      sourceFragment: FragmentRef; targetFragment: FragmentRef };
```

**Diagnostics are emitted for partially-unresolved negatives, not only totally-unresolved ones.** The
previous draft emitted `inconclusive-containment` only when *every* sample was inconclusive, which a
review pass correctly identified as still losing completeness information: a pair with some
conclusive "outside" samples and some unresolved components produces a negative that is not a
verified negative. The rule is now: **any unresolved component or truncated examination that could
have changed a negative result emits a pair diagnostic.** Positive results need no such diagnostic —
a witness point inside the other solid is conclusive regardless of what else went unresolved.

**`findClashes` always resolves `{ pairs: ClashPair[], statistics: ClashStatistics }`**, never a
bare `{ pairs: [] }` — the earlier draft of this spec returned a statistics-less empty result for
the no-candidate-rooms case, which is inconsistent with the idea doc's `ClashResult` type (where
`statistics` is required) and would make it impossible to tell "zero rooms existed to check" apart
from "the query itself never ran." When there are no candidates, `statistics` is still returned with
its counters zeroed (`broadPhasePairs: 0`, etc.) rather than the field being omitted.

## Error Handling & Edge Cases

- **Unsupported geometry layout**: if the adapter can't detect a position/index source on a
  fragment, or the fragment uses a legacy `offsets` layout (explicitly rejected — see
  `ViewerGeometryAdapter`), skip that fragment and record a `scope: 'fragment'` diagnostic with the
  appropriate `role` — not just a console warning, which would make an incomplete result
  indistinguishable from a verified no-clash one. The extension should surface a visible caveat (not
  silently report "no room found") when `statistics.diagnostics` is non-empty for the queried
  element.
- **Geometry too large to build synchronously**: a candidate pair whose geometry exceeds
  `maxSyncTriangleCount` (20,000 triangles) is skipped with a
  `geometry-too-large-for-sync-build` diagnostic rather than blocking the Viewer — see
  `ThreeMeshBvhBackend`/`BlasCache`.
- **Non-watertight geometry**: ray-parity containment assumes a closed target surface, so
  `volume-overlap` is only strongly guaranteed for closed/manifold geometry — mitigated with
  `THREE.DoubleSide` raycasting, distance-sorted coincident-hit merging, `barycentricEpsilon`
  edge/vertex rejection, and a bounded retry on an alternate local axis (see `ContainmentQuery` for
  the exact rule). Unresolved components under a negative result produce
  `inconclusive-containment` rather than a silent guess.
- **Truncated examination**: hitting `maxContainmentSamples` before covering every component, or
  `maxCrossingPairsExamined` with every examined pair classified as touching, produces
  `incomplete-component-coverage` / `inconclusive-crossing` respectively — a bounded search that
  finds nothing has not proven a negative.
- **No candidate rooms** (empty search result, or wrong category name): `findClashes` still returns
  a full `ClashResult` with `pairs: []` and zeroed `statistics`; the extension surfaces "No rooms
  found" rather than throwing.
- **Cross-model query attempted**: `findClashes` rejects synchronously rather than silently
  computing a meaningless result — Milestone 1 has no defined coordinate normalization across models
  (see Milestone Scope).
- **Element with no fragments** (fully hidden/suppressed dbId): `findClashes` returns early with
  `pairs: []` and zeroed `statistics` (same contract as the no-candidate-rooms case above), no BLAS
  work attempted.
- **Invalid dbId**: reject with a clear error rather than silently returning empty.
- **Stacked/overlapping-bbox rooms** (e.g. double-height spaces): handled correctly by
  construction — broad phase may pass multiple bbox candidates through, but narrow-phase
  volume-overlap resolves the true containing room via actual triangle-level testing.
- **Disposal mid-query**: if `unload()`/`world.dispose()` fires while a query is in flight,
  in-flight promises reject cleanly. Full cancellation tokens are out of scope for this milestone.

## Testing & Verification

**Unit tests** (pure geometry, no Viewer needed):
Each of the three rejected algorithm shapes has a named regression fixture below, so a future
refactor can't silently reintroduce a bug an earlier round already found.

- `SurfaceIntersectionQuery`:
  - two clearly separated boxes — no intersection
  - two boxes with genuine interpenetration — intersects
  - **flush/coplanar touching faces only** (a box resting exactly on another box's top face) —
    **intersects**. Correct for *this* mode: touching is surface intersection. The point of the
    fixture is to pin the contrast with `volume-overlap`, which must return false on the same input.
- `ProperCrossingQuery` — the round-3 fix, tested directly rather than only through its caller:
  - **flush/coplanar touching faces only** — **not a crossing**. Same geometry as the
    `SurfaceIntersectionQuery` fixture above, opposite expected result; this pair of fixtures is the
    regression test for round 2's "touching counted as volume overlap" bug.
  - edge-edge and vertex-face contact with no shared volume — not a crossing
  - **two long, thin boxes crossing perpendicularly mid-span** (a duct through a beam), thin enough
    that no vertex of either lies inside the other — **is a crossing**. Regression test for round 2's
    counterexample, which pure vertex sampling cannot detect at any sample count.
  - a crossing between meshes with **inconsistent/inward-facing winding** — still a crossing,
    verifying the four-quadrant candidate test doesn't depend on outward normals.
- `ContainmentQuery`:
  - **a two-component geometry where only the smaller, second component lies inside the target**,
    with no surface intersection anywhere — must report contained. Regression test for the
    capped-sampling false negative: any connectivity-blind sampler can miss the small component,
    while per-component coverage cannot.
  - a geometry with **more than 8 active ranges** — verifies sample budgeting is coherent (the
    previous draft's "up to 64 total" and "at least 8 per range" were arithmetically contradictory
    here)
  - a mesh where containment is only read correctly with `THREE.DoubleSide` (a thin shell whose
    back-facing crossings a front-face-only raycast would miss)
  - two adjacent triangles sharing an edge, with a ray passing exactly through that shared edge —
    verifies hits are distance-sorted *then* merged, so the shared edge counts as one crossing and
    doesn't flip parity
  - a target under a **non-uniform scale** instance transform — verifies scale-relative tolerances
    and local-frame ray directions behave, since this is exactly where a world-space epsilon or a
    world-axis ray direction would have gone wrong
  - a geometry that exhausts `maxContainmentSamples` — verifies `incomplete-component-coverage` is
    emitted rather than a clean negative
- `VolumeOverlapQuery` (composition-level):
  - box fully inside box; separated boxes — baseline sanity
  - **flush touching only — must report NO overlap.** The headline round-3 behavior change, and the
    behavior the original CSG implementation had.
  - an **L-shaped (non-convex) room** with an element in the concave notch
  - a **torus with a small element centered in its hole** — no overlap (round 1's false positive)
  - an element **fully embedded off-center** in a large room — overlap (round 1's false negative)
  - a **door-like element straddling two room volumes** through a wall opening — overlap with both
  - a pair whose only unresolved components sit under a negative result — verifies the negative
    carries `inconclusive-containment` rather than being reported as verified
- `ViewerGeometryAdapter` against fixtures covering:
  - the confirmed primary `vb`/`vbstride`/`vblayout` layout
  - standard `attributes.position.array` (non-interleaved `BufferAttribute`)
  - standard `attributes.position.data.array` (real three.js `InterleavedBufferAttribute`) — the
    layout the previous draft omitted entirely
  - index via `geometry.index.array` (the correct standard three.js location) — verifying the fixed
    fallback, since the previous draft incorrectly checked `attributes.index.array`
  - `geometry.groups` present vs. absent (verifying the single-synthesized-range fallback)
  - `geometry.groups` **and** `geometry.drawRange` both present, with a group whose range only
    partially overlaps the draw range — verifying the two are intersected, not treated as either/or
  - a fixture using a legacy `offsets` layout — verifying it's explicitly rejected (recorded as
    `rejected-primitive-range`), not silently normalized with a guessed `baseVertex`

**Integration test (acceptance criterion for this milestone)**: load URN
`dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ`
in the sandbox app, select `Bathtub-TOTO-Nexus-FBF794S [420270]`, trigger "Locate Room" from the
context menu, and confirm the reported/highlighted room visually matches the bathroom it's actually
in. Manual verification for this milestone — no parallel run against the old CSG extension for
cross-checking, since maintaining two implementations to compare adds scope this milestone doesn't
need.

## Risks (carried and refined from the idea doc)

- **Geometry identity is model-local**: confirmed via direct inspection of the shipped Viewer
  source (`FragmentList.getGeometryId`) — no cross-model dedup in this milestone, and no evidence
  of a portable geometry hash for classic SVF (only OTG/SVF2 expose `getGeometryHash`, and it's
  undocumented).
- **Non-watertight tessellation**: Viewer geometry isn't guaranteed closed/manifold; volume-overlap
  strong guarantees are limited to well-formed room geometry, as in the idea doc.
- **Viewer private API drift**: `getRenderProxy`, `vb`/`vbstride`/`vblayout`, and `getGeometryId`
  are all untyped/internal APIs, confirmed only by reading the shipped 7.124.2 source, not by
  official prose documentation. A future Viewer version could change this layout — isolate all of
  it inside the two adapters, as designed.
- **Import map registration order**: the import map must be present in `index.html` before the
  first module import that resolves `three`/`three-mesh-bvh`, per the idea doc's deployment
  guidance.
- **Model-removal event name unverified**: the per-model room-dbId cache (Data Flow step 1) needs to
  invalidate when a model unloads. The exact Viewer event/notification for this wasn't confirmed
  during design research (only load-side APIs were) — must be verified against the 7.124.2 source or
  official docs during implementation, not assumed.
- **`ProperCrossingQuery` is the most intricate piece of new geometry code in this milestone**: the
  four-quadrant candidate test is standard technique, but it is the one component with no simpler
  fallback if it proves fragile against real tessellation (thin slivers, near-degenerate triangles at
  the intersection curve). It's covered by direct unit fixtures rather than only through
  `VolumeOverlapQuery`, precisely so a failure here is diagnosable in isolation. If it does prove
  unworkable during implementation, the fallback is *not* to silently revert to touching-inclusive
  overlap (round 2's rejected behavior) but to raise it as a scope question.
- **Component decomposition depends on index sharing, not geometric welding**: `GeometryConnectivity`
  can over-segment tessellated meshes with duplicated seam vertices. This is conservative for
  correctness but inflates sample counts, and is the most likely trigger for
  `incomplete-component-coverage` on real models — worth measuring early, since it determines whether
  `maxContainmentSamples = 512` is comfortable or tight.
- **`InterleavedBufferAttribute` and `drawRange`/`groups`-intersection fixtures are unverified
  against real Viewer output**: the adapter fixes in this revision (index path, interleaved
  fallback, range intersection, `offsets` rejection) are grounded in correct three.js semantics and
  the reviewer's citations, but — unlike the `vb`/`vbstride` primary path — none of them have been
  confirmed to actually occur in real geometry from the given URN. They're defensive-but-currently
  theoretical branches; implementation should log when any fallback path actually fires against real
  models, to confirm whether this generality is load-bearing or dead code for Viewer 7.124.2 in
  practice.

## Open Questions Deferred to Future Milestones

- Should the small-geometry brute-force fallback (from the idea doc) be added in this milestone or
  the next, once real room/fixture triangle counts are measured against the given URN?
- Should `indexOwnership: 'indirect'` become the default once a benchmark suite exists?
- Does cross-model geometry deduplication matter enough to prioritize once multi-model clash
  detection (a later milestone) is designed?
- Are `samplesPerComponent = 4`, `maxContainmentSamples = 512`, and
  `maxCrossingPairsExamined = 64` the right budgets? All three are provisional. Unlike the previous
  draft's flat 64-point cap, none of them affect *coverage* correctness (component decomposition
  handles that) — they only bound pathological cases, and every truncation is now observable via a
  diagnostic. That makes them tunable from real telemetry rather than guesswork, but they still need
  real measurement.
- Is `maxSyncTriangleCount = 20,000` the right threshold before a geometry is skipped rather than
  built synchronously? It's a provisional default, not a benchmarked one (see
  `ThreeMeshBvhBackend`/`BlasCache`) — needs real measurement against the given URN and, if rooms or
  fixtures routinely exceed it, either a higher threshold or real incremental/Worker construction
  becomes a near-term (not indefinitely deferred) need rather than a future-milestone nicety.
- Now that `ProperCrossingQuery` exists, a `touching` mode is nearly free (it's
  `SurfaceIntersectionQuery AND NOT ProperCrossingQuery`, both already implemented). Should the
  deferred `touching` mode be pulled forward into this milestone, or does adding a third public mode
  outweigh the small implementation cost? Deliberately left deferred here to hold the milestone
  boundary, but it's now a cheap increment rather than new machinery.
- The idea doc's open question on coplanar semantics
  ([idea:1709](../../ideas/aps-viewer-clash-detection-library-idea.md#L1709)) is now answered *for
  these two modes* (touching is surface intersection, not volume overlap) but not at the architecture
  level for `clearance`/`touching` tolerances. Should that answer be promoted into the idea doc as a
  library-wide convention?
- When a model is reloaded with the same `model.id` (if that's possible in this Viewer version) but
  different content, does the per-model room cache need an explicit epoch/version key in addition to
  `model.id`? Unconfirmed whether `model.id` is ever reused across distinct loads.
