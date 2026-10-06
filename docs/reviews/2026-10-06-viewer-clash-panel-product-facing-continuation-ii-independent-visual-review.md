# Viewer Clash Panel — product-facing continuation II independent visual/product review (2026-10-06)

## Verdict

**Accepted.** Scope A is product-ready for a single checkpoint commit and push. No additional owner screenshot review is needed. This review authorizes neither that commit/push nor any further implementation.

**Findings:** Critical 0 · High 0 · Medium 0 · Low 4.

## Repository state reviewed

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch: `main`
- Baseline: `HEAD == origin/main == b24a005d1a7fbe8b76172806a544898fa5aaa4b4`
- Reviewed uncommitted implementation: `clashpanel/core/controller.js`, `clashpanel/core/viewModel.js`, and their two focused test files.
- Reviewed untracked package: owner prompt, evidence report and 22 PNGs, and the internal review. `git diff --check` is clean.
- The diff stays inside the owner-authorized Scope A. No Core, Viewer Adapter, M4, G2, authorization-record, procedure, retry, reset, or G3 change is present.

## Independent implementation verification

### D1 — stale Soft clearance message

Accepted. `buildSetupRegion` derives one `clearanceVisible` predicate and omits clearance-control findings whenever the clearance input is not visible. The validation state is unchanged, and the Soft availability finding remains visible and blocking. Hard mode and Soft with one participating model or a verified basis retain their prior behavior.

The new regression test is meaningful: against baseline production code it fails because `clearance.error` is `"Enter a clearance for Soft mode."`; against the working tree it passes and also proves the verified-basis path still shows the clearance requirement.

### D2 — group-scope navigation label

Accepted for the reported Group → None defect. `navOf` now shows `"(within its group)"` only in grouped view with the stored scope expanded. Navigation behavior itself is unchanged. The new test fails against baseline production code (`"Clash #6 (within its group)"`) and passes in the working tree (`"Clash #6"`), while proving flat Next movement and restoration of the suffix when grouping resumes.

The change preserves the accepted controller/ordered-list boundary: `navOf` describes the state; `orderedList.navNeighbor` remains authoritative for stepping.

### Independent gates

| Gate | Result |
|---|---|
| Baseline-red proof | Both new tests fail for the intended reasons; the other 31 tests in those files pass |
| `npm run test:offline` | 5,187 total · 5,186 pass · 0 fail · 1 existing todo |
| `npm run test:clashpanel:dom` | 83/83 pass |
| `node --test test/clashpanel/core/*.test.mjs` | 313/313 pass |
| `git diff --check` | clean |

Codebase-memory coverage reported no recorded issue and matching index metadata for the two changed production files and two changed test files; the conclusions above were also checked directly against source and executed tests.

## Independent visual/product verification

All 22 PNGs were opened and inspected. The evidence matrix is accurate: **21 current PASS states, one superseded historical FAIL (`04a`), zero inconclusive**. The addenda correctly explain screenshot 16's retained `299264` filter and screenshot 10's disabled Prev/Next: navigation remains anchored to the Mechanical group from which the clash was selected.

A separate headed run on the uncommitted tree reproduced the product-critical path:

- one participating Structure model enables Soft and exposes Clearance;
- adding Mechanical makes Soft fail closed, removes Clearance, and shows only the measurement-basis explanation;
- Hard completes with 491 clashes;
- Element grouping, expanded rows, grouped selection, and the `"within its group"` label work;
- switching to Group None retains the selection and removes the suffix;
- a no-match filter produces the filtered-empty state and hidden-selection explanation.

The default-host source configuration still auto-loads Room Locator and Clash Finder and does not auto-load Clash Panel. The default-URL smoke evidence is consistent with that unchanged path. The headed action screenshots independently show Focus, Isolate, Markers off, and Back to All with the expected Viewer states. No changed code touches those action paths.

## Findings

### Low

1. **Filtered-away navigation scope can retain the group suffix.** `navOf` checks grouped view plus `expanded.has(navScope)`, while `orderedList.navNeighbor` also requires the scope to exist in the current grouped index. If a filter removes every member of the expanded origin group, the label can still say `"within its group"` while Prev/Next correctly fall back to the flat filtered list. This is misleading but does not block or misroute navigation; the label self-corrects after the next selection. Defer as product polish.
2. The multi-valued grouping note remains visible over an empty filtered list. Cosmetic, pre-existing, and accurately disclosed.
3. Run status can read `"Idle · Ready to run"` while setup validation reads `"Not ready"`. Wording debt, pre-existing, and accurately disclosed.
4. Completed status repeats the word in `"Completed · Completed — N clashes"`. Wording debt, pre-existing, and accurately disclosed.

There are no open Critical, High, or Medium findings. Internal-review L2 and L3 are documentation clarifications now correctly recorded; its former L4 handoff/process issue is closed by the current handoff.

## Coverage limitations and disposition

- **Soft with a verified common basis:** not available in this demo because the host supplies no `measurementBasis`. This is a disclosed environment/product-composition limitation, not a contradiction in the Scope A fix. Single-model Soft availability and multi-model fail-closed behavior are both evidenced.
- **Fault-only §13 states:** engine-capacity, enumeration/planning, result-cap, unload/reload-during-run, internal-error, truncation, grouping-too-large, and related states remain offline-only. Their deterministic controller/view-model coverage is adequate for this product-facing continuation; manufacturing live failures would add fault-injection work outside Scope A.
- **Earlier product debt:** unchanged and non-blocking: UUID fallback entropy, narrow responsive overflow/exact-width coverage, marker visibility on large elements, union framing, no Viewer-selection synchronization, interim model keys, SVF2 fixture breadth, and deferred model-pair grouping/roll-ups.
- **G2 track:** unchanged at FAIL row 3 with C6 NOT_EVIDENCED and C8 unresolved. This review does not retry, supersede, or resolve it.

## Readiness

Scope A needs no further implementation fix before checkpointing. The uncommitted package is ready for one owner-authorized checkpoint commit and push containing the two production fixes, their regression tests, the evidence package, reviews, prompt, and updated handoff. Further product implementation remains unauthorized.
