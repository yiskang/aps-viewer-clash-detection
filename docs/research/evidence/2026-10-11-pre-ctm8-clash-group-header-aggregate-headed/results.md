# Pre-CTM-8 clash group header aggregate presentation: headed SVF2 evidence

**Scope:** Addendum B (spec §27, AC-GP1 to AC-GP12) headed check only. **This is not CTM-8 evidence.** Date 2026-10-11. Repo `main` @ `9e49f40` with the uncommitted B1–B7 working tree. `git diff --stat` was the same before and after the run (27 files, +875/−72). No production or test file was edited.

**Runtime:** `PORT=8080 node server.js` using the existing `.env`. The run used Playwright MCP headed Chromium at 1600×1000 and Viewer 7.124.2. Models were Audubon Architecture #1, Structure #2 and Mechanical #3, all SVF2 in ft. Structure and Mechanical were later unloaded and reloaded as #4 and #5. Two tests were run:
- "ArchStruct x Mech" (Hard), A = Arch + Struct, B = Mech: 1702 clashes
- "Mech self" (Hard, self-compare on Mech #5): 242 clashes

The Clash Panel was opened from the toolbar button. The server was stopped and the browser closed at the end. The capture helper is `capture-helper.js`, kept here and read-only. All captures are in `state-captures.json`: 57 entries, one per step tag.

| # | Item | Verdict | Key observation | Evidence |
|---|---|---|---|---|
| 1 | One-model group | PASS | Mech self Model Pair group: 242 clashes / 365 participants. Camera moved. Isolation `{5:365}`. Overlays 0/0. | GP-20 |
| 2 | Two-model group | PASS | Arch↔Mech: 1211 / 1004 participants. Isolate gives `{1:238, 3:766}` (sum 1004). No overlay scene. Expansion unchanged. | GP-01, GP-04 |
| 3 | >2-model group | PASS | Category "Floors ↔ Mechanical Equipment": 23 / 25 participants. Isolation `{1:2, 2:2, 3:21}`. Overlays 0/0. | GP-07, GP-08 |
| 4 | Aggregate Focus | PASS | Camera was moved away first. Focus re-framed the union: 2-model target (2.65, 1.58, 1.29); 3-model target (0.89, 1.4, −4.18). Isolation unchanged. | GP-02, GP-08 |
| 5 | Isolate, then restore | PASS (O-1, pre-existing) | Starting from external `isolate([327,329,330], Arch)`: group Isolate, then Back to all, gave `getIsolatedNodes(Arch)` = [327,329,330] exactly. | GP-03..GP-06 |
| 6 | Back to all | PASS | Clears selection and isolation. Keeps filter "Round Duct", Category grouping, page 2/2, expansion. Camera untouched. | GP-14 |
| 7 | Unavailable participant | PASS (unload path); O-2 for hideModel | See below. | GP-15, 16, 18, 19; GP-15h/16h/17h |
| 8 | Selected visuals | PASS | `.clash-group-row-selected`: grey background, 3px left bar, bold. Body has `aria-current=true`. Group region carries no child fields. | GP-07, GP-09, GP-22 |
| 9 | Markers | PASS | Disabled. Title and aria-describedby text are exactly "Markers are unavailable for a clash group.". Overlays 0/0. Child #112 then shows Markers on and overlays 1/2. | GP-09, GP-10 |
| 10 | Disclosure vs body | PASS | Disclosure Enter, Space and click only toggle `aria-expanded`. Body Enter, Space and click only select and present. Disclosure on the selected group keeps the selection. | GP-11, GP-12 |

**Totals:** 10 PASS / 0 FAIL / 0 NOT-RUN. 1 finding, 4 observations.

**Item 7 details:**
- **Structure unloaded while the 3-model Category group was shown with Isolate:** the aggregate cleared at once. Category grouping became unavailable and fell back to the flat list, so the group disappeared and its selection ended (§27.6).
- **Model Pair "Mechanical ↔ Structure":** shows "26 of 464 participants are not shown (model not loaded).". Isolation is `{3:438}`, live participants only.
- **Mechanical then unloaded while shown:** the aggregate cleared. The note reads "464 of 464 …". Focus and Isolate are disabled with the reason "Viewer actions are unavailable: no participant model is loaded."
- **Reload:** the models came back with new keys (#4/#5). The selection stays on the old keys (label "…dA#3", "…Z0#2"). Nothing re-bound.

**Extra checks:**
- **PASS:** a filter change with a warm label index re-presented the current membership: "80 of 100", 99 participants, `{1:51, 3:48}` (GP-13).
- **PASS:** panel hide cleared the Viewer and kept the selection. Panel show did not change the Viewer. Focus re-presented.
- **PASS:** New test cleared the selection.

## Finding GP-F1 (Medium): the first text filter on a run ends the group selection even though the group still exists

**Repro:**
1. Run a test.
2. Set Group to Model Pair.
3. Click the group row body.
4. Type a text filter that still matches some of the group's clashes. It must be the first text filter since the run (cold label index), for example "Duct" on the Mech self run.

**Expected:** §27.2 / AC-GP10. The group is still listed, so the selection is kept and the filtered membership is re-presented.

**Actual:** MutationObserver trace:
- +159 ms: results show "No clashes match the current filters." and the Selected region is empty.
- +165 ms: the group returns as "(213 of 242)", but the selection stays null and isolation goes from `{5:365}` to `{}`.

This reproduced twice. A second filter with a warm label index behaves correctly (GP-13).

**Likely cause:** in `clashpanel/core/controller.js`, `setFilter` calls `refreshList`, and that runs a cold text pass before `ensureLabelIndex` warms the labels. The empty match then reaches `rebuildOrdered`, `reconcileSelectedGroup` and `endGroupSelection`, which is permanent. The cold pass also ends a single-clash `navScope` for good, which is pre-existing. Evidence: GP-21; captures `S6-filter-applied-membership-recomputed` (mis-tagged; it is the first occurrence), `S6-first-text-filter-after`, `F1-repro2-presented`.

## Observations
- **O-1:** after an aggregate restore, models that were not isolated stay root-hidden instead of visible. The same happens on the single-clash path (S5x, GP-06), so it is pre-existing `isolation.js` behaviour (a protected file).
- **O-2:** `viewer.hideModel(Structure)` while the group was shown changed nothing: still 25 participants, no unavailable note, and isolation kept on Arch and Mech. `showModel` then left Structure visible and not isolated. The single-clash path also keeps the isolation residue (its markers are removed). The hidden model stays in `getAllModels` and the catalog. This is the same hide/departure ambiguity as CTM-7 F-1 and depends on the owner's decision there.
- **O-3:** in a group with no live participants, the disabled Isolate checkbox still renders as checked (the shared toggle preference).
- **O-4:** Category and Level groupings become unavailable when any model of the run unloads. "Keep a truthful context after departure" therefore applies only in modes that survive, and was verified in Model Pair.

**Console:** 0 errors. 1 warning: the known Viewer `Model#getInstanceTree` deprecation, present from the moment the panel opened (`console.log`).

**Integrity:** `MANIFEST.sha256`. Screenshot GP-13 was taken at the warm-index filter step. The first GP-13 attempt timed out before its screenshot, so no file exists for it.
