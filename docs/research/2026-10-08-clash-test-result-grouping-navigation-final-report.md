# Clash Test Result Grouping / Navigation — Package Final Report (2026-10-08)

## 1. Repository state
- Repo `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`; branch `main`; HEAD `e8969cb7d22410c25a476ee294a393eafba469a5` (verified = expected starting checkpoint; `origin/main` identical at start).
- Working tree: **dirty, uncommitted, unpushed** (owner did not authorize commit/push). **Corrected statistics (post navigation polish, measured with `git ls-files -m` / `git diff --shortstat`): 22 modified tracked files, +617/−85** (the first draft said 16 files, +441/−50 — stale; Work L3). Untracked package artifacts: `clashpanel/core/{groupModes,elementProperties,propertyGrouping}.js`, `test/clashpanel/core/{controller.grouping,controller.propertyGrouping,propertyGrouping}.test.mjs`, the brief, this report, the Work review, and evidence dirs. Counts will drift if further edits land; re-measure at commit time.

## 2. Governing artifacts / authorized scope
- Brief: `docs/reviews/for-claude-clash-test-result-grouping-navigation.md`. Spec: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` (new **§25**; §0 Q9, §10.2, §18 reconciled). Starting handoff: H1/H2 checkpoint (no open gate; owner authorized this package in the current task).
- Scope: single-level grouping None / Element / Model Pair / Category / Level + navigation/filter interaction inside the existing single-test Panel. No manager panel, history, lifecycle, nesting.

## 3. Owner decision recorded
Level metadata has no universal attribute across the Audubon models (live probe). Owner chose **per-side level pair**: documented precedence, unordered pair of resolved level labels, same-level collapses to one label, `Unknown Level` for missing, **no cross-model name normalization**, no world-Z fallback.

## 4. Grouping modes implemented
Registry `clashpanel/core/groupModes.js` (none, element, modelPair, category, level; each descriptor supplies compute/labelOf/multiValued/note/unavailable text). Group ids: Model Pair = Core `pairModels` facet id; Category/Level = `JSON.stringify([modeId, key])` — never display text. Radios in `ui/render/filters.js`.
- **Model Pair:** keyed by `modelKey` via Core `pairModels` (canonical because `PairId` orders first/second for volume-overlap/clearance, the only Panel modes). Self-clash `A ↔ A`; same display name on different instances stays distinct and disambiguated; missing name → `Model <key>`.
- **Category:** `Category` attribute (`__category__`), unordered raw pair, `Revit ` prefix stripped for display only, same category → single label, missing → `Unknown category`, colliding display labels disambiguated by raw text.
- **Level:** precedence internal-ref `Level` (numeric dbId resolved to Level element name, trailing ` [digits]` stripped) → `Constraints` `Level` → Reference Level → Base Level → Base Constraint; first non-empty wins.
- Property read: `elementProperties.js`; `getBulkProperties2` (fallback `getBulkProperties`), distinct dbIds only, ≤2000 ids/chunk, sliced + generation-guarded, cached per run and shared by both modes. Failure/unloaded model → mode *unavailable* (flat list + note), never guessed; transient failures retry on next mode selection (see §9).

## 5. Filtering / sorting / navigation
Counts reflect filtered members (`n of m`); empty groups dropped; Sort group-count/group-label works for all modes. Both known Lows closed: stale `(within its group)` now requires the scope group still present (and `rebuildOrdered` clears missing scope); grouping/multi-valued notes suppressed over empty/error lists. Multi-valued note only for Element.

### 5a. Navigation-scope contract across mode switches (corrected wording; Work L3)
Group-scoped navigation is **not** always dropped on a mode switch. Executable contract (`controller.navigation` / `controller.propertyGrouping` tests): the scope is a stable group id. Element → None → Element: scope survives None dormant and the still-valid, still-expanded Element scope is restored. Switching to a *different grouped* mode (e.g. Element → Model Pair) drops the scope because that group id does not exist in the new grouping (selection is kept; navigation is whole-list). Model Pair → Element → Model Pair does not resurrect the scope (same code path; only the Element→Model Pair→Element direction has a direct test). A scope group filtered away is dropped and not restored by Clear filters.

### 5b. Navigation-clarity polish (owner-authorized, 2026-10-08, post Work review)
The pager is now two labelled rows: **Selected clash** `◀ Previous / Clash #N / Next ▶` (`data-scope="selected-clash"`) and **Result pages** `‹ / Page X of Y / ›` (`data-scope="result-pages"`). While navigation is truly group-constrained (same condition that previously drove the suffix) row 1 reads `Previous in group` / `Next in group` with `data-group-scoped="true"`, aria-labels "…clash in group"; the `(within its group)` suffix is removed (`nav.label` = `Clash #N`, `nav.scoped` flag). No change to paging, clash-selection, grouping identity, ordering or enable/disable rules. Files: `ui/render/results.js`, `core/controller.js`, `core/viewModel.js`, `wwwroot/main.css` + DOM/viewModel/controller tests (the implementing agent wrote the new tests after the code, not strictly test-first; old suffix assertions were rewritten, not weakened). Verification: offline 5,447 / 5,446 pass / 0 fail / 1 todo; DOM 106/106 (+4); diff check clean. Headed navigation-only validation: [evidence](evidence/2026-10-08-navigation-polish-headed/README.md) — **23 PASS / 0 FAIL / 0 INCONCLUSIVE** (Structure×Mechanical 491, Architecture×Mechanical 1,211; in-group wording only when constrained; collapse/filter-away/mode-switch → plain wording; page row independent of selected clash; page-next disabled at last page; Focus/Isolate/Markers/Back to all OK). Lows: native Viewer toolbar overlaps row 2 at 480 px (existing layout; both rows verified with it hidden); hidden selection's `Clash #N` label stays with Prev/Next disabled after collapse/mode switch; Prev/Next enabled in None with no selection (pre-existing). Panel-level 480 px page scroll is from the app header. Sections 7-8 numbers above predate this polish except where noted.

