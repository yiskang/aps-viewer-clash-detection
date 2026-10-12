# CTM8-P0-v2 Targeted Independent Work Review Report

Date: 2026-10-11  
Scope: targeted re-review of the remediated CTM-8 P0 calibration protocol package; review only.

## Verdict

**FAIL — P0 REMEDIATION REQUIRED**

**Findings: 0 Critical / 2 High / 1 Medium / 0 Low.**

The prior technical H1–H5 corrections are substantively sound, and the protocol now has a viable public-sentinel cold/warm method, comparable selected-group measurement, exact timing/statistical rules, bounded headed corroboration, and a correct execution-support boundary. It is nevertheless not executable as the owner-fixed campaign: the protocol still makes SKEWED mandatory, carries the resulting obsolete 132-cell arithmetic, and leaves the Family M fixture construction dependent on a wrong source path plus an incomplete helper analogy. The remediation report and handoff repeat the obsolete campaign and still present final owner choices as open.

No calibration or support code may begin from this version.

## 1. Repository state independently verified

| Item | Verified state |
| --- | --- |
| Repository | `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` |
| Branch | `main` |
| HEAD | `ac5bcb42b00e668442ce3add9764cba96d883309` |
| `origin/main` | same SHA; ahead/behind `0 / 0` |
| Working tree before this review | docs-only: modified `docs/handoffs/latest.md`; eight untracked files under `docs/prompts/`, `docs/research/`, and `docs/reviews/` |
| Production/test changes | none in the working tree |
| CTM-7 / Addendum B | CTM-7 remains closed; Addendum B is preserved in the `ac5bcb4` checkpoint |
| CTM-8 execution state | no CTM-8 harness, generator, observation seam, calibration run, or execution evidence exists |

`git diff --check` was clean before review. The current tree is uncommitted and unpushed. No tests or calibration were run because this is a docs-only protocol review.

## 2. Authorities and inputs reviewed

