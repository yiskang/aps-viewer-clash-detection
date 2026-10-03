# For Claude — G2 Real Two-File Flag Flip Only

I explicitly authorize **one bounded real activation change only**: apply the independently verified two-file `LIVE_PATH_WIRED` activation diff.

This authorization does **not** include authorization-record preparation/issuance, attempt reservation/consumption, Viewer/fixture load, or live G2 execution.

## Baseline

Verify before editing:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `99029ff7be4ce4e2b502918a5ed975f73879f93e`
- `main == origin/main`
- working tree clean
- committed harness SHA:
  `d34d470cf51f5f74c5cf3cfa8380944822af2ce6c2e07d27f4117ea71fd19c39`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=false`
- no authorization record
- no attempt/reservation state
- no Viewer/fixture/live-G2 evidence

Read:

- `docs/handoffs/latest.md`
- `docs/research/2026-10-02-g2-live-execution-plan.md`
- latest independent live-flag activation-preparation reviews
- current harness and live-path-isolation test

If baseline differs materially, stop and report.

## Runtime prerequisite

Before running any verification for this task:

- select Node exactly:
  `nvm use 22.23.1`
- verify:
  `node -v`

Required value:

`v22.23.1`

Do not proceed with verification under another Node version.

Do not install a new runtime in this task if `22.23.1` is unavailable; stop and report.

## Authorized source changes — exactly two files

Make only these two real-repository changes.

### 1. Harness activation literal

File:

`test/acceptance/clashpanel-viewerbridge.acceptance.mjs`

Change only:

`LIVE_PATH_WIRED=false`

to:

`LIVE_PATH_WIRED=true`

Do not alter surrounding activation, authorization, runtime-gate, reservation, attempt, verdict, cleanup, evidence, or execution logic.

### 2. Deliberate real-state pin

File:

`test/acceptance/clashpanel-viewerbridge.acceptance.live-path-isolation.test.mjs`

Update only the single deliberate real-state pin to match the activated harness:

- test title/description as needed;
- expected literal/state from `false` to `true`;
- both associated assertions identified by the accepted governing plan.

Do not modify other live-path-isolation scenarios.

## No third implementation/test edit

The accepted plan and independent scratch simulation concluded that the real activation diff is exactly these two edits.

If any third implementation/test file appears necessary:

- stop;
- do not broaden scope;
- report the failing check and the additional required change.

Do not normalize unexpected failures by editing more files.

## Authorization boundary must remain closed

Even after `LIVE_PATH_WIRED=true`, this task must leave:

- no real authorization record;
- no attempt/reservation state;
- no Viewer launch;
- no fixture load;
- no live G2 execution.

Verify that a missing authorization record still prevents the live execution path.

Do not create authorization-shaped files in the production repo location.

## Verification

After the two edits, run non-live/offline verification only.

At minimum:

- focused G2 suite;
- runtime-gates suite;
- live-path-isolation suite;
- activation tests;
- authorization tests;
- preflight tests;
- journal tests;
- CLI tests;
- gate tests;
- offline aggregate suite;
- `git diff --check`.

Use the exact Node `v22.23.1` environment.

Report exact pass/fail/TODO counts.

Confirm:

- no test creates a real authorization record;
- no test creates real attempt state;
- no test launches APS Viewer;
- no fixture is loaded;
- no live G2 runs;
- CLI tests remain isolated to temp-root copies;
- the two-file diff is the only source/test diff.

## Hashes

After the final activated working-tree state:

- recompute harness SHA;
- confirm accepted procedure SHA is unchanged;
- record the new **uncommitted activated harness SHA**.

Do not bind it to any authorization record.

It must be independently reviewed and later recomputed after any correction/commit.

## Focused internal review

Perform one focused internal review over the real two-file activation diff.

Review:

- exact diff scope;
- activation interlock state;
- missing-authorization refusal;
- runtime-gate ordering;
- reservation/attempt boundary;
- test isolation;
- accidental live-entry risk;
- whether any procedure or plan assumption is violated.

Classify:

- Critical
- High
- Medium
- Low

Fix only genuine Critical/High issues if and only if the fix remains within the exact two-file authorized scope.

If a fix requires any third implementation/test file, stop and report instead.

Persist the internal review under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## Handoff requirements

The handoff should state:

- baseline commit `99029ff...`;
- real `LIVE_PATH_WIRED=true` in the uncommitted working tree;
- exact two-file activation diff applied;
- verification results;
- new uncommitted activated harness SHA;
- procedure SHA unchanged;
- no authorization record;
- no attempt reserved/consumed;
- no Viewer/fixture load;
- no live G2;
- authorization-record preparation remains unauthorized;
- live G2 execution remains unauthorized;
- next action:
  **independent Work review of the real two-file flag flip**.

## Commit policy

Do **not** commit or push.

Leave the activated two-file diff, review, and handoff changes uncommitted for independent Work review.

## Stop gate

Stop after:

- exact two-file real flag flip;
- offline verification;
- hash recomputation;
- focused internal review;
- handoff update.

Do not:

- prepare or issue an authorization record;
- reserve or consume an attempt;
- launch Viewer;
- load fixtures;
- run live G2;
- modify procedure;
- broaden implementation scope;
- commit;
- push.

The next gate is:

**Independent Work review of the real two-file flag flip → owner decision on activation checkpoint commit/push → separate authorization-record gate**

## Final report

Report:

- branch / HEAD / origin relation;
- Node version used;
- exact two-file diff;
- verification results;
- whether any third edit was required;
- new uncommitted activated harness SHA;
- procedure SHA;
- internal review findings/fixes;
- working-tree state.

Explicitly confirm:

- `G2_DUAL_COUNTER_GATE.resolved=true`
- real `LIVE_PATH_WIRED=true`
- no authorization record created
- no attempt reserved/consumed
- no Viewer/fixture load
- no live G2
- procedure unchanged
- no commit
- no push
