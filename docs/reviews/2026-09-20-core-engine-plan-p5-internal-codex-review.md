Revise P5 before implementation; its task-level code contradicts its reconciled interfaces and can produce Result Sets that its own reader rejects.

# Executive Summary

The specification is not implementation-ready. I found five critical issues and four important improvements.

Most risk comes from reconciliation changes being applied only to the phase summary and gates, not to the implementation steps. Following the tasks literally would cause compile failures, incorrect claim decisions, non-conforming digests, unsafe untrusted-input handling, and incomplete status APIs.

No files were modified.

# Critical Issues

## 1. P5.1 uses the superseded P1 identity API

- **Severity:** Critical
- **Location or section:** [P5.1 implementation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:228)
- **Problem:** The summary correctly specifies `makePairId(mode, x, y)` and `pairSemanticsOf(mode)`, but the implementation imports nonexistent `pairSemanticsForMode` and calls `makePairId(source, target, semantics)`.
- **Why it matters:** This either fails to compile or silently passes a semantics string where a mode is required. Containment orientation and every resulting `PairId`/`ResultId` can be wrong.
- **Concrete failure scenario:** P1 implements its documented contract. P5 imports `pairSemanticsForMode`, causing module initialization to fail before any result can be projected.
- **Recommended specification change:** Rewrite P5.1 to import only the reconciled P1 names and use `makePairId(ctx.mode, p.source, p.target)`. Remove the local semantics variable and add a direct integration test against P1’s actual exports.

## 2. The normative claim implementation omits the reconciled freshness contract

- **Severity:** Critical
- **Location or section:** [Phase summary](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:38), [P5.2 implementation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:485)
- **Problem:** `freshnessStateOf` is promised but never implemented. `assessNoClashClaim` compares `currentFreshness === 'current'` directly and does not append object-form freshness reasons to `qualifiers`.
- **Why it matters:** P6 and P7 pass `{state, reasons}` objects. A genuinely current result would be rejected, while the documented explanation for stale or unverifiable refusals would be lost.
- **Concrete failure scenario:** `engine.canClaimNoClashes` passes `{state:'current', reasons:[]}`. The literal comparison returns false, contradicting the reconciled API and the engine-level acceptance criteria.
- **Recommended specification change:** Replace the P5.2 code and tests with the reconciled implementation: define `freshnessStateOf`, call it exactly once per helper, test valid and malformed object shapes, and verify that object reasons appear in `qualifiers`.

## 3. Writer derivation conflicts with reader invariants and digest semantics

- **Severity:** Critical
- **Location or section:** [Run-outcome derivation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:391), [digest projection](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:615)
- **Problem:** There are two producer/reader contradictions:
  - `deriveRunOutcome` declares full coverage when all leaves are `evaluated`, without requiring `scopeProof === 'equal'`; validation does require it.
  - `DIGESTED_UNIT_KEYS` includes `secondaryCauses`, although the design and P6 explicitly require them to be excluded from `ledgerDigest`.
- **Why it matters:** This violates “an engine never produces a set it cannot read” and breaks deterministic digest equality across different callback schedules.
- **Concrete failure scenario:** An evaluated leaf with `scopeProof:'unverifiable'` seals as `coverage:'full'`; read-back rejects it as `coverage-not-full`. Separately, two settlements with the same primary cause but different observed secondary races receive different ledger digests.
- **Recommended specification change:** Require every leaf to be both `evaluated` and `scopeProof:'equal'` when deriving full coverage. Remove `secondaryCauses` from `DIGESTED_UNIT_KEYS`. Add writer-to-reader and permutation tests for both cases.

## 4. Untrusted capture is incompatible with P0 and reads unsafe fields before capture

- **Severity:** Critical
- **Location or section:** [P5.4 implementation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:773), [readResultSet](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:980), [P0 capture contract](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p0-foundations.md:82)
- **Problem:** P5 calls `captureDetached` with `softMaxNodes`, `unknownFieldByteBudget`, and `onRootKey`; P0 actually exports `captureData` with one node ceiling and `rootGate`. Additionally, both capture functions default `runId` from `raw?.runId`, which can invoke an attacker-controlled getter before descriptor-based capture.
- **Why it matters:** The code will not integrate with P0, and the getter access violates the central guarantee that no accessor on external input is invoked.
- **Concrete failure scenario:** A raw set defines an enumerable `runId` getter that throws or causes a side effect. `readResultSet` invokes it while evaluating its parameters, before the safe capture traversal begins.
- **Recommended specification change:** Rewrite P5.4 against `captureData` exactly as reconciled in P0. Never derive metadata from `raw`; accept an explicit diagnostic `runId` or extract it only from the captured copy. Specify the P0 one-ceiling error mapping and add accessor tests for `schemaVersion` and `runId`.

## 5. The status-reader contract is internally impossible and incompletely implemented

- **Severity:** Critical
- **Location or section:** [Status exports](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:41), [P5.6 implementation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1085), [OPEN-2](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/interface-reconciliation.md:220)
- **Problem:** The summary requires `createStatusReader`, `buildStatusReaderSteps`, and `readLedger`, but P5.6 produces and implements only the one-shot helpers. The implementation also:
  - returns `required:false` for `undetermined`, despite the pinned value being `null`;
  - treats benign `witness-unavailable` as verdict-affecting;
  - cannot derive complete hierarchy-internal element status because the persisted root rows lack the required `cls` marker.
