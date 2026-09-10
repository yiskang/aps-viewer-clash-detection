# M4 blocker adjudication — correctness defects in the pinned `three-mesh-bvh@0.9.14`

Date: 2026-09-10
Branch: `feature/m4-performance-worker-decision-design`
Status: **adjudication only — no source was changed, nothing was upgraded, nothing was patched.**

## What this document is

M4 Phase 3's canonical full-matrix run aborts at `S2[k=100:typical:clearance]` with
`FAILED_VALIDATION`. The prior investigation
(`.superpowers/sdd/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation/s2-clearance-divergence-investigation.md`)
traced that abort to a defect in the pinned dependency and flagged a second suspected one.
This document independently re-establishes both from scratch, determines their upstream status,
evaluates the remediation options, and recommends exactly one. It also records a **third** defect
in the same file, surfaced by the second-opinion consult and verified here, which is real but is
*not* a blocker and must not expand the patch (§2.3).

**Everything below was produced read-only.** `node_modules/` was not edited. Candidate patches were
validated *out of tree* — a copied-and-edited cast module and a temporarily monkey-patched prototype
inside throwaway scripts under this session's scratchpad,
`/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/0a66274d-41b6-465b-8f3b-2512eb2770f8/scratchpad/`
(`repro-defect1-obb2.mjs`, `repro-defect2-final.mjs`, `repro-defect2-endtoend.mjs`,
`repro-defect3-sat.mjs`, `verify-patches.mjs`, `verify-patch1alt.mjs`, `patched/`). None of them are
part of the repo.

Pinned version confirmed before anything else was trusted:

| source | value |
|---|---|
| `package.json` `dependencies` | `"three-mesh-bvh": "0.9.14"` (exact, no range) |
| `package-lock.json` | `0.9.14`, `resolved` `https://registry.npmjs.org/three-mesh-bvh/-/three-mesh-bvh-0.9.14.tgz` |
| `node_modules/three-mesh-bvh/package.json` | `"version": "0.9.14"` |
| `three` | `0.185.1` (exact) |

---

## Step 1 — Upstream status

### 1.1 Defect 1 — stale module-global `obb2` in `closestPointToGeometry*`

**Fixed upstream: NO.**

`closestPointToGeometry_indirect.generated.js` declares module-level singletons including
`const obb2 = new OrientedBox()` (line 13). Each call refreshes only `obb2.matrix` (line 62).
`obb2.min` / `obb2.max` / `obb2.needsUpdate` are written **only** inside the outer shapecast's
`intersectsBounds` leaf branch (lines 78-84). `shapecastTraverse`
(`src/core/cast/shapecast.js:53-62`) calls `intersectsBoundsFunc` only on a node's *children*
during recursion — never on the root — so when the outer (anchor) BVH's root is itself a leaf,
`intersectsBounds` is never invoked at all and the nested traversal prunes against the **previous
call's** leaf box combined with **this call's** matrix.

Checks performed today (2026-09-10):

- **npm registry**: `dist-tags.latest` = `0.9.15`, published `2026-09-09T11:06:07.319Z`.
  `0.9.14` was published `2026-08-01`. There is no `0.10.x` and no `1.x`.
- **0.9.15 tarball, diffed against the installed 0.9.14 tree — whole package, not just `src/`**
  (`diff -rq node_modules/three-mesh-bvh <unpacked 0.9.15>`; both trees contain
  `build/ LICENSE package.json README.md src/`):

  ```
  Files .../0.9.14/package.json and .../0.9.15/package.json differ
  Files .../0.9.14/src/webgpu/nodes/WGSLTagFnNode.js and .../0.9.15/.../WGSLTagFnNode.js differ
  Files .../0.9.14/src/webgpu/shapecastFns/getRaycastFirstHitFn.js and .../0.9.15/... differ
  Files .../0.9.14/src/webgpu/tsl/fns.js and .../0.9.15/... differ
  Files .../0.9.14/src/webgpu/tsl/structs.js and .../0.9.15/... differ
  ```

  **The version string plus those four WebGPU files are the entire difference between 0.9.14 and
  0.9.15.** Nothing in `src/core/`, `src/math/`, `src/utils/`, `src/objects/`, `src/workers/`,
  `src/index.d.ts` or `build/` changed.
- **0.9.15 source, same lines**: `obb2` is still module-global (line 13), still matrix-only
  refreshed (line 62), still leaf-branch initialised (lines 80-82).
- **GitHub `master`** (`src/core/cast/closestPointToGeometry.template.js`, fetched today): identical
  structure — `const obb2` at line 9, `obb2.matrix.copy( tempMatrix )` at line 58, min/max/needsUpdate
  at lines 76-78, `obb2.distanceToBox( box )` at line 100. Byte-for-byte the same as the repo's
  vendored template.
- **CHANGELOG for 0.9.15**: only two entries, both `BVHComputeData` / WGSL ray-traversal items.
  No unreleased section.
