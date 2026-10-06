# Viewer Clash Panel native-style alignment: headed AFTER evidence (FINAL, round 3, 2026-10-06)

Validation only. No product source, tests or `main.css` were edited by this pass. Nothing committed.

## Launch

- `npm start` (dev server already on :8080, static). Demo URL: `http://localhost:8080/?clashPanelDemo=1`. Toolbar button `#clash-panel-toolbar-button`.
- Playwright headed Chromium, 1280x800 (700x800 for the narrow check, restored). Real Viewer 7.124.2. Round 3 used a cache-bypass reload and waited for both models to finish loading.
- BEFORE evidence (referenced, not copied): `docs/research/2026-10-06-viewer-clash-panel-product-facing-continuation-ii/snapshots/` (`02-panel-open.png`, `04-soft-unavailable-two-models.png`, `05-hard-ready-soft-explained.png`, `06-completed-491.png`, `07-group-element-collapsed.png`, `08-group-expanded.png`, `12-grouped-isolate.png`, `15-empty-filtered-selected-hidden.png`, `16-group-none-selection-kept.png`, `20-cleared.png`) and `reference-audit.md` in this folder.
- AFTER (final) evidence: `after/` (16 PNGs). Superseded-round shots that show now-closed defects: `after/superseded-rounds/` (`round1-01-panel-initial-open.png`, `round1-03-run-loading.png`, `round1-10-filter-pager.png`, `round1-15-actions-active.png`, `round2-03-run-loading-D-E.png`).

## History: Round 1 -> Round 2 -> Round 3

| ID | Found in | Finding | Closed by (`wwwroot/main.css`) | Verified closed (round 3) |
| --- | --- | --- | --- | --- |
| D-A | R1 | Inline checkbox/radio labels touched ("Unverified only[]Has location", "None(o)Element"); `round1-03`, `round1-10` | inline-flex labels, gap 4, margin-right 14 | Clear gaps in `after/03,04,05,10,11` |
| D-B | R1 | "Hide setup" glued to "Test name"; tight legends; `round1-01` | `.clash-setup-toggle` block, `label.clash-name` block, legend margin-bottom | Own row, label above full-width input (`after/01,02,12`) |
| D-C | R1 | "Show only this element" inline against `#180`; `round1-15` | `button[data-key^="selected-only-"]` block + margins | Stacked buttons, even action row (`after/09`) |
| L3 | R1 | Disabled Soft nearly invisible | label opacity .55 | R3: label .55 (see CR-2 for the refinement) |
| D-E | R2 | New side effect: Filter/Model/Sort labels squeezed and wrapped ("Filte/r", "Mode/l", "Sor/t"); `round2-03-run-loading-D-E` | stacked column layout for `label.clash-filter-text/-model/.clash-sort` | Label height 49-51px, width 434 = control width 434, `flex-direction:column`, margin-bottom 6px; no wrapping in `after/03,04,05,10,11,13` |
| CR-1 | Codex review | No keyboard focus ring on text/search/select | `:focus-visible` 2px outline `#1dc6f2` | Tab from the setup toggle lands on Test name: `focus-visible` true, outline 2px solid `rgb(29,198,242)` (`after/01` shows the ring). Shift+Tab to the Filter search: same 2px solid `rgb(29,198,242)` (`after/10`) |
| CR-2 | Codex review | Disabled-label opacity compounded onto the disabled input | input opacity reset to 1 | Disabled Soft: label 0.55, input 1 (computed). Soft radio and text readable, visibly disabled (`after/01,02,12`) |
| CR-3 | Codex review | Fieldset margin from PANEL_CSS (`margin:0`) overrode the 8px fieldset spacing | `fieldset.clash-set/.clash-mode/.clash-group` margin `0 0 8px` | Computed margin-bottom 8px on `clash-mode`, `clash-set-A`, `clash-set-B`, `clash-group` |

## Comparison table (final)

| Area | Before | After (measured) | Viewer-native reference | Verdict |
| --- | --- | --- | --- | --- |
| Header | Native title, body overlapped by 10px | Title y58-108 (50px); body y108, `top:50px`; no overlap | `.docking-panel-title` 50px | PASS |
| Body | Flat inline `#fff`, OS scrollbar | `docking-panel-scroll docking-panel-container-solid-color-a`, native 6px thumb, 460x622 scrolling; bg computes opaque white (native .94, not visible) | `docking-panel-scroll` | PASS |
| Typography | 21px h2, Arial 13.33px controls | h2 14px/700 capitalize on band; controls Artifakt 12px; 0 Arial elements | 14px bold band, 12px controls | PASS |
| Buttons | Gray `2px outset` | Secondary `1px solid #4a555b` radius 4 pad 6/10 12px, hover `#00bfff`; Run `#06a7df` 34px bold radius 3, hover `#00bfff`; Stop `#939ca5`; 0 outset/inset/groove | `.adsk-button.table-button`, `.docking-panel-primary-button` | PASS |
| Selects | Arial, `1px #767676`, labels inline | `1px solid #d5dbe1`, radius 4, 12px `#4a555b`; stacked labels; Filter/Model/Sort controls 434px = full width; Test name 434px; 2px `#1dc6f2` keyboard focus ring | `select.option-drop-down`, native search box | PASS |
| Checkboxes | Browser default | accent `#00bfff`, 13px, spaced labels; disabled Soft input 1 / label .55 | none native; accent | PASS |
| Sections | Five 21px headings, groove fieldsets, bullets | Band headings, no fieldset border, unbulleted lists, fieldset margin-bottom 8px | `tr.logical-group` | PASS |
| Group rows | Gray outset buttons | Full-width bold band rows, chevrons, hover `rgba(0,191,255,.2)` | `.group.category > lmvheader` | PASS |
| Result rows | Bordered box | 12px, no box, hover `rgba(0,191,255,.2)` | tree row | PASS |
| Selected row | `#cfe8fb` + 4px blue bar | `rgb(231,231,231)` + 3px `rgb(153,153,153)` | `#e7e7e7` + 3px `#999` | PASS |
| Disabled state | Gray default | opacity .4 buttons (Stop, Clear filters, Next/Prev), .55 label for Soft; readable yet disabled | `opacity:.4` | PASS |
| Scroll behavior | Default OS bar | Body scrolls under the title with a native thumb; inner list also scrolls | `docking-panel-scroll` | PASS |
| Responsive width | 460px; page overflow 20px at 700 | 700x800: panel [10,58] 460x657, right 470 <= 700, bottom 715; 0 children overflow the panel; body scrollWidth 454 = clientWidth; page scrollWidth 720 vs 700 solely from external `#header` `LABEL` "Load as additional model" (right 720) | fixed-width panels | PASS (overflow external, deferred) |

