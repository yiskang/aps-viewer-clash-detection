# For Claude — G2 C13 Phase Ownership and Retained-Snapshot Completeness Fix Only

I explicitly authorize **one bounded procedure + harness/test correction** for exactly the two remaining findings from the latest independent Work review.

This authorization is limited to:

1. **High — C13 phase ownership**
   - make C13 **P8-owned everywhere**;
   - remove the current P8 execution / P7 ownership contradiction;
   - ensure the real Node authority no longer rejects C13 with `sync-activeCheck-phase-inconsistent`.

2. **Medium — retained-snapshot completeness**
   - route retained transport-fallback snapshots through the same `pageEvidenceProblems` completeness validation used for normal page evidence before failed-run R1 closeout.

It does **not** authorize:

- changing H1 sequencing;
- changing `G2_DUAL_COUNTER_GATE.resolved=true`;
- changing `LIVE_PATH_WIRED=false`;
- live planning;
- authorization-record issuance;
- live G2;
- real-Viewer failure injection;
- production/Core/Viewer Adapter/M4/Panel changes;
- G3;
- H1/H2 host integration;
- OQ-1;
- host integration;
- unrelated Low fixes;
- commit or push.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD:
  `c0f877aee82c078564efdb504bcbe695522b4ed4`
- `main == origin/main`
- current uncommitted failed-run / partial-transfer correction is still present
- current provisional procedure SHA:
  `59c27e186911074393323816532ddc5da3c35267e07408700844c5d4cc9d7b34`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record
- no production/downstream changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current G2 procedure
- `docs/reviews/2026-10-02-g2-node-authoritative-partial-transfer-independent-rereview.md`
- current C13 phase ownership metadata / phase runner
- current retained-snapshot fallback path
- relevant C13 / failed-run / page-evidence tests

If the baseline differs materially, stop and report.

## 2. High — make C13 P8-owned everywhere

Work verified that C13 currently executes in P8 while ownership metadata says P7.

That guarantees the real Node authority will reject:

`beginCheck('C13')`

with:

`sync-activeCheck-phase-inconsistent`

This must be corrected consistently across the procedure and implementation.

### Required outcome

C13 must be **P8-owned everywhere**.

Update every authoritative source of phase ownership, including as applicable:

- procedure phase/check ownership table;
- harness phase metadata;
- runtime ownership maps;
- `beginCheck` / active-check validation expectations;
- phase-order tables;
- matrix fixtures;
- static guards;
- test expectations;
- docs/handoff references that state ownership.

Do not change where C13 actually executes unless the accepted procedure itself requires that.

The intended correction is ownership alignment, not a phase redesign.

### Required invariants

After the correction:

- C13 executes in P8;
- C13 ownership metadata says P8;
- `beginCheck('C13')` is accepted in P8;
- C13 is rejected in P7 or any other phase where it is not legal;
- downstream evidence uses P8 consistently;
- no stale P7 ownership reference remains.

Run a repository-wide targeted search for C13/P7 ownership assumptions and reconcile every directly affected occurrence.

## 3. C13 tests

Add/adjust tests that prove:

1. C13 in P8 is accepted;
2. C13 in P7 is rejected;
3. Node authoritative active-check/phase validation accepts the real intended path;
4. phase matrix / ownership table and runtime metadata agree;
5. a mutation restoring P7 ownership fails the tests;
6. no unrelated check ownership changes.

Do not run live Viewer.

## 4. Medium — retained transport-fallback snapshots must pass completeness validation

The current failed-run transport fallback can use retained snapshots to preserve truthful completed history, but those retained snapshots bypass the normal:

`pageEvidenceProblems`

completeness validation.

That weakens audit completeness.

### Required outcome

Before retained transport-fallback evidence is admitted into failed-run R1:

- run the same applicable `pageEvidenceProblems` completeness/provenance checks used for normal page evidence;
- validate eventLog / spy ledger / state snapshots according to the accepted evidence contract;
- reject missing, duplicate, unsourced, mismatched, or leaked provenance exactly as normal evidence would;
- preserve fail-closed semantics.

