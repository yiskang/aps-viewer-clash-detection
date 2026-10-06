# Viewer Clash Panel — product-facing continuation II evidence report (2026-10-06)

Status: headed validation of scope A complete. 2 small in-scope UX defects found and fixed (TDD). Nothing committed. No G2 / live-diagnostic / retry / record / reset / G3 action.

## Governing scope (scope A, owner-authorized 2026-10-06)

Headed Viewer validation, plus in-scope fixes, focused tests and evidence, of accepted v1 features that had never been exercised headed:

1. Region 3 Group by None / Element. Spec `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` §10.2, §12.2, §14.4–§14.5; plan T13/T29/T30; AC-P17. Covers group headers with "n of m" counts, expand/collapse, and a selected clash showing as selected under both of its elements.
2. Region 5 actions (Focus / Isolate / Markers / Back to all) on a row selected from a group (§9.3, §9.6).
3. The Soft-unavailable explanation for two models (§6.2 step 4, §14.4 Region 1, AC-P18).
4. The §13 / §14.4 empty and error-state wording that can be reached headed.

Non-goals: model-pair grouping and roll-ups, new Group By behavior, persistence, Viewer selection, framing changes, `measurementBasis`, G2/C6/C8/G3 work, and the 3 deferred Lows. None of these were touched.

## Launch / URL / models

- Command: `npm start` (port 8080; `.env` APS credentials present). Started detached outside the sandbox and stopped at the end.
- Demo URL: `http://localhost:8080/?clashPanelDemo=1` (SVF2). Also checked the default URL `http://localhost:8080/` and `http://localhost:8080/#<Structure URN>`.
- Models: Audubon Structure + Mechanical, federated and auto-loaded (`getAllModels()` gives 2, both `isLoadDone()`).
- Browser: Playwright MCP headed Chromium, viewport 1202x909, real Viewer 7.124.2.
- The demo host supplies no `measurementBasis`, so Soft fails closed for more than one model. This is the accepted demo state and was not changed.

## Flow executed

Default URL → default URL with the Structure hash (extension smoke) → demo URL (01) → toolbar open (02) → Set A Structure, Soft selected; Soft is available because only 1 model participates (03) → Set B Mechanical; Soft becomes unavailable (04a pre-fix, 04 post-fix) → Hard; Ready (05) → Run, completes with 491 (06) → Group: Element, all groups collapsed (07) → expand a group (08) → select #5 under Mechanical 839567, then text filter `299264` gives "n of m" headers (09) → expand Structure 299264: #5 is selected under both elements (10) → select #7 inside the Structure group, then Next steps to #9 within that group, then Focus (11) → Isolate (12) → Markers off (13) → Markers on, then Back to all (14) → reselect #9, pager to page 2 → filter `zzzz-nomatch`: empty-filtered state with a hidden-selection note (15) → Clear filters (the page follows the selected occurrence to 10/11) → Group: None, selection kept (16, post-fix) → close via X (17) → reopen (18) → re-run and Stop (19) → Clear results (20) → reload, New test, Use selection with 1 Structure element vs 1 Mechanical element, Run: completed empty (21).

## Screenshot index and visual matrix

All PNGs are under `snapshots/`. Every one was opened and read.

