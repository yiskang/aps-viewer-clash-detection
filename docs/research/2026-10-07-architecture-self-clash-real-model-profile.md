# Architecture whole-model self-clash: real-model headed profile

- **Date:** 2026-10-07. Runs at 14:18–14:24 UTC (22:18–22:24 +08:00).
- **Purpose (owner instruction):** check the dominant-cost diagnosis of the offline investigation [`2026-10-07-architecture-self-clash-performance-investigation.md`](2026-10-07-architecture-self-clash-performance-investigation.md) against the exact headed scenario that exposed the defect. The offline report is kept unchanged as supporting evidence.
- **Scope:** profiling only. No Option A/B or any other fix was made. Collision semantics, thresholds and acceptance expectations are unchanged. **No product source file was edited** (§2.2).
- **Status:** measurement complete. Next action: owner disposition of the remediation recommendation (§7). **Awaiting owner authorization.**
- **Evidence:** [`docs/research/evidence/2026-10-07-self-clash-real-profile/`](evidence/2026-10-07-self-clash-real-profile/README.md), with a SHA-256 manifest.

## 1. Environment

| Item | Value |
| --- | --- |
| Repository | branch `main`, HEAD `dcdab38`. The working tree is dirty with the pre-existing D-V6 package edits (`clashtest/viewer/ViewerElementEnumerator.js`, its test, README/spec/plan/handoff/final report), and the browser ran that working tree. These files were not touched (§2.3). |
| Server | `node server.js` (Node v22.23.1) on `localhost:8080`, `.env` present |
| Browser | Playwright MCP Chromium, **headed**, UA `Chrome/154.0.0.0`, macOS 27.0.1, Apple M4 (ANGLE Metal), `hardwareConcurrency` 10, viewport 1202×909, `document.visibilityState = visible` throughout |
| Viewer | APS Viewer **7.124.2**, SVF2 (`model.isOTG() === true`), Architecture model with **5,435 fragments** |
| App mode | Normal app, flag-free URL `http://localhost:8080/#<URN_ARCH>`. The demo/fixture mode was **not** used. URN `URN_ARCH` from `test/acceptance/clash-finder.acceptance.mjs:327` (`Audubon_Architecture_clash_test.rvt`) |
| Scenario | Real Clash Panel: New test → Hard → Set A = `Audubon_Architecture_clash_test` → "Compare Set A against itself (Set B = Set A)" → Run clash test → Stop, all clicked through the real Panel. The Panel showed `Clash test 2 · Hard · A: Audubon_Architecture_clash_test · B: Same as Set A`, `units n/4294`. |

## 2. Procedure

### 2.1 Runs

1. Start the server with `nohup node server.js > "$TMPDIR/server.log" 2>&1 & disown`.
2. **Run F (full profile).** Install `install-profile-full.js` (Playwright `browser_run_code`), reload the normal-app page and wait for the model to load (`isLoadDone` and instance tree present). Open the Clash Panel (`#clash-panel-toolbar-button`) and set up the scenario. Click **Run clash test** at 14:18:21.6Z. Click **Stop** at 14:21:11.8Z, during unit 13 (`3b.11`). **12 units evaluated** (Panel: `4282 parts could not be evaluated`). Window: 175.2 s.
3. **Run L (minimal-instrumentation variant, used to measure overhead).** Close the browser so no init script or route carries over. Install `install-profile-lite.js` and repeat the scenario. Click **Stop** at 14:24:26.6Z, during unit 11 (`3b.10`). **11 units evaluated.** Window: 159.3 s.
4. In both runs, export `window.__CLASH_PROFILE`, the console log and screenshots (in progress and after Stop). Then close the browser and stop the server.

Both runs stayed within the bounded window (≤ 3 min, ≤ 12 units). A full run was never attempted.

### 2.2 Instrumentation: no product-source edits

The marks are defined in `instr-replacements.mjs` as 11 anchored text replacements in three modules:

- `clashtest/execution/LocalUnitExecutor.js`: checkpoint wrapper, per-unit record, pre/post bracket timing, `findClashes` timing and library statistics.
- `clashtest/planning/scopeDigest.js`: time and yield count of each `digestScope` call, keyed by scope kind.
- `clashtest/run/Run.js`: unit wall time, `interUnitYield`, per-unit `diagnosticAggregator.snapshot()`, `requestCancel` entry, and seal start/end.

