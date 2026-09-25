# Federated Clash Test core — P7 owner-ruling #9 focused re-review: targeted adjudication

**Date:** 2026-09-25
**Repository / branch:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` @ `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`2026-09-25-federated-clash-test-core-p7-owner-ruling-9-focused-rereview.md`](2026-09-25-federated-clash-test-core-p7-owner-ruling-9-focused-rereview.md) (PASS, 0 Critical / 0 High / 0 Medium / 0 Low)
**Adjudicated boundary:** `06f1d7e..5025bf2`; HEAD at adjudication = `5025bf2`
**Method:** direct verification by the adjudicator (tests re-run, revert check, two read-only coordinator probes) plus one targeted `codex-advisor` pass. Per `CLAUDE.md`: no production, spec, plan or test file was modified; no unrestricted review was run.

## Result

**Work and adjudication AGREE on the boundary, the verification numbers, and that M-1 (a throwing `removeEventListener`) is resolved. They DISAGREE on the "0 findings" verdict: a Codex pass found a related reentrancy defect in the same coordinator acquisition path that the review did not examine; the adjudicator reproduced it.** The adjudicator classifies it **Low** (see below) and recommends convergence rather than another expansion round. Because this was a difference on the gate verdict, it was persisted here and the handoff set to awaiting owner decision; the owner then ruled **R-1 = B** (see the final section). P7 is not accepted; P8 must not begin.

## Verified (agreement)

| Claim | Result | Evidence |
| --- | --- | --- |
| Boundary | **Agree** | `git diff --name-only 06f1d7e..5025bf2`: `clashtest/results/residency.js` (one 7-line `release()` change + header comment), the two new `listenerFailure` test files, the handoff and two review/adjudication records. No engine, spec, plan or schema change. |
| Counts | **Agree** | Re-run on `5025bf2`: the two new files **11/11**; affected suites **682/682**; full `npm test` **2,609 total / 2,608 pass / 0 fail / 1 todo**. |
| Revert check | **Agree** | With `residency.js` restored to `06f1d7e`, the two new files give 6 pass / 5 fail (the tests do pin the fix). |
| M-1 resolved | **Agree** | `release()` now wraps `detach()` in `try/catch` before `resolve(makeSlot())`; a throwing `removeEventListener` can no longer lose the waiter, leak the slot, or fail the holder. Genuine `AbortSignal` behaviour is unchanged. The throwing-`addEventListener` case (rejects before `queue.push`) is correctly described. |

## Disagreement — R-1: acquisition state is decided before the untrusted `addEventListener` runs

