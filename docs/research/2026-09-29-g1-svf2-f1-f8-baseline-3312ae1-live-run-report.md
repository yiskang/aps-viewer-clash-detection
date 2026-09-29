# G1 SVF2 F1–F8 — fresh exactly-one live run on baseline `3312ae1`

**Date:** 2026-09-29 · **Base:** `main` @ `3312ae16d69c86def3c29e58cef22e343b310d17` (= `origin/main`, unchanged after run) · **Overall verdict: `FAIL`** (preserved exactly as returned by the harness; not reinterpreted).

Authorization: `docs/prompts/for-claude-fresh-exactly-one-live-g1-f1-f8-baseline-3312ae1.md`. This was the only live attempt; no retry.

## Run envelope

| Item | Value |
| --- | --- |
| Command | `G1_F1_F8_LIVE_AUTHORIZED=YES node test/acceptance/g1-svf2-f1-f8-verification.mjs --execute-live-f1-f8` (local `npm start` on :8080 started beforehand for `/api/auth/token`, stopped afterwards) |
| Wall clock | 2026-09-29T11:10:39Z → 11:10:49Z (harness `startedAt` 11:10:43.525Z, `finishedAt` 11:10:49.899Z); process exit **1** (verdict-coded exit for FAIL) |
| Branch / HEAD | `main` @ `3312ae1` before and after |
| Tree at run | only untracked `docs/prompts/for-claude-fresh-exactly-one-live-g1-f1-f8-baseline-3312ae1.md` (allowed by the clean-tree interlock; recorded in `harnessIntegrity.gitStatusPorcelain`) |
| Versions | Node v22.23.1 · Chromium 151.0.7922.34 · Viewer 7.124.2 (Playwright 1.62.1 per prior envelope; not re-recorded in this JSON) |
| Model URN | `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ` |
| Initializer | `env: AutodeskProduction2`, `api: streamingV2` |
| `isOTG()` / `isSVF2()` | `true` / `true` · classifier `CONFIRMED_SVF2` |
| Viewer script integrity | `viewerScriptIntegrityReason: null`; `sessionTainted: false` |
| Harness sha256 | `fc928289f91a48aaae33f36ace72d9dc77d63560f63b4dee2fde574d7e0611c1` |

## F1–F8

| Check | Verdict | Reason / key fields |
| --- | --- | --- |
| F1 | PASS | Population digest `EQUAL` (`sha256:7c165493…928ba`), 789/789 rows, no mismatches, oracle error `null`. (Previous run's F1 digest FAIL is not reproduced.) |
| F2 | PASS | |
| F3 | PASS | |
| F4 | **FAIL** | `f4-render-proxy-adapter-or-weld-consumer-failure`: distinctGeometryCount 348, `weldConsumerFailures` **348**, `weldConsumerSuccessCount` 0; renderProxyFailures 0, geometryAdapterFailures 0, geometriesWithNullIndex 0, libraryThrew 0 |
| F5 | **FAIL** | `existing-limit-exceeded`: `maxSyncTriangleCount` observed 21845 > limit 12000 (only dimension exceeded); maxCollisionInstancesPerEpoch 789/20000, maxFragmentsPerDbId 17/5000 (dbId 430), maxFragmentsPerRoot 17/5000, maxChildrenPerNode 43/10000 all within limit; oversizedGeometryCount 0; fullyEnumerated true |
| F6 | PASS | |
| F7 | NOT_EVIDENCED | `f7-calibration-gated-state-present` |
| F8 | PASS | |

## Mandatory controls (9)

All nine `DETECTED_RESTORED`: tree-unavailable, wrong-owner, late-completion-after-timeout, hidden-fragment, invalid-geometry-consumer, capacity-breach, invalid-bounds, bounds-beyond-tolerance, stale-old-model-event.

Control target evidence: wrong-owner — fragId 0, owner dbId 4788, injected 2147483647, source `f1PopulationRecords`, numeric-minimum, population 789. hidden-fragment — fragId 0, tree owner 4788, acted-on fragId 0, source `f2TreeOwnerByFragId-intersect-f1PopulationClasses-L`, population 789.

## Ledger / cleanup

Error ledger empty (no page errors, rejections, required-resource failures, context loss, console errors/warnings; `fatalErrorObserved: false`). `cleanupFailures: []`, `cleanupUnresolvedOwnership: false`; several cleanup steps recorded `skipped` (nothing to clean) — see `cleanupStepStatus` in the JSON.

## Warnings / residuals / limitations

- F4 FAIL: all 348 geometries failed the weld consumer while render-proxy/adapter paths succeeded — cause **not diagnosed** (harness-side vs. library/Viewer-side unknown); no fix attempted.
- F5 FAIL: the single exceeded dimension is `maxSyncTriangleCount` (21845 vs 12000); all other limits within bounds. Not interpreted beyond the harness verdict.
- F7 NOT_EVIDENCED is reported by the harness as calibration-gated; not reinterpreted.
- Raw log is empty by design (harness prints nothing); the JSON is the authoritative record.
- The result JSON is 1.0 MB; it is retained unabridged.

## Evidence

- Raw JSON: [`evidence/2026-09-29-g1-svf2-f1-f8-baseline-3312ae1-live-run-result.json`](evidence/2026-09-29-g1-svf2-f1-f8-baseline-3312ae1-live-run-result.json)
- Raw log: [`evidence/2026-09-29-g1-svf2-f1-f8-baseline-3312ae1-live-run.log.txt`](evidence/2026-09-29-g1-svf2-f1-f8-baseline-3312ae1-live-run.log.txt)
- Harness-written original (gitignored): `test/acceptance/results/g1-svf2-f1-f8-verification-result.json`

## Next gate

Independent ChatGPT Work verification of this run → owner decision. No rerun, fix, G2/G3, H1/H2, OQ-1, or host integration is authorized.
