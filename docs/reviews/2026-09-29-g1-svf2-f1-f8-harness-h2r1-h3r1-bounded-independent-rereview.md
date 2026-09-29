# G1 SVF2 F1–F8 harness — bounded H2-R1 / H3-R1 independent re-review

- **Date:** 2026-09-29
- **Branch / HEAD:** `feature/g1-svf2-f1-f8-harness` @ `1d9662478fb8ced8bf5ef903b4122669cbdf965e`
- **Reviewed state:** the H2-R1/H3-R1 remediation is uncommitted on top of the stated HEAD.
- **Scope:** only H2-R1 real Playwright liveness, H3-R1 durable target evidence, the two disclosed Medium questions, their directly affected tests/verdict logic, and scope/test verification.
- **Verdict:** **0 Critical / 1 High / 1 Medium / 3 Low. H2-R1 is closed. H3-R1 is not fully closed. The harness implementation is not yet accepted for live F1–F8 authorization.**

## Executive disposition

The remediation correctly connects the real Playwright `Page`, `BrowserContext`, and `Browser` liveness APIs to independently timeout-bounded cleanup steps. Confirmed-live ownership after a failed close is durably recorded and forces `FAIL`; confirmed-closed/disconnected and indeterminate liveness cannot produce `PASS` because the cleanup failure remains recorded. H2-R1 is closed.

The ordinary real `wrong-owner` and `hidden-fragment` paths now select deterministic authoritative targets and persist useful target records. However, target evidence is not a required invariant of a successful target-bearing control. `runBridgedControl` may return `DETECTED_RESTORED` after target sanitation yields no record, and `validateResultSchema` expressly permits the corresponding `controlTargets` entry to be absent. This leaves a mechanically demonstrated path to a PASS-compatible mandatory-control result whose authoritative target cannot be independently audited. H3-R1 therefore remains open and blocks live authorization.

## Findings

### High — A target-bearing control can be `DETECTED_RESTORED` with no durable target evidence

**Evidence**

