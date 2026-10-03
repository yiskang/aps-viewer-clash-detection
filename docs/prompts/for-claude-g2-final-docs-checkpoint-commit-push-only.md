# For Claude — G2 Final Docs Checkpoint Commit + Push Only

I explicitly authorize **one docs-only checkpoint commit and push** for the independently accepted final G2 live-plan drift correction.

This authorization does **not** include the real flag flip.

## Baseline

Verify before staging:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `7ae4147b726e20b8183f0522ffabf61ab75895d6`
- `main == origin/main`
- working tree contains only the independently reviewed documentation/review/handoff/prompt changes
- committed harness SHA:
  `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt/reservation state
- no Viewer/fixture/live-G2 evidence

If this baseline differs materially, stop and report.

## Independently accepted state

The latest targeted Work re-review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

It accepted:

- §9 completed/pending grouping;
- coupled stale-text corrections;
- G-15 correction;
- current/historical baseline wording;
- §10 historical labeling;
- exact future two-edit activation diff;
- preserved technical dispositions;
- docs-only checkpoint commit/push readiness.

## Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify no harness/test/procedure/production files changed;
3. verify real `LIVE_PATH_WIRED=false`;
4. verify harness SHA and procedure SHA still match the values above;
5. verify no authorization/attempt/live state exists.

Do not make additional plan edits unless required to restore the exact independently reviewed state. If any substantive difference is found, stop instead of silently fixing it.

## Commit scope

Commit only the independently reviewed docs-only change set, including as applicable:

- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/handoffs/latest.md`
- the live-flag activation-preparation internal/independent review artifacts currently uncommitted
- the final drift-correction internal/independent review artifacts
- directly related authorizing prompt files already present in this reviewed docs-only working tree

Do not add unrelated files.

## Handoff

Before commit, confirm the current handoff states:

- final governing-plan drift correction independently accepted;
- future real activation diff remains exactly two edits;
- docs checkpoint commit/push is authorized;
- real flag activation remains separately unauthorized;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- real `LIVE_PATH_WIRED=false`;
- no authorization record;
- no attempt reserved/consumed;
- no Viewer/fixture/live G2;
- current activation baseline will become the new docs checkpoint after push.

Do not imply that the real flag flip is already authorized.

## Commit

Create exactly one docs-only checkpoint commit.

After commit, verify:

- working tree clean;
- harness SHA unchanged;
- procedure SHA unchanged;
- `LIVE_PATH_WIRED=false`.

Report the new commit hash.

## Push

Push that single docs-only checkpoint commit to `origin/main`.

After push, verify:

- `main == origin/main == <new commit>`;
- ahead/behind is `0/0`;
- working tree clean;
- harness SHA unchanged;
- procedure SHA unchanged;
- `LIVE_PATH_WIRED=false`;
- no authorization record or attempt state exists.

## Prohibited

Do not:

- flip `LIVE_PATH_WIRED`;
- modify harness/tests/procedure/production code;
- run a new scratch flip simulation;
- prepare or issue an authorization record;
- reserve or consume an attempt;
- launch Viewer;
- load fixtures;
- run live G2;
- begin the real activation task.

## Stop gate

Stop immediately after the docs-only checkpoint has been committed, pushed, and verified clean/current.

The next gate is:

**separate owner authorization of the exact real two-file flag flip**

## Final report

Report:

- new docs-checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- harness SHA;
- procedure SHA;
- confirmation that real `LIVE_PATH_WIRED=false`;
- confirmation that no authorization record, attempt state, Viewer/fixture load, or live G2 occurred.
