# G1 SVF2 F1–F8 harness — bounded H2-R1 / H3-R1 remediation review

- **Branch:** `feature/g1-svf2-f1-f8-harness` (base HEAD `1d96624`; changes uncommitted at time of writing).
- **Authorization:** owner's "Bounded H2-R1 / H3-R1 Harness Remediation" prompt (2026-09-29), exactly two High findings from [the bounded independent re-review](2026-09-29-g1-svf2-f1-f8-harness-h1h3-bounded-independent-rereview.md). No live F1–F8.
- **Files changed:** `test/acceptance/g1-svf2-f1-f8-verification.mjs`; `...stage8.test.mjs` (+1 fixture line `controlTargets: {}`); new `...cleanupliveness.test.mjs` (9 tests); new `...targetevidence.test.mjs` (9 tests).

## H2-R1 — real liveness classification
- New exported `buildPlaywrightCleanupResources({page,context,browser})`, wired at the real `nodeCleanupResources` site: page/context → `!isClosed()`, browser → `isConnected()`; absent resources stay `null`.
- `runCleanup` `step()`: after a close timeout/failure, positive "still alive" sets `cleanupUnresolvedOwnership` and enriches that step's `cleanupFailures` entry: `{step, error, resourceType, livenessObservation:'page.isClosed()===false'|'context.isClosed()===false'|'browser.isConnected()===true', ownership:'unresolved'}` → `computeOverall` branch 1 = **FAIL**.
- Liveness absent/throwing = indeterminate: prior classification kept, never escapes, never marked resolved. Confirmed-closed = no unresolved flag (PARTIAL). Independent bounded closes preserved.

## H3-R1 — durable target evidence
- New additive top-level `controlTargets` (ControlResult shape unchanged), fed by `runBridgedControl`'s `onTargetEvidence` → `runControlSafely` sink; sanitized Node-side (`sanitizeControlTargetEvidence`), validated (`validateControlTargetEvidence`, `validateResultSchema`); Phase 0 failure results emit `{}`.
- `wrong-owner`: `controlName, selectedFragId, selectedOwnerDbId, injectedOwnerDbId (≠ selectedOwnerDbId), selectionSource:'f1PopulationRecords', selectionRule:'numeric-minimum', populationSize`.
- `hidden-fragment`: `controlName, selectedFragId, selectedTreeOwnerDbId, actedOnFragId (= selectedFragId), selectionSource:'f2TreeOwnerByFragId-intersect-f1PopulationClasses-L', selectionRule:'numeric-minimum', populationSize`.
- No eligible target → NOT_EXECUTABLE, no record (no 0/1 fallback). Sparse IDs 7/4242 retained exactly.

## Verification
`npm run test:offline`: 4170 total / 4169 pass / 0 fail / 1 existing todo, exit 0 (baseline 4152/4151/1; +18 tests). Independently re-run by controller and by the reviewer.

## Focused internal review (opus, read-only)
**0 Critical / 0 High.** Dispositions (none fixed this pass — outside bounded scope):
- M1: liveness checked right after `page.close()` timeout, before context/browser close; if later closes cascade-close the page, run stays FAIL rather than PARTIAL (safe direction; test asserts it). **Owner decision.**
- M2: schema does not require a `controlTargets` entry for an executed control (sanitizer-null on malformed data → PASS possible without record). Practically unreachable with real data. **Deferred.**
- L: hidden-fragment `populationSize` counts the full F2 tree map, not the intersection; fallback `livenessObservation` label wording for raw test resources; target recorded before boolean-typing check; validator is structure-only (population not persisted). **Deferred.**

## Gate
Live F1–F8 **not run**; no G2/G3/H1/H2/OQ-1/host/Core/Adapter/M4/production work. Harness not yet accepted; next step is owner decision + bounded independent re-review.

---

# Addendum — final bounded H3-R1 target-evidence coupling fix (2026-09-29)

**Authorization:** owner's "Final Bounded H3-R1 Target-Evidence Coupling Fix" prompt; closes the High finding of [the bounded independent re-review](2026-09-29-g1-svf2-f1-f8-harness-h2r1-h3r1-bounded-independent-rereview.md). Out of scope and untouched: FAIL-vs-PARTIAL teardown, populationSize wording, fallback liveness label, unrelated validator hardening, dead Node-side controls.

## PASS-gating rule
- `computeOverall` takes a new `controlTargets` input. For `wrong-owner` and `hidden-fragment`, `DETECTED_RESTORED` counts as restored (in both the branch-3 FAIL test and the branch-5 PASS test) **only if** `validateControlTargetEvidence(name, controlTargets[name]).valid`. Otherwise the control is treated as not restored ⇒ **FAIL**. Missing `controlTargets` ⇒ FAIL. `runHarness` passes its collected `controlTargets`; the Phase 0 path is already FAIL via `fatalErrorObserved`.
- `validateResultSchema` (evidence boundary): a target-bearing control `DETECTED_RESTORED` without a valid record is a schema error; `NOT_EXECUTABLE` with any record is a schema error.
- `runBridgedControl` now emits the record to the sink only after the strict boolean check, so a `NOT_EXECUTABLE` (malformed-in-page-result) control never carries a record.

## Target-record validation rules (`validateControlTargetEvidence`, unchanged rules, now gating)
`controlName` matches; `selectedFragId` finite number; `selectionSource`/`selectionRule` equal fixed constants; `populationSize` integer ≥ 1. wrong-owner: `selectedOwnerDbId`, `injectedOwnerDbId` finite numbers and `injectedOwnerDbId !== selectedOwnerDbId`. hidden-fragment: `selectedTreeOwnerDbId`, `actedOnFragId` finite numbers and `actedOnFragId === selectedFragId`. Records originate only from `sanitizeControlTargetEvidence`, which copies the known fields only (no live objects).

## Tests
New `...targetcoupling.test.mjs` (10 tests: valid PASS-compatible; wrong-owner/hidden-fragment missing; missing carrier; malformed; semantic invalid ×2; wrong-name filing; bridge no-record-on-malformed-booleans; bridge valid emit) + stage8 schema-coupling test + 2 runHarness-level tests. Fixtures that stubbed target-bearing controls as DETECTED_RESTORED without records were updated (`baseCleanInput`, cleanupliveness `cleanInput`, controlbridge/stage8 stubs, stage8 `fabricateValidResult`). Failing-first: the 8 gating/schema tests were run red before the fix; the bridge malformed-boolean test's red run was masked by a missing import, so its pre-fix failure was confirmed by the reviewer's probe, not by the test.
`npm run test:offline`: **4183 total / 4182 pass / 0 fail / 1 existing todo**, exit 0.

## Focused internal review (opus, read-only)
0 Critical / 0 High. One Medium (fixed): sink invoked before boolean check ⇒ NOT_EXECUTABLE result could carry a record (schema-invalid, fail-safe). Fixed and tested. Noted, out of scope: `validateResultSchema` does not recompute `overall`; validator tolerates extra fields on injected test records (real path sanitizes) — Low.

Live F1–F8 not run; all later gates remain unauthorized.
