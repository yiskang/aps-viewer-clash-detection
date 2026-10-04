# For Claude — G2 Pre-Issuance Docs Checkpoint Commit + Push Only

I explicitly authorize **one docs-only checkpoint commit and push** to restore the clean-tree condition required before authorization-record issuance.

This authorization does **not** include authorization-record issuance, attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

## Baseline

Verify before staging:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`
- `main == origin/main`
- committed activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no authorization record
- no attempts directory / reservation / consumed attempt
- no Viewer/fixture/live-G2 evidence

Expected current working-tree governance artifacts:

- modified:
  - `docs/handoffs/latest.md`
- untracked:
  - `docs/reviews/2026-10-04-g2-committed-activation-identity-independent-verification.md`
  - `docs/reviews/2026-10-04-g2-authorization-record-issuance-blocked-internal-review.md`
  - the current authorization-record issuance prompt under `docs/prompts/`, if present

If the current working tree contains additional implementation/test/procedure/production changes, stop and report.

## Why this checkpoint exists

Authorization-record issuance was correctly blocked by the clean-tree gate.

The current harness clean-tree classifier tolerates untracked files under `docs/prompts/`, but the current tree also contains:

- a tracked handoff modification;
- untracked review artifacts under `docs/reviews/`.

Those prevent issuance under the accepted W1 clean-tree contract.

Do not weaken or bypass that rule.

## Authorized scope

Commit and push only the governance/doc artifacts needed to restore a clean current baseline.

Do not modify:

- harness;
- tests;
- procedure;
- production/Core/Viewer Adapter/M4/Panel/OQ-1/host code;
- governing live-plan semantics.

Do not prepare or issue an authorization record in this task.

## Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify `LIVE_PATH_WIRED=true`;
3. recompute harness SHA and confirm:
   `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`;
4. recompute procedure SHA and confirm:
   `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
5. verify no authorization record exists;
6. verify no attempts directory exists;
7. verify no Viewer/fixture/live-G2 evidence exists;
8. confirm no implementation/test/procedure files are modified.

If any identity or scope differs materially, stop instead of silently correcting it.

## Commit scope

Commit only the current reviewed governance artifacts, including as applicable:

- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-04-g2-committed-activation-identity-independent-verification.md`
- `docs/reviews/2026-10-04-g2-authorization-record-issuance-blocked-internal-review.md`
- the related authorization-record issuance prompt under `docs/prompts/`, if it is part of the current reviewed task state

Do not add unrelated files.

## Handoff

Before commit, ensure the handoff accurately states:

- committed activation remains `LIVE_PATH_WIRED=true`;
- committed harness SHA is still the reviewed activated SHA;
- procedure SHA unchanged;
- committed activation identity independently verified;
- first issuance attempt was blocked by clean-tree governance only;
- no authorization record was issued;
- no attempt reserved/consumed;
- no Viewer/fixture/live G2;
- this docs checkpoint is authorized only to restore a clean baseline;
- after push, the next action is:
  **re-authorize authorization-record preparation/issuance bound to the new HEAD**;
- live execution remains separately unauthorized.

Do not imply authorization-record issuance is authorized by this checkpoint task.

## Commit

Create exactly one docs-only checkpoint commit.

After commit:

- verify working tree clean;
- recompute harness SHA;
- recompute procedure SHA;
- verify `LIVE_PATH_WIRED=true`;
- verify no authorization record or attempt state exists.

Report the new commit hash.

## Push

Push that single docs-only checkpoint commit to `origin/main`.

After push, verify:

- `main == origin/main == <new commit>`;
- ahead/behind is `0/0`;
- working tree clean;
- harness SHA unchanged from:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`;
- procedure SHA unchanged;
- `LIVE_PATH_WIRED=true`;
- no authorization record;
- no attempts directory;
- no Viewer/fixture/live-G2 evidence.

## Prohibited

Do not:

- prepare or issue an authorization record;
- create a real authorization candidate file;
- reserve or consume an attempt;
- run the real harness with any authorization;
- launch Playwright/browser/Viewer;
- load fixtures;
- run live G2;
- modify harness/tests/procedure;
- start the next gate.

## Stop gate

Stop immediately after the docs-only checkpoint commit/push and clean-baseline verification.

The next gate is:

**separate owner re-authorization of G2 authorization-record preparation/issuance, bound to the new committed HEAD**

Live execution remains a later, separate gate.

## Final report

Report:

- new docs-checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- committed harness SHA;
- procedure SHA;
- confirmation `LIVE_PATH_WIRED=true`;
- confirmation no authorization record, attempt state, Viewer/fixture load, or live G2 occurred.
