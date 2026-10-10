# Headed validation: Clash Tests Manager UI layout / responsive polish (spec §26.14, plan Addendum A)

Date: 2026-10-11. **Normal app** (`node server.js`, port 8080, hash-URN load of Audubon Architecture, then Structure and Mechanical via "Load as additional model"; Clash Panel from the toolbar; **not** `?clashPanelDemo=1`). Viewer 7.124.2 (CDN pin in `wwwroot/index.html`), Playwright MCP headed Chrome 155 (macOS, DPR 1), viewport 1300×950 unless stated. Uncommitted Addendum A working tree at HEAD `fdb8643`; **no production code or test edited during validation; no commit.** Set labels: Architecture = `Audubon_Architecture_clash_test`, Structure = `Audubon_Structure_clash_test`, Mechanical = `Audubon_Mechanical_clash_test`.

State built for the run: four tests — `Clash test 1` (Arch × Struct, run to completion: 2277 clashes); `Structure vs Mechanical` (not run); a 154-character realistic long name with Set A = all three models / Set B = Arch + Mech (not run); an 87-character unbroken name `Autodesk_Revit_Clash_Test_…_FINAL_v7` (Mech × Arch, later run: 1211 clashes). Panel geometry at 1300 px: `width:min(460px,90vw)` → 460 px.

| # | Scenario | File | Result | Reason / assertion |
|---|---|---|---|---|
| S1 | Normal Manager view, 460 px, 4 tests | ML-01-manager-460-normal.png | PASS | Clear hierarchy (name · badge · actions → mode · status → Set A → Set B → readiness → reasons); Active item has accent bar + tinted background + `Active` badge; no table; no horizontal overflow |
| S2 | Narrower Panel — viewport 360 px (panel 324 px) | ML-02-manager-viewport360.png | PASS (caveat) | `body.scrollWidth == clientWidth` (318); no one-char-per-line; actions stay inline with the name and usable. Caveat: the native Viewer toolbar overlaps the panel bottom (pre-existing; same finding as the 2026-10-08 packages) |
| S2b | Same, Viewer toolbar hidden at runtime | ML-02b-manager-viewport360-viewer-toolbar-hidden.png | PASS | Whole list visible; 3-line Set A clamps to 2 lines with ellipsis |
| S2c | Supported minimum — viewport 300 px (panel 270 px, list 264 px) | ML-03-manager-viewport300-supported-minimum.png | PASS | No overflow (264/264); container query engaged on every item: action group on its own row, Set label stacked over value; name width 244 px |
| S3 | Long content (154-char name, 87-char unbroken name, 3-model Set A) | ML-04-long-content-panel-460.png | PASS (caveat) | Both names clamp to 2 lines with ellipsis; DOM: `title` = full name/Set text on every clamped element, 2 rendered lines, full text in DOM. Caveat: a Set label longer than the 3 real model names cannot be produced from the live fixture; the Set clamp itself is shown at 360/400 px (ML-02, ML-08c) and for 10 000-character values in the Chromium DOM suite; native tooltip rendering is not capturable in a screenshot (`title` attribute asserted) |
| S4 | Active-state presentation | ML-05a-active-item.png (and ML-01/04/08b/09) | PASS | Visible `Active` pill + accent bar + tint + `aria-current="true"`; understandable without color (badge text); `(active)` absent from the list text (DOM) |
| S5a | Action controls — keyboard focus on Open | ML-06a-focus-open.png | PASS | 2 px cyan focus ring on a 28×28 button; `aria-label` `Open “Clash test 1”`, `title` `Open` |
| S5b | Focus on Delete (Tab order Open→Duplicate→Reset→Delete verified) | ML-06b-focus-delete.png | PASS | Ring clear; Delete distinguished by trash glyph and last position |
| S5c | Hover on Duplicate; disabled Reset shown faded | ML-06c-hover-duplicate.png | PASS | Accent hover border/glyph; disabled Reset at the native disabled opacity; all four glyphs legible and unambiguous at 28 px; all four 28×28, 4 px gaps |
| S6a | Disabled reasons — run active, whole panel | ML-07-disabled-reasons-run-active.png | PASS | Per-item reasons small, one row per distinct reason; panel not broken vertically or horizontally |
| S6b | Shared reason — active running item | ML-07b-shared-reason-active-running-item.png | PASS | `Reset results, Delete test: Stop the running test first.` appears **once** for two disabled actions; DOM: both buttons' `aria-describedby` resolve to it |
| S6c | Confirmation pending — four actions share one reason | ML-11-delete-confirmation-banner.png | PASS | `Open, Duplicate, Reset results, Delete test: Confirm or cancel the pending action first.` once per item; banner focused; Cancel leaves 4 items |
| S6d | Disabled action on an inactive item (no results to reset) | ML-05b-inactive-item-with-disabled-reason.png | PASS | `Reset results: This test has no results to reset.` |
| S7a | Manager → Editor | ML-08a-editor-after-switch-460.png | PASS | Editor intact at 460 px; `style.width` `min(460px, 90vw)` unchanged |
| S7b | Editor → Manager (round trip) | ML-08b-manager-after-round-trip-460.png | PASS | List intact; width identical (460) |
| S7c | Width set from outside to 400 px, then a round trip | ML-08c-manager-externally-set-400-after-round-trip.png | PASS | Width stays `400px` across both switches; clamp "…" on the long name/Set A at 400 px |
| S8 | Viewer-native alignment (next to the native Model panel) | ML-09-viewer-native-alignment-with-model-browser.png | PASS (caveat) | Same title bar, close control, shadow, Artifakt font and `#0a131c` text color as the native panel; the Manager item density (12 px) is smaller than the native tree (14 px) — the existing Clash Panel base size, not a regression. The native Model panel shows a resize footer; the Clash Panel has none (consistent with the static finding) |
| S9a | Icon fallback seam `.clash-manager-no-mask`, 460 px | ML-10a-icon-fallback-460.png | PASS | Text labels visible, glyphs hidden, buttons ≥ 28 px tall, group wraps, no overflow |
| S9b | Icon fallback, viewport 300 px | ML-10b-icon-fallback-viewport300.png | PASS | Four labels wrap onto two rows inside the item; no overflow |

