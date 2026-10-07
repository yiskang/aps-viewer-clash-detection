# Architecture whole-model self-clash: Options D and E, and a real-model headed profile

- **Date:** 2026-10-07. Browser runs 15:28–15:38 UTC (23:28–23:38 +08:00).
- **Owner authorization (binding):** (1) the projected ~9–11 min after Option A is **not** acceptable. (2) **Option D** is authorized: remove the cost of taking a full diagnostic snapshot after every unit, **while preserving diagnostic semantics, result integrity, completeness classification and final-run evidence**. (3) **Option E** is authorized: make the Panel's progress reflect completed units instead of the front-loaded pair-space percentage. The change stays in the Panel's presentation and must not touch protected engine or result contracts. (4) Options B, C, F, G, H, I and J are **not** authorized, and none was implemented.
- **Inputs (read-only):** [`2026-10-07-architecture-self-clash-post-option-a-profile.md`](2026-10-07-architecture-self-clash-post-option-a-profile.md) (post-A), [`2026-10-07-architecture-self-clash-real-model-profile.md`](2026-10-07-architecture-self-clash-real-model-profile.md) (pre-A), and [`2026-10-07-architecture-self-clash-performance-investigation.md`](2026-10-07-architecture-self-clash-performance-investigation.md).
- **Status:** D and E are implemented and tested, and the re-profile is complete. **A full Architecture self-clash was measured end to end at about 2.5 min** (post-A projection: about 9.5 min). No further optimization was applied. **Next action: owner disposition. Awaiting owner authorization.**
- **Evidence:** [`docs/research/evidence/2026-10-07-self-clash-post-d-e-profile/`](evidence/2026-10-07-self-clash-post-d-e-profile/README.md), with a SHA-256 manifest.

## 1. Product changes

| File | Change |
| --- | --- |
| `clashtest/execution/diagnostics.js` | Option D. The aggregator gains `counters()`, which returns `{total, completenessAffectingCount, unclassifiedOccurrences}` from the running totals it already keeps. It does not sort or copy the dedup map. It keeps the Σ-invariant guard that `snapshot()` has, recomputed from the same `countsByReason` bucket objects held in a parallel admission-order array. That costs O(maxDistinctReasons) and never O(retained). `assertSigma` is shared with `snapshot()`. `snapshot()` itself is unchanged. |
| `clashtest/run/Run.js` | Option D. The per-unit progress commit (`applyUnitResult`, formerly `diagnosticAggregator.snapshot()` at line 781) reads `counters()`. An injected aggregator that implements only the N20 surface `{addUnit, snapshot}` falls back to the old per-unit `snapshot()` (added after the internal review, §11). It used only two fields, `completenessAffectingCount` → `caveatCount` and `unclassifiedOccurrences` → `caveatUnclassified`, so the values committed are unchanged. The seal still calls the full `snapshot()` once (`buildAndAdmitResultSet`, A11). |
| `clashpanel/core/viewModel.js` | Option E. The running progress `fraction` is now **settled units / total units**, computed as `min(1, (unitsEvaluated + unitsFailedOrSkipped) / unitsTotal)`. It is `null` (indeterminate) while `unitsTotal ≤ 0`. It used to be `RunProgress.fractionProcessed`, the pair-space share. All inputs were already `RunProgress` fields, so no engine field changed. The view-model progress also carries `unitsFailedOrSkipped`. |
| `clashpanel/ui/render/run.js` | Option E. The percentage now names what it measures. The visible text is `N% of units ·` and the bar's `aria-valuetext` is `N% of units processed` (formerly a bare `N%`). The `units X/Y` counter (evaluated/total) is unchanged, except that when units failed or were skipped it appends `(k not evaluated)`, so the % (settled units) and the counter never contradict (added after review, §11). `found`, `caveats` and elapsed time are unchanged. No ETA was added. |

**Why the per-unit snapshot existed.** Run.js read `snapshot()` after every unit only to set two numbers on the progress counters. A snapshot spreads the whole dedup map into an array, sorts it with `compareDiagnosticOrder`, slices it to `maxRetainedDiagnostics`, and copies `countsByReason`. The plans already describe the intended cadence as "`snapshot()` once at seal" (p4/p6 plans, interface-reconciliation N20). D restores that cadence for the full read.

