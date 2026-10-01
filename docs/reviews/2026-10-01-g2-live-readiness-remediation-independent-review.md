# Independent Review — G2 Live-Readiness Remediation

**Date:** 2026-10-01  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed baseline:** `main == origin/main == d07dea0045a07c3f748618f4f959195f4346db89`  
**Accepted procedure:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`  
**Scope:** the uncommitted harness-only H1/H2/M1/L1 remediation and directly affected tests; no live G2 execution.

## Verdict

**0 Critical / 1 High / 1 Medium / 4 Low.**

The working tree is suitable for an owner-authorized **dormant checkpoint commit** with both live interlocks still false. It is **not ready for live-planning authorization**, activation, authorization-record issuance, or live G2 execution.

High 2 (the authoritative Node fatal ledger) is closed. Item 24 (gate-time pending-response finalization) is fully integrated on that ledger. High 1 is not fully closed against the accepted procedure: the implementation replaces the procedure's single Node-side monotonic counter with a two-allocator composite namespace whose cross-realm temporal order is authoritative only at awaited fences. The implementation is collision-free and fail-closed in the reviewed offline model, but it does not implement the literal accepted sequencing contract and the real Playwright scheduling assumption remains unevidenced.

## Verified repository state

- `main` and `origin/main` both resolve to `d07dea0045a07c3f748618f4f959195f4346db89`.
- The accepted procedure digest recomputes to `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`.
- `LIVE_PATH_WIRED=false` and `G2_DUAL_COUNTER_GATE.resolved=false` remain mechanically enforced by both `main()` and live-mode `runChecksInPhaseOrder()`.
- No G2 live result/evidence or authorization record exists. The implementation diff is confined to `test/acceptance/`; the remaining dirty paths are prompts/reviews/handoff documentation. No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host-integration path changed.
- `git diff --check` passes.

## Findings

### Critical

None.

### High

#### H1 — the composite sequence does not conform to the accepted single-counter contract

**Procedure clause:** §9.2, `Harness-owned operation ledger`, states: “`seq` is one node-side monotonic counter shared by `opLedger`, phase-boundary markers, `check-finalized` events, `gates.C1`, control start/terminal records and request/response events.” The same single-counter model is used by the closed-gate predicates and the evidence schema.

**Implementation:** `createPageSeqSource()` allocates page values `major * 2^20`; `createRunSeqCounter()` independently allocates Node minor values under the highest ingested page major. `createRunAuthority.syncPage()` makes cross-realm order authoritative only when a page high-water mark is ingested at an awaited fence.

**What is sound:**

- page and Node values occupy disjoint numeric classes, so normal allocations cannot collide;
- each realm is strictly monotone;
- minor exhaustion repeats one reserved value, causing a detectable `seq-not-unique` row-5 contradiction instead of a silent page collision;
- phase/check attribution is acknowledged before the associated driver action; a refused report throws before that action;
- C16 hide and C17/cleanup unload/teardown can carry P9/cleanup attribution instead of stale P1;
- C1 finalization, gate preparation, operation begin/end, page-fatal transfer, cleanup, and final transfer have explicit fences.

**Why it remains blocking:** between fences, numeric order is not a strict total temporal order across realms. A Node event may receive a minor under the last reported page major after the page has already allocated later, unreported major values. The current code deliberately documents this. No reviewed invariant was found that creates a false PASS from that limitation in the simulated flow: gate/fatal ordering, cancellation-window start/ack, phase transitions, and closeout all use fences. Nevertheless, the retained evidence no longer has the literal ordering semantics accepted by the governing procedure, and future readers/validators are entitled to rely on that contract.

**Minimum correction:** make one bounded owner-authorized choice before live planning:

1. implement the accepted single Node allocation authority for every primary sequence; or
2. amend only the sequencing clauses of the procedure to define the fenced composite namespace, enumerate which cross-realm comparisons are authoritative, and prohibit consumers from inferring temporal order inside an unfenced epoch.

Then run the non-live real-Playwright binding test described below and independently re-review the bounded result. Do not flip `G2_DUAL_COUNTER_GATE.resolved` before both steps pass.

### Medium

#### M1 — real Playwright binding scheduling is still unevidenced

`crossrealm.test.mjs` is materially stronger than a pure function test: it runs the real page-agent bundle and slices the actual Node binding bodies from `runPostReservation()`. Its transport, however, is a VM plus a hand-written delayed JSON channel. It does not prove the scheduling/order behavior of Playwright's real `exposeFunction` transport or its interaction with Playwright network events.

This test is **not required for the dormant checkpoint commit**. It is required before resolving `G2_DUAL_COUNTER_GATE` and therefore before ordinary live planning can declare the sequencing remediation closed.

Minimum non-live test: one local blank Chromium page, no APS Viewer, credentials, fixture, or G2 attempt. Install the actual bindings through `page.exposeFunction`; run the real bundled page agent; prove (a) awaited P9 attribution is acknowledged before a synthetic hide action, (b) an acknowledged operation plus an overlapping synthetic abort preserves the intended order/attribution, (c) a page-fatal call racing the gate either arrives first or causes the reconciliation mismatch fatal, and (d) drain/final transfer yields unique sequences and complete fatal ids. Include a delayed/reordered negative control. This tests the transport assumption without entering the live G2 path.

### Low

1. **Active-control phase ownership is not validated by `syncPage`.** It verifies that `activeControl` is N1–N8 but not that the control belongs to the reported phase. The page runner currently supplies correct values and retained control records remain independently validated, so no false PASS was found. Fold this guard and one mutation test into the bounded H1 follow-up.
2. **Teardown C-e uses the cleanup marker as a terminal-record proxy.** The proxy is causally safe in the current runner and a missing/contradictory terminal record still prevents PASS through schema/verdict checks. It is slightly weaker than the procedure's literal “every check has a recorded final verdict.” Reconcile the procedure wording to terminal records (including gate dispositions), or pass the record state into the classifier, before live execution. It does not block the dormant commit or bounded planning.
3. **C15(e) contradiction reaches row 5 through R1 verification.** PASS is impossible and the accepted procedure requires row-5 failure without mandating that it be selected during primary computation. This is optional/non-blocking conformance hardening.
4. **`T_iso` is proved against the bridge ledger target, not the actual Viewer-call argument.** Current production code uses the same target, and disagreement blocks rather than passes, but the procedure names the spy-recorded `setAggregateIsolation` argument as the authority. Capture a bounded canonical argument or reconcile the clause before live execution. This does not block the dormant commit or bounded planning.

The prior `requestfinished` Low is closed: an instrumentation exception now records the fail-closed `network-instrumentation:requestfinished` harness fatal, and the focused test covers the normal and throwing paths.

## High 2 — authoritative fatal-ledger adjudication

**Closed.** The C1 gate now executes synchronously inside the Node binding against `state.errorLedger`, after ingesting the page high-water and reconciling the page fatal count. The page mirror only requests early abort and is not a gate input.

Page-origin fatals use contiguous ids. Missing, duplicate, gapped, unnumbered, invalid-count, and late transfers each create the fail-closed `page-fatal-transfer-mismatch` fatal once. A fatal delivered before the gate is counted; a late transfer causes the mismatch before the gate opens; a fatal during drain is either received or causes the final reconciliation mismatch. Node-origin fatals mirrored back to the page are not incorrectly counted as page-origin transfers. No reviewed path lets a page-only fatal coexist with a PASS-authoritative closeout.

## Item 24 adjudication

**Fully integrated.** Gate preparation finalizes every still-provisional response on the authoritative Node ledger before witness rebuild, fatal recount, and `gateSeq` allocation. `responseRules` is resolved once and passed to event-time instrumentation, load-window finalization, gate finalization, and closeout finalization.

The tests cover non-fatal and fatal gate finalization, unresolved ownership, duplicate `requestfailed`/response members sharing one witness, an existing witness that is not double-counted, ordering `responseSeq < finalizedSeq <= witnessSeq < gateSeq`, and a non-vacuity case without the finalization. No unresolved provisional entry can escape closeout.

## Test quality and results

- Focused G2: `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs` — **542/542 pass, 0 fail**.
- Aggregate offline: `npm run test:offline` — **4788 total / 4787 pass / 0 fail / 1 existing todo**. The initial restricted run failed only because three unchanged local-server tests could not bind (`EPERM`); the permission-correct rerun produced the clean result above.
- The new tests have meaningful negative controls: counter-clamp removal, sync-guard removal, non-awaited attribution, non-adopting authority, omitted fatal reconciliation, omitted high-water ingestion, mirror-gate contrast, and absent item-24 finalization all reproduce the targeted defects.
- The principal remaining test limitation is explicit rather than hidden: simulated transport cannot establish real Playwright binding/CDP scheduling.

## Static-guard disposition

The previously deferred M1/M2 hardening over the pre-link dependency graph and all live closeout consumers may remain **before-live-execution** work. The existing double interlock, critical-section AST guard, source-order tests, real closeout tests, and new binding-body/static-coupling checks are sufficient for a dormant checkpoint.

The H1 follow-up must add an earlier guard for its new critical boundary: the accepted sequencing model (whichever owner-authorized option is chosen), the phase/control ownership table, and the real-Playwright transport test must all pass before `G2_DUAL_COUNTER_GATE.resolved` can become true. The broader M1/M2 closeout hardening still need not block that dormant remediation checkpoint.

## Readiness and authorization

### A. Checkpoint commit

**Ready for an owner-authorized dormant checkpoint commit** after this review and the updated handoff are included. Preserve `LIVE_PATH_WIRED=false` and `G2_DUAL_COUNTER_GATE.resolved=false`. Do not include an authorization record or describe the branch as live-ready.

### B. Live planning

**Not ready.** Resolve H1's procedure/implementation mismatch, add the active-control phase guard, run the non-live real-Playwright binding test, and independently re-review that bounded result first.

### C. Live execution

After B closes, live execution still requires: M1/M2 static-guard hardening; the teardown C-e and `T_iso` before-live dispositions; final commit/clean tree; recomputed procedure/harness/tree/fixture digests; explicit owner decisions/authorization; a fresh single-use authorization record; and only then a separately authorized activation/live run.

## Procedure and dependency impact

A bounded procedure correction is required if the composite allocator is retained. No procedure change is needed for H2 or item 24. No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host dependency appeared.

## Recommended next authorized action

Owner-authorize only a bounded dormant closeout task: commit this checkpoint with both gates false, then separately authorize the H1 sequencing-contract reconciliation plus the local non-live Playwright binding test. Live planning and live execution remain unauthorized.
