# D-10: evidence that the engine seals result sets its own reader rejects (per-model root cap)

- **Date:** 2026-09-24
- **Branch / base:** `feature/federated-clash-test-core-engine`, base HEAD `37f0997`
- **Origin:** the P7 D-8b/D-8c review (`.superpowers/sdd/p7-engine-integration/review-A.md`, "Incidental finding (3)") and the D-10 line in `progress.md`. That review checked the finding against source only and did not run it. This record runs it.
- **Scope:** evidence only. No production code, spec, plan or handoff was edited.
- **Evidence test:** `test/clashtest/integration/rootCap.producerReader.test.mjs`. It has 6 tests: 5 pass and 1 is a standing `test.todo`, following precedent R-P7-24. The file runs in about 2.8 s.

## 1. The invariant break

The result-set schema limits two per-model arrays to `ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection` = **10,000** entries:

| Array | Where the cap is set |
| --- | --- |
| `provenance.models[].scopeDigests.roots` | `clashtest/results/resultSetSchema.js:142` |
| `ledger.rootOwners[].owners` | `clashtest/results/resultSetSchema.js:196` |

The reader derives its capture-time `ARRAY_CEILINGS` from these limits (`validateResultSet.js:~100-106`). An array that is too long is therefore reported as `array-too-long`, which the reader treats as **corrupt** (`CorruptResultSetError`), not as too large.

The producer never checks this limit. `clashtest/planning/rootResolution.js:214-224` (step 6) pushes one `rootOwners` row and one `scopeRoots` row for every root in the union RU = RA ∪ RB. Nothing downstream refuses a model with more than 10,000 roots:

- **The planner's record budget.** Step 9 (`rootResolution.js:257-264`) admits about 3 plan records per root. At the default `maxPlanReferences` of 500,000, 10,001 roots use about 30,000 records, so the `plan-too-large` guard does not fire until roughly 166,000 roots.
- **The run.** It seals `completed`.
- **The result store.** It persists the set.
- **The same engine's resident copy.** `engine.getResultSet` returns it without validating it.

## 2. Which variants are reachable (measured on the real engine, not derived from source)

Each run goes through the full pipeline: P2 capture, P3 planning, P6 run, seal, persist into `InMemoryResultStore`, `releaseResultSet`, and then a read-back by id through the store (`engine.js` `readStoredSet` → `readResultSet`). All runs use `RUN_OPTION_DEFAULTS` and the scripted clean executor.

| Variant | Limits | Reachable? | Outcome |
| --- | --- | --- | --- |
| (a) Whole-model scope on a model with 10,001 roots | defaults | **Yes** | The run is `completed` and the set is persisted. Both arrays have 10,001 rows. The resident read succeeds. The by-id read after release fails with `CorruptResultSetError`, `array-too-long` at both paths. |
| (b) Two explicit selections on the **same** model: A has 10,000 dbIds and B has 1 other dbId | defaults | **Yes** | Same outcome as (a). The per-selection budget (`definition/validate.js:205`, `maxExplicitElementsPerSelection` = 10,000 per selection) does not limit the per-model union. A 10,000 + 10,000 disjoint version was also run outside the committed test: it completed with 20,000 rows and failed the same way, taking about 4.6 s. |
| (c) One explicit selection of 10,001 dbIds | defaults | **No** | The definition validator refuses it: `InvalidTestDefinitionError`, `too-many-elements` at `/selectionA/entries/0/dbIds` (`definition/validate.js:186`). |
| (c) Same selection, with `maxExplicitElementsPerSelection` raised to 10,001 | raised engine limit (ceiling 100,000, `options.js:89`) | **Yes** | Same outcome as (a). |

In every reachable variant, `validateResultSet` on the stored set returns exactly two issues:

- `/ledger/rootOwners/0/owners` `array-too-long`
- `/provenance/models/0/scopeDigests/roots` `array-too-long`

## 3. Minimal reproduction

The cheapest reproduction is variant (a):

1. Create a flat synthetic model `mA` with 10,001 one-fragment roots, and a model `mB` with 1 root.
2. Set `selectionA: [{kind:'model', modelKey:'mA'}]` and `selectionB: [{kind:'model', modelKey:'mB'}]`.
3. Use default run options and default engine limits.
4. Call `startRun(...).done`. It resolves with `completed`.
5. Call `releaseResultSet(runId)`, then `getResultSet(runId)`. It fails with `CorruptResultSetError`.

This takes about 0.6 s.

## 4. Severity and ownership

**Severity: High.** The run looks successful: it reports `completed` and the set persists. The failure only shows up later, once the resident copy has been released or evicted and every by-id read goes through the store. The read then reports corruption, which is a stronger claim than `ResultSetTooLarge`. This is the same class of producer/reader break as R21-2. Variant (a) is the ordinary whole-model path, and a real BIM model can easily have more than 10,000 roots. By code reading only, not tested here: the other store-backed read paths (`withReadSet` → `readStoredSet`, which serve freshness, claims and `rerun`) would reject the set in the same way once it is no longer resident.