**These replacements were applied only in the browser.** A Playwright `page.route` rewrote the served module text, so the files on disk were never modified. `instrumentation.patch` is the unified diff of exactly what the browser ran. Every mark is a no-op unless `globalThis.__CLASH_PROFILE` exists, and that object is created only by the Playwright init script. Without the route and init script the product is byte-identical.

The init script for run F also:

- wraps `window.setTimeout` to build a page-wide 0-delay timer latency histogram;
- adds a capture-phase click listener and a `MutationObserver` that timestamp the Stop click and the moment the Panel shows "Stopped".

Run L keeps only the yield **count**, the phase timers and the stop marks. It drops the per-yield latency promise, the `setTimeout` wrapper and the per-digest records.

### 2.3 Repository state verification

- `git diff` of all tracked files before and after is byte-identical (`cmp`).
- `git diff clashtest/viewer/ViewerElementEnumerator.js` is byte-identical to the pre-run snapshot. This is the D-V6 diff, which was never touched.
- `git status --short` matches the start state, except for the two new untracked paths this package adds (this report and its evidence directory).
- No offline test was modified or run.

## 3. Measurements

All numbers are from `analyze.mjs` → `summary.json` and come from run F unless stated otherwise.

### 3.1 Per-unit table (run F, all 12 evaluated units)

Column notes:
- Shape `src × tgt`: source root dbIds × target root dbIds. Every unit's `scopeExpect` was `[src roots, whole source population, 2,122 target roots]`.
- Yield wait: the summed latency of that unit's executor yields.
- Library time is the `findClashes` wall time, followed by `statistics.narrowPhaseMs`.

| # | unit | shape src×tgt | yields (pre/post) | pre ms | call ms (narrow) | post ms | unit wall ms | yield wait ms | narrow pairs | pairs | lib diags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 3b.0 | 115×2122 | 2854 (1427/1427) | 6,617 | 813 (789) | 6,859 | 14,307 | 13,313 | 1,734 | 318 | 4,691 |
| 2 | 3b.1 | 155×2122 | 2854 | 7,096 | 901 (882) | 7,155 | 15,162 | 14,087 | 1,533 | 608 | 2,566 |
| 3 | 3b.2 | 196×2122 | 2854 | 7,118 | 156 (137) | 7,153 | 14,429 | 14,121 | 530 | 84 | 1,160 |
| 4 | 3b.3 | 181×2122 | 2854 | 7,100 | 319 (302) | 7,132 | 14,553 | 14,083 | 889 | 334 | 1,432 |
| 5 | 3b.4 | 125×2122 | 2854 | 7,075 | 836 (818) | 7,166 | 15,085 | 14,081 | 954 | 139 | 2,950 |
| 6 | 3b.5 | 123×2122 | 2854 | 7,117 | 484 (464) | 7,134 | 14,738 | 14,094 | 594 | 104 | 1,640 |
| 7 | 3b.6 | 192×2122 | 2854 | 7,090 | 105 (88) | 7,138 | 14,334 | 14,064 | 402 | 29 | 748 |
| 8 | 3b.7 | 161×2122 | 2854 | 7,106 | 154 (135) | 7,127 | 14,388 | 14,090 | 333 | 42 | 778 |
| 9 | 3b.8 | 180×2122 | 2854 | 7,100 | 219 (200) | 7,136 | 14,456 | 14,076 | 649 | 92 | 1,446 |
| 10 | 3b.9 | 126×2122 | 2854 | 7,113 | 296 (277) | 7,127 | 14,537 | 14,101 | 484 | 90 | 1,025 |
| 11 | 3b.10 | 119×2122 | 2854 | 7,104 | 77 (60) | 7,137 | 14,319 | 14,086 | 262 | 18 | 769 |
| 12 | 3b.11 | 100×2122 | 2854 | 7,102 | 50 (33) | 7,145 | 14,298 | 14,126 | 303 | 0 | 1,300 |
| **mean** | | | **2,854** | **7,061** | **367** | **7,117** | **14,550** | **14,027** | | | |

- Library TLAS build: 6–9 ms per call. TLAS query: 0.6–2.1 ms. Broad phase: 13–16 ms.
- After 12 units the Panel showed 1,858 clashes and 20,505 diagnostics.

**Throughput.** Run F: **4.11 units/min** (12 units in 175.2 s). Run L: **4.14 units/min** (11 units in 159.3 s).

### 3.2 Yield count and per-yield latency (run F)