**Cause.** In `createReadCoordinator().acquire` (`clashtest/results/residency.js:441-464`), the "no free slot" and "queue not full" decisions are made first, and the waiter is pushed only after `signal.addEventListener(...)` returns (`:459` then `:462`). A structurally-accepted signal-like object (owner ruling #8) may run arbitrary code inside `addEventListener`, re-entering the coordinator while the waiter is neither queued nor holding a slot.

**Reproduced by the adjudicator (coordinator level, `maxConcurrentStoreReads: 1`, `maxQueuedStoreReads: 1`):**

- **R-1a — stranded waiter.** Holder `H` owns the slot; `B` calls `acquire({signal})`; the signal's `addEventListener` synchronously calls `H.release()`. `B` then sees an empty queue, `count` is decremented, and `B` is pushed afterward. Observed: **`B` still pending with `inUse() === 0`** (no holder exists to hand it a slot; it progresses only if an unrelated later `acquire` takes and releases the free slot).
- **R-1b — queue depth and FIFO.** `B`'s `addEventListener` synchronously starts another `acquire()` `C`. `C` queues first; `B` is pushed afterward without a capacity re-check. Observed: **`C` is granted before `B`** (FIFO reversed for the two calls) and the queue briefly holds one more waiter than `maxQueuedStoreReads`.

**Reachability (adjudicator inference — not exhaustively proven).**

- **R-1b is reachable through the public engine API**: a hostile `addEventListener` can start another read. The effect is confined to the reentrant caller's own two calls plus a one-waiter overshoot of the queue depth; every waiter is still granted in turn and `inUse()` returns to 0 — no hang, no leak.
- **R-1a requires the holder's slot to be released synchronously from inside `addEventListener`.** Through the engine façade a slot is released only in `withReadSlot`'s `finally` after an awaited continuation, so hostile code cannot force a synchronous release; R-1a therefore appears reachable only by driving the coordinator directly (an internal API), not through `getResultSet`/`getFreshness`/…/`rerun`.
- Codex additionally reports no slot-accounting defect in `withReadSet`/`liveFreshness` (their held-slot paths release in `finally`); a hostile, later-throwing `aborted` getter can change or mask the *rejection error* but strands nothing.

**Classification (adjudicator).** **Low** — an implementation-level robustness gap in a P5 path against a deliberately reentrant, hostile signal-like caller: bounded, self-inflicted, no permanent leak or hang reachable through the public façade. Codex's assessment is that the PASS should not stand as written; the adjudicator does not regard R-1 as a Medium because the M-1 conditions (permanent slot leak + cross-request hang through the public API) are not met. The repository has no severity rubric; this is a judgement for the owner.

**Convergence note (`CLAUDE.md` review boundary).** This is the third consecutive round whose findings concern machinery introduced by remediation — the structural (duck-typed) signal check adopted by owner ruling #8 — rather than the original P7 architecture (N1 → M-1 → R-1: each a deeper hostile-object edge). The genuine `AbortSignal` paths, N1, and every original finding are stable. Continuing to expand the coordinator defensively against arbitrary hostile signal-like objects has no natural stopping point unless the *contract* is bounded.

## Options for the owner (adjudicator's recommendation first)

- **(A) Recommended — accept R-1 as Low, defer, and bound the contract.** Record that the façade accepts structurally AbortSignal-compatible objects whose listener methods are assumed *non-reentrant*; failures they raise (throwing members) fail closed without leaking (M-1, fixed), and reentrant misbehaviour is out of contract. Close the hostile-signal class here; P7 may then proceed to acceptance on the existing pass of every original finding.
- **(B) Reorder acquisition.** Push the waiter before invoking `addEventListener`, then register the listener; on a throwing registration, remove the waiter if still queued, or release the slot if it was already granted during registration; abort during registration must find the queued waiter. Small but subtle (a granted-then-throws corner), P5 code again, needs new regressions (release-during-registration, reentrant acquire, throw-after-grant) and a further focused re-review.
- **(C) Isolate the hostility at the façade.** The engine listens to the caller's signal once (guarded, cleaned up in `finally`) and passes the coordinator its own genuine internal `AbortSignal`, so no duck-typed object ever reaches P5. Removes the whole class permanently, but is a larger engine change (listener lifecycle at every read site) and is not authorized by ruling #9.

## Owner decision required (RESOLVED: owner ruling #10, R-1 = B — see the final section)

1. **R-1 disposition:** (A) accept as Low and bound the contract (recommended), (B) reorder acquisition, or (C) façade isolation.
2. **P7 acceptance** remains a separate owner decision.


## Owner ruling #10 (2026-09-25): R-1 = B — remediation implemented and committed as one checkpoint over `5025bf2`

**Ruling.** Fix the P5 read-coordinator ordering so waiter state is established before the caller-controlled `addEventListener` is invoked, and make registration failure safe even if the waiter was already granted or queue state changed reentrantly. Under synchronous reentrancy: no stranded waiter; no slot leak; no queue overshoot beyond `maxQueuedStoreReads`; FIFO well-defined; a registration throw fails closed without corrupting unrelated reads; genuine same-/cross-realm `AbortSignal` behaviour unchanged. Regressions for both reproduced cases (synchronous holder release; synchronous nested read); retain the existing throwing-`addEventListener`/`removeEventListener` regressions. No P8; no unrestricted review; update this record and the handoff; do not commit yet.

**Change (one production file, `clashtest/results/residency.js`, `createReadCoordinator().acquire` congested path; +41/−11 over `5025bf2`; no engine, spec, plan, schema or error-code change):**

- The waiter is **pushed onto the FIFO first**, before any caller code runs. The queue-capacity decision therefore includes it (a nested `acquire` from inside `addEventListener` sees it: R-1b's overshoot and FIFO reversal cannot occur), and the FIFO position is fixed at that point.
- A slot handed to the waiter **during registration** (a reentrant `release()` — R-1a) is captured by the waiter's `resolve` wrapper and held while `registering`; when registration returns normally the listener is detached (best-effort, ruling #9) and the promise resolves with that slot. So the waiter is granted, `inUse()` stays consistent, and nothing is stranded.
- **Registration throw** (fail closed): the waiter is removed from the FIFO if still queued; if a reentrant release had already granted it a slot, that slot is **released** (handed to the next waiter or uncounted) before the read rejects with the registration error; if a synchronous abort already settled the waiter there is nothing to undo. No slot leaks and no unrelated waiter is disturbed.
- Unchanged: `{once: true}` registration, abort-while-queued removal (`ReadAbortedError`), FIFO, one-shot release, `ReadCapacityError`, the free-slot path (never touches the listener methods), the `try/catch` around `detach()` in `release()` (ruling #9), and genuine `AbortSignal` semantics (pinned by `readCoordinator.abort.test.mjs`, `residency.test.mjs` and R-1f).

**Tests (existing 11 retained; 10 added to the two `listenerFailure` files → 21 tests):**

| Case | Test |
| --- | --- |
| R-1a — `addEventListener` synchronously releases the holder: waiter granted, `inUse` 1 → 0, later acquire progresses | coordinator |
| R-1b — nested acquire from `addEventListener`: depth 1 → nested rejects `ReadCapacityError`; depth 2 → nested queues after the outer waiter and is granted after it (FIFO) | coordinator ×2 |
| R-1c — releases the holder then throws: fail closed, granted slot handed on to a nested waiter / uncounted when none, no leak, later reads progress | coordinator ×2 |
| R-1d — nested acquire then throws: only the failed waiter leaves, the nested one and queue depth unaffected | coordinator |
| R-1e — synchronous abort inside `addEventListener`: `ReadAbortedError`, waiter leaves the FIFO, freed place reusable | coordinator |
| R-1f — genuine `AbortSignal`: register, cancel queued waiter, not undone after grant (unchanged) | coordinator |
| Nested read from `addEventListener` at the engine: all six public reads + `rerun` (both validation sites), depth 2: FIFO outer-then-nested, over-capacity read rejected, holder unaffected, `readSlotsInUse` 0, later read progresses | engine |
| Same with `maxQueuedStoreReads: 1`: nested read rejects `ReadCapacityError`, no overshoot, no leak | engine |
| Retained: throwing `removeEventListener`/`addEventListener` (all reads + `rerun`, FIFO/depth, one-shot release, free-slot path, abort with throwing remove, no unhandled rejection) | both |

**Verification (tree over `5025bf2` before the commit):**

- Revert check: with `residency.js` restored to `5025bf2`, the R-1 tests fail (R-1a hangs; under `--test-timeout` the remaining coordinator R-1 tests of that file are reported as cancelled behind it); with the fix, both files **21/21**, 0 cancelled.
- Affected P7 read/integration suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`): **692/692 pass, 0 fail** (682 + 10).
- Full `npm test` (for the record, not a new review): **2,619 total / 2,618 pass / 0 fail / 1 todo** (= 2,609 + 10; the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap).

**Status.** R-1 is remediated in the ruling-#10 checkpoint commit. The two reproductions no longer occur (release-during-registration grants the waiter; a nested acquire is bounded and ordered after the outer waiter). P7 remains **NOT ACCEPTED**. Not done / not authorized: push; P8; unrestricted review; any further change. **Next: the owner sends `5025bf2` → the new commit for a focused independent Work re-review** (scope: `clashtest/results/residency.js` `acquire` and the two extended test files).
