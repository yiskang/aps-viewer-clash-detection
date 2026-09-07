# M2.1 Design Spec — Clash Witness Marker

Status: reviewed and revised (see §16 for review disposition)
Scope: additive to landed M2 (`57ad8c9`). Does not reopen M1/M2 architecture except where explicitly noted as a contradiction.

## 0. Source-of-truth inventory (landed code, cited)

This section records what M2.1 builds on. All line numbers refer to the branch tip at the time of writing (`feature/collision-library-m2`, commit `57ad8c9`).

### 0.1 `ClashPair` today

`CollisionWorld.js:1391-1401`, built inside `findClashes`'s narrow-phase loop:

```js
const key = `${sourceOperand.epoch}:${sourcePlaced.ownerDbId}:${targetOperand.epoch}:${targetPlaced.ownerDbId}`;
if (!pairsByKey.has(key)) {
  pairsByKey.set(key, {
    source: { modelId, dbId: sourcePlaced.ownerDbId, model: sourceOperand.model },
    target: { modelId, dbId: targetPlaced.ownerDbId, model: targetOperand.model },
    type: query.mode,
  });
}
```

`findClashes` returns `{ pairs: [...pairsByKey.values()], statistics }` (line 1414). `type` is one of `'surface-intersection' | 'containment' | 'volume-overlap'`. No point/witness field exists. No fragment-level provenance is on the public object.

**Aggregation today is first-discovery-wins, sequentially awaited** (`for...of` over `candidates`, not `Promise.all`) — deterministic *given* a fixed `candidates` order, but `candidates` order comes from either `_runBroadPhaseScan` (deterministic nested-array order) or `_runTlasBroadPhase` (BVH traversal order). M2's own invariant (§7.3, restated in the M2.1 prompt) is that TLAS and linear must produce equal *result sets* without requiring equal *traversal order*. **First-discovery-wins is therefore not a safe basis for witness selection** — it would make the chosen witness point depend on broad-phase strategy, which is exactly what the M2.1 prompt forbids. §5 below defines the fix.

### 0.2 The actual call chain from narrow phase to `ClashPair` (corrected)

`volume-overlap(A,B) := ProperCrossingQuery(A,B) OR ContainmentQuery(A in B) OR ContainmentQuery(B in A)` (M1 design, unchanged by M2), composed by **`volumeOverlapQuery`** (`collision/query/VolumeOverlapQuery.js:24-198`) — **this is the function `CollisionWorld` actually calls** (`CollisionWorld.js:1647`, via `_runNarrowPhasePair`), not `properCrossingQuery`/`anyComponentInside` directly. `_runNarrowPhasePair` currently reduces the result to a bare boolean: `return result.overlap;` (`CollisionWorld.js:1652`). This is the layer the first draft of this design missed — witness data cannot reach `CollisionWorld` without `volumeOverlapQuery` itself propagating it. §8 below defines the full path.

Where a usable point already exists at verdict time, and in **which frame it is actually in** (corrected from the first draft — verified by reading the exact success statements, not inferred from parameter names):

- **`properCrossingQuery`** (`collision/query/ProperCrossingQuery.js:36-178`, module-level scratch `_mid`, `_probe`, `_probeInB` at lines 18-26): on a confirmed non-coplanar triangle/triangle intersection, computes `_mid` (segment midpoint, line 117) then probes outward from it. `_probe` (line 135, tested via `classifyPoint(_probe, bvhA, localDiagonalA)`) is in **`bvhA`'s local frame** — i.e. `canonicalFirst`'s frame, since `volumeOverlapQuery` calls this as `properCrossingQuery(canonicalFirst.bvh, canonicalSecond.bvh, ...)` (`VolumeOverlapQuery.js:84-87`). The moment `_probe` also classifies `'inside'` via its transformed copy `_probeInB` against `bvhB` (line 144), `crossing = true` is set. Return today: `{crossing, aborted, inconclusive, diagnostics, stats}` (171-177) — `_probe` is discarded. **`_probe` and `_probeInB` are module-level mutable scratch objects**, reused across every call to this function — any captured reference must be cloned before returning, or a later call (including a concurrent one) will overwrite it in place (confirmed review finding, see §16).
- **`anyComponentInside`** (`collision/query/ContainmentQuery.js:154-354`, module-level scratch including `_point` near line 122): stage 1/2 vertex sampling reads a literal source-component vertex into `_point` and **immediately applies `sourceToTargetMatrix` to it before classification** (`_point.fromBufferAttribute(position, v).applyMatrix4(sourceToTargetMatrix)`, line 289) — so at the success statement (line 293, `classifyPoint(_point, targetBvh, targetLocalDiagonal) === 'inside'`), `_point` is already in **the container's local frame** (the frame of the `targetBvh`/`targetLocalDiagonal` parameters passed in), not the sampled operand's own frame. This corrects the first draft's claim that this point is "source-local."
- **`constructedInteriorWitness`** (`ContainmentQuery.js:379-477`, stage 3, reached only when stages 1-2 are inconclusive and `mode === 'volume-overlap'`): constructs `_wProbe` (line 460) off a component centroid+normal ladder in the **sampled component's own local frame**, validates it's inside its own component first (`classifyPoint(_wProbe, componentBvh, ...)`, line 465) — an own-geometry check, not the container — then copies and transforms it into `_wProbeInTarget` (`_wProbeInTarget.copy(_wProbe).applyMatrix4(sourceToTargetMatrix)`, line 467) and classifies **that** against the container (line 468). At success (line 469), **`_wProbeInTarget` is the container-local point that was actually proven inside the target** — the same frame convention as stage 1/2's `_point`. Both stages therefore share one consistent contract: *the returned witness point is in the container's local frame*.
- **`surfaceCrossingWitness`** (`collision/query/SurfaceCrossingWitness.js`) is wired only into standalone `containment` mode (`ContainmentModeQuery.js:95-99`), **not** into `volume-overlap`'s crossing term inside `volumeOverlapQuery`. It is not in `volume-overlap`'s call graph today. M2.1 does not pull it in — doing so would be a composition change, not a retain-what's-computed change, and is out of scope.