**Unchanged:** collision semantics, thresholds, digests, scope-check (bracket) semantics, decomposition, the executor (Option A as accepted), the `RunProgress` and event schema, the persisted Result Set shape, and diagnostic retention, deduplication, ordering and truncation.

**Local corrections beyond D/E:** none. **Test-support changes:**

- `test/clashtest/support/runFixture.mjs`: the aggregator wrapper forwards `counters()`.
- `test/clashpanel/dom/support/inPageFakes.mjs`: the fake handle's `progress()` takes an optional `pairSpace: {processed, total}`. When it is omitted, the old behavior is unchanged.

## 2. Tests (TDD)

Every behavior test was run red before its change and green after it. Characterization tests (green on both sides) are marked per row.

| File | Tests | Pins | Red before the change |
| --- | --- | --- | --- |
| `test/clashtest/execution/diagnostics.counters.test.mjs` (new) | 8 | 4 seeded streams (300/300/200/400 units: fragment and pair scopes, known, unknown and non-affecting reasons, repeats, null-modelKey operands, whole-array overflow units, `maxDistinctReasons` 3/9/64, `maxRetainedDiagnostics` 5/40/100,000, `maxUnitIdsPerDiagnostic` 0/3). Per-unit `counters()` deep-equals the old per-unit `snapshot()` fields, `addUnit` returns the same `unitTaints`, and the final `snapshot()` is deep- and **byte-identical** (JSON) to an aggregator read with `snapshot()` after every unit, with truncation and omission exercised. Also: `counters()` makes **0** `Array.prototype.sort` / `Map.prototype.values` / `slice` calls at retained sizes 10 and 20,000 (the spy does see `snapshot()`'s calls); 0 Map iterations over 1,000 calls at sizes 100 and 30,000 (cost not O(retained)); the Σ guard still throws; shape `{total, completenessAffectingCount, unclassifiedOccurrences}`. | 8/8 failed (`counters is not a function`) |
| `test/clashtest/run/diagnosticCounters.run.test.mjs` (new) | 7 | Run level, comparing the old and new paths. The same 12-unit run is driven through an aggregator whose `counters()` is derived from a full `snapshot()` (exactly the old read) and through the real one, for **completed, cancelled (Stop after `1.6`) and failing-unit** runs. Every per-unit progress snapshot and the sealed Result Set are identical (deep and byte), with truncation exercised. The full `snapshot()` is called **exactly once per run (at seal)** in all three cases, `counters()` once per settled unit, and final `caveatCount`/`caveatUnclassified` equal the sealed summary. | 3/6 failed (13, 8 and 7 snapshot calls instead of 1). The 3 old-vs-new parity tests were green before and after, as a regression guard should be. Added after review: an aggregator with only the N20 surface (no `counters()`) completes with progress and a sealed set identical to the old path. It failed red (`TypeError` → `failed`) before the fallback. |
| `test/clashtest/execution/diagnosticCounters.e2e.test.mjs` (new) | 2 | End to end: real engine, real `CollisionWorld`, the **production** `createViewerElementEnumerator`, a same-model (cell 3b) run whose units really produce library diagnostics (`geometry-not-yet-available`). Before every unit, the committed `caveatCount`/`caveatUnclassified` equal an independent pre-D replay (fresh aggregator, full `snapshot()` after every settled unit). The sealed `resultSet.diagnostics` is deep- and byte-identical to the replay's final snapshot. Covers completed and stopped mid-run. | A characterization test: it passes on both pre-D and post-D code (see the hashes below). |
| `test/clashtest/engine/runAdmission.test.mjs` | +1 assertion | The engine-built aggregator exposes `counters`. | (assertion added) |
| `test/clashpanel/core/viewModel.test.mjs` | +5 | Settled units / total: 80 / 4,294 → 0.0186, even with `fractionProcessed` = 2/3. Failed or skipped units count. `null` while `unitsTotal` is 0. Clamped at 1. The progress carries `unitsFailedOrSkipped`. A runtime split (10 → 11 units) steps the fraction back from 0.5 to 5/11 and is shown as is, not smoothed. | 4/5 failed; the split test is a characterization and passed both before and after. The existing AC-P3 key-list assertion was **updated** to include `unitsFailedOrSkipped`. |
| `test/clashpanel/core/controller.setupRun.test.mjs` | 1 assertion **changed** | The same view-model progress key list, plus `unitsFailedOrSkipped` (vm shape, not old presentation). | failed before the update |
| `test/clashpanel/dom/composition.dom.mjs` | +1 | Composed Panel (real controller, ViewerBridge and UI over fake ports): engine reports 80/4,294 units with pair space 2/3 → bar `aria-valuenow` `2`, `value` 80/4,294, `2% of units ·`, `units 80/4294`, no `67`. | Failed against the old mapping (showed `67`, `0.666…`), checked by temporarily restoring the old line |
| `test/clashpanel/dom/run.dom.mjs` | 1 assertion **changed** | **This assertion tested the old presentation** (a bare `42%`, line `' 42% units 8/19 …'`). It now expects `42% of units processed` and `' 42% of units · units 8/19 …'`. aria-valuenow/min/max, `value`, the indeterminate case and the no-ETA check are unchanged. | Failed (1/95) before the renderer change. Added: a test that `units 6/10 (2 not evaluated)` appears next to `80% of units` (red before the counter change). |

Apart from the assertions marked **changed** or **updated** above (`run.dom.mjs`, `controller.setupRun.test.mjs`, and the AC-P3 key list in `viewModel.test.mjs`), no existing test changed.

**Pre-D and post-D comparison on the same offline scenario.** `offline-pre-vs-post-d.mjs` (evidence) runs the e2e scenario against a scratch tree holding HEAD `dcdab38`'s `Run.js` and `diagnostics.js` (pre-D), then against the working tree (post-D). For both the completed and the cancelled run, it hashes three things: the sealed Result Set (durations and the random `runId`/`registrySessionId` stripped), `resultSet.diagnostics`, and the per-unit committed progress. All three hashes are **identical**. Completed: Result Set `d88299d7…`, diagnostics `63f63de6…`, progress `07be84e0…`. Cancelled: `339d5d78…`, `b92d7cdf…`, `d6990085…`. Output is in `offline-pre-vs-post-d.txt`.

**Verification (exact):**

| Suite | Result |
| --- | --- |
| `npm run test:offline` | **5,383 total / 5,382 pass / 0 fail / 1 todo** (baseline 5,361/5,360/0/1, plus 22 new: 8 + 7 + 2 + 5). The todo is the pre-existing `KNOWN GAP` aspect-ratio test. |
| `npm run test:clashpanel:dom` | **97/97** (baseline 95, plus 2 new) |
| viewer adapter (`node --test test/clashtest/viewer/*.test.mjs`) | **128/128** |
| focused (`diagnostics.counters`, `diagnosticCounters.run`, `diagnosticCounters.e2e`, `runAdmission`, `viewModel`) | all pass |
| `git diff --check` | clean |

## 3. Environment and procedure

| Item | Value |
| --- | --- |
| Repository | `main`, HEAD `dcdab38`. Dirty tree: the D-V6 and Option A edits already present, plus this package's D/E changes. The browser ran this working tree **before the two post-review edits** (§11): `Run.js` then called `counters()` unconditionally, and the Panel had no `(k not evaluated)` suffix. In production the engine-built aggregator always has `counters()`, so the fallback branch is never taken. No unit failed or was skipped in any run, so the suffix would not have appeared. The measured behavior is therefore that of the final code. |
| Server | `nohup node server.js` (Node v22.23.1) on `localhost:8080`, `.env` present. Stopped at the end. |
| Browser | Playwright MCP Chromium **headed**, Chrome/154.0.0.0, macOS, Apple M4 (ANGLE Metal), `hardwareConcurrency` 10, `visibilityState = visible`, viewport 1202×909 |
| Viewer | APS Viewer 7.124.2, SVF2 (`isOTG() === true`), Architecture 5,435 fragments |
| App | Normal app, flag-free `http://localhost:8080/#<URN_ARCH>` (`Audubon_Architecture_clash_test.rvt`). **No demo or fixture mode, no synthetic fixtures.** |
| Scenario | Real Clash Panel: Set A = `Audubon_Architecture_clash_test`, Hard, "Compare Set A against itself (Set B = Set A)", Run clash test. Stops used a **trusted mouse click on the real Stop button**. |

**Instrumentation.** The method is the same as post-A: gated marks applied **only inside the browser**, by Playwright `page.route` rewriting of the served module text, gated by `window.__CLASH_PROFILE`. No product source was instrumented on disk; `instrumentation.patch` is the exact served diff. Changes from post-A:

- the per-unit `snapshot()` mark became a `counters()` mark;
- new: the seal-time `snapshot()` is timed, with its counts recorded;
- new: `diagnosticAggregator.addUnit` is timed per unit;
- new: a page-wide `PerformanceObserver('longtask')` is installed in the init script.

**The body-wide MutationObserver from the post-A run was not used.** The only MutationObserver is the existing Stop-click observer. It is scoped to the panel, armed only by a Stop click, and disconnected once "Stopped" is shown. Progress was read by Playwright `page.evaluate` polls, not by an in-page observer.

**Runs** (the browser was closed between runs):

| Run | Profile | Window | Units | Purpose |
| --- | --- | --- | --- | --- |
| F | full | 15:28:22.4Z → completed | **4,294 / 4,294 (completed)** | The first 1,000 units projected under 5 min, so the run was allowed to complete **once**, as a measurement. Progress was sampled at head, middle and late. |
| M | lite | 15:36:26Z → Stop at 15:37:26.5Z | 1,707 | Stop in the middle |
| H | lite | 15:37:54.6Z → Stop at 15:37:56.5Z | 2 | Stop during the in-flight head unit `3b.1` |

Run M was meant to stop at unit 1,500. The first Stop attempt failed on a re-rendered button lookup before any click was issued, and the retried click landed at unit 1,707. No click was lost or doubled: `stopClick` was recorded once.

## 4. Measurements: before (post-A) and after (post-D/E)

"Post-A" is the post-A run F (3,034 units, Stop in the tail, `../2026-10-07-self-clash-post-option-a-profile/profile-full.json`). "Post-D/E" is this run F (4,294 units, completed) unless noted. Head = plan units 1–80, tail = units 81 onward. Every number comes from `analyze.mjs` → `summary.json`.

### 4.1 Per-unit and throughput

| Metric | Post-A | Post-D/E |
| --- | --- | --- |
| per-unit diagnostic read | `snapshot()` **mean 100.2 ms**, median 96.7, max 151. Decile means 80.6 → 123.1 (growing). | `counters()` **mean 0.0006 ms**, max 0.1. Decile means flat (0–0.001). |
| Σ per-unit diagnostic read / window | **304.1 s / 372.9 s = 81.6%** | **2.7 ms / 144.3 s ≈ 0.002%** |
| `addUnit` (aggregation, per merged unit) | not separately measured | mean 0.121 ms, median 0.0, p99 4.9, max 17.3. Tail fit slope 5.9·10⁻⁶ ms/unit (**flat**: about 0.03 ms over the whole run). Σ 0.52 s. |
| seal-time full `snapshot()` (once) | not marked | 148.6 ms (completed, 57,130 diagnostics, 10,000 retained); 99.6 ms (M); 15.6 ms (H) |
| gap from unit end to next unit start (tail) | **mean 102.5 ms** (snapshot + 1.4) | **mean 13.85 ms**, median 15.2, p99 16.9 |
| `interUnitYield` (animation-frame aligned, §7.3) | median 0.2 ms | **mean 12.7, median 14.1, max 16.6 ms** (see §6) |
| unit wall, tail | mean 19.09 ms | mean 18.37 ms (median 18.0, p95 19.6) |
| unit wall, head (1–80) | mean 99.1 ms | mean 93.0 ms (max 1,371) |
| bracket (pre + post), tail | mean 18.7 ms | mean 17.99 ms (median 17.8) |
| …whole-population digests, tail | mean 17.0 ms | mean 16.48 ms (**49.1% of the window** across all units) |
| library call (`findClashes`), tail / head | 0.3 / 67.0 ms | 0.31 / 61.6 ms (head max 1,317) |
| scheduler yields per unit | ≈ 5 | mean 4.9 (4–7) |
| **throughput** | **488 units/min** | **1,786 units/min** (×3.66). Run M: 1,731. |
| first unit start → last unit end | 372.9 s for 3,034 units (not completed) | **144.3 s for all 4,294 units** |

### 4.2 Main-thread long tasks (> 50 ms, `PerformanceObserver('longtask')`)

| | Post-A | Post-D/E |
| --- | --- | --- |
| during the unit window | not measured. Each per-unit `snapshot()` was an 80–150 ms synchronous block, so roughly one long task per unit can be inferred but was not observed. | **F: 0 long tasks across 4,294 units.** The 1 task at the window edge (161 ms, starting exactly at the last unit end) is the seal's `snapshot()` (148.6 ms). **M: 0 across 1,707 units.** Per settled unit: 0.037 ms (F). |
| at seal | — | F: 161 ms (seal `snapshot`), then **one 2,473 ms task** starting 1.43 s after the last unit, then a 598 ms task. M: 109 + **2,022 ms** inside the seal window, then 512 ms after "Stopped" was shown. H: **1,177 ms** inside the seal, then 302 ms after it. |
| outside a run | page and model load: 225–228 ms (all runs), 58 ms (M) | |

The seal-time multi-second task is **not** the diagnostic snapshot (100–150 ms). Which seal step it is was not instrumented. The 300–600 ms task after "Stopped"/"Completed" is consistent with the Panel rendering the result list, but that is an inference.

### 4.3 Stop latency and seal (two Stops at different progress points, plus the completed seal)

| | Post-A F (3,034 units) | Post-A L (628) | Post-A S2 (head `3b.1`) | **Post-D/E M (1,707)** | **Post-D/E H (head `3b.1`)** |
| --- | --- | --- | --- | --- | --- |
| in-flight at click | `3b.3033`, 148 ms in (snapshot gap) | `3b.627`, 23.9 ms in | `3b.1`, 259 ms in | `3b.1706` settled 9 ms before the click; the click landed in the inter-unit gap | `3b.1`, 38.8 ms in |
| click → `requestCancel` | 0.2 ms | 0.1 ms | 0.2 ms | **0.3 ms** | **0.2 ms** |
| click → unit boundary (drain) | 1.7 ms | 105 ms | 523 ms | **6.4 ms** | **713.7 ms** (the rest of a 732 ms head unit) |
| seal | 3.60 s | 3.03 s | 1.76 s | **3.18 s** | **1.77 s** |
| click → Panel "Stopped" | 3.60 s | 3.13 s | 2.29 s | **3.19 s** | **2.48 s** |
| sealed | cancelled, partial | same | same | cancelled, partial, 3,786 clashes, 2,587 units not evaluated, "Diagnostic detail was truncated" | cancelled, partial, 926 clashes |

- Drain is still bounded by the remainder of the in-flight unit. In the tail it is now the 13–16 ms inter-unit gap, not a 100–150 ms snapshot. Cancel is still observed only at the unit boundary (H was not authorized).
- **The seal is unchanged in kind and is now the dominant Stop cost** (1.8–3.2 s). Most of it is the single 1.2–2.5 s synchronous task described in §4.2.
- **Completion seal (run F):** the last unit ended at 180,272 ms. `finishedAt` (stamped when the seal builds the set) is 161 ms later, and the 2,473 ms long task ends at 184,178 ms. That gives a completion seal of **about 3.9 s**, inferred from long-task timestamps: no explicit seal-end mark exists on the completion path, because the existing `sealStart` mark sits only on the cancel boundary path.

### 4.4 End-to-end and projection

| | Post-A | Post-D/E |
| --- | --- | --- |
| run click → first unit | 1.66 s | 1.16 s |
| run click → last unit end | projected | **145.5 s (measured)** |
| run click → `finishedAt` | projected | **145.6 s** (engine Started 15:28:22.477Z → Finished 15:30:48.062Z) |
| run click → "Completed" shown | projected **≈ 572 s ≈ 9.5 min (working range 9–11 min)** | **≈ 149.5–150 s ≈ 2.5 min.** Last unit end plus the inferred ≈ 3.9 s seal; the exact moment "Completed" appeared was not marked. |

**Projection from the first 1,000 units (decision rule for letting the run complete), and its check:**

`T ≈ t_lead + T(1..1,000) + (N − 1,000) · w̄_81..1,000`

Here `t_lead` = 1.16 s, `T(1..1,000)` = 37.88 s, `w̄` = 31.89 ms per unit (units 81–1,000, wall plus gap) and `N` = 4,294. That gives **144.1 s**. The measured run click → last unit end is **145.5 s**, an error of −0.9%. The seal adds about 4 s.

**Uncertainty:** one machine, one headed tab in the foreground, one completed run. The tail per-unit cost is very steady (unit wall p95 19.6 ms, gap p99 16.9 ms), so the dominant uncertainty is environmental. That covers other machines, a background tab (animation-frame-aligned yields are throttled there), and a different display refresh rate (see §6). Cross-model runs were not re-measured.

## 5. Equivalence and result integrity (product path)

- **Post-A run F against post-D/E run F, same unit ids** (all **3,034** units post-A evaluated): library `pairs`, `narrowPhasePairs`, `broadPhasePairs`, `tlasPrimitiveCandidatePairs` and `diagnostics` count are **identical for 3,034 / 3,034**. So are the executor's projected `outPairs`/`outDiags` and unit shape, the engine counters at the same boundaries (`pairSpaceProcessed`, `resultsFound`, `caveatCount`), and the bracket proofs and outcome (all `equal`/`equal`/`evaluated`). Post-A's 4,395 clashes at its 3,034-unit Stop matches this run's `resultsFound` at the same boundary.
- **Post-D/E F against M** (1,707 shared units) and **F against H** (2): all of the above identical.
- **Final Result Set, run F (completed), internally consistent:**
  - Coverage full, Integrity caveated, Freshness current.
  - 4,770 clashes = `resultsFound` = Σ per-unit `outPairs` (4,770).
  - Sealed diagnostics: `total` 57,130, `completenessAffectingCount` 57,130, `unclassifiedOccurrences` 0, Σ `countsByReason` 57,130 (8 reasons), retained 10,000 (`truncated: true`, `maxRetainedDiagnostics` default).
  - The last committed `caveatCount` (57,130) equals the sealed `completenessAffectingCount`.
  - All 4,294 units settled `evaluated` with pre `equal` and post `equal`.
- Reason mix (sealed, run F), previously uncaptured: `unverified-parity-operand` 29,281, `non-manifold-component` 16,494, `geometry-aspect-ratio-exceeds-tolerance-model` 3,779, `inconclusive-containment` 3,552, `inconclusive-crossing` 3,075, `unverified-open-component` 919, `crossing-budget-exhausted` 27 (all pair scope), and `geometry-not-yet-available` 3 (fragment scope).
- The profile's `runUnits` mark reads the counters *before* that unit's commit, the same mark position as post-A. M's last boundary shows 40,365 = sealed 40,371 − the 6 diagnostics of its last unit, and H's shows 4,691 = 7,257 − 2,566. Cross-profile counter comparisons are therefore like-for-like.
- **Verdict: no difference found.** Offline, the pre-D and post-D sealed sets are hash-identical (§2). On the real model, every shared unit is identical across post-A and post-D/E runs.

## 6. New dominant cost

Per tail unit, unit wall plus gap is ≈ 32.2 ms. Of that, the whole-population source digests inside the bracket take ≈ 16.5 ms (51%), the animation-frame-aligned `interUnitYield` wait ≈ 12.7 ms (39%), the rest of the bracket ≈ 1.5 ms, the library call ≈ 0.3 ms, and other boundary work ≈ 1.1 ms. Across the whole run window: the bracket is 54.2% (whole-population digest 49.1%), the inter-unit gap 41.2% (`interUnitYield` 37.8%), and the library call 4.3%.

1. **Whole-population source digest in every unit's bracket** (§16.3.2 R20-1), ≈ 16.5 ms × 2 calls per unit, **≈ 49% of the run**. This is CPU work. It is a protected bracket protocol (Option F territory) and was **not changed**.
2. **`interUnitYield: 'animation-frame'`** (run option, §7.3), ≈ 12.7 ms per unit, **≈ 38% of the run**.
   - This wait is not main-thread work: the thread is idle until the next frame.
   - Post-A the wait was hidden (median 0.2 ms), because each 100 ms snapshot made the next frame due at once. D exposed it.
   - Its cost depends on the display refresh rate and on tab visibility. Background tabs throttle animation frames.
   - Changing the option or its default is **not authorized** and was **not done**.
3. **The seal: one synchronous 1.2–2.5 s main-thread block, about 3.9 s in total for a completed run.** This dominates Stop latency (1.8–3.2 s) and adds a visible freeze at the end of every run. The responsible seal step was not instrumented.

**No further optimization was applied, and no further local correction was needed** for D or E to work as designed.

## 7. Progress UX: before and after (Option E)

| | Before (post-A, unchanged since the Panel spec) | After |
| --- | --- | --- |
| bar / `%` | `fractionProcessed` = pair-space processed / total. Front-loaded for cell 3b: **66.7% at unit 80/4,294** (offline §7; this run: 66.69% of pair space at unit 80), 73% at unit 1,618 (post-A screenshot `full-profile-in-progress.png`). | **(evaluated + failed/skipped units) / total units**, labelled `N% of units ·` (aria `N% of units processed`) |
| unit counter | `units X/Y` (`unitsEvaluated/unitsTotal`) | unchanged |
| failed/skipped units | not shown in the counter | `units X/Y (k not evaluated)` when k > 0 (not exercised live: no unit failed) |
| measured agreement (run F) | — | 56 middle and late samples plus 20 head samples: the shown `units X/Y` matched the true settled count in 75/76 samples; one head sample lagged by 1 unit (progress commit timing). The shown % matched round(100·X/4,294) in every sample. |
| examples, shown units % vs pair-space % | — | unit 80: **2%** vs 66.7%; 1,248: 29% vs 73.0%; 2,063: **48%** vs 75.0%; 2,426: 56% vs 91.8%; 3,931: **92%** vs 99.6% |

Because each tail unit costs a near-constant ≈ 32 ms, the units percentage also tracks elapsed time closely: 48% at 1:13, 92% at 2:13, completed at about 2:27. That is an observation, not a claim the Panel makes, and no ETA is shown.

Screenshots: `progress-head.png` (unit 48, "1% of units"), `progress-middle.png` (unit 2,063, "48% of units"), `progress-late.png` (unit 3,931, "92% of units"), `full-run-completed.png`, `stop-mid-after-stop.png`, `stop-head-after-stop.png`. For the old presentation, see post-A `full-profile-in-progress.png`.

**Known property, not smoothed:** a runtime split adds units, so the units fraction can step back slightly. The pair-space fraction cannot, because a split conserves pair space. This run had no splits.

## 8. Protected-contract notes

- **Not changed:** `RunProgress` and event schema (`fractionProcessed` is still published, only no longer displayed as the bar), persisted Result Set shape, `DiagnosticsSummary`, digests, collision semantics, thresholds, scope-check semantics, decomposition and the executor.
- **Additive internal interface (P4 → P6):** the aggregator now exposes `counters()` besides `{addUnit, snapshot}`. The P4 plan's interface table (N20) lists `{addUnit, snapshot}` and says no signature may change without a reconciliation-register update. No existing signature changed. The register and plan were **not edited** (out of scope for this package). That update is recorded here as a required follow-up for the plan owner.
- **Panel design spec §7.1 (`running` row)** says "progress bar = `fractionProcessed`; … bar uses fractions, which are monotone". Option E deliberately departs from that row under the owner's authorization. The spec was **not edited**, and the row needs an owner-authorized update to read "bar = settled units / `unitsTotal`, labelled; may step back on a runtime split".

## 9. Readiness assessment

- **The owner-rejected envelope is gone.** A full Architecture self-clash is **about 2.5 min measured** (145.5 s of units plus about 4 s seal), against about 9.5 min projected post-A and about 16.9 h pre-A. Results and diagnostics are identical.
- **Responsiveness during units is now clean:** no main-thread long task in 4,294 + 1,707 units. Post-A had an 80–150 ms block per unit.
- **The progress indicator is now truthful about work done.** The displayed % equals settled units / total, labelled as such.
- **Remaining, for owner disposition** (none authorized here): (1) the per-unit whole-population digest (≈ 49%, protected); (2) the animation-frame inter-unit wait (≈ 38%, a run-option default that also makes background-tab runs slower); (3) the 1.2–2.5 s synchronous seal block (Stop and completion latency, UI freeze); (4) the large caveat volume (57,130 completeness-affecting diagnostics, 10,000 retained and truncated), which is correct by the current classification but heavy for users. Whether about 2.5 min with about 3–4 s Stop is product-acceptable is an owner decision.

## 10. Not measured or limits

1. The exact moment "Completed" appeared, and the completion seal's own end, were not marked. Both are inferred from long-task and `finishedAt` timestamps (≈ 3.9 s).
2. The seal step behind the 1.2–2.5 s long task was not identified.
3. One machine, one foreground headed tab, one completed run. Not measured: background-tab throttling (animation-frame yields), other refresh rates, other machines and browsers.
4. Cross-model scenarios (for example Architecture × Structure) were not re-measured. The progress change affects them only marginally, because their units carry near-equal pair space.
5. Containment and topology time still cannot be separated inside `narrowPhaseMs`.
6. Run M stopped at 1,707 units instead of the planned 1,500, because the first Stop attempt failed on a re-rendered button lookup with no click issued (see §3).
7. Run F used the full profile, which wraps `setTimeout` and does per-yield accounting. Its tail unit wall (18.37 ms) and gap (13.85 ms) are within about 0.5–0.9 ms of the lite run M (17.93 / 12.98 ms). Overhead is small but measurable at this scale.
8. Independent review: one `codex-advisor` consultation (§11). No independent Work review.
9. The live runs predate the two post-review edits (§3). Both are covered by the offline and DOM suites.

## 11. Internal review (codex-advisor, medium, request `20261007-234042-38468-20922`)

Codex confirmed four points:

- production semantics are identical, because `counters()` reads the same running totals and the seal still uses `snapshot()`;
- the I2 "aggregator throws after merge" path is unchanged, because an `addUnit` throw prevents either per-unit read;
- the Σ-guard equivalence holds, because `reasonBuckets` holds the same bucket objects, pushed exactly once;
- the comment "O(1)" was inaccurate: the cost is O(maxDistinctReasons).

Findings and disposition:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | `Run.js` called `counters()` unconditionally. An injected aggregator implementing only the documented N20 `{addUnit, snapshot}` would `TypeError` → `failed:internal-error`, an observable failure-path change. | **Fixed:** falls back to `snapshot()` when `counters` is absent. Test added (red, then green). The engine always builds the full aggregator. |
| 2 | Comment said O(1). | **Fixed** (comment now says O(maxDistinctReasons), independent of the retained set). |
| 3 | The units % includes failed/skipped units but the adjacent counter shows evaluated units only: "80% … units 6/10". | **Fixed:** the counter appends `(k not evaluated)` when k > 0. vm and DOM tests added. |
| 4 | The units fraction can step back on a runtime split. Panel spec §7.1 and N20 are stale. | **Recorded, not changed:** stepping back is the truthful behavior (no smoothing, per owner decision); characterized by a test. Spec §7.1 and N20 updates are owner/plan-owner follow-ups (§8). Specs and plans were not edited, per scope. |
| — | Rename "processed" → "settled". | **Not adopted:** "processed" is the engine's own term for evaluated + gaps (`pairSpaceProcessed`), so the label uses the existing vocabulary. |

Re-verification after the fixes: offline 5,383/5,382/0/1 todo, DOM 97/97, viewer adapter 128/128, `git diff --check` clean.

## 12. Reproduction

```sh
npm run test:offline && npm run test:clashpanel:dom && node --test test/clashtest/viewer/*.test.mjs
node --test test/clashtest/execution/diagnostics.counters.test.mjs test/clashtest/run/diagnosticCounters.run.test.mjs test/clashtest/execution/diagnosticCounters.e2e.test.mjs
nohup node server.js > "$TMPDIR/server.log" 2>&1 & disown
node docs/research/evidence/2026-10-07-self-clash-post-d-e-profile/build-instr.mjs . "$TMPDIR/postDE"
```

Then, with Playwright MCP:

1. Run `browser_run_code` with `filename: docs/research/evidence/2026-10-07-self-clash-post-d-e-profile/install-profile-full.js` (or `-lite.js`).
2. Open `http://localhost:8080/#<URN_ARCH>` and wait for the model.
3. In the Panel: Set A = Architecture → "Compare Set A against itself" → Run clash test (for Stops, use a mouse click at the Stop button's box).
4. Export `{env…, progressSamples, profile: window.__CLASH_PROFILE}` as `profile-*.json`.
5. Run `node docs/research/evidence/2026-10-07-self-clash-post-d-e-profile/analyze.mjs`, which writes `summary.json` and also reads the post-A `profile-full.json`.