**Count.** Every unit made exactly **2,854** executor checkpoint calls: 1,427 in the pre-bracket and 1,427 in the post-bracket. Every counted call awaited a `setTimeout(0)` macrotask, because the executor's `ctx.checkpoint` calls `yieldToScheduler()` unconditionally. The library's `findClashes` used **0** executor yields.

Yields per `digestScope` call, the same in every unit:

| scope | yields / call | calls / unit | yields / unit | offline (M2b) |
| --- | --- | --- | --- | --- |
| whole source population (R20-1) | **1,274** | 2 | 2,548 (**89.3%**) | 1,274 (90%) |
| explicit source roots (100–196) | 76 | 2 | 152 | 68 |
| explicit target roots (2,122) | 77 | 2 | 154 | 68 |
| **total** | | 6 | **2,854** | 2,820 |

**Per-yield latency**, n = 34,248 yields:

| min | p05 | median | mean | p95 | p99 | max | share ≥ 4 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.0 | 4.2 | **5.0** | **4.92** | 5.4 | 5.7 | 22.1 | **99.77%** |

Histogram:

| < 4 ms | 4–4.5 ms | 4.5–5 ms | 5–6 ms | 6–8 ms | 8–16 ms | 16–50 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | 3,921 | 8,197 | 21,941 | 101 | 1 | 7 |

**Page-wide 0-delay `setTimeout` histogram** (`setTimeout` wrapper): 34,933 zero-delay timers fired in the window. 34,248 of them (98%) are the executor yields above.

| bucket | 0 ms | 1–3 ms | 4 ms | 5 ms | 6–28 ms | ≥ 50 ms |
| --- | --- | --- | --- | --- | --- | --- |
| timers | 106 | 25 | 12,426 | 22,259 | 115 | 2 |

The ≥ 4 ms nested-timer clamp is **observed directly**, not inferred: once a chain is nested, Chrome delays each `setTimeout(0)` by 4–6 ms.

### 3.3 Phase breakdown per unit (run F means)

| phase | ms / unit | share of unit wall |
| --- | --- | --- |
| scope bracket, pre + post (§16.3.2) | **14,179** | **97.45%** |
| …of which waiting in executor yields | 14,027 | 96.4% |
| …of which whole-population digests (2 calls) | 12,615 (6,307 / call) | 86.7% (89.0% of bracket) |
| …of which explicit-roots digests (4 calls) | 1,562 (≈ 390 / call) | 10.7% |
| …bracket time that is not yield waiting | **152** | 1.0% |
| collision library call (`findClashes`) | **367** (range 50–901) | **2.52%** (range 0.3–5.9%) |
| …narrow phase (library statistics) | 349 | 2.4% |
| other in-unit time | ≈ 4 | 0.03% |
| outside the unit: `interUnitYield` | 0.3 (max 0.4) | — |
| outside the unit: `diagnosticAggregator.snapshot()` | 13 → 55, growing with the run (median 44, Σ 448 ms over 12 units) | ≈ 0.3% |

**Containment/topology** time is not exposed separately. The library reports only broad-phase, narrow-phase, TLAS and clearance timers, and containment work is included in `narrowPhaseMs`. The library call as a whole is at most 5.9% of any unit.

**The same digests with no yields.** After the Stop, the engine's read-time freshness pass ran the same production `digestScope` on the same live model. That pass passes either no context or a context whose checkpoint only checks the abort signal and never yields (`clashtest/engine.js:1158-1166`). It recorded:

- whole population: **7.9 ms and 16.0 ms**, against 6,307 ms inside the executor bracket;
- explicit 4,244 roots: **26.5 ms and 26.7 ms**, against ≈ 390 ms in the bracket.

So more than 99.5% of the bracket's whole-population time is scheduler waiting, not digest work.

### 3.4 Stop responsiveness

All timestamps are `performance.now()` deltas inside the page.

| | Run F | Run L |
| --- | --- | --- |
| in-flight unit at the click | `3b.11` (13th unit), 11.57 s in | `3b.10` (11th unit), 8.44 s in |
| click → `requestCancel` (`cancelling` committed) | 0.3 ms | 0.1 ms |
| click → unit boundary (drain of the in-flight unit) | **2.79 s** | **4.92 s** |
| seal (boundary → sealed `cancelled`) | **2.36 s** | **2.35 s** |
| click → Panel shows "Stopped" | **5.15 s** | **7.27 s** |
| sealed state | `cancelled`, coverage partial, `cancel-requested`, 4,282 not evaluated | same, 4,283 not evaluated |

