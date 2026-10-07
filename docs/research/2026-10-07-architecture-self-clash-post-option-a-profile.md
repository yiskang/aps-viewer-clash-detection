# Architecture whole-model self-clash: post-Option-A real-model headed profile

- **Date:** 2026-10-07. Runs at 14:44–14:54 UTC (22:44–22:54 +08:00).
- **Owner authorization:** implement **Option A** of [`2026-10-07-architecture-self-clash-real-model-profile.md`](2026-10-07-architecture-self-clash-real-model-profile.md) §7 (time-sliced executor checkpoint), then a bounded real-model re-profile. Options B–J were **not** implemented.
- **Inputs (unchanged, read-only):** the pre-A real-model profile above and the offline investigation [`2026-10-07-architecture-self-clash-performance-investigation.md`](2026-10-07-architecture-self-clash-performance-investigation.md).
- **Status:** Option A implemented and tested; re-profile complete. No further optimization applied. Next action: **owner disposition** of the new dominant cost (§6) and of the product envelope (§7). **Awaiting owner authorization.**
- **Evidence:** [`docs/research/evidence/2026-10-07-self-clash-post-option-a-profile/`](evidence/2026-10-07-self-clash-post-option-a-profile/README.md), with a SHA-256 manifest.

## 1. Product change

**File:** `clashtest/execution/LocalUnitExecutor.js` (only product file touched). **Test:** new `test/clashtest/execution/localExecutor.checkpoint.test.mjs` (11 tests).

The executor's `EnumerationContext.checkpoint` (spec §6.2) used to be `() => yieldToScheduler()` on every call. It is now created **per unit** inside `execute()` by `createUnitCheckpoint()`:

