# M3 Design Spec — Soft Clash / Clearance

Status: design/spec only. No implementation, no implementation plan. Source of truth is landed `main` (post M2.1, `v0.2.1`), not older design text where the two differ.

Landed context reconciled for this spec: `collision/` (`CollisionWorld.js`, `constants.js`, `blas/`, `tlas/`, `geometry/`, `query/`, `viewer/`), `collision/README.md`, root `README.md` (stale — still claims "Milestone 1", ignored in favor of `collision/README.md`/`CHANGELOG.md`), `CHANGELOG.md`, `wwwroot/extensions/ClashFinderExtension.js`, `test/acceptance/clash-finder.acceptance.mjs`, `test/performance/run-gate.mjs` + `run-gate-m2.mjs`, `test/fixtures/geometry.mjs`, and the finalized M1/M2/M2.1 specs under `docs/superpowers/specs/` (historical/contract context only).

---

## 1. Landed baseline this spec builds on

Restating only what M3 depends on (full detail in the cited files, not reproduced here):

- `findClashes({source, target, mode, groupBy:'dbId', broadPhase?})` — `mode ∈ {'volume-overlap','containment','surface-intersection'}` today (`CollisionWorld.js:23,1049-1051`). `target` accepts legacy `{model,dbIds}` or M2 `{targets:[{model,dbIds?}]}`; `broadPhase` defaults to `'linear'` for the legacy shape, `'tlas'` for `targets` shape (`CollisionWorld.js:1114`).
- `volume-overlap(A,B) := ProperCrossingQuery(A,B) OR anyComponentInside(A in B) OR anyComponentInside(B in A)` — i.e. Hard Clash already covers both true surface crossing *and* fully-enclosed containment with no surface contact. This matters directly for M3 (§9 below): a contained instance can have its surfaces arbitrarily far apart from the container's surfaces while still being a Hard Clash.
- `surface-intersection(A,B)` — pure boolean `bvhcast`-based triangle-intersection test, no witness, no distance. This is where "touching" (`distance == 0`, no proper crossing) already lives today.
- `ClashPair = {source:{modelId,dbId,model}, target:{modelId,dbId,model}, type: query.mode, ...(type==='volume-overlap' ? {witness: {kind,point}|null} : {})}` — the `witness` *key* is present only when `type==='volume-overlap'`; its value is a single world-space `[x,y,z]` point or `null` (M2.1). Deterministic fragment→dbId aggregation uses a stable total-order comparator (`compareWitnessCandidates`), tie-broken by `comparePlacedCanonically` (`(loadEpoch, geometryIndex, fragmentId)`).
- TLAS broad phase (M2): one `CollisionInstanceBVH` per `loadEpoch`, `queryBox(min,max,{onLeafRange,onCandidate})` accepts an **arbitrary AABB**, not necessarily an instance's own bounds (`tlas/CollisionInstanceBVH.js:60`; confirmed by the M2 spec §7.1 as the reason `bvhcast`/TLAS-vs-TLAS was rejected in favor of one query-box-per-source-instance). `maxTlasCandidatePairs = 200_000` bounds primitive-candidate expansion, checked incrementally during traversal (leaf-range emission), never as an upfront Cartesian precheck. `broadPhase:'linear'` is a permanent, always-placement-fresh differential correctness oracle (`_runBroadPhaseScan`/`_testBroadPhasePair`), immune to the TLAS staleness/revision machinery entirely.
- `invalidateModelPlacement(model)` only bumps revision counters; actual re-read of `worldMatrix`/`worldBounds` is lazy, triggered the next time a TLAS-consuming query touches that epoch, and forces a TLAS rebuild (no incremental extend). No separate alignment-transform math exists inside the collision library — it trusts the Viewer's own `fragList.getWorldMatrix` for federation/unit alignment, an assumption M2's live federated acceptance (cross-model witness point at real coordinates) already empirically exercises.
- Diagnostics convention: a non-empty `statistics.diagnostics` means the result **may be incomplete**; a clash is never silently downgraded to "no clash" on incomplete information. M2.1 carved out one exception (`witness-unavailable` does *not* count toward the incompleteness caveat, because the boolean verdict is still fully trustworthy without a marker) — §13 below explains why clearance does **not** get the same carve-out.
- `constants.js` already defines `surfaceEpsilonFactor = 1e-6` (× reference length) as the library-wide near-zero/touching tolerance convention, and `maxTlasCandidatePairs`, `maxCandidatePairsExamined`, `maxCrossingPairsExamined` as the existing budget vocabulary M3 should extend rather than replace.
- `three-mesh-bvh@0.9.14` is the pinned version (`package.json:35`), identical in `node_modules/` and `wwwroot/vendor/`. `MeshBVH.closestPointToGeometry(otherGeometry, geometryToBvh: Matrix4, target1, target2, minThreshold=0, maxThreshold=Infinity)` is public, documented, exported, typed — a genuine BVH-to-BVH closest-point/distance primitive with built-in threshold-bounded pruning, built on the same reentrancy-safe `shapecast` machinery already used elsewhere in this codebase (unlike `bvhcast`, which has a module-level `_active` reentrancy guard the existing crossing/containment queries already carry defensive comments about). Full findings in §3.

---

## 2. Soft Clash semantics (Required Decision 1)

**Adopted contract**, `mode: 'clearance'`, evaluated per source/target `CollisionInstance` fragment pair:

```
Soft Clash iff:
  NOT volume-overlap(A, B)                          [reuses the existing, unmodified predicate]
  AND distance(A, B) > toleranceFloor(A, B)          [exclusive — "touching" is not Soft Clash]
  AND distance(A, B) <= clearance                    [inclusive threshold]
```

Where `toleranceFloor(A, B) = surfaceEpsilonFactor × max(localDiagonal(A) × scaleFactor(A), localDiagonal(B) × scaleFactor(B))` — the library's own existing near-zero convention (`surfaceEpsilonFactor`), reused rather than inventing a new epsilon, but **corrected by review to be expressed in world units**: each operand's `localDiagonal` (a local-frame quantity) is converted to world units via that operand's own validated uniform scale factor (§5/§9) before taking the max, so the floor is comparable to the world-space `distance` it's compared against — the initial draft mixed local- and world-scale quantities directly, which is invalid once scale is present. `distance` is exclusive at the floor and inclusive at `clearance` (`(toleranceFloor, clearance]`).

