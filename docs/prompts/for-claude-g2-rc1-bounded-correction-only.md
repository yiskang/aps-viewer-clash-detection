# For Claude — G2 RC1 Bounded Correction Only

I explicitly authorize **one bounded documentation-only RC1 correction** for the G2 ViewerBridge / DockingPanel live-verification procedure.

This authorization is limited to correcting the latest independent Work findings:

- High 1 — C15(e) hidden-state contradiction
- High 2 — HTTP 4xx/5xx failures missing from the fatal ledger
- Medium 1 — exact NRDB/X4 `executionRecord` schema
- Medium 2 — exact NRDB/X4 `dependencyBlockedBy` schema and legality
- Medium 3 — durable request-prefix provenance / ambiguous-prefix accounting / `boundPrefix` / load-vs-mutation operation-ledger shapes

It does **not** authorize:

- harness edits;
- implementation changes;
- `LIVE_PATH_WIRED` activation;
- live G2;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- commit or push;
- authorization-record issuance.

Use the latest independent reconciliation review as the governing remediation input.

---

## 1. Verify baseline first

Verify:

- branch `main`;
- HEAD `68ef222f097d5ff34b475fdb3980fe662574ac3d`;
- `main == origin/main`;
- dormant harness checkpoint remains committed and unchanged;
- working tree contains only the current docs/review/handoff reconciliation state;
- `LIVE_PATH_WIRED=false`;
- no live G2 attempt/evidence exists.

Read:

- `CLAUDE.md`;
- `docs/handoffs/latest.md`;
- current G2 procedure;
- `docs/reviews/2026-10-01-g2-procedure-reconciliation-independent-review.md`;
- `docs/reviews/2026-10-01-g2-procedure-reconciliation-internal-review.md`;
- actual ViewerBridge source where C15 semantics need verification.

If the committed harness or production implementation has changed unexpectedly, stop.

---

# 2. C15(e) — correct hidden-state semantics

The current RC1 incorrectly requires hidden nodes to be empty immediately after failed clear #1.

That contradicts the isolation-derived hidden-state behavior already acknowledged by C10.

Correct C15(e) using the actual observable sequence.

## Required state capture

After presenting/applying the Panel isolation, capture the post-present observable hidden/isolation state as:

`H_iso`

Use the exact public Viewer read(s) permitted by the accepted procedure.

Do not require a particular hidden-node representation if the Viewer runtime does not guarantee one; define the observable consistently with C10.

## Three-clear oracle

Define:

### Clear #1 — injected failure

- failure injection throws **before** invoking the original `setAggregateIsolation`;
- `clear()` returns the expected failed outcome;
- the Panel isolation remains applied;
- the post-clear observable hidden/isolation state must remain equivalent to captured `H_iso`, not baseline-empty.

### Clear #2 — retry succeeds

- injection is disarmed;
- `clear()` returns the expected restored outcome;
- Viewer isolation/hidden state returns to the documented baseline-empty state;
- restoration is attributable to the bridge-owned retry path.

### Clear #3 — idempotent/no retained retry

- `clear()` returns the expected `none` outcome;
- Viewer remains baseline-empty;
- this proves the retained retry record was dropped after successful restoration.

## Evidence

Define exact retained fields for:

- captured `H_iso`;
- state after clear #1;
- state after clear #2;
- state after clear #3;
- each `ClearOutcome`;
- injection state;
- equality/comparison rule.

Do not use post-clear `inspectLedger()` as a required oracle.

Keep it setup-only/diagnostic if already justified.

Add/update mutation tests in the procedure specification so they would fail if:

- clear #1 incorrectly expects baseline-empty;
- clear #2 fails to restore baseline;
- clear #3 still behaves as if retry state remained.

---

# 3. HTTP 4xx/5xx — add fail-closed response evidence

`requestfailed` does **not** fire simply because an HTTP response is 4xx/5xx.

Therefore the procedure must separately observe HTTP responses.

Add fail-closed response instrumentation and classification for required resources.

## Required response evidence

Capture, at minimum:

- URL;
- method;
- HTTP status;
- resource type;
- owning phase/check;
- model binding if applicable;
- operation ledger reference;
- whether the response is classified as required or optional.

## Fatal rule

A 4xx/5xx response for a **required resource** must feed row-1 fatal handling.

Required-resource examples should be mechanically scoped to things such as:

- Viewer bootstrap assets required for the run;
- model document/manifest resources;
- required SVF2 geometry/property resources;
- harness-owned required endpoints.

Do not classify all 4xx/5xx globally without ownership/requirement evidence.

## Non-required responses

Define how optional/non-required HTTP failures are retained diagnostically without silently hiding required failures.

Unknown/unclassifiable responses should remain fail-safe.

Add procedure-level tests proving:

- required 404 => fatal;
- required 500 => fatal;
- optional/non-required response follows its declared non-fatal/diagnostic rule;
- ambiguous ownership cannot become non-fatal by default.

Keep `console.error` policy unchanged unless the governing procedure requires otherwise.

---

# 4. NRDB/X4 — define exact schemas

Option B / `NOT_RUN_DEPENDENCY_BLOCKED` remains the intended direction, but mechanical closure requires exact evidence shapes.

Define exact schema for each control/check execution record.

## `executionRecord`

Specify required fields, including as applicable:

