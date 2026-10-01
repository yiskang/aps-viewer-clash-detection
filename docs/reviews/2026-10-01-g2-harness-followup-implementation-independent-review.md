# Independent Review — G2 Harness Follow-up Implementation

**Date:** 2026-10-01  
**Scope:** uncommitted G2 harness follow-up only; no live G2 execution  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed baseline:** `main == origin/main == c6d89af1991f3849a97ef8a807ea4480de43704b`  
**Accepted procedure:** `docs/research/2026-09-30-g2-viewerbridge-dockingpanel-live-verification-procedure.md`, SHA-256 `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb`

## Verdict

**0 Critical / 2 High / 1 Medium / 4 Low.**

The implementation is acceptable as a **dormant, deliberately non-runnable checkpoint**. It is not ready for live-planning authorization, activation, an authorization record, or a live G2 attempt.

The follow-up is not accurately described as all 24 items fully integrated. Items 1–23 are implemented, including the corrected H1 load-failure handling and the effective-state rules. Item 24's atomic gate-preparation algorithm exists and is well tested in isolation, but the real run still invokes it against a page-side mirror rather than the authoritative Node network ledger. With the live optional-response rule set frozen empty this cannot currently create a false PASS; it remains an incomplete live integration requirement.

`LIVE_PATH_WIRED=false` and the independent `G2_DUAL_COUNTER_GATE.resolved=false` checks in both `main()` and live-mode `runChecksInPhaseOrder()` reliably prevent the incomplete path from running. No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host-integration dependency was introduced.

## Repository and verification state

- `main` and `origin/main` both resolve to `c6d89af1991f3849a97ef8a807ea4480de43704b`.
- The procedure digest recomputes to `5f9c4c7e124751d09406f07eab63f844fec53add006bd12ad676ecaca3732abb` and matches `ACCEPTED_PROCEDURE_SHA256`.
- `LIVE_PATH_WIRED` remains `false`; `G2_DUAL_COUNTER_GATE.resolved` remains `false`; no G2 live result/evidence artifact exists.
- The working implementation diff is confined to `test/acceptance/`; the other dirty paths are documentation/review/handoff records. No production path changed.
- Focused command `node --test test/acceptance/clashpanel-viewerbridge.acceptance.*.test.mjs`: **502/502 pass, 0 fail**.
- Aggregate `npm run test:offline`: **4748 total / 4747 pass / 0 fail / 1 existing todo**. The first sandboxed run denied the three unchanged ephemeral-port tests (`EPERM`); one permission-correct rerun produced the stated clean result. No retry was used to repair a harness failure.

## Findings

### Critical

None.

### High

#### H1 — Node and page do not share the procedure's single ordered sequence/attribution authority

**Evidence:** `runPostReservation()` creates the Node counter and passes its current value to `g2RunPhases()`. `g2BuildEnv()` then creates an independent page counter starting at that same value, while Node continues allocating request, operation-ledger, fatal, cleanup, and closeout sequences. A normal open-gate run reaches acknowledged C16/C17 operations, so the two realms can allocate identical numbers; the retained real-numbering test demonstrates `seq-not-unique`. Node attribution also remains `{phase:'P1', activeCheck:null}` through page phases P2–P11.

**Failure mode:** sequence collisions force row 5 `FAIL`. Expected hide/unload request cancellations are labelled P1 instead of P9/cleanup, so C-e cannot match and they become fatal-required-resource. This is fail-closed, but a valid live run cannot produce trustworthy total-order or phase evidence and will false-FAIL when these paths occur.

**Minimum correction:** harness-only cross-realm redesign: one authoritative sequence allocator for every primary allocation, plus authoritative phase/check/control attribution delivered to Node before any corresponding Node-observed event. Keep an explicit unresolved gate until a real no-gap cross-realm test proves uniqueness and phase correctness. No procedure or production change is required.

#### H2 — the runtime C1 gate reads an asynchronous page mirror, not the authoritative Node fatal ledger

**Evidence:** page `g2RunPhases()` supplies `prepareC1Gate()` a synthetic ledger built from `g.fatal.kinds`. Node fatal events reach that mirror through asynchronous RPC. The authoritative request/response/fatal-witness ledger remains in Node and is only reconciled later.

**Failure mode:** a Node fatal observed before the logical gate can arrive at the page after the page has opened C1, allowing forbidden downstream Viewer-mutating phases to run. Closeout still sees the authoritative Node fatal and produces `FAIL`; no false PASS was found. The defect is nevertheless a stop-gate failure because work that should never start can execute.

**Minimum correction:** make gate preparation consume a synchronous authoritative snapshot whose fatal witnesses, gate-time finalizations, counter, and attribution share one order. The gate must not open until that Node-owned snapshot is frozen and acknowledged. This is a harness-only integration correction.

### Medium

#### M1 — item 24 gate-time finalization is implemented only on the non-authoritative gate ledger

`prepareC1Gate()` correctly performs finalize → witness rebuild → count → gate allocation, and its positive/reversed-order tests are meaningful. In the real wiring, however, the page mirror has no `responseFailures`; Node normally finalizes candidates at load-window close or closeout. Because `OPTIONAL_RESPONSE_RULES` is frozen empty, no live provisional response can currently exist, so this is not an exploitable false-PASS path. It is still a procedure-integration gap and is why the result is 23 fully integrated items plus one partial item, not 24/24.

Resolve this together with H2 by moving gate preparation to the authoritative network ledger. A procedure change is unnecessary.

### Low

#### L1 — `requestfinished` capture exceptions are silently swallowed

