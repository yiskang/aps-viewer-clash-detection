# M4 Design Spec — Performance / Worker Decision Gate

Status: design/spec only. No implementation, no implementation plan, no worker. Source of truth is landed `main` after the M3 merge (`f941e07`), not older design text where the two differ.

This document defines **how M4 reaches a verdict**, not what the verdict is. M4's product question — *is the current synchronous collision architecture good enough under realistic federated workloads, or is some worker/off-main-thread execution justified?* — is an empirical question this spec deliberately does **not** answer. Its job is to fix the workload matrix, the measurement protocol, the thresholds, the verdict rules, the feasibility analysis, the correctness gates, and the bounded spikes, so that whichever verdict the measurements produce is defensible and reproducible.

M4 is designed as a **pre-registered decision experiment**: the workloads, the metrics, the target, the statistics, and the evidence→verdict mapping are all fixed *before* any measurement is taken, so the verdict is read off the evidence mechanically rather than argued for after the numbers are in.

Landed context reconciled for this spec: `collision/` (`CollisionWorld.js`, `constants.js`, `scheduler.js`, `errors.js`, `index.js`, `blas/`, `tlas/`, `geometry/`, `query/`, `viewer/`), `collision/README.md`, `CHANGELOG.md`, `docs/superpowers/specs/collision-library-roadmap.md`, the finalized M1/M2/M2.1/M3 design specs, `test/performance/run-gate.mjs` + `run-gate-m2.mjs` + `run-gate-m3.mjs` + `browser-probes.mjs` + `checkpoint-recorder.mjs` + `README.md`, `test/acceptance/clash-finder.acceptance.mjs`, `test/CollisionWorld.findClashes.clearance.test.mjs`, the archived gate result JSON under `test/performance/results/`, `wwwroot/index.html` / `server.js` / `scripts/sync-vendor.mjs`, and the pinned `three-mesh-bvh@0.9.14` / `three@0.185.1` source trees in both `node_modules/` and `wwwroot/vendor/`.

---

## 1. What M4 is, and what M4 is not

**M4 is:** benchmark → evidence → architecture decision. It produces (a) a measurement harness, (b) a set of bounded, disposable spikes, (c) a recorded evidence set, and (d) exactly one of four verdicts.

