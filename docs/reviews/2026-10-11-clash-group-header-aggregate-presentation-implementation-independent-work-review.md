# Clash group header aggregate presentation implementation — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD / origin:** `main` / `9e49f4036137bafd098ceb8631bcd16fff6c4da6` / `origin/main` at the same commit (`0` ahead / `0` behind)  
**Working tree:** uncommitted and unpushed; Addendum B implementation/tests, prior docs-only addendum, headed evidence, package report, reviews and handoff are present  
**Verdict:** **CONDITIONAL PASS — READY FOR OWNER CHECKPOINT DECISION**  
**Findings:** 0 Critical / 0 High / 0 Medium / 2 Low

## Scope and authorities

This is the independent implementation review of the bounded pre-CTM-8 Addendum B group-header aggregate presentation package. Governing inputs were:

- [Viewer Clash Panel design §27](../superpowers/specs/2026-09-26-viewer-clash-panel-design.md), AC-GP1…AC-GP12;
- [Clash Tests Manager implementation plan Addendum B](../superpowers/plans/2026-10-10-clash-tests-manager-implementation-plan.md), B1…B7;
- the prior [aggregate-presentation design review](2026-10-11-clash-group-header-aggregate-presentation-independent-work-review.md) and [Addendum B plan review](2026-10-11-clash-group-header-aggregate-presentation-addendum-independent-work-review.md);
- the upstream [implementation final report](../research/2026-10-11-clash-group-header-aggregate-presentation-final-report.md), treated as read-only review input;
- the implementation, tests and headed evidence on disk.

CTM-7 remains closed at the owner-ratified checkpoint at HEAD. CTM-8 has not started. This review did not modify production code, tests, spec, plan, evidence or the upstream report.

## Repository and diff verification

- `main` and `origin/main` both resolve to `9e49f4036137bafd098ceb8631bcd16fff6c4da6`.
- The implementation is uncommitted. The actual production diff contains **12 modified files** (11 JavaScript modules plus `wwwroot/main.css`), not the upstream report's stated 11. The actual test/support diff contains **12 modified files plus 2 new test files**, not the report's stated 13 modified plus 2 new. The report's own file tables enumerate the correct files; this is finding L2 below.
- Protected-path inspection found no change under collision/Core, Viewer Adapter, host/server, `clashpanel/viewer/markers.js`, `fit.js`, `isolation.js`, package/runtime limits, CTM-8 or L1–L8 remediation.
- The only changed production seams outside Addendum B's initial expected list are `clashpanel/ui/render/manager.js` and `clashpanel/core/ports.js`. Both are required mechanical integrations: the former adds the new group-body control to terminal-fault locking without locking disclosure; the latter makes `presentGroup` a required member of the existing internal bridge port. Neither expands public API or architecture.

## Implementation adjudication

### Single-clash protection and aggregate bridge

`ViewerBridge.present()` retains independent 1–2-side validation and the existing single-clash marker/witness path. Aggregate presentation enters only through `presentGroup()`, whose request validation accepts a non-empty participant list and rejects marker options. It never calls `present()`.

Both operations share the private transaction queue, supersession token, held-state ledger, rollback, clear and disposal machinery. The group runner supplies no draw function, creates no witness marker or participant outline, and uses aggregate isolation and fit across arbitrary positive participant counts. The implementation and tests cover more than two models. Viewer mutation remains confined to `ViewerBridge`; controller and render layers carry identity and intent only.

### Participant identity and lifecycle

The controller derives membership from the current filtered group's `memberIndexes`, visits both sides of each pair, and de-duplicates by compound `[modelKey, dbId]`. Equal dbIds in different models remain distinct. Live models are resolved only when an action is dispatched; durable state retains model keys, member indexes and counts, not Viewer Model objects.

