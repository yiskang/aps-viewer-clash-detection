# Federated Clash Test core — P2 remediation focused independent re-review

- **Date:** 2026-09-21
- **Branch:** `feature/federated-clash-test-core-engine`
- **HEAD / committed boundary:** `6a74cdd33ec624df2ae556b84df787af7c7ed4f3` (`feat(clashtest): P2 definitions, validation and ClashTestStore`)
- **Reviewed checkpoint:** the owner-authorized, uncommitted P2 remediation above `6a74cdd`, including the minimum P2/P3/P7 interface-plan reconciliation and its tests.
- **Review authority:** the original [P2 independent review](2026-09-21-federated-clash-test-core-p2-independent-review.md) and its [targeted adjudication/remediation record](2026-09-21-federated-clash-test-core-p2-independent-review-adjudication.md).
- **Scope:** only the three adjudicated High findings: sliced root-rule helpers, sliced model-key ordering, and the `spanRecorder` / `semanticDigest` measurement seam. No unrestricted P2 review and no reopening of the frozen design.

## Verdict

**All three High findings are resolved in the reviewed working tree. This focused re-review found 0 Critical, 0 High, 0 Medium, and 0 Low findings in scope.** The remediation is a bounded P2 implementation/interface correction and does not reopen the frozen core design.

This document is an independent review claim under `CLAUDE.md`. P2 is not accepted until a targeted adjudication verifies this review's resolution claims, working-tree boundary, test evidence, and gate verdict. P3 remains blocked meanwhile and also requires the milestone owner's explicit go-ahead after P2 acceptance.

## Resolution verification

### High 1 — sliced root-contract helpers: resolved

The three rules now have one generator implementation each and two drivers:

- synchronous forms retain the existing small-input/oracle API;
- `assertRootAntichainSliced`, `checkCrossRoleNestingSliced`, and `hierarchyInternalCandidatesSliced` call the supplied `tick('plan')` for each unit of size-dependent work and await any returned Promise (`clashtest/definition/normalize.js`, lines 12–32 and 62–238);
- candidate, dropped-id, and candidate-output ordering use the same yielding merge-sort body, so no size-dependent native sort remains inside these rules (lines 35–60, 121, 173, and 227);
- P3's plan consumes only the sliced forms for planning-sized data and adapts its existing enumeration checkpoint with `{tick: () => checkpoint()}`. This preserves P3/P6 cancellation semantics without importing the P0 slicer into the planner.

The remediation tests exercise maximum-shaped inputs, owner scans, candidate scans, each size-dependent sort, early stopping at 20 violations, returned-Promise awaiting, labels, and 300 randomized sync/sliced/reference equivalence rounds (`test/clashtest/definition/roots.test.mjs`, lines 193–348). The implementation now gives P3 a conforming way to divide every cited root-rule span without duplicating P2-owned semantics.

### High 2 — sliced model-key ordering: resolved

`normalizeSelectionSteps` copies model keys cooperatively and orders them through `yield* sortAscending(keys, byCodeUnit)` (`clashtest/definition/normalize.js`, lines 274–297). Both synchronous and sliced normalization still execute the same generator body, preserving byte-identical canonical forms and semantic digests.

The added tests use 10,000 long, shuffled keys to attribute the expected merge-sort work to `normalize` spans, compare randomized Unicode/prefix/duplicate inputs with native UTF-16 code-unit ordering, and prove synchronous/sliced definition and digest equivalence (`test/clashtest/definition/capture-stability.test.mjs`, lines 208–267). Replacing the merge sort with a native sort would fail the yield-floor test.

### High 3 — recorder propagation and digest label: resolved

`prepareDefinition` accepts `spanRecorder`, passes it to `createSlicer`, and labels the sliced digest `semanticDigest` while normalization remains `normalize` (`clashtest/definition/normalize.js`, lines 324–337). `createDefinitionOperations` accepts the same recorder and puts it in the shared slice bundle used by both saved definitions and untrusted definitions returned from the store (`clashtest/definition/operations.js`, lines 18–35 and the `saveTest` path).

Direct preparation tests require both labels and forbid `digest`; operation-level tests cover `saveTest`, store-returned `getTest`, and the no-recorder path (`test/clashtest/definition/capture-stability.test.mjs`, lines 269–294; `test/clashtest/definition/operations.test.mjs`, lines 333–374). The P2 interface rows, P7 construction call, and interface-reconciliation register carry the optional recorder consistently. P7's existing AC-12 expectation can now observe the required spans.

## Cross-phase and scope checks

- P3's plan names all three sliced helpers, awaits them, and uses the §6.2 enumeration checkpoint adapter; it does not call the synchronous forms on planning data.
- P7's plan passes its configured `spanRecorder` into `createDefinitionOperations`; its AC-12 labels remain `normalize` and `semanticDigest`.
- P4, P5, P6, and P8 do not acquire a new dependency on these interfaces.
- No P0/P1 implementation, frozen specification, collision-library source, Viewer source, remote-persistence scope, annotation scope, calibration value, or M4 Phase 4 work is changed by this remediation.
- The P2 production import boundary remains clean: no `collision/`, Viewer, `wwwroot/`, Three.js, or Autodesk dependency enters `clashtest/definition` or `clashtest/stores`.

## Verification

- Targeted P2 definition/store suites: **125 passed, 0 failed**.
- All implemented Clash Test suites: `node --test test/clashtest/**/*.test.mjs` → **317 passed, 0 failed, 0 todo**.
- Repository runner in this restricted review environment: `node scripts/run-tests.mjs` → **1,443 total; 1,439 passed; 3 failed; 1 todo**. All three failures are the pre-existing M4 spike-server tests failing to bind `0.0.0.0` with sandbox `listen EPERM`; no P2 or Clash Test test failed. The handoff also records the prior unrestricted remediation run as 1,442 passed / 0 failed / 1 todo.
- `git diff --check`: clean.
- P2 definition/store layering scan: clean.
- Repository state stayed on branch `feature/federated-clash-test-core-engine`, HEAD `6a74cdd33ec624df2ae556b84df787af7c7ed4f3`; this review modified no production code, tests, plan, or specification.

## Gate result

`P2 remediation passes focused independent re-review; targeted adjudication is required before P2 acceptance.`

Do not start P3. After targeted adjudication agrees with this review, update the handoff to accept P2; P3 may begin only after a separate explicit owner go-ahead.
