# Headed product-path validation: Clash Panel single-level grouping (None / Element / Model Pair / Category / Level)

Date: 2026-10-08. Normal app (`node server.js`, port 8080, `#<Architecture URN>` hash load, Audubon SVF2 Architecture then Structure and Mechanical via "Load as additional model"; Panel opened from the toolbar button; Hard test configured in Test Setup; NOT `?clashPanelDemo=1`). Viewer 7.124.2, Playwright MCP headed, viewport 1300x950 (480x900 for the narrow case). Working tree has the uncommitted grouping work; no source/test/spec file was edited.

Self-clash note: a completed Architecture x Architecture result does not exist in a fresh browser session and the brief requires self-clash grouping validation, so the multi-minute self-clash was run ONCE (about 2.5 min, 4,770 clashes, 4294 units, completed, coverage full, integrity caveated, diagnostics 57,130). Cross-model results were each run once and reused for all modes.

Set labels: AxM = Architecture x Mechanical (1211), AxS = Architecture x Structure (2277), SxM = Structure x Mechanical (491), AxA = Architecture self (4770), AxMS = Architecture x (Mechanical+Structure) (3488; accidental extra run), Dup = Structure x (Mechanical#3 + Mechanical#4, same URN loaded twice) (982).

## Scenario table

| Scenario | File | Result | Reason |
|---|---|---|---|
| AxM run state | AxM-00-run-state.png | PASS | Completed 1211 clashes, Group None, panel opened in normal app |
| AxM ungrouped baseline | AxM-01-none-baseline.png | PASS | Flat list, 1211 |
| AxM Model Pair | AxM-02-model-pair.png | PASS | 1 group "Audubon_Architecture_clash_test <-> Audubon_Mechanical_clash_test (1211)" |
| AxM Category | AxM-03-category.png | PASS | 43 groups, sum 1211, e.g. "Air Terminals <-> Rooms (136)", "Air Terminals <-> Walls (19)" |
| AxM Level | AxM-04-level.png | PASS | 5 groups, sum 1211 (see labels below), "Unknown Level" present |
| AxM Element | AxM-05-element.png | PASS | Page 1 of 50-group pages; multi-valued note shown ("listed under both elements, counts do not add up") |
| AxM filtered grouped (text "Wall", Category) | AxM-06-category-filtered-Wall.png | PASS | 311 match filters; partial groups "(107 of 136)"; sum of group visible counts = 311 |
| AxM group nav (select, Prev/Next) | AxM-07-group-nav-selected.png | PASS | "(within its group)" shown when selected in expanded group |
| AxM origin group filtered away | AxM-08-origin-group-filtered-away.png | PASS | Suffix gone ("Clash #137"), "The selected clash is hidden by the current filters." |
| AxM empty filtered | AxM-09-category-empty-filtered.png | PASS | "No clashes match..." only; no grouping note, no stale rows; also verified in Element/Model Pair/Level/None by DOM text |
| AxM Clear filters returns to grouped state | AxM-10-category-after-clear-filters.png | PASS | Full groups back; expanded group preserved |
| AxM Focus/Isolate/Markers/Back to all | AxM-11-actions-isolate-on.png | PASS | Isolate on => aggregate isolation [1,1]; Isolate off => []; Markers toggle 1/2 overlay objs <-> 0/0; Back to all clears isolation, markers, selection |
| AxM narrow viewport (480px) | AxM-12-narrow-level-selected.png | PASS (caveat) | Layout intact, labels wrap, pager wraps, no horizontal overflow in Results. Panel width itself is fixed (~460px) and was not user-resizable, so only the viewport was narrowed; viewer toolbar overlaps panel bottom (pre-existing viewer behaviour) |
| AxMS Level (extra) | AxMS-01-level.png | PASS | 15 groups, sum 3488 |
| AxMS Model Pair (extra) | AxMS-02-model-pair.png | PASS | 1211 + 2277 = 3488 |
| AxS ungrouped baseline | AxS-00-none-baseline.png | PASS | 1/46 pages. Low observation: Prev/Next enabled with "No clash selected" in None |
| AxS Model Pair | AxS-01-model-pair.png | PASS | "Architecture <-> Structure (2277)" |
| AxS Category p1 | AxS-02-category-page1.png | PASS | 50 groups sum 2275 |
| AxS Category p2 | AxS-03-category-page2.png | PASS | "Walls (2)"; 2275+2 = 2277 |
| AxS Level | AxS-04-level.png | PASS | 10 groups sum 2277 |
| AxS Element | AxS-05-element.png | PASS | multi-valued note shown |
| AxS filtered grouped ("Floor") | AxS-06-category-filtered-Floor.png | PASS | 889 match; 14 groups, sum 889 |
| AxS group nav | AxS-07-group-nav-within-group.png | PASS | "Clash #2250 (within its group)", Next/Prev step the 4-clash group |
| AxS origin group filtered away | AxS-08-origin-group-filtered-away.png | PASS | Suffix gone, hidden note shown |
| AxS empty filtered | AxS-09-empty-filtered.png | PASS | clean empty state |
| SxM baseline | SxM-00-none-baseline.png | PASS | 1/10 pages (same Prev/Next-enabled-without-selection low observation) |
| SxM Model Pair | SxM-01-model-pair.png | PASS | "Mechanical <-> Structure (491)" |
| SxM Category | SxM-02-category.png | PASS | 13 groups sum 491 |
| SxM Level | SxM-03-level.png | PASS | 3 groups sum 491 |
| SxM Element | SxM-04-element.png | PASS | multi-valued note shown |
| SxM filtered grouped ("Duct") | SxM-05-category-filtered-Duct.png | PASS | 170 match, 4 groups sum 170 |
| SxM group nav | SxM-06-group-nav-within-group.png | PASS | "Clash #354 (within its group)" |
| SxM origin group filtered away | SxM-07-origin-group-filtered-away.png | PASS | filter "Elbow" removes origin group; suffix gone, hidden note |
| SxM empty filtered | SxM-08-empty-filtered.png | PASS | clean |
| AxA baseline | AxA-00-none-baseline.png | PASS | 1/96 pages |
| AxA Model Pair | AxA-01-model-pair.png | PASS | "Architecture <-> Architecture (4770)" |
| AxA Category | AxA-02-category.png | PASS | 2 pages, 4130 + 640 = 4770; same-category groups "Casework (11)" |
| AxA Level | AxA-03-level.png | PASS | 8 groups sum 4770 |
| AxA Element | AxA-04-element.png | PASS | 70 pages, multi-valued note |
| AxA group nav, 4,143-row group | AxA-05-group-nav-big-group.png | PASS | Prev/Next 13-15 ms, page crossing works |
| AxA filtered grouped ("Mullion") | AxA-06-category-filtered-Mullion.png | PASS | 2467 match |
| AxA group nav, small group | AxA-07-group-nav-small-group.png | PASS | Next disabled at group end, suffix kept |
| AxA origin group filtered away | AxA-08-origin-group-filtered-away.png | PASS | suffix gone, hidden note |
| AxA empty filtered | AxA-09-empty-filtered.png | PASS | clean |
| AxA Clear results | AxA-10-after-clear-results.png | PASS | resets to "Run a test to see clashes.", Group back to None, no stale groups |
| Duplicate-name model case | Dup-01-model-pair-duplicate-names.png | PASS | two groups "Mechanical · ...dA#3 <-> Structure (491)" and "...dA#4 <-> Structure (491)"; not merged |

Totals: 46 PNG scenarios, 46 PASS, 0 FAIL, 0 INCONCLUSIVE (one PASS carries a caveat: narrow case only narrowed the viewport).

## Real group labels and counts

- Model Pair: AxM "Audubon_Architecture_clash_test <-> Audubon_Mechanical_clash_test (1211)"; AxS "... Architecture <-> ... Structure (2277)"; SxM "... Mechanical <-> ... Structure (491)"; AxA "... Architecture <-> ... Architecture (4770)"; Dup "Audubon_Mechanical_clash_test · ...dA#3 <-> ...Structure (491)" and "#4 ... (491)". Sums equal totals.
- Category (AxM): 43 groups, sum 1211: "Air Terminals <-> Casework (1)", "Air Terminals <-> Rooms (136)", "Air Terminals <-> Walls (19)", "Casework <-> Ducts (5)". AxS: "Casework <-> Floors (26)", "Curtain Wall Mullions <-> Structural Framing (432)", "Walls (2)". SxM: "Air Terminals <-> Floors (68)", "Duct Fittings <-> Floors (189)". AxA: "Curtain Panels <-> Curtain Wall Mullions (539)", "Curtain Wall Mullions <-> Rooms (959)".
- Level: AxM "Arch-BEARING <-> FIRST FLOOR (2)", "Arch-FIRST FLOOR <-> FIRST FLOOR (1193)", "Arch-FIRST FLOOR <-> Unknown Level (12)", "FIRST FLOOR <-> MP Room Lighting (1)", "FIRST FLOOR <-> Unknown Level (3)" = 1211. AxS: "FIRST FLOOR <-> FOUNDATION PLAN (1994)" etc. = 2277. SxM: "Arch-FIRST FLOOR <-> FOUNDATION PLAN (488)", "FOUNDATION PLAN <-> MP Room Lighting (1)", "MEZZANINE <-> MP Room Lighting (2)" = 491. AxA: "BEARING (84)", "BEARING <-> FIRST FLOOR (335)", "FIRST FLOOR (4143)", "FIRST FLOOR <-> Unknown Level (163)", "Unknown Level (15)" = 4770.
- Element (multi-valued, sums intentionally exceed totals; note displayed): e.g. "Audubon_Architecture_clash_test · Basic Wall [899117] (5)".

## Self-clash performance (AxA, 4,770 clashes; in-page performance.now; no long tasks >50 ms except one)

| Measure | Value |
|---|---|
| Mode switch, cold: Model Pair / Category / Level | 13.2 / 6.7 / 7.3 ms |
| Mode switch, cold Element | 610.6 ms (one long task of 609 ms, only one observed) |
| Mode switch, warm (repeat, any mode) | 5-17 ms |
| Expand 4,143-row Level group (first / collapse / re-expand) | 24 / 33 / 32 ms (45 rows rendered, 84 in-group pages) |
| Filter keystroke handler (10 chars, "Basic Wall") | 4.8-10.3 ms each; max rAF frame gap 27 ms; filtered-to-1303 settled within debounce; clear-to-full 178 ms |
| Prev/Next latency | 13-15 ms (label update); page-boundary Next moves to page 2 with selection visible |
| Console errors | 0 errors; warnings: Model#getInstanceTree deprecation + three-mesh-bvh coplanar triangle warnings (expected) |

## Observations (not FAILs)

1. Low, pre-existing-looking: in Group None the Prev/Next buttons are enabled while "No clash selected" (grouped modes disable them). Not grouping-specific.
2. Text filter matches the hidden searchText of both sides (e.g. "Wall" matched Room clashes because the other side is "Supply Diffuser - Sidewall"); group labels are categories, so a filtered group can look unrelated to the filter text. Existing filter semantics, not grouping.
3. Expanded-group state survives mode switches and Clear filters; Clear results resets Group to None.
4. Within-group suffix is not shown after a mode switch away and back (scope intentionally dropped); consistent with navOf() in clashpanel/core/controller.js.
5. A camera-set via viewer.navigation.setPosition in a script coincided with the selection clearing once; not reproduced and not attributed to grouping (script action, not a user path).

Verify: `shasum -a 256 -c MANIFEST.sha256`
