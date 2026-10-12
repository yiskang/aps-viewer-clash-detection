# CTM-8 P0 — Calibration Protocol Design: Package Final Report

Date: 2026-10-11 · Package: docs-only CTM-8 P0 · This report is the package completion report; the protocol itself is a separate artifact.

- **Protocol artifact:** [`2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md`](2026-10-11-ctm-8-rebuild-cost-calibration-protocol.md) (version CTM8-P0-v1).
- **Authorization:** owner P0 authorization and decisions ([prompt](../prompts/ctm-8-p0-calibration-protocol-design-prompt.md)); governed by spec gate table (:986, PD-14, AC-P11), plan G-PERF (:4675/:4678) and the [CTM-8 entry review](../reviews/2026-10-11-ctm-8-entry-gate-independent-work-review.md) (OWNER DECISION REQUIRED → resolved by that authorization for P0 only).

## Repository state

`main` == `origin/main` == `ac5bcb42b00e668442ce3add9764cba96d883309` at start (verified: 0/0 ahead/behind; CTM-7 closed; Addendum B checkpoint present; no CTM-8 implementation/calibration existed). Working tree after this package: untracked/modified docs only — the two prompt files, the entry review, the protocol, this report, `docs/handoffs/latest.md`. No commit, no push.

## Delivered

- Protocol covering all 17 required items: purpose/non-goals, measurement questions Q1–Q7, scenario matrix with normative per-scenario contract, headless protocol (timing boundary pseudocode, subscription topology, public-observable predicates, repetition/launch/ordering/outlier rules), headed protocol (corroboration only, justified subset, combined stop condition), metrics, timing-boundary table, cold/warm policy, selected-group path, fixtures/provenance, environment, statistics, evidence layout, execution-report contract, interpretation rules, protected boundaries, execution gate.
- **Design decisions flagged for review:** (1) "records × models" split into Family M (manager test records) and Family R (results records) because the repo uses the phrase for the manager while the owner's selected-group/cold-label paths exist only in the results panel; (2) full Cartesian headless matrix, reduced headed subset; (3) three mandatory process launches; (4) primary subscribed topology plus separate `-PULL` scenarios.

## Files changed

Added: protocol, this report, entry review (previous package), P0 prompt (owner-provided). Modified: `docs/handoffs/latest.md`. No production code, tests, spec, plan or historical report changed. No benchmark code created.

## Verification

Docs-only; no tests run (none apply). Verified instead: repository state commands above; protocol facts were taken from source by read-only research and checked against file:line (controller.js, testsManager.js, labels.js, constants.js, harness support). Not independently re-verified by me: the claims about `fakeScheduler.advance` semantics, which come from the Codex review.

## Internal review

One Codex `spec` review (medium). Result: "Requires major revision" — 5 Critical (debounce timing boundary contradiction; non-comparable R scenarios; private-state predicates; unspecified subscription topology; undefined Family M model dimension/mutation) and 5 High (fixture/filter dimensions; launch/randomization contradiction; GC exclusion bias; headed engine-cap statement; undefined headed stop condition). **All ten were remediated in the protocol** (normative pseudocode, scenario contract table, sentinel-query warm predicate, subscribed topology, §9b manager fixture schema, mandatory launches and paired deltas, natural GC retained, cap wording corrected, combined stop condition). The remediation was **not re-reviewed** by Codex; it is left for the independent Work review per the review-boundary rule, which targets changed areas. No unresolved findings known to me.

## Open items for Work / owner

1. Confirm/narrow Family M vs R. 2. Repetition counts/launches adequacy. 3. Authorize calibration-only `test/` support code and any observation seam (not authorized by P0). 4. Accept `NOT REACHABLE HEADED` outcomes. 5. Whether a pull-only variant is wanted. 6. Warm-predicate feasibility via public API is unproven; may be UNAVAILABLE.

## Deferred / protected

L1–L8, Addendum B L1/L2, O-1…O-4, navScope, grouping semantics, persistence/history, Core/Adapter/collision/host, G2/C6/C8/G3/R20-1 untouched. No limits, budgets, thresholds, scalability claims introduced.

## Commit/push state

Uncommitted, unpushed.

## Next gate

**Independent Work Review of CTM-8 P0.** CTM-8 calibration execution remains **unauthorized** until the owner decides after that review. Must not begin: harness/benchmark code, any measurement, headed runs, instrumentation, commit/push.