- Stop is acknowledged at once, but `Stopped` appears only after **the remainder of the in-flight unit (0 to ≈ 14.5 s) plus a seal of ≈ 2.35 s**.
- The in-flight unit is drained, never interrupted (§10.1). The executor checkpoint does not observe cancel.
- Worst case ≈ 17 s. Expected value ≈ 7.3 + 2.35 ≈ 9.6 s.
- The Panel showed "Stopped" in the same millisecond as the seal resolved.

### 3.5 Instrumentation overhead

Run F (full marks) against run L (counts plus phase timers only):

| | yields/unit | unit wall ms | units/min |
| --- | --- | --- | --- |
| Run F | 2,854 | 14,550 | 4.11 |
| Run L | 2,854 | 14,438 | 4.14 |
| difference | none | +0.8% | −0.7% |

- Within run L, units 1–9 took 14.3–15.1 s and units 10–11 took 13.3–13.4 s, so run-to-run noise is about ±5%.
- The full profile adds one `.then` microtask and one `performance.now()` per yield, plus the `setTimeout` wrapper. Its overhead is **below the noise (≤ ≈ 1%)**.
- Neither variant changes the yield count.
- The library call (366 ms against 390 ms per unit) is equal within noise.

## 4. Comparison with the offline predictions

| # | Offline claim | Real-model measurement | Verdict |
| --- | --- | --- | --- |
| 1 | Executor `checkpoint` yields to the scheduler on every call (`LocalUnitExecutor.js:381`) | Every one of 34,248 counted calls awaited a macrotask, with no budget check | **CONFIRMED** |
| 2 | ≈ 2,820 yields per self-clash unit | **2,854** in every unit (+1.2%). Whole-population digest is exactly 1,274 as predicted. Explicit-roots digests are 76/77 instead of 68 because the real instance tree is larger than the offline mock's 4,251 nodes. | **CONFIRMED** (minor count correction) |
| 3 | The source whole-population digest (R20-1) is ≈ 90% of yields | 89.3% | **CONFIRMED** |
| 4 | Each yield is a nested `setTimeout(0)` clamped to ≥ 4 ms, ≈ 4.8–5.1 ms per yield (back-solved, not observed) | Median 5.0, mean 4.92, p95 5.4 ms; 99.77% ≥ 4 ms; the page-wide timer histogram shows the 4–5 ms clamp directly | **CONFIRMED** (now measured) |
| 5 | ≈ 13.5 s per unit, set by the yield floor | **14.55 s per unit** (run L 14.44). 14.03 s of it is yield waiting. | **CONFIRMED** (+8%) |
| 6 | Scope bracket ≈ 88% of wall time (offline, near-free yields) | **97.45%** of unit wall with real yields. The whole-population digest is 89% of the bracket. | **CONFIRMED** (more dominant in the browser) |
| 7 | Collision ≈ 1% of wall time (offline, whole run) | **2.5% mean** (0.3–5.9%) over the 12 head units, which carry most of the plan's pair weight. With real meshes the library call takes 50–901 ms, against 29–368 ms offline with box geometry, but it is still minor. Tail units were not measured. | **PARTIAL**: collision is minor (confirmed), but its share in the head units is about 2.5× the offline whole-run figure |
| 8 | Diagnostic `snapshot()` per unit is a negligible secondary cost (≤ 10.6 ms per unit offline) | 13 → 55 ms, growing about linearly over 12 units (≈ 1,600 diagnostics per unit; 20,505 after 12 units). 0.3% of a unit now. | **PARTIAL**: negligible today, but larger and growing faster than offline predicted (see §6) |
| 9 | Stop latency = in-flight unit remainder + seal; worst case ≈ 13.5 s + seal (seal not measured in a browser) | Mechanism confirmed. Measured 5.15 s and 7.27 s click → Stopped. Browser seal ≈ 2.35 s (offline 0.86–1.13 s). Worst case ≈ 14.5 + 2.35 ≈ 17 s. | **CONFIRMED** (seal about 2× the offline estimate) |
| 10 | The SVF2 Architecture root count is 4,250 (inferred from the plan reproducing 4,294 units) | The live explicit whole-model root scopes digest **4,244** roots, and the top-cell target is 2,122 = 4,244 / 2. The 4,294 units come from the real per-root fragment distribution: source chunks of 100–196 roots, against 150–165 offline. | **REFUTED** (the unit count stands; the root-count inference was wrong) |
| 11 | Full run ≈ 13.45 h at 4 ms per yield | At the measured 4.92 ms × 2,854 yields: **≈ 16.9 h** (projection, §5) | **CONFIRMED in kind** (≈ 25% longer) |
| 12 | The live D-V6 time (80 units in 18:04 = 1,084 s) is explained by the yield floor | The measured rate gives 80 × 14.55 ≈ 1,164 s (+7%). Unit 1 matches the head-unit shape. | **CONSISTENT** |