**M4 is not** (binding, from `collision-library-roadmap.md` §5 and this milestone's own prompt): Federated Clash Test definitions, Selection A / Selection B workflows, persistent clash result sets, Group By / filtering UI, the Viewer Clash Panel, result approval/status workflow, issue-management integration, or model-vs-model orchestration introduced as a side effect of worker research. M4 also does not add UI progress components, and does not define batch-result terminal semantics (reject vs. partial vs. discard) — those belong to the future Federated Clash Test & Results layer.

**M4 does not reopen M1–M3 architecture.** Nothing here changes a public contract named in roadmap §1. Where M4 needs something the library does not expose, it is *instrumentation*, in the same class as M1 Task 23's `setSpanRecorder` — additive, no-op when unused, and enumerated exhaustively in §16.4 so it cannot grow silently.

### 1.1 The four possible verdicts (Required Decision 4)

- **A — Stay synchronous.** No worker. The current architecture meets the declared responsiveness target at every declared realistic scenario.
- **B — Targeted worker boundary is justified.** One bounded stage should move off-main-thread. B must **name** the boundary (§8.2); "a worker" is not a verdict.
- **C — Broader off-main-thread architecture is justified.** A worker-resident query/cache boundary, because repeated per-query transfers would erase a targeted worker's benefit.
- **D — No decision yet / blocked.** A prerequisite for a sound decision is missing. §7.5 makes D **mandatory**, not merely available, in eight enumerated circumstances. D also carries one **decisive negative** cause, distinct from a missing prerequisite: **no boundary can close the gap** — the baseline fails the target *and* §7.3 condition 3's screen shows the **main-only remainder alone** already fails it, so A is excluded by the failure and B and C are excluded by condition 3. That D is reported as a finding about the architecture, naming the main-only stages responsible, not as a missing external input; it is forced by §7.3's mapping rather than by §7.5's prerequisite list.

### 1.2 What a B or C verdict does and does not authorize

This distinction is load-bearing; getting it wrong makes B and C mechanically unreachable.

**B and C are *justification* verdicts, not proofs of parity.** They mean: *the synchronous baseline fails the declared responsiveness target at a declared realistic scenario, a named boundary is measurably capable of closing that gap with its own overhead included, and no structural blocker or budget violation stands in the way.* They authorize the **next** milestone to design and build that boundary.

They do **not** assert that a worker implementation is correct. Full correctness parity (§19.2) is a property only a real implementation can have, and §17 forbids M4 from building one. Parity therefore belongs to the **adoption prerequisites** of the implementation milestone, not to M4's own verdict conditions — which is why §7.3's B/C conditions rest on *stage-scoped* evidence from a bounded vertical spike rather than on end-to-end result equality.

Conversely, **A and D are binding on M4's own evidence alone.** A closes the question for now; D names precisely what must be obtained before it can be closed.

---

## 2. The landed architecture M4 measures

Restating only the facts M4's design depends on, verified against landed source (file:line where load-bearing).

### 2.1 Execution model

- `CollisionWorld` (`collision/CollisionWorld.js:534`) is entirely main-thread. `fromViewer` (`:626`) and `findClashes` (`:1184`) are the **only** async members; every lifecycle/identity method is synchronous and throws synchronously.
- Cooperative scheduling is the checkpoint port (`collision/scheduler.js:151`). `checkpoint({loadEpoch, modelIdHint, label})` returns `undefined` **synchronously** when `frameBudgetMs = 8` has not elapsed, and a Promise (one `setTimeout(0)` macrotask yield, `scheduler.js:80`) when it has. It re-validates lifecycle before, and again after, every real yield.
- **Checkpoints exist between phases, never inside one.** None inside `new MeshBVH(...)` (`blas/ThreeMeshBvhBackend.js:55`), inside `new CollisionInstanceBVH(records)`/`init()` (`tlas/TlasCache.js` has exactly one, before `buildPrimitives`, `:181`), or inside a single `bvhcast` / `closestPointToGeometry` traversal. This is why a single pair can overrun `frameBudgetMs` with no budget able to stop it (a documented M3 limitation).
- `setSpanRecorder(fn)` / `clearSpanRecorder()` / `reportSpan(label, ms)` (`scheduler.js:47-55`) are real **production** instrumentation, no-ops when unset. Their signature is **`(label: string, ms: number)` and nothing else** — §16.4 depends on this being true today.
- **`totalMs` is wall time, not CPU time** (`statistics.totalMs = this._now() - startedAt`, `CollisionWorld.js:1772`, bracketing the whole async operation with its cooperative yields included). §6.2 makes this load-bearing.

### 2.2 Identity and lifecycle

- `loadEpoch` is a global, monotonic, never-reused counter (`:540`), incremented only in `admitModel` (`:697`). A lease is `Object.freeze({model, epoch})`. `_modelLifecycle` is a `WeakMap<Model, …>` keyed by the object (`:538`), transitioning `live → evicted` permanently; `_liveEpochs: Set<epoch>` (`:550`) is the reverse-lookup companion the checkpoint port needs.
- `modelId` is diagnostic-only and never consulted by a correctness path (`:541-542`).
- `CollisionWorld` subscribes to **no** Viewer events. Its only Viewer call is `viewer.impl.getRenderProxy(model, fragId)` (`:2830`). Unload is observed by host extensions, which call `evictModel(event.model)` from `BEFORE_MODEL_UNLOAD_EVENT`.
- `invalidateModelPlacement(model)` **only marks cached placement stale** — it bumps `_placementRevisionByEpoch` and records `_placementInvalidatedAtRevision` (`:752-760`). It does not itself move anything; the re-read of `worldMatrix`/`worldBounds` is lazy, staged, and published atomically in `_refreshPlacementForEpoch` (`:2487`), and forces a TLAS rebuild. **Invalidating without an actual placement change cannot change a clash verdict** — §5.2.1 depends on this.
- **Mid-call placement-revision rejection is path-specific.** `createCompositeCheckpointPort(leases, tlasConsultedEpochs)` (`:1105`) arms revalidation for **exactly the TLAS-consulted epochs**; every `broadPhase:'linear'` call passes none, deliberately, because a linear call never consults `_placementByEpoch` or a cached TLAS and would gain nothing but spurious aborts (`:1095`).
- **Concurrent `findClashes` calls are an existing, handled scenario.** `_getTlasEntryForEpoch`'s supersession branch reasons explicitly about "a DIFFERENT concurrent call" (`:2591-2599`) and resolves it by retrying with fresh state, not by cancelling either call. §10 must not regress this.
- `_placementByEpoch` is **write-once per fragment and historically accumulating** within an epoch (`:2450`, `:2728-2737`).

### 2.3 Cancellation, as it actually exists today

- **No caller-facing cancellation.** `findClashes` accepts no signal, token, or deadline; `collision/index.js` exports none. `AbortController` appears zero times in `collision/`; `AbortSignal` appears once, in prose, at `tlas/TlasCache.js:171-176`, as the codebase's own admission of the gap.
- Two internal hand-rolled deferred-rejection signals (`GeometryRegistry.makeCancellationSignal`, `TlasCache.makeCancellationSignal`) stop *waiting*; they cannot preempt running synchronous work. Their trip conditions are eviction, disposal, or revision supersession — never a caller request.
- The nearest abort token is the **checkpoint port**: a poll-on-checkpoint validator throwing `WorldDisposedError` / `ModelEvictedError` / `ModelPlacementChangedError`.

### 2.4 The three data shapes at the narrow-phase boundary

| Shape | Where | Contents | Cloneable? |
|---|---|---|---|
| `CollisionInstance` | `:854`, cached in `_instanceCache` | `{fragmentId, geometryIdentity:{loadEpoch, geometryIndex}}` — **no geometry, no bvh, no matrix, no dbId** | **Yes**, fully |
| `PlacedInstance` | `makePlaced`, `:51` | `{instance, worldMatrix: Float64Array(16), worldBounds:{min:[3], max:[3]}, ownerDbId}` | **Yes** — `viewer/ViewerModelAdapter.js:28-37` already enforces "only numbers cross the Viewer/collision boundary" |
| narrow-phase `Instance` operand | `toInstance`, `:376` (shape at `:352-360`) | `{geometry: THREE.BufferGeometry, bvh: MeshBVH, localDiagonal, connectivity:{componentCount, componentOf: Int32Array, closedManifold: boolean[]}, closedManifold: boolean, aspectRatioExceeded, matrix: THREE.Matrix4}` | **No** — an object graph, not data |

The third is what every narrow-phase query consumes. Its *backing buffers* are all transferable; the objects wrapping them are not.

### 2.5 Geometry pipeline and where memory accumulates

- `_resolveGeometryView` (`:2809`) → `viewer.impl.getRenderProxy` (`:2830`) → `adaptViewerGeometry`, which returns **live references into the Viewer's own buffers, never copies**, and must be consumed in the same synchronous span with no intervening `await` until collision-owned copies exist (`geometry/createGeometryRegistry.js:28-33`). `compactAndWeld` (`geometry/activeRangeCompaction.js:125`) is that copy step, returning `{position: Float32Array, index: Uint32Array, triangleCount}`. **The Viewer's own buffers can never be transferred; only the collision-owned copies can.**
- `BlasCache` (`blas/BlasCache.js`) **caches nothing** — a 20-line stateless delegation, existing as an injection point for a future multi-backend milestone. The real cache is `GeometryRegistry._epochs: Map<loadEpoch, Map<geometryIndex, Entry>>` (`geometry/GeometryRegistry.js:55`), single-flight per entry, keyed per `(loadEpoch, geometryIndex)`.
- **Eviction is wholesale-per-epoch only.** No LRU, no size cap, no memory-pressure eviction, no TTL. Instance count is capped (`maxCollisionInstancesPerEpoch = 20_000`); **distinct-geometry record count is uncapped** — only each geometry's triangle count is bounded (`maxSyncTriangleCount = 12_000`).
- Each entry retains **both** the welded typed arrays **and** a duplicate `THREE.BufferGeometry` built from them (`ThreeMeshBvhBackend.js:38-40`), held alive by `geometry.boundsTree = bvh` (`:56`), plus the `MeshBVH`, plus `connectivity.componentOf: Int32Array(triangleCount)`. A ~2× geometry duplication already exists on the main thread today.
- **No byte-level memory accounting exists in `collision/`.** Zero occurrences of `byteLength`, `performance.memory`, or heap accounting. The only production accessor is `getEpochCollisionInstanceCount(epoch)` (`:770`). `run-gate-m2.mjs:285-310` reaches into private internals and says so.

### 2.6 Existing seams a worker backend would plug into

`BlasCache`'s documented injection point (`blas/BlasCache.js:6-8`); `fromViewer`'s `narrowPhase` / `indexOwnership` reserved options (`:627-640`); `createGeometryRegistry`'s three injectable builders (`geometry/createGeometryRegistry.js:16-22`); the "only numbers cross the boundary" discipline. There is **no** existing worker code: zero `Worker`, `postMessage`, `Transferable`, or `structuredClone` in `collision/`.

---

## 3. Baseline evidence — carried forward as hypotheses, not conclusions

All figures from an archived gate run on the real 3-discipline federated Audubon fixture (Architecture 5,435 + Structure 543 + Mechanical 1,496 = **7,474 fragments**), **one** source instance (Structure dbId `3076`), whole-model target scope across all three models. **M4 re-measures.**

### 3.1 M3 clearance gate (`test/performance/results/m3-gate-1788864064755.json`, `clearance = 0.05`)

| Quantity | TLAS cold | TLAS warm | Linear cold | Linear warm |
|---|---|---|---|---|
| `totalMs` (**wall time**, yields included) | 2250.6 | 526.7 | 2166.9 | 517.1 |
| `broadPhaseMs` | 4.2 | 1.4 | 2.0 | 1.7 |
| `narrowPhaseMs` | 2238.3 | 517.8 | 2157.7 | 508.2 |
| `clearanceQueryMs` | 58.4 | 55.9 | 57.5 | 57.5 |
| `clearanceQueryMs / totalMs` | 2.6% | 10.6% | 2.7% | 11.1% |

- **Broad phase is 0.19% of wall clock.** TLAS reduces clearance candidates 3.78× (1,978 vs. 7,473) bit-identically, with no measurable end-to-end difference — matching M2's 3.91× / no-wall-clock finding.
- **Narrow phase is ~98%, and the distance primitive is not what dominates it.** Of 1,978 candidates, 1,913 (96.7%) ran the `volumeOverlapQuery` precheck; only 129 (6.5%) reached a `closestPointToGeometry` call. 1,197 dbId pairs were Hard-Clash-excluded; 30 hits returned. **465 of 1,913 prechecks (24.3%) were `inconclusive`.** **The precheck's own duration was never measured** — it is inferred from the remainder around an awaited call (`CollisionWorld.js:2318`), and `classifyHardClashPrecheck` collapses every inconclusive cause into one generic diagnostic (`query/ClearanceHardClashPrecheck.js:29-30`).
- **Worst single `clearance-distance-query` span: 6.10 ms** over 516 samples (p50 0.20, p95 2.0, p99 4.7, zero over `frameBudgetMs`) — the "thin margin" figure the prompt cites.
- **The largest checkpoint-bracketed span is not that one:** 12.2 ms (`composed-narrow-phase-stage`, cold), 10.7 ms (`clearance-narrow-phase-pair`, cold); warm 3.1 ms and 6.0 ms. M3's criterion 6 examined only one label.
- Cold-only build cost from direct brackets: `weld` 1,461 builds / 176.4 ms / 2.8 ms max; `connectivity` 96.4 ms / 2.0 ms max; `bvh-construction` 43.1 ms / 0.7 ms max — **~316 ms** against a cold-minus-warm wall-time delta of **~1,724 ms**. **~1.4 s of the cold delta is unexplained by any existing timer.**
- `narrowPhaseBudgetHeadroom`: 1,978 of `maxClearanceNarrowPhasePairs = 20,000` — **9.89% consumed by one source instance.**

### 3.2 Two things the archived spans cannot be used for

Both documented at `test/performance/README.md:196-315`, and both bind M4's protocol:

1. **Span sums are not CPU time.** A `narrow-phase-pair` span can absorb a separate `GeometryRegistry` port's *yielded* wall-clock; nested and direct-bracket spans overlap the checkpoint-bracketed ones.
2. **A loop's last iteration may go unflushed**, so a genuine 24.8–49 ms violation can be invisible to both the manual bracketing and the longtask observer (which fires only above ~50 ms).

Accordingly M4 does **not** infer a yield tax by subtracting span sums from wall time and does not estimate yield counts; §6.2 measures main-thread task time from an external trace and §16.4 measures yields directly.

### 3.3 M2 Hard Clash gate (`m2-gate-1788758319999.json`), same fixture and source

TLAS cold 1,836.4 / warm 450.5 ms; linear cold 1,858.7 / warm 438.1 ms. `broadPhasePairs` 1,913 vs. 7,473 = 3.91×. Broad phase 0.22% / 0.10% of cold wall clock.

### 3.4 M1 gate, for the worst-span convention

Max labeled span **6.8 ms cold / 1.8 ms warm** against its declared **24.8 ms** ceiling — PASS with margin. §7.1 reuses that ceiling and §7.2 explains why it is a *scheduler-conformance* check, not a user-experience threshold.

### 3.5 The runtime the archived evidence came from is not representative

All three gates launch Chromium with `--no-sandbox --disable-dev-shm-usage --single-process --no-zygote` (`run-gate-m3.mjs:180`). `--single-process` collapses the normal browser/renderer separation. Fine for the historical continuity those gates were written for; **it cannot be the sole basis for a decision about worker execution.** §6.1.5 requires a representative multi-process configuration.

### 3.6 What this evidence does not establish

**Every measurement used exactly one source instance, and none measured Viewer responsiveness at all.**

---

## 4. Existing conventions and shipped ceilings M4 inherits

| Constant / line | Value | Origin | Status |
|---|---|---|---|
| `frameBudgetMs` | 8 ms | `constants.js:45` | Shipped |
| Worst-case-span ceiling | **24.8 ms** = 8 + 16.8 | M1 spec `:2283-2284`, `:4882-4885` — `frameBudgetMs` plus the *measured* worst non-preemptible atomic unit (a weld at ~19,800 triangles) | Shipped |
| `maxClearanceNarrowPhasePairs` | 20,000 | Upfront preflight on the assembled clearance candidate list (`CollisionWorld.js:2206`) | Provisional |
| `maxBroadPhaseInstancePairs` | 1,000,000 | `broadPhase:'linear'` only, **per target epoch group** (`:1545-1559`) | Provisional |
| `maxTlasCandidatePairs` | 200,000 | Incremental during TLAS traversal | Provisional |
| `maxCollisionInstancesPerEpoch` | 20,000 | Per-epoch instance ceiling | Provisional |
| `maxSyncTriangleCount` | 12,000 | Per-geometry synchronous-build ceiling | Provisional |

Two are **workload ceilings M4 must respect and report as capability boundaries**:

- **Clearance's executable ceiling.** At the measured density of one dense source instance (1,978 narrow-phase candidates), `maxClearanceNarrowPhasePairs = 20,000` is exhausted at roughly **ten** similarly dense instances, throwing `CapacityExceededError('clearance-narrow-phase-budget')` before any narrow-phase work. Sparse elements produce far fewer candidates, so ten bounds *dense* sources only.
- **The linear oracle's executable ceiling.** `_exceedsBroadPhaseCeiling(sourceExtracted.size, effectiveTargetCount)` is evaluated **once per target epoch group** (`:1545-1559`), with `effectiveTargetCount` reduced by source self-exclusion for the source's own epoch only. On this fixture the binding group is **Architecture at 5,435 fragments**, giving `⌊1,000,000 / 5,435⌋ =` **183 source instances** (strict `>`, so 183 passes and 184 throws) — *not* a cap derived from the 7,474 federated total. This path throws a **plain `Error`**, not `CapacityExceededError`, which the harness must classify correctly.

**A capacity rejection is a measured capability boundary, never a pass.** The gate reports the limit, the observed value, and `CAPACITY_REJECTED`; it may additionally run a reduced set, but must report both and must never silently trim until a case passes.

**M4 retunes none of these constants.**

---

## 5. Adopted workload matrix (Required Decision 1)

The matrix separates **declared realistic scenarios** — what a verdict is *about* — from **synthetic scale and stress sweeps**, which characterise behaviour and find breaking points and may not on their own force a verdict.

### 5.1 Why source-instance count is a controlled variable, not "the" scaling axis

Cost is driven by at least: extracted **source-fragment** count (not requested `dbId` count); broad-phase candidates per source instance (spatial density × target population); unique geometries and triangle counts (cold cache work); the narrow-phase **outcome mix** (early proven overlap / full negative traversal / inconclusive precheck / distance query), which have very different costs; and cache reuse and output aggregation density.

So source-instance count is swept, but source sets are **stratified into low / typical / high candidate-density cohorts** (§5.4), and every run records: requested dbId count, **extracted source-instance count**, unique geometry count, total triangle count, broad-phase candidate count, narrow-phase candidate count, the four-way outcome mix, and result count. Picking high-count but spatially *sparse* sources is a named loophole (§7.6.1).

Selecting cohorts needs no new library capability: `findClashes` already accepts multiple source `dbIds` (`CollisionWorld.js:1301`). The roadmap forbids implementing selection workflows and model-vs-model orchestration, not benchmarking a fixed dbId list in one invocation.

### 5.2 Declared realistic scenarios (R-cases)

| # | Scenario | Source | Target | Mode | Why realistic |
|---|---|---|---|---|---|
| **R1** | Single-element Hard Clash | Structure dbId `3076` | all 3 models, whole-model | `volume-overlap` | Exactly what the shipped "Find Clashes" action does. Continuity anchor vs. M2. |
| **R2** | Single-element Soft Clash | Structure dbId `3076` | all 3 models, whole-model | `clearance` @ 0.05 | Exactly what the shipped "Find Soft Clashes" action does. Continuity anchor vs. M3. |
| **R3** | Typical-density multi-element Soft Clash | typical cohort, target ~10 **extracted instances** | all 3 models, whole-model | `clearance` @ 0.05 | The nearest thing to a realistic multi-select. **Verdict-bearing only if product-confirmed** (§5.5). |
| **R4** | Typical-density multi-element Hard Clash | the same dbId set as R3 | all 3 models, whole-model | `volume-overlap` | Isolates *mode* from *scale* at identical source and target. Same §5.5 condition. |
| **R5** | Single-model, non-federated | Structure dbId `3076` | Structure only, whole-model | `clearance` @ 0.05 | Isolates *federation* from *scale* against R2. |
| **R6** | Placement change + refresh | R3's source set | all 3 models, whole-model | `clearance` @ 0.05 | §5.2.1 — the lazy re-read and forced TLAS rebuild, the one path with revision semantics no other case exercises. Same §5.5 condition. |

#### 5.2.1 R6 must actually move a model

`invalidateModelPlacement` **only marks cached placement stale** (`CollisionWorld.js:752-760`); re-reading unchanged Viewer matrices cannot change a clash verdict, so an "invalidate, re-run, expect a different result" design is impossible as stated. R6's adopted sequence mirrors what `test/acceptance/clash-finder.acceptance.mjs` and `test/CollisionWorld.findClashes.clearance.test.mjs:370` already do — mutate placement *first*:

1. Run R3 warm; record the pair set `P₀`.
2. Apply a **real, reversible** placement transform to the Architecture model via `viewer.impl.setPlacementTransform` — a translation chosen and recorded so it demonstrably changes the clearance verdict for at least one pair (e.g. on the order of the measured 0.0417-unit near-miss gap, so a known near-miss crosses the threshold in a known direction).
3. Call `invalidateModelPlacement(architectureModel)`.
4. Re-run R3; record the pair set `P₁`.
5. **Reset** the placement transform to identity before the next repetition, and re-confirm `P₀` is recovered.

**Measured:** the cost of the lazy staged refresh plus the forced TLAS rebuild (`tlasBuildMs`, `tlasBuilds`), on top of the ordinary warm cost. Step 1's two queries are R6's `cold` and `warm` samples; **step 4's re-run is R6's third measured query, the `refresh` state** (§6.1.4's declared exception, §7.2's evaluation unit), and it is verdict-bearing on its own. Step 5's reset query is correctness-only and unmeasured.

**Asserted (§19.1):** `P₁ ≠ P₀` in the specific, pre-recorded way step 2 was designed to produce, identically under both broad phases; **exactly one** TLAS rebuild attributable to the invalidation; and `P₀` recovered after reset. A run where `P₁ == P₀` is a **failure**, not a pass — it would mean the refresh did not happen.

### 5.3 Synthetic scale and stress sweeps (S-cases)

| # | Case | What it varies | Why it is not verdict-forcing on its own |
|---|---|---|---|
| **S1** | Density sweep: R3's source set at `clearance ∈ {0.02, 0.05, 0.25}` | candidate density at fixed source/target | Characterises scaling with inflated-AABB query volume. |
| **S2** | Source-count sweep, in **extracted source instances**: ~10 / ~50 / ~100 / ~183, for each of the three density cohorts, under **both** `volume-overlap` **and** `clearance` @ 0.05 | source-instance count × density × mode | Levels are instance counts, not dbId counts, because both ceilings operate on instances/candidates (§4); the harness resolves dbId sets meeting or bracketing each level and **reports requested dbIds vs. achieved instances**. The **`clearance` arms** locate `maxClearanceNarrowPhasePairs`; the **`volume-overlap` arms** reach the 183/184-instance linear boundary against the 5,435-fragment Architecture group. Both are `CAPACITY_REJECTED` findings, not timings (§4). |
| **S3** | Whole-model-scale source | the extreme | **Explicitly synthetic.** Full-model selection semantics are post-M4 scope; must not independently force a worker verdict unless whole-model source is separately established as a collision-core requirement (§7.5.4). |
| **S4** | Pathological single pair | one atomic call's duration | Two large, densely-tessellated synthetic meshes at/near `maxSyncTriangleCount` (12,000 triangles) with broadly overlapping bounds and a generous clearance, under both modes. The real fixture never produces an atomic span above ~12 ms; this finds where one call *can* exceed 8 ms / 24.8 ms. Labelled synthetic everywhere; never mixed into a real-fixture aggregate. |

### 5.4 Cohort construction — the exact, deterministic algorithm

**Profiling pass** (cheap, unmeasured, touching **no** `collision/` narrow phase — the public API exposes no broad-phase-only operation, so this must not be built out of `findClashes`). For every Structure `dbId` owning at least one fragment, compute in-page using only Viewer APIs:

- `instances(dbId)` = fragments enumerated by `InstanceTree.enumNodeFragments(dbId, cb, false)`;
- `proximity(dbId)` = the number of `(sourceFragment, targetFragment)` pairs across all three models whose world AABBs, read from each model's own `fragList.getWorldBounds`, are within `0.05` world units of each other, by a plain nested scan.

`proximity` is a **Viewer-side proxy** for candidate density — deliberately not the collision library's own candidate count, which would require running the very queries the cohorts configure. The report states it is a proxy and records both `proximity` and the measured `broadPhasePairs` per run, so its fidelity is visible.

**Cohort selection** for a required cohort size `k` (in extracted instances):

1. Rank all dbIds by ascending `proximity`; ties broken by ascending `dbId`. Call the ranked list `L`, `n = |L|`.
2. For quantile `q ∈ {0.25 (low), 0.50 (typical), 0.90 (high)}`, take the **nearest-rank index** `i_q = min(n − 1, max(0, ⌈q·n⌉ − 1))` (0-based).
3. The **band** is the contiguous window of `L` centred on `i_q` of width `w = max(3k, 25)` entries, clipped to `L` and, when clipped at one end, extended at the other to preserve `w` where possible. If `n < w` the band is all of `L`, and this is recorded.
4. Walk the band in ascending `dbId` order, accumulating dbIds until the cumulative `instances` sum first reaches or exceeds `k`. Record requested dbIds and achieved instance count.
5. **`3076` is forced into the high cohort** (it is R1/R2's source, so the multi-element cases strictly contain the single-element baseline). It replaces the band member whose `proximity` is closest to `3076`'s, ties broken by ascending `dbId`, and the replacement is recorded explicitly.
6. If a band cannot reach `k` instances even after widening to all of `L`, the case is recorded `NOT EXERCISED` with the achieved count — never silently run at a smaller size.

Every parameter (`q`, `w`, tie rule, replacement rule, undersized behavior) is fixed here so two implementers produce identical cohorts from the same model, and the resulting dbId lists are recorded verbatim.

### 5.5 The realistic-workload validity condition

R3, R4, and R6 use a ~10-instance source. **Nothing in this repository establishes that a 10-element selection is a real workload** — the shipped extension gates its context-menu actions on exactly one aggregate selection with exactly one dbId (`collision/README.md`, "Reference sample: Clash Finder"). Therefore:

- If the ~10-instance workload is **product-confirmed**, R3/R4/R6 are verdict-bearing as written.
- If it is **not** confirmed, they are reclassified as synthetic sensitivity cases, and **if the decision turns on them, §7.5.4 forces D.** R1, R2, and R5 — which correspond exactly to what ships today — remain verdict-bearing unconditionally.

Recorded as open question 3 (§23) rather than assumed either way.

### 5.6 Protocol dimensions

Cold/warm applies to R1–R6 and S2 (S4 is warm-only; **R6 additionally has the third `refresh` state** of §6.1.4/§7.2, and is the only case that does). `broadPhase ∈ {'tlas','linear'}` applies to every case executable under both. Both runtime configurations (§6.1.5) apply to R1–R6 and S4.

---

## 6. Measurement protocol (Required Decision 2)

### 6.1 Run protocol

1. **Fixture load.** Architecture normally, then Structure and Mechanical as-additional via `#keep-current-models`; wait for `isLoadDone()` **and** `getData().instanceTree` on every model.
2. **Fixture identity re-confirmation**, live, in this run. Nothing taken on faith from a prior gate's header.
3. **Sacrificial unmeasured warm-up** — one throwaway `volume-overlap` and one throwaway `clearance` query, each in its own disposable world, disposed immediately, **with no recorder installed**. "Cold" means no BLAS/TLAS cached *in the measured world*, not a cold JavaScript engine.
4. **Fresh-world identity is `(runtime, case, broadPhase, repetition)`.** Exactly one `CollisionWorld` is constructed per such tuple. Its **first** measured query is that tuple's *cold* sample; its **immediately following second** query, on the same world with no intervening world, is the *warm* sample. The world is disposed before the next tuple's world is constructed. No world is reused across cases, arms, repetitions, or runtimes.

   **Two measured queries per world, with exactly one declared exception: R6.** §5.2.1's sequence needs a third query in the *same* world — the cold sample is R6's setup query, the warm sample is the query that records `P₀`, and the post-invalidation re-run that records `P₁` is a **third measured query**, the `refresh` sample (§7.2). Step 5's reset-and-re-confirm query is correctness-only and remains **unmeasured**. No other R-case and no S-case has a third measured query.
5. **Two runtime configurations.** Every R-case and S4 runs under (a) the historical configuration (`--single-process --no-zygote`, for continuity with M1–M3's archived numbers) and (b) a **representative normal multi-process Chromium** with those two flags removed. Both are reported; **(b) is authoritative for every worker-related conclusion and for every §7.2 target evaluation.**
6. **Repetitions and counterbalancing.** Every R-case is run **5 repetitions per state**. Two orderings are counterbalanced by a fixed, recorded schedule: the `'tlas'` / `'linear'` arm order alternates by repetition parity, and the **case order** rotates by repetition index (repetition `r` starts the case list at position `r mod |cases|`). Report **median, min, max, and all five raw values** — never a mean alone.
7. **Observer boundaries.** Every observer (CDP trace, rAF recorder, span recorder, diagnostic-event recorder, input probe) is started and reset immediately before, and stopped immediately after, each individual measured query, bracketed by `performance.mark` pairs naming the tuple. No observer spans two measured queries.
8. **Reporting statistics.** For any *population*: `count, min, p50, p95, p99, max, mean, sum`, plus counts and fractions over 8 ms, 24.8 ms, and 50 ms. For any *scalar*: median of repetitions plus the raw set. **`Math.max(...[])` is `-Infinity`** — every population summary carries an explicit empty-set guard and reports `NOT EXERCISED`, never a verdict computed from an unpopulated set. **Maxima are never compared across differently-sized populations** (§7.6.3); comparisons use like-for-like percentiles with both counts stated.

### 6.2 The three axes, and how each is actually obtained

The most important methodological section, and the one where the obvious browser APIs do **not** work.

#### X-1 — Viewer responsiveness (decides necessity)

- **Main-thread task timeline.** From a **Chromium DevTools Protocol trace**, via a Playwright CDP session on the measured page, capturing the renderer's complete task timeline within the `performance.mark`-delimited query window. **Long Tasks and Long Animation Frames are cross-checks only, never the source**: `longtask` entries exist only for tasks above ~50 ms, so they can neither enumerate all tasks nor produce a duty cycle, and their *absence* proves nothing. Reported: the full task-duration distribution, and counts over 8 ms, 24.8 ms, 50 ms, and 100 ms.
- **Frame production.** An in-page `requestAnimationFrame` cadence recorder: frame count, inter-frame intervals, p95/max interval, and counts of intervals above 32 ms and 100 ms.
- **Input responsiveness.** Input must be **trusted and externally generated**: dispatched from Node through Playwright (`page.mouse.move` / `page.keyboard.press`) at a fixed recorded cadence, with the **intended dispatch timestamp taken in Node, outside the blocked renderer**, and the handler-entry timestamp taken in-page. An in-page `dispatchEvent` is **forbidden** as the primary measure — synthetic events are untrusted, are excluded from Event Timing, and `dispatchEvent` invokes handlers synchronously, so it measures nothing about queue delay. The protocol fixes: event type (`mousemove` over the canvas), cadence (one every 100 ms for the query's duration), target element, clock correlation (a calibration exchange measured immediately before and after each query window, with offset and drift recorded), and **missed-event handling** (an event whose handler never runs before the query ends is a censored observation at ≥ the query's remaining duration, never dropped). Event Timing entries are recorded as a cross-check where the browser produces trusted ones.

#### X-2 — Main-thread consumption (explains interference)

Duty cycle = Σ(task durations from the **CDP trace** within the marked window) ÷ window duration. **Not** a sum of the library's own spans (§3.2), and **not** derived from Long Tasks. The library's own span totals are reported alongside as a cross-check, and any disagreement is reported rather than reconciled silently.

#### X-3 — Query makespan (what the user waits on)

End-to-end elapsed time, in every measured state the case has (cold and warm, plus `refresh` for R6 — §6.1.4, §7.2), *including* yield delay and (for any worker measurement) worker startup, transfers, and result publication. Yield count and cumulative yield delay are **measured directly** (§16.4.1), never estimated.

#### Scheduler conformance (retained, but not a verdict axis)

The maximum inter-checkpoint span **across every checkpoint label** — not one primitive, which is what let M3 report 6.10 ms where the same runs' worst bracketed span was 12.2 ms. Direct-bracket spans (`weld`, `connectivity`, `bvh-construction`, `capacity-admission-commit`, `tlas-build`, `clearance-distance-query`) are reported **alongside** as nested attributions, never unioned into the same maximum and never summed with the bracketed ones.

Reporting only X-3 is forbidden: it hides where the cost is. Deciding on the conformance metric alone is forbidden: **a query can consume hundreds of conforming 8 ms tasks, pass the span gate, and still starve Viewer rendering** — precisely what the M3-era "6.1 ms vs 8 ms" framing cannot see.

### 6.3 Stage separation, and the main-only / transferable partition

| Stage | Class | Instrumented today? | M4 requirement |
|---|---|---|---|
| Viewer extraction: `getRenderProxy`, instance-tree walk, `adaptViewerGeometry` | **main-only** (§8.5) | **No** — the ~1.4 s unattributed cold cost | Must be attributed. It is the achievable-benefit ceiling for every worker option. |
| `compactAndWeld` (the collision-owned copy) | **main-only as written**; movable only via the extra-copy variant (§8.2) | Yes (`weld`, ~176 ms cold) | Report; classify per variant. For **§7.3 condition 3's screen specifically** this means **counted as transferable** (it is movable under WB-1b's extra-copy variant); the stage-level cost and overhead of whichever variant is later selected still comes from S7′ under §7.3 condition 4. |
| Connectivity | **transferable** (welded index only) | Yes (~96 ms cold) | Report. |
| BVH construction | **transferable** | Yes (~43 ms cold) | Report. This — not 316 ms — is what the vendor's worker actually moves (§8.2). |
| TLAS build / cache / query | transferable | Yes | Report as-is. |
| Broad-phase candidate work | transferable | Yes | Report as-is. |
| Geometry resolution per narrow-phase pair | main-only on first touch, transferable when warm | **No** — folded into `*-narrow-phase-pair` | Must be separated from the precheck (§12.4). For **§7.3 condition 3's screen specifically**, "transferable when warm" means **counted as transferable**; the stage-level cost and overhead evidence still comes from S7′ under §7.3 condition 4. |
| Hard-Clash precheck (`volumeOverlapQuery`) | **transferable** | **No** as a timed stage — only counted | Must be timed directly, with inconclusive **cause** attribution (§12.4). |
| Exact narrow phase (crossing / containment / surface intersection) | transferable | Partially | Report per sub-query. |
| Clearance distance query | transferable | Yes | Report per §13. |
| Result aggregation, dbId grouping, provenance mapping | **main-only** (§9) | No | Must be attributed, including result-message volume. |
| Lifecycle validation and result publication | **main-only** | No | Must be attributed. |
| Scheduler / yield overhead | main-only | **No** | Measured directly (§16.4.1). |

**This partition is the cheapest decisive measurement M4 can make, and the gate must produce it before any worker spike is built.** If main-only work alone already violates the target, no boundary in §8.2 can fix it. If transferable warm computation is too small to matter, a query worker is ruled out early.

### 6.4 The canonical correctness comparator

One comparator, used for (a) the gate's **TLAS-vs-linear** parity comparison and (b) any **full-result** worker arm — an arm that reproduces the complete query pipeline and therefore emits final pair sets, distances, witnesses, statistics, and diagnostics. It does **not** govern a **stage-scoped spike**, which by §17's construction genuinely computes only the one stage it moves and carries a stub result mapping for everything downstream of it; that case is covered by the stage-scoped rule below. Defined once here and referenced by §19.

| Field | Rule |
|---|---|
| Pair set | The full sorted set of `(sourceModelTag, sourceDbId, targetModelTag, targetDbId, type)` tuples must be equal. Counts alone are never sufficient. |
| `distance` | **Bit-identical** for the TLAS-vs-linear comparison — both paths hand the identical operand pair to the identical `clearanceQuery`, and `run-gate-m3.mjs` already measures a max delta of exactly `0` over all shared keys, so anything else is a regression. For a **worker arm only**, an absolute tolerance of `1e-9` is permitted and must be reported as an explicitly relaxed comparison, justified by possible float-operation reordering across the boundary. |
| `witness` | Shape equality (`{sourcePoint,targetPoint}` for `clearance`, `{kind,point}` for `volume-overlap`), and each coordinate equal within `1e-9 × max(sourceWorldDiagonal, targetWorldDiagonal)` — a scale-relative absolute tolerance, whose numeric value for the fixture actually used is computed and printed in the report. |
| `statistics` | `clearanceExactAabbSurvivors`, `narrowPhasePairs`, `clearanceOverlapPrechecksRun`, `clearanceHardClashExclusions`, `clearanceDistanceQueriesRun`, and `clearanceHits` must be equal. Timing fields are excluded. |
| `diagnostics` | **Multiset** equality over the complete public payload of each entry: `reason`, `scope`, `role` (present on fragment-scoped entries, `CollisionWorld.js:97-107`), and every applicable fragment reference expanded to `(modelTag, dbId, fragId)` — `fragment` for fragment-scoped entries, `sourceFragment` and `targetFragment` for pair-scoped ones. A key omitting `role` and the singular `fragment` would treat a source-side and a target-side `clearance-anisotropic-scale-unsupported` as identical and let a provenance regression pass. `modelTag` is used rather than `modelId`, which is documented as reused-under-collision-prone. |

A run is **invalid** — `FAILED_VALIDATION`, non-zero exit — if any field above differs. A performance verdict never fails the process; a correctness violation always does.

**Stage-scoped validity — the rule for a spike that genuinely reproduces only one stage's outputs.** Such a spike is compared to the synchronous path **only on the outputs it actually reproduces**, over the *identical* inputs the synchronous path was given. Everything downstream of its stub result mapping is a timing artifact by construction (§17) and is **never** compared. For **S7′**'s precheck vertical (§17) the criterion is: over the identical candidate list, the worker-side precheck's per-pair `conclusive` verdicts, its `inconclusiveCause` distribution, and its excluded-pair set must match the synchronous path's. For **S7′**'s geometry-preparation vertical (§17) the criterion is: over the identical geometry set, (i) the welded `position` / `index` buffers are **element-wise equal**; (ii) connectivity matches as a **partition** — `componentCount` equal and `componentOf` inducing the identical grouping of triangles up to relabelling, with `closedManifold` element-wise equal under that relabelling; and (iii) the returned serialized BVH's `roots`, `index`, and `indirectBuffer` are **byte-identical** to the main thread's, which is well-defined because both sides run the same pinned `three-mesh-bvh@0.9.14` build over identical input, so a difference is a real defect rather than a tolerance question. A mismatch fails **that spike** — recorded as such, with the spike's evidence unusable for §7.3's conditions — and does **not** invalidate the gate run or fail the process. A stage-scoped spike is never asked for the fields above that it does not produce.

---

## 7. The responsiveness target, decision rules, and thresholds (Required Decision 3)

### 7.1 What is inherited, and what it does and does not mean

`frameBudgetMs = 8` and M1's derived **24.8 ms** ceiling are shipped conventions (§4), reused unchanged. **They are scheduler-conformance checks, not user-experience thresholds.** Passing them says the library yields as designed; it says nothing about whether the Viewer stayed usable. Bands for the worst bracketed span across all labels: `> 24.8 ms` = **NONCONFORMANT** · `> 8 ms` but `≤ 24.8 ms` = **CAUTION** · `≤ 8 ms` = **CONFORMANT**.

### 7.2 The responsiveness target — precommitted, provisional, statistically defined

There is **no product-approved responsiveness target for this operation today**, and none can be derived from the repository. This spec declares a provisional one — anchored to named external conventions rather than a number chosen here — *and* makes its confirmation a mandatory-D prerequisite (§7.5.1).

**Provisional target, evaluated on the representative multi-process runtime (§6.1.5b), for each verdict-bearing R-case:**

- **T-a** — no main-thread task in the query window exceeds **50 ms** (the Long Tasks definition; measured from the CDP trace, not from `longtask` entries).
- **T-b1** — the p95 inter-frame interval is at most **32 ms** (two frames at 60 Hz).
- **T-b2** — no inter-frame gap exceeds **100 ms** (the RAIL model's Response budget, itself derived from Nielsen's 0.1 s "feels instantaneous" limit). T-b's two clauses are split because they are thresholds of different kinds — a percentile and a hard maximum — and §7.2's aggregation rules treat those differently.
- **T-c** — p95 measured input-handler delay is at most **100 ms** (the same RAIL Response budget), over the trusted externally-generated input series of §6.2, with censored observations counted at their lower bound.

**Aggregation unit — fixed, so two implementations cannot disagree:**

- **T-a and T-b2 are hard maxima and require 5/5 repetitions to pass.** A single repetition containing a >50 ms task fails T-a; a single repetition containing an inter-frame gap >100 ms fails T-b2. Hard maxima are not medianed and are not subject to the 1.5× clause below; a rare 61 ms task, or a single 149 ms frame gap, is exactly the event the target exists to catch.
- **T-b1 and T-c are percentile statistics.** Each is computed **within** each repetition; the case passes only if (i) the **median across the five repetition values** is within the threshold **and** (ii) **no single repetition exceeds 1.5× the threshold**. Clause (ii) stops a median hiding one badly-degraded run.
- Every evaluation is per `(runtime, case, broadPhase, state)`, where `state ∈ {cold, warm}` — or `{cold, warm, refresh}` for **R6**, §6.1.4's one declared exception — are the measured queries §6.1.4 defines for each fresh world. **Every state a case has is independently verdict-bearing**: each is evaluated on its own query window, against the same thresholds, by the same aggregation rules, and a case passes only if it passes in **every** state it has under **both** broad-phase arms it can execute. Cold is not excluded, and states are never pooled into one window — the cold path is where §3.1's ~1.4 s of unattributed cost lives and where §8.2's cold-only boundaries (WB-1a/WB-1b) would apply, so a cold-state failure must be able to fail a case (§7.3 condition 2, §17's S7′ variant selection). Where a case is declared warm-only (S4, §5.6), only the warm state exists and only it is evaluated. Where a case declares the third `refresh` state — **R6 only** (§5.2.1's post-invalidation re-run recording `P₁`); no other R-case and no S-case has one — it is evaluated on its own query window by these same rules, and a **target** failure there (T-a, T-b1, T-b2, or T-c) fails that tuple **exactly as** a cold or warm failure does, and can satisfy §7.3 B condition 1 on its own. Correctness at that query — a stale or incorrect result, a parity mismatch against the linear oracle, or a lifecycle error — is governed by §6.4 and §19.1 exactly as it is at cold and warm: it invalidates the **run** (`FAILED_VALIDATION`, non-zero exit). It is never a target failure and is never evidence for B condition 1, which is a responsiveness condition only.

**Secondary, reported but not target-bearing:** X-3 makespan against Nielsen's 1 s "keeps the user's flow of thought seamless" limit (Nielsen 1993, the source RAIL's Response budget derives from — cited for the 1 s figure specifically, which is *not* a RAIL budget), and against the **accepted status quo**: M2 and M3 both shipped and were reviewed with a warm single-element federated query at ~440–520 ms wall time. Evidence of what this project has already accepted, not a claim that it is comfortable.

**T-a, T-b1, T-b2, and T-c are all provisional** and must be restated once confirmed, exactly as `maxSyncTriangleCount` and `maxCollisionInstancesPerEpoch` stayed provisional until their own gates measured them.

### 7.3 The evidence → verdict mapping

Read mechanically. Narrative judgement may not override a missing prerequisite. Recall §1.2: B and C are *justification* verdicts; parity is an adoption prerequisite (§19.2), not a verdict condition.

**Verdict A — stay synchronous.** Permitted **only** when *every* verdict-bearing R-case, on the representative multi-process runtime, under every broad-phase arm it can execute and in **every** measured state it has (§7.2's `(runtime, case, broadPhase, state)` unit — cold and warm, plus `refresh` for R6), meets T-a, T-b1, T-b2, and T-c by §7.2's aggregation rules. A failing S-case does not by itself block A, but §7.5.4 governs when an S-case is nonetheless decision-driving. Simplicity is a benefit; **migration difficulty is not evidence of adequacy.**

**Verdict B — a targeted worker boundary is justified.** Requires **all** of:
1. the synchronous baseline **fails** T-a, T-b1, T-b2, or T-c at one or more verdict-bearing R-cases, in **any** measured state that case has — cold, warm, or, for R6, `refresh` (§7.2);
2. a **named** boundary from §8.2 — whether B means BVH construction, complete geometry preparation, or a batched narrow-phase service. Each of these has an evidence path: §17's S7′ vertical is selected by the §6.3 stage attribution of the failing cost, to match the named boundary — the precheck vertical for a narrow-phase boundary, the extra-copy geometry-preparation vertical for a cold-only WB-1a/WB-1b one, subject to §17's rule that the geometry-preparation arm proves **WB-1b** unless the worker-side BVH-construction sub-stage is also reported in isolation;
3. §6.3's partition passing the **main-only remainder** screen: the largest **main-only-attributed task residual** in the failing query window is at most the **50 ms** T-a threshold. **The residual is computed exactly as follows, so two harnesses cannot disagree.** The harness timestamps each recorder callback at receipt with `performance.now()` (harness-side only — no library change, no addition to §16.4), giving every reported stage the interval `[end − ms, end]` on the same clock the query's `performance.mark` pair anchors to the CDP trace. For each CDP main-thread task interval inside the marked window, subtract the portions of that task covered by stages classified **transferable** under the fixed rule immediately below; the remainder is that task's main-only-attributed residual. **Overlapping stages are counted once**: only the innermost classified stage covering an instant contributes, so a nested direct-bracket span inside a checkpoint-bracketed one is never subtracted twice (§6.2's rule that nested and bracketed spans are never unioned or summed). The screen value is the **maximum residual over all tasks in the window and over all five repetitions**, evaluated as a hard maximum like T-a.

   **The transferable classification this screen uses is fixed and pre-registered, so it never depends on the verdict it helps determine.** Two of §6.3's rows carry no single fixed class — `compactAndWeld` is "main-only as written; movable only via the extra-copy variant (§8.2) … classify per variant", and per-pair geometry resolution is "main-only on first touch, transferable when warm". **For the purposes of this screen only**, any stage §6.3 marks as movable under *any* §8.2 variant counts as **transferable**: `compactAndWeld` counts as transferable (it moves under WB-1b's extra-copy variant), and per-pair geometry resolution counts as transferable (it moves once warm). This classification is read straight off §6.3's static table and is **independent of which §8.2 boundary a later B verdict would name and of which vertical §17 selects** — which is what removes the circularity that would otherwise arise, since §17's variant selection consumes this very screen's partition. **The consequence is deliberate and is stated here rather than left implicit:** this is the most *permissive* classification available — it credits every stage that is movable under some variant as fully removable — so a screen that still fails under it is a genuinely conservative finding that **no** §8.2 boundary, not merely the one that would eventually be named, can close the gap. That is exactly what licenses the *no-boundary* **D**. The actual stage-level cost and overhead of whichever variant is later selected is not this screen's business; it comes from S7′ under condition 4.

   **This screen is T-a-only, deliberately.** Removing transferable time from a *real* trace bounds the main-only task residual, but it cannot reconstruct the frame cadence or input latency a *hypothetical* main-only execution would have — moving work also changes task boundaries, message handling, yield placement, and frame opportunities. **T-b1, T-b2, and T-c sufficiency for the hypothetical post-boundary configuration is therefore not established by M4 at all.** Observing it would require a real integrated worker path executing complete queries end to end, which §17 forbids M4 from building, and S7′'s evidence is stage-scoped (§17) and cannot supply it. That sufficiency is instead an **adoption prerequisite** for the implementation milestone (§19.2), on exactly the same footing as full correctness parity already is there — consistent with §1.2, under which B and C are *justification* verdicts that a named boundary is worth building and measuring end to end, not claims that the post-boundary configuration has been shown responsive. If the screen fails, no boundary in §8.2 can solve it: B **and** C are both excluded (C requires this same condition), and the verdict is **D** under §1.1's *no-boundary* cause;
4. spike S7′ evidence, at **every failing `(case, broadPhase, state)` tuple plus R1 and R2**, from §7.4.2's effect rule applied to the **paired comparison** §17 defines — the named stage executed **synchronously** versus the same stage executed **in the worker over identical inputs**, with a stub result mapping downstream in both arms — establishing (a) the worker arm's own real-world cost, transfer, serialization, worker-side execution, and result receipt included, and (b) that this cost is not so large that it would erase condition 3's screen margin once the stage is notionally removed from the main-only residual. **This is stage-level cost and overhead evidence only.** It does **not** by itself establish end-to-end T-b1/T-b2/T-c sufficiency for the post-boundary configuration; per condition 3 that sufficiency is not established by M4 and is an adoption prerequisite (§19.2).

   **Clause (b) is computed exactly as follows, so two harnesses cannot disagree.** For each of the five paired repetitions `i`, let `Rᵢ` be condition 3's main-only-attributed residual maximum **at that repetition** — the same per-repetition quantity condition 3 then maximises across repetitions — and let `Hᵢ` be the largest CDP main-thread task duration inside the **worker arm's** mark window at that repetition. `Hᵢ` is the main-thread cost the boundary *adds*: the input snapshot and any extra copy, the transfer and its serialization, and the response's receipt and deserialization. Worker-side execution and the main thread's `await` occupy no main-thread task, so by construction they contribute nothing to `Hᵢ` — which is exactly why a total-elapsed figure may **not** be substituted for it. Clause (b) passes only if `Rᵢ + Hᵢ ≤ 50 ms` for **all five** repetitions, evaluated as a hard maximum exactly like T-a and like condition 3's own screen. The sum is deliberately conservative — it charges the largest added task against the largest residual task even where the two could not occupy the same task — so its errors fall toward **D**, which is the safe direction under §7.5;
5. S7′ overhead measured at **both** the smallest queries (R1/R2) and the largest verdict-bearing workload — a design winning only at a stress case must not silently become the default;
6. §15's memory budget met on §15.3's controlling metric, measured cold/warm/peak/retained, with the multipliers confirmed (§7.5.7);
7. §10 and §11's lifecycle, stale-result, and disposal requirements demonstrated by S4′ (and S5′ where the topology requires it);
8. no structural blocker outstanding — in particular §8.6's module-resolution precondition resolved by S1′.

**Verdict C — a broader off-main-thread architecture is justified.** Requires B's conditions 1 and 3–8, plus evidence that the failure is in the **warm narrow phase** and that repeated per-query transfers would erase a targeted worker's benefit (§18's C1 refuted by S6′, and S7′ showing a one-way-population topology does not suffer the same overhead).

**Verdict D — blocked.** §7.5's eight mandatory conditions, plus §1.1's *no-boundary* cause when condition 3's screen fails and A, B, and C are therefore all excluded.

### 7.4 Topology, amortization, and the effect rule

#### 7.4.1 Topology and amortization must be fixed before any overhead figure means anything

- **Worker topology must be named**: one long-lived worker vs. per-query worker vs. pool; persistent worker-resident cache vs. per-query population. §18 enumerates the options; a proposal picks one, and every overhead number is reported against it.
- **The amortization horizon is declared, not open-ended.** A one-time population cost may be amortized over **the queries actually executed in the measured scenario sequence, and over nothing else.** Amortizing over unspecified "future queries" is a named loophole (§7.6.4).
- **Overhead is compared at both ends of the workload range** (B condition 5), never only where it looks best.

The comparison M4 then makes is simply: *at the failing scenarios, does the named boundary's own measured stage-level cost — its transfer and serialization overhead included — leave the main-only residual within **T-a*** (§7.3 conditions 3 and 4) — not a ratio test against an invented "small fraction." M4 deliberately does **not** compare a proposal against T-b1/T-b2/T-c end to end: that comparison requires an integrated worker path executing complete queries, which §17 forbids M4 from building, and it is therefore an adoption prerequisite (§19.2) rather than a verdict condition.

#### 7.4.2 The precommitted effect rule (what "beyond measurement noise" means)

For a paired comparison between a synchronous arm and a worker arm — both run for the same 5 repetitions under §6.1.6's schedule, and both measured over the **same scope covering the same work**, which §17 fixes for S7′ as the *same stage* executed by both arms over *identical inputs*, with everything downstream of that stage stubbed in both — an improvement counts **only if both** hold:

1. the difference of the two arms' **medians** exceeds the **interquartile range of the noisier arm** across its five repetition values (a non-parametric spread bound requiring no distributional assumption at n = 5); **and**
2. the improvement's **direction is consistent in at least 4 of the 5 paired repetitions** (a sign test at n = 5; 4/5 or 5/5 is the strongest statement 5 pairs support).

Failing either, the effect is **INCONCLUSIVE**, which under §7.5.5 forces D rather than permitting B or C.

### 7.5 When D is mandatory

Verdict **D** is required — not merely permitted — if **any** of the following holds. Each D verdict names which apply and exactly what would resolve them.

1. **No confirmed responsiveness target.** §7.2's target is still provisional and unconfirmed.
2. **No representative runtime.** §6.1.5b could not be run, or produced results materially different from the historical configuration with no explanation.
3. **Capacity censoring.** The workloads the decision turns on could not be executed because a shipped constant rejected them (§4).
4. **Workload validity.** The scenario a proposal depends on is not established as a real collision-core requirement — including §5.5's condition (an unconfirmed ~10-instance workload driving the decision) and S3 (whole-model source, post-M4 scope).
5. **Insufficient statistical confidence.** A comparison the verdict depends on is **INCONCLUSIVE** under §7.4.2.
6. **Missing causal attribution.** §6.3's partition is incomplete — in particular while the ~1.4 s unattributed cold cost, the direct Hard-Clash-precheck duration, or the inconclusive-cause breakdown remain unmeasured.
7. **Unconfirmed memory multipliers.** §15.3's 1.0×/2.0× budgets are still provisional and a B/C verdict depends on them.
8. **Undetermined device/browser scope, or undetermined concurrency expectations where the proposal depends on them.** The target was evaluated on a machine class not established as representative — this condition applies to **A, B, and C alike**, because a target met only on one development machine is not a met target; **or** the proposal's topology is a worker **pool** (§18's C5) while concurrent-`findClashes` usage expectations remain unspecified (§8.8). A single-worker topology is not blocked by the concurrency half.

### 7.6 Named loopholes

1. **Cherry-picking high-count but spatially sparse sources** (or dense ones) — defeated by §5.1's mandatory covariates and §5.4's deterministic banded cohorts.
2. **One cold and one warm sample** — defeated by §6.1.6's five counterbalanced repetitions and §7.2's aggregation rules.
3. **Comparing a maximum from one sample count against a maximum from another** — §6.1.8 requires like-for-like percentiles with both counts stated.
4. **Amortizing worker transfer over an unspecified number of future queries** — defeated by §7.4.1's declared horizon.
5. **Ignoring result-message volume** — a worker returning thousands of pair results pays serialization and main-thread deserialization cost; §6.3 requires it attributed and §8.4 names it.
6. **Treating a capacity rejection as a fast pass** — defeated by §4's `CAPACITY_REJECTED` requirement.
7. **Deciding on the scheduler-conformance metric alone**, which can be fully conformant while the UI starves — defeated by §6.2 and §7.2.
8. **Reporting only the historical `--single-process` runtime** — defeated by §6.1.5.
9. **Measuring input latency with in-page `dispatchEvent`**, which measures nothing — explicitly forbidden by §6.2.
10. **Deriving duty cycle from Long Tasks**, which cannot see tasks under ~50 ms — explicitly forbidden by §6.2.

---

## 8. Worker-boundary feasibility (Required Decision 5)

### 8.1 What can actually cross, established from source

| Item | Crossable? | Basis |
|---|---|---|
| Welded geometry buffers | **Yes** — `{position: Float32Array, index: Uint32Array}`; cloneable and transferable | `geometry/activeRangeCompaction.js:182` |
| Raw Viewer geometry | **No** — live references, valid only within one synchronous span | `viewer/ViewerGeometryAdapter.js`, `geometry/createGeometryRegistry.js:28-33` |
| `MeshBVH` | **Yes, via serialization.** `MeshBVH.serialize(bvh, {cloneBuffers})` → `{version, roots: ArrayBuffer[], index: TypedArray, indirectBuffer: Uint32Array}`; `MeshBVH.deserialize(data, geometry, {setIndex, indirect})` rebuilds it, sharing root buffers | pinned `three-mesh-bvh@0.9.14`, `src/core/MeshBVH.js:112,160`, verified in `node_modules/` and `wwwroot/vendor/` |
| `MeshBVH` **as an object** | **No.** It holds a `geometry` back-reference; `deserialize` needs the geometry present, and `geometry.boundsTree` must be re-attached or `closestPointToGeometry` silently degrades to a per-leaf linear triangle scan | `MeshBVH.js:160`; `blas/ThreeMeshBvhBackend.js:56` |
| `indirect: true` layout | **Yes** — `indirectBuffer` is in the serialized payload, so `resolveTriangleIndex` stays correct | `MeshBVH.js:112` |
| `GeometryConnectivity` result | **Yes** — `{componentCount, componentOf: Int32Array, closedManifold: boolean[]}`; the boolean array should cross as `Uint8Array` | `geometry/GeometryConnectivity.js:101` |
| `PlacedInstance` | **Yes** — `Float64Array(16)` matrix, plain-number bounds | `CollisionWorld.js:51` |
| `CollisionInstance` | **Yes** | `CollisionWorld.js:854` |
| narrow-phase `Instance` operand | **No, as an object** — reconstructible from the crossable parts | `CollisionWorld.js:376` |
| `CollisionInstanceBVH` (TLAS) | **In principle**; not covered by `MeshBVH.serialize`. Rebuilding in a worker from transferred records is cheap (2.1–2.9 ms for all three epochs) and is the sane option | `tlas/CollisionInstanceBVH.js:9,15,29`; §3.1 |
| Viewer `Model` object | **Never.** Not cloneable — `postMessage` throws `DataCloneError`. A structural guarantee, not merely a policy | §9 |
| Diagnostics / statistics | **Yes** | `CollisionWorld.js:491-524` |
| Cancellation signal | **Not as a shared flag today** | §8.7 |
| Progress signal | **Yes** — `postMessage`; the vendor's worker does this with a 10 ms throttle | `three-mesh-bvh/src/workers/generateMeshBVH.worker.js` |

**Transfer detaches.** Transferring an `ArrayBuffer` neuters it on the sender. The main thread still needs the welded geometry for the `'linear'` oracle and for `ContainmentQuery.anyComponentInside`'s direct `.attributes.position` / `.index.array` reads. So a transfer-based design either **copies** (memory duplication) or **loses** the main-thread copy (the oracle stops working — forbidden by §14). Every proposal states which and accepts the consequence.

### 8.2 The candidate boundaries — with the payoff stated correctly

"The easy worker stage is worth ~316 ms" is **wrong**:

- The vendor's `GenerateMeshBVHWorker` moves **only `MeshBVH` construction** — it transfers position/index buffers away temporarily and returns them; it does not move this repository's weld or connectivity phases (`node_modules/three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js:7`). On the M3 fixture that is **~43 ms**, not 316 ms.
- `compactAndWeld` (~176 ms) must run in the same synchronous span as proxy resolution *until collision-owned copies exist*. It can move only under an **extra-copy variant**: the main thread first `slice()`-copies the raw Viewer position/index views, then hands those copies to a worker that welds. Whether that wins is a measurement; §6.3 requires the extra copy's cost attributed.
- Connectivity (~96 ms) reads only the welded index and is **freely transferable**.

| Option | Boundary | What actually moves | Payoff on current evidence | Principal cost |
|---|---|---|---|---|
| **WB-0** | none | — | — | status quo |
| **WB-1a** | BVH construction only (vendor-supported) | `new MeshBVH(...)` per distinct geometry | **~43 ms cold**, zero warm | buffers out and back per geometry |
| **WB-1b** | full geometry preparation, extra-copy variant | copy → weld → connectivity → BVH in the worker | up to **~316 ms cold**, zero warm, minus the added copy | one extra main-thread copy per geometry; larger transfer |
| **WB-2** | narrow-phase pair evaluation | precheck + exact queries + distance query | the dominant **warm** cost (~450–518 ms of ~518 ms warm narrow phase, one source instance) | both operands' geometry + BVH + connectivity worker-resident ⇒ a worker-owned cache, not per-pair transfer |
| **WB-3** | clearance distance primitive only | `closestPointToGeometry` | ~11% of warm narrow phase | WB-2's data requirement for a tenth of the benefit. Re-measured, not assumed. |
| **WB-4** | whole query below extraction | broad + narrow phase + per-pair aggregation | everything except main-only stages | entire instance population and all geometry worker-resident |
| **WB-5** | extraction | — | — | **structurally impossible**, §8.5 |

**WB-1a and WB-1b are cold-only** — the geometry cache already amortizes them to zero warm — while **WB-2/WB-4 are where the warm cost is.** A verdict of B must say which.

### 8.3 The tension M4 must resolve with evidence

The warm narrow phase is hard to move **because of ownership and lifecycle, not because its data is fundamentally non-transferable**. Once copied out of Viewer state, positions, indices, connectivity arrays, matrices, BVH buffers, epochs, and revisions are all representable as worker data (§8.1), and a *persistent worker-owned cache* avoids per-query duplication. The honest framing:

> the dominant stage is movable only under a **persistent worker-resident cache** (verdict C's shape), while the trivially movable stage is already amortized to zero warm (verdict B's cheap shape, which only helps cold).

A hypothesis, not a finding — and it does **not** support A on its own.

### 8.4 What a WB-2/WB-4 message would contain

Per `(epoch, geometryIndex)`, pushed **once** as a one-way population, not per pair:

```
{ epoch, geometryIndex,
  position: Float32Array, index: Uint32Array,            // copied first — the oracle needs its own
  bvh: { version, roots: ArrayBuffer[], index, indirectBuffer },   // MeshBVH.serialize output
  connectivity: { componentCount, componentOf: Int32Array, closedManifold: Uint8Array },
  localDiagonal, aspectRatio, aspectRatioExceeded }
```

Per query, a compact repeated message:

```
{ requestId, worldGeneration, mode, clearance?,
  epochs: [{ epoch, placementRevision, revisionArmed: boolean }],   // §10; arming mirrors §2.2's path rule
  pairs: [{ sourceEpoch, sourceFragmentId, sourceGeometryIndex, sourceMatrix: Float64Array(16),
            targetEpoch, targetFragmentId, targetGeometryIndex, targetMatrix: Float64Array(16) }] }
```

Response:

```
{ requestId, epochs: [{ epoch, placementRevision }],     // echoed for revalidation, never an authority
  results: [{ sourceFragmentId, targetFragmentId, verdict, conclusive, inconclusiveCause?, distance?, witness?, ... }],
  diagnostics: [...], statistics: { ... } }
```

Absent by design: no `Model`, no `modelId`, no `dbId` (§9). **Response volume is itself a measured cost** (§7.6.5).

### 8.5 Why extraction cannot move (settled by structure)

`viewer.impl.getRenderProxy`, `model.getInstanceTree()`, `enumNodeFragments`, and `fragList.getWorldMatrix`/`getWorldBounds` are live main-thread Viewer objects backed by the Viewer's own GPU/DOM state, and `adaptViewerGeometry` returns references into those buffers valid only within one synchronous span. **WB-5 is ruled out on structure.** If the ~1.4 s of unattributed cold cost lives here, it is a permanent main-thread floor capping every other option — which is why §6.3 makes attributing it mandatory and §7.5.6 makes leaving it unattributed a mandatory-D condition.

### 8.6 Module resolution — a precondition, not a detail

The app has **no bundler**. `server.js` serves `wwwroot/` statically and mounts `collision/` at `/collision`; `wwwroot/index.html:47-53` declares an import map mapping `three`, `three-mesh-bvh`, and `three/addons/utils/BufferGeometryUtils.js` to vendored paths. Every module under `collision/` imports `three` and `three-mesh-bvh` by **bare specifier**, and so does the vendor's own `src/workers/generateMeshBVH.worker.js`.

An import map is scoped to the realm of the document that declares it, and there is no shipped browser mechanism for applying it to a dedicated worker's realm. If that holds here, **no module worker built from the current source tree can resolve its imports**, and every worker option — including reusing the vendor's `GenerateMeshBVHWorker` — acquires a prerequisite: a worker-specific build/rewrite step, worker entry modules using relative paths only, or a classic worker over a pre-bundled script. Any CSP affecting `worker-src` must be checked at the same time.

This spec does **not** assert the outcome; spike **S1′** settles it empirically, and §17 constrains how — a blob-URL or intercepted-request worker would answer a *different* question (different base URL, different origin inheritance) than a same-origin served module worker.

### 8.7 `SharedArrayBuffer` is unavailable today

SAB — and therefore `ParallelMeshBVHWorker`/`WorkerPool`, zero-copy shared geometry, and any `Atomics`-based cancellation flag — requires cross-origin isolation (`COOP: same-origin` + `COEP: require-corp`). `server.js` sets no such headers, and the page loads cross-origin Viewer assets (`developer.api.autodesk.com`, `cdn.autodesk.io`) that COEP would block without per-resource CORP or a credentialless mode. Enabling isolation is not a local change and risks breaking Viewer asset loading.

**Adopted position:** SAB designs are out of scope for M4's verdict. If only a SAB design could meet the target, the correct verdict is **D**, with cross-origin isolation named as the blocker — never an unvalidated recommendation to change server headers.

### 8.8 Concurrency posture

Without SAB, N workers means N copies. M4's default is **one long-lived worker** unless measured evidence shows a single worker is the bottleneck; a pool is a memory multiplier before a throughput multiplier, and §15's budget applies per worker. Whether concurrent `findClashes` calls are an expected *usage* pattern is unspecified (§23 open question 5) — note that concurrent calls are demonstrably *supported* today (`CollisionWorld.js:2591-2599` handles interference between different concurrent calls), which is a correctness constraint on §10 regardless of frequency. A pool topology is blocked on the usage question by §7.5.8; a single-worker topology is not.

---

## 9. Runtime identity implications (Required Decision 6)

1. **The main thread is the sole identity authority.** `_modelLifecycle`, `_liveEpochs`, `_modelByEpoch`, `_placementRevisionByEpoch`, lease validity, and `ownerDbId` resolution stay main-thread, unchanged.
2. **The worker receives opaque numeric tokens only** — `loadEpoch`, `placementRevision`, `geometryIndex`, `fragmentId`, `requestId`, `worldGeneration`. Never a `Model` (structurally impossible), never `modelId` (diagnostic-only, collision-prone).
3. **The worker never learns dbIds.** dbId aggregation, `groupBy:'dbId'` semantics, and source/target provenance are computed main-thread from `PlacedInstance.ownerDbId` after results return, so `ClashPair.source.model` / `.target.model` remain real `Model` references resolved by the identity authority.
4. **`loadEpoch`'s global monotonic never-reused property is what makes token revalidation sound.** A stale epoch token is simply absent from `_liveEpochs`.
5. **Geometry identity remains `(loadEpoch, geometryIndex)`**, so a worker-side cache is keyed identically and an epoch release invalidates both by the same key.
6. **Fragment identity remains `fragmentId` within an epoch**; the first-discovery-wins `_representativeFragmentByGeometry` election stays main-thread.
7. **No worker result may introduce an identity the main thread did not already hold.** A response naming an unknown epoch or fragmentId is discarded, not resolved.

Deliberately compatible with the future durable-identity layer: nothing persists a `Model` reference or `modelId` as if durable, and nothing requires the worker to hold identity state a future durable identity would have to reconcile.

---

## 10. Lifecycle / stale-result correctness (Required Decision 7)

A worker introduces one new hazard class: **a result computed from state that is no longer valid, arriving after the fact.** Any proposal must carry this design, and S4′ must prove it.

### 10.1 Request state is per-call, never global

**`requestId` is a routing and duplicate-response key, not a supersession signal.** The main thread holds a `Map<requestId, RequestState>` where `RequestState = {settle, reject, epochs: [{epoch, placementRevision, revisionArmed}], worldGeneration, issuedAt}`. **Every concurrent `findClashes` call has its own entry and settles independently.**

This is a correctness requirement, not a preference: concurrent calls are an existing, handled scenario — `_getTlasEntryForEpoch` reasons explicitly about interference from "a DIFFERENT concurrent call" and resolves it by retrying with fresh state, never by cancelling either call (`CollisionWorld.js:2591-2599`). **A world-global "current in-flight id" would silently convert supported independent concurrent calls into latest-call-wins and would leave the superseded call's promise permanently pending.** M4 must not introduce that; if latest-call-wins were ever wanted it would be an explicit public contract change under roadmap §8, not a silent side effect of a worker.

Each request also carries a snapshot taken at true query entry — the same point `createCompositeCheckpointPort` snapshots `expectedRevisionByEpoch` (`CollisionWorld.js:1107`) — and `revisionArmed` mirrors §2.2's path-specific arming exactly.

### 10.2 The acceptance predicate and the complete settlement matrix

On receiving a message, the main thread looks up `requestId` in the map. **Every** outcome settles the owning promise exactly once:

| Condition at receipt | Outcome |
|---|---|
| `requestId` not in the map | **Discard silently** — a duplicate or late response for an already-settled call. Counted in statistics; settles nothing, because nothing is pending. |
| world disposed | reject with `WorldDisposedError` |
| `worldGeneration` mismatch | reject with `WorldDisposedError` (the world this result belongs to no longer exists) |
| any named epoch absent from `_liveEpochs` | reject with `ModelEvictedError` |
| an **armed** epoch's current `_placementRevisionByEpoch` ≠ its captured value | reject with `ModelPlacementChangedError` |
| response malformed / schema-invalid | reject with a `TypeError`-class error naming the request; never a silent drop |
| worker `onerror`, crash, or `terminate()` while requests are in flight | reject **every** entry in the map with an error naming the cause, then clear the map |
| otherwise | resolve with the mapped result |

Precedence follows the existing convention — **disposed → evicted → placement-revision** — so no new public failure mode is introduced and the errors a caller can observe are exactly today's set.

**The armed-epoch clause must reproduce today's arming scope, not broaden it.** Revalidating placement for *every* epoch on *every* path would introduce aborts that do not exist today for `broadPhase:'linear'` callers — a silent contract change, and therefore forbidden.

**No unsettled promise is permitted under any of these conditions.** That property is what S4′ exists to demonstrate.

### 10.3 Interaction with eviction and disposal

- `evictModel(model)` must remain **synchronous and never-throwing**, including on a disposed world — it is called from `BEFORE_MODEL_UNLOAD_EVENT`. A worker design *posts* an eviction message and returns; it never awaits an acknowledgement.
- The worker may transiently hold state for an evicted epoch. Acceptable **only because** §10.2 guarantees no result derived from it is accepted. It is reclaimed on the worker's processing of the message, and `dispose()` terminates the worker outright — which by §10.2's crash/terminate row rejects every in-flight request rather than leaving promises pending.
- `invalidateModelPlacement(model)` bumps the revision main-thread; an in-flight request naming an **armed** epoch is thereby invalidated. A worker must **never** re-read placement itself — it has no Viewer access and no authority to.
- The lazy staged refresh and the TLAS rebuild it forces stay main-thread-authored; refreshed placement is pushed as data.

### 10.4 What S4′ must prove, not merely design

On a stub worker with no real geometry: rejection **at publication**, with the correct error and **no unsettled promise**, for **all** of —

(a) `dispose()` mid-flight; (b) `evictModel` mid-flight; (c) model reload producing a **new epoch** while a result for the old one is in flight; (d) `invalidateModelPlacement` mid-flight in **both** the armed (TLAS) and unarmed (linear) states — the unarmed case must **not** reject; (e) **two concurrent requests with responses returned out of order**, each settling its own caller correctly and neither cancelling the other; (f) a **duplicate** response for an already-settled `requestId`, discarded without disturbing anything; (g) a malformed response; (h) worker `onerror` / `terminate()` mid-request, rejecting every in-flight request. Proving that a token survives structured cloning is *not* sufficient.

---

## 11. Cancellation / abort compatibility (Required Decision 8)

### 11.1 The honest starting point

No caller-facing cancellation; two internal deferred-rejection signals that stop *waiting* without preempting work; a poll-on-checkpoint validator. **Abort granularity today is already one atomic unit** — one pair, one build phase, one traversal. A worker does not make that worse; this is parity, not a worker cost.

### 11.2 What M4 must evaluate

- **Signal path.** Without SAB (§8.7) a worker cannot poll a shared flag, and `postMessage` cannot interrupt a synchronous `closestPointToGeometry` or `bvhcast` inside the worker. Cooperative abort in a worker has *exactly* the granularity the main thread has today: between pairs, not within one.
- **Graceful abort vs. termination.** A between-pairs cooperative check driven by a queued message; and `worker.terminate()`, immediate and unconditional but destroying all worker-resident cache — making the next query cold and, per §10.2, rejecting every in-flight request.
- **Partial work disposal.** §10.2 guarantees no partial result is accepted; what must additionally be established is that the *memory* is reclaimed.
- **Cleanup of transferred/rebuilt state.** A design that transfers must state how the main thread recovers, or must copy.

### 11.3 What M4 must decide, and what it must not

**Decide:** does collision core need a per-request cancellation token at all, or is per-call stale-result rejection (§10) plus disposal sufficient for its own obligations?

**Do not:** introduce a cancellation API shape constraining how the future result layer expresses reject / partial / discard. No `AbortSignal` is added.

**S5′ is conditional** on the selected topology disposing by terminating a dedicated worker; if so, it becomes required.

---

## 12. Progress / yielding compatibility (Required Decision 9) and the Hard-Clash precheck (Required Decision 11)

### 12.1 Is the current yielding keeping the UI responsive?

**Not established by any prior gate.** §6.2's X-1 axis is the answer, with yield count and cumulative yield delay measured directly (§16.4.1).

### 12.2 Would a worker remove the need for main-thread yielding?

Only for the stages that move. Extraction (§8.5), result aggregation, dbId grouping, lifecycle validation, and visualization stay main-thread and still need checkpoints. Any proposal must enumerate **which checkpoint call sites survive** and confirm the survivors still share one per-call frame-budget accumulator with correct semantics (`scheduler.js:60-90`).

### 12.3 Progress from worker stages

Feasible and cheap in principle (the vendor's worker posts throttled progress at ~10 ms). The overhead must be **measured** at a stated rate on the largest case and reported — assigned to spike **S8′** (§17), because it requires an actual worker and therefore cannot be produced by the gate. No progress API and no UI are added. If progress messaging costs more than a stated small fraction of the stage it reports on, that is itself a finding.

### 12.4 The Hard-Clash precheck breakdown

The most important stage to understand, and today's instrumentation cannot see inside it: the precheck's duration is *inferred from a remainder* around an awaited call (`CollisionWorld.js:2318`), and `classifyHardClashPrecheck` collapses **every** inconclusive cause into one generic `{reason: 'clearance-hard-clash-precheck-inconclusive'}` (`query/ClearanceHardClashPrecheck.js:29-30`). M4 must time it directly and report:

| Quantity | Why |
|---|---|
| Direct duration of `volumeOverlapQuery`, separated from geometry resolution | §3.1 attributes the warm cost to the two *jointly*; splitting them decides whether the remedy is caching or computation. |
| Time in `ProperCrossingQuery` vs. `anyComponentInside(A in B)` vs. `anyComponentInside(B in A)` | Locates cost within the composed predicate; `composed-narrow-phase-stage` aggregates all three. |
| **Cause attribution** of `inconclusive` outcomes | 24.3% on the M3 fixture. Causes must be separated — crossing budget exhausted, containment sample budget exhausted, unsupported geometry layout, aspect-ratio gate, non-manifold/parity-tainted component — which requires §16.4.2's additive cause enum, since no such distinction exists today. |
| Containment samples consumed vs. `maxContainmentSamples` | Distinguishes a budget problem from a geometry problem. |
| Precheck run rate vs. skip rate, and why skipped | 96.7% run / 3.3% skipped; the skip requires provably disjoint unpadded AABBs (`ClearanceHardClashPrecheck.js:18-20`), which a near-miss search rarely offers. |
| Per-pair cost distribution vs. operand triangle counts and component counts | Distinguishes "many cheap prechecks" from "a few expensive ones". |
| Repeat rate of `(sourceFragmentId, targetFragmentId)` precheck evaluations within one call and across a world's measured states (cold/warm, plus R6's `refresh`) | Quantifies the headroom of an ordinary synchronous precheck cache — a remedy requiring no worker at all. |

**Then, and only then**, evaluate whether a worker boundary should target this stage.

---

## 13. Clearance distance focus (Required Decision 12)

M3's 6.10 ms worst case is re-measured. Each per-call span must carry its **explanatory variables** — which the `(label, ms)` recorder cannot express, hence §16.4.5's structured event recorder:

- both operands' welded triangle counts, and their min / max / product;
- both operands' validated uniform scale factors, and whether the call anchored on the source or the target (M3's anchor-selection correction means unequal scale changes which operand drives traversal cost);
- the requested `clearance` and the resulting anchor-local `maxThreshold`;
- whether the call returned `null` (pruned entirely) vs. a distance beyond `clearance` vs. a hit;
- the resulting `distance`.

