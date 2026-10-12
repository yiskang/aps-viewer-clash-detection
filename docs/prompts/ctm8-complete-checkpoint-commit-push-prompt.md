# Checkpoint Commit + Push Prompt — Complete CTM-8 Package

## Owner authorization

The owner authorizes a **checkpoint commit and normal push** for the complete reviewed CTM-8 package in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to checkpointing the already reviewed CTM-8 package.

Do **not** begin another CTM-8 package.
Do **not** reopen calibration/refinement.
Do **not** remediate deferred findings.
Do **not** alter production behavior.
Do **not** amend prior history.
Do **not** force-push.

## Governing reviews

Before any commit, read and treat as authoritative:

- `docs/reviews/2026-10-12-ctm-8-execution-support-package-independent-work-review.md`
- `docs/reviews/2026-10-12-ctm-8-hv2-focus-adjudication-independent-work-review.md`
- `docs/handoffs/latest.md`

Also read:

- `CLAUDE.md`
- current CTM governing spec/plan
- accepted CTM8-P0-v4 protocol
- `docs/research/2026-10-12-ctm-8-rebuild-cost-calibration-final-report.md`
- `docs/research/2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md`

The latest authoritative disposition is:

- CTM-8 execution package reviewed
- HV-2 classified **CHECK/EVIDENCE DEFECT**
- HV-2 product remediation not required
- HM-REC unavailable disposition accepted as non-blocking
- Family M launch shift accepted as a documented non-blocking anomaly
- latest checkpoint verdict: **CONDITIONAL PASS — READY FOR OWNER CHECKPOINT DECISION WITH NON-BLOCKING RESIDUALS**
- blockers: none

## Before committing

Independently verify:

- repository path is correct;
- branch is `main`;
- current HEAD;
- `origin/main`;
- ahead/behind;
- working tree;
- all modified/untracked paths;
- no unrelated changes appeared after the latest Work review;
- no production file changed outside the already reviewed package;
- CTM-7 remains closed;
- Addendum B checkpoint remains preserved;
- CTM-8 execution artifacts/evidence/support code match the reviewed package;
- no new remediation/refinement package began.

Expected prior checkpoint baseline before this CTM-8 package:

`ac5bcb42b00e668442ce3add9764cba96d883309`

If repository state differs materially from the reviewed state, **stop before commit** and report the discrepancy.

## Reviewed CTM-8 state to preserve

Do not change the following accepted dispositions during checkpointing.

### Mandatory campaign

- 84 cells / launch
- 252 cell executions across 3 launches
- 7,020 measured samples
- 1,080 warm-ups
- 8,100 total operations

### Verification

Preserve the reviewed execution results, including:

- calibration tests: 118 pass
- full offline suite: 5,813 total / 5,812 pass / 0 fail / 1 todo
- evidence checksum verification
- no production changes
- Family R headed evidence
- HM-REC 6/6 `UNAVAILABLE`
- Family M launch-shift anomaly
- HV-2 historical 9/9 defect evidence preserved
- HV-2 targeted adjudication: 7 PASS / 0 FAIL / 0 INCONCLUSIVE

Do not rerun or reinterpret these merely to checkpoint unless repository rules require a final mechanical verification.

## Accepted non-blocking residuals

Preserve all currently reviewed non-blocking residuals.

At minimum include the latest HV-2 review Lows:

### HV-2 Low L1

The HV-2 upstream report says 37 checksummed files while the manifest actually contains 38 entries.

All 38 verify.

Do not rewrite the upstream report during checkpoint unless an existing authorized closeout rule explicitly requires it.

### HV-2 Low L2

P3-C raw containment was sampled after Focus and is not independently sufficient for the pre-Focus state.

The independent review found the remaining camera/event/screenshot evidence sufficient.

Do not rerun or rewrite this evidence during checkpoint.

Also preserve any previously accepted non-blocking CTM-8 execution-review residuals/deferred observations.

## HM-REC / launch-shift owner dispositions

Do not reopen:

- HM-REC 6/6 `UNAVAILABLE` — accepted as non-blocking
- Family M launch 0 vs launches 1/2 shift — accepted as documented non-blocking anomaly

