# For Claude — G2 Authorization-Record Preparation / Issuance Only

I explicitly authorize **one bounded G2 authorization-record preparation / issuance task only**.

This authorization does **not** authorize attempt reservation/consumption, Viewer/fixture loading, or live G2 execution.

Use the repository as the source of truth.

## Expected committed activation baseline

Verify first:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- committed HEAD:
  `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`
- expected relation:
  `main == origin/main`
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
- accepted G2 procedure
- authorization validation / runtime-gate / attempt-journal implementation and tests
- fixture identity artifacts referenced by the governing plan

If any material baseline identity differs, stop and report.

---

## 1. Runtime selection before preparation

Before generating or issuing any real authorization record:

1. explicitly select:
   `nvm use 22.23.1`
2. verify:
   `node -v`

Required value:

`v22.23.1`

Also verify:

- `playwright` `1.62.1`
- `playwright-core` `1.62.1`
- Chromium headless-shell revision `1234`
- Chromium headless-shell version `151.0.7922.34`

Do not install or upgrade runtimes in this task.

If exact Node `v22.23.1` cannot be selected, stop and do not issue the record.

---

## 2. Tracked-tree cleanliness gate

Before issuing a real record, verify the tracked repository state satisfies the accepted clean-tree contract.

Current Work verification reported that the independent review and handoff update were still uncommitted at review completion.

Therefore:

- inspect actual current git status;
- determine from the accepted procedure/plan exactly what "clean tree" requires at issuance/W1;
- do not assume those uncommitted docs are harmless;
- do not commit or push them in this task.

If tracked modifications/untracked governance artifacts would violate the issuance or W1 clean-tree requirement:

- prepare the record content only in a non-issued scratch location if useful;
- do **not** place a real record in the production authorization-record location;
- stop and report that a separate docs checkpoint commit/push is required before issuance.

Do not weaken the clean-tree rule.

---

## 3. Recompute all authorization-bound identities

Do not copy hashes only from conversation/history.

Independently recompute and verify all identities required by the accepted record schema, including:

- committed HEAD:
  `7fe9c99b4d1aaf49c3996514132ccd54f9ff1ab0`
- committed activated harness SHA:
  expected `471fae40d371c292f05d92bbdafdbdaa426a0426af0924a6e0946ac69fe77ac4`
- accepted procedure SHA:
  expected `d1ccfde224b8ae76fe74b06c93abc532e6df9612933cafaa045053c8e2e45a75`
- Model A committed URN identity and deterministic digest required by the plan
- Model B committed URN identity and digest
- any other fixture identity explicitly required by the accepted schema
- runtime envelope
- exact command identity / invocation contract
- authorization schema version/format if the accepted plan requires one

Do not invent object IDs or content digests that do not exist in the repository contract.

If any required bound identity is ambiguous or cannot be independently recomputed, stop before issuance.

---

## 4. Authorization-record schema

Prepare the real record strictly according to the accepted governing plan/schema.

The record must bind, at minimum where required by the accepted schema:

- explicit owner authorization scope:
  **authorization-record issuance only; not live execution**
- unique authorization ID
- exact committed HEAD
- committed activated harness SHA
- accepted procedure SHA
- fixture identities/digests
- required runtime versions/envelope
- exact command identity
- single-use / exactly-one-attempt semantics
- deterministic record location/selection semantics
- ambiguity/stale/superseded rejection semantics
- byte-hash binding if required by the accepted implementation

Preserve prior accepted disposition that optional metadata such as:

- `issuedAt`
- `expiresAt`
- explicit record version

remains optional unless the current accepted schema now requires it.

Do not silently expand the schema.

---

## 5. Record-path and uniqueness rules

Before issuance, independently verify the real record discovery rules.

Confirm:

- exact production record directory/path;
- sole-candidate semantics;
- no pre-existing candidate record;
- no ambiguous candidate;
- no stale/superseded record;
- no filename assumption beyond what current implementation/procedure actually requires.

The prior unsupported prohibition on the specific name `g2-live-authorization.md` was removed from the governing plan.

Do not reintroduce it.

If the implementation requires a particular deterministic path/name, use the implementation/procedure as source of truth and document it.

---

## 6. Preparation vs issuance

Treat these as distinct substeps.

### Preparation

First construct the exact candidate record content in memory or a clearly non-issued scratch location.

Validate:

