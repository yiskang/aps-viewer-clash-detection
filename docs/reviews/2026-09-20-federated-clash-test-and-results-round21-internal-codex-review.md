# Federated Clash Test & Results round 21 internal Codex review (raw output, NOT remediated)

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256 at review time:** `eca085bf1d415ec3ccbeb36af4ddc024be5f876d3bd331066e1e246334876a5a` (uncommitted round 21 remediation on HEAD `62aa070`)
- **Reviewer:** internal `codex-review spec` (medium effort), request `20260920-213846-94380-28310` — the *internal* reviewer of the CLAUDE.md review loop, **not** the independent acceptance gate
- **Prior:** [`2026-09-20-federated-clash-test-and-results-round20-internal-codex-review.md`](2026-09-20-federated-clash-test-and-results-round20-internal-codex-review.md)
- **Review date:** 2026-09-20
- **Status:** raw reviewer output, preserved verbatim below. **The user stopped the internal review loop when this pass returned, so none of these findings has been checked or remediated and the spec has no §25 disposition for them.** They are listed as open in `docs/handoffs/latest.md`.

---

Revise the three result-contract blockers before implementation planning: persisted result validation, diagnostic DTO separation, and annotation memory accounting.

# Executive Summary

The specification is unusually thorough and generally consistent with the existing collision library. Its planning model, fail-closed completeness semantics, lifecycle precedence, and persistence contracts are strong.

However, three contract defects can produce incompatible implementations or invalid read-back behavior:

1. Persisted `ClashResult` uses `mode`, while validation requires `type`.
2. `UnitOutcome.diagnostics` references a post-aggregation schema that cannot exist at executor return time.
3. Annotation memory can exceed the claimed hard bound before the engine applies its byte cap.

Several smaller contradictions also affect defaults, acceptance tests, overload validation, and schema evolution.

# Critical Issues

## C1 — Persisted results disagree on `mode` versus `type`

- **Severity:** Critical
- **Location or section:** [§11.1 lines 651–667](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:651>), [§13.6 line 964](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:964>)
- **Problem:** `ClashResult` defines a required `mode` field and no `type` field. Stored-result validation instead requires “the result's `type` and evidence shape” to match the definition.
- **Why it matters:** `ClashResult` is closed under §13.6. An implementation following §11.1 will omit `type`; an implementation following §13.6 may reject every conforming persisted result or add an unknown field that the closed schema rejects.
- **Concrete failure scenario:** A valid `volume-overlap` run persists results containing `mode: 'volume-overlap'`. After eviction, `getResultSet` validates the stored set, looks for `result.type`, and returns `CorruptResultSetError`.
- **Recommended specification change:** Make `mode` the sole persisted field and change all stored validation and acceptance criteria from `result.type` to `result.mode`. Explicitly state that `UnitOutcome.pairs[].type` is projected into `ClashResult.mode`.

## C2 — Per-unit and aggregated diagnostic schemas are conflated

- **Severity:** High
- **Location or section:** [§11.2 lines 675–699](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:675>), [§12.2 lines 720–733](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:720>)
- **Problem:** `UnitOutcome.diagnostics` is declared as `NormalizedDiagnostic[]`, but that type requires batch-level fields such as `occurrences` and `unitIds`, described as populated after cross-unit de-duplication. The executor is required to return diagnostics before that aggregation.
- **Why it matters:** Implementers cannot determine whether the executor or engine owns attribution, occurrence counting, and unit provenance. Boundary validation will differ between implementations.
- **Concrete failure scenario:** `LocalUnitExecutor` returns one projected library diagnostic without `occurrences` or `unitIds`. A strict `validateUnitOutcome` rejects it as malformed. If the executor invents those fields, the engine may double-count occurrences during aggregation.
- **Recommended specification change:** Define two closed types:
  - `ProjectedDiagnostic`, returned by `UnitExecutor`, containing only per-call fields.
  - `NormalizedDiagnostic`, stored after engine attribution, de-duplication, and occurrence aggregation.
  
  Specify the exact projection between them.

## C3 — Annotation input can exceed the claimed hard memory bound

- **Severity:** High
- **Location or section:** [§14.5 lines 1015–1019](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1015>), [§17.1 line 1237](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1237>)
- **Problem:** The spec claims in-flight annotation memory is bounded by `maxConcurrentAnnotations × maxAnnotationBytes`. But `ElementAttributeSource` first resolves a complete `Map`; only afterward does the engine copy, truncate, count, and reject it.
- **Why it matters:** `maxAnnotationBytes` bounds the accepted snapshot, not the source map already allocated and retained during capture. The hard browser-memory formula and AC-13 assertion are therefore unsound.
- **Concrete failure scenario:** A conforming source returns requested entries containing very large strings. The engine intends to truncate each string to 1,024 code units, but the oversized `Map` already exists before byte accounting begins, potentially exhausting the tab.
- **Recommended specification change:** Choose one explicit contract:
  - Require the source to enforce input byte/value limits before resolving and include that requirement in port conformance tests; or
  - Replace the all-at-once `Map` with a bounded page/stream protocol; or
  - Remove the hard peak claim and include one uncapped source-result graph per annotation job in the memory-risk model.

# Important Improvements

## I1 — Normative defaults conflict across sections

