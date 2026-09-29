# G1 SVF2 F1–F8 harness — H1–H3 bounded independent re-review

**Date:** 2026-09-29  
**Branch:** `feature/g1-svf2-f1-f8-harness`  
**Reviewed HEAD:** `1d9662478fb8ced8bf5ef903b4122669cbdf965e`  
**Remediation implementation commits:** `4a351c7`, `3e52ded`, `2208fa1`  
**Remediation base:** `67b3fdf82bebbe216ce9585dea8a35041dcdb74b`

## Verdict

**H1 is closed. H2 and H3 are not fully closed. The harness implementation is not yet accepted, and it is not ready for owner authorization of live F1–F8 execution.**

Two High findings remain inside the bounded remediation scope:

1. H2's bounded closes are implemented, but real Playwright liveness observables are not connected to `cleanupUnresolvedOwnership`; a positively still-alive resource can therefore be reported as `PARTIAL` instead of the reviewed contract's required `FAIL`.
2. H3's deterministic target selection is implemented, but the selected fragment/owner identifiers are discarded by the Node bridge and do not reach the durable machine-readable evidence.

No Critical, Medium, or Low finding was identified in this bounded re-review. Live execution remains unauthorized independent of this verdict.

## Repository and review boundary

- Git independently reports `feature/g1-svf2-f1-f8-harness` at `1d9662478fb8ced8bf5ef903b4122669cbdf965e`.
- The implementation diff `67b3fdf..2208fa1` changes exactly the harness and four directly affected test siblings. `1d96624` adds the remediation review/handoff documentation.
- No production, Viewer Adapter, Core, M4, Panel, OQ-1, host-integration, G2/G3, or host H1/H2 file is present in the implementation diff.
- No live result artifact exists at `test/acceptance/results/g1-svf2-f1-f8-verification-result.json`; no live F1–F8 execution was performed during this review.

## Findings

### Critical

None.

### High

#### H2-R1 — Real Playwright liveness is not wired, so confirmed unresolved ownership can be downgraded to `PARTIAL`

**Evidence:**

- `runCleanup` calls `confirmStillAlive()` only when that optional method exists on `page`, `context`, or `browser` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:1648-1661`).
- Real wiring passes the raw Playwright objects unchanged as `nodeCleanupResources: { page, context, browser }` (`:9326`). It supplies no `confirmStillAlive` adapters.
- The installed Playwright API exposes `Page.isClosed()`, `BrowserContext.isClosed()`, and `Browser.isConnected()`; none is consulted by this path.
- `computeOverall` returns `FAIL` when `cleanupUnresolvedOwnership === true`, while a non-empty `cleanupFailures` array with ownership still `false` falls through to `PARTIAL` (`:830-865`).
- The governing plan states that a browser/page/context close failure sets `cleanupUnresolvedOwnership` when the handle is confirmed still alive and that unresolved ownership is a `FAIL`, not merely incomplete evidence.

The new timeout does correctly prevent a wedged close from blocking later cleanup or the evidence write. The defect is the verdict classification after that timeout. If `page.close()` times out while `page.isClosed() === false`, or `browser.close()` times out while `browser.isConnected() === true`, the current real wiring cannot observe that fact through `confirmStillAlive`; it records only `cleanupFailures`, producing `PARTIAL` on an otherwise clean run.

This is not acceptable merely because PASS remains impossible. Under the reviewed overall-verdict contract, `PARTIAL` is reserved for missing/non-failing evidence or resolved cleanup failures. A positively still-owned resource is a cleanup correctness failure and belongs to branch 1 (`FAIL`). The distinction is externally recorded evidence, not stylistic preference.

**Minimum correction:** pass bounded adapters or ownership predicates into `nodeCleanupResources` using the real Playwright observables (`!page.isClosed()`, `!context.isClosed()`, `browser.isConnected()`), and add timeout cases proving confirmed-alive → `cleanupUnresolvedOwnership:true` → `FAIL`, while confirmed-closed/unknown cases retain their specified classification. Preserve independent timeout-bounded cleanup attempts.

**Disposition:** blocking before live F1–F8 authorization. H2 remains open.

#### H3-R1 — Selected control targets are not retained in durable run evidence

**Evidence:**

- `wrongOwnerControlInPage` returns `selectedFragId`/`selectedOwnerDbId`; `hiddenFragmentControlInPage` returns `selectedFragId`/`selectedTreeOwnerDbId` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:4070-4074`, `:4231-4235`).
- `runBridgedControl` validates the raw result and calls `mapControlAttemptOutcome(controlName, raw)` (`:7327-7361`).
- `mapControlAttemptOutcome`/`createControlResult` retain only the fixed `ControlResult` fields; the implementation comments explicitly state that selected-target fields are never threaded through them (`:3949-3954`).
- The persisted result writes only `controls: controlResults` and has no separate control-target evidence carrier (`:8233-8288`).
- The new H3 tests assert selected IDs only by invoking the in-page functions directly. No bridge/runHarness/schema test proves those IDs survive into the atomic evidence artifact.

