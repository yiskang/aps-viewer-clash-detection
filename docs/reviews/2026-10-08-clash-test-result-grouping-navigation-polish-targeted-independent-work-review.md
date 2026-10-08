# Clash Test Result Grouping / Navigation Polish — Targeted Independent Work Re-review

**Date:** 2026-10-08  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / HEAD:** `main` / `e8969cb7d22410c25a476ee294a393eafba469a5` (`origin/main` identical)  
**Review boundary:** owner-authorized two-row navigation polish, its directly affected controller/view-model/render/CSS/tests, the corrected upstream final report, and the retained 23-image navigation evidence set

## Verdict

**Targeted re-review passed. Ready for owner checkpoint decision.** The two-row pager materially improves the distinction between clash-to-clash navigation and result-page navigation without changing selection, grouping, ordering, paging, or Viewer-action semantics. The prior report finding L3 is correctly resolved. No further implementation or report correction is required for this targeted gate.

Findings in this targeted scope: **0 Critical / 0 High / 0 Medium / 0 Low**.

The previously recorded non-blocking product limitations remain open and are not reopened by this review: no Viewer property-callback timeout, the native Viewer toolbar overlaps the second pager row at the 480 px application width, hidden-text filtering can make a visible group label look unrelated to the query, the one-time 611 ms Element cold switch, and the pre-existing enabled Prev/Next state in None with no selection.

## Independent verification

### 1. Navigation state and rendering

- `clashpanel/core/controller.js` derives `nav.scoped` from the same effective condition that governs actual group-constrained neighbours: the retained scope exists in the current grouped result and remains expanded.
- `clashpanel/core/viewModel.js` carries `nav.scoped` without deriving new navigation behavior. The selection label remains `Clash #N`; presentation wording belongs to the renderer.
- `clashpanel/ui/render/results.js` renders two visibly labelled rows: **Selected clash** owns Previous/Next, while **Result pages** owns page Previous/Next. Only the selected-clash buttons acquire “in group” text and matching aria-labels when `nav.scoped === true`.
- Page controls still dispatch only `nav/page`; clash controls still dispatch only `nav/prev` and `nav/next`. Existing enable/disable values remain authoritative.
- `wwwroot/main.css` stacks the two rows and permits bounded wrapping. It does not alter result identity, controller state, or Viewer behavior.

Graph tracing confirms `navOf` feeds `listInput`/`viewInput`, and `navBlock` is called only by `renderResults`. Coverage checks report no recorded issue for every relied-on source/test path and relevant scope; direct source/test inspection was also used because graph coverage is best-effort.

### 2. Corrected navigation contract

The final report §5a now matches the executable contract:

- Element → None → Element may restore a still-valid, still-expanded Element scope after its flat-mode dormancy.
- Switching to a different grouped mode drops a scope whose group id does not exist there.
- Filtering away the scoped group drops that scope and Clear filters does not resurrect it.

The report no longer makes the earlier overbroad claim that every switch away and back drops group scope.

### 3. Visual evidence — all 23 screenshots independently inspected

Work verified the evidence manifest and opened **every one of the 23 retained PNGs at original detail**, including the five the validating agent did not visually review. This review does not rely on the upstream PASS table as proof.

The retained classification **23 PASS / 0 FAIL / 0 INCONCLUSIVE** is supported:

- Plain None-mode navigation shows separate clash and page rows; selection and paging remain independent.
- Element and Model Pair examples show “Previous/Next in group” only while the selected occurrence is actually constrained to an expanded group, including a cross-page in-group step.
- Collapse, filter-away, and grouped-mode switches remove “in group” wording. Retained hidden selections remain plainly labelled where present, with disabled clash controls when no visible neighbour is available.
- Page navigation changes the page without changing the selected clash; clash navigation follows the selected occurrence across page boundaries.
- The last-page control is disabled correctly, and Focus/Isolate/Markers/Back to All evidence shows no action-path regression.
- At 480 px, both pager rows fit horizontally. The native Viewer toolbar visibly overlays row 2 in `09a`; `09b` proves the complete Panel layout with that toolbar hidden. The evidence and report accurately classify this as a pre-existing host-layout caveat, not responsive-support proof.

The five-image visual-review gap is therefore closed by this independent review.

### 4. Upstream final-report correction

The read-only upstream report now records the corrected navigation-scope contract and the package's measured tracked-file statistics. Its 22-file count is still current. Its +617/−85 insertion/deletion snapshot predates subsequent handoff text; immediately before this review/handoff write, the tracked diff was +626/−85. The report explicitly states that these counts can drift with later edits and must be re-measured at commit time, so this is a transparent measurement boundary rather than a renewed factual contradiction. No additional upstream correction is required for this gate.

Work did not edit the upstream final report.

## Tests and repository boundary

- Focused controller-navigation + view-model suite: **45/45 pass**.
- Panel DOM suite: **106/106 pass**.
- Offline suite: **5,447 total / 5,446 pass / 0 fail / 1 existing todo**.
- Evidence integrity: **23/23 PNG hashes plus README hash verified**.
- `git diff --check`: clean.
- `main == origin/main == e8969cb7d22410c25a476ee294a393eafba469a5`; working tree remains dirty, uncommitted, and unpushed.
- No `clashtest/` or `collision/` production diff is present. No G2/C6/C8, G3, reflected-fragment, R20-1, manager/history/lifecycle, or multi-level grouping work was introduced.

## Authorization / next action

The targeted independent Work re-review is complete. The grouping/navigation package, navigation polish, corrected final report, and retained evidence are ready for an **owner checkpoint decision**.

Until explicitly authorized, do not commit or push, remediate retained Lows, or begin any additional product or milestone scope.
