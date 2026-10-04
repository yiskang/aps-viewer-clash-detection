# For Claude — G2 Terminal-Sequencing Governance Checkpoint Commit + Push Only

I explicitly authorize **one docs-only terminal-sequencing governance checkpoint commit and push**.

This task exists to resolve the independently verified sequencing contradiction where mandatory post-issuance review/handoff writes make the repository fail Phase 0 after `AUTH_BOUND`.

This authorization does **not** include issuing the final authorization record, reserving/consuming an attempt, Viewer/fixture loading, or live G2 execution.

Use the repository as the source of truth.

## 1. Verify baseline

Before editing/staging, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `8a8d49f6293e9be1bd858ed76ad991319c1e9f8c`
- `main == origin/main`
- committed harness SHA:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no attempts directory / reservation / `AUTH_BOUND` / `ATTEMPT_CONSUMED`
- no Viewer/fixture/live-G2 evidence

Existing records:

### Historical record 1
- ID: `g2-live-20261004-dbd97137`
- path:
  `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-dbd97137.md`
- SHA:
  `0f339d964794ceb54d84e3a3c13d1655cce6aac2b9796cf4c4deb3c243baa4ae`

### Current superseding record
- ID: `g2-live-20261004-8a8d49f6`
- path:
  `docs/prompts/g2-live-execution-authorization-record-g2-live-20261004-8a8d49f6.md`
- SHA:
  `b520bc712fbf85ad848a234e0472c3f6da9f0fa724c9fe8682c657dc759db461`

Latest independent Work review concluded:

- both records are technically valid;
- the second record is active and unspent;
- the first is natively superseded;
- current dirty-tree governance artifacts make live execution ineligible;
- another docs checkpoint is required;
- a final new record must later be issued against the new HEAD;
- post-final-issuance repo writes must be deferred until after the single live attempt.

If any material baseline differs, stop and report.

## 2. Preserve both existing authorization records unchanged

Both existing authorization records must remain:

- untracked;
- byte-identical;
- unstaged;
- uncommitted;
- unmodified;
- unmoved;
- undeleted.

Before staging governance docs, recompute both SHA-256 values and confirm exact matches.

Do not use either record for live execution after this checkpoint changes HEAD.

Do not issue a third/final record in this task.

## 3. Persist the terminal clean-window governance decision

Create or update a durable repository governance artifact that records the owner-authorized sequencing exception.

Prefer the existing repository artifact structure and keep the full rationale in `docs/reviews/` or another established governance/research artifact, with the handoff linking to it.

The durable decision must state:

### Terminal clean-window rule

For the **final authorization-record issuance and exactly-one live G2 sequence only**:

1. all required governance docs/reviews/handoff updates that must affect HEAD are completed, reviewed, committed, and pushed **before** final issuance;
2. the final authorization record is issued against that resulting clean committed HEAD;
3. after final issuance, verification until the live attempt is restricted to **read-only / non-repo-mutating checks**;
4. no `docs/handoffs/`, `docs/reviews/`, plan, prompt, test, source, or other repository file may be created/modified before the single live attempt;
5. the final record itself remains an allowed untracked `docs/prompts/` artifact under the current clean-tree classifier;
6. the live attempt proceeds only after an explicit separate owner authorization;
7. immediately after the live attempt reaches its terminal state, persist:
   - issued-record verification;
   - live evidence;
   - independent review;
   - handoff update;
   - any required closeout artifacts.

This is a **bounded sequencing/governance exception**, not a change to harness logic or the accepted G2 procedure.

Do not modify implementation/procedure semantics.

## 4. Explain why the exception is necessary

The governance artifact should record the independently verified ordering:

`record/runtime validation → AUTH_BOUND reservation → Phase 0 git-tree check → ATTEMPT_CONSUMED → Viewer/model activity`

and the consequence:

- any repository write after final issuance but before the live attempt can cause Phase 0 failure after the record has already been spent/bound;
- no retry is allowed;
- therefore all durable governance writes that change HEAD must happen before final issuance.

Keep this factual and concise.

## 5. Current record lifecycle disposition

Record clearly:

- `g2-live-20261004-dbd97137` remains historical and superseded;
- `g2-live-20261004-8a8d49f6` is technically valid/unspent but becomes historical-only once this docs checkpoint changes HEAD;
- neither should be deleted or mutated;
- the next record must:
  - use a new authorization ID;
  - bind the new checkpoint HEAD;
  - supersede `g2-live-20261004-8a8d49f6`;
  - become the sole active candidate.

Do not issue that next record now.

## 6. Commit scope

Commit only governance/documentation artifacts, including as applicable:

- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-04-g2-superseding-authorization-record-issuance-internal-review.md`
- `docs/reviews/2026-10-04-g2-superseding-authorization-record-independent-verification.md`
- the new/updated terminal-sequencing governance decision artifact
- related authorizing prompt artifact(s) under `docs/prompts/` that are not authorization-record candidates

Do not stage either authorization record.

Do not add unrelated files.

If implementation/test/procedure/production files are modified, stop and report.

## 7. Pre-commit verification

Before staging:

1. run `git diff --check`;
2. confirm both record hashes are unchanged;
3. confirm neither record is staged;
4. recompute harness SHA and confirm unchanged:
   `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`;
5. recompute procedure SHA and confirm unchanged;
6. confirm `LIVE_PATH_WIRED=true`;
7. confirm no attempts directory / reservation / live evidence exists;
8. confirm all source/test/implementation files are unchanged.

If any material difference exists, stop.

## 8. Handoff update

Before commit, ensure `docs/handoffs/latest.md` states:

- current baseline before checkpoint: `8a8d49f...`;
- both current authorization records are preserved unchanged;
- current active record is valid/unspent but will become historical-only after HEAD changes;
- terminal clean-window sequencing decision is durably authorized;
- final issuance must happen only after this docs checkpoint is pushed;
- after final issuance, no repo writes before the single live attempt;
- final live execution remains separately unauthorized;
- no attempt/live activity has occurred;
- next action after push:
  **issue one final superseding authorization record against the new HEAD under the terminal clean-window rule**.

## 9. Commit and push

Create exactly one docs-only governance checkpoint commit.

After commit:

- verify both authorization records remain untracked and unchanged;
- verify tracked tree clean;
- recompute harness/procedure SHAs;
- verify `LIVE_PATH_WIRED=true`.

Push that single commit to `origin/main`.

After push, verify:

- `main == origin/main == <new checkpoint commit>`;
- ahead/behind `0/0`;
- tracked tree clean;
- only allowed untracked `docs/prompts/` authorization records/prompts remain;
- both old record hashes unchanged;
- harness SHA unchanged;
- procedure SHA unchanged;
- no attempts/live state.

## 10. Post-push disposition

After HEAD changes, explicitly report:

- both existing records are historical/non-executable against the new HEAD;
- neither was mutated/deleted;
- final record has **not** been issued yet;
- the terminal clean-window rule is now durably persisted;
- the next record must supersede:
  `g2-live-20261004-8a8d49f6`.

## 11. Prohibited

Do not:

- issue a new authorization record;
- mutate/delete/move either existing record;
- reserve/consume an attempt;
- run the real harness;
- launch Playwright/browser/Viewer;
- load fixtures;
- run live G2;
- modify harness/tests/procedure;
- start the next gate.

## 12. Stop gate

Stop after:

- terminal-sequencing governance artifact is persisted;
- docs-only checkpoint commit;
- push;
- clean-baseline verification.

Next gate:

**separate owner authorization to issue one final superseding authorization record against the new HEAD under the terminal clean-window rule**

Exactly-one live G2 remains a later, separate gate.

## Final report

Report:

- new checkpoint commit hash;
- exact files committed;
- terminal clean-window artifact path;
- confirmation both records were excluded from staging/commit;
- both record SHA values before/after;
- push result;
- final `main` / `origin/main` relation;
- final tracked/untracked state;
- harness SHA;
- procedure SHA;
- `LIVE_PATH_WIRED=true`;
- confirmation no attempt state, Viewer/fixture load, or live G2 occurred;
- exact next gate.
