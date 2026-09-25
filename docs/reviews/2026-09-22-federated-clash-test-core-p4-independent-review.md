# Federated Clash Test core — P4 independent implementation review

- **Date:** 2026-09-22
- **Branch:** `feature/federated-clash-test-core-engine`
- **Reviewed checkpoint:** `b47d5402b553ca5a2d98598795e0e51ba58d5270` (`feat(clashtest): P4 executor and diagnostics (Table A precedence fix)`)
- **Scope:** P4 executor/diagnostics implementation and tests, the P4 plan, frozen-spec §§7, 11, 12, 16.3, 16.7, and 17.3, plus only the directly affected P6 settlement interface. P0–P3 were not reopened.

## Verdict

**P4 is not ready for acceptance.** This review found **0 Critical, 3 High, 2 Medium, and 0 Low** findings. H1 exposes a settlement fact combination that the owner-selected Option-B representation cannot carry without loss. H2 and H3 violate the frozen core's main-thread and memory-bound contracts on legal cap-shaped inputs. M1 and M2 are bounded DTO/error-hardening defects.

This artifact is an independent review claim under `CLAUDE.md`. It requires targeted adjudication before remediation or phase acceptance. P5 must not start.

## High findings

### H1 — simultaneous model death can be lost, producing the wrong Table-A primary fact

**Code:** `clashtest/execution/LocalUnitExecutor.js`, the post-call classification at lines 488–506 and the pre-check settlement at lines 424–440.

**Contract:** frozen spec §16.7 requires all facts from one settlement to be collected before ranking; U6 `model-evicted` outranks U7 `scope-unverifiable` and every U8 capacity/extraction/tree/stale-placement cause. Every other observed fact must remain available for `secondaryCauses` and the complete run-level reasons list.

**Failure mode:** the Option-B implementation exports only two fact channels: the thrown error as `failure.code`, and the bracket answer as `scopeProof`. Although `classifyLibraryError` is given `deadModelKeys`, it records `model-evicted` only when the thrown value itself is named `ModelEvictedError`. If a participant dies during a call that throws a U8 error, the observed death is discarded.

A direct probe evicted `mk-b` inside `findClashes` and then threw `CapacityExceededError('bucket-capacity')`. The returned outcome was:

```text
outcome: discarded
scopeProof: unverifiable
failure.code: capacity-exceeded
```

The P6 plan's `factsFromOutcome` can recover only `scope-unverifiable` and `capacity-exceeded`, so it selects U7. The required primary is U6 `model-evicted`; the capacity cause should remain secondary. The same representation gap loses U6 as a secondary fact when pre-check drift (U5) and a dead co-participant occur together. This makes the ledger cause and complete run reasons schedule-dependent/incomplete, contrary to §16.7 and AC-21.

**Classification:** implementation-compatibility issue exposing a bounded architecture/interface contradiction in the owner-selected no-schema-change repair.

**Minimum correction:** targeted adjudication must first decide how the exact P4-observed fact set crosses the port. The direct correction is a bounded canonical fact/secondary-cause field on `UnitOutcome`, with validator and P6 reconciliation updates. If the owner insists on no schema change, an equally exact existing-channel encoding must be demonstrated for every Table-A pair, including U6+U8 and U5+U6; the current `failure.code` + `scopeProof` pair is insufficient. This is a valid freeze exception because implementation has exposed a concrete correctness contradiction.

### H2 — legal cap-shaped executor and diagnostic work still contains unsliced main-thread spans

**Code:** `LocalUnitExecutor.projectPairs` lines 90–121; `diagnostics.deriveUnitTaints` lines 289–340; `createDiagnosticAggregator.addUnit` lines 410–425; `createDiagnosticAggregator.snapshot` lines 468–490.

**Contract:** frozen spec §17.3 says outcome projection, dedup/merge, canonical sorting, and sealing are deadline-aware, check at least every 64 items, and yield when the slice budget is exhausted. Only synchronous definition validation is excluded.

**Failure mode:**

- pair projection scans up to `maxPairsPerOutcome` synchronously;
- taint derivation scans the whole diagnostic array synchronously;
- `addUnit` performs an unsliced first pass and native sort before its sliced second pass;
- `snapshot()` copies and natively sorts the complete diagnostic map synchronously.

These paths accept legal arrays at the configured caps. The committed 100,000-distinct-reason test already takes roughly 160 ms in this environment, while only the later aggregation loop is instrumented by the slicer. The current tests prove slicing only for `projectDiagnostics`; they do not mechanically bound these other spans.

**Classification:** implementation-compatibility issue and verification gap.

**Minimum correction:** add sliced/generator implementations for pair projection and taint derivation, drive both passes and reason ordering through the slicer/sliced sort, and make final diagnostic ordering sliced. Synchronous oracle helpers may remain for small tests, but the production P4/P6 path must use sliced forms. Reconcile the affected P6 interface before that phase starts.

