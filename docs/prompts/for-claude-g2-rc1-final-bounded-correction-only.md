# For Claude — G2 RC1 Final Bounded Correction Only

I explicitly authorize **one final bounded documentation-only correction** to the G2 ViewerBridge / DockingPanel RC1 procedure.

This authorization is limited to the latest independent Work findings:

- **H1** — global C1 gate contradiction between synthetic downstream `BLOCKED` records and the later prohibition on downstream check records;
- **M1** — correct N8 dependencies to `{C1,C4,C7,C8}` while keeping C20 excluded to avoid a cycle;
- **M2** — add a one-to-one fatal witness/count invariant for dual `requestfailed` / HTTP-response evidence sharing the same `reqId`.

It does **not** authorize harness edits, implementation changes, `LIVE_PATH_WIRED` activation, live G2, real-Viewer failure injection, production/Core/Viewer Adapter/M4/Panel changes, G3, H1/H2 host integration, OQ-1, host integration, commit/push, or authorization-record issuance.

Use the latest independent Work re-review as the governing remediation input.

## 1. Verify baseline first

Verify:

- branch `main`;
- HEAD `68ef222f097d5ff34b475fdb3980fe662574ac3d`;
- `main == origin/main`;
- dormant harness checkpoint remains unchanged;
- current working tree contains only the accepted RC1 docs/review/handoff state;
- `LIVE_PATH_WIRED=false`;
- no live G2 attempt/evidence exists.

Read `CLAUDE.md`, `docs/handoffs/latest.md`, the current corrected RC1 procedure, `docs/reviews/2026-10-01-g2-procedure-rc1-c1-corrected-independent-rereview.md`, and the latest RC1 internal review.

Do not rely on conversational summaries as proof.

## 2. H1 — reconcile the global C1 gate record semantics

The current procedure is contradictory:

- when C1 blocks, it requires synthetic downstream C2–C20 `BLOCKED` records;
- another rule then forbids downstream “check records” after the C1 gate closes.

Make the contract mechanically consistent.

Preferred model:

- no downstream check execution occurs;
- no downstream runtime result is fabricated;
- the harness emits deterministic **synthetic gate-disposition records** for downstream checks/controls to document why they did not run.

Distinguish these records by schema/type from normal executed check records.

For each downstream C2–C20 item, define fields equivalent to:

- `executed: false`;
- terminal disposition;
- normalized C1 blocking reason;
- `dependencyBlockedBy`;
- no start timestamp / no runtime evidence;
- explicit synthetic/gate-generated marker.

These records must:

- satisfy evidence completeness;
- not imply execution;
- not be mistaken for a runtime `BLOCKED` result;
- never hide a real failure after a check has started.

Update all directly affected global C1 gate rules, execution-record schema, NRDB legality, verdict rows 4/6, X4/X20–X23, evidence schema, and offline matrix requirements.

## 3. M1 — correct N8 dependencyIds

Set N8 dependencies to:

`{C1, C4, C7, C8}`

Preserve:

- N7 → `{C1, C16}`;
- C20 excluded from N8 dependencies to avoid the N8 ↔ C20 cycle.

Update dependency table, schema examples, X/matrix cases, and offline dependency tests.

Do not add new dependencies without independent justification.

## 4. M2 — one-to-one fatal witness/count invariant

The procedure records both `requestfailed` and HTTP-response failures. The same underlying request may produce multiple raw events with the same `reqId`.

Define a mechanically testable invariant:

- exactly one **fatal witness** contributes to verdict/fatal count per unique fatal request identity;
- every raw event remains retained;
- multiple raw events sharing `reqId` correlate into one fatal request record;
- no second raw event increments the fatal count again;
- disagreement uses the worse/fail-safe classification.

Define exact schemas for:

- raw request/response event;
- correlated request identity;
- fatal witness record;
- witness/fatal count.

Define correlation rules for:

- `requestfailed` only;
- HTTP >=400 only;
- both for same `reqId`;
- malformed/missing `reqId`;
- conflicting model/phase ownership;
- duplicate events.

Unknown/ambiguous correlation must remain fail-safe and must not silently suppress a fatal.

Add procedure-level test cases proving:

- one `requestfailed` => one fatal witness;
- one HTTP 500 => one fatal witness;
- both events with same `reqId` => one fatal witness, not two;
- duplicate raw events => still one fatal witness;
- conflicting classification => one fatal witness with worse classification;
- missing/invalid identity => fail-safe fatal handling.

Do not weaken the accepted HTTP >=400 default-fatal policy.

## 5. Preserve already-closed findings

Do not reopen unless this correction directly reveals a contradiction:

- C15(e) fully closed;
- `H_iso` three-clear oracle accepted;
- request classifier policy closed/fail-safe;
- HTTP >=400 fatal-by-default accepted for live planning, with known conservative false-FAIL risk;
- N7 dependencies correct;
- X4/NRDB policy direction accepted apart from this record-semantics correction;
- dormant harness unchanged;
- `LIVE_PATH_WIRED=false`.

## 6. Harness impact analysis only

Do not edit the harness.

Update the harness follow-up list so it explicitly includes:

- synthetic C1 gate-disposition records/schema;
- corrected NRDB handling;
- corrected N8 dependencies;
- one-to-one request fatal-witness correlation/counting;
- corresponding matrix/schema/static tests.

Preserve all previously accepted follow-up items.

## 7. Focused internal review

After editing:

1. Run one focused internal review only over:
   - C1 gate record semantics;
   - NRDB legality and X4;
   - N8 dependency graph;
   - request fatal-witness correlation/counting;
   - directly affected schemas/examples/matrix rules.
2. Fix genuine Critical/High findings within this documentation-only scope.
3. Do not edit the dormant harness.
4. Persist the review under `docs/reviews/`.
5. Update `docs/handoffs/latest.md`.

The handoff must state:

- final RC1 correction status;
- whether H1/M1/M2 are technically resolved;
- exact harness follow-up work;
- dormant harness unchanged;
- `LIVE_PATH_WIRED=false`;
- no live G2;
- next action: none / awaiting independent Work re-review.

## 8. Stop gate

Stop after procedure correction, focused internal review, and handoff update.

Do not modify harness code/tests, enable live path, run live G2, run real-Viewer failure injection, modify production code, issue authorization records, commit, or push.

## 9. Final report

Report:

- branch / HEAD / git status;
- exact procedure sections changed;
- final global C1 gate record model;
- exact synthetic-record schema/type distinction;
- final NRDB legality rule;
- N8 dependencyIds;
- fatal witness/count invariant;
- request-event correlation rules;
- exact harness follow-up list;
- internal review findings/fixes;
- confirmation dormant harness unchanged;
- confirmation `LIVE_PATH_WIRED=false`;
- confirmation no live run, commit, or push occurred.
