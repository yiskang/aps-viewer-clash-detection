# SVF2 Non-Uniform Fragment Transforms for Soft (Clearance) Queries — Design

- Date: 2026-10-07
- Status: **IMPLEMENTED (T0–T7)** within the bounded owner authorization, plus one owner-authorized **bounded amendment** — no-clearance-surface classification (§5.7). Not committed. Ready for the **targeted independent Work review**. Implementation closeout: [`docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md`](../../research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md) §12. (History: the design-only revision converged through the internal Codex loop of §11 before implementation was authorized.)
- Owner decisions as applied (§9):
  - **O-1** reflected (negative-determinant) fragments stay `'unsupported'` (`clearance-anisotropic-scale-unsupported`); legacy-SVF output stays bit-identical.
  - **O-2** per-format expected values for the Soft distances (SVF and SVF2 values recorded separately); the acceptance `distanceTolerance` (1e-6) is **not** widened. (The acceptance-suite re-baseline itself belongs to the acceptance package, not to this design.)
  - **O-3** applied as the default: the reason string `clearance-anisotropic-scale-unsupported` is kept (meaning narrowed), so `KNOWN_DIAGNOSTIC_REASONS` is untouched.
  - **O-5** applied as the default: the derived mesh is built from a second raw Viewer read (world-unit weld); variant F stays the documented fallback.
- Amendment (owner-authorized, bounded, 2026-10-07): a non-uniform operand whose canonical record has 0 triangles is classified `'no-surface'` before every anisotropic-eligibility rule and is a silent clean negative (no diagnostic, legacy-SVF parity), visible through the accessor counter `noSurfaceOperands` — §5.7.
- M3 performance gate (T7), criterion (d) — legacy-SVF Soft timings within the existing M3 thresholds: **CAUTION**. Worst single legacy-SVF call 9.6 ms vs the 8 ms frame budget; historical legacy gate runs of the same unchanged path span GO (6.1 ms) to NO-GO (19.5 ms), and the legacy path is bit-identical by the T0 golden test. Criteria (a) build accounting, (b) derived memory (0.048× SVF canonical) and (c) SVF2 wall time (0.9–1.5× SVF) PASS (agent-reported). **Adjudication of (d) is left to the targeted independent Work review**; the M3 contract/gate was neither optimized nor altered.
- Scope authority: owner authorization (bounded, 2026-10-07) to support real SVF2 non-uniform fragment transforms for Soft (clearance) queries, preferring a clearance-specific transformed-geometry path that preserves the canonical mesh-identity contract; no global baking of scale into shared meshes; no rewrite of unrelated collision semantics; no change to the clearance distance definition; legacy-SVF uniform-scale results must stay bit/semantically identical.
- Root-cause input: [`docs/research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md`](../../research/2026-10-07-viewer-clash-panel-normal-app-model-identity-final-report.md) §11 "Cause 3".
- Governing prior design: [`2026-09-07-collision-library-milestone3-clearance-design.md`](2026-09-07-collision-library-milestone3-clearance-design.md) §3 / §5 / §9 / §12 / §15 (fixtures 15–16); `collision/README.md` diagnostics table (~l.385) and transform contract (~l.955).

## 1. Problem (measured facts)

SVF2 (OTG) normalizes every mesh to a `[-0.5, 0.5]³` unit cube and moves the element's dimensions into the fragment world matrix. Measured on the Audubon fixtures (Viewer 7.124.2):

| | Struct SVF | Struct SVF2 | Arch SVF | Arch SVF2 |
|---|---|---|---|---|
| fragments | 543 | 543 | 5435 | 5435 |
| fragments failing `validateUniformScale` (tol 1e-4) | 0 | 541 | 2 (reflected) | 5432 |
| column orthogonality violations (> 1e-4 rel.) | 0 | 0 | 0 | 0 |
| negative-determinant fragments | 0 | 0 | 2 (frags 2820/2821) | 2 (same frags) |
| unique meshes (geomId) | 487 | 416 | 2643 | 1176 |
| unique (geomId, exact scale vector, det sign) | 493 | 478 | 2863 | 2375 |
| same, scale quantized to 5 sig. digits | 487 | 463 | 2644 | 2078 |

Example SVF2 scales: Struct frag 398 (dbId 197) `(0.583, 0.583, 7.333)`; frag 366/367 `(9.708, 0.583, 0.583)`; frag 352 `(0.331, 14.79, 0.993)`; roof frag 0 `(51.5, 0.686, 206.6)`; Arch frag 10 `(124.9, 27.2, 7.56)`. Every SVF2 world matrix is affine with orthogonal columns (no shear). The only negative-determinant fragments are also negative in SVF.

`collision/query/ClearanceTransform.js:25-71 validateUniformScale` rejects all of them, so `CollisionWorld._runClearanceNarrowPhasePair` (`collision/CollisionWorld.js` ~2380-2403) returns `'anisotropic-scale'` with a fragment-scoped `clearance-anisotropic-scale-unsupported` diagnostic (`diagnoseAnisotropicScaleOnce`, ~141), and SVF2 Soft queries return 0 pairs.

## 2. The clearance path end to end (as shipped)