### H3 — `maxRetainedDiagnostics` does not bound the run's retained diagnostic working set

**Code:** `createDiagnosticAggregator` lines 390–491.

**Contract:** spec §12.4 caps retained diagnostic detail at `maxRetainedDiagnostics`; §17.1's memory formula budgets retained diagnostics by that cap.

**Failure mode:** `dedupMap` stores every distinct diagnostic for the entire run. `maxRetainedDiagnostics` is applied only in `snapshot()`, after copying and sorting the full map. Legal input can therefore retain up to the run-wide number of unique diagnostics rather than the configured retention cap. The committed test with 100,000 distinct legal reasons demonstrates that the map accepts this growth even when `maxRetainedDiagnostics` is much smaller. At production limits, this can exhaust memory before truncation and invalidates the stated memory bound.

This is not only a calibration question: calibration can select a number but cannot make an output cap bound an uncapped internal map. Exact cross-unit occurrence counts plus globally canonical top-K retention also cannot be implemented as a one-pass bounded map without either replay/spill or a defined overflow compromise.

**Classification:** implementation issue exposing a genuine bounded-design decision.

**Minimum correction:** adjudicate one bounded strategy before acceptance: provide replay/spill/two-pass machinery that preserves the frozen exact semantics, or authorize a narrow overflow contract/retention-order correction with an explicit hard cap and fail-safe behavior. Merely lowering `maxRetainedDiagnostics` does not fix this implementation.

## Medium findings

### M1 — pair-scoped diagnostic operands accept the fragment-only `role` field

**Code:** `UnitExecutor.js` lines 435–467.

`checkFragmentsPair` sends pair operands through `checkFragment`, whose shared `FRAGMENT_KEYS` permits `role`. The frozen `ProjectedDiagnostic`/`NormalizedDiagnostic` schema allows `role` only on the singular fragment-scope `fragment`; the P4 plan explicitly says pair-scoped role is dropped. A direct probe returned `{ok:true, issues:[]}` for a pair diagnostic whose `first` and `second` both carried roles. The aggregator then copies those extra fields into stored diagnostic detail.

**Minimum correction:** split the allowed-key sets for singular fragment and pair operand, reject pair-operand `role`, and add a boundary regression test.

### M2 — hostile thrown-value getters can escape the reference executor

**Code:** `LocalUnitExecutor.classifyLibraryError` lines 145–179 and the projection catch at lines 542–545.

The classifier reads `error.name`, `error.message`, and capacity-detail properties without guarded access. A direct probe throwing an object with a throwing `name` getter caused `createLocalUnitExecutor(...)(request)` to reject with `hostile-name-getter` instead of returning `failed:internal-error`. The projection catch has the same unguarded `err.name`/`err.message` family. P6 is planned to substitute rejected executors, so this is not a false-clean path, but the reference executor violates its own structured error-mapping boundary and loses its normal outcome evidence.

**Minimum correction:** use total guarded property readers and safe string truncation for every thrown-value field, then test hostile `name`, `message`, capacity-detail, and projection-error getters.

## Confirmed sound areas

- The request/outcome closed-schema validators, derived diagnostic-field rechecks, pair canonicalization, and owner-membership seam behave as intended for the tested shapes.
- Pre/post scope bracketing, lease revalidation immediately before issue, live-binding post-checks, and the implemented Table-A combinations preserve both thrown and scope facts where those two existing channels are sufficient.
- Diagnostic projection preserves `dbId:null`, ambiguous-model fail-closed attribution, completeness classification, whole-array overflow totals, and structured-clone safety for ordinary library data.
- The library call uses the required multi-target shape, fresh arrays, correct mode/clearance/broad-phase fields, and one call per attempt.
- No production P4 module imports Viewer, Three.js, collision internals, or P6/run code.

## Verification

- P4 execution suite: `node --test test/clashtest/execution/*.test.mjs` → **140 passed, 0 failed**.
- All implemented Clash Test suites: `node --test test/clashtest/**/*.test.mjs` → **779 passed, 0 failed**.
- Full repository runner in this restricted environment: **1,905 total / 1,900 passed / 4 failed / 1 todo**. Three failures are sandbox-only M4 spike-server `listen EPERM`; the fourth was the unrelated placement-invalidation fixture and passed **18/18** immediately when rerun alone. No P4/Clash Test test failed.
- Direct probes reproduced H1, M1, and M2 exactly as described.
- `git diff --check` and the P4 production layering scan were clean at the committed boundary.
- The working tree was clean before this review artifact and handoff update.

## Gate result

`P4 requires targeted adjudication and remediation before acceptance.`

Blocking findings: **H1, H2, H3**. Do not start P5.
