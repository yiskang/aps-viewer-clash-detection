# Collision Library — Milestone 1: Core Slice + RoomLocatorExtension

Status: approved design, pending spec review
Date: 2026-08-06
Related: [`docs/ideas/aps-viewer-clash-detection-library-idea.md`](../../ideas/aps-viewer-clash-detection-library-idea.md)

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
the idea doc's `TriangleGeometryView`. Primary path, confirmed universal across SVF/SVF2/OTG in
Viewer 7.124.2: `geometry.vb` + `geometry.vbstride` + `geometry.vblayout.position.offset`, wrapped
zero-copy into a library-side `InterleavedBuffer`/`InterleavedBufferAttribute` over the *same*
TypedArray. Fallback path (legacy/non-LMV geometry only): `geometry.attributes.position.array`,
stride 3. Index: `geometry.ib`, then `geometry.attributes.index.array`, then non-indexed
(`vertexCount / 3` triangles). The adapter still does runtime capability detection rather than
hard-coding the primary path — the research just tells us which branch fires in practice for this
Viewer version.

**`GeometryRegistry` / `GeometryIdentity`** — one `GeometryRecord` per unique
`(modelId, geometryIndex)`, with a `referenceCount` and a lazy `accelerationPromise`. Cross-model
geometry sharing is out of scope for this milestone.

**`ThreeMeshBvhBackend` / `BlasCache`** — builds one `MeshBVH` per `GeometryRecord`, lazily, on
first use. Position: shared/zero-copy interleaved buffer. Index: **cloned**
(`viewerIndex.slice()`), not indirect — the idea doc's own first-version recommendation, simplest
to reason about without a benchmark suite yet to justify indirect mode. `BlasCache` dedupes
concurrent build requests via `accelerationPromise` so two simultaneous queries never build the
same BVH twice.

**`VolumeOverlapQuery`** — the direct replacement for `ThreeBSP.intersect()`. Given the relative
matrix between two instances:
1. Surface-intersection check via `MeshBVH.intersectsGeometry` (BVH-vs-BVH triangle overlap,
   early-exit on first hit). If surfaces cross, overlap = true. This catches elements that straddle
   two rooms (e.g. a door spanning a wall).
2. If no surfaces cross, a single point-in-mesh containment test (ray-casting parity from the
   element's bbox center against the room's BVH) distinguishes "fully inside" from "fully outside."
   This is the common case — furniture/fixtures sitting entirely within one room's volume.

This mirrors what the original CSG `intersect()` was actually detecting, without polygon splitting
or BSP tree construction.

**`CollisionWorld`** — the facade. Broad phase is a plain linear AABB scan over
`CollisionInstance.worldBounds` (no TLAS yet — candidate counts are small). Narrow phase calls
`VolumeOverlapQuery` per candidate pair.

## Data Flow — Room Locate Query

1. On `load()`, the extension resolves room dbIds once via
   `viewer.search(roomCategoryName, onSuccess, onError, ['Category'], { searchHidden: true })`
   (default `roomCategoryName: 'Revit Rooms'`), cached for the extension's lifetime.
2. On a locate request: `world.findClashes({ source: { model, dbIds: [dbId] }, target: { model,
   dbIds: roomDbIds }, mode: 'volume-overlap', groupBy: 'dbId' })`.
3. Inside `CollisionWorld.findClashes`:
   - Build/get `CollisionInstance`s for the source dbId and every target room dbId via
     `ViewerModelAdapter` (one instance per fragment — either side may have more than one fragment).
   - **Broad phase**: linear AABB scan of source instances against target instances.
   - **Narrow phase**: for each candidate pair, lazily get/build BLAS via `GeometryRegistry`/
     `BlasCache`, then run `VolumeOverlapQuery` with the pair's relative matrix.
   - Aggregate fragment-pair hits into dbId-level `ClashPair`s (`groupBy: 'dbId'`), deduping so a
     room with multiple fragments isn't reported twice.
4. The extension maps `result.pairs[].target.dbId` back to room dbIds and returns them — the same
   return contract as the original `locateElementByRoom(dbId)`.

## Public API

```ts
CollisionWorld.fromViewer(viewer, options): Promise<CollisionWorld>
// options: { model?, narrowPhase: 'three-mesh-bvh', indexOwnership: 'clone' }
// both narrowPhase and indexOwnership are fixed in Milestone 1 — one backend, one strategy

world.findClashes(query): Promise<ClashResult>
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
  async load()                      // resolves room dbIds; does NOT eagerly build any BLAS
  unload()                          // world.dispose(), unregisters context menu callback
  async locateElementByRoom(dbId): Promise<number[]>
  onContextMenu(menu, status)       // adds "Locate Room" item, same UX as the original extension
}
```

`ClashPair`, `ClashResult`, `ClashStatistics`, `ElementRef`, `FragmentRef` reuse the shapes already
defined in the idea doc's "Proposed Types" section — no new types introduced for this milestone.

## Error Handling & Edge Cases

- **Unsupported geometry layout**: if the adapter can't detect a position/index source on a
  fragment, skip that fragment with a logged warning rather than failing the whole query.
- **Non-watertight room geometry**: volume-overlap is only strongly guaranteed for closed/manifold
  geometry. The point-in-mesh raycast is the fragile part — mitigated with a `coplanarEpsilon`
  tolerance, and a retry with a second ray direction if the first hit count is inconclusive
  (grazes an edge or coplanar face).
- **No candidate rooms** (empty search result, or wrong category name): `findClashes` returns
  `{ pairs: [] }`; the extension surfaces "No rooms found" rather than throwing.
- **Element with no fragments** (fully hidden/suppressed dbId): return `[]` early, no BLAS work
  attempted.
- **Invalid dbId**: reject with a clear error rather than silently returning empty.
- **Stacked/overlapping-bbox rooms** (e.g. double-height spaces): handled correctly by
  construction — broad phase may pass multiple bbox candidates through, but narrow-phase
  volume-overlap resolves the true containing room via actual triangle-level testing.
- **Disposal mid-query**: if `unload()`/`world.dispose()` fires while a query is in flight,
  in-flight promises reject cleanly. Full cancellation tokens are out of scope for this milestone.

## Testing & Verification

**Unit tests** (pure geometry, no Viewer needed):
- `VolumeOverlapQuery` against synthetic `BufferGeometry` fixtures: box fully inside box, box
  straddling two boxes, separated boxes, a coplanar-face edge case, and an **L-shaped (non-convex)
  room** with an element in the concave notch — the case a bbox-only test gets wrong but real
  triangle-level containment gets right.
- `ViewerGeometryAdapter` against fixtures mimicking both the confirmed primary
  `vb`/`vbstride`/`vblayout` layout and the `attributes.position.array` fallback.

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

## Open Questions Deferred to Future Milestones

- Should the small-geometry brute-force fallback (from the idea doc) be added in this milestone or
  the next, once real room/fixture triangle counts are measured against the given URN?
- Should `indexOwnership: 'indirect'` become the default once a benchmark suite exists?
- Does cross-model geometry deduplication matter enough to prioritize once multi-model clash
  detection (a later milestone) is designed?
