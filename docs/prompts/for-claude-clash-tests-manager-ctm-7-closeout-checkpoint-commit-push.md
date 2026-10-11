# For Claude — CTM-7 Closeout Checkpoint Commit + Push Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Owner authorization

The owner explicitly authorizes **one scoped CTM-7 closeout checkpoint commit + push only**.

This authorization closes the current CTM-7 package at the accepted evidence/governance state and checkpoints the complete reviewed package.

It does **not** authorize:

- CTM-8;
- L1–L8 remediation;
- H5 copy remediation;
- stale `PROTOCOL.md` wording cleanup;
- D/J/H6 coverage expansion;
- any new headed rerun;
- any production/test/spec/plan change beyond the already-reviewed Option B remediation currently in the working tree;
- persistence/history/background runs;
- resize/separate-panel work;
- Core / Viewer Adapter / collision changes;
- G2 / C6 / C8 / G3 / R20-1;
- another package or milestone.

## Governing closeout state

The owner has already decided and ratified:

- F-1 **Option B**: hide is visibility-only while the same model key remains computationally available.
- Option B remediation is independently accepted.
- Scenario H retained post-fix headed evidence is owner-ratified despite the disclosed preflight workflow deviation.
- H0–H5 are gate-valid PASS evidence.
- H6 remains INCONCLUSIVE because there is no same-key-after-unload product path.
- Earlier Scenario D and J remain INCONCLUSIVE.
- H5 editor copy Low remains open.
- stale `PROTOCOL.md` role/wording Low remains open.
- L1–L8 remain deferred.
- CTM-8 remains unauthorized.

The ratification applies only to this retained evidence package and is **not** a general retry policy.

## Start-state verification

Before staging or committing, independently verify:

- repository path;
- branch / HEAD / origin relation;
- working tree;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- latest accepted checkpoint baseline;
- latest CTM-7 Independent Work Review;
- latest F-1 Option B remediation Independent Work Review;
- latest Scenario H headed revalidation Independent Work Review;
- owner-ratification record:
  `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-scenario-h-evidence-owner-ratification.md`;
- all upstream final reports and evidence packages listed below.

Repository state is authoritative. If the tree differs materially from the reviewed CTM-7 closeout state, stop and report the discrepancy instead of repairing it.

## Required package to include

Checkpoint the complete current CTM-7 package and only its reviewed artifacts.

### Production remediation

Include the already-reviewed Option B production change:

- `clashpanel/core/testsManager.js`

Do not modify it further.

### Directly affected tests

Include the already-reviewed F-1 Option B tests, including:

- `test/clashpanel/core/testsManager.core.test.mjs`

and only other test files already part of the accepted CTM-7 remediation diff, if any.

Do not add or edit tests during checkpointing.

### Governing current docs

Include the already-reviewed current normative changes:

- Viewer Clash Panel spec §26.6 / AC-M10;
- Clash Tests Manager implementation plan CTM-7 row;
- current handoff.

Do not rewrite unrelated historical sections.

### CTM-7 upstream reports

Include all current CTM-7 package reports, including:

- `docs/research/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-final-report.md`
- `docs/research/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-final-report.md`
- `docs/research/2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-final-report.md`

Preserve their bytes unless a file was already legitimately changed before this checkpoint and that change is part of the reviewed package.

### Independent Work Reviews

Include:

- `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-headed-svf2-validation-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-f1-option-b-remediation-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-scenario-h-headed-revalidation-independent-work-review.md`

### Owner decision record

Include:

- `docs/reviews/2026-10-11-clash-tests-manager-ctm-7-scenario-h-evidence-owner-ratification.md`

### CTM-7 evidence

Include the complete retained evidence directories for:

- original CTM-7 headed validation;
- Scenario H revalidation;
- evidence-support files used for the H revalidation.

Expected paths include:

- `docs/research/evidence/2026-10-11-ctm-7-headed-svf2/`
- `docs/research/evidence/2026-10-11-ctm-7-scenario-h-revalidation/`
- `docs/research/evidence-support/ctm-7-h-revalidation/`