Reporting: the full distribution (§6.1.8), correlation between span and each explanatory variable, cold-vs-warm effect, the unequal-scale subset separately, and the effect of the S1 density sweep. **Then** determine whether the primitive is itself a worker candidate — current evidence (≈11% of warm narrow phase; 6.5% of candidates reach it) disfavours WB-3, but M4 re-measures at multi-element scale and higher density first.

---

## 14. TLAS vs. linear evidence (Required Decision 13)

**Correctness parity is a hard gate.** §6.4's canonical comparator applies, and a mismatch fails the run.

`broadPhase:'linear'` is not removed, weakened, or skipped for cleaner numbers. Where structurally unavailable — S2 beyond the per-target-group cap, 183 source instances against this fixture's 5,435-fragment Architecture group (§4) — the case is `CAPACITY_REJECTED` / `NOT EXERCISED` with the exact limit and observed value.

Performance is reported separately from parity, with the caveat both prior gates established: broad phase is under 1% of wall clock at this scale, so an end-to-end comparison measures narrow-phase noise. The order-independent evidence is candidate-count reduction. M4 adds the ratio at **multi-instance** source counts across the three density cohorts, where linear cost scales as `sourceCount × targetCount` while TLAS traversal does not — M2 and M3 both flagged their single-instance ratios as *lower bounds*, and S2 tests whether that bound is loose or tight.

