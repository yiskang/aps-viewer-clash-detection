# For Claude — G2 Completed-Phase Result Retention Fix Only

I explicitly authorize **one bounded procedure + harness/test correction** for the remaining post-C1 failed-run evidence defect identified by the latest independent Work review.

This authorization is limited to:

1. **High** — persist completed same-phase check/control results **before** the final attribution-clear fence so a later fence failure cannot erase already-completed C2/C3/N1 or equivalent history.
2. Update only the minimum failed-run procedure wording, harness logic, and tests required by that correction.
3. Focused internal review and handoff update.

It does **not** authorize:

- changing H1 sequencing, which remains closed;
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
- current uncommitted failed-run correction is still present
- current provisional procedure SHA:
  `01ab35879ba8ce50bcec267b1257a1008ddc1892e012e9961bf5eb1acfa18d0a`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record
- no production/downstream scope changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current G2 procedure
- `docs/reviews/2026-10-02-g2-post-c1-failed-run-evidence-independent-rereview.md`
- current failed-run harness/reader/closeout code
- current failed-run tests

If the baseline differs materially, stop and report.

## 2. High — completed same-phase history must survive a later fence failure

The current failure path can lose results that were already returned/completed in the same phase when the subsequent Node attribution-clear fence fails.

Work reproduced loss of:

- completed `C2`
- completed `C3`
- completed `N1`

That violates the accepted truthful post-C1 history contract.

### Required invariant

Once a check/control result has completed sufficiently to become part of authoritative execution history, that result must be persisted into Node-owned failed-run state **before** any later attribution-clear fence can fail.

A later fence failure may add the terminal/root failure reason, but it must never erase already-completed same-phase results.

## 3. Required execution ordering

Refactor the affected phase runner so the logical order is:

1. execute the check/control;
2. validate/normalize its result;
3. persist the completed result into authoritative Node-owned phase history;
4. only then run the final attribution-clear / synchronization fence;
5. if that fence fails:
   - retain the already-persisted completed result;
   - record the fence failure as the phase-run failure;
   - close out as FAIL;
   - preserve all prior history.

Do not defer authoritative persistence of completed results until after the final attribution-clear fence.

## 4. Scope of retained history

Apply the rule to every completed same-phase record type that can be lost through this path, including as applicable:

- completed check records;
- completed control records;
- terminal state;
- evidence references;
- authoritative Node seq values;
- markers/timeline needed to prove completion.

Do not fabricate a result for work that had not completed.

Not-started work remains not-started/blocked under the accepted failed-run model.

## 5. Procedure correction

Update only the minimum procedure wording necessary to make the ordering explicit.

The procedure must state that:

- completed phase results are committed to authoritative history before the attribution-clear fence;
- fence failure does not roll back completed history;
- post-C1 failed-run R1 preserves completed same-phase results plus the later fence failure;
- PASS remains impossible because `phaseRunFailure != null`.

Do not otherwise redesign the failed-run evidence model.

## 6. `phaseRunFailure` relationship

Ensure the fence failure record is consistent with retained history.

Validate:

- failure occurs after the preserved completed result(s);
- `failureSeq` is ordered after the last completed retained result where applicable;
- active check/control attribution reflects the fence failure point truthfully;
- previously completed C2/C3/N1 or equivalent records remain unchanged.

## 7. Required tests

Add/adjust tests covering at least:

1. C2 completes, final attribution-clear fence fails → C2 remains in failed-run R1;
2. C2 and C3 complete, fence fails → both remain;
3. N1 completes, fence fails → N1 remains;
4. mixed completed check/control history survives the fence failure;
5. work not yet completed is not fabricated;
6. fence failure is preserved as root/terminal failure;
7. reader reconstructs FAIL while preserving completed history;
8. PASS path remains unchanged;
9. post-C1 history validation rejects rollback/erasure;
10. sequence ordering proves completed result precedes fence failure.

Use mutation/non-vacuity tests so the suite would fail if authoritative persistence is moved back after the fence.

## 8. Preserve already-closed work

Do not regress:

- H1 closure;
- single Node allocator;
- `G2_DUAL_COUNTER_GATE.resolved=true`;
- cleanup provenance;
- cleanup phase/transfer-stage fix;
- operation-refusal blocking/detail;
- authoritative Node fatal ledger;
- item 24 pending-response finalization;
- pre-C1/post-C1/untransferred model;
- marker/error retention;
- request witness accounting;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

## 9. Remaining Low findings

Do not broaden scope to fix the current independent-review Lows:

- unanchored post-c1-untransferred gate facts;
- null operation-id correlation;
- consistency-only hashing.

If one is directly touched by this correction, preserve its disposition unless a local fix is strictly necessary.

## 10. Procedure SHA handling

Because the procedure changes:

- recompute the provisional procedure SHA;
- update only required harness/test SHA pins;
- mark `01ab3587...` stale in the handoff;
- do not treat the new SHA as owner-accepted;
- do not issue an authorization record.

## 11. Verification

Run non-live verification only:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- failed-run closeout tests;
- completed-history retention tests;
- reader/R1/R2/R3/K tests;
- `git diff --check`.

Prior reviewed baseline:

- focused: 773/773
- aggregate: 5018 PASS / 0 FAIL / 1 TODO
- binding: 8/8

New tests may increase totals.

Do not run APS Viewer or live G2.

## 12. Focused internal review

After implementation:

1. review only:
   - completed-result persistence ordering;
   - attribution-clear fence failure path;
   - truthful failed-run history retention;
   - directly affected procedure/reader/tests;
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
- harness/tests changed;
- completed-result persistence ordering;
- attribution-clear failure handling;
- truthful retained-history behavior;
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