Unavailable participants are counted once per compound identity. With no live participant, the controller clears stale Viewer presentation and exposes a truthful unavailable group state. Group selection is mutually exclusive with child-clash selection. Back to All clears both selection kinds and Viewer presentation while preserving filter/group/expansion/page state. New run, Clear, active-test switch/delete, grouping-mode change, disappearance and the reviewed model-departure cases follow §27.

The reported hide-versus-departure ambiguity is pre-existing bridge/lifecycle behavior: `hideModel` does not emit the model-left event used by the controller, and the same retained-isolation behavior exists for single-clash presentation. This package does not change `isolation.js` or make the ambiguity architecturally different; it remains properly deferred.

### Interaction and selected-region contracts

The group disclosure and group body are sibling native buttons. Disclosure dispatches only `GROUP_TOGGLE`; the body dispatches only `GROUP_PRESENT`. DOM tests cover click, Enter and Space, collapsed groups, selected styling, no cross-trigger and the absence of nested interactive controls. Presenting a group does not alter disclosure state.

The selected-region group variant contains only group label/counts and the permitted Focus, guarded Isolate, disabled Markers and Back-to-all actions. It contains no child ordinal, sides, gap, location or witness. Markers use the exact group-specific visible/title/ARIA reason. Selecting a child restores the unchanged single-clash shape and presentation behavior.

### GP-F1 remediation

The original failure is reproducible from the pre-fix state described by the retained headed evidence: the first text filter ran before the label index was ready, produced a provisional empty ordered/group set, and `reconcileSelectedGroup` treated that provisional absence as final. It ended group selection and cleared isolation.

The correction adds a per-pipeline `labelsPending` token and treats a cold-label-index text pass as provisional. Group reconciliation remains dormant only while that exact warm-up is pending; the settled refresh then re-presents current filtered membership or ends selection if the group genuinely disappears. Superseded warm-ups cannot publish into a newer pipeline. This preserves lifecycle semantics without retaining stale membership or isolation.

Two focused unit cases cover the boundary: a cold matching filter retains/re-presents the group, and a cold no-match filter ends selection after labels settle. The focused controller/bridge suite passes 74/74. The cold-index no-match path was not repeated headed, but it has an exact non-vacuous unit test and the warm headed no-match case verifies the final UI/Viewer outcome. This is acceptable residual verification risk and does not require another headed run before checkpoint disposition.

The neighboring single-clash `navScope` provisional-drop behavior predates this diff. Addendum B touches the shared rebuild path only to add the group-specific pending guard; it neither causes nor worsens the existing single-clash behavior. The asymmetry is known deferred debt, not a regression in this package.

## Headed and visual evidence adjudication

The retained headed package identifies Viewer 7.124.2 and three real Audubon SVF2/OTG-loaded models. I independently inspected all **27 retained PNGs** (24 matrix screenshots plus 3 GP-F1 recheck screenshots), the 57 state captures, JSON/Markdown results, GP-F1 recheck record and manifest. `MANIFEST.sha256` verifies every retained artifact, including locally retained ignored logs.

The ten matrix items are supported by the screenshots and state evidence: one-model, two-model and three-model groups; aggregate Focus; isolation/restore; Back to All; unavailable participant; selected styling; disabled Markers; and disclosure/body separation. The GP-F1 recheck independently shows the selected group retained and re-presented with filtered membership while isolation remains continuous. Visual result: **10 PASS / 0 FAIL / 0 INCONCLUSIVE**.

No evidence is claimed as CTM-8 calibration. No screenshot shows a group marker or outline, stale child details, theming/selection mutation or cross-trigger.

## Findings

### Low L1 — provisional cold-label refresh briefly renders a false empty result state