- schema;
- all identity bindings;
- exact scope;
- single-use semantics;
- command/runtime bindings;
- uniqueness assumptions.

### Issuance

Only if **all** issuance preconditions are satisfied:

- tracked tree satisfies accepted clean-tree requirement;
- exact Node/runtime prerequisites are satisfied;
- committed identities recompute exactly;
- no existing record/attempt state exists;
- record path is unambiguous;
- schema validation passes;

then write exactly one real authorization record to the accepted production record location.

Do not create multiple candidates.

Do not reserve an attempt merely by issuing the record.

---

## 7. No live execution

After issuance, do **not** invoke the real harness in a way that can proceed past W1 into:

- runtime gates;
- reservation;
- `AUTH_BOUND`;
- `ATTEMPT_CONSUMED`;
- Playwright import;
- browser launch;
- Viewer access;
- fixture loading;
- live G2.

Do not "test" the issued record by running the real command.

Validation of the issued record must be static/read-only unless the accepted implementation exposes a proven non-consuming validation path.

A separate preflight-only mode is not required and must not be invented.

---

## 8. Verify issued-record bytes and identity

If a real record is issued:

- reread the exact bytes from disk;
- recompute its byte hash if the accepted schema/implementation uses one;
- verify all bound identities still match the committed repository state;
- verify it is the sole candidate;
- verify no attempts directory was created;
- verify no reservation/attempt state was created;
- verify no live evidence was produced.

Do not mutate the record after verification.

If any correction would require changing issued bytes, stop and report rather than silently replacing it, unless the accepted procedure explicitly defines safe pre-use replacement semantics.

---

## 9. Documentation Low from Work

Latest independent verification carried one non-blocking Low:

- pre-activation wording remains in parts of the plan/harness comments.

Do not broaden this task into documentation cleanup.

Record it as deferred/non-blocking unless it directly interferes with record interpretation.

Do not modify harness comments or plan wording in this task.

---

## 10. Focused internal review

Perform one focused internal review of the authorization-record preparation/issuance result.

Review:

- committed identity bindings;
- runtime prerequisites;
- clean-tree compliance;
- fixture bindings;
- schema correctness;
- record-path/uniqueness semantics;
- single-use semantics;
- accidental attempt-consumption risk;
- whether issuance itself crossed any execution boundary.

Classify:

- Critical
- High
- Medium
- Low

If a Critical/High finding requires changing repository implementation/procedure/schema, stop and report instead of broadening scope.

Persist the review under:

`docs/reviews/`

Update:

`docs/handoffs/latest.md`

only after determining whether a real record was actually issued.

---

## 11. Handoff requirements

If issuance succeeds, the handoff must state:

- committed HEAD;
- committed harness SHA;
- procedure SHA;
- exact runtime versions used during issuance;
- authorization record issued: yes;
- authorization ID;
- record path;
- record byte hash if applicable;
- fixture identities bound;
- no attempt reserved/consumed;
- no Viewer/fixture load;
- no live G2;
- exactly-one live execution remains separately unauthorized;
- next action:
  **independent Work verification of the issued authorization record**.

If issuance is blocked, state:

- exact blocker;
- whether record content was only prepared in scratch;
- no real record issued;
- next required owner action.

---

## 12. Commit / push policy

Do **not** commit or push in this task unless the accepted procedure explicitly requires the authorization record to be tracked—which prior governance has not established.

Do not add the real authorization record to git unless the accepted procedure explicitly requires it.

Do not commit/push review or handoff artifacts automatically.

Leave any governance-doc changes for a separate owner-authorized checkpoint if needed.

---

## 13. Stop gate

Stop after:

- record preparation;
- issuance only if every gate passes;
- static/read-only verification of the issued record;
- focused internal review;
- handoff update.

Do not:

- reserve an attempt;
- consume an attempt;
- run the real harness with the issued record;
- launch Playwright/browser/Viewer;
- load fixtures;
- run live G2;
- commit;
- push.

The next gate after successful issuance is:

**Independent Work verification of the issued authorization record → explicit owner authorization of exactly one live G2 execution**

---

## Final report

Report:

- branch / HEAD / origin relation;
- git-status / clean-tree disposition;
- Node/runtime versions used;
- independently recomputed HEAD/harness/procedure identities;
- fixture identities bound;
- authorization schema used;
- whether a real record was issued;
- authorization ID;
- record path;
- record byte hash if applicable;
- uniqueness/sole-candidate verification;
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