**Ownership:**

- **Owning phase: P3 (the producer).** `rootResolution.js` emits the oversized arrays, and P3's planning budget is the place where a refusal would sit.
- **Alternative owner: P5 (the schema).** The caps at `resultSetSchema.js:142/196` are tied to the entries-per-selection ceiling, which is not a bound the producer respects.
- **P6: contributing only.** The run seals the set, and the resident copy is served without validation. Neither is the cause.

**Owner decision pending (not decided here):**

- **Option 1:** derive the per-model root caps from a bound the producer does respect, such as a `maxPlanReferences`-based limit. This is a schema change.
- **Option 2:** add a producer-side `plan-too-large` guard for when a model's union roots exceed the schema cap.

When the fix lands, the `test.todo` in the evidence test should be changed to `test()`. The three passing `OPEN GATE D-10` tests pin the current behavior, so they have to be flipped or removed at the same time.

## 5. Verification

- **Proof that the todo fails for the stated reason.** Run once as a plain `test()`, the file gave 5 pass and 1 fail. The failure is `validateResultSet` `{ok:false}` with `array-too-long` at both paths, for variant (a). The test was then restored to `test.todo`.
- **Full suite (`npm test`), baseline 2524 tests / 2522 pass / 0 fail / 2 todo:** with the new file it is **2530 tests / 2527 pass / 0 fail / 3 todo**. That result held on 7 of 9 runs.
- **Two runs had one intermittent failure each, and neither involved this file.**
  - One was `differential.test.mjs:133` "cross-model explicit, surface-intersection", where integrity came back `caveated` instead of `clean`.
  - The other was not captured.
- **The same kind of flakiness exists without this file.** With the file moved aside, 1 of 6 baseline runs failed once, in "duct through beam, no vertex inside either (round 7 regression)".
- **The differential file on its own did not flake.** It passed 36 of 36 runs under 6-way parallel load.

## 6. Applied (owner ruling #5)

The owner chose **Option 2**: a producer-side `plan-too-large` guard, with the Result Set schema ceilings left unchanged. Base HEAD `c4177b1`, after D-8b and D-11/D-12 had landed.

### 6.1 Guard

- **Location:** `clashtest/planning/rootResolution.js`, at the start of step 6. By this point step 5 (F16) has already proven that RU = RA ∪ RB, so the union answer's root count is the model's real union. The guard therefore runs before any `classes` / `rootOwners` / `scopeRoots` row is built, before the step 9 budget charge, and before `buildRootTables`. All earlier planning causes keep their precedence: `enumeration-failed`, `owner-mapping-mismatch`, `element-unresolvable` and `hierarchy-overlap`.
- **Rule:** `answerU.roots.length > MAX_ROOTS_PER_MODEL` ⇒ `{ok: false, cause: 'plan-too-large', overflowClass: 'root-table'}`.
  - The refusal charges nothing: `planRecords` is unchanged.
  - It fails closed whether or not a budget is supplied.
  - The planner maps it to the planning gap `plan-too-large` with detail `{overflowClass: 'root-table'}`, through the same path as every other root-resolution refusal (`planner.js` ~l.316-320). The run then seals `failed`.
- **Cap constant:** `export const MAX_ROOTS_PER_MODEL = ENGINE_LIMIT_CEILINGS.maxEntriesPerSelection`, imported from `options.js`. This is the same constant `resultSetSchema.js` uses for `ScopeDigests.roots.max` and `RootOwners.owners.max`, and no literal is restated. A test pins `TYPES.get('ScopeDigests').fields.roots.max` and `TYPES.get('RootOwners').fields.owners.max` to `MAX_ROOTS_PER_MODEL`. It fails if either side drifts.
- **Closed-enum check:** the spec names no `overflowClass` values. The code's closed set is `PLAN_RECORD_CLASSES` in `ledger.js`, and no member was added. The guard reuses `root-table`, which §6.5.1 names as "root-table entries" (one per root in the model's `A'`/`C`/`B'` tables). Its meaning fits: the model's root-table entries, which number |RU|, exceed the representable per-model count. The planning gap schema (`PlanningGap {phase, cause}`) does not persist `detail`, so no persisted value changed.

### 6.2 Audit: the sealed arrays per model and per root, with their schema caps and producer bounds

