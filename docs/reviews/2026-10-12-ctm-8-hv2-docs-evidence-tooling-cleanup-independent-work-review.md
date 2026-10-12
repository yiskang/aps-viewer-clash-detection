# CTM-8 HV-2 Documentation / Evidence-Tooling Cleanup — Independent Work Review

**Date:** 2026-10-12

**Verdict:** **CONDITIONAL PASS — READY FOR OWNER CLEANUP CHECKPOINT DECISION WITH NON-BLOCKING RESIDUALS**

**Findings:** 0 Critical / 0 High / 0 Medium / 1 Low

**Blockers:** None

## 1. Repository and checkpoint state

- Repository: `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- Branch: `main`
- HEAD: `9dbf47ad80d32de246cca1f19f116910f3040d4d`
- Origin: `origin/main` at the same commit; ahead/behind `0/0`
- Checkpoint: `9dbf47a` — `test(clash-panel): complete CTM-8 rebuild-cost calibration`
- The checkpoint is present at both local `main` and `origin/main`, directly after `ac5bcb4`; it was not amended or replaced in this package.
- Working tree before this review: one tracked modification, `docs/handoffs/latest.md`; four untracked documentation files comprising the cleanup prompt and three cleanup research artifacts.
- No production, test, protocol, plan, prior review, or evidence path is modified.
- `git diff --check`: clean.

The pushed CTM-8 checkpoint remains complete and unchanged. This review covers only the post-checkpoint documentation/evidence-tooling cleanup described in [`docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`](../research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md). That upstream report was treated as read-only input.

## 2. Cleanup scope

The package is correctly limited to:

1. a forward-looking HV-2 Focus check definition;
2. a metadata correction from 37 to 38 checksummed files; and
3. a forward-looking pre-/post-Focus containment capture requirement.

It does not change product behavior, performance conclusions, calibration results, the accepted CTM8-P0-v4 protocol, historical evidence, or historical review dispositions.

## 3. Future HV-2 guidance adjudication

Reviewed: [`future HV-2 check and evidence guidance`](../research/2026-10-12-ctm-8-hv2-future-check-and-evidence-guidance.md).

The guidance correctly preserves the accepted classification **CHECK/EVIDENCE DEFECT** and removes the invalid universal rule that the camera must differ after explicit Focus.

It requires a discriminating pre-state through either:

- moving the camera away from the fitted aggregate pose and proving the pre-Focus state is not framed; or
- disabling Focus-on-select before selecting the group and proving that selection issued no aggregate fit.

The future predicate requires the explicit Focus action to dispatch the aggregate fit path, settle at a finite fitted camera, and frame the selected group's aggregate participant bounds. Camera motion is required only from a non-fitted pre-state. An already-fitted explicit Focus may remain idempotent; an already-fitted sample that cannot discriminate working Focus from a no-op is `INCONCLUSIVE`, not `FAIL`.

The future definition therefore closes the predicate defect without changing the completed historical result.

## 4. Checksum-count correction adjudication

Reviewed: [`checksum-count correction`](../research/2026-10-12-ctm-8-hv2-checksum-count-correction.md).

- The historical upstream HV-2 report still says 37 files.
- The retained `checksums.sha256` manifest contains **38** entries.
- Independent verification from the evidence directory produced **38 OK / 0 failed**.
- The earlier count is a prose/metadata error only; no evidence file or checksum is invalid.
- The historical upstream report and the prior Independent Work Review remain unchanged.

The additive correction note is sufficient and preserves history. Rewriting the historical report is neither necessary nor authorized.

## 5. Pre-/post-Focus containment guidance adjudication

The future guidance explicitly requires:

- `containmentPreFocus` after settling and before issuing the Focus click;
- a separately captured `containmentPostFocus` after the post-click settled condition;
- explicit `pre-focus` / `post-focus` labels, settled state, participant source, event-count mark, and timestamp; and
- an `INCONCLUSIVE` result when the pre-Focus value is captured after the click, with no retrospective backfill.

The historical P3-C evidence remains unchanged. This directly addresses the prior Low evidence-capture finding without manufacturing historical evidence.

## 6. Tooling-left-unchanged adjudication

`test/calibration/ctm8/headed/hv2-adjudication.js` is retained historical, runtime-injected support. Repository search found no retained driver, test, package command, or automatic execution path that invokes it. Its `containment()` function is an unlabeled point-in-time measurement whose ordering was supplied by the one-shot external driver preserved only as historical evidence.

Changing the helper in this cleanup would create unexecuted and unvalidated code. The guidance correctly requires a labelled wrapper, test, and version bump if a future package retains or reuses the helper. Leaving it unchanged is **correct scope discipline; no finding**.

## 7. Protocol-left-unchanged adjudication

The accepted CTM8-P0-v4 protocol remains byte-stable at SHA-256 `a6f7a61f1cae8b2aac7868277b67c26422537f88af3c27d908cbd054fc2634c3`. Its §9.4 HV-2 row is the historical record of the completed campaign and still contains the old predicate.

The new guidance explicitly identifies that predicate as invalid, states that the guidance governs any future HV-2 execution where it differs, and is linked from the current handoff. This is an adequate durable forward boundary while preserving the accepted protocol. Editing the historical protocol is not required; **no finding**.

## 8. Historical preservation

Diff checks against `HEAD` confirmed no modification to:

- historical raw CTM-8 calibration evidence;
- historical HV-2 9/9 evidence;
- targeted HV-2 evidence;
- the upstream HV-2 final report;
- prior Independent Work Reviews;
- `test/calibration/ctm8/headed/hv2-adjudication.js`;
- production implementation or existing tests.

The cleanup is additive/corrective. No calibration or HV-2 run occurred, and no history rewrite, amend, reset, or force-push is represented in the repository state.

## 9. Cleanup final-report and handoff accuracy

The cleanup final report accurately records the checkpoint, three-item scope, guidance, checksum correction, containment requirement, protected history, lack of rerun, lack of production/test change, uncommitted state, and independent-review next gate.

The handoff accurately keeps the pushed CTM-8 milestone distinct from this post-checkpoint cleanup and records no product remediation, performance change, or rerun. Before this review it correctly awaited Independent Work review.

One non-blocking wording defect remains in the upstream final report, recorded below.

## 10. Findings

### Low L1 — final-report changed-files heading incorrectly says every listed path is new

- **Affected artifact:** `docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`, §4 heading: “Files changed (all new, docs only)”.
- **Concrete defect:** the list includes the modified existing `docs/handoffs/latest.md` and the pre-existing untracked task prompt, so not every listed path is new or created by the cleanup.
- **Historical/product impact:** none. The bullets and repository status identify the actual roles correctly; no scope or evidence claim changes.
- **Minimum correction:** the responsible cleanup package should change the heading in a separately authorized correction to “Files changed/added (docs only)” or equivalent. No production, historical, or evidence edit is needed.
- **Blocker status:** non-blocking for the cleanup checkpoint.
- **Responsible upstream package:** post-checkpoint HV-2 documentation/evidence-tooling cleanup package.

## 11. Verdict and next gate

The cleanup is historically safe, technically correct, and sufficiently scoped. The future predicate, checksum metadata, and pre-/post-Focus capture requirements are resolved. The single Low is report wording only.

**Cleanup checkpoint readiness:** ready for the owner's cleanup checkpoint decision.

**Exact next authorized action:** none automatically. The next gate is the **owner decision whether to authorize one small follow-up checkpoint commit/push for this reviewed cleanup package**. Until authorized, do not remediate the upstream report, modify production/tests/tooling/protocol/history/evidence, rerun HV-2 or calibration, commit, push, reopen CTM-8, or begin another milestone.
