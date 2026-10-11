# Checkpoint Commit + Push Prompt — Pre-CTM-8 Addendum B

## Owner authorization

The owner authorizes the **Addendum B checkpoint commit and push** for the reviewed pre-CTM-8 group-header aggregate presentation package in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This authorization is limited to checkpointing the already reviewed package.

**CTM-8 remains unauthorized and must not begin.**

Do not start any new remediation, cleanup package, milestone, L1–L8 work, visual-polish work, navScope work, O-1…O-4 work, or unrelated change.

## Governing review

Use the authoritative implementation review:

`docs/reviews/2026-10-11-clash-group-header-aggregate-presentation-implementation-independent-work-review.md`

Its accepted disposition is:

- Conditional Pass — ready for owner checkpoint decision
- 0 Critical / 0 High / 0 Medium / 2 Low
- no blockers
- commit/push is the exact next gate

The two accepted non-blocking Low findings remain open:

- L1: ~4 ms provisional `"No clashes match"` visual flash during cold-label refresh
- L2: upstream final-report prose diff counts do not match repository counts

Do **not** remediate either Low as part of this checkpoint unless a change is strictly required to make the already-reviewed checkpoint mechanically valid. If that occurs, stop and report instead of silently changing the reviewed package.

## Before committing

Independently verify:

- repository is `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- branch is `main`
- HEAD is still `9e49f4036137bafd098ceb8631bcd16fff6c4da6`
- `origin/main` is still at the same commit
- working tree contains only the reviewed Addendum B implementation/tests/docs/evidence/reviews/handoff package
- CTM-7 remains closed
- CTM-8 has not started
- no unrelated or newly generated files have appeared since the Independent Work Review

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-11-clash-group-header-aggregate-presentation-implementation-independent-work-review.md`
- `docs/research/2026-10-11-clash-group-header-aggregate-presentation-final-report.md`

If repository state differs materially from the reviewed state, **stop before commit** and report the discrepancy.

## Verification before checkpoint

Re-run only the verification needed to ensure the reviewed tree has not changed unexpectedly.

At minimum verify:

- `git diff --check`
- changed-file / protected-path inspection
- no Core / collision / Viewer Adapter / host / `markers.js` / `fit.js` / `isolation.js` / CTM-8 / L1–L8 changes outside the already reviewed package

Do not perform new implementation work.

If the repository workflow requires a final test re-run immediately before checkpoint, run the canonical required tests and record exact totals. Otherwise preserve the already independently reviewed verification:

- offline: 5695 total / 5694 pass / 0 fail / 1 todo
- DOM: 147/147
- focused controller/bridge: 74/74
- headed evidence: 10 PASS / 0 FAIL / 0 INCONCLUSIVE

## Handoff closeout

Before commit, update `docs/handoffs/latest.md` only if necessary to record the checkpoint authorization/closeout state.

Keep it concise and preserve the existing authoritative review links.

It should state, as applicable:

- repo / branch / HEAD / tree state before checkpoint
- CTM-7 closed
- Addendum B reviewed and accepted for checkpoint
- latest Independent Work Review path
- 2 Low non-blocking findings remain open/deferred
- CTM-8 not started
- next gate after successful push: owner direction; no automatic CTM-8 entry

Do not turn the handoff into a second full review report.

## Commit

Create one checkpoint commit containing the complete reviewed Addendum B package.

Use a clear commit message such as:

`feat(clash-panel): add aggregate group presentation`

Do not amend or rewrite prior history.
Do not squash unrelated historical commits.
Do not force-push.

After committing, verify:

- commit contains only the intended reviewed package
- working tree is clean
- commit SHA is recorded
- `git diff HEAD^..HEAD --check` is clean
- branch remains `main`

## Push

Push the checkpoint commit normally to:

`origin/main`

No force-push.

After push, verify:

- local `main` == `origin/main`
- working tree is clean
- pushed commit SHA matches the local checkpoint commit
- CTM-8 has not started

## Final response

Report only:

- checkpoint commit SHA
- push result
- `main == origin/main` status
- working-tree clean/dirty status
- whether blockers remain
- the two Low findings still open
- CTM-8 status
- exact next gate

Do not begin any follow-up work.

## Stop condition

After successful checkpoint commit and push:

**STOP.**

Do not enter CTM-8.
Do not remediate L1/L2.
Do not begin another package.
Wait for owner direction.
