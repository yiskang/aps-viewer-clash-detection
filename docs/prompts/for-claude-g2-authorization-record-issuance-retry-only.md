# For Claude — G2 Authorization-Record Issuance Retry Only

I explicitly re-authorize **one bounded G2 authorization-record preparation / issuance task only**, now bound to the new clean committed baseline.

This authorization does **not** include attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

Use the repository as the source of truth.

## 1. Verify the new committed baseline

Before preparing any record, independently verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- `main == origin/main`
- working tree clean
- committed activated harness SHA-256:
  `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA-256:
  `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no authorization record exists
- no attempts directory / reservation / consumed attempt exists
- no Viewer/fixture/live-G2 evidence exists

Read at minimum:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/research/2026-10-02-g2-live-execution-plan.md`
- `docs/reviews/2026-10-04-g2-committed-activation-identity-independent-verification.md`
- `docs/reviews/2026-10-04-g2-authorization-record-issuance-blocked-internal-review.md`
- accepted G2 procedure
- current authorization validation / runtime-gate / attempt-journal implementation and tests
- fixture identity artifacts referenced by the governing plan

If any material baseline identity differs, stop and report.

## 2. Select the exact runtime

Before issuing any real authorization record:

1. run:
   `nvm use 22.23.1`
2. verify:
   `node -v`

Required:

`v22.23.1`

Also verify without changing versions:

- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell revision `1234`
- Chromium headless-shell version `151.0.7922.34`

Do not install/upgrade runtimes in this task.

If exact Node `v22.23.1` cannot be selected, stop and do not issue.

## 3. Recompute all bound identities from repository state

Do not rely on copied values from conversation alone.

Independently recompute and verify:

- committed HEAD:
  expected `dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- activated harness SHA:
  expected `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  expected `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- Model A URN and deterministic SHA-256 from committed source
- Model B URN and deterministic SHA-256 from committed source
- runtime envelope required by the accepted plan
- exact live command / invocation identity required by the accepted plan
- any schema/version marker explicitly required by the current accepted record contract

Do not invent fixture object IDs or content digests that are not part of the accepted contract.

If any required identity is ambiguous or cannot be independently recomputed, stop before issuance.

## 4. Verify clean-tree eligibility again

Before writing the real record:

- run the same effective clean-tree classification used by the harness;
- confirm no tracked modification exists;
- confirm no disallowed untracked file exists;
- confirm any tolerated untracked prompt file is actually allowed by the current classifier;
- confirm no review/handoff artifact is pending.

If clean-tree eligibility fails, do not issue.

Do not weaken or bypass the rule.

## 5. Verify record discovery / uniqueness rules

Independently inspect current implementation/procedure and confirm:

- exact production authorization-record directory;
- candidate discovery rule;
- sole-candidate requirement;
- stale/superseded rejection;
- ambiguity rejection;
- whether filename is fixed or arbitrary under current implementation;
- whether any forbidden-name rule exists in code/procedure.

Do not reintroduce the previously removed unsupported `g2-live-authorization.md` prohibition.

Confirm there is currently no candidate record.

## 6. Prepare the record before issuance

Construct the exact candidate record content first in memory or a clearly non-issued scratch location.

Do not place it in the production record location yet.

Validate the candidate against the accepted schema.

Bind all required values, including where required:

- explicit authorization scope:
  **record issuance only; live execution not authorized**
- unique authorization ID
- Baseline-HEAD:
  `dbd97137a53890c43a5b89010a73f3dc39f0dc67`
- activated harness SHA
- accepted procedure SHA
- Model A identity/digest
- Model B identity/digest
- required runtime versions
- exact command identity
- single-use / exactly-one-attempt semantics
- deterministic discovery/selection semantics
- ambiguity/stale/superseded rejection semantics
- byte-hash binding if required

Preserve prior accepted disposition that optional fields such as:

- `issuedAt`
- `expiresAt`
- explicit record version

remain optional unless the current accepted schema explicitly requires them.

Do not expand the schema on your own.

## 7. Issue exactly one real authorization record

Only if **all** of the following are true:

