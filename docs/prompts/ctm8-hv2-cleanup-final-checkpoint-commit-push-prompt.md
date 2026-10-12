# Cleanup Checkpoint Commit + Push Prompt — Post-CTM-8 HV-2 Cleanup

## Owner authorization

The owner authorizes the **post-checkpoint HV-2 cleanup checkpoint commit and normal push** for:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to checkpointing the already reviewed cleanup package.

Do **not** amend or rewrite the previously pushed CTM-8 checkpoint.
Do **not** force-push.
Do **not** reopen CTM-8.
Do **not** rerun calibration or HV-2 evidence.
Do **not** modify production code, tests, protocol, spec, plan, historical evidence, or prior reviews.

## Governing review

Use as the authoritative cleanup review:

`docs/reviews/2026-10-12-ctm-8-hv2-cleanup-l1-closure-targeted-independent-work-review.md`

Accepted disposition:

- **PASS — READY FOR OWNER CLEANUP CHECKPOINT DECISION**
- 0 Critical / 0 High / 0 Medium / 0 Low
- blockers: none
- cleanup checkpoint readiness: ready

Also read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/research/2026-10-12-ctm-8-hv2-future-check-and-evidence-guidance.md`
- `docs/research/2026-10-12-ctm-8-hv2-checksum-count-correction.md`
- `docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`
- `docs/reviews/2026-10-12-ctm-8-hv2-docs-evidence-tooling-cleanup-independent-work-review.md`

## Before committing

Independently verify:

- repository path;
- branch is `main`;
- current HEAD;
- `origin/main`;
- ahead/behind;
- working tree;
- every modified/untracked path;
- pushed CTM-8 checkpoint remains intact;
- cleanup package has not already been committed/pushed;
- no unrelated local changes appeared after the targeted review.

The latest review verified the pushed CTM-8 checkpoint at:

`9dbf47ad80d32de246cca1f19f116910f3040d4d`

Verify current repo state from Git rather than assuming this is still HEAD.

If repository state differs materially from the reviewed cleanup state, **stop before commit** and report the discrepancy.

## Reviewed cleanup scope

Checkpoint only the reviewed cleanup package, including as applicable:

- `docs/research/2026-10-12-ctm-8-hv2-future-check-and-evidence-guidance.md`
- `docs/research/2026-10-12-ctm-8-hv2-checksum-count-correction.md`
- `docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`
- `docs/reviews/2026-10-12-ctm-8-hv2-docs-evidence-tooling-cleanup-independent-work-review.md`
- `docs/reviews/2026-10-12-ctm-8-hv2-cleanup-l1-closure-targeted-independent-work-review.md`
- `docs/handoffs/latest.md`
- any intentionally tracked prompt artifact belonging exactly to this cleanup package, if repository convention tracks prompts

Do not include unrelated files.

## Historical protections

Preserve unchanged:

- pushed CTM-8 checkpoint history;
- CTM-8 raw calibration evidence;
- historical HV-2 9/9 evidence;
- targeted HV-2 evidence;
- prior Independent Work Reviews;
- CTM8-P0-v4 protocol;
- production implementation;
- existing tests.

Do not amend.
Do not rebase.
Do not reset history.
Do not force-push.

## Cleanup semantics to preserve

### Future HV-2

Future HV-2 guidance must remain based on a discriminating pre-state:

- move camera away before Focus, or
- disable Focus-on-select before selection.

Do not restore the invalid historical requirement that an already-correct fitted camera must change pose after explicit Focus.

### Checksum correction

Preserve:

- correct manifest count = **38**
- all 38 checksum entries verify
- prior `37` value is a historical metadata error only

### Pre/post Focus containment

Preserve:

- `containmentPreFocus` captured before explicit Focus
- `containmentPostFocus` captured separately after Focus
- no retroactive backfill of historical P3-C evidence

### Closed Low L1

Preserve the corrected cleanup-report heading:

`Files changed/added (docs only)`

Do not revert it to wording implying all listed files are new.

## Mechanical verification before staging

Run/inspect at minimum:

- `git status --short`
- `git diff --check`
- changed-file inventory
- protected-path inspection
- confirm no historical evidence path changed
- confirm no production/test/protocol/prior-review path changed unexpectedly

Do not rerun calibration.
Do not rerun HV-2 headed evidence.

## Handoff closeout

Before commit, update `docs/handoffs/latest.md` only if necessary to record the cleanup checkpoint closeout.

Keep it concise.

Record:

- repo / branch / pre-commit HEAD / tree state
- CTM-8 checkpoint remains complete and pushed
- post-checkpoint HV-2 cleanup reviewed with 0 findings
- cleanup final report
- cleanup Independent Work Review
- L1 closure targeted review
- blockers: none
- owner cleanup checkpoint authorization
- exact next gate after successful push: owner direction
- no automatic CTM-8 reopening/refinement

Do not duplicate full review content.

## Stage and inspect

Stage only the reviewed cleanup package.

Before commit:

- inspect staged file list;
- verify no unrelated files are staged;
- verify no production/test/evidence-history rewrite is present;
- verify every staged file belongs to this cleanup package.

If any staged/untracked file is ambiguous, stop and report.

## Commit

Create one cleanup checkpoint commit.

Suggested commit message:

`docs(clash-panel): finalize CTM-8 HV-2 evidence guidance`

Use the closest repository-conformant equivalent if needed.

Do not amend prior commits.
Do not rewrite history.

## Post-commit verification

After commit verify:

- commit SHA;
- branch remains `main`;
- commit contains only the intended cleanup package;
- `git diff HEAD^..HEAD --check`;
- working tree state.

If `--check` reports only preserved Markdown trailing-space line breaks in historical/read-only review artifacts, report that precisely and do not rewrite them merely to silence the warning.

Any unexpected code/test whitespace issue must not be ignored.

## Push

Push normally to:

`origin/main`

No force-push.

After push verify:

- local `main == origin/main`
- pushed SHA matches local commit
- ahead/behind = `0/0`
- working tree clean
- original CTM-8 checkpoint remains in history unchanged
- cleanup checkpoint is now the latest synchronized commit

## Final response

Report only:

- cleanup checkpoint commit SHA
- commit message
- push result
- `main == origin/main` status
- working-tree status
- blockers remaining
- findings remaining
- confirmation CTM-8 checkpoint/history/evidence were preserved
- exact next gate

Do not start follow-up work.

## Stop condition

After successful commit and push:

**STOP.**

Do not:

- reopen CTM-8
- rerun calibration
- rerun HV-2
- modify production/tests/protocol/evidence
- start another cleanup/refinement package

Wait for owner direction.
