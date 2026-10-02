# G2 failed-run evidence closeout — independent re-review

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Baseline:** `main == origin/main == c0f877aee82c078564efdb504bcbe695522b4ed4`  
**Scope:** current uncommitted failed-run procedure and dormant-harness correction only  
**Procedure SHA-256 reviewed:** `74e5a2b82e2adaf7c6baff31affd7daa4df9b52677fa4b569cac72b6efe09b50`

## Verdict

**0 Critical / 1 High / 1 Medium / 1 Low.**

The correction is fail-safe for verdicts: a non-null `phaseRunFailure` forces row 3 `FAIL`, row 8 requires it to be null, K commits `finalOverall = primaryOverall`, and the reader independently rejects a failed-run K whose final verdict is not `FAIL`. R1/R2/R3/K and F preserve the root failure on the paths exercised by the new tests. Marker reuse and Node-authoritative ordering are also sound.

The correction is not ready for owner acceptance or checkpoint commit. A failed run after the authoritative C1 gate has opened is durably represented as if the gate was never reached and every control never started. That makes the committed failure evidence materially false even though it cannot create a false PASS.

## Findings

### High H1 — post-C1 failure closeout erases authoritative gate and execution history

**Type:** evidence-contract / implementation-compatibility defect; bounded procedure and harness correction required.

The Node `gate` binding constructs the authoritative C1 gate and returns it to the page, but does not retain that gate in Node-owned run state (`clashpanel-viewerbridge.acceptance.mjs`, `G2_NODE_SYNC_BINDING`, lines 12819–12835). If the page later throws, the failure transfer contains `phaseRunFailure`, markers and final ledgers, but omits `checks`, `controls`, `gates` and `c1FinalizedEvent` (lines 11578–11585).

Node first applies that incomplete transfer as a normal run, synthesizing invalid/missing records and filtering the retained C1 finalization event against the synthesized C1 record (lines 12480–12520 and 12954–12966). `applyPhaseRunFailureToState` then overwrites every check as `BLOCKED`, replaces every control with a not-started placeholder, and unconditionally sets `state.gates = null` (lines 12462–12466). The procedure makes that representation normative by requiring no gate on every failed run.

Concrete failure mode: a throw in P4–P11 after C1 opened can commit a schema-valid R1/R2/R3/K that says no C1 gate existed and every control was unstarted, despite authoritative C1 finalization and already executed checks/controls. The new tests start from the same lossy model, so they prove durable closure of that model rather than truthfulness of the execution record.

This does **not** permit PASS: row 3, row 8, R1 validation and reader W-5/W-6 all fail closed. It does violate the purpose of the failed-run evidence correction and prevents independent reconstruction of what executed before failure.

**Minimum correction:**

1. Persist the authoritative C1 result and gate in Node state when the synchronous gate action succeeds.
2. Distinguish pre-gate and post-gate phase-run failures in the procedure and durable schema.
3. For a post-gate failure, retain the authoritative gate, C1 finalization, and truthful completed/started check and control records; represent only genuinely unstarted downstream work as blocked/not started.
4. Add a non-vacuous failure-after-open-gate test with at least one completed control and verify R1, R2, R3, K and the reader preserve those facts while returning `FAIL`.

### Medium M1 — `phaseRunFailure` semantic coupling is incomplete

The schema validates field shapes but not all relationships needed for a mechanically auditable failure record:

- `activeControl` may name a control while the failed-run rule requires that same control's execution record to say `started:false`.
- A non-null `operation` is not required to match the authoritative `errorLedger.opLedger` entry it names.
- A page-sourced `failureSeq` is checked for type/uniqueness, but the durable schema does not bind it to the ingested `phase-run-failure` provenance row or require it to fall after the last pre-failure marker and before cleanup.

These gaps do not create PASS, but they allow internally contradictory failed-run evidence to validate. The bounded correction for H1 should add these cross-field constraints and mutation tests.

### Low L1 — malformed completed RPC is labelled `phase-run-completed`

