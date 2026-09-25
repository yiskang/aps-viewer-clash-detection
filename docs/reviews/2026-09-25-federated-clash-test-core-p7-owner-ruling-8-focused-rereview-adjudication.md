# Federated Clash Test core — P7 owner-ruling #8 focused re-review: targeted adjudication

**Date:** 2026-09-25
**Repository / branch:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` @ `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`2026-09-25-federated-clash-test-core-p7-owner-ruling-8-focused-rereview.md`](2026-09-25-federated-clash-test-core-p7-owner-ruling-8-focused-rereview.md) (PASS, 0 Critical / 0 High / 0 Medium / 1 Low)
**Adjudicated boundary:** `62395b2..06f1d7e`; HEAD at adjudication = `06f1d7e`
**Method:** direct verification by the adjudicator (tests re-run; two read-only end-to-end probes against the committed code) plus one targeted `codex-advisor` pass. Per `CLAUDE.md`: no production, spec, plan or test file was modified; no unrestricted review was run.

## Result

**Work and adjudication AGREE on the boundary, the verification numbers, N1, and the cross-realm support for genuine signals. They DISAGREE on the severity of the review's one Low and therefore on the gate verdict: the underlying validation defect is a Medium, not a Low.** Per `CLAUDE.md` the disagreement was persisted here and the handoff set to awaiting owner decision; the owner then ruled **M-1 = A** (see the final section). P7 is not accepted; P8 must not begin.

## Verified (agreement)

| Claim | Result | Evidence |
| --- | --- | --- |
| Boundary | **Agree** | `git diff --name-only 62395b2..06f1d7e` = `clashtest/engine.js`, the new test file, the handoff and the two review/adjudication records. No spec, plan, schema or P5 file. |
| Counts | **Agree** | Re-run on `06f1d7e`: ruling-#8 file **11/11**; affected suites (`engine`, `integration`, `results`, `run`) **671/671**; full `npm test` **2,598 total / 2,597 pass / 0 fail / 1 todo**. |
| N1 | **Resolved** | `liveFreshness` catch throws `ReadAbortedError` whenever `signal.aborted`, else rethrows the original; final post-settlement check kept. Codex found no N1 defect for a standards-compatible signal. |
| Cross-realm support, genuine signals | **Resolved** | One shared `isAbortSignal` at both sites; foreign-realm signal accepted, pre-aborted, queued-abort/FIFO, pending-`get` cases pass. |
| The review's Low as *stated* (throwing `addEventListener`) | **Agree it is Low** | Adjudicator probe: with the slot held, a queued read whose signal's `addEventListener` throws rejects with that raw error; the promise executor throws before `queue.push`, so no slot or queue entry leaks (a subsequent queue-depth check still admits exactly the configured number of waiters; final `readSlotsInUse` 0; 0 unhandled rejections). |

## Disagreement — M-1 (same validation defect, worse member): a throwing `removeEventListener` permanently leaks a read slot and hangs the waiter

**Cause.** `isAbortSignal` (`clashtest/engine.js:190-199`, used at `:230` and `:1246`) accepts any object with a boolean `aborted` and function-valued `addEventListener`/`removeEventListener`; no member is ever exercised at validation, so a callable member that throws is accepted. The review examined only the `addEventListener` consequence. The P5 read coordinator's slot hand-off (`clashtest/results/residency.js:417-424`, `makeSlot().release()`) does `queue.shift()` → `detach()` → `resolve(makeSlot())`; `detach()` is `signal.removeEventListener(...)` (`:455`). A throwing `removeEventListener` therefore throws **after the waiter left the queue and before it is resolved and before `count` is adjusted**.

**Adjudicator reproduction (committed code, `06f1d7e`; `maxConcurrentStoreReads: 1`, `maxQueuedStoreReads: 2`):**

1. Read A holds the only slot, parked in a gated `ResultStore.get`.
2. Read B queues with `{signal: {aborted: false, addEventListener() {}, removeEventListener() { throw new Error('remove-boom') }}}`.
3. The gate opens; A completes its store read and releases.