- committed HEAD matches;
- harness SHA matches;
- procedure SHA matches;
- fixture identities match;
- Node/runtime requirements match;
- working tree is eligible/clean;
- no existing candidate record exists;
- candidate schema validation passes;
- record path is unambiguous;

then write **exactly one** real authorization record to the accepted production location.

Do not create backups, alternate candidates, temp siblings, or duplicate copies in the discovery directory.

Issuance must not create an attempts directory or reserve/consume an attempt.

## 8. Static verification after issuance

After issuing the record:

- reread exact bytes from disk;
- recompute the record byte hash if applicable;
- verify exact Baseline-HEAD;
- verify harness SHA;
- verify procedure SHA;
- verify fixture bindings;
- verify runtime bindings;
- verify command identity;
- verify sole-candidate status;
- verify no attempts directory exists;
- verify no reservation/attempt state exists;
- verify no Viewer/fixture/live evidence exists.

Do not mutate the issued record after this verification.

If the issued bytes are wrong or incomplete, stop and report. Do not silently replace them unless the accepted procedure explicitly permits safe pre-use replacement.

## 9. Do not run the real harness

Do **not** test the issued record by executing the real harness.

Do not cross W1 into:

- runtime gates;
- reservation;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- Playwright import;
- browser launch;
- Viewer access;
- fixture loading;
- live G2.

Validation in this task must remain static/read-only after issuance.

Do not invent a new preflight-only execution mode.

## 10. Deferred Low

Preserve the existing non-blocking Low:

- stale pre-activation wording remains in parts of the plan/harness comments.

Do not broaden this task into documentation cleanup.

Do not modify plan/harness comments unless they directly make record interpretation unsafe.

## 11. Focused internal review

After issuance (or if blocked), perform one focused internal review covering:

- clean-tree compliance;
- committed identity binding;
- fixture binding;
- runtime binding;
- record schema;
- record path/uniqueness;
- single-use semantics;
- accidental attempt-consumption risk;
- whether issuance crossed any execution boundary;
- record byte/hash integrity.

Classify:

- Critical
- High
- Medium
- Low

If a Critical/High issue requires implementation/procedure/schema changes, stop and report instead of broadening scope.

Persist under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

## 12. Handoff requirements

If issuance succeeds, record:

- committed HEAD;
- harness SHA;
- procedure SHA;
- Node/Playwright/headless-shell versions used;
- authorization record issued: yes;
- authorization ID;
- exact record path;
- record byte hash if applicable;
- Model A/B identities bound;
- no attempts directory;
- no attempt reserved/consumed;
- no Viewer/fixture load;
- no live G2;
- exactly-one live execution remains separately unauthorized;
- next action:
  **independent Work verification of the issued authorization record**.

If blocked:

- exact blocker;
- whether candidate content was only prepared in scratch;
- no real record issued;
- next required owner action.

## 13. Commit/push policy

Do not commit or push in this task.

Do not add the authorization record to git unless the accepted procedure explicitly requires tracking.

Do not commit/push the review or handoff.

Any governance cleanup after issuance is a separate owner decision.

## 14. Stop gate

Stop after:

- candidate preparation;
- real issuance only if every gate passes;
- static/read-only post-issuance verification;
- focused internal review;
- handoff update.

Do not:

- reserve an attempt;
- consume an attempt;
- run the real harness;
- launch Playwright/browser/Viewer;
- load fixtures;
- run live G2;
- commit;
- push.

The next gate after successful issuance is:

**Independent Work verification of the issued authorization record → explicit owner authorization of exactly one live G2 execution**

## Final report

Report:

- branch / HEAD / origin relation;
- clean-tree status;
- Node/runtime versions used;
- independently recomputed HEAD/harness/procedure identities;
- Model A/B identities;
- authorization schema used;
- whether a real record was issued;
- authorization ID;
- exact record path;
- record byte hash if applicable;
- sole-candidate verification;
- no-attempt-state verification;
- internal review findings;
- working-tree state after the task;
- exact next gate.

Explicitly confirm:

- `LIVE_PATH_WIRED=true`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- no attempt reserved/consumed
- no Viewer/fixture load
- no live G2
- no commit
- no push