**Totals (by required scenario S1–S9, 19 retained PNGs): 9 PASS (3 with caveats: S2, S3, S8) / 0 FAIL / 0 INCONCLUSIVE.** Sub-rows above (19 rows, one per screenshot group): 19 PASS (3 with caveats), 0 FAIL, 0 INCONCLUSIVE.

**Runtime observations.** Console: 0 errors; 1 warning, the expected Viewer `Model#getInstanceTree` deprecation (pre-existing). The Viewer base panel wrote `max-width`/`max-height` pixel values on the container (`max-width:1300px; max-height:902px`) — never `width`. No page errors.

**Observations (non-blocking, not regressions).**
1. The native Viewer toolbar overlaps the bottom of the panel at narrow viewports (pre-existing).
2. The header line `Test: <long name>` above the list is not clamped and may break mid-word on unbroken names (existing header, outside §26.14).
3. An active, running test reads `Running — 0 found · Results not held — open and re-run to view` (existing ViewModel wording; deferred Low L3).
4. Delete is distinguished by glyph and position only (as specified), not color.
5. With an 87-character unbroken name at a 324 px panel, the clamp leaves ≈ 16 characters per line over two lines — readable, within the §26.14 minimum-size contract.
6. Fallback seam and the viewport-narrowing method exercise the list at panel widths 270–460 px only; the 240 px list-content floor was DOM-tested, not reachable by viewport narrowing alone (the panel minimum is `min(340px, 90vw)`).

Verify: `shasum -a 256 -c MANIFEST.sha256`.
