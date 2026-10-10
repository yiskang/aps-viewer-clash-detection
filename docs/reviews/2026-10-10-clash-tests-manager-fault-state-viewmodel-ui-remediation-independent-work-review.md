# Clash Tests Manager Fault-State ViewModel/UI Remediation — Independent Work Review

**Date:** 2026-10-10  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
**Origin relation:** `HEAD == origin/main`  
**Verdict:** **Revise the implementation plan before owner implementation authorization.**  
**Findings:** **0 Critical / 0 High / 1 Medium / 1 Low**

## Review boundary and repository state

This was the requested targeted re-review of only the prior remaining Medium fault-state ViewModel/UI finding and the directly affected implementation-plan, package-report and handoff changes.

At review start, the working tree was dirty, uncommitted and unpushed with documentation only. The branch and origin remained aligned at `ea533997dc62543aac47c28628e095e62a7b90ea`. No Clash Tests Manager production or test implementation existed.

Reviewed artifacts:

- remediated plan: `docs/superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md`;
- upstream package report (read-only): `docs/research/2026-10-10-clash-tests-manager-implementation-plan-final-report.md`;
- prior governing review: `docs/reviews/2026-10-10-clash-tests-manager-implementation-plan-remediation-independent-work-review.md`;
- current handoff: `docs/handoffs/latest.md`;
- current editor intent/ViewModel/render contracts in `clashpanel/core/intents.js`, `clashpanel/core/viewModel.js` and `clashpanel/ui/render/{setup,run,filters,results,selected,panel}.js`.

No production, test, spec or implementation-plan text was modified by Work. The plan's proposed tests were not executed as implementation evidence. Structural checks used the current codebase graph plus direct source reads; all relied-on source paths matched the indexed generation with no recorded coverage issue.

## Confirmed sound areas

### `FAULT_POLICY` meaning remains fail-closed and unchanged

The policy still classifies the complete planned 39-intent vocabulary as 20 allowed and 19 blocked. The existing independent allow-list test, exact-key-set comparison against `Object.values(INTENT)`, and `FAULT_POLICY[intent.type] !== ALLOW` dispatch guard preserve fail-closed behavior for a missing or newly added intent.

The blocked meanings remain unchanged: setup edits, New test, Run, Release-and-retry, row selection, Previous/Next, Focus, Isolate, Markers, Back to All, and the two manager-only editor seams. The allowed meanings remain unchanged: filters, grouping, sorting, paging, setup collapse, Focus-on-select, Stop, Clear and its confirmation, confirmation cancel, Panel hide/show and diagnostics.

### The ViewModel overlay covers the intended control families without mutating the editor

`lockedEditorVm(editorVm, reason, policy)` is a copy-only manager-layer overlay. It covers:

- setup edits through `setup.locked`, plus New test and Use current selection;
- Run through `run.canRun/run.locked` and Release-and-retry through the banner action gate;
- result selection through `results.select`, Previous/Next through `results.nav.locked` and false navigation gates;
- Focus, Isolate, Markers and Back to All through the existing selected-action gate shape.

Allowed state is carried through unchanged, including filters, group/sort/page, Focus-on-select, Stop, Clear, diagnostics and the setup collapse toggle. Banner actions consult the policy dynamically and fail closed when their intent is absent from it.

The plan applies the overlay only in the manager-composed `viewModelOf` while terminal-faulted. When not faulted, the composite editor object is the editor's own `getViewModel()` object by identity. While faulted, the source editor ViewModel remains unchanged. That preserves AC-M13: the standalone editor, its own ViewModel and its current renderers are not mutated by the overlay.

### `FAULT_CONTROLS` is structurally exhaustive and covers alternate variants

The table maps 35 user-facing editor intents and separately declares the four non-body intents (`TEST_LOAD`, `TEST_LABEL_SCOPE`, `PANEL_HIDDEN`, `PANEL_SHOWN`). The union/disjoint guard equals the complete 39-intent vocabulary. Every mapped entry has a ViewModel gate and one or more DOM selectors.

The two mutually exclusive dispatch sites found by internal review are now explicit variants:

- `RESULTS_CLEAR`: the normal Clear results control plus the admission banner's Clear-results action;
- `FILTER_CLEAR`: the filters-region control plus the empty-filtered results control.

Both the ViewModel and DOM equivalence tests iterate the main and variant fixtures. The policy-to-overlay checks would fail when a mapped intent moves between allow/block without a corresponding overlay update. This closes the internal-review variant-coverage gap at the plan level.

## Medium finding

### M1 — A faulted result row is marked disabled but remains focusable and activatable

