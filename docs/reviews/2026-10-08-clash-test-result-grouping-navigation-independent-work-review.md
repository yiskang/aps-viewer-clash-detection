# Clash Test Result Grouping / Navigation — Independent Work Visual/Product Review

**Date:** 2026-10-08  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `e8969cb7d22410c25a476ee294a393eafba469a5` (`origin/main` identical)  
**Review input:** `docs/research/2026-10-08-clash-test-result-grouping-navigation-final-report.md` (read-only)  
**Governing scope:** `docs/reviews/for-claude-clash-test-result-grouping-navigation.md`; Viewer Clash Panel design §25

## Verdict

**Accepted for owner checkpoint decision.** The current single-level grouping/navigation package is visually coherent, product-usable within the accepted Viewer 7.124.2 SVF2 envelope, architecturally contained inside the existing single-test Panel, and sufficiently verified. No implementation correction is required before the owner decides whether to authorize checkpoint closeout.

Findings: **0 Critical / 0 High / 0 Medium / 3 Low**.

The working tree remains dirty, uncommitted, and unpushed. This review does not authorize a commit, push, additional product scope, or remediation of the non-blocking observations below.

## Findings

### Low L1 — Metadata reads have no completion timeout

`clashpanel/core/elementProperties.js` guards property reads by generation and chunks them, and the controller safely invalidates their results on run/model lifecycle changes. A Viewer property callback that never settles can nevertheless leave Category or Level showing the busy/flat state until a new run or model lifecycle invalidation. Switching to another mode remains possible, but returning to the pending mode does not create a second read while the first remains unresolved.

This is a real product-resilience limitation, not a correctness failure in completed reads. Design §25.7 and the package report disclose it, so it does not block this checkpoint. Any future timeout/retry policy requires separate authorization because it changes host-failure behavior.

### Low L2 — Narrow-view evidence does not establish responsive support

The 480×900 evidence keeps the grouping selector, group rows, paging, labels, and selection state legible, but the fixed-width Panel nearly fills the viewport and the Viewer toolbar overlaps the lower Panel content. This is identified in the evidence as existing Viewer behavior. It does not invalidate the grouping package, but the screenshot must not be read as proof that the Panel is fully responsive or unobstructed at narrow application widths.

The related product observations are also non-blocking: text filtering searches hidden element text from both sides, so a visible Category/Level group label can appear unrelated to the typed term; and the first Element grouping of the 4,770-result self-clash produced one 609 ms long task. Warm switches and the other grouping modes were responsive. These are disclosed limitations, not regressions introduced by the reviewed identity/navigation contracts.

### Low L3 — The upstream final report has two factual drifts

The read-only final report records 16 modified tracked files at +441/−50. The reviewed tree currently has **17** modified tracked files at **+450/−51**, plus the listed untracked package artifacts. It also says group-scoped navigation is always dropped after switching away and back. The executable contract is narrower: Element → None → Element restores the still-valid expanded Element scope, while switching through another grouped mode drops the scope because the group identity changes. `test/clashpanel/core/controller.navigation.test.mjs` verifies the flat-mode dormancy/restoration behavior.

Minimum correction, if the owner wants the upstream report exact before checkpoint closeout: the responsible package author should update only those repository-state statistics and the mode-switch observation. Work has not edited the upstream final report. Neither drift changes implementation behavior or the acceptance verdict.

## Independent product and implementation assessment

### Grouping model and identity

- The UI exposes exactly one of None, Element, Model Pair, Category, or Level. The registry-driven implementation does not introduce nesting, history, lifecycle, or manager-panel scope.
- Model Pair uses Core `pairModels` values and loaded-instance `modelKey` identity; duplicate display names are disambiguated without merging instances, and self-clash remains `A ↔ A`.
- Category and Level use stable raw-value keys independent of display labels. Both are unordered per-side pairs; missing values have explicit sentinels; display-label collisions are disambiguated.
- Level follows the owner-approved per-side metadata precedence and does not infer levels from world Z or normalize names across models.
- Property acquisition is distinct-dbId, chunked, generation-guarded, cached per run, invalidated on model lifecycle changes, and fail-closed to an unavailable flat view rather than guessed metadata.

### Filtering, sorting, and navigation

- Visible group counts are derived from filtered membership; empty groups disappear; single-valued modes retain count-total equality while Element correctly declares multi-valued membership.
- Stable group IDs, not labels, drive expansion and group-scoped navigation. Changing modes cannot accidentally reuse a different mode's scope.
- `(within its group)` appears only when the current grouped view still contains and expands the selected scope. Filtering away, collapsing, or leaving that scope removes the suffix and returns navigation to the visible list.
- Model, text, Unverified, Has location, sort, and Clear-filter interactions retain coherent rows and selection-hidden messaging. No stale grouping note appears over an empty/error list.
- Focus, guarded Isolate, markers, and Back to All remain the existing action path; the grouping package does not add Viewer mutation outside the established bridge/controller boundary.

### Visual/product evidence

Work verified `MANIFEST.sha256` and independently inspected all **46** retained PNGs. The set covers normal-app None/Element/Model Pair/Category/Level states, four principal result sets, self-clash, combined and duplicate-name model cases, filtered and empty states, group navigation, filtered-away scope, actions, Clear, and the narrow viewport. The retained classification of **46 PASS / 0 FAIL / 0 INCONCLUSIVE** is supported, with the narrow-width caveat stated above.

The screenshots were captured before the final transient property-read recovery correction. That correction changes only recovery after a failed property read and is covered by focused tests; the absence of a second headed capture is an evidence-envelope limitation, not a visual regression signal.

### Scope and architecture

- Reviewed production changes are confined to `clashpanel/core` and `clashpanel/ui/render/filters.js`; no `clashtest/`, `collision/`, Viewer Adapter, M4, G2/C6/C8, G3, or R20-1 production change is present.
- The headless controller/view-model boundary remains intact. The renderer receives declarative group-mode state and does not acquire BIM properties or mutate Viewer state.
- The implementation does not add multi-level grouping, saved-test management, history, issue lifecycle, persistence, or reflected-fragment behavior.

## Verification

- Evidence manifest: **46/46 hashes verified**.
- Focused grouping/property/DOM tests: **91/91 pass**.
- Offline suite (normal host permissions): **5,446 total / 5,445 pass / 0 fail / 1 existing todo**.
- Panel DOM suite: **102/102 pass**.
- `git diff --check`: clean.
- Graph coverage signal for relied-on `clashpanel/core`, `clashpanel/ui/render`, `test/clashpanel/core`, and `test/clashpanel/dom` scopes: no recorded issue; conclusions were also verified directly from source/tests because that signal is best-effort.

An initial sandboxed offline run produced filesystem/loopback `EPERM` errors in mutation and binding tests. The same suite passed under normal repository permissions; those sandbox errors are not implementation failures.

## Authorization / next action

The independent Work visual/product review is complete. The package is ready for an **owner checkpoint decision**. The owner may optionally authorize the bounded upstream-report correction in L3 together with checkpoint closeout.

Until explicitly authorized, do not commit or push, edit the upstream final report, start multi-level grouping or manager/history/lifecycle work, reopen G2/C6/C8 or G3, change reflected-fragment/R20-1 behavior, or remediate L1/L2.