## Per-screenshot verdicts (`after/`, final)

| # | File | Verdict | Reason |
| --- | --- | --- | --- |
| 01 | 01-panel-initial-open.png | PASS | Toggle row, label above full-width Test name input with visible 2px keyboard focus ring, Mode radios, Soft dimmed, spaced Set A/B |
| 02 | 02-test-setup.png | PASS | Ready; Soft explanation; checked boxes cyan; blue Run (clipped only by panel bottom, scroll) |
| 03 | 03-run-loading.png | PASS | Filter/Model/Sort labels stacked, no wrapping; progress row and gray Stop readable (body scrolled 16px by focus, harmless) |
| 04 | 04-completed-results.png | PASS | Completed 491, status lines, Copy diagnostics, stacked labels |
| 05 | 05-group-none.png | PASS | Flat list, pager, Selected-clash band; Group legend sits tight under checkbox row (Low note N1) |
| 06 | 06-group-element-collapsed.png | PASS | Banded bold group rows with chevrons |
| 07 | 07-group-element-expanded.png | PASS | Expanded group with nested rows |
| 08 | 08-selected-result.png | PASS | `#e7e7e7` + gray bar, readable, distinct |
| 09 | 09-action-controls.png | PASS | Stacked Show-only buttons; Focus / Isolate / Markers / Focus on select / Back to all evenly spaced |
| 10 | 10-filter-pager.png | PASS | Focus ring on filter, "(1 of 2)" counts, selected row, Clear filters enabled |
| 11 | 11-empty-clear-state.png | PASS | Cleared state, Ready, full-width fields |
| 12 | 12-soft-unavailable.png | PASS | Soft disabled with explanation, Ready, spaced sets |
| 13 | 13-narrow-700.png | PASS | Fits; scrolls; stacked labels; page h-scroll only from external header label |
| 14 | 14-close-reopen.png | PASS | Reopened after X: active button, results kept |
| 14a | 14a-closed-via-x.png | PASS | Panel hidden, button inactive |
| 15 | 15-stopped-partial.png | PASS | "Cancelled - Stopped - partial results (394)", left-bar callout |

Totals (16 PNGs): PASS 16, FAIL 0, INCONCLUSIVE 0. Required 14 (01-14): PASS 14, FAIL 0.

Low notes (not FAIL): N1 the Group legend is tighter to the preceding checkbox row than Sort is to the radio row; cosmetic. N2 "Filters And Grouping" capitalizes "And" via `text-transform:capitalize` (same as native settings groups). N3 body bg is opaque white vs native .94 (invisible).

## Category verdicts (final)

Header PASS; Body PASS; Typography PASS; Buttons PASS; Selects/inputs PASS; Checkboxes/radios PASS; Sections/hierarchy PASS; Group rows PASS; Result rows PASS; Selected row PASS; Disabled state PASS; Scroll PASS; Responsive PASS; Contrast/readability PASS; Status/validation area PASS; Action buttons PASS; Regressions: none (visual or behavioral).

## Remaining FAIL

None.

## Console

Demo session (cache-bypass load, 3 runs, Stop, group/filter/pager, keyboard Tab, close/reopen, 700px): 0 errors; warnings only the Viewer-origin `Model#getInstanceTree` deprecation. Default URL: 0 errors, 0 warnings.

## Functional regression (round 3)

| Item | Result |
| --- | --- |
| First click opens one panel | PASS (1 panel) |
| Run -> 491 | PASS (reproduced twice) |
| Stop | PASS (partial 394) |
| Group None / Element | PASS |
| Filter (incl. no-match message) | PASS |
| Pager | PASS (1/10 -> 2/10) |
| Focus / Isolate / Markers / Back to all | PASS (aggregate isolation 2, then 0) |
| Clear results | PASS |
| X-close, toolbar sync, reopen | PASS (active -> inactive/display none -> active, 1 panel) |
| Default URL | PASS (no panel, no Clash button, 0 errors) |
| Room Locator / Clash Finder | Both extensions loaded on the default URL; their toolbar buttons were not enumerated (smoke only) |

## Responsive (final)

1280x800: panel [10,58] 460x672, document scrollWidth 1280 = innerWidth. 700x800: see table; panel fits and nothing inside it overflows; the only page-level overflow is the external header label (deferred external, not Clash Panel ownership).
