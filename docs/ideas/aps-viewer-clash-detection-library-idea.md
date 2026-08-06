# APS Viewer High-Performance Geometry Clash Detection Library Concept

## Purpose

Build a high-performance geometry clash detection library that runs on the client side in APS Viewer and supports:

- model-to-model clash detection
- category-to-category clash detection
- selection-to-model collision queries
- element-to-element intersection tests
- touching and tolerance-based contact detection
- clearance and soft-clash detection

The library should focus on spatial queries and collision detection. It should not perform full CSG Boolean operations or generate Boolean intersection geometry.

This document is an architectural concept and technical direction draft. It is intended to be handed to Codex or Claude for expansion into:

- a detailed technical specification
- an implementation plan
- module design
- milestone breakdown
- test plan
- benchmark plan

---

## Background and Problem

A previous approach used `three-csg` to detect collisions between Viewer geometries. Its efficiency and performance are not suitable for a production clash detection engine.

CSG typically has to handle:

- polygon splitting
- BSP or other spatial classification
- inside/outside classification
- topology reconstruction
- Boolean result geometry generation
- vertex and face rebuilding

Most clash detection use cases only need to answer:

```ts
doMeshesIntersect(a, b): boolean
```

or:

```ts
findClashPairs(source, target): ClashPair[]
```

CSG therefore solves a much larger problem than required, resulting in unreasonable initialization cost, memory usage, and execution time.

The new library should treat collision and distance queries as first-class operations instead of using geometric Boolean operations to indirectly prove that a clash exists.

---

## Core Design Direction

Use a two-level acceleration structure:

```text
APS Viewer models
  │
  ├─ TLAS
  │    Top-Level Acceleration Structure
  │    leaf = fragment instance / collision instance
  │
  └─ BLAS cache
       Bottom-Level Acceleration Structure
       leaf = triangles of one unique geometry
```

Overall flow:

```text
Viewer model
  ↓
ViewerGeometryAdapter
  ↓
Normalized triangle geometry
  ↓
Unique geometry deduplication
  ↓
BLAS cache
  ↓
Collision instances
  ↓
TLAS
  ↓
TLAS-vs-TLAS broad-phase traversal
  ↓
Candidate fragment pairs
  ↓
BLAS-vs-BLAS narrow-phase traversal
  ↓
Triangle intersection / distance test
  ↓
fragId pair aggregation
  ↓
dbId / externalId clash results
```

---

## Design Principles

### Do Not Depend on CSG

The library should not:

- perform union, subtraction, or intersection Boolean operations
- generate an intersection solid
- rebuild mesh topology
- use a BSP tree as the primary collision algorithm

### Do Not Assume a Fixed Viewer Geometry Layout

The implementation must not assume that every geometry always contains:

```js
geometry.vb
geometry.vbstride
geometry.ib
```

Viewer geometry may be represented as:

- Viewer-internal interleaved geometry
- `BufferGeometry.attributes.position`
- `InterleavedBufferAttribute`
- `geometry.index`
- `geometry.attributes.index`
- non-indexed geometry
- geometry with `drawRange`
- geometry with legacy `offsets`
- geometry with primitive ranges
- other Viewer-internal layouts

The adapter must therefore use capability detection and normalization.

### Isolate Viewer Internals

All Viewer private APIs and undocumented geometry layouts must be isolated inside adapters.

The collision core must not directly depend on:

- Viewer `Mesh`
- Viewer `Vector3`
- Viewer `Matrix4`
- Viewer internal BVH node layouts
- Viewer private rendering structures

The collision core should receive only:

- TypedArrays
- numeric matrices
- bounds
- instance metadata
- normalized triangle ranges

### Build BLAS per Unique Geometry

Do not build a triangle BVH for each `fragId`.

Multiple fragments can reference the same geometry. The correct relationship is:

```text
geometryKey → one BLAS
fragId      → one instance transform
```

### Separate TLAS and BLAS

- BLAS describes the triangle hierarchy of one unique geometry.
- TLAS describes the world-space bounds and transform of every fragment instance in the scene.

This separation enables:

- geometry instancing
- multi-model clash detection
- transform updates
- partial rebuilds
- geometry caching
- serialization
- Worker support

---

## Viewer Geometry Adapter

### Purpose

Convert Viewer geometry into a normalized triangle geometry view that can be consumed by the collision backend.

### Proposed Output Format

