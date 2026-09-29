# G1 SVF2 F1–F8 harness — bounded H1–H3 remediation review

**Date:** 2026-09-29
**Branch / HEAD:** `feature/g1-svf2-f1-f8-harness` @ `2208fa1a825fab03cb595dc0b3cd24dee67c44bc`
**Base for this remediation:** `67b3fdf82bebbe216ce9585dea8a35041dcdb74` (the prior independent
implementation review's own reviewed HEAD).

## Authorization

User-pasted "For Claude — Bounded H1–H3 Harness Remediation" (2026-09-28). Scope: fix exactly the
three High findings from
[`docs/reviews/2026-09-28-g1-svf2-f1-f8-harness-implementation-independent-review.md`](2026-09-28-g1-svf2-f1-f8-harness-implementation-independent-review.md)
(H1, H2, H3). Explicitly excluded: live F1–F8 execution; G2/G3; H1/H2 host-integration items
(unrelated same-letter labels in the roadmap, not these findings); OQ-1; host integration;
Viewer Adapter/Core/M4/production Viewer initialization/Viewer Clash Panel production changes;
addressing the four disclosed Low findings unless mechanically required by H1–H3 (none were).

## Execution

Three sequential task-dispatched subagent implementations (`.superpowers/sdd/g1-f1-f8-harness/`
briefs/reports task-15/16/17), each independently TDD'd (failing tests first, confirmed failing
for the right reason, then fixed, then confirmed passing) and each independently passed its own
`codex-review`/`codex-advisor` consult before commit — never the native `advisor` tool. Commits:

- `4a351c7` — Task 15, H1.
- `3e52ded` — Task 16, H2.
- `2208fa1` — Task 17, H3.

## H1 — generic bridged-control exception now taints the session

`runControlSafely`'s generic catch branch (an unexpected, non-outer-watchdog-tagged control
exception) now additionally sets `sessionTainted = true`, alongside the pre-existing
`fatalErrorObserved = true` and `errorLedger.record(...)` (both unchanged). This reuses every
already-present `if (!sessionTainted)` short-circuit gate across Phase 3c–10 — no other
`runHarness` control-flow change was needed. Phase 11 cleanup remains unconditional.

The test that previously locked in the unsafe behavior
(`'runControlSafely: an ORDINARY control throw ... does NOT taint the session'` in
`g1-svf2-f1-f8-verification.controlbridge.test.mjs`) was rewritten per the governing review's own
explicit instruction, mirroring the sibling outer-watchdog taint test's proof shape: a
`capacity-breach` (Phase 7c) throw now proves earlier phases (F1/F2/F4/F5 and the three earlier
controls) ran for real, later phases (F7/F8/F6 and the two later controls) are fail-closed
`BLOCKED`/`NOT_EXECUTABLE` with reason `not-reached:fatal-error` and never actually invoked,
`overall` stays `FAIL`, and Phase 11 cleanup plus the atomic evidence write still run.

The existing outer-watchdog/`TIMED_OUT`/`RESTORE_FAILED`/`restored===false` taint paths (Task 14's
own prior fix) are unmodified — confirmed unweakened.

## H2 — bounded Phase 11 teardown

`runCleanup`'s `step()` helper gained an opt-in `timeoutMs` parameter, applied only to the
`closePage`/`closeContext`/`closeBrowser` steps, reusing the exact `Promise.race` /
timer-cleared-in-`finally` technique the pre-existing `closeAllBestEffort` (previously used only
by the Phase 0 failure path) already established, sharing the same `CLOSE_TIMEOUT_MS` constant —
no second timeout constant introduced. A timed-out close is recorded in `cleanupFailures` through
the step's own existing catch path; later steps still run regardless. `computeOverall` required no
change: `PASS` already requires `cleanupFailures.length === 0`.

**Disclosed residual (not fixed in this pass, judged correctly out of scope):** `main()`'s real
wiring of `nodeCleanupResources` never supplies `confirmStillAlive`/`isRemoved`/`isDisposed` to
any of `runCleanup`'s ~22 `checkOwnership`-capable steps (not only the 3 new timeout-bounded
ones) — a pre-existing, cross-cutting gap this diff does not introduce or worsen. Practical effect:
a close timeout with a genuinely-still-alive underlying resource currently reaches `computeOverall`'s
`PARTIAL` branch (via non-empty `cleanupFailures`) rather than its `FAIL` branch (which requires
`cleanupUnresolvedOwnership === true`). Before this pass, the same wedge simply hung forever with
no verdict ever computed. Independently verified twice — once by Task 16's own `codex-review`,
once by this review's own `codex-advisor medium` consult (below) — both concluded `PARTIAL` (never
`PASS`) already satisfies H2's own stated requirement ("unresolved cleanup timeout/failure
prevents PASS"), and that wiring real liveness predicates is a separate, later, narrow follow-up
(would need to define the intended `PARTIAL` vs. `FAIL` distinction for a *confirmed-still-alive*
resource vs. one whose fate is merely unknown) rather than something H2 mechanically requires.

## H3 — control fragment selection from authoritative population

`wrongOwnerControlInPage` and `hiddenFragmentControlInPage` no longer hard-code `fragId===0`/`1`.
Both now deterministically select a target from the REAL session's already-computed F1/F2
population data — `session.artifacts.f1PopulationRecords` (numeric-minimum fragId) for
wrong-owner, and the intersection of `session.artifacts.f2TreeOwnerByFragId` (tree-reachable, per
F2) with F1's own class-`'L'` fragIds from `session.artifacts.f1PopulationClasses` (numeric-minimum
of the intersection) for hidden-fragment — via two new pure helpers,
`selectAuthoritativeFragmentTarget`/`selectHiddenFragmentTarget`, both registered in
`IN_PAGE_FUNCTION_REGISTRY` and exported. The intersection requirement for hidden-fragment (rather
than plain tree-reachability alone) was added after this task's own `codex-review` found that
`observeF2`'s own `loadedButUnreachableCount` field only counts class-`L` fragments — plain
tree-reachability alone was insufficient to guarantee detectability.

