# Federated Clash Test core — P7 owner-ruling #9 focused independent re-review

**Date:** 2026-09-25  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Checkpoint:** `5025bf2a074ed3bac486ecbc451f9301bb302f20`  
**Review boundary:** `06f1d7e..5025bf2`

## Verdict

**PASS for the owner-ruling #9 remediation checkpoint.** M-1 is resolved. This focused re-review found **0 Critical / 0 High / 0 Medium / 0 Low**.

This is an independent-review result, not P7 acceptance. Under `CLAUDE.md`, the next gate is targeted adjudication of this review. P8 remains unauthorized.

## Scope

Per the repository's convergence rule, this pass reviewed only:

- owner ruling #9 and M-1 as recorded in the current handoff and prior adjudication;
- the `createReadCoordinator` hand-off change in `clashtest/results/residency.js`;
- the two new listener-failure regression files and directly affected FIFO, slot-accounting, abort and one-shot-release invariants in `06f1d7e..5025bf2`;
- the claimed focused, affected-suite and full-suite verification results.

It did not restart an unrestricted P7 review, reopen the frozen design, or reassess unrelated deferred items.

## Findings

None.

## M-1 remediation verification

**Resolved.** During a queued hand-off, `release()` removes the waiter from the FIFO, attempts its listener cleanup inside `try/catch`, and resolves the waiter with the transferred slot even if cleanup throws. A malformed signal-like object's `removeEventListener` can therefore no longer:

- reject the unrelated holder read;
- leave the queued waiter pending;
- leak the read slot;
- corrupt FIFO order or queue-depth accounting.

The swallowed cleanup failure does not make a later abort mutate coordinator state: the abort callback finds that its waiter is no longer in the FIFO and returns. Genuine `AbortSignal` behavior is unchanged.

The registration-failure path is also pinned: a synchronously throwing `addEventListener` becomes a Promise rejection from the Promise constructor, before the waiter is pushed, so it consumes no slot or queue entry. The immediate-slot path invokes neither listener method.

## Direct invariant checks

- The holder's one-shot `release()` remains one-shot even when listener cleanup throws.
- A handed-off slot remains counted exactly once and is decremented when its new holder releases it.
- With multiple queued reads, a cleanup failure on the first waiter does not reorder or lose later waiters.
- An abort while a waiter is still queued removes only that waiter and rejects `ReadAbortedError`.
- All six public reads and `rerun` exercise the hardened coordinator through both signal-validation sites.
- No production, spec, plan or schema change outside the authorized coordinator hardening is present in the boundary.

## Verification

Independently run on `5025bf2`:

- the two owner-ruling #9 regression files: **11/11 passed**;
- affected P7 read/integration suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`): **682/682 passed**;
- full `npm test`: **2,609 total / 2,608 passed / 0 failed / 1 todo**;
- the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap;
- the initial sandboxed full-suite attempt stopped during the generated vendor refresh with filesystem `EPERM`; the permitted rerun completed with the counts above;
- graph coverage metadata was current for the changed coordinator and both regression files, with no recorded indexing gaps; source and executed tests remained the authority;
- repository before review persistence: branch `feature/federated-clash-test-core-engine`, HEAD `5025bf2a074ed3bac486ecbc451f9301bb302f20`, working tree clean.

## Gate result

The owner-ruling #9 remediation checkpoint is ready for the repository's targeted adjudication step. P7 is not accepted by this review alone, and P8 must not begin.