- Governing design: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, especially PD-14, AC-P11, and §26.13 CTM-8.
- Governing plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`, especially G-PERF / CTM-8.
- Protocol: `docs/research/2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md` (`CTM8-P0-v2`, SHA-256 `6a988c393264016f0c75b90be8a1d7757ec096a3afce53e3221137fc1e05e3ed`).
- Read-only upstream reports: original `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-final-report.md` and remediation `docs/research/2026-10-11-ctm-8-p0-calibration-protocol-remediation-final-report.md`.
- Prior reviews: `docs/reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md` and `docs/reviews/2026-10-11-ctm-8-p0-calibration-protocol-independent-work-review.md`.
- Current owner decisions supplied with this targeted review: mandatory Family R is UNIFORM-only; SKEWED is optional; the 30-second safety timeout, cell-local three-consecutive-failure rule, and headed Family M `5/25/100 × 1/3` points are final.
- Source/API checks: `clashpanel/core/testsManager.js`, `controller.js`, `labels.js`, `viewModel.js`, and relevant `test/clashpanel/support/` plus integration helpers. The code graph was used first and its cited production-file coverage was current; test-support files flagged without freshness metadata were read directly.

The upstream reports were preserved unchanged.

## 3. Prior H1–H5 closure adjudication

| Prior finding | Result | Independent basis |
| --- | --- | --- |
| H1 private cold/warm dependency | **Closed** | §7.3 defines one public `P-WARM(T)` predicate using ViewModel fields, exact expected count, and first-page identity. Failure to prove it yields `UNAVAILABLE`; §7.4/§8 keep only R-COLD total and mark exact index-commit timing unavailable. The normative method never reads `textIndexed` or `labelsPending`. Source confirms those are private controller fields. |
| H2 headed completion | **Closed** | §9.3 fixes pre-state, action/payload, event-capture start, semantic + DOM completion, quiet confirmation, and timeout. §9.4 excludes Viewer mutation work from timing and checks it separately with public Viewer getters. HB-BASE matches R-BASE rather than comparing different operations. |
| H3 Family M mutations | **Closed for the measured transitions; fixture construction remains H-02 below** | M-BASE freezes the catalog replacement, `fire()`, completion, and reverse reset. M-REC freezes target selection, setup-name intents, payloads, predicate, reset, and intentionally included editor work. Source confirms catalog mutators do not notify until `fire()`, manager dispatch forwards setup intent to the real editor, and cache invalidation is epoch/version based. |
| H4 selected-group comparator | **Closed** | R-GROUP-WARM holds `G*` membership constant across T1/T2, checks unchanged clash count, and asserts no new `presentGroup` call. Membership-changing work is separately named and optional. Source confirms `groupSelectedInput` re-resolves current membership and `presentGroup` is a distinct Viewer path. |
| H5 false 10,000 cap | **Closed** | §9.2 and §15 call 10,000 exploratory, record configured/produced/retained/truncated counts, and require unreachable headed points to be labelled. No remaining protocol statement calls 10,000 an engine cap. |

## 4. M1–M3 / L1 adjudication

- **M1 campaign scope: not closed.** Family M and R axes are clearly labelled and `-PULL` is excluded, but §§4.1–4.2 still mandate both UNIFORM and SKEWED and therefore use the wrong campaign size. See H-01.
- **M2 fixture/statistical parameters: partially closed.** R fixtures, seeds, timeout/failure handling, repetition policy, nearest-rank p95, per-launch authority, pooling labels, and retention are exact. Family M fixture creation still requires invention. See H-02.
- **M3 remediation status: not fully closed.** The original report is preserved and no execution is claimed, but the remediation report asserts the superseded SKEWED-inclusive campaign and says the timeout/headed choices still need confirmation. See H-01 and M-01.
- **L1 support-code decision: closed.** §17 cleanly separates harness/generator/runtime instrumentation/execution/evidence authorization from an unnecessary and unauthorized observation seam.

## 5. Mandatory campaign arithmetic

Applying the owner's final UNIFORM-only Family R decision:

| Quantity | Per launch | Three launches |
| --- | ---: | ---: |
| Family M cells: 3 scenarios × 4 record points × 3 model points | 36 | 108 |
| Family R cells: 4 scenarios × 4 result points × 3 model points × 1 profile | 48 | 144 |
| Total cells | **84** | **252** |
| Warm cells: M 36 + R 36 | 72 | 216 |
| Cold cells: R-COLD 12 | 12 | 36 |
| Measured warm samples: 72 × 30 | 2,160 | 6,480 |
| Measured cold samples: 12 × 15 | 180 | 540 |
| Total measured samples | **2,340** | **7,020** |
| Warm-ups: 72 × 5 | 360 | **1,080** |
| Total measured + warm-up operations | 2,700 | **8,100** |

The protocol/report/handoff currently state 132 cells per launch, 396 cell executions, 10,800 measured samples, 1,620 warm-ups, and 12,420 total operations. Those numbers are arithmetically correct only for the unauthorized SKEWED-inclusive mandatory matrix.

## 6. Findings

### High H-01 — mandatory Family R scope contradicts the final owner decision

- **Affected:** protocol §§4.1–4.2, §6.2 framing, §18; remediation report §§Owner decisions/Exact mandatory campaign/Residual limitations; current handoff.
- **Defect:** all four mandatory Family R scenarios still require both UNIFORM and SKEWED. §18 asks the owner to decide the same question already decided. The package therefore specifies 132 rather than 84 cells per launch and repeats the obsolete totals in both status artifacts.
- **Execution-validity impact:** a conforming runner would execute 48 unauthorized SKEWED cells per launch and report the wrong mandatory denominator. Evidence completeness and campaign acceptance could not be judged against the owner's actual gate.
- **Minimum correction:** make UNIFORM the sole mandatory Family R profile; retain SKEWED only as an optional, separately authorized refinement; replace every mandatory count with the independently calculated 84/252, 7,020 measured, 1,080 warm-up, 8,100 total figures; remove the obsolete owner-open item; reconcile the remediation report through a responsible-package correction/addendum and update the handoff.
- **Blocker:** yes, blocks execution-support authorization and execution. Responsible upstream package: CTM-8 P0 protocol remediation.

### High H-02 — Family M deterministic fixture construction is not an exact executable algorithm

- **Affected:** protocol §5.1 line 80 and §6.1 line 123; remediation report §Residual limitations item 1.
- **Defect:** the protocol cites non-existent `test/clashpanel/testsManager.integration.test.mjs` and says to use “the same public setup intents” as `selectAB`. The actual helper is `test/clashpanel/core/testsManager.integration.test.mjs:28–31` and toggles only A=`mA`, B=`mB`. It does not define the protocol's required B=`all remaining catalog keys` for three models or the special one-model B=`mA` case. The remediation report explicitly defers exact CREATE/selectAB sequences to a future harness specification.
- **Execution-validity impact:** different runner authors can produce different Family M drafts/model dimensions while all claiming conformance. That changes the `records × models` work being calibrated and fails the prompt's requirement that execution not invent methodology.
- **Minimum correction:** in the protocol, state the exact ordered public intent sequence and payloads for each created record, including activation/confirmation behavior, A selection, the deterministic ordered B selections for `n_models=1/2/3`, naming, settling, and the final fixture predicates; correct the source path. A later harness may implement this contract but must not choose it.
- **Blocker:** yes, blocks execution-support authorization and execution. Responsible upstream package: CTM-8 P0 protocol remediation.

### Medium M-01 — final safety/headed choices remain falsely presented as owner-open

- **Affected:** protocol §18 items 2–4; remediation report §Residual limitations; handoff “Open for owner”.
- **Defect:** the supplied owner decisions already fix the 30-second safety-only timeout, cell-local three-consecutive-failure rule, headed Family M `5/25/100 × 1/3` points, and explicit unreachable/unavailable dispositions. The protocol still requests confirmation and says the headed list becomes final only later.
- **Execution-validity impact:** it does not make the mechanics ambiguous—the body defines them correctly—but it can cause an execution package to reopen or alter frozen choices and makes the gate state inaccurate.
- **Minimum correction:** move these items into the resolved-owner-decision list without changing their normative mechanics. Leave only execution/support-code authorization as the next owner decision.
- **Blocker:** blocks P0 acceptance/status accuracy; it does not independently require production or harness changes. Responsible upstream package: CTM-8 P0 protocol remediation.

## 7. Headed policy and protected boundaries

The headed policy is otherwise bounded and sound: Family M uses only `5/25/100 × 1/3`; Family R chooses practical natural low/middle/high result sets; 5,000/10,000 are attempted only when naturally reachable; fake data cannot be labelled real headed evidence; timing excludes unobservable Viewer work; correctness uses settled public Viewer state. No headed run has occurred.

No remediation pulled in Addendum B L1/L2, CTM-7 L1–L8, O-1…O-4, hide/departure, navScope, GP-F1, Core/collision/Viewer Adapter/host, Viewer theming/selection, persistence/history, or public performance/resource limits.

## 8. Execution-support boundary and remaining decisions

The protocol correctly requires a separate owner authorization for the headless harness, deterministic generator, runtime-injected headed instrumentation, mandatory execution, evidence writes, and execution report. No production observation hook or label-index seam is required.

After the bounded P0 corrections and a clean targeted independent re-review, the only remaining owner gate should be whether to authorize that execution/support-code package. There is no remaining owner methodology choice inside the protocol; the decisions supplied with this review are final.

## 9. Exact next action and prohibited work

**Exact next action:** the responsible CTM-8 P0 package agent performs a bounded docs-only correction for H-01, H-02, and M-01, preserves the original upstream report, issues an accurate remediation correction/addendum, updates the handoff, and stops for targeted Independent Work re-review.

**Must not begin:** calibration harness/generator/instrumentation; headless or headed execution; observation seams; evidence generation; production/test/spec/plan changes; CTM-7/Addendum B/deferred remediation; limits/budgets/scalability claims; commit/push; or another CTM-8 package without explicit authorization.
