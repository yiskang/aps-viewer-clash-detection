# Federated Clash Test core — P7 owner-ruling #10 focused re-review: targeted adjudication

**Date:** 2026-09-25
**Repository / branch:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection` @ `feature/federated-clash-test-core-engine`
**Adjudicated review:** [`2026-09-25-federated-clash-test-core-p7-owner-ruling-10-focused-rereview.md`](2026-09-25-federated-clash-test-core-p7-owner-ruling-10-focused-rereview.md) (PASS, 0 Critical / 0 High / 0 Medium / 0 Low)
**Adjudicated boundary:** `5025bf2..22ff778`; HEAD at adjudication = `22ff778`
**Method:** direct verification by the adjudicator (tests re-run; one read-only coordinator probe) plus one targeted `codex-advisor` pass. Per `CLAUDE.md`: no production, spec, plan or test file was modified; no unrestricted review was run.

## Result

**Work and adjudication AGREE on the boundary, the verification numbers, and that R-1 (release-during-registration, nested acquire, throw-after-grant, synchronous abort) is resolved. They DISAGREE on "0 findings": a Codex pass found one further FIFO-ordering edge under *combined* `addEventListener` + `removeEventListener` reentrancy; the adjudicator reproduced it.** The adjudicator classifies it **Low** (not reachable through the public engine API; no leak) and **strongly recommends closing the hostile-signal class by convergence** rather than another patch round. Because this was a difference on the gate verdict, it was persisted here; the owner then ruled **R-2 = A** (owner ruling #11, final section) and **P7 is accepted**. P8 is not authorized.

## Verified (agreement)

| Claim | Result | Evidence |
| --- | --- | --- |
| Boundary | **Agree** | `git diff --name-only 5025bf2..22ff778`: `clashtest/results/residency.js`, the two `listenerFailure` test files, the handoff and two review/adjudication records. No engine, spec, plan or schema change. |
| Counts | **Agree** | Re-run on `22ff778`: the two files **21/21** (0 cancelled); affected suites **692/692**; full `npm test` **2,619 total / 2,618 pass / 0 fail / 1 todo**. |
| R-1 resolved for the cases the review lists | **Agree** | Waiter is queued before `addEventListener`; a reentrant grant is held in `granted` and delivered/released; nested acquire is bounded and ordered after the outer waiter; synchronous abort/throw are safe (the ruling-#10 tests, and the prior M-1 tests, all pass). |

## Disagreement — R-2: observable completion order can invert under combined listener reentrancy

**Cause.** In the new `acquire` success path (`clashtest/results/residency.js` ~`:489-492`) the waiter's listener cleanup — the caller-controlled `removeEventListener` — runs *before* `resolve(granted)`. If that cleanup itself re-enters the coordinator and releases another holder, `release()` hands a slot to the next queued waiter and resolves it first.

**Adjudicator reproduction (coordinator level, `maxConcurrentStoreReads: 2`, `maxQueuedStoreReads: 4`):** holders `h1`, `h2` occupy both slots; waiter `W1` registers with a signal whose `addEventListener` calls `h1.release()` (granting `W1` during registration) and starts a nested `acquire()` `W2`; and whose `removeEventListener` calls `h2.release()`. Observed: **completion order `W2, W1`** (W2 was queued after W1 but its promise settled first); **slot accounting stays correct** (`inUse()` 2 while both hold, final 0); no leak, no double-count, no stranded waiter, no queue overshoot.

**Reachability and severity.**

- Requires **`maxConcurrentStoreReads ≥ 2`** (default 1, ceiling 4), **and** a signal-like object whose `addEventListener` releases a holder and starts a second acquire **and** whose `removeEventListener` releases a second holder. Through the engine façade, read slots are released only in `withReadSlot`'s `finally` after an awaited continuation, so hostile listener code cannot release a holder synchronously; this ordering case therefore appears reachable **only by driving `createReadCoordinator` directly** with holders the test controls (adjudicator inference, not exhaustively proven).
- The defect is limited to the *promise-settlement order* of two waiters; no slot, queue or accounting invariant is violated.
- **Classification (adjudicator): Low.** Codex's assessment is that the PASS should not stand as written. There is no severity rubric in the repository; this is a judgement for the owner.

**Convergence note (`CLAUDE.md` review boundary).** This is the **fourth consecutive round** whose findings concern machinery introduced by remediation — the duck-typed (structurally checked) signal accepted by owner ruling #8 — rather than the original P7 architecture: N1 → M-1 (throwing `removeEventListener`, Medium, fixed) → R-1 (reentrant `addEventListener`, fixed) → R-2 (reentrant `removeEventListener` + `addEventListener` ordering). Every round has been a strictly more contrived hostile-object edge, each found by an adversarial probe of the previous fix, and each fix added coordinator machinery (a `granted`/`registering` state machine) that the next probe attacked. The original P7 findings (H1, M1, M2, M3, L1, L2), N1 and all *genuine* `AbortSignal` (same- and cross-realm) behaviour are stable and independently verified across all rounds. Patching the coordinator against arbitrary hostile signal-like objects has no natural stopping point unless the **contract** is bounded or the hostility is **isolated**.

## Options for the owner (adjudicator's recommendation first)

- **(A) Recommended — accept R-2 as Low, defer, and bound the contract; close the hostile-signal class.** Record explicitly (code comment + spec-independent note in the handoff) that the façade accepts structurally AbortSignal-compatible objects whose listener methods are assumed *well-behaved*: they may throw (fail-closed, no leak — pinned), but must not synchronously release read slots or re-enter the coordinator in ways that reorder waiters; ordering under such misbehaviour is undefined. P7 then proceeds to owner acceptance on the existing pass of every original finding and every genuine-signal invariant.
- **(B) Cheap local patch + one more round.** In the two places that call caller cleanup (`release()` and the success path of `acquire`), resolve the waiter **before** running `detach()`, so a reentrant release from cleanup cannot deliver a later waiter first; add the two-holder/two-waiter regression. Very small, but it does not close the class and invites another probe round.
- **(C) Isolate the hostility at the façade (closes the class permanently).** The engine listens to the caller's signal once, guarded and cleaned up in `finally`, and hands the coordinator its own genuine internal `AbortSignal`; no duck-typed object ever reaches P5. Larger engine change (listener lifecycle at every read site), not authorized by any current ruling; would need its own focused re-review.

## Owner decision required (RESOLVED: owner ruling #11, R-2 = A — see the final section)

1. **R-2 disposition:** (A) accept as Low and close the hostile-signal class (recommended), (B) local patch, or (C) façade isolation.
2. **P7 acceptance** remains a separate owner decision.


## Owner ruling #11 (2026-09-25): R-2 = A — convergence decision; P7 ACCEPTED

**Ruling.** R-2 is a **Low, non-blocking compatibility edge**; this issue class is closed by **bounding the supported signal contract**. The P7 public read APIs support: (i) a genuine same-realm `AbortSignal`; (ii) a genuine cross-realm `AbortSignal`; (iii) structurally compatible signals that behave according to normal `AbortSignal` listener semantics. They do **not** guarantee FIFO settlement semantics for hostile signal-like objects whose `addEventListener` or `removeEventListener` synchronously re-enter the read coordinator or release unrelated slots. Throwing listener methods continue to fail closed exactly as implemented; synchronous coordinator-manipulating side effects from a malformed/hostile signal-like object are outside the supported contract. **No further coordinator change for R-2; no further focused implementation-review loop for this class.** This is an **explicit convergence decision under the `CLAUDE.md` review-boundary rule** (findings primarily about machinery introduced by earlier remediation rather than the original architecture). If no other blocking finding is unresolved, **record P7 as accepted**; no P8; no production, test, spec or plan change for R-2; no further unrestricted review; documentation-only closeout commit.

**Recorded disposition of R-2 — Low / deferred compatibility hardening.**

- Genuine `AbortSignal` behaviour (same-realm and cross-realm) remains covered by tests and supported.
- **No slot leak, stranded waiter, capacity corruption or false result occurs** (adjudicator reproduction: `inUse()` correct throughout, final 0; the review's and Codex's probes agree).
- **Only settlement order under hostile reentrancy is undefined** (with `maxConcurrentStoreReads ≥ 2`, a later waiter can settle before an earlier one).
- Optional future hardening, unscheduled and requiring separate owner authorization: resolve-before-detach in `release()`/`acquire`, or façade isolation with an engine-owned internal signal (Options B/C above).

**Unresolved-blocking-findings check (adjudicator, from the repository record).** Original independent review (`c598ad3`): H1, M1, M2, M3, L1, L2 — all resolved and independently re-reviewed (`62395b2`). Adjudication follow-ups: N1 and cross-realm `AbortSignal` (`06f1d7e`), M-1 (`5025bf2`), R-1 (`22ff778`) — all resolved, each independently re-reviewed and adjudicated. R-2 — Low, deferred by this ruling. The remaining items in the handoff are the previously recorded **non-blocking** lower-severity/deferred items (no-store `getPersistenceState` attempt-0 snapshot to a synchronous `finalizing` listener; a discard already executing inside P5 may finish after dispose; freshness-abort promptness depends on enumerator checkpoints; optional read-time `libraryExclusions`↔ledger validation; recorded coverage gaps; the pre-existing `ContainmentQuery.classifyPoint` todo), each requiring separate owner authorization. **No blocking finding is unresolved.**

**Final P7 verification of record (adjudicator re-run on `22ff778`, working tree at the checkpoint):** ruling-#10 listener-failure files **21/21**; affected suites (`test/clashtest/{engine,integration,results,run}/*.test.mjs`) **692/692**; full `npm test` **2,619 total / 2,618 pass / 0 fail / 1 todo** (the todo is the pre-existing `ContainmentQuery.classifyPoint` extreme-aspect-ratio gap).

**Status.** **P7 ACCEPTED (2026-09-25, owner ruling #11) at implementation checkpoint `22ff778`.** Recorded in `docs/handoffs/latest.md`. **P8 and later phases are not authorized** (a plan entry is a recommendation, not authorization); nothing is pushed. This record, the ruling-#10 Work review and the handoff are committed together as the documentation-only P7 closeout commit.