Include manifests, screenshots, state captures, runtime identity, console/scenario logs, helper/schema/protocol and other reviewed evidence files already present.

Do not regenerate evidence.

### Package prompts / authorization artifacts

Include the CTM-7 prompts/authorization artifacts that belong to this package and are already present in the working tree / intended tracked set, including as applicable:

- CTM-7 headed validation prompt;
- CTM-7 Independent Work review prompt;
- F-1 Option B remediation prompt;
- F-1 remediation Independent Work review prompt;
- Scenario H headed revalidation prompt;
- Scenario H Independent Work review prompt;
- owner-ratification prompt.

Do not invent additional prompt artifacts.

### Handoff

Include:

- `docs/handoffs/latest.md`

It must reflect the owner-ratified CTM-7 closeout state and link the latest authoritative review/decision artifacts.

## Explicitly excluded from this checkpoint

Do **not** modify or remediate:

- H5 ambiguous editor copy Low;
- stale `PROTOCOL.md` role/wording Low;
- D held-unsaved headed coverage gap;
- J fault/recovery headed coverage gap;
- H6 same-key-after-unload coverage gap;
- L1–L8;
- CTM-8;
- any other Low/Medium not already remediated and independently accepted;
- persistence/history/background runs;
- resize/separate-panel behavior;
- Core / Viewer Adapter / collision;
- G2 / C6 / C8 / G3 / R20-1;
- unrelated product/UI cleanup;
- another milestone/package.

Do not run a fresh headed validation.

## Pre-commit verification

Before staging:

1. Verify `main` / `origin/main` / current baseline state.
2. Inspect the full diff and untracked set.
3. Confirm the only production change is the accepted `clashpanel/core/testsManager.js` Option B remediation.
4. Confirm directly affected tests match the accepted remediation package.
5. Confirm spec §26.6 / AC-M10 and plan CTM-7 changes match the accepted Option B contract.
6. Confirm all CTM-7 reports/reviews/evidence/ratification artifacts exist.
7. Verify evidence manifests that already exist.
8. Confirm no evidence file is regenerated or rewritten.
9. Run `git diff --check`.
10. Verify protected paths have zero unintended diff.
11. Verify CTM-8 and L1–L8 have no diff.
12. Verify H5 copy and stale-protocol Lows remain intentionally unremediated.
13. Verify the handoff links:
    - latest CTM-7 Independent Work Review;
    - Option B remediation review;
    - Scenario H review;
    - owner-ratification record.

If any unexpected/unreviewed change exists, stop and report it. Do not fix it under this authorization.

## Commit

Create exactly one scoped CTM-7 closeout checkpoint commit.

Suggested commit message:

`feat(clashpanel): checkpoint CTM-7 manager validation`

Do not amend prior commits.

After commit:

- record the exact commit SHA;
- inspect the committed file list;
- verify the complete intended CTM-7 package is included;
- verify no excluded scope entered the commit.

## Push

Push the new checkpoint commit to the current `main` remote branch.

Do not:

- force-push;
- rewrite history;
- create a new branch;
- make a second cleanup commit.

## Post-push verification

After push, verify:

- `main == origin/main`;
- the new checkpoint commit is the tip of both;
- working tree is clean;
- all CTM-7 reports/reviews/evidence/ratification artifacts are tracked;
- the Option B production/test/spec/plan remediation is tracked;
- handoff is tracked and points to the accepted CTM-7 closeout state;
- H5 copy Low remains open;
- stale `PROTOCOL.md` Low remains open;
- D/J/H6 inconclusive coverage remains recorded, not silently changed;
- L1–L8 remain deferred;
- CTM-8 remains unauthorized;
- no unrelated scope entered the checkpoint.

## Final status

After successful push, report only:

- checkpoint commit SHA;
- push result;
- `main == origin/main` confirmation;
- clean-tree confirmation;
- confirmation that the complete CTM-7 package was included;
- confirmation that open Lows / D-J-H6 limitations remain intentionally unremediated;
- confirmation that CTM-8 and L1–L8 were not entered;
- next gate: **none — CTM-7 checkpoint complete, awaiting owner direction**.

Do not begin CTM-8 or any other work.