Conclusion: both witness kinds required by the prompt are already computed as a side effect of the existing algorithm, at exactly one success statement each, in a well-defined (if not previously public) frame. Capturing them is a small additive change to two leaf functions **plus** the composition layer that already sits between them and `CollisionWorld` (§8).

### 0.3 World-space transform ownership

`volumeOverlapQuery` receives `Instance` objects (`source`, `target`) whose `.matrix` field is each operand's own world matrix (populated via `toInstance(record, placed.worldMatrix)` at the `CollisionWorld` call site, `CollisionWorld.js:1626-1627`). Critically, **`volumeOverlapQuery` already has both operands' world matrices in scope at the exact point it receives a witness point back from a leaf query** — so the local-to-world transform belongs inside `volumeOverlapQuery`, immediately after each leaf call returns, not deferred to `CollisionWorld`. This is a correction from the first draft (which underspecified where the transform happens) and is simpler than what it replaces: no frame-identifier needs to travel further up the stack than `volumeOverlapQuery`, because `volumeOverlapQuery` resolves to world space before returning.

Concretely, per term:
- **Crossing** (`crossing.crossing === true`): the witness (`_probe`, in `canonicalFirst`'s frame) is transformed by `canonicalFirst.matrix` — `volumeOverlapQuery` already knows which physical `Instance` (`source` or `target`) is `canonicalFirst` from its own `compareCanonical` resolution (line 44).
- **`A in B`** (`aInB.inside === true`): `anyComponentInside` was called with `target` as the container (`targetBvh: target.bvh`, `VolumeOverlapQuery.js:117-120`), so the returned container-local point is transformed by `target.matrix`.
- **`B in A`** (`bInA.inside === true`): called with `source` as the container (`VolumeOverlapQuery.js:149-152`), so the returned point is transformed by `source.matrix`.

`ClashFinderExtension.js` never needs coordinate-transform logic — it already receives `ClashPair.source/target` fully resolved, and will receive `witness.point` the same way.

Placement freshness: the witness point is computed from the exact same `worldMatrix` values the verdict itself is computed from (via `toInstance`), so it inherits the existing TLAS placement-revision contract (`CollisionWorld.js:508-517`, `invalidateModelPlacement`) with no separate invalidation path. `linear` broad phase reads operand world matrices directly from the Viewer per query and is always placement-fresh by construction (M2 §6.5).

### 0.4 `ClashFinderExtension.js` — lifecycle and marker precedent

- **No overlay/marker mechanism exists anywhere in this repo** (confirmed by repo-wide search). `wwwroot/extensions/` has only `ClashFinderExtension.js` and `RoomLocatorExtension.js`; neither uses `viewer.impl.createOverlayScene`, `THREE.Scene`, or a marker mesh. M2.1 introduces this mechanism from scratch (§9).
- **Stale-action-token discipline**: `this._latestActionToken` (init at construction, line 54) is bumped in `unload()` (line 89) and at the top of the context-menu callback (line 160), captured locally as `token` (line 161), and checked on both the catch path (line 182) and success path (line 196). Any invocation whose token has since been superseded is a silent no-op.
- **Isolation clear/apply pattern**: `_clearIsolation()` (lines 133-138) iterates `this._isolatedModels` and calls `viewer.isolate([], model)` per model, unconditionally, at the top of every success path (line 217, before applying new isolation) and on the failure path (line 189). `_onBeforeModelUnload` (105-111) evicts the model from `CollisionWorld` and drops it from `_isolatedModels` bookkeeping.
- Isolation/fit is applied per model, grouped by Model **object identity** (`dbIdsByModel`, lines 239-242), federated-safe.
- **Two independent Three.js runtimes coexist in this repo, and they are load-bearing, not incidental** (`collision/README.md:238-247`; `M1 design spec:1019` area): the Viewer's own three.js global is `window.THREE` at **revision r71** (confirmed for Viewer `7.124.2`, the version this repo is developed and tested against); the collision library's own three.js is **r185** (via `three-mesh-bvh`) and is *"kept strictly isolated from that global"* — enforced by a runtime-isolation check in `test/README.md`. Any code that hands an r185 object (a `Mesh`, a `Vector3`, a `Material`) to the Viewer's r71 renderer, or vice versa, is a version-compatibility hazard this repo has already gone out of its way to prevent. M2.1's marker rendering must respect this boundary explicitly (§9.1).

Markers must reuse the token-guard/clear-then-apply discipline exactly, and must not blur the r71/r185 boundary.

---

## 1. Public result shape

```js
ClashPair = {
  source: { modelId, dbId, model },   // unchanged
  target: { modelId, dbId, model },   // unchanged
  type: 'volume-overlap',             // unchanged; witness only populated for this type in M2.1
  witness: {
    kind: 'surface-crossing' | 'containment',
    point: [x, y, z],   // Viewer scene/render coordinates — see §3 for the precise contract
  } | null,
}
```

Decisions:

- **Field name**: `witness`. Matches the prompt's own vocabulary and reads unambiguously next to `type`.
- **Presence**: the `witness` key is always present on a `volume-overlap` pair, but its value is **nullable**. `ClashPair`s of type `containment` or `surface-intersection` do not get a `witness` key in M2.1 (out of scope per the prompt's §6 — only `volume-overlap` needs witness support).
- **`kind`**: exactly the two values the geometry can justify — `'surface-crossing'` and `'containment'`. No `'unknown'` kind; if no trustworthy point exists, `witness` is `null` (§7), not a witness object with a placeholder kind.
- **`point`**: a plain 3-element array `[x, y, z]` of finite numbers (not a `THREE.Vector3` of either revision — see §9.1) — keeps the public shape framework-agnostic, avoids the r71/r185 ambiguity entirely, and matches the plain-object style of the rest of `ClashPair`. Consumers construct whichever `THREE.Vector3` they need at the call site, from whichever Three.js runtime they're in.
- **Coordinate space**: see §3 — named precisely, not just "world/viewer space."
- **Provenance inside the public witness object**: none. Internal fragment/method identity (§6) is used solely to run the aggregation comparator (§5) and is not exposed publicly — no identified consumer need yet, and it can be added additively later without breaking this shape.
- **Confidence/diagnostic metadata on the witness itself**: none in M2.1. Diagnostic information about *why* a witness is missing goes on `statistics.diagnostics` (§7), reusing the existing diagnostics channel.
- **Backward compatibility**: `source`, `target`, `type` are untouched. `witness` is a new, additive key.

## 2. One witness vs. multiple

Adopt **one representative witness per dbId-level `ClashPair`**, per the prompt's preferred scope. No contact-point cloud, no exhaustive triangle-intersection list. Selection rule is in §5.

## 3. Coordinate-space contract (precise)

**`witness.point` is expressed in Viewer scene/render coordinates** — the same coordinate space produced by applying a fragment's world matrix as returned by the Viewer's `FragmentList.getWorldMatrix` (the same world-matrix source `toInstance(record, placed.worldMatrix)` already consumes at `CollisionWorld.js:1626-1627`). This is **not** guaranteed to be an external, unshifted geospatial/geographic coordinate — if the loaded model applies a Viewer global offset (georeferencing), that offset is already baked into the fragment world matrices the point is derived from, and `witness.point` reflects whatever the Viewer itself is currently using for on-screen placement, nothing more. A future consumer needing true geospatial coordinates would need to reverse the Viewer's own global-offset transform explicitly; M2.1 makes no claim about that and does not attempt it.

This choice reconciles cleanly with:
- **Model alignment / `invalidateModelPlacement`**: the witness point is computed from the same placement data (`worldMatrix`) the verdict itself is computed from (§0.3). Re-querying after `invalidateModelPlacement` yields a witness reflecting the new aligned position automatically.
- **Federated models with different local frames**: the transform happens per-operand using that operand's own world matrix (§0.3), correct regardless of how many federated models are involved.
- **`linear` broad phase**: always placement-fresh by construction (§0.3).

A Viewer marker never needs to reconstruct or re-transform the point — it's already placed in the same space the Viewer renders in.

Explode/animation remain out of scope, as stated in the prompt.

## 4. Witness taxonomy for `volume-overlap`

### A. Surface-crossing

Source: the winning probe from `properCrossingQuery` (§0.2) — a point proven to classify `'inside'` both solids at the moment `crossing` is confirmed `true`. Preferred over the segment midpoint `_mid`, which is only guaranteed to be *on* the intersection curve, not interior to both volumes. `properCrossingQuery` additively returns an **owned clone** (not the mutable module-level scratch reference — see §6) whenever `crossing: true`:

```js
// additive fields only — crossing/aborted/inconclusive/diagnostics/stats unchanged
{ crossing: true, ..., witnessPoint: /* owned THREE.Vector3 clone, canonicalFirst-local */ }
```

Since `crossing` is only ever set `true` at the exact statement that finds this probe, the witness point is available on every positive surface-crossing verdict — no partial-success case to handle for this kind.

### B. Containment

Source: preferentially the stage 1/2 vertex-sampling point when sampling was conclusive; otherwise the stage 3 constructed interior witness. Both are geometrically justified — never a bbox center. Both, per §0.2, resolve to the **container's local frame** at their success statement, giving `anyComponentInside` one consistent return contract regardless of which stage produced the point:

```js
{ inside: true, ..., witnessPoint: /* owned clone, container-local */, witnessMethod: 'vertex-sample' | 'constructed-interior' }
```

`witnessMethod` is an **internal diagnostic field only** (not on the public `ClashPair.witness`) — both methods produce a `kind: 'containment'` witness publicly.

`volume-overlap`'s containment term runs in both directions (`A in B` and `B in A`, `VolumeOverlapQuery.js:117-163`); whichever direction actually resolves `true` supplies the witness, transformed by the world matrix of whichever physical operand played the container role in that specific call (§0.3).

### Kind selection when both are computed

`volume-overlap`'s verdict short-circuits at the `volumeOverlapQuery` level: crossing is checked first, and only on a negative result does containment run (`VolumeOverlapQuery.js:97-107`, unchanged). So for a single fragment-pair hit, at most one witness kind is ever computed — no per-hit ambiguity. Ambiguity only arises at aggregation time, across *different* fragment pairs contributing to the same dbId pair — resolved in §5.

## 5. Fragment-pair → dbId-pair aggregation (deterministic witness selection)

**Problem with the current code** (§0.1): `pairsByKey` is insert-only — the first fragment-pair hit to reach a given key wins, and that arrival order depends on broad-phase strategy.

**Fix**: replace insert-only with **insert-or-replace-if-better**, using a total order over candidate witnesses that does not depend on arrival order and handles the nullable case explicitly (a fix from the reviewed draft, which assumed both candidates always had a `kind`):

```js
function compareWitnessCandidates(a, b) {
  // 1. A valid (non-null) witness always outranks a missing one — a witness-capture
  //    failure on one fragment pair must never suppress a valid witness found on
  //    another fragment pair contributing to the SAME dbId-level pair.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  // 2. Prefer surface-crossing over containment (more directly informative).
  if (a.kind !== b.kind) return a.kind === 'surface-crossing' ? -1 : 1;
  // 3. Tie-break by canonical fragment-pair identity, reusing the same ordering
  //    already used elsewhere (comparePlacedCanonically: loadEpoch, geometryIndex,
  //    fragmentId), applied to (source, target).
  return comparePlacedCanonically(a.sourcePlaced, b.sourcePlaced)
      || comparePlacedCanonically(a.targetPlaced, b.targetPlaced);
}
```

For each fragment-pair hit: compute `key` as today; if the key is new, insert (witness may be `null`); if the key exists, compare the new candidate's witness against the stored one with `compareWitnessCandidates` and keep whichever sorts first. This is a single pass, and the result is **independent of traversal order** by construction (minimum of a total order). A `witness-unavailable` diagnostic (§7) is only emitted once, after the full pass, for a dbId pair whose *final* aggregated witness is still `null` — not per individual fragment-pair miss, so one fragment pair's capture failure never produces a spurious diagnostic when a sibling fragment pair supplied a valid witness for the same dbId pair.

This satisfies all four required cases in the prompt (multiple source fragments × one target; one source × multiple targets; several fragment pairs → one dbId pair; both a surface-crossing and a containment witness available for the same dbId pair — rule 2 always picks surface-crossing) without depending on arrival order anywhere.

## 6. Witness provenance and scratch-object ownership

**Provenance** (internal only, used solely for §5's comparator and for diagnostics): `sourcePlaced`/`targetPlaced` (already in scope in the narrow-phase loop), `witnessMethod` (§4B). None of this crosses into the public `ClashPair.witness` shape.

**Scratch-object ownership (added by this revision, a confirmed review finding)**: every witness-producing leaf function (`properCrossingQuery`'s `_probe`; `anyComponentInside`'s `_point`; `constructedInteriorWitness`'s `_wProbeInTarget`) reads and writes a **module-level, reusable `THREE.Vector3` singleton** — the standard scratch-object pattern already used throughout this codebase for allocation avoidance. These singletons are mutated on every call, including a subsequent or concurrent call. A returned witness point **must be an owned clone** (`.clone()`, or copied into a plain `[x,y,z]` at the point of capture), taken at the exact success statement, before the function returns and before any later code path (including a concurrent `findClashes` invocation reusing the same module-level scratch) can overwrite it. No module-level scratch reference may escape a query function's return value. This is a one-line `.clone()` at each of the three capture sites (§0.2), not a broader refactor of the existing scratch-reuse pattern — the pattern itself remains correct and performant for every *other* use of these variables within a single call.

## 7. No-trustworthy-witness behavior

**Principle held**: a confirmed `volume-overlap` clash is never suppressed or downgraded because witness capture failed.

- If no fragment-pair hit contributing to a given dbId-level pair produced a witness (§5's aggregation still resolves to `null` after considering every contributing fragment pair — not merely the first one tried), `witness: null` is set on that `ClashPair`, and **one** entry is added to the existing `statistics.diagnostics` stream (the same channel already used for fragment-scoped diagnostics, `CollisionWorld.js:1513,1590-1591`) identifying the pair and a short reason string.
- **Validation, not broad exception-catching**: after the world-space transform (§0.3), the resulting `[x, y, z]` is checked for three finite numbers; a non-finite result (e.g. a degenerate matrix) is treated as "no witness for this fragment pair" for aggregation purposes (§5 already handles a missing candidate correctly) rather than thrown. This is a narrow, specified validation step — it does not swallow arbitrary exceptions from the query functions themselves, which continue to propagate as they do today.
- The clash itself is always reported regardless of witness outcome. `ClashFinderExtension` treats `witness: null` as "no marker for this pair," never as "no clash."

## 8. Narrow-phase integration points (corrected — includes the composition layer)

| Function | Change | Backward compatible? |
|---|---|---|
| `properCrossingQuery` | additively return an owned-clone `witnessPoint` (canonicalFirst-local) when `crossing: true` | yes — existing consumers destructure `crossing`/`aborted`/etc. and are unaffected by extra fields |
| `anyComponentInside` / `constructedInteriorWitness` | additively return an owned-clone `witnessPoint` (container-local), `witnessMethod` when `inside: true` | yes, same reasoning |
| **`volumeOverlapQuery`** | on each positive branch (`crossing.crossing`, `aInB.inside`, `bInA.inside`), transform the returned local-frame point to world space using the correct operand's `.matrix` per §0.3, and add `witness: { kind, point }` (or `witness: null` on the negative path) to its own return object, alongside the existing `{overlap, via, diagnostics, stats}` | yes — additive field on an already-internal function; the existing `overlap`/`via`/`diagnostics`/`stats` consumers (including `_runNarrowPhasePair`) are unaffected until they choose to read `witness` |
| `CollisionWorld._runNarrowPhasePair` | for `mode === 'volume-overlap'`, return `{ hit: result.overlap, witness: result.witness }` instead of the bare boolean `result.overlap`; the `containment`/`surface-intersection` branches keep returning a bare boolean, since witness support is scoped to `volume-overlap` only | internal-only signature change to a private method — verify (during implementation) that its one caller (the aggregation loop) is updated in the same change; no public API is affected |
| `CollisionWorld`'s aggregation loop | consume `{hit, witness}` for `volume-overlap`, run `compareWitnessCandidates` (§5) instead of insert-only `has()` | internal only, no public API change |
| `surfaceCrossingWitness`, `surfaceIntersectionQuery`, standalone `containment` mode | **untouched** | n/a — out of scope, witness support is `volume-overlap`-only |

This corrects the first draft's omission: `volumeOverlapQuery` (`collision/query/VolumeOverlapQuery.js`) is a required, explicitly-specified integration point — it is the only place that has both the leaf-query witness point and the operand world matrices needed to resolve it (§0.3), and it is the only thing standing between the leaf functions and `CollisionWorld` today.

## 9. Viewer marker design

### 9.1 Rendering mechanism (corrected — respects the r71/r185 boundary, and addresses occlusion)

No existing marker/overlay pattern exists in this repo (§0.4), so M2.1 introduces the standard Viewer-native mechanism for custom 3D markup: an **overlay scene** (`viewer.impl.createOverlayScene(name)`) holding one small mesh per witness-bearing `ClashPair`, added/removed via `viewer.impl.addOverlay(name, mesh)` / `removeOverlay(name, mesh)`.

**Runtime-isolation requirement (new in this revision)**: the public `witness.point` is plain numbers (§1) specifically so it never carries a Three.js object across the r71/r185 boundary (§0.4). All overlay-layer objects — the marker `Vector3`, `SphereGeometry`, `MeshBasicMaterial`, `Mesh` — **must be constructed from the Viewer's own three.js global** (`window.THREE`, r71), never from an imported `three` package (r185, the collision library's own dependency). `ClashFinderExtension.js` must not import `three` for this purpose. This is a hard constraint carried over from the collision library's own existing runtime-isolation discipline (`collision/README.md:238-247`), not a new one invented for M2.1 — it simply hadn't been engaged yet because no prior extension code touched the Viewer's rendering internals this directly.

**Visibility / occlusion (new in this revision)**: both witness kinds are, by construction, points *inside* overlapping solids (§4) — a normal depth-tested opaque marker sitting inside a closed wall or duct is invisible from any camera position, which would silently fail the feature's entire purpose ("where should I look"). The marker material must therefore render through occluding geometry — e.g. `depthTest: false` (or an equivalent always-on-top / x-ray treatment already available on the pinned Viewer version) combined with a distinct color/emissive treatment not used by the Viewer's default selection/highlight theme, so a marker reads as "clash marker, visible through the model" rather than "selection." The acceptance workflow (§12) includes a case exercising an enclosed containment witness specifically to catch a regression here.

**Marker sizing (new in this revision, replacing the underspecified "a fraction of scene bounds")**: radius is computed once per `Find Clashes` action as `clamp(sceneBoundingSphereRadius * radiusFraction, minRadius, maxRadius)`, where `sceneBoundingSphereRadius` is the bounding sphere of the combined isolated dbIds' world-space bounds (the same bounds already computed for `fitToView`), `radiusFraction` is a small fixed constant (e.g. `0.01`), and `minRadius`/`maxRadius` are fixed absolute world-unit bounds chosen so a marker is neither imperceptibly small on a tiny fixture nor larger than a room on a kilometer-scale federated model. Exact constants are an implementation-planning detail; the contract is that a radius is always clamped, never an unbounded fraction.

**Resource allocation**: one **shared** `SphereGeometry` and one shared `MeshBasicMaterial` are created once per extension instance (lazily, on first marker) and reused across every marker `Mesh` for that instance — not one geometry/material pair per marker. A source with many clashes therefore allocates one `Mesh` (position-only) per witness-bearing pair, not a duplicated geometry/material per pair. The shared geometry/material are disposed once, on `unload()`, after every marker mesh has been removed from the overlay scene.

### 9.2 Marker lifecycle (corrected — model-unload and exceptional-teardown behavior)

Mirrors `_clearIsolation()`'s existing discipline (§0.4), adding a parallel `_clearMarkers()` and `_addMarkers(pairs)`:

| Event | Marker behavior |
|---|---|
| Successful Find Clashes | `_clearMarkers()` unconditionally (same point as the existing `_clearIsolation()` call), then `_addMarkers()` for every `ClashPair` with a non-null `witness` |
| Newer action supersedes older in-flight | Governed by the same `_latestActionToken` check (§0.4) — a superseded continuation never reaches `_addMarkers`/`_clearMarkers` |
| Zero-clash result | `_clearMarkers()` runs as part of the same unconditional clear already happening before the zero-clash branch; no markers added |
| Query failure | `_clearMarkers()` runs alongside the existing `_clearIsolation()` call on the failure path — a failed query never leaves a stale marker from a prior successful query |
| **Model unload (revised)** | Clears the **entire** clash visualization — both isolation and markers, for every model, not only markers referencing the unloaded model. A partial-preservation policy (keep markers/isolation for still-loaded models, drop only the affected ones) would require materially more bookkeeping than M2.1's scope justifies, and the earlier per-pair-filter approach was shown to be unsound: it left surviving models isolated with no corresponding marker, contradicting the "isolation and markers can never visually disagree" invariant this design otherwise holds to. The simplest correct behavior — clear everything on any participating-model unload, exactly as a fresh Find Clashes' `_clearIsolation()`/`_clearMarkers()` already do — is adopted instead. |
| **Extension unload / exceptional teardown (revised)** | Marker disposal (removing every tracked mesh, disposing the shared geometry/material, removing the overlay scene) is placed in an **outer `finally`** that runs regardless of whether `this._world.dispose()` throws — not merely "the same try/finally structure," which the reviewed draft incorrectly assumed already guaranteed this. The action-token bump (already the first statement in `unload()`) continues to run first, unconditionally. |
| Clearing/restoring clash visualization | Isolation and markers are cleared together, at the same call site, so they can never visually disagree |
| Running Find Clashes again on a different source | No special case — same clear-then-apply flow as isolation |

`_activeMarkers` is tracked the same way `_isolatedModels` is tracked today (a small array on the extension instance), and disposal only ever removes/disposes mesh instances — the shared geometry/material (§9.1) are disposed exactly once, in `unload()`, after every mesh referencing them has already been removed.

### 9.3 Multiple clash results

One marker per returned `ClashPair` that has a non-null `witness` — the prompt's stated strong default. No cap, no filtering/dashboard. Marker density on a source with many clashes is a documented limitation for M2.1; the shared-geometry/material requirement (§9.1) keeps the *resource* cost of high density bounded even though the *visual* density is not addressed further in this design.

### 9.4 Marker interaction

Visual only in M2.1: no click-to-select, no tooltip/panel, no clash list/dashboard, matching the prompt's preferred scope. No tiny label/count is added either — deferred as a non-blocking open item (§17).

## 10. Non-goals (restated, unchanged from the prompt)

Penetration volume, overlap volume, intersection curve/mesh, all-contact-point cloud, Soft Clash/clearance, TLAS/BLAS architecture changes, worker rewrite, explode/animation, per-fragment dynamic-transform support, clash dashboard/history/approval workflow, persistent clash storage. None of these are touched by this design.

## 11. Correctness / test design

### Witness correctness
- A known surface-crossing Hard Clash fixture produces `witness.kind === 'surface-crossing'` with `point` classifying `'inside'` both operand volumes (validated by re-running `classifyPoint` against both BVHs as a test oracle, not by exact-coordinate assertion).
- A known containment-caused Hard Clash fixture produces `witness.kind === 'containment'`.
- Witness `point` for a fixture with a known world transform lands within floating-point tolerance of the expected Viewer scene-coordinate location.
- Aligning a model, calling `invalidateModelPlacement`, and re-running produces a witness in the new aligned location (extends the existing M2 alignment fixture).
- `tlas` and `linear` modes return equivalent `ClashPair`s with the **same witness kind and point** for equivalent inputs — a direct consequence of §5's traversal-order-independent selection rule, asserted as a new explicit equivalence check.
- **New**: a fixture where the transformed witness point would be non-finite (degenerate matrix, injected in the test) confirms the pair is still returned with `witness: null` and a diagnostic entry, never thrown or dropped (§7).
- **New**: a fixture where one contributing fragment pair fails witness capture and a sibling fragment pair for the *same* dbId pair succeeds confirms the aggregated result keeps the valid witness, not `null` (§5's comparator rule 1).

### Aggregation determinism
- A fixture with multiple fragment pairs rolling into one dbId pair selects the same witness deterministically regardless of injected traversal order (feed `candidates` in both original and reversed order, assert identical output).
- Repeated identical queries never change the witness point.
- **New**: a concurrent-query or deliberate post-return scratch-mutation test confirms that mutating the module-level scratch singletons (`_probe`, `_point`, `_wProbeInTarget`) after a query returns does not alter an already-captured witness (§6's ownership contract).

### Failure behavior
- A confirmed clash with a forced/mocked witness-capture failure still returns the `ClashPair` with `witness: null` and a corresponding `statistics.diagnostics` entry.

### Marker lifecycle
- Markers appear only for witness-bearing results.
- Zero-clash clears previous markers.
- A failed query does not leave stale markers.
- A stale in-flight action (superseded token) cannot restore old markers.
- Extension unload removes the overlay scene, every tracked marker mesh, and the shared geometry/material, **even when `_world.dispose()` throws** (§9.2).
- Any participating-model unload clears the entire clash visualization (isolation and markers for every model), not just markers referencing the unloaded model (§9.2).
- **New**: a live containment fixture proving an enclosed witness (inside opaque geometry) is actually visible on screen, not merely present in the overlay scene (§9.1).

## 12. Acceptance workflow

1. Load the existing real federated Architecture/Structure/Mechanical fixture.
2. Select a source with a known Hard Clash.
3. Right-click → Find Clashes.
4. Existing isolation/highlight behavior still works, unchanged.
5. A visible clash marker appears at the witness location for each witness-bearing result, **including one known to be fully enclosed inside opaque geometry** — confirm it is actually visible (§9.1), not just logically present.
6. Camera fit (existing `fitToView` behavior) confirms the marker visually sits within the clash region.
7. Run a known negative source → previous markers clear, no new marker remains.
8. Perform one model-alignment operation, call `invalidateModelPlacement`, rerun, and confirm the marker moves to the newly-aligned clash location.
9. Unload one of the participating models mid-session and confirm the **entire** clash visualization clears (§9.2), not just markers referencing that model.

No pixel-perfect screenshot comparison required, consistent with the prompt.

## 13. Performance considerations

- Witness data is **already computed today and currently discarded** — §4/§8's changes retain a value that exists in a local variable at the exact statement that sets the boolean verdict. The additive cost per confirmed hit: one `.clone()` at the leaf-function success site (§6), one `Vector3.applyMatrix4` in `volumeOverlapQuery` (§0.3), and one comparator call per fragment-pair hit during aggregation (§5) instead of a `has()` check — same asymptotic complexity as today's aggregation loop.
- Only fragment pairs that actually confirm a `volume-overlap` hit pay this cost — negative narrow-phase results are unaffected.
- Marker-side allocation is bounded by shared geometry/material reuse (§9.1) — one `Mesh` per witness-bearing `ClashPair`, not per-marker geometry/material duplication.
- No new performance-instrumentation field is needed; existing `statistics.diagnostics` absorbs the one new "witness unavailable" case (§7) without a new subsystem.

## 14. Required review

An independent targeted design review was run via `codex-review` (spec, high effort), focused on geometric correctness of surface-crossing vs. containment witnesses, deterministic fragment→dbId aggregation, world-space transform correctness, preservation of existing Hard Clash verdict semantics, and marker lifecycle/stale-action correctness. Full disposition in §16.

## 15. Final report

- **Adopted public witness shape**: `ClashPair.witness = { kind: 'surface-crossing' | 'containment', point: [x,y,z] } | null`, additive to the existing `source`/`target`/`type` shape, present (possibly `null`) only for `type: 'volume-overlap'`.
- **Witness kinds and semantics**: `surface-crossing` from `properCrossingQuery`'s proven-interior probe; `containment` from `anyComponentInside`'s vertex sample or, when inconclusive, `constructedInteriorWitness`'s constructed interior point — both already computed by the existing verdict algorithm, never invented geometry.
- **World/local coordinate decision**: Viewer scene/render coordinates, resolved inside `volumeOverlapQuery` (not `CollisionWorld`, and not deferred to the Viewer layer) using the per-operand world matrix already in scope, immediately after each leaf query returns. Explicitly not guaranteed to be an external geospatial coordinate.
- **Narrow-phase integration point**: additive return fields on `properCrossingQuery` and `anyComponentInside`/`constructedInteriorWitness`, **plus** `volumeOverlapQuery` (the actual composition layer `CollisionWorld` calls) and a corrected internal return shape for `_runNarrowPhasePair`. No other M1/M2 query module is touched.
- **dbId-level aggregation rule**: insert-or-replace-by-total-order (valid-over-null, then `kind` preference, then canonical fragment-pair ordering), independent of broad-phase traversal order.
- **Unavailable-witness behavior**: `witness: null` plus one `statistics.diagnostics` entry per dbId pair that has no valid witness after considering every contributing fragment pair; the clash verdict itself is never suppressed or altered; a narrow finite-number validation (not broad exception-catching) is the only new failure path.
- **Marker rendering/lifecycle approach**: an overlay scene with one small, always-visible-through-occlusion mesh per witness-bearing pair, built exclusively from the Viewer's own r71 three.js global, sharing one geometry/material per extension instance; lifecycle mirrors the existing stale-action-token and `_clearIsolation()` discipline, extended so any participating-model unload clears the entire visualization and marker teardown survives a throwing `_world.dispose()`.
- **Compatibility impact**: purely additive at the public level. No existing field renamed or removed on `ClashPair`; no existing M1 public query API signature changed incompatibly (`_runNarrowPhasePair`'s internal-only return shape changes, verified to have exactly one caller); no change to Hard Clash truth semantics, tolerance, or BLAS/TLAS candidate semantics.
- **Remaining open questions** (non-blocking):
  1. Exact overlay-scene Viewer API call signatures and the exact "always visible through occlusion" material setting should be pinned against Viewer `7.124.2` during implementation planning.
  2. Whether a future tiny label/count on markers is worth the added interactive-UI surface — deferred.
  3. Whether a marker-density cap is needed for sources with very many clashes — deferred as a documented limitation pending real usage data.
- **Verdict**: `ready for implementation planning` — all four Critical and all three High findings from the independent review (§16) have been resolved in this revision; no unresolved Critical/High finding remains.

## 16. Review disposition

Independent review via `codex-review` (type: `spec`, effort: `high`) against the first draft of this document. Overall readiness from that review: "Requires major revision." Each finding below was independently re-verified against source (not accepted on the reviewer's word alone) before being applied.

| # | Severity | Finding | Verified? | Disposition |
|---|---|---|---|---|
| 1 | Critical | Witness data has no path from leaf queries through `volumeOverlapQuery` to `CollisionWorld` — the composition layer discards it and `_runNarrowPhasePair` reduces to a boolean | Confirmed by reading `VolumeOverlapQuery.js:97-198` and `CollisionWorld.js:1636-1653` directly | Fixed — §8 now specifies `volumeOverlapQuery` and `_runNarrowPhasePair` as required integration points, not just the two leaf functions |
| 2 | Critical | Stage 1/2 containment point (`_point`) is in the container's local frame at its success statement, not the sampled/source operand's frame as the first draft claimed | Confirmed by reading `ContainmentQuery.js:289-293` (the `applyMatrix4` happens before classification) | Fixed — §0.2/§0.3/§4B corrected to container-local frame throughout, with the correct per-branch world matrix identified |
| 3 | Critical | Marker design didn't address this repo's mandatory r71 (Viewer)/r185 (collision library) Three.js runtime isolation | Confirmed by reading `collision/README.md:238-247` | Fixed — §1 keeps the public shape plain numbers by design; §9.1 adds an explicit constraint that all overlay-layer THREE objects come from the Viewer's own r71 global, never an imported `three` package |
| 4 | Critical | An interior witness point can be fully occluded by opaque geometry, defeating the feature's purpose | Accepted as a valid design gap (both witness kinds are interior points by construction, §4) | Fixed — §9.1 adds an explicit always-visible-through-occlusion material requirement; §11/§12 add a test/acceptance case for an enclosed witness |
| 5 | High | `compareWitnessCandidates` didn't handle a `null` candidate, and the diagnostic-emission rule risked firing on a per-fragment-pair miss even when a sibling fragment pair had a valid witness | Confirmed by inspection of the first draft's own comparator | Fixed — §5's comparator now ranks valid-over-null explicitly; §7 clarifies the diagnostic is emitted once, after full aggregation, only if the final result is still `null` |
| 6 | High | Witness points are captured from module-level mutable scratch singletons without an ownership/cloning contract | Confirmed by reading the scratch declarations in `ProperCrossingQuery.js:18-26` and `ContainmentQuery.js` (module-level `_point` etc.) | Fixed — §6 adds an explicit owned-clone requirement at each of the three capture sites, plus a regression test in §11 |
| 7 | High | Model-unload marker filtering could leave surviving models isolated with no marker (visual disagreement), and marker cleanup wasn't actually guaranteed on a throwing `_world.dispose()` | Confirmed the try/finally structure in `ClashFinderExtension.js` doesn't cover code after it, and that per-model marker filtering doesn't touch isolation | Fixed — §9.2 revised to clear the entire clash visualization on any participating-model unload, and to place marker/overlay teardown in an outer `finally` |
| 8 | Medium | Marker radius ("a fraction of scene bounds") and per-marker geometry/material allocation were underspecified, risking wildly-sized markers or thousands of duplicate GPU resources | Accepted as a valid specification gap | Fixed — §9.1 adds a clamp formula and a shared-geometry/material requirement |
| 9 | Medium | "Viewer/world space" was ambiguous with external geospatial coordinates | Accepted as a valid specification-precision gap | Fixed — §3 names the frame precisely (Viewer scene/render coordinates via the fragment world matrix) and explicitly disclaims geospatial guarantees |

No unrelated M2 architecture was reopened, and no broad comprehensive M2 review was run, per the prompt's constraints — this review was scoped exactly to the dimensions listed in §14.