- **Severity:** High
- **Location or section:** [§6.5.1 lines 418–420](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:418>), [§17.1 lines 1218–1237](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1218>)
- **Problem:** §6.5.1 gives provisional defaults of 2,000,000 for `maxPlanReferences` and 4,000,000 for `maxLedgerRecords`; §17.1 gives 500,000 and 1,000,000. The calibration paragraph also refers to a 256 MiB allowance while the table specifies 512 MiB.
- **Why it matters:** These values determine planning rejection, ledger reserve proofs, reader compatibility, and worst-case memory.
- **Concrete failure scenario:** The planner implements the §6 values while option validation and producer/reader calculations use §17 values. A run accepted by one component is rejected or unreadable by another.
- **Recommended specification change:** Declare §17.1 the single normative defaults table and replace numeric repetitions elsewhere with cross-references. Correct the stale 256 MiB reference.

## I2 — AC-13 requires a grouping that §14.4 forbids

- **Severity:** Medium
- **Location or section:** [§14.4 line 1003](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1003>), [AC-13 line 1474](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1474>)
- **Problem:** Repeated facet IDs with identical parameters must be rejected, but AC-13 uses `element × element` as the required nested multi-valued overflow case.
- **Why it matters:** The acceptance test cannot reach `GroupingTooLargeError`; it must first fail with `InvalidOptionsError`.
- **Concrete failure scenario:** A correct implementation rejects the second `element` facet, causing the mandated AC-13 test to fail.
- **Recommended specification change:** Use two distinct multi-valued facets, such as `element × attrEither:<name>`, or explicitly permit repeated facets and define their semantics.

## I3 — Stored-reference overload validation is underspecified

- **Severity:** Medium
- **Location or section:** [§5.3 line 255](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:255>), [§5.5 line 289](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:289>)
- **Problem:** The spec says `{testId, revision?}` is captured and its “reference shape” validated, but never defines its complete validation rules or overload discrimination.
- **Why it matters:** Implementations may disagree about unknown properties, empty IDs, unsafe revisions, accessors, or objects containing a mixture of reference and definition fields.
- **Concrete failure scenario:** `{testId: 'T', revision: 1, mode: 'clearance'}` is treated as a reference by one implementation and rejected as ambiguous by another.
- **Recommended specification change:** Add a closed `ClashTestReference` schema: exact keys, string and revision limits, descriptor rules, and deterministic overload discrimination. Add acceptance cases for partial and mixed-shape objects.

## I4 — `ElementRef.externalId` is simultaneously reserved and forbidden

- **Severity:** Medium
- **Location or section:** [§4.4 line 206](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:206>), [§13.6 line 958](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:958>)
- **Problem:** §4.4 says `ElementRef` reserves optional `externalId`, while the defined shape contains only `modelKey` and `dbId`, and §13.6 makes `ElementRef` closed.
- **Why it matters:** Writers and readers will disagree on whether `externalId` is valid in schema version 1.
- **Concrete failure scenario:** A host emits the “reserved” field; persistence succeeds in one implementation but another rejects the set as corrupt.
- **Recommended specification change:** Either add `externalId?: string` with limits and identity semantics to schema version 1, or remove the reservation statement and require a future schema-version bump.

## I5 — Acceptance text assumes an archive-restoration transition that does not exist

- **Severity:** Medium
- **Location or section:** [§5.5 lines 274–289](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:274>), [AC-1 line 1462](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1462>)
- **Problem:** Lifecycle is one-way `active → archived`, with no restore operation. AC-1 nevertheless discusses a test “restored after” an archive.
- **Why it matters:** The store test suite either requires an undocumented operation or contains an unreachable case.
- **Concrete failure scenario:** Implementation planning adds `unarchive` solely to satisfy AC-1, expanding the public lifecycle without a defined concurrency or revision contract.
- **Recommended specification change:** Remove the restoration case, or formally add `unarchive(testId)` with state transitions, race semantics, errors, and API exposure.

# Questions / Clarifications

1. **Implementation scope:** Is authorization intended for the core only or core plus Viewer adapter? [OQ-4 explicitly blocks adapter implementation planning](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:1517>).

2. **Configuration authority:** Are §17.1 values intended to be executable provisional defaults, or placeholders that cannot be committed until AC-12 and a product memory budget exist? The current text uses both interpretations.

3. **Annotation trust boundary:** Is `ElementAttributeSource` trusted to obey pre-allocation memory limits? If so, those limits need to be part of the port contract rather than an engine-only postcondition.

# Positive Observations

- The specification correctly preserves the repository’s subtree extraction and owner-level aggregation behavior.
- The three-cell decomposition explicitly addresses same-model self-exclusion instead of assuming dbId-set disjointness is sufficient.
- Coverage, integrity, and freshness are separated, with unknown diagnostics handled fail-closed.
- Terminal-state precedence and persistence settlement are unusually explicit and testable.
- Scope drift, model identity, tombstones, store atomicity, and nonresident lifecycle behavior all have concrete failure semantics.

# Overall Readiness

**Requires major revision**

The architecture is close, but the stored-result and diagnostic schema contradictions affect the central durable contract. The annotation memory claim and contradictory defaults also prevent reliable implementation of the promised hard bounds.

Next: resolve C1 first by choosing `ClashResult.mode` as the persisted field and updating §13.6 plus AC-11 consistently.