---

## 15. Memory and duplication budget (Required Decision 14)

### 15.1 Two metrics, because one is not reproducible

**`estimateMemoryInBytes(bvh)` covers only the BVH** — not geometry buffers, connectivity arrays, pending messages, duplicated buffers, or abandoned caches. And a byte-array lower bound cannot be compared mechanically with a heap total. M4 therefore defines **two metrics** and says which controls.

**Metric M — typed-buffer lower bound (deterministic, controlling).**

```
M(scope) = Σ_geometry [ position.byteLength + index.byteLength
                      + Σᵢ bvh._roots[i].byteLength + (bvh._indirectBuffer?.byteLength ?? 0)
                      + connectivity.componentOf.byteLength + connectivity.closedManifold.length ]
         + Σ_epoch    [ tlas.primitiveBuffer.byteLength + tlasRecordCount × recordBytes ]
         + Σ_epoch    [ placementCount × (16×8 + 6×8 + 16) ]      // Float64Array(16) + two 3-arrays + scalars
         + Σ_epoch    [ instanceCount × instanceBytes ]
```

`recordBytes` and `instanceBytes` are **not guessed**: each is derived once, in the harness, by constructing `N = 10_000` objects of the exact frozen shape and taking `(H_after − H_before) / N` under §15.1's Metric H protocol; the derived figures are printed in the report so they can be checked. `estimateMemoryInBytes(bvh)` is reported **alongside** as a structural cross-check on the BVH term only, never substituted for it.

