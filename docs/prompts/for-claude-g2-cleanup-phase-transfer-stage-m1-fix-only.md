# For Claude — G2 Cleanup Phase/Transfer-Stage M1 Fix Only

I explicitly authorize **one bounded harness/test-only correction** for the remaining cleanup phase/transfer-stage mismatch identified by the latest independent Work review.

This authorization is limited to:

- accepting a valid `phase:'cleanup'` event that occurs after the cleanup marker even if it traveled in the run-stage transfer;
- preserving the existing bidirectional cleanup provenance guarantees;
- preserving duplicate/identity/source validation;
- adding/adjusting only directly related harness tests;
- focused internal review and handoff update.

It does **not** authorize:

- changing the accepted procedure;
- changing the single Node authoritative allocator;
- changing operation-refusal behavior, which is already closed;
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
- expected HEAD: `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`
- `main == origin/main`
- current H1 remediation working-tree changes are still present
- accepted procedure SHA unchanged
- `G2_DUAL_COUNTER_GATE.resolved=false`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- `docs/reviews/2026-10-02-g2-cleanup-event-provenance-independent-rereview.md`
- current harness
- current cleanup-evidence tests
- current cross-realm/sequencing tests

If the baseline differs materially, stop and report.

## 2. Fix only the phase/transfer-stage mismatch

The current harness rejects a valid cleanup-phase event when:

- the event occurs after the cleanup marker;
- its semantic phase is `cleanup`;
- but it is still carried inside the earlier run-stage transfer batch.

That creates a realizable conservative false FAIL via `cleanup-event-outside-drain`.

This must be corrected without weakening cleanup provenance.

### Required rule

A page event is a valid cleanup event when its **semantic cleanup boundary** proves it belongs to cleanup, even if its transport batch/stage was `run`.

Do not equate transport stage with semantic phase.

The implementation must distinguish:

- **transport stage** — which transfer batch carried the event;
- **semantic phase** — when the event actually occurred relative to the cleanup marker.

A `phase:'cleanup'` event that is provably after the cleanup marker may be sourced from either:

- cleanup-stage drain; or
- the tail of the run-stage transfer that crossed the marker boundary.

This exception must be narrow and mechanically proven.

## 3. Provenance must remain strict

Preserve the already accepted bidirectional invariants:

- every mandatory cleanup source ordinal maps to exactly one authoritative cleanup event;
- every authoritative cleanup event maps back to exactly one ingested source ordinal;
- Node `seq` remains the sole authoritative order;
- no page ordinal leaks into authoritative state;
- no duplicate merge;
- no unsourced authoritative event;
- no missing source event;
- no identity mismatch.

The fix must **not** broadly allow arbitrary run-stage events to count as cleanup.

## 4. Boundary proof

Define the minimum evidence required for a run-stage-carried event to qualify as cleanup:

- event semantic `phase === 'cleanup'`;
- event occurred after the authoritative cleanup marker/boundary;
- its source ordinal/Node seq ordering is consistent with that boundary;
- its provenance identity remains valid;
- the event is not already represented in cleanup-stage drain evidence.

If any of these cannot be proven, retain fail-closed behavior.

Do not use transport-stage membership alone as either acceptance or rejection.

## 5. Validation changes

Update cleanup provenance validation so:

### Valid
- cleanup-stage source + cleanup phase → valid;
- run-stage source + cleanup phase + proven post-marker ordering → valid.

### Invalid
- run-stage source + cleanup phase but before marker → FAIL;
- run-stage source + cleanup phase with unknown ordering → FAIL;
- same event appears in both run and cleanup transfer → FAIL;
- identity/provenance mismatch → FAIL;
- missing authoritative event → FAIL;
- unsourced authoritative cleanup event → FAIL;
- page ordinal leak → FAIL.

Use stable problem labels.

If `cleanup-event-outside-drain` is no longer correct for the valid cross-boundary case, retain it only for genuinely invalid cases or replace it with a more precise label.

## 6. Tests

Add focused tests that would fail before this fix.

At minimum cover:

1. cleanup-phase event in cleanup-stage transfer → PASS;
2. cleanup-phase event in run-stage transfer, proven after cleanup marker → PASS;
3. cleanup-phase event in run-stage transfer, before marker → FAIL;
4. cleanup-phase event in run-stage transfer, ordering unknown → FAIL;
5. same event appears in both run and cleanup transfer → FAIL;
6. identity/provenance mismatch → FAIL;
7. missing authoritative event → FAIL;
8. unsourced authoritative cleanup event → FAIL.

Keep existing provenance mutation/non-vacuity tests intact.

Run:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- cleanup-evidence tests;
- sequencing/static guards;
- `git diff --check`.

Prior reviewed baseline:

- focused: 652/652 PASS
- aggregate: 4897 PASS / 0 FAIL / 1 TODO
- binding: 8/8 PASS

New tests may increase totals.

## 7. Preserve all closed work

Do not regress:

- single Node authoritative allocator;
- real Playwright binding test;
- cleanup bidirectional provenance;
- operation-refusal blocking;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- C15(e) `H_iso` oracle;
- global C1 gate;
- NRDB/effective-state semantics;
- N7/N8 dependencies;
- request fatal-witness accounting;
- authoritative K closeout.

## 8. Remaining findings

Do not broaden this task to fix unrelated findings.

Preserve for later review:

- Medium: failed-phase cleanup retention;
- Medium: durable operation-refusal detail;
- Medium: broader local-counter static guarding;
- Low findings recorded by Work.

If this correction incidentally resolves one of them, note it and add a regression test; otherwise leave it untouched.

## 9. Focused internal review

After implementation:

1. run one focused internal review over only:
   - phase/transfer-stage distinction;
   - cleanup marker boundary proof;
   - provenance validation changes;
   - directly affected tests;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this harness-only scope;
4. do not change procedure or production code;
5. do not flip either gate.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

The handoff must state:

- M1 phase/transfer-stage correction status;
- whether cleanup provenance now appears fully closed;
- whether H1 now appears technically closed;
- both gates remain false;
- live planning remains unauthorized;
- next action: none / awaiting targeted independent Work re-review.

## 10. Stop gate

Stop after:

- bounded harness/test correction;
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

**targeted independent ChatGPT Work re-review → owner decision on H1 closure, gate resolution, and checkpoint commit**

## 11. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- files modified/created;
- semantic phase vs transport-stage model;
- cleanup-marker boundary proof;
- validation-rule changes;
- exact new/updated failure labels;
- focused / aggregate / binding test results;
- internal review findings/fixes;
- whether cleanup provenance appears fully closed;
- whether H1 appears fully closed;
- remaining Medium/Lows;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=false`
  - `LIVE_PATH_WIRED=false`
  - no live G2
  - no authorization record
  - no production/downstream changes
  - nothing committed or pushed.
