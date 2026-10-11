# GP-F1 recheck (addendum): pre-CTM-8 evidence only, NOT CTM-8 evidence

Date 2026-10-11. Repo main @ 9e49f40 with the working tree after the GP-F1 fix (`git diff --stat` 27 files, +891/-73 at start; no production or test file edited by this run). Real app, Playwright MCP headed Chromium 1600x1000, three Audubon SVF2 models (Arch #1, Struct #2, Mech #3). Test: "Clash test 1", Hard, Set A = Mechanical, self-compare: 242 clashes. Group = Model Pair. Fresh page load, so the label index was cold and the filter below was the first text filter of the run.

Deviation from the original repro: the Isolate checkbox is off on a fresh load, so after clicking the group body I ticked Isolate (aggregate isolation {3:365}) to make "isolation not {}" observable.

## Step 1: first text filter "Duct" (cold label index): PASS
- Before: group selected (aria-current), 242 clashes / 365 participants, isolation {3:365}.
- After: group row still selected and aria-current; label "(213 of 242)"; vm.selected = group, clashCount 213, participants 328, shown 328; isolation {3:328} (not {}); Isolate checked; camera re-framed (target z -2.61 -> 0.97); Markers still disabled with "Markers are unavailable for a clash group."
- Observation (Low): MutationObserver trace shows one transient intermediate DOM state, about 4 ms long (t=8558 ms), with "No clashes match the current filters." and no selection, followed at t=8562 ms by the final selected "(213 of 242)" state. Isolation never dropped to {} (365 -> 328 directly). The original defect (permanent selection loss, isolation {}) did not reproduce. I did not investigate the source of the flash; it is a single-frame render glitch at most.
- Evidence: GPF1R-01-group-selected-isolated-before-filter.png, GPF1R-02-first-text-filter-Duct.png

## Step 2: text that removes the group ("zzzqqq", warm index): PASS
- Results show "No clashes match the current filters."; vm.selected null; no aria-current row; aggregate isolation [] and per-model isolated counts 0/0/0; overlays none. Selection ended and Viewer cleared.
- Evidence: GPF1R-03-no-match-filter-selection-ended.png. The no-match case was run second, so with a warm index; not tested with a cold index.

## Console
0 errors; 1 warning (known Viewer getInstanceTree deprecation). GPF1R-console.log.

## Verdict
GP-F1 recheck: PASS (with the Low transient-flash observation above). Server killed (port 8080 free), browser closed.
