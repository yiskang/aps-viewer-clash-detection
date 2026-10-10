# Clash Tests Manager final implementation-plan correction — targeted Independent Work Review

Date: 2026-10-10

## Verdict

**Ready for owner implementation authorization.** The bounded Task 11 result-row correction closes the prior Medium finding, and the Task 9 Step 2 red-stage wording closes the prior Low. This review grants no implementation authorization.

Findings: **0 Critical / 0 High / 0 Medium / 0 Low** in the authorized bounded scope.

## Repository state and review boundary

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch: `main`
- HEAD: `ea533997dc62543aac47c28628e095e62a7b90ea`
- Origin relation: `HEAD == origin/main`
- Working tree: dirty, uncommitted and unpushed; documentation changes only. No manager production or test implementation exists.
- Governing design: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`, §26.
- Reviewed plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`, Task 11 result-row fault lock and Task 9 Step 2 only.
- Prior authority: `docs/reviews/2026-10-10-clash-tests-manager-fault-state-viewmodel-ui-remediation-independent-work-review.md`.
- Upstream package report: `docs/research/2026-10-10-clash-tests-manager-implementation-plan-final-report.md`, read-only during this review.

No implementation, test, spec, plan or upstream-report text was changed. The plan's proposed tests were inspected as executable acceptance design but were not run or treated as implementation evidence.

## Task 11 — terminal-fault result-row contract

The correction is internally consistent with the current renderer:

- `results.js` creates each row as an `li[role=option][tabindex="0"]` with ordinary bubble/target-phase `click` and `keydown` listeners that dispatch `NAV_SELECT`.
- Planned `lockRow` removes `tabindex`, sets `data-fault-locked="true"`, preserves `aria-disabled="true"`, and points `aria-describedby` at the manager fault alert. If focus was restored to that row by the editor's existing keyed rebuild, `lockRow` blurs it after render.
- Planned `guardLockedRows` is installed once on the persistent manager editor host. Its capture-phase `click`, `keydown` and `keyup` listeners call `preventDefault()` and `stopImmediatePropagation()` for a target inside a locked row. Because that host is an ancestor of the row, the guard runs before the row's existing non-capture handlers and prevents click, Enter and Space from reaching `NAV_SELECT`.
- The disabled presentation is deterministic: opacity `0.4`, cursor `default`, no unselected-row hover highlight and no focus-visible outline. The semantic fault reason remains exposed through the alert relationship.
- Leaving terminal fault rebuilds fresh rows from the unchanged editor renderer. The persistent guard sees no `data-fault-locked` marker and therefore does not intercept their events.

### DOM acceptance-test non-vacuity

The planned test exercises the same row and the same input paths across all three states:

1. Before fault, two synthetic clicks, synthetic Enter/Space, a real forced click, and real Enter/Space yield seven `NAV_SELECT` intents; both rows appear in the real Tab sweep.
2. During fault, the intent count stays unchanged after those same actions, focus is removed, neither row appears in the Tab sweep, and the ARIA/visual lock is asserted.
3. After leaving fault, the lock attributes are absent and the same seven actions dispatch again.

This is a behavioral proof plan, not a markup-only assertion. The idempotent second fault render also exercises the focus-restoration/blur sequence.

### AC-M13

AC-M13 remains preserved. `lockRow`, `guardLockedRows`, the marker attribute and the disabled CSS exist only in the proposed manager renderer. The standalone editor's ViewModel, `getViewModel()`, result renderer and event contract are unchanged.

## Task 9 Step 2 — red-stage wording

The wording now identifies the actual first failure: the recovery test statically imports `FAULT_POLICY`, while the export is not introduced until Step 3, so the module fails to link before any test executes. The later notification-first and fault assertions are correctly described only as subsequent red failures once the export exists.

## Residual-note adjudication

### Exact Chromium computed-style values

**Non-blocking implementation-time test detail.** The proposed values are grounded in the plan's own injected hover rule and higher-specificity manager CSS. If Chromium serializes an equivalent value differently in the eventual implementation environment, the test expectation may be adjusted without weakening the required deterministic disabled presentation. That does not require another plan correction.

### Scrollable result-list container as a possible Tab stop

**Acceptable; no plan correction required.** The contract requires locked result rows—not the read-only scroll container—to leave the Tab order. A browser making the scrollable listbox itself focusable neither reaches a row handler nor dispatches `NAV_SELECT`; it can preserve keyboard access to scroll/read retained results. The planned test correctly asserts that no `.clash-row` becomes a Tab stop while faulted rather than imposing a browser-specific container-focus rule.

## Verification and gaps

- Independently inspected the current Task 9 and Task 11 plan text, the proposed manager renderer/test, the current `results.js`, `dom.js`, panel/CSS behavior, the prior Independent Work Review, the read-only upstream report and the current handoff.
- Codebase-memory index matched HEAD and reported no recorded coverage issue for the relied-on files; material source was also read directly.
- `FAULT_POLICY` meaning was not changed by this correction and remains fail-closed as accepted by the prior review.
- No proposed test was executed. Correctness here is implementation-plan readiness, not implementation evidence.

## Readiness and authorization

No blocker remains in this bounded correction. The Clash Tests Manager implementation plan is ready for an explicit owner implementation-authorization decision.

**Exact next authorized action:** none beyond this review/handoff update. The owner may next authorize implementation of the reviewed 13-task plan.

**Must not begin without explicit owner authorization:** implementation; production/test/spec/plan edits; CTM-7 or CTM-8 execution; commit/push; persistence/history/lifecycle/rebinding/background-run work; G2/C6/C8/G3; reflected-fragment or R20-1 work; Core, Viewer Adapter or collision changes.
