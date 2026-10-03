# For Claude — G2 Activation Checkpoint Commit + Push Only

I explicitly authorize **one activation checkpoint commit and push only** for the independently accepted real two-file flag flip.

This authorization does **not** include authorization-record preparation/issuance or live G2 execution.

## Baseline

Verify before staging:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD: `99029ff7be4ce4e2b502918a5ed975f73879f93e`
- `main == origin/main`
- working tree contains only:
  - the independently reviewed two-file activation diff;
  - the docs-only plan-anchor restoration;
  - the new independent/internal review artifacts;
  - the updated handoff;
  - related prompt artifact if present
- activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=true`
- no authorization record
- no attempts directory / attempt state
- no Viewer/fixture/live-G2 evidence

If this baseline differs materially, stop and report.

## Independently accepted state

The latest Work review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 0
- activation checkpoint: ready to commit/push

Verified:
- focused G2 `903/903`
- offline aggregate `5,149 total / 5,148 pass / 0 fail / 1 TODO`
- Node `v22.23.1`
- Playwright/core `1.62.1`
- Chromium headless-shell `151.0.7922.34`
- missing authorization still stops at W1 before runtime gates/reservation/import/live work

## Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify the implementation/test diff is still exactly the two authorized activation files;
3. verify the plan-anchor restoration is documentation-only;
4. verify no additional harness/test/procedure/production edits exist;
5. verify real `LIVE_PATH_WIRED=true`;
6. recompute harness SHA and confirm it is still:
   `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
7. verify procedure SHA remains unchanged;
8. verify no authorization record / attempts directory / live evidence exists.

If any substantive difference is found, stop instead of silently fixing it.

## Commit scope

Commit only the independently reviewed activation checkpoint change set, including as applicable:

- `test/acceptance/clashpanel-viewerbridge.acceptance.mjs`
- `test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`
- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-03-g2-real-two-file-flag-flip-internal-review.md`
- `docs/reviews/2026-10-03-g2-real-two-file-flag-flip-independent-review.md`
- `docs/handoffs/latest.md`
- directly related authorizing prompt artifact already present in the reviewed working tree

Do not add unrelated files.

## Handoff

Before committing, ensure `docs/handoffs/latest.md` accurately records:

- real `LIVE_PATH_WIRED=true`;
- exact two-file activation diff independently accepted;
- activated harness SHA;
- procedure SHA unchanged;
- activation checkpoint commit/push authorized;
- no authorization record exists;
- no attempt reserved/consumed;
- no Viewer/fixture/live G2;
- authorization-record preparation remains separately unauthorized;
- exactly-one live G2 execution remains separately unauthorized;
- next action after push:
  **independent verification of committed HEAD + recomputed harness SHA, then owner decision on authorization-record gate**.

Do not imply record issuance or live execution is authorized.

## Commit

Create exactly one activation checkpoint commit.

After commit, verify:

- working tree clean;
- real `LIVE_PATH_WIRED=true`;
- procedure SHA unchanged;
- no authorization/attempt/live state exists.

Recompute harness SHA from the committed state.

If the committed SHA differs from the reviewed SHA unexpectedly, stop and report before pushing.

Report the new commit hash.

## Push

Push that single activation checkpoint commit to `origin/main`.

After push, verify:

- `main == origin/main == <new activation checkpoint commit>`;
- ahead/behind is `0/0`;
- working tree clean;
- real `LIVE_PATH_WIRED=true`;
- committed harness SHA;
- procedure SHA;
- no authorization record;
- no attempts directory;
- no Viewer/fixture/live-G2 evidence.

## Prohibited

Do not:

- prepare or issue an authorization record;
- create authorization-shaped files in the real record location;
- reserve or consume an attempt;
- launch Viewer;
- load fixtures;
- run live G2;
- alter procedure semantics;
- broaden implementation scope;
- start the next gate.

## Stop gate

Stop immediately after the activation checkpoint has been committed, pushed, and verified clean/current.

The next gate is:

**independent verification of committed activation identity → separate owner authorization of authorization-record preparation/issuance**

Live execution remains a later, separate gate.

## Final report

Report:

- new activation-checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- committed activated harness SHA;
- procedure SHA;
- confirmation that real `LIVE_PATH_WIRED=true`;
- confirmation that no authorization record, attempt state, Viewer/fixture load, or live G2 occurred.
