# For Claude — Clash Tests Manager UI Layout Checkpoint Commit + Push Only

Repository:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

## Owner authorization

The owner explicitly authorizes **one scoped checkpoint commit + push only** for the completed and independently accepted:

**Clash Tests Manager — Manager UI Layout / Responsive Polish — Addendum A**

This authorization is limited to checkpointing the already-reviewed package. It does **not** authorize remediation, additional validation, new implementation, or any new milestone/workstream.

## Before making the checkpoint

Independently verify:

- repository path and branch;
- current `HEAD`;
- `origin/main`;
- full working-tree state;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- latest governing design §26.14;
- Plan Addendum A;
- implementation final report;
- implementation Independent Work Review;
- headed-validation final report;
- headed visual/product Independent Work Review;
- evidence directory and manifest.

Repository state is authoritative. Do not rely on conversational summaries.

The latest accepted authorities are:

- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-implementation-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-headed-validation-independent-work-review.md`

Both accepted the package with no blockers.

## Scope authorized for this checkpoint

Include the complete current UI-layout package and only directly related package artifacts:

### Production
- `clashpanel/ui/render/manager.js`

### Directly affected tests
- the existing DOM test files changed for the new list/item structure;
- `managerLayout.dom.mjs`;
- the static guard test added for this package;
- any other test file that is already part of this accepted Addendum A diff and explicitly documented in the implementation final report.

### Governing docs
- Viewer Clash Panel spec changes for §26.14;
- Clash Tests Manager implementation plan Addendum A;
- any directly affected current-status cross-references already changed as part of this accepted package.

### Upstream package reports
- `docs/research/2026-10-11-clash-tests-manager-ui-layout-implementation-final-report.md`
- `docs/research/2026-10-11-clash-tests-manager-ui-layout-headed-validation-final-report.md`

### Independent Work Reviews
- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-implementation-independent-work-review.md`
- `docs/reviews/2026-10-11-clash-tests-manager-ui-layout-headed-validation-independent-work-review.md`

### Headed evidence
- `docs/research/evidence/2026-10-11-manager-layout-headed/`
- include all retained screenshots;
- include `README.md`;
- include `MANIFEST.sha256`;
- verify the manifest before commit.

### Handoff
- `docs/handoffs/latest.md`

### Package prompt / authorization artifacts
Include the prompt/authorization files that belong to this UI-layout package and are already present in the working tree, including the design/plan, implementation, headed-validation, and review prompts where they are intentionally tracked by this repository.

Do not invent or add unrelated prompt files.

## Explicitly excluded from this checkpoint

Do **not** modify or remediate any of the following:

- headed-evidence Low concerning the `ML-02b` caption (“Whole list visible” wording);
- the prior documentation-bookkeeping Low concerning stale design/authorization status wording or task-brief count;
- deferred L1–L8;
- CTM-7;
- CTM-8;
- persistence/history/background-run work;
- resize feature work;
- separate-panel architecture;
- Core;
- Viewer Adapter;
- collision;
- G2 / C6 / C8 / G3;
- R20-1;
- any other package, milestone, cleanup, refactor, or opportunistic fix.

The two documentation Lows are deliberately **not** part of this checkpoint authorization.

## Pre-commit verification

Before staging:

1. Confirm the production diff remains limited to the already accepted `clashpanel/ui/render/manager.js`.
2. Confirm protected paths still have zero unintended diff.
3. Run `git diff --check`.
4. Verify the headed evidence manifest.
5. Verify the latest handoff links the implementation Independent Work Review and headed-validation Independent Work Review.
6. Verify no unreviewed production/test/doc change has appeared since the final Independent Work visual/product review.
7. Verify no CTM-7 / CTM-8 / L1–L8 work entered the tree.
8. Verify no excluded Low has been silently remediated.

If any unexpected or unreviewed change is present, **stop** and report it. Do not repair it under this authorization.

## Commit

Create exactly one scoped checkpoint commit containing the accepted UI-layout package.

Use a clear commit message such as:

`feat(clashpanel): checkpoint manager UI layout polish`

Do not amend prior commits.

After creating the commit:

- record the exact commit SHA;
- inspect the committed file list;
- confirm the intended package artifacts are included;
- confirm no excluded scope was committed.

## Push

Push the new checkpoint commit to the current `main` remote branch.

Do not create another branch.

Do not force-push.

Do not rewrite history.

## Post-push verification

After push, verify:

- `main == origin/main`;
- the new checkpoint commit is the tip of both;
- working tree is clean;
- the evidence directory and manifest are tracked;
- the two latest Independent Work Review reports are tracked;
- the implementation and headed-validation final reports are tracked;
- `docs/handoffs/latest.md` is tracked and points to the accepted latest review state;
- no excluded Low, CTM-7/8, L1–L8, or unrelated scope entered the checkpoint.

Do not run new implementation or headed-validation work after the push.

## Final response

Report only:

- checkpoint commit SHA;
- push result;
- `main == origin/main` confirmation;
- clean-tree confirmation;
- confirmation that the scoped UI-layout package and evidence/reviews were included;
- confirmation that the excluded Lows, L1–L8 and CTM-7/8 were not changed;
- next gate: **none — checkpoint complete, awaiting owner direction**.

Do not begin any further work.