```ts
interface TriangleRange {
  start: number;
  count: number;
  baseVertex: number;
}

interface TriangleGeometryView {
  positions: ArrayBufferView;

  positionStride: number;
  positionOffset: number;

  indices:
    | Uint8Array
    | Uint16Array
    | Uint32Array
    | null;

  ranges: TriangleRange[];

  vertexCount: number;
  triangleCount: number;
}
```

### Geometry Layouts the Adapter Should Support

#### Viewer-Internal Interleaved Buffer

The geometry may contain:

```js
geometry.vb
geometry.vbstride
```

These fields must not be treated as a stable public contract.

#### Standard BufferAttribute

```js
geometry.attributes.position.array
geometry.attributes.position.itemSize
```

#### InterleavedBufferAttribute

```js
geometry.attributes.position.data.array
geometry.attributes.position.data.stride
geometry.attributes.position.offset
```

#### Indexed Geometry

The index may come from:

```js
geometry.index.array
geometry.attributes.index.array
geometry.ib
```

#### Non-Indexed Geometry

When no index exists, each group of three position entries should be interpreted as one triangle, subject to the active range.

#### Draw Range and Primitive Ranges

The adapter must correctly process:

```js
geometry.drawRange
geometry.offsets
geometry.groups
```

Collision geometry should not preserve rendering material groups unless they are necessary to represent valid primitive ranges.

### Adapter Responsibilities

- locate the position buffer
- detect packed or interleaved position layout
- locate the index buffer
- handle non-indexed geometry
- handle draw ranges, offsets, and primitive ranges
- calculate triangle count
- reject unsupported primitive types with clear errors
- normalize geometry metadata
- never modify Viewer-owned buffers

---

## Geometry Identity and Deduplication

### Purpose

Ensure that the same Viewer geometry produces only one BLAS.

### Proposed Data Structure

```ts
type GeometryKey = string | number;

interface GeometryRecord {
  key: GeometryKey;

  source: TriangleGeometryView;

  collisionGeometry?: CollisionGeometry;
  acceleration?: GeometryAcceleration;

  triangleCount: number;
  referenceCount: number;
}
```

### Possible Geometry Key Sources

The detailed specification must investigate and select a reliable approach, such as:

- Viewer geometry ID
- render-proxy geometry identity
- geometry object identity
- model ID plus geometry ID
- stable geometry hash
- a `WeakMap`-based fallback identity

The implementation must account for the possibility that geometry IDs are only unique within one model.

---

## Collision Instance

A TLAS leaf should represent a fragment instance rather than only a `dbId`.

```ts
interface CollisionInstance {
  instanceId: number;

  modelId: number | string;
  dbId: number;
  fragId: number;

  geometryKey: GeometryKey;

  matrixWorld: Float32Array;
  inverseMatrixWorld?: Float32Array;

  worldBounds: Float32Array;

  metadata?: Record<string, unknown>;
}
```

### Why `dbId` Alone Is Not Sufficient

- One `dbId` may contain multiple fragments.
- Different fragments may reference different geometries.
- Different fragments may have different transforms.
- Exact narrow-phase processing still operates on fragment pairs.

Fragment-pair results should be aggregated into element-level `dbId` pairs only after narrow-phase processing.

---

## BLAS: Geometry Acceleration

### First-Version Backend

The first version should use:

```text
three-mesh-bvh
```

as the triangle-level narrow-phase backend.

Reasons include:

- mature triangle BVH implementation
- BVH traversal support
- `bvhcast`
- `shapecast`
- `intersectsGeometry`
- serialization support
- existing handling of many triangle-query details
- lower implementation risk while validating the architecture and API

### Do Not Modify Viewer Geometry Directly

Do not do this:

```js
viewerGeometry.boundsTree =
  new MeshBVH(viewerGeometry);
```

Instead, create a private collision-geometry wrapper owned by the library.

### Isolate the Three.js Runtime

The THREE runtime bundled with APS Viewer may not be compatible with the current version required by `three-mesh-bvh`.

Use this separation:

```text
Viewer THREE
  └─ rendering

Library THREE
  └─ collision BufferGeometry and MeshBVH
```

The runtimes should exchange only:

- TypedArrays
- numeric matrices
- primitive metadata

They should not exchange:

- `Mesh` instances
- `Vector3` instances
- `Matrix4` instances
- `Box3` instances

---

## Browser ESM Loading and Global THREE Isolation

### Goal

