# Architecture whole-model self-clash — offline performance investigation (H1)

- **Date:** 2026-10-07
- **Trigger:** H1 of [`docs/reviews/2026-10-07-d-v6-architecture-self-clash-targeted-independent-work-review.md`](../reviews/2026-10-07-d-v6-architecture-self-clash-targeted-independent-work-review.md) (Architecture self-clash: 18:04 elapsed, 67%, 80/4,294 units, 3,415 results, 35,225 diagnostics, user-stopped).
- **Owner authorization (bounded):** treat the runtime as a blocking product-performance defect; profile offline only; no fix, no live/headed run, no browser, no APS network; no change to collision semantics, thresholds, result semantics or acceptance expectations.
- **Repository state measured:** branch `main`, HEAD `dcdab38`, **dirty working tree** (uncommitted `clashtest/viewer/ViewerElementEnumerator.js`, README/spec/plan edits by the concurrent D-V6 package; none of them touch the paths profiled here except the enumerator's `resolveWhole` null-geometry branch, which the per-unit bracket does not call). No repository file other than this report was written; all harnesses live in the session scratchpad and import repo modules read-only.
- **Status:** investigation complete; **no remediation implemented**. Next action: owner disposition of §9 (awaiting owner authorization).

## 1. Scope and evidence used

| Evidence | What it gives |
| --- | --- |
| `docs/research/evidence/2026-10-07-d-v6-headed/Architecture-vs-self-in-progress.png` | `67% units 80/4294 found 3415 caveats 35225 18:04`, Hard, A = Audubon_Architecture, B = "Same as Set A" |
| `.../Architecture-vs-self-after-stop.png` | `Stopped`, `cancel-requested`, `Coverage: partial`, `4213 parts could not be evaluated`, `Diagnostics: 35225`, "Diagnostic detail was truncated" |
| `.../Architecture-vs-Structure.png` | Hard Architecture × Structure **completed**, 2,277 clashes, 6,836 diagnostics, started 10:03:29.711Z, finished 10:10:25.611Z (**415.9 s**) |
| `.../Architecture-vs-Mechanical.png` | Hard Architecture × Mechanical completed, 1,211 clashes, 5,438 diagnostics (no timing visible) |
| `.../console-warnings-errors.txt` | only `getInstanceTree` deprecation warnings and two token-refresh failures; nothing performance-related |
| `docs/research/evidence/2026-09-29-g1-svf2-fixture-capacity-screening-result.json` | SVF2 fragment counts: Architecture 5,435, Mechanical 1,496 (1,257 roots), Structure 543 (468 roots) |
| `docs/research/2026-09-26-federated-clash-test-oq4-live-evidence-check.md:503` | SVF Architecture: 5,435 fragments, 4,244 whole-model roots, max 14 fragments/root, 4,747 tree nodes |
| `test/fixtures/svf2-audubon-fragment-matrices.json` | the **real** SVF2 world matrices of all 5,435 Architecture and 543 Structure fragments (SVF2 meshes are normalized to the unit cube) |

Offline harnesses (scratchpad, reproduced verbatim in §11): **M1** real planner (`decompose.js`/`sizing.js`/`planTables.js`); **M2** the real engine end to end (`createClashTestEngine` → `Run.js` → `LocalUnitExecutor` → production `createViewerElementEnumerator` → real `CollisionWorld`) over a mock Viewer model whose 5,435 fragments are the real Architecture SVF2 matrices applied to the unit cube (each fragment is its real oriented bounding box, 12 triangles); **M2b/M2c** yield attribution and scaling of the production digest path; **M4** the run-level diagnostic aggregator at the live volume.

**Fidelity limits (stated up front).** Offline geometry is box-per-fragment, so narrow-phase cost, result count and diagnostic count are **not** reproduced (offline: 18,245 results / 3,922 diagnostics over a full run vs. live 3,415 / 35,225 after 80 units). The root→fragment assignment of the real model is unknown offline; fragments were assigned to roots in ascending fragId order with the probe's size distribution. The browser's yield latency cannot be measured offline; it is emulated with a 4 ms `setTimeout` and cross-checked against the two live timings (§3.4).

## 2. Code path map (file:line, working tree at `dcdab38`)

| Stage | Location | Relevant behaviour |
| --- | --- | --- |
| Cell 3b decomposition | `clashtest/planning/decompose.js:102-121` | recursive bisection `L → R`, **pre-order DFS**, one CellSpec per internal node: `R − 1` cells for `R` roots |
| Sizing | `clashtest/planning/sizing.js:132-155, 239-266`; defaults `clashtest/options.js:51-55` | source packed to ≤200 fragments / ≤500 roots per unit; target ≤20,000 fragments; sizing only **splits** a cell, never merges cells |
| Unit materialization / bracket expectation | `clashtest/planning/planner.js:191-210` (R20-1 at `:201-203`) | per unit: source `roots` entry, **source whole-population entry** (A is `kind:'model'`), target `roots` entry |
| Executor | `clashtest/execution/LocalUnitExecutor.js:381` | `const ctx = { checkpoint: () => yieldToScheduler() };` — **every** checkpoint call is an unconditional scheduler yield; it never checks a slice budget and never observes cancellation |
| Bracket pre / call / post | `LocalUnitExecutor.js:439`, `:462`, `:475`; `clashtest/planning/scopeDigest.js:214-234` | each bracket digests every `scopeExpect` entry via `enumerator.digestScope` |
| Production digest | `clashtest/viewer/ViewerElementEnumerator.js:16` (`digestSlicer`: `maxItemsPerSlice: CHECK_EVERY` = 64, yield = `ctx.checkpoint`), `:89` entry checkpoint, `:91-94` whole scope (`scanPopulation` + sliced `digestPopulation`), `:96-101` explicit scope (`normalizeExplicit` → full-tree `indexNodeParents`) | |
| Tree index | `clashtest/viewer/treeWalk.js:38-53` (checkpoint every 64 nodes, `:50`); `clashtest/viewer/checkpoint.js:3` `CHECK_EVERY = 64` ("Provisional (G-CAL)") | the explicit-scope digest walks the **whole** instance tree on every call, independent of how many roots it digests |
| Sliced sort | `clashtest/util/slicer.js:75` (yield when `items >= maxItemsPerSlice`), `:94-114` `sortSliced` (one tick per merge step) | with `maxItemsPerSlice = 64`, a population sort yields every 64 merge steps |
| Scheduler | `clashtest/engine.js:512` (`engineYield = yieldToScheduler ?? makeYieldToScheduler('macrotask')`), `clashtest/util/slicer.js:16` (`setTimeout(resolve, 0)`), `wwwroot/extensions/clashPanelHost.js:223` (host passes **no** `yieldToScheduler`) | in the product every executor yield is a chained `setTimeout(0)` |
| Run loop | `clashtest/run/Run.js:515-526` (`interUnitYield` then boundary; cancel observed only here), `:781` (`diagnosticAggregator.snapshot()` after **every** unit), `:1436-1440` (in-flight unit drained, never interrupted) | |
| Aggregator | `clashtest/execution/diagnostics.js:473` (`snapshot()` sorts the full dedup map) | |
| Progress | `clashtest/run/Run.js:46-61` (`fractionProcessed = pairSpaceProcessed / pairSpaceTotal`), `clashpanel/core/viewModel.js:199`, `clashpanel/ui/render/run.js:36-54` (`%`, `units a/b`, `caveats` = `completenessAffectingCount`, `Run.js:782`) | |
| Library | `collision/CollisionWorld.js` `findClashes` (`:1297` ff.), TLAS broad phase `:3047` ff. | per call: extract source + target roots, admit, TLAS query, narrow phase |

## 3. Measurements

### 3.1 Planner (M1) — the plan reproduces the live numbers exactly

`node m1-planner.mjs` (real planner, default options; F = 5,435 fragments, max 14 per root):

| Roots R | units | gaps | 3b cells (R−1) |
| --- | --- | --- | --- |
| 4,244 (SVF probe count) | 4,288 | 0 | 4,243 |
| **4,250** | **4,294** (= live) | 0 | 4,249 |
| 4,260 | 4,304 | 0 | 4,259 |

With R = 4,250 the plan has exactly the live unit count. Cumulative progress in execution order:

| units done | last unit | `fractionProcessed` | Σ target fragments so far |
| --- | --- | --- | --- |
| 1 | 3b.0 | 3.5% | 2,717 |
| 14 | 3b.13 | 50.0% | 38,038 |
| 28 | 3b.27 | 66.6% | 51,132 |
| **80** | 3b.79 | **66.7%** | 51,456 |
| 1,000 | 3b.999 | 68.7% | 56,900 |
| 2,000 | 3b.1999 | 74.9% | 66,310 |
| 3,000 | 3b.2999 | 93.6% | 85,303 |
| 4,294 | 3b.4293 | 100.0% | 95,920 (17.6 × F) |

The live `67% at 80/4,294` is exactly the planner's pre-order position (M2 independently reports `fractionProcessed = 0.66684` at the start of unit 81). 71.5% of units have `pairSpaceWeight ≤ 4`; 2,048 units are single root × single root. Cross-model for comparison: Architecture (A) × Structure (B, whole) plans **28 units**; Architecture × Mechanical also **28** — the target is the whole-model sentinel, so units = source chunks only.

**Scaling (F = 1.28 R):** units 500 → 500, 1,000 → 1,004, 2,000 → 2,015, 4,250 → 4,294, 8,000 → 8,112, 16,000 → 16,276; **units ∝ R^1.005**; Σ target fragments ∝ R^1.693. Planning itself is cheap (8.2 ms at R = 4,250; 33.5 ms at 16,000).

### 3.2 End-to-end engine (M2) — where the time goes

`node m2-engine.mjs self` (yield = `setImmediate`, so yields are near-free and CPU is visible):

| metric | Architecture self (full run) | Architecture × Structure |
| --- | --- | --- |
| units / `findClashes` calls | 4,294 / 4,294 | 28 / 28 |
| status | completed / full | completed / full |
| `digestScope` calls | 25,764 (**6 per unit**) | 168 (6 per unit) |
| scheduler yields (total / inside digest) | 12,113,560 / **12,109,080** | 80,953 / 80,864 |
| yields per unit inside digest | **2,820** | **2,888** |
| wall time in `digestScope` | 234,124 ms | 1,624 ms |
| wall time in `findClashes` | **2,508 ms** | 320 ms |
| total wall | 265,584 ms | 2,288 ms |
| narrow-phase pairs | 32,671 | 5,444 |

Even with near-free yields, **88% of wall time is the per-unit scope bracket and 0.9% is the library**. Per unit: p50 61.2 ms, p99 84.1 ms, max 677.9 ms (unit 1).

Distribution across the plan: the **first 80 units** hold 28,477 of 32,671 narrow-phase pairs (**87%**) and 16,575 of 18,245 results (91%); the remaining **4,214 units** hold 4,194 narrow-phase pairs (13%) but cost 257,786 ms of the 264,724 ms of per-unit wall time (97%). Unit 81 (typical tail unit): 2 source roots × 2 target roots, `findClashes` 0.23 ms, unit wall 57 ms.

### 3.3 Yield attribution (M2b) and scaling (M2c)

`node m2b-digest-yields.mjs` — checkpoint calls of **one** production `digestScope` (each is a yield under the executor's ctx), R = 4,250, 4,251 tree nodes:

| scope | yields | dominant site |
| --- | --- | --- |
| explicit, 1 root | 68 | 65 × `indexNodeParents` (`treeWalk.js:50`) — whole-tree pass |
| explicit, 165 roots | 68 | same |
| explicit, 2,125 roots | 68 | same |
| whole (population, 5,435 fragments) | **1,274** | 1,104 × `sortSliced` (`slicer.js:107`) under `maxItemsPerSlice: 64`; 84 × encode; 83 × `scanPopulation` |

Per self-clash unit: 2 brackets × (68 source roots + **1,274 source population (R20-1)** + 68 target roots) = **2,820** — exactly the M2 measurement. Per Architecture × Structure unit: 2 × (68 + 1,274 + 103) ≈ 2,890 (measured 2,888). The source-population digest is **90%** of the yields; it is identical in both scenarios. The explicit-scope cost is independent of the number of roots digested.

`node m2c-scaling.mjs` (per-unit yields × planned units):

| R | F | per-unit yields | units | total yields | hours at 4 ms/yield |
| --- | --- | --- | --- | --- | --- |
| 500 | 639 | 274 | 500 | 137,000 | 0.15 |
| 1,000 | 1,279 | 586 | 1,004 | 588,344 | 0.65 |
| 2,000 | 2,558 | 1,250 | 2,015 | 2,518,750 | 2.80 |
| **4,250** | **5,435** | **2,820** | **4,294** | **12,109,080** | **13.45** |
| 8,000 | 10,230 | 5,624 | 8,112 | 45,621,888 | 50.69 |
| 12,000 | 15,346 | 8,430 | 12,207 | 102,905,010 | 114.34 |

Log-log fit vs R: per-unit yields **R^1.08**, units **R^1.005**, total yields **R^2.09** — the self-clash bracket overhead is **quadratic in model size**, with a constant set by the per-yield latency.

### 3.4 Per-yield latency — reconciling with the two live timings

The product's yield is a chained `setTimeout(0)` (`engine.js:512`, `slicer.js:16`, no host override at `clashPanelHost.js:223`). Under the HTML timer rules a `setTimeout` scheduled from within a timer task nested more than 5 deep is clamped to **≥ 4 ms**; a promise continuation of a timer callback that schedules the next `setTimeout` is such a nesting. (Inferred applicability; not measured in a browser — no browser was run.)

| | yields (measured offline) | live wall | implied time per yield |
| --- | --- | --- | --- |
| Architecture × Structure, full run | 80,953 | 415.9 s | **5.14 ms** |
| Architecture self, first 80 units | 80 × 2,820 = 225,600 (M2 cancel-at-80 run: 225,600 digest yields, exact) | 18:04 = 1,084 s | **4.80 ms** |

Both live runs are explained by **≈ 4.8–5.1 ms per executor yield**, i.e. the 4 ms clamp plus a small amount of real work. Emulation: `YIELD=timeout4 node m2-engine.mjs cross-struct` (every yield = `setTimeout(4)`, box geometry) completes in **325.4 s** (live 415.9 s; the ≈ 90 s gap is consistent with real-mesh narrow phase, which the boxes cannot reproduce). `YIELD=timeout4 node m2-engine.mjs self-cancel 80` (first 80 self-clash units, then Stop): **908.6 s = 15:09** to the stop point (live 18:04; 904.4 s of it inside `digestScope`, 1.95 s inside `findClashes`), cancel → sealed 1,126 ms, sealed `cancelled` / `partial` / `cancel-requested`, 4,294 unit records. The ≈ 175 s gap to the live time is again consistent with real-mesh narrow phase over the 87%-of-pairs head of the plan.

### 3.5 Diagnostic bookkeeping (M4)

`node m4-diag.mjs` (real `createDiagnosticAggregator`, default `maxRetainedDiagnostics` 10,000; `snapshot()` after every unit as `Run.js:781` does):

| shape | units × per unit | total | retained | Σ addUnit | Σ snapshot | last snapshot |
| --- | --- | --- | --- | --- | --- | --- |
| distinct pair diagnostics | 80 × 440 | 35,200 | 10,000 (truncated) | 29 ms | **439 ms** | 10.5 ms |
| repeating fragment diagnostics | 80 × 440 | 35,200 | 3,000 | 17 ms | 36 ms | 0.8 ms |
| distinct pair diagnostics, full-run unit count | 4,294 × 8 | 34,352 | 10,000 (truncated) | 64 ms | **23,116 ms** | 10.6 ms |

## 4. Duplicate-evaluation analysis

**No duplicate pair evaluation exists in the plan.** `m1-planner.mjs` enumerates every (source root, target root) of every unit and checks unordered uniqueness: R = 7, 64, 300, 1,000 → distinct pairs = R(R−1)/2 exactly, **0 duplicates, 0 reversed (b,a) re-evaluations, 0 self-pairs**; Σ `pairSpaceWeight` at R = 4,250 = 9,029,125 = R(R−1)/2. The plan is unordered (`ordered: false` for Hard; `decompose.js:113-118` emits `R → L` only for containment). A fragment pair cannot be evaluated in two units because roots are subtree-disjoint (`planTables.js:84-96`) and every unit pair is a disjoint `L × R` product. M2 confirms at the library level: `narrowPhasePairs` = `broadPhasePairs` = 32,671 for the whole run with no unit splits.

What *is* repeated is **per-unit fixed work over the same model**: the source-model population digest is recomputed twice per unit (8,588 times for one run over the same 5,435 fragments), and every explicit-scope digest re-indexes the whole tree (17,176 full-tree passes per run). That repetition, not pair duplication, is the cost.

## 5. Diagnostic bookkeeping cost

- **What the 35,225 are.** `caveats` in the progress line is `completenessAffectingCount` (`Run.js:782`), which excludes `witness-unavailable` and `fragment-null-geometry` (`diagnostics.js:63`); the after-stop `Diagnostics: 35225` is `diagnostics.total` (`viewModel.js:270-271`). Equal values mean **every** diagnostic in the partial run was completeness-affecting. Their reasons are not in the retained evidence (no copied diagnostics JSON); offline box geometry produces almost none (3,922 over a full run), so the reason mix is **unmeasured**. By the library's reason table (`diagnostics.js:70-79`), the candidates for a dense same-model contact set are pair-scope narrow-phase reasons (`inconclusive-crossing`, `crossing-budget-exhausted`, `inconclusive-containment`, `unverified-*`) — inferred, not established.
- **Retention/dedup/sort complexity.** `addUnit` is O(per-unit diagnostics) with a Map dedup (`diagnostics.js:403-466`). `snapshot()` sorts the full dedup map with an allocating comparator (`:371-387, :473`) and `Run.js:781` calls it after **every** unit only to read `completenessAffectingCount`. This is O(U · D log D) over a run. Measured: 0.44 s for the live 80-unit volume (negligible against 18 minutes) but 23.1 s over a 4,294-unit run with 34k distinct diagnostics. **Secondary inefficiency, not the dominant cost**; it is synchronous (no yield inside `snapshot()`), ≈ 10.6 ms per unit once the retention cap is reached.

## 6. Stop responsiveness

- **Mechanism (code).** Cancel sets `cancelRequested` and transitions to `cancelling` (`Run.js:1442-1471`); it is observed **only at the unit boundary** (`Run.js:515-527`). The in-flight unit is drained, never interrupted (`Run.js:1436-1440`). The executor's checkpoint does not observe cancellation (`LocalUnitExecutor.js:381`), unlike the planning-time `enumerationCheckpoint` (`Run.js:1107-1113`).
- **Measured offline.** `node m2-engine.mjs self-cancel 80` (cancel issued as unit 80 settled): status `cancelled`, `coverage: partial`, reason `cancel-requested`, 4,294 unit records, **cancel → sealed 863 ms** (seal of 16,575 results and 4,214 `not-run` records; setImmediate yields). No library call was started after the request (`findClashes` calls = 80). With 4 ms yields: cancel → sealed **1,126 ms**.
- **Inferred product latency.** Worst case = remaining yields of the in-flight unit × per-yield latency + seal: ≈ 2,820 × 4.8 ms ≈ **13.5 s** for any self-clash unit (or ≈ 15 s for an Architecture × Structure unit), plus the seal. The seal's browser cost is not measured.

## 7. Progress semantics

- `%` is `pairSpaceProcessed / pairSpaceTotal` (`Run.js:61`), where a unit's weight is |source roots| × |target roots| (`sizing.js:86-88`). For cell 3b the pre-order bisection front-loads weight: the top cell (14 units) is 50%, the left spine reaches 66.6% after 28 units (0.65% of units), and the remaining 4,214 units carry 33.3% (§3.1).
- Time per unit is roughly **constant** (≈ 2,820 yields each, §3.3), so time tracks the unit counter, not the percentage. At the live stop point: 67% of pair space, **1.9% of units**, and by the yield floor ≈ 15 of ≈ 807 minutes (13.45 h) of a full run.
- **The `67%` is arithmetically correct for its definition but misleading as a completion/ETA signal** for same-model runs; `units 80/4294` was the accurate indicator. For cross-model runs (28 near-equal units) the two agree.

## 8. Dominant cost — conclusion

**Dominant cost: the per-unit input-scope bracket (spec §16.3.2) executed through an executor checkpoint that yields to the scheduler on every call, multiplied by cell-3b's R−1 unit count.** Each self-clash unit performs 6 `digestScope` calls and **2,820 scheduler yields**, 90% of them in the R20-1 whole-population digest of the (unchanging) source model, whose sliced sort yields every 64 merge steps. In the product each yield is a clamped `setTimeout(0)` (≈ 4.8–5.1 ms implied by both live runs), so the run has a **yield floor of ≈ 13.5 seconds per unit and ≈ 13.45 hours for the whole Architecture self-clash**, growing ∝ R^2.09. Collision work is not the bottleneck: offline it is 0.9% of wall time, and the first 80 units already hold 87% of all narrow-phase pairs.

It is not specific to self-clash: Architecture × Structure pays the same ≈ 2,890 yields per unit (415.9 s live = 80,953 yields × 5.14 ms). Self-clash is slow because cell 3b turns 5,435 fragments into 4,294 units instead of 28.

**Confidence: high** that the yield floor dominates the full run: it reproduces the live unit count, the live `67%`, and, with a 4 ms emulated yield, both live wall times to within 16–22% (909 s vs 1,084 s; 325 s vs 416 s), the shortfall consistent with real-mesh narrow phase that box geometry omits. **Medium** for the exact browser per-yield latency (inferred from the HTML timer clamp and back-solved from the live runs, not measured in a browser) and for the residual ≈ 180 s of the live 80-unit time (attributed to real-mesh narrow phase; offline cannot reproduce it).

## 9. Minimum remediation options

None implemented. Effects are estimates from the measurements above unless marked otherwise.

| # | Option | Expected effect | Contract touched | Protected? |
| --- | --- | --- | --- | --- |
| A | Make the executor's `EnumerationContext.checkpoint` (`LocalUnitExecutor.js:381`) **time-sliced**: yield only when `sliceBudgetMs` has elapsed (as the planning `enumerationCheckpoint` already does through the run slicer, `Run.js:1107-1113`) | yields/unit drop from 2,820 to ≈ CPU time / 4 ms; offline CPU in the bracket is ≈ 35–55 ms/unit, so ≈ 10–15 yields/unit; full Architecture self-clash from ≈ 13.5 h to roughly **minutes** (inferred: 4,294 × ~50–60 ms ≈ 4–5 min + library + inter-unit yield). Digest bytes unchanged; same scopes bracketed | Core P4 executor implementation; spec §6.2 (line 336) requires `checkpoint()` "at least once per slice" — a time-sliced checkpoint satisfies it | **Not protected** (implementation; needs targeted tests + G-CAL-style re-measure) |
| B | In the Viewer adapter, stop forcing a yield every 64 items: `digestSlicer` `maxItemsPerSlice: CHECK_EVERY` (`ViewerElementEnumerator.js:16`) → the engine's `aggregationSliceMaxItems`/time budget | removes the 1,104 sort yields per population digest (−78% of per-unit yields) even without A | Adapter implementation; `CHECK_EVERY` is "Provisional (G-CAL)" (`checkpoint.js:2`) | **Not protected** |
| C | Host passes an unclamped `yieldToScheduler` (e.g. a `MessageChannel` macrotask) at `clashPanelHost.js:223` | per-yield latency from ≈ 4–5 ms to sub-ms; does not reduce yield count (12.1M); inferred ≈ 10× or more | Host wiring (`createClashTestEngine` already accepts `yieldToScheduler`, `engine.js:482`) | **Not protected**; weaker than A/B, a stopgap |
| D | Read `completenessAffectingCount` without a full `snapshot()` per unit (`Run.js:781`, `diagnostics.js:473`) | removes O(U·D log D): −23 s over a 4,294-unit run (M4); negligible at the live 80-unit stop | Core P5/P6 internal | **Not protected**; secondary |
| E | Panel progress for same-model runs: show units-based progress or a determinate/indeterminate distinction | removes the misleading `67%`; no speed effect | Panel design (`docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`) | Product/UI decision — **owner decision**, not a Core contract |
| F | Bracket the source whole-population digest **once per run/generation** instead of per unit (or only when the placement/binding generation changed) | removes ≈ 90% of per-unit digest work | Spec §16.3.2 R20-1 bracket protocol (frozen Core) | **REQUIRES OWNER AUTHORIZATION** |
| G | Cache the explicit-scope tree parent index across `digestScope` calls | removes ≈ 4 × 66 yields and 4 full-tree passes per unit | Spec §6.2 / adapter "every call re-reads the LIVE model (never cached)" (`ViewerElementEnumerator.js:2-3`), D-V4/D-V9 | **REQUIRES OWNER AUTHORIZATION** |
| H | Cancel-aware executor checkpoint (throw on cancel mid-bracket) | Stop latency bounded by one slice instead of one unit | §10.1 "in-flight unit is drained, never interrupted", §16.7 settlement of an interrupted unit | **REQUIRES OWNER AUTHORIZATION**; largely unnecessary if A lands (a unit then takes ~tens of ms) |
| I | Coarser same-model decomposition (OQ-5 block-triangular) so leaf cells are packed instead of R−1 units | units ≈ R^1 → O(F / source cap); multiplies the benefit of A | Spec §6.3 cell 3b, AC-2; the library's F2 source self-exclusion forbids a unit with source = target | **REQUIRES OWNER AUTHORIZATION** (Core/planner change) |
| J | Narrow/defer/disable whole-model self-clash in v1 | removes the workflow | Panel design §220/§297 | **Owner product decision** (review H1 option 2) |

**Minimum set:** A (or A + B) alone is predicted to remove the dominant cost without touching any protected contract, collision semantics, thresholds, result semantics or acceptance expectations. D is a cheap secondary. Everything in F–I needs owner authorization and is not required to remove the measured bottleneck.

## 10. Unmeasured — needs a live run (not run here)

1. The browser per-yield latency of the product scheduler (inferred 4.8–5.1 ms; the HTML clamp is inferred, not observed), and whether rendering/rAF contention or background-tab throttling changes it.
2. Real-mesh narrow-phase cost of the Architecture self-clash (≈ 180 s residual of the live 80-unit time, inferred) and the reason mix of the 35,225 diagnostics (not retained in evidence).
3. The SVF2 Architecture root count: inferred 4,250 from the plan reproducing 4,294 units; the SVF probe has 4,244.
4. Browser seal time after Stop with 4,213 `not-run` units (offline 863 ms with fast yields, 1,126 ms with 4 ms yields).
5. Post-fix envelope: any option in §9 needs a measured live Architecture self-clash before an owner-accepted product envelope can be claimed (review H1 option 1).

## 11. Reproduction commands

All scripts are in the session scratchpad (`/private/tmp/claude-501/-Users-kangea-Workspace-Codes-aps-viewer-clash-detection/b2fa9ff2-f23c-4b38-b8c2-c7a52a35d417/scratchpad/`) and import repo modules by absolute path from `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`. Node v22.23.1, darwin. Run from the scratchpad directory:

```sh
node m1-planner.mjs                         # §3.1, §4: unit count/order/progress, coverage-exactly-once, scaling fit
node m2-engine.mjs self                     # §3.2: full real-engine self-clash, setImmediate yields (~4.5 min)
node m2-engine.mjs cross-struct             # §3.2: Architecture x Structure
YIELD=timeout4 node m2-engine.mjs cross-struct   # §3.4: 4 ms yield emulation (~5.5 min)
node m2-engine.mjs self-cancel 80           # §6: cancel after unit 80, cancel->seal latency
YIELD=timeout4 node m2-engine.mjs self-cancel 80 # §3.4: first 80 units with 4 ms yields
node m2b-digest-yields.mjs                  # §3.3: yield attribution of one digestScope call
node m2c-scaling.mjs                        # §3.3: per-unit/total yields vs model size, fit
node m4-diag.mjs                            # §3.5/§5: diagnostic aggregator cost
```

Raw outputs: `m1.out`, `m2-self.log` + `m2-self-setImmediate.json` (per-unit records), `m2-cross-struct-setImmediate.json`, `m2-cross-t4.log`, `m2-self-cancel-t4.log`, `m2b.out`, `m2c.out`, `m4.out` in the same directory. The scratchpad is session-local and not durable; the numbers above are the durable record.
