# For Claude — G2 Final Authorization-Record Issuance Only

I explicitly authorize **one final G2 authorization-record preparation / issuance task only** under the already-persisted terminal clean-window rule.

This authorization does **not** authorize attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

Use the repository as the source of truth.

## 1. Verify final clean baseline

Before preparing the final record, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- `main == origin/main`
- tracked tree clean
- only untracked files are the two historical authorization records
- committed activated harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no attempts directory / reservation / consumed attempt
- no Viewer/fixture/live-G2 evidence

Existing historical records:

1. `g2-live-20261004-dbd97137`
   - SHA:
     `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

2. `g2-live-20261004-8a8d49f6`
   - SHA:
     `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461`

Both must remain byte-identical and untracked.

If any baseline fact differs materially, stop and report.

## 2. Terminal clean-window rule

This task is governed by:

`docs/reviews/2026-10-04-g2-terminal-clean-window-sequencing-decision.md`

Apply it strictly.

After the final authorization record is issued:

- do **not** create or modify any repository file;
- do **not** update `docs/handoffs/latest.md`;
- do **not** create a review artifact;
- do **not** create a new prompt/artifact;
- do **not** commit or push;
- do **not** mutate either historical record;
- do **not** run the real harness.

Only read-only/static verification is allowed until a later separately authorized exactly-one live attempt completes.

Your final chat report is allowed; repo writes are not.

## 3. Select exact runtime

Before record preparation:

- run:
  `nvm use 22.23.1`
- verify:
  `node -v`

Required:

`v22.23.1`

Also verify read-only:

- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell revision `1234`
- Chromium headless-shell version `151.0.7922.34`

Do not install or upgrade runtimes.

## 4. Recompute all final record bindings

Independently recompute from current committed repo state:

- HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- activated harness SHA
- accepted procedure SHA
- Model A URN + SHA-256
- Model B URN + SHA-256
- accepted runtime envelope
- any other schema-required identity
- exact single-use / exactly-one-attempt semantics

Do not copy blindly from prior records.

Do not invent object IDs/content digests not present in the accepted contract.

## 5. Verify historical-record chain

Before writing the final record:

- reread both historical record bytes;
- recompute their SHA values;
- confirm both match exactly;
- confirm native supersession logic still recognizes:
  - `g2-live-20261004-dbd97137` as superseded by `g2-live-20261004-8a8d49f6`;
- confirm no other active candidate exists.

Do not move, rename, edit, delete, stage, or commit either historical record.

## 6. Prepare the final record

Prepare a candidate first in memory or an explicitly non-repo scratch location.

Use a **new authorization ID**.

Recommended deterministic ID:

`g2-live-20261004-75a3ccb9`

unless the current accepted ID convention requires another unique value.

Bind the final record to:

- Baseline-HEAD:
  `75a3ccb9ba160f8afcf3c9b39a301f352b273c08`
- activated harness SHA
- accepted procedure SHA
- Model A digest
- Model B digest
- exact runtime envelope
- single-use / exactly-one-attempt semantics
- all other accepted required markers

Include native supersession:

`Supersedes: g2-live-20261004-8a8d49f6`

Do not supersede the first record directly unless the accepted parser requires transitive linkage.

Do not expand the schema.

## 7. Final pre-issuance gate

Immediately before writing the final record, recheck:

- `main == origin/main == 75a3ccb9...`
- tracked tree clean
- only the two historical records are untracked
- harness SHA exact
- procedure SHA exact
- both historical record SHAs exact
- Node/runtime exact
- no attempts directory
- no reservation/journal/live evidence
- exactly zero active non-historical candidate records

If any check fails, do not issue.

## 8. Issue exactly one final active record

Only if all gates pass:

- write exactly one new authorization record under the accepted production discovery path;
- do not create any backup/sibling/temp file in `docs/prompts/`;
- do not modify either historical record;
- do not create any other repo file.

After write, there should be exactly:

- two historical/superseded records;
- one final active record.

## 9. Read-only post-issuance verification

After issuance, perform **read-only only** verification:

- reread the final record bytes;
- compute its SHA-256;
- validate schema;
- verify Baseline-HEAD;
- verify harness/procedure/fixture/runtime bindings;
- verify `Supersedes: g2-live-20261004-8a8d49f6`;
- verify old records remain byte-identical;
- verify discovery sees exactly one active candidate;
- verify both prior records are superseded;
- verify no attempts directory;
- verify no reservation/journal;
- verify no Viewer/fixture/live evidence.

Do not write any review/handoff/log artifact into the repo.

Do not run the real harness.

## 10. No live execution

Do not cross into:

- W1 live execution;
- runtime gates through real harness execution;
- reservation;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- Playwright import;
- browser launch;
- Viewer access;
- fixture loading;
- live G2.

Exactly-one live execution remains separately unauthorized.

## 11. No repository writes after issuance

Once the final record is written, the only repo-file mutation permitted in this task is **none**.

Specifically do not:

- update handoff;
- create review docs;
- edit prompts;
- touch plan/tests/source;
- commit/push.

The repository must remain Phase-0 eligible for the later single live attempt.

## 12. Stop gate

Stop immediately after read-only verification of the final issued record.

The next gate is:

**Independent read-only verification of the final issued authorization record → explicit owner authorization of exactly one live G2 execution**

That independent verification must also obey the terminal clean-window rule and make no repo writes before live execution.

## Final report

Report in chat only:

- branch / HEAD / origin relation;
- runtime versions;
- recomputed harness/procedure/fixture identities;
- both historical record IDs + SHAs;
- final authorization ID;
- final record path;
- final record SHA-256;
- supersession chain;
- active-candidate count;
- no-attempt-state verification;
- confirmation tracked tree remains clean;
- exact untracked files after issuance;
- exact next gate.

Explicitly confirm:

- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no attempt reserved/consumed
- no Viewer/fixture load
- no live G2
- no commit
- no push
- no repo writes after final record issuance
