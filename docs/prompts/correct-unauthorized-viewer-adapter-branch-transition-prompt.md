# Prompt — Correct Unauthorized Viewer Adapter Branch Transition

This is a repository-governance correction task.

Do **not** start Viewer Adapter planning.
Do **not** implement Viewer Adapter code.
Do **not** push anything.
Do **not** alter the valid Core Engine merge history.

## Context

The following repository state has been verified:

- `main` contains a valid `--no-ff` merge commit:
  - `8b5245e5eecce3153f161e83fb831ab3643e64cc`
- Its parents are:
  - `438a832987986ccc5b51f789781948981d227cdb`
  - `c96e3477ee9757a3afd8fb1bb3503770dd7f84c9`
- This merge correctly integrates:
  - Federated Clash Test Core Engine P0–P8
  - OQ-4 live evidence PASS
- A new branch was then created:
  - `feature/federated-clash-test-viewer-adapter`
- A handoff-only commit was added there:
  - `2054a97`
- The handoff correctly says Viewer Adapter is only a **candidate next milestone awaiting owner authorization**.
- However, the Viewer Adapter branch itself was created **before explicit milestone-owner authorization**.

Under the repository's transition-governance rules:

> recommended next action ≠ authorized next action

Creating a feature branch named for a new milestone before owner authorization is considered an early transition and should be corrected.

## Goal

Return the repository to a governance-correct state while preserving:

1. the valid Core Engine merge on `main`;
2. the useful handoff content from `2054a97`;
3. all current project-history evidence;
4. a clear statement that Viewer Adapter is only a candidate next milestone and is **not yet authorized**.

Do not lose information.

## Step 1 — Verify before modifying

Independently verify:

- current branch
- `main` HEAD
- `feature/federated-clash-test-viewer-adapter` HEAD
- `2054a97` contents
- working-tree state
- whether anything has been pushed
- whether any Viewer Adapter plan/spec/code exists beyond the branch name and handoff text

Confirm that:

- `8b5245e` is a two-parent merge commit;
- the Core Engine merge is valid and must remain untouched;
- the Viewer Adapter branch contains no authorized milestone work beyond the handoff update.

If any of those assumptions are false, stop and report instead of proceeding.

## Step 2 — Preserve the handoff content safely

Preserve the useful `docs/handoffs/latest.md` changes from `2054a97`, but do **not** preserve the unauthorized milestone branch as the operational state.

The resulting handoff must describe the repository truth without implying authorization.

Use wording equivalent to:

- Core Engine milestone: completed and merged into `main`
- latest completed merge: `8b5245e`
- Viewer Adapter: candidate next milestone only
- Viewer Adapter planning: **awaiting explicit milestone-owner authorization**
- work that must not begin:
  - Viewer Adapter design/planning
  - Viewer Adapter implementation
  - any next-milestone branch/work unless explicitly authorized

Do not write Viewer Adapter as the active milestone.

## Step 3 — Restore a neutral authorized branch state

Preferred final state:

- `main` remains at `8b5245e`
- no unauthorized Viewer Adapter feature branch remains
- handoff update is preserved on an appropriate neutral/authorized branch state

Use the smallest safe approach.

Acceptable options:

### Preferred

Move the handoff update onto `main` as a documentation-only commit, **only because this task explicitly authorizes that governance correction**.

### Alternative

Use a neutral admin/handoff branch if repository convention strongly prefers not to add the handoff commit directly to `main`.

Do **not** create another milestone-named feature branch.

## Step 4 — Remove the unauthorized branch safely

Only after the handoff content is safely preserved elsewhere:

- delete the local branch:
  - `feature/federated-clash-test-viewer-adapter`

Do not delete the valid Core Engine feature branch unless separately authorized.

Do not rewrite or squash the Core Engine merge.

Do not force-reset `main`.

## Step 5 — Verify final state

After correction, verify:

- `main` still contains merge commit `8b5245e`
- merge parents are unchanged
- Core Engine content is unchanged
- handoff content is preserved
- Viewer Adapter is recorded only as a candidate awaiting authorization
- no Viewer Adapter implementation/spec/plan work was started
- unauthorized Viewer Adapter branch no longer exists locally
- nothing was pushed
- working tree is clean

Run:

- `git log --graph --oneline --decorate --all -20`
- `git rev-list --parents -n 1 8b5245e`
- `git status --short`
- branch listing sufficient to prove the unauthorized branch is gone

No test suite rerun is required unless file content beyond `docs/handoffs/latest.md` changes.

## Governance note to preserve

Update the handoff so future agents can distinguish:

- **recommended next milestone**
- **authorized next action**

The handoff must not allow a future agent to infer that Viewer Adapter planning is authorized merely because it is the roadmap's likely next milestone.

## Final response

Report only:

- final current branch
- final HEAD
- whether `main` still points at `8b5245e` or at a documentation-only handoff commit on top of it
- where the handoff content from `2054a97` was preserved
- whether `feature/federated-clash-test-viewer-adapter` was deleted
- whether anything was pushed
- final `git status`
- explicit confirmation:
  - Viewer Adapter planning is **not authorized**
  - no Viewer Adapter work was started

Do not start the next milestone.
