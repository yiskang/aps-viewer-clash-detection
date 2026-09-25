# Federated Clash Test core — P7 owner-ruling #10 focused independent re-review

**Date:** 2026-09-25  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Checkpoint:** `22ff778dd30385a1cd67c3f4885bb8dd98443dfd`  
**Review boundary:** `5025bf2..22ff778`

## Verdict

**PASS for the owner-ruling #10 remediation checkpoint.** R-1 is resolved. This focused re-review found **0 Critical / 0 High / 0 Medium / 0 Low**.

This is an independent-review result, not P7 acceptance. Under `CLAUDE.md`, the next gate is targeted adjudication of this review. P8 remains unauthorized.

## Scope

Per the repository's convergence rule, this pass reviewed only:

- owner ruling #10 and R-1 as recorded in the current handoff and prior adjudication;
- the `createReadCoordinator.acquire` reordering in `clashtest/results/residency.js`;
- the ten new listener-reentrancy regressions and directly affected capacity, FIFO, abort, failure and slot-accounting invariants in `5025bf2..22ff778`;
- the claimed focused, affected-suite and full-suite verification results.

It did not restart an unrestricted P7 review, reopen the frozen design, or reassess unrelated deferred items.

## Findings

None.

## R-1 remediation verification

**Resolved.** A queued acquire now inserts its waiter before invoking caller-controlled `signal.addEventListener`. Reentrant code therefore observes the outer waiter in the FIFO and cannot consume an uncounted queue position or reverse the intended order.

If the current holder is released during registration, the transferred slot is retained in `granted` until registration settles. Successful registration then detaches the listener and resolves the outer waiter. If registration throws, the outer waiter is removed if still queued and any temporarily granted slot is released, handing it to the next waiter or decrementing the in-use count. A synchronous abort removes and rejects the queued waiter without leaving coordinator state behind.

The implementation preserves the prior owner-ruling #9 behavior: cleanup failure remains best-effort and cannot corrupt slot hand-off. Genuine `AbortSignal` cancellation behavior remains unchanged.

## Direct invariant checks

- Queue-capacity decisions include the outer waiter before any reentrant nested acquire occurs.
- Depth-one reentrancy rejects the nested request with `ReadCapacityError`; depth-two reentrancy admits it after the outer waiter.
- A slot granted during registration is counted exactly once and is either delivered or released after a registration failure.
- Registration throw-after-grant and nested-then-throw paths remove only the failing waiter and preserve later progress.
- Synchronous abort rejects `ReadAbortedError`, frees the queue position and leaks no slot.
- All six public reads and `rerun` exercise the hardened path through the engine façade.

## Verification

Independently run on `22ff778`:

- the two listener-failure regression files: **21/21 passed**;
- affected P7 read/integration suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`): **692/692 passed**;
- full `npm test`: **2,619 total / 2,618 passed / 0 failed / 1 todo**;
- the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap;
- graph coverage metadata was current for the changed coordinator and both regression files, with no recorded indexing gaps; source and executed tests remained the authority;
- repository before review persistence: branch `feature/federated-clash-test-core-engine`, HEAD `22ff778dd30385a1cd67c3f4885bb8dd98443dfd`, working tree clean.

## Gate result

The owner-ruling #10 remediation checkpoint is ready for the repository's targeted adjudication step. P7 is not accepted by this review alone, and P8 must not begin.
