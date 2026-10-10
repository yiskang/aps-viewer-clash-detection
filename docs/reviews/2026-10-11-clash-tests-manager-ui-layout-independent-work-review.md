# Clash Tests Manager — Manager UI Layout / Responsive Polish — Independent Work Review

**Date:** 2026-10-11  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`  
**Origin relation:** `HEAD == origin/main` (verified from the uploaded repository refs)  
**Working tree at review start:** docs-only, uncommitted and unpushed: modified spec, implementation plan and handoff; new package final report and task brief  
**Governing design/plan:** Viewer Clash Panel design, Manager presentation amendment currently labelled §26.13; Clash Tests Manager implementation plan Addendum A  
**Read-only upstream input:** `docs/research/2026-10-11-clash-tests-manager-ui-layout-final-report.md` (preserved unchanged)  
**Verdict:** **acceptable; ready for owner authorization of Addendum A implementation**  
**Findings:** **0 Critical / 0 High / 0 Medium / 1 Low**

## Scope and verification method

This review independently inspected `CLAUDE.md`, the handoff, the complete current docs diff, the presentation amendment, Plan Addendum A, the package final report, the prior Option A owner record, the accepted implementation review's deferred L1–L8, and the currently committed Manager renderer, DockingPanel shell and directly affected DOM tests. The handoff was used only as navigation.

The codebase-memory graph was current for the reviewed branch and identified the Manager renderer, view-switch handlers and DockingPanel boundary; coverage checks reported no recorded issue for every relied-on source, test and documentation path. Material conclusions were also verified by direct file reads and repository diff checks.

No production implementation, test, governing spec/plan text or upstream final report was modified by Work.

## Readiness verdict

The package is a bounded presentation redesign over the accepted single-panel Manager/List ↔ Editor architecture. The design and Addendum A are implementable without changing manager state, intents, controller composition, Viewer mutation ownership, result residency, public APIs or the deferred L1–L8.

The five product decisions in the current owner instruction are treated as decided and authorized product direction:

1. replace the seven-column table with a semantic list/item layout;
2. retain the 460 px preferred Panel width;
3. use compact icon actions;
4. replace ` (active)` with a visible `Active` badge;
5. deduplicate repeated visible disabled reasons while preserving every disabled control's `aria-describedby` linkage.

The final report and the pre-review handoff describe CTM-UI-OD1…3 as awaiting owner choice because they were written before this owner decision. Those statements are now superseded as gate status, not treated as open questions. The final report remains a read-only, accurate package-time record. Addendum A implementation still requires a separate owner authorization.

## Findings

### Low L1 — the presentation amendment duplicates an existing §26.13 section number

The governing spec already labels the CTM-1…11 gate table as `26.13 Gates and open items` at line 974. The new presentation contract is also labelled `26.13` at line 992. Consequently, bare references such as §26.10's “see §26.13”, Addendum A's “spec §26.13”, and the older spec final report's “gates in §26.13” are ambiguous.

This does not make the design or plan behavior ambiguous: Addendum A additionally names AC-UI1…AC-UI12, while the historical gate section names CTM-1…11. It is therefore non-blocking for owner implementation authorization.

**Minimum correction:** the responsible package agent should assign the presentation amendment a unique section number (recommended §26.14) and update its directly affected cross-references in the spec, Addendum A, package final report and handoff. Historical artifacts that accurately refer to the original gate section should remain unchanged. This correction must not alter any product decision or acceptance criterion.

## Owner-decision consistency

### List/item layout

- The spec requires a labelled `ul`, one ordered `li` per test, and a fixed reading order.
- Addendum A P1 replaces only the table/caption/head/body presentation while retaining `data-test-id`, `aria-current`, action keys, status/readiness classes and creation order.
- AC-UI1/2 and the enumerated selector edits make the structure mechanically testable without weakening the existing action/confirmation assertions.

### 460 px preferred width

- The spec keeps `min(460px, 90vw)`, the 340 px minimum and 90vw maximum unchanged; AC-UI8 requires the shell strings and view-switch width to remain identical.
- Addendum A places `ClashDockingPanel.js` and shell geometry outside the production change set and retains the existing shell DOM test unchanged.
- The responsive design therefore fixes the layout structurally rather than by widening the Panel.

### Compact icon actions

- The spec preserves native buttons, existing action order, `data-key`, accessible labels, disabled behavior, confirmation semantics and dispatch intents while specifying 28×28 px icon controls with a text fallback.
- Addendum A P2/P3 confines icon markup and CSS to `clashpanel/ui/render/manager.js`; AC-UI9 prohibits changes to shared CSS, shell, core/controller or Viewer layers.
- CSS-mask data URIs are a technical implementation choice consistent with the repository precedent; no additional owner decision remains for the icon mechanism.

### Active badge and deduplicated reasons

- AC-UI2 requires the visible `Active` badge and preserves `aria-current` as the semantic state.
- The disabled-reason contract groups equal reasons once per item, keeps each reason string byte-identical to the gate reason, and links every affected disabled button to that shared reason id.
- AC-UI4/11 and Addendum A tests cover non-operability, visible reason text, accessible linkage, action ordering and deduplication.

## Protected architecture and semantics

The package changes only the Tests-list renderer's later presentation. It preserves:

- the headless manager and one editor controller;
- one active test and active-test-only held Result Set/residency;
- ViewerBridge as the Viewer-mutating boundary and existing Viewer ownership;
- all manager ViewModel keys, intents, dispatch contracts, confirmations, live announcements, readiness/recovery and public APIs;
- existing action meaning and order: Open, Duplicate, Reset results, Delete test.

The current repository diff confirms no production or test path changed. Addendum A's zero-diff guard limits the future production edit to `clashpanel/ui/render/manager.js` and explicitly protects `clashpanel/core/**`, the DockingPanel shell, other renderers, Viewer/Core/Adapter/collision paths, ports, package files and shared CSS.

## Deferred L1–L8 interaction

- **L1, L5, L7:** the view-switch focus loss, index-based action keys and missing focus-path coverage touch the list rebuild. Addendum A deliberately retains the rebuild and keys and forbids tests from claiming these debts are fixed. They remain deferred.
- **L2:** fault-lock replacement of editor `aria-describedby` is outside the Manager-list action-reason markup.
- **L3:** the two existing message/copy nits remain unchanged; `Active`, `Set A` and `Set B` are new presentation labels, not remediation of those messages.
- **L4, L6, L8:** lifecycle defensive gaps, non-settling editor dispatch and documentation-fidelity debt are outside this package and remain unchanged.

No L1–L8 remediation is hidden in the presentation work. If implementation requires changing focus restoration, stable action-key identity, lifecycle behavior or manager copy, Addendum A correctly requires a stop rather than silent scope expansion.

## Acceptance and verification assessment

Addendum A provides executable acceptance coverage for semantics, responsive widths, pathological names, icon fallback, accessible names, disabled reasons, action keyboard behavior, confirmation preservation, width invariance, protected-path zero diff and prohibited DOM/icon techniques. The planned headed visual pass is correctly separate from both implementation authorization and CTM-7.

Repository checks performed:

- `main` and `origin/main`: `fdb8643aa1987e5a1c96355d97a3deb6a0e9a9de`;
- `git diff --check`: clean;
- protected production/test diff: empty;
- package diff before this review: modified spec, plan and handoff plus the new final report and task brief; no implementation or test file;
- upstream final-report SHA-256 during review: `19054baede3de65dd3af5ead4c2a790c0ed1b1d53d145a8f3a1ea08f2995bc16`.

No tests were run because the package is documentation-only and changes no executable source. The accepted checkpoint test results are historical evidence, not newly reproduced evidence. No headed/layout run, CTM-7 or CTM-8 was performed.

## Gate and authorization state

**Blockers:** none. The duplicate section number is a non-blocking traceability correction.

**Ready for:** owner authorization of Addendum A implementation, with the five product decisions above treated as resolved.

**Currently authorized next action:** this independent review and handoff update only; completed by this report.

**Must not begin without explicit owner authorization:** Addendum A implementation; the headed layout pass; CTM-7; CTM-8; L1–L8 remediation; commit/push; persistence/history/background runs; resize features; separate-panel architecture; Core, Viewer Adapter, collision, G2/C6/C8/G3, R20-1 or other new product scope.
