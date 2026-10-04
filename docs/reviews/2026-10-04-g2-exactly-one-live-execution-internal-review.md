# G2 exactly-one live execution — post-attempt internal review

- **Verdict (harness-authoritative, K file): `FAIL` (primaryRow 3)**; exit code 1. Not reinterpreted or upgraded.
- **Authorization:** `g2-live-20261004-75a3ccb9`, record SHA `f68436dfbab09ad32a2ba248cf6ab63ce652b5615e82f8232f77aae9409c33c6` (untracked, unmodified). **Attempt ID:** `59b8713d-1e63-4df8-b641-ac6b830f3ea6`.
- **Baseline:** `main == origin/main == 75a3ccb9ba160f8afcf3c9b39a301f352b273c08`; harness SHA `471fae40…7ac4`; procedure SHA `d1ccfde2…5a75`.
- **Command (single invocation, from repo root, Node v22.23.1):**
  `G2_LIVE_AUTHORIZED=YES PORT=8080 node test/acceptance/clashpanel-viewerbridge.acceptance.mjs --execute-live-g2 --authorization-record docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md > /private/tmp/claude-501/g2/g2-live.log 2>&1` (app server via `PORT=8080 npm start`, log outside repo; server stopped afterward).
- **Lifecycle:** `AUTH_BOUND` (03:28:57Z) → `ATTEMPT_CONSUMED` (03:29:00Z) → `CLOSEOUT_STARTED` (03:29:15Z) → K committed (03:29:15.9Z). Attempt consumed; both models loaded (C1 PASS, both `CONFIRMED_SVF2`). Post-commit: unlink=ok, dir fsync=ok, read-back=match.

## Evidence (git-ignored, transient; unmodified)
- `test/acceptance/results/clashpanel-viewerbridge-g2-attempts/g2-live-20261004-75a3ccb9.{reservation,journal,commit}.json`
- R1 `…/clashpanel-viewerbridge-g2-result.json` (sha `4204e2d3…2148`), R2 `…-summary.md` (`5282f01c…d4da4`), R3 `…-closeout.json`; K `manifestSha256 8de72bb0…28f0`, `journalSha256 0486d395…352b`.
- Raw log (non-authoritative): `/private/tmp/claude-501/g2/g2-live.log`.

## Results
- Runtime envelope matched: Viewer 7.124.2, AutodeskProduction2, streamingV2, Chromium 151.0.7922.34, Playwright 1.62.1, WebGL2; viewer script integrity `VERIFIED`; fixture URN SHAs matched.
- Checks: 16 PASS (C1,C2,C4,C5,C7,C9–C19); **C3 FAIL(repetitions)**; **C8 FAIL(element-outside-frustum)**; C6 NOT_EVIDENCED(n2-not-discriminating); C20 BLOCKED(dependency:C8).
- Controls: N1 DETECTED, N2 NOT_DISCRIMINATING, N3/N4/N5/N7 DETECTED_RESTORED, N6 DETECTED, N8 NOT_APPLICABLE.
- Error ledger: fatalCount 0, request failures 0, response failures 0; session not tainted; `phaseRunFailure` null.
- Cleanup: all 17 steps `ran`, `cleanupFailures []`, `cleanupUnresolvedOwnership false`. No crash/timeout/interruption.
- Reader consistency: R1/R2 byte/schema/snapshot verification all true; R2 provisional overall = K final overall.

## Findings (classification; no production/harness change made)
- **High — C8 FAIL:** target element outside frustum, worstExcess ≈ 5.858 (all sampled corners clip y ≈ −6.7, w>0). Real product/harness behavior finding or camera-framing defect; needs triage. Cascades to C20 BLOCKED.
- **High — C3 FAIL(repetitions):** `repetitionsObserved: 3`; dispose and residue clauses true. Close-button routed through `setVisible(false)`, dispatching `panel/hidden`.
- **Medium — C6 NOT_EVIDENCED:** N2 control not discriminating; C6 predicate itself passed (worstExcess −0.54).
- **Low — C20 not evidenced** (dependency on C8); N8 NOT_APPLICABLE (procedure-conformant).
- **No Critical.** Lifecycle, identity, ledgers, cleanup and evidence completeness show no defects.
- Verdict precedence: row 3 FAIL stands; PARTIAL not available.

## Process notes
- The execution-authorization prompt itself was an extra untracked `docs/prompts/` file beyond the owner's "allowed" list; harness `classifyGitTreeState` allows the prefix (zero blocking paths) and Phase 0 passed. Treated as the authorization document, not an unexpected file.
- Terminal clean-window respected: no repo writes between baseline check and terminal state.

## Next gate
Independent Work review of the live G2 evidence and verdict. No retry, no new record, no second attempt authorized.
