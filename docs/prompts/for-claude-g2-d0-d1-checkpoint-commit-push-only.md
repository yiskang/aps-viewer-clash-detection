# For Claude — G2 D0/D1 Checkpoint Commit + Push Only

I explicitly authorize **one bounded D0/D1 research checkpoint commit and push only** for the independently accepted research/replay package.

This authorization does **not** include D2 implementation, T4/C6/N2 changes, live diagnostic/retry, new authorization-record issuance, attempt reset, or downstream work.

Use the repository as the source of truth.

## 1. Verify baseline before staging

Verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `ef436d4a5632692fadbddc09fb9aa6410fadc258`
- `main == origin/main`
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence snapshot unchanged:
  `docs/research/evidence/g2-live-20261004-75a3ccb9/`
- historical G2 remains:
  `FAIL (row 3)`
- C6 remains:
  `NOT_EVIDENCED`
- C8 remains unresolved
- T4 remains unchanged
- no live retry
- no new authorization record
- no attempt reset
- no harness/test/product/procedure implementation changes
- `git diff --check` clean

If any material baseline differs, stop and report.

## 2. Independently accepted state

The latest targeted Work re-review found:

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

Accepted:

- §10 historical-claim correction
- removed overclaims
- fact/inference matrix
- cwd guidance
- working-tree terminology
- harness-revision reconciliation
- D2 completion-event wording
- `restoreState` branch modeling
- replay portability/reproducibility
- rejection of the internal "no implementable D2 contract" Critical
- four-gate deferral of the circular-gate issue

Replay from `/tmp` was byte-identical, with SHA beginning:

`9d39b4d...`

All preserved evidence remained unchanged.

## 3. Commit scope

Commit only the independently reviewed D0/D1 research/checkpoint artifacts.

Expected scope includes, as applicable:

### Research / replay
- `docs/research/2026-10-04-g2-d0-viewer-api-evidence-d1-r1-replay.md`
- `docs/research/2026-10-04-g2-d1-replay-scripts/`
- retained replay output/artifacts that are part of the reviewed research package

### Reviews / handoff
- D0/D1 internal review
- D0/D1 correction internal review
- prior D0/D1 independent review
- targeted corrected D0/D1 re-review
- final wording-correction internal review
- final targeted independent re-review
- `docs/handoffs/latest.md`

### Prompts
- directly related D0/D1 planning/correction/review prompts already present in the reviewed working tree

Do not stage unrelated files.

If any harness/test/product/procedure file appears in the staged diff, stop.

## 4. Preserve immutable evidence

Do not modify or stage any changes to:

`docs/research/evidence/g2-live-20261004-75a3ccb9/`

Confirm the evidence directory has no diff before commit.

## 5. Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify only docs/research/reviews/handoff/replay/prompt artifacts are in scope;
3. verify harness SHA unchanged;
4. verify procedure SHA unchanged;
5. verify immutable evidence unchanged;
6. verify historical G2 remains `FAIL (row 3)`;
7. verify C6/C8/T4 state unchanged;
8. verify no new authorization record / attempt reset / live retry.

If any substantive difference exists, stop instead of silently fixing it.

## 6. Handoff

Before commit, ensure `docs/handoffs/latest.md` states:

- baseline `ef436d4...`;
- D0/D1 research independently accepted;
- replay reproducibility accepted;
- lag pattern remains moderate/partial;
- historical causality remains unproved;
- C6 remains `NOT_EVIDENCED`;
- C8 remains unresolved;
- T4 remains unchanged;
- immutable evidence remains authoritative and unchanged;
- D0/D1 checkpoint commit/push is authorized;
- D2 remains unauthorized;
- next action after push:
  **separate owner authorization for D2 synthetic-transition specification/research only**.

Do not imply D2 implementation or live diagnostic authorization.

## 7. Commit

Create exactly one D0/D1 research checkpoint commit.

After commit:

- verify working tree state;
- verify harness SHA unchanged;
- verify procedure SHA unchanged;
- verify immutable evidence unchanged.

Report the new commit hash.

## 8. Push

Push that single checkpoint commit to `origin/main`.

After push verify:

- `main == origin/main == <new checkpoint commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- harness SHA unchanged;
- procedure SHA unchanged;
- immutable evidence unchanged;
- no retry/new record/attempt reset occurred.

## 9. Prohibited

Do not:

- implement D2;
- create a D2 simulator/spec in this task;
- modify T4;
- redesign C6/N2;
- modify C8 logic;
- modify harness/tests/product/procedure;
- run live diagnostic;
- rerun G2;
- issue a new authorization record;
- reset attempt state;
- start G3/downstream work.

## 10. Stop gate

Stop immediately after the D0/D1 checkpoint is committed, pushed, and verified.

The next gate is:

**separate owner authorization for D2 synthetic-transition specification/research only**

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- push result;
- final `main` / `origin/main` relation;
- final working-tree state;
- harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- replay package inclusion;
- confirmation C6/C8/T4 unchanged;
- confirmation no retry/new record/attempt reset occurred;
- exact next gate.
