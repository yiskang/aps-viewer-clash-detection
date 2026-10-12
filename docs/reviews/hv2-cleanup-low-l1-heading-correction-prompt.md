# Claude/Codex Prompt — HV-2 Cleanup Report Heading Correction

## Owner authorization

The owner authorizes one **minimal docs-only correction** in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This correction is limited to closing the single remaining Low finding from:

`docs/reviews/2026-10-12-ctm-8-hv2-docs-evidence-tooling-cleanup-independent-work-review.md`

## Exact correction

Edit only:

`docs/research/2026-10-12-ctm-8-hv2-documentation-evidence-tooling-cleanup-final-report.md`

Change the §4 heading from wording equivalent to:

`Files changed (all new, docs only)`

to:

`Files changed/added (docs only)`

or an equally precise equivalent.

Reason:

- the section includes `docs/handoffs/latest.md`, which was modified rather than newly created;
- it also lists a pre-existing untracked prompt;
- therefore “all new” is inaccurate.

## Hard boundaries

Do not change:

- any production code;
- any test/support code;
- any historical evidence;
- any prior Independent Work Review;
- any CTM-8 protocol/spec/plan;
- any checksum/evidence content;
- any product behavior;
- any other cleanup finding/disposition.

Do not rerun calibration or HV-2 evidence.

Do not commit or push.

## Verification

After the edit:

- re-read the affected section;
- run `git diff --check`;
- verify the only content change for this correction is the heading wording;
- confirm no historical/evidence path changed.

## Durable status

Update `docs/handoffs/latest.md` only if necessary to record that the single cleanup Low has been corrected and that the package is awaiting a minimal targeted Independent Work re-review.

Do not rewrite historical handoff entries.

## Stop condition

After the one-line correction and any necessary concise handoff update:

**STOP.**

Do not commit.
Do not push.

Next gate:

**targeted Independent Work re-review of the corrected cleanup package**, limited to verifying closure of Low L1 and checkpoint readiness.
