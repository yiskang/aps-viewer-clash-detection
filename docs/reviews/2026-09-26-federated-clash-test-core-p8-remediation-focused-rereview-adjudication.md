# Federated Clash Test core — P8 remediation focused re-review adjudication

**Date:** 2026-09-26  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Repository HEAD adjudicated:** `01afad2df21e54862a8fbd6ce57651a9280f1392`  
**Production checkpoint:** `acf347573fcb353bc0197b1e6e46c123fd4e44d6`  
**Remediation boundary:** `72497d10a4a10d410e9c640931c50b479e300981..acf347573fcb353bc0197b1e6e46c123fd4e44d6`  
**Review adjudicated:** [`2026-09-26-federated-clash-test-core-p8-remediation-focused-rereview.md`](2026-09-26-federated-clash-test-core-p8-remediation-focused-rereview.md)

## Result

**AGREE.** The focused independent re-review's boundary, findings, verification claims and PASS verdict are supported by the current repository.

| Claim | Adjudication |
| --- | --- |
| Remediation boundary is `72497d1..acf3475`; later commits are documentation-only | **AGREE** |
| H1 owner-authorized clean-proof correction is resolved | **AGREE** |
| M1 guarded detached options capture is resolved | **AGREE** |
| M2 owned and bounded filter operand capture is resolved | **AGREE** |
| Findings are 0 Critical / 0 High / 0 Medium / 0 Low | **AGREE** |
| Focused verification is 188/188 | **AGREE — reproduced** |
| Full verification is 2,848 total / 2,847 pass / 0 fail / 1 pre-existing todo | **AGREE — reproduced** |
| Gate verdict is PASS and ready for targeted adjudication, not P8 acceptance | **AGREE** |

## Scope and method

This adjudication followed `CLAUDE.md` and checked only the review's cited findings, repository/commit boundary, verification claims and gate verdict. It did not restart unrestricted P8 review, inspect unrelated deferred concerns as new findings, modify production code, reopen the frozen design, or reopen accepted P5 behavior.

The adjudication compared Git history and the `72497d1..acf3475` diff; inspected the changed H1/M1/M2 implementation and focused regressions; reproduced the focused and full test counts; and checked current graph-coverage metadata for all seven changed production files and four focused test files.

## Finding adjudication

### H1 — agree resolved

The committed `cleanProof` predicate requires the covering unit to evaluate the exact pair: direct orientation for ordered modes, either orientation for unordered modes, source-root membership, matching target scope, and exclusion of same-model target roots that are also source roots. The regression matrix covers the original forged overlap cases in both comparison directions and both semantics, positive controls, and real planner/split layouts. The accepted P5 reader is not used as the final clean predicate and was not changed.

### M1 — agree resolved

The derivation boundary now uses guarded, descriptor-based snapshots for closed option bags and bounded arrays. Symbols, non-enumerable fields, accessors, hostile or revoked proxies, sparse/decorated arrays and non-plain bags are handled as typed option errors without invoking caller getters. Captured copies, rather than live caller bags, feed derivation preparation. The focused coverage spans context options and limits, method options, group-by facets, filter clauses and nested facet specifications.

### M2 — agree resolved

Filter equality operands are owned synchronously and isolated from later caller mutation. Cycles, accessors, hostile proxies and non-JSON inputs are refused with typed option errors. Depth, expanded DAG size, exact-boundary behavior, cross-clause budget sharing and engine `maxCapturedNodes` propagation are directly covered. The implementation adds no public option, schema or persistence obligation. The already recorded generous default and host string-size edge remain owner-visible calibration/resource notes and are outside this bounded checkpoint.

## Boundary adjudication

The production checkpoint is the single consolidated commit `acf3475`. Its diff from `72497d1` contains six P8 derivation files, the authorized `clashtest/engine.js` limit hook, four focused test files, and the earlier review/handoff records: **14 files, 1,050 insertions, 71 deletions**. It contains no design spec, implementation plan, Result Set schema, planning, P5 result, persistence or public-barrel change.

`ad771b4` adds the focused independent re-review and its handoff update. `01afad2` is a handoff-only refresh. Neither changes production or tests. The working tree was clean before this adjudication was persisted.

## Verification reproduced

- Focused files (`compare`, `filter`, `closedOptions`, engine derivations): **188/188 passed**.
- Full `node scripts/run-tests.mjs`: **2,848 total / 2,847 passed / 0 failed / 1 todo**.
- The todo remains the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap.
- Graph coverage metadata was current for the seven changed production files and four focused test files, with no recorded gaps; source, Git and executed tests remained authoritative.

## Gate result

The focused independent re-review is adjudicated **AGREE**. No blocking P8 remediation finding remains. The P8 checkpoint is ready for the milestone owner's explicit acceptance decision.

This adjudication does not itself accept P8 and does not authorize any phase beyond P8, P5 changes, Viewer/OQ-4 integration, remote persistence, annotation work, new resource-limit policy, pushing, or M4 Phase 4.