Selection itself is correctly remediated: there are no hard-coded `0`/`1` targets in the live browser functions; `wrong-owner` chooses the numeric minimum from `f1PopulationRecords`; `hidden-fragment` chooses the numeric minimum of the F2 tree-reachable/F1 class-`L` intersection; no eligible target fails closed before lease acquisition; sparse/non-zero IDs are tested.

However, a future independent live-evidence review cannot establish which target was actually perturbed from the retained JSON. That fails the explicit H3 acceptance requirement that the chosen target be retained in evidence.

**Minimum correction:** persist a bounded target record for both controls—at least the selected fragment ID and corresponding recorded owner/tree-owner ID—through the bridge into the atomic result, validate its schema, and add end-to-end bridge/runHarness tests. This is a harness-evidence correction and does not require a production/Core/Adapter/host change.

**Disposition:** blocking before live F1–F8 authorization. H3 remains open.

### Medium

None.

### Low

None within this bounded review. The four previously deferred Low items remain outside this remediation and were not re-reviewed.

## H1 adjudication — closed

`runControlSafely` now sets both `fatalErrorObserved = true` and `sessionTainted = true` for every ordinary, non-watchdog bridged-control exception. Every subsequent Phase 3c–10 Fi/control block is guarded by `!sessionTainted`, so later Viewer work cannot reuse the session. Phase 11 remains outside those gates and still performs the protected in-page cleanup attempt, Node cleanup, verdict computation, schema assembly, and atomic evidence write.

The original exception remains represented as the primary `control-threw:<name>` fatal ledger event. Cleanup failures are retained separately and cannot replace it. `computeOverall` receives `fatalErrorObserved || sessionTainted`, so the outcome is `FAIL`, never `PASS` or `PARTIAL`.

The rewritten end-to-end test meaningfully proves the earlier phases ran, the later F7/F8/F6/control calls did not run, cleanup ran, the atomic writer ran, the output remained schema-valid, and the final verdict was `FAIL`.

**H1 status: closed.**

## H2 adjudication — partially closed, still blocking

The timeout mechanism is mechanically sound:

- page, context, and browser closes each independently race against `CLOSE_TIMEOUT_MS`;
- each timeout becomes its own `cleanupFailures` entry and `stepStatus:'threw'`;
- the generic step catch continues to later close/server/evidence steps;
- the timer is cleared in `finally`;
- a primary Fi/control failure keeps its higher-precedence `FAIL` result and its evidence;
- any cleanup failure prevents `PASS`.

The tests cover each close independently, a wedged page followed by successful later steps, bounded return, the production timeout constant, schema serialization, and PASS exclusion. They do not cover the real Playwright liveness adapters because none are wired. H2-R1 therefore remains blocking.

**H2 status: not closed.**

## H3 adjudication — selection closed, durable evidence still blocking

The target-selection mechanics and the associated arbitrary-ID/no-target tests are meaningful and consistent with the retained F1/F2 artifacts. The hidden-fragment intersection correctly excludes tree-reachable fragments outside F1 class `L`, which would not affect `loadedButUnreachableCount`.

The tests do not cross the page-to-Node bridge with the selected fields and do not inspect the final persisted result. H3-R1 leaves the evidence half of the requirement unresolved.

**H3 status: not closed.**

## Test and scope verification

Independent canonical run:

```text
npm run test:offline
tests 4152
pass 4151
fail 0
todo 1
exit 0
```

The one todo is the existing unrelated containment extreme-aspect-ratio known gap. The net +27 tests are substantive for H1 taint/short-circuit behavior, H2 timeout/continuation/verdict behavior, and H3 population-driven selection. They do not close the two evidence/contract gaps identified above.

No live APS model was loaded. No G2/G3, host H1/H2, OQ-1, host integration, Viewer Adapter, Core, M4, or production implementation work appeared in the bounded diff.

## Gate disposition

- **Harness implementation accepted:** no.
- **Ready for owner authorization of live F1–F8:** no.
- **Required first:** bounded remediation of H2-R1 and H3-R1, then another bounded independent re-review and a clean canonical offline run.
- **Current authorization:** documentation of this review only. Live F1–F8 remains unauthorized, and this review does not authorize implementation remediation.