**Why exclusive at zero, inclusive at the threshold:** any pair whose distance falls at or below `toleranceFloor` is treated as surface contact, not a *clearance violation* — consistent with how `volume-overlap` crossing already implies a shared point (distance exactly 0) at the moment of crossing. `<= clearance` (inclusive) is adopted because "closer than the required clearance distance" (the product goal's own phrasing) most naturally reads as "distance does not exceed the threshold."

**Correction (post-review):** the original draft of this section additionally claimed that a positive gap at or below `toleranceFloor` "would show up under a `surface-intersection` query" — this is **false** and has been removed. `SurfaceIntersectionQuery` performs exact, zero-tolerance triangle intersection (`collision/query/SurfaceIntersectionQuery.js:80`); it does not report near-zero *positive* separations at all, only actual intersection. `toleranceFloor` (`surfaceEpsilonFactor × ...`, on the order of `1e-6` relative to instance size) therefore carves out a narrow, deliberately unreported **dead band**: a real, strictly-positive gap smaller than `toleranceFloor` is neither a `surface-intersection` hit (surfaces genuinely don't touch) nor a `clearance` hit (excluded by the floor). This is an intentional, accepted consequence of reusing the library's existing near-zero epsilon convention (the same convention already creates comparably narrow tolerance bands elsewhere in this codebase, e.g. `mergeDistanceFactor`/`surfaceEpsilonFactor`'s existing roles) rather than inventing a new, unprincipled threshold — but it is a genuine gap, not a redirection to another mode, and implementers/callers should understand a `1e-6`-relative-scale near-contact will simply not appear in any mode's output. The partition is therefore: `{0} ∪ (0, toleranceFloor]` = touching or dead-band (unreported by any mode), `(toleranceFloor, clearance]` = Soft Clash, `(clearance, ∞)` = not reported.

**`clearance` for non-`'clearance'` modes:** rejected at entry validation, not silently ignored — if `query.clearance` is present while `query.mode !== 'clearance'`, `findClashes` throws the same class of clear validation error as any other shape mismatch (e.g. the existing `groupBy` strictness), rather than accepting and discarding a caller-supplied value that looks load-bearing.

**Containment/overlap exclusion (ties to §9):** a dbId pair with *any* contributing fragment pair that is a Hard Clash (`volume-overlap`, crossing or containment) under the same query scope is excluded from `clearance` results entirely, never merely "distance-filtered out." This is not redundant with the distance check above — `anyComponentInside` containment has no surface-crossing requirement, so a fully-enclosed component's own surfaces can be measured at a large `distance` from the container's surfaces while the pair is still, correctly, a Hard Clash. Relying on distance alone would silently misreport an enclosed component as a "near miss" once its container's *surfaces* happen to be more than `toleranceFloor` away — the exclusion must be semantic (query the existing `volume-overlap` predicate), not purely numeric.

**Units:** clearance is supplied in the same world/model units the library's existing witness points already use (Viewer scene units, post-`worldMatrix`). No unit conversion is performed inside `collision/` — same trust boundary M2 cross-model overlap already relies on.

**Invalid input:** `clearance` must be a finite number `> 0`. Non-finite, `<= 0`, or missing when `mode==='clearance'` is rejected at the same up-front validation stage as the existing `mode`/`groupBy`/`dbIds`-shape checks (`CollisionWorld.js:1029-1095`) — a clear thrown error, never a silent empty-`pairs` result. This matches the library's existing "never silently convert an unverified query into a negative result" discipline.

---

## 3. Distance quantity and the `three-mesh-bvh` evaluation (Required Decisions 2 & 3)

**Adopted definition:** the minimum Euclidean distance between the two transformed *collision surfaces* (the same welded, BLAS-backed triangle meshes every other narrow-phase query already operates on) in Viewer scene/world coordinates, computed via `MeshBVH.closestPointToGeometry` — genuine BVH-to-BVH traversal, not a custom algorithm.

**Verified pinned-library findings** (`three-mesh-bvh@0.9.14`, confirmed against actual installed source in both `node_modules/three-mesh-bvh` and `wwwroot/vendor/three-mesh-bvh`, byte-identical):

- `MeshBVH.js:840` — `closestPointToGeometry(otherGeometry, geometryToBvh: Matrix4, target1={}, target2={}, minThreshold=0, maxThreshold=Infinity) → HitPointInfo | null`. Public, fully JSDoc'd, exported via `src/index.js`, typed in `src/index.d.ts:168-175`.
  - `geometryToBvh` is the explicit relative transform of `otherGeometry` into `this` BVH's local frame — **the two operands do not need to share a coordinate frame**; a relative transform is a required parameter, not a caller-side pre-transform step. This resolves the "which frame" question in the prompt directly: compute in one operand's local frame with a relative transform, exactly as the pinned API is shaped for.
  - **Critical correctness constraint, found by review, not present in the initial draft:** `target1.distance`/`target2.distance` are measured in **the source BVH's own local-mesh units**, not world units, regardless of what relative transform is supplied. Passing `geometryToBvh = inverse(sourceWorldMatrix) * targetWorldMatrix` correctly relocates `otherGeometry` into the source's local frame for the geometric comparison, but it does **not** convert the resulting scalar distance into world units. If `sourceWorldMatrix` carries any scale, the raw returned distance is wrong by that scale factor, and the error is direction-dependent (hence uncorrectable by a single scalar) if the scale is anisotropic. §5 defines the adopted policy: validate uniform scale per operand, and convert the local distance to world units by multiplying by the source's own validated uniform scale factor. Non-uniform (anisotropic) per-instance scale is diagnosed as unsupported for `clearance`, not silently computed wrong.
  - `target1` receives the closest point **on `this` BVH**, in `this` BVH's local frame, plus `distance` and `faceIndex`. `target2` (pass `null` to skip) receives the closest point **on `otherGeometry`**, converted back into `otherGeometry`'s own local frame, plus its own `distance`/`faceIndex`. Both `distance` values describe the same physical separation and should agree modulo floating-point.
  - `minThreshold`/`maxThreshold` are real, built-in traversal-pruning bounds, but **`minThreshold` is an early-exit optimization, not an exclusion filter**: the moment the traversal finds any candidate pair closer than `minThreshold`, it returns immediately with that pair — which may be closer than `minThreshold` itself and is not guaranteed to be the true global minimum (confirmed directly in the indirect generated source, `closestPointToGeometry_indirect.generated.js:150`, which returns as soon as `dist < minThreshold`). A non-null result is therefore **not** guaranteed to lie in `(minThreshold, maxThreshold]` — it can be anywhere in `[0, maxThreshold]` (subject to `maxThreshold`'s own strict-`<` internal pruning comparisons, `:74`). Any exclusion-floor semantics (§2's `toleranceFloor`) must be implemented as an explicit **post-hoc check on the returned distance**, never by passing the floor as `minThreshold` and trusting the result to already be filtered. `maxThreshold` bounds the OBB-distance-lower-bound traversal so subtrees whose lower bound exceeds it are pruned outright; the call returns `null` (targets untouched) only when nothing at all is found within `[0, maxThreshold]`.
  - Mechanism: an outer `shapecast()` on `this` BVH prunes by OBB-distance-to-box; at a leaf range, if `otherGeometry.boundsTree` exists it recurses into a **nested inner `shapecast()`** on the other BVH using the equivalent distance score, only falling to an O(n·m) triangle-pair scan once both sides bottom out at small leaf ranges. **If `otherGeometry.boundsTree` is not set, it falls back to a full linear scan of all of `otherGeometry`'s triangles per leaf** — confirmed (by review) that `ThreeMeshBvhBackend.build()` does **not** currently assign `geometry.boundsTree = bvh` (`collision/blas/ThreeMeshBvhBackend.js:55`), so as landed today every clearance query would silently take the unaccelerated per-leaf linear-scan fallback on the target side. **This spec settles the open question from the initial draft: `ThreeMeshBvhBackend.build()` must be changed to assign `geometry.boundsTree = bvh` on the geometry it returns**, as a required, in-scope M3 change (not an implementation-time judgment call) — this is the single construction point every BLAS already passes through, so it is the correct and only place to establish this invariant permanently for all consumers, present and future. `test/fixtures/geometry.mjs`'s `testInstance()` helper currently discards the backend-returned `geometry` in favor of a separately-welded object (`geometry.mjs:94`) and must be updated to preserve/use the backend's own `geometry` (with `boundsTree` attached) so unit fixtures exercise the same accelerated path production code will use, not a different one.
  - Purely synchronous, recursive `shapecast` calls — no worker, no async, no yield points, same execution model as the rest of the library.
  - **Reentrancy-safe**, unlike `bvhcast`: `shapecast.js` uses a per-call `boxStack` (push/pop of scratch `Box3`s) specifically to support nested/recursive `shapecast` invocations, and carries no module-level `_active` guard. This is exactly the mechanism `closestPointToGeometry`'s nested inner `shapecast()` relies on, and it means clearance's narrow-phase query carries none of the reentrancy hazard the existing `bvhcast`-based crossing/containment/surface-intersection queries already have to defensively code around.
- **`indirect: true` caveat (load-bearing for this repo):** `ThreeMeshBvhBackend.js:49` builds every BLAS with `{indirect: true}`. For the indirect-variant implementation of `closestPointToGeometry`, the `faceIndex` values written into `target1`/`target2` are **raw internal BVH-layout indices**, not resolved via `resolveTriangleIndex()` — confirmed directly in the generated indirect source. Any consumer of a clearance witness's `faceIndex` (e.g. to enrich with `getTriangleHitPointInfo`) **must call `bvh.resolveTriangleIndex(faceIndex)` first**. This is the same class of hazard `ThreeMeshBvhBackend.js`'s own header comment already documents for `bvhcast`/`intersectsTriangles` consumers, now confirmed to extend to `closestPointToGeometry` as well — `closestPointToPoint`'s `faceIndex` does *not* need this (its triangle-iteration helper already resolves indices before invoking callbacks), so this asymmetry is easy to miss and must be called out explicitly in the eventual implementation.
- `bvhcast` (two-BVH simultaneous traversal, already used by `SurfaceIntersectionQuery`/`ProperCrossingQuery`/`SurfaceCrossingWitness`) is **pure boolean AABB-overlap traversal** — no threshold parameter anywhere in its signature or implementation, cannot bound/prune a "within distance D" search, and additionally carries the documented `_active`-guard reentrancy hazard. **Rejected for clearance's narrow phase** — `closestPointToGeometry` is architecturally the correct primitive; `bvhcast` remains correctly scoped to actual overlap detection.
- Nothing in this pinned version offers a distinct "BVH-to-BVH minimum distance" method separate from `closestPointToGeometry` — that method *is* the primitive, taking a `BufferGeometry` (optionally BVH-accelerated) rather than a second `MeshBVH` instance directly. No async/worker variant exists for either closest-point method in this pinned source tree.
- `closestPointToPoint` (already in production use, `ContainmentQuery.js:81`) is a related, simpler primitive (point-to-geometry, not geometry-to-geometry) — not sufficient on its own for the geometry-to-geometry minimum distance M3 needs, but confirms the same underlying `shapecast`/threshold/reentrancy-safe pattern is already proven-in-use in this codebase.

**Conclusion:** `closestPointToGeometry` is adopted as the sole narrow-phase distance primitive. No custom geometric-distance algorithm is introduced.

---

## 4. Broad-phase architecture (Required Decision 4)

**Adopted TLAS-path design**, reusing the existing `CollisionInstanceBVH`/`TlasCache` machinery with no new acceleration structure:

1. For each admitted source instance, compute its exact world-space AABB (already available — same `worldBounds` every instance already carries) and **inflate it by `clearance` in all six directions**.
2. Query the target epoch's existing `CollisionInstanceBVH` via `queryBox(inflatedMin, inflatedMax, {onLeafRange, onCandidate})` — the same API M2 already uses for Hard Clash, which already accepts an arbitrary query box (`CollisionInstanceBVH.js:60`), so **no TLAS API change is required**.
3. Each surviving candidate then passes an **exact, unpadded AABB-to-AABB minimum-distance retest** against `clearance` before any narrow-phase work is attempted (see §6's decision tree for what happens next).

**No-false-negatives proof:** every collision surface is, by definition of an AABB, entirely contained within its own AABB. For any point `p` on source surface `A` and `q` on target surface `B`, `p ∈ AABB(A)` and `q ∈ AABB(B)`, so `dist(p,q) ≥ dist(AABB(A), AABB(B))` (the AABB-to-AABB box distance is a lower bound on any point-pair distance between the regions the boxes contain). Therefore if the true surface-to-surface minimum distance is `≤ clearance`, then `dist(AABB(A), AABB(B)) ≤ clearance` necessarily holds too — meaning inflating one box by `clearance` and testing overlap against the other (inclusive of touching) is a valid, conservative *necessary* condition. No true-positive pair can be missed by this broad phase.

**Why not a second TLAS or TLAS-vs-TLAS `bvhcast`:** the existing per-source-instance `queryBox` pattern already accepts an arbitrary box, so inflation happens entirely on the *query* side — the indexed `CollisionInstanceBVH` itself is untouched and shared verbatim with the Hard Clash path. This also sidesteps `bvhcast`'s reentrancy hazard entirely (M2 §7.1 already rejected TLAS-vs-TLAS `bvhcast` for the same reason, for Hard Clash).

**Self-exclusion, placement invalidation, federation:** all inherited unchanged. Self-exclusion uses the same instance-identity check every other mode already applies. `invalidateModelPlacement`/TLAS revision-staleness/lazy-refresh-and-rebuild is entirely orthogonal to what's being queried (it operates on the same per-epoch `CollisionInstanceBVH`, not on query-box shape), so it needs no new logic for clearance.

**Linear oracle for clearance (Required Decision 5):** a permanent `broadPhase:'linear'` path, `_runClearanceBroadPhaseScan`, structurally identical to `_runBroadPhaseScan`'s nested-loop shape but with a different per-pair test: **exact, unpadded AABB-to-AABB minimum distance `≤ clearance`** (not overlap — the linear path doesn't need the inflate-then-overlap indirection the TLAS query-box API requires, since it's already doing a direct pairwise test). This exact-distance test is itself the same conservative lower bound proven above, so it is a valid no-false-negative precheck, and it doubles as the "exact AABB distance retest" the TLAS path also needs (§6) — meaning the linear oracle's precheck and the TLAS path's post-candidate exact retest are, by design, the *same* predicate, which is exactly what makes them a valid differential correctness pair (same discipline as M2's `_testBroadPhasePair` being reused verbatim as the TLAS exact retest).

---

## 5. Narrow-phase query design (Required Decision 6)

**Two-tier decision per broad-phase-surviving candidate pair**, chosen specifically to bound the cost of the (expensive, geometrically necessary) Hard-Clash-exclusion check from §2/§9. **Corrected by review to be tri-state, not boolean**, on the Hard-Clash precheck:

```
if exact-unpadded-AABB(A) and exact-unpadded-AABB(B) overlap or touch:
    # Hard Clash is geometrically possible for this pair — must check.
    overlapResult = volumeOverlapQuery(A, B)        # reused verbatim, no changes
    if overlapResult.overlap === true:
        # PROVEN overlap.
        mark dbId-pair as hard-clash-excluded; do not compute distance for this fragment pair
    else if overlapResult.overlap === false AND overlapResult.diagnostics has no
            fragment-pair-scoped entry for (A, B) indicating an incomplete/inconclusive evaluation:
        # PROVEN no overlap.
        run clearanceQuery(A, B, {clearance})
    else:
        # INCONCLUSIVE: overlap:false was reached via an incomplete evaluation
        # (e.g. exhausted containment-sampling budget, unsupported-geometry gate).
        # Do NOT compute distance and do NOT emit a clearance result for this
        # fragment pair — a false "no overlap" here could turn an undetected Hard
        # Clash into a reported Soft Clash, which is worse than an incomplete result.
        push diagnostic 'clearance-hard-clash-precheck-inconclusive' (pair-scoped);
        this fragment pair contributes nothing to the dbId-level clearance result
else:
    # AABBs are genuinely separated (a real gap exists) — Hard Clash is geometrically
    # impossible (crossing requires shared points; containment requires the contained
    # AABB to be inside the container's AABB), so the volume-overlap check is skippable.
    run clearanceQuery(A, B, {clearance})
```

**Why the tri-state correction matters:** `volumeOverlapQuery` already returns `{overlap:false, diagnostics}` for genuinely inconclusive cases (e.g. containment-sampling budget exhaustion, unsupported-geometry gates feeding `anyComponentInside`) — `overlap:false` there means "not proven," not "proven absent." Treating any `overlap:false` as license to proceed to distance computation (the initial draft's bug) could report a Soft Clash for a dbId pair that is, in fact, an undetected Hard Clash — a false positive strictly worse than an incomplete result, and a direct violation of §12's non-negotiable "never silently convert an unverified evaluation into a negative verdict" principle applied to the *exclusion* check itself, not just the distance computation. The inconclusive branch's diagnostic **does** count toward the standard "result may be incomplete" caveat (same partitioning as `clearance-distance-unavailable`, §13 below) — the dbId pair is simply omitted from this call's `clearance` results, never falsely reported either way. If a *different* fragment pair for the same dbId later proves a genuine Hard Clash, the dbId pair is excluded via the proven-overlap branch as normal; the inconclusive diagnostic from the other fragment pair is still retained in `statistics.diagnostics` (diagnostics describe what was actually observed during evaluation and are never retracted once recorded, matching the existing `witness-unavailable` precedent of being pair-scoped and permanent).

This remains a correctness-preserving optimization on the common path: crossing requires the two surfaces to share a point (hence AABB overlap is necessary), and containment requires the contained instance's AABB to lie within the container's AABB (also implying overlap) — so the `volumeOverlapQuery` precheck is provably unnecessary whenever the unpadded AABBs are already disjoint, which is expected to be the common case for a genuine near-miss search (most surviving broad-phase candidates are nearby-but-separated, not touching).

**`clearanceQuery` module** — new file `collision/query/ClearanceQuery.js`, pure/stateless like the other five narrow-phase modules:

```js
export function clearanceQuery(source, target, options = {})
  // source/target: { geometry, bvh, matrix, localDiagonal }  — same Instance shape as volumeOverlapQuery
  // options: { clearance, toleranceFloor }
  // returns one of:
  //   { withinClearance: true,  distance, witness: { sourcePoint:[x,y,z], targetPoint:[x,y,z] } }
  //   { withinClearance: false, distance: null }   // nothing found within [0, clearance] in world units — beyond threshold
  //   { withinClearance: false, distance }         // found, but at/below toleranceFloor — touching/dead-band, not a hit (§2)
  //   { aborted: true, diagnostics }                // could not evaluate (non-finite transform, anisotropic scale, missing boundsTree)
```

**Scale contract (fixes the world-space correctness gap found by review):** `clearanceQuery` supports rigid transforms and uniform per-instance scale only. Before any distance work, both `source.matrix` and `target.matrix` are decomposed (`Matrix4.decompose`) and each operand's 3-axis scale is checked for equality within a small relative tolerance. If either operand carries non-uniform (anisotropic) scale, the pair returns `{aborted: true, diagnostics: [{reason: 'clearance-anisotropic-scale-unsupported', ...}]}` — diagnosed as unsupported, exactly like the existing `aspectRatioExceeded` gate for a different unsupported-geometry class, never silently computed with a wrong scalar distance.

Given validated uniform scale, the call is: `source.bvh.closestPointToGeometry(target.geometry, targetToSourceMatrix, target1, target2, 0, clearance / sourceScaleFactor)`, where `targetToSourceMatrix = inverse(source.matrix) * target.matrix` and `sourceScaleFactor` is source's validated uniform scale factor (extracted from the decomposition above). `minThreshold` is passed as **`0`, never `toleranceFloor`** (per §3's corrected `minThreshold` semantics — it is an early-exit optimization, not an exclusion filter, and misusing it as one was the initial draft's Critical defect); `maxThreshold` is `clearance` **converted into source-local units** by dividing by `sourceScaleFactor`, since the pinned API's threshold arguments are in the same local-frame units as its returned distance. `target1`/`target2`'s raw `faceIndex` values are resolved via `bvh.resolveTriangleIndex()` before any downstream use (per §3's indirect-BVH caveat). Both closest points are converted to world-space via `toFiniteWorldArray` — critically, **each point uses its own operand's `worldMatrix`** (`target1.point` via `source.matrix`, `target2.point`, first converted back through `target.matrix`'s own frame, via `target.matrix`), never the relative transform — the exact existing helper `VolumeOverlapQuery.js` already uses for witness points, applied correctly per-point. A non-finite conversion on either side is treated as `aborted: true` with a `'clearance-distance-unavailable'` diagnostic.

If the raw call returns non-null, the returned local-frame `distance` (either `target1.distance` or `target2.distance` — both describe the same physical separation and are cross-checked for agreement within a small tolerance as a correctness sanity check, not two independent measurements) is multiplied by `sourceScaleFactor` to produce the **world-space `distance`** the public API reports. This scalar conversion is exact for a uniform scale (a single linear factor applies identically in every direction), which is precisely why anisotropic scale is diagnosed as unsupported above rather than "solved" — no single scalar conversion exists for it.

Post-hoc classification against `toleranceFloor` (itself now expressed in world units, per §9's corrected definition) then applies: `distance <= toleranceFloor` → `withinClearance: false` (touching/dead-band, §2); `distance > toleranceFloor` (and, by construction of the `maxThreshold` bound, `<= clearance`) → `withinClearance: true`, with the witness. If the raw call returns `null` (nothing found within `[0, clearance/sourceScaleFactor]` in local units), `withinClearance: false, distance: null` — genuinely beyond threshold; the pinned API doesn't return a value in that case, and computing the true excess distance would require a second, unbounded query, defeating the point of the threshold-bounded pruning (the "threshold early-out is allowed" option from the required decisions).

---

## 6. Public `ClashPair` result shape (Required Decision 7)

```js
{
  source: {...}, target: {...},         // unchanged shape
  type: 'clearance',                    // literal — mode value, same convention as existing types
  distance: number,                     // measured minimum world-space separation
  clearance: number,                    // echoes the requested threshold, for caller convenience
  witness: {
    sourcePoint: [x, y, z],             // world-space closest point on the source surface
    targetPoint: [x, y, z],             // world-space closest point on the target surface
  },                                    // always present and non-null on a returned pair, see below
}
```

**Correction (post-review):** the initial draft allowed `witness: null` on an emitted `clearance` pair, mirroring M2.1's fault-tolerant `volume-overlap` witness — but no code path in the corrected §5/§12 design can actually produce that state: a fragment pair that fails to compute a witness (`clearance-distance-unavailable`) never reaches the point of contributing a dbId-level result at all; it only contributes a diagnostic (§12). A `type: 'clearance'` pair is therefore **only ever emitted when a valid, non-null witness was successfully computed** for its winning fragment pair — unlike `volume-overlap`, where the boolean verdict is independently trustworthy even without a marker, `clearance`'s entire verdict (the `distance`) depends on the same computation that produces the witness, so there is no scenario where the pair exists but the witness doesn't.

**Why `witness` keeps its name but changes shape by type, rather than a new field name:** the existing convention already gates *presence* of `witness` by `type` (`'witness' in pair === false` for `containment`/`surface-intersection` pairs). Extending that same gate to also vary the *shape* of `witness` by `type` (`{kind,point}` for `volume-overlap`, `{sourcePoint,targetPoint}` for `clearance`) is a natural, minimal extension of an already-accepted pattern, not a new kind of polymorphism — callers must already branch on `pair.type` before touching `pair.witness` today. A structurally different single-point shape reused under a *different* field name (e.g. `clearanceWitness`) would be more explicit but adds a second field name for what is conceptually the same "how do I visualize this pair" concept; keeping one name, discriminated by `type`, was judged preferable given the existing discipline already requires type-based branching. `distance`/`clearance` are new top-level fields (not nested in `witness`) because they are measured/requested *scalars* describing the pair itself, independent of whether a visual witness could be computed — this mirrors why `type`/`source`/`target` are top-level while only the optional visualization detail is nested.

`supportedModes` gains `'clearance'` as a fourth entry. `findClashes` validation gains the `clearance` numeric-input check from §2.

---

## 7. Closest-point / visualization witness (Required Decision 8)

**Adopted:** two small endpoint markers (source-side, target-side — reusing the exact shared-geometry/shared-material sphere-mesh pattern `ClashFinderExtension.js` already uses for Hard Clash markers, so no new visual language is introduced) **plus one connecting line segment** between `witness.sourcePoint` and `witness.targetPoint`, both in world space.

**Rationale:** a single midpoint marker (the M2.1 Hard Clash pattern) communicates *where* a violation is, but Soft Clash's defining question is also *how far apart* — a connecting line's length is itself the answer, and two endpoints let the user see which side is which. A full measurement UI (numeric distance label, snapping, multi-select comparison) is explicitly out of scope per the M3 prompt's non-goals; the line/two-marker combination is the minimal representation that still answers both "where" and "roughly how far."

**Lifecycle:** identical discipline to M2.1's markers — same stale-action-token gating, same clear-on-success/zero-result/failure/model-unload/extension-unload points, same r71-only THREE construction (`window.THREE`, never the library's imported r185 three.js), same `depthTest:false` choice for visibility through occluding geometry (consistency with the existing marker behavior, which already established this as the right default for "prove this exists" visualizations in this codebase). The line is simply one more overlay-scene object tracked in the same lifecycle bookkeeping array as the markers — no new lifecycle category, no new invalidation path. Numeric distance labels are explicitly deferred (not needed, non-goal risk of dashboard creep).

---

## 8. Deterministic dbId-level aggregation (Required Decision 9)

**Minimum-distance fragment pair wins**, with a deterministic tie-break, mirroring M2.1's `compareWitnessCandidates` pattern exactly:

1. A fragment pair with `withinClearance: true` (a real, in-range distance) beats one without.
2. Among two in-range candidates, the **smaller `distance`** wins.
3. Exact ties (bit-identical `distance`, an edge case with axis-aligned synthetic fixtures) are broken by `comparePlacedCanonically` applied first to the source operand, then the target operand — the same total order M2.1 already established, reused verbatim.

**Hard-Clash exclusion is call-scoped, not fragment-pair-scoped:** if *any* contributing fragment pair for a given dbId pair is flagged `hard-clash-excluded` (§5/§9), the entire dbId pair is omitted from the `clearance` result set for that call — never reported with a "smaller" clearance distance from some other, non-overlapping fragment pair. This is deterministic and traversal-order-independent because it is evaluated as a simple boolean OR across all contributing fragment pairs for that dbId key, accumulated the same way the existing witness-candidate comparator already accumulates across fragment pairs before producing one dbId-level result.

---

## 9. Units and Viewer/model alignment (Required Decision 10)

Distance is computed entirely in Viewer scene/world coordinates, using each operand's existing `worldMatrix` — the same trust boundary every other narrow-phase query and the M2.1 witness point already rely on. No new alignment-transform logic is introduced inside `collision/`; federation/unit normalization is presumed handled upstream by the Viewer's own `fragList.getWorldMatrix`, exactly as M1's design already states and M2's live federated acceptance (a real cross-model witness point at plausible real-world coordinates) already empirically exercises.

**Settled by review (was an open question in the initial draft):** the M1 spec flags that anisotropic (non-uniform) per-instance scale has no direction-independent scalar-conversion answer at the architecture level — this is exactly the gap that made the initial draft's distance computation wrong (§3/§5's Critical fix). M3's adopted policy resolves it explicitly rather than deferring it: **rigid transforms and uniform per-instance scale are supported; non-uniform scale is diagnosed as unsupported (`clearance-anisotropic-scale-unsupported`) and excluded, never silently computed as a wrong number.** The per-operand uniform-scale-factor correction in `clearanceQuery` (§5) is applied to *each operand's own* scale independently — because the relative transform already places the target into the source's local frame under the assumption that both operands' `worldMatrix`es are individually correct within a shared Viewer world space (the same assumption M1/M2 already rely on, and M2's live federated acceptance already empirically exercises via a plausible cross-model witness coordinate), this per-operand correction is sufficient even when two federated models encode different underlying unit systems as different uniform model-level scale factors — no additional cross-model unit-reconciliation logic is required beyond what M1/M2 already established. The one remaining, genuinely pre-existing (not M3-specific) assumption is that the Viewer's own `fragList.getWorldMatrix` correctly places every model into one shared, comparable world-unit space to begin with — unchanged from M1/M2, not newly load-bearing in a way M3 introduces, and not re-verified here since it is exercised by the existing M2 live acceptance test.

**`invalidateModelPlacement` interaction:** unchanged from the existing contract. Clearance's TLAS broad phase and linear oracle both consume the exact same `_placementByEpoch`/revision/lazy-refresh machinery as Hard Clash (no new placement-tracking structures introduced), so a subsequent clearance query after `invalidateModelPlacement` follows the identical lazy rebuild path already proven for Hard Clash.

---

## 10. Capacity / budget semantics (Required Decision 11)

- **Broad-phase primitive-candidate expansion** (the inflated `queryBox` traversal): reuses `maxTlasCandidatePairs` verbatim, same incremental-during-traversal check, same `CapacityExceededError` deferred-throw-after-return discipline. No new constant — the existing constant's own stated rationale ("bounds primitive-candidate expansion... traversal cost not known until it runs") applies unchanged to an inflated query box; if anything, clearance queries are expected to consume more of this budget per call than Hard Clash (larger effective query volume), which is exactly the kind of pressure this constant already exists to catch.
- **Narrow-phase exact-work budget — new semantic, no numeric value chosen here:** a new call-scoped counter, `maxClearanceNarrowPhasePairs` (name only — value deliberately left provisional, to be set the same way `maxCandidatePairsExamined`/`maxSyncTriangleCount` were: an initial reasoned default, revised against the M3 performance gate's real numbers). This is needed because `maxTlasCandidatePairs` only bounds *broad-phase* AABB-candidate volume, not how many (potentially expensive) `volumeOverlapQuery`/`closestPointToGeometry` narrow-phase calls actually execute — the same gap M1 already addressed for Hard Clash's own narrow phase via `maxCandidatePairsExamined`/`maxCrossingPairsExamined`, which this mirrors rather than duplicates in spirit.
- **Early-out by threshold:** `closestPointToGeometry`'s own `maxThreshold=clearance` argument provides traversal-internal pruning (§3/§5) — a second, complementary control to the pair-count budget above, not a replacement for it (one bounds cost-per-call, the other bounds cost-per-pair).
- **Scope:** one running counter per `findClashes` call (not per-model), matching the existing `maxTlasCandidatePairs` convention exactly.
- **Known, unmitigated limitation (flagged by review):** `maxClearanceNarrowPhasePairs` bounds the *count* of `closestPointToGeometry` calls per `findClashes` invocation — it cannot bound the *duration* of a single call. The pinned `closestPointToGeometry` is purely synchronous with no yield point, checkpoint hook, or abort callback (§3); a single pathological pair (e.g. two large, densely-tessellated meshes with broadly overlapping bounds and a generous `clearance`) could in principle block the main thread for longer than `frameBudgetMs` before the pair-count budget ever has a chance to intervene. M3 does not solve this (a fix would mean either a worker/off-main-thread rewrite, explicitly a non-goal without evidence, or upstream changes to the pinned library) — §17's performance gate is required to measure the worst-case single-call span on realistic geometry and report a go/no-go disposition rather than this spec presuming the risk is negligible.

---

## 11. Statistics (Required Decision 12)

New additive fields, always present (default 0 for non-`'clearance'` calls), mirroring M2's 9-field TLAS statistics pattern:

| Field | Meaning |
|---|---|
| `clearanceExpandedCandidatePairs` | broad-phase primitive candidates surviving the inflated-AABB `queryBox` traversal (what the reused `maxTlasCandidatePairs` bounds) |
| `clearanceExactAabbSurvivors` | candidates surviving the exact/unpadded AABB-distance retest, i.e. proceeding to narrow-phase work of either kind |
| `clearanceOverlapPrechecksRun` | count of candidates whose unpadded AABBs overlapped/touched, requiring the `volumeOverlapQuery` precheck from §5 before any distance computation |
| `clearanceHardClashExclusions` | dbId-level pairs excluded from the `clearance` result set because ≥1 contributing fragment pair was a Hard Clash — visibility into how often §9's exclusion rule actually fires |
| `clearanceDistanceQueriesRun` | count of actual `closestPointToGeometry` narrow-phase calls executed |
| `clearanceHits` | final within-clearance dbId-level pair count (equals `pairs.length` for a `mode:'clearance'` call — included for parity with other per-call summary fields, not derivable elsewhere without recomputation) |
| `clearanceQueryMs` | narrow-phase distance-query wall-clock, same bracketing convention as `tlasQueryMs`/`narrowPhaseMs` |

No per-candidate distance histograms, no separate closest-point-query sub-timing breakdown — not needed for correctness or performance analysis at this milestone, consistent with the instruction not to add fields merely because they're measurable.

**Relationship to existing M2 TLAS fields (clarified by review — the initial draft left this ambiguous):** because clearance's broad phase reuses the exact same `queryBox`/leaf-range-emission traversal machinery as Hard Clash (§4 — only the query box is inflated, not the underlying `CollisionInstanceBVH` or traversal code path), the existing `tlasLeafRangeEmissions`, `tlasPrimitiveCandidatePairs`, `tlasExactRetestSurvivors`, `tlasNarrowPhaseInputPairs`, `tlasBuilds`, `tlasCacheHits`, `tlasSharedBuildWaits`, `tlasBuildMs`, and `tlasQueryMs` are populated **identically, by the same code, for a `mode:'clearance'` call as for `mode:'volume-overlap'`** — they are not clearance-specific and are not duplicated by the new fields below. The 7 `clearance*` fields are additional, layered on top to describe clearance-specific stages the generic TLAS fields don't distinguish (the exact-AABB-distance retest, the tri-state overlap precheck, and the narrow-phase distance-query stage itself). Exact increment points:

- `clearanceExpandedCandidatePairs` — incremented once per primitive candidate accepted by the inflated-AABB `queryBox`'s `onCandidate` callback (i.e. after per-primitive exact-bounds filtering within a matched leaf range, the same point M2's own `broadPhasePairs` is derived from — **not** raw leaf-range emissions, which `tlasLeafRangeEmissions` already covers generically).
- `clearanceExactAabbSurvivors` — incremented once per candidate whose exact, unpadded AABB-to-AABB distance is `<= clearance` (§5's branch condition), i.e. candidates proceeding to either the overlap precheck or directly to `clearanceQuery`.
- `clearanceOverlapPrechecksRun` — incremented once per candidate entering §5's `volumeOverlapQuery` precheck branch (unpadded AABBs overlap/touch).
- `clearanceHardClashExclusions` — incremented once per **dbId-level** pair omitted from the `clearance` result set because of a proven Hard Clash on any contributing fragment pair (not incremented for the inconclusive-precheck branch, which is separately visible via its own diagnostic count).
- `clearanceDistanceQueriesRun` — incremented once per actual `clearanceQuery`/`closestPointToGeometry` call executed (both the direct branch and the post-proven-no-overlap branch of §5).
- `clearanceHits` — the final `pairs.length` for this call; included for parity with other per-call summary fields.
- `clearanceQueryMs` — wall-clock spent inside `clearanceQuery` calls only, same bracketing convention as `tlasQueryMs`.

For `broadPhase:'linear'` clearance calls, the `clearance*` fields are populated by the equivalent linear-scan stages (`clearanceExpandedCandidatePairs` has no meaning under `'linear'` and stays `0`; `clearanceExactAabbSurvivors` onward populate identically in meaning, driven by the linear oracle's own exact-AABB-distance precheck from §4). Existing M1/M2/M2.1 statistics fields are otherwise unmodified.

---

## 12. Diagnostics / incomplete results (Required Decision 13)

Reuses existing fragment-scoped diagnostics verbatim for unavailable/unsupported/non-finite geometry inputs (`geometry-not-yet-available`, `unsupported-geometry-layout`, etc. — same source, same dedup-per-`(epoch,fragId,reason)` convention).

**New pair-scoped diagnostics, enumerated (corrected by review — the initial draft's "or any other failure" catch-all is removed, since silently absorbing unenumerated exceptions into a diagnostic would conceal programmer defects rather than surface genuine transient/data conditions):**

- `'clearance-distance-unavailable'` — `clearanceQuery` reached `closestPointToGeometry` but a downstream step failed for a recoverable, expected reason: a witness point's `toFiniteWorldArray` conversion produced a non-finite result, or the underlying BVH-to-BVH call itself signaled an internal recoverable failure.
- `'clearance-anisotropic-scale-unsupported'` — either operand's `worldMatrix` decomposes to non-uniform scale (§5).
- `'clearance-invalid-transform'` — either operand's `worldMatrix` is non-finite or singular (non-invertible), detected **before** the pair is even offered to broad-phase candidate filtering (see the validation-timing fix below).
- `'clearance-hard-clash-precheck-inconclusive'` — the tri-state overlap precheck (§5) could not prove absence of Hard Clash for this fragment pair.

Any exception raised during clearance evaluation that does **not** match one of these four enumerated, recoverable conditions is **not** caught and converted to a diagnostic — it propagates as a genuine error, consistent with the library's existing allowlisted-error-handling discipline (`errors.js`'s own class-per-condition pattern), rather than the initial draft's open-ended "any other failure" language which could have silently absorbed real defects.

**Validation timing (corrected by review):** the initial draft only checked for non-finite transforms inside `clearanceQuery`, after a pair had already survived broad-phase candidate filtering — but `extractFragments`/`extractAllFragments`/`ViewerModelAdapter.js` do not currently validate finiteness of `worldBounds`/`worldMatrix` at extraction time (`ViewerModelAdapter.js:42`). A non-finite `worldBounds` would silently fail every AABB comparison (NaN comparisons are always `false`), producing zero candidates and **zero diagnostics** — exactly the silent-incompleteness failure mode §12's own non-negotiable principle forbids. M3 therefore requires validating finite, correctly-ordered `worldBounds` and a finite, invertible `worldMatrix` for every instance **as part of clearance's own admission path**, immediately after extraction and before either broad-phase AABB inflation or the linear oracle's pairwise scan — pushing `'clearance-invalid-transform'` per offending instance rather than letting it silently vanish from candidate consideration. This is a new validation requirement introduced by M3 specifically because a numeric `distance` output is far less tolerant of degenerate input than the prior boolean-only modes were; it is not a retroactive fix to extraction itself, which is unchanged for the other three modes.

**Diagnostic persistence (answers a review question):** a diagnostic recorded for one fragment pair (e.g. `clearance-hard-clash-precheck-inconclusive`) is never retracted or removed if a *different*, later-evaluated fragment pair for the same dbId-level pair proves a genuine Hard Clash (and the dbId pair is consequently excluded via the proven-overlap branch instead). Both facts are real and both are retained in `statistics.diagnostics` — diagnostics describe what was observed during evaluation, not the final aggregate verdict, matching the existing pair-scoped, non-superseded precedent `witness-unavailable` already established.

**Deliberate divergence from M2.1's `witness-unavailable` carve-out:** `witness-unavailable` does *not* count toward "result may be incomplete" for `volume-overlap`, because the boolean clash verdict is already fully determined by the time a witness fails to compute — the marker is a bonus, not the verdict. For `clearance`, the **distance itself is the verdict** — if `closestPointToGeometry` cannot be evaluated for a candidate pair, there is no fallback source of truth for whether that pair is within threshold. `'clearance-distance-unavailable'` therefore **does** count toward the standard "may be incomplete" caveat, the opposite partitioning decision from `witness-unavailable`, and this spec calls that out explicitly so a future reader doesn't assume the M2.1 precedent transfers unchanged.

**Budget exhaustion:** a new `CapacityExceededError` kind, `'clearance-narrow-phase-budget'`, following the exact existing pattern — accumulated as a pending error inside broad-phase/narrow-phase traversal callbacks, thrown only after the relevant traversal call returns, never mid-callback.

**Non-negotiable principle, restated:** no code path may convert an unverified or incomplete clearance evaluation into a silent "not a Soft Clash." Every such case produces a diagnostic.

---

## 13. Viewer UX: context-menu integration (Required Decision 14)

**Adopted:** a second, independent context-menu action, **"Find Soft Clashes,"** alongside the existing "Find Clashes" entry — not a mode toggle grafted onto the existing action. This keeps the already-tested Hard Clash flow (`clash-finder.acceptance.mjs`'s 106/106-passing coverage) entirely untouched, and avoids any new modal/settings UI for mode selection.

**Clearance threshold input (corrected by review — the initial draft specified only an "e.g." option name with no actual fallback, which would make every click throw once `clearance` fails §2's required-numeric-input validation):** `ClashFinderExtension` defines a real, concrete internal default — `DEFAULT_CLEARANCE = 0.05` (world units; provisional, like every other numeric constant in this library, explicitly subject to revision once real usage/the performance gate gives evidence for a better value — the *contract* that a usable default always exists is what this spec settles now, not the tuned number itself). At `load()` time, the extension resolves `this._clearance = this.options.defaultClearance ?? DEFAULT_CLEARANCE` and **validates it immediately** (finite, `> 0`) — an invalid caller-supplied override fails `load()` itself with a clear thrown error (configuration-time failure, loud and immediate), rather than deferring to a per-click `findClashes` validation failure deep inside a context-menu callback. This guarantees the "Find Soft Clashes" action is always invocable with zero required configuration (the no-options construction path used by `clash-finder.acceptance.mjs` today), while `options.defaultClearance` remains available for callers (including future tests) that want a different value — without any prompt/dialog UI. A `window.prompt()`-style interactive input was evaluated and rejected for M3 — it adds modal-UX surface area the prompt's non-goals (no settings/dashboard infrastructure) argue against, for a milestone whose primary acceptance criterion is a known threshold value, not arbitrary user-chosen ones.

**Invocation shape**, mirroring the existing Hard Clash call exactly:

```js
result = await this._world.findClashes({
  source: { model: sourceModel, dbIds: [sourceDbId] },
  target: { targets: this._viewer.getAllModels().map((model) => ({ model })) },
  mode: 'clearance',
  clearance: this._clearance,
  groupBy: 'dbId',
  // broadPhase intentionally omitted — defaults to 'tlas' for the targets shape, same as Hard Clash
});
```

---

## 14. Visualization lifecycle (Required Decision 15)

No new lifecycle category. The two-endpoint-marker-plus-line visualization from §7 is tracked in the same array/token/cleanup bookkeeping `ClashFinderExtension.js` already uses for Hard Clash markers — stale-action token check before touching results, clear on success/zero-result/failure, full-visualization clear on any model unload (not filtered to participating models, matching the existing documented "partial preservation was shown unsound" decision), cleanup on extension unload, r71/r185 isolation preserved. The existing marker lifecycle discipline is reused, not reopened.

---

## 15. Correctness fixtures

All fixtures use the existing `box(w,h,d)`/`at(x,y,z)`/`testInstance(geometry, matrix)` helpers from `test/fixtures/geometry.mjs` (already builds real production BVH/connectivity via `ThreeMeshBvhBackend`/`GeometryConnectivity` — no bespoke test-only geometry pipeline), giving exact, hand-computable known distances:

1. **Far apart:** `box(2,2,2)` at origin vs. `box(2,2,2)` at `(10,0,0)` with `clearance=2` → known exact gap 8 units → no Soft Clash.
2. **Exactly at threshold:** same pair, offset chosen so the exact face-to-face gap equals `clearance` precisely → result per §2's inclusive-at-ceiling rule (included).
3. **Slightly within threshold:** `box(2,2,2)` at origin vs. `box(2,2,2)` at `(2.5,0,0)` (`clearance=1`) → known exact gap 0.5 → Soft Clash, `distance≈0.5`.
4. **Surface touching:** `box(2,2,2)` at origin vs. `box(2,2,2)` at `(2,0,0)` (`clearance` large enough to otherwise include it) → gap exactly 0 → classified as touching (§2's `surface-intersection` territory), **not** reported under `clearance`.
5. **Positive-volume overlap:** two overlapping boxes (existing `VolumeOverlapQuery.test.mjs` fixtures) → `volume-overlap` fires, **not** misreported as `clearance` (exercises §5's precheck branch).
6. **Containment:** small box fully enclosed inside a larger box with a real interior gap (existing containment fixture shape, `box(10,10,10)` vs `box(1,1,1)` at `(3,3,3)`) → `volume-overlap` (containment) fires; even though the enclosed box's surfaces are geometrically far from the container's surfaces, the pair must **not** appear under `clearance` (directly exercises §9's exclusion rule, the case that motivates it).
7. **Rotated/transformed geometry:** a box rotated 45° about one axis at a known offset, expected minimum distance computed analytically (corner-to-face or edge-to-face case) → validates the relative-transform argument to `closestPointToGeometry` is applied correctly.
8. **Cross-model federated clearance:** two instances in different `loadEpoch`s (different `Model` objects) at a known synthetic offset → validates §9's world-space/no-separate-alignment-math assumption end-to-end in the unit-test tier (not just the live acceptance tier).
9. **Source self-exclusion:** clearance query whose target scope includes the source's own model → source instance never appears as its own target.
10. **Multi-fragment dbId, minimum wins:** one dbId with two fragments at different distances from a target — aggregation must select the closer fragment pair, deterministically, regardless of which fragment is enumerated first (§8).
11. **Linear vs. TLAS parity:** the same clearance query run under `broadPhase:'linear'` and `broadPhase:'tlas'` must produce identical final `pairs` sets (same `distance`/`witness` values, order not compared) — direct differential-oracle test, same discipline as M2's `CollisionWorld.tlasTraversal.test.mjs`.
12. **Placement invalidation:** `invalidateModelPlacement` after moving one instance closer than/farther than the threshold must change the clearance verdict correctly on the next call — validates §9's lazy-refresh interaction.
13. **Dead-band (added by review):** two boxes separated by a known gap smaller than `toleranceFloor` (e.g. `1e-7` relative to instance size) → not reported under `clearance` **and** not reported under `surface-intersection` (surfaces genuinely don't touch) — directly proves §2's corrected dead-band behavior rather than the initial draft's incorrect "would show up elsewhere" claim.
14. **Inconclusive Hard-Clash precheck (added by review):** a synthetic pair constructed so `volumeOverlapQuery`'s containment-sampling path returns `overlap:false` with an incomplete-evaluation diagnostic (e.g. by forcing `maxContainmentSamples` exhaustion via a pathological component count) and whose true surface distance would otherwise qualify as a Soft Clash → the pair must **not** appear in `clearance` results, and `'clearance-hard-clash-precheck-inconclusive'` must appear in `statistics.diagnostics` — directly exercises §5's tri-state correction, the review's Critical Issue 3.
15. **Anisotropic scale rejection (added by review):** one instance with a non-uniformly-scaled `matrix` (e.g. `Matrix4.makeScale(2,1,1)` composed with a translation) at a distance that would otherwise be within `clearance` → `'clearance-anisotropic-scale-unsupported'` diagnostic, pair excluded, never a silently-wrong `distance` — exercises §3/§5/§9's Critical fix.
16. **Uniform scale correctness (added by review):** one instance uniformly scaled (e.g. `Matrix4.makeScale(2,2,2)` composed with translation) at a known, hand-computable world-space gap → `clearanceQuery`'s reported `distance` must equal the true world-space gap (not the unconverted local-frame value) — the direct positive-case regression test for the review's Critical Issue 2 fix.
17. **Non-finite/invalid transform (added by review):** an instance with a deliberately non-finite or singular `worldMatrix` injected at the extraction boundary → `'clearance-invalid-transform'` diagnostic pushed and the pair excluded from candidate consideration, never silently dropped with zero diagnostics — exercises §12's validation-timing fix.

---

## 16. Live federated acceptance

**Finding (from bounded research, not yet a bounded discovery *spike*):** the existing `test/acceptance/clash-finder.acceptance.mjs` fixture (3 real federated Audubon Architecture/Structure/Mechanical models, ~7,474 fragments) documents exactly two known ground-truth cases today — one Hard Clash pair (Structure dbId `2734`) and one clean geometric negative (Structure dbId `3965`, verified bounding box, zero pairs). **No known near-miss (close-but-non-intersecting) pair is documented anywhere in this fixture, its header comment, or any other repo doc.** This gap was already anticipated by the M3 prompt itself.

**Adopted plan:** a bounded fixture-discovery step, following the exact precedent M2.1's Task 10 already established for the witness-occlusion proof — a throwaway Playwright spike that issues the real production `findClashes({mode:'clearance', ...})` query (or, pre-implementation, a bounding-box proximity scan over the same 3-model scene's already-loaded element metadata) against the existing scene to *live-derive* a genuine near-miss pair and its measured distance, rather than assuming one exists or brute-forcing an unbounded search. Bound the scan explicitly (e.g. a fixed clearance-candidate range like `0.01`–`2.0` units, capped iteration count) — matching the prompt's own "do not brute-force an unbounded federation search" constraint.

**Fallback if discovery finds nothing suitable (settled by review — the initial draft left this genuinely undecided):** the bounded discovery spike is **required to run at least once**; if it finds no suitable real near-miss pair, a synthetic (non-Viewer, unit-tier) fixture is **sufficient** to close M3's acceptance requirement, and a live Viewer-hosted near-miss pair is preferred but **not mandatory**. Rationale: §15's correctness fixtures already fully exercise the core distance/threshold/aggregation/exclusion logic at the unit tier with exact, analytically-known geometry — the live acceptance test's distinct job is proving the *Viewer-integration plumbing* (context menu → `findClashes` → visualization → lifecycle) end-to-end, which does not strictly require a *geometrically near-miss* real pair; it can instead assert the correct (empty or populated) result against a `clearance` value chosen relative to an *already-known* real distance in the existing fixture — e.g. running `mode:'clearance'` against the existing `NEGATIVE_CASE` element (`3965`) with a `clearance` provably smaller than its true measured distance to everything, proving the "no false positive" path end-to-end through the real Viewer/extension stack, without requiring a brand-new near-miss ground-truth pair to exist.

If a near-miss pair is found (by either path), the acceptance test should additionally cover: known negative beyond threshold (reuse or extend the existing `NEGATIVE_CASE` element, `3965`, at a `clearance` value provably smaller than its true distance from anything), no Hard Clash pair leaking into `clearance` results (reuse `2734`'s known Hard Clash — assert it is absent from a `clearance` query's `pairs`), model provenance, and a model-alignment `invalidateModelPlacement` re-verification step mirroring M2.1's existing alignment test — reusing the exact same `viewer.impl.setPlacementTransform` pattern already proven in `clash-finder.acceptance.mjs`.

---

## 17. Performance gate

New `run-gate-m3.mjs`, mirroring `run-gate-m2.mjs`'s shape (same real 3-discipline Audubon fixture, same `CheckpointRecorder`/`browser-probes` instrumentation) rather than inventing new harness machinery. At minimum, measured and reported plainly (no numeric thresholds presumed a priori, matching M1/M2's evidence discipline):

1. Clearance TLAS broad phase vs. clearance linear oracle — candidate counts (`clearanceExpandedCandidatePairs` vs. the linear scan's pair count) and wall-clock, cold and warm.
2. Candidate reduction ratio (TLAS vs. linear), reported the same way M2's ~3.9x figure was — a real number, not assumed.
3. `clearanceOverlapPrechecksRun` vs. `clearanceDistanceQueriesRun` split — quantifies how often the (more expensive) `volumeOverlapQuery` precheck from §5 actually fires vs. the direct-distance path, on a realistic federated scene.
4. `clearanceQueryMs` as a fraction of `totalMs` — since `closestPointToGeometry` is a genuinely new, potentially-more-expensive-per-call primitive relative to the existing narrow-phase queries, this spec explicitly does not presume it will be cheap; if it dominates end-to-end cost (plausible, given M2's own finding that narrow phase already dominates Hard Clash's wall clock even with a 3.9x broad-phase candidate reduction), the gate must say so plainly rather than the design assuming otherwise.
5. End-to-end wall clock on the realistic federated case, cold and warm, both `broadPhase` values.
6. **Worst-case single `clearanceQuery` span, with an explicit go/no-go disposition (added by review — the initial draft's gate was report-only with no failure criterion, and §10 already flags that the per-call pair-count budget cannot bound one call's duration).** Bracket each individual `closestPointToGeometry` invocation the same way M1's per-primitive spans are already bracketed (`CheckpointRecorder`). If the worst observed single-call span on the realistic federated fixture exceeds `frameBudgetMs` (8ms) by a substantial, consistent margin, the gate must say so plainly and record a **go/no-go disposition** for M3 as designed — not silently ship an interaction that can freeze the main thread on a single pathological pair. A genuine failure here does not necessarily block M3 (a tighter default `clearance`, or scoping the feature to smaller selections, may be sufficient mitigations within the existing non-goals), but it must be an explicit, reported finding, not an assumption.

---

## Non-goals (restated, unchanged from the prompt)

No penetration volume, clash volume, collision manifold, CSG, physics, continuous collision detection, worker/off-main-thread rewrite without evidence, GPU collision, full clash-management dashboard, issue tracking/approval workflow, persistent clash storage, arbitrary per-fragment animation/explode support. This spec does not reopen M1/M2/M2.1 architecture beyond the points explicitly cited above as dependencies.

---

## Required review disposition

An independent targeted design review was performed (`codex-review`, `spec` type, `high` effort, request `20260908-000037-55283-23610`) after `codex-worker` was started, focused on: Soft Clash semantics vs. existing Hard/Surface/Containment meanings; exact minimum-distance correctness; broad-phase conservativeness/no-false-negatives; transform/unit correctness; deterministic dbId aggregation; result/witness shape; Viewer UX/lifecycle compatibility.

**Findings: 4 Critical, 5 High.** All 4 Critical and all 5 High findings were independently verified against the cited source (three-mesh-bvh's actual generated source for the `minThreshold` claim; `VolumeOverlapQuery.js`/`ThreeMeshBvhBackend.js`/`ClashFinderExtension.js`/`ViewerModelAdapter.js` for the others) and accepted — none were rejected as misunderstanding the architecture, and all were fixed in this same pass, in place, throughout the sections above:

1. **`minThreshold` misinterpreted as an exclusion filter** (Critical) — it is an early-exit optimization; fixed in §3 and §5 (`clearanceQuery` now calls with `minThreshold=0` and applies `toleranceFloor` as an explicit post-hoc check).
2. **Distance measured in source-local, not world, coordinates under scale** (Critical) — fixed in §3, §5, §9: rigid + uniform-scale-only contract, per-operand scale-factor conversion, anisotropic scale diagnosed as unsupported.
3. **Inconclusive Hard-Clash precheck treated as proof of no overlap** (Critical) — fixed in §5: the precheck is now tri-state (proven-overlap / proven-no-overlap / inconclusive), with the inconclusive branch excluded from results and recorded as an incompleteness-affecting diagnostic.
4. **No usable default clearance threshold for the Viewer action** (Critical) — fixed in §13: a concrete `DEFAULT_CLEARANCE` constant with load-time validation of any override.
5. **Touching-partition claim didn't match `surface-intersection`'s actual (zero-tolerance) behavior** (High) — fixed in §2: reframed as an explicit, acknowledged dead band rather than a false "reported elsewhere" claim; new fixture #13.
6. **`boundsTree` ownership left as an open question the repo already answers** (High) — fixed in §3: `ThreeMeshBvhBackend.build()` assigning `geometry.boundsTree` is now a required M3 change, not an open item; `testInstance()` fixture-helper update also specified.
7. **Result/statistics contracts internally ambiguous** (High) — fixed in §6 (witness is never `null` on an emitted pair) and §11 (exact increment points defined; relationship to existing `tlas*` fields clarified).
8. **Failure validation too late; catch-all too permissive** (High) — fixed in §12: enumerated diagnostic reasons replace the "any other failure" catch-all; finite/invertible-transform validation moved to admission time, before broad-phase filtering.
9. **No pass/fail criterion for the performance gate; single-call duration unbounded** (High) — fixed in §10 (explicit known-limitation statement) and §17 (new go/no-go criterion #6 for worst-case single-call span).

The review's 5 clarifying questions are answered inline where each fix was made (dead band is intentional, §2; rigid+uniform-scale only, §9; `clearance` for other modes is rejected not ignored, §2; diagnostics are never retracted, §12; synthetic acceptance fallback is sufficient, §16).

No re-review was performed after applying these fixes, per this project's review-loop policy (fix genuine Critical/High findings in the same pass; do not run another comprehensive review). The verdict below reflects this spec-writer's own judgment that the fixes resolve the findings as stated, not a second Codex pass.

---

## Final report

- **Adopted Soft Clash definition:** `NOT volume-overlap(A,B) AND distance(A,B) ∈ (toleranceFloor, clearance]`, with a call-scoped exclusion of any dbId pair having ≥1 Hard-Clash-contributing fragment pair, regardless of what a purely numeric distance check on other fragment pairs would say (§2, §9).
- **Threshold inclusivity:** exclusive at the near-zero tolerance floor (touching stays under `surface-intersection`), inclusive at `clearance` itself (§2).
- **Exact distance definition:** minimum Euclidean distance between the two transformed BLAS-level triangle meshes in Viewer world coordinates, via `MeshBVH.closestPointToGeometry` (§3).
- **`three-mesh-bvh`/distance-query approach:** `closestPointToGeometry(otherGeometry, geometryToBvh, target1, target2, minThreshold, maxThreshold)`, confirmed public/documented/exported/reentrancy-safe in the pinned `0.9.14` source, with a required `resolveTriangleIndex()` step for `indirect:true` BLASes (§3).
- **TLAS/linear broad-phase design:** inflate the source instance's AABB by `clearance`, reuse the existing `queryBox` API unchanged against the existing per-epoch TLAS (no new acceleration structure); linear oracle uses the same exact-AABB-distance predicate directly (§4).
- **Public result shape:** additive `type:'clearance'`, `distance`, `clearance`, and a `witness` field whose *shape* (not just presence) is now type-dependent — `{sourcePoint,targetPoint}` for clearance vs. `{kind,point}` for volume-overlap (§6).
- **Closest-point/witness visualization:** two endpoint markers plus a connecting line segment, reusing M2.1's exact marker/lifecycle machinery (§7, §14).
- **Deterministic dbId aggregation:** minimum-distance fragment pair wins, `comparePlacedCanonically` tie-break, call-scoped Hard-Clash exclusion (§8).
- **Unit/transform contract:** world-space via existing `worldMatrix`, no new alignment math, one flagged-but-inherited open limitation (anisotropic per-instance scale) carried over unchanged from M1 (§9).
- **Budget/statistics model:** reuses `maxTlasCandidatePairs` for broad phase; one new narrow-phase pair-count budget (semantics only, value deferred to the performance gate); 7 new additive statistics fields (§10, §11).
- **Viewer UX:** a second, independent "Find Soft Clashes" context-menu action; fixed-default clearance threshold via extension `options`, no new prompt/settings UI (§13).
- **Acceptance/performance strategy:** a bounded fixture-discovery spike for a near-miss pair (no known one exists in the current fixture today — an honestly-reported gap, not assumed away); a new `run-gate-m3.mjs` mirroring `run-gate-m2.mjs`'s shape, with no numeric outcome presumed for TLAS-vs-linear or for `closestPointToGeometry`'s real cost (§16, §17).
- **Remaining open questions (narrowed from 5 to 2 by the review fix pass):**
  1. The numeric value for the new narrow-phase pair-count budget (`maxClearanceNarrowPhasePairs`) and for `DEFAULT_CLEARANCE` — both deliberately deferred to implementation/the performance gate, per the prompt's own "separate semantics from tuned numeric values" instruction (§10, §13), not a design gap.
  2. Whether the M3 performance gate's new single-call-span criterion (§17, criterion 6) passes on realistic geometry — a genuinely open empirical question this design cannot answer in advance, with an explicit go/no-go disposition already defined for whichever way it lands.

  (Previously open items now resolved by the review pass: `boundsTree` ownership is now a required change, not a question, §3; the Viewer unit/scale question is settled by the rigid+uniform-scale contract, §9; the near-miss fixture fallback is settled as synthetic-sufficient, §16.)

**Verdict: ready for implementation planning.**

The required independent targeted design review was performed (`codex-review`, `spec`, `high` effort) and returned 4 Critical + 5 High findings, all of which were verified against the actual repository/library source and fixed in place in this document (see "Required review disposition" above) — none were rejected, none remain outstanding. The two remaining open items are genuinely deferred-by-design numeric-tuning and empirical-measurement questions (consistent with how M1/M2 handled `maxSyncTriangleCount`/`maxCollisionInstancesPerEpoch`), not unresolved architectural or semantic gaps. All 15 required design decisions, the correctness fixture set (now 17 fixtures), the live acceptance strategy, and the performance gate strategy are complete and internally consistent as written.
