# CTM-8 P0 — Calibration Protocol Remediation: Package Final Report

> **Status note (added 2026-10-11):** historical v2 remediation report. Its SKEWED-inclusive campaign figures, Family M fixture description and open-owner-decision wording were corrected by the [v2 correction final report](2026-10-11-ctm-8-p0-v2-correction-final-report.md) (`CTM8-P0-v3`); the figures below are superseded.

Date: 2026-10-11 · Package: bounded docs-only CTM-8 P0 remediation · This is the remediation completion report/addendum. The original [P0 final report](2026-10-11-ctm-8-p0-calibration-protocol-final-report.md) is preserved unchanged as historical input; where it conflicts with this report (notably its "all ten internal findings remediated" claim), this report and the Work review govern.

## Repository state

- Repository `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; HEAD `ac5bcb42b00e668442ce3add9764cba96d883309`; `origin/main` at the same commit (0 ahead / 0 behind), verified before editing.
- Working tree: docs only, uncommitted and unpushed (modified `docs/handoffs/latest.md`; untracked prompts, entry review, P0 protocol, P0 final report, P0 Work review, this report). CTM-7 remains closed; Addendum B remains checkpointed at HEAD; no CTM-8 harness, generator, seam, execution evidence or calibration result exists. No commit, no push.

## Governing inputs

- Failed review: [P0 Independent Work Review](../reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md) — **FAIL — P0 REMEDIATION REQUIRED, 0 Critical / 5 High / 3 Medium / 1 Low**.
- Owner authorization: [remediation prompt](../prompts/ctm-8-p0-docs-only-remediation-prompt.md).
- Remediated protocol: [`2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`](2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), **`CTM8-P0-v2`** (updated in place; no competing protocol).

## Owner decisions applied (final for this remediation)

Both Family M (manager test-records) and Family R (clash-result records), full 4 × 3 headless matrix for mandatory scenarios; all `-PULL` excluded from the mandatory campaign; 3 launches, 30 warm / 15 cold measured repetitions (warm: median/min/max/coarse p95; cold: per-launch p95 `n/a`, pooled p95 only if estimator fixed, labelled pooled, raw retained; no silent outlier removal); public-observable sentinel classification only (no `textIndexed`/`labelsPending`, no seam, no hook; index-commit sub-phase UNAVAILABLE; R-COLD total retained); headed = practical real-product corroboration only, unreachable points recorded, no fake data.

## Dispositions

| Finding | Disposition | Protocol location |
| --- | --- | --- |
| **H1** private-state cold/warm | Removed every normative use of private state. One canonical public predicate `P-WARM(T)` (`filters.text`, `filters.active`, `filters.busy === false`, `results.state === 'list'`, exact `run.counts.filtered === W(T)`, first-page identity); a name-only sentinel makes the cold count exactly 0 so `W(T)` proves a committed index. Failure to prove ⇒ R-WARM/R-GROUP-WARM `UNAVAILABLE`. R-COLD total kept with an informational transition log; commit sub-phase explicitly UNAVAILABLE; no seam implied. | §7.3, §7.4, §8 |
| **H2** headed action/completion | Exact action, payload, pre-state, `t0` (in-page capture-phase listener of the triggering event), completion predicate (semantic ∧ DOM, 250 ms quiet confirmation not added to duration, 10 s timeout) and included/excluded work for HB-BASE/HB-WARM/HB-COLD/HB-GROUP. All Viewer work (`presentGroup`, Focus, Isolate, Back to all, fit) **excluded from timing** (only the dispatch promise could signal completion and it is not observable from a DOM/instrumentation stop condition) and kept as correctness-only HV-1…HV-4 with a defined "Viewer settled" check. HB-BASE transition equals headless R-BASE (`group-label → group-count`). | §9.3, §9.4, §10 |
| **H3** Family M exactness | M-BASE frozen: `catalog.addModel({modelKey:'mA', displayName:'Architecture-R', …})`, timed `catalog.fire()`, predicate on `tests[0]`/`tests[N−1].setA` and `catalog.calls.list`, exact reset. M-REC frozen: `k = floor(M.N_tests/2)`, untimed `MANAGER_INTENT.OPEN` + alternating `INTENT.SETUP_NAME` `'Test k A'/'Test k B'`, predicate on `tests[k].name/testId`, `activeTestId`, `count`; forwarded real-editor work **intentionally included**. Family M moved onto the real-controller integration route because the fake editor's `SETUP_NAME` is a no-op. Manager-only variant declared UNAVAILABLE (no seam). | §5.1, §6.1 |
| **H4** selected-group comparator | Primary comparator `R-GROUP-WARM − R-WARM` requires identical `G*`, identical `memberIndexes` (T1/T2 constructed so all `G*` members match both), no membership change, and **no `bridge.presentGroup` in the window**, asserted per sample. Membership-changing behavior is a separately named unpaired optional scenario. | §5.2, §6.2, §4.3 |
| **H5** false 10,000 cap | Removed from every location (the old §18 item and wording); 10,000 is an exploratory target; configured (default 100,000, ceiling 956,824, `clashtest/options.js:58`) / produced / retained / truncated recorded; headed reachability empirical; no synthetic fill. | §9.2, §15 |
| **M1** scope/campaign size | Named populations `M.N_tests` / `R.N_results` / `n_models`; mandatory scenario table; exact counts computed (below). | §2, §4 |
| **M2** fixture/statistics | Closed-form deterministic generator (pair table, b-side ids, UNIFORM group size 10, SKEWED 4 hot × `N/5` + 20% singletons, names, `G*`), exact expected-count table incl. `W(T1)/W(T2)`; Family M fixture rules; 30,000 ms timeout, retained-and-labelled TIMEOUT, repetitions continue, abort after 3 consecutive failures, no silent reduction; nearest-rank p95; per-launch authoritative, median-of-launch-medians headline, pooled secondary and labelled. | §6, §7.6, §11 |
| **M3** package status | This addendum records the FAIL and corrects the upstream status claim without rewriting the original report; original preserved. | this report |
| **L1** support-code duplication | Collapsed into one §17 list (harness, generator, headed instrumentation, execution, evidence writes) separate from the observation-seam statement (not required/not recommended/not authorized); numbering made stable. | §17, §18 |

## Exact mandatory campaign size

36 Family M cells (M-BASE, M-REC, M-HIT × 12) + 96 Family R cells (R-BASE, R-WARM, R-GROUP-WARM, R-COLD × 12 × {UNIFORM, SKEWED}) = **132 cells per launch** (108 warm, 24 cold); × 3 launches = **396 cell executions**; **3,600 measured samples per launch** (warm 108 × 30 = 3,240; cold 24 × 15 = 360), **10,800 measured** overall; warm-ups 108 × 5 = 540 per launch, **1,620** overall; **12,420 total operations**. Arithmetic cross-checked against the review's earlier method (180 cells → 15,120 / 2,340 / 17,460), which this reproduces.

## Headed corroboration policy

Practical real-product points only; Family R: up to low/middle/high real result sets per reachable model count (ceiling 9 points → 36 timed cells + 9 correctness blocks); Family M: HM-REC only at proposed `M.N_tests ∈ {5, 25, 100}`, `n_models ∈ {1, 3}` (ceiling 6, subject to owner review); M-BASE headless-only; unreachable ⇒ `NOT REACHABLE HEADED`/`NEAREST-REACHABLE`; primary curves are headless.

## Observability boundary

Public sentinel only. No private state, seam or hook. Label-index commit sub-phase UNAVAILABLE; R-COLD total valid.

## Execution support still unauthorized

Calibration-only harness, deterministic generator, runtime-injected headed instrumentation, execution of the matrix, evidence/execution-report writes — each needs separate owner authorization (§17). No observation seam or production hook is required, recommended or authorized.

## Verification performed

Docs-only. No calibration, benchmark or tests executed. Source facts used in the protocol were obtained by read-only research and cited to file:line by delegated read-only agents, then cross-checked against the review: `catalogEpoch`/`recordsVersion` bump paths and `fakeCatalog.addModel`/`fire` (testsManager.js:154-199, 677-704; fakeCatalog.mjs:30-48), `SETUP_NAME` forwarding and the fake editor no-op (testsManager.js:655-668; fakeEditor.mjs:57-68), public VM fields (no public committed-filter value; viewModel.js:416-422), reconcile/`presentGroup` semantics (controller.js:1221-1277), filter matching and cold-vs-warm behavior (filters.js, labels.js, controller.js:857-879), element grouping both-sides listing (grouping.js), `maxResultsPerRun` (clashtest/options.js:58), DOM selectors (ui/render/*). Protocol re-read end to end; stale-term search and arithmetic recorded below; `git diff --check` and docs-only path check run before stopping.

## Internal review

A read-only targeted consistency review by a delegated agent (not Codex) checked H1–H5/M1–M3/L1 against the owner prompt, internal contradictions, arithmetic and stale terms. Arithmetic (cell/sample counts, nearest-rank ranks, fixture formulas for N=100 and n_models=3) and stale-term searches were confirmed clean. It found **1 High** (headed HM-REC lacked an exact contract) and 1 Medium + 5 Low clarity gaps, all remediated in place: HM-REC contract added (§9.3); R-COLD/P-WARM and R-BASE references now come from an untimed preparatory pass; M-BASE controller-listener work and `catalog.calls.list` covariate clarified; M-REC editor-view state and per-cell fixture reuse/reset stated; HB-WARM `T`→`T1`; instrumentation access path disclaimer added; §4.2 "frozen" qualified by §18 owner confirmations. No unresolved findings known. No Codex review was run.

## Residual limitations

1. Some harness-level details (exact `CREATE`/`selectAB` intent sequences for Family M test-records, recording-bridge `presentGroup` logging, VM first-page identity field names) are specified as behaviors but their exact field names are resolved in the harness specification; if the recording bridge does not log `presentGroup`, a counting wrapper at the bridge port is calibration support code under §17.
2. Family M test-record creation at 10,000 may exceed the 120,000 ms setup timeout; such cells are recorded `NOT EXECUTED — setup timeout`, never omitted.
3. R-BASE S1/S2 reference lists are recorded in the first warm-up and frozen (tie-break order not predicted).
4. Both UNIFORM and SKEWED profiles are kept for every mandatory R scenario (protocol §18 item 1 flags this for owner confirmation).
5. Headed HB-* sentinels depend on finding name-only tokens in real element names; otherwise `UNAVAILABLE — sentinel not provable`.
6. Headed timings exclude Viewer work, so Q6 is answered from UI-render timing, long tasks and correctness checks only.
7. The full original internal review remains only in ignored `.codex-worker` state (not durably retained); this remediation was not re-reviewed by Codex.

## Protected boundaries

Confirmed unchanged: production code, tests, spec, plan, upstream P0 final report, CTM-7, Addendum B, Core/collision/Viewer Adapter/host, theming/selection, persistence/history, grouping semantics, public limits. Deferred items (CTM-7 L1–L8, Addendum B L1/L2, O-1…O-4, navScope, GP-F1) not pulled in.

## Commit / push state

Uncommitted, unpushed. No commit created because the handoff was updated.

## Next gate

**Targeted Independent Work re-review of the remediated CTM-8 P0 protocol (`CTM8-P0-v2`).** CTM-8 calibration execution and execution-support code remain **unauthorized**. Must not begin: harness/generator/observation code, calibration or headed runs, evidence creation, protocol/spec/plan/production/test edits beyond authorized remediation, commit/push, another CTM-8 package.