Load a modern Three.js version and `three-mesh-bvh` in an APS Viewer page without replacing or polluting the THREE runtime used by Viewer.

Recommended mechanisms:

- native browser ES Modules
- dynamic `import()`
- import maps
- pinned, self-hosted module files

### Recommended Loading Method

```html
<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/build/three.module.js",
    "three-mesh-bvh": "/vendor/three-mesh-bvh/build/index.module.js",
    "@your-scope/aps-clash": "/vendor/aps-clash/index.js"
  }
}
</script>
```

The collision library or Viewer extension can then use:

```ts
const CollisionTHREE = await import("three");

const {
  MeshBVH
} = await import("three-mesh-bvh");
```

Viewer continues to use its own THREE runtime:

```ts
const ViewerTHREE =
  Autodesk.Viewing.Private.THREE;
```

Treat the two runtimes as fully separate:

```text
APS Viewer THREE
  └─ Viewer rendering

Collision THREE
  ├─ collision BufferGeometry
  ├─ Matrix4 / Box3 / Triangle
  └─ three-mesh-bvh
```

### Native ESM Does Not Automatically Pollute Global Scope

A Three.js module namespace loaded through ESM does not automatically assign itself to:

```ts
window.THREE
globalThis.THREE
Autodesk.Viewing.Private.THREE
```

The library must not explicitly do this:

```ts
window.THREE = CollisionTHREE;
globalThis.THREE = CollisionTHREE;
```

It should also avoid legacy global or UMD builds that create `window.THREE`, such as:

```html
<script src="three.min.js"></script>
```

### Do Not Patch Viewer THREE Prototypes

Do not install `three-mesh-bvh` prototype extensions on Viewer THREE classes.

Forbidden:

```ts
ViewerTHREE.BufferGeometry.prototype.computeBoundsTree =
  computeBoundsTree;

ViewerTHREE.BufferGeometry.prototype.disposeBoundsTree =
  disposeBoundsTree;

ViewerTHREE.Mesh.prototype.raycast =
  acceleratedRaycast;
```

The collision engine should create private `MeshBVH` instances directly:

```ts
const bvh = new MeshBVH(
  collisionGeometry,
  {
    indirect: true
  }
);
```

The collision library does not need to replace Viewer’s raycast pipeline.

### Do Not Mix Class Instances Across Runtimes

Even when the APIs have the same names, class identities differ.

For example:

```ts
viewerMatrix instanceof CollisionTHREE.Matrix4;
// false
```

Do not pass Viewer class instances into APIs that depend on modern Three.js class identity.

At the runtime boundary, exchange only:

- TypedArrays
- plain number arrays
- matrix elements
- bound values
- primitive metadata

Copy matrix values explicitly:

```ts
const collisionMatrix =
  new CollisionTHREE.Matrix4()
    .fromArray(viewerMatrix.elements);
```

Bounds should preferably use a packed numeric representation:

```ts
const bounds = new Float32Array([
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ
]);
```

### Import Maps and Dependency Resolution

Browsers cannot resolve bare module specifiers such as:

```ts
import "three";
import "three-mesh-bvh";
```

without an import map or bundler.

The deployment must ensure that:

1. The collision library and `three-mesh-bvh` resolve to the same modern Three.js module.
2. The collision side does not load multiple incompatible Three.js versions.
3. Viewer’s built-in THREE is never mapped as the npm `three` dependency.
4. The import map is registered before the first module import.
5. Three.js and `three-mesh-bvh` versions are pinned and compatibility-tested.

### Recommended Deployment

Self-host the runtime dependencies in production:

```text
/vendor/
├─ three/
│  └─ build/
│     └─ three.module.js
├─ three-mesh-bvh/
│  └─ build/
│     └─ index.module.js
└─ aps-clash/
   └─ index.js
```

Production runtime should not depend on an uncontrolled public CDN because of:

- Content Security Policy restrictions
- enterprise intranet restrictions
- CDN availability
- supply-chain review requirements
- version drift
- offline deployment
- uncontrollable cache policies

### Runtime Loader

Dependency loading should be centralized so that multiple extensions do not initialize separate runtimes.

```ts
let runtimePromise:
  | Promise<CollisionRuntime>
  | undefined;

export function loadCollisionRuntime():
  Promise<CollisionRuntime> {
  runtimePromise ??=
    Promise.all([
      import("three"),
      import("three-mesh-bvh")
    ]).then(([THREE, BVH]) => ({
      THREE,
      MeshBVH: BVH.MeshBVH
    }));

  return runtimePromise;
}
```