**Conclusion: the dominant-cost diagnosis is CONFIRMED on the real headed scenario.**

- The dominant cost is the per-unit §16.3.2 scope bracket run through an executor checkpoint that yields unconditionally.
- 2,854 clamped `setTimeout(0)` yields at ≈ 4.9 ms give **≈ 14.0 s of pure scheduler waiting per unit**, which is 96.4% of a 14.55 s unit.
- The digest work behind those yields is ≈ 0.15 s, and the collision library is ≈ 0.37 s in the heaviest units.

## 5. Projected benefit of Options A and B

> **These are PROJECTIONS from the measured per-unit numbers, not measurements.** No option was implemented.

Inputs:

- yields per unit Y = 2,854, of which 2 × 1,104 are sort yields (the offline M2b split; the measured whole-population count of 1,274 matches offline exactly);
- latency per yield ℓ = 4.92 ms (measured);
- bracket non-wait time C ≈ 152 ms per unit (measured upper bound; it includes the per-yield promise cost). The no-yield freshness digests suggest ≈ 2 × (8–16 + 2 × 27) ≈ 125–140 ms of actual digest work;
- `sliceBudgetMs` default 4 ms (`clashtest/options.js:86`);
- snapshot ≈ 50 ms per unit and growing (§3.3);
- library time: 367 ms per unit in the head units. Tail units (≈ 4,200 of 4,294, mostly 1–4 roots × 1–4 roots) are not measured; offline they are sub-ms with box geometry, assumed ≤ 10 ms here.

| Scenario | yields per unit | bracket per unit | unit total (tail) | full Architecture self-clash (4,294 units) |
| --- | --- | --- | --- | --- |
| **Current** (measured head; projected tail) | 2,854 | 14.18 s | ≈ 14.2 s | **≈ 16.9 h** |
| **B only**: adapter `digestSlicer` uses the engine time budget instead of `maxItemsPerSlice: 64` | ≈ 2,854 − 2,208 ≈ 646 | 646 × 4.92 + 0.15 ≈ 3.3 s | ≈ 3.4 s | **≈ 4.0 h** (≈ 4.2× faster) |
| **A**: executor checkpoint yields only when `sliceBudgetMs` (4 ms) has elapsed | ≈ C / 4 ms ≈ 30–38 | C + 34 × 4.92 ≈ 0.25–0.33 s | ≈ 0.30–0.40 s (incl. snapshot ≈ 0.05) | **≈ 21–29 min**, plus ≈ 0.5 min for the head units' collision; **≈ 35–50× faster** |
| **A + B** | ≈ A (B removes checkpoint *calls* that A would no longer turn into yields) | ≈ A | ≈ A | ≈ A |

Notes on the projections:

- **Head units under A.** The 12 measured head units would take ≈ 0.3 s bracket + 0.05–0.9 s library ≈ 0.4–1.2 s each, against 14.3–15.2 s today.
- **Stop latency under A.** It would fall to (in-flight unit ≤ ≈ 1 s) + seal ≈ 2.35 s, so **the seal becomes the dominant Stop cost**. Option H (a cancel-aware checkpoint) stays unnecessary.
- **Cross-model runs under A.** Architecture × Structure (28 units, 415.9 s live; offline ≈ 2,888 yields per unit) would drop to roughly the library time plus ≈ 0.3 s per unit, i.e. well under 1 min.
- **Why the A range is wider than offline's "4–5 min".** The real bracket non-wait time (≈ 125–150 ms) is ≈ 2.5× the offline 35–55 ms, and the browser snapshot cost is now included. Both raise the A floor.

## 6. Secondary costs that become visible after A

1. **`diagnosticAggregator.snapshot()` after every unit (`Run.js:781`).** It grew 13 → 55 ms over 12 units as the diagnostics grew to 20.5k, and it is still growing.
   - Today it is 0.3% of a unit.
   - Under A it would be ≈ 15–20% of a tail unit at the observed 55 ms, and more if growth continues. At ≈ 50–100 ms × 4,294 units that is ≈ 4–7 min of the projected A run (projection).
   - Option D (read `completenessAffectingCount` without a full sort) is the cheap follow-up. Its real-scale benefit should be re-measured once A lands.