- **Issue/PR search** on `gkjohnson/three-mesh-bvh` for `obb2`, `distanceToBox`, `"root leaf"`:
  `total_count: 0`. A broader `closestPointToGeometry` search returns only historical items
  (#386/#387 in 2022 — "No early out when computing box scores", a different bug; #100, #321/#323,
  #328/#331, #871). **No open or closed issue describes either defect.**

**First known fixed version/commit:** none exists.
**Applies cleanly to 0.9.14?** N/A — there is no upstream change to apply.

### 1.2 Defect 2 — `OrientedBox.distanceToBox` `max[f2]` / `max[f3]` indexing typo

**Fixed upstream: NO.**

`node_modules/three-mesh-bvh/src/math/OrientedBox.js`, inside `distanceToBox`'s AABB edge-segment
construction:

```js
419:  start[ f2 ] = i1 ? min[ f2 ] : max[ f2 ];
420:  start[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];   // <-- should be max[ f3 ]
423:  end[ f2 ]   = i1 ? min[ f2 ] : max[ f2 ];
424:  end[ f3 ]   = i2 ? min[ f3 ] : max[ f2 ];   // <-- should be max[ f3 ]
```

- **0.9.15**: identical, same line numbers (`start[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];` at :420,
  `end[ f3 ] = i2 ? min[ f3 ] : max[ f2 ];` at :424).
- **GitHub `master`**: identical, same line numbers.
- No changelog entry, no issue, no PR.

**First known fixed version/commit:** none exists.

### 1.3 Consequence for an upgrade, and 0.9.14 → 0.9.15 compatibility

Because 0.9.15 is the newest published version and its **only** difference from 0.9.14 is four
WebGPU files, an upgrade to 0.9.15:

- fixes **neither** defect;
- changes **nothing** this repo touches. `indirect: true` handling, `MeshBVH.serialize` /
  `deserialize`, `closestPointToGeometry`'s signature and semantics, `bvhcast`, `shapecast`,
  `ExtendedTriangle`, `OrientedBox`, `Constants.js` (`targetLeafSize: 10`) are all byte-identical
  between the two versions. There is no API or behavioural change to assess, because there is no
  change at all outside `src/webgpu/`.

This repo imports `MeshBVH` and `ExtendedTriangle` only (`collision/blas/ThreeMeshBvhBackend.js:15`,
`spike/geometry-core.mjs:11`, `spike/m4/s1-module-resolution/worker.bare.mjs:5`,
`test/blas/ThreeMeshBvhBackend.test.mjs:4`). It never imports anything under `src/webgpu/`.
`MeshBVH.serialize` / `deserialize` are **not called anywhere** in `collision/`, `spike/`, `test/`
or `scripts/` today; the only reference is the M4 spec's §6.4 stage-scoped-validity clause, which
makes byte-identical `roots` / `index` / `indirectBuffer` a criterion for a *future* Phase 4 S7′
geometry-preparation spike.

**Upgrading is not a remedy. Option A is empirically unavailable.**

---

## Step 2 — Independent reproduction of both defects

New minimal reproductions, built from scratch. Neither reuses the S2 `k=100` case, the repo fixture,
`CollisionWorld`, the Viewer, or a browser. Both run in plain Node against the installed package.

### 2.1 Defect 1 — root-is-leaf order dependence

`repro-defect1-obb2.mjs`. Operands, built exactly the way
`collision/blas/ThreeMeshBvhBackend.js:55-56` builds a BLAS (`new MeshBVH(geometry, { indirect: true })`
plus `geometry.boundsTree = bvh`):

- **anchor under test**: a 1×1 quad — **2 triangles**, so `targetLeafSize: 10` gives a single-node
  BVH (`rootIsLeaf: true`).
- **far operand**: a 6×6 grid (72 triangles) parallel to the anchor at `z = 0.05`, with its own
  `boundsTree`, so the nested accelerated path that reads `obb2` is taken.
- `maxThreshold = 0.5`, `geometryToBvh = identity`. Ground truth 0.05, computed by dense
  barycentric sampling of every triangle pair.
- **only the immediately preceding `closestPointToGeometry` call is varied**: a "near" perturber
  (multi-node anchor whose leaf boxes sit on the plate) versus a "distant" perturber (the same
  geometry translated 1000 units away).

Actual output:

```
=== Defect 1 — stale module-global obb2 when the anchor BVH root is a leaf ===
installed three-mesh-bvh: 0.9.14
installed three         : 0.185.1

BVH shapes (32 bytes/node, IS_LEAF == uint16[15] === 0xFFFF):
  anchor under test (2 tris) : { bytes: 32, nodes: 1, rootIsLeaf: true }
  near perturber   (72 tris) : { bytes: 736, nodes: 23, rootIsLeaf: false }
  distant perturber(72 tris) : { bytes: 736, nodes: 23, rootIsLeaf: false }
  MeshBVH targetLeafSize default = 10 (src/core/Constants.js)

brute-force ground truth for (anchor, far): 0.05000000074505806

closestPointToGeometry(anchor, far) — BYTE-IDENTICAL operands every time:
  call #1  (no controlled predecessor)                           -> 0.05000000074505806
  call #2  (predecessor: call #1, same operands)                 -> 0.05000000074505806
  call #3  (predecessor: NEAR perturber, leaf box on the plate)  -> 0.05000000074505806
  call #4  (predecessor: DISTANT perturber, leaf box ~1000 away) -> null  (MISS: "beyond threshold")
  call #5  (predecessor: NEAR perturber again)                   -> 0.05000000074505806
  call #6  (predecessor: DISTANT perturber again)                -> null  (MISS: "beyond threshold")

  distinct results over identical operands: 2
  DEFECT 1 REPRODUCED — the answer depends only on the preceding call.

--- CONTROL: same experiment with a MULTI-NODE anchor (root is NOT a leaf) ---
  control anchor BVH: { bytes: 736, nodes: 23, rootIsLeaf: false }
  results: [
  0.05000000074505806,
  0.05000000074505806,
  0.05000000074505806,
  0.05000000074505806
]
  distinct: 1 (1 == stable, as expected when intersectsBounds runs)

--- exposure: which anchor triangle counts produce a root-is-leaf BVH? ---
    2 triangles -> { bytes: 32, nodes: 1, rootIsLeaf: true }
    8 triangles -> { bytes: 32, nodes: 1, rootIsLeaf: true }
   18 triangles -> { bytes: 160, nodes: 5, rootIsLeaf: false }
```

**Verdict: Defect 1 is CONFIRMED REAL.** Byte-identical operands, one process, no worker, no
`CollisionWorld` — the result flips between the correct 0.05 and a false `null`
("beyond threshold") purely as a function of which `closestPointToGeometry` call ran immediately
before. The multi-node control is stable 4/4, which localises the cause to the root-is-leaf path
exactly as the source reading predicts.

**Why no existing test caught this.** The canonical clearance fixture is `box(w, h, d)`
(`test/fixtures/geometry.mjs`), and a `box(2, 2, 2)` is **12 triangles → a 3-node BVH,
`rootIsLeaf: false`** (measured: `_roots[0].byteLength === 96`, `indirect: true`). Every one of the
23 tests in `test/query/ClearanceQuery.test.mjs` uses box-derived operands, so the whole existing
suite **structurally cannot reach the root-is-leaf path**. This is not an oversight to be scolded —
it is the reason regression test 1 below must build a deliberately ≤ 10-triangle anchor and assert
on the root's `IS_LEAF` flag, rather than reusing the standard fixture.

**Exposure in this repo.** `ThreeMeshBvhBackend.js:55` builds every BLAS with the default
`targetLeafSize: 10` (`src/core/Constants.js:74-78`), so **any fragment with ≤ 10 triangles gets a
single-node BVH**. `ClearanceQuery.js:155-161` anchors on the *smaller-or-equal-scale* operand, and
`ClearanceQuery.js:223-225` maps a `null` return to `{ withinClearance: false, distance: null }` →
`beyond-threshold`. Flat plates, 2-triangle panels and other trivial fragments are common in real
BIM models, so the exposed class is broad, and it is silent: a single-arm caller has nothing to
compare against.

### 2.2 Defect 2 — `distanceToBox` indexing typo

Two levels of evidence, because "the source looks wrong" was explicitly not enough.

**(a) Unit level.** `repro-defect2-final.mjs` builds three things: a **verbatim port** of 0.9.14's
`distanceToBox` with a single switch on lines 419/423; an **independent exact reference** written
from scratch (for two disjoint convex polytopes the minimum is attained on a vertex-vs-body or
edge-vs-edge pair; box edges are enumerated in **local index space** — pairs of corner indices
differing in one bit — and only then transformed, so no float-equality test is ever applied to
rotated coordinates); and a **strictly-valid upper bound** by dense OBB-surface sampling.

Actual output:

```
=== Defect 2 — OrientedBox.distanceToBox max[f2]/max[f3] typo ===
installed three-mesh-bvh: 0.9.14

disjoint OBB/AABB samples:                              18239
verbatim port reproduces shipped function:              18239/18239
cases where the typo changes the answer:                11344

SHIPPED (buggy)  OVER-estimates true distance:          685   <-- false-prune capable
SHIPPED (buggy)  UNDER-estimates true distance:         10659
TYPO-FIXED       OVER-estimates true distance:          0
TYPO-FIXED       UNDER-estimates true distance:         0

--- worst relative OVER-estimate produced by the typo ---
  obb local min : [ -0.3804163099641057, -0.9479515318050755, -2.03228256792402 ]
  obb local max : [ 0.4589844705345968, 1.8687230714451164, 0.7140377524374228 ]
  obb matrix    : [
   0.00430200927020449, 0.008173964532454317, -0.9999573386000331, 0,
   -0.5471904444278781,  0.8369961037130074, 0.004487749554735238, 0,
    0.836997078993147,   0.5471477941772834, 0.008073480282549787, 0,
   -1.07325792176335,    4.013246063149184,  0.5037035963049643,   1 ]
  aabb min      : [ 0, 0, 0 ]
  aabb max      : [ 1.334708213962013, 3.561825842858211, 1.3125964404608106 ]
  shipped lib   : 0.045563153441575466
  typo-fixed    : 0.015450309808991687
  exact ref     : 0.015450309808991687
  sampled upper : 0.020519101685075203
  over-estimate : 0.030112843632583777 (194.90% high)
  => a maxThreshold anywhere in ( 0.015450309808991687 , 0.045563153441575466 ) is FALSELY PRUNED

--- additional over-estimating cases ---
  lib=3.801677225723852  typo-fixed=3.79935565125916  exact=3.79935565125916  sampled=3.7993637548660892
  lib=1.3398502543544284 typo-fixed=1.333392405913511 exact=1.333392405913511 sampled=1.3333926598164376
  lib=0.7263598251679361 typo-fixed=0.6673368684809662 exact=0.6673368684809662 sampled=0.6674644708302281

--- control: cube AABB (max.x===max.y===max.z), typo is a no-op ---
  samples 4859, typo changed the answer in 0 (expected 0), over-estimates 0
```

Three things make this conclusive rather than suggestive:

1. The verbatim port reproduces the shipped function **18239/18239**, so the port is the function.
2. With only lines 419/423 repaired, the port agrees with the independent exact reference in
   **every one of 18239 cases** — 0 over-estimates *and* 0 under-estimates. Two implementations
   written from different starting points converging exactly is strong mutual validation, and it
   also says `distanceToBox` has **no other error**: the typo is the whole defect.
3. The cube-AABB control, where `max[f2] === max[f3]` makes the typo a literal no-op, shows
   **0 changes and 0 over-estimates** — the typo is the cause, not a coincidence.

**Scope of claim 2, stated precisely.** The 18239-case sweep filters out every pair for which
`distanceToBox` returned `0` (`if ( lib === 0 ) continue;`). So the correct statement is: **the typo
fully explains every observed non-zero-distance error in the tested disjoint domain.** It is *not* a
claim that `distanceToBox` is defect-free once the typo is repaired — §2.3 below shows it is not,
and shows that the excluded `=== 0` class is exactly where the remaining defect lives.

**(b) End-to-end.** `repro-defect2-endtoend.mjs` asks the question that actually matters: does the
over-estimate make `MeshBVH.closestPointToGeometry` return a *wrong distance*? Defect 1 is held out
of play by using a **multi-node** anchor (15 nodes, `rootIsLeaf: false`), and `maxThreshold` is
`Infinity` so the only prune is `score < closestDistance` — any deviation is a pruning error, never
a threshold effect. The oracle uses the **same leaf math the library uses**
(`ExtendedTriangle.distanceToTriangle`) over all triangle pairs with no BVH, so the *only*
difference between library and oracle is the pruning decision.

```
=== Defect 2 end-to-end: pruning-induced wrong distance from closestPointToGeometry ===

anchor BVH nodes: 15  rootIsLeaf: false

random (anchor, far, transform) samples: 3149
closestPointToGeometry distance > oracle distance (false prune): 1

worst case:
  library closestPointToGeometry : 0.3764796770271388
  oracle (same leaf math, no BVH): 0.3656977933631861
  relative error                 : 2.9483%
  far triangles                  : 18
  matrix                         : [
  -0.10770400874775261, -0.17783314589801621, -0.9781488734950723,  0,
   0.6158705228368438,  -0.7842908784128042,  0.07477511042549251, 0,
  -0.780450732333782,   -0.5943594789842986,  0.19399346417128727, 0,
   0.49131167004411647,  1.1737833033193756, -0.43321251819525486, 1 ]
```

**Verdict: Defect 2 is CONFIRMED REAL and correctness-bearing, not merely suspicious source.**
It produces a wrong distance from `distanceToBox` in 62% of disjoint configurations, and in **3.8%**
of them the error is in the *over-estimating* direction — the only direction that can wrongly prune,
because both prune predicates in `closestPointToGeometry` are `score < closestDistance` and
`score < maxThreshold`. That over-estimate propagates to a genuinely wrong
`closestPointToGeometry` result. It is rarer end-to-end than Defect 1 (1 in 3149 random
configurations here) because it additionally requires the over-estimated node to be the one holding
the true minimiser — but it is real, and it is independent of Defect 1.

### 2.3 A third defect, surfaced by the second-opinion consult and verified here — NOT a blocker

The `codex-advisor` consult (§ "Second opinion" below) independently found a **third** defect in the
same file and challenged the "0/18239 after the typo fix" figure. Verified here from source and by
a fresh sweep (`repro-defect3-sat.mjs`), rather than taken on trust:

`OrientedBox.prototype.intersectsBox` (`src/math/OrientedBox.js:140-181`) tests only **6 of the 15**
box-vs-box separating axes — the 3 AABB axes and the 3 OBB axes — and omits all **9 edge-cross-edge
axes**. The source carries a literal `// TODO: should this be doing SAT against the AABB?` at :146.
`distanceToBox` early-returns `0` on that predicate (`:344-358`), so it can report **zero distance
for genuinely disjoint boxes**.

```
=== Defect 3: incomplete SAT in OrientedBox.intersectsBox ===
cases where intersectsBox returned TRUE: 11301
of those, provably DISJOINT by full 15-axis SAT: 947

worst false-intersection (largest true gap reported as 0):
  exact reference distance : 1.0080554989864934
  distanceToBox returned   : 0
  obb local min: [ -0.6584559443213306, -2.0325003632961307, -0.9722872738131728 ]
  obb local max: [ 0.32409963618223536, 0.9109050396880624, 1.226423121023189 ]
  matrix       : [ -0.61938006825685, -0.3976450204029932, 0.6769392652187071, 0,
                    0.658593811688699, -0.7325051027637512, 0.17230921516395084, 0,
                    0.4273435646543543, 0.5525529044116676, 0.715585610234541, 0,
                    4.084285739382862,  2.7047691371779745, 2.149959566607121, 1 ]
  aabb         : [0,0,0] [2.5436020798718566, 1.559116482995039, 3.4285161208494177]
```

Also present unchanged on upstream `master`.

**Disposition: real, but not part of this remediation.**

- It is a **correctness defect for the public `OrientedBox.distanceToBox` API** — a documented
  distance function returning 0 for separated boxes.
- It is **safe for this repository's traversal**: reporting 0 is an *under*-estimate, and both prune
  predicates are `score < …`, so an under-estimate only admits more nodes. It cannot lose the
  minimum and cannot produce a false negative.
- It is **performance-bearing**: a false zero disables pruning for that node entirely.
- It **explains** why §2.2's sweep reported 0 over-estimates after the typo fix: the sweep skipped
  every `lib === 0` case, which is precisely this class.

It should be reported upstream but must **not** expand the patch that unblocks Phase 3 — widening
the patch increases regression surface for no correctness gain on the blocked path.

A fourth, related contract hole (already noted in the prior investigation and re-confirmed by the
consult): because a root-leaf outer BVH bypasses `intersectsBounds`, and `closestPointToGeometry`
never re-checks `maxThreshold` against the *exact* triangle distance found at a leaf, the function
can return a distance above `maxThreshold` where its own documentation says it returns `null`. This
repo is already insulated: `ClearanceQuery.js` applies an explicit exact world-distance filter after
the call. Report upstream; do not patch here.

### 2.4 Candidate patches, validated out of tree

Two patches were written and exercised in the scratchpad. `node_modules/` was **not** modified;
Patch 1 was tested by importing a copied-and-edited module, Patch 2 by temporarily assigning
`OrientedBox.prototype.distanceToBox` inside the script and restoring the original afterwards.

**Patch 1 (Defect 1).** Two variants were tried.

- *1a — seed from the BVH's own root bounds.* After `obb2.matrix.copy( tempMatrix )`, call
  `bvh.getBoundingBox( box )` and copy into `obb2.min`/`max`, setting `needsUpdate`. Exact for a
  single-root BVH (the root bounds **are** the leaf box when the root is a leaf); a superset — and
  therefore a distance under-estimate, i.e. conservative — for a hypothetical multi-root BVH.
  Costs one `Float32Array` allocation per root per call (`BVH.js:311-323`).
- *1b — seed inside `intersectsRange` from the box it is already given.* `shapecastTraverse`
  **always** passes the visited node's own box as `intersectsRange`'s 6th argument
  (`shapecast.js:60`, `:116`, `:152`), including on the root-is-leaf path where `intersectsBounds`
  is never called. Changing `intersectsRange: ( offset, count ) =>` to
  `intersectsRange: ( offset, count, contained, depth, nodeIndex, box ) =>` and copying `box` into
  `obb2` at the top of the body is **exact in every case**, allocation-free, correct for multi-root
  BVHs, and makes the `intersectsBounds` leaf-branch assignment redundant.

**Patch 2 (Defect 2).** `OrientedBox.js:419` and `:423`, `max[ f2 ]` → `max[ f3 ]`. Four characters.

Validation output:

```
=== PATCH VALIDATION (out-of-tree; node_modules untouched) ===

--- Patch 1: seed obb2 from the anchor BVH root bounds (Defect 1) ---
  predecessors      : near, DISTANT, near, DISTANT
  BASELINE  results : [ 0.05000000074505806, null, 0.05000000074505806, null ]
  PATCHED   results : [ 0.05000000074505806, 0.05000000074505806,
                        0.05000000074505806, 0.05000000074505806 ]
  baseline distinct: 2   patched distinct: 1 (1 == order-independent)
  patched value == brute-force truth 0.05000000074505806 : true

  Patch-1 regression on a MULTI-node anchor, 500 random transforms: identical 500, changed 0

--- Patch 2: OrientedBox.js:419,423  max[f2] -> max[f3] (Defect 2) ---
  end-to-end failing case:
    BASELINE closestPointToGeometry : 0.3764796770271388
    PATCHED  closestPointToGeometry : 0.3656977933631861
    oracle (all triangle pairs)     : 0.3656977933631861
    patched == oracle: true

  unit-level re-check after Patch 2 (20000 random OBB/AABB pairs):
    samples 18239, over-estimates after patch: 0 (was 685)
```

```
=== Patch 1-alt (seed obb2 inside intersectsRange from its 6th arg) ===
  FIX1 getBoundingBox seed     [0.05000000074505806, x4] distinct= 1
  FIX2 intersectsRange seed    [0.05000000074505806, x4] distinct= 1
  BASELINE 0.9.14              [0.05000000074505806,null,0.05000000074505806,null] distinct= 2

  multi-node anchor, 800 random transforms: FIX1 identical to baseline 800/800, FIX2 identical 800/800
```

Both Patch 1 variants make the reproduction order-independent and both leave every multi-node result
byte-identical to baseline (500 and 800 random transforms, zero changes). **Variant 1b is the better
patch** — exact rather than conservative, allocation-free, and multi-root safe.

**One correction to an earlier phrasing, from the consult.** Saying variant 1a is "a no-op for every
multi-node BVH" is too broad. A **multi-root** BVH (one geometry with several groups) can contain
internal roots and root-*leaf* roots simultaneously, and 1a's union seed stays active for each
root-leaf root — where it is a superset, hence a distance under-estimate: safe (it cannot
false-prune) but needlessly permissive if the groups are far apart. Variant 1b has no such case: it
is exact for single-root leaf BVHs, for *every* root of a multi-root BVH, for ordinary non-root
leaves, and for the `CONTAINED` range path should that ever be exercised. This is the deciding
argument for 1b, and it is why the regression set below adds a multi-root fixture.

**Rejected alternative:** changing generic `shapecast` to call `intersectsBounds` on roots. That
would alter public callback behaviour and depth semantics for every existing client of `shapecast`,
far beyond the two functions that need fixing.

---

## Step 3 — Remediation options

### Option A — upgrade to the smallest upstream-fixed version

**Not available.** There is no upstream-fixed version. 0.9.15 is the newest published release and
differs from 0.9.14 only in four `src/webgpu/` files; both defects are byte-identical in it and on
`master`. No issue or PR upstream describes either defect. Evaluating A on correctness terminates
here: **A fixes nothing.**

For completeness, if 0.9.15 were adopted anyway (it should not be, as part of this remediation):
regression risk is essentially nil and API compatibility total, because nothing outside
`src/webgpu/` changed — but it would also buy nothing, while making the M4 spec's several literal
`three-mesh-bvh@0.9.14` references stale for no benefit. **Do not bundle it.**

### Option B — retain 0.9.14 and apply the smallest local patch

Two patches, four changed lines of upstream source total (or five with variant 1b's parameter list).

| criterion | assessment |
|---|---|
| **Correctness** | Directly and provably fixes both defects. Patch 1b restores order-independence exactly (repro: 2 distinct results → 1, equal to brute-force truth). Patch 2 eliminates 685/18239 over-estimates → 0, and returns the end-to-end failing case to the oracle value exactly. |
| **Regression risk** | Low and measured, not assumed. Patch 1 changed **0 of 1300** multi-node-anchor results across two independent sweeps; it can only alter behaviour on the root-is-leaf path, which is precisely the broken path. Patch 2 is provably a no-op whenever `max[f2] === max[f3]` (cube control: 0 changes) and, where it does act, moves the answer *onto* the exact reference in 18239/18239 cases. Both patches strictly *tighten* correctness; neither widens any pruning bound in a way that could newly admit a wrong result. |
| **API compatibility** | None affected. No exported signature, option, or return shape changes. `closestPointToGeometry`'s `(otherGeometry, geometryToBvh, target1, target2, minThreshold, maxThreshold)` contract that `ClearanceQuery.js:220-222` depends on is untouched. |
| **`indirect: true` behaviour** | Untouched. Neither patch touches `resolveTriangleIndex`, the indirect buffer, or BVH construction. The `indirect: true` contract documented at `ThreeMeshBvhBackend.js:43-53` is unaffected. **Note:** the same defect exists in the non-indirect `closestPointToGeometry.generated.js` and in the shared `closestPointToGeometry.template.js`. This repo only ever builds `indirect: true` BLASes, but the patch should be applied to **all three** files so a future non-indirect use is not silently broken and so the template does not regenerate the bug. |
| **Serialized-BVH compatibility (M4)** | Unaffected. Neither patch touches BVH construction, node layout, or `serialize`/`deserialize`. Nothing is written into the packed buffer. §6.4's stage-scoped criterion — that S7′'s worker-side serialized `roots`/`index`/`indirectBuffer` be byte-identical to the main thread's — stays satisfiable, and remains well-defined provided **both sides load the same patched build**. That is a real constraint on the fix's *delivery* (see below), not on its correctness. |
| **`closestPointToGeometry` semantics** | Restored to the documented semantics, not changed. A `null` return still means "no triangle pair within `maxThreshold`" — it just stops being wrong. `target1.distance` / `target2.distance` / `.point` / `.faceIndex` are all unchanged in shape. |
| **M1–M3 behaviour and tests** | M1/M2/M3 each have their own gate (`test/performance/run-gate.mjs`, `run-gate-m2.mjs`, `run-gate-m3.mjs`) plus the unit suite. Baseline measured today over four full `npm test` runs — **1012 tests, best observed 1011 pass / 0 fail / 1 todo (exit 0), but 3 of 4 runs failed** on `test/query/ContainmentModeQuery.test.mjs` "duct through beam, no vertex inside either (round 7 regression)" and once additionally on `"a proven crossing overlap is conclusive:true"`. Both go through `ProperCrossingQuery`'s wall-clock crossing budget — the M4 spec's own named non-deterministic source. **This flakiness is pre-existing and unrelated to these defects** (see §5 of the regression list), and must be characterised *before* the patch lands so it cannot be mistaken for a patch regression. The patches can only *change* a result where the old answer was demonstrably wrong, so any M1–M3 assertion that changes is an assertion that was encoding a defective value — which must be surfaced, not accommodated. Concretely at risk: `test/query/*` clearance expectations built against small-triangle-count fixtures. This must be run, not assumed. |
| **Maintenance burden** | The real cost of B, and the thing to design carefully. Two ~4-line patches against a pinned exact version, carried in-repo. Burden is bounded because the version is pinned exactly (`"0.9.14"`, not `^0.9.14`), so the patch target cannot drift without a deliberate lockfile change. An upstream PR should be filed so the patch has an exit path, but M4 cannot wait on it. |

**Delivery mechanism — the part that needs a decision.** The repo has **no** patch tooling today:
no `patches/` directory, no `patch-package`, no pnpm `patchedDependencies`, no `overrides`, no
`postinstall`. And `scripts/sync-vendor.mjs` copies `node_modules/three-mesh-bvh/src` into
`wwwroot/vendor/three-mesh-bvh/src` on both `prestart` and `pretest` (`package.json`), so the
browser runtime — and therefore every gate run and every future worker — consumes whatever is in
`node_modules`. Named failure modes:

- **A reinstall silently reverts the fix.** `npm ci` / `npm install` / `npm update` rewrites
  `node_modules/three-mesh-bvh/src`. Without a `postinstall` re-application step the patch vanishes
  and the gate quietly starts producing wrong clearance answers again. This is the single most
  dangerous mode, because the symptom is order-dependent and intermittent.
- **`pretest` re-syncs an unpatched tree into `wwwroot/vendor`.** If the patch is applied only to
  `wwwroot/vendor` and not to `node_modules`, the very next `npm test` or `npm start` overwrites it.
  The patch must live at the `node_modules` source of truth (or the vendor sync must be re-pointed),
  never only in the vendored copy.
- **Worker/main-thread divergence.** If a future Phase 4 worker resolves `three-mesh-bvh` from a
  different path than the main thread, one side can be patched and the other not — which would
  break §6.4's byte-identical serialized-BVH criterion in a way that looks like a spike failure
  rather than a packaging error.
- **Ordering.** `postinstall` runs after `npm ci`, so patch-application there is correct; but any CI
  step that unpacks `node_modules` from a cache without re-running lifecycle scripts would skip it.
- **`--ignore-scripts` defeats a `postinstall` entirely.** `npm ci --ignore-scripts` skips patch
  application; `npm test --ignore-scripts` additionally skips `pretest`, so the vendor tree is not
  even resynced. Many corporate CI templates set this by default.
- **`patch-package` in `devDependencies` is absent from a production-only install**
  (`npm ci --omit=dev`), so the `postinstall` fails or silently no-ops depending on flags.
- **`patch-package` exits 0 on a failed local application by default** — it only fails closed when
  it detects CI. The `--error-on-fail` flag is mandatory, not optional.
- **A direct `node …` invocation bypasses npm lifecycle hooks altogether**, so a developer running
  `node test/performance/run-gate-m4.mjs` by hand gets whatever is on disk.
- **Patching only the template leaves both generated runtime files defective** — the template is not
  what runs.

**Two viable mechanisms, in preference order:**

1. **Native npm `patchedDependencies`** (`npm patch`). Preferred if the toolchain can be pinned:
   patch application is part of dependency *resolution* rather than a lifecycle script, so it
   survives `--ignore-scripts`, is represented in the lockfile, and fails closed. The local
   environment is `npm 12.0.2` / `node v22.23.1`, which supports it — but `package.json` declares
   only `"engines": { "node": ">=20" }` and **no npm floor**, and neither CI's nor deployment's npm
   version is recorded anywhere in the repo. Adopting this requires adding an npm engine pin first.
2. **`patch-package` with `"postinstall": "patch-package --error-on-fail"`**, as the compatibility
   fallback if npm cannot be standardised. Smaller blast radius than a vendored fork, but subject to
   every lifecycle-script failure mode above.

A **committed vendored fork** is justified only if install scripts are prohibited outright *and* npm
cannot be pinned — it carries far more vendored source and maintenance burden than two localized
defects warrant.

The mitigation for every residual failure mode is the same: **a checked-in test that fails loudly if
the patch is not present** (see Step 4, regression test 7), so a reverted patch can never be silent.

### Option C — mixed strategy (one fixed upstream, one patched locally)

**Vacuous.** C presupposes that at least one defect is fixed upstream. Step 1 establishes that
neither is, in any published version or on `master`. There is no upstream half to take. C reduces
to B.

---

## Step 4 — Recommendation

### Recommended remediation: **Option B**

**Retain `three-mesh-bvh@0.9.14` exactly as pinned, and apply two local patches, carried in-repo and
re-applied automatically on install.**

Specifically:

1. **Patch 1 (Defect 1)** — in `src/core/cast/closestPointToGeometry_indirect.generated.js`,
   `src/core/cast/closestPointToGeometry.generated.js`, and
   `src/core/cast/closestPointToGeometry.template.js`: change the outer shapecast's
   `intersectsRange: ( offset, count ) => {` to
   `intersectsRange: ( offset, count, contained, depth, nodeIndex, box ) => {` and, as the first
   statements of the body, `obb2.min.copy( box.min ); obb2.max.copy( box.max );
   obb2.needsUpdate = true;`. `shapecastTraverse` already supplies the visited node's own box on
   every path including root-is-leaf (`shapecast.js:60`), so this is exact, allocation-free and
   multi-root-safe. (The `getBoundingBox`-seeding variant also works and was validated, but is
   conservative rather than exact for multi-root BVHs and allocates per call — prefer the above.)
2. **Patch 2 (Defect 2)** — in `src/math/OrientedBox.js`, lines 419 and 423:
   `max[ f2 ]` → `max[ f3 ]` in the `start[ f3 ]` and `end[ f3 ]` assignments only. Leave the
   `start[ f2 ]` / `end[ f2 ]` assignments alone; they are already correct.
3. **Delivery** — carry the patchset in-repo so a reinstall cannot silently revert it. Preferred:
   **native npm `patchedDependencies`** (`npm patch`), which applies during dependency resolution,
   survives `--ignore-scripts`, and is recorded in the lockfile — but this requires first adding an
   **npm engine pin** (`package.json` declares only `"node": ">=20"` today, and no CI/deployment npm
   version is recorded in the repo). Fallback if npm cannot be standardised:
   `patches/three-mesh-bvh+0.9.14.patch` with
   `"postinstall": "patch-package --error-on-fail"` — the flag is mandatory, since `patch-package`
   otherwise exits 0 after a failed local application. Keep the exact pin `"three-mesh-bvh":
   "0.9.14"`. Do **not** bundle a 0.9.15 bump — it fixes nothing here, and it would contaminate the
   before/after comparison as well as invalidating the spec's literal version references.
4. **Record the runtime as `three-mesh-bvh@0.9.14 + <patch hash>`** wherever M4 records provenance.
   §6.4 currently identifies the pinned build **by version alone** ("both sides run the same pinned
   `three-mesh-bvh@0.9.14` build"), which is no longer a sufficient identifier once a patch exists —
   two installs can report the same version and behave differently. Both the main thread and any
   future worker realm must install the identical patchset.
5. **Land it as its own commit/PR**, separate from M4 work, even though it lives on the M4 branch —
   it is a dependency hotfix that M4 depends on, not an M4 deliverable (see scope classification).
6. **Upstream** — file separate reports against `gkjohnson/three-mesh-bvh` for: (i) the stale `obb2`
   on root-leaf traversal, (ii) the `max[f2]` edge-coordinate typo, (iii) the incomplete OBB/AABB SAT
   and its false-zero distance (§2.3), and (iv) the root-leaf `maxThreshold` bypass. **Only (i) and
   (ii) block this repository's M4 rerun.** M4 must not wait on any of them.

**Why not A:** there is nothing to upgrade to. **Why not C:** it presupposes an upstream fix that
does not exist.

### Mandatory regression tests accompanying the eventual fix

Concrete scenarios, not categories. Each must fail on unpatched 0.9.14.

1. **Root-is-leaf `closestPointToGeometry` order-independence.** Unit test, plain Node, no Viewer.
   Build a 2-triangle quad anchor (`new MeshBVH(geometry, { indirect: true })`, assert
   `bvh._roots[0].byteLength === 32` and `IS_LEAF` on the root) and a 72-triangle grid far operand
   with its own `boundsTree` at distance 0.05. Call `closestPointToGeometry` with
   `maxThreshold = 0.5` four times, interleaving a *different* `closestPointToGeometry` call whose
   anchor is a multi-node BVH translated 1000 units away. **Assert all four calls return
   `0.05000000074505806`** — i.e. exactly one distinct value, equal to the brute-force minimum.
   On unpatched 0.9.14 this yields `[0.05, null, 0.05, null]`. Include the multi-node control
   (must be stable both before and after) so the test cannot pass by accident.
2. **Exact-distance reference regression for `OrientedBox.distanceToBox`.** Unit test with three
   parts: (a) the named worst-case operand tuple from §2.2 — OBB local
   `min [-0.3804163099641057, -0.9479515318050755, -2.03228256792402]`,
   `max [0.4589844705345968, 1.8687230714451164, 0.7140377524374228]`, the 16-element matrix printed
   above, AABB `[0,0,0] .. [1.334708213962013, 3.561825842858211, 1.3125964404608106]` — **assert
   `distanceToBox` returns `0.015450309808991687`, not `0.045563153441575466`**; (b) a sweep of at
   least 5000 deterministic pseudo-random disjoint OBB/AABB pairs with **non-cubic** AABBs asserting
   **zero over-estimates** against an in-test independent exact reference (vertex-vs-body plus all
   12×12 edge-edge, box edges enumerated in local index space); (c) the cube-AABB control asserting
   the patch is a no-op there. Part (b) is what makes this a *reference* regression rather than a
   golden-value one. Extend (b) to also assert the returned **`target1` / `target2` witness points**
   lie on their respective boxes and realise the reported distance, and include **zero-thickness**
   AABBs (a degenerate BVH node bound is common for planar fragments). The cube control in (c) is
   diagnostic only — a **rectangular AABB per axis permutation** is the more valuable coverage,
   since the typo's effect depends on which axis lands in the `f2`/`f3` roles.
3. **The real `structure:2761 → structure:3980` clearance case.** Live-fixture test on the real
   federated model: `findClashes({ mode: 'clearance', clearance: 0.05,
   source: { model: structureModel, dbIds: [2761] }, target: all models, groupBy: 'dbId' })` under
   **both** `broadPhase: 'tlas'` and `broadPhase: 'linear'`. Assert the pair
   `structure:2761 → structure:3980` reports `distance === 0.026129089841138233` under **both** arms
   (today TLAS gives `0.03193299065509384`), and that fragment pair `358 ↔ 461` produces a
   `clearance-distance-query` `hit`, not `beyond-threshold`, in both arms. This is the only test
   that closes the loop from library defect to public `ClashPair` value.
4. **TLAS-vs-linear §6.4 parity on the previously failing S2 tuple.**
   `node test/performance/run-gate-m4.mjs --cases=S2 --runtimes=multi-process --repetitions=1`
   must reach `parity cold:MATCH warm:MATCH` at `S2[k=100:typical:clearance]` with
   `distanceDiffCount: 0` and `witnessDiffCount: 0` in the `structure|structure` partition
   (today: `distanceDiffCount: 1`, `witnessDiffCount: 1`, `maxDistanceDelta 0.0058039008139556085`,
   `maxWitnessDelta 0.2223360227743285`). **§6.4 must not be relaxed to achieve this** — the
   comparator is what caught the defect and stays exactly as strict as written.
5. **Full collision test suite passes.** `npm test` → 1012 tests, 1011 pass / 0 fail / 1 todo
   (exit 0), with **no assertion edited to accommodate a changed value** unless that assertion is
   separately shown to have been encoding a defective distance.

   **This gate needs a pre-patch baseline, because the suite is already flaky.** Measured today over
   four consecutive full runs on an unpatched tree:

   ```
   run A exit=0 (pipeline masked)  # pass 1010  # fail 1  # todo 1   [duct through beam]
   run B exit=1                    # pass 1009  # fail 2  # todo 1   [duct through beam; a proven crossing overlap is conclusive:true]
   run C exit=1                    # pass 1010  # fail 1  # todo 1   [duct through beam]
   run D exit=0                    # pass 1011  # fail 0  # todo 1   []
   ```

   `test/query/ContainmentModeQuery.test.mjs` "duct through beam, no vertex inside either (round 7
   regression)" passes **6/6 in isolation** but fails in 3 of 4 full-suite runs; the crossing-overlap
   test fails intermittently too. Both run through `ProperCrossingQuery`'s wall-clock crossing budget
   — the one legitimately non-deterministic source §6.4 itself names. `not ok 750` is the
   todo-marked known aspect-ratio gap and is expected. **None of this is caused by these defects**
   (neither test goes through `closestPointToGeometry`), and it must be recorded as the pre-patch
   baseline so a post-patch failure of the same two tests is not misread as a patch regression —
   nor a patch regression excused as "just the known flake". Ideally the flake is stabilised
   separately, before the patch lands, so this gate has an unambiguous pass condition.
6. **M1/M2/M3 regression gates unchanged in source and still passing as applicable.**
   `git diff` must show **zero** changes to `test/performance/run-gate.mjs`,
   `test/performance/run-gate-m2.mjs`, `test/performance/run-gate-m3.mjs`, and each must be executed
   and pass. `run-gate-m3.mjs`'s existing max-distance-delta-of-exactly-0 measurement over shared
   keys is the M3-side check that the patch did not perturb agreement between paths.
7. **Clean-install patch-integrity guard (required by the delivery mechanism).** After a clean
   `npm ci`, assert three things: (a) the resolved version **and the patch identity** (patch file
   hash, or a marker the patch introduces) are both what the lockfile declares — version alone is
   not a sufficient identifier once a patch exists; (b) tests 1 and 2(a) execute and pass, since
   both fail on an unpatched tree, giving a *behavioural* rather than merely textual guard;
   (c) the patched files under `node_modules/three-mesh-bvh/src/` and their copies under
   `wwwroot/vendor/three-mesh-bvh/src/` are **identical after `sync-vendor.mjs` has run**
   (`scripts/sync-vendor.mjs` copies unconditionally and validates nothing). Without this, a
   cache-restored `node_modules`, an `npm update`, or an `--ignore-scripts` install reverts the fix
   and the only symptom is intermittent, order-dependent wrong clearance answers.
8. **Multi-root fixture with two widely-separated root-leaf groups.** A geometry with two groups,
   each ≤ `targetLeafSize` triangles and far apart, so `bvh._roots.length === 2` and **both roots are
   leaves**. Assert `closestPointToGeometry` returns the exact brute-force minimum under the same
   perturbed-predecessor sequence as test 1. This is the test that **distinguishes the recommended
   `intersectsRange` patch from the looser `getBoundingBox` union seed** — the union seed passes
   test 1 but is measurably more permissive here, and only the exact patch keeps each root's own
   bound. Without it, a future maintainer could "simplify" to the union seed undetected.
9. **Finite-`maxThreshold` Defect 2 case.** §2.2's end-to-end proof used `maxThreshold = Infinity`,
   which exercises only the `score < closestDistance` conjunct. Production always passes a finite
   `anchorLocalMaxThreshold` (`ClearanceQuery.js`), so add a case where the **true** distance is
   inside `maxThreshold` but the **buggy** over-estimated score exceeds it — the worst-case tuple in
   test 2(a) supplies the bracket directly: any `maxThreshold` in
   `(0.015450309808991687, 0.045563153441575466)` is falsely pruned before the patch and admitted
   after it. Assert a non-`null` result with the correct distance.

### Scope classification

**This is a prerequisite correctness fix that M4 Phase 3 is blocked on. It is NOT an M4 scope
change, and it is NOT worker-related evidence.**

- **Prerequisite, not scope creep.** The defects are in a pinned third-party dependency, not in
  `collision/` and not in M4's harness. `collision/` is untouched by the entire M4 effort. M4's
  §6.4 comparator behaved exactly as designed: it detected a genuine correctness violation and
  refused to pass. Phase 3 cannot produce a valid canonical matrix while a clearance query can
  silently return a false negative, because every downstream M4 verdict is conditioned on
  correctness holding. Fixing the dependency is what makes the *existing* M4 scope executable — it
  adds no new M4 deliverable, no new instrumentation (§16.4's list stays closed), and no new spike.
- **Explicitly not worker-related evidence.** The defect has nothing to do with the
  worker-vs-main-thread decision M4 exists to make. It reproduces in **plain Node, in one process,
  with no worker, no `CollisionWorld`, and no Viewer** (§2.1 above), and it reproduces in the browser
  with a **single source dbId**. The TLAS-vs-linear broad phase merely permutes the order in which
  candidate pairs reach the narrow phase, and that order is what decides whether the stale `obb2`
  happens to be benign — **either arm can produce the wrong answer**. Neither arm is "correct";
  the parity check found a latent library defect by accidentally perturbing evaluation order.
  Recording this as worker or broad-phase evidence would corrupt M4's decision inputs.
- **Pre-existing, not introduced.** Both defects are present in 0.9.14 as published (2026-08-01),
  in 0.9.15, and on upstream `master`. The typo at `OrientedBox.js:419/423` and the `obb2`
  initialisation gap predate this repository's use of the library.

### Consequence for Phase 3

Until the fix lands, `S2[k=100:typical:clearance]` will keep aborting the full-matrix run. The two
acceptable dispositions are (i) fix the dependency per Option B and re-run, or (ii) record the tuple
as a named known finding and re-run — **but not** by relaxing §6.4, which is the mechanism that
caught it, and not by treating the divergence as a TLAS defect, which it is not.

---

## Second opinion — `codex-advisor`, effort `high`, request `20260910-182830-34174-31257`

A `codex-advisor` consult was run on the full evidence set before this document's conclusions were
finalised. **Every finding below was independently re-verified against the source here before being
recorded** — none is taken on trust.

**Confirmed:**

- The pruning-direction analysis: only an *over*-estimate can false-prune, because both predicates
  are `score < …`. It added a fourth failure class worth naming — **`NaN`**, which makes *both*
  comparisons false and prunes unconditionally; the stale `obb2` is "not a bound at all" and can
  behave like an arbitrary over-estimate.
- Option B, and rejection of the 0.9.15 bump as remediation.
- The scope classification: prerequisite dependency hotfix, not worker evidence, not M4 scope.
- Regression tests 1-6 as proposed.

**Changed my analysis:**

1. **Patch 1 variant.** It reached the `intersectsRange`-box patch independently and argued it over
   the `getBoundingBox` seed on multi-root grounds — the same conclusion I had reached from
   `shapecast.js:60` and validated, and it supplied the argument that corrected my "no-op for every
   multi-node BVH" phrasing (a multi-root BVH can hold internal *and* root-leaf roots at once). It
   also warned against the tempting broader fix — making `shapecast` call `intersectsBounds` on
   roots — because that changes public callback and depth semantics for every existing client.
2. **A third defect (§2.3), and a correction to an overclaim.** It found the incomplete 6-of-15-axis
   SAT in `OrientedBox.intersectsBox` and challenged my "0/18239 over-estimates after the typo fix"
   as an implied claim that `distanceToBox` was fully characterised. It was right: my sweeps filter
   `if ( lib === 0 ) continue;`, which excludes exactly the class where the SAT defect lives. I
   verified the defect from source and reproduced it independently (947 provably-disjoint pairs
   reported as intersecting out of 11301, worst true gap 1.008 reported as 0) and rescoped the
   claim. **This is the single most valuable thing the consult added** — without it the report would
   have asserted something false.
3. **Delivery mechanism.** It supplied the native-npm `patchedDependencies` option (preferable
   because it survives `--ignore-scripts` and is lockfile-represented), the mandatory
   `patch-package --error-on-fail` flag (it otherwise exits 0 on local application failure), and
   four failure modes I had not enumerated: `--ignore-scripts` on both `ci` and `test`,
   `patch-package` missing under `--omit=dev`, direct `node …` invocation bypassing hooks, and
   patching only the template.
4. **Provenance identifier.** §6.4 identifies the pinned build by *version alone*, which stops being
   a sufficient identifier once a patch exists — hence recommendation 4.
5. **Three added regression tests** (8, 9, and the strengthened 7), plus witness-point and
   zero-thickness coverage in test 2.

**Its stated uncertainties**, recorded honestly: it could not inspect the out-of-tree oracle or the
18239-case generator, so it could not itself determine why they missed the SAT case (answer: the
`lib === 0` filter — confirmed here); and it did not run `npm test`, because `pretest` writes to the
vendor directory and that would have violated the read-only constraint.

---

## Provenance

- Reproduction and validation scripts (scratchpad, not part of the repo):
  `/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/0a66274d-41b6-465b-8f3b-2512eb2770f8/scratchpad/`
  — `repro-defect1-obb2.mjs`, `repro-defect2-final.mjs`, `repro-defect2-endtoend.mjs`,
  `repro-defect2-distanceToBox.mjs`, `repro-defect2b-isolate.mjs`, `repro-defect2c-direction.mjs`,
  `repro-defect3-sat.mjs`, `verify-patches.mjs`, `verify-patch1alt.mjs`,
  `patched/cptg-fixed.mjs`, `patched/cptg-fixed2.mjs`.
- `codex-advisor` consult transcript:
  `.codex-worker/responses/20260910-182830-34174-31257/response.md`.
- Upstream artefacts fetched 2026-09-10: npm registry metadata for `three-mesh-bvh`; the
  `three-mesh-bvh-0.9.15.tgz` tarball; `master` copies of `src/math/OrientedBox.js` and
  `src/core/cast/closestPointToGeometry.template.js`; `CHANGELOG.md`; GitHub issue/PR search.
- Prior investigation this document builds on and independently re-verifies:
  `.superpowers/sdd/2026-09-09-collision-library-milestone4-performance-worker-decision-implementation/s2-clearance-divergence-investigation.md`.
- A first pass of the Defect 2 reference implementation was **wrong** — it derived OBB edges by
  float-equality on *transformed* corners, which finds no edges at all, so it silently omitted every
  edge-edge candidate and reported "0 over-estimates". The error was caught by a dense-sampling
  upper bound that the reference exceeded in 118/3662 cases. The corrected reference (local-index
  edge enumeration) agrees with the typo-fixed port in 18239/18239 cases. Recorded because the first
  pass would have produced the opposite recommendation for Defect 2.
