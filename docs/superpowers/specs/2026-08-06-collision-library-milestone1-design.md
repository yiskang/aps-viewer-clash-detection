# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: revised after codex review (see `docs/superpowers/specs/review-coments.md`), pending user re-review
Date: 2026-08-06
Related: [`docs/ideas/aps-viewer-clash-detection-library-idea.md`](../../ideas/aps-viewer-clash-detection-library-idea.md)

## Revision Notes (post-review)

A review pass found 4 P1 and 3 P2 issues, all confirmed valid against this repo's own code and the
Viewer source. This revision addresses all of them while keeping the original design intent (thin
extension, `three-mesh-bvh` backend, lazy BLAS, same Milestone 1 boundaries):

- Room discovery moved from extension `load()` (before any model exists) to a lazily-built,
  per-model cache.
- The containment algorithm was replaced: the old two-step "surface-intersection-then-bbox-center"
  approach was both non-symmetric and capable of false positives/negatives. It's now a single,
  symmetric, geometry-derived sample-point containment test.
- The Viewer geometry adapter now explicitly normalizes primitive ranges (`groups`/`drawRange`),
  and the BLAS builder applies them.
- Cross-model queries are explicitly rejected in Milestone 1 rather than silently allowed with an
  undefined coordinate convention.
- `ClashResult.statistics` is always populated, and skipped fragments are now a structured
  diagnostic instead of a console warning only.
- BLAS construction is explicitly called out as synchronous/blocking, with an incremental
  yield-between-builds rule added.

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
│  │  └─ VolumeOverlapQuery.js
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

- Positions — primary path, confirmed universal across SVF/SVF2/OTG in Viewer 7.124.2:
  `geometry.vb` + `geometry.vbstride` + `geometry.vblayout.position.offset`, wrapped zero-copy into
  a library-side `InterleavedBuffer`/`InterleavedBufferAttribute` over the *same* TypedArray.
  Fallback path (legacy/non-LMV geometry only): `geometry.attributes.position.array`, stride 3.
- Index — `geometry.ib`, then `geometry.attributes.index.array`, then non-indexed
  (`vertexCount / 3` triangles).
- Ranges — if `geometry.groups` is present, map each `{start, count}` group into a `TriangleRange`
  (`baseVertex: 0`; `materialIndex` is dropped, it's not needed for collision). If absent, synthesize
  a single range covering the full index/vertex count — this exact fallback pattern
  (`geometry.groups || [{start: 0, count: indices.length, index: 0}]`) was directly observed in the
  shipped Viewer 7.124.2 source's own vertex-enumeration utilities, so it's a grounded default, not
  a guess. No `drawRange` field was observed on the Viewer's internal `LeanBufferGeometry` class in
  this version; if the fallback (non-LMV) path ever hands the adapter a real `THREE.BufferGeometry`
  with `drawRange` set, that must clip the synthesized range. No evidence of a distinct `baseVertex`
  concept exists in this Viewer version's geometry — default `baseVertex: 0` for every range, flagged
  as an open question if a legacy `offsets` layout turns up in real models during implementation.

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

**`VolumeOverlapQuery`** — the direct replacement for `ThreeBSP.intersect()`. The first version of
this spec used a two-step "surface-intersection, then bbox-center point test" approach that a
review pass correctly rejected on two counts: (1) `MeshBVH.intersectsGeometry` is a boolean
surface-crossing test — it does not distinguish proper crossing from face/edge/vertex *touching*,
so it would have silently promoted "the bathtub's rim is flush with the wall" to "volume overlap;"
and (2) a single bbox-center sample is not guaranteed to even lie inside the source's own solid (a
torus's bbox center sits in its hole, not its material), so it could both miss real off-center
containment and report overlap where none exists.

The replacement is a single, symmetric, geometry-derived sample-point containment test — no
surface-intersection step at all:

1. Take up to 64 sample points from **instance A's own vertex buffer** (all vertices if the mesh
   has fewer than 64, otherwise evenly strided across the vertex array — bounding the cost per
   query without needing benchmark-derived tuning yet). Each sample point is guaranteed to lie *on*
   A's actual surface, unlike a bbox-derived point.
2. Transform each sample point into B's local space via the pair's relative matrix, and test
   point-in-mesh containment against B's BVH using ray-casting parity (odd crossing count = inside).
   A point exactly on B's boundary (within `coplanarEpsilon`) counts as **not** overlapping — pure
   surface contact/touching is intentionally excluded from `volume-overlap` in Milestone 1, per the
   idea doc's own split between "overlap" and "touching."
3. If any sampled A-point lands inside B, report overlap and stop (early exit).
4. Otherwise repeat steps 1-3 with the roles reversed (sample B's vertices, test against A's BVH).
   This second direction is required for a symmetric definition and is what catches an element that
   is fully embedded in a room without any of its own vertices being useful witnesses (e.g. a small
   fixture whose vertices are all comfortably inside the room, tested directly against the room's
   BVH) as well as, in the general case, a small target fully inside a larger, non-convex source.
5. Overlap is true iff either direction found a contained point. If no fragments' vertices lend
   themselves to a decisive parity read (degenerate/self-intersecting geometry), record it as a
   skipped-fragment diagnostic (see Public API) rather than guessing.

