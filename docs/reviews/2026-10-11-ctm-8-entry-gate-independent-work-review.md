# CTM-8 Entry Gate — Independent Work Review Report

Date: 2026-10-11 · Scope: CTM-8 entry gate and exact first package · Review-only (no production/test/commit/push).

## Verdict

**OWNER DECISION REQUIRED**

The owner's entry authorization is real (the review prompt), but the repository defines CTM-8 only as a one-line, deliberately unspecified calibration *gate* — not a task, protocol or package. No first package exists in any governing artifact. The smallest honest first package (a docs-only calibration-protocol design) is a design/spec step that needs its own explicit owner authorization and several product decisions. Nothing is broken; this is a specification gap, not a prerequisite failure.

## 1. Repository state (verified directly)

| Item | Value |
| --- | --- |
| Path | `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` |
| Branch | `main` |
| HEAD | `ac5bcb42b00e668442ce3add9764cba96d883309` (matches expected checkpoint) |
| `origin/main` | `ac5bcb42b00e668442ce3add9764cba96d883309`; ahead/behind `0 / 0` |
| Working tree | only untracked `docs/prompts/ctm-8-entry-gate-independent-work-review-prompt.md` (the entry prompt) |
| HEAD commit | `feat(clash-panel): add aggregate group presentation` — 11 `clashpanel/` JS files (+ CSS), tests, docs, evidence PNGs; no Core/Adapter/collision/host/`markers.js`/`fit.js`/`isolation.js` change |
| CTM-8 work on disk | **None.** No CTM-8 branch, stash, commit, harness or script; `test/performance/*` is the older M4 collision-engine harness, not CTM-8. Commits mentioning CTM-8 (`ac5bcb4`, `9e49f40`, `85aee23`, `fdb8643`, `8c102cb`) all state it was not run. |

## 2. Governing artifacts

