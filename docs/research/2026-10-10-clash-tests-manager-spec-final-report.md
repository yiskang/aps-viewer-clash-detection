# Clash Tests Manager (session-scoped v1) — design spec package final report

Date: 2026-10-10. Package type: design/specification only (no plan, no code).

## Repository state
- Branch `main`, HEAD `ea53399` (== `origin/main`). Working tree **dirty, uncommitted, unpushed**: modified `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (+~175/−8, now 990 lines), `docs/handoffs/latest.md`; untracked `docs/reviews/for-claude-clash-tests-manager.md`, this report.
- `git diff --check` clean. No change under `clashpanel/`, `clashtest/`, `collision/`, `test/`.

## Authorized scope and governing artifacts
- Owner brief: [for-claude-clash-tests-manager.md](../reviews/for-claude-clash-tests-manager.md) (scope, out-of-scope, five design questions). Owner then confirmed the defaults and the Delete-vs-Reset split and authorized: draft §26, run the bounded internal Codex review, stop for independent Work review; **no plan, no code**.
- Governing spec: Panel spec `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`; new **§26** (lines 825–~990). Earlier manager non-goal (§0 Q9, §18, §25.1) reconciled by pointer edits (lines 37, 198, 223, 301, 420, 691, 781, 805).

## Delivered (spec changes)
§26.1–26.13: one editor controller kept for the whole Panel with a headless manager layer around it; only the active test holds a result set and owns the Viewer; per-test record (draft + summary), Duplicate/Create naming and `testId` minting; per-test readiness (`setup-complete`, models-missing/changed) for all records; **Delete test definition** vs **Reset/discard held result** specified as distinct destructive actions (both session-only, reusing the existing `heldUnsaved`/confirm pattern, distinct from Clear results and New test); manager/editor sync protocol and pending-operation object (§26.2a); null-result-set summary; atomic load seam with divergence recovery and terminal manager-fault state; ViewModel additions; acceptance criteria AC-M1…M19; gates CTM-1…11.

## Design findings that the owner defaults did not anticipate
1. "Editor reused unchanged" is not literally possible: the controller can only mint drafts (`controller.js:54,244-254`) and exposes no draft/summary → §26.2 specifies an **additive** load-test intent and `vm.test` snapshot (gate CTM-1, plan requirement). The engine port is not widened.
2. `controller.dispose()` also disposes the bridge (`controller.js:514`) → one controller for the whole Panel.
3. Inactive tests cannot call `getFreshness` (no held set) → Panel-local "models changed" check.
4. The editor's `New test` would overwrite a listed test in place → in a Panel that hosts the manager it becomes Create.
5. Naming follows code (`Clash test N`, `draft.js:39`), not the brief.

## Internal review summary (bounded, Codex)
- Round 1 (`codex-review spec`, medium, request 20261010-133355-31150-4287): "requires major revision"; 4 High, 3 Medium. Accepted and remediated in §26: sync transaction, null-result-set summary, confirmation ownership/pending operation, model re-entry wording, inactive Soft readiness. **Not remediated, recorded as CTM-11 (pre-existing, not caused by §26):** Soft rule §23 vs §18 (:691)/§21 (:742); §19 item 8 (:704) `getPairStatus` vs §7.5 (:297)/AC-P4 (:717).
- Round 2 (`codex-advisor`, medium, targeted at changed areas, request 20261010-134056-35187-24650): the five fixes close their findings; **1 High** (unexpected activation `testId` could diverge manager and editor) → remediated (atomic load seam + one compensating reload + terminal manager fault; AC-M16, §26.9, CTM-1). Medium/Low: none decision-changing.
- **The final remediation has not itself been re-reviewed** (loop stopped per CLAUDE.md boundary; verified by direct read of §26 lines 833/844/866/955). Subagent drafting model reports were verified against the spec text, not trusted.

## Unresolved / deferred (gates in §26.13)
- Plan requirements: CTM-1 (additive editor seam), CTM-2 (label disambiguation over all tests' model keys).
- Product decisions (defaults recorded): CTM-3 Duplicate copies basis attestation; CTM-4 switch confirms only when held results are unsaved; CTM-5 deleting last test creates a fresh one; CTM-6 names need not be unique.
- Verification gates: CTM-7 headed SVF2 check that switch/delete removes markers and restores isolation; CTM-8 many-tests list render cost unmeasured.
- Deferred: CTM-9, CTM-10 (rebinding to reloaded model, persistence, run history, background runs); CTM-11 pre-existing inconsistencies.

## Protected boundaries
No Core/`clashtest/` change, no collision change, no R20-1, no G2/C6/C8/G3, no persistence/history/lifecycle/multi-level grouping.

## Commit/push state
Uncommitted, unpushed; no commit authorized.

## Exact next gate
**Independent ChatGPT Work review of §26** (spec + pointer edits + CTM gates). Then, only after owner authorization: targeted adjudication of that review, then implementation plan (not authorized), then separate implementation authorization.