Browsers cache ESM by module URL, while the shared promise also prevents:

- repeated initialization
- race conditions
- simultaneous loading by multiple extensions
- inconsistent dependency state

### Acceptance Criteria

Integration tests must verify that:

```ts
window.THREE
```

remains unchanged before and after loading the collision library.

They must also verify that:

```ts
Autodesk.Viewing.Private.THREE
```

has not had the following prototype members added or replaced:

```text
computeBoundsTree
disposeBoundsTree
acceleratedRaycast
```

---

## Viewer Geometry Conversion Strategy

### Position Buffer

Prefer sharing the original Viewer position buffer.

For an interleaved buffer, create private library-side:

```ts
InterleavedBuffer
InterleavedBufferAttribute
```

objects while referencing the original TypedArray underneath.

Target:

```text
position buffer: zero-copy or near-zero-copy
```

### Index Buffer

The implementation must prevent `three-mesh-bvh` from modifying a Viewer-owned index buffer.

Provide two strategies.

#### Strategy A: Indirect

```ts
new MeshBVH(geometry, {
  indirect: true
})
```

Characteristics:

- position data can be shared
- index data can be shared
- Viewer index data is not reordered
- an additional triangle-ordering structure is maintained
- traversal may require an extra indirect lookup

#### Strategy B: Clone Index

```ts
const privateIndex = viewerIndex.slice()
```

Characteristics:

- position data is shared
- index data is privately owned by the library
- the backend may reorder the private index
- additional index memory is required
- traversal performance may be better

Proposed API:

```ts
type IndexOwnershipStrategy =
  | "indirect"
  | "clone";
```

### Do Not Copy Rendering Attributes

Collision geometry normally requires only:

- position
- index
- primitive ranges

Do not copy:

- normals
- UVs
- colors
- material attributes
- object IDs
- rendering-only attributes

### Packed Position Copy

The first version should not extract tightly packed XYZ positions by default.

Keep this as an optional strategy:

```ts
type PositionStrategy =
  | "shared-interleaved"
  | "packed-copy";
```

Use benchmarks to determine whether packed positions justify their extraction and memory cost.

---

## TLAS: Scene-Level Acceleration

### Build a Private Packed TLAS

Viewer already contains a BVH, but it should not be a core library dependency.

Reasons:

- Viewer BVH is an internal implementation.
- Node layout may change between Viewer versions.
- It is not exposed as a stable public clash-query API.
- It is difficult to unit-test independently.
- It is difficult to serialize.
- It is difficult to use from Workers.
- It limits support for non-Viewer geometry.
- Stable support for multi-model and custom instances is harder.

### Role of Viewer BVH

Viewer BVH may be supported as an optional broad-phase adapter:

```ts
interface BroadPhaseIndex {
  queryBox(
    box: Float32Array,
    output: number[]
  ): void;
}
```

Possible implementations:

```ts
class PackedTlas implements BroadPhaseIndex {}
class ViewerBvhAdapter implements BroadPhaseIndex {}
class SpatialHashIndex implements BroadPhaseIndex {}
```

The default should remain a library-owned packed TLAS.

### TLAS Leaf

```ts
interface TlasLeaf {
  instanceId: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
```

The implementation should favor TypedArrays and packed layouts instead of allocating large numbers of:

- `THREE.Box3`
- `THREE.Vector3`
- temporary objects
- per-query allocations

---

## Broad Phase

### Purpose

Quickly eliminate fragment pairs that cannot intersect.

### Base Condition

```text
world-space AABB overlap
```

### Query Modes

The library should support:

- TLAS vs TLAS
- instance set vs TLAS
- query box vs TLAS
- model A vs model B
- category A vs category B
- dbId set vs dbId set

### Candidate-Pair Deduplication

Prevent:

- duplicate fragment pairs
- duplicate A-B and B-A pairs
- repeated element pairs caused by multiple fragments
- self-pairs when source and target are the same set

---

## Narrow Phase

### Purpose

Run exact geometry queries on broad-phase candidate pairs.

### Relative Matrix

BLAS data should remain in geometry-local space.

When comparing instance A with instance B:

```ts
relativeMatrix =
  inverse(instanceA.matrixWorld) *
  instanceB.matrixWorld;
```

Transform B into A’s local space and execute:

```text
BLAS A vs BLAS B
```

### Early Exit

A Boolean surface-intersection query should stop as soon as the first intersecting triangle pair is found.

```ts
intersectsSurface(a, b): boolean
```

Do not collect every triangle pair unless explicitly requested.

### Optional Detail Levels

```ts
type DetailLevel =
  | "boolean"
  | "fragment-pair"
  | "element-pair"
  | "triangle-pair"
  | "contact";
```

Each level has a different performance cost.

---

## Small-Geometry Fallback

Many BIM fragments have very few triangles.

Building a BLAS for small geometry may:

- cost more than direct testing
- use more memory
- increase cache complexity
- add unnecessary Worker scheduling overhead

Use a threshold:

```ts
if (triangleCount < blasThreshold) {
  useBruteForceTriangleTraversal();
} else {
  useBvhTraversal();
}
```

The decision can also be pair-based:

```ts
if (
  triangleCountA * triangleCountB
  < bruteForcePairThreshold
) {
  useBruteForcePair();
}
```

Thresholds must be determined by benchmarks rather than hard-coded assumptions.

---

## Lazy Build

### Use Lazy BLAS Construction by Default

After model loading, initially build only:

- geometry records
- collision instances
- TLAS

Build a BLAS only when its geometry first appears in a narrow-phase candidate pair.

```text
TLAS query
  ↓
candidate geometry
  ↓
BLAS missing
  ↓
build once
  ↓
cache
```

### Benefits

- avoids building acceleration for geometry that is never queried
- reduces initial loading time
- works well with category-limited queries
- works well with selection-limited queries
- enables progressive warm-up

### Deduplicate Build Promises

```ts
interface GeometryRecord {
  accelerationPromise?: Promise<GeometryAcceleration>;
}
```

This prevents simultaneous queries from building the same geometry more than once.

---

## Worker Strategy

### Problem

Viewer-owned buffers usually cannot be transferred directly to a Worker. Transfer would detach the buffer on the main thread and could break Viewer rendering.

### Options

#### Main-Thread Incremental Build

- does not copy the position buffer
- builds in batches
- yields control between batches
- suitable for many small geometries

#### Worker with Copied Buffers

- copies position and index data
- avoids blocking the UI
- uses more memory
- may incur substantial copy overhead

#### SharedArrayBuffer

- requires cross-origin isolation
- imposes stricter deployment requirements
- suitable for large geometry and parallel building

### First-Version Recommendation

Start with:

```text
shared Viewer position buffer
+ cloned index or indirect mode
+ incremental main-thread BLAS build
```

Worker support should be a second-stage optimization validated by benchmarks.

---

## Collision Semantics

The library should not use one ambiguous `intersects()` method for every type of clash.

At minimum, distinguish the following semantics.

### Surface Intersection

Triangle surfaces physically intersect.

```ts
intersectsSurface(a, b): boolean
```

### Volume Overlap

Two closed solids have overlapping volume.

```ts
overlapsVolume(a, b): boolean
```

Note:

```text
surface intersection = false
volume overlap       = true
```

This occurs when one closed solid is fully contained inside another without crossing its surface.

Viewer tessellation is not guaranteed to be watertight. Strong guarantees for this mode should therefore be limited to:

- watertight geometry
- manifold geometry
- closed geometry

### Touching

The distance between geometries is less than or equal to a contact tolerance.

```ts
isTouching(a, b, tolerance): boolean
```

### Clearance

The distance between geometries is below a required threshold.

```ts
withinClearance(a, b, distance): boolean
```

---

## Tolerance

BIM clash detection should not rely solely on exact floating-point intersection.

Proposed options:

```ts
interface ToleranceOptions {
  intersectionEpsilon: number;
  touchingDistance: number;
  clearanceDistance?: number;
  coplanarEpsilon: number;
}
```

Support:

```text
Hard clash
  geometry overlaps

Touching
  distance <= contact tolerance

Soft clash
  distance < required clearance
```

The specification must define:

- the distance unit used by the library
- Viewer model units
- the effect of global offsets
- the effect of model transforms on tolerances
- floating-point precision behavior at large coordinates

---

## Proposed Public API

### Create a Collision World

```ts
const world = await CollisionWorld.fromViewer(viewer, {
  models: viewer.getVisibleModels(),

  buildStrategy: "lazy",

  broadPhase: "packed-bvh",
  narrowPhase: "three-mesh-bvh",

  indexOwnership: "clone",

  tolerance: {
    intersectionEpsilon: 1e-6,
    touchingDistance: 0
  }
});
```