Do not create a weaker validator specifically for failure paths.

If some checks are genuinely inapplicable to the retained snapshot shape, encode that distinction explicitly and minimally rather than skipping the whole completeness pass.

## 5. Failure semantics

If retained fallback evidence fails completeness validation:

- overall result remains FAIL;
- retain the original/root phase failure;
- add the completeness failure as an additional reason;
- do not erase already-validated completed history;
- do not fabricate missing history;
- do not allow PASS eligibility.

The reader / R1 / R2 / R3 / K path must remain schema-valid and fail closed.

## 6. Retained-snapshot tests

Add/adjust tests covering at least:

1. valid retained snapshot passes `pageEvidenceProblems`;
2. missing eventLog provenance → FAIL;
3. duplicate event provenance → FAIL;
4. unsourced spy record → FAIL;
5. snapshot provenance mismatch → FAIL;
6. leaked page ordinal → FAIL;
7. original root failure is retained alongside completeness failure;
8. completed C2/C3/N1 history remains preserved when completeness passes;
9. no duplicate history is created by fallback + normal path;
10. PASS path remains unchanged.

Include mutation/non-vacuity coverage so the tests fail if the retained fallback bypasses completeness validation again.

## 7. Procedure correction

Update only the minimum normative wording required for these two findings.

For C13:
- record P8 ownership consistently.

For retained fallback:
- state that retained transport-fallback page evidence is subject to the same applicable completeness/provenance validation before admission into durable failed-run evidence.

Do not redesign unrelated failed-run semantics.

## 8. Procedure SHA handling

Because the procedure changes:

- recompute the provisional procedure SHA after the correction;
- update only required harness/test SHA pins;
- mark `59c27e18...` stale in the handoff;
- do **not** treat the new SHA as owner-accepted;
- do **not** issue an authorization record.

## 9. Preserve already-closed work

Do not regress:

- H1 closure;
- single Node allocator;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- cleanup provenance;
- cleanup phase/transfer-stage fix;
- operation-refusal blocking/detail;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- pre-C1/post-C1/untransferred failed-run model;
- completed-result retention;
- Node-authoritative partial-result transfer;
- marker/error retention;
- request witness accounting;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

## 10. Remaining Low findings

Do not broaden scope to fix the six Low findings from the latest independent review unless directly touched by these corrections.

Preserve their current dispositions.

## 11. Verification

Run non-live verification only:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- C13 phase-ownership tests;
- retained-snapshot completeness tests;
- failed-run reader/R1/R2/R3/K tests;
- `git diff --check`.

Prior reviewed baseline:

- focused: 797/797
- aggregate: 5042 PASS / 0 FAIL / 1 TODO
- binding: 8/8

New tests may increase totals.

Do not run APS Viewer or live G2.

## 12. Focused internal review

After implementation:

1. review only:
   - C13 P8 ownership consistency;
   - Node active-check/phase enforcement for C13;
   - retained fallback completeness validation;
   - directly affected failed-run evidence paths/tests;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this bounded scope;
4. do not modify production code;
5. do not enable live.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

## 13. Stop gate

Stop after:

- bounded procedure/harness correction;
- non-live verification;
- focused internal review;
- handoff update.

Do not:

- commit or push;
- change `G2_DUAL_COUNTER_GATE.resolved`;
- change `LIVE_PATH_WIRED`;
- start live planning;
- issue authorization record;
- run live G2;
- modify production/downstream code.

Next gate:

**independent Work re-review → owner decision on procedure SHA acceptance, checkpoint commit, and live-planning readiness**

## 14. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- procedure sections changed;
- C13 ownership locations changed;
- harness/tests changed;
- retained-snapshot completeness validation design;
- new provisional procedure SHA;
- focused / aggregate / binding test results;
- internal review findings/fixes;
- remaining Medium/Lows;
- explicit confirmation:
  - `G2_DUAL_COUNTER_GATE.resolved=true`
  - `LIVE_PATH_WIRED=false`
  - no live G2
  - no authorization record
  - no production/downstream changes
  - nothing committed or pushed.