No refinement is authorized as part of checkpointing.

## HV-2 disposition

Preserve:

**CHECK/EVIDENCE DEFECT**

The accepted reason is that the historical HV-2 predicate required camera pose to change after explicit Focus, even though group selection with Focus-on-select had already fitted the same aggregate pose.

The targeted evidence establishes that:

- idempotent Focus executes correctly;
- moved-away Focus restores the fitted pose;
- Focus-on-select OFF allows explicit Focus to perform the first fit;
- product Focus behavior meets the reviewed Addendum B contract.

Do not edit production Focus behavior.

## Mechanical verification before commit

Run only the mechanical checks needed to confirm the reviewed package has not changed unexpectedly.

At minimum:

- `git status --short`
- `git diff --check`
- changed-file inventory
- protected-path inspection
- evidence-manifest/checksum verification if repository workflow requires it immediately before checkpoint

Do not run a new calibration campaign.

Do not open new headed evidence.

If repository workflow requires a final test execution before commit, run the required suite and report exact totals. Otherwise do not create a new evidence baseline simply for checkpointing.

## Handoff closeout

Before commit, update `docs/handoffs/latest.md` only as necessary to record the checkpoint closeout state.

Keep it concise.

Record:

- repo / branch / pre-commit HEAD / tree state
- CTM-7 closed
- Addendum B checkpoint preserved
- CTM-8 protocol version
- CTM-8 execution final report
- CTM-8 execution Independent Work Review
- HV-2 adjudication final report
- HV-2 Independent Work Review
- checkpoint verdict/readiness
- blockers: none
- accepted non-blocking residuals/deferred anomalies
- owner checkpoint authorization
- CTM-8 checkpoint being committed/pushed
- exact next gate after successful push: owner direction
- no automatic refinement, optimization, limit-setting, or new milestone

Do not duplicate the full Independent Work Reviews in the handoff.

## Commit contents

Create **one checkpoint commit** containing the complete reviewed CTM-8 package, including as applicable:

- CTM-8 protocol/research documentation
- remediation/correction reports
- Independent Work Reviews
- non-production calibration support code
- calibration support tests
- raw/derived evidence retained by repository policy
- execution final report
- HV-2 evidence/adjudication artifacts
- prompts that are intentionally repository-tracked
- updated handoff

Before committing, inspect the staged file list.

Do not include:

- unrelated local files
- editor/temp files
- ignored runtime junk
- secrets
- local-only caches
- unreviewed changes

If an untracked file is ambiguous, stop and report rather than guessing.

## Commit message

Use a clear checkpoint message such as:

`test(clash-panel): complete CTM-8 rebuild-cost calibration`

If repository conventions suggest a better equivalent, follow them while preserving the meaning.

Do not amend previous commits.
Do not rewrite history.

## Post-commit verification

After commit, verify:

- commit SHA
- branch remains `main`
- commit contains only the intended CTM-8 package
- `git diff HEAD^..HEAD --check`
- working tree state

If `--check` reports only known preserved Markdown trailing-space line breaks in read-only review artifacts, report that precisely and do not alter historical review files merely to silence the warning.

Any code/test whitespace error must be treated separately and must not be silently ignored.

## Push

Push normally to:

`origin/main`

No force-push.

After push verify:

- local `main == origin/main`
- pushed SHA matches local checkpoint commit
- ahead/behind = `0/0`
- working tree clean
- no additional local commit exists
- CTM-8 checkpoint is fully synchronized

## Final response

Report only:

- checkpoint commit SHA
- commit message
- push result
- `main == origin/main` status
- working-tree status
- blockers remaining
- accepted non-blocking residuals
- CTM-8 checkpoint status
- exact next gate

Do not start follow-up work.

## Stop condition

After successful commit and push:

**STOP.**

Do not:

- open CTM-8 refinement
- optimize performance
- set product limits/budgets
- remediate HM-REC
- investigate launch shift
- change HV-2 protocol/check
- remediate deferred CTM/Addendum findings
- begin another milestone/package

Wait for owner direction.