- **Why it matters:** P8 has no valid API to consume, benign diagnostics become false caveats, and hierarchy-internal status can be under-reported.
- **Concrete failure scenario:** P8 imports `buildStatusReaderSteps` and fails at module load. Independently, an evaluated pair with only `witness-unavailable` returns `covered-caveated` although the gates require `covered-clean`.
- **Recommended specification change:** Resolve OPEN-2 before implementation—prefer persisting and digesting an explicit root-class marker. Then provide complete pseudocode and tests for all five exports, `required:null`, index reuse, the witness filter, and hierarchy cases beyond the bounded examples list.

# Important Improvements

## 1. “Sealed exactly once” is not enforced

- **Severity:** High
- **Location or section:** [Global constraint](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:9), [sealResultSet](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:645)
- **Problem:** `sealResultSet` accepts an already sealed set, shallow-copies it, and produces another sealed object.
- **Why it matters:** The enforced lifecycle invariant is only a convention. Accidental resealing can recompute digests or create multiple “canonical” sealed objects.
- **Concrete failure scenario:** A caller invokes `sealResultSet(existingSealedSet, ...)`; it succeeds instead of reporting a lifecycle error.
- **Recommended specification change:** Define the rejection type for `draft.sealed !== false`, reject drafts already containing final digests, and add a reseal test.

## 2. Duplicate reconciliation does not implement “plan order”

- **Severity:** High
- **Location or section:** [P5.1 reconciliation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:282)
- **Problem:** The tie-break compares `unitId` strings lexicographically. Unit IDs such as `1.10` and `1.2` do not sort in numeric plan order.
- **Why it matters:** Duplicate selection can depend on settlement order and string formatting, changing evidence and flags.
- **Concrete failure scenario:** Noncanonical duplicates from units `1.2` and `1.10` are reconciled; lexical comparison selects `1.10` even if `1.2` was earlier in the plan.
- **Recommended specification change:** Supply an explicit `unitPlanRank` index in the accumulator context, or state that first merge is guaranteed to occur in plan order and never replace equal-orientation records. Test double-digit sequences and reversed settlement order.

## 3. `touch()` cannot affect the documented LRU policy

- **Severity:** High
- **Location or section:** [Residency surface](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:54), [makeRoom](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1498)
- **Problem:** Eviction compares only `sealedAt`; no last-access value or deterministic tie-break is specified. The public `touch(runId)` therefore has no defined effect.
- **Why it matters:** Frequently accessed results may be evicted while untouched results remain, contradicting “evictable LRU.”
- **Concrete failure scenario:** Set A is sealed before B and repeatedly touched. Admission of C still evicts A because its `sealedAt` is older.
- **Recommended specification change:** Define `lastTouchedAt` plus a deterministic sequence-number tie-break, list which operations touch a set, and add a fake-clock eviction test.

## 4. Acceptance claims exceed the actual tests

- **Severity:** High
- **Location or section:** [Validation acceptance](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1647), [round-trip test](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:1564)
- **Problem:** The document claims every validation-table row and every status reconciliation behavior is tested, but the examples omit several cases, including pair-space consistency, result-unit range coverage, provenance model coverage, unknown digest versions, resealing, witness filtering, and the moved reader exports. The round-trip section also defines five `KINDS` while repeatedly referring to four shapes and expecting “4 passing.”
- **Why it matters:** The implementation can satisfy the written test steps while violating named acceptance criteria.
- **Concrete failure scenario:** `checkResultLinkage` never verifies unit range coverage, yet all prescribed tests pass because only nonexistent `unitId` and orientation are mutated.
- **Recommended specification change:** Add a traceability table mapping every rule-table row to a named test case. Correct the terminal-shape count and expected test count.

# Questions / Clarifications

1. Should the durable `rootOwners` rows gain `cls`, or should hierarchy class membership be stored in a separate digested index? Falling back to bounded examples contradicts the promised complete element-status behavior.

2. What exact error must repeated sealing produce? The current specification says enforcement is mandatory but defines no failure contract.

3. Must migrations be single-hop directly to `SCHEMA_VERSION`, or may they be chained through intermediate versions? `applyMigration` currently assumes one lookup.

4. For invalid `schemaVersion` values, should non-integer/missing values be `CorruptResultSetError('invalid-schema-version')` while only newer integers produce `UnsupportedSchemaVersionError`? The current P5 code classifies both as unsupported.

# Positive Observations

- The capture-first trust boundary and explicit forgery limitation are well motivated.
- The whole-unit result-cap rule prevents partial-unit coverage ambiguity.
- Persistence state is correctly separated from the sealed run outcome.
- The store conformance-suite approach is a strong foundation for host implementations.
- Open versus closed schema types and digest exclusions are explicitly considered.

# Overall Readiness

**Requires major revision**

The underlying design is substantial, but the implementation steps must be reconciled with their own phase summary, P0/P1/P6/P8 contracts, and the primary design specification before coding begins.