# G1 SVF2 F1–F8 — fresh exactly-one live run on `Audubon_Mechanical_clash_test.rvt` (baseline `b811888`)

**Date:** 2026-09-29 · **Base:** `main` @ `b811888ebc7be76163b99d730ce9ed66fe63a2cf` (= `origin/main`, unchanged after run) · **Overall verdict: `PARTIAL`** (preserved exactly as returned by the harness; not reinterpreted). Process exit **3** (PARTIAL).

Authorization: `docs/prompts/for-claude-fresh-exactly-one-live-g1-f1-f8-mechanical-b811888.md`. This was the only live attempt; no retry; authorization consumed.

## Run envelope

| Item | Value |
| --- | --- |
| Command | `G1_F1_F8_LIVE_AUTHORIZED=YES node test/acceptance/g1-svf2-f1-f8-verification.mjs --execute-live-f1-f8` (local `npm start` on :8080 started beforehand for `/api/auth/token`, stopped afterwards) |
| Wall clock | 2026-09-29T14:28:33Z → 14:28:45Z (harness `startedAt` 14:28:37.765Z, `finishedAt` 14:28:45.791Z) |
| Branch / HEAD | `main` @ `b811888` before and after |
| Tree at run | only untracked authorization prompt (allowed by the clean-tree interlock; recorded in `harnessIntegrity.gitStatusPorcelain`) |
| Versions | Node v22.23.1 · Playwright 1.62.1 · Chromium 151.0.7922.34 · Viewer 7.124.2 |
| Model URN | `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL0F1ZHVib25fTWVjaGFuaWNhbF9jbGFzaF90ZXN0LnJ2dA` (Audubon_Mechanical_clash_test.rvt) |
| Initializer | `env: AutodeskProduction2`, `api: streamingV2` |
| `isOTG()` / `isSVF2()` | `true` / `true` · classifier `CONFIRMED_SVF2` |
| Viewer script integrity | `viewerScriptIntegrityReason: null`; `sessionTainted: false` |
| Harness sha256 | `08afa7e236c5787362252db52f30dc03d0df55bbc9ed0fff311227ef6c1de87f` |

## F1–F8

| Check | Verdict | Key fields |
| --- | --- | --- |
| F1 | PASS | population 1,496 / roots 1,257; digest EQUAL; 0 owner/size/subtree mismatches; 0 digest errors |
| F2 | PASS | treeReachable 1,496; classL 1,496 / N 0 / U 0; accounting balanced; maxChildrenPerNode 262 |
| F3 | PASS | modelAdded observed; tree/instanceTree/loadDone settled |
| F4 | PASS | 438 distinct geometries; 0 render-proxy/adapter/weld failures; weld successes 438; max active triangles 4,228; oversized 0 |
| F5 | PASS | all five limits within: 1,496/20,000; 2/5,000; 2/5,000; 262/10,000; 4,228/12,000 |
| F6 | PASS | unload/re-register/reload probes ok; reload classifier CONFIRMED_SVF2 |
| F7 | **NOT_EVIDENCED** | `f7-calibration-gated-state-present`; boundsAgreement: 873 agrees / 358 no-reference-geometry / 26 exceeds-envelope; placement identity; unit ft (0.3048) |
| F8 | PASS | 1,257 roots / 1,496 fragments censused; 0 ownership/tree divergences; coverage equations closed |

## Mandatory controls

All 9 `DETECTED_RESTORED`: tree-unavailable, wrong-owner, late-completion-after-timeout, hidden-fragment, invalid-geometry-consumer, capacity-breach, invalid-bounds, bounds-beyond-tolerance, stale-old-model-event. Control targets recorded in JSON (`controlTargets`; e.g. wrong-owner fragId 0, owner 153 → 2147483647).

## Ledger / cleanup

Error ledger empty (no page errors, rejections, resource failures, context loss, console errors/warnings); `fatalErrorObserved: false`. `cleanupFailures: []`, `cleanupUnresolvedOwnership: false`; several cleanup steps recorded `skipped` (as in `cleanupStepStatus`), while unload/unregister/evict/verifyViewerModelSetEmpty/close page/context/browser ran.

## Verdict interpretation (harness-defined, unmodified)

`PARTIAL` is produced solely by F7 being `NOT_EVIDENCED` (the calibration-gated bounds check; 26 exceeds-envelope entries). No check FAILED or BLOCKED. The prior RAC-run F4/F5 failures did not occur on Mechanical. F7 remains a calibration/owner decision; nothing was changed or rerun.

## Limitations / residuals

- Live log is empty (0 bytes), as in prior runs; harness emits its evidence via the JSON.
- F7 needs a separate calibration disposition before overall PASS is reachable.
- Not covered: G2/G3, H1/H2, OQ-1, host integration.

Evidence: [JSON](evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run-result.json) · [log](evidence/2026-09-29-g1-svf2-f1-f8-mechanical-b811888-live-run.log.txt).
