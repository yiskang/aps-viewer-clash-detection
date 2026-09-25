# Federated Clash Test core — P7 owner-ruling #8 focused independent re-review

**Date:** 2026-09-25  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Branch:** `feature/federated-clash-test-core-engine`  
**Checkpoint:** `06f1d7edcc868880134a704b61872271b0d179da`  
**Review boundary:** `62395b2..06f1d7e`

## Verdict

**PASS for the owner-ruling #8 remediation checkpoint.** N1 abort precedence is corrected and the public read/rerun validators now accept standards-compatible cross-realm signals. This focused re-review found **0 Critical / 0 High / 0 Medium / 1 Low**.

The Low is a bounded validation-contract edge for deliberately malformed signal-like objects. It does not affect genuine `AbortSignal` values, N1's abort-precedence guarantee, or the reviewed P7 read-cancellation behavior. This is an independent-review result, not P7 acceptance. Under `CLAUDE.md`, the next gate is targeted adjudication of this review. P8 remains unauthorized.

## Scope

Per the repository's convergence rule, this pass reviewed only:

- owner ruling #8 and the N1/cross-realm dispositions recorded in the current handoff and prior adjudication;
- `clashtest/engine.js`, `test/clashtest/engine/readAbort.ownerRuling8.test.mjs`, and directly affected read-slot/cancellation invariants in `62395b2..06f1d7e`;
- the claimed focused, affected-suite and full-suite verification results.

It did not restart an unrestricted P7 review or reopen the frozen design.

## Finding

### Low — the structural signal check accepts callable-but-broken listener members

`clashtest/engine.js:190-199` treats any object with a boolean `aborted` value and function-valued `addEventListener` / `removeEventListener` members as an `AbortSignal`. Both public validation sites therefore accept an object whose listener function throws when called (`clashtest/engine.js:230`, `:1246-1248`). If a read slot is available, that member may never be invoked; if the same request queues, `clashtest/results/residency.js:445-457` invokes it and surfaces the raw thrown error. The same invalid input can therefore behave differently solely because of read-slot occupancy.

The new malformed-input coverage at `test/clashtest/engine/readAbort.ownerRuling8.test.mjs:296-336` checks missing/non-callable members and throwing property access, but not callable members that throw on invocation. A direct coordinator probe with such an object produced `Error: listener-boom`, confirming the downstream path.

This is an **implementation-compatibility and verification gap**, not a failure for genuine same- or cross-realm `AbortSignal` instances. The minimum future correction, if strict `AbortSignal` validation is required, is a cross-realm-safe platform-brand check plus a real second-realm regression. Alternatively, an explicit owner-approved contract could define structurally compatible signal objects and specify failures from their methods. Do not expand this checkpoint further without the targeted adjudication/owner disposition required by `CLAUDE.md`.

## Remediation verification

| Owner-ruling item | Result | Evidence |
| --- | --- | --- |
| N1 — abort must win over a simultaneous freshness failure | **Resolved** | `liveFreshness` now checks `signal.aborted` in its catch and throws `ReadAbortedError` before preserving any non-abort error. A final post-settlement check remains. Tests cover resident, stored/read-through and raw-set paths for `getFreshness`, `canClaimNoClashes` and `assessNoClashClaim`, plus the no-abort preservation case. |
| Cross-realm `AbortSignal` support | **Resolved for valid signal behavior** | Both read and rerun validation sites use the shared structural predicate instead of same-realm `instanceof`. Tests cover all public read methods, rerun, pre-abort, queued abort/FIFO removal, a pending store read and listener cleanup. The Low above concerns malformed duck types, not valid cross-realm signals. |

## Direct invariant checks

- An abort observed when `readTimeFreshness` rejects wins over every underlying error and cannot resolve as `unverifiable`.
- Without an observed abort, `liveFreshness` preserves the original failure object.
- Read and rerun options use the same signal predicate; the prior same-realm-only split is gone.
- Queued abort still removes only its own waiter, preserves FIFO order and releases its listener.
- An abort during a non-abortable store read keeps the slot until the store operation settles, then rejects `ReadAbortedError`.

## Verification

Independently run on `06f1d7e`:

- owner-ruling #8 regression file: **11/11 passed**;
- directly affected P7 suites: **671/671 passed**;
- full `npm test`: **2,598 total / 2,597 passed / 0 failed / 1 todo**;
- the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap;
- graph coverage metadata was current for the changed engine and regression-test files, with no recorded indexing gaps; source and executed tests remained the authority;
- repository before review persistence: branch `feature/federated-clash-test-core-engine`, HEAD `06f1d7edcc868880134a704b61872271b0d179da`, working tree clean.

## Gate result

The owner-ruling #8 remediation checkpoint is ready for the repository's targeted adjudication step. P7 is not accepted by this review alone, and P8 must not begin.