## 6. Large-result behavior (headed, real SVF2 Architecture self-clash, 4,770 clashes, normal app)
Cold mode switch: Model Pair 13.2 ms, Category 6.7, Level 7.3; **Element 610.6 ms (one 609 ms long task, the only one)**; warm 5–17 ms. Expand 4,143-row Level group 24 ms. Filter keystroke 4.8–10.3 ms, max frame gap 27 ms; Clear filter 178 ms; Prev/Next 13–15 ms. 0 console errors. No virtualization added. Offline fake-source compute: Category ~9.5 ms, Level ~5.7 ms.

## 7. Headed validation
Evidence: `docs/research/evidence/2026-10-08-grouping-navigation-headed/` (46 PNGs, README, `MANIFEST.sha256`). Sets: A×M 1,211; A×S 2,277; S×M 491; A self 4,770 (one ~2.5 min run, needed because no completed result exists in a fresh browser session); extras A×(M+S) 3,488 and S×(M loaded twice) 982 (duplicate-name case: two distinct Model Pair groups). Captured per brief: baseline, all modes, filtered grouped, empty-filtered, group navigation, filtered-away origin, narrow width (480 px viewport only; panel itself not resizable), Focus/Isolate/Markers/Back to all/Clear.
**Visual totals: 46 PASS / 0 FAIL / 0 INCONCLUSIVE** (classified by the validating agent reading each PNG; the controller did not re-view every image). Group-count sums equal totals for single-valued modes (e.g. Category self-clash 4130+640=4770). Live probe (Viewer 7.124.2 SVF2): Category 100% on all three models; Level union coverage Arch 97.8%, Structure 100%, Mechanical 100% (internal-ref alone 97.7/39.3/49.3%).
Note: the Medium fix (§9) landed **after** headed validation; it changes failure-recovery only and is unit-covered; the headed run was not repeated.

## 8. Tests
Baseline 5,383/5,382 → **offline 5,446 tests / 5,445 pass / 0 fail / 1 todo** (before nav polish; after polish 5,447 / 5,446 / 0 / 1); DOM 97 → **102/102** (106/106 after polish); `git diff --check` clean (controller-verified on final tree). New: `controller.grouping`, `propertyGrouping`, `controller.propertyGrouping` tests; real-engine Model Pair (A×B/B×A, self-clash) tests; DOM radio/render tests.

## 9. Internal review
One bounded review (+ one `codex-advisor medium` consult): **0 Critical / 0 High / 1 Medium / 3 Low.**
- Medium (fixed): transient property-read failure locked Category and Level as unavailable for the whole run → now retried on next mode selection; `model-not-loaded` outcomes dropped on catalog change; `properties-unsupported` stays cached. Tests written first (2 failed pre-fix).
- Low (fixed): unload-event-order realism test added.
- Low (open): no timeout on the property read (hung host callback leaves mode busy until next run/unload).
- Low (open): Sort "Group name" compares lowercased UTF-16 units vs code-point default order (deterministic, identity unaffected).
Headed-run Low observations (existing behavior, not grouping): Prev/Next enabled in None with no selection; text filter matches hidden text of both sides; expanded-group state persists across mode switches/Clear filters (see §5a for the exact nav-scope contract); one unreproduced selection clear during scripted camera moves.

## 10. Remaining debt / assumptions
No read timeout; pinned-build assumptions (`getBulkProperties2` signature; `propFilter:['Name']` drops row name; integer `__internalref__` values) from probe on one Viewer build/SVF2 only; Level names unnormalized across models by owner decision (e.g. `Arch-FIRST FLOOR` ≠ `FIRST FLOOR`); Element cold switch 611 ms long task on 4,770 results; panel-resize narrow case not exercised. G2/C6/C8 debt unchanged.

## 11. Protected boundaries
`clashtest/`, `collision/`, R20-1 perf code unchanged (git status). No manager panel, history, lifecycle, nesting, reflected-fragment work, G2/C6/C8/G3, retry/record/reset/procedure change. Not committed/pushed.

## 12. Next gate
**Ready for independent Work visual/product review.** Independent Work review completed earlier (0C/0H/0M/3L, accepted); nav polish then authorized by owner and a targeted Work re-review of it is the next gate. Next authorized action: that re-review only. Not authorized: commit/push, new milestone, any item in §10 remediation without owner direction.
