# CTM-8 P0 v2 Correction — Package Final Report

Date: 2026-10-11 · Package: bounded docs-only correction of `CTM8-P0-v2` → **`CTM8-P0-v3`**. Preserved unchanged as history: the original [P0 final report](2026-10-11-ctm-8-p0-calibration-protocol-final-report.md) and the v2 [remediation final report](2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md) (which carries only a one-line "superseded by" pointer; its figures below are corrected here, not rewritten there).

## Repository state

`main` == `origin/main` == `ac5bcb42b00e668442ce3add9764cba96d883309` (0/0), verified before editing. Tree: docs only, uncommitted and unpushed (modified `docs/handoffs/latest.md`; untracked prompts, reviews, research artifacts). CTM-7 closed; Addendum B checkpointed; no CTM-8 harness, generator, seam, instrumentation, evidence or calibration exists. No production code, tests, spec or plan changed. No commit, no push.

## Governing inputs

- Failed review: [P0 v2 targeted Independent Work Review](../reviews/2026-10-11-ctm-8-p0-v2-targeted-independent-work-review.md) — **FAIL; 0 Critical / 2 High / 1 Medium / 0 Low** (H-01, H-02, M-01).
- Authorization: [bounded correction prompt](../prompts/ctm8-p0-v2-bounded-docs-only-correction-prompt.md).
- Corrected protocol: [`2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`](2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md), **`CTM8-P0-v3`**.

## Dispositions

| Finding | Correction | Protocol |
| --- | --- | --- |
| **H-01** Family R mandatory scope | Mandatory Family R is **UNIFORM only**; SKEWED retained as optional targeted refinement (definition kept for future use), excluded from counts, required execution, completeness denominator, headed mandatory scope and open decisions. All counts recomputed (below); no stale SKEWED-inclusive totals remain in the protocol. | §4.1–§4.3, §6.2, §11, §18 |
| **H-02** Family M fixture | Source path corrected to `test/clashpanel/core/testsManager.integration.test.mjs` (`setup()` 14–27, `selectAB` 28–31, `confirm` 39; verified on disk). Exact ordered public sequence frozen per `n_models` (see below), including naming, activation, intents/payloads, no-confirm rule, readiness predicates, reset/disposal, and compatibility with M-BASE/M-REC/M-HIT. `selectAB` is explicitly **not** the contract. The earlier "all remaining keys"/`mC`-always/duplicate-name assumptions were replaced by source-verified rules (harness always has `mA`,`mB`; names unique). | §5.1, §6.1 |
| **M-01** falsely-open decisions | Moved to **§18.1 Resolved owner decisions**: UNIFORM-only, SKEWED optional, 30 s timeout, cell-local 3-consecutive-failure rule (+ distinct `GLOBAL_FAILURE`), headed Family M `5/25/100 × 1/3`, unreachable-point dispositions, public-sentinel-only observability, no seam. §18.2 leaves one decision: whether to authorize the execution/support-code package after a clean targeted re-review. | §7.6, §9.2, §18 |

## Exact final mandatory campaign

| Quantity | Per launch | 3 launches |
| --- | ---: | ---: |
| Family M cells (3 × 4 × 3) | 36 | 108 |
| Family R cells (4 × 4 × 3 × 1 profile) | 48 | 144 |
| **Total cells** | **84** | **252** |
| Warm cells (M 36 + R 36) / cold cells (R-COLD 12) | 72 / 12 | 216 / 36 |
| Measured samples (72 × 30 + 12 × 15) | 2,340 | **7,020** |
| Warm-ups (72 × 5) | 360 | **1,080** |
| Measured + warm-up operations | 2,700 | **8,100** |

Superseded (SKEWED-inclusive) values 132 / 396 / 10,800 / 1,620 / 12,420 are no longer mandatory anywhere in the protocol.

## Exact Family M fixture contract (summary; normative text is protocol §6.1)

Fresh `setup(opts)` per cell per launch (`extraModels:[mC]` only for `n = 3`); one no-op subscriber before building. For `i = 1…N`: (`manager/create` if `i > 1`), `setup/name` = `CTM8-M-<N>-<n>-<i>`, `setup/toggleModel` A=`mA`, then Set B by `n`: **1** → B=`[mA]` (toggle `mA`, `selfClash` stays false); **2** → B=`[mB]`; **3** → B=`[mB, mC]` (two toggles). Identical for every record (no rotation). Then `manager/viewList`; readiness predicates on count, names, `setA = 'Architecture'`, `setB = 'Architecture' / 'Structure' / 'Structure; Mechanical'`, `readiness.state = 'setup-complete'`, active id, view, no confirm. Dispose `manager.dispose()` then `await h.controller.dispose()`; never reuse a fixture across cells/launches.

## Closed owner decisions / remaining authorization boundary

Closed: see protocol §18.1. Remaining: authorization of the CTM-8 execution/support-code package (§17: harness, deterministic generator, runtime-injected headed instrumentation, mandatory-matrix execution, evidence/report writes), decidable only after a clean targeted Independent Work re-review. No observation seam or production hook is required, recommended or authorized.

## Verification performed

Docs-only; no calibration, harness, generator or tests. Source facts for H-02 extracted read-only (delegated agent) and spot-verified on disk (helper path/lines, intent constants `manager/create|open|viewList`, `setup/toggleModel`, draft defaults, VM `view`). Stale-value, SKEWED-mandatory, `-PULL`, open-decision and arithmetic checks, `git diff --check` and docs-only path check recorded in the final chat summary; results below.

## Residual limitations

1. `n = 1` uses B=`[mA]` by toggle without the `selfClash` flag (not a "self-clash" in the product sense); it exercises the same Set-A/Set-B code paths as other `n` but is a deliberate frozen choice.
2. `n = 1` catalog still contains the unreferenced `mB` (harness constraint).
3. Family M build at `N = 10,000` through the real controller may exceed the 120 s setup timeout and be recorded `NOT EXECUTED — setup timeout`.
4. The editor-side Run gate (`engine.validateTest` on A∩B overlap for `n = 1`) was not examined; it does not affect manager readiness, which the protocol uses.
5. Not re-reviewed by Codex; the targeted Independent Work re-review is the next gate.

## Next gate

**Targeted Independent Work re-review of corrected `CTM8-P0-v3`.** CTM-8 execution and execution-support code remain **unauthorized**; do not begin harness/generator/instrumentation, calibration, evidence, commits/pushes or another CTM-8 package.