### Query Clash Pairs

```ts
const result = await world.findClashes({
  source: {
    model: modelA,
    dbIds: sourceDbIds
  },

  target: {
    model: modelB,
    dbIds: targetDbIds
  },

  mode: "surface-intersection",

  firstHitOnly: false,
  groupBy: "dbId",

  detailLevel: "element-pair"
});
```

### Clearance Query

```ts
const result = await world.findClashes({
  source,
  target,

  mode: "clearance",
  clearance: 0.05,

  groupBy: "dbId"
});
```

### Single-Pair Query

```ts
const hit = await world.intersectsSurface(
  instanceA,
  instanceB
);
```

---

## Proposed Types

```ts
type ClashMode =
  | "surface-intersection"
  | "touching"
  | "clearance"
  | "volume-overlap";

type GroupBy =
  | "fragment"
  | "dbId"
  | "externalId";

interface ElementRef {
  modelId: number | string;
  dbId: number;
  externalId?: string;
}

interface FragmentRef {
  modelId: number | string;
  dbId: number;
  fragId: number;
}

interface TrianglePair {
  sourceTriangle: number;
  targetTriangle: number;
}

interface FragmentClash {
  source: FragmentRef;
  target: FragmentRef;

  type: ClashMode;

  distance?: number;
  trianglePairs?: TrianglePair[];
}

interface ClashPair {
  source: ElementRef;
  target: ElementRef;

  type: ClashMode;

  fragmentPairs?: FragmentClash[];
  minimumDistance?: number;
}

interface ClashStatistics {
  broadPhasePairs: number;
  narrowPhasePairs: number;

  blasBuilt: number;
  blasCacheHits: number;

  triangleTests?: number;

  broadPhaseMs: number;
  narrowPhaseMs: number;
  totalMs: number;
}

interface ClashResult {
  pairs: ClashPair[];
  statistics: ClashStatistics;
}
```

---

## Proposed Module Structure

```text
src/
├─ viewer/
│  ├─ ViewerModelAdapter.ts
│  ├─ ViewerGeometryAdapter.ts
│  ├─ ViewerInstanceExtractor.ts
│  └─ ViewerBvhAdapter.ts
│
├─ geometry/
│  ├─ TriangleGeometryView.ts
│  ├─ GeometryRegistry.ts
│  ├─ GeometryIdentity.ts
│  └─ GeometryNormalizer.ts
│
├─ blas/
│  ├─ GeometryAcceleration.ts
│  ├─ ThreeMeshBvhBackend.ts
│  ├─ BruteForceBackend.ts
│  └─ BlasCache.ts
│
├─ tlas/
│  ├─ CollisionInstance.ts
│  ├─ PackedTlas.ts
│  ├─ TlasBuilder.ts
│  └─ TlasTraversal.ts
│
├─ query/
│  ├─ CollisionQuery.ts
│  ├─ BroadPhaseQuery.ts
│  ├─ NarrowPhaseQuery.ts
│  ├─ ClearanceQuery.ts
│  └─ ResultAggregator.ts
│
├─ math/
│  ├─ TriangleIntersection.ts
│  ├─ TriangleDistance.ts
│  ├─ Bounds.ts
│  └─ Matrix.ts
│
├─ workers/
│  ├─ BlasBuildWorker.ts
│  └─ WorkerProtocol.ts
│
├─ diagnostics/
│  ├─ Statistics.ts
│  ├─ Benchmark.ts
│  └─ DebugVisualization.ts
│
├─ CollisionWorld.ts
└─ index.ts
```

---

## Proposed Core Interfaces

### GeometryAcceleration

```ts
interface GeometryAcceleration {
  intersects(
    other: GeometryAcceleration,
    relativeMatrix: ArrayLike<number>,
    options?: IntersectionOptions
  ): boolean;

  distanceTo?(
    other: GeometryAcceleration,
    relativeMatrix: ArrayLike<number>,
    options?: DistanceOptions
  ): number;

  dispose(): void;
}
```

### BroadPhaseIndex

```ts
interface BroadPhaseIndex {
  queryBox(
    bounds: ArrayLike<number>,
    output: number[]
  ): void;

  queryPairs?(
    other: BroadPhaseIndex,
    callback: (
      sourceInstanceId: number,
      targetInstanceId: number
    ) => boolean | void
  ): void;

  refit?(instanceIds?: number[]): void;

  dispose(): void;
}
```