If `g2RunPhases` returns status `completed` with a missing/falsy value, the transport-failure branch persists `status:'completed'` and therefore `phase-run-completed` (lines 12953–12973). The result still fails, so this is diagnostic misclassification rather than a verdict defect. Normalize this case to a failure status such as `invalid-result` during the H1 correction.

## Requested verification

### Failed-run artifacts and PASS exclusion

- R1 is schema-valid for the currently implemented failed-run model; R2 includes the failed-run summary; R3 hashes the exact on-disk R1/R2; K commits terminal `FAIL`; and `deriveVerdictFromArtifacts` reconstructs `FAIL`.
- `phaseRunFailure != null` selects row 3, row 8 explicitly requires null, validation requires a failed-run overall of `FAIL`, and W-5 rejects any failed-run K whose final verdict is not `FAIL`.
- These mechanisms are sufficient to prevent accidental PASS. H1 concerns truthfulness of the durable execution record, not verdict safety.

### Root failure and marker retention

- The original `phaseRunFailure` remains primary through cleanup failures. Later cleanup failures add fatal detail and do not replace it.
- Normal closeout and the unexpected closeout-abort path pass the root record into F where F can be written; F remains the procedure's best-effort failure witness.
- Caller-owned pre-failure markers survive; an existing cleanup marker is reused; transport failures reconstruct markers from Node provenance; final ordering remains Node-authoritative.
- The post-C1 gate/finalization loss in H1 is separate from marker retention: the timeline markers can survive while the durable gate/check/control interpretation is false.

### `gates:null`, compatibility and SHA

- Reusing `gates:null` for both pre-gate and post-gate failures is **not acceptable**. It removes a fact already authoritatively established and is the minimum procedure distinction required by H1.
- Old R1 files become invalid because `phaseRunFailure` is now mandatory. No migration is required because no live G2 attempt/evidence or authorization record exists.
- `74e5a2b82e2adaf7c6baff31affd7daa4df9b52677fa4b569cac72b6efe09b50` is the exact current procedure digest, but it is **not ready for owner acceptance or live binding**. The previous `5f9c4c7e…` digest is stale for this revision; the corrected procedure must receive a new digest after remediation, independent acceptance, commit and clean-tree verification.

## Tests and repository state

- Focused G2: **748/748 passed**.
- Aggregate offline: **4,994 total / 4,993 passed / 0 failed / 1 existing todo**. The first sandboxed invocation could not open the M4 test's local ephemeral listener; the permitted local-runtime invocation passed.
- Real Playwright binding: **8/8 passed**. The sandboxed Chromium launch was denied by macOS IPC policy; the permitted local-runtime invocation passed.
- `git diff --check`: clean.
- `main == origin/main == c0f877aee82c078564efdb504bcbe695522b4ed4`; `G2_DUAL_COUNTER_GATE.resolved=true`; `LIVE_PATH_WIRED=false`.
- No live G2 attempt/evidence, authorization record, live activation, or production/Core/Adapter/M4/Panel/OQ-1/host change was found.

The new tests are meaningful for failed-run hashing, K/reader agreement, PASS exclusion, marker retention, cleanup-additive failure and closeout-abort root retention. They do not cover a failure after an authoritative OPEN C1 gate while preserving already executed records, which is the missing non-vacuity case behind H1.

## Readiness and authorization

- **Procedure ready to accept:** no.
- **Harness ready for checkpoint commit:** no; committing now would freeze a known false execution history for post-gate failures.
- **Live planning ready:** no. The procedure digest and harness evidence contract are not final.
- **Before live execution:** after H1/M1/L1 remediation, repeat focused/aggregate/binding verification, independent re-review, owner acceptance, checkpoint commit, clean-tree digest recomputation, and only then consider a new single-use authorization record. `LIVE_PATH_WIRED` must remain false until separately authorized.

## Exact next action

Obtain explicit owner authorization for one bounded procedure-and-harness correction that preserves authoritative C1/gate and partial execution evidence on post-gate phase-run failure, strengthens the coupled `phaseRunFailure` rules, adds the missing post-gate mutation test, and normalizes the completed-without-result status. No commit, push, live planning, activation, authorization-record issuance or live G2 is authorized by this review.
