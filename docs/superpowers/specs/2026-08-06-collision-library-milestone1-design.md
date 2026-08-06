# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: revised after two rounds of codex review (see `docs/superpowers/specs/review-coments.md` and
`docs/superpowers/specs/review-comments-v2.md`), pending user re-review
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
│  │  └─ GeometryIdentity.js
│  ├─ blas/
│  │  ├─ ThreeMeshBvhBackend.js
│  │  └─ BlasCache.js
│  ├─ query/
│  │  ├─ SurfaceIntersectionQuery.js
│  │  └─ VolumeOverlapQuery.js      # composes SurfaceIntersectionQuery + containment sampling
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
`(modelId, geometryIndex)`, with a `referenceCount` and a lazy `accelerationPromise`. Cross-model
geometry sharing is out of scope for this milestone.

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
synchronously — `GeometryRegistry` marks it `unsupported-for-sync-build` and any pair touching it is
recorded as a `ClashDiagnostic` (`reason: 'geometry-too-large-for-sync-build'`, see Public API)
rather than risking a multi-hundred-millisecond freeze. This is a deliberate scope boundary, not a
solved problem — true incremental (multi-frame) or Worker-based construction for large geometries is
explicitly out of scope for Milestone 1 (see Milestone Scope), so oversized geometries degrade to
"can't verify this pair" rather than "block the UI." `20_000` is a provisional default reasoned from
typical `three-mesh-bvh` build costs, not a benchmarked figure — Model Derivative-tessellated Revit
rooms and fixtures are expected to be well under this in practice (to be confirmed against the given
URN during implementation), but the threshold itself should be revisited once real measurements
exist.

