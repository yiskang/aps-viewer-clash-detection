# For Claude — Harden Durable Reporting Workflow + Backfill Current Package Report

This is a workflow-hardening task only. Do not advance product scope, G2/C6/C8, G3, or any other milestone.

The goal is to close a repository-collaboration gap:

> Substantial package completion reports must not exist only in chat.

Repository artifacts are the durable collaboration boundary between Claude, ChatGPT, Work, Codex, and future sessions.

## 1. Verify repository state first

Identify the repository currently in scope and verify:

- repository path
- branch
- HEAD
- `origin/main`
- working-tree state
- `docs/handoffs/latest.md`
- `CLAUDE.md`
- current package artifacts for the Viewer Clash Panel Test Setup / Interaction UX Cleanup
- internal review
- headed/visual evidence

Treat repository state as authoritative. Do not rely only on conversation summaries.

## 2. Update `CLAUDE.md`

Add a durable-reporting rule that applies to all substantial work packages.

Preserve existing repository instructions and structure.

Add a section such as:

`## Durable Package Completion Reports`

Require the following.

### 2.1 Mandatory package final report

For every substantial package, persist a complete final/completion report in the repository **before returning the final chat response**.

Use:

- `docs/research/<date>-<package>-final-report.md`
  for implementation, product-facing, research, validation, preparation, remediation, and closeout packages.

Use:

- `docs/reviews/<date>-<name>-review.md`
  only when the task itself is an independent/internal review or audit.

Do not use a review artifact as a substitute for a package final report when the task is primarily implementation/product/research work.

### 2.2 Required final-report contents

Include, as applicable:

- repository / branch / HEAD / origin relation / working-tree state
- authorized scope
- governing spec/plan
- files changed
- implementation/results delivered
- design/spec changes
- run/reproduction commands
- test results
- headed/live validation results
- visual evidence summary and paths
- autonomous fixes/remediations
- internal review summary
- unresolved findings
- remaining debt/limitations
- deferred work
- owner/product decisions
- protected boundaries confirmed unchanged
- commit/push state
- exact next gate / next authorized action

### 2.3 Chat must not be more authoritative than the repo

Before returning a substantive final response:

1. verify the final report exists;
2. verify substantive conclusions in chat are already represented in that report;
3. verify the handoff links to it;
4. verify relevant evidence/review artifacts are linked.

The final chat response should be a concise summary of the persisted artifact, not a second source of truth.

### 2.4 Handoff role

`docs/handoffs/latest.md` must remain concise and include:

- repo / branch / HEAD / tree state
- current milestone/package status
- governing spec/plan
- latest package final report
- latest relevant review
- latest relevant evidence/research
- blockers/deferred work
- exact next authorized action
- work that must not begin without authorization

It must link to the full final report rather than duplicating it.

### 2.5 Supporting artifacts do not replace the final report

State explicitly:

- internal reviews do not replace the package final report;
- evidence reports do not replace the package final report;
- handoffs do not replace the package final report;
- chat does not replace the package final report.

### 2.6 Missing-report behavior

If a substantial completed package has no durable final report:

- treat that as a workflow defect;
- backfill it before advancing to the next gate when practical;
- update the handoff to link it;
- do not silently rely on chat as the missing source of truth.

## 3. Backfill the currently missing package report

Create:

`docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-final-report.md`

Use repository evidence as the source of truth.

Reconstruct from:

- actual diff/current working tree
- governing spec changes
- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup-internal-review.md`
- `docs/research/2026-10-07-viewer-clash-panel-test-setup-ux-cleanup/evidence-report.md`
- actual tests/results
- headed validation artifacts

Do not copy unsupported chat claims.

The report should consolidate at least:

### Repository state
- branch / HEAD / origin
- working-tree state
- owner prompt file pre-existing untracked state if still applicable

### Package scope
- Test Setup / Interaction UX Cleanup
- no unrelated scope expansion

### New test
- placement left of Hide setup
- expanded/collapsed behavior
- neutral styling
- disabled while active run
- exact reset semantics
- confirmation behavior for unsaved results

### Soft basis
- Soft no longer simply disabled when auto verification is unavailable
- unit/basis choices
- user-supplied provenance
- raw model-unit behavior if implemented
- no unit guessing
- no unsupported conversion assumption
- exact verified-label rules

### Spec/design update
- exact governing spec section changed
- old acceptance criterion replaced/updated

### Status wording
- Idle
- readiness
- Completed
- Stopped
- removal of redundant reasons

### Headed validation
- exact launch command
- demo URL
- Hard Structure × Mechanical result
- regression flows exercised
- console result
- keyboard/focus flow
- screenshot totals
- evidence path

### Soft validation limitation
Persist the exact current limitation:

- Soft demo run returns 0 clashes
- `clearance-anisotropic-scale-unsupported`
- occurrence count if repository evidence supports it
- library/fixture limitation, not panel failure
- collision code unchanged
- screenshot 08 inconclusive if still current

### Tests
- offline totals
- DOM totals
- `git diff --check`
- todo count

### Internal review
- C/H/M/L counts
- fixed Medium fail-open default
- fixed Low findings

### Remaining debt
- cancelled-status line
- Max gap wrapping
- host-header overflow around 700px
- any other current Low debt

### Protected boundaries
Explicitly state whether unchanged:

- no unsupported unit assumptions
- no false verified result
- no G2 retry
- no new authorization record
- no attempt reset
- no acceptance-procedure change
- no G3
- no commit
- no push

### Next gate
`Independent Work visual/product review`

## 4. Update the handoff

Update `docs/handoffs/latest.md` so the current package links to:

- the new package final report
- the internal review
- the evidence report

Keep the handoff concise.

## 5. Do not modify product implementation

This task is workflow hardening + documentation backfill only.

Do not change production code, tests, collision behavior, UI, G2/C6/C8, acceptance procedure, authorization records, or G3.

Do not commit or push unless separately authorized.

## 6. Final verification

Before reporting completion, verify:

- `CLAUDE.md` contains the durable package-report rule;
- the current package final report exists;
- the handoff links to it;
- the internal review remains separate;
- the evidence report remains separate;
- the final chat summary contains no substantive conclusion absent from repo artifacts;
- `git diff --check` is clean;
- exact working-tree state is reported.

Stop after workflow hardening. Do not advance to independent Work review yourself.