**Affected area:** `clashpanel/core/controller.js`, results/selected rendering transition, retained GP-F1 recheck evidence.  
**Failure mode:** during the fixed cold-label matching refresh, the DOM briefly displays “No clashes match the current filters.” and removes the selected-region view for approximately 4 ms before the settled label pass restores the correct group. Viewer isolation is never cleared and the final selection/membership is correct.  
**Adjudication:** this is a real state-ordering visual artifact, not merely timing noise, because the provisional empty ordered set is rendered even though destructive group reconciliation is suppressed. It is Low: the state is transient, no incorrect Viewer mutation occurs, no durable controller selection is lost, and the final observable state is correct.  
**Minimum future correction:** if the owner chooses to remediate it, hold the prior results/selected presentation or expose an explicit pending state during the provisional label pass instead of rendering the false empty result.  
**Checkpoint impact:** non-blocking; remediation belongs to Claude/Codex only if separately authorized.

### Low L2 — upstream final-report diff counts do not match the repository

**Affected area:** upstream final report §§1 and 4.  
**Failure mode:** the prose claims 11 modified production files and 13 modified test/support files, while repository status and the report's own tables show 12 production files and 12 modified test/support files plus 2 new tests.  
**Adjudication:** the enumerated paths are complete and scope verification is unaffected, so this is a documentation inventory error rather than hidden implementation scope. The upstream report remains read-only under repository workflow.  
**Minimum future correction:** the responsible upstream package may correct only the two counts during an owner-authorized checkpoint/documentation closeout.  
**Checkpoint impact:** non-blocking; no correction is required before the owner checkpoint decision.

No Critical, High or Medium finding remains.

## Deferred observations and non-findings

- The no-live group can display the shared Isolate preference as checked while the control is disabled. The control has the truthful no-participant reason and makes no Viewer claim; this is a non-blocking product observation, not a correctness failure.
- Category/Level availability after a model leaves, root-hidden residue after restore, and hide-versus-departure remain the recorded O-1…O-4 behavior. Addendum B does not alter their underlying protected seams.
- Per-ViewModel membership cost remains a CTM-8 calibration candidate. It is not CTM-8 work and no performance conclusion is made here.
- The stricter group marker-option rejection faithfully enforces owner Option A. The failure-injection title, non-success participant count, fixture shape and untested Isolate linkage noted upstream do not create a false pass in the implementation paths reviewed.
- CTM-7 L1–L8 remain untouched and deferred.
- The Addendum B “PLANNED ONLY” heading and B7 review-before-headed sequence are historical/stale wording superseded by the explicit owner implementation/headed authorization; they do not reopen scope or invalidate evidence.

## Verification performed

- Canonical `npm test`: **PASS**.
  - offline: **5695 total / 5694 pass / 0 fail / 1 todo**;
  - DOM: **147/147 pass**.
- The sole todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio known gap and is unrelated to Addendum B.
- Focused controller/bridge suite: **74/74 pass**.
- `git diff --check`: clean.
- Protected-path diff: empty.
- Structural index results for the controller, bridge and render seams were cross-checked against direct source and tests; no relied-on file had a reported index coverage issue.

Coverage is sufficient for Element, Category, Model Pair/Level shared grouping, one/duplicate/compound-identity/>2-model participants, empty/no-live and single-child cases, collapse/filter/regroup/departure lifecycle, group-to-child and Back-to-all behavior, single-clash regression, fault equivalence, independent bridge validation, marker suppression, queue/supersession/rollback/clear/dispose, renderer separation, selected semantics and keyboard/ARIA behavior.

## Readiness, blockers and next gate

The implementation satisfies the reviewed Addendum B architecture and acceptance contract. The two Low findings are non-blocking. No implementation correction or further headed verification is required before checkpoint disposition.

**Exact next gate:** owner decision whether to authorize the uncommitted Addendum B checkpoint commit and push.

Until that decision, commit/push remain unauthorized. CTM-8, L1–L8 remediation, GP-F1 visual-polish remediation, neighboring navScope work, O-1…O-4 work, persistence/history, Viewer theming/selection, public-limit changes, Core/collision/Viewer Adapter/host changes, G2/C6/C8/G3/R20-1 and any other package or milestone must not begin without explicit owner authorization.
