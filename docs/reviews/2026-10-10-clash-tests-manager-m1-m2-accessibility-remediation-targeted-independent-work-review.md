# Clash Tests Manager M1/M2 accessibility remediation — Targeted Independent Work Review

**Date:** 2026-10-10  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `ea533997dc62543aac47c28628e095e62a7b90ea`  
**Origin relation:** `HEAD == origin/main`  
**Working tree:** dirty, uncommitted and unpushed; the Clash Tests Manager package and its documentation remain in the working tree  
**Governing contract:** Viewer Clash Panel design §26.10, the accepted 13-task implementation plan, and the prior implementation Independent Work Review  
**Read-only upstream input:** `docs/research/2026-10-10-clash-tests-manager-final-report.md` (preserved unchanged)  
**Verdict:** **M1 and M2 are closed; the functional Clash Tests Manager implementation checkpoint is accepted**  
**Findings in this bounded re-review:** **0 Critical / 0 High / 0 Medium / 0 Low**

## Scope

This re-review is limited to the two prior Medium findings in `docs/reviews/2026-10-10-clash-tests-manager-implementation-independent-work-review.md` and the directly affected implementation, tests, final-report input and handoff. The eight previously accepted Low findings were not reopened. CTM-7 and CTM-8 were not run.

The codebase-memory graph was used for structural discovery and reported current coverage for every relied-on implementation/test file. Conclusions were then verified by direct source reads and executable repository tests.

## M1 — disabled-action reasons: closed

### Confirm reason derivation

`confirmOf` in `clashpanel/core/managerViewModel.js` derives one `enabled` value and one `disabledReason` with the required priority:

1. terminal manager fault, using the actual fault text (or the established fault fallback);
2. recovery in progress, using `MANAGER_TEXT.RECOVERING`;
3. pending editor confirmation, using `MANAGER_TEXT.ANSWER_CONFIRM`.

When Confirm is enabled, `disabledReason` is exactly `null`. The core test exercises enabled, recovery-only, editor-confirmation-only, fault+recovery+editor-confirmation, and recovery+editor-confirmation combinations, including custom fault text, so the priority is not inferred from defaults.

`confirmBanner` in `clashpanel/ui/render/manager.js` renders the disabled reason as visible text and connects the disabled Confirm button to it with `aria-describedby`. The enabled render emits neither the description attribute nor a stale reason node. The DOM test resolves the referenced element for all three disabled reasons and then re-enables Confirm to prove removal.

The fault-state Confirm combination is difficult to reach through the normal real flow because terminal recovery failure clears or supersedes pending operation state. That does not weaken this contract: the ViewModel is the normative manager presentation boundary, the priority logic is exhaustively tested there, and the renderer is tested with the resulting reachable shape. No live Viewer behavior is needed to establish the disabled-reason mapping.

### Managed New test reason and AC-M13

The manager ViewModel carries `manager.runActiveReason = MANAGER_TEXT.STOP_FIRST`. This is a legitimate manager-layer presentation carrier: the managed renderer cannot import private core copy, and the field adds no editor intent, mutation or standalone behavior.

After rendering the unchanged editor, the manager-only `describeNewTest` overlay adds one visible reason and `aria-describedby` only when the editor's New test gate is disabled for the live-run state and has no existing description. Because it returns when `aria-describedby` already exists, a terminal-fault reason is preserved rather than overwritten. Re-rendering is idempotent, and re-enabling removes the overlay because the editor setup region is rebuilt.

The real composed-panel DOM test proves the reason while a run is active and its removal after completion. Its standalone companion proves `testsManager:false` retains the original editor contract: disabled New test, no manager reason overlay, and no new `aria-describedby`. `manager.runActiveReason` therefore remains consistent with AC-M13.

## M2 — repeatable live announcements: closed

### Core announcement identity

`testsManager.js` initializes `liveSeq` to zero and routes every manager announcement through the single `setLive` helper, which writes the text and increments the sequence once. Direct search found no other manager `live` write or `liveSeq` increment. The six announcing sites are committed Open, Create, both Delete paths, Reset and Duplicate; together they cover the §26.10 activation, creation, deletion, reset and duplication vocabulary.

Core tests cover Open/Create/Delete, two distinct same-name deletions, Duplicate and Reset. They also establish that view-only changes and refused Create do not advance the sequence. Thus a site cannot update `live` without also advancing `liveSeq`, and non-announcing work does not synthesize an event.

### Persistent live-region behavior

The managed renderer keeps exactly one header `role=status` / `aria-live=polite` node and removes live semantics from the editor's internal status node. A changed `liveSeq` is treated as a new manager event even when announcement text is unchanged. For identical text it replaces the child text node, producing a real child-list mutation while preserving the live-region element itself.

The focused DOM test proves: no churn for the same sequence, a new mutation for the next sequence with identical text, stable live-region node identity and exactly one `aria-live` region. The real composed-panel scenario creates two tests named `Same`, performs two distinct valid deletion actions, obtains identical deletion text with sequence `N` then `N+1`, and observes a new mutation for each action.

The clear-and-reinsert happens in one JavaScript task. That is sufficient for this implementation checkpoint's mechanically testable §26.10 contract: every announcement event causes an observable mutation of the persistent live region. Browser/assistive-technology coalescing is not established by DOM tests, so actual screen-reader repetition remains a product-accessibility verification caveat rather than a code correctness blocker. No headed or screen-reader PASS is claimed. It may be validated with later product accessibility work, including the headed phase around CTM-7, but CTM-7's existing scope is not silently expanded by this review.

## Verification

- Focused M1/M2 suites: **58/58 pass** (`managerViewModel`, `testsManager.core`, `manager.dom`, and `managerComposition.dom`).
- Canonical `npm test`: exit 0.
  - offline: **5,609 total / 5,608 pass / 0 fail / 1 existing todo**;
  - DOM: **125/125 pass**.
- `git diff --check`: clean.
- Protected-path check is empty for `clashtest`, `collision`, `wwwroot`, `server.js`, `routes`, `package.json`, `scripts`, `clashpanel/core/ports.js`, and `clashpanel/viewer`.
- `main` and `origin/main` both resolve to `ea533997dc62543aac47c28628e095e62a7b90ea`.
- The upstream final report remained read-only; its SHA-256 during review was `9861925cb1fb0f7c1d4c8f02d7ce761b9303552dd7f19e062b47d93cca0402ef`.
- No CTM-7, CTM-8, live Viewer, persistence/history/background-run, Core, Viewer Adapter, collision or new-package work was performed.

## Gate and authorization state

The two blocking Medium findings from the implementation review are closed. No further M1/M2 implementation correction is required before the functional implementation checkpoint.

**Checkpoint verdict:** accepted for the implemented headless/browser-DOM scope. This does not close CTM-7 headed SVF2 product validation or CTM-8 rebuild-cost calibration, and it makes no screen-reader compatibility claim.

**Recommended next owner gate:** decide whether to authorize committing the accepted Clash Tests Manager implementation/remediation/review checkpoint.

**Currently authorized next action:** this targeted review and handoff update only; completed by this report.

**Must not begin without explicit owner authorization:** commit/push; CTM-7; CTM-8; remediation of the eight deferred Low findings; headed/screen-reader validation; persistence/history/background runs/lifecycle expansion; another package or milestone; G2/C6/C8/G3; reflected-fragment/R20-1 work; Core, Viewer Adapter or collision changes; edits to the governing spec/plan or upstream final report.
