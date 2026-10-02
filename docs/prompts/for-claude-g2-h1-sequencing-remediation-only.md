# For Claude — G2 H1 Sequencing Remediation Only

I explicitly authorize **one bounded G2 H1 sequencing remediation pass only** against the committed/pushed live-readiness checkpoint.

The purpose of this task is to close the remaining H1 sequencing contract mismatch by bringing the harness implementation into alignment with the already accepted procedure.

This authorization is limited to:

- replacing the current composite/fenced Node/page sequencing model with the accepted **single authoritative Node-side sequence allocator**;
- correcting any directly related phase-attribution logic;
- adding one **non-APS local Playwright binding integration test** that exercises the real Playwright page↔Node binding/scheduling mechanism without loading Autodesk Viewer or consuming any G2 live attempt;
- updating directly affected offline/static tests;
- focused internal review and handoff update.

It does **not** authorize:

- changing the accepted procedure to accommodate the existing composite/fenced ordering model;
- flipping `G2_DUAL_COUNTER_GATE.resolved`;
- enabling `LIVE_PATH_WIRED`;
- live planning;
- live G2 execution;
- real-Viewer failure injection;
- authorization-record issuance;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- production/Core/Viewer Adapter/M4/Panel changes;
- unrelated cleanup;
- commit or push unless separately authorized.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`
- `main == origin/main`
- working tree clean
- accepted procedure SHA-256:
  `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`
- `LIVE_PATH_WIRED=false`
- `G2_DUAL_COUNTER_GATE.resolved=false`
- no live G2 attempt/evidence exists
- no authorization record exists

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- accepted G2 procedure
- latest independent live-readiness review
- latest live-readiness internal review
- current harness and sequence/phase tests

Note: the handoff may still contain stale wording that the previous checkpoint was "not pushed". Since `main == origin/main == b33b7a9`, correct that wording as part of this task's normal handoff update; do not create a separate cleanup-only change.

If the baseline differs materially, stop and report.

## 2. H1 — implement one authoritative Node-side sequence allocator

The accepted procedure requires one authoritative Node-side allocator for verdict-bearing event ordering.

The current composite page-major / Node-minor namespace must no longer be the authoritative sequencing mechanism.

### Required architecture

All verdict-bearing events, regardless of origin, must receive their authoritative sequence number from one Node-owned allocator.

Preferred model:

1. page observes a raw event;
2. page sends the raw event payload to Node without assigning an authoritative sequence number;
3. Node ingests the event;
4. Node assigns the next authoritative monotonic sequence number;
5. Node attaches/validates:
   - source realm;
   - authoritative phase;
   - active check/control;
   - operation id, if applicable;
6. only the Node-normalized event enters the authoritative ledger.

Node-origin events use the same allocator.

### Required invariants

The allocator must guarantee:

- globally unique sequence values;
- strictly monotonic allocation;
- one namespace for Node-origin and page-origin events;
- deterministic ingestion order at the Node boundary;
- no page-local authoritative counter;
- no merge/reconciliation of independently allocated Node/page sequences;
- no collision possibility;
- no ambiguity about which event came first **within the authoritative ledger**.

If a page-local diagnostic counter is retained, it must be explicitly non-authoritative and must not participate in verdict ordering.

## 3. Cross-realm ingestion semantics

Define one explicit ingestion API/path for page-origin verdict-bearing events.

The page-to-Node path must:

- be awaited where the procedure requires a synchronization boundary;
- return success/failure explicitly;
- fail closed if the event cannot be ingested;
- prevent the attributed Viewer action from starting if phase/check synchronization is refused or fails.

Do not allow fire-and-forget delivery for verdict-bearing evidence.

### Ordering boundary

The authoritative ordering point is Node ingestion.

Document in implementation/tests that:

- events are ordered by Node ingestion sequence;
- the harness does not claim causal ordering stronger than what the accepted procedure requires;
- no secondary composite order is needed after ingestion.

## 4. Phase attribution

The authoritative Node ledger must assign/validate phase attribution.

Before page-side attributed actions such as:

- hide
- unload
- teardown
- other mutation actions covered by the operation ledger

the page must synchronize the intended phase/check/operation state with Node.

Required behavior:

- Node acknowledges the phase/check/operation transition;
- only after successful acknowledgement may the action begin;
- subsequent page-origin request/response/failure events are attributed against the acknowledged authoritative state;
- stale P1 attribution must be impossible for hide/unload/teardown operations.

Add tests proving:

- refused sync prevents action start;
- hide events get hide/mutation phase;
- unload events get unload/mutation phase;
- teardown events get cleanup/teardown phase;
- phase state does not leak into later unrelated operations.

## 5. Authoritative ledger integration

Preserve the already accepted Node-side authoritative fatal ledger.

The new sequence allocator must integrate with:

- request observations;
- response observations;
- requestfailed;
- requestfinished;
- fatal witness correlation;
- pending-response finalization;
- C1 gating;
- closeout recomputation.

Every authoritative ledger entry must carry the Node-assigned sequence.

Do not reintroduce any page-authoritative fatal mirror.

The page mirror may remain diagnostic/early-abort only if it cannot affect the authoritative verdict.

## 6. Local Playwright binding integration test

Add one **non-APS, non-Viewer** Playwright integration test using a blank/local page and the real Playwright page↔Node binding mechanism.

This test is required to close the remaining scheduling evidence gap.

It must not:

- load Autodesk Viewer;
- load Mechanical/Structure fixtures;
- touch APS;
- consume a live G2 attempt;
- require a live authorization record.

### Minimum coverage

Use real Playwright binding/exposed-function mechanics to verify:

1. page emits multiple awaited events;
2. Node receives and sequences them with the single allocator;
3. interleaved Node-origin events use the same allocator;
4. resulting authoritative sequence is unique and monotonic;
5. awaited phase-sync is observed before the simulated page action proceeds;
6. a rejected phase-sync prevents the page action;
7. delayed binding completion does not produce a second sequence namespace;
8. late/failing binding delivery is fail closed.

Add a negative case that would have exposed the old dual-counter/composite design if reintroduced.

The test may use a local HTML/data URL or equivalent non-network fixture.

## 7. Static guards

Add/update static guards so they fail if future changes reintroduce:

- an authoritative page-side sequence allocator;
- two independent authoritative counters;
- composite page-major/Node-minor verdict ordering;
- direct verdict use of a page-local sequence;
- non-awaited verdict-bearing page→Node delivery where an awaited boundary is required.

Keep guards narrowly tied to the accepted sequencing contract.

## 8. `G2_DUAL_COUNTER_GATE.resolved`

Do **not** flip this flag in this task.

The implementation and tests may make the gate technically ready to flip, but that decision belongs to the next independent Work review.

Leave:

`G2_DUAL_COUNTER_GATE.resolved=false`

Report whether the implementation now appears technically ready for independent confirmation.

## 9. Low findings

Do not broaden this task to fix the four Low findings unless a tiny local change is strictly necessary for H1 sequencing correctness.

Preserve their current dispositions:

- active-control phase validation;
- teardown C-e proxy;
- C15(e) FAIL routing;
- `T_iso` evidence authority.

If H1 work incidentally resolves the active-control phase-validation Low, note it explicitly and add a regression test.

Do not touch the other Lows unless required by the sequencing architecture.

## 10. Preserve other closed work

Do not regress:

- H2 authoritative Node fatal ledger;
- item 24 pending-response finalization;
- C15(e) `H_iso` oracle;
- global C1 gate;
- gate-disposition / effective-state semantics;
- NRDB;
- N7/N8 dependencies;
- one-fatal-witness-per-trustworthy-request identity;
- HTTP >=400 default-fatal;
- prefix provenance / operation ledgers;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

If H1 remediation requires a procedure change, stop and report rather than changing the procedure.

## 11. Verification

Run offline/non-live verification only.

At minimum:

- focused G2 suite;
- aggregate offline suite;
- new single-allocator tests;
- new phase-attribution tests;
- local Playwright binding integration test;
- static sequencing guards;
- authoritative-ledger regression tests;
- `git diff --check`.

Prior checkpoint baseline:

- focused: 542/542 PASS
- aggregate: 4788 total / 4787 PASS / 0 FAIL / 1 TODO

New tests may increase totals.

Do not run APS Viewer or live G2.

## 12. Focused internal review

After implementation:

1. run one focused internal review over:
   - single Node-side allocator;
   - cross-realm ingestion;
   - phase attribution;
   - Playwright binding integration test;
   - sequencing static guards;
   - directly affected authoritative-ledger paths;
2. classify Critical / High / Medium / Low findings;
3. fix genuine Critical/High defects within this bounded harness scope;
4. do not modify production code;
5. do not flip either live gate.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- H1 remediation status;
- local Playwright binding test result;
- whether H1 appears technically closed;
- `G2_DUAL_COUNTER_GATE.resolved=false` pending independent Work decision;
- `LIVE_PATH_WIRED=false`;
- remaining Low findings;
- remaining before-live-execution hardening;
- next action: none / awaiting independent Work review.

Also correct any stale "not pushed" checkpoint wording now that `main == origin/main == b33b7a9`.

## 13. Commit policy

Do not commit or push unless separately authorized.

Leave the complete working tree available for independent Work review.

## 14. Stop gate

Stop after:

- H1 implementation remediation;
- local Playwright binding test;
- offline verification;
- focused internal review;
- handoff update.

Do not:

- set `G2_DUAL_COUNTER_GATE.resolved=true`;
- set `LIVE_PATH_WIRED=true`;
- start live planning;
- issue authorization records;
- run live G2;
- run real-Viewer failure injection;
- start G3/H1/H2/OQ-1/host integration;
- modify production code;
- commit or push.

The next gate is:

**independent ChatGPT Work review of H1 remediation → owner decision on gate resolution and checkpoint commit**

## 15. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- working-tree state;
- exact files modified/created;
- single Node-side allocator design;
- page→Node ingestion design;
- phase-attribution changes;
- local Playwright binding test design/result;
- static guards added;
- focused and aggregate offline test results;
- internal review findings/fixes;
- whether H1 appears technically closed;
- whether active-control phase-validation Low was affected;
- remaining Low findings;
- remaining before-live-execution work;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=false`
  - `LIVE_PATH_WIRED=false`
  - no live G2
  - no authorization record
  - no production/downstream changes
  - nothing committed or pushed.
