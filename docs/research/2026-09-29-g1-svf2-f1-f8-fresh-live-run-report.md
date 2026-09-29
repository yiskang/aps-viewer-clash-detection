# G1 SVF2 F1–F8 — fresh single live run report

**Date:** 2026-09-29 · **Base:** `main` @ `9eab858` (= `origin/main`) · **Overall verdict: `FAIL`** (preserved exactly as returned by the harness; not reinterpreted).

## Run envelope

| Item | Value |
| --- | --- |
| Command | `G1_F1_F8_LIVE_AUTHORIZED=YES node test/acceptance/g1-svf2-f1-f8-verification.mjs --execute-live-f1-f8` (server: `npm start` on :8080, started beforehand) |
| Wall clock | 2026-09-29T06:31:58Z → 06:32:07Z (harness `startedAt` 06:32:02.261Z, `finishedAt` 06:32:07.208Z); process exit 0 |
| Branch / HEAD | `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088` (unchanged after run) |
| Tree at run | only untracked `docs/prompts/for-claude-fresh-exactly-one-live-g1-f1-f8.md` (allowed) |
| Versions | Node v22.23.1 · Playwright 1.62.1 · Chromium 151.0.7922.34 · Viewer 7.124.2 |
| Model URN | `dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6dGVzdC1zYW5kYm94LWxrd2VqN3hwYmdwNjN4NGhsMzM1eTZtMjZvYWtnZ29mL3JhY2Jhc2ljc2FtcGxlcHJvamVjdC5ydnQ` (matches raw JSON `runtimeEnvelope.modelUrn`) |
| Initializer | `env: AutodeskProduction2`, `api: streamingV2` |
| `isOTG()` / `isSVF2()` | `true` / `true` · classifier `CONFIRMED_SVF2` |
| Viewer script integrity | `viewerScriptIntegrityReason: null`; `sessionTainted: false` |

## F1–F8

| Check | Verdict | Reason |
| --- | --- | --- |
| F1 | **FAIL** | `f1-mismatch-or-digest-disagreement`: population 789, roots 467/467 compared, ownersMismatch 0, sizeMismatch 0, unreachable 0, **subtreeDigestMismatch 467**, `populationDigestEqual: false` |
| F2 | PASS | |
| F3 | PASS | |
| F4 | BLOCKED | `f1-population-records-not-available-run-observeF1-first` (F1 failed → dependent) |
| F5 | PASS | |
| F6 | PASS | |
| F7 | BLOCKED | `f4-artifacts-not-available-run-observeF4-first` (dependent on F4) |
| F8 | PASS | |

## Mandatory controls (9)

DETECTED_RESTORED: tree-unavailable, late-completion-after-timeout, hidden-fragment, invalid-geometry-consumer, capacity-breach, stale-old-model-event.
NOT_EXECUTABLE: wrong-owner (`no-eligible-fragment`), invalid-bounds (`precondition-unmet`), bounds-beyond-tolerance (`perturbation-not-representable`).

Control target evidence (hidden-fragment): fragId 0, tree owner dbId 4788, acted-on fragId 0, rule numeric-minimum, population 789.

## Ledger / cleanup

Error ledger empty (no page errors, rejections, required-resource failures, context loss, console errors/warnings; `fatalErrorObserved: false`). `cleanupFailures: []`, `cleanupUnresolvedOwnership: false`.

## Warnings / residuals / limitations

- F1 subtree-digest mismatch on all 467 roots with equal owners/sizes suggests a digest-computation disagreement (harness-side or Viewer-side) — **not diagnosed**; no fix attempted per authorization.
- F4/F7 BLOCKED are consequences of F1's FAIL, not independent findings.
- Three controls NOT_EXECUTABLE (above) — recorded as-is.
- The raw log is empty by design: the harness writes no console output; the machine-readable JSON is the authoritative record.
- This was the only live attempt; no retry.

## Evidence

- Raw JSON: [`evidence/2026-09-29-g1-svf2-f1-f8-fresh-live-run-result.json`](evidence/2026-09-29-g1-svf2-f1-f8-fresh-live-run-result.json)
- Raw log: [`evidence/2026-09-29-g1-svf2-f1-f8-fresh-live-run.log.txt`](evidence/2026-09-29-g1-svf2-f1-f8-fresh-live-run.log.txt)
