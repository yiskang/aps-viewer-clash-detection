# For Claude — G2 Post-Issuance Governance Docs Checkpoint Commit + Push Only

I explicitly authorize **one docs-only governance checkpoint commit and push** after independent verification of the first issued G2 authorization record.

This authorization does **not** include mutation/deletion/reissue of the current authorization record, attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

## Baseline

Verify before staging:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- HEAD:
  `dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- `main == origin/main`
- committed activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`

Current issued record:

- path:
  `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`
- authorization ID:
  `g2-live-20261004-dbd97137`
- SHA-256:
  `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`
- state:
  technically valid, uniquely discoverable, unspent, but bound to current HEAD `dbd97137...`

Latest independent Work decision:

- current dirty tree would spend the record at `AUTH_BOUND` and then fail Phase 0;
- removing/relocating governance artifacts is rejected;
- commit/push governance docs, excluding the record;
- preserve the current record unchanged as historical evidence;
- later issue a new record against the new HEAD with a new ID and:
  `Supersedes: g2-live-20261004-dbd97137`.

If the actual baseline differs materially, stop and report.

## Current working-tree expectation

Inspect exact `git status`.

Expected governance changes may include:

- modified:
  - `docs/handoffs/latest.md`
- untracked:
  - `docs/reviews/2026-10-04-g2-authorization-record-issuance-internal-review.md`
  - `docs/reviews/2026-10-04-g2-issued-authorization-record-independent-verification.md`
  - relevant prompt artifacts under `docs/prompts/`
  - the issued authorization record itself

Do not assume filenames; verify actual state.

If implementation/test/procedure/production files are changed, stop and report.

## Critical exclusion — do not stage the issued record

The existing issued record must remain **unchanged and untracked**:

`docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`

Do not:

- stage it;
- commit it;
- rename it;
- edit it;
- delete it;
- move it;
- replace it;
- alter its bytes.

Before staging, recompute its SHA and confirm it is still:

`0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

If the bytes/hash differ, stop and report.

## Authorized commit scope

Commit only governance/documentation artifacts from the completed issuance/review cycle, including as applicable:

- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-04-g2-authorization-record-issuance-internal-review.md`
- `docs/reviews/2026-10-04-g2-issued-authorization-record-independent-verification.md`
- related prompt artifacts under `docs/prompts/` that are not authorization-record candidates

Do not add unrelated files.

Do not alter governing plan/harness/tests/procedure unless already part of the independently reviewed docs-only state; if such changes are present unexpectedly, stop.

## Pre-commit verification

Before staging:

1. run `git diff --check`;
2. verify no implementation/test/procedure/production changes;
3. verify `LIVE_PATH_WIRED=true`;
4. recompute harness SHA and confirm:
   `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`;
5. recompute procedure SHA and confirm:
   `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`;
6. verify the current record SHA remains unchanged;
7. verify no attempts directory / reservation / journal / `AUTH_BOUND` / `ATTEMPT_CONSUMED` / live evidence exists.

## Handoff

Before commit, ensure `docs/handoffs/latest.md` accurately records:

- current committed baseline `dbd97137...`;
- first authorization record is technically valid and unspent;
- current record is preserved unchanged as historical evidence;
- current record must **not** be used for live execution after this docs checkpoint changes HEAD;
- governance docs checkpoint commit/push is authorized;
- after push, a new authorization record must be issued against the new HEAD;
- new record must use a new authorization ID;
- new record must include:
  `Supersedes: g2-live-20261004-dbd97137`
  if supported by the accepted record format/disposition;
- `LIVE_PATH_WIRED=true`;
- no attempt reserved/consumed;
- no Viewer/fixture load;
- no live G2;
- next action:
  **separate owner authorization for new authorization-record issuance bound to the new HEAD**.

Do not imply live execution is authorized.

## Commit

Stage only the authorized governance/doc files.

Explicitly verify the issued record is **not staged**.

Create exactly one docs-only checkpoint commit.

After commit:

- verify working tree state;
- verify the existing record remains untracked and unchanged;
- recompute its SHA;
- recompute harness SHA;
- recompute procedure SHA;
- verify `LIVE_PATH_WIRED=true`;
- verify no attempt/live state exists.

Report the new commit hash.

## Push

Push that single docs-only checkpoint commit to `origin/main`.

After push, verify:

- `main == origin/main == <new commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- only allowed untracked `docs/prompts/` artifacts remain;
- existing historical record remains untracked and unchanged;
- harness SHA unchanged;
- procedure SHA unchanged;
- `LIVE_PATH_WIRED=true`;
- no attempts directory;
- no Viewer/fixture/live evidence.

## Post-push record disposition

After HEAD changes, explicitly mark in the report:

- the existing record is still byte-valid historical evidence;
- it is **not valid for future live execution** because its Baseline-HEAD remains `dbd97137...`;
- do not delete or mutate it in this task;
- do not issue a replacement record in this task.

The replacement/reissue is a separate owner-authorized gate.

## Prohibited

Do not:

- mutate/delete/rename/move the existing authorization record;
- issue a new authorization record;
- reserve or consume an attempt;
- run the real harness;
- launch Playwright/browser/Viewer;
- load fixtures;
- run live G2;
- modify harness/tests/procedure;
- start the next gate.

## Stop gate

Stop immediately after:

- docs-only checkpoint commit;
- push;
- post-push clean-tree verification;
- confirmation that the old record remains unchanged/untracked/historical.

The next gate is:

**separate owner authorization to issue a new G2 authorization record bound to the new committed HEAD, with a new ID and supersession linkage**

Exactly-one live execution remains a later, separate gate.

## Final report

Report:

- new docs-checkpoint commit hash;
- exact files committed;
- confirmation the old record was excluded from staging/commit;
- old record SHA before/after;
- push result;
- final `main` / `origin/main` relation;
- tracked/untracked working-tree state;
- harness SHA;
- procedure SHA;
- `LIVE_PATH_WIRED=true`;
- confirmation no attempt state, Viewer/fixture load, or live G2 occurred;
- confirmation the old record is preserved unchanged as historical evidence and must not be used for live execution;
- exact next gate.