- check/control id;
- started/not-started;
- start timestamp;
- terminal timestamp;
- terminal state;
- owning phase;
- dependency ids;
- evidence references;
- failure/control result;
- whether execution ever crossed its start boundary.

The legality test for NRDB must be mechanically decidable from this record.

## `dependencyBlockedBy`

Define exact structure, including:

- blocking check id, expected to be C1 in this case;
- blocking state;
- normalized reason;
- timestamp;
- evidence reference;
- whether the dependency failed before the dependent control started.

NRDB is legal only when the procedure-defined dependency condition is satisfied and the control **never started**.

No mid-run failure, taint, timeout, or partially executed control may be relabeled NRDB.

## C1 normalized reasons

Define the exact normalized C1 reasons needed for X4, including at least the already-reviewed categories:

- prerequisite block;
- load-timeout block.

Do not leave free-form strings as the verdict input.

---

# 5. Global C1 gate — procedure contract

The independent review found that P2/N1 can currently proceed even after C1 is blocked.

The procedure must explicitly require a **global C1 gate** before any downstream live check/control starts.

Define:

- which checks/controls are downstream of C1;
- the exact gate point;
- behavior when C1 is PASS;
- behavior when C1 is BLOCKED with a legal dependency reason;
- behavior when C1 FAILs;
- how not-started controls are recorded.

This is procedure-only in this task.

Do not modify the harness yet.

---

# 6. Request classifier provenance and ledger schemas

Mechanical request classification requires durable causal evidence.

Define exact schemas for:

## Successful-request / prefix-source evidence

For each model load window, retain:

- model identity;
- observed successful request URLs used to derive model-specific prefixes;
- derivation rule;
- resulting prefix set;
- evidence hash/reference.

A prefix must not be accepted merely because it appears temporally near a load.

## Ambiguous-prefix accounting

Define:

- what counts as ambiguous;
- exact evidence retained;
- classifier result when prefixes overlap or cannot distinguish models.

Ambiguous model binding must remain fatal/fail-safe.

## `boundPrefix`

Add `boundPrefix` to the declared classifier result when classification depends on prefix binding.

Define null/absent semantics for cases where no valid prefix binding exists.

## Operation ledger

Define separate exact record shapes for:

### Load operation

Fields should identify:

- operation id;
- model id;
- phase;
- start/end;
- expected request window;
- successful-prefix evidence;
- completion outcome.

### Mutation operation

For hide/unload/teardown:

- operation id;
- operation type;
- model id if applicable;
- start/end;
- cancellation window;
- causal evidence;
- terminal outcome.

Expected-cancellation classification must bind to one of these explicit operation records.

Temporal overlap alone is insufficient.

---

# 7. Request classifier result

Define a complete classifier result schema including at least:

- event kind (`requestfailed` vs HTTP response failure);
- URL;
- method/status/failure reason as applicable;
- resource type;
- phase;
- model id if bound;
- `boundPrefix`;
- operation id;
- classification:
  - fatal-required-resource;
  - expected-cancellation;
  - diagnostic/non-required, if permitted;
  - unknown/fatal;
- evidence references;
- verdict effect.

No unknown/unclassifiable event may silently become non-fatal.

---

# 8. Harness impact analysis only

Do not edit the harness.

Update the impact analysis to enumerate exact follow-up implementation work required after procedure acceptance.

At minimum:

- C15 three-clear oracle + tests;
- `H_iso` capture/comparison;
- NRDB state/schema;
- normalized C1 reasons;
- global C1 gate;
- X4/X20–X23 updates;
- requestfinished/requestfailed/response instrumentation;
- HTTP 4xx/5xx handling;
- operation ledgers;
- prefix-source evidence;
- ambiguous-prefix accounting;
- `boundPrefix`;
- schema and offline classifier tests;
- procedure SHA rebinding.

Also preserve the previously identified M1/M2 static-guard hardening as **before-live-execution** work unless the independent review changes that disposition.

---

# 9. Internal review

After editing:

1. Run one focused internal review over only:
   - C15 hidden-state semantics;
   - HTTP-response fatal evidence;
   - NRDB schemas/global C1 gate;
   - request provenance/classifier/operation ledgers.
2. Fix genuine Critical/High findings within this documentation-only scope.
3. Do not edit the harness.
4. Persist the review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- RC1 correction status;
- whether C15, X4/NRDB, and request-fatality are technically resolved;
- exact harness follow-up work;
- dormant harness remains unchanged;
- `LIVE_PATH_WIRED=false`;
- no live G2;
- next action: none / awaiting independent Work re-review.

---

# 10. Stop gate

Stop after:

- procedure correction;
- internal review;
- handoff update.

Do not:

- modify harness code/tests;
- enable live path;
- run live G2;
- run real-Viewer failure injection;
- modify production code;
- issue authorization records;
- commit or push.

---

# 11. Final report

Report:

- branch / HEAD / git status;
- exact procedure sections changed;
- corrected C15 `H_iso` contract;
- HTTP 4xx/5xx fatal-response policy;
- NRDB `executionRecord` schema;
- `dependencyBlockedBy` schema;
- global C1 gate;
- prefix-source evidence schema;
- ambiguous-prefix rule;
- `boundPrefix` schema;
- load/mutation operation-ledger schemas;
- exact harness follow-up list;
- internal review findings/fixes;
- confirmation dormant harness unchanged;
- confirmation `LIVE_PATH_WIRED=false`;
- confirmation no live run, commit, or push occurred.
