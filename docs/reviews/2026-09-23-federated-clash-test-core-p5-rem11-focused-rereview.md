# Federated Clash Test core P5-REM11 focused re-review

**Date:** 2026-09-23
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
**Branch:** `feature/federated-clash-test-core-engine`
**Reviewed checkpoint:** `1810ecefa6c6c6e8de741a295ebd79068c5ab371`
**Comparison base:** `116a811d79598e1ebf84c82ae95eb77e23d9f5e3`
**Scope:** P5-REM11 only: the three restored cross-field validation checkpoints, their focused tests, the G-CAL memory-claim correction, and the checkpoint's operational handoff state. This review does not reopen the frozen design, the REM4–REM10 exact-cover implementation, or unrelated P5/P6 work.

## Verdict

**Functional remediation PASS; checkpoint closeout needs documentation remediation.**

**Findings: 0 Critical / 0 High / 1 Medium / 1 Low.**

The three code changes are correct, output-preserving, owner-ratified, and adequately tested. The committed checkpoint is not yet a reliable operational closeout because its canonical handoff is stale and internally contradictory, and its memory correction leaves two instances of the exact false claim it was intended to correct.

This independent review is a claim under `CLAUDE.md`; its boundary, verification results, and two findings require targeted adjudication. P6 remains unauthorized and unstarted.

## Findings

### Medium — the committed canonical handoff reports stale and contradictory checkpoint state

**Locations:** `docs/handoffs/latest.md` lines 5–6, 20–24, 167, and 183–190 at reviewed commit `1810ece`.

The committed handoff identifies current HEAD as `116a811`, says the REM4–REM10 review and handoff are uncommitted, says the two extra break-loop fixes are “not yet owner-ratified,” says “Nothing committed this round,” later records those same fixes as ratified, and separately states both that P5 is unaccepted/awaiting adjudication and that P5 is accepted at the committed REM11 checkpoint.

**Concrete failure mode:** `docs/handoffs/latest.md` is the repository's canonical operational entry point. A next agent cannot mechanically determine the current commit, whether REM11 is committed, or whether P5 is accepted without reconstructing history from later paragraphs and git. The contradictions fail the minimum handoff-state requirements in `CLAUDE.md` and can cause unnecessary re-review or an incorrect phase-gate report.

**Classification:** operational documentation / verification-state defect. It does not change runtime behavior or reopen P5 architecture.

**Minimum correction:** make the current-state block single-valued: HEAD `1810ece`; clean production/test/spec/plan state; REM11 committed and owner-ratified; this focused review pending targeted adjudication; P5 functional acceptance supported but its REM11 closeout documentation pending this review's adjudication. Remove or clearly mark superseded the pre-ratification and “nothing committed” sentences. Keep P6 explicitly unauthorized.

The current working-tree handoff update made by this review corrects its top-level operational state and points to this review; it does not rewrite the historical record or remediate the separate memory wording finding.

### Low — the G-CAL correction still repeats the disproven “typed arrays only” claim

**Locations:**

- `clashtest/results/validateResultSet.js` lines 1017–1027, especially lines 1021–1022.
- `docs/reviews/2026-09-23-federated-clash-test-core-p5-remediation-focused-rereview-adjudication.md` line 306.

REM11 correctly adds text saying the ~569/~512 MiB figures are incomplete because the ranking phase allocates ordinary JavaScript arrays and wrapper objects. In the same committed checkpoint, however:

- the implementation comment still says “the proof's working set lives in typed arrays only”; and
- the adjudication paragraph that introduces the correction later says “the proof's memory is now entirely typed arrays.”

Both statements directly contradict the correction and the already-identified allocations: `mergeSortSteps`'s `dst`, per-model `roots[]`, and per-root `{rootDbId, rec}` wrappers.

**Concrete failure mode:** a future G-CAL pass can mistake the typed-array formula for total proof memory or exclude the ranking allocations from measurement, reproducing the undercount REM11 was intended to prevent. Runtime correctness remains unchanged and allocation failure still fails closed.

**Classification:** documentation/verification-record inconsistency. This is Low because G-CAL already requires measuring total typed-array plus plain-JS peak, so the authoritative gate remains conservative despite the stale prose.

**Minimum correction:** replace both absolute statements with wording limited to the sweep's typed-array buffers; explicitly say the displayed formula accounts only for typed-array backing storage and excludes ranking-phase JavaScript allocations. No algorithm, schema, spec, or test change is needed.

## Functional remediation verification

The live `116a811..1810ece` diff was read directly.

- `countsByReason`: malformed and valid rows now both reach exactly one `yield CROSS_STEP`; `countsRowsValid`, `countsSum`, Sigma reconciliation, and fail-closed behavior are unchanged.
- `allLeavesEvaluatedEqual`: the triggering leaf now yields before the break; the final boolean and derived coverage result are unchanged.
- `duplicateConflict`: the triggering result now yields before the break; the final boolean and derived integrity result are unchanged.
- The additional two fixes match the owner-ratified narrow rule: an item that terminates an existing per-item loop must not skip that item's established checkpoint. No broader slicing audit or behavior change was introduced.
- The four REM11 tests cover malformed-row fail-closed behavior and independently distinguish the missing-trigger-item checkpoints from the fixed behavior.

## Verification results

- `node --test test/clashtest/results/validateResultSet.invariants.test.mjs test/clashtest/results/validateResultSet.slicing.test.mjs` — **43/43 pass** (**38/38 invariants + 5/5 slicing**).
- `node --test 'test/clashtest/**/*.test.mjs'` — **966/966 pass**.
- `node scripts/run-tests.mjs` with local ephemeral-port access — **2,092 total / 2,091 pass / 0 fail / 1 todo**.
- The sole todo is the pre-existing extreme-aspect-ratio containment gap in `test/query/ContainmentQuery.classifyPoint.test.mjs`; it is unrelated to P5-REM11.
- `git diff --check 116a811..1810ece` — clean.

## Gate conclusion

P5-REM11's runtime change is sound and has no Critical, High, or Medium implementation blocker. The checkpoint's operational/documentation closeout should be corrected and targeted-adjudicated before the REM11 review cycle is recorded complete. This does not authorize P6.
