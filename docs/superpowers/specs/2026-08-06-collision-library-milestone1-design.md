# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: revised after six rounds of codex review (see `review-coments.md`, `review-comments-v2.md`
… `review-comments-v6.md` in this directory), pending user re-review
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

### Round 4 (4 P1, 1 P2 — all confirmed valid)

Round 3 built the right *structure* (classify crossings, decompose into components) but several of its
geometric primitives don't survive contact with the actual `three-mesh-bvh` contract or with
adversarial geometry. Two findings independently defeat round 3's headline fix — touching must not
count as overlap — by different routes:

- **Boundary points read as "inside."** Ray parity from a point lying exactly *on* a target face
  produces a distance-zero hit that the barycentric edge/vertex rule doesn't reject, flipping parity
  to "inside." A box resting on another box has its whole bottom face on the target's boundary, so
  this turns pure face contact back into `volume-overlap` — undoing round 3. Fixed with an explicit
  three-valued `inside | outside | boundary` classification and a surface-proximity pre-check.
- **`interiorOffset` imposed a hidden minimum penetration depth.** Stepping a fixed
  `1e-4 × diagonal` off the intersection curve steps *clean through* any overlap thinner than that,
  yielding a false negative with no vertex witness either. Replaced with an adaptive offset ladder
  and an explicitly declared `minPenetrationDepth`, plus a symmetric definition of whose diagonal
  sets the scale (round 3 never said).
- **Coplanar pairs never had a valid segment.** Verified directly against upstream: the coplanar
  branch of `ExtendedTriangle.intersectsTriangle` warns and sets the output edge to `(0,0,0)`, so
  round 3's midpoint was the origin and the four-quadrant argument was vacuous for exactly the case
  it most needed to classify. Coplanar contact now has its own classification path that never asks
  for a segment.
- **The exactness proof was wrong.** Vertex-based union-find can merge two solids joined at a single
  vertex; one may sit inside the target and the other outside with no transverse crossing, so
  component representatives can miss the contained one. Round 3's rebuttal ("they touch, so the
  contact query decides it") confused A-touching-*itself* with A-touching-B. Fixed by switching to
  edge-connectivity, replacing the unconditional "exact" claim with a stated-precondition guarantee,
  and detecting the geometry that violates it.
- **Model removal leaked collision data.** The room cache was evicted per model but geometry
  records, BLASes, and connectivity — all keyed by `(modelId, geometryIndex)` — were only freed by a
  whole-world `dispose()`. Added `world.evictModel()`.

This round also pins exact dependency versions and corrects the vendor file layout, both of which
were wrong in a way that would have surfaced at first `npm install`.

### Round 5 (3 P1 accepted, 1 P1 rejected with evidence, 1 P2 accepted)

- **`bvhcast` does not hand you intersecting pairs — it hands you *candidates*.** Round 4 built the
  whole crossing classifier on the assumption that an `intersectsTriangles` callback meant an
  intersection had occurred. Verified against `MeshBVH.js` at tag `v0.9.14`: the wrapper is a plain
  nested loop over every triangle in the two overlapping leaf ranges, calling the callback for each
  pair with **no intersection test whatsoever** — testing is the callback's job. Round 4 would
  therefore have computed segments from non-intersecting pairs, where `intersectsTriangle` returns
  false and leaves `targetLine` holding a *previous* pair's data, fabricating crossings from stale
  state. `ProperCrossingQuery` now tests each candidate explicitly, and orders the coplanar check so
  the upstream warning path is never entered at all.
- **Four samples never guaranteed a conclusive one.** The containment guarantee said "one conclusive
  sample decides the component," but the algorithm stopped after 4 arbitrary vertices. A solid deep
  inside a room while sharing one coplanar face with it can have all 4 picks land on that shared
  face, all reading `boundary` — returning a diagnosed non-overlap for an overlap far deeper than
  `minPenetrationDepth`. Sampling now continues until conclusive and, if a component's vertices are
  exhausted inconclusively, falls back to a **constructed interior witness** rather than giving up.
- **Tolerances were declared in one frame and applied in another.** Round 4 scaled every tolerance by
  a characteristic length defined in the classification frame, but `classifyPoint` does its proximity
  and ray work in the *target* BVH's local frame — so `surfaceEpsilon`/`mergeDistance` were being
  compared against distances in a different space, and the `min(diagonal(A), diagonal(B→A))` formula
  wasn't even symmetric under swap. Tolerances are now **target-frame-local** by construction, and
  operand order is **canonicalized** so symmetry is structural rather than a property of a formula.
- **Interleaved stride/offset mapping** is now spelled out instead of implied.
- **Rejected: "`three-mesh-bvh@0.9.14` is not published."** It is. `https://registry.npmjs.org/three-mesh-bvh`
  lists `0.9.14` in `versions` with `dist-tags.latest = 0.9.14`, published `2026-08-01T04:33:04Z`,
  and its tarball returns HTTP 200. The npmjs.com web UI can lag the registry, which is the likely
  source of the discrepancy. The pin stays at `0.9.14` — downgrading to `0.9.13` on this basis would
  pin an *older* release for no reason. The finding's methodological point was fair, though, and has
  been acted on: every upstream claim in this spec is now verified against the exact `v0.9.14` tag
  rather than `master`.

### Round 6 (4 P1 — all confirmed valid)

Round 5's fixes held, but three of these findings expose the same underlying gap: **the spec
described point classification without ever declaring the solid model it implies.** Parity, "any
component," and "closed manifold" were each specified locally and never reconciled into one
statement of what geometry *means*. This revision adds that statement (see **Solid model**) and
fixes what it exposes:

- **Open components could produce a clean false-positive overlap.** A single open triangle inside a
  closed box has zero volume, yet one of its vertices classifies `inside`, so `anyComponentInside`
  returned true and `volume-overlap` reported an *undiagnosed* clash. Round 5 flagged non-manifold
  components only on **negative** results, which is exactly backwards for this case. Flagging now
  follows whichever component decided the outcome, in either direction.