| # | File | Verdict | Reason |
|---|---|---|---|
| 01 | 01-entry.png | PASS | Both models visible. Clash Panel toolbar button present and inactive. No panel. |
| 02 | 02-panel-open.png | PASS | Panel open and button active. Hard is checked. Soft is disabled with no explanation (no participating models yet). Validation lists both empty sets. |
| 03 | 03-soft-available-single-model.png | PASS | With only Structure participating, Soft is enabled and selectable and the Clearance field is shown (§6.2 step 4(i)). |
| 04a | 04a-pre-fix-soft-unavailable-clearance-prompt.png | FAIL (pre-fix, superseded) | The explanation is correct, but validation also says "Enter a clearance for Soft mode." while the Clearance field is hidden. It asks for input the user cannot give. Fixed: see Defects D1. |
| 04 | 04-soft-unavailable-two-models.png | PASS | After the fix: Soft is disabled, and the fixed §6.2 wording plus the host reason replaces the Clearance field. Validation shows only that explanation. Run is disabled and Hard stays selectable. Nothing says "approximate". |
| 05 | 05-hard-ready-soft-explained.png | PASS | Hard is selected, Ready, and Run is enabled. The Soft explanation persists. |
| 06 | 06-completed-491.png | PASS | "Completed — 491 clashes", coverage full, integrity caveated. Setup is collapsed to its summary. |
| 07 | 07-group-element-collapsed.png | PASS | Group: Element. Headers are collapsed by default (▸) and show `Model · label [id] (m)`. The multi-valued note is shown. Pager shows 1/10. |
| 08 | 08-group-expanded.png | PASS | Mechanical 839567 is expanded (▾) and shows its 2 member rows, #4 and #5. Other groups stay collapsed. |
| 09 | 09-filtered-n-of-m-selected-under-element-1.png | PASS | With filter `299264`: headers read "(1 of 2)", "(1 of 3)", etc. Unchanged totals stay "(m)". #5 is highlighted under Mechanical 839567. Status line: "42 of 491 clashes match the filters". |
| 10 | 10-selected-under-element-2.png | PASS | Structure 299264 is expanded "(42)". The same clash #5 is also highlighted there (2 `aria-selected` rows, one per group). Nav label reads "Clash #5 (within its group)". Detail shows Clash #5. |
| 11 | 11-grouped-next-focus.png | PASS | Selected #7 from the Structure group, then Next went to #9, the next member of that group (not the flat #8). Focus framed both elements. Outlines and marker are visible. |
| 12 | 12-grouped-isolate.png | PASS | Isolate leaves only the beam and elbow visible (`getAggregateIsolation()` has 2 entries). Outlines and marker are drawn. |
| 13 | 13-grouped-markers-off.png | PASS | Markers off removes the outlines and marker. Isolation is kept. |
| 14 | 14-grouped-back-to-all.png | PASS | Whole model restored, isolation 0, overlay scenes empty, "No clash selected". Filter, grouping and expansion are unchanged (§9.3). |
| 15 | 15-empty-filtered-selected-hidden.png | PASS (note) | "No clashes match the current filters." plus a Clear filters button. "The selected clash is hidden by the current filters." appears in both the list and the detail. The Viewer still presents #9. Note: the multi-valued grouping note still shows over the empty list (Low, cosmetic). |
| 16 | 16-group-none-selection-kept.png | PASS | After the fix: Group None gives the flat list, page 1/1, and #9 is still selected and highlighted. The nav label is now "Clash #9" (pre-fix it read "(within its group)" although Next stepped the flat list; see D2). |
| 17 | 17-closed-via-x.png | PASS | Panel closed with X. Button `inactive`. Isolation and overlays cleared (§9.6 Hide Panel). |
| 18 | 18-reopened-selection-kept.png | PASS | Reopened from the toolbar with the button `active`. 491 results retained. The selection is kept (DOM: detail "Clash #10", off-frame) with no visualization reapplied (§9.6: "kept (reapply via Focus)"). |
| 19 | 19-stopped-partial.png | PASS | "Cancelled · Stopped — partial results (472)", Coverage partial. Gap list reads "1 part could not be evaluated (the run was stopped)", reason `cancel-requested`. The new run cleared the previous selection. The partial count depends on timing. |
| 20 | 20-cleared.png | PASS | Clear results: "Idle · Ready to run", Results "Run a test to see clashes.", "No clash selected". |
| 21 | 21-completed-empty-claim.png | PASS | 1 Structure element vs 1 Mechanical element: "Completed — 0 clashes", full / clean / current. Results show the §7.5 claim wording "No clashes found in the evaluated scope." plus the Set A / Set B scope lines, never a bare "No clashes". |

