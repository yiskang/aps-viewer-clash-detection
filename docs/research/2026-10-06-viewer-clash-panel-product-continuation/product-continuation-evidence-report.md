# Viewer Clash Panel — product continuation evidence report (2026-10-06)

Status: headed validation of polish fixes L1-L11 complete. Uncommitted. No source changed during validation. No G2 / live-diagnostic / retry / record / reset / G3 action.

## Launch / URL / models

- Command: `npm start` (port 8080; `.env` APS creds; started unsandboxed, stopped at end).
- Demo URL: `http://localhost:8080/?clashPanelDemo=1` (SVF2). Default URL `http://localhost:8080/` checked too.
- Models (federated, auto-loaded): Audubon Structure + Mechanical (`NOP_VIEWER.getAllModels().length === 2`).
- Browser: Playwright MCP headed Chromium, viewport 1202x909 (700x909 for narrow step), real Viewer 7.124.2.

## Scope

Polish fixes L1-L11 on the Viewer Clash Panel demo. Key checks: L1 toolbar button state after X-close, L2 rapid double-click on first use, L7 narrow viewport, L8 plain headings.

## Flow executed

Default URL (no flag) -> demo URL fresh page -> screenshot 01 -> rapid double-click toolbar button (L2) -> 02 -> check Set A Structure / Set B Mechanical, Run (03 in progress) -> completes 491 (04) -> click result #5 (focus-on-select moves camera, 05) -> Focus (05b) -> Isolate (06) -> Markers off (07b) / on (07) -> Back to all (08) -> close via panel X (09) -> reopen from toolbar (10) -> Clear results (11) -> headings (14) -> 700px viewport (12) -> restore, re-run and Stop (13, 13b).

## Screenshot index and PASS/FAIL matrix

All PNGs under `snapshots/` were opened and read.

| # | File | Verdict | Reason |
|---|---|---|---|
| 01 | 01-initial-toolbar-inactive.png | PASS | Both models visible; rightmost Clash Panel toolbar button present, unhighlighted (DOM class `inactive`); no panel. |
| 02 | 02-panel-open-button-active.png | PASS | Panel anchored top-left, scrollable; button highlighted (DOM class `active`). |
| 03 | 03-run-in-progress.png | PASS | "Planning", progress bar, 0/3 units; Run disabled, Stop enabled. |
| 04 | 04-completed-491.png | PASS | "Completed - 491 clashes", coverage full, integrity caveated, Clear results enabled. |
| 05 | 05-result-selected-focus.png | PASS | Row #5 highlighted (blue); camera moved (focus-on-select); purple outlines and a small marker visible. |
| 05b | 05b-focus-clicked.png | PASS | Focus button click; framing identical to 05 (already focused). Detail pane shows Clash #5. |
| 06 | 06-isolate.png | PASS | Only the beam and elbow remain; the rest hidden; outlines and marker drawn. |
| 07 | 07-markers-on.png | PASS | Marker and outlines visible (marker is tiny: known L2 limitation). |
| 07b | 07b-markers-off.png | PASS | Markers off: outlines/marker overlay removed; isolation retained. |
| 08 | 08-back-to-all.png | PASS | Whole model restored, no overlays, "No clash selected". |
| 09 | 09-closed-via-X-button-state.png | PASS (key L1) | Panel gone; toolbar button no longer highlighted; DOM class `inactive`. |
| 10 | 10-reopened.png | PASS | Button `active` again (focus ring + "Clash Panel" tooltip); 491 results retained, no stale overlay. |
| 11 | 11-cleared.png | PASS | "Idle - Ready to run", Results "Run a test to see clashes", no overlays. |
| 12 | 12-narrow-700.png | PASS (note) | 460px panel leaves ~240px of canvas visible, not whole-canvas occlusion. Note: viewer toolbar's left group clipped at 700px and a horizontal page scrollbar appears (header/toolbar width, not the panel). |
| 13 | 13-stop-partial.png | INCONCLUSIVE as final state | Captured mid-"Stopping... (finishing the current step)" at 39%, found 394. Not the final state. |
| 13b | 13b-stop-partial-final.png | PASS | Final: "Cancelled - Stopped - partial results (472)", coverage partial banner, "1 part could not be evaluated". Count is 472, not 394 (stop is timing dependent). |
| 14 | 14-headings-plain.png | PASS (L8) | Headings render plain bold sentence-case (computed `text-transform: none`, 21px/700). |

Other checks:

- L2 double-click: fresh page, `dblclick` on the toolbar button with 0 delay. After 3 s the panel was OPEN and the button `active` (state consistent, no stuck/half-created panel). PASS.
- Default URL (no flag): loads, 0 console errors/warnings, no clash toolbar button, no panel DOM. PASS.
- Toolbar button DOM class sequence: inactive -> (dblclick) active -> X-close inactive -> toolbar click active.

## Console status

Whole demo session (all steps): 0 errors; Viewer-origin deprecation warnings only (this run saw `Model#getInstanceTree`, viewer3D.js 7.124.2; the independent Work run observed both `getInstanceTree` and `getAecModelData`). Default URL: 0 errors, 0 warnings.

## Tests (rerun)

- `npm run test:offline`: tests 5185, pass 5184, fail 0, cancelled 0, skipped 0, todo 1. Matches expected.
- `npm run test:clashpanel:dom`: tests 83, pass 83, fail 0. Matches expected.

## Limitations

- Run-time partial count is non-deterministic (394 previously, 472 now); 13 captured mid-stop, so 13b is the authoritative partial state.
- Marker radius is still very small on large elements (L2 from earlier report); framing is the union of both elements (L1 earlier).
- At 700px the viewer's own toolbar is clipped and a horizontal scrollbar shows.
- Toolbar icons use the viewer's own icon font; accessibility-snapshot letters are artifacts of that, screenshots render correctly.
- No hard-error-state, soft-mode, Group by Element, or hash-change (earlier L9) scenarios were exercised. No video.
- Single browser (Chromium), single run.

## Deferred product debt

Marker visibility on large elements; union framing; panel does not change Viewer selection (spec 9.2, owner decision); interim `modelKey = urn#loadSeq` (no cross-reload resume); no `measurementBasis` (Soft across models fails closed); SVF2 opt-in, Structure+Mechanical only; demo hash-change replacing models; Group by Element roll-ups; narrow-viewport viewer toolbar clipping.

## Product-facing status

A user can open/close the panel from the toolbar with the button state correctly tracking panel visibility (including X-close), configure and run a federated Hard test (491 clashes), stop mid-run for partial results, select/focus/isolate/mark a result, return to all, clear, and reopen with results retained. Default page unchanged and error-free. No defects found in this validation pass; the only non-pass item is the mid-stop capture (13), resolved by 13b.

## Verification debt (unchanged)

- G2: FAIL (row 3) — unchanged.
- C6: NOT_EVIDENCED — unchanged.
- C8: unresolved — unchanged. The visual checks here are Track A product evidence and do not resolve C8.
- No live diagnostic authorization; none exercised.
