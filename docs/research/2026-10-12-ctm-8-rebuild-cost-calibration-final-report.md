# CTM-8 Rebuild-Cost Calibration — Execution / Support-Code Package Final Report

Protocol: **CTM8-P0-v4** (`docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`, SHA-256 `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3`, verified equal to the handoff value). Date: 2026-10-12. Owner prompt: `docs/prompts/ctm8-p0-v4-execution-support-code-package-prompt.md`. Filename choice: the owner prompt's name (`…-rebuild-cost-calibration-final-report.md`) was used; protocol §14 names `…-calibration-execution-final-report.md`; only this one exists.

**Tested points are calibration observations, not product limits.** Nothing below is a supported maximum, record/model limit, performance budget, frame-time guarantee, scalability certification or pass/fail verdict.

## 1. Repository state
- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `ac5bcb42b00e668442ce3add9764cba96d883309` == `origin/main` (0 ahead / 0 behind), verified before and after.
- Working tree: uncommitted, unpushed. Modified: `docs/handoffs/latest.md`. Untracked: P0 docs/prompts/reviews/final reports (pre-existing), this report, `docs/research/evidence/2026-10-12-ctm-8-rebuild-cost-calibration/`, `test/calibration/`. **No production path, existing test, or `test/clashpanel/support` file changed** (git status shows only docs and new `test/calibration/`). CTM-7 remains closed; Addendum B checkpoint intact.
- Commit/push: none (not authorized).

## 2. Scope delivered
Non-production support code under `test/calibration/ctm8/` (all new files):
- `lib/enumeration.mjs`, `lib/stats.mjs`, `lib/evidence.mjs`, `lib/cellRunner.mjs`
- `scenarios/familyM.mjs` (§6.1 fixture; M-BASE/M-REC/M-HIT), `scenarios/familyR.mjs` (§6.2 UNIFORM generator, `NAME(modelKey,dbId)`, `mC` object-tree injection + name proof; R-BASE/R-WARM/R-GROUP-WARM/R-COLD)
- `run-campaign.mjs` (one launch per process), `summarize.mjs`
- `headed/instrument.js`, `headed/summarize-headed.mjs`
- Tests: `tests/{enumeration,stats,evidence,cellRunner,familyM,familyR,summarize}.test.mjs`, `headed/instrument.test.mjs`

