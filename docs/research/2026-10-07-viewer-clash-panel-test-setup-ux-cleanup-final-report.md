# Viewer Clash Panel — Test Setup / Interaction UX Cleanup: package final report

Date: 2026-10-07. Backfilled from repository state (diff, spec, handoff, internal review, evidence report, test runs) under `docs/prompts/for-claude-harden-durable-reporting-workflow.md`. Supporting artifacts do not replace this report, and this report does not replace them.

## 1. Repository state
- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`, branch `main`, HEAD `060b7385d9ee9f8e73a857111fe8861a7daa83df`, `main == origin/main`. **Nothing committed or pushed.**
- Working tree (uncommitted): 24 modified tracked files (`clashpanel/core/{constants,controller,draft,intents,setupValidation,viewModel}.js`, `clashpanel/ui/render/{run,setup}.js`, `wwwroot/main.css`, the design spec, `docs/handoffs/latest.md`, 12 test files) plus untracked `clashpanel/core/measurementBasis.js`, `test/clashpanel/core/{controller.basis,measurementBasis}.test.mjs`, `test/clashpanel/dom/setupUx.dom.mjs`, the internal review, the evidence directory, and the owner prompts (`for-claude-viewer-clash-panel-test-setup-interaction-ux-cleanup-package.md` was untracked before work began; `for-claude-harden-durable-reporting-workflow.md` is the later workflow prompt). `CLAUDE.md` is also modified by the workflow-hardening task.
- Governing spec: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (owner decision addendum §23). Plan: `docs/superpowers/plans/2026-09-26-viewer-clash-panel-implementation-plan.md` (unchanged).

## 2. Authorized scope
Owner prompt `docs/prompts/for-claude-viewer-clash-panel-test-setup-interaction-ux-cleanup-package.md`: Test Setup / Interaction UX Cleanup (New test placement, Soft measurement-basis UX, status/readiness wording, keyboard/focus, headed validation, tests, internal review, handoff). No unrelated scope was added: no new grouping, persistence, Viewer selection, framing, collision, G2/C6/C8 or G3 work.

## 3. Delivered
### New test
- Placed in the top action row (`div.clash-setup-actions`), **left of** `Hide setup`/`Show setup`, in both expanded and collapsed setup; removed from the bottom.
- Neutral outlined (secondary) button; Run remains the filled primary.
- Disabled while a run is active (skipped by Tab; observed headed, screenshot 13).
- Reset semantics (controller `newTest`; covered by `controller.basis.test.mjs`): new test id; name `Clash test N+1`; Hard; no clearance; no basis attestation; empty Set A/B; self-clash off; displayed results retired; selected clash, text filter, markers/isolation cleared via the bridge; hasRun/setupChanged reset; setup re-expanded.
- Confirmation: the pre-existing "discard unsaved results?" banner is kept only when held results are `held-unsaved` (the one real state-loss case). No new confirmation added. Headed: with 491 held results New test reset immediately with no banner because the demo host never reaches `held-unsaved`; the banner path is covered by unit tests, not headed (screenshot 19 INCONCLUSIVE).

### Soft measurement basis (spec §23)
- Soft is **no longer disabled** when the host cannot auto-verify a common basis. Primary copy: "Soft clearance needs a measurement basis. Hard clash is available." and "Measurement basis was not verified automatically. Choose the units/basis to run a Soft clearance test."; the host reason is secondary ("Details: …").
- A single Units control: mm, cm, m, in, ft, or "Model units (raw, unverified)".
- **No unit guessing and no conversion.** A declared unit is the user's attestation that all participating models share it, and the clearance is entered in that unit and reaches Core **unchanged**; unit is a label only. Raw option passes the number as Viewer model units, implying no physical unit.
- States: `verified` (host verdict `verified`, or exactly one participating model), `user-supplied`, `raw-model-units`, `unavailable` (Soft chosen, nothing supplied; Run disabled). **`verified` is only ever produced by a host verified verdict or a single model**; user-supplied/raw are never labelled verified (fail-closed `resolveBasis`, tested against non-verified verdict shapes incl. `'verified'` strings and missing state).
- The attestation is dropped when the participant set changes (including self-clash) and on New test; a pending verdict still blocks Run; `buildDefinition` defaults to `verifiedBasis=false` (fail closed).
- Provenance: `runRecord.basis` captured at run start; Run details line "Measurement basis (at run start)" reads e.g. `user-supplied, not verified — models declared to share the unit "m"; the clearance was entered in that unit and used unchanged`, or `raw model units, not verified — …`, or `verified (single model: no cross-model comparison)`. Result gap values stay "scene units" (no back-conversion).
- New intent `setup/basis`; new module `clashpanel/core/measurementBasis.js`.

### Design/spec changes
`docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md`: new **§23 Owner-decision addendum 2026-10-07** (23.1–23.7); PD-17 row amended (with a note that `verified` stays reserved for host-verified/single model); **AC-P18 amended** — the "Soft disabled when basis unverified" criterion is replaced by §23.7 (Soft stays selectable, Run disabled until basis + valid clearance, definition clearance equals the typed number, never `verified` without host evidence, attestation dropped on participant change/New test, Hard ready regardless, invalid clearance rejected, pending blocks). G2 acceptance procedure and collision invariants untouched.

### Status wording
Idle shows only `Idle` (readiness appears once, in Setup, as `✔ Ready`/`✖ Not ready`); a headline that begins with the state label replaces it (`Completed — 491 clashes`, no `Completed · Completed`); a headline repeated by a banner below is dropped (state line `Stopped`, banner "Stopped before any results"); cancelled label is `Stopped`; the aria-live region is visually hidden but still announced; reasons shown inline under Clearance/Units are not repeated in the Not-ready list; the unit label sits inline, bottom-aligned with the Clearance input; the Units error is linked with `aria-describedby`.

## 4. Reproduction
`npm start`, then open `http://localhost:8080/?clashPanelDemo=1` (SVF2 Structure + Mechanical). Hard: Set A = Structure, Set B = Mechanical, Run. Soft: choose Soft, pick Units, enter clearance.