### ViewerGeometryAdapter

```ts
interface ViewerGeometryAdapter {
  supports(geometry: unknown): boolean;

  normalize(
    geometry: unknown
  ): TriangleGeometryView;
}
```

---

## Recommended First-Version Scope

### Include

1. APS Viewer model adapter
2. Viewer geometry-layout detection
3. geometry normalization
4. unique geometry deduplication
5. fragment collision-instance extraction
6. world-space AABB extraction
7. packed TLAS
8. TLAS-vs-TLAS traversal
9. `three-mesh-bvh` BLAS backend
10. small-geometry brute-force backend
11. lazy BLAS construction
12. fragment-pair results
13. dbId-pair aggregation
14. surface-intersection queries
15. touching tolerance
16. clearance queries
17. cancellation support
18. progress reporting
19. statistics
20. benchmark suite
21. correctness test suite

### Exclude for Now

- CSG result geometry
- Boolean solid output
- penetration volume
- physics response
- rigid-body simulation
- GPU compute collision
- custom WebGPU backend
- custom triangle BVH implementation
- exact solid overlap for arbitrary non-watertight meshes
- automatic clash-grouping UI
- Viewer extension UI
- issue-persistence backend
- BCF export

---

## Performance Priorities

### Must Avoid

- building one BLAS per `fragId`
- rebuilding BLAS data for every query
- copying the full vertex buffer for every query
- copying normals, UVs, or colors
- using CSG for Boolean collision detection
- nested loops over all fragment pairs
- brute-force loops over all triangle pairs
- allocating many `Vector3`, `Triangle`, or `Box3` objects during traversal
- creating temporary objects in tight loops
- eagerly building every BLAS on model load

### Recommended

- unique geometry cache
- shared position buffers
- cloned index or indirect mode
- lazy BLAS construction
- packed TypedArray TLAS
- reusable scratch buffers
- early exit
- pair deduplication
- category and selection filtering
- query cancellation
- incremental build
- benchmark-driven thresholds

---

## Benchmark Plan

The detailed specification should define a reproducible benchmark suite.

### Model Types

- MEP models with many low-poly fragments
- models with a small number of complex, high-poly families
- architectural models
- structural models
- linked multi-model federated scenes
- models with extensive geometry instancing
- models with little or no geometry sharing
- large-coordinate or global-offset models

### Benchmark Metrics

```text
Viewer geometry extraction time
Geometry normalization time
TLAS build time
BLAS build time
Total memory usage
Unique geometry count
Fragment count
Triangle count
Candidate pair count
Narrow-phase pair count
Triangle test count
Query latency
First-hit latency
Full-result latency
Cache hit rate
Worker copy overhead
```

### Strategies to Compare

#### Position Strategy

- shared interleaved
- packed copy

#### Index Strategy

- indirect
- cloned index

#### BLAS Strategy

- no BLAS
- CENTER
- AVERAGE
- SAH

#### Build Strategy

- eager
- lazy
- incremental
- Worker

#### Small-Geometry Threshold

- 0
- 32 triangles
- 64 triangles
- 128 triangles
- 256 triangles
- adaptive pair threshold

#### Broad Phase

- packed BVH
- spatial hash
- Viewer BVH adapter
- brute-force baseline

---

## Correctness Validation

### Basic Cases

- separated boxes
- touching boxes
- overlapping boxes
- coplanar triangles
- edge-edge contact
- vertex-face contact
- rotated geometry
- non-uniform scale
- mirrored transform
- indexed geometry
- non-indexed geometry
- interleaved positions
- `drawRange`
- `offsets`
- geometry groups
- one `dbId` with multiple fragments
- shared geometry with multiple transforms
- multi-model transforms

### Special Cases

- degenerate triangles
- zero-area triangles
- duplicate vertices
- invalid indices
- empty geometry
- very large coordinates
- very small geometry
- non-watertight meshes
- fully contained closed meshes
- transforms with a negative determinant
- precision near a tolerance boundary

### Baseline Comparison

Use slower but easier-to-verify reference implementations:

- brute-force triangle-pair tests
- controlled analytic geometry cases
- an offline desktop geometry engine
- known clash datasets with expected results

CSG may be used as a correctness reference for a small set of closed-geometry fixtures, but it must not be used as the production algorithm or the primary benchmark baseline.