Totals: 22 PNGs. 21 PASS (one, 15, with a Low note), 0 open FAIL, 0 INCONCLUSIVE. The one FAIL, 04a, is a superseded pre-fix capture kept as evidence for D1 and replaced by 04. The pre-fix state of D2 was recorded from the DOM only and has no PNG. 16 is the post-fix capture.

Additional DOM-level checks:

- AC-P17 (headed): after the selection inside Structure 299264, Clear filters rebuilt the list and the page moved to 10/11, where that occurrence is. Both occurrences stayed `aria-selected`.
- Grouped page 2 starts mid-group: 36 option rows, no header, plain "Clash results" listbox, as the `results.js` design describes.
- The sort options in grouped Hard view are `default`, `group-count` and `group-label` (presentation-only re-sort, §10.2). Group re-sort was not exercised headed beyond listing the options. It is covered by `controller.navigation.test.mjs`.
- Group ordering looks non-monotone by the bracketed number. It is not: the bracketed value is the Revit element id inside the name, and the order is by Viewer dbId (`#127, #128, …`), as §10.2 specifies.

## Defects found and fixed (in scope, TDD)

| ID | Severity | Area | Defect | Fix | Test |
|---|---|---|---|---|---|
| D1 | Medium (UX) | Region 1 / §6.2 step 4 | With Soft selected and then made unavailable by adding a second model, the validation list asked "Enter a clearance for Soft mode." although the Clearance field is hidden. The user is asked for input they cannot give. | `clashpanel/core/viewModel.js`: while the clearance field is not visible, clearance-control messages are left out of the displayed validation list. The Soft finding still blocks Run, so validation stays `blocked` and the explanation remains the reason. | `test/clashpanel/core/viewModel.test.mjs`: "§6.2 step 4: while Soft is unavailable the hidden clearance field is not asked for…" (red, then green) |
| D2 | Low (UX) | Region 4 nav label / §9.3 | After selecting inside a group and switching Group → None, the label still read "Clash #9 (within its group)", but Next stepped the flat list (#9 → #10). | `clashpanel/core/controller.js` `navOf`: the "(within its group)" suffix shows only when Prev/Next actually step that group, meaning grouped view with the scope group expanded (the same condition `orderedList.navNeighbor` uses). Navigation behavior is unchanged. | `test/clashpanel/core/controller.navigation.test.mjs`: "headed finding: after Group → None the nav label no longer claims…" (red, then green) |

Neither fix changes Group By semantics, selection, framing, persistence or the Viewer bridge.

## Console / runtime

- Demo sessions (2 page loads, all steps, including 3 runs): 0 errors. The only warning, once per page load, is Viewer-origin `Model#getInstanceTree` deprecation (viewer3D.js 7.124.2). This matches the prior baseline.
- Default URL (no model, then the Structure hash): 0 errors, 0 warnings.

## Tests

- Focused: `test/clashpanel/core/*.test.mjs` gave 313 pass, 0 fail (includes the 2 new tests).
- `npm run test:offline`: tests 5187, pass 5186, fail 0, cancelled 0, skipped 0, todo 1 (baseline 5185/5184/1 todo + the 2 new tests).
- `npm run test:clashpanel:dom`: tests 83, pass 83, fail 0 (unchanged; no DOM renderer touched).
- `git diff --check`: clean.

## Regressions checked (owner prompt §10)

| Item | Result |
|---|---|
| Open / close, X-close button sync | PASS (01, 02, 17, 18; classes inactive → active → inactive → active) |
| Rapid first-click | Not re-run this pass (unchanged code path; PASS in prior package) |
| Structure/Mechanical demo, full run 491 | PASS (06; reproduced 491 after reload) |
| Stop / partial | PASS (19; 472, timing-dependent) |
| Result list, selected-row highlight | PASS (09–11, 16) |
| Filter | PASS (09, 15) |
| Pager | PASS (grouped 1/10 → 2/2 and 10/11; flat 1/10) |
| Focus, Isolate, Markers | PASS (11–13, from a grouped row) |
| Switching results | PASS (#5 → #7 → #9 → #10) |
| Back to all | PASS (14) |
| Clear | PASS (20) |
| Close/reopen state | PASS (17, 18) |
| Default URL safety | PASS: no Clash Panel extension or button, 0 errors / 0 warnings |
| Room Locator / Clash Finder | Smoke PASS: with the Structure hash on the default URL, both `Autodesk.Sandbox.RoomLocator` and `Autodesk.Sandbox.ClashFinder` are loaded and Clash Panel is not. Their own workflows were not re-exercised (no code touched). |

## Known limitations of this pass

- Headed §13 reach: the following were exercised: invalid-setup per-control messages (02, 03), Soft-unavailable (04), cancellation / partial and gap list (19), empty-after-filter (15), completed-empty claim (21), and before-run (20). The following were **not reachable headed** without fault injection or other models, and are covered offline only: engine at capacity, enumeration-failed, planning failures, result cap, model unload or reload during a run, internal error, diagnostics truncated, grouping-too-large ("showing the flat list"), the non-claim empty wording, and "Model X is still loading / not registered".
- Soft with a verified basis (a run with clearance) cannot be exercised on this demo, because the host provides no `measurementBasis` (deferred).
- Group re-sort (`group-count`, `group-label`) was only listed headed, not visually checked.
- Single browser (Chromium), single run per state, no video.

## Product-facing status

The panel shows, headed: per-element grouping with collapsed-by-default headers, expand/collapse, "n of m" filtered counts and the multi-valued note. A selected clash is highlighted under both of its elements. Prev/Next stay inside the group the user selected from. Focus, Isolate, Markers and Back to all work from a grouped row. Selection survives filter changes, the empty-filter state and Group → None. Soft is offered for a single model and correctly disabled for two models, with the fixed explanation and no request for a hidden field. The empty-result claim wording, cancellation/partial wording and the cleared state read as specified. The prior demo baseline holds (491, Stop/partial, close/reopen, Clear, default-URL safety).

Low observations, not fixed (deferred product debt): (a) the multi-valued note is shown over an empty filtered list (15); (b) the Run status line reads "Idle · Ready to run" while the setup validation says "Not ready" (02, 04). This wording predates this pass and was already in accepted baseline screenshots; (c) the status line repeats the word "Completed · Completed — N clashes" (pre-existing, already in the accepted baseline).

## Deferred product debt (unchanged)

UUID fallback entropy; ~700 px responsive overflow; missing exact-width assertion; marker visibility on large elements; union framing; no Viewer selection change (spec §9.2); interim `modelKey = urn#loadSeq` (no cross-reload resume); no `measurementBasis` (Soft across models fails closed); SVF2 Structure+Mechanical only; model-pair grouping and roll-ups. Plus the 3 Low observations above.

## Verification debt (unchanged, separate)

- G2: FAIL (row 3). Unchanged.
- C6: NOT_EVIDENCED. Unchanged.
- C8: unresolved. Unchanged. This is Track A product evidence and does not resolve C8.
- No live-diagnostic authorization exists and none was exercised. No retry, no new authorization record, no attempt reset, no acceptance-procedure change, no G3.

## Review addenda (post internal review)

- **Screenshot 16 recapture (internal review L2):** `16` is the post-D2 capture taken after Group was switched to None with a clash still selected; it still shows the earlier filter (`299264`, page 1/1) because filters were not cleared before recapture. The #9 → #10 selection step precedes 17/18. Visual verdict unchanged.
- **Screenshot 10 (L3):** Prev and Next both disabled is correct per spec §9.3: navigation stays anchored to the Mechanical group the clash was selected from.
- **Deferred Low (L1):** the D2 "(within its group)" label does not check the group still exists in the filtered list; when a filter removes every member of an expanded group the label can still show while Next steps the whole list. Pre-existing, label-only, deferred.