Observed:

- **A** (an unrelated, valid read) **rejects with `remove-boom`** — the malformed value's error escapes through `withReadSlot`'s `finally` (`engine.js:756`), replacing A's own result;
- **B never settles** (still pending after 200 ms);
- `retentionReport().readSlotsInUse` = **1 permanently** — the slot is never released and never handed on;
- a later read then queues behind it forever; enough such requests exhaust `maxQueuedStoreReads` and every further read rejects `ReadCapacityError`.

**Why Medium, not Low.** The input is caller-supplied and passes the validation ruling #8 required to be "fail-closed"; the consequence is a permanent read-capacity deadlock (hang, leak, queue exhaustion) plus cross-request interference, not a local raw-error rejection. It is reachable only with a malformed/hostile signal-like object (a genuine same- or cross-realm `AbortSignal` cannot trigger it), so it is **not High**, and it is not a spec/design blocker. No severity rubric exists in the repository; the classification rests on the verified hang/leak.

**Provenance.** The defect exists only since the structural predicate replaced `instanceof AbortSignal` (a non-`AbortSignal` could not reach the coordinator before). The checkpoint's own malformed-input test (`readAbort.ownerRuling8.test.mjs:296-336`) covered missing/non-callable members and throwing property access but **not callable members that throw on invocation** — a verification gap in my own remediation, and the same gap the review's Low identified for `addEventListener`.

**Classification (per `CLAUDE.md`):** implementation-level defect in a just-remediated checkpoint (not a design/spec blocker); blocks a clean P7 acceptance under the owner's "fail-closed" wording until dispositioned.

## Options for the owner (adjudicator's recommendation first)

- **(A) Recommended — make the coordinator hand-off exception-safe, keep the structural validation.** Change the P5 read coordinator (additive, behaviour-preserving for valid signals) so that (i) `release()` cannot lose the waiter or the slot if `detach()` throws — e.g. detach inside `try/catch` before resolving, and `count` accounting unaffected; (ii) a throwing `addEventListener` rolls back cleanly (already true today) and is rejected as a normal read failure; and (iii) `withReadSlot`'s `finally` cannot be pre-empted by a release error. Add regression tests: throwing `removeEventListener` (queued then holder releases: holder result intact, waiter admitted, `readSlotsInUse` returns to 0, no unhandled rejection), throwing `addEventListener` (no leaked slot/queue entry), and a callable-but-throwing signal on the rerun site. **This requires an owner-authorized additive change to accepted P5 code** (as A17 already did once for `acquire({signal})`).
- **(B) Tighten validation instead.** Restrict accepted values to platform-branded signals (a cross-realm-safe check such as `Object.prototype.toString.call(v) === '[object AbortSignal]'` plus the structural members). Cheaper and no P5 change, but a spoofable `Symbol.toStringTag` object still reaches the coordinator, so the leak remains reachable by a deliberately hostile caller; it narrows, not removes, the defect. Not recommended alone.
- **(C) Accept as Low and defer** (the review's classification). Not recommended: the verified hang/leak is reachable from any caller that passes a malformed signal-like value.

## Owner decision required (RESOLVED: owner ruling #9, M-1 = A — see the final section)

1. **M-1 disposition:** (A) authorize the coordinator hardening + tests (recommended), (B), or (C).
2. **P7 acceptance** remains a separate owner decision; a focused re-review of any further checkpoint would follow.

## Note on the earlier ledger

The prior adjudication record and the committed handoff describe the ruling-#8 checkpoint as resolving both Lows; that statement stands for genuine signals but is superseded by M-1 for malformed signal-like objects.

## Owner ruling #9 (2026-09-25): M-1 = A — remediation implemented and committed as one checkpoint over `06f1d7e`

**Ruling.** Authorize the small additive hardening of the accepted P5 read coordinator so a failing `removeEventListener` cannot lose a waiter, leak a slot or deadlock subsequent reads; narrowly scoped (waiter/slot state consistent even if cleanup throws; a malformed signal fails closed without stranding the queue; genuine same-/cross-realm `AbortSignal` behaviour and the public cancellation semantics unchanged); targeted regressions for throwing `removeEventListener` and `addEventListener`, both public validation sites, the queued hand-off at slot limit 1, and later-read progress / no leaked slot. No P8; no unrestricted review; update this record and the handoff; do not commit yet.

**Change (one production file, `clashtest/results/residency.js`; no engine, spec, plan, schema or error-code change):** in `makeSlot().release()`'s queued hand-off, `detach()` (the waiter's `removeEventListener`) now runs inside `try/catch` before `resolve(makeSlot())`. Cleanup is best-effort: the waiter has already left the FIFO, so a throwing `removeEventListener` can no longer lose the waiter, leave `count` unadjusted, or throw out of the unrelated holder's `release()` (and therefore out of `withReadSlot`'s `finally`). A stale abort listener is inert (`onAbort` finds the waiter gone). The header comment records the contract. A throwing `addEventListener` needed **no code change**: it already throws inside `acquire`'s Promise executor before `queue.push`, so the read rejects fail-closed with nothing queued; it is now pinned by tests. Everything else — the structural `isAbortSignal`, `{once: true}` registration, abort-while-queued removal, FIFO, one-shot release, `ReadCapacityError`, the immediate (free-slot) path that never touches the listener methods — is unchanged.

