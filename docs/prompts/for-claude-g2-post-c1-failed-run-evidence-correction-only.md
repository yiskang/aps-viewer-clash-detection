# For Claude — G2 Post-C1 Failed-Run Evidence Correction Only

I explicitly authorize **one bounded procedure + harness/test correction** for the failed-run evidence defects identified by the latest independent Work review.

This authorization is limited to:

1. **High** — failed phase runs that occur **after C1 has opened** must preserve truthful authoritative gate state and prior execution history instead of forcing `gates:null` and all controls to unstarted placeholders.
2. **Medium** — strengthen `phaseRunFailure` cross-validation against control, operation, and sequence provenance.
3. **Low (optional within scope)** — correct the misleading label for a completed RPC whose result is missing, if the fix is local and does not widen scope.

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
- expected HEAD: `c0f877aee82c078564efdb504bcbe695522b4ed4`
- `main == origin/main`
- current uncommitted before-live hardening / failed-run closeout changes are present
- current procedure SHA is:
  `74e5a2b82e2adaf7c6baff31affd7daa4df9b52677fa4b569cac72b6efe09b50`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record
- no production/downstream scope changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current G2 procedure
- `docs/reviews/2026-10-02-g2-failed-run-evidence-closeout-independent-rereview.md`
- current failed-run harness/reader/closeout code
- current failed-run tests

If the baseline differs materially, stop and report.

## 2. High — preserve truthful post-C1 gate and execution history

The current failed-run path erases authoritative history after C1 has already opened by writing:

- `gates:null`
- all controls/checks as if never started

This is not acceptable for a post-C1 failure.

### Required distinction

The failed-run evidence model must distinguish at least:

- **pre-C1 failure** — C1/gate never successfully opened;
- **post-C1 failure** — C1/gate opened and some downstream execution history may already exist.

Do not overload one representation for both.

### Post-C1 failed run

When a phase fails after C1 has opened:

- preserve the authoritative C1/gate result;
- preserve all prior executed `check-run` / `control-run` records;
- preserve any legal `gate-disposition` records already emitted;
- preserve prior terminal states and authoritative Node seq values;
- do not rewrite previously executed controls to unstarted placeholders;
- only later/not-yet-started work may be represented as blocked/not-run according to the accepted procedure;
- preserve the exact point of phase failure.

The failed-run closeout must be a truthful snapshot of history, not a synthetic reset.

### Pre-C1 failed run

If failure occurs before C1 successfully opens:

- `gates:null` may be used only if that remains the accepted procedure contract;
- no downstream execution history may be fabricated.

Define the transition boundary mechanically.

## 3. R1 / R2 / R3 / K semantics

Update the failed-run procedure/harness model so:

- R1 contains truthful gate/execution history for the failure timing;
- `phaseRunFailure` identifies whether failure was pre-C1 or post-C1;
- R2 summary is consistent with the preserved history;
- R3 hashes the correct R1/R2 artifacts;
- K still commits a terminal **FAIL** result;
- reader reconstructs FAIL without discarding prior successful gate/check/control history;
- PASS remains impossible whenever `phaseRunFailure != null`.

Do not change the accepted synchronous K commit protocol.

## 4. `phaseRunFailure` provenance cross-validation

Strengthen the schema and validator so the failure record is mechanically consistent with authoritative execution evidence.

Validate, where applicable:

- `phase`
- `check`
- `control`
- `operationId`
- `operationType`
- source realm
- `failureSeq`
- marker/timeline position
- whether the referenced check/control/operation had actually started
- whether the referenced operation ledger record exists
- whether `failureSeq` is consistent with authoritative Node sequence ordering
- whether post-C1 classification agrees with stored gate state

Reject contradictions such as:

- failure references a control that never existed;
- operation id/type mismatch;
- failure seq before the referenced start seq;
- post-C1 failure with no successful C1/gate record;
- pre-C1 failure with downstream execution history.

Use fail-closed validation.

## 5. Preserve marker and exact error retention

Do not regress the current retention behavior:

- earlier phase markers survive;
- cleanup marker remains unique;
- root failure detail survives cleanup and closeout;
- later cleanup/closeout failures add reasons but do not replace the root cause.

The preserved marker timeline must remain compatible with the truthful post-C1 execution history.

## 6. Optional Low — completed RPC with missing result

If local and mechanically safe, replace the misleading `phase-run-completed` classification for an RPC completion where the expected result payload is missing with a distinct failure/reason label that reflects the actual condition.

Add a regression test.

Do not broaden this into unrelated taxonomy cleanup.

## 7. Procedure SHA handling

Because the procedure changes again:

- recompute the procedure SHA after the bounded correction;
- update only the harness/test pins required to bind to the corrected procedure;
- mark the current `74e5a2b8...` SHA as stale in the handoff after correction;
- do **not** treat the new SHA as owner-accepted yet;
- do **not** issue any authorization record.

## 8. Required tests

Add/adjust tests for at least:

1. pre-C1 phase failure → truthful pre-C1 failed-run evidence;
2. post-C1 failure immediately after gate open → gate preserved;
3. post-C1 failure after one or more checks ran → prior history preserved;
4. post-C1 failure after a control ran → control history preserved;
5. not-yet-started later work gets only legal blocked/not-run representation;
6. failure record references invalid control → validator FAIL;
7. operation id/type mismatch → validator FAIL;
8. invalid `failureSeq` provenance → validator FAIL;
9. post-C1 flag/history contradiction → validator FAIL;
10. reader returns FAIL while preserving prior history;
11. PASS path remains unchanged;
12. failed run can never become PASS-eligible.

Keep existing marker/error-retention tests.

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
- global C1 gate;
- NRDB/effective-state semantics;
- request witness accounting;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

If this correction exposes a broader procedure contradiction, stop and report rather than widening scope.

## 10. Verification

Run non-live verification only:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- failed-run closeout tests;
- reader/R1/R2/R3/K tests;
- provenance/cross-field tests;
- `git diff --check`.

Prior reviewed baseline:

- focused: 748/748
- aggregate: 4993 PASS / 0 FAIL / 1 TODO
- binding: 8/8

New tests may increase totals.

Do not run APS Viewer or live G2.

## 11. Focused internal review

After implementation:

1. review only:
   - pre-C1 vs post-C1 failed-run semantics;
   - truthful gate/execution-history retention;
   - `phaseRunFailure` provenance validation;
   - directly affected reader/closeout tests;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this bounded scope;
4. do not modify production code;
5. do not enable live.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

## 12. Stop gate

Stop after:

- procedure/harness correction;
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

## 13. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- procedure sections changed;
- harness/tests changed;
- pre-C1 vs post-C1 failed-run model;
- truthful history-retention rules;
- `phaseRunFailure` provenance checks;
- optional Low disposition;
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