- **Target-wide parity is XOR, not union — and the spec claimed neither.** A point inside two nested
  closed shells crosses two surfaces and reads `outside`. Round 5's composition ("any component
  inside") implied union semantics while the primitive implemented even-odd, so a source inside two
  concentric target shells was a clean false negative. Even-odd is now the **declared** model, with
  its real justification (it is what makes a pipe's bore correctly hollow) and its real limitation
  (genuinely nested independent solids in one geometry) both stated and pinned by fixtures.
- **The constructed witness reintroduced the frame bug round 5 had just fixed.** `offsetLadder` is
  scaled by `L_canonical`, but the witness construction applies it in the *source component's* frame.
  Round 5 established the per-frame principle and then missed an instance of it; there is now a
  separate `witnessLadder` scaled by `L_source`.
- **Raw `bvhcast` candidate work was unbounded.** The crossing budget counted only *confirmed*
  intersections, so two meshes with heavily overlapping leaves and no intersections at all could run
  a multi-million-pair synchronous loop while never consuming the budget — directly contradicting
  this spec's own claim that the budgets bound the worst case. A raw-candidate budget with an abort
  protocol now backs that claim up.

## Spike Findings (executable, `spike/`)

After six review rounds, the remaining questions were ones no amount of reading could
settle. `spike/geometry-core.mjs` implements the primitives below against real
`three@0.185.1` / `three-mesh-bvh@0.9.14`; `spike/fixtures.mjs` runs every regression case the
review rounds produced (`node spike/fixtures.mjs` — 20/20 pass); `spike/measure.mjs` replaces the
guessed constants with measured ones. It found two defects that no review round caught, and settled
three open questions:

1. **Local-axis ray directions are pathological for BIM geometry.** The spec said "local +X first,
   local +Y on retry." A ray along a local axis from a symmetric point inside an axis-aligned box
   strikes the exact *centre* of a face — which is precisely where `BoxGeometry` splits its two
   triangles — so every hit grazes a diagonal, both retries graze, and the point returns `boundary`.
   The centre of a box classified as boundary. Axis-aligned boxes being most of what BIM contains,
   this would have failed pervasively and silently. **Fixed:** generic non-axis-aligned directions.
2. **Vertex welding is mandatory, not the optional future "repair" the spec deferred.** Unwelded,
   index-based connectivity splits a plain `BoxGeometry` into **6 components** with every edge a
   boundary edge; a cylinder into **49**. `closedManifold` is false for the simplest solid there is,
   so the containment guarantee would never once have held. Welding rescues every closed primitive
   tested (box, sphere, cylinder, cone, torus → 1 component, closed manifold). **Fixed:** welding is
   now a required normalization step.
   - The reason `mergeVertices` appears not to work is that it compares *all* attributes, and
     per-face normals/uvs make every vertex unique. Stripping to position-only first is what makes
     welding possible — so the spec's "don't copy rendering attributes" rule, written for memory,
     turns out to be **load-bearing for correctness**.
   - This invalidates the zero-copy position strategy (see `ThreeMeshBvhBackend`) — but welding
     *shrinks* geometry by ~23% on average (box 24→8 vertices, cylinder 148→50), so an owned welded
     buffer costs less than the shared one would have, not more.
3. **Measured budgets replace guessed ones** (see Tolerances/budgets): BVH build is ~16ms at 18k
   triangles, validating `maxSyncTriangleCount = 20_000` as roughly a one-frame ceiling; raw
   candidate pairs cost ~0.3µs each, making the guessed `maxCandidatePairsExamined = 200_000` a
   ~53ms stall, so it drops to `50_000`.

**Part B ran the same questions against the live acceptance model** (`racbasicsampleproject.rvt`,
classic SVF) via Playwright. Full detail in `spike/FINDINGS.md`; the load-bearing results:

4. **The acceptance criterion is met.** `Bathtub-TOTO-Nexus-FBF794S` resolves to **Master Bath 207**
   — 907 of its 1003 world vertices classify inside that room, and **all 13 other rooms score
   exactly 0**. No ambiguity.
5. **`Autodesk.Viewing.Private.THREE` does not exist** — Viewer's THREE is the global `window.THREE`
   at **r71**. The spec said otherwise throughout; see Architecture for the corrected (and
   strengthened) isolation argument.
6. **The bracketed number in a display name is a Revit ElementId, not a dbId** — `[420270]` is
   dbId **2530**, and querying 420270 returns nothing. See `ViewerModelAdapter`.
7. **Rooms weld into perfect closed manifolds** (1 component, 0 boundary edges, 0 non-manifold
   edges). The precondition ray-parity containment depends on **holds for real room geometry** — the
   spec's biggest risk, resolved favourably.
8. **Source geometry does not, and that broke a round-6 rule.** The bathtub welds to 14 components
   with 441 boundary edges, so "flag any positive decided by an open component" would have fired on
   essentially every query. Corrected in `anyComponentInside`.
9. **Real SVF exercises none of the fallback machinery**: 100% of fragments took the `vb`/`vbstride`
   branch with `ib` indices; `groups`, `drawRange`, and `offsets` were absent everywhere. The
   primitive-range rules two review rounds were spent on are defensive code that reality never
   reaches in this format.

What remains unsettled is **B7 in `spike/FINDINGS.md`**: brute-force point-in-mesh with no BVH at all
resolved the entire acceptance query in **10.2ms**, because rooms are 12–64 triangles. The BLAS,
lazy build, sync-triangle ceiling, and cache-eviction machinery are justified for the general
clash-detection library the idea doc describes, but are not needed by the extension meant to prove
it. That is a scope decision to make deliberately rather than by momentum.

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

**Runtime split.** Two isolated THREE.js worlds, per the idea doc.

**Viewer's THREE is the global `window.THREE`, at revision 71.** Earlier drafts said
`Autodesk.Viewing.Private.THREE` throughout; the spike proved that path does not exist in Viewer
7.124.2 — reading it returns `undefined`. The correction makes isolation *more* critical, not less,
and for a sharper reason than the original text gave:

- The global is **already occupied by Viewer**. The rule is not "don't pollute a free global," it is
  "**don't clobber Viewer's r71 and break rendering**." A UMD/classic-script build of modern three
  would do exactly that, which is why only ESM is acceptable here.
- r71 against the pinned r185 is a ~114-revision gap, and `three-mesh-bvh@0.9.14` requires
  `three >= 0.159.0`. Sharing one runtime is not merely inadvisable — it is impossible. The
  two-runtime design is vindicated rather than merely cautious.

So: the collision library uses its own modern `three` + `three-mesh-bvh` loaded via import map, never
assigns to `window.THREE` / `globalThis.THREE`, and never patches Viewer THREE prototypes. The two
sides exchange only TypedArrays, plain numeric matrices, and packed bounds — never shared class
instances (`Mesh`, `Vector3`, `Matrix4`, `Box3`), which across a 114-revision gap would be
incompatible even where the class names match.

The acceptance test the idea doc proposed is still exactly right, with one correction: assert
`window.THREE.REVISION === '71'` before and after loading the collision runtime — *unchanged*, not
*absent*.

**Repo layout** (this is a single-app sandbox with no bundler — plain `<script type="module">`,
no monorepo):

```text
wwwroot/
├─ vendor/                          # self-hosted, npm-installed, copied here
│  ├─ three/build/three.module.js   #  + three.core.js, which it imports
│  └─ three-mesh-bvh/src/**         #  whole src tree — see note below
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

**Exact dependency pins** (a review pass asked for real versions rather than "pinned"; these were
checked against the npm registry rather than assumed):

| Package | Pin | Note |
|---|---|---|
| `three` | `0.185.1` | ESM entry `./build/three.module.js` |
| `three-mesh-bvh` | `0.9.14` | `peerDependencies: { three: ">= 0.159.0" }` — satisfied |

`0.9.14` was confirmed published against the registry directly (present in `versions`,
`dist-tags.latest`, published `2026-08-01`, tarball returns HTTP 200) after a review pass reported it
missing — the npmjs.com web UI can lag `registry.npmjs.org`. **Every upstream behavioral claim in
this spec is verified against the `v0.9.14` git tag specifically**, not `master`, since the two can
diverge and a spec that cites the wrong revision is worse than one that cites none.

**The vendor copy is not two files.** The earlier draft's `three-mesh-bvh/build/index.module.js`
does not exist: that package's `exports.import` is **`./src/index.js`**, a multi-file source tree
whose modules import each other by relative path and import `three` by bare specifier. `three`'s own
`build/three.module.js` likewise imports `./three.core.js`. So `scripts/sync-vendor.mjs`
(`npm run build:vendor`, no bundler — still just a copy step) must copy **directory trees**, not
single files, and the import map resolves the bare specifiers:

```json
{ "imports": {
  "three": "/vendor/three/build/three.module.js",
  "three-mesh-bvh": "/vendor/three-mesh-bvh/src/index.js"
} }
```

The bare `three` specifier inside three-mesh-bvh's own sources resolves through that same map — which
is exactly the mechanism that keeps it bound to the *collision* THREE and never to Viewer's.

## Components

**`ViewerModelAdapter`** — turns a `(model, dbId)` into the raw ingredients for a
`CollisionInstance`:
- Leaf fragments: `model.getInstanceTree().enumNodeFragments(dbId, cb, true)`. This is the real
  Viewer API — `getLeafFragIds` (used by the original gist) is not a built-in method, it's a
  community convention wrapping this call. `recursive: true` is required to cover assembly/parent
  dbIds, not just true leaf nodes — confirmed on the acceptance model, where the family node
  (dbId 2527) yields its child instance's fragment only with the flag set.
- **The bracketed number in a display name is a Revit ElementId, not a dbId.** The acceptance
  element `Bathtub-TOTO-Nexus-FBF794S [420270]` has **dbId 2530**; calling
  `enumNodeFragments(420270, …, true)` returns an empty array. The number users read off the Model
  Browser — and the one in this spec's own acceptance criterion — is not addressable by the fragment
  APIs. Any code path that accepts an element identifier from a human must resolve it (by name
  search or property lookup) rather than passing it straight through, or it will silently find
  nothing. This spike hit exactly that.
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

  Each source maps onto `TriangleGeometryView`'s `positionStride`/`positionOffset` explicitly —
  spelled out because a review pass noted the previous draft named the interleaved *array* without
  ever saying where the stride and offset came from, which is precisely the part that goes silently
  wrong (a plausible-looking wrong mapping yields garbage vertices, not an error):

  | Source | `positions` | `positionStride` | `positionOffset` |
  |---|---|---|---|
  | Viewer interleaved | `geometry.vb` | `geometry.vbstride` | `geometry.vblayout.position.offset` |
  | `InterleavedBufferAttribute` | `position.data.array` | `position.data.stride` | `position.offset` |
  | `BufferAttribute` | `position.array` | `position.itemSize` (3) | `0` |

  All three are in **float elements, not bytes** — matching Viewer's own `vbstride` convention — so a
  vertex `i`'s x-coordinate is always `positions[i * positionStride + positionOffset]`, whichever
  branch produced it. That single uniform accessor is the whole point of normalizing.
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
first use, over the **welded** collision geometry.

**Position is an owned welded buffer, not a zero-copy view of Viewer's.** This reverses the idea
doc's "prefer sharing the original Viewer position buffer / target: zero-copy" guidance, because
welding necessarily produces a new, deduplicated vertex array — and welding is what makes
connectivity, manifold classification, and therefore the containment guarantee work at all (see
above). The memory argument that motivated zero-copy does not survive measurement either: welding
*shrinks* geometry by ~23% on average across the primitives tested (box 24→8 vertices, cylinder
148→50), so an owned welded buffer is typically **smaller** than the shared one it replaces. Index is
likewise owned, produced by the weld. `indexOwnership: 'clone'` remains the only supported value, and
`'indirect'` is now not merely unimplemented but inapplicable — indirect mode exists to avoid
reordering a *shared* index, and there is no longer a shared index to protect. The private collision
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

**Every tolerance is defined in the frame it is applied in.** Round 4 defined one characteristic
length in "the classification frame" and then used it inside `classifyPoint`, which does its
proximity and ray work in the *target BVH's* local frame — comparing a length from one space against
distances in another. A review pass also showed the formula `min(diagonal(A), diagonal(B→A))` isn't
symmetric under swapping the operands, since `B→A` and `A→B` differ under non-uniform scale. Both
problems come from trying to make one scalar serve two frames, so this revision stops doing that:

- **Per-BVH tolerance scale.** Each `GeometryRecord` carries `L_X := diagonal(localBounds(X))`,
  computed once in X's own local space and cached with the BLAS. Any tolerance applied against X's
  BVH is scaled by `L_X`. `classifyPoint(point, targetBvh)` therefore uses the *target's* scale — the
  frame it is actually working in — with no conversion anywhere.
- **Canonical operand order.** `ProperCrossingQuery`'s probes and its `offsetLadder` necessarily live
  in one shared frame (the one `bvhcast` traverses). Rather than derive a "symmetric" scalar, the
  pair is **canonically ordered before evaluation** — sorted by `(modelId, geometryKey,
  instanceId)` — so the classification frame is a deterministic function of the pair, not of
  argument order. Swapping the caller's arguments now runs the identical computation, making
  symmetry structural rather than a property to be argued about. `L_canonical` is then simply
  `L_X` of whichever instance sorts first, and `minPenetrationDepth` is well-defined per pair.

| Tolerance | Units | Milestone 1 default | Applied in |
|---|---|---|---|
| `barycentricEpsilon` | dimensionless (0-1) | `1e-6` | Ray-hit edge/vertex rejection (frame-free) |
| `coplanarAngleEpsilon` | dimensionless (`1−\|n·n\|`) | `1e-6` | Coplanar pair detection (frame-free) |
| `mergeDistance` | distance in target frame | `1e-6 × L_target` | Collapsing coincident ray hits |
| `surfaceEpsilon` | distance in target frame | `1e-6 × L_target` | `boundary` classification |
| `offsetLadder` | distance in canonical frame | `[1e-3, 1e-4, 1e-5] × L_canonical` | `ProperCrossingQuery` probe steps |
| `witnessLadder` | distance in **source** frame | `[1e-3, 1e-4, 1e-5] × L_source` | Constructed interior witness (`anyComponentInside` stage 3) |
| `minPenetrationDepth` | distance in canonical frame | `1e-5 × L_canonical` | **Declared** detection limit |

**Anisotropic scale remains a stated limitation, not a solved problem.** When the relative transform
between two instances is anisotropic, no direction-independent scalar converts a length between the
frames — so `minPenetrationDepth`, defined in the canonical frame, corresponds to a *direction-
dependent* world-space depth, bounded by the smallest and largest singular values of the transform's
3×3 linear part. Milestone 1 declares this rather than pretending a single number covers it, and
pins the behavior with a swapped-operand anisotropic-scale test fixture. Absolute world-space
tolerances, model units, and global offsets remain an open question inherited from the idea doc's
"Tolerance" section.

`minPenetrationDepth` deserves emphasis because it is a **semantic** limit, not an implementation
detail: `volume-overlap` detects overlaps deeper than it, and may classify shallower ones as mere
touching. The previous draft had exactly this limit at a *thousand times coarser* value and did not
declare it at all — a review pass correctly identified that a fixed offset steps clean through any
overlap thinner than itself, producing a false negative in precisely the thin-geometry case
(perpendicular thin boxes) where no vertex-containment witness exists either. Making the offset
adaptive shrinks the blind spot; declaring `minPenetrationDepth` makes what remains of it honest.

### Solid model

Everything below depends on what a triangle soup is taken to *mean* as a solid. Six review rounds
specified parity, "any component," and "closed manifold" separately without ever reconciling them,
and a review pass showed the pieces disagreed: the composition implied one model, the primitive
implemented another. Milestone 1 declares the model once, here.

**A target geometry's interior is defined by even-odd (parity) over its entire triangle set.** A ray
from a point crosses an odd number of surfaces iff the point is inside. This is a deliberate choice,
not an accident of using `MeshBVH.raycast`:

- It is what makes **hollow solids correct**. A pipe is an outer cylinder plus an inner cylinder;
  its bore is not material. Under even-odd a point in the bore crosses both shells, reads `outside`,
  and the pipe is correctly hollow. Under union-of-components semantics the bore would fill with
  phantom material — and pipes are not an edge case in the MEP models this library exists to serve.
- The same argument covers containers, ducts, and any Revit family whose tessellation encodes a
  cavity as an inner shell.

**Its limitation, stated rather than discovered later:** two genuinely *nested independent solids*
inside one geometry (a small box floating inside a larger closed box, both material) read the inner
region as cavity, so a source there is classified `outside`. Even-odd cannot distinguish that from a
hollow container — no parity scheme can, because the two configurations have identical triangle
sets. Distinguishing them requires per-component classification plus an orientation/nesting analysis
that Milestone 1 does not attempt. In practice Model Derivative emits separate solids as separate
fragments far more often than as nested shells within one geometry, so this trades a common
correctness win (pipes) for a rare loss. A fixture pins the behavior so it can't drift silently.

**A source geometry contributes as the union of its components.** `anyComponentInside` returns true
if *any* component has material inside the target: distinct components are distinct pieces of the
same element, and one piece inside the target is an overlap. This is union semantics on the source
side and even-odd on the target side, and that asymmetry is intentional — the source is being asked
"is any of you in there," the target is being asked "what is your interior."

**Only closed components can establish positive volume.** An open shell has zero volume, so its
vertices being inside a target proves contact, not overlap. See `anyComponentInside` for how that is
reported.

**Vertex welding is a required normalization step, not an optional repair.** Earlier drafts deferred
"welding coincident vertices" to a future milestone as a possible improvement. The spike showed it is
a precondition for the design working at all: tessellators emit per-face vertices (a `BoxGeometry`
has 24 vertices for 8 corners, because each face carries its own normals and uvs), so index-based
connectivity on raw geometry splits **a plain box into 6 components with every edge a boundary
edge** — and a cylinder into 49. `closedManifold` would be false for every solid, and the containment
guarantee would never hold once. After welding, every closed primitive tested collapses to one closed
manifold component.

So `ViewerGeometryAdapter`'s output is welded before connectivity or BVH construction:
strip to **position + index only**, then merge vertices coincident within a position epsilon. The
strip must come first — `mergeVertices` compares all attributes, and per-face normals make every
vertex unique, so welding a full-attribute geometry silently does nothing. That makes the idea doc's
"do not copy rendering attributes" rule (written to save memory) **load-bearing for correctness**.

**`GeometryConnectivity`** (new) — decomposes the welded geometry into connected components by
union-find over triangles that share an **edge** (two vertex indices), restricted to the active
triangle ranges. Computed **once per unique `GeometryRecord`** and cached alongside the BLAS (not per
query, not per pair), so its cost amortizes exactly like BVH construction does. Building the edge map
also yields, for free, the manifold classification below.

Round 3 used *vertex*-sharing, which a review pass broke with a clean counterexample: two solids
joined at a single shared vertex merge into one component; if one sits inside the target and the
other outside — with only that measure-zero self-contact and no transverse crossing of the target's
boundary anywhere — then representatives drawn from the outside solid miss the contained one
entirely. Round 3's rebuttal ("they touch, so the contact query decides it") confused A touching
*itself* with A touching B; `ProperCrossingQuery(A, B)` never fires on A's internal self-contact.
Edge-connectivity does not merge vertex-joined solids, which removes that counterexample.

- Tessellated output often duplicates vertices at seams, so index-based connectivity can
  *over*-segment a visually-connected mesh. Conservative — more components means more sampling, never
  less correctness — but it inflates sample counts, which `maxContainmentSamples` caps.
- **Edge-connectivity narrows the under-segmentation hole but does not close it.** Two solids joined
  along a shared *edge* still merge, and the same construction defeats them. Rather than claim
  otherwise, `GeometryConnectivity` classifies each component while building the edge map:
  a component is **manifold** if every one of its edges is shared by exactly two triangles.
  Components with boundary edges (used once — an open shell) or non-manifold edges (used by three or
  more — the junction geometry that makes the counterexample possible) are flagged. That flag is what
  the containment guarantee below is conditioned on, and what gets reported when it doesn't hold.

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

1. Traverse with `MeshBVH.bvhcast(otherBvh, relativeMatrix, { intersectsTriangles(triA, triB) { … } })`.
   Returning `true` from the callback early-exits the traversal.

   **The callback receives *candidate* pairs, not intersecting ones.** Round 4 assumed otherwise and
   was wrong. Verified against `MeshBVH.js` at `v0.9.14`: the `intersectsTriangles` wrapper is a
   plain nested loop over every triangle in the two overlapping leaf ranges —

   ```js
   for ( let i2 = offset2, l2 = offset2 + count2; i2 < l2; i2 ++ ) { …
     for ( let i1 = offset1, l1 = offset1 + count1; i1 < l1; i1 ++ ) { …
       if ( intersectsTriangles( triangle1, triangle2, i1, i2, … ) ) return true;
   ```

   — with no intersection test anywhere. BVH traversal narrows to overlapping *leaf bounds*; deciding
   whether two triangles actually meet is the callback's job. Round 4 would have fed non-intersecting
   pairs into segment computation, where `intersectsTriangle` returns false and leaves `targetLine`
   holding the *previous* pair's endpoints — fabricating a crossing from stale state, which is both a
   false positive and a nondeterministic one.
2. **Classify the candidate before doing anything else**, ordered so the upstream coplanar warning
   path is never entered:
   - Compute the cheap coplanarity predicate from the triangles' own planes: coplanar iff
     `|nA · nB| ≥ 1 − coplanarAngleEpsilon` **and** the planes coincide within the target-frame
     `surfaceEpsilon`.
   - **Coplanar candidate** → call `triA.intersectsTriangle(triB)` **without** a target line. If it
     reports intersection, record a *touching contribution*; either way, continue to the next
     candidate. Omitting the target argument is what avoids the warning — upstream only warns when
     asked for an output edge it cannot produce.
   - **Non-coplanar candidate** → call `triA.intersectsTriangle(triB, targetLine)`. If it returns
     false, this pair simply doesn't intersect: continue, and **do not read `targetLine`**.

   Skipping coplanar pairs is the *correct* answer, not merely the safe one: if two solids' only
   contact is coplanar face overlap, that contact has zero volume and is touching by definition. If
   they also genuinely interpenetrate, the interpenetration necessarily produces non-coplanar
   intersecting pairs elsewhere, which this loop still examines. (Verified at `v0.9.14`: the coplanar
   branch of `ExtendedTriangle.intersectsTriangle` warns and sets `target.start`/`target.end` to the
   origin, so a coplanar pair could never have yielded a usable segment anyway.)
3. For a confirmed non-coplanar intersection, take the midpoint `M` of the now-valid `targetLine`.
4. Classify by stepping off the intersection curve into the four quadrants the two surfaces locally
   divide space into. For each sign combination `(s₁, s₂) ∈ {+1,−1}²` with `d = s₁·nA + s₂·nB`
   non-degenerate, and **for each rung `δ` of `offsetLadder` from coarsest to finest**, form a
   **probe point** `P = M + δ × normalize(d)`. (Called a *probe* rather than a candidate to keep it
   distinct from the candidate *pairs* of step 1.) The pair is a proper crossing iff some probe
   classifies as `inside` **both** A and B.
   - **The ladder is what makes thin overlaps detectable.** A single fixed offset steps clean through
     any overlap thinner than itself and reports a false negative — a review pass identified this,
     and it bites hardest on thin perpendicular geometry, where there is no vertex-containment
     witness to fall back on either. Trying successively finer rungs finds the overlap as long as it
     is deeper than the last rung, which is precisely the declared `minPenetrationDepth`.
   - Winding-independent: it never assumes outward-facing normals, only that the two normals span the
     local quadrants.
   - For a genuine transversal crossing (the duct-through-beam case), the surfaces divide space into
     four quadrants, one interior to both — classified as a crossing.
5. **Inconclusive probes propagate.** A probe whose classification against either solid is `boundary`
   (see `ContainmentQuery`) proves nothing — it can neither confirm nor refute a crossing. If a
   pair's probes are exhausted with no `inside`/`inside` result but at least one `boundary` result,
   that pair is **inconclusive**, not "touching." A negative overall result that had any inconclusive
   pair carries an `inconclusive-crossing` diagnostic, so it is never reported as verified.
6. Early-exit `true` on the first proper crossing. **Two independent budgets** bound the work, because
   the expensive failure mode isn't the one round 5 bounded:
   - `maxCrossingPairsExamined = 64` counts **confirmed intersecting non-coplanar pairs** — the ones
     that reach probe classification. Coplanar pairs don't consume it; they're decided, not deferred.
   - `maxCandidatePairsExamined = 50_000` counts **raw candidate pairs** entering the callback.
     Round 5 explicitly exempted these on the grounds that each costs "only a triangle-triangle
     test," which a review pass correctly rejected: two sub-`maxSyncTriangleCount` meshes with
     heavily overlapping leaves and **no intersections at all** never consume the confirmed-pair
     budget, so nothing bounded them. With `three-mesh-bvh`'s default leaf size, a dense overlap
     between two ~20k-triangle meshes reaches millions of pairs in one synchronous, uninterruptible
     `bvhcast` — seconds of frozen Viewer, and a direct contradiction of this spec's own claim that
     the budgets bound the worst case.

   **Abort protocol.** Exceeding either budget sets an `aborted` flag and returns `true` from
   `intersectsTriangles` — the only way to stop a `bvhcast` traversal early. `bvhcast` therefore
   returns `true`, which **must not be read as "crossing found"**: the caller checks the flag first
   and, when set, reports the pair as inconclusive with `crossing-budget-exhausted` rather than as a
   crossing. Getting this backwards would turn a timeout into a fabricated clash.

   Chunked or off-thread traversal is the real fix for large overlaps and is deliberately out of
   scope here (Workers are excluded from this milestone); the budget converts an unbounded freeze
   into a bounded one plus an honest diagnostic.

   **The budgets share one principle: no synchronous step should exceed roughly one frame (~16ms).**
   Earlier drafts picked each constant independently by reasoning; the spike measured them and they
   are now derived from that single rule, which is also what makes them reviewable:

   | Budget | Measured cost | Value | Blocking |
   |---|---|---|---|
   | `maxSyncTriangleCount` | ~16ms to build a BVH at 18k triangles | `20_000` | ~1 frame |
   | `maxCandidatePairsExamined` | ~0.3µs per candidate pair | `50_000` | ~15ms, ~1 frame |

   The previously-guessed `200_000` corresponds to ~53ms — three-plus dropped frames — which is why
   it drops to `50_000`. `maxSyncTriangleCount = 20_000` was a lucky guess and survives measurement
   unchanged.

**`ContainmentQuery`** — point classification against a mesh. It exposes **two layers**, and keeping
them distinct is what stops the design from being circular:

- `classifyPoint(point, targetBvh) → 'inside' | 'outside' | 'boundary'` — the low-level primitive.
  `ProperCrossingQuery` uses only this, on its own synthesized candidate points.
- `anyComponentInside(source, target)` — the per-component sampling wrapper below.
  `VolumeOverlapQuery` uses this, and only *after* `ProperCrossingQuery` has returned false.

So the guarantee below (which assumes no proper crossing) never depends on a result that depends on
it: the primitive has no such precondition, and only the wrapper does.

**`classifyPoint` is three-valued, and the `boundary` case is load-bearing.** Round 3's boolean
`isPointInside` had a defect a review pass correctly identified as undoing round 3's entire headline
fix: a point lying exactly *on* a target face produces a hit at distance ≈ 0 (raycasting starts at
`near = 0`), that hit sits in a face's *interior* so the barycentric edge/vertex rule doesn't reject
it, and parity therefore counts it — classifying a boundary point as `inside`. A box resting on
another box has its entire bottom face on the target's boundary, so pure face contact would have
come back out as `volume-overlap`, exactly the behavior round 3 existed to eliminate.

1. **Surface-proximity pre-check.** `MeshBVH.closestPointToPoint(point)`; if the distance is
   ≤ `surfaceEpsilon`, return `boundary` immediately. This both fixes the misclassification and
   guarantees the parity ray below cannot encounter a near-zero hit — the point is now known to be
   strictly off the surface, so the degenerate case simply cannot arise rather than needing to be
   special-cased after the fact.
2. **Parity test**, in the target BVH's own local space throughout:
   - Cast with `THREE.DoubleSide` explicitly. `MeshBVH.raycast` defaults to front-face-only, which
     silently breaks parity counting — a back-facing crossing wouldn't register.
   - Ray directions are **generic (non-axis-aligned) directions in the target BVH's local frame** —
     three of them, tried in order, e.g. `normalize(1, 0.3178, 0.1234)`, `normalize(0.2189, 1,
     0.4567)`, `normalize(0.4321, 0.1357, 1)`. Local-frame (not world) because a world axis would
     need transforming into the target's frame under any rotated or scaled instance transform.
     **Non-axis-aligned because the spike proved axis directions are pathological here**: a ray
     along local +X from a symmetric interior point of an axis-aligned box hits the exact centre of a
     face, which is exactly where the two triangles of that face meet, so the hit grazes their shared
     diagonal; +Y then does the same; both retries graze and the box's own centre returns `boundary`.
     BIM is largely axis-aligned boxes, so this failed on the very first fixture and would have
     failed pervasively in production. Directions with no rational relationship to each other or to
     the axes don't systematically align with mesh features.
   - **Sort hits by distance, then** collapse runs closer together than `mergeDistance` into a single
     crossing before counting parity. This handles genuinely coincident *surfaces* — duplicated
     triangles, double-sided wall geometry — where two distinct triangles are hit at the same
     distance. Sorting must precede merging; `MeshBVH.raycast` does not guarantee ordered hits.
   - A hit whose barycentric coordinates put it within `barycentricEpsilon` of a triangle edge or
     vertex is inconclusive *for that ray*: the ray has grazed a seam where the crossing count is
     unreliable. Retry the whole test once along the alternate local axis. If the retry also grazes,
     return `boundary` — the point is unresolved, and `boundary` is exactly the "cannot say" value.
   - Otherwise return `inside` for odd parity, `outside` for even — **even-odd across the target's
     entire triangle set**, which is the declared solid model (see **Solid model**), not an
     incidental consequence of how `MeshBVH.raycast` reports hits. A point inside two nested shells
     reads `outside`, which is correct for a hollow pipe and is the stated limitation for genuinely
     nested independent solids.

**`anyComponentInside` samples per connected component, not against a global cap.** Round 2's flat
"up to 64 points" had a false negative: an unsampled component of A could be contained in B while
every sampled component sits outside, with no diagnostic emitted. The fix isn't a bigger cap — it's
sampling the right decomposition:

> **The containment guarantee, and its preconditions.** `anyComponentInside` only decides the outcome
> after `ProperCrossingQuery` has returned false — i.e. no proper crossing exists. For a component
> that is a **closed manifold solid**, passing from B's interior to its exterior would require
> transversally crossing B's boundary, which *is* a proper crossing. So such a component is wholly
> inside or wholly outside (possibly with zero-volume boundary contact), and **one conclusive sample
> determines it exactly.** Covering every component then makes the containment step exact.
>
> **That guarantee is conditional, and round 3 stated it unconditionally — which was wrong.** A
> review pass supplied the counterexample: a component that is *not* a single manifold solid — two
> solids joined at a shared vertex or edge — can have one part inside B and the other outside, with
> no transverse crossing anywhere, so representatives drawn from the outside part miss the contained
> one. Edge-connectivity (see `GeometryConnectivity`) removes the shared-vertex form of this, but not
> the shared-edge form. The honest statement is therefore:
>
> - **closed manifold component** → the guarantee holds, exactly as argued above;
> - **non-manifold or open component** → sampling is best-effort, and the component is flagged.
>
> **Flagging follows whichever component decided the outcome, in either direction.** Round 5 emitted
> `non-manifold-component` only on *negative* results, which a review pass showed is backwards for
> the case that matters most: a single open triangle sitting inside a closed box has **zero volume**,
> so it cannot overlap anything — yet one of its vertices classifies `inside`, `anyComponentInside`
> returns true, and round 5 reported a *clean* clash with no diagnostic at all. Containment can
> establish positive volume only for a component certified closed (see **Solid model**). So:
>
> - a **positive** result whose deciding component encloses no volume emits
>   `unverified-open-component` — the containment is real, the *volume* overlap is not certified;
> - a **negative** result involving any flagged component emits `non-manifold-component`.
>
> **The positive rule is scoped to genuinely degenerate components, not merely open ones — the
> spike forced this correction.** Round 6 wrote "open or non-manifold," reasoning from a zero-volume
> single triangle. Measured against the acceptance model, the bathtub welds to 14 components with
> 441 boundary edges and 5 non-manifold edges: **real furniture is never a closed solid**, so that
> rule would have fired on virtually every query, making the diagnostic noise and training callers to
> ignore diagnostics altogether. A 441-boundary-edge bathtub is a nearly-closed solid, not a sheet.
>
> What actually matters is *which side* is open, a distinction round 6 missed entirely:
> - **target open** → ray parity is unreliable, because parity is evaluated against the target.
>   Serious; this is what `non-manifold-component` is for.
> - **source open** → parity is still evaluated against a closed target, so "is this point inside the
>   room" stays well-posed. Common, and benign for containment.
>
> Measured on the acceptance model: **every room welds to a perfect closed manifold** (1 component,
> 0 boundary edges, 0 non-manifold edges), so the side that must be closed is closed.
>
> The positive is still reported as true rather than suppressed. For the room-locator that is the
> useful answer — an open-shell fixture inside a room should be located in that room — and the
> diagnostic is what keeps the `volume-overlap` contract honest about what was actually proven.

**Finding a conclusive sample is the algorithm's job, not luck.** Round 4 stopped after 4 arbitrary
vertices, which a review pass showed does not deliver what the guarantee promises: a solid sitting
deep inside a room while sharing one coplanar face with it has no proper crossing, so it falls
through to containment — and if all 4 picks land on that shared face they all read `boundary`, and a
deep, unambiguous overlap comes back as a (diagnosed) non-overlap. "One conclusive sample decides the
component" is only a guarantee if the search actually pursues one. Three escalating stages, per
component:

1. **Spatially-spread vertex sampling.** Walk the component's referenced vertices on a stride
   (`ceil(n / samplesPerComponent)`, `samplesPerComponent = 8`) rather than taking the first few, so
   the initial picks can't all come from one face of a mesh whose vertices are stored face-by-face —
   the exact storage order that makes the counterexample above likely rather than exotic. Stop at the
   first `inside` or `outside`.
2. **Continue through the component.** If every strided pick reads `boundary`, keep walking the
   component's remaining vertices until one is conclusive or the component is exhausted. On a
   manifold component this is where the guarantee is actually discharged: `boundary` reads mean the
   sample sat on shared surface, and any vertex off that shared surface resolves it.
3. **Constructed interior witness.** If *every* vertex of the component reads `boundary` — possible
   when the component's entire surface is coincident with the target's — synthesize a point in the
   component's own interior instead of relying on its surface: take a triangle of the component, and
   from its centroid step along ±normal by each **`witnessLadder`** rung, keeping the first probe
   that `classifyPoint` puts `inside` **the component's own geometry**. That probe is interior to the
   source by construction, so classifying it against the target decides the component. Try up to
   `maxWitnessTriangles = 8` triangles before giving up.

   **`witnessLadder` is scaled by `L_source`, not `L_canonical`.** This stage constructs and
   validates points entirely in the *source component's* own local frame — the centroid, the normal
   step, and the `classifyPoint` call against the source's own BVH all live there. Round 5 reused
   `offsetLadder`, which is scaled by the canonical operand's `L`; when the source sorts second and
   the two local scales differ, its rungs are wrong in that frame — too coarse and the step exits the
   source entirely, too fine and it lands within the source's own `surfaceEpsilon` and reads
   `boundary` forever. Round 5 established the per-frame tolerance principle and then missed this
   instance of it; `witnessLadder = [1e-3, 1e-4, 1e-5] × L_source` applies it consistently.

Only if all three stages fail is the component unresolved, and a negative result with any unresolved
component emits `inconclusive-containment`. On a non-manifold-flagged component the same three stages
run, but no guarantee attaches to their result.

A global `maxContainmentSamples = 512` bounds pathologically over-segmented geometry; hitting it
emits `incomplete-component-coverage` so an unsampled-component negative is never reported as clean.

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
a witness point to find. Pure touching correctly returns **false** — it yields no proper crossing
(coplanar contact is classified, not crossed), and a solid resting on another's face classifies as
`boundary`/`outside`, never `inside`. Any unresolved component, inconclusive candidate, or truncated
examination turns a negative into a *diagnosed* negative rather than a clean one.

**Known limits, stated rather than implied.** `volume-overlap` is exact for closed manifold geometry
with overlaps deeper than `minPenetrationDepth`. It is best-effort, and says so via diagnostics, for:
non-manifold or open components; overlaps shallower than `minPenetrationDepth`; and geometry that
exhausts the examination budgets. Every one of these was a silent failure in an earlier draft; the
point of this milestone's diagnostics is that none of them is silent now.

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
     model-removal notification) so a stale room list can never outlive its model. **That same
     handler must also call `world.evictModel(model.id)`** — the room cache is not the only
     model-scoped state, and the previous draft evicted only it.
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

world.evictModel(modelId): void
// Drops everything keyed by that modelId: CollisionInstances, GeometryRecords, their reference
// counts, cached BLASes, cached connectivity, and any in-flight build promises (which reject).
// Required because all of that is keyed by (modelId, geometryIndex) — a review pass caught that
// the previous draft evicted only the extension's room-dbId cache on model removal, leaving the
// unloaded model's geometry and BVHs resident, and risking stale BLAS reuse if the Viewer ever
// recycles a model id. Must be called from the extension's model-removal handler, alongside
// dropping the room cache entry.

world.dispose(): void   // evicts every model and releases all cached state
```

```ts
class RoomLocatorExtension extends Autodesk.Viewing.Extension {
  constructor(viewer, options)      // options.roomCategoryName default 'Revit Rooms'
  async load()                      // constructs the CollisionWorld only; no room resolution here
                                     // (see Data Flow step 1) and no eager BLAS building
  unload()                          // world.dispose(), unregisters context menu + model-removal
                                     // listener, clears the per-model room cache
  // on model removal: world.evictModel(id) AND drop that id's room-cache entry
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
  | 'inconclusive-containment'        // unresolved (all-`boundary`) component(s) under a negative
  | 'incomplete-component-coverage'   // maxContainmentSamples hit before covering all components
  | 'inconclusive-crossing'           // a probe classified `boundary`, so touching wasn't provable
  | 'crossing-budget-exhausted'       // maxCandidatePairs/maxCrossingPairs hit; traversal aborted
  | 'non-manifold-component'          // NEGATIVE result involving a component the guarantee misses
  | 'unverified-open-component';      // POSITIVE result decided by an open/zero-volume component

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

**Diagnostics attach to positive results too, not only negatives.** Every earlier draft treated a
diagnostic as a caveat on "we found nothing," which left the one case where a *positive* is the
unsound answer — an open, zero-volume component classifying `inside` — reported as a clean clash.
A diagnostic marks any result whose soundness wasn't established, in whichever direction.

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
  `volume-overlap` is only strongly guaranteed for closed/manifold geometry — mitigated with the
  `surfaceEpsilon` boundary pre-check, `THREE.DoubleSide` raycasting, distance-sorted coincident-hit
  merging, `barycentricEpsilon` edge/vertex rejection, and a bounded retry on an alternate local axis
  (see `ContainmentQuery`). Unresolved components under a negative produce
  `inconclusive-containment` rather than a silent guess.
- **Non-manifold or open source components**: the containment guarantee doesn't cover them (see
  `anyComponentInside`), so a negative result involving one emits `non-manifold-component`. Sampling
  still runs — this degrades a verified negative to an unverified one, it doesn't skip work.
- **A positive decided by an open component**: emits `unverified-open-component`. An open shell has
  zero volume and so cannot overlap anything, but its vertices can classify `inside`; the result is
  still reported as a clash (useful for the room-locator) with its soundness explicitly qualified.
- **Traversal budget exhausted**: `crossing-budget-exhausted`, with the pair reported as inconclusive
  rather than as a crossing — the abort path returns `true` from `bvhcast` purely as a stop signal
  and must never be mistaken for a hit (see `ProperCrossingQuery`).
- **Overlaps shallower than `minPenetrationDepth`**: may classify as touching rather than overlap.
  This is a declared semantic limit of the mode (see Tolerances), not a diagnosed failure.
- **Truncated examination**: hitting `maxContainmentSamples` before covering every component, or
  `maxCrossingPairsExamined` before deciding, produces `incomplete-component-coverage` /
  `inconclusive-crossing` — a bounded search that finds nothing has not proven a negative.
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
- `ProperCrossingQuery` — tested directly rather than only through its caller:
  - **flush/coplanar touching faces only** — **not a crossing**, and the run must produce **no
    `console.warn` from `ExtendedTriangle`**. That warning is the tell that the coplanar branch was
    reached and a zeroed segment consumed; asserting on its absence is how this fixture proves the
    coplanar pre-split actually happens rather than the classification merely appearing to work.
  - edge-edge and vertex-face contact with no shared volume — not a crossing
  - **two long, thin boxes crossing perpendicularly mid-span** (a duct through a beam), thin enough
    that no vertex of either lies inside the other — **is a crossing**. Regression test for round 2's
    counterexample, which pure vertex sampling cannot detect at any sample count.
  - **a crossing whose overlap is thinner than the coarsest ladder rung but deeper than the finest**
    — must be detected. Regression test for round 3's fixed-offset blind spot, which stepped clean
    through thin overlaps; it is the fixture that justifies the ladder existing at all.
  - a crossing shallower than `minPenetrationDepth` — documented as *not* detected, pinning the
    declared limit so it can't silently drift.
  - a crossing between meshes with **inconsistent/inward-facing winding** — still a crossing,
    verifying the four-quadrant probe test doesn't depend on outward normals.
  - **two geometries whose BVH leaves overlap but whose triangles do not intersect** (e.g. two combs
    interleaved without touching) — must report no crossing. Regression test for round 4's assumption
    that a `bvhcast` callback implies an intersection; without the explicit per-candidate test this
    reads a stale `targetLine` and can fabricate a crossing. Run it *after* a fixture that populates
    `targetLine` with a real segment, so stale state would actually be present to be caught.
  - **swapped operand order under an anisotropic instance scale** — `crossing(A,B)` must equal
    `crossing(B,A)`. Verifies the canonical ordering makes symmetry structural, and is the fixture
    that would have caught round 4's non-symmetric `min(diagonal(A), diagonal(B→A))` scale.
  - **two meshes with heavily overlapping BVH leaves and zero triangle intersections**, sized so the
    candidate count exceeds `maxCandidatePairsExamined` — must abort and report
    `crossing-budget-exhausted`, **not** a crossing. Regression test for round 5's unbounded raw
    candidate loop, and specifically for the abort protocol: `bvhcast` returns `true` on abort, so a
    caller that reads that as a hit turns a timeout into a fabricated clash. Assert the query
    completes within a wall-clock bound as well as returning the right verdict.
- `ContainmentQuery.classifyPoint` — the three-valued primitive, tested on its own:
  - a point demonstrably inside / demonstrably outside — `inside` / `outside`
  - **a point lying exactly on the interior of a target face** — must return `boundary`, **not**
    `inside`. Direct regression test for the round-3 defect that would have re-promoted face contact
    to `volume-overlap`; assert it for several ray directions, since the old failure was
    direction-dependent.
  - a point on a target edge, and one on a target vertex — `boundary`
  - a mesh where the answer is only correct with `THREE.DoubleSide` (a thin shell whose back-facing
    crossings a front-face-only raycast would miss)
  - **two coincident duplicate triangles** with a ray through them — verifies hits are distance-sorted
    *then* merged so the duplicated surface counts as one crossing. (Note this fixture tests
    *coincident surfaces*, not a shared edge: a ray grazing a shared edge is rejected by
    `barycentricEpsilon` and retried on the alternate axis, so it never reaches the merge logic. An
    earlier draft asserted merge behavior on a shared-edge ray, which the algorithm can't reach —
    a genuine contradiction between spec and test.)
  - a target under a **non-uniform scale** instance transform — verifies scale-relative tolerances
    and local-frame ray directions behave, since this is exactly where a world-space epsilon or a
    world-axis ray direction would have gone wrong
  - **a point inside two nested closed shells** (concentric boxes) — must return `outside`, pinning
    the declared even-odd model. Pair it with a **pipe fixture** (annulus, point in the bore →
    `outside`) so the test suite records *why* even-odd was chosen, not merely that it was; and with
    a **nested independent solids** fixture asserting the same `outside` result as the documented
    limitation, so the tradeoff is visible in the tests rather than only in prose.
- `ContainmentQuery.anyComponentInside` — the sampling wrapper:
  - **a two-component geometry where only the smaller, second component lies inside the target** —
    must report contained. Regression test for the capped-sampling false negative: a
    connectivity-blind sampler can miss the small component, per-component coverage cannot.
  - **two solids joined at a single shared vertex, one inside the target and one outside** — must
    report contained. Regression test for round 3's broken exactness proof; with vertex-based
    union-find these merge into one component and the contained solid can be missed, with
    edge-connectivity they are separate components and it cannot.
  - **two solids joined along a shared edge, one inside and one outside** — the case
    edge-connectivity does *not* separate. Whatever the sampled result, the component must be flagged
    non-manifold and a negative must carry `non-manifold-component`. This fixture pins the honest
    limit rather than asserting a guarantee that doesn't hold.
  - **a closed solid deep inside the target while sharing one coplanar face with it** — must report
    contained. Regression test for round 4's fixed 4-sample cap: there is no proper crossing, so the
    result rests entirely on containment, and if sampling gives up while its picks sit on the shared
    face a deep overlap is reported as a diagnosed non-overlap. Build the fixture with its shared-face
    vertices **first in index order**, so a naive "first N vertices" pick provably fails it.
  - **a component every one of whose vertices lies on the target's surface** — exercises the
    constructed-interior-witness stage, which is the only stage that can resolve it.
  - **the same witness case with source and target at markedly different local scales, arranged so
    the source sorts second** in canonical order — must still resolve. Regression test for round 5's
    witness stage borrowing `offsetLadder`'s canonical-frame scale instead of `witnessLadder`'s
    source-frame one; with the wrong scale the ladder either exits the source or never leaves its
    `surfaceEpsilon`, and the case silently degrades to unresolved.
  - **a single open triangle placed entirely inside a closed box** — must report the containment as
    positive **and** carry `unverified-open-component`. Regression test for round 5's clean
    false-positive: a zero-volume component cannot overlap anything, so an undiagnosed `true` here
    is the one case where a positive result is the unsound one.
  - a geometry with **more than 8 active ranges** — verifies sample budgeting is coherent (an earlier
    draft's "up to 64 total" and "at least 8 per range" were arithmetically contradictory here)
  - a geometry that exhausts `maxContainmentSamples` — verifies `incomplete-component-coverage` is
    emitted rather than a clean negative
- `GeometryConnectivity`:
  - a mesh with duplicated seam vertices — over-segments into multiple components (conservative,
    accepted) rather than failing
  - closed manifold, open shell, and non-manifold (three-triangle edge) inputs — verifies the
    manifold flag that the containment guarantee is conditioned on
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
    layout the previous draft omitted entirely. Use a **stride greater than 3 with a nonzero position
    offset** (e.g. position+normal+uv interleaved, position at offset 3), so a mapping that ignores
    either field produces visibly wrong vertices instead of accidentally passing on a stride-3,
    offset-0 buffer where every plausible mapping agrees.
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
- ~~**How often is real Viewer geometry weldable into closed manifolds?**~~ **Answered by spike
  Part B, favourably for the side that matters.** Real SVF arrives as fully unwelded triangle soup
  (raw component count *equals* triangle count), and welding rescues it: every room tested welds to
  1 component with 0 boundary and 0 non-manifold edges. Since ray parity is evaluated against the
  *target*, and targets here are rooms, the precondition holds. Source geometry (the bathtub: 14
  components, 441 boundary edges) does not weld closed, but does not need to — see
  `anyComponentInside`. Residual risk is that this is **one model**; a federated or MEP-heavy model
  could differ, so the check is worth repeating rather than assuming settled.
- **Welding tolerance is unexamined.** The spike used `mergeVertices`'s default position epsilon on
  clean synthetic geometry. Real tessellation may have seams that are near-coincident rather than
  exactly coincident, where too tight an epsilon fails to weld (fragmenting components again) and too
  loose collapses genuinely distinct features. This is now a first-order parameter, not a detail.
- **Correctness work has accumulated real, unmeasured cost.** `closestPointToPoint` on every sample
  point, an offset ladder multiplying probe tests by up to 3×, a connectivity pass per geometry, a
  triangle-triangle test on every `bvhcast` candidate pair (not just intersecting ones — now known to
  be every pair in overlapping leaves), and containment sampling that may walk a whole component's
  vertices before falling back to constructed witnesses. Each was added to fix a real correctness
  defect and none is obviously expensive, but they compound, and there is still no benchmark suite.
  With `maxCandidatePairsExamined` added this round, the budgets do now bound the worst case — but
  note that claim was made in round 5 and was **false when written**: nothing capped the raw
  candidate loop, so a dense leaf overlap could run for seconds. Treat "the budgets bound it" as a
  property to re-verify whenever a new traversal is added, not as a standing invariant. The residual
  risk is *latency on realistic input*; measure before tuning any budget down.
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
- ~~Should `indexOwnership: 'indirect'` become the default once a benchmark suite exists?~~
  **Settled by the spike:** welding produces an owned index, so there is no shared Viewer index for
  indirect mode to protect. The option is inapplicable, not merely deferred.
- ~~Should non-manifold components attempt repair (welding coincident vertices)?~~ **Settled by the
  spike:** not optional — nothing works without it. Promoted to a required normalization step.
- Does cross-model geometry deduplication matter enough to prioritize once multi-model clash
  detection (a later milestone) is designed?
- Is even-odd the right solid model for real Viewer geometry? It is chosen for pipes/containers and
  costs correctness on nested independent solids (see **Solid model**). The assumption that Model
  Derivative emits separate solids as separate fragments rather than nested shells within one
  geometry is **reasoned, not measured** — check it against the acceptance URN, since if nested
  independent solids turn out to be common the tradeoff inverts.
- `maxSyncTriangleCount = 20_000` and `maxCandidatePairsExamined = 50_000` are now **measured**
  against the one-frame principle (see `ProperCrossingQuery`), not guessed. Remaining question is
  whether real rooms/fixtures routinely exceed the triangle ceiling — if they do, incremental or
  Worker construction becomes near-term rather than a future-milestone nicety.
- `samplesPerComponent = 8` (a stride divisor, not a cap — sampling continues past it),
  `maxWitnessTriangles = 8`, and `maxContainmentSamples = 512` remain provisional. None affects
  *coverage* correctness (component decomposition handles that) — they only bound pathological
  cases, and every truncation is observable via a diagnostic, so they're tunable from telemetry.
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
  `model.id`? Unconfirmed whether `model.id` is ever reused across distinct loads. `evictModel()`
  makes this survivable *if* the removal event always fires; the open question is whether it can be
  missed.
- Beyond welding, should components that are *still* non-manifold after it attempt further repair
  (hole filling, seam stitching)? Welding is now mandatory and handles the per-face-vertex case,
  which the spike showed is the dominant one; genuinely open shells are a separate and much smaller
  problem, deliberately left to the diagnostics for this milestone.