## 5. Tests (final run)
- `npm run test:offline`: **5,228 total / 5,227 pass / 0 fail / 1 todo** (the pre-existing aspect-ratio KNOWN GAP todo).
- `npm run test:clashpanel:dom`: **94 / 94**.
- `git diff --check`: clean.
- New/updated coverage: `measurementBasis`, `controller.basis` (user-supplied/raw runs, 7 non-verified verdict shapes, participant-change drop, New test reset, race tests for stale verdict / verified↔unverified after attestation / pending re-check), draft fail-closed default, `setupUx.dom` (placement, collapsed, disabled, Tab order, Units dispatch, live region hidden, visibleStatus).

## 6. Headed validation
Evidence: `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup/evidence-report.md`; PNGs in `…/after/` (superseded rounds in `after/superseded-rounds/`). Real Chromium 151, URL above.
- **Hard Structure × Mechanical: 491 clashes**, reproduced three times.
- Regression flows exercised: Group None/Element, text filter (55 of 491 for "Elbow"), pager, Focus, Isolate, Markers, Focus on select, Back to all, Show only this element, Clear results, X-close/toolbar reopen/toggle with state kept, default URL (no panel; Room Locator and Clash Finder extensions loaded), Stop/Stopping (14a).
- Console: 0 errors, 0 page errors; only the known Viewer-origin `getInstanceTree` deprecation warning.
- Keyboard (expanded Soft): New test → Hide setup → Test name → Mode (one stop) → Units → Clearance → Set A boxes → Use selection A → Set B boxes → Use selection B → self-clash → (Run/Stop skipped when disabled) → filters. Focus ring 2px solid rgb(29,198,242). Collapsed: only New test and Show setup exist among setup controls.
- Screenshots: **21 triaged (20 numbered + 14a): 19 PASS / 0 FAIL / 2 INCONCLUSIVE** (08 Soft results; 19 New-test confirmation). Three crops (02b, 09b, 20b) uncounted. Not headed-observed: Run details wording for raw-model-units (covered by unit tests only).

### Soft validation limitation
Soft runs complete (user-supplied basis; typed clearance reaches Core: Run details Clearance `0.05` / `50`) but **return 0 clashes on the demo fixtures**. Exported diagnostics show a single reason, `clearance-anisotropic-scale-unsupported`, scope fragment, **25,487 occurrences** (2,033 listed fragment entries over 1,721 elements), 0 unclassified. The collision library excludes fragments with non-uniform/sheared/reflected scale from clearance and never approximates (`collision/README.md`). This is a library/fixture limitation, not a panel defect; **collision code is unchanged**. No Soft clash list could be visually validated; screenshot 08 is INCONCLUSIVE. The single-model Soft self-clash run (1,264 units) did not finish within 3.5 min (stopped at 67%).

## 7. Autonomous fixes
Basis option objects now deeply frozen in the ViewModel; duplicate idle/completed/stopped wording removed; clearance unit label made inline and bottom-aligned; duplicate inline-vs-list reasons removed; fail-closed `buildDefinition` default; `aria-describedby` on Units; PD-17 wording clarified.

## 8. Internal review
`docs/reviews/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-internal-review.md` (Codex advisor, medium): **0 Critical / 0 High / 1 Medium / 3 Low, all fixed**. Medium: `buildDefinition` defaulted `verifiedBasis` to `true` (fail-open helper default) — fixed to `false`. Lows: missing race tests (added), Units error not programmatically associated (fixed), PD-17 amendment wording (fixed). No unresolved in-scope Critical/High/Medium.

## 9. Remaining debt / limitations / deferred
- L3: after Stop the technical line still reads `Status: cancelled` / `Reason: cancel-requested`.
- L4: `Max gap (≤ 0.05)` filter label wraps to two lines.
- L5: ~700 px page-level horizontal scrollbar from the external host header (panel itself clean; outside panel ownership).
- L6: "Completed — N clashes." text repeated inside collapsed Run details DOM (not visible).
- Soft clash list not demonstrable on current fixtures; the panel shows only "integrity caveated" + a diagnostics count, not the dominant caveat code (product decision).
- Unchanged prior debt: union framing, tiny markers, no cross-reload persistence, no Viewer selection (§9.2), UUID fallback entropy, prior Lows.
- Headed-unreachable: New-test confirmation banner (demo host never holds unsaved results); raw-units run details.

## 10. Owner/product decisions
Implemented: New test left of Hide setup; Soft not simply disabled; user-supplied basis and raw model units supported; wording per owner prompt. Open for owner: whether to surface the dominant caveat code; whether to provide a uniform-scale fixture for a non-empty Soft demo.

## 11. Protected boundaries (all unchanged)
No unsupported unit assumptions or conversion; no result labelled verified without host evidence/single model; no collision math/algorithm change; no G2/C6/C8 change (G2 `FAIL (row 3)`, C6 `NOT_EVIDENCED`, C8 unresolved); no G2 retry; no new authorization record; no attempt reset; no acceptance-procedure change; no G3; **no commit; no push**.

## 12. Linked artifacts
Internal review: `docs/reviews/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-internal-review.md`. Evidence: `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup/evidence-report.md`. Handoff: `docs/handoffs/latest.md`.

## 13. Next gate
**Independent Work visual/product review.** Commit/push and any further scope: awaiting owner authorization.