---

## Risks

### Viewer Private API Changes

Viewer geometry layouts, fragment structures, or render-proxy behavior may change between releases.

Mitigations:

- isolate access in adapters
- use capability detection
- maintain versioned tests
- report unsupported layouts clearly
- use fixture-based regression tests

### Three.js Version Conflicts

Viewer THREE and library THREE may use different versions.

Mitigations:

- isolate runtimes
- exchange only TypedArrays and numeric matrices
- never patch Viewer THREE prototypes
- define an explicit bundling strategy

### Buffer Ownership

If the backend modifies a Viewer-owned index buffer, Viewer rendering may break.

Mitigations:

- indirect mode
- cloned index
- immutable source contract
- explicit ownership metadata

### Memory Pressure

Large models may simultaneously hold:

- original Viewer geometry
- collision index copies
- BLAS data
- TLAS data
- Worker copies

Mitigations:

- lazy build
- LRU cache
- disposal APIs
- configurable memory budget
- small-geometry fallback
- optional serialization

### Non-Watertight Geometry

Viewer tessellation is not guaranteed to be closed.

Mitigations:

- focus the first version on surface intersection and clearance
- document the limitations of volume overlap
- provide geometry diagnostics

### Units and Precision

Models may use:

- different model units
- global offsets
- placement transforms
- large world coordinates

Mitigations:

- define one world-coordinate convention
- define tolerance units explicitly
- use relative-coordinate calculations where appropriate
- benchmark precision at large coordinates

---

## Open Questions

The detailed specification must research and decide:

1. What are the actual geometry-layout differences between APS Viewer v7 and newer Viewer versions?
2. Do SVF, SVF2, and OTG require separate adapters?
3. How can the library obtain a stable unique geometry identity?
4. Can Viewer index buffers use compressed or special layouts?
5. How are `drawRange`, `offsets`, and groups used in real Viewer geometry?
6. What are the current limitations of `three-mesh-bvh` with interleaved position attributes?
7. What is the real performance difference between `indirect: true` and cloned indices on APS models?
8. Should the default BLAS build strategy use CENTER, AVERAGE, SAH, or another strategy?
9. Should the small-geometry threshold be fixed or adaptive?
10. Should TLAS use LBVH, SAH BVH, median split, or a spatial hash?
11. Does TLAS need refit support?
12. At which layer should multi-model transforms and global offsets be normalized?
13. Should clearance queries rely directly on `three-mesh-bvh` distance traversal?
14. Is Worker buffer-copy overhead worthwhile?
15. Is persistent serialized BLAS caching required?
16. Should the library support cancellation and progressive result streaming?
17. Should the first version support triangle primitives only?
18. How should lines, points, and 2D geometry be handled?
19. How should touching, intersection, and coplanar overlap be defined?
20. How can the library avoid producing large numbers of duplicate contacts for one element pair with many fragment pairs?

---

## Recommended Next Step for Codex or Claude

Use this document to produce a detailed technical specification and implementation plan containing at least:

1. exact library scope
2. package and repository structure
3. TypeScript public API
4. internal data model
5. Viewer geometry extraction strategy
6. Viewer-version compatibility strategy
7. TLAS algorithm selection
8. BLAS backend integration
9. geometry identity and cache policy
10. memory ownership rules
11. lazy-build flow
12. Worker strategy
13. query execution pipeline
14. tolerance and unit handling
15. error handling
16. cancellation
17. progress reporting
18. disposal lifecycle
19. unit tests
20. integration tests
21. benchmark fixtures
22. milestone breakdown
23. MVP boundary
24. technical risks
25. proof-of-concept implementation steps

Before full implementation, complete a discovery spike:

```text
1. Extract fragment geometry from several APS Viewer models.
2. Record the observed geometry layouts.
3. Verify geometry sharing and unique-geometry identity.
4. Build a zero-copy or low-copy BufferGeometry wrapper.
5. Verify three-mesh-bvh construction.
6. Verify BLAS-vs-BLAS intersection.
7. Benchmark cloned indices against indirect mode.
8. Measure the brute-force threshold for small geometry.
9. Build a minimal TLAS prototype.
10. Complete a model-to-model benchmark.
```

---

## One-Sentence Positioning

> A high-performance client-side spatial query and clash-detection engine for APS Viewer models, using a custom instance-level TLAS and reusable geometry-level BLAS instead of CSG Boolean operations.