- It uses the existing P0 slicer (`clashtest/util/slicer.js` `createSlicer`) with the executor's existing injected `now`, `yieldToScheduler` and `sliceBudgetMs` (engine limit `sliceBudgetMs`, default 4 ms, `clashtest/options.js:86`), i.e. the same mechanism the planning-time `enumerationCheckpoint` (`clashtest/run/Run.js`) uses. No new option, constant or clock.
- `checkEvery: 1`: every checkpoint call reads the clock (each call is already a coarse cadence point — the adapter calls it every 64 items), so a yield is never later than one checkpoint interval past the budget ("at least once per slice", §6.2). The slicer's existing secondary ceiling (`aggregationSliceMaxItems`, default 2,000 calls) is kept.
- The **first checkpoint of every unit still yields unconditionally** (kept from today's behaviour; it is the only yield the first unit of a run gets before its pre-bracket). Run's `interUnitYield` at the unit boundary is untouched.
- One slice account spans pre-bracket → library call → post-bracket and is never reset in between, so a long library call makes the first post-bracket checkpoint due at once.
- The not-due path returns `undefined` synchronously (the adapter's "Item D" same-tick convention).
- Unchanged: which scopes are digested, digest bytes, the §16.3.2 bracket protocol and comparison, Table A settlement, collision query/semantics, thresholds, results, and cancellation (still observed only at the unit boundary; the executor checkpoint never observed cancel and still does not).

**Local corrections beyond Option A:** none.

## 2. Tests (TDD)

The new test file was written first and failed 10/11 against the old executor (yield counts 1,200 / 600 / 80 / 20 / 70 instead of 1 / 3 / 10 / 2 / 7; the (d) cancel guard passed before and after, as a regression guard should). After the change, 11/11 pass:

| # | Pins |
| --- | --- |
| (a) ×2 | 1,200 checkpoint calls inside one slice → exactly 1 yield (the unit's first-call yield); every other call returns `undefined` synchronously; each unit gets its own first-call yield and slice |
| (b) ×2 | fake clock, 1 ms per call, 8 ms slice → 10 yields at exactly 8 ms spacing; a slice-long library call makes the next post-bracket checkpoint due; `durationMs` still reads the injected clock |
| (c) ×5 | unit outcome identical (minus `durationMs`) to an always-yield schedule for: evaluated with pairs+diagnostics, pre-check drift, post-check drift, lease death during pre-bracket, lease death during post-bracket |
| (c) e2e | real engine + real `CollisionWorld` + **production `createViewerElementEnumerator`**, same-model (cell 3b) run of 7 units under both schedules: identical results, `pairSetDigest`, provenance scope digests, ledger (minus durations), outcome, `findClashes` count; same checkpoint calls; sliced schedule = exactly 1 executor yield per unit |
| (d) | cancel during the first unit (under both schedules): in-flight unit drained (1 `findClashes`), status `cancelled`, every later unit `not-run` |

No existing test changed; none asserted per-call executor yields.

**Verification (exact):**

| Suite | Result |
| --- | --- |
| `npm run test:offline` | **5,361 total / 5,360 pass / 0 fail / 1 todo** (baseline 5,350/5,349/0/1 + 11 new) |
| `npm run test:clashpanel:dom` | **95/95** |
| viewer adapter (`node --test test/clashtest/viewer/*.test.mjs`) | **128/128** |
| focused (`execution`, `engine`, `viewer`, `integration`, `run` test files) | 788/788 |
| `git diff --check` | clean |

## 3. Environment and procedure

| Item | Value |
| --- | --- |
| Repository | `main`, HEAD `dcdab38`, dirty tree: the pre-existing D-V6 package edits plus this package's `LocalUnitExecutor.js` change and new test. The browser ran this working tree. |
| Server | `node server.js` (Node v22.23.1) on `localhost:8080`, `.env` present; stopped at the end |
| Browser | Playwright MCP Chromium **headed**, Chrome/154.0.0.0, macOS, Apple M4 (ANGLE Metal), `hardwareConcurrency` 10, `visibilityState = visible` |
| Viewer | APS Viewer 7.124.2, SVF2 (`isOTG() === true`), Architecture 5,435 fragments |
| App | normal app, flag-free `http://localhost:8080/#<URN_ARCH>` (`Audubon_Architecture_clash_test.rvt`, URN from `test/acceptance/clash-finder.acceptance.mjs:327`). **No demo/fixture mode, no synthetic fixtures.** |
| Scenario | real Clash Panel: Set A = `Audubon_Architecture_clash_test`, Hard, "Compare Set A against itself (Set B = Set A)", Run clash test, **Stop via the real Panel Stop button** (a trusted mouse click at the button's coordinates; the button re-renders too often for a locator click) |

**Instrumentation.** Same method as the pre-A profile: 12 gated marks (`instr-replacements.mjs`, adapted to the new checkpoint; Run.js/scopeDigest.js marks unchanged) applied **only in the browser** by Playwright `page.route` rewriting of served module text, gated by `window.__CLASH_PROFILE`. No product source was instrumented on disk; `instrumentation.patch` is the exact served diff. New marks: per-unit checkpoint **call** count (separately from yields), bracket proofs, projected evaluated pair count.

**Runs.**

| Run | Profile | Run click → Stop click | Units evaluated | Purpose |
| --- | --- | --- | --- | --- |
| F | full | 14:44:20Z → 14:50:34.7Z (≈ 6.2 min) | **3,034** of 4,294 (70.7%) | head + deep tail, Stop in tail |
| L | lite | 14:52:16.9Z → 14:53:29.8Z | 628 | instrumentation overhead, second Stop |
| S2 | lite | 14:54:09Z → +2.3 s | 2 | third Stop, **in-flight head unit** (`3b.1`) |

F was **not** run to completion: at 2,921 units the projected total was ≈ 10 min, above the ~8 min allowance, so it was stopped. Browser closed between runs (no carried-over init script/route).

One deviation, run F: at unit ≈ 1,620–1,684 a body-wide `MutationObserver` (to timestamp completion) was installed and could not be removed. Measured impact: unit-to-unit period 118.5 → 120.4 ms over the 384 units before/after, in line with the snapshot growth trend; unit wall unchanged (19.22 vs 19.21 ms). Treated as negligible.

## 4. Measurements: before (pre-A run F) vs after (post-A)

All post-A numbers from `analyze.mjs` → `summary.json`. "Head" = plan units 1–80 (offline: ~87% of narrow-phase pairs); "tail" = units 81–3,034 (run F).

### 4.1 Per-unit costs

| Metric | Pre-A (12 units, `3b.0`–`3b.11`) | Post-A, same 12 units | Post-A head (1–80) | Post-A tail (81–3,034) |
| --- | --- | --- | --- | --- |
| checkpoint **calls** / unit | 2,854 | 2,854 | 2,852–2,854 | 2,852 (2,854 for 11 tail units) |
| scheduler **yields** / unit | **2,854** | 6–8 | mean 5.4 (4–8) | **mean 5.0** (4–6) |
| yield wait / unit | 14,027 ms | — | mean 5.6 ms | mean 0.68 ms |
| pre-bracket | 7,061 ms | 22.8–28.7 ms | mean 13.3 | mean 9.7 |
| post-bracket | 7,117 ms | 36.4–56.3 ms | mean 18.2 | mean 9.0 |
| bracket total (pre+post) | **14,179 ms** | ≈ 60–85 ms | mean 31.4 (median 18.4) | **mean 18.7** (p95 20.1, max 49.2) |
| …whole-population digests (2 calls) | 12,615 ms | — | mean 18.6 | mean 17.0 (**91% of bracket**) |
| …explicit-roots digests (4 calls) | 1,562 ms | — | mean 12.6 | mean 1.7 |
| library call (`findClashes`) | mean 367 ms (50–901) | mean 277 ms (24–862) | mean 67.0 (p95 469, max 1,344) | **mean 0.3** (p95 1.0, max 35.6) |
| **unit wall** | **14,550 ms** (14,298–15,162) | **mean 348 ms** (84–963) | mean 99.1 (median 18.7, max 1,399) | **mean 19.1** (p95 21.1) |
| bracket share of unit wall | 97.5% | — | 31.7% | 98.1% |
| outside the unit: `diagnosticAggregator.snapshot()` | 13 → 55 ms | — | first 11.6 | **80.6 → 123.1 ms** (decile means), median 96.7 |
| outside the unit: gap to next unit | mean 50.8 ms | — | mean 75.4 | **mean 102.5** (snapshot + 1.4 ms) |
| `interUnitYield` | 0.3 ms | — | median 0.2, max 5.5 (all units) | |

Bracket digest work is now real CPU, not waiting: post-A whole-population digest ≈ 8.5 ms per call (17 ms / 2), consistent with the pre-A no-yield freshness measurement (7.9–16.0 ms).

Library call for the same head units is ≈ 25% lower post-A (mean 277 vs 367 ms; e.g. `3b.3` 179 vs 319 ms, `3b.0` 862 vs 813 ms). **Hypothesis, not verified:** the library's own frame-budget yields are no longer nested inside a deep `setTimeout(0)` chain, so they escape the 4 ms clamp. Library statistics (pairs, candidates) are identical (§5), so this is scheduling, not work.

### 4.2 Scheduler / yields (run F)

| | Pre-A | Post-A |
| --- | --- | --- |
| executor yields | 34,248 in 12 units (2,854/unit) | **15,063 in 3,034 units** (≈ 5/unit), of 8,653,022 checkpoint calls (0.17%) |
| per-yield latency min / median / mean / p95 / p99 / max | 0.0 / 5.0 / 4.92 / 5.4 / 5.7 / 22.1 ms | **0.0 / 0.1 / 0.163 / 0.4 / 1.5 / 6.0 ms** |
| share of yields ≥ 4 ms | 99.77% | **0.74%** |
| page-wide 0-delay `setTimeout` | 34,933 fired; 12,426 @4 ms, 22,259 @5 ms | 16,019 fired; 15,141 @0 ms, 202 @4 ms, 601 @5 ms |
| total executor yield wait | 168 s (12 units) | 2.45 s (3,034 units) |

The 4 ms nested-timer clamp is gone: with ≈ 5 yields per unit the timer chain rarely reaches nesting depth 5.

### 4.3 Throughput and time budget

| | Pre-A F | Post-A F | Post-A L |
| --- | --- | --- | --- |
| units/min | 4.11 | **488** (3,034 in 372.9 s) | 524 (628 in 71.9 s) |
| Σ unit wall / window | ≈ 99.7% | **17.2%** (64.3 s) | 25.6% |
| Σ `snapshot()` / window | 0.3% | **81.6%** (304.1 s) | — |
| run click → first unit | — | 1.66 s | 1.18 s |

### 4.4 Stop responsiveness (three Stops)

| | Pre-A F | Pre-A L | Post-A F | Post-A L | Post-A S2 |
| --- | --- | --- | --- | --- | --- |
| in-flight unit at click | `3b.11`, 11.57 s in | `3b.10`, 8.44 s in | `3b.3033` (unit 3,034), 148 ms in (click landed in the snapshot gap) | `3b.627`, 23.9 ms in | **`3b.1` (head), 259 ms in** |
| click → `requestCancel` | 0.3 ms | 0.1 ms | 0.2 ms | 0.1 ms | 0.2 ms |
| click → unit boundary (drain) | 2.79 s | 4.92 s | **1.7 ms** | **105 ms** | **523 ms** |
| seal | 2.36 s | 2.35 s | **3.60 s** | **3.03 s** | **1.76 s** |
| click → Panel "Stopped" | 5.15 s | 7.27 s | **3.60 s** | **3.13 s** | **2.29 s** |
| sealed | cancelled/partial | same | cancelled, partial, 4,395 clashes, 1,260 not evaluated | cancelled, partial | cancelled, partial |

- The drain is now bounded by the in-flight unit remainder (≤ ≈ 1.4 s in the heaviest head unit, ≈ 20 ms in the tail) plus at most one snapshot (≈ 100–150 ms).
- **The seal is now the dominant Stop cost**, and it grows with run progress (1.76 s at 2 units → 3.03 s at 628 → 3.60 s at 3,034). Worst case observed 3.6 s (pre-A worst case ≈ 17 s).
- Cancel is still observed only at the unit boundary; the in-flight unit was drained in every case (S2: `3b.1` finished its library call and post-bracket, settled `evaluated`).

### 4.5 Instrumentation overhead (F vs L, units 81–628)

Unit wall 18.77 (F) vs 19.04 ms (L); gap 86.94 vs 86.75 ms. **No measurable overhead.**

## 5. Result integrity (product path)

- **Pre-A vs post-A, same unit ids** (`3b.0`–`3b.11`, the 12 units the pre-A profile evaluated): library `pairs`, `narrowPhasePairs`, `broadPhasePairs`, `tlasPrimitiveCandidatePairs` and diagnostics count are **identical for all 12**; unit shapes identical; engine counters (`pairSpaceProcessed`, `resultsFound`, `caveatCount`) at the same boundaries **identical**. Per-unit clashes 318, 608, 84, 334, 139, 104, 29, 42, 92, 90, 18, 0 — same both sides; projected evaluated pairs equal library pairs.
- **Post-A F vs L** (628 shared units) and **F vs S2** (2 units): library statistics, projected pair counts and engine counters identical.
- **Bracket outcomes:** all 3,034 (F), 628 (L), 2 (S2) units settled `evaluated` with pre `equal` / post `equal`.
- **No difference found.**

## 6. Projection and the new dominant cost

### 6.1 Full-run projection (Architecture self-clash, 4,294 units)

> **Projection, not a measurement.** 70.7% of the units (3,034) were measured end to end in one run.

Formula:

`T = t_lead + T_measured(1..3,034) + Σ_{k=3,035}^{4,294} (w_tail + g(k)) + t_seal`

- `t_lead` = 1.66 s (run click → first unit, measured)
- `T_measured` = 372.9 s (first unit start → unit 3,034 end, measured)
- `w_tail` = 19.09 ms (mean tail unit wall, measured)
- `g(k)` = 78.93 + 0.01511·k ms: least-squares fit of the measured inter-unit gap over units 81–3,033 (the gap is `snapshot()` + 1.4 ms; snapshot fit 77.65 + 0.01501·k)
- `t_seal` ≈ 4 s (assumed from the measured cancel seals 1.8–3.6 s; the completion seal was not measured)

Result: remaining 1,260 units ≈ 193 s → **T ≈ 572 s ≈ 9.5 min**.

Uncertainty: flat gap at the last-300 mean (124.6 ms) → 9.3 min; slope 1.5× the fit → 9.6 min. Unmeasured terms — tail units 3,035–4,294 (offline: low narrow-phase weight), the completion seal, and machine/tab variance — make a working range of **≈ 9–11 min**. Pre-A: ≈ 16.9 h (**≈ 100× faster**). The pre-A report's Option-A projection (21–29 min) was conservative because it assumed ≈ 150 ms of bracket CPU per unit (measured: 18.7 ms) but only 50 ms of snapshot (measured: 80–125 ms and growing).

Cross-model runs (e.g. Architecture × Structure, 28 units) were **not** re-measured.

### 6.2 New dominant cost

**`diagnosticAggregator.snapshot()` after every unit (`clashtest/run/Run.js:781`; `clashtest/execution/diagnostics.js:473`)** — synchronous, no yield inside, ≈ 80 ms → 125 ms per unit and growing ≈ 0.015 ms per unit, **81.6% of the measured wall window** (304 s of 373 s). After 3,034 units the run held 49,725 caveats. At ≈ 100–150 ms it is also a **main-thread long task once per unit** (not measured as a long-task/frame metric; flagged as a responsiveness concern).

Remaining costs, in order:

1. whole-population source digest inside the per-unit bracket (§16.3.2 R20-1): ≈ 17 ms/unit, 91% of the bracket, ≈ 14% of the window (protected bracket protocol; Option F territory);
2. the cancel seal (1.8–3.6 s, growing), now the dominant Stop cost;
3. library real-mesh time in the head units (up to 1.34 s per call), correct work.

**No further optimization was applied.** Option D (read `completenessAffectingCount` without a full `snapshot()`) is the already-documented candidate for (6.2) and is **not authorized** by this package.

## 7. Remaining product-readiness assessment

- **The measured bottleneck is removed:** yields per unit 2,854 → ≈ 5, unit wall 14.55 s → 19 ms (tail) / 348 ms (heaviest 12 head units), Stop 5–7 s → 2.3–3.6 s, with identical results.
- **Not yet an owner-accepted envelope.** A full Architecture self-clash is projected at ≈ 9.5 min (≈ 9–11 min). Whether that is acceptable is an owner product decision (review H1). ≈ 82% of it is per-unit snapshot bookkeeping, not clash work.
- Still open, unchanged by this package: misleading `%` for same-model runs (Option E; the Panel showed 73% at unit 1,618/4,294); the large caveat count (49,725 at 70.7%) and its unmeasured reason mix; the seal-dominated Stop latency.

## 8. Not measured or limits

1. The run was **not completed**: units 3,035–4,294 and the completion seal are projected.
2. Main-thread long tasks / frame rate during the run (snapshot is a ≈ 100–150 ms synchronous block per unit) were not measured.
3. Cross-model scenarios, background-tab throttling, and other machines/browsers were not measured.
4. Diagnostic reason mix: not captured.
5. Containment/topology time cannot be separated from `narrowPhaseMs` (no library-internal marks, as before).
6. The library-call speed-up for head units (§4.1) is observed, but its cause is a hypothesis.
7. No independent/Codex review of the code change was run in this package.

## 9. Reproduction

```sh
npm run test:offline && npm run test:clashpanel:dom
node --test test/clashtest/execution/localExecutor.checkpoint.test.mjs
nohup node server.js > "$TMPDIR/server.log" 2>&1 & disown
node docs/research/evidence/2026-10-07-self-clash-post-option-a-profile/build-instr.mjs . "$TMPDIR/postA"
```

Then, with Playwright MCP: `browser_run_code` with `filename: docs/research/evidence/2026-10-07-self-clash-post-option-a-profile/install-profile-full.js` (or `-lite.js`). Open `http://localhost:8080/#<URN_ARCH>` and wait for the model. In the Panel: Set A = Architecture → "Compare Set A against itself" → Run clash test → Stop (mouse click at the Stop button's box). Export `JSON.stringify(window.__CLASH_PROFILE)` with the environment fields as `profile-*.json`. Then run `node docs/research/evidence/2026-10-07-self-clash-post-option-a-profile/analyze.mjs` (writes `summary.json`; it also reads the pre-A `../2026-10-07-self-clash-real-profile/profile-full.json`).
