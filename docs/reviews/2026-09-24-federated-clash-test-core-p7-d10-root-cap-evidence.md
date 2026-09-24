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
