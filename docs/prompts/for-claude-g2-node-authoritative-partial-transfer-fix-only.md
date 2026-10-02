# For Claude — G2 Node-Authoritative Partial-Result Transfer Fix Only

I explicitly authorize **one bounded procedure + harness/test correction** for the remaining failed-run evidence blocker identified by the latest independent Work review.

This authorization is limited to:

- ensuring completed post-C1 results already present in page `partialSink` are transferred into Node-authoritative state even when the attribution-clear fence and cleanup-entry fence both refuse;
- making durable failed-run evidence truthfully preserve those completed results;
- updating only the minimum procedure wording, harness logic, and directly affected tests;
- focused internal review and handoff update.

It does **not** authorize changing H1 sequencing, changing `G2_DUAL_COUNTER_GATE.resolved=true`, changing `LIVE_PATH_WIRED=false`, live planning, authorization-record issuance, live G2, real-Viewer failure injection, production/Core/Viewer Adapter/M4/Panel changes, G3/H1/H2/OQ-1/host integration, unrelated Low fixes, commit, or push.

Use repository state as the source of truth.

## 1. Verify baseline first

Before editing, verify:

- repo: `aps-viewer-clash-detection`
- branch: `main`
- expected HEAD: `c0f877aee82c078564efdb504bcbe695522b4ed4`
- `main == origin/main`
- current uncommitted failed-run retention correction is still present
- current provisional procedure SHA:
  `7f68188940da7e9786acaab6802d82fd455f527bc684e8bfaf2676096df06d4c`
- `G2_DUAL_COUNTER_GATE.resolved=true`
- `LIVE_PATH_WIRED=false`
- no live G2 attempt/evidence
- no authorization record
- no production/downstream scope changes

Read:

- `CLAUDE.md`
- `docs/handoffs/latest.md`
- current G2 procedure
- `docs/reviews/2026-10-02-g2-completed-phase-result-retention-independent-rereview.md`
- current `g2RunPhases()` / `partialSink` / failed-run transfer code
- current failed-run closeout tests

If the baseline differs materially, stop and report.

## 2. Blocking path to close

Work verified this path:

1. C2/C3/N1 or equivalent results complete and reach page `partialSink`;
2. attribution-clear fence refuses;
3. cleanup-entry fence also refuses;
4. `g2RunPhases()` rethrows before transferring `partialSink`;
5. Node commits FAIL artifacts that incorrectly describe completed work as blocked/not-started.

PASS is impossible, but durable history is false.

This path must be eliminated.

## 3. Required invariant

Once a completed post-C1 result has reached `partialSink`, Node must receive enough authoritative information to preserve that completed result **even if every later page-side fence needed for cleanup entry refuses**.

A later fence refusal may add a phase-run failure, cleanup/fence fatal detail, and overall FAIL, but it must never erase completed history already produced by the phase runner.

## 4. Node-authoritative transfer design

Implement a fail-safe transfer path for `partialSink` that does **not** depend on successful cleanup-entry.

Preferred properties:

- completed results are transferred to Node immediately or through a dedicated failure-transfer path before rethrow;
- Node validates/normalizes the transferred records;
- Node owns the durable authoritative copy;
- page `partialSink` is not the sole durable source once a result is complete;
- transfer is awaited or otherwise fail-closed;
- transfer failure is itself retained as fatal evidence.

Do not create a second sequence authority.

All retained results must use the existing Node-authoritative sequence model.

## 5. Failure ordering

For the blocking path, durable ordering must be reconstructable as:

1. completed result(s) produced;
2. completed result(s) transferred/preserved in Node;
3. attribution-clear refusal;
4. cleanup-entry refusal if it occurs;
5. failed-run closeout;
6. R1/R2/R3/K commit terminal FAIL.

The preserved history must show that completed results happened before later fence failures.

## 6. Procedure correction

Update only the minimum normative wording needed so the procedure explicitly requires:

- completed post-C1 results to become Node-authoritative before they can be lost by later fence/cleanup-entry failures;
- failed-run R1 to preserve those completed results;
- fence/cleanup-entry failures to append FAIL detail rather than roll history back.

Remove any wording that merely documents the current limitation as acceptable.

Do not redesign unrelated failed-run semantics.

## 7. `phaseRunFailure` / evidence consistency

Ensure:

- `failureSeq` is after the retained completed-result seq where applicable;
- post-C1 history remains truthful;
- completed records remain unchanged;
- only genuinely not-started later work becomes blocked/unstarted;
- cleanup-entry refusal and attribution-clear refusal are represented as later failures, not as evidence that earlier work never ran.

## 8. Required tests

Add/adjust tests for at least:

1. C2 completed → attribution-clear refuses → cleanup-entry refuses → C2 retained;
2. C2+C3 completed → both fences refuse → both retained;
3. N1 completed → both fences refuse → N1 retained;
4. mixed check/control history survives both refusals;
5. failure-transfer succeeds but cleanup-entry refuses → truthful FAIL artifacts;
6. failure-transfer itself fails → fail closed, with transfer failure retained;
7. no duplicate history when normal cleanup-entry succeeds;
8. not-started later work is not fabricated;
9. reader returns FAIL and preserves completed history;
10. R1/R2/R3/K remain schema-valid;
11. PASS path remains unchanged;
12. mutation test proves the old rethrow-before-transfer behavior loses history and is caught.

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
- pre-C1/post-C1/untransferred model;
- marker/error retention;
- request witness accounting;
- authoritative K closeout;
- `LIVE_PATH_WIRED=false`.

## 10. Remaining Low findings

Do not broaden scope to fix the current Low findings unless directly touched:

- unanchored untransferred gate facts;
- null operation-id correlation;
- consistency-only hashing;
- ordering/provenance hardening Lows from the latest review.

Preserve their current dispositions.

## 11. Procedure SHA handling

Because the procedure changes:

- recompute the provisional procedure SHA;
- update only required harness/test pins;
- mark `7f681889...` stale in the handoff;
- do not treat the new SHA as owner-accepted;
- do not issue an authorization record.

## 12. Verification

Run non-live verification only:

- focused G2 suite;
- aggregate offline suite;
- `npm run test:g2:binding`;
- failed-run transfer tests;
- reader/R1/R2/R3/K tests;
- completed-history retention tests;
- `git diff --check`.

Prior reviewed baseline:

- focused: 786/786
- aggregate: 5031 PASS / 0 FAIL / 1 TODO
- binding: 8/8

New tests may increase totals.

Do not run APS Viewer or live G2.

## 13. Focused internal review

After implementation:

1. review only:
   - Node-authoritative transfer of completed partial history;
   - attribution-clear + cleanup-entry refusal path;
   - truthful failed-run closeout;
   - directly affected procedure/reader/tests;
2. classify Critical / High / Medium / Low;
3. fix genuine Critical/High defects within this bounded scope;
4. do not modify production code;
5. do not enable live.

Persist the review under `docs/reviews/`.

Update `docs/handoffs/latest.md`.

## 14. Stop gate

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

## 15. Final report

Report:

- branch / HEAD / relation to `origin/main`;
- procedure sections changed;
- harness/tests changed;
- Node-authoritative completed-result transfer design;
- both-fence-refusal handling;
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
