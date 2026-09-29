# G1 SVF2 F1–F8 Phase 0 failure and attempt-consumption — independent review

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch / reviewed HEAD:** `main` / `606ee50d3bbac3f581743aac31b62c85e0ea7554`  
**Scope:** retained Phase 0 evidence, attempt accounting, served-module-manifest root cause, offline coverage, and evidence sufficiency.  
**Verdict:** 0 Critical / 1 High / 2 Medium / 2 Low. **The invocation is a pure preflight failure and did not consume the one authorized live F1–F8 attempt.**

## Evidence reviewed

- `docs/prompts/for-claude-one-live-g1-f1-f8-execution.md`
- `docs/research/evidence/2026-09-29-g1-svf2-f1-f8-live-run.log.txt`
- `docs/research/evidence/2026-09-29-g1-svf2-f1-f8-live-run-result.json`
- `docs/handoffs/latest.md`
- `test/acceptance/g1-svf2-f1-f8-verification.mjs`
- `test/acceptance/g1-svf2-f1-f8-verification.shell.test.mjs`
- the actual `/collision/index.js` import chain through `CollisionWorld.js`, `TlasCache.js`, and `CollisionInstanceBVH.js`

No G1 execution was run during this review. No implementation or production file was modified.

## 1. Phase boundary — verified

The raw log records one command invocation starting and ending at `2026-09-29T04:29:34Z`, exit 1. Its only stack is `buildServedModuleManifest()` at harness line 1914 called from `main()` at line 9304.

The code order is decisive:

1. `main()` begins `phase0Step = 'harness-integrity'` and builds the served-module manifest.
2. Only after that succeeds does it dynamically import Playwright.
3. Browser, context, and page creation follow the Playwright import.
4. Navigation/module installation follow page creation.
5. `runHarness()`—which owns model load, runtime format observation, F1–F8, controls, and final Viewer-script identity assessment—is called only after Phase 0 succeeds.

The retained JSON agrees: `phase` is `PHASE_0`; `failureCategory` is `harness-integrity-compute-failed`; `resourcesExisted.browser/page/context` are all false; Chromium is null; `runtime.isOTG` and `runtime.isSVF2` are null; all F1–F8 entries are `BLOCKED` with `status: not-run`; all mandatory controls are `NOT_EXECUTABLE`; and no control target exists.

Therefore no real model load, `isOTG()`/`isSVF2()` observation, F1–F8 check, mandatory control, browser request, or live Viewer-script response/hash identity check occurred. The JSON's `viewerScript.integrityResult: FETCH_FAILED` is a fail-closed Phase 0 fallback computed from an empty capture, not evidence that a Viewer-script fetch was attempted or failed.

## 2. Attempt consumption — adjudicated

The authorization states: “A pure preflight failure does **not** count as the one live F1–F8 attempt if no real model load/F1–F8 execution has started.” It separately defines consumption as beginning once the real SVF2 model load / F1–F8 execution begins.

Both non-consumption conditions are mechanically established. This invocation failed before Playwright import and browser launch, so it is a pure preflight failure. **The one authorized live F1–F8 attempt was not consumed.**

This does not authorize an immediate rerun. The same authorization requires stopping after a failure, prohibits retries, and sends the result to independent Work verification and owner decision. A fresh single live execution may be authorized only after a bounded harness-only correction, focused verification, and a new explicit owner authorization.

## 3. Exact root cause

The manifest starts from `SERVED_MODULE_ENTRY_POINTS`, including `/collision/index.js`. Its transitive repository path is:

`/collision/index.js` → `./CollisionWorld.js` → `./tlas/TlasCache.js` → `./CollisionInstanceBVH.js`

`buildServedModuleManifest()` does not parse JavaScript syntax. It applies the regex `\bfrom\s*['\"]([^'\"]+)['\"]` to raw file contents, including comments. `collision/tlas/CollisionInstanceBVH.js` line 26 contains this explanatory comment:

```
src/index.js:9 (`export { CENTER, AVERAGE, SAH, ... } from './core/Constants.js';`)
```

The regex mistakes that comment for a real re-export and resolves `./core/Constants.js` relative to `collision/tlas/`, producing the nonexistent `/collision/tlas/core/Constants.js`. The actual executable import in `CollisionInstanceBVH.js` is `import { BVH, CENTER } from 'three-mesh-bvh';`; that bare package import is intentionally excluded from the repository-module manifest.

This is entirely a harness import-graph scanner defect. It is not a bad Core import, missing production module, Viewer Adapter defect, Viewer/SVF2 behavior, or model problem. A bounded correction to the harness scanner plus offline tests is sufficient. No production, collision-library/Core, Viewer Adapter, M4, Panel, initializer, or host change is required. Removing or rewriting the valid production comment would hide the harness bug and is not an acceptable correction.

## 4. Findings

### Critical

None.

### High

1. **H1 — the served-module manifest scanner is not comment-aware and blocks every real Phase 0 walk of the current served graph.** It must be corrected before another live authorization. Minimum correction: recognize actual static import/export declarations without treating comments as code, while preserving fail-closed behavior for a genuinely missing imported repository module.

### Medium

1. **M1 — the offline suite does not exercise the real served entry-point graph or a comment-contained fake import.** Its manifest tests use synthetic scratch modules containing only real import/export statements, so 4,183 green offline tests could not detect this defect. Add a regression for import-like text in comments and a bounded real-entry-point manifest smoke check (or an equivalent mechanically complete graph fixture) before re-review.
2. **M2 — the repository-clean preflight was not actually satisfied.** Phase 0's retained `gitStatusPorcelain` includes the untracked authorization prompt (the log itself was also already open as the command's output artifact). This does not change the phase boundary or attempt accounting, but the handoff's “Preflight (all OK)” wording was inaccurate. Any newly authorized execution must begin from the exact clean/reviewed harness state required by its authorization.

### Low

1. **L1 — the Phase 0 evidence labels Viewer-script integrity `FETCH_FAILED` even though no browser or request existed.** This is fail-closed and cannot create a false PASS, but it should be documented as “not attempted / unavailable because Phase 0 failed” rather than interpreted as an observed network failure.
2. **L2 — the raw evidence is sufficient for independent verification, but the authorized evidence package lacks a dedicated human-readable research report.** The JSON and log establish command, time, HEAD, phase, error, resource non-creation, blocked checks, controls, cleanup, and verdict; the handoff and this review supply human-readable interpretation. For strict closeout against the authorization, add one short `docs/research/` report linking the two raw files and recording the Phase 0 boundary, root cause, non-consumption ruling, and limitations. No new execution evidence is needed.

## 5. Evidence sufficiency and next gate

The retained log and JSON are sufficient to prove the Phase 0 failure, its exact cause, and non-consumption of the live attempt. They are also sufficient to exclude a live Viewer/SVF2 finding: no browser, model, Viewer response, classifier observation, F-check, or mandatory control ran.

The next safe gate is:

1. explicit authorization for a bounded harness/test-only correction to H1/M1;
2. focused offline verification plus independent bounded re-review;
3. repository/evidence documentation made clean and complete;
4. a fresh explicit owner authorization for exactly one live F1–F8 execution.

Until those gates are passed, rerunning G1 and starting G2/G3, host H1/H2, OQ-1, host integration, or any production/Core/Adapter/M4/Panel work remain unauthorized.