Both functions read this data from the REAL session, strictly BEFORE creating their own scratch
session for the perturbation, and strictly AFTER the corresponding primary F1/F2 phase has run
(`runHarness`'s phase order: Phase 4 F1 → Phase 4c wrong-owner; Phase 5 F2 → Phase 5c
hidden-fragment — verified by direct read, not assumed).

An empty/no-eligible population now returns `{ok:false, reason:'no-eligible-fragment'}`,
fail-closed, before any lease acquisition — a deliberate documented deviation from the task
brief's own suggested `{ok:true, restored:null}` shape, confirmed correct via a `codex-advisor`
consult during the task: `runBridgedControl`'s existing strict-boolean contract for
`detected`/`restored`/`timedOut` would otherwise silently discard the specific `reason`. A second,
separate `codex-review` finding (an unguarded `window.__g1` read that could throw instead of
returning the established no-session result) was also fixed in both functions, guarded identically
to the pre-existing `acquireControlLease`'s own pattern.

19 new/adapted tests in `g1-svf2-f1-f8-verification.mandatorycontrols1.test.mjs` cover: non-0/1
populations, empty/no-eligible populations, deterministic selection, sparse/arbitrary valid IDs,
and an explicit per-existing-test disposition (kept/adapted/replaced) for every previously-passing
wrong-owner/hidden-fragment test, per the task's own report.

## Controller's own focused internal review (`codex-advisor medium`, this pass)

Scoped strictly to the H1–H3 diff on `test/acceptance/g1-svf2-f1-f8-verification.mjs` and its
cross-cutting interaction with `computeOverall`'s verdict precedence and Phase 11 cleanup — not an
unrestricted full-file review (the rest of the file was already covered by the prior independent
review). **Verdict: accept as landed, 0 Critical/High.**

Verified findings:

1. H1 and H3 interact safely — F1/F2 observations are direct `pageEvaluate` calls, never routed
   through `runControlSafely`; `f1PopulationRecords`/`f2TreeOwnerByFragId` are only ever assigned
   after their respective phase's complete computation (never partially populated); an `{ok:false}`
   F1/F2 observation leaves the artifacts absent, which H3 already converts to
   `no-eligible-fragment` rather than treating as authoritative.
2. Phase 11 still runs unconditionally in every H1/H3 combination — neither introduced a
   `runHarness` early return/throw that bypasses it.
3. H2 genuinely prevents `PASS` on any close timeout, via the existing `cleanupFailuresEmpty`
   check — confirmed by direct trace, not merely asserted.
4. The `confirmStillAlive` gap (above) is real but correctly disclosed rather than fixed here —
   `PARTIAL` already satisfies H2's own literal requirement; positively confirming a surviving
   resource to force `FAIL` is separate, later, narrower work.

No code changes resulted from this review pass (nothing Critical/High to fix).

## Verification

- `npm run test:offline` (run independently by the controller after all three tasks landed,
  matching each task's own reported total): **4152 total / 4151 pass / 0 fail / 1 pre-existing
  unrelated `todo`** (up from `4125`/`4124`/`0`/`1` at the prior independent review's own baseline
  — net +27 tests across the three tasks, 0 regressions).
- `git diff --stat 67b3fdf..HEAD`: exactly 5 files changed (the harness file plus 4 test
  siblings), 857 insertions / 80 deletions. `git diff -- wwwroot clashtest collision routes
  server.js package.json package-lock.json scripts` empty at every task boundary and at this
  review — confirmed no production/Adapter/Core/Panel file touched anywhere in this pass.

## Confirmed, per the authorization's own closing requirements

Live F1–F8 execution was NOT run at any point in this remediation pass (the activation interlock
was not touched by any of the three tasks). No Viewer Adapter, Core, M4, production Viewer
initialization, or Viewer Clash Panel production file was changed. G2/G3, OQ-1, and host
integration were not started. Only `codex-advisor`/`codex-review` (skills/CLI) were used for every
second opinion across all three tasks and this controller-level review — the native `advisor` tool
was never used.

## Disposition of the prior review's disclosed residuals

| Item | Status after this pass |
| --- | --- |
| H1 (generic control-exception doesn't taint session) | **Fixed** (Task 15) |
| H2 (browser-close cleanup has no timeout) | **Fixed** (Task 16), with one new disclosed residual (`confirmStillAlive` unwired — see above) |
| H3 (hard-coded fragment IDs 0/1) | **Fixed** (Task 17) |
| L1 (bounds double-failure label) | Not addressed — not mechanically required by H1–H3, per the authorization's own explicit scope instruction |
| L2 (Phase 0 outer guard) | Not addressed — same |
| L3 (abandoned scratch-state accounting) | Not addressed — same |
| L4 (dead Node-side controls) | Not addressed — same |
| NEW (this pass): `confirmStillAlive` never wired to real Playwright ownership predicates | Disclosed, not fixed — judged out of H2's own mechanical scope by two independent second opinions |

## Next gate

Per the prior independent review's own stop condition ("A bounded implementation remediation is
required for H1–H3, followed by an independent re-review and a clean canonical offline/synthetic
verification"): this pass is now complete and internally converged. **Recommended next action:**
independent ChatGPT Work re-review of this remediation. Per this repository's own transition-
authorization discipline, that recommendation is not itself authorization — live F1–F8 execution,
G2/G3, H1/H2 (host-integration items), OQ-1, and host integration all remain unauthorized pending
explicit owner decision, independent of this review's own findings.
