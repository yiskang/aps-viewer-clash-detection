# G1 SVF2 F1–F8 harness remediation — bounded independent re-review

**Date:** 2026-09-29  
**Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`  
**Reviewed branch / HEAD:** `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`  
**Scope:** the uncommitted F1 digest/evidence, dependent-control, exit/import remediation and the newly disclosed F5 count concern only. No live G1 execution was performed.

## Verdict

The **F1 remediation is accepted**. It corrects the digest row contract, distinguishes digest inequality from extraction/oracle failure, persists bounded audit evidence into the final result, preserves dependent inputs before digest evaluation, and makes CLI exit/import behavior fail-closed.

The harness is **not ready for a new live authorization**. One High-severity F5 defect can make a live F5 result materially unreliable. A bounded harness/test-only correction and targeted re-review are required first. The aggregate offline gate also did not reproduce the claimed clean result because one unchanged timing-sensitive Core test failed; that separate verification residual must be cleared or explicitly dispositioned before a live authorization.

**Finding count:** 0 Critical / 1 High / 1 Medium / 1 Low.

## Findings

### High H1 — F5 per-dbId evidence collapses to the total loaded population and is not used as a limit gate

**Location:** `test/acceptance/g1-svf2-f1-f8-verification.mjs:3143-3154`, `3183-3191`, `5357-5377`; governing plan `docs/research/2026-09-27-g1-svf2-f1-f8-harness-build-plan.md:§7.5`.

`populationClasses` records class-L rows as `{fragId, cls:'L'}` and omits `ownerDbId`. The later `perDbIdCounts` loop keys those rows by `row.ownerDbId`, so every class-L fragment is accumulated under the single `undefined` key. `maxPerDbIdFragmentCount` therefore equals the total loaded-fragment count rather than the maximum count for one owner dbId. This explains the retained live value `789` and makes that field non-authoritative.

The failure is broader than the field alone: `scoreF5` copies `maxPerDbIdFragmentCount` into evidence but never compares it with `maxFragmentsPerDbId`. Its PASS predicate checks only `F2.accountingBalanced` and `oversizedGeometryCount === 0`; it also maps absent F4 `oversizedGeometryCount` to zero. That contradicts the plan's requirement that F5 prove full F4 census completion and every applicable existing bound.

**Failure mode:** a fixture can receive F5 PASS with an incorrect per-dbId count, without proving the per-dbId limit, and even while F4 evidence is absent. The prior live F5 PASS is therefore unreliable and must not be used as evidence that F5 is satisfied.

**Minimum correction:** derive per-dbId counts from the authoritative `populationExtraction.records` / `f1PopulationRecords` entries, whose `ExtractedFragmentRecord.ownerDbId` is populated by `extractAllFragments`; retain the owning dbId with the maximum; make `scoreF5` require complete F2 and F4 evidence and explicitly compare every recorded population/geometry dimension against the imported existing constants. Add focused tests for multiple owners, a per-owner breach, missing F4 fields, and a normal within-limits PASS. Do not change any Core/public limit.

**Disposition:** blocking before any future live G1 rerun; harness/test-only fix is sufficient. No production, Core, Viewer Adapter, Panel, M4, OQ-1, or host change is required.

### Medium M1 — requested clean aggregate offline result was not reproduced

The independent `npm run test:offline` run produced **4213 total / 4211 pass / 1 fail / 1 existing todo**, exit 1, not the stated 4213 / 4212 / 0 / 1. The sole failure is the unchanged `test/query/ContainmentModeQuery.test.mjs:64-85` real-clock scheduler test. A direct isolated run also failed the same assertion. The directly affected F1/final-integration files independently passed **19/19**.

There is no diff in `collision/`, `clashtest/`, `clashpanel/`, or `wwwroot/`, and the failing file is unchanged, so this is not evidence of an F1 remediation regression. It is nevertheless an unresolved verification result: the handoff must not claim a clean aggregate gate until a future authorized remediation/checkpoint produces one or the baseline test is explicitly adjudicated.

**Disposition:** does not invalidate the F1 code review, but a clean aggregate gate or explicit baseline disposition is required before live authorization. No retry was used to manufacture a passing full-suite result.

### Low L1 — new F1 exception evidence uses the unbounded `sessionErrOf` carrier

`observeF1` persists digest/extraction exceptions through `sessionErrOf`, which copies `name`, `message`, and `reason` without the harness's stronger bounded/redacted `describeError` treatment. This cannot create PASS and does not make the corrected digest semantics ambiguous, but a pathological or sensitive error message could enlarge or weaken the hygiene of the durable artifact.

**Disposition:** non-blocking evidence-hardening item; it may be folded into the bounded F5 harness fix if explicitly authorized, but it is not required to accept the F1 remediation.

## Verified remediation behavior

### F1 digest construction and durable evidence

- Subtree rows carry `fragId`, `ownerDbId`, and `geometryId`; class-L population digest rows carry the same required identity fields (`verification.mjs:3075-3089`, `3143-3159`).
- Digest exceptions increment separate oracle-error counters and produce `ORACLE_ERROR`; true unequal digests increment mismatch counters and produce `UNEQUAL` (`verification.mjs:3092-3105`, `3161-3167`, `3223-3234`). Extraction failure remains `EXTRACTION_ERROR`.
- The bounded first-20 mismatch carrier includes adapter/library digest values, component counts, row count/sample, state, and exception. The population record includes both digests/counts, sample, state, and error (`verification.mjs:3054-3115`).
- `runHarness` persists both structures at `checks.F1.evidence.details`, and the final-integration test asserts the carrier is present (`verification.mjs:8129`; `verification.finalintegration.test.mjs:399-405`).

These records are sufficient to distinguish comparison failure from extraction/oracle failure and to audit the rows actually presented to the digest, subject only to Low L1's error-carrier hardening.

### Dependent controls

- `f1PopulationRecords` is assigned immediately after successful `extractAllFragments`, before population digest evaluation (`verification.mjs:3117-3135`). Digest-oracle failure therefore does not starve F4/F7 or the wrong-owner control.
- Wrong-owner uses the valid non-negative safe integer `2147483647`, or `2147483646` when necessary, and is guaranteed different from the real owner (`verification.mjs:4205-4212`). The real `scopeDigest` contract rejects the old negative sentinel; the new test exercises both values through real population scanning/digesting.
- Invalid-bounds and bounds-beyond-tolerance dependencies reach their bridged controls when valid F7 fields exist; absent F7 evidence still fails closed as designed.

### Exit and import semantics

- `PASS=0`, `FAIL=1`, `BLOCKED=2`, `PARTIAL=3`, and unknown/missing verdict `=4`; a thrown harness error yields 1 (`verification.mjs:9721-9744`). Child-process tests verify actual shell status.
- `isDirectInvocation` converts the module URL with `fileURLToPath` and compares filesystem realpaths, which handles URL-encoded spaces and symlink aliases correctly. Missing/unresolvable inputs fail closed. `main()` is reached only through that guard (`verification.mjs:9747-9759`).
- Importing with `G1_F1_F8_LIVE_AUTHORIZED=YES` was exercised in a child process and did not start Phase 0 or live work (`verification.f1digest.test.mjs:235-250`).

## Scope and repository state

- Verified branch / HEAD: `main` @ `9eab858a7f7c314ba43c3416d5345a3124707088`.
- Review-time tree was already dirty with the stated harness/tests/handoff plus retained prior live report/evidence/review/prompt. This review adds only this review artifact and the handoff update.
- No live rerun occurred. Retained live evidence timestamps predate this review and were not changed.
- No production/Core/Viewer Adapter/M4/Panel change and no G2/G3/host H1/H2/OQ-1/host integration work was introduced.

## Authorization state

The currently authorized review is complete. No implementation correction or live execution is authorized by this review. The recommended next owner action is to authorize a bounded harness/test-only H1 correction, followed by the focused tests, a clean aggregate-gate verification or explicit disposition of M1, and a targeted independent re-review. A new exactly-one live F1–F8 execution remains a separate later owner gate.