**Metric H — measured heap (cross-check).** `performance.memory.usedJSHeapSize` (Chromium, non-standard, coarse), under a fixed protocol: the harness launches Chromium with `--js-flags=--expose-gc` (it launches its own browser, so nothing about the app changes), then at each sample point calls `gc()` twice separated by two `requestAnimationFrame` turns, waits one further turn, and takes the **median of three** readings. Worker-side heap is measured inside the worker by the identical protocol and reported **separately**, never silently added to the main-thread figure. `performance.measureUserAgentSpecificMemory()` is **unavailable** — it requires cross-origin isolation this app does not have (§8.7) — and that limitation is recorded rather than papered over.

**Metric M controls the verdict**, being deterministic, reproducible across runtimes, and independent of GC timing. Metric H is reported for every scope, and a large divergence between them is itself a reportable finding.

### 15.2 Required reporting

For **cold, warm, peak, and retained** scopes, separately for main thread and worker: base collision-world memory; per-model geometry-cache memory; TLAS memory; instance/placement memory; worker duplicate/rebuilt structures; **pending-message bytes** (`byteLength` in flight plus serialized result payload size); peak during transfer/build; steady state after. Every figure states which metric produced it.

"Peak" is taken as Metric M at the point of maximum simultaneous residency — deterministically identifiable, since the harness controls when buffers are handed across — with Metric H sampled immediately before and after that point.