**`SurfaceIntersectionQuery`** — this mode was listed as included from the first draft but never
actually designed; a review pass correctly called that out. It's now precisely defined as:
`MeshBVH.intersectsGeometry(otherGeometry, relativeMatrix)` — a real, existing `three-mesh-bvh`
triangle-triangle intersection test, called directly, early-exiting on the first intersecting
triangle pair. Its semantics are exactly what that primitive provides: **true iff any triangle pair
from A and B has a non-empty geometric intersection**, including coincident/touching contact
(face-face, edge-edge, or vertex-face). Milestone 1 makes no attempt to distinguish genuine
crossing from mere touching *for this mode* — the idea doc itself lists "how should touching,
intersection, and coplanar overlap be defined" as an open, unresolved question
([idea:1709](../../ideas/aps-viewer-clash-detection-library-idea.md#L1709)), so Milestone 1
inherits that ambiguity explicitly and documents it (with a dedicated test fixture pinning the exact
behavior — see Testing) rather than pretending to resolve it.

**`VolumeOverlapQuery`** — the direct replacement for `ThreeBSP.intersect()`. Two review rounds
shaped this into its current form:

- **Round 1's mistake**: a two-step "surface-intersection, then bbox-center point test." Rejected
  because `MeshBVH.intersectsGeometry` conflated touching with overlap, and a single bbox-center
  sample isn't even guaranteed to lie inside the source's own solid (a torus's bbox center sits in
  its hole, not its material) — missing off-center containment and producing false positives.
- **Round 1's fix overcorrected**: dropping the surface-crossing check entirely and relying only on
  bidirectional vertex sampling. This reintroduced a different, worse false negative: two thin,
  perpendicular solids can share real positive volume — genuinely interpenetrate — while *neither
  solid's own vertices land inside the other* (e.g. a duct crossing through a beam mid-span, both
  thin enough that no corner of either object falls inside the other's volume). Vertex sampling
  alone can never catch this class of case, no matter how many points are sampled, because the
  overlap region isn't anywhere near either solid's vertices — it's bounded by *edges* crossing
  through the interior of the other solid's *faces*. This isn't a hypothetical: it's the idea doc's
  own first-listed benchmark scenario, "MEP models with many low-poly fragments."

`VolumeOverlapQuery` is now `SurfaceIntersectionQuery(A, B)` **OR** bidirectional containment
sampling — reusing the real triangle-triangle test for the crossing case (which correctly handles
the duct-through-beam scenario, since it tests actual triangle geometry across the whole surface,
not just vertices) instead of trying to reinvent one:

1. Run `SurfaceIntersectionQuery(A, B)`. If it reports a hit, `volume-overlap` is true — **this
   means Milestone 1's `volume-overlap`, like `surface-intersection`, does not distinguish crossing
   from mere touching** (a bathtub's base flush against a room's floor reports "overlap" with that
   room, which is the semantically correct outcome for containment purposes; the same coarse
   treatment could theoretically produce a false positive across a shared wall in an unusual
   pathological case — flagged as an open question below, bounded by the same idea-doc ambiguity
   `SurfaceIntersectionQuery` already inherits). This is a documented, tested Milestone 1 tradeoff,
   not an oversight.
2. If no crossing is found, fall through to bidirectional containment sampling — this is the part
   Round 1 got right and it's unchanged in substance, only clarified:
   - Take up to 64 sample points, but drawn from **the set of vertex indices actually referenced by
     A's active triangle ranges** (not the raw vertex buffer — a review pass correctly noted that
     sampling unreferenced vertices could pick "phantom" points that aren't part of the geometry
     being tested, given the range-normalization work above). The 64-point budget is spread with a
     minimum floor per active range (at least `min(8, rangeVertexCount)` samples per range) rather
     than one flat stride across all referenced vertices — this doesn't fully solve arbitrary
     disconnected-component coverage (that would need real mesh-connectivity/island analysis, out of
     scope here) but meaningfully reduces the risk of a small sub-part being skipped entirely when
     Viewer geometry commonly maps distinct parts to distinct ranges/groups.
   - Transform each sample point into B's local space and test point-in-mesh containment against
     B's BVH via ray-casting parity (odd crossing count = inside). Concretely, to actually be
     correct (a review pass flagged the prior draft as underspecified here):
     - Cast with `THREE.DoubleSide` explicitly — `MeshBVH.raycast` defaults to front-face-only,
       which silently breaks parity counting (a back-facing triangle crossing wouldn't register).
     - Deduplicate hits within `coplanarEpsilon` of each other by distance along the ray before
       counting parity, so a ray passing exactly through a shared edge between two adjacent
       triangles isn't double-counted.
     - A hit whose barycentric coordinates place it within `coplanarEpsilon` of a triangle's edge or
       vertex is inconclusive for that attempt; retry the same sample point with one alternate fixed
       ray direction (a different world axis than the first attempt), for at most 2 attempts total.
       If still inconclusive, exclude that sample point from the vote rather than guessing.
     - `coplanarEpsilon` is an absolute distance in Viewer world-space units (the same units
       `matrixWorld`-transformed geometry uses) with a Milestone 1 default of `1e-5`, consistent in
       order of magnitude with the idea doc's own `intersectionEpsilon: 1e-6` example. Real
       cross-model unit/scale calibration remains an open question inherited from the idea doc's own
       "Tolerance" section, unchanged by this milestone.
   - If any sampled A-point lands inside B, report overlap and stop (early exit).
3. If step 2 found nothing, repeat it with the roles reversed (sample B's vertices, test against
   A's BVH) — required for a symmetric definition, and what catches a small fixture fully embedded
   in a room without a decisive witness point from step 2's direction, or in general a small target
   fully inside a larger, non-convex source.
4. Overlap is true iff step 1 or either direction of steps 2-3 found a hit. If every sample point
   across both directions ended inconclusive (degenerate/self-intersecting geometry, or all retries
   exhausted), record a `ClashDiagnostic` (`reason: 'inconclusive-containment'`, see Public API)
   rather than guessing a boolean.

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
     `viewer.search(roomCategoryName, onSuccess, onError, ['Category'], { searchHidden: true })` and
     caches the resulting promise; later calls for the same `model.id` reuse it. The cache entry for
     a model is dropped when that model is unloaded (the extension listens for the Viewer's
     model-removal notification) so a stale room list can never outlive its model.
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
     `geometry-too-large-for-sync-build` diagnostic rather than building. Otherwise lazily get/build
     BLAS via `GeometryRegistry`/`BlasCache`, then run `VolumeOverlapQuery` (or
     `SurfaceIntersectionQuery` for that mode) with the pair's relative matrix. Because `MeshBVH`
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
//   ('touching' / 'clearance' deferred to a later milestone)
// query.groupBy: 'dbId'
//   ('fragment' / 'externalId' deferred)
// query.firstHitOnly?: boolean = false

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

A flat `skippedFragments: FragmentRef[]` (the first revision's fix) turned out to still lose
information a review pass correctly flagged as necessary: it can't say *why* a fragment was
skipped, nor which specific candidate pair an inconclusive containment read applies to (the same
source fragment can succeed against one room and be inconclusive against another). Milestone 1 uses:

```ts
interface ClashDiagnostic {
  reason: 'unsupported-geometry-layout' | 'rejected-primitive-range'
    | 'geometry-too-large-for-sync-build' | 'inconclusive-containment';
  sourceFragment: FragmentRef;
  // Fragment-level reasons ('unsupported-geometry-layout', 'rejected-primitive-range') are
  // discovered during geometry normalization, independent of any specific pairing, and leave
  // targetFragment absent — they apply to every pair sourceFragment would have participated in.
  // Pair-level reasons ('geometry-too-large-for-sync-build', 'inconclusive-containment') are
  // discovered during a specific pair's narrow-phase check and always set targetFragment, since
  // e.g. a fragment can be too large relative to one candidate's role in the check but the
  // limitation is only meaningful in the context of that specific pair.
  targetFragment?: FragmentRef;
}
```

**`findClashes` always resolves `{ pairs: ClashPair[], statistics: ClashStatistics }`**, never a
bare `{ pairs: [] }` — the earlier draft of this spec returned a statistics-less empty result for
the no-candidate-rooms case, which is inconsistent with the idea doc's `ClashResult` type (where
`statistics` is required) and would make it impossible to tell "zero rooms existed to check" apart
from "the query itself never ran." When there are no candidates, `statistics` is still returned with
its counters zeroed (`broadPhasePairs: 0`, etc.) rather than the field being omitted.

## Error Handling & Edge Cases

- **Unsupported geometry layout**: if the adapter can't detect a position/index source on a
  fragment, or the fragment uses a legacy `offsets` layout (explicitly rejected — see
  `ViewerGeometryAdapter`), skip that fragment and record a `ClashDiagnostic`
  (`reason: 'unsupported-geometry-layout'` or `'rejected-primitive-range'`) — not just a console
  warning, which would make an incomplete result indistinguishable from a verified no-clash one. The
  extension should surface a visible caveat (not silently report "no room found") when
  `statistics.diagnostics` is non-empty for the queried element.
- **Geometry too large to build synchronously**: a candidate pair whose geometry exceeds
  `maxSyncTriangleCount` (20,000 triangles) is skipped with a
  `geometry-too-large-for-sync-build` diagnostic rather than blocking the Viewer — see
  `ThreeMeshBvhBackend`/`BlasCache`.
- **Non-watertight room geometry**: volume-overlap is only strongly guaranteed for closed/manifold
  geometry. The point-in-mesh raycast is the fragile part of `VolumeOverlapQuery`'s containment
  fallback — mitigated with `THREE.DoubleSide` raycasting, coincident-hit deduplication, a
  `coplanarEpsilon` tolerance, and a bounded retry with an alternate ray direction per sample point
  (see `VolumeOverlapQuery` for the exact rule). A pair where every sample point stays inconclusive
  after retries is recorded as `inconclusive-containment` rather than guessing.
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
- `SurfaceIntersectionQuery` against synthetic `BufferGeometry` fixtures:
  - two clearly separated boxes — no intersection
  - two boxes with genuine interpenetration — intersects
  - **two meshes with flush/coplanar touching faces only** (a box resting exactly on another box's
    top face, no interpenetration) — **must report an intersection**. This looks counterintuitive
    but is the documented, intentional Milestone 1 behavior: `intersectsGeometry` doesn't distinguish
    touching from crossing, and the spec says so explicitly rather than silently. This fixture exists
    to pin that behavior down as tested and expected, not to leave it ambiguous.
- `VolumeOverlapQuery` against synthetic `BufferGeometry` fixtures:
  - box fully inside box, separated boxes — baseline sanity
  - an **L-shaped (non-convex) room** with an element in the concave notch — the case a bbox-only
    test gets wrong but real triangle-level containment gets right
  - a **torus with a small element centered in its hole** — must report *no* overlap; this is the
    false-positive a bbox-center approach would have produced (round 1's bug)
  - an element **fully embedded off-center** in a large room, away from the room's own bbox center —
    must report overlap; this is the false-negative a single-sample-point approach would have
    produced (round 1's bug)
  - a **door-like element straddling two room volumes** through a wall opening — must report overlap
    with both rooms
  - **two long, thin boxes crossing perpendicularly mid-span** (e.g. a duct through a beam), each
    thin enough that no vertex of either box lands inside the other — must report overlap. This is
    round 2's counterexample: pure vertex-sampling misses it entirely; the reinstated
    `SurfaceIntersectionQuery` step is what catches it. This fixture is the regression test for that
    specific bug.
  - a ray-parity correctness fixture using a mesh whose containment can only be read correctly with
    `THREE.DoubleSide` (e.g. a thin shell where a front-face-only raycast would miscount crossings) —
    verifies the containment fallback doesn't silently regress to front-face-only.
  - a fixture with two adjacent triangles sharing an edge, positioned so a containment ray passes
    exactly through that shared edge — verifies coincident-hit deduplication doesn't double-count the
    crossing and flip the parity result.
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
- **Touching-as-overlap could theoretically produce a false positive across a shared boundary**:
  because `volume-overlap` inherits `surface-intersection`'s coarse touching-inclusive semantics
  (see `VolumeOverlapQuery` step 1), an element whose surface is merely flush against — not actually
  crossing — a shared wall between two rooms could report overlap with the wrong room in an unusual
  case. This is the same idea-doc-level open question (`idea:1709`) both query modes already inherit
  explicitly, not a new gap, but it's worth calling out as a concrete risk rather than only an
  abstract one: the room-locator acceptance scenario should be checked for this specifically if the
  bathtub's geometry happens to touch a shared wall.
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
- Is a 64-sample-point cap (with the per-range minimum floor) in `VolumeOverlapQuery`'s containment
  fallback the right default for typical room/fixture triangle counts, or should it scale with
  vertex count? No benchmark suite exists yet to answer this — flagged here rather than guessed at.
- Is `maxSyncTriangleCount = 20,000` the right threshold before a geometry is skipped rather than
  built synchronously? It's a provisional default, not a benchmarked one (see
  `ThreeMeshBvhBackend`/`BlasCache`) — needs real measurement against the given URN and, if rooms or
  fixtures routinely exceed it, either a higher threshold or real incremental/Worker construction
  becomes a near-term (not indefinitely deferred) need rather than a future-milestone nicety.
- Does the per-range minimum-sample floor meaningfully reduce missed disconnected sub-parts in
  practice, or does real mesh-connectivity/island analysis end up necessary anyway once tested
  against multi-part family instances?
- Should `surface-intersection` and `volume-overlap`'s shared touching-inclusive behavior be split
  into a real crossing-vs-touching classifier in a future milestone, once the idea doc's own open
  question (`idea:1709`) about coplanar semantics is resolved at the architecture level, rather than
  each Milestone-1-scoped mode continuing to inherit that ambiguity independently?
- When a model is reloaded with the same `model.id` (if that's possible in this Viewer version) but
  different content, does the per-model room cache need an explicit epoch/version key in addition to
  `model.id`? Unconfirmed whether `model.id` is ever reused across distinct loads.