**Type:** implementation-plan completeness and user-interaction correctness  
**Affected plan:** Task 11 `FAULT_LOCKS` / `lockEditor` and its DOM equivalence test (`plan:4216–4252`, `3997–4031`)  
**Affected current renderer:** `clashpanel/ui/render/results.js:19–29`

For native controls, Task 11 sets the real `disabled` property, which prevents interaction. A result row is an `li role="option"`, so `lockEditor` only adds `aria-disabled="true"` and `aria-describedby`. That communicates a disabled state but does not implement one:

- the row retains `tabindex="0"`;
- its click handler still dispatches `NAV_SELECT`;
- its Enter/Space handler still dispatches `NAV_SELECT`.

The proposed DOM test checks only the `disabled`/`aria-disabled` attributes and fault description. It never attempts pointer or keyboard activation. Therefore it passes while the row remains interactive and terminal-fault dispatch silently drops the resulting intent—the exact behavior the remediation was intended to eliminate. The row also has no specified disabled visual treatment, so `aria-disabled` alone does not establish that it is visibly disabled.

**Minimum correction:** keep the fail-closed manager dispatch, but make a faulted result row genuinely non-interactive in the manager-composed layer. The plan must specify and test all of the following:

1. remove it from the tab order while faulted;
2. suppress click, Enter and Space activation before the editor row handler dispatches;
3. retain `aria-disabled="true"` and the terminal-fault `aria-describedby` relationship;
4. provide a deterministic disabled visual state consistent with the other locked controls;
5. add a non-vacuous DOM test proving pointer and keyboard activation emit no intent, while an unfaulted row still dispatches normally.

This can remain manager-only—for example, through bounded post-render event suppression/attributes in `renderManagedPanel`—so AC-M13 need not be reopened. A backward-compatible optional gate in the result renderer is also possible, but the plan would then need to reconcile its current claim that the five editor renderers remain unchanged.

## Low finding

### L1 — Task 9 Step 2 describes the wrong red-stage failure

**Type:** executable-plan wording defect  
**Affected plan:** Task 9 Step 2 (`plan:3259–3262`)

The augmented Task 9 test module imports the not-yet-created `FAULT_POLICY` export before Step 3 implements it. The Step 2 command therefore fails at module linking before it can reach the stated notification-first and `vm.fault` assertions. “Expected: FAIL” is directionally correct, so this cannot create a false green and is not an architectural or implementation blocker.

It should nevertheless be corrected before implementation authorization because the plan is intended to be executed task-by-task and its red-stage expected failure should match the actual first failure. The minimum wording correction is to name the missing `FAULT_POLICY` export/module-link failure first, with the older recovery assertion failures described only as subsequent failures after that export exists.

## Acceptance/readiness adjudication

- **Result-row selection:** not closed; still interactive despite `aria-disabled`.
- **Previous/Next, Focus, Isolate, Markers, Back to All:** adequately disabled with native control state and terminal-fault reason.
- **Setup edits, Run, Release-and-retry:** adequately covered by the overlay and managed DOM lock.
- **Allow-listed actions:** preserved unchanged by the overlay/lock design; main and alternate rendered variants are covered.
- **Policy/table equivalence:** structurally exhaustive over all 39 intents and both alternate variants, but its DOM assertion is insufficient for non-native result-row activation.
- **AC-M13:** preserved by the current manager-only overlay and source-ViewModel immutability tests.

The upstream package report and handoff currently state that the Medium is remediated. That statement is incomplete because the result-row path remains activatable. Work preserved the upstream report unchanged; the responsible plan package must correct the plan, its final report and the handoff after applying the bounded correction.

## Verification and protected boundaries

- Verified branch, HEAD, origin relation and docs-only working tree from disk.
- Inspected the exact planned policy, overlay, mapping table, main/variant fixtures, core equivalence tests, DOM lock and DOM assertions.
- Inspected the current result-row, banner, setup, filter, navigation and selected-action renderers.
- Did not execute the plan's proposed new tests.
- Did not start implementation, CTM-7, CTM-8 or any Core/Adapter/collision/downstream work.

## Verdict and authorization

The final fault-state remediation is **not yet ready for owner implementation authorization**. One bounded Medium correction is required for actual result-row non-interactivity, plus the Low Step 2 wording correction should be made in the same plan-only pass.

**Exact next authorized action:** bounded documents-only plan remediation of the result-row interaction/visual/test contract and Task 9 Step 2 expected-failure wording; responsible package-agent correction of its read-only final report and handoff; then a targeted independent Work re-review of those changes only.

**Must not begin without explicit owner authorization:** implementation, execution of proposed tests as implementation evidence, production/test/spec edits, commit/push, CTM-7, CTM-8 or protected Core/Adapter/collision/downstream work.
