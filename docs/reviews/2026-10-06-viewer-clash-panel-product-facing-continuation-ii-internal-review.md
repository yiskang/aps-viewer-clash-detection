# Viewer Clash Panel — product-facing continuation II: internal review (2026-10-06)

Reviewer: Claude (internal, read-only). No production code, tests or evidence were edited. No commit or push.
Second opinion: none requested. The diff is small and every claim below was checked directly by running code or tests.

## Boundary reviewed

- Repo `aps-viewer-clash-detection`, branch `main`, HEAD `b24a005`. Uncommitted package:
  - `M clashpanel/core/controller.js` (`navOf`, +4/-1)
  - `M clashpanel/core/viewModel.js` (`buildSetupRegion`, +10/-5)
  - `M test/clashpanel/core/controller.navigation.test.mjs` (+1 test)
  - `M test/clashpanel/core/viewModel.test.mjs` (+1 test)
  - `?? docs/prompts/for-claude-viewer-clash-panel-product-facing-continuation-package-ii.md` (governing prompt)
  - `?? docs/research/2026-10-06-viewer-clash-panel-product-facing-continuation-ii/` (`evidence-report.md` + 22 PNGs)
- `docs/handoffs/latest.md` is not modified yet. Prompt §17 requires that update before the package is complete.
- Governing scope: scope A (headed validation of Group None/Element, grouped-row actions, Soft unavailable for 2 models, reachable §13 states, with in-scope fixes only). Spec: `docs/superpowers/specs/2026-09-26-viewer-clash-panel-design.md` §6.1, §6.2 step 4, §9.3, §10.2, §13, §14.4.

## Verification run by the reviewer

| Check | Result |
|---|---|
| `git diff --check` | clean |
| `npm run test:offline` | tests 5187, pass 5186, fail 0, todo 1 (matches the claim) |
| `npm run test:clashpanel:dom` | 83/83 (matches) |
| `node --test test/clashpanel/core/*.test.mjs` | 313/313 (matches) |
| Fail-before: new tests run against HEAD production code (a `git archive HEAD` copy in the scratchpad, with only the 2 new test files copied in) | Both new tests **fail** at HEAD. D2: expected `'Clash #6'`, actual `'Clash #6 (within its group)'`. D1: expected `null`, actual `'Enter a clearance for Soft mode.'`. The other 31 tests in those files pass. Pass-after confirmed in the working tree. |
| Scratch probe (outside the repo): navScope group filtered out while still expanded | See L1 |

## Fix correctness

**D1: clearance message hidden while the field is hidden (`viewModel.js`).** Correct against §6.1 ("shown only while Soft is available") and §6.2 step 4 ("Run is disabled with that explanation"). The filter only affects what is displayed. `validation.state` still comes from `validation.state`, so Run stays blocked. Every case where the filter applies still leaves a visible blocking reason:
- Soft is unavailable and models participate: `soft-unavailable` finding (`setupValidation.js` `softFinding`).
- Soft is pending: `soft-checking` finding.
- No models participate: the Set A/Set B empty findings.

Soft with |P| = 1, or with a verified basis, still asks for clearance: `clearanceVisible` is true there, the second half of the new test checks this, and headed screenshot 03 shows it. Hard is unaffected: `buildDefinition` emits a `clearance` problem only when `mode === 'soft'`, so the filter has nothing to remove in Hard. `clearance.error` uses the same filtered list, so it is consistent.

**D2: "(within its group)" suffix only when stepping in a group (`controller.js` `navOf`).** This is correct for the reported case (Group → None) and matches §9.3. The test checks the suffix disappears in the flat view, comes back when grouping returns with the group still expanded, and that Next then steps the flat list (r5 → r6). Navigation behavior is unchanged: `canPrev`/`canNext` still call `navNeighbor` with the same scope. The new condition mirrors only part of `navNeighbor`'s guard, which also requires `ordinalOf.has(navScope)` (see L1).

Neither fix touches Group By semantics, selection, framing, persistence, the Viewer bridge, `measurementBasis`, or G2. **No unauthorized scope expansion.**

## Evidence check (all 22 PNGs opened)