- Spec: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (gate table :986; PD-14 :120; §27 :1028/:1095/:1114).
- Plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md` (G-PERF :4675; CTM-8 row :4678; P-16 :4702; :4833; :4841).
- Handoff `docs/handoffs/latest.md` used as navigation only.

## 3. Exact CTM-8 definition (everything the repo says)

- Spec :986: "Manager ViewModel rebuild cost with many records × models is unmeasured; no record-count limit is introduced (PD-14) — verification/calibration gate".
- Plan :4675 (G-PERF): owner decided 2026-10-10 the manager stays default-on; CTM-8 is "a **mandatory later calibration gate before any product/performance closeout**. No scalability claim and no record limit is made before that measurement."
- Plan :4678: "**Mandatory later gate** (G-PERF) … not part of this plan's tasks; no timing assertion is added; not authorized."
- Plan :4841: "CTM-7 … and CTM-8 (calibration) are intentionally gates, not tasks."
- Spec §27 and Addendum B treat CTM-8 only as out-of-scope and state their headed evidence "must not be described as CTM-8 calibration or performance evidence" (plan :4940).

**Not defined anywhere:** objective beyond the above, protocol, task list, acceptance criteria / AC-ID, fixtures / record×model counts, performance budget or thresholds (explicitly forbidden pre-measurement), evidence matrix and output location, measurement method (headless vs headed), owner-authorization text in a governing artifact.

Code that a calibration would measure (for the future protocol): derived-row cache `derivedOf`/`viewModelOf` in `clashpanel/core/testsManager.js` (~:64, :111, :156, :672-708), renderer `rebuild` in `clashpanel/ui/dom.js:52`; existing call-count-only test `test/clashpanel/core/testsManager.core.test.mjs:157-169` (P-16). Addendum B adds `groupSelectedInput` (re-resolves membership O(members×2) per VM build while a group is selected) — a documented CTM-8 *candidate* measurement dimension, not CTM-8 work.

## 4. Prerequisite verification

| Prerequisite | Status |
| --- | --- |
| CTM-7 closed at owner-ratified checkpoint (`9e49f40`; ratification record; F-1 Option B accepted 0C/0H/1M/0L) | Satisfied |
| CTM-7 residual INCONCLUSIVE (D held-unsaved, J fault/recovery, H6) | Recorded as prior coverage; no artifact makes them a CTM-8 gate |
| Addendum B checkpoint (`ac5bcb4`; Independent Work Review CONDITIONAL PASS 0C/0H/0M/2L; offline 5695/5694 pass/0 fail/1 todo, DOM 147/147; headed 10 PASS) | Satisfied; does not alter CTM-8 entry assumptions (no change to the row-derivation algorithm beyond a `selected` flag) |
| Owner entry authorization | Present in the entry prompt only; **not yet recorded in any governing artifact** (recorded now in the handoff) |
| CTM-8 spec/plan section, protocol, fixtures, budget, evidence matrix | **Missing** — gate blocker for any *measurement/implementation* package, by design |
| Owner decisions on calibration scope | **Outstanding** (see §8) |

## 5. Findings

- **Critical / High / Medium: none.**
- **Low L-A (documentation, non-blocking):** stale historical wording — plan :4898 heading "Addendum B … PLANNED ONLY; IMPLEMENTATION NOT AUTHORIZED" (implemented in `ac5bcb4`); plan :4900 "must receive a separate owner implementation authorization" (authorization given and used); plan :4715 and :4832 ("CTM-7 … not authorized"/"gate only", CTM-7 now closed); plan :4853 Addendum A "NOT IMPLEMENTED" (checkpoint committed); spec §27 header (:1028) "authorize implementation" clause. None blocks CTM-8 (the CTM-8 and CTM-7 clauses remain true; `latest.md` is the status authority). Minimum correction: one-line status notes in a future authorized docs package; historical artifacts are not rewritten per `CLAUDE.md`. Not edited here.
- **Low L-B (process):** the entry authorization lives only in an untracked prompt. Mitigation: recorded in the handoff by this review.

## 6. Authorization interpretation

The entry authorization permits *entering the CTM-8 gate*. Combined with the governing artifacts it is **not sufficient** to authorize any named package, because (a) the plan states CTM-8 is "not part of this plan's tasks", and (b) the entry prompt itself says it does not authorize production code and forbids bypassing a research/design/planning gate. Measurement or code before a protocol exists would also risk violating PD-14/AC-P11 (no timing assertion, record limit, or scalability/calibration claim before measurement). A narrower explicit authorization is required.

## 7. Deferred work (nothing pulled into CTM-8)

Addendum B L1 (~4 ms false "No clashes match" flash) and L2 (report prose counts); CTM-7 L1–L8 and the two CTM-7 package Lows; O-1…O-4 (hide-versus-departure is O-2); single-clash transient-filter `navScope` cold-pass loss; optional GP-F1 polish; upstream Minor B3 M2. None is required by CTM-8's governing text; all remain deferred. L1 is only relevant to CTM-8 if the owner chooses to include the cold-label path in the protocol.

## 8. Unresolved owner decisions

1. Authorize the first package: a **docs-only CTM-8 calibration protocol design** (recommended), or direct a different first package.
2. Measurement method: headless harness (test-double ports, deterministic, in-repo) and/or headed live-Viewer measurement.
3. Scale targets (records × models) to measure — as exploration points, not limits (PD-14).
4. Whether measurements include the selected-group membership path and cold-label refresh (ties to Addendum B L1).
5. Pass/fail semantics: report-only characterization vs. any later budget (a budget must not be set before measurement).

## 9. Exact first CTM-8 package (recommended; not yet authorized)

**CTM-8 P0 — Calibration protocol design (docs-only, non-implementation).** Executor: Claude/Codex (package agent) under the internal review loop, then independent Work review.
- Expected to change/add: one new design/protocol document (e.g. `docs/research/<date>-ctm-8-calibration-protocol.md`), its package final report `docs/research/<date>-ctm-8-calibration-protocol-final-report.md`, `docs/handoffs/latest.md`.
- Must remain untouched: all production code, all tests, spec/plan bodies, upstream final reports, Core/Adapter/collision/host, `markers.js`/`fit.js`/`isolation.js`.
- Required content: objective, measured quantities (derived-row rebuild, VM build, render rebuild, selected-group path), fixtures and N×M exploration points, method, environment capture, evidence matrix/output location, explicit statement that no limit/budget/scalability claim results, follow-on gate.
- Stop condition: protocol + final report + handoff written; internal review converged; stop for independent Work review.
- Next gate after P0: Independent Work review, then separate owner authorization for a measurement-harness/execution package (implementation or headed), which is not authorized by anything today.

## 10. Exact next authorized action

**Currently authorized: none beyond this gate review.** Recommended (requires owner confirmation): authorize CTM-8 P0 above as a docs-only package.

## 11. Must not begin yet

Any CTM-8 measurement, harness, benchmark or production/test code; setting any record limit, timing assertion or budget; scalability claims; L1–L8 / Addendum B L1/L2 / O-1…O-4 / navScope remediation; spec/plan/historical-report edits; persistence/history; Core/Adapter/collision/host; G2/C6/C8/G3/R20-1; commit/push; any second CTM-8 package.