`onRequestFinished()` does not call the shared fail-closed handler. A lost terminal prevents positive prefix binding and therefore tends toward false FAIL, not false PASS. Add `failClosed('requestfinished')` before live execution.

#### L2 — teardown C-e uses the cleanup marker as a proxy for terminal records

The procedure says all checks have final outcomes; the implementation tests that cleanup began after record construction. Under a closed C1 gate, C2–C20 are terminal gate-dispositions rather than verdict-bearing check runs. The implementation is causally bounded but slightly more permissive than the literal wording. Reconcile the procedure wording to “terminal records, including gate dispositions,” or validate those records directly before live execution.

#### L3 — C15(e) evidence contradiction reaches final FAIL through R1 verification rather than primary row 5

`validateC15eEvidence()` is enforced in result-schema verification. A contradiction cannot commit PASS, but `primaryOverall` does not select row 5 first. This is verdict-safe. Moving the recomputation into `recordSchemaProblems()` is optional conformance hardening.

#### L4 — `T_iso` is checked against the bridge ledger target, not the captured bridge-call argument

The actual C15(e) sequence is non-vacuous and proves failed → restored → none with `H_iso` preservation. The setup oracle compares `T_iso` to `inspectLedger().isolation.target`, while the procedure names the spy-recorded `setAggregateIsolation` argument. A discrepancy blocks the scenario rather than passing it. Bind `T_iso` to the spy argument (or both sources) before live execution; this does not require a production change.

## 24-item follow-up adjudication

| Item | Requirement | Result |
|---:|---|---|
| 1 | C15(e) three-clear oracle | Implemented; real driver plus mutation tests are non-vacuous |
| 2 | `H0` / `H_iso`, canonical state, retained evidence | Implemented; L4 is a source-of-truth wording mismatch |
| 3 | discriminated `check-run` / `control-run` / `gate-disposition` | Implemented |
| 4 | normalized C1 reasons and finalization | Implemented after H1 remediation; load exceptions and timeouts fail closed |
| 5 | global C1 gate and atomic synthetic dispositions | Implemented offline; authoritative live-ledger integration remains H2/M1 |
| 6 | X4 and X20–X29 | Implemented |
| 7 | four passive network listeners | Implemented; L1 remains |
| 8 | HTTP ≥400 fatal by default; empty optional rules | Implemented |
| 9 | disjoint load/mutation operation ledgers | Implemented |
| 10 | expected-cancellation conditions | Implemented; stale Node phase is H1 |
| 11 | prefix-source derivation and ambiguity handling | Implemented |
| 12 | `boundPrefix` and event/closeout equivalence | Implemented |
| 13 | schema/classifier/static coverage | Implemented |
| 14 | procedure SHA rebinding | Implemented and recomputed |
| 15 | synthetic gate-disposition model | Implemented |
| 16 | exact global-gate evidence prohibitions | Implemented |
| 17 | `requestObservations` and request identity | Implemented |
| 18 | one fatal witness per trustworthy identity | Implemented; recomputation is order-independent for retained events |
| 19 | invalid identity remains fail-safe | Implemented; separate invalid events remain separate witnesses |
| 20 | one observation per request object | Implemented |
| 21 | attribution fields and exhaustive closed-gate evidence | Schema implemented; real Node attribution remains H1 |
| 22 | N7/N8 corrected dependencies | Implemented; graph is acyclic |
| 23 | effective-state use in verdict/schema/terminal/dependency paths | Implemented; static guard and tests cover gate-disposition-capable paths |
| 24 | atomic gate-time provisional finalization and witness count | Algorithm/tests implemented; real authoritative-ledger integration incomplete (M1) |

## Required pre-live corrections

1. Replace the dual Node/page counters with one authoritative sequence service and propagate page phase/check/control attribution to Node before observable work.
2. Make the runtime C1 gate use the authoritative Node ledger synchronously; do not let an asynchronous page fatal mirror decide whether downstream Viewer actions start.
3. Run item 24's gate-time response finalization and witness rebuild against that same ledger, even though the current empty optional-rule set makes the path dormant.
4. Close L1, L2, and L4 before live execution; L3 may remain optional because final PASS is already impossible on contradiction.
5. Add real cross-realm offline tests for no-gap sequencing, P9/cleanup cancellation attribution, pre-gate fatal ordering, and authoritative pending-response finalization.

The previously deferred M1/M2 static-guard hardening may remain before-live-execution work. The current double refusal is adequate for a dormant commit. It must not be removed or marked resolved until all three cross-realm corrections and their negative controls pass.

## Commit readiness versus live readiness

### Dormant checkpoint

**Ready for an owner-authorized dormant checkpoint commit**, provided the commit and handoff preserve `LIVE_PATH_WIRED=false`, `G2_DUAL_COUNTER_GATE.resolved=false`, this review, the internal review, and the full test set. The commit must not include an authorization record or claim live readiness.

### Live planning / execution

**Not ready for live-planning authorization.** H1, H2, and M1 must be resolved and independently re-reviewed first. Live execution, activation, and authorization-record issuance remain further separate owner gates.

## Procedure and dependency disposition

- No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host change is needed.
- No accepted procedure correction is required for H1, H2, or M1; they are harness-integration defects.
- L2 has a bounded wording ambiguity; either the procedure or harness wording should be reconciled before live execution, without changing the accepted architecture or verdict policy.
- Exact next recommendation: owner-authorize **only the dormant checkpoint commit**. After that clean checkpoint, separately authorize a bounded harness-only cross-realm sequencing/attribution/authoritative-gate remediation task. Do not authorize live planning or execution yet.