2. **Seal ≈ 2.35 s after Stop** with ≈ 4,282 not-run units. It is not on the per-unit path, but it sets the post-A Stop latency.
3. **Library real-mesh time in head units**, 50–901 ms per call. This is correct work and is out of scope here.

## 7. Minimum remediation recommendation

Yield behaviour is confirmed as the dominant cost, so the minimum remediation stands as stated offline: **Option A**.

- **What it is.** Make the executor's `EnumerationContext.checkpoint` (`clashtest/execution/LocalUnitExecutor.js:381`) time-sliced against `sliceBudgetMs`, the way the planning-time `enumerationCheckpoint` already is.
- **What it is projected to do.** Remove ≈ 98–99% of per-unit wall time in this scenario (≈ 16.9 h → ≈ 0.4–0.5 h). The digested scopes, digest bytes, bracket protocol, collision semantics, thresholds and results are all unchanged.
- **Option B** is a valid but weaker independent step (≈ 4×). Under A it is redundant for latency, but harmless.
- **Option D** is the recommended follow-up once A has been measured live (§6.1).
- **Verification after a fix.** Re-run this exact profile with the same scripts. Expect yields per unit ≤ ≈ 40 and units/min ≥ ≈ 100. Then do a live end-to-end Architecture self-clash so an owner can accept the product envelope (review H1 option 1).

Nothing in this recommendation is authorized by this report. **Awaiting owner authorization.**

### Protected-contract implications

| Option | Contract touched | Protected? |
| --- | --- | --- |
| A | Core P4 executor implementation. Spec §6.2 requires `checkpoint()` "at least once per slice", and a time-sliced checkpoint satisfies that. No change to §16.3.2, §10.1 or result semantics. | **Not protected** (needs targeted tests and a G-CAL-style re-measure) |
| B | Adapter `digestSlicer` cadence (`ViewerElementEnumerator.js:16`). `CHECK_EVERY` is "Provisional (G-CAL)". | **Not protected**. That file currently carries uncommitted D-V6 edits, so any change must be coordinated with that package. |
| D | Core P5/P6 internal (`Run.js:781`, `diagnostics.js:473`) | **Not protected** |
| F / G / H / I | §16.3.2 R20-1 bracket per unit, the "never cached" live-read rule, the §10.1 drain rule, and cell-3b decomposition | **Requires owner authorization**, and is **not needed** to remove the measured bottleneck |

## 8. Not measured or limits

1. **Tail units** (≈ 4,200 small units after the head) were not reached in the bounded window. Their per-unit cost is projected, not measured. Their bracket yields are the same 2,854 by construction, because the whole-population digest and full-tree indexing do not depend on unit size.
2. **Containment/topology time** cannot be separated from `narrowPhaseMs` without library-internal marks, which were deliberately not added.
3. **Per-yield latency under Option C** (`MessageChannel`) was not measured.
4. **The reason mix of the 20.5k diagnostics** was not captured. Panel "Copy diagnostics" was not used.
5. **One browser and machine** (Chromium 154, Apple M4, visible headed tab). Background-tab throttling, which can push timers to ≥ 1 s, was not tested.
6. **What the Panel showed during the run.** The progress `%` / `units` line was taken from in-progress screenshots and snapshots (`units 11/4294`, `39%`), not from a timed series.

## 9. Reproduction

From the repository root:

```sh
nohup node server.js > "$TMPDIR/server.log" 2>&1 & disown
# Regenerate the install scripts from the replacement table:
node docs/research/evidence/2026-10-07-self-clash-real-profile/build-instr.mjs . "$TMPDIR/realprof"
```

Then, with Playwright MCP:

1. `browser_run_code` with `filename: docs/research/evidence/2026-10-07-self-clash-real-profile/install-profile-full.js` (or `-lite.js`).
2. Open `http://localhost:8080/#<URN_ARCH>` (new page, or reload), wait for the model to load, and open the Panel with `#clash-panel-toolbar-button`.
3. New test → Hard → Set A: Audubon_Architecture_clash_test → "Compare Set A against itself" → Run clash test. After about 10 units, click Stop.
4. `browser_evaluate` `JSON.stringify(window.__CLASH_PROFILE)`, and save it as `profile-*.json`.

Finally, analyse the saved profiles:

```sh
cd docs/research/evidence/2026-10-07-self-clash-real-profile && node analyze.mjs   # writes summary.json
```
