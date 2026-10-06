# Viewer Clash Panel — demo-ready evidence report (2026-10-06)

Status: **Ready for independent Work visual/product review.** Uncommitted. Product-facing status and G2 verification debt are kept separate below.

## Launch

- Command: `npm start` (needs `APS_CLIENT_ID`/`APS_CLIENT_SECRET` in `.env`; port 8080, or `PORT=<n>`).
- Demo URL: `http://localhost:8080/?clashPanelDemo=1` (implies SVF2). `?clashPanel=1` / `?svf2=1` = SVF2 + panel button without the auto-loader. No flag = the sample behaves exactly as before (SVF, no panel).
- Models (auto-loaded, federated): Audubon **Structure** then **Mechanical** (`Auduboin_*_clash_test.rvt`; URNs in `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`). Architecture and RAC are not usable with the panel under SVF2 (planning failure / triangle limit — see `implementation-gap-note.md`).
- Headed run: Playwright MCP browser (Chromium, viewport ≈1202×909, DPR 2) against the real server and real Viewer 7.124.2, 2026-10-06.

## Demo sequence

1. Open the URL; wait ≈30–40 s for both models (SVF2/OTG confirmed: `isOTG()` true for both).
2. Click the **Clash Panel** toolbar button (rightmost, orange/grey overlap icon).
3. Set A ☑ Structure, Set B ☑ Mechanical (Hard mode default) → **Run clash test**.
4. Watch Planning / progress / Stop; completes with **491 clashes** (Stop mid-run → "Stopped — partial results").
5. Click a result row → camera focuses, outlines + marker drawn; toggle **Isolate**, **Markers**, **Focus on select**; use **Prev/Next**/pager; **Back to all**.
6. Close the panel (X) / reopen from toolbar; **Clear results**; filter to an empty result.

## Snapshot index and Claude visual review (`snapshots/`)

| # | File | Verdict | Reason |
|---|---|---|---|
| 1 | 01-viewer-loaded.png | PASS | Both models visible; panel toolbar button present |
| 2 | 02-panel-open.png | PASS | Panel anchored top-left, scrolls, lists Structure/Mechanical (was FAIL before fix: mounted below viewport, see Fixes) |
| 3 | 03-test-configured.png | PASS | A/B checked, Run enabled |
| 4 | 04-running.png | PASS | Planning + progress; Run disabled, Stop enabled (duplicate run prevented) |
| 5 | 05-results.png | PASS | Ordered list `#n A ↔ B caveated`, bounded scrollable list |
| 6 | 06-result-selected.png | PASS | Selected row highlighted; camera moved; outlines + marker drawn |
| 7 | 07-isolate.png | PASS | Aggregate isolation 1+1 ids; everything else hidden |
| 8 | 08-markers.png | PASS (marker small) | Marker at the elbow/beam crossing; radius is tiny (limitation L2) |
| 9 | 09-switch-result-1.png | PASS (framing limit) | Selection/isolation/outline update coherently; framing is the whole Floor (L1) |
| 10 | 09-switch-result-5.png | PASS (framing limit) | Clash #5 (Round Elbow vs Concrete-Rectangular Beam) selected; Prev/Next + detail shown; framing is the long Beam, marker a small speck (L1/L2) |
| 11 | 10-switch-result-20.png | PASS | Repeated switch coherent; overlay counts stay 1 marker / 2 outlines |
| 12 | 11-panel-closed.png | PASS | Panel hidden; overlays 0, isolation restored |
| 13 | 12-panel-reopened.png | PASS | Results retained; no stale marker/isolation (was FAIL before fix: transparent body) |
| 14 | 13-empty-filter-state.png | PASS | "No clashes match the current filters" + Clear filters |
| 15 | 14-cleared.png | PASS | Idle · Ready to run; overlays 0 |
| 16 | 15-cancelled-run.png | PASS | "Cancelled · Stopped — partial results (394)" + partial-coverage banner; readable (was FAIL before fix) |