1. **Entry / validation** — `findClashes` (~1262): `mode:'clearance'` requires a finite positive `clearance`.
2. **Extraction + admission** — shared with Hard modes. Clearance-only admission filter `isValidClearanceTransform` (~82, ~1516): finite 16-element `worldMatrix`, `det ≠ 0`, ordered finite `worldBounds`; failures → fragment-scoped `clearance-invalid-transform`.
3. **Broad phase** — `_runClearanceBroadPhaseScan` (~2013) or `_runClearanceTlasBroadPhase` (~2069): world AABBs (`placed.worldBounds`) inflated by `clearance`, exact `aabbMinDistance ≤ clearance`. World-space only; transform class is irrelevant here.
4. **Budget** — `_checkClearanceNarrowPhaseBudget` (`maxClearanceNarrowPhasePairs` = 20 000).
5. **Narrow phase per pair** — `_runClearanceNarrowPhasePair` (~2349):
   1. `resolveGeometryRecord` (~314) → `GeometryRegistry.getOrBuildGeometry({loadEpoch, geometryIndex, needsConnectivity:true})`, cached per `(loadEpoch, geometryIndex)` = `createGeometryIdentity` (`collision/geometry/GeometryIdentity.js`). Build = `resolveGeometryView` (synchronous Viewer read, `_resolveGeometryView` ~2946) → `compactAndWeld` (weld epsilon `weldEpsilonMeters / unitScale` **in the mesh's local units**) → connectivity → `ThreeMeshBvhBackend.build` (MeshBVH `indirect:true`, `geometry.boundsTree`, `localDiagonal`, `aspectRatioExceeded`, `geometryDigest`).
   2. `toInstance(record, placed.worldMatrix)` (~391) → `{geometry, bvh, localDiagonal, geometryDigest, connectivity, closedManifold, aspectRatioExceeded, matrix}`.
   3. `validateUniformScale` on both matrices → reject (this design's target).
   4. Hard-Clash exclusion precheck `classifyHardClashPrecheck` (`ClearanceHardClashPrecheck.js`) → `volumeOverlapQuery` on the **same canonical instances** (Hard-clash semantics), tri-state.
   5. `computeToleranceFloor` = `surfaceEpsilonFactor × max(localDiagonal × scaleFactor)` (world units).
   6. `clearanceQuery` (`ClearanceQuery.js:146`): re-validates uniform scale; anchors on the smaller-or-equal-scale operand; one `anchor.bvh.closestPointToGeometry(far.geometry, inv(anchor)·far, …, maxThreshold = clearance/anchorScale·(1+4e-4))`; distance measured in the **anchor's local frame** and converted by `× anchorScaleFactor`; world-unit cross-check against the far-frame distance (`clearanceCrossCheckAllowedDisagreement`); witness points mapped to world through each operand's own matrix (`toFiniteWorldArray`); post-filters `(toleranceFloor, clearance]`.
6. **Aggregation** — `compareClearanceCandidates` (distance, then `(loadEpoch, fragmentId)`), never `geometryIndex`/digest.
7. **Caches / lifecycle** — registry entries released per epoch (`_releaseEpochScopedState` ~960 → `releaseEntriesForEpoch`) and on `dispose` (`releaseAll`). Placement refresh `_refreshPlacementForEpoch` (~2624) swaps `_placementByEpoch` wholesale and releases the TLAS entry; geometry records are placement-independent and are not touched.

The **only** frame-dependent assumption in the distance computation is that each operand's matrix is rigid × uniform scale, so that one scalar converts local distance to world distance and the pinned traversal's mixed-frame prune is safe in the anchor direction (M3 §5).

## 3. Mathematical core

For an SVF2 fragment, `M = [A | t]` with columns `a₀, a₁, a₂` mutually orthogonal and `sᵢ = ‖aᵢ‖ > 0`. Let `σ = sign(det A)` and `S = diag(s₀, s₁, σ·s₂)`. Then `Q = A·S⁻¹` has orthonormal columns and `det Q = +1` (the default design admits only `σ = +1`; `σ = −1` is the reflection case deferred to owner decision O-1, §9), so

```
world(v) = A·v + t = Q·(S·v) + t.
```

A raw (pre-weld) mesh with vertices `v' = S·v` placed by the rigid matrix `M' = [Q | t]` is **the same world-space point set, triangle for triangle**, as the raw mesh placed by `M`. `M'` is rigid with scale 1, i.e. inside M3's supported class, so the existing `clearanceQuery` applies **unchanged** (anchor rule, threshold, cross-check, witness mapping all remain exact for scale 1).

**Equivalence contract (precise; revised after internal review C1).** The library never measures clearance on raw Viewer triangles: every operand is first normalized by `compactAndWeld` (tolerance weld + degenerate-triangle removal), and M3's distance is defined on that welded collision surface placed in world space. The contract this design keeps is therefore:

> derived surface = the library's existing normalization pipeline applied to the **world-scaled** raw triangles `S·v`, with the existing weld epsilon (`weldEpsilonMeters / unitScale`) interpreted in **world model units** — exactly what the legacy path does for an SVF fragment (whose mesh is already in world-scale units with a rigid/translation matrix).

Relative to the raw world triangles, the derived surface differs only by (a) the weld, which moves a merged vertex by at most `√3·ε_w` (world units; `mergeVertices` hashes each axis on an `ε_w` grid) and may remove triangles whose vertices merge — the identical, already-accepted normalization the legacy path applies to SVF geometry; and (b) float32 storage of `S·v`. It is **not** equal to "the canonical SVF2 record placed by `M`": that record was welded on the unit-cube grid, i.e. with an effective world tolerance of `ε_w·sᵢ` per axis (up to ≈0.068 ft on the Struct roof, s = 206) — the latent Cause-1 tolerance defect this design deliberately does not inherit.

**Reference surface (revised after the targeted re-review).** The design's normative surface is the *exact implemented* pipeline output: `fround(S·v)` → `mergeVertices(ε_w)` → `filterDegenerateTriangles`. Because `fround` happens before the weld, rounding can move a vertex across a weld-hash bucket boundary and change which vertices merge; that is the same bucket-boundary sensitivity the legacy path already has for SVF's float32 world-scale vertices, and this design neither adds to nor bounds it. Concretely: every **retained** derived triangle is within Hausdorff distance `√3·(2⁻²⁴·m_X + ε_w)` of a raw world triangle (`ε_w` term only where a merge happened); triangles **removed** by the weld are exactly the weld-degenerate ones, by the same rule as legacy. T5 therefore checks two separate things: (i) `clearanceQuery` on derived instances equals float64 brute force on the *same welded derived triangles* placed by `[Q|t]` (query exactness); (ii) agreement with raw world truth within the band above on the measured fixtures (§6).

**Numerical bound (pre-weld step only).** `v'` is stored as float32 (`ThreeMeshBvhBackend.build` uses `Float32BufferAttribute`); `fround(S·v)` (computed in float64 from the float32 source) moves each vertex by `≤ √3·2⁻²⁴·m_X`, where `m_X = max‖S·v‖_∞` over operand X's vertices (computable up front from the canonical record's local bounding box: `m_X ≤ maxᵢ sᵢ·max(|bboxMinᵢ|, |bboxMaxᵢ|)`). Because `Q` is orthonormal and the world-space min distance is 1-Lipschitz in each surface's Hausdorff perturbation, for a pair (A, B):

```
|d_derived − d_reference| ≤ √3·2⁻²⁴·(m_A + m_B)  (+ √3·ε_w per operand only where the weld actually merged distinct vertices)
```

where `d_reference` is the min distance between the float64-scaled surfaces **when the weld merges the same vertex sets** (otherwise the reference-surface paragraph above governs). This adds to (never replaces) M3's existing documented bounds (uniform-scale residual 1e-4 relative, cross-check tolerance). For SVF2's centred unit-cube meshes `m_X` is half the element's own extent, so this term is below the float32 quantization SVF itself carries at world coordinates.

**Supported numerical domain.** The derived path is defined for any positive-determinant, column-orthogonal affine transform (not only SVF2's normalized meshes), **provided** `m_X·(1 + 2⁻²⁴)` is finite and ≤ float32 max (`3.4028234e38`) — checked before the precheck, from the canonical bounding box (§5.1) — and every stored `fround(S·v)` coordinate is finite (re-checked at build, §5.6). Underflow/collapse is not an error: it is the weld's ordinary behaviour (vertices closer than `ε_w` merge, as for SVF geometry of the same world shape); a derived weld that leaves 0 triangles while the canonical record has > 0 is diagnosed (§5.6), never silently treated as "no clearance hit".

Residual non-orthogonality: if columns are orthogonal only to within ε (relative), `Q` is not exactly orthonormal but `Q·S = A` still holds exactly, so the world geometry is still exact; only the "scale 1" assumption inside `clearanceQuery` is off by O(ε). Gating `Q` through the **existing** `validateUniformScale` (tol 1e-4) therefore makes the derived path inherit exactly M3's already-documented residual bound — no new tolerance constant is introduced.

## 4. Candidate designs

### A. Clearance-only derived ("prescaled") mesh cache — **chosen**

A clearance-private cache, keyed `(loadEpoch, geometryIndex, S as exact float64 bits incl. sign)`, holding a derived record `{geometry, bvh, localDiagonal}` whose vertices are `S·v`. The fragment's remaining transform `M' = [Q | t]` is read from the live `placed.worldMatrix` at every query; the cache never stores placement. Feeds the unchanged `clearanceQuery`.

- *Equivalence*: exact pre-weld; post-weld it equals the legacy pipeline applied to world-scaled geometry, within the §3 bound; verified numerically (§6).
- *Canonical identity*: untouched — `createGeometryIdentity`, `GeometryRegistry` entries, `geometryDigest`, `getEpochGeometryEntries`, BLAS/TLAS caches are not modified, and the derived record never enters them.
- *Cost*: one extra weld + BVH per distinct `(mesh, S)` that actually reaches the clearance distance query. Worst case if every fragment did: Struct ≤ 476, Arch ≤ 2372 derived meshes — the same order as SVF's own canonical counts (487 / 2643), i.e. SVF2 Soft memory ≲ SVF Soft memory. Built lazily, only after the Hard-Clash precheck says `proceed`/`skip-precheck`.
- *Sharing*: exact-bits keying shares only identical scales (Struct 478 vs 543 frags; Arch 2375 vs 5435). Quantized keys (5 sig. digits → 463 / 2078) were rejected: they would change world geometry by up to 5e-5 relative and break exactness for a < 15 % saving.

### B. Per-pair world-space evaluation

Transform one or both operands to world (or into the other's frame) per pair. Building a BVH per pair costs O(pairs) builds (up to 20 000) instead of O(distinct meshes); evaluating without a BVH on one side is O(n·m) triangles. Either way it needs the anchor to be rigid, which already requires a prescaled BVH — so B is A with no caching. Rejected (cost).

### C. Anisotropy-aware clearance traversal

Own a copy of `closestPointToGeometry` that measures in world units (transform both trees' bounds to world, OBB-vs-OBB scoring in world units). Rewrites M3 §3/§5 semantics, removes the protected "exactly one pinned `closestPointToGeometry` call per pair" invariant, and re-opens the anchor/false-prune analysis. Rejected (outside authorization: rewrites collision semantics).

### D. Prescale only the anchor, keep the canonical far operand

The pinned traversal's nested prune is safe only if the far operand's local units are never "longer" than the anchor's in any direction (M3 §5). With a rigid anchor (scale 1) that requires `min(sᵢ_far) ≥ 1`; SVF2 has scales down to 0.33 and below. Rejected (false negatives).

### E. Bake scale into canonical/shared meshes (global)

Explicitly excluded by the authorization; would change mesh identity, digests, Hard-clash geometry and caches. Rejected.

### F. Derive from the canonical (local-unit-welded) geometry instead of the raw Viewer view

A cheaper variant of A: prescale `record.geometry` positions. No second Viewer read, but it inherits the canonical weld, which runs at `weldEpsilonMeters/unitScale` in **unit-cube local units**: world displacement per merged vertex up to `eps_local × sᵢ` (≈ 3.3e-4 × 206 ≈ 0.068 ft on the Struct roof). That contradicts "weld tolerance in world units for the derived mesh" and SVF's own weld semantics. On the four live fixture pairs it happens to give identical results (§6), but it is not guaranteed. Kept only as the documented fallback if the second Viewer read is ever judged unacceptable.

## 5. Chosen design (A, raw-view variant)

### 5.1 Per-operand transform classification (pure, before the precheck)

New module `collision/query/ClearanceTransformClass.js`:

```
classifyClearanceTransform(matrix /* THREE.Matrix4 — the Instance.matrix toInstance() already builds */,
                           localBox /* THREE.Box3 — the canonical record's geometry.boundingBox (local frame) */) →
  { path: 'uniform', scaleFactor }                         // validateUniformScale(M) valid  → legacy path, unchanged
| { path: 'derived', scale: [s0, s1, s2], rigid: Matrix4 } // orthogonal columns, det > 0, validateUniformScale(Q) valid, in numerical domain
| { path: 'unsupported', cause: 'reflected' | 'non-orthogonal' | 'numeric-domain' | 'other' }
```

Input type is `THREE.Matrix4` (the conversion point stays `toInstance`, ~391); the function never mutates its input. The returned `rigid` is a **fresh, non-aliased** `Matrix4` per call (never a module scratch), and `scale` a fresh array — two back-to-back classifications (source, target) must not share state (tested, T1). `localBox` is read from the canonical record's `geometry.boundingBox` (already computed by `ThreeMeshBvhBackend.build`); `toInstance`'s output shape is not changed — the narrow-phase code passes the record's box alongside.

Rules, in order:
1. `validateUniformScale(M)` valid → `'uniform'`. This is evaluated **first** and returns the legacy result object, so every operand that is supported today takes the byte-identical legacy path.
2. Otherwise compute `sᵢ = ‖aᵢ‖`, `Q = A·S⁻¹` (`σ = +1` only — see §9 item O-1), and require `det A > 0` and `validateUniformScale([Q|t]).valid` (this single existing call enforces finiteness, affine bottom row, orthogonality within 1e-4, and |scale − 1| within 1e-4). Failing `det > 0` → `'reflected'`; failing the `Q` check → `'non-orthogonal'`.
3. Numerical domain (§3): `m = maxᵢ sᵢ·max(|localBox.min[i]|, |localBox.max[i]|)` (components x/y/z); require `Number.isFinite(m)` and `m·(1 + 2⁻²⁴) ≤ 3.4028234e38`; else `'numeric-domain'`. Pass → `'derived'`.
4. Otherwise `'unsupported'/'other'`. `det = 0` / non-finite never reach here (rejected at admission by `isValidClearanceTransform`, `clearance-invalid-transform`).

*Amendment (§5.7):* a rule **1a** sits between rules 1 and 2 — `triangleCount === 0` (canonical record, passed as an optional third argument `{ triangleCount }`) → `{ path: 'no-surface' }`.

### 5.2 Derived geometry cache

New module `collision/geometry/ClearanceDerivedGeometryCache.js`, owned by `CollisionWorld` (constructed in `fromViewer` beside the registry), **not** by `GeometryRegistry`:

- Key: `Map<loadEpoch, Map<"geometryIndex|bits(s0)|bits(s1)|bits(s2)", entry>>`, bits = the float64 bit pattern (deterministic, collision-free for distinct scales).
- **Lifecycle state machine (revised after internal review C2) — the same rigor as `GeometryRegistry`** (`_insertBuildingEntry` / `_runPhase` / `_removeIfSame` / `releaseEntriesForEpoch` / `releaseAll`), implemented as its own small class rather than by abusing the registry's integer `geometryIndex` key:
  1. On a miss, a `building` placeholder with its own cancellation signal is inserted **synchronously, before any checkpoint/await**; concurrent callers for the same key share its one promise (single flight — at most one build per key per epoch at a time).
  2. The build runs as: registry-style checkpoint `{loadEpoch}` (the world's long-lived registry checkpoint port, so liveness/disposal are validated) → synchronous `_resolveGeometryView` + `compactAndWeld(…, {positionScale})` + `ThreeMeshBvhBackend.build`, with no await between the Viewer read and the copy (same protected invariant as `buildWeld`). The whole attempt is raced against the entry's cancellation signal.
  3. Success publishes `{state:'ready', geometry, bvh, localDiagonal, triangleCount}` **only if the placeholder is still the bucket's current entry for that key** (a released/evicted/superseded build never publishes and never recreates a bucket for a dead epoch).
  4. Any rejection removes **only the matching placeholder** (`removeIfSame`) and propagates; nothing is cached for a transient failure, so the next call retries.
  5. Deterministic unsupported outcomes (§5.6: non-finite scaled coordinate) are cached as a per-key `unsupported` marker (they are pure functions of the key).
  6. `releaseEpoch(epoch)` (model eviction only) rejects every in-flight waiter of that epoch with `ModelEvictedError`; `releaseAll()` (dispose only) with `WorldDisposedError`; both drop the buckets.
  7. `detachEpoch(epoch)` (placement change: `invalidateModelPlacement`, successful `_refreshPlacementForEpoch` publish) is **non-cancelling**: it replaces the epoch's bucket with a fresh empty one; in-flight builds keep running and resolve their existing waiters normally, but their publish check (step 3) fails against the new bucket, so they are never cached. A placement change can never abort a live query (it is not an eviction; exact-scale keys already make stale geometry impossible).
- `compactAndWeld` gains one optional `positionScale` option: applied to the compacted float32 positions (multiply in float64, store float32) **before** `mergeVertices`. Absent ⇒ byte-identical to today; canonical callers never pass it.
- Weld epsilon is the same `weldEpsilonMeters / unitScale` value, now applied in the derived mesh's frame, which is **world model units** (scale 1) — the SVF semantics (§3 contract). `localDiagonal` of the derived mesh is already in world units.
- **Second Viewer read — consistency (revised after internal review I3).** The canonical `GeometryRegistry` already caches one record per `(loadEpoch, geometryIndex)` for the epoch's whole lifetime and never re-reads it, i.e. the library already relies on raw Viewer geometry being **immutable per `(loadEpoch, geometryIndex)`** while the epoch is live. The derived build relies on exactly that existing assumption — it is not new — and this design states it explicitly in the README transform section as a supported-limitation note (no runtime mismatch detection is added: the registry keeps no pre-weld fingerprint to compare against, and adding one would touch the canonical record contract). The only runtime guard is the one the canonical path already has: a second read that comes back without a proxy or with an unsupported layout is handled as a transient failure (§5.6). If the owner prefers zero second reads, variant F (§4) removes them at the cost of the documented local-weld residual.
- **Release and memory bound (revised after internal review C3).** The linear broad phase (default for the legacy `{model,dbIds}` shape) uses the *current call's* freshly extracted matrices, so scales can change without any `_refreshPlacementForEpoch`. Therefore:
  - the epoch's derived bucket is released (`releaseEpoch`) in `_releaseEpochScopedState` (eviction) and `dispose` (`releaseAll`), and **detached non-cancellingly** (`detachEpoch`, step 7) on `invalidateModelPlacement` (every broad-phase mode — the public signal that placements changed) and on a successful `_refreshPlacementForEpoch` publish;
  - independently of any caller discipline, each epoch bucket has a hard **byte** budget, new provisional constant `maxClearanceDerivedGeometryBytesPerEpoch` (proposed 256 MiB; retuned at the M3 gate like every other provisional budget), over the actual retained position + index + BVH bytes of ready entries, plus an entry-count cap of `maxCollisionInstancesPerEpoch` (20 000) that also covers `unsupported` markers. Exceeding either evicts least-recently-used ready/marker entries (never a `building` one) until both hold. A single entry always fits: each derived mesh has ≤ `maxSyncTriangleCount` (12 000) triangles, i.e. a few MB at most. Note the derived mesh is **not** guaranteed smaller than the canonical record (the world-unit weld may merge fewer vertices than the unit-cube weld), which is why the budget is in bytes. Eviction only costs a rebuild — entries are pure functions of their key — so results are unaffected and remain deterministic;
  - correctness never depends on any release: a changed scale is a different key and the rigid part `[Q|t]` is always read from the live `placed.worldMatrix`.
  This makes the memory bound unconditional per live epoch. The only new constant is `maxClearanceDerivedGeometryBytesPerEpoch` (additive in `collision/constants.js`); no new `CapacityExceededError` kind is introduced.
- `oversized`/unsupported-layout cannot newly arise from a consistent second read (same triangle count/layout as the canonical record, which must already have resolved).
- Never visible to Hard modes: only `_runClearanceNarrowPhasePair` calls it; `_runNarrowPhasePair`, `resolveGeometryRecord`, `getEpochGeometryDiagnostics`, the TLAS cache and every M1/M2 query are unchanged.

### 5.3 Narrow-phase integration (`_runClearanceNarrowPhasePair`)

1. Resolve both canonical records (unchanged; still needed for the precheck).
2. `classifyClearanceTransform(instance.matrix, record.geometry.boundingBox)` for both operands (replaces the bare `validateUniformScale` calls at ~2383-2403). Any `'unsupported'` side → existing `diagnoseAnisotropicScaleOnce` + `'anisotropic-scale-before-precheck'` + `{outcome:'anisotropic-scale'}` — identical shape, dedup and ordering.
3. Hard-Clash precheck on the **canonical** instances (`toInstance(record, placed.worldMatrix)`), unchanged. Derived meshes never feed `volumeOverlapQuery`.
4. For each `'derived'` side, `derivedCache.get(...)` → distance instance `{geometry, bvh, localDiagonal, matrix: rigid}`; `'uniform'` sides keep the canonical instance object.
5. `computeToleranceFloor` and `clearanceQuery` called exactly as today on those distance instances (`scaleFactor` from re-validating the distance instance's matrix — ≈1 for derived). Mixed uniform/derived pairs are already handled by the anchor rule.
6. Derived-build failures map per the §5.6 table.
7. Diagnostic-event covariates (`clearance-distance-query` recorder event only): `sourceTriangles`/`targetTriangles` report the **distance instance actually traversed** (derived `triangleCount` for a derived side), and `sourceTransformPath`/`targetTransformPath` (`'uniform'|'derived'`) are added; recorder-only, not part of `statistics`.

`ClearanceQuery.js` itself is **not modified** (its own `validateUniformScale` gate stays as defence in depth and is satisfied by construction).

### 5.4 Diagnostics

- `clearance-anisotropic-scale-unsupported` is **kept** (same string, scope, dedup, `precheckNotRunReason`), with its meaning narrowed to "transform outside the supported clearance class": shear/non-orthogonal beyond 1e-4, reflected (negative determinant), or a derived rigid part that fails validation. Keeping the string avoids changing `clashtest/execution/diagnostics.js` `KNOWN_DIAGNOSTIC_REASONS` and its drift test. Renaming it is optional (§9 O-3).
- No new `statistics` keys (the clash-test executor rejects unknown keys: `clashtest/execution/UnitExecutor.js:562` `statistics-unknown-key`). Derived-cache observability goes through a new, **required**, additive read-only accessor `getEpochClearanceDerivedGeometryDiagnostics(epoch)` → `{ readyEntries, buildingEntries, unsupportedEntries, builds, hits, sharedWaits, evictions, retainedPositionBytes, retainedIndexBytes, retainedBvhBytes }` (cumulative counters per live epoch; same `WorldDisposedError` / empty-default conventions as the existing three diagnostic accessors). *Amendment §5.7 adds `noSurfaceOperands`.* `getEpochGeometryDiagnostics`'s exhaustive shape (M4 Metric M) is untouched.

### 5.5 Determinism

The derived record is a pure function of (raw Viewer geometry, exact `S` bits, weld epsilon). Aggregation tie-breaks still use only distance and `(loadEpoch, fragmentId)`. The derived record has a digest internally (`build` computes one) but it is never read, exposed, or used for ordering. LRU eviction (§5.2) affects only cost, never results.

### 5.6 Derived-path failure table (added after internal review I2)

All diagnostics below are existing reason strings with existing scope/dedup; no `statistics` key changes. "Before precheck" outcomes keep the existing `precheckNotRunReason` events.

| Condition | Where detected | Cached? | Diagnostic (scope, reason) | Pair outcome | Retry |
|---|---|---|---|---|---|
| reflected / non-orthogonal / numeric-domain / other (§5.1) | classification, before precheck | n/a (pure) | fragment, `clearance-anisotropic-scale-unsupported` (deduped per `(epoch, fragmentId)`) | `'anisotropic-scale'` | no (deterministic) |
| `RenderProxyUnavailableError` on the second read | derived build | no (placeholder removed) | fragment, `geometry-not-yet-available` (`diagnoseFragmentOnce`) | `'geometry-unavailable'` | next call |
| second read returns `unsupported:true` layout (canonical had resolved) | derived build | no | fragment, `geometry-not-yet-available` | `'geometry-unavailable'` | next call |
| any stored `fround(S·v)` non-finite | derived build (backstop to the §5.1 domain check) | yes, `unsupported` marker per key | fragment, `clearance-anisotropic-scale-unsupported` | `'anisotropic-scale'` | no |
| derived weld leaves 0 triangles while canonical `triangleCount > 0` | derived build | yes, as ready entry with `triangleCount 0` | fragment, `clearance-anisotropic-scale-unsupported` (never a silent "beyond threshold") | `'anisotropic-scale'` | no |
| canonical `triangleCount === 0` under a non-uniform transform (amendment §5.7) | classification rule 1a, before the precheck | n/a (pure) | **none** (accessor counter `noSurfaceOperands`; recorder-only not-run reason `no-clearance-surface-before-precheck`) | `'no-clearance-surface'` (clean negative) | n/a |
| `ModelEvictedError` / `WorldDisposedError` (checkpoint, or `releaseEpoch`/`releaseAll` race — eviction/dispose only) | derived cache | no | none | call aborts (unchanged lifecycle semantics) | n/a |
| placement change (`invalidateModelPlacement` / refresh publish) during an in-flight build | derived cache `detachEpoch` | no (build result not cached) | none | query continues normally with the built record | n/a |
| any other exception (BVH/builder bug, invariant break) | derived build | no | none | call aborts (same policy as `resolveGeometryRecord`, which absorbs only `RenderProxyUnavailableError`) | n/a |

`clearanceDistanceQueriesRun` / `clearanceOverlapPrechecksRun` keep their exact current semantics (a derived-build failure after the precheck counts the precheck, not a distance query).

### 5.7 Amendment — no-clearance-surface operands (owner-authorized, bounded, 2026-10-07)

**Gap (measured live, SVF2 Arch+Struct+Mech, Soft query of struct dbId 180 @0.05).** 212 fragments got `clearance-anisotropic-scale-unsupported` where legacy SVF yields no hit and no diagnostic: 207 whose canonical record has **0 triangles and an empty bounding box** (the empty box made rule 3 return `'numeric-domain'`), and 5 two-vertex line fragments whose canonical record has **0 triangles but 2 retained vertices** (non-empty box → `'derived'` → the derived weld has 0 triangles → §5.6 row "derived weld leaves 0 triangles"). Neither is a transform problem: the geometry simply has no surface.

**Rule.** `classifyClearanceTransform(matrix, localBox, { triangleCount })` with `triangleCount = record.geometry.index.count / 3` of the **canonical** record:
1. rule 1 (`validateUniformScale(M)` valid → `'uniform'`) is unchanged and still first — a uniform zero-triangle operand keeps the byte-identical legacy path;
2. rule **1a**: `triangleCount === 0` → `{ path: 'no-surface' }`, before every anisotropic-eligibility rule (reflection, shear, numeric domain, derived build). Both measured classes (empty record, two-vertex line) have canonical `triangleCount 0` and are classified identically;
3. absent or positive `triangleCount` → the pre-amendment classification exactly.

A **non-empty** canonical record whose derived mesh collapses to 0 triangles (numeric collapse, e.g. a flat-axis scale such as `6e-6`) is **not** `'no-surface'`: the canonical record has a surface, the collapse is a property of the prescaled/welded representation, and it stays diagnosed per §5.6 (tested).

**Narrow phase.** Both sides are classified; every genuinely `'unsupported'` side is diagnosed first exactly as before (so a no-surface operand never masks an unsupported partner). Otherwise, if either side is `'no-surface'`, the pair returns the internal outcome `'no-clearance-surface'` **before the Hard-Clash precheck**: no diagnostic, no precheck, no distance query, no derived build — a clean negative like `'beyond-threshold'`. An operand without a surface can be neither a Hard-clash operand nor a clearance surface, so the pair is conclusively negative regardless of its partner.

**Visibility decision — no new public diagnostic reason; accessor counter instead.** Adding a `ClashDiagnostic` reason is not "trivially compatible": `fragment-null-geometry` (Cause 2) needed coordinated changes in `clashtest/execution/diagnostics.js` (`KNOWN_DIAGNOSTIC_REASONS` + drift tests), `clashtest/results/status.js`, `validateResultSet.js`, the population scan / enumerator and the Clash Finder's completeness policy — a protected cross-package contract, outside this bounded amendment. A diagnostic is also semantically wrong here: the pair's verdict is complete and correct (no surface → no clearance hit), exactly as legacy SVF reports it, and no clearance `statistics` key may be added (the clash-test executor rejects unknown keys). Visibility is therefore:
- `getEpochClearanceDerivedGeometryDiagnostics(epoch).noSurfaceOperands` — cumulative per live epoch, one per surface-less side per pair evaluation that reached the no-surface branch (a pair decided by an unsupported partner is not counted). World-owned (`CollisionWorld`), so it exists without a derived cache; released on eviction, cleared on dispose, kept across placement invalidation; only a live epoch is counted. The accessor's documented exhaustive shape gains this one additive key;
- recorder-only `hard-clash-precheck` event `stage: 'not-run'`, `precheckNotRunReason: 'no-clearance-surface-before-precheck'` (the M4 outcome matrix gains one exit path; no repository consumer validates a closed enum).

**Pre-existing uniform-path behaviour, preserved and documented (not imitated).** A *uniform* zero-triangle operand keeps the legacy path: AABB-disjoint → precheck skipped, distance query runs, beyond threshold, no diagnostic; AABB-overlapping → `volumeOverlapQuery` on the empty mesh returns inconclusive → pair-scoped `clearance-hard-clash-precheck-inconclusive`. That legacy quirk is protected (golden / bit-identical legacy path) and pinned by a test; the no-surface class deliberately does not reproduce it (internal second opinion, `codex-advisor` request `20261007-161603-7715-5807`, concurred: reproducing it would preserve accidental empty-BVH behaviour, not collision semantics). Changing the uniform path is out of scope.

**Legacy-SVF impact.** Rule 1a can only affect a legacy-SVF fragment that is zero-triangle **and** non-uniform (reflected/sheared); none exists on the fixtures (the only reflected SVF fragments, Arch 2820/2821, have surfaces), so legacy results are unchanged — the T0 golden test stays exact.

**Tests.** `test/query/ClearanceTransformClass.test.mjs` (no-surface for every non-uniform class and both box shapes; uniform zero-triangle stays `'uniform'`; absent/positive count unchanged) and `test/CollisionWorld.clearanceNonUniform.test.mjs` (empty and line classes identical, disjoint and overlapping AABBs, either/both sides, unsupported partner still diagnosed and not counted, flat-axis `6e-6` derived collapse still diagnosed, uniform zero-triangle legacy behaviour pinned, counter lifecycle).

## 6. Equivalence prototype (offline, node, real fixture data)

Scripts (session scratchpad, not committed): `…/scratchpad/nonuni/dump.mjs` (live dump of raw vertex buffers + `fragList.getWorldMatrix` for SVF and SVF2), `proto.mjs` (fixture pairs), `proto2.mjs` (synthetic sweep), `proto3.mjs` (weld-variant comparison). They import the repo's real `compactAndWeld`, `ThreeMeshBvhBackend.build`, `validateUniformScale`, `computeToleranceFloor` and the **unchanged** `clearanceQuery`. Ground truth = float64 brute-force minimum triangle–triangle distance of the canonical SVF2 meshes transformed to world by their full anisotropic matrices.

| Pair (SVF2 frags) | canonical path today | derived-path distance | world ground truth | abs. error | witness off-surface (src / tgt) | SVF legacy distance | SVF2 GT − SVF GT |
|---|---|---|---|---|---|---|---|
| soft+ 398→366 (dbId 197→6615) @0.05 | rejected | 0.041666350063061 | 0.041666350063057 | 3.9e-15 | 2.4e-9 / 2.8e-10 | 0.04166616338460325 | +1.88e-7 |
| soft+ 398→367 (197→6618) @0.05 | rejected | 0.041667303737377 | 0.041667303737373 | 3.9e-15 | 2.4e-9 / 2.8e-10 | 0.04166616338460503 | **+1.14e-6** |
| soft− 398→366 @0.02 | rejected | no hit (correct) | 0.04167 | — | — | no hit | — |
| flange 352 → roof 0 (5750→253) @0.5 | rejected | 0.121636056884 | 0.121636061459 | 4.6e-9 | 3.6e-15 / 4.6e-9 | 0.121635052215 | +1.01e-6 |
| reflected Arch 2820→2821 @5 (prototype with σ folding) | rejected | 2.750002560977 | 2.750002558150 | 2.8e-9 | 5.3e-15 / 3.4e-10 | rejected (reflected) | — |

`|witness.sourcePoint − witness.targetPoint| − distance` ≤ 1.7e-12 in every case. Synthetic sweep (300 pairs, random rotations, scales 0.2–20 per axis, 60 flat-axis cases with one scale = 6e-6, 100 reflected cases, 75 mixed uniform-legacy vs derived): **0 false negatives, 0 false positives, 0 aborts**, max abs. error 1.9e-6, max rel. error 7.1e-6 (float32 rounding of `S·v`). Weld variants (raw-view world-unit weld vs canonical-local-weld-then-prescale, §4 F): identical distances and vertex counts on all four fixture pairs.

Consequences:
- The derived path reproduces SVF2 world truth to float32 precision; the design does not change the distance definition.
- **SVF and SVF2 ground truth themselves differ by up to 1.14e-6** on the Soft positive pair (format-level float32 placement differences; §11 measured world Hausdorff ≤ 7e-6). The live acceptance asserts each Soft distance against the SVF value `0.04166616338460325` with `distanceTolerance: 1e-6` (`test/acceptance/clash-finder.acceptance.mjs` ~492-493) — the 6618 pair will be ~1.14e-6 off **even with a perfect implementation**. See §9 O-2.

## 7. Protected-contract impact

| Contract | Impact |
|---|---|
| `createGeometryIdentity` / `GeometryRegistry` entries / `geometryDigest` / `getEpochGeometryEntries` / BLAS / TLAS caches | **None** |
| Hard modes (`surface-intersection`, `containment`, `volume-overlap`) and the clearance Hard-Clash precheck | **None** — still canonical instances |
| Clearance distance definition, `(toleranceFloor, clearance]`, witness shape, aggregation order | **None** |
| Legacy uniform-scale clearance results (all SVF fragments except the 2 reflected ones) | **Bit-identical by construction** (classification returns the legacy path first; `clearanceQuery` untouched) |
| M3 transform contract ("anisotropic scale diagnosed unsupported", M3 §3/§5/§9, fixture 15; README ~385/~634/~955; CHANGELOG) | **Changes** — the change the owner authorized; docs updated, fixture 15 re-pointed at a shear matrix |
| `clearance-anisotropic-scale-unsupported` reason | String/scope kept; meaning narrowed (doc change only) |
| `compactAndWeld` signature | Additive optional `positionScale`; default byte-identical |
| `collision/constants.js` | One additive provisional constant `maxClearanceDerivedGeometryBytesPerEpoch`; no existing value changes |
| Public `CollisionWorld` API | One additive read-only accessor `getEpochClearanceDerivedGeometryDiagnostics(epoch)` (amendment §5.7: one additive key `noSurfaceOperands`) |
| `statistics` keys / `KNOWN_DIAGNOSTIC_REASONS` / clash-test projection | **None** |
| Memory | New per-epoch derived cache: lazily built, unconditional per-epoch byte budget (new provisional constant `maxClearanceDerivedGeometryBytesPerEpoch`) + 20 000-entry cap with LRU eviction; released on eviction/dispose, detached non-cancellingly on placement change (§5.2); worst case on the fixtures ≈ SVF canonical footprint (§4 A) |

## 8. Implementation plan (ordered; each task TDD, offline gates green before the next)

- **T0 — Legacy golden baseline, BEFORE any source change** (added after internal review I5): new `test/fixtures/clearance-legacy-golden.json` + generator `test/fixtures/generate-clearance-legacy-golden.mjs` (documented command, committed together and before T1). It records, for every uniform/rigid clearance scenario the existing suites exercise (the fake-geometry `findClashes` fixtures of `test/CollisionWorld.clearance*.test.mjs` and `test/CollisionWorld.findClashes.clearance.test.mjs` minus the anisotropic ones, and direct `clearanceQuery` fixtures), the full `pairs` (distance, witness), the clearance `statistics` subset and `diagnostics`. A new test `test/CollisionWorld.clearanceLegacyGolden.test.mjs` asserts deep equality (exact numbers, `Object.is`) against it at every later task.
  - **Must stay byte-for-byte unchanged** (never edited by this work): `test/query/ClearanceQuery.test.mjs`, `test/query/ClearanceTransform.test.mjs`, `test/query/ClearanceHardClashPrecheck.test.mjs`, `test/CollisionWorld.findClashes.clearance.test.mjs`, `test/CollisionWorld.clearanceBudget.test.mjs`, `test/CollisionWorld.clearanceStatistics.test.mjs`, `test/CollisionWorld.emptyStatistics.m3.test.mjs`, `test/CollisionWorld.isValidClearanceTransform.test.mjs`, `test/ClashFinderExtension.softClash.test.mjs`, every Hard-mode test, and every test in the two files below that does not use `ANISOTROPIC_MATRIX`.
  - **Intentionally rewritten for the new contract** (exhaustive list): in `test/CollisionWorld.clearanceAdmissionValidation.test.mjs` the five tests around `ANISOTROPIC_MATRIX` (~101-366: "well-formed but non-uniformly-scaled…", the two single-side dedup tests, "both … anisotropically-scaled", "… under both broadPhase") and in `test/CollisionWorld.precheckNotRunReason.test.mjs` the two `anisotropic-scale-before-precheck` tests (~92-139): they currently use `scale(1,2,1)`, which becomes supported; they are re-pointed at a **sheared** matrix (same assertions on the residual-unsupported diagnostic), and each gains a sibling asserting the `scale(1,2,1)` case now measures correctly.
- **T1 — `classifyClearanceTransform`** (`collision/query/ClearanceTransformClass.js`, new; test `test/query/ClearanceTransformClass.test.mjs`): uniform → `'uniform'` with the exact legacy `scaleFactor`; axis-aligned and rotated anisotropic → `'derived'` with `Q·S = A` to 1e-15; flat axis 6e-6 → `'derived'`; reflected (uniform and anisotropic) → `'unsupported'/'reflected'`; shear > 1e-4 → `'non-orthogonal'`; huge scale (e.g. 1e39 × unit box) → `'numeric-domain'`; projective / non-finite → `'other'`; **two back-to-back calls return non-aliased `rigid`/`scale`** and never mutate the input; all 543 + 5435 SVF2 fixture matrices (frozen JSON snapshot of the `aniso` dump) → `'derived'` except the 2 reflected Arch frags and the 5 uniform ones.
- **T2 — `compactAndWeld({positionScale})`** (`collision/geometry/activeRangeCompaction.js`; test extending its existing suite): absent → byte-identical output to today on existing fixtures; present → positions = `fround(p·s)` before weld; weld epsilon applies in scaled units; flat-axis partial collapse and full 0-triangle collapse behave like the unscaled function on the equivalent pre-scaled input; non-finite scaled coordinate reported (not passed to weld).
- **T3 — `ClearanceDerivedGeometryCache`** (`collision/geometry/ClearanceDerivedGeometryCache.js`, new; test `test/geometry/ClearanceDerivedGeometryCache.test.mjs`) — state machine of §5.2: exact-bits keying (distinct `S` → distinct entries; identical `S` → one build); **concurrent miss → one build, shared promise**; failure (incl. `RenderProxyUnavailableError`) → placeholder removed, next call retries; **eviction race** (`releaseEpoch` during an in-flight build → waiters get `ModelEvictedError`, no late publish, no bucket recreated); **disposal race** (`releaseAll` → `WorldDisposedError`); late completion after supersession never publishes; `unsupported` marker caching; LRU budget (byte budget and entry cap each exceeded by one entry → exactly the least-recently-used ready/marker entry evicted, never a building one; retained-byte accounting matches the accessor); **`detachEpoch` during an in-flight build → waiters resolve normally, result not cached**; synchronous Viewer read + copy (no await between, asserted with a scheduler spy).
- **T4 — `CollisionWorld` wiring** (`collision/CollisionWorld.js`: construct in `fromViewer`; release in `_releaseEpochScopedState`, `dispose`, `invalidateModelPlacement`, `_refreshPlacementForEpoch` publish; replace the gate at ~2383-2403; build derived instances after the precheck; recorder covariates per §5.3; `getEpochClearanceDerivedGeometryDiagnostics`). Tests:
  - T0 golden test green; the T0 "intentionally rewritten" tests updated as listed;
  - new: `scale(1,2,1)` / rotated anisotropic / mixed uniform+derived pairs return the world-truth distance and on-surface witnesses (fake geometry, hand-computable gaps); every §5.6 row exercised;
  - Hard isolation: spy that `volumeOverlapQuery` receives canonical instances only and that `getEpochGeometryDiagnostics` is deep-equal before/after a derived build;
  - cache invalidation: eviction, dispose, `invalidateModelPlacement`, placement-refresh publish; **repeated legacy-shape (linear) queries with a changing non-uniform scale** stay within the byte budget/entry cap and never serve a stale scale; an `invalidateModelPlacement` racing an in-flight derived build does **not** abort the query.
- **T5 — Offline equivalence test committed** (`test/query/ClearanceNonUniform.equivalence.test.mjs`): port `proto2.mjs` (seeded) plus large-origin (translation 1e5) and threshold-boundary (`clearance` = ground truth ± bound) cases; reference = float64 brute force on the world-scaled, identically-welded meshes; assert (i) query exactness against float64 brute force on the same welded derived triangles placed by `[Q|t]` (≤ M3's existing cross-check allowance), and (ii) 0 false negatives/positives against raw world truth outside the §3 band `√3·(2⁻²⁴·(m_A+m_B) + merged·ε_w)`.
- **T6 — Docs**: M3 spec §3/§5/§9/§12/§15 reconciliation note (fixture 15 now shear; new fixture "anisotropic SVF2-style transform measured correctly"); `collision/README.md` ~385, ~634, ~955 (transform class, narrowed diagnostic meaning, immutability assumption, accessor); `CHANGELOG.md`.
- **T7 — Gates** (pass/fail, added after internal review I4): offline + DOM suites green; T0 golden deep-equal; `test/performance/run-gate-m3.mjs` extended with an SVF2 Soft scenario and required to show (a) `builds ≤ distinct (geometryIndex, S)` keys touched and `builds + hits + sharedWaits` = derived resolutions (accessor counters), (b) peak retained derived bytes (`retainedPositionBytes + retainedIndexBytes + retainedBvhBytes`) ≤ the same scene's SVF canonical retained bytes (`getEpochGeometryDiagnostics` sums) × 1.25, (c) SVF2 Soft wall time ≤ 2 × the same queries on legacy SVF (provisional, retuned at the gate with owner sign-off; SVF2 currently does no distance work so there is no SVF2 baseline), (d) legacy-SVF Soft timings within the existing M3 gate thresholds; live `test/acceptance/clash-finder.acceptance.mjs` under SVF2 default **and** forced legacy SVF.

Live acceptance expectation (SVF2): `[soft]` positive returns exactly struct 6615 and 6618 for dbId 197 at the default clearance (distances 0.0416663501 and 0.0416673037); `[soft][known-negative]` @0.02 → 0 pairs, decided in broad phase; `[soft][hard-clash-exclusion]` @5 → the crossing target (arch 5428) is absent and counted in `clearanceHardClashExclusions` because the precheck runs the same `volumeOverlapQuery` that already finds that crossing pair under SVF2 in Hard mode. Forced legacy SVF: unchanged (bit-identical path). Known non-design deltas: the 1.14e-6 distance offset (§9 O-2); the `[negative]`/`[soft][known-negative]` exact-alert checks still fail on SVF2 until Cause 2 is decided; the 33-pair broad set at clearance 5 may differ from SVF where a canonical precheck on an open mesh is frame-dependent (Cause 1 class — reported, not designed around).

## 9. Owner decisions

*Resolved (2026-10-07): O-1 keep reflection unsupported; O-2 per-format expected values, tolerance not widened; O-3 keep the reason string; O-5 second raw Viewer read. Amendment §5.7 authorized. The text below is the original decision request, kept for history.*

**REQUIRES OWNER APPROVAL** (original request)

- **O-1 Reflected fragments.** The design keeps negative-determinant fragments `'unsupported'` (as today), so legacy SVF output is bit-identical everywhere (Arch frags 2820/2821 are reflected in SVF too). The prototype shows reflection is exactly supportable by folding `σ` into `S` (error 2.8e-9). Enabling it changes legacy-SVF results for those fragments (new pairs / one fewer diagnostic). Decide: keep unsupported (default) or enable reflection support.
- **O-2 Soft-positive distance tolerance under SVF2.** The SVF2 and SVF fixtures differ by 1.14e-6 in ground truth for the 197→6618 pair, exceeding the acceptance `distanceTolerance: 1e-6`. Any correct implementation fails that check. Decide: widen to ≥ 2e-6 (or 1e-5, the measured inter-format Hausdorff bound), or record per-format expected values — both are acceptance re-baselining.

**Optional (no protected contract changes if declined)**

- **O-3** Rename `clearance-anisotropic-scale-unsupported` (e.g. `clearance-transform-unsupported`) — would also require the `KNOWN_DIAGNOSTIC_REASONS` drift update in `clashtest/execution/diagnostics.js`. Default: keep.
- **O-4** (withdrawn after internal review C3: the per-epoch LRU cap is now part of the design, §5.2.)
- **O-5** Second Viewer read vs variant F (§4): default is the raw-view re-read (world-unit weld, SVF semantics, relies on the already-existing per-epoch geometry-immutability assumption). Variant F avoids the second read but inherits the canonical unit-cube weld residual (≤ `ε_w·sᵢ`, ≈0.068 ft worst on the fixtures; identical results on all four measured fixture pairs).

No item requires changing canonical mesh identity, Hard-clash semantics, or the clearance distance definition — the authorization's constraints are met by the chosen design.

## 10. Risks

- **Second Viewer read per derived mesh**: depends on render-proxy availability exactly like the canonical build; mitigated by the existing transient-failure handling. If unacceptable, fall back to variant F (documented weld-unit residual).
- **Memory**: worst case on the fixtures ≈ SVF canonical footprint per epoch (Struct 476, Arch 2372 derived meshes), byte-budgeted per epoch (§5.2); pass/fail at the M3 performance gate (T7 b).
- **Precheck frame dependence** (pre-existing Cause 1 class): the Hard-Clash precheck on canonical SVF2 instances may be inconclusive or differ from SVF for open meshes, dropping a Soft candidate with `clearance-hard-clash-precheck-inconclusive`. Out of scope; reported if it shows in T7.
- **Float32 rounding of `S·v`**: bounded (§3); covered by T5.
- **Dirty work tree**: `clashtest/`, `collision/viewer/ViewerModelAdapter.js` and several tests carry other packages' uncommitted changes; this design touches none of `clashtest/` and only additive points in `collision/`.

## 11. Internal review disposition

One `codex-review spec` pass (medium; request `20261007-150713-30870-17052`, verdict "requires major revision", mathematical direction judged viable). Every finding was re-verified against source before acting:

| Finding | Verified? | Disposition |
|---|---|---|
| C1 weld vs "exact equivalence" | yes (`compactAndWeld` merges/filters) | §3 rewritten: exact pre-weld; post-weld contract = legacy pipeline on world-scaled geometry; explicit weld + float32 bound; "triangle for triangle" no longer claimed for welded output |
| C2 cache concurrency/cancellation undefined | yes (`GeometryRegistry` placeholder/race/removeIfSame) | §5.2 state machine; T3 race tests |
| C3 memory bound false under linear broad phase | yes (legacy shape defaults to linear, `_recordPlacement` write-once, fresh matrices per call) | release on `invalidateModelPlacement` + unconditional per-epoch LRU cap; T4 changing-scale test |
| C4 float32 domain / error bound | yes | §3 numerical domain + two-operand bound; §5.1 `'numeric-domain'`; §5.6 backstop; T1/T5 tests |
| I1 classifier input type / aliasing | yes (`validateUniformScale` takes `Matrix4`) | §5.1 signature fixed; non-aliased results; T1 test |
| I2 failure mapping | yes | §5.6 table |
| I3 second-read consistency | yes | §5.2: explicit reliance on the already-existing per-epoch immutability assumption; O-5 |
| I4 non-pass/fail perf criteria; wrong triangle covariates | yes (~2477 uses canonical counts) | T7 criteria; required accessor; §5.3 covariates |
| I5 contradictory regression instructions | yes | T0 golden baseline + exhaustive unchanged/rewritten lists |
| Q4 / O-2 acceptance tolerance | yes (`distanceTolerance: 1e-6`, ~493) | unchanged: owner decision O-2 |

Targeted re-review of the changed areas only (`codex-advisor` medium, request `20261007-151417-39459-10649`): C1, C2, I1, I3, I4, I5 **closed**; three remaining High items, each re-verified and fixed:

| Finding | Verified? | Disposition |
|---|---|---|
| C3 entry count is not a memory bound (derived mesh can exceed canonical size; markers uncapped) | yes (world-unit weld may merge fewer vertices) | byte budget `maxClearanceDerivedGeometryBytesPerEpoch` + entry cap incl. markers (§5.2) |
| C4 `fround` before weld can cross weld buckets, so the Lipschitz bound vs a float64-welded reference does not hold | yes | §3: normative reference = exact implemented pipeline; bound restated for retained triangles; T5 split into query-exactness vs raw-truth band |
| NEW placement invalidation would spuriously abort live queries with `ModelEvictedError` | yes (`invalidateModelPlacement` ~771 only bumps revisions) | non-cancelling `detachEpoch` for placement changes; reject only on eviction/dispose (§5.2 step 7, §5.6) |

No Critical/High remains known at this design's abstraction level. Per the review-boundary rule the internal loop stops here; the artifact is ready for independent review / owner decision.

## 12. Next gate

Implementation T0–T7 and the §5.7 amendment are complete and **uncommitted**. Next: the **targeted independent Work review** (scope: the Cause 1–3 changes, the §5.7 amendment, and the adjudication of M3 gate criterion (d) — CAUTION, see header). Not authorized by this document: commit/push, acceptance-suite re-baselines, reflected-fragment support, any change to the uniform legacy path or to the M3 performance contract.

*(Original design-only text: "Internal review of this design, then owner decision on O-1 and O-2. Implementation (T1–T7) is not authorized by this document." — superseded by the owner authorization above.)*