Implemented exactly per protocol: Family M subscriber attached only after Step 3 predicates (Step 3b/3c), none during build (the manager's own editor-sync subscription excepted, see anomalies); M-BASE timed window has no `await`; teardown order unsubscribe → manager dispose → controller dispose; `mC` `getObjectTree` replaced immediately after `makeHarness`; public-sentinel P-WARM only (no `textIndexed`/`labelsPending`); 120 s setup bound distinct from 30 s sample bound; cell-local abort after 3 consecutive failures; SKEWED and `-PULL` absent (a test checks the Family R module source).

## 3. Internal review
Codex review (`code`, medium) on `familyM.mjs`, `familyR.mjs`, `cellRunner.mjs` **before** the campaign: 3 High + 5 Medium accepted findings (timed-out polling kept running; timeout not bounding the triggering call; swallowed teardown/dispose failures; reset failure erasing timeout evidence; partial-setup leak; `timeoutMs` ignored; unvalidated `kind`). All fixed with tests; campaign ran on fixed code. No unresolved findings. (A stale duplicate set of three misplaced test files was found and removed.)

## 4. Verification
- Calibration tests: **118 / 118 pass** (`node --test test/calibration/ctm8/tests/*.test.mjs test/calibration/ctm8/headed/*.test.mjs`).
- Full offline suite `npm run test:offline`: **5,813 tests, 5,812 pass, 0 fail, 0 cancelled, 0 skipped, 1 todo**.
- `git diff --check`: clean (exit 0).
- Enumeration asserted by test and observed in evidence: 84 cells/launch, 252 executions, 7,020 measured (6,480 warm + 540 cold), 1,080 warm-ups, 8,100 operations. SKEWED/`-PULL` not executed.
- Checksums: `shasum -a 256 -c checksums.sha256` in the evidence root, 131 entries, 0 mismatches; `headed/checksums.sha256` (106 files) all OK.
- Not run: `npm run test:clashpanel:dom` (not part of this package).

## 5. Campaign executed (headless — primary evidence)
Environment: Apple M4, 10 cores, 32 GiB, Darwin 27.0.0, Node v22.23.1, no flags, `performance.now()`; power source/other processes not recorded (see `environment.json`). Three separate sequential Node processes (`--launch 0|1|2`, seeds `mulberry32(20261011+launch)`, Fisher–Yates), started 2026-10-12 ≈09:42 CST; exit codes 0/0/0.

| Quantity | Expected | Observed |
| --- | --- | --- |
| cells / launch | 84 | 84 |
| cell executions | 252 | 252 — **all COMPLETED** |
| measured samples | 7,020 | 7,020 |
| warm-ups | 1,080 | 1,080 |
| total operations | 8,100 | 8,100 — every record `status: OK` |

Attempted 252 / completed 252 / failed 0 / inconclusive 0 / setup-timeout 0 / TIMEOUT samples 0 / INVALID 0. Largest Family M setup (N = 10,000) finished within the 120 s bound.

### Headline medians (ms; median of 3 launch medians; full per-launch tables, p95, POOLED in `summary/headless-matrix.md`)
Family M (n_models = referenced models per record; neutral exploratory dimension):

| Scenario | N | n=1 | n=2 | n=3 |
| --- | --- | --- | --- | --- |
| M-BASE | 100 | 0.32 | 0.32 | 0.49 |
| M-BASE | 1,000 | 22.4 | 21.4 | 22.0 |
| M-BASE | 5,000 | 329.5 | 543.1 | 558.4 |
| M-BASE | 10,000 | 2,231 | 2,347 | 2,269 |
| M-REC | 100 / 1,000 | 0.23 / 7.5 | 0.29 / 12.0 | 0.30 / 12.1 |
| M-REC | 5,000 / 10,000 | 272 / 752 | 171 / 1,175 | 176 / 742 |
| M-HIT per call | all N | ≈0.007–0.014 | ≈0.009–0.014 | ≈0.008–0.012 |

Family R (UNIFORM):

| Scenario | N=100 | 1,000 | 5,000 | 10,000 |
| --- | --- | --- | --- | --- |
| R-BASE (n=1) | 0.053 | 0.28 | 1.64 | 3.68 |
| R-WARM (n=1) | 0.100 | 0.39 | 1.82 | 7.66 |
| R-GROUP-WARM (n=1) | 0.113 | 0.40 | 1.90 | 7.72 |
| R-COLD total (n=1, cold only) | 0.178 | 0.90 | 5.78 | 26.2 |

n=2 and n=3 values for Family R are within a few percent of n=1 at each scale (tables in the summary).

### Observations (descriptive; no inference beyond measured points)
- **Model axis:** Family M and Family R medians do not show a consistent, material difference across n_models = 1/2/3 beyond the launch-to-launch spread (see anomaly 1); no slope or direction is claimed.
- **Cold vs warm separate:** R-COLD total is 2.3–3.4× the R-WARM median at N = 1,000–10,000 in these runs (`n=1`: 0.90 vs 0.39; 26.2 vs 7.66 ms). Reported as separate columns, never blended. The label-index commit sub-phase is UNAVAILABLE (no seam, as authorised).
- **Selected-group paired delta (R-GROUP-WARM − R-WARM):** all 12 (scale × n_models) cells are **indistinguishable** from run-to-run spread; headline deltas range ≈ −0.16 to +0.32 ms.
- **Per-unit-cost ratios (descriptive knee observation):** Family M M-BASE per-record cost rises with N (100 → 1,000: ×4.5–6.9; 1,000 → 5,000: ×2.9–5.1; 5,000 → 10,000: ×2.0–3.4), i.e. superlinear over the tested range; M-REC similar in character. Family R per-result cost is roughly flat 1,000 → 5,000 and ≈×2 from 5,000 → 10,000. These are observations at tested points only. **No knee is converted into a limit.** Headless timings measure pure compute plus microtask scheduling (`fakeScheduler.yield` is microtask-only), not real yielding or Viewer work.

## 6. Headed corroboration (real Viewer 7.124.2, SVF2, Chrome 155, 1600×1000, `http://localhost:8080`)
Evidence: `headed/` (README, reachability, blockers, results.json, 106 checksummed files, 90 screenshots).
- **Family R:** 9 real points (low/mid/high × n_models 1/2/3) from real engine runs; HB-BASE, HB-WARM, HB-GROUP (2 warm-up + 5 measured) and HB-COLD (3 fresh generations): 36 timed cells, 216 samples, all OK, no TIMEOUT/INVALID. Nearest-reachable labels used for low/mid; **5,000 and 10,000: NOT REACHABLE HEADED** (largest natural sets 4,770 / 2,277 / 3,488 for 1 / 2 / 3 models); no run truncated; configured `maxResultsPerRun` = 100,000 (source-derived default, not publicly observable).
- Median headed durations (include the real 150 ms debounce; Viewer work excluded): HB-BASE 2.3–11.0 ms; HB-WARM 163.5–179.1 ms; HB-GROUP 159.6–180.5 ms; HB-COLD 159.5–186.2 ms. Time after the debounce (from first busy notification): warm 1.5–18.3 ms, cold 2.6–22.8 ms. No long task overlapped a timed window (131 long tasks recorded elsewhere, up to 2.46 s, during runs/Viewer work). Headed and headless boundaries differ (§10) and are not compared as equivalent.
- HV-1, HV-3, HV-4 pass at all 9 points; **HV-2 (Focus) "not met as written" at all 9** (camera already fitted by HV-1). Observation only.
- **Family M HM-REC: UNAVAILABLE at all 6 points** (§9.3 predicate not executable through the allowed public instrumentation route; no substitute predicate adopted; nothing timed; **owner ruling required**).
- Console: 0 errors, 16 warnings (known `getInstanceTree` deprecation; three-mesh-bvh coplanar warnings). Addendum B L1 flash observed in 27/27 cold samples (≈1.3–10 ms), observation only.

## 7. Anomalies / unresolved
See `evidence/…/anomalies.md`. Key: (1) unexplained launch-to-launch level shift in many Family M cells (launch 0 lower in most; not attributed to a cause); (2) isolated R-GROUP-WARM outliers retained; (3) HM-REC unavailability and HV-2 as above; (4) minor protocol ambiguities (private `viewer.impl.overlayScenes` read for HV-1, reused sentinel pairs across sets, no manager `version` covariate).

## 8. Protected boundaries
Unchanged: production code, Core/collision/Viewer Adapter/host, Viewer theming/selection, limits/budgets, `controllerHarness.mjs` and all existing tests/support, CTM-7 L1–L8, Addendum B L1/L2, O-1…O-4, hide/departure, navScope, GP-F1. No performance remediation; no new mandatory scenarios; SKEWED and `-PULL` not run.

## 9. Owner decisions / next gate
No owner decision made here. Candidate questions for the owner (recommendation only, **not** authorization): (a) ruling on HM-REC (accept UNAVAILABLE, or authorize a seam/alternate predicate package); (b) whether the observed Family M superlinearity and the unexplained launch shift warrant a refinement/optimization decision (§4.4/§15 — a review/owner decision, not an execution-package choice); (c) whether to repeat launches under a controlled machine state.
**Exact next gate: Independent Work review of this execution/support-code package. Commit/push awaiting owner decision after that review. Awaiting owner authorization for anything further.**