This is deliberately *not* the same shortcut the original spec took: a straddling element (e.g. a
door spanning two rooms) is still caught correctly, because part of its own geometry's vertices are
spatially located inside the neighboring room — no separate surface-crossing check is needed to
detect that case. Disconnected sub-meshes within one fragment's geometry don't need special
handling either — the vertex sample is taken from the fragment's geometry as a whole regardless of
its topology; only the *target* side's watertightness matters for the ray-parity read to be
reliable.

**`CollisionWorld`** — the facade. Broad phase is a plain linear AABB scan over
`CollisionInstance.worldBounds` (no TLAS yet — candidate counts are small). Narrow phase calls
`VolumeOverlapQuery` per candidate pair.

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
   - **Narrow phase**: for each candidate pair, lazily get/build BLAS via `GeometryRegistry`/
     `BlasCache`, then run `VolumeOverlapQuery` with the pair's relative matrix. Because `MeshBVH`
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
`ClashStatistics` gains `skippedFragments: FragmentRef[]` — fragments that couldn't be normalized
(unsupported geometry layout) or gave an inconclusive containment read (see `VolumeOverlapQuery`
step 5), so a caller can tell "verified no clash" apart from "some fragments couldn't be tested."

**`findClashes` always resolves `{ pairs: ClashPair[], statistics: ClashStatistics }`**, never a
bare `{ pairs: [] }` — the earlier draft of this spec returned a statistics-less empty result for
the no-candidate-rooms case, which is inconsistent with the idea doc's `ClashResult` type (where
`statistics` is required) and would make it impossible to tell "zero rooms existed to check" apart
from "the query itself never ran." When there are no candidates, `statistics` is still returned with
its counters zeroed (`broadPhasePairs: 0`, etc.) rather than the field being omitted.

## Error Handling & Edge Cases

- **Unsupported geometry layout**: if the adapter can't detect a position/index source on a
  fragment, skip that fragment and record it in `statistics.skippedFragments` — not just a console
  warning, which would make an incomplete result indistinguishable from a verified no-clash one. The
  extension should surface a visible caveat (not silently report "no room found") when
  `skippedFragments` is non-empty for the queried element.
- **Non-watertight room geometry**: volume-overlap is only strongly guaranteed for closed/manifold
  geometry. The point-in-mesh raycast is the fragile part of `VolumeOverlapQuery` — mitigated with a
  `coplanarEpsilon` tolerance per sample point, and a retry with a second ray direction for any
  individual sample whose hit count is inconclusive (grazes an edge or coplanar face) before falling
  through to the next sample point.
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
- `VolumeOverlapQuery` against synthetic `BufferGeometry` fixtures:
  - box fully inside box, box straddling two boxes, separated boxes
  - an **L-shaped (non-convex) room** with an element in the concave notch — the case a bbox-only
    test gets wrong but real triangle-level containment gets right
  - a **torus with a small element centered in its hole** — must report *no* overlap; this is the
    exact false-positive the bbox-center approach in the earlier draft would have produced
  - an element **fully embedded off-center** in a large room, away from the room's own bbox center —
    must report overlap; this is the false-negative the earlier draft's single-sample-point approach
    would have produced
  - two meshes with **flush/coplanar touching faces only** (e.g. a box resting exactly on another
    box's top face, no interpenetration) — must report *no* overlap, verifying `volume-overlap` and
    mere surface contact stay distinct
  - a **door-like element straddling two room volumes** through a wall opening — must report overlap
    with both rooms, verifying the vertex-sampling approach still catches partial/straddling cases
    without a dedicated surface-crossing step
- `ViewerGeometryAdapter` against fixtures mimicking both the confirmed primary
  `vb`/`vbstride`/`vblayout` layout and the `attributes.position.array` fallback, **plus** fixtures
  for `geometry.groups` present vs. absent (verifying the single-synthesized-range fallback) and a
  `drawRange`-clipped fallback-path geometry — covering the primitive-range normalization the idea
  doc requires.

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

## Open Questions Deferred to Future Milestones

- Should the small-geometry brute-force fallback (from the idea doc) be added in this milestone or
  the next, once real room/fixture triangle counts are measured against the given URN?
- Should `indexOwnership: 'indirect'` become the default once a benchmark suite exists?
- Does cross-model geometry deduplication matter enough to prioritize once multi-model clash
  detection (a later milestone) is designed?
- Is a 64-sample-point cap in `VolumeOverlapQuery` the right default for typical room/fixture
  triangle counts, or should it scale with vertex count? No benchmark suite exists yet to answer
  this — flagged here rather than guessed at.
- What's an acceptable per-BLAS-build blocking budget before the small-geometry brute-force fallback
  or true incremental (multi-frame) construction becomes necessary, rather than the single-yield
  scheduling this milestone uses?
- When a model is reloaded with the same `model.id` (if that's possible in this Viewer version) but
  different content, does the per-model room cache need an explicit epoch/version key in addition to
  `model.id`? Unconfirmed whether `model.id` is ever reused across distinct loads.