### 15.3 The budget

```
base   = M(main thread, steady state, no worker)
delta  = M(main thread, steady state, with worker) + M(worker, steady state) − base
peakΔ  = M(peak, both sides) − base
```

Steady-state `delta ≤ 1.0 × base`; `peakΔ ≤ 2.0 × base`. Both **provisional**; §7.5.7 makes an unconfirmed multiplier a mandatory-D condition when a B/C verdict depends on it.

Rationale, so these are not bare numbers: without SAB, a non-transferring worker duplicates by construction, so *some* doubling is unavoidable and a budget below 1.0× would reject every option a priori. Above 1.0× means duplication plus additional rebuilt structure, requiring a correspondingly large measured gain — and **"proportionate" is not left to judgement**: a proposal exceeding `1.0 × base` may only be recommended if it moves a *failing* target metric to *passing* under §7.4.2's effect rule, a binary precommitted condition. The multiplier a user sees is worse than `delta` suggests, because the main thread already carries ~2× geometry duplication of its own (§2.5).

---

## 16. Benchmark harness design (Required Decision 15)

### 16.1 Adopted shape: one standalone new gate, no shared module

**A new, standalone `test/performance/run-gate-m4.mjs`.** `run-gate.mjs`, `run-gate-m2.mjs`, and `run-gate-m3.mjs` are **not modified** — they are the archived evidence artifacts behind M1, M2, and M3's accepted dispositions.

**No shared helper module is extracted.** Lifting the summarizers and fixture sequence into a `gate-harness.mjs` would create an abstraction with one consumer and make historical comparison *harder* (a future edit silently changes what M4 measured relative to M2/M3). Duplicating ~80 lines of behavior-free boilerplate is the lower-risk call and keeps every threshold and disposition readable in one file. Extraction becomes justified only if M4 acquires **multiple real consumers**; if so, extract an **M4-only** module then, still leaving M1–M3 untouched.

### 16.2 Hard requirements

