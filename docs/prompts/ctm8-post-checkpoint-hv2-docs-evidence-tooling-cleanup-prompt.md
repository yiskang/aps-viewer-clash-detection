# Claude/Codex Prompt — Post-Checkpoint HV-2 Documentation / Evidence-Tooling Cleanup

## Context

The complete CTM-8 checkpoint has already been **committed and pushed**.

Do **not** amend, rewrite, reset, or force-push that checkpoint.

This package is a small post-checkpoint cleanup only. Its purpose is to correct documentation/evidence-tooling guidance discovered after the checkpoint, while preserving historical evidence and review artifacts.

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Scope

Perform a **docs/evidence-tooling cleanup package only** covering exactly these three items:

1. Future HV-2 Focus check definition
2. HV-2 checksum-count metadata correction (`37 → 38`)
3. Future pre-Focus containment capture requirement

Do not reopen CTM-8 calibration.
Do not rerun the headless campaign.
Do not rerun the historical 9/9 HV-2 evidence.
Do not modify production code.
Do not modify existing historical evidence.
Do not amend the pushed CTM-8 checkpoint.

## Before editing

Independently verify:

- repository / branch / HEAD / origin;
- current working tree;
- the pushed CTM-8 checkpoint is present on `origin/main`;
- latest handoff;
- latest HV-2 final report;
- latest HV-2 Independent Work Review;
- relevant protocol/evidence-tooling documentation.

Read at minimum:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/research/2026-10-12-ctm-8-hv2-focus-adjudication-final-report.md`
- `docs/reviews/2026-10-12-ctm-8-hv2-focus-adjudication-independent-work-review.md`
- current CTM-8 calibration protocol / headed-evidence guidance
- any evidence-tooling docs/scripts that define future HV-2 checks

If repo state materially differs from the expected post-checkpoint state, stop and report before editing.

## 1. Future HV-2 check definition

The historical HV-2 check is now classified as a **CHECK/EVIDENCE DEFECT**.

The old predicate was invalid because it effectively required:

> camera pose after explicit Focus must differ from the pre-Focus pose

That is not a valid correctness requirement when the group was already fitted by Focus-on-select.

### Required correction

Update only the **future** HV-2 check/guidance so it uses a discriminating pre-state.

Preferred accepted pattern:

- either move the camera away from the aggregate fitted pose before explicit Focus;
- or disable Focus-on-select before selecting the group, so explicit Focus performs the first fit.

The future check must verify the actual product contract:

- explicit Focus dispatches the aggregate fit path;
- the selected group's aggregate participant bounds are correctly framed;
- camera movement is required only when the camera is not already at the correct fitted pose;
- idempotent Focus at an already-fitted pose is valid behavior.

Do not rewrite historical HV-2 evidence or historical review conclusions.

## 2. Checksum-count metadata correction

The historical HV-2 upstream report says the evidence package contains **37** checksummed files.

The authoritative review verified:

- the checksum manifest actually contains **38** entries;
- all 38 entries verify successfully.

### Required correction

Do not rewrite the historical Independent Work Review.

Preferred approach:

- create a small correction/addendum note under `docs/research/` or the repository's normal correction location;
- state clearly that the earlier `37` count was metadata-only and the correct count is `38`;
- state that all 38 checksums verify;
- preserve the original report as historical input.

If repository workflow permits a narrow correction pointer in the upstream report, use only the minimum non-destructive pointer and do not rewrite historical body text.

## 3. Future pre-Focus containment capture

The historical P3-C evidence sampled one containment field after Focus.

That historical limitation is accepted and non-blocking because other evidence was sufficient.

### Required future tooling correction

Update future evidence-tooling guidance / non-production support code, if such tooling is intended to be retained, so that:

- containment / framing state is captured **before** the explicit Focus click;
- post-Focus containment is captured separately;
- before/after state cannot be confused;
- the raw evidence labels pre-Focus and post-Focus samples explicitly.

Do not modify historical evidence files.
Do not manufacture a missing pre-Focus sample retroactively.

If the evidence tooling itself is not intended to be retained as active support code, document the future requirement rather than changing dead/archived tooling unnecessarily.

## Protected history

Do not modify or rewrite:

- historical CTM-8 raw calibration evidence;
- historical HV-2 9/9 evidence;
- historical HV-2 targeted evidence;
- prior Independent Work Reviews;
- prior commit history;
- pushed checkpoint commit;
- production behavior.

No force-push.
No amend.
No history rewrite.

## Required durable artifact

Create a concise cleanup/correction report under `docs/research/`.

Suggested filename:

`docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`

It must record:

- repo / branch / HEAD / origin / tree;
- pushed CTM-8 checkpoint reference;
- exact cleanup scope;
- future HV-2 check correction;
- checksum-count correction;
- future pre-Focus containment requirement;
- exact files changed;
- explicit confirmation that historical evidence/reviews were preserved;
- explicit confirmation that no calibration was rerun;
- explicit confirmation that no production code changed;
- exact next gate.

## Handoff

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- CTM-8 checkpoint remains complete and pushed;
- this is a post-checkpoint documentation/evidence-tooling cleanup only;
- cleanup report path;
- no product remediation;
- no calibration rerun;
- no performance conclusion changed;
- exact next gate.

## Verification

Before stopping:

- `git diff --check`
- verify changed paths are limited to docs and, only if necessary, non-production retained evidence tooling
- verify no historical evidence file changed
- verify no production file changed
- verify no prior review file changed
- verify checksum correction says `38`, not `37`
- verify future HV-2 no longer requires camera pose change from an already-fitted state
- verify future containment capture is explicitly pre-Focus + post-Focus

## Independent review boundary

Do **not** author the Independent Work Review yourself.

After cleanup artifacts are complete:

**STOP.**

Next gate:

**Independent Work review of the post-checkpoint HV-2 documentation/evidence-tooling cleanup package.**

Do not commit or push unless separately authorized after that review.