- `runBridgedControl` sanitizes and optionally publishes target evidence, but silently omits malformed/absent evidence and then independently maps the boolean outcome to `DETECTED_RESTORED` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:7458-7485`).
- The real `runHarness` sink only records a valid target and does not make its absence affect the control result (`:7826-7835`).
- `validateResultSchema` requires `controlTargets` to be an object but treats every entry as optional; it validates only entries that happen to exist (`:8573-8583`).
- A direct execution of the real exported bridge with `{ok:true, detected:true, restored:true, timedOut:false}` and no target fields produced `{"state":"DETECTED_RESTORED","targetCount":0}`. This is the current implementation path, not only a hypothetical schema mutation.
- The new tests prove the happy path, sparse IDs, malformed-record omission, and no-target `NOT_EXECUTABLE`, but do not assert that a target-bearing `DETECTED_RESTORED` result without a valid target is rejected (`test/acceptance/g1-svf2-f1-f8-verification.targetevidence.test.mjs:395-574`).

**Failure mode**

A live run can claim that `wrong-owner` or `hidden-fragment` detected and restored its perturbation while the retained JSON lacks the record needed to verify which F1/F2-authoritative fragment was selected and mutated. Because every mandatory control may still be `DETECTED_RESTORED`, this omission does not prevent overall `PASS`. That defeats H3-R1's independent-auditability purpose.

**Disposition of the internally reported Medium**

This is **High**, not Medium, because it is a false-PASS evidence-integrity path at the live gate. For each target-bearing control, `DETECTED_RESTORED` must require a structurally and semantically valid persisted target record. Missing/invalid target evidence should force `FAIL` (for example by producing a PASS-incompatible control result) and must also fail result-schema validation. `PARTIAL`/`BLOCKED` would understate an internally inconsistent mandatory-control claim.

**Minimum correction**

Couple `wrong-owner` and `hidden-fragment` success to successful target sanitation/persistence, add a final control/result cross-check, and add negative tests proving that absent, malformed, or sink-rejected target evidence cannot coexist with `DETECTED_RESTORED` or overall `PASS`.

### Medium — Immediate page-liveness escalation can conservatively remain `FAIL` after later teardown resolves ownership

`runCleanup` sets `cleanupUnresolvedOwnership` monotonically when `page.close()` times out and `page.isClosed() === false` at that point (`test/acceptance/g1-svf2-f1-f8-verification.mjs:1505-1514`, `:1686-1702`). A later successful `context.close()` or `browser.close()` can ultimately close that page, but the earlier flag is not recomputed. The focused test deliberately preserves that behavior (`test/acceptance/g1-svf2-f1-f8-verification.cleanupliveness.test.mjs:109-121`).

This is a **non-blocking semantic overclassification**, not a correctness blocker. The governing contract distinguishes genuinely unresolved final ownership (`FAIL`) from a recorded cleanup failure whose postcondition is ultimately resolved (`PARTIAL`). Final-state recomputation would represent that distinction more precisely. The current behavior is nevertheless conservative: the page-close timeout is retained, overall `PASS` is impossible either way, later cleanup still runs, and no unsafe run can be certified. It may reject a usable evidence run as `FAIL`; it cannot create a false `PASS`. H2-R1 remains closed and this does not block one owner-authorized live run.

## H2-R1 verification — closed

- `buildPlaywrightCleanupResources` uses the installed Playwright 1.62.1 APIs exactly: `!page.isClosed()`, `!context.isClosed()`, and `browser.isConnected()` (`test/acceptance/g1-svf2-f1-f8-verification.mjs:1472-1484`). The installed Playwright declarations include `BrowserContext.isClosed()`.
- Page, context, and browser closes remain separate sequential steps, each using the production `CLOSE_TIMEOUT_MS`; one timeout cannot prevent later cleanup or evidence finalization (`:1679-1713`).
- A positive liveness result adds `cleanupUnresolvedOwnership:true` and durable `{resourceType,livenessObservation,ownership:'unresolved'}` evidence, which `computeOverall` maps to `FAIL`.
- Already-closed/disconnected resources do not set unresolved ownership. Liveness-check exceptions are caught and treated as indeterminate; the underlying cleanup failure still prevents `PASS` and cleanup continues.
- The nine focused cleanup-liveness tests cover the three real API adapters, confirmed-live failure, confirmed-closed/disconnected behavior, independent later steps, throwing/absent liveness checks, and JSON durability.

## H3-R1 verification — partially closed, blocking edge remains

- `wrong-owner` selects the numeric-minimum entry from retained `f1PopulationRecords`; `hidden-fragment` selects the numeric-minimum intersection of retained F2 tree ownership and F1 class-L population. No production hard-coded fragment ID remains.
- Sparse/non-zero IDs cross the browser/Node boundary unchanged, and ordinary real harness execution persists selected fragment, owner, mutation, selection-source/rule, and population metadata.
- No eligible target returns `NOT_EXECUTABLE` without fabricated target metadata.
- These changes close target selection and happy-path durability, but the High finding above leaves successful-result auditability unenforced. H3-R1 is not fully closed.

## Low findings

1. `hidden-fragment.populationSize` records the full F2 tree-owner map size rather than the eligible F2/F1-class-L intersection (`test/acceptance/g1-svf2-f1-f8-verification.mjs:4231-4237`). The selected target remains authoritative; the count label is imprecise.
2. Raw test resources without a named liveness adapter use the generic `confirmStillAlive()` label. Real Playwright resources use the exact API labels, so live evidence is unaffected.
3. The target validator checks record structure and local relationships, not deeper consistency against a persisted authoritative population. That population is not presently retained in a form that permits a full independent recomputation. This is future hardening after the blocking presence/coupling invariant is fixed.

## Verification and scope

- Independent `npm run test:offline`: **4170 total / 4169 pass / 0 fail / 1 existing todo**, exit 0.
- The +18 focused tests are included and pass. No live F1–F8 execution occurred.
- The working diff is limited to the harness, its directly affected acceptance tests, reviews, and handoff. No G2/G3, host-integration H1/H2, OQ-1, host integration, production initializer, Viewer Adapter, Core, M4, or Viewer Clash Panel production change is present.
- Codebase-memory coverage reported no recorded gap for every repository artifact used in this review; source and diffs were also read directly.

## Gate

- **H2-R1:** closed.
- **H3-R1:** not closed because successful target-bearing controls do not require durable target evidence.
- **Harness implementation accepted:** no.
- **Ready for owner authorization of live F1–F8:** no.
- **Required first:** one bounded correction enforcing valid persisted target evidence for every `wrong-owner`/`hidden-fragment` `DETECTED_RESTORED` result, plus focused negative tests and another bounded independent re-review.
- **Still unauthorized:** live F1–F8; G2/G3; host H1/H2; OQ-1; host integration; production/Adapter/Core/M4/Panel changes.
