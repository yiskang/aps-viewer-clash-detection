# For Claude — G2 Cleanup Event Provenance Fix Only

I explicitly authorize **one bounded harness/test remediation pass only** for the remaining H1 cleanup-event provenance defect identified by the latest independent Work review.

This authorization is limited to:

- reverse-validating cleanup `eventLog` provenance so every authoritative cleanup event is sourced by an ingested page ordinal exactly once;
- making unsourced, duplicate, missing, or inconsistent cleanup-event provenance fail closed;
- adding/adjusting only directly related harness tests;
- focused internal review and handoff update.

It does **not** authorize:

- changing the accepted procedure;
- changing operation-refusal behavior that Work has already accepted as closed;
- flipping `G2_DUAL_COUNTER_GATE.resolved`;
- enabling `LIVE_PATH_WIRED`;
- live planning;
- authorization-record issuance;
- live G2;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- commit or push unless separately authorized.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD:
  `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`
- `main == origin/main`
- accepted procedure SHA unchanged
- current H1 remediation working-tree changes are still present
- `G2_DUAL_COUNTER_GATE.resolved=false`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- latest independent H1 cleanup/op-refusal re-review
- current harness
- current cleanup-evidence tests
- current cross-realm/sequencing tests

If baseline differs materially, stop and report.

## 2. Remaining H1 defect — cleanup eventLog provenance

The original cleanup-transfer defect is closed, but Work found that authoritative cleanup `eventLog` records are not reverse-validated against the ingested page ordinals that sourced them.

This must be fixed mechanically.

### Required invariant

For every authoritative cleanup `eventLog` record:

- there must be exactly one corresponding ingested page ordinal;
- that page ordinal must have been part of the cleanup drain;
- that ordinal must map to exactly one Node-authoritative sequence;
- no authoritative cleanup event may exist without source provenance;
- no source ordinal may unexpectedly produce multiple authoritative cleanup events;
- no ingested mandatory cleanup event may disappear from authoritative state.

The reverse direction matters:

- page source → authoritative event
- authoritative event → page source

Both must be complete and one-to-one according to the accepted record model.

## 3. Provenance fields

If not already explicit, add only the minimum harness-side provenance needed to make the invariant mechanically testable.

For each authoritative cleanup `eventLog` entry, retain enough information to identify:

- source page ordinal;
- Node-authoritative sequence;
- source record kind;
- cleanup phase / operation;
- source realm;
- ingestion batch/drain identity if useful.

Do not create a second sequencing authority.

The Node-assigned authoritative `seq` remains the verdict-ordering sequence.

## 4. Reverse validation

Extend the cleanup completeness validation so it checks all relevant cleanup evidence classes, including `eventLog`.

At minimum detect:

- authoritative cleanup event with no source ordinal;
- source ordinal with no authoritative event;
- same source ordinal mapped to multiple authoritative events unexpectedly;
- duplicate authoritative event with same source provenance;
- authoritative event whose source ordinal was not in the cleanup drain;
- leaked page ordinal;
- mismatched seq/source mapping;
- cleanup event merged twice.

Each violation must fail closed through the existing cleanup-evidence fatal path.

Use stable, specific problem labels so tests can distinguish the cases.

Do not weaken the existing spy/snapshot completeness checks.

## 5. Preserve accepted H1 architecture

Do not regress:

- single Node-owned authoritative allocator;
- page ordinals non-authoritative only;
- cleanup drain before page close;
- Node remapping through the allocator;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- real Playwright binding test;
- operation-refusal blocking, which Work has fully closed;
- no page-local authoritative counter;
- `G2_DUAL_COUNTER_GATE.resolved=false`;
- `LIVE_PATH_WIRED=false`.

Do not alter the accepted procedure unless the implementation proves the contract impossible. If that happens, stop and report.

## 6. Tests

Add focused tests that would fail before this fix.

At minimum cover:

1. complete one-to-one cleanup event provenance → PASS;
2. authoritative cleanup event with no source ordinal → FAIL;
3. source ordinal missing from authoritative `eventLog` → FAIL;
4. duplicate authoritative cleanup event for one source → FAIL;
5. cleanup event sourced from ordinal not in the drain → FAIL;
6. duplicate merge / same event merged twice → FAIL;
7. page ordinal leak remains detected;
8. normal spy/snapshot completeness still passes.

Keep tests non-live.

Re-run:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- cleanup-evidence tests;
- sequencing/static guards;
- `git diff --check`.

Prior reviewed baseline:

- focused: 613/613 PASS
- aggregate: 4858 PASS / 0 FAIL / 1 TODO
- binding: 8/8 PASS

New tests may increase totals.

## 7. Medium / Low findings

Do not broaden this task to fix unrelated findings unless directly required by provenance correctness.

Preserve current dispositions for:

- Medium: static guards cannot detect every consumer-local counter;
- Low: active-control phase validation;
- Low: teardown C-e proxy;
- Low: C15(e) FAIL routing;
- Low: `T_iso` evidence authority;
- Low: refused `ops.end` leaves record unsettled;
- Low: thrown drain RPC lacks exact error name.

If any is incidentally resolved, note it and add a regression test.

## 8. Focused internal review

After implementation:

1. run one focused internal review over only:
   - cleanup `eventLog` provenance;
   - reverse validation;
   - completeness/fail-closed behavior;
   - directly affected cleanup merge logic/tests;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this harness-only scope;
4. do not change procedure or production code;
5. do not flip either gate.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- cleanup provenance remediation status;
- whether H1 now appears technically closed;
- operation-refusal High remains closed;
- both gates remain false;
- live planning still unauthorized;
- next action: none / awaiting independent Work re-review.

## 9. Stop gate

Stop after:

- cleanup provenance fix;
- non-live verification;
- focused internal review;
- handoff update.

Do not:

- commit or push;
- flip `G2_DUAL_COUNTER_GATE.resolved`;
- enable `LIVE_PATH_WIRED`;
- start live planning;
- issue authorization record;
- run live G2;
- modify production/downstream code.

The next gate is:

**independent ChatGPT Work re-review → owner decision on H1 closure, gate resolution, and checkpoint commit**

## 10. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- files modified/created;
- cleanup event provenance model;
- reverse-validation rules;
- exact new fail-closed problem labels;
- focused / aggregate / binding test results;
- internal review findings/fixes;
- whether H1 appears closed;
- remaining Medium/Lows;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=false`
  - `LIVE_PATH_WIRED=false`
  - no live G2
  - no authorization record
  - no production/downstream changes
  - nothing committed or pushed.
