# G1 SVF2 F1–F8 — Phase 0 preflight failure report (live attempt NOT consumed)

**Date:** 2026-09-29 · **Base:** `main` @ `606ee50` · **Status:** factual record; no live F1–F8 result exists.

## Summary

The single authorized live G1 invocation (`G1_F1_F8_LIVE_AUTHORIZED=YES node test/acceptance/g1-svf2-f1-f8-verification.mjs --execute-live-f1-f8`, 2026-09-29T04:29:34Z, exit 1) failed in Phase 0 (`harness-integrity`) before Playwright import, browser launch, model load, `isOTG()`/`isSVF2()` observation, F1–F8, or any mandatory control. Overall harness verdict: `FAIL` (Phase 0 fail-closed).

## Evidence

| Artifact | Path |
| --- | --- |
| Raw log | [`evidence/2026-09-29-g1-svf2-f1-f8-live-run.log.txt`](evidence/2026-09-29-g1-svf2-f1-f8-live-run.log.txt) |
| Raw JSON | [`evidence/2026-09-29-g1-svf2-f1-f8-live-run-result.json`](evidence/2026-09-29-g1-svf2-f1-f8-live-run-result.json) |
| Independent review | [`../reviews/2026-09-29-g1-svf2-f1-f8-phase0-failure-and-attempt-consumption-independent-review.md`](../reviews/2026-09-29-g1-svf2-f1-f8-phase0-failure-and-attempt-consumption-independent-review.md) |

## Root cause

`buildServedModuleManifest()` scanned raw source text with a regex and treated a documentation comment in `collision/tlas/CollisionInstanceBVH.js` (`` `export { CENTER, AVERAGE, SAH, ... } from './core/Constants.js';` ``) as a real re-export, inventing the nonexistent `/collision/tlas/core/Constants.js`. The real dependency is the bare package import `three-mesh-bvh`, intentionally not followed. Harness scanner defect only; no Core, Adapter, Viewer, SVF2, or model defect.

## Conclusion on the attempt

The authorization states a pure preflight failure does not count as the one live attempt if no real model load/F1–F8 execution has started. None had. The independent review adjudicates the same: **the authorized live attempt was not consumed.** This does not authorize a rerun; a fresh single live execution needs new explicit owner authorization.

## Secondary findings from the same run

- **Viewer identity label:** the JSON reports `viewerScript.integrityResult: FETCH_FAILED`, computed from an empty capture. No Viewer request was ever issued, so this was a misleading label.
- **Preflight wording:** the run's preflight was described as clean while the untracked owner-authorization prompt existed. The run-time `gitStatusPorcelain` in the raw JSON actually listed two untracked paths: the authorization prompt and the raw log file being redirected into `docs/research/evidence/`.

## Remediation required before any fresh authorization (harness/test only)

Implemented in the bounded remediation of 2026-09-29 (see `docs/handoffs/latest.md`), pending independent re-review:

1. **Scanner (H1):** `stripJsComments` removes `//` and `/* */` comments (string/template/regex-aware) before specifier discovery; hashes remain over raw bytes; no pathname special-casing; no collision-library edits.
2. **Offline coverage (M1):** `test/acceptance/g1-svf2-f1-f8-verification.phase0preflight.test.mjs` — comment cases, adjacent real imports, and a deterministic real-graph test over `SERVED_MODULE_ENTRY_POINTS` that asserts no `/core/Constants.js` path and the bare `three-mesh-bvh` import is still skipped.
3. **Clean-tree preflight (M2):** `classifyGitTreeState` records exact dirty paths; only untracked files under `docs/prompts/` are allowed (still listed, never called "clean"); anything else blocks in Phase 0 (`git-tree-check`) before any browser action.
4. **Viewer identity (Low):** a failure before the navigation step reports `CAPTURE_UNAVAILABLE` with reason `not-attempted:phase-0-failed-before-viewer-fetch` and `capture: null`, never `FETCH_FAILED`; overall remains `FAIL`.

The porcelain is read untrimmed (a leading-space status like ` M` stays intact) and a failing `git status` fails closed. **Operational consequence:** the raw live log must NOT be redirected into a non-allowed in-repo path before the harness's git check (e.g. write it to the scratchpad or an ignored path, then copy it into `docs/research/evidence/` after the run); only untracked `docs/prompts/` files are tolerated.

Before a fresh live run the owner must also commit or otherwise clear all non-allowed dirty paths (the harness now enforces a clean tree), then explicitly authorize exactly one live execution.
