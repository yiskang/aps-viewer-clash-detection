# For Claude — G2 Procedure Reconciliation Only

I explicitly authorize **one bounded documentation/procedure reconciliation** for the G2 ViewerBridge / DockingPanel live-verification procedure.

This task is limited to resolving the three live-planning blockers identified by the latest independent Work review of the dormant G2 harness checkpoint:

1. C15(e)
2. X4
3. request-fatality policy

This authorization does **not** include:

- changing the committed dormant harness implementation;
- enabling `LIVE_PATH_WIRED`;
- running live G2;
- executing real-Viewer failure injection;
- modifying production ViewerBridge/Panel/Core/Adapter/M4 code;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- commit or push unless separately authorized.

Use repository state as source of truth.

---

## 1. Verify baseline first

Verify:

- repository in scope;
- branch `main`;
- expected baseline:
  `68ef222f097d5ff34b475fdb3980fe662574ac3d`;
- `main == origin/main`;
- working tree clean;
- dormant G2 harness checkpoint is committed;
- `LIVE_PATH_WIRED=false`;
- no live G2 attempt/evidence/result exists.

Read:

- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- accepted G2 procedure;
- dormant G2 harness implementation;
- `docs/reviews/2026-10-01-g2-harness-implementation-independent-review.md`;
- directly relevant ViewerBridge implementation for C15;
- governing Viewer Clash Panel design/plan where needed.

Do not treat prior conversational summaries as proof.

---

# 2. C15(e) — reconcile the impossible observable

Latest independent Work disposition:

- after marker cleanup, `ViewerBridge.inspectLedger()` necessarily returns `null`;
- the internal isolation record may still exist for retry;
- the current procedure asks for an observable that production code cannot expose;
- the harness correctly implements the literal procedure;
- no production-code change is required.

## Required task

Inspect the actual ViewerBridge implementation and current C15 procedure text.

Redefine C15(e) so it tests the original behavioral intent using observable state.

The preferred direction from Work is:

**failed first `clear()` → restored second `clear()`**

The procedure must define mechanically:

- setup/preconditions;
- first `clear()` action and injected failure point;
- expected first-clear result;
- observable Viewer state after the failed clear;
- second `clear()` action;
- expected restoration result;
- exact PASS condition;
- exact FAIL condition;
- timeout/deadline;
- cleanup;
- retained evidence;
- any negative control.

Do **not** require `inspectLedger()` to expose internal state after the first clear if production code cannot do so.

Do not weaken the isolation-restore contract. The new oracle must still prove that a transient clear failure does not permanently strand Panel-owned isolation state.

Explicitly distinguish:

- internal retry state;
- externally observable Viewer state;
- what the harness is allowed to inspect.

---

# 3. X4 — reconcile Model-B loss semantics

Latest Work disposition:

- Model-B loss makes mandatory controls non-acceptable;
- verdict row-4 `FAIL` therefore wins before row-6 `BLOCKED`;
- the current X4 expectation is contradictory/unreachable.

## Required task

Trace:

- X4 definition;
- mandatory-control acceptance rules;
- verdict precedence;
- Model-B dependency behavior.

Choose and justify one coherent contract:

### Option A — X4 should expect FAIL

Use this if losing Model B after attempt consumption is itself a test/control failure under the accepted gate semantics.

Then:

- rewrite X4 to expect FAIL;
- explain why BLOCKED is not valid once the attempt has started and required controls can no longer complete;
- ensure verdict examples and truth tables agree.

### Option B — dependency-blocked controls may remain non-failing

Use this only if the governing design truly intends external dependency loss to produce BLOCKED rather than FAIL.

Then define:

- which controls become `NOT_RUN_DEPENDENCY_BLOCKED` or equivalent;
- why they are exempt from mandatory-control failure;
- exactly when row-6 BLOCKED outranks/avoids row-4 FAIL;
- how this cannot mask genuine control failures;
- required evidence proving dependency loss rather than harness defect.

Do not invent a special exception solely to preserve the old X4 expected value.

Prefer the simplest contract consistent with the accepted verdict philosophy.

---

# 4. request-fatality policy

Latest Work disposition:

- treating every `console.error` as fatal matches the accepted empty allow-list;
- treating every Playwright `requestfailed` event as a required-resource failure is broader than the procedure;
- expected unload cancellation or Viewer/network noise could produce false G2 FAIL.

## Required task

Define a bounded, mechanically testable request-fatality policy.

Preserve:

- `console.error` policy unless the procedure itself requires a change;
- fail-closed treatment of genuinely required-resource failures.

The procedure must classify failed requests into at least:

### Fatal required-resource failure

Examples may include resources essential to:

- Viewer bootstrap;
- model document/manifest;
- required SVF2 geometry/property payloads;
- harness-owned required endpoint calls.

Define classification using mechanically observable properties such as:

- request URL/pattern;
- resource type;
- owning phase/check;
- whether the request is explicitly awaited/required by the harness.

### Expected/non-fatal cancellation

Define narrow cases such as:

- cancellation caused by intentional model unload;
- teardown/navigation after a check has completed;
- browser-reported cancellation/abort with explicit harness-owned causal evidence.

Do not create a broad Viewer-domain allow-list.

### Unknown failed request

Choose a fail-safe disposition.

Prefer:

- fatal unless explicitly proven to be an expected cancellation;

or another equally bounded policy justified by the procedure.

For every non-fatal request failure, require retained evidence showing why it was classified as expected.

Define:

- event fields captured;
- classification function;
- verdict effect;
- evidence schema;
- tests required for the classifier.

Do not tune the policy based on a live run.

---

# 5. Harness impact analysis only

Because the dormant harness is already committed and independently reviewed:

- do not modify it in this task;
- identify exactly which harness sections/tests would need follow-up changes after procedure reconciliation;
- classify those changes as:
  - required before live planning;
  - optional cleanup;
  - no change needed.

At minimum assess impact on:

- C15 implementation/tests;
- X4 verdict/example tests;
- requestfailed instrumentation/classifier tests;
- offline matrix/truth-table tests;
- handoff/live-readiness checks.

---

# 6. Internal review

After editing the procedure:

1. Run one focused internal review covering only:
   - C15(e) reconciliation;
   - X4 semantics;
   - request-fatality policy;
   - directly affected verdict/examples/evidence sections.
2. Fix genuine Critical/High findings within this bounded docs-only scope.
3. Do not modify the committed harness.
4. Persist the review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- procedure reconciliation status;
- whether C15(e), X4, request-fatality are technically resolved;
- exact harness follow-up changes still required;
- `LIVE_PATH_WIRED=false`;
- live G2 remains unauthorized;
- next authorized action: none / awaiting independent Work review of the procedure reconciliation.

---

# 7. Stop gate

Stop after:

- procedure reconciliation;
- focused internal review;
- handoff update.

Do not:

- edit the committed G2 harness;
- enable live path;
- run live G2;
- run real-Viewer failure injection;
- modify production code;
- start G3/H1/H2/OQ-1/host integration;
- commit or push unless separately authorized.

---

# 8. Final report

Report:

- branch / HEAD / git status;
- exact procedure sections changed;
- final C15(e) observable contract;
- final X4 disposition (`FAIL` vs dependency-blocked semantics) and rationale;
- final request-fatality classification policy;
- exact harness follow-up changes required;
- internal review findings/fixes;
- confirmation `LIVE_PATH_WIRED=false`;
- confirmation no live G2 or production changes occurred;
- confirmation nothing was committed or pushed.
