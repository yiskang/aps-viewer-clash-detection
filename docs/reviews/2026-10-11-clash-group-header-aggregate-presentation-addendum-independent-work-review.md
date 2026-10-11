# Clash group header aggregate presentation addendum — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD / origin:** `main` / `9e49f4036137bafd098ceb8631bcd16fff6c4da6` / `origin/main` at the same commit  
**Working tree:** uncommitted, docs-only; the pre-existing review/handoff outputs plus this package's governing spec, plan, review and handoff edits; no production or test file changed  
**Verdict:** **PASS — READY FOR OWNER IMPLEMENTATION AUTHORIZATION**  
**Findings:** 0 Critical / 0 High / 0 Medium / 0 Low

## Scope and governing inputs

This review covers only the bounded docs-only pre-CTM-8 addendum requested after the owner selected aggregate marker **Option A**. It reviews:

- [Viewer Clash Panel design §27](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md);
- [Clash Tests Manager implementation plan Addendum B](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md);
- the prior [aggregate-presentation Independent Work Review](2026-10-11-clash-group-header-aggregate-presentation-independent-work-review.md);
- current implementation seams in `clashpanel/core`, `clashpanel/viewer/ViewerBridge.js` and the results/selected renderers;
- the current [handoff](../handoffs/latest.md) and repository instructions in `CLAUDE.md`.

No upstream implementation final report is expected for this docs-only package, and none was created. Existing upstream reports were preserved unchanged.

## Repository and gate verification

- Git and the repository index agree on `main` at `9e49f4036137bafd098ceb8631bcd16fff6c4da6`; `origin/main` matches.
- CTM-7 remains closed at the owner-ratified checkpoint recorded in the handoff and history.
- No CTM-8 implementation, evidence or calibration package exists in the current diff; CTM-8 remains not started and unauthorized.
- The working tree entering this package already contained the prior review and handoff update. This package adds only the governing spec/plan addenda, this review, and the new handoff state. No production or test path was modified.

## Independent adjudication

### 1. Prior review and owner decision are represented exactly

Spec §27 and Addendum B preserve the prior review's architectural conclusion: existing `ViewerBridge.present()` is one clash with one or two sides and remains unchanged in meaning. Aggregate presentation is a separately validated sibling operation, `presentGroup()`. The owner decision is recorded as final v1 behavior: group mode creates neither witness markers nor participant outlines, and the Markers control is disabled with the exact group-specific explanation. The documents do not retain Option B as an open choice.

### 2. Interaction and selection contracts are complete

The design requires sibling native controls: disclosure dispatches only `GROUP_TOGGLE`; the row body dispatches only `GROUP_PRESENT`. It covers click, Enter and Space, bans nested controls and cross-triggering, and keeps expansion independent from selection.

The new `selectedGroupId` direction is mutually exclusive with the existing clash occurrence/nav scope. Child selection restores the existing clash path. Group selection survives disclosure changes; grouping-mode change or disappearance clears it. The selected region receives only a bounded group variant, so stale child ordinal/sides/gap/location/witness data cannot remain visible.

### 3. Participant and ViewerBridge contracts preserve architecture

Membership is derived from current filtered `memberIndexes`, visits both pair sides, and de-duplicates `{modelKey,dbId}` rather than dbId alone. Live `{model,dbId}` values exist only at action time, so the controller does not acquire Viewer-object ownership. One, two and more than two models use one path.

`presentGroup()` has independent non-empty participant validation and shares only the existing queue, supersession, held ledger, guarded isolation, fit, rollback, clear and disposal machinery. It does not fall back through `present()`, change public collision/Core/Adapter contracts, call theming/selection, or introduce a new public resource limit. Empty live membership clears old Viewer state and leaves truthful unavailable UI.

### 4. Lifecycle, fault and Back-to-all behavior are mechanically testable

The spec states filter refresh/disappearance, grouping-mode, panel-hide, model-departure/re-entry, run, Clear, active-test switch/delete and Back-to-all behavior. Back to all clears Viewer state plus both selection kinds while preserving filters/grouping/expansion/page. Panel hide follows the existing conservative clear-with-selection-retained behavior; later action re-resolves live membership.

Addendum B correctly includes `testsManager.js`, because the new user-facing `GROUP_PRESENT` intent must be classified as terminal-fault blocked while disclosure remains allow-listed. It includes only the minimal `managerViewModel.js` overlay work needed to make the new row/action state match that policy. The required `FAULT_CONTROLS` equivalence coverage prevents policy/UI drift.

### 5. Plan coverage and boundaries are sufficient

Tasks B1–B7 cover every required controller, bridge, lifecycle, renderer, accessibility, fault-equivalence, regression and closeout case. The expected production list is bounded to the reviewed seams. Marker, fit and isolation helper behavior cannot be changed without a plan amendment; private reuse from the bridge is permitted. Canonical `npm test`, `git diff --check`, exact test totals and a protected-path diff are required at closeout.

The later headed matrix includes one-, two- and greater-than-two-model groups, aggregate focus/isolation/restore, Back to all, unavailable participants, selected visuals, disabled Markers and interaction separation. It is explicitly a separate authorization gate and not CTM-8 evidence.

## Findings

No Critical, High, Medium or Low finding remains in the docs-only addendum. The specification is internally consistent with the current architecture, and the plan is implementable without silently reopening single-clash presentation, CTM-7, CTM-8, L1–L8, Core, collision, Viewer Adapter, host integration, persistence/history, Viewer theming/selection or public limits.

## Verification performed and limits

- Independently inspected the current git state, handoff, repository workflow, prior Independent Work Review, spec, plan and directly affected source seams.
- Verified the indexed structural symbols against direct source: `ViewerBridge.validateRequest`/`present`, controller selection/presentation/group toggle/lifecycle handlers, and group/selected renderers. Coverage checks reported no recorded issue for all relied-on paths; this remains a best-effort index signal, so the material contracts were also read from disk.
- Ran `git diff --check`: clean.
- Did not run tests, headed Viewer evidence or CTM-8; this package changes documentation only and claims no implementation evidence.

## Readiness and exact next gate

The docs-only design/plan addendum is accepted. No blocker remains before an owner decides whether to authorize implementation.

**Exact next gate:** owner authorization for Claude/Codex implementation of the reviewed pre-CTM-8 Addendum B correction.

Until that authorization, do not modify production/tests, create an implementation branch, run headed/manual verification, begin CTM-8 or L1–L8 remediation, change Core/Adapter/collision/host integration, commit or push, or begin another package.