**Tests (two new files, 11 tests; 5 were red before the fix, 6 pin already-correct behaviour):**

| File | Coverage |
| --- | --- |
| `test/clashtest/results/readCoordinator.listenerFailure.test.mjs` (6) | Throwing `removeEventListener` on a queued waiter at slot limit 1: holder `release()` does not throw, waiter granted, `inUse` 1 → 0, later acquire progresses; full queue keeps FIFO and full depth; one-shot release preserved. Throwing `addEventListener`: rejects (never a sync throw), no slot/ghost waiter/queue depth consumed. Free-slot path never invokes the listener methods. A genuine abort of a queued waiter whose `removeEventListener` throws still removes it and rejects `ReadAbortedError`. |
| `test/clashtest/engine/readAbort.listenerFailure.test.mjs` (5) | Engine level, slot limit 1, read queued behind a gated `ResultStore.get`, for **all six public reads (`getResultSet`, `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `listResults`, `listTests`) and `rerun`** (i.e. both validation sites): throwing `removeEventListener` → holder's result intact, queued read admitted and completed, `readSlotsInUse` back to 0, later reads progress; queue depth and FIFO preserved across the failing hand-off; throwing `addEventListener` → rejects fail-closed, only the holder holds a slot, a full depth of real waiters still fits, holder unaffected, no slot leaked, later read progresses; both members throwing but slot free → never invoked, read succeeds; no unhandled rejection. |

**Verification (tree over `06f1d7e` before the commit):**

- Revert check: with `residency.js` reverted (stashed), the two new files give **6 pass / 5 fail**; with the fix **11/11**.
- Affected P7 read/integration suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`): **682/682 pass, 0 fail** (671 + 11).
- Full `npm test` (for the record, not a new review): **2,609 total / 2,608 pass / 0 fail / 1 todo** (= 2,598 + 11; the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap).

**Status.** M-1 is remediated in the ruling-#9 checkpoint commit; the original reproduction (holder rejects `remove-boom`, waiter pending forever, `readSlotsInUse` stuck at 1) no longer occurs. The ruling-#8 checkpoint `06f1d7e` remains as committed; this hardening is the follow-on checkpoint commit. P7 remains **NOT ACCEPTED**. Not done / not authorized: push; P8; unrestricted review; any further change. **Next: the owner sends `06f1d7e` → the new commit for a focused independent Work re-review** (scope: `clashtest/results/residency.js` `release()` hand-off and the two new test files).