| Array (sealed set) | Schema cap (`resultSetSchema.js`) | Producer bound | Status |
| --- | --- | --- | --- |
| `provenance.models[].scopeDigests.roots` | `maxEntriesPerSelection` ceiling (10,000) | one row per union root of the model | **covered by the D-10 guard** |
| `ledger.rootOwners[].owners` | `maxEntriesPerSelection` ceiling (10,000) | one row per union root of the model | **covered by the D-10 guard** |
| `provenance.models` | 2 × `maxEntriesPerSelection` ceiling | one per model key in the union of both selections' entries; each selection has ≤ `maxEntriesPerSelection` entries (V4, `definition/validate.js`; engine limit ≤ its ceiling), one per model after normalization | bounded (definition validator) |
| `provenance.admissionBaseline` | 2 × `maxEntriesPerSelection` ceiling | one per run model key (`Run.js` ~l.298) | bounded (same) |
| `ledger.rootOwners` (per-model rows) | 2 × `maxEntriesPerSelection` ceiling | one per planned model | bounded (same) |
| `ledger.unreachablePopulation` | 2 × `maxEntriesPerSelection` ceiling | ≤ one per model (whole-scope union only) | bounded (same) |
| `ledger.hierarchyInternal` | 2 × `maxEntriesPerSelection` ceiling | ≤ one per model | bounded (same) |
| `RootOwnerRow.ownerDbIds`, `UnreachablePopulation.ownerDbIds` / `mixedOwnerDbIds`, `UnresolvedSelection.dbIds` | `ids()` = `maxPlanReferences` ceiling | every id is charged to the record budget (`root-owner`, `unreachable-population`, `unresolved-selection`) ⇒ ≤ `maxPlanReferences` ≤ its ceiling | bounded (record budget) |
| `ledger.unresolvedSelections` | `maxLedgerRecords` ceiling | each row is charged (1 + ids) ⇒ ≤ `maxPlanReferences` | bounded (record budget) |
| `HierarchyInternal.examples` / `HierarchyExample.ownerDbIds` | 20 / `ids()` | sliced to `MAX_OFFENDERS` = 20 / `MAX_EXAMPLE_OWNERS` = 8 (`rootResolution.js` step 8) | bounded (producer slice) |
| `UnitRecord.sourceRootDbIds`, `UnitTarget.rootDbIds` | `ids()` = `maxPlanReferences` ceiling | charged per expanded id (A14) ⇒ ≤ `maxLedgerRecords` run budget; a unit's own ids ≤ `maxSourceDbIdsPerUnit` / the target caps | bounded (record budget, A14) |

Only the two arrays capped at 1 × `maxEntriesPerSelection` could be reached past their cap. Every array capped at 2 × `maxEntriesPerSelection` is indexed per model, and the definition validator bounds it. No fix needed a schema or closed-enum change.

### 6.3 Before and after (real engine, default run options, read back by id after `releaseResultSet`)

| Case | Before (`c4177b1`) | After |
| --- | --- | --- |
| (a) whole-model scope, 10,001 roots | `completed`; read back fails with `CorruptResultSetError` `array-too-long` | `failed`, planning gap `plan-too-large`, no units; the stored set validates and reads back |
| (b) explicit 10,000 + 1 on one model | same as (a) | same as (a) |
| (c) 10,001 dbIds, `maxExplicitElementsPerSelection` raised to 10,001 | same as (a) | same as (a) |
| (c) at default limits | `InvalidTestDefinitionError` `too-many-elements` | unchanged |
| whole-model, exactly 10,000 roots | (not tested) | `completed`; the set validates and reads back after release |
| explicit union 9,999 + 1 = 10,000 | (not tested) | `completed`; the set validates and reads back after release |

The failed seal records `plan-too-large` twice in `ledger.planningGaps`: once from the planner's ledger and once from `Run.js`'s seal. This is the engine's existing failed-planning behavior, and the D-8b reproducer in `nodeFactor.ledgerDiagnostic.test.mjs` asserts it the same way. D-10 does not change it.

### 6.4 Tests and verification

- `test/clashtest/integration/rootCap.producerReader.test.mjs` now has 10 tests, all passing, and runs in about 5.3 s:
  - the three `OPEN GATE D-10` pin tests were converted to refusal tests for (a), (b) and (c-raised);
  - two boundary tests were added;
  - a stage-level test checks that the refusal is `root-table`, charges nothing, and fails closed with no budget, and that exactly 10,000 roots resolve;
  - a cap-drift test was added;
  - the standing `test.todo` (R21-2) was flipped to `test()`.
- **TDD:** with only the constant exported and no guard, 5 of the 10 tests failed for the stated reason (`status` was `completed`, not `failed`; the stage returned `ok: true`; `validateResultSet` reported `array-too-long`). All 10 pass with the guard.
- **Full suite (`node scripts/run-tests.mjs`):**
  - baseline at `c4177b1`: 2535 tests / 2533 pass / 0 fail / 2 todo;
  - after: 2539 tests / 2538 pass / 0 fail / 1 todo.
- **Spec:** erratum **A15** in §25, plus one sentence in §6.5.1.
