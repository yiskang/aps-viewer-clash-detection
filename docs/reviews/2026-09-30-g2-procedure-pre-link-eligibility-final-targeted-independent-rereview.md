# Final targeted independent re-review — G2 §8 / §9.1 pre-link eligibility

- **Date:** 2026-09-30
- **Repository state:** `main` @ `f139dda375d6aa466698207def745e94e2cc5abd` (`origin/main` equal); documentation-only uncommitted working tree; G2 harness absent; no live G2 execution.
- **Scope:** only the corrected §8/§9.1 verdict phases and directly affected cross-references, the targeted internal review/dispositions, the prior independent review, and the current handoff.
- **Method:** direct source read and stale-wording search; repository-graph verification of the unchanged ViewerBridge/DockingPanel boundary; no harness implementation, Viewer session, or live execution.

## Verdict

**The §8/§9.1 correction is internally consistent and ready for owner acceptance.** The pre-link K-dependency contradiction is fully closed. D2 is technically owner-ready. No technical correction remains before a separately authorized G2 harness implementation task.

**Findings: 0 Critical / 0 High / 0 Medium / 1 Low.**

The Low is editorial and does not block owner acceptance, D2, or later harness implementation authorization.

## Low finding — non-blocking

### L1 — the worked-example heading still overstates `computeOverall` coverage

- **Location:** §8 line 420.
- **Current text:** “Mandatory worked examples (each is an offline `computeOverall` test)”.
- **Issue:** X15–X19 exercise closeout/reader/commit behavior, not only `computeOverall`. The targeted internal review identified this as part of L3, but its post-review disposition says L2/L3 were fixed while this sentence remains unchanged.
- **Minimum correction:** change the heading to “Mandatory worked examples (offline verdict/closeout/reader tests as applicable)”.
- **Impact:** none on verdict semantics or implementability. This may be folded into a future documentation cleanup; it is not required before owner acceptance or harness implementation authorization.

## 1. Operational phases

`computeOverall(state, phase)` now has exactly two operational phases:

1. `pre-closeout` after cleanup, producing `primaryOverall`.
2. `pre-link` immediately before K creation, producing `preLinkOverall` from current state plus facts already established before K.

No operational `final` phase remains. The remaining occurrences of the word `final` describe `finalOverall`, the final critical section, or explicitly deny a `computeOverall(...,'final')` phase. `finalOverall` is assigned by the commit outcome rather than computed from a post-link state.

The pre-link inputs are all knowable before K exists: ordered check/control/cleanup state, durable verified `CLOSEOUT_STARTED`, verified R1/R2/R3 and Kc, snapshot equality, quiescence, fatal-count stability, absolute-deadline status, empty pre-link closeout failures, and the exact pre-link journal history. No K-dependent state is part of the phase.

## 2. `closeoutComplete`

`closeoutComplete` now means that the authoritative K hard-link commit succeeded. It is consistently described as a postcondition:

- §8 row 8 uses only pre-link prerequisites and explicitly excludes `closeoutComplete` from pre-K evaluation.
- §9.1 says K commitment produces the postcondition.
- X5 describes PASS eligibility before link and `closeoutComplete` only after successful link.
- The handoff matches those semantics.

The test specification is mechanically useful. Its AST assertion rejects reads of K, `closeoutComplete`, journal `COMPLETED`, or other post-link fields in the pre-link path. The X5 behavioral case supplies no K and defines `closeoutComplete` as a throwing getter; any direct or transitive state access through that property makes the test fail. Together, the structural and behavioral checks cover the illegal pre-K dependency that caused the prior contradiction.

## 3. Gate → link → assignment

Step 8 is coherent and non-yielding:

`gate → fs.linkSync(Kc, K) → committed = true → finalOverall = primaryOverall`

The entire sequence is one `try` block. There is no `await`, promise construction, timer, callback filesystem operation, deadline wrapper, or event-loop yield inside it. A gate or `linkSync` throw routes to step 10, leaves no authoritative K under the stated filesystem assumption, and assigns FAIL. PASS is assigned only after `linkSync` returns successfully. No post-K operation can change the verdict or exit code.

## 4. Non-PASS primary outcomes

A non-PASS `primaryOverall` is never upgraded. If the pre-link evaluation is unchanged and closeout succeeds, K records the same `FAIL`, `BLOCKED`, or `PARTIAL` value. This is consistent with the authority model:

- K is the only artifact capable of authoritatively carrying PASS.
- W-6 also permits K to carry an authoritative non-PASS result for a consumed, fully closed-out attempt.
- A candidate Kc is never authoritative.
- Any pre-link closeout or link failure yields FAIL with no authoritative K.

Therefore “a non-PASS `primaryOverall` commits unchanged” means a valid terminal verdict artifact may record that non-PASS result; it does not create or imply an authoritative PASS.

## 5. Phase-parameterized journal predicate

Row 5 now has the required two forms:

- `pre-closeout`: exactly one `ATTEMPT_CONSUMED`, with that as the last durable state.
- `pre-link`: exactly `AUTH_BOUND → ATTEMPT_CONSUMED → CLOSEOUT_STARTED` for one `attemptId`, with journal bytes equal to those hashed into Kc.

The pre-link form requires no K or later journal terminal state. X5 explicitly requires the valid `CLOSEOUT_STARTED` history to remain PASS-eligible, so a valid all-PASS run can reach the link.

## 6. Regression safeguards

The added specifications catch the three relevant regressions:

- The source/AST check rejects restoration of a `final` compute phase and any pre-link K/post-link-field read.
- The throwing `closeoutComplete` getter fails on an illegal pre-K dependency.
- X5 proves the correct pre-link journal history remains PASS-eligible with K absent; the matrix asserts `preLinkOverall` and assigned `finalOverall` never improve on `primaryOverall`.

The heading issue in L1 does not weaken these requirements; it only mislabels the mixed set of worked examples.

## 7. Preserved closures

No regression was found in:

- dedicated-macrotask quiescence and owned promise/listener shutdown;
- synchronous direct `fs.linkSync` with no timeout or asynchronous-link race;
- exact-name K as the sole PASS-authoritative artifact and W-0…W-6 fail-closed reader behavior;
- local Darwin/POSIX atomic-link, non-overwrite, error/no-destination, and fail-safe pre-directory-fsync loss assumptions;
- the previously closed R1/R2/R3, C20/D7, N6/C4, Viewer ownership, and scope boundaries.

No production, Core, Viewer Adapter, M4, Panel, OQ-1, or host dependency appeared.

## 8. Owner decisions and authorization

| Item | Technical status | Owner action still required |
|---|---|---|
| D1 — Mechanical + Structure | ready | explicitly accept the bounded fixture pair |
| D2 — fail-first, durable closeout, local-POSIX assumptions | **technically owner-ready** | explicitly accept the policy and bounded assumptions |
| D4 — bounded real-Viewer failure injection | ready as a procedure decision | explicitly permit it, subject to later harness implementation review |
| D7 — C20 role, PARTIAL fallback, PASS-granting constants/capture budget | technically ready | explicitly accept the disclosed evidence envelope |

**Correction required before G2 harness implementation authorization:** none. L1 is optional editorial cleanup.

**Current authorization:** review and handoff update only. Owner acceptance of D1/D2/D4/D7 has not yet been recorded. G2 harness implementation and live G2 remain unauthorized, as do G3, H1/H2, OQ-1, host integration, production changes, commit, and push.