- Real federated fixture for R1–R6 and S1–S3; **S4 is the only fully synthetic case**, constructed in-page, labelled synthetic everywhere.
- Both runtime configurations (§6.1.5), the multi-process one marked authoritative.
- Five counterbalanced repetitions per R-case state with the raw set reported (§6.1.6), and one fresh world per `(runtime, case, broadPhase, repetition)` (§6.1.4).
- Machine-readable JSON to `test/performance/results/m4-gate-<timestamp>.json`. Never raw span/diagnostic/event arrays (M1's disposition records an unusable 15 MB / 769K-line dump); always count + per-key breakdown + bounded sample + bounded top-N.
- **Never a verdict from an unexercised criterion.** Explicit empty-set guards; `NOT EXERCISED` reported honestly; every unrunnable case reports `CAPACITY_REJECTED` with the exact limit and observed value.
- **Fail loudly on correctness.** Any §6.4 mismatch ⇒ `disposition: 'FAILED_VALIDATION'`, non-zero exit. Any errored run ⇒ `'FAILED'`. Performance verdicts never fail the process. This applies to §6.4's comparator at its stated scope — the gate's TLAS-vs-linear comparison and any full-result worker arm; a **stage-scoped** spike's §6.4 stage-scoped validity failure fails and disqualifies **that spike**, is recorded as such, and does not set `FAILED_VALIDATION` on the gate run.
- Record provenance: browser version and launch flags, OS and machine class, the cohort dbId lists with their §5.4 profiling covariates and any forced replacement, the constants read from `collision/constants.js`, the counterbalancing schedule, the input-probe clock calibration and drift, the derived `recordBytes`/`instanceBytes`, and console warnings.
- Install and clear the span/event recorders in a `try`/`finally` per measured call, and dispose the `CheckpointRecorder`'s `PerformanceObserver` and the CDP session.
- **Emit the §6.3 main-only / transferable partition as a first-class report section.**

### 16.3 What the harness must not do

Retune a shipped constant; modify `collision/` behavior; **modify `server.js` or add a route to it**; change server headers; leave a recorder installed across runs; or silently trim a selection until it passes a capacity check.

**Serving spike assets does not require changing `server.js`.** The M4 harness may start **its own** express instance, from a file under `test/performance/` or `spike/m4/`, mounting the same `wwwroot/` and `/collision` paths the production server mounts **plus** `spike/m4/`. That is an additional test-only process, not a production route, and it is how S1′ gets a same-origin served worker module (§17).

### 16.4 The instrumentation M4 requires — enumerated and closed

All additive, all no-ops when unused, all in the same class as M1 Task 23's `setSpanRecorder`. This is the **complete** list:

1. **Yield instrumentation** in `collision/scheduler.js`: each real yield's resume latency and a running yield count, through the existing recorder hook. This makes X-3's yield delay a measurement rather than an estimate.
2. **Narrow-phase interior labels and an additive inconclusive-cause enum**: separate geometry resolution from the Hard-Clash precheck and separate the precheck's three sub-terms; and have `volumeOverlapQuery` / `classifyHardClashPrecheck` surface *which* condition produced `conclusive: false` (crossing budget / containment sample budget / unsupported geometry / aspect ratio / non-manifold). **Additive**: the existing `{reason: 'clearance-hard-clash-precheck-inconclusive'}` diagnostic string and the existing `conclusive` boolean are unchanged, so no public contract moves — the cause travels only on item 5's event channel.
3. **An extraction-stage bracket** around `_resolveGeometryView` / `adaptViewerGeometry` / `compactAndWeld`, closing §3.1's ~1.4 s attribution gap and producing §6.3's partition.
4. **Read-only diagnostic accessors for memory accounting**: per-epoch geometry-entry count and enumeration of resident geometry entries (welded buffer byte lengths, BVH, connectivity) for Metric M. Precedent: `getEpochCollisionInstanceCount` was added for M1's own gate for exactly this reason, and `run-gate-m2.mjs` currently reaches into privates because the accessor is missing.
5. **One structured, no-op diagnostic-event recorder** — `setDiagnosticEventRecorder(fn)` / `clearDiagnosticEventRecorder()` / `reportDiagnosticEvent(kind, payload)` in `collision/scheduler.js`, alongside the existing span hook and gated by the identical null-check so it costs nothing when unset. The existing `reportSpan(label, ms)` accepts a label and a number and nothing else (`scheduler.js:47-55`), so the per-pair covariates §12.4 and §13 require cannot be expressed through it, and encoding them into label strings would be unbounded and unparseable. **Bounded schema**, fixed here so the channel cannot grow arbitrarily:

   ```
   kind: 'clearance-distance-query' | 'hard-clash-precheck' | 'narrow-phase-pair' | 'geometry-resolve'
   payload: {
     sourceEpoch, sourceFragmentId, targetEpoch, targetFragmentId,      // pair identity (numbers)
     stage,                                                             // short enum string
     ms,                                                                // duration of this stage
     sourceTriangles, targetTriangles,                                  // geometry covariates
     sourceComponents, targetComponents,
     sourceScaleFactor, targetScaleFactor, anchoredOnSource,            // clearance-only
     requestedClearance, anchorLocalMaxThreshold, distance, outcome,    // clearance-only
     conclusive, inconclusiveCause,                                     // precheck-only
     containmentSamplesUsed                                             // precheck-only
   }
   ```

   **Retention rule, so raw high-volume events never enter the result JSON:** the harness's sink aggregates online — per `kind` and per `stage`, it keeps counts, §6.1.8's full duration summary, per-covariate correlation accumulators (sums, sums of squares, sums of products), a per-`inconclusiveCause` histogram, and a bounded top-N (N = 20) of the slowest individual events. Raw events are discarded after aggregation.

6. **Nothing else.** No worker code, no cancellation API, no progress API, no constant changes, no change to any existing diagnostic reason, statistics field, or public error.

Items 1–3 and 5 are useful to future milestones independently of M4's verdict.

---

## 17. Required spikes (Required Decision 16)

Every spike: a narrow question, a bounded implementation, a measurable result, explicit disposal. **No spike code may land under `collision/` or `wwwroot/`.** All spike code lives under `spike/m4/`, served by the harness's own express instance (§16.3), and is deleted at M4 close unless a verdict explicitly adopts it.

**Ordering is load-bearing.** §6.3's main-only / transferable partition is produced by the *gate*, not a spike, and comes first. S1′ and S3′ are cheap and unconditional. **S7′ and S8′ run only if the synchronous baseline fails the §7.2 target** — if it passes, no worker prototype is built at all.

| # | Question | Bound | Result | Decisive for |
|---|---|---|---|---|
| **S1′** | Can a dedicated **module worker**, served **same-origin from the harness's own express instance** at `/spike/m4/…`, resolve `three` / `three-mesh-bvh` bare specifiers with no bundler and a document-scoped import map? Does any CSP `worker-src` rule interfere? If it fails, what is the minimal change? | One worker file, one page, one assertion, in **both** runtime configurations; plus at most one relative-path-only variant | Yes/no + the minimal change | **Every** worker option (§8.6). Run first. |
| **S3′** | Worker cold start + module init latency: `new Worker(...)` to first acknowledged message | One worker, 10 repetitions, median + max, both runtimes | ms | Whether a worker can be per-query or must be long-lived — deciding §10.3's disposal story and whether S5′ is required |
| **S4′** | Does per-call stale-result rejection work end to end, at publication, with no unsettled promise? | Stub worker, no real geometry; **all eight** scenarios in §10.4, including both arming states, concurrent out-of-order responses, duplicates, malformed responses, and worker crash | Pass/fail per scenario | §7.3 B condition 7 |
| **S5′** *(conditional — only if the chosen topology disposes by terminating a dedicated worker)* | `terminate()` latency during a long synchronous worker task, and the cost of the next query after termination | One long synthetic task; time to termination, confirmation the main thread is not blocked, then a rebuild measurement | ms, both figures | §11.2 |
| **S6′** *(conditional — only if S1′ passes and §18's C1 is not already refuted analytically)* | Per-message `postMessage` overhead at the observed candidate volume, **including result-message volume** | Round-trip a representative request/response message N times, N = the measured candidate count of the largest verdict-bearing case | ms per message, bytes, total | C1 vs. C2/C4 (§18) |
| **S7′** *(conditional — only if the baseline fails §7.2's target)* | **The batched vertical spike.** Snapshot representative collision-owned data, transfer it **once** as a one-way population, execute the failing stages' dominant workload in the worker, return compact results — **measured as a stage-scoped paired comparison against that same stage executed synchronously**, see the window note below the table. Its vertical is **selected**, not fixed — see the variant note below the table. | **Every failing `(case, broadPhase, state)` tuple, plus R1 and R2** (small-query overhead), plus the largest verdict-bearing workload; one worker; the real candidate list (precheck vertical) or the real geometry set (geometry-preparation vertical); the same 5 counterbalanced repetitions as the baseline; **the offloaded stage only**, over identical inputs in both arms, with a stub result mapping for everything downstream; measured on X-1/X-2/X-3 and on §15's metrics | The named boundary's own stage-level cost — transfer, serialization, and worker execution included — against the synchronous stage, under §7.4.2's effect rule | The **A vs. B vs. C vs. D** distinction |
| **S8′** *(conditional — same gate as S7′)* | What does progress messaging from a worker stage cost at a stated rate? | Reuse S7′'s worker; post throttled progress at 10 ms intervals during one case; measure the delta in X-1/X-2/X-3 against the same case without progress | ms and duty-cycle delta | §12.3 |

**S7′'s vertical is selected by the §6.3 stage attribution of the failing cost — not by the cold/warm/`refresh` state label alone.** For each failing `(case, broadPhase, state)` tuple the gate already emits §6.3's partition over that tuple's query window (§16.2's first-class report section). Rank the stages in that window by attributed duration; the vertical selected is the one whose stages carry the failing cost:

- **Geometry-preparation stages dominate** (`weld`, `connectivity`, `bvh-construction` — the cold-only WB-1a/WB-1b boundaries of §8.2): the **extra-copy geometry-preparation vertical**, matching §8.2's WB-1b shape — the main thread `slice()`-copies the relevant cold-stage inputs (the raw Viewer position/index views), transfers them **once**, executes weld / connectivity / BVH construction in the worker, and returns the compact prepared results (welded buffers, connectivity arrays, serialized BVH), with the extra main-thread copy's own cost attributed per §6.3. **This arm models WB-1b, and on its own proves only WB-1b.** A B verdict naming **WB-1a** (BVH construction alone) additionally requires the worker-side `bvh-construction` sub-stage timed and reported as its own figure within the same run; without that isolated result the boundary B may name is WB-1b, not WB-1a.
- **Narrow-phase stages dominate** (precheck, exact queries, distance query — WB-2/WB-4): the **warm Hard-Clash-precheck vertical** — snapshot the collision-owned geometry, BVH, and connectivity for the pairs on the real candidate list, transfer once as a one-way population, execute the precheck over that candidate list in the worker, return compact results.
- **Main-only stages dominate** (extraction, aggregation, publication): no vertical models them — WB-5 is ruled out on structure (§8.5). §7.3 condition 3's screen governs, and if that screen fails the verdict is **D** under §1.1's *no-boundary* cause.

**When the attribution does not cleanly separate the first two** — either because both are implicated in the same failing tuple, or because different failing tuples point different ways — **both variants run**, and each is reported against **only** the boundary it actually models. Reporting a geometry-preparation result as evidence for a narrow-phase boundary, or the reverse, is forbidden.

Both variants carry the **same** bound, the **same** case set (every failing `(case, broadPhase, state)` tuple plus R1 and R2 plus the largest verdict-bearing workload), the **same** 5 counterbalanced repetitions, the **same** X-1/X-2/X-3 and §15 metrics, the **same** stage-scoped measured scope (below), and the **same** stub-result-mapping restriction below. This selects *which* bounded measurement runs; it adds no spike infrastructure and no new spike.

**S7′'s measured window is the offloaded stage, not a full query.** For every measured tuple, and in **either** variant, S7′ is a **paired, stage-scoped comparison over identical inputs**: one arm executes the named stage **synchronously on the main thread**, exactly as the library does today; the other snapshots that stage's inputs, transfers them once, executes the stage **in the worker**, and awaits and receives the response. Both arms' `performance.mark` pairs bracket the stage and nothing else — for the worker arm, the snapshot, the transfer, the worker-side execution, the await, and the receipt of the return value are all **inside** the bracket, so the worker arm's own real cost, transfer and serialization overhead included, is what is measured. Both arms run the same 5 counterbalanced repetitions and are measured on X-1/X-2/X-3 and on §15's metrics.

**Everything downstream of the stage is stubbed, in both arms.** The worker's return value is received inside the bracket and then held **inert**: no worker-produced value drives any subsequent query stage, nothing S7′ computes is persisted or published as a result of record, and the arm runs no further query pipeline for measurement purposes. Whatever a downstream stage would have consumed is a **stub result mapping**. S7′ therefore produces **stage-level feasibility and overhead evidence only**.

**What S7′ does not establish, stated so it cannot be over-read.** Because the arms are stage-scoped, their X-1, X-2, and X-3 statistics describe **a stage, never a complete query**, and they cannot be read as the frame cadence or input latency a hypothetical post-boundary configuration would exhibit end to end — moving work also changes task boundaries, message handling, yield placement, and frame opportunities across the *rest* of the query, none of which a stage-scoped measurement observes. **Full-query T-b1/T-b2/T-c sufficiency for the hypothetical post-boundary configuration is not established by M4**: establishing it would require a real integrated worker path executing complete queries, which the prohibition at the end of this section forbids M4 from building. That sufficiency is an **adoption prerequisite** for the implementation milestone (§19.2), on the same footing as full correctness parity. §7.3 condition 3 records that deferral; §7.3 condition 4 states exactly what S7′ *does* establish.

**§6.4's stage-scoped validation of the worker output runs *after* the closing `performance.mark`, never inside the measured comparison.** The synchronous arm performs no such comparison, and element-wise welded-buffer and byte-identical serialized-BVH equality checks are not cheap; validating inside the bracket would charge the worker arm work the synchronous arm never does and could turn a viable boundary into a false D. The order is therefore: execute, receive, close the mark, then validate, sample §15's metrics, and dispose.

**For §15**, the arm counts the retained worker-produced prepared result as the **one** prepared-result copy a real boundary would retain (a real WB-1b path keeps it — `GeometryRegistry` holds welded geometry and acceleration state as persistent registry state). Any value retained purely to serve as the stub result mapping is **harness-only scaffolding**: excluded from the controlling Metric M budget and reported separately as harness overhead, so the arm's steady-state and peak figures stay representative of the boundary rather than of the measurement rig.

This is what makes §7.3 B condition 4's paired comparison, under §7.4.2's effect rule, a comparison of **like measured work**: both arms cover the same stage over the same inputs with the same downstream stub, so the worker arm can come out ahead only because the boundary helped, never because its bracket omits work the synchronous arm's bracket contains.

**Where the failing tuple is R6's `refresh` state**, the arm reproduces §5.2.1's sequence in one world, because the `refresh` query cannot exist without its precursors. Those precursor queries — R6's cold and its warm `P₀` query — are executed as **setup** for the `refresh` measurement and are not themselves S7′ measured samples unless they are independently failing tuples in their own right, in which case they are measured as such under the rules above.

**Deliberately not a spike:** a generic `serialize → postMessage → deserialize` round-trip timing. A persistent worker-cache design is a **one-way population plus repeated compact query messages**, not a round trip per geometry; an artificial round trip would overstate its cost and bias the verdict toward A. S7′ measures the real topology; S6′ measures its repeated-message half.

**Also not permitted for S1′:** a blob-URL worker or a request-interception shim. Both change the worker's base URL and, for blob URLs, its origin inheritance — so they would answer a *different* question than "can this app serve a working module worker," and a pass under either would not license a worker in production. If S1′ fails, the recorded finding is that a build step or relative-path rewrite is a prerequisite, not that a blob worker is an acceptable substitute.

**No spike may build a working worker collision path.** S7′, in **either** variant, is a stage-scoped measurement vertical with a stub result mapping: no worker-produced value ever enters a query, and it produces no result of record. Its entire correctness surface is §6.4's **stage-scoped validity rule**, which compares only the offloaded stage's own outputs over identical inputs. If B or C is reached, building the real path is the *next* milestone's work.

---

## 18. Cache architecture options (Required Decision 10)

| # | Option | Startup cost | Warm-query cost | Memory | Invalidation / eviction | Complexity |
|---|---|---|---|---|---|---|
| **C1** | Main-thread cache only; transfer/copy both operands' buffers **per pair** | none | one message pair per candidate — at R2's 1,978 candidates per source instance almost certainly fatal; **S6′ confirms or refutes** | transient only | trivially correct | lowest |
| **C2** | Worker-owned cache; push welded geometry once per `(epoch, geometryIndex)`; the worker builds its own BVH | one transfer + one BVH build per distinct geometry (1,461 here) | none per pair | worker holds geometry + BVH + connectivity | keyed identically to `GeometryRegistry`; epoch release invalidates both by the same key | moderate |
| **C3** | Fully duplicated caches | as C2 | none per pair | ~2× the collision-world geometry footprint, atop the ~2× already on the main thread | same key, same lifetime — coherent by construction | moderate |
| **C4** | Main thread builds; ships the **serialized** BVH | one transfer per geometry; **no second build** | none per pair | as C2/C3 | as C2 | moderate |
| **C5** | Per-worker caches in a pool | N× | none per pair | N× | N× fan-out | highest |

**Evaluation order:** C1 first (measure it — the only option with no memory cost) → C4 (reuses the main-thread build) → C2 (if S6′/S7′ show serialize+transfer is worse than rebuilding) → C3 only if a main-thread copy is genuinely required alongside a worker copy and C4/C2 cannot provide it → **C5 only on measured evidence of a single-worker bottleneck, and only once concurrent-usage expectations are specified** (§7.5.8), never by default.

C2 and C4 both need the main thread to *keep* the welded geometry (for the `'linear'` oracle and `anyComponentInside`'s direct buffer reads), so both imply **copying**, not transferring, and therefore duplication. Only a design abandoning the main-thread copy avoids duplication, and that breaks the oracle, which §14 forbids.

---

## 19. Correctness gates

### 19.1 Gates M4's own harness enforces

§6.4's canonical comparator is applied to every TLAS-vs-linear pair of runs, plus these case-specific gates:

| Gate | Proof |
|---|---|
| Same final pairs, provenance, distance, witness, statistics, diagnostics | §6.4's comparator in full. Provenance compared by strict `===` `Model` identity, never `modelId`. |
| Same `conclusive` / incomplete-result semantics | The precheck's `excluded` / `proceed` / `inconclusive` / `skip-precheck` distribution must match, and the incompleteness caveat must be computed identically. |
| Same deterministic aggregation | The dbId-level winner (minimum distance, `comparePlacedCanonically` tie-break) must select the same fragment pair, verified by comparing emitted **witness points**, not just the distance. |
| Same placement-change behavior (R6) | `P₁ ≠ P₀` in the specific pre-recorded way §5.2.1's transform was designed to produce, identically under both broad phases; **exactly one** TLAS rebuild attributable to the invalidation (`tlasBuilds` delta = 1); a fresh placement read observed; and `P₀` recovered after reset. **`P₁ == P₀` is a failure.** |

Any failure invalidates the run (`FAILED_VALIDATION`, non-zero exit). **No performance finding may be reported as valid from a run that failed a correctness gate.**

### 19.2 Adoption prerequisites for the implementation milestone (not M4 verdict conditions)

Because §17 forbids M4 from building a working worker collision path, these cannot be proven by M4 and are **not** conditions on a B or C verdict (§1.2). They are the gates the *next* milestone must clear before a worker path is adopted:

- the full §6.4 comparator satisfied between the synchronous oracle and the worker path, across the complete R-case and S-case matrix, with the `1e-9` distance relaxation reported as such;
- **full-query T-b1 / T-b2 / T-c sufficiency for the adopted boundary**, measured end to end on the real (non-stub) integrated worker path once one exists, across the verdict-bearing R-cases and states that failed the baseline. M4's S7′ evidence is **stage-scoped** (§17) and cannot establish this: reconstructing a hypothetical post-boundary configuration's real frame cadence and input latency requires the integrated path §17 forbids M4 from building, and §7.3 condition 3's screen is T-a-only by construction. A B or C verdict therefore asserts that a boundary is *worth building and measuring end to end*, never that the post-boundary configuration has already been shown responsive;
- lifecycle rejection across all eight §10.4 scenarios in the real path, not a stub;
- the same diagnostics multiset, including the inconclusive-cause field if it is ever promoted from the event channel into a public diagnostic;
- the same deterministic aggregation and placement-change behavior.

**The synchronous implementation remains the oracle throughout**, unless M4's evidence proves a specific defect in it — reported and dispositioned separately, never silently absorbed.

---

## 20. Downstream roadmap compatibility

- **Many-object execution.** §8.4's request shape is a pair *list*; nothing assumes one source element.
- **Concurrency.** §10.1 preserves independent settlement for concurrent calls, so a future batch layer is not forced into latest-call-wins.
- **Cancellation.** §11.3 forbids committing to a cancellation API shape that would constrain the result layer's policy, and adds no `AbortSignal`.
- **Progress.** §12.3 measures overhead without adding a progress API or UI.
- **Grouping/filtering-ready result semantics.** The worker never sees dbIds and never aggregates.
- **Stable source/target provenance.** §9 keeps the `Model` reference as the sole authoritative identity and `modelId` out of the boundary.
- **No worker API is hard-coded.** M4 produces a verdict and evidence, not an API.
- **Whole-model source stays post-M4 scope** (§5.3's S3, §7.5.4).

No constraint in roadmap §4 changes and no public contract in roadmap §1 is reopened, so roadmap §8's architecture-change discipline is not triggered.

---

## 21. Non-goals (restated)

No worker implementation. No implementation plan. No Federated Clash Test definitions, Selection A/B, persistent result sets, Group By/filtering UI, Viewer Clash Panel, issue/status workflow, or model-vs-model orchestration. No constant retuning. No UI progress components. No `AbortSignal`. No latest-call-wins semantics. No cross-origin-isolation change. No modification of `server.js` or of `run-gate.mjs` / `run-gate-m2.mjs` / `run-gate-m3.mjs`. No reopening of M1–M3 architecture.

---

## 22. Required review disposition

Two independent reviews were performed via the shared `codex-worker`, and **all** Critical and High findings from both were verified against cited source and fixed in this same pass.

### 22.1 Pre-draft framing review (`codex-advisor`, `high`, request `20260908-233706-38359-16101`)

Corrections applied: span sums are not CPU time and `totalMs` is wall time (→ §3.2, §6.2); responsiveness rather than occupancy decides necessity (→ §6.2's X-1, §7.2); the existing gates' `--single-process` runtime cannot ground a worker decision (→ §3.5, §6.1.5); "the easy worker stage is ~316 ms" was wrong, the vendor worker moves only BVH construction (→ §8.2's WB-1a/WB-1b split, §6.3's classification); placement-revision rejection is armed only for TLAS-consulted epochs (→ §2.2, §10.2, §10.4d); the "all criteria" bias rule was itself unprincipled (→ §7.3, §7.4, §7.5, §7.6); the spike set needed reshaping toward a batched vertical (→ §17), with the cheapest decisive measurement moved into the gate (→ §6.3); no shared harness module should be extracted (→ §16.1); source-instance count is a controlled variable needing density stratification (→ §5.1, §5.4); `estimateMemoryInBytes` covers only the BVH (→ §15); and no product-approved responsiveness target exists (→ §7.2 plus §7.5.1's mandatory-D condition).

### 22.2 Independent spec review of this document (`codex-review`, `spec`, `high`, request `20260908-235835-70456-21195`)

**Findings: 5 Critical, 6 High, 1 Medium.** Each was independently verified against the cited source before being accepted; none was rejected, and all — including the Medium — are fixed above.

- **C1 — B/C were mechanically unreachable.** B/C required parity and full-matrix coverage that only a real implementation could produce, while §17 forbade building one. *Verified* — the earlier §7.3 and §19 did contain exactly that contradiction. *Fixed:* §1.2 defines B/C as *justification* verdicts and moves parity to §19.2's adoption prerequisites; §7.3's B conditions now rest on stage-scoped spike evidence; S7′ was expanded to every failing R-case plus R1/R2 plus the largest verdict-bearing workload; §12.3's progress-overhead experiment was assigned to a new named spike, S8′.
- **C2 — X-1 input latency and X-2 duty cycle were not measurable as specified.** Long Tasks surfaces only tasks above ~50 ms so it cannot yield total task time or duty cycle; script-created events are untrusted, are excluded from Event Timing, and `dispatchEvent` runs handlers synchronously. *Verified* against both specifications and against the spec's own contradictory use of longtask. *Fixed:* §6.2 requires a CDP task timeline for X-1/X-2 and trusted, externally-generated input with Node-side dispatch timestamps, clock correlation, cadence, target, and censored-observation handling, with longtask/LoAF and Event Timing demoted to cross-checks; §7.6.9–10 name both mistakes as loopholes.
- **C3 — the closed instrumentation surface could not produce the required telemetry.** `reportSpan` accepts `(label, ms)` only (`scheduler.js:47-55`), and `classifyHardClashPrecheck` collapses every inconclusive cause into one generic diagnostic (`query/ClearanceHardClashPrecheck.js:29-30`). *Verified* in both files. *Fixed:* §16.4.5 adds one structured, no-op `reportDiagnosticEvent(kind, payload)` recorder with a bounded schema and an online-aggregation retention rule; §16.4.2 adds an additive inconclusive-cause enum leaving the existing diagnostic string and `conclusive` boolean untouched.
- **C4 — request supersession conflicted with existing concurrent-call behavior.** "Current in-flight id" was undefined; a world-global one would silently supersede earlier calls and strand their promises. *Verified:* `CollisionWorld.js:2591-2599` reasons explicitly about interference from "a DIFFERENT concurrent call" and resolves it by retrying, never by cancelling. *Fixed:* §10.1 defines a per-call `Map<requestId, RequestState>` with independent settlement and states that `requestId` is routing and duplicate protection, never global supersession; §10.2 gives a complete settlement matrix including malformed responses, duplicates, and worker crash/terminate, with "no unsettled promise" as an explicit property; §10.4 gains concurrent out-of-order, duplicate, malformed, and crash scenarios; §21 adds "no latest-call-wins semantics" as a non-goal.
- **C5 — the "mechanical" verdict still depended on undefined judgement.** "Exceeds measurement noise" had no formula; threshold aggregation units, fresh-world identity, and case-order counterbalancing were unspecified. *Verified.* *Fixed:* §7.4.2 defines a precommitted non-parametric effect rule (IQR of the noisier arm plus a 4-of-5 sign test); §7.2 fixes the aggregation unit per threshold (hard maxima require 5/5; percentile statistics use median-across-repetitions with a no-repetition-above-1.5× clause); §6.1.4 defines fresh-world identity as `(runtime, case, broadPhase, repetition)` with explicit cold/warm sequencing; §6.1.6 adds case-order counterbalancing; §6.1.7 fixes observer boundaries.
- **I1 (High) — spike files could not be served.** `server.js` mounts only `wwwroot/` and `/collision`, adding a route was forbidden, and spikes were confined to `spike/m4/`. *Verified* at `server.js:6-8`. *Fixed:* §16.3 permits the harness to start its **own** express instance mounting `spike/m4/` alongside the same paths, changing nothing in `server.js`; §17 additionally forbids blob-URL and request-interception workers for S1′ because they would answer a different question.
- **I2 (High) — S2 could not measure the clearance ceiling it claimed.** It was defined under `volume-overlap` only, with levels in dbId counts. *Verified.* *Fixed:* §5.3's S2 now runs **both** modes with levels in **extracted source instances**, and reports requested dbIds vs. achieved instances.
- **I3 (High) — cohort construction was not deterministic.** Band width, tie rule, undersized-band behavior, the `3076` replacement rule, and the profiling algorithm were unspecified, and the public API exposes no broad-phase-only operation. *Verified.* *Fixed:* §5.4 gives the exact quantile method, band width, tie-break, replacement, minimum-cardinality behavior, and a Viewer-only profiling algorithm touching no `collision/` narrow phase (with its proxy status stated); §5.5 makes the ~10-element workload verdict-bearing only if product-confirmed, and otherwise a §7.5.4 mandatory-D driver.
- **I4 (High) — R6 never changed placement but was required to change the verdict.** `invalidateModelPlacement` only marks placement stale (`:752-760`), so re-reading unchanged matrices cannot change a result; the existing tests mutate placement first (`test/CollisionWorld.findClashes.clearance.test.mjs:370`). *Verified.* *Fixed:* §5.2.1 gives R6 a real, reversible `setPlacementTransform` step with a recorded expected pair change and a reset-and-recover assertion; §19.1's criterion is restated, with `P₁ == P₀` an explicit failure.
- **I5 (High) — correctness comparators were contradictory and incomplete.** §6.4 allowed `1e-9` while §19 demanded bit-identical; witness tolerance was unnamed; the diagnostics key omitted `role` and the singular `fragment`. *Verified* against `CollisionWorld.js:97-107`'s actual diagnostic shape. *Fixed:* §6.4 is now the single canonical comparator — bit-identical distance for TLAS-vs-linear, an explicitly-labelled `1e-9` relaxation for a worker arm only, a scale-relative witness tolerance whose numeric value is printed, and a diagnostics multiset key covering `reason`, `scope`, `role`, and every applicable fragment expanded to `(modelTag, dbId, fragId)`.
- **I6 (High) — memory acceptance was not reproducible.** Per-object sizes, base footprint, peak/retained sampling, GC protocol, and worker isolation were undefined, and a byte lower bound is not comparable with a heap total. *Verified.* *Fixed:* §15 defines two metrics with explicit equations, derives per-record and per-instance sizes empirically rather than guessing, fixes a `--expose-gc` sampling protocol, measures worker heap separately, names **Metric M as controlling**, and §7.5.7 makes unconfirmed multipliers a mandatory-D condition; "proportionate gain" is replaced by the binary §7.4.2 effect condition.
- **I7 (Medium) — claimed mandatory-D inputs were not wired into §7.5.** *Verified.* *Fixed:* §7.5.8 now covers device/browser scope (applying to A, B, and C alike) and concurrency expectations (scoped to pool topologies, since a single-worker topology does not depend on them); §23's claim is restated to match exactly.

The review's four clarifying questions are answered inline: M4 delivers a *justification* verdict, not a binding adoption decision (§1.2); concurrent `findClashes` calls are supported today and §10.1 preserves that; approval of the target, device matrix, realistic selection size, and memory multipliers is required before a B/C verdict is binding and is enforced by §7.5.1/7.5.4/7.5.7/7.5.8; and R6 measures refresh cost **and** correctness after a real transform (§5.2.1).

No re-review was performed after applying these fixes, per this project's review-loop policy. The verdict below reflects this spec-writer's own judgement that the fixes resolve the findings as stated.

---

## 23. Final report

### Adopted workload matrix

Six **declared realistic scenarios** (R1–R6) and four **synthetic sweeps** (S1 density, S2 source-count × density × mode, S3 whole-model-scale, S4 pathological single pair). R1, R2, and R5 correspond exactly to what ships today and are verdict-bearing unconditionally; R3, R4, and R6 use a ~10-instance source and are verdict-bearing **only if that workload is product-confirmed**, otherwise they are synthetic and, if decision-driving, force D (§5.5). R6 applies a **real, reversible `setPlacementTransform`** before invalidating, because invalidation alone cannot change a verdict (§5.2.1), and is the **only** case with a third measured query — the post-invalidation `refresh` state, verdict-bearing like cold and warm (§6.1.4, §7.2). Source-instance count is a **controlled variable**: cohorts are built by an exactly-specified quantile-band algorithm over a Viewer-only proximity proxy touching no collision narrow phase, with band width, tie-break, forced-member replacement, and undersized-band behavior all fixed (§5.4), and every run records the full covariate set. Shipped ceilings — `maxClearanceNarrowPhasePairs` at ~10 dense instances, and `maxBroadPhaseInstancePairs` at 183 source instances as a **per-target-epoch-group** cap against the 5,435-fragment Architecture group — are `CAPACITY_REJECTED` capability boundaries, never trimmed away and never a pass.

### Measurement protocol

`run-gate-m3.mjs`'s reviewed protocol extended by: **two runtime configurations**, with the representative **multi-process** one authoritative; **five counterbalanced repetitions** with both arm order and case order rotated on a recorded schedule; **one fresh world per `(runtime, case, broadPhase, repetition)`** with explicit cold/warm sequencing — plus R6's third, post-invalidation `refresh` query, the one declared exception (§6.1.4) — and per-query observer boundaries; and **three separately-obtained axes** (§6.2) — X-1 responsiveness from a **CDP main-thread task timeline** plus rAF cadence plus **trusted, externally-generated input** with Node-side dispatch timestamps and clock correlation; X-2 duty cycle from that same trace, never from library spans and never from Long Tasks; X-3 makespan with yields measured directly. Scheduler conformance survives as a separate, non-deciding metric taken across *all* checkpoint labels. Thirteen stages are attributed and each classified **main-only vs. transferable** (§6.3) — the gate's cheapest decisive output, produced before any worker spike.

### Decision thresholds

`frameBudgetMs = 8` and M1's **24.8 ms** ceiling are inherited and re-scoped as scheduler conformance. Because **no product-approved responsiveness target exists**, §7.2 declares a provisional one anchored to named conventions — T-a no main-thread task over 50 ms (Long Tasks), T-b1 p95 inter-frame ≤ 32 ms, T-b2 no inter-frame gap over 100 ms, T-c p95 input delay ≤ 100 ms (RAIL Response) — with the **aggregation unit fixed per threshold** (T-a and T-b2 hard maxima requiring 5/5; T-b1/T-c median-across-repetitions with a no-run-above-1.5× clause) and the **evaluation unit** fixed as `(runtime, case, broadPhase, state)` with every state independently verdict-bearing — cold and warm for every case, plus R6's third post-invalidation `refresh` query (§6.1.4, §7.2), reports makespan against Nielsen's 1 s flow limit and the accepted ~440–520 ms status quo, and makes target confirmation a mandatory-D prerequisite. §7.4.2 supplies a precommitted non-parametric effect rule so "beyond noise" is not a judgement call. Memory budgets (1.0×/2.0×) are provisional and their confirmation is likewise a mandatory-D condition.

### Explicit M4 verdict categories

**A**, **B** (which must name its boundary), **C**, **D**. §1.2 fixes what B/C mean: *justification* verdicts authorizing the next milestone, not proofs of parity — parity is an adoption prerequisite (§19.2), which is what makes B and C reachable from bounded spike evidence at all. §7.3 maps evidence to verdict mechanically. The gate is non-leading in both directions: **A** requires every verdict-bearing R-case to meet the target on the representative runtime under every executable arm, and migration difficulty is explicitly not evidence of adequacy; **B/C** require the baseline to *fail*, a named boundary (with S7′'s vertical selected to match it, §17), the main-only remainder passing a **T-a-only** screen under a fixed, pre-registered transferable classification that credits every stage movable under *any* §8.2 variant (§7.3 condition 3, so the screen cannot depend on the verdict it determines), **stage-level** S7′ cost/overhead evidence at **every failing case plus R1/R2 plus the largest verdict-bearing workload** under the effect rule, the memory budget on the controlling metric, and the lifecycle and module-resolution prerequisites. Full-query responsiveness sufficiency for the post-boundary configuration is deliberately **not** an M4 verdict condition — it is an adoption prerequisite (§19.2), like full correctness parity. **D is mandatory** under eight enumerated conditions (§7.5), and is additionally the forced outcome when that screen fails — the **no-boundary** D of §1.1, a decisive negative finding rather than a missing prerequisite. Ten loopholes are named (§7.6).

### Worker-boundary options considered

WB-0; **WB-1a** BVH construction alone (**~43 ms cold, zero warm** — not the 316 ms a naive reading suggests); **WB-1b** full geometry preparation via an extra-copy variant; **WB-2** narrow-phase pair evaluation (the dominant *warm* cost, viable only with a persistent worker-resident cache); **WB-3** the clearance primitive alone (~11% of warm narrow phase); **WB-4** the whole query below extraction; **WB-5** extraction, **ruled out on structure**. §8.1 tabulates what can and cannot cross, including that `MeshBVH.serialize`/`deserialize` are real and ArrayBuffer-based, that `geometry.boundsTree` must be re-attached or `closestPointToGeometry` silently degrades, that transferring detaches the sender's buffer (so keeping the `'linear'` oracle forces copying and hence duplication), that a Viewer `Model` is structurally non-cloneable, that this app has **no bundler** and import maps do not reach a worker realm (§8.6, with blob/interception workarounds explicitly disallowed as substitutes), and that `SharedArrayBuffer` is unavailable without cross-origin isolation the app cannot trivially have (§8.7).

### Lifecycle / identity model

The main thread is the sole identity authority; the worker gets opaque numeric tokens only. **Request state is per-call** — a `Map<requestId, RequestState>` with independent settlement, because concurrent `findClashes` calls are an existing supported scenario the landed code explicitly handles (`CollisionWorld.js:2591-2599`), and a global "current in-flight id" would silently impose latest-call-wins and strand promises. §10.2 gives a complete settlement matrix (dispose, generation mismatch, eviction, armed-epoch placement change, malformed response, duplicate, worker crash/terminate, success) reproducing today's error set and precedence with **no unsettled promise under any condition**, and preserving the **path-specific** placement arming scope so linear callers' behavior is unchanged. §10.4 requires all eight scenarios proven at publication, including concurrent out-of-order responses and worker crash.

### Cancellation / progress feasibility requirements

Today's abort granularity is already one atomic unit, so a worker is parity, not regression; without shared memory a `postMessage` cannot preempt a synchronous traversal in the worker either. M4 decides whether a per-request cancellation token is needed at all, without pre-committing the result layer's policy, and adds no `AbortSignal` and no latest-call-wins. Termination-latency measurement is conditional on the chosen topology. Progress overhead is measured by S8′ — assigned to a named spike precisely because it needs a real worker — with no progress API or UI added. Whether current yielding keeps the UI responsive is **not established by any prior gate** and is answered by X-1.

### Cache / memory evaluation strategy

Five options (§18), cheapest-first, with C5 gated on both a measured single-worker bottleneck and specified concurrency expectations. Memory uses **two metrics**: a deterministic typed-buffer lower bound (Metric M, controlling) with per-record and per-instance sizes derived empirically rather than guessed, and a `--expose-gc`-protocol heap measurement (Metric H, cross-check), with worker heap measured separately and `measureUserAgentSpecificMemory()` recorded as unavailable. Pending-message bytes and abandoned caches are accounted explicitly. Budgets 1.0×/2.0×, provisional, with confirmation a mandatory-D condition and "proportionate gain" replaced by the binary effect rule.

### Benchmark harness plan

One **standalone** `test/performance/run-gate-m4.mjs`; M1/M2/M3 byte-stable; **no shared helper module**. The harness may start its **own** express instance mounting `spike/m4/` alongside the production paths — which is how S1′ gets a same-origin served worker without touching `server.js`. Hard requirements: both runtimes; five counterbalanced repetitions; fresh world per tuple; real fixture with S4 the only synthetic case; summarized JSON with online aggregation and bounded top-N; `CAPACITY_REJECTED` with limit and observed value; loud failure on correctness while performance never fails the process; full provenance including cohort covariates, counterbalancing schedule, input-probe clock calibration, and the derived per-object byte sizes; and the main-only/transferable partition as a first-class section. Exactly five instrumentation additions are permitted and enumerated (§16.4) — yield latency, narrow-phase interior labels plus an additive inconclusive-cause enum, an extraction bracket, read-only memory accessors, and one structured no-op diagnostic-event recorder with a bounded schema and retention rule — and nothing else.

### Required spikes

Eight, confined to `spike/m4/`, deleted at close unless adopted, and **ordered**: the main-only/transferable partition comes from the *gate* first. **S1′** module resolution and CSP in a worker realm, same-origin served, both runtimes, with blob/interception substitutes forbidden; **S3′** worker cold-start latency; **S4′** per-call stale-result rejection across eight publication-time scenarios; **S5′** (conditional) terminate latency and post-termination rebuild; **S6′** (conditional) per-message overhead including result volume; **S7′** (conditional on the baseline failing) the **batched vertical spike** across every failing R-case plus R1/R2 plus the largest verdict-bearing workload, measured as a **stage-scoped paired comparison** — the named stage run synchronously versus the same stage run in the worker over identical inputs, with a stub result mapping downstream in both arms — so the comparison is of like measured work. It yields **stage-level cost and overhead evidence only**; full-query T-b1/T-b2/T-c sufficiency for the post-boundary configuration is **not established by M4** and is an adoption prerequisite (§19.2). **S8′** (same gate) progress-messaging overhead. A generic serialize→transfer→deserialize round-trip is deliberately *not* a spike. No spike may build a working worker collision path.

### Correctness gates

§6.4's single canonical comparator — pair set, bit-identical distance (with an explicitly-labelled `1e-9` relaxation for a worker arm only), scale-relative witness tolerance, six statistics fields, and a diagnostics multiset keyed on the complete public payload including `role` and every fragment's `(modelTag, dbId, fragId)` — plus case-specific gates for conclusive semantics, deterministic aggregation, and R6's placement-change behavior where `P₁ == P₀` is a failure. §19.2 separately records the adoption prerequisites the *implementation* milestone must clear, which M4 structurally cannot.

### Remaining open questions

1. **Is the provisional responsiveness target (§7.2) acceptable as the decision criterion?** A product decision. Until confirmed, §7.5.1 makes **D mandatory** — the single most important blocker.
2. **What is the ~1.4 s of unattributed cold cost?** (§3.1, §6.3). If it is `getRenderProxy`/`adaptViewerGeometry`, it is a permanent main-thread floor capping every worker option. Answered by §16.4.3 plus a gate run.
3. **Is a ~10-element selection a real workload?** (§5.5). Nothing in the repository establishes it; the shipped UI gates on one dbId. Determines whether R3/R4/R6 are verdict-bearing or force D.
4. **What production device classes and browsers must the target hold on?** (§7.5.8). A target met only on the development machine is not a met target — this binds A as much as B or C.
5. **Are concurrent `findClashes` calls an expected usage pattern?** They are demonstrably *supported* (which §10.1 preserves), but their expected frequency is unspecified and gates any pool topology (§7.5.8, §18's C5).
6. **How much of the dominant warm cost is geometry resolution vs. the precheck itself, and how much is recoverable by an ordinary synchronous cache?** (§12.4). The largest single determinant of whether a worker is the right remedy.
7. **Can a module worker resolve its imports in this no-bundler app, and does any CSP interfere?** (§8.6). Spike S1′.
8. **Where does `maxClearanceNarrowPhasePairs` actually bind across the three density cohorts?** (§4, §5.3's S2 clearance arms).
9. **The provisional memory multipliers** (§15.3) must be confirmed before a B/C verdict is binding (§7.5.7).

Questions 2, 6, and 8 are measurements this harness produces; 7 is a specified spike; 1, 3, 4, 5, and 9 are **external inputs** M4 requires and cannot manufacture — each wired into §7.5's mandatory-D conditions rather than assumed.

### Which of the four outcomes does this spec land on?

**None, deliberately.** M4's verdict is an output of running the gate. Two provisional readings are recorded, clearly marked as such:

- **On current evidence the defensible provisional outcome is D** — because the decisive measurements are missing (no responsiveness measurement of any kind exists; the precheck's duration is inferred and its inconclusive causes are collapsed into one; ~1.4 s of cold cost is unattributed; every archived number comes from a `--single-process` runtime and a single source instance; and no responsiveness target, device matrix, or realistic-selection-size decision exists) — **not** because worker migration looks difficult. §7.5 turns each gap into a mandatory-D condition rather than a judgement call.
- **The framing that motivated this milestone is probably not where the decision turns.** The "6.1–6.5 ms against 8 ms" story concerns a primitive accounting for ~11% of warm narrow-phase cost, measured on the wrong metric (the worst *bracketed* span in the same runs was 12.2 ms) in a non-representative runtime, and it is a *scheduler-conformance* question, not a responsiveness one.

**Verdict: ready for implementation planning.**

The gate is fully specified: realistic scenarios separated from synthetic sweeps with a deterministic cohort algorithm and an explicit workload-validity condition; a protocol with two runtimes, counterbalanced repetitions, fresh-world identity, and three separately-obtained axes using measurement mechanisms that actually work; a mandatory main-only/transferable partition; inherited conventions re-scoped correctly plus a precommitted target with fixed aggregation units and a precommitted effect rule; a mechanical evidence→verdict mapping with symmetric anti-bias rules, eight mandatory-D conditions, and ten named loopholes; a corrected worker-boundary analysis with its structural blockers identified; a per-call lifecycle model preserving both concurrent-call independence and path-specific placement arming, with a complete settlement matrix; cancellation and progress requirements that add no API; a two-metric memory strategy with explicit equations and a GC protocol; a standalone harness plan with a closed five-item instrumentation list including one bounded structured event channel; eight ordered and conditionally-gated spikes; and a single canonical correctness comparator with adoption prerequisites separated from verdict conditions.

Of the nine open questions, four are measurements this harness produces or spikes it specifies. The other five are **external inputs**, each explicitly wired into §7.5 as a mandatory-D condition — so a missing input produces a correct verdict of D rather than an unsound verdict of A, B, or C. An M4 implementation plan can be written directly from this document, and the gate it describes cannot silently reach a conclusion it has not earned.
