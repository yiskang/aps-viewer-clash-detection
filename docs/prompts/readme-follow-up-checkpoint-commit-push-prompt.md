# Claude/Codex Prompt — README Follow-up Checkpoint Commit + Push

## Owner authorization

The owner explicitly authorizes **one bounded follow-up checkpoint commit and normal push** for the README refresh package.

This authorization is limited to the currently reviewed README wording cleanup and the durable README-package documentation that has already passed targeted Independent Work verification.

Do not expand scope.

## Repository

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Governing review

Read first:

- `docs/reviews/2026-10-12-readme-ratification-final-report-backfill-targeted-independent-work-review.md`
- `docs/reviews/2026-10-12-readme-thumbnail-refresh-independent-work-review.md`
- `docs/reviews/2026-10-12-readme-thumbnail-refresh-owner-ratification.md`
- `docs/research/2026-10-12-readme-thumbnail-refresh-final-report.md`
- `docs/handoffs/latest.md`
- `CLAUDE.md`

Targeted Work verdict:

- **CONDITIONAL PASS — READY FOR OWNER README FOLLOW-UP CHECKPOINT DECISION WITH NON-BLOCKING RESIDUALS**
- 0 Critical / 0 High / 0 Medium / 2 Low
- no blockers
- H1 closed
- H2 closed

The owner now authorizes the checkpoint.

## Before commit

Independently verify:

- branch is `main`;
- HEAD and `origin/main` are still at the expected pre-checkpoint state;
- `8f7bed5` and `ef790ad` remain unchanged in history;
- no unexpected commit/push occurred;
- working tree contains only the reviewed README cleanup and durable README-package docs/prompts/reviews/handoff;
- no production or test files changed;
- `git diff --check` passes.

If the tree contains unrelated or unexpected changes, **stop and report instead of committing**.

## Authorized checkpoint contents

Include the reviewed, currently uncommitted README package closure material, including as applicable:

- `README.md` final wording cleanup;
- `docs/research/2026-10-12-readme-thumbnail-refresh-final-report.md`;
- `docs/reviews/2026-10-12-readme-thumbnail-refresh-independent-work-review.md`;
- `docs/reviews/2026-10-12-readme-thumbnail-refresh-owner-ratification.md`;
- `docs/reviews/2026-10-12-readme-ratification-final-report-backfill-targeted-independent-work-review.md`;
- `docs/handoffs/latest.md`;
- README-package prompt files under `docs/prompts/` if repository convention is to track prompts and they belong exclusively to this package.

Do not add unrelated files.

## Preserve existing history

Do not:

- amend `8f7bed5`;
- amend `ef790ad`;
- reset/rebase/squash/rewrite history;
- force-push;
- revert the ratified commits;
- replace screenshots;
- modify production code;
- modify tests;
- remediate Low L1 or L2 in this checkpoint.

The existing two pushed commits must remain intact.

## Commit

Create **one** normal checkpoint commit for the follow-up README cleanup/docs closure.

Suggested commit message:

`docs(readme): finalize clash detection README refresh`

A similarly concise conventional commit message is acceptable if repository convention suggests a better wording.

## Push

Push normally to `origin/main`.

No force push.

## Post-push verification

After push, verify:

- `main == origin/main`;
- ahead/behind `0/0`;
- working tree clean;
- `git diff --check` clean;
- `8f7bed5` and `ef790ad` still exist unchanged in history;
- the new checkpoint commit contains only authorized README/docs package files;
- no production/test files were included.

Update `docs/handoffs/latest.md` **before the commit** so it records the checkpoint as authorized/pending commit in a way that remains truthful once committed, or use the repository's established convention for avoiding a self-referential SHA.

Do not create an additional post-push commit merely to insert the new commit SHA into the handoff unless repository convention explicitly requires it.

## Final response

Report only:

- new checkpoint commit SHA and message;
- push result;
- `main == origin/main` status;
- working-tree status;
- confirmation that `8f7bed5` and `ef790ad` remain intact;
- confirmation that only authorized README/docs files were included;
- remaining deferred Lows:
  - L1 hard-clash thumbnail visual weakness;
  - L2 `Simple Viewer` screenshot chrome.

Then stop.
