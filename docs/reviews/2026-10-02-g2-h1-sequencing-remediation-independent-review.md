# Independent Review — G2 H1 Sequencing Remediation

**Date:** 2026-10-02  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed baseline:** `main == origin/main == b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`  
**Accepted procedure:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`  
**Scope:** the uncommitted harness/test-only H1 sequencing remediation and directly affected review/handoff state; no live G2 execution.

## Verdict

**0 Critical / 2 High / 1 Medium / 4 Low.**

The core sequencing replacement is technically sound: one Node-owned `createRunSeqAllocator()` assigns every authoritative sequence at Node ingestion; page ordinals are diagnostic only; awaited fences resend unacknowledged entries and atomically validate attribution/high-water; the transferred phase-run state is remapped before authoritative use; and the real local Chromium binding test establishes the intended `exposeFunction` scheduling behavior.

H1 is nevertheless **not fully closed end-to-end**. Page records created during cleanup are ingested but never merged into authoritative `eventLog`/`spyLedger`, so the final state is not a complete representation of allocator output. Separately, `runAcknowledgedMutation()` still invokes hide/unload after a refused or failed operation-begin acknowledgement. Both contradict accepted procedure behavior and must be corrected before `G2_DUAL_COUNTER_GATE.resolved` can be flipped or live planning can begin.

The corrected review/handoff set is suitable for an owner-authorized **dormant checkpoint commit** with both gates false and both blockers explicit. It is not ready for gate resolution, live planning, activation, an authorization record, or live execution.

## Verified repository state

- `main` and `origin/main` both resolve to `b33b7a94eaaefd4b3c7f097a4c743a5bb5abf80a`.
- The accepted procedure digest recomputes to `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`; the procedure is unchanged.
- `LIVE_PATH_WIRED=false` and `G2_DUAL_COUNTER_GATE.resolved=false` remain enforced. No live G2 result/evidence or authorization record exists.
- The implementation changes are confined to `test/acceptance/` plus the `package.json` test-script entry; other dirty paths are prompt/review/handoff documentation. No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host-integration path changed.
- `git diff --check` is clean.

## Findings

### Critical

None.

### High

#### H1 — cleanup-phase page records are allocated but omitted from authoritative state

**Procedure contract:** §7's closed-gate evidence model explicitly treats cleanup/closeout `spyLedger`, `stateSnapshots`, and `eventLog` entries — including `wrapper-restore` — as authoritative records. §9.2 states that one Node-side counter is shared by the verdict-bearing ledgers.

**Implementation:** `g2RunPhases()` drains and returns the page phase result before Node starts `runCleanup()`. Page-owned cleanup then creates further recorder/event entries and operation fences ingest their ordinals, but `runPostReservation()` never performs a post-cleanup page drain/snapshot/merge. `authority.assertAllocated(maxRecordedSeq(state))` checks only that recorded state does not exceed the allocator; it does not prove that every authoritative allocation is represented in state.

**Failure mode:** a PASS-authoritative result can omit cleanup Viewer calls and the required `wrapper-restore` events while still satisfying the current one-way allocator check. Cleanup step outcomes protect many final-state postconditions, but they do not make the missing call/event ledger complete or independently auditable. The result can therefore claim complete accepted-procedure evidence while silently dropping verdict-bearing cleanup records.

**Minimum correction:** after page-owned cleanup work and before closing the page, perform an awaited final drain that returns the cleanup delta, remap it through the existing ordinal→sequence map, merge it exactly once into authoritative state, and validate allocator/state completeness in both directions. Cover wrapper-restore, cleanup spy records, idempotent resend, missing/unmapped delta, and a negative control that would otherwise PASS with an omitted cleanup record.

**Gate:** before `G2_DUAL_COUNTER_GATE.resolved=true` and before live planning. It does not prevent a clearly labelled dormant checkpoint commit with the gate false.

#### H2 — refused operation-begin acknowledgement still allows the mutation

**Procedure contract:** §9.2 requires the harness to append the operation start and wait for Node acknowledgement **before** invoking each hide/unload mutation. The cross-realm remediation request likewise requires a refused attribution/gate/drain/operation fence to prevent the associated action where required.

**Implementation:** `g2NodeOps().begin()` returns `{ok:false}` on an ingest, phase, descriptor, or sealed-ledger refusal. `runAcknowledgedMutation()` catches/ignores failures, leaves `operationId=null`, then records/invokes the mutation anyway. The binding test proves sync refusal blocks an action, but it does not make the production helper demand a successful operation-begin result.

**Failure mode:** an unacknowledged Viewer mutation can execute with no operation-ledger start/ack record. Many cases become FAIL through an ingest fatal or an aborted request, but a phase/descriptor/sealed refusal need not itself create a fatal, and a mutation that causes no request failure can proceed without the required causal record. Fail-safe network classification is not a substitute for blocking an action that never obtained its required acknowledgement.

**Minimum correction:** make a present operation-ledger binding mandatory for these live mutations and require `{ok:true, operationId}` before recorder activity or `invoke()`. A refusal, throw, or malformed response must throw/taint and skip the action while preserving the primary reason and durable evidence. Add real-binding and offline negatives for phase mismatch, ingest refusal, malformed response, thrown binding, and sealed ledger.

**Gate:** before `G2_DUAL_COUNTER_GATE.resolved=true` and before live planning. It does not prevent a clearly labelled dormant checkpoint commit with both gates false.

### Medium

#### M1 — static guards do not exclude every consumer-local counter

The guards prove one `createRunSeqAllocator()` call, ban the known composite machinery, constrain page recorder wiring, and verify the main Node consumers receive `runSeq.next`. They do not reject an anonymous/local counter inside a consumer that ignores the injected callback. The runtime cross-realm tests and namespace assertions cover the current critical paths, including real Playwright binding behavior, so no current second authority was found.

This is not a blocker to the dormant checkpoint or, by itself, to resolving H1 after H1/H2 above are fixed. Harden it before live execution: enumerate every authoritative sequence consumer, mutation-test each injected `nextSeq`/`seqOf` use, and compare the allocator allocation ledger against every authoritative state sequence, not only `maxRecordedSeq`.

### Low

1. **Active-control phase validation remains open.** `syncPage()`/ingestion validate the `N1…N8` enum and active-check ownership, but no control→owning-phase table is enforced. Add that validation and a mutation test before live execution.
2. **Teardown C-e proxy remains open.** It still uses the cleanup marker as a proxy for terminal records. Reconcile to actual terminal check/gate-disposition evidence before live execution.
3. **C15(e) FAIL routing remains non-blocking.** Contradictory evidence reaches row 5 through R1/schema verification, so PASS is impossible; direct primary-row routing is optional conformance hardening.
4. **`T_iso` evidence authority remains open.** It is checked against the bridge ledger target rather than the captured Viewer-call argument named by the procedure. Bind both sources or reconcile the clause before live execution.

## Single-allocator and cross-realm adjudication

The following bounded H1 mechanics are correct:

- `createRunSeqAllocator()` is the only current authoritative allocator. It produces contiguous values below `PAGE_LOCAL_BASE`; the removed composite page-major/Node-minor machinery no longer exists.
- `createPageOrdinalSource()` produces only non-authoritative ordinals. `createRunAuthority` allocates authoritative values on atomic ingestion, handles idempotent resend, rejects gaps/conflicts/invalid attribution/high-water, and does not acknowledge refused input.
- attribution sync, C1 gate, drain, and the Node operation-binding body ingest pending ordinals before later Node allocations. `gateSeq > c1FinalizedSeq` uses remapped Node sequences.
- the phase-run transfer is `reconcilePageFatals → rewritePageRun → applyPhaseRunToState → assertAllocated`; leaked or unmapped ordinals fail closed.
- page-local provisional checks cannot authorize the final result: Node closeout recomputes over the remapped authoritative state. Their local ordinal comparisons are acceptable only as provisional page-realm inputs.

The first four properties do not cure the post-phase cleanup omission or the mutation-on-refusal path. Therefore the narrow allocator construction is accepted, but the full H1 gate is not closed.

## Internal-review fix verification

- **Digest false-fatal:** closed. `remapPageOrdinals()` rewrites only numeric ordinals and the exact `spyLedger:seq:<n>` reference form; arbitrary decimal runs inside digests/strings remain untouched. The regression test is non-vacuous.
- **Duplicate violation:** closed for the reviewed ingestion path. Early hints defer without recording a violation; an awaited bad fence records one violation and applies no partial ingestion. Page-fatal reconciliation also reports its mismatch once.
- **High-water handling:** closed for the phase-run path. Awaited fences require exact `hw`; `g2FenceReport()` supplies the real page high-water; `rewritePageRun()` compares `pageHighWater` with the last ingested ordinal and fails closed on mismatch.

## Binding-test disposition

`npm run test:g2:binding` is an **acceptable separate required non-live gate**. It uses real local Chromium and real Playwright `exposeFunction`, with no APS, Viewer, credentials, fixture, or network. Its seven tests cover awaited delivery, interleaved Node/page allocations, phase-sync-before-action, refusal blocking for sync, delayed/failed delivery, one namespace, and second-counter negative controls.

Keeping it outside `npm run test:offline` is consistent with the repository's `domIsolation.test.mjs` policy forbidding Playwright imports in `*.test.mjs`. The handoff/closeout must continue to require both commands explicitly. The test currently exposes the H2 coverage gap: it demonstrates operation-binding ordering but does not require `runAcknowledgedMutation()` to abort on `{ok:false}`.

## Verification

- Focused G2: `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` — **558/558 pass, 0 fail**.
- Aggregate offline: `npm run test:offline` — **4804 total / 4803 pass / 0 fail / 1 existing todo**. Restricted runs denied unchanged local ephemeral-server tests; the permission-correct isolated run produced the stated clean result.
- Real Playwright binding: `npm run test:g2:binding` — **7/7 pass, 0 fail**.
- `git diff --check` — clean.

The cross-realm, sequencing-guard, and binding suites contain meaningful mutation/negative controls rather than markup-only or implementation-mirroring assertions. Their two material omissions are exactly H1 cleanup completeness and H2 operation-refusal blocking.

## Readiness and authorization

- **H1 fully closed:** no.
- **`G2_DUAL_COUNTER_GATE.resolved` ready to flip:** no.
- **Dormant checkpoint commit:** technically ready only if this review and corrected handoff are included and both gates stay false; commit remains owner-authorized work, not authorized by this review.
- **Live planning:** not ready. Close H1 and H2, run the focused/offline/binding gates, and obtain another bounded independent review first.
- **Before live execution after that:** harden allocator-consumer/static completeness, close active-control ownership, teardown C-e, and `T_iso`; retain or explicitly disposition direct C15(e) routing; then commit to a clean tree, recompute digests, obtain explicit owner authorization, issue a fresh single-use authorization record, and separately activate/run.

## Exact next authorized action

No harness edit, commit, push, gate flip, authorization record, activation, or live run is authorized by this review. The next candidate action is an owner-authorized bounded harness-only remediation of the cleanup-delta transfer/completeness check and operation-refusal blocking, followed by focused, aggregate-offline, real-binding, and bounded independent re-review.
