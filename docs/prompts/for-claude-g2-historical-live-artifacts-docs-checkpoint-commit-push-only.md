# For Claude — G2 Historical Live Artifacts Docs Checkpoint Commit + Push Only

I explicitly authorize **one docs-only hygiene checkpoint commit and push** for five historical live-execution prompt/review artifacts that are already referenced by tracked repository files.

This task exists only to eliminate dangling tracked references before D2-OFFLINE work begins.

It does **not** authorize:
- D2-OFFLINE implementation;
- any harness/test/product/procedure change;
- T4/C6/C8 changes;
- live retry;
- new authorization-record issuance;
- attempt reset;
- deletion/mutation/move of any authorization record;
- unrelated cleanup;
- downstream work.

Use the repository as the source of truth.

## 1. Verify baseline

Before staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- current HEAD is the latest pushed D2-spec checkpoint
- `main == origin/main`
- tracked tree clean
- exactly these 8 untracked files remain:
  - 3 authorization records under `docs/prompts/`
  - 3 historical prompt artifacts
  - 2 historical review artifacts
- no other untracked or modified file exists
- harness SHA unchanged
- procedure SHA unchanged
- immutable evidence unchanged
- historical G2 remains `FAIL (row 3)`
- no retry/new record/attempt reset occurred

If the working-tree inventory differs materially, stop and report.

## 2. Explicit files authorized for commit

Stage and commit **only these five files**:

1. `docs/prompts/for-claude-g2-exactly-one-live-execution-only.md`
2. `docs/prompts/for-claude-g2-final-authorization-record-issuance-only.md`
3. `docs/prompts/for-work-g2-live-evidence-verdict-independent-review.md`
4. `docs/reviews/2026-10-04-g2-exactly-one-live-execution-internal-review.md`
5. `docs/reviews/2026-10-04-g2-live-evidence-verdict-independent-review.md`

Do not stage any other file.

## 3. Authorization records must remain untouched and untracked

The following three files must remain:

- untracked;
- unstaged;
- uncommitted;
- byte-identical;
- unmoved;
- undeleted.

### Final spent record
`docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-75a3ccb9.md`

### Superseded historical record
`docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`

### Superseded historical record
`docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`

Do not use `git add docs/prompts`.

Stage the five authorized paths explicitly.

Before staging, recompute all three authorization-record SHA-256 values and record them.

After commit/push, recompute them again and verify no byte changed.

## 4. Why these five files are being checkpointed

Verify, read-only, that:

- the two review artifacts are substantive historical collaboration artifacts;
- tracked repository artifacts already cite them;
- the two Claude prompts document owner-authorized execution/issuance gates;
- the Work prompt documents the independent live-evidence review gate;
- committing these files resolves dangling references without changing technical state.

Do not edit their contents merely for style/cleanup.

If one of the five files differs from the artifact previously cited by tracked docs, stop and report.

## 5. Pre-commit verification

Before staging:

1. run `git diff --check`;
2. inspect `git status --short`;
3. verify only the expected 8 untracked files are present;
4. compute SHA-256 of all three authorization records;
5. verify no tracked source/test/procedure/evidence change exists;
6. verify immutable evidence has no diff;
7. verify harness/procedure SHAs unchanged.

## 6. Staging verification

Stage exactly the five authorized files by explicit path.

Then verify the staged file list contains **exactly five files** and no authorization record.

If any sixth file is staged, reset the staging area for this task and stop/report rather than guessing.

## 7. Commit

Create exactly one docs-only historical-artifacts checkpoint commit.

Do not modify the five artifacts before commit.

After commit:

- verify the tracked tree state;
- verify the three authorization records are still untracked;
- verify their SHA-256 values unchanged;
- verify harness/procedure SHAs unchanged;
- verify immutable evidence unchanged.

Report the new commit hash.

## 8. Push

Push that single commit to `origin/main`.

After push, verify:

- `main == origin/main == <new commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- the only remaining untracked files are exactly the three authorization records;
- all three authorization-record hashes unchanged;
- harness SHA unchanged;
- procedure SHA unchanged;
- immutable evidence unchanged.

## 9. Prohibited

Do not:

- stage/commit any authorization record;
- rename/move/delete authorization records;
- edit historical prompts/reviews;
- modify handoff unless required solely to reflect this checkpoint and separately authorized;
- implement D2-OFFLINE;
- create simulator files;
- modify harness/tests/product/procedure;
- change T4/C6/C8;
- rerun live G2;
- issue new authorization record;
- reset attempt state;
- start G3/downstream work.

## 10. Stop gate

Stop immediately after the five-file docs-only checkpoint is committed, pushed, and verified.

The next gate remains:

**separate owner authorization for D2-OFFLINE synthetic simulator implementation only**

## Final report

Report:

- new checkpoint commit hash;
- exact five files committed;
- push result;
- final `main` / `origin/main` relation;
- final tracked/untracked working-tree state;
- the three authorization-record SHA-256 values before/after;
- confirmation only those three records remain untracked;
- harness SHA;
- procedure SHA;
- immutable-evidence unchanged confirmation;
- confirmation no D2 implementation/live retry/new record/attempt reset occurred;
- exact next gate.
