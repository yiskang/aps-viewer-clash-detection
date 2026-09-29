# G1 SVF2 F1–F8 Phase-0 remediation — bounded independent re-review

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / reviewed HEAD:** `main` / `606ee50d3bbac3f581743aac31b62c85e0ea7554`  
**Reviewed state:** uncommitted bounded remediation on top of the stated HEAD  
**Verdict:** 0 Critical / 0 High / 0 Medium / 0 Low. **The Phase-0 blocker is closed. The harness is technically ready for a fresh exactly-one live F1–F8 authorization after the accepted set is committed and the working tree satisfies the new preflight.**

## Scope and evidence

Reviewed directly from disk:

- `test/acceptance/g1-svf2-f1-f8-verification.mjs`
- `test/acceptance/g1-svf2-f1-f8-verification.phase0preflight.test.mjs`
- `docs/research/2026-09-29-g1-svf2-f1-f8-phase0-preflight-failure-report.md`
- `docs/research/evidence/2026-09-29-g1-svf2-f1-f8-live-run.log.txt`
- `docs/research/evidence/2026-09-29-g1-svf2-f1-f8-live-run-result.json`
- `docs/reviews/2026-09-29-g1-svf2-f1-f8-phase0-failure-and-attempt-consumption-independent-review.md`
- `docs/handoffs/latest.md`

No live F1–F8 execution was run. No G2/G3, host H1/H2, OQ-1, host integration, production initializer, Core, Viewer Adapter, M4, or Panel production work was started.

## 1. Manifest scanner — verified

`stripJsComments()` removes both `//` and `/* ... */` comments before dependency-specifier discovery while leaving the raw file contents unchanged for SHA-256 calculation. The focused fixtures verify line, trailing-line, single-line block, and multiline block comments. Real imports, export-from declarations, bare side-effect imports, and imports adjacent to comments remain discoverable.

String, template, and regex literal contents are preserved by the comment stripper, including URL-like `//`, `/*` text, character classes, escaped slashes, and a `return /.../` case. The helper is intentionally a bounded lexer rather than a general JavaScript parser; that limitation is acceptable for the frozen module set because of the independent parser comparison below.

The real served graph now resolves completely and does not contain `/collision/tlas/core/Constants.js` or any other invented `core/Constants.js` path. `CollisionInstanceBVH.js` remains in the graph; its executable `three-mesh-bvh` bare import survives stripping and remains correctly excluded from the repository-relative manifest. No `node_modules` path enters the result.

## 2. Offline real-graph coverage — verified

Independent reproduction of `buildServedModuleManifest(SERVED_MODULE_ENTRY_POINTS)` produced exactly **88 modules** with valid SHA-256 digests.

Independent comparison used Node v22.23.1's JavaScript module parser (`vm.SourceTextModule.dependencySpecifiers`) as the oracle:

- served 88-module set: **0 missing / 0 extra** relative imports;
- all 123 `.js` modules under `collision/`, `clashtest/`, and `clashpanel/`: **0 missing / 0 extra** relative imports.

The negative-control claim is also mechanically supported. Without comment stripping, the same raw-regex traversal reaches a comment-derived nonexistent dependency and aborts with `ENOENT`; the three comment fixtures and two real-graph tests cannot remain green under that mutation. Thus the new tests detect the original defect rather than merely observing the corrected output.

## 3. Clean-tree preflight — verified

`git status --porcelain` is read without trimming, preserving leading status-column spaces. A failed Git command returns `null` and fails closed rather than masquerading as an empty clean tree.

`classifyGitTreeState()` retains each exact status/path plus the derived `dirtyPaths`, `allowedPaths`, and `blockingPaths`. `clean` is true only when there are no entries. The sole exception is an untracked (`??`) path under `docs/prompts/`; it is explicitly recorded as dirty-but-allowed and is never described as clean. Modified or staged prompt files do not receive the exception.

Any modified, staged, or other untracked path produces a blocking path and throws during `git-tree-check`. This occurs before served-module manifest completion, Playwright import, browser launch, page creation, navigation, or model activity.

Operational consequence: a live command must not create its raw log at a non-allowed in-repository path before the preflight check. Write the live log outside the repository or to an ignored result path, then copy it into `docs/research/evidence/` after the run.

## 4. Viewer identity state — verified

For every Phase-0 step before `goto`, `main()` passes `viewerFetchAttempted: false`. `handlePhase0Failure()` then records:

- `CAPTURE_UNAVAILABLE`;
- `not-attempted:phase-0-failed-before-viewer-fetch`;
- `capture: null`.

It does not call the capture classifier or fabricate `FETCH_FAILED`. A genuine post-navigation request failure retains the existing `FETCH_FAILED` behavior. The overall Phase-0 result remains `FAIL` because `fatalErrorObserved: true` has verdict precedence. The not-attempted result remains schema-valid.

## 5. Human-readable report — verified

`docs/research/2026-09-29-g1-svf2-f1-f8-phase0-preflight-failure-report.md` links the retained raw log, raw JSON, and prior independent review with correct relative paths. It accurately records:

- Phase 0 stopped before Playwright/model/F1–F8;
- the comment-scanner root cause;
- the prior live attempt was not consumed;
- no rerun is thereby authorized;
- the log must not be opened at a non-allowed in-repository path before the new clean-tree check.

The documentation gap from the prior review is closed.

## 6. Test verification

Independent `npm run test:offline` verification:

- tests: **4201**
- pass: **4200**
- fail: **0**
- todo: **1** existing known geometry gap
- process exit: **0**

The first sandboxed invocation produced three local-server `EPERM` failures because it could not bind ephemeral test ports. The identical command, rerun with local test-port permission and without changing code, tests, thresholds, or arguments, produced the clean result above.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

None in the bounded remediation. The hand-written lexer remains intentionally scoped to the reviewed repository module set; exact Node-parser parity over that set makes this a documented boundary, not an open defect.

## Readiness and required closeout

The Phase-0 blocker is closed, and no additional technical blocker remains in the reviewed scope. The harness is ready to be considered for a fresh exactly-one live F1–F8 authorization.

**A commit/clean-tree closeout is required first.** The remediation currently exists only as modified/untracked files, and those paths would correctly fail the new preflight. The accepted harness change, focused test, retained evidence, human-readable report, independent reviews, authorization record, and handoff must be committed (or otherwise preserved at an equally exact reviewed HEAD with no blocking paths) before the next authorization. Because these artifacts are required project evidence, committing the complete accepted set is the appropriate disposition; stashing or discarding them would not produce the reviewed state.

After that commit, independently verify the branch/HEAD and clean-tree result, then obtain a new explicit owner authorization for exactly one live execution. Live F1–F8 remains unauthorized until that owner action.
