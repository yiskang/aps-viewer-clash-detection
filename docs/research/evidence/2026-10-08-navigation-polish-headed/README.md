# Headed validation: two-row navigation pager polish (Clash Panel)

Date: 2026-10-08. Normal app (`node server.js`, port 8080, hash-URN load of Audubon Architecture, then Structure and Mechanical via "Load as additional model"; Panel from toolbar; Hard test; NOT `?clashPanelDemo=1`). Viewer 7.124.2, Playwright MCP headed, viewport 1300x950 (480x900 for the narrow case). Uncommitted working tree; no source/test/spec edited; no commit. Sets: SxM = Structure x Mechanical (491, 10 pages), AxM = Architecture x Mechanical (1211, 25 pages). No self-clash run.
DOM attributes asserted via evaluate on `[data-scope=selected-clash]` (`data-group-scoped`, button labels/aria-labels/disabled) and `[data-scope=result-pages]`.

| # | Scenario | File | Result | Reason / DOM assertion |
|---|---|---|---|---|
| 0 | Panel open, normal app | 00-panel-open.png | PASS | Test Setup visible |
| 1 | Group None, no selection (also 10a: first page, page-prev disabled) | 01-none-no-selection.png | PASS | scoped=false; "Previous / No clash selected / Next"; "‹ [disabled] Page 1 of 10 ›". Pre-existing: Prev/Next enabled with no selection |
| 2 | None with selection (#3) | 02-none-with-selection.png | PASS | scoped=false; "Clash #3"; plain wording |
| 3 | Element grouped, group expanded, #4 selected | 03-element-group-selected-in-group.png | PASS | scoped=true; "Previous in group / Clash #4 / Next in group"; aria "Previous clash in group"; Prev disabled at group start |
| 4a | Next in group -> #5 (group end) | 04a-element-group-next-at-group-end.png | PASS | stays scoped=true; Next in group disabled; does not step out of group |
| 4b | Prev in group -> back to #4 | 04b-element-group-prev-at-group-start.png | PASS | scoped=true; Prev disabled at start |
| 4c | Model Pair group 491: Next in group from #49 (last row page 1) | 04c-modelpair-next-in-group-crosses-page.png | PASS | #50 selected, result page moved 1->2, still scoped |
| 5 | Collapse the group | 05-element-group-collapsed-plain.png | PASS | scoped=false; plain "Previous / Clash #4 / Next" (buttons disabled; hidden selection label retained) |
| 6 | Filter "Takeoff" removes origin group | 06-origin-group-filtered-away.png | PASS | scoped=false, plain wording; "The selected clash is hidden by the current filters."; no "in group" text anywhere |
| 7a | Element -> Model Pair with selection | 07a-element-to-modelpair-plain.png | PASS | scoped=false, plain, scope cleared |
| 7b | Model Pair group expanded, #4 selected | 07b-modelpair-group-selected-in-group.png | PASS | scoped=true "in group" labels |
| 7c | Model Pair -> Category | 07c-modelpair-to-category-plain.png | PASS | scoped=false, plain |
| 7d | Category (#55 in group, scoped=true) -> Level | 07d-category-to-level-plain.png | PASS | scoped=false, plain, "Clash #55" |
| 8a | Model Pair grouped: page-prev with selection #50 on page 2 | 08a-modelpair-page-prev-selection-unchanged.png | PASS | page 2->1, selected clash stays #50, scoped stays true |
| 8b | None (SxM): page-next | 08b-none-page-next-selection-unchanged.png | PASS | page 1->2, "Clash #50" unchanged |
| 8c | None: row-1 Next -> #51 (page unchanged), Prev x2 -> #49 | 08c-none-clash-prev-crosses-to-page1.png | PASS | Clash row independent; Prev crossing moved to page 1 |
| 8d | AxM None: select #7, page-next x2 | 08d-AxM-none-page3-selection-7.png | PASS | Page 3 of 25, "Clash #7" unchanged, row 1 #101 |
| 8e | AxM Element, in-group #791, page-next | 08e-AxM-element-in-group-page-next.png | PASS | Page 3->4 of 21, still "in group" scoped=true |
| 9a | 480px, both rows, in-group labels | 09a-narrow-480-in-group.png | PASS (caveat) | No element clipped (scrollWidth<=clientWidth; buttons x 20..426); but the native Viewer toolbar (wraps at 480px) overlaps row 2: pre-existing Viewer layout |
| 9b | Same with Viewer toolbar hidden at runtime | 09b-narrow-480-in-group-viewer-toolbar-hidden.png | PASS | Both rows fully visible: "Previous in group / Clash #334 / Next in group", "Page 10 of 10". Page-level horizontal scroll (docSW 720) comes from the app header URN field/checkbox, not the panel |
| 10b | Last page: page-next disabled | 10b-last-page-next-disabled.png | PASS | "Page 10 of 10", `›` disabled, `‹` enabled |
| 11a | Focus / Isolate / Markers | 11a-actions-focus-isolate-markers.png | PASS | Focus moved camera from [300,300,300] to [0.6,74.2,25.4]; Isolate on -> isolated nodes [0,1,1]; Markers off -> clash overlay objects 1/2 -> 0/0 |
| 11b | Back to all | 11b-after-back-to-all.png | PASS | selection cleared ("No clash selected"), isolation [0,0,0], overlays 0 |

Totals: 23 PNG scenarios (10a first-page disabled state is asserted in 01): 23 PASS, 0 FAIL, 0 INCONCLUSIVE (9a carries a pre-existing Viewer-toolbar caveat covered by 9b).

Observations (not FAILs): (a) In Group None, Prev/Next are enabled while "No clash selected" (pre-existing, grouped modes disable them). (b) After collapsing a group or switching mode, the "Clash #N" label of the retained hidden selection remains with Prev/Next disabled, plain wording. (c) At 480px the native Viewer toolbar overlays the bottom of the panel (pre-existing). (d) Run-state/page navigation re-renders asynchronously; DOM assertions were taken after the render.

Verify: `shasum -a 256 -c MANIFEST.sha256`
