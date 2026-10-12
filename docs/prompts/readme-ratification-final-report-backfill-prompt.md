# Claude/Codex Prompt — README Commit Ratification + Final Report Backfill

## Owner authorization

The owner **ratifies** the already-pushed README commits:

- `8f7bed5` — `docs(readme): reposition as clash detection sample with feature thumbnails`
- `ef790ad` — `docs(readme): lay out context-menu and Find thumbnails as 2x2`

This ratification is intentional and retrospective.

Do **not** amend, revert, reset, squash, rewrite, or force-push those commits.

The repository history must preserve that these commits were pushed before the required Independent Work review; the ratification closes the authorization deviation without rewriting history.

## Scope

Perform a **bounded docs-only ratification/backfill package** for the README/thumbnail refresh in:

`/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`

This package is limited to:

1. recording owner ratification of `8f7bed5` and `ef790ad`;
2. creating the missing upstream README package final report;
3. updating the handoff to reflect the real pushed state and next gate.

Do not modify production code.
Do not modify tests.
Do not replace thumbnails in this package.
Do not remediate the two Low visual observations.
Do not commit or push yet.

## Governing review

Read and use as the authoritative downstream review:

`docs/reviews/2026-10-12-readme-thumbnail-refresh-independent-work-review.md`

Its current disposition is:

- **OWNER DECISION REQUIRED**
- 0 Critical / 2 High / 0 Medium / 2 Low
- H1: review/owner checkpoint gate was bypassed because commits were already pushed
- H2: required upstream final report is missing
- Low L1: hard-clash thumbnail is visually weak
- Low L2: screenshots still show `Simple Viewer` in app chrome

The owner now resolves H1 by ratifying the pushed commits.

H2 still requires the responsible README package to backfill the missing final report.

## Before editing

Independently verify:

- repository path;
- branch;
- HEAD;
- `origin/main`;
- ahead/behind;
- working tree;
- commits `8f7bed5` and `ef790ad` are present in `main` / `origin/main`;
- current `README.md`;
- six README images under `docs/images/`;
- current uncommitted README wording cleanup;
- `CLAUDE.md`;
- `docs/handoffs/latest.md`.

If the repo no longer contains the ratified commits or the state materially differs from the review, stop and report.

## Ratification record

Persist the owner ratification durably.

Preferred artifact:

`docs/reviews/2026-10-12-readme-thumbnail-refresh-owner-ratification.md`

or the repository's established ratification location if a better convention already exists.

The record should state:

- owner ratifies `8f7bed5` and `ef790ad`;
- the commits were already pushed before required Independent Work review;
- history is intentionally preserved;
- no amend/revert/force-push is authorized;
- ratification addresses the workflow deviation only;
- technical/content acceptance still relies on the Independent Work review;
- the missing upstream final report must still be backfilled and independently verified before any follow-up README checkpoint.

Do not phrase Work/Claude recommendation as owner authorization; this artifact records the owner's explicit decision from this prompt.

## Required upstream final report

Create:

`docs/research/2026-10-12-readme-thumbnail-refresh-final-report.md`

This is the missing upstream package completion report required by repo governance.

It must accurately record the package as it actually happened.

### Required contents

#### Repository state

Record:

- repo
- branch
- HEAD / origin
- tree state
- already-pushed README commits:
  - `8f7bed5`
  - `ef790ad`

#### Package objective

State that the README was updated from stale generic Simple Viewer positioning to the current APS Viewer Clash Detection sample identity.

#### Actual README scope

Record the public-facing feature coverage:

- Clash Tests / Clash Tests Manager
- Clash Detection / Results
- Context Menu Utilities
  - Locate Room
  - Find Clashes
  - Find Soft Clashes

Record that the historical Simple Viewer reference is retained only as provenance.

#### Thumbnail assets

Enumerate all six README image assets:

- `docs/images/clash-tests-manager.png`
- `docs/images/clash-detection-results.png`
- `docs/images/context-menu.png`
- `docs/images/find-room.png`
- `docs/images/find-clashes-hard.png`
- `docs/images/find-clashes-soft.png`

Describe their roles concisely.

#### README layout

Record:

- Clash Tests / Clash Detection Results in a 2-column row
- Context Menu / Find Room in a 2-column row
- Find Clashes / Find Soft Clashes in a 2-column row

#### Verification performed

Record only what actually happened.

At minimum:

- `git diff --check` status
- image paths verified
- local README links/paths verified if actually checked
- no production/test changes
- screenshot source/capture approach where relevant

Do not invent a Markdown-renderer verification if it was not performed.

#### Deviations / workflow history

Record explicitly:

- `8f7bed5` and `ef790ad` were committed/pushed before the required Independent Work review;
- owner later ratified them;
- no history rewrite is being performed;
- upstream final report was missing initially and is now being backfilled.

#### Current uncommitted README cleanup

Accurately record the currently uncommitted wording cleanup, including:

- group Markers wording correction;
- `Context Menu Utilities` section rename;
- hard/soft terminology normalization;
- any other current README-only wording change actually present.

Do not falsely claim these changes are already committed/pushed.

#### Independent Work review disposition

Reference:

`docs/reviews/2026-10-12-readme-thumbnail-refresh-independent-work-review.md`

Record:

- content technically acceptable;
- 5 PASS / 0 FAIL / 1 INCONCLUSIVE visual total;
- H1 ratified by owner;
- H2 addressed by this final-report backfill;
- Low L1 hard-clash thumbnail remains non-blocking;
- Low L2 Simple Viewer chrome remains non-blocking.

#### Protected boundaries

Confirm:

- no production code changed;
- no tests changed;
- no CTM-7/CTM-8 state changed;
- no prior evidence/reviews rewritten;
- no image replacement/remediation performed in this package.

#### Exact next gate

State:

**Targeted Independent Work verification of the ratification + upstream final-report backfill package.**

Do not authorize commit/push of the current README cleanup from inside the final report.

## Handoff update

Update:

`docs/handoffs/latest.md`

Keep it concise.

Record:

- README refresh commits `8f7bed5` and `ef790ad` are already pushed;
- owner ratified both commits;
- no history rewrite is planned;
- README Independent Work Review path;
- owner ratification artifact path;
- README final report path;
- current README wording cleanup remains uncommitted if still true;
- the two visual Lows remain deferred/non-blocking;
- exact next gate: targeted Independent Work verification of ratification + final-report backfill;
- follow-up commit/push remains unauthorized until that verification and owner decision.

Do not rewrite unrelated historical handoff entries.

## Verification

Before stopping:

- `git diff --check`
- verify the two ratified commits remain in history unchanged
- verify no production/test file changed
- verify the new ratification artifact exists
- verify the new final report exists
- verify the handoff links both
- verify the final report distinguishes:
  - already-pushed README commits
  - current uncommitted README wording cleanup
- verify no Low visual remediation was performed

## Stop condition

After the ratification artifact, final-report backfill, and handoff update are complete:

**STOP.**

Do not commit.
Do not push.
Do not replace screenshots.
Do not modify production/tests.
Do not reopen CTM work.

The next gate is:

**targeted Independent Work verification of the README ratification + final-report backfill package**.