The PNG count is 22: 01–21 plus 04a. The matrix (21 PASS, 04a FAIL pre-fix and superseded, 0 INCONCLUSIVE) agrees with what the images show:

- 04a shows "Enter a clearance for Soft mode." with the field hidden. 04 shows only the explanation.
- 07/08: collapsed ▸ headers with counts; Mechanical 839567 expanded with #4 and #5.
- 09: "(1 of 2)" headers; #5 highlighted.
- 10: #5 highlighted under Structure 299264 (42).
- 11: #9 selected inside the group with the marker drawn.
- 12: only the beam and elbow, isolated.
- 13: same view with outlines and marker removed.
- 14: whole model and "No clash selected".
- 15: empty-filtered list plus the hidden-selection note in both places.
- 16: flat list, "Clash #9" with no suffix, page 1/1.
- 17: closed, button inactive.
- 18: reopened, 491 retained.
- 19: "Cancelled · Stopped — partial results (472)" with the gap list.
- 20: idle, "Run a test to see clashes."
- 21: "No clashes found in the evaluated scope." plus the Set A/B lines.

Several statements are DOM-only and not visible in the PNG. They are labelled as such or are plausible, but cannot be verified from images:
- 09's status line "42 of 491".
- 18's "selection kept (Clash #10)".
- 19's "new run cleared the selection".

Product-facing status and Verification debt (G2 FAIL row 3, C6 NOT_EVIDENCED, C8 unresolved) are kept in separate sections. No retry, record, reset, procedure change or G3.

## Findings

**Critical: 0. High: 0. Medium: 0. Low: 4.**

- **L1. D2 guard is narrower than `navNeighbor`'s.** `navOf` checks `view === 'grouped' && expanded.has(navScope)`. `orderedList.navNeighbor` also requires `ordinalOf.has(navScope)`, meaning the group survives the current filter. Scratch probe:
  1. Grouped view; select r1 inside group mB11 (expanded).
  2. Apply text filter `a-1002`, which removes every mB11 member. Expand mB10.
  3. The label still reads "Clash #2 (within its group)" with Prev/Next both enabled. Next steps the whole list to r2, after which the label drops the suffix.

  This is the same kind of misleading label D2 fixed, in a narrower state that existed before this package. It is cosmetic and navigation is correct. Optional fix: expose a `scopeActive(navScope)` predicate from the ordered index, or add the group-exists check, and add one test. Disposition: in-scope Low, may be deferred.
- **L2. Flow narrative does not match screenshot 16's state.** The flow says "Clear filters … → Group: None (16)". The PNG shows filter `299264` still set and page 1/1, with Isolate apparently off. With cleared filters, a flat list of 491 would page 1/10. So 16 is evidently a post-fix recapture made in a re-established state. The matrix row itself is accurate. Also, the step that moved the selection from #9 to #10 before 17/18 is not listed. Add one sentence giving 16's recapture provenance and the #9 → #10 step.
- **L3. Screenshot 10 shows Prev and Next both disabled with #5 highlighted above #7 in the expanded Structure group.** This is correct per §9.3: navScope is still the group the user selected from, Mechanical 839567, which has 1 match under the filter. The report does not mention it, and a viewer may read it as a defect. Add a note to row 10, or record it as UX debt (scope is anchored to the origin group, not the most recently expanded group). No code change implied.
- **L4. Process: the scope A authorization and the handoff update are still pending.** The "scope A, owner-authorized 2026-10-06" choice is recorded only in the evidence report. `docs/handoffs/latest.md` is unchanged, and its current next gate still reads "awaiting owner authorization". Prompt §17 requires a handoff update that names the authorized work item before the package is ready for the independent gate.

Note, not a finding: rating D1 as Medium (UX) in the evidence report is reasonable. The pre-existing Lows (a)–(c) in the report are correctly classed as deferred product debt.

## Verdict

No in-scope Critical, High or Medium findings. Both fixes are correct and minimal. They follow spec §6.1/§6.2 step 4 and §9.3, and the tests fail before and pass after the fix. The evidence matrix matches the PNGs and the claimed counts. After the handoff update (L4), the package is ready for independent Work visual/product review. L1–L3 are optional polish.