No video (screenshots sufficient). A hard error state was not forced (no safe repro); the cancelled/partial state is the interruption path exercised. Console: 0 errors, 1 expected deprecation warning (`getInstanceTree`).

## Fit-to-view sanity (Track A)

Real focus flow exercised on #1 (Elbow ↔ Floor), #5 (Elbow ↔ Beam), #20. The camera lands on the **union of both elements' boxes** (spec §9.2/§16), the target elements and outlines are visibly framed. When one element is a large Floor/long Beam the clash itself is a small speck inside the frame — usable, not ideal. No numeric/oracle check was run (C8/C6 are not consulted).

## Product-facing status (what a user can visibly do now)

Open/close panel; configure and run a federated Hard test; see progress, stop, partial results; browse/filter/sort/page results; select a result with highlighted row; Focus (camera), Isolate (aggregate, restored on Back to all/close), Markers + per-element bounds outlines; switch results; clear; reopen with retained results; no stale overlays after close/clear/back-to-all.

## Fixes made in this package (live-found)

1. Panel mounted **below the viewport**, unpositioned and not scrollable → shell now anchors geometry and scrolls the body (`clashpanel/ui/ClashDockingPanel.js`).
2. Panel body **transparent** (3D scene bled through the text) → opaque body background.
3. No selected-row highlight / unbounded list → host CSS (`wwwroot/main.css`).
4. Internal review M1 (default page eagerly imported the panel/engine code): `clashPanelHost.js` is now imported lazily on first toggle; default path re-verified live (Room Locator + Clash Finder load, no panel, 0 errors) and panel open/close/reopen re-verified after the change.
5. Host composition built (the Panel was not integrated anywhere): static routes, SVF2 opt-in, extension + toolbar button, host composition, demo loader.

## Known product limitations

- L1 Fit frames the union of both elements (spec-defined); large elements make the clash a small speck.
- L2 Marker radius = 0.2 % of union bounding sphere (clamped 0.05–2.0) → hard to see on large elements.
- L3 The panel does not change the Viewer selection (spec §9.2). The package prompt says "selecting corresponding Viewer objects": highlighting is via isolation + markers/outlines instead. **Product decision for Work/owner; not changed.**
- L4 Toolbar button active state is not synced when the panel is closed with its X.
- L5 Interim `modelKey = urn#loadSeq` (OQ-1 open): results cannot be resumed across a reload. No `measurementBasis`: Soft across models fails closed.
- L6 Demo needs SVF2 opt-in; default sample path is unchanged (SVF, no panel). Structure+Mechanical only.
- L9 In demo mode a later URL hash change can replace the demo model pair (the demo loader re-evaluates the hash), which invalidates the current results/test setup. Not guarded in this package; do not change the hash while a demo session is in use.
- Group by Element exists in the panel; roll-ups remain deferred.

## Verification debt (separate; unchanged by this package)

Historical G2 = `FAIL (row 3)`; C6 `NOT_EVIDENCED`; C8 unresolved; diagnostic/live research checkpointed and deferred; no live diagnostic authorization. No G2 retry, authorization record, attempt reset, procedure/acceptance edit, or G3 step was made. The visual fit check above is Track A evidence only and does not resolve C8.

## Internal review (docs/reviews/2026-10-06-viewer-clash-panel-demo-ready-internal-review.md)

0 Critical / 0 High / 3 Medium / 10 Low. M1 fixed (above). M2 (union framing makes small-vs-large clashes a speck) and M3 (panel does not change the Viewer selection) are spec-defined behaviours recorded as limitations L1–L3 / product decisions for Work/owner, **not** claimed as fully meeting prompt §6/§7 "useful framing" / "selecting Viewer objects". Lows (button active state, double-click before first create, http-LAN `crypto.randomUUID`, hard-coded size, etc.) are listed in the review and left open.
