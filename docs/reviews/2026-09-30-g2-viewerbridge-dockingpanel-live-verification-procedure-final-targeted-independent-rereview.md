# Final targeted independent re-review — G2 ViewerBridge / DockingPanel procedure

- **Date:** 2026-09-30
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Repository state reviewed:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd` (`origin/main` equal); documentation-only uncommitted working tree; the G2 acceptance harness does not exist and no live G2 execution was performed.
- **Scope:** the final gate → authoritative K correction, its quiescence/macrotask contract, reader/crash semantics, local-POSIX assumptions, truth table, O1/O2 wording, added test safeguards, directly affected prior closures, and D1/D2/D4/D7 readiness.
- **Sources:** current G2 procedure; final gate/K internal review and its dispositions; the v5 bounded independent re-review; current handoff; accepted Viewer Clash Panel design and implementation plan; actual `ViewerBridge`, marker, and DockingPanel implementation; the host Darwin `link(2)` manual.

## Verdict

**Not ready for owner acceptance or G2 harness-implementation authorization.** The correction closes the previously reported asynchronous gate → K race: the final gate and direct `fs.linkSync(Kc, K)` are now one synchronous, non-yielding block, entered only after an explicit quiescence barrier. One High internal contradiction remains in the operational final-verdict evaluation: §9.1 computes `computeOverall(state, 'final')` before `linkSync`, while §8 says final PASS requires `closeoutComplete`, which itself requires that `linkSync` has already committed K.

**Findings: 0 Critical / 1 High / 0 Medium / 0 Low.**

No production, Core, Viewer Adapter, M4, Panel, server, OQ-1, or host dependency appeared. The remaining correction is documentation/procedure-only and directly confined to final-verdict sequencing.

## High finding — blocking

### H1 — final PASS is evaluated before its required K-commit fact exists

- **Exact sections:** §8 lines 393–404 (`computeOverall` is evaluated in `pre-closeout` and `final` phases; final row 8 requires `closeoutComplete`, including “the K `linkSync` committed”); §9.1 step 8(a)–(c) line 485 (`computeOverall(state, 'final')` is run before `fs.linkSync`, is required to equal `primaryOverall`, then K is linked).
- **Concrete contradiction:** on an otherwise all-PASS run, the literal final-phase evaluation before `linkSync` cannot satisfy final row 8 because K is not committed yet. It therefore cannot produce the asserted `finalOverall = primaryOverall = PASS`. An implementation must either fail every otherwise valid PASS attempt or silently treat a future link success as already true, which is not the documented current-state evaluation and makes the gate/test contract ambiguous.
- **Why this blocks:** this is the same verdict-critical block that D2 asks the owner to accept. The synchronous race is closed, but the procedure still cannot be implemented literally with an all-PASS path and the stated `computeOverall` semantics.
- **Minimum correction:** in the pre-link gate, recompute only `pre-closeout` and verify all pre-link closeout predicates, fatal count, state stability, and absolute deadlines. Call `fs.linkSync(Kc, K)` immediately. On success, assign `finalOverall = primaryOverall`; define that assignment as the operational final mapping and state that `computeOverall(..., 'final')` is not evaluated before K exists. Update §8's “evaluated twice” wording accordingly. Preserve link failure → no K → FAIL. Add one offline case proving an all-PASS state reaches K/PASS and the corresponding injected link failure reaches FAIL/no K.
- **Classification:** procedure correctness / implementation-compatibility issue.

## Verified closures

### 1. Final gate → authoritative K

- The gate and the single direct `fs.linkSync(Kc, K)` call are specified in one synchronous, non-yielding block. `await`, promises, timers, timeout wrappers, callback-style filesystem calls, aliases, helpers, and asynchronous link primitives are prohibited in that block.
- No timeout can choose FAIL while an already-started link later creates K. A hung synchronous syscall leaves the process hung; external termination is classified by the surviving file set.
- Exact-name K is the only verdict-authoritative artifact. Kc, temporary, invalid, R1–R3, and optional artifacts cannot authorize PASS. A thrown `linkSync` means no K under the stated local-filesystem assumption; success atomically creates K.
- After successful K creation, `committed` and the exit-bearing verdict are fixed synchronously. Later unlink/fsync/read-back/logging/events are informational and cannot alter verdict or exit code.

**Result:** the reported gate → K race itself is fully closed. H1 is a separate ordering contradiction inside the gate's verdict calculation.

### 2. Dedicated macrotask and quiescence

- Every harness-created promise must be registered and either settled with `Promise.allSettled` or have an owned rejection handler. Cleanup closes Viewer/page/context/browser resources before closeout; remaining Viewer/Playwright listeners and spies are detached before the final drain.
- The drain is precise: two consecutive `setImmediate` turns plus a microtask flush, followed by a separately scheduled `setImmediate` whose body is the synchronous critical section. The gate is not entered from an `await` continuation.
- This gives rejections from the drain tick a Node rejection-processing checkpoint before the commit macrotask. Once the commit macrotask begins, no callback or continuation can interleave with the gate and syscall.
- Deadline absolute times are retained before timer clearing. The gate checks the recorded absolute deadline for any step not completed before that deadline, so clearing an overdue-but-undispatched timer cannot erase the failure.
- The proposed real-Node scheduling tests cover rejection during the drain turn, overdue timers, and listener-detachment adjacency. These are implementation requirements, not evidence that exists yet.

**Result:** the corrected quiescence/macrotask contract is mechanically implementable and no longer rests only on an informal event-loop assumption.

### 3. Crash, timeout, and reader behavior

| Window | Durable result |
|---|---|
| Failure/timeout before the final gate, or crash before `linkSync` begins | no K; reader FAIL; authorization remains consumed after B5 |
| `linkSync` throws | no K under the bounded local-filesystem assumption; reader and harness FAIL |
| process kill/hang during `linkSync` | reader uses the surviving state: no K ⇒ FAIL; valid K ⇒ K verdict; no asynchronous operation remains able to finish later |
| `linkSync` succeeds, then process crash | visible valid K is authoritative |
| OS crash before directory fsync | K may survive or be lost; survival yields K verdict, loss yields fail-safe `FAIL(commit-missing)`; authorization remains consumed |
| successful durable K | W-6 returns K's verdict; later failures cannot change it |

W-0…W-6 remain total and fail closed. Malformed, contradictory, candidate-only, incomplete, or unknown states cannot yield PASS. The terminal-commit matrix now contains 11 actual scenarios; no placeholder remains. Rows 8–10 correctly classify kill/crash outcomes from the durable state rather than assuming syscall return.

### 4. Local Darwin/POSIX assumptions and D2

- **Acceptable bounded platform assumption:** the host Darwin `link(2)` contract says link creation is atomic, an existing destination fails with `EEXIST`, and listed failure returns create no link. Kc and K are required to be same-directory/same-filesystem, and network/FUSE/power-loss guarantees are explicitly excluded.
- **Harness implementation obligation:** use direct `fs.linkSync` against verified real directory components and the verified Kc bytes; do not substitute copy, overwrite-rename, a helper, or asynchronous link. The AST and real-Node tests must enforce this.
- **Accepted fail-safe direction, if the owner chooses D2:** loss of K between link visibility and directory fsync can only downgrade the evidence to FAIL. It cannot create PASS or enable another attempt.

The local-POSIX assumption set is technically bounded and owner-ready. **D2 as a whole is not owner-ready until H1 is corrected**, because D2 also accepts the internally inconsistent final-verdict sequencing.

### 5. O1, safeguards, and prior closures

- O1 is consistently operator-captured outside the repository until copied; the harness does not write or record its status, and W-0…W-6 do not consume it. Only O2 is harness-recorded in `optional[]`.
- The AST whitelist, direct-call requirement, real-Node scheduler cases, post-K fault matrix, and asynchronous-late-link negative control are sufficient specifications to catch an inserted yield, async link, timeout race, and post-K verdict/exit mutation. They remain future implementation tests.
- No regression was found in H1 reservation/durability, the acyclic R1→R2→R3→Kc→K chain, H3/C20, R1 freeze/cutoff, N6 `2^897` vs C4 `2^900`, C7/C18, C17, C2, D3/D5, or deferred D6.
- Actual source still matches the procedure boundary: `ViewerBridge` owns serialized Viewer mutation and cleanup, `markers.js` removes exact Panel-owned meshes/scenes, and `ClashDockingPanel` remains a thin lifecycle shell. No new Adapter/Core/host API is required.

## Owner decisions and authorization

| Item | Status | Required owner action |
|---|---|---|
| D1 — Mechanical + Structure | technically unobstructed; undecided | explicitly accept the bounded fixture pair |
| D2 — fail-first/K policy and local-POSIX assumptions | **not owner-ready because of H1**; its filesystem subset is technically ready | correct H1, then explicitly accept the policy and bounded assumptions |
| D4 — bounded real-Viewer failure injection | technically specified; undecided | explicitly authorize only after harness implementation review |
| D7 — C20 role, PARTIAL fallback, constants/capture budget | technically ready; undecided | explicitly accept the disclosed evidence envelope |

**Required correction before owner acceptance or harness implementation authorization:** H1 only. The prior final gate → K timing race is closed; the correction must reconcile §8 and §9.1 without weakening K authority or reintroducing an async boundary.

**Current authorization:** this review and handoff update only. G2 harness implementation, live G2, G3, H1/H2, OQ-1, host integration, production changes, commit, and push remain unauthorized.
