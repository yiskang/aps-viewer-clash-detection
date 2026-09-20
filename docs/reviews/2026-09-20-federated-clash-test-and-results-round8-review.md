# Federated Clash Test & Results round 8 remediation review

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256:** `3f84ea7ef8e3aeda2881710630ed484c6dec8354dc40326d897922cb2bd18759`
- **Prior review authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-remediation-review.md`](2026-09-20-federated-clash-test-and-results-remediation-review.md)
- **Review date:** 2026-09-20
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `017eb7d6e18dc2bc39031fa6cdc4e94bb40148e1`
- **Scope:** Independent verification of the three blocking fixes and eight Medium dispositions in round 8 against the specification, current collision implementation and tests, roadmap, M4 closeout constraints, and repository state.

## Verdict

**Revise the specification before implementation planning.**

Two of the three blocking fixes are complete. The hard-delete fix still permits durable identity reuse through the explicitly store-independent direct-definition and embedded-definition rerun paths. Seven of the eight Medium dispositions are complete; the aggregate ledger budget still leaves some runtime record classes without defined exhaustion behavior.

| Severity | Current findings |
| --- | ---: |
| Critical | 0 |
| High — blocking | 1 |
| Medium | 1 |
| Low | 0 |

## Verification of the three blocking fixes

### NH1 — atomic `ResultStore.put`: resolved

Sections §4.2 and §13.5 now make the same-`runId` check, validation and claiming of every `modelKey → modelVersion` mapping, and Result Set insertion one linearization point with all-or-nothing state. AC-11 exercises conflicting writes under different `runId`s in both completion orders and a partially overlapping multi-key case. This closes the cross-`runId` identity-index race identified by the prior review.

### NH2 — terminal settlement precedence: resolved

Section §16.7 now defines:

1. a fixed U1–U9 primary-cause order for one unit settlement;
2. bounded secondary-cause recording;
3. the run-status order `failed > invalidated > cancelled > completed`; and
4. a matrix specifying pair/diagnostic merge or discard, ledger outcome, and final status while cancellation or engine disposal is pending.

AC-21 covers pairwise and specified multi-fact combinations under randomized delivery order. The resulting contract is consistent with the current lifecycle constraints: a binding reload produces a gap and stale freshness rather than rebinding an in-flight run, while placement or scope drift invalidates the snapshot. Letting invalidation outrank a pending cancel is an explicit fail-closed product choice, not an internal contradiction. A product owner may choose a different policy, but further owner confirmation is not required to make the current specification implementable or mechanically testable.

### NH3 — permanent `testId` tombstone: not resolved

- **Spec sections:** §4.4; §5.5; §13.5; AC-1.
- **Classification:** Durable-identity/spec issue.
- **Concrete failure mode:** §5.5 permanently tombstones a `testId` only inside `ClashTestStore`, but the same section explicitly says `startRun(definition)` never consults that store and `rerun` is likewise ad hoc when it uses an embedded definition. A caller can retain a deleted definition, start or rerun it directly, and persist the resulting Result Set. Because `ResultId` is derived from `(testId, semanticDigest, PairId)` and `ResultStore.put` enforces model identity but has no test-lineage/tombstone contract, that path can recreate byte-identical durable `ResultId`s after hard deletion. AC-1 tests only later `ClashTestStore.put` calls and therefore cannot detect the bypass.
- **Minimum design correction:** Enforce the permanent reservation for every run whose Result Set may be persisted, including direct definitions and embedded-definition reruns. This can be done by requiring a shared test-lineage/tombstone authority during admission or persistence. Alternatively, add an immutable lineage/generation identifier to the durable test and `ResultId`. Add acceptance cases for direct start and embedded rerun after deletion, including persistence through `ResultStore`.

## Verification of the eight Medium dispositions

| ID | Disposition | Verification |
| --- | --- | --- |
| M1 — geometry readiness | **Resolved** | §§1.3.6, 15.1 and 16.4 now treat render-proxy readiness as an environmental input, preserve the completeness caveat, narrow determinism, and state that `current` proves extraction identity rather than future rerun equality. AC-19(e) exercises unavailable-then-available geometry with unchanged scope digests. This matches `CollisionWorld`'s transient `geometry-not-yet-available` behavior. |
| M2 — aggregate memory accounting | **Partially resolved; Medium remains** | §6.5.1 adds one `maxLedgerRecords` count and names the retained plan/ledger classes. The exhaustion rule, however, only defines collapse for a further **element** taint. Target-model taints, unit taints, runtime gaps, split/range records, and other runtime ledger records are also counted, but their behavior when the budget is already full is unspecified. The two-record-per-unit reserve guarantees a unit record and one overflow record, not every named runtime record class. |
| M3 — annotation compatibility | **Resolved** | §14.5 binds snapshots to `runId`, `semanticDigest`, every model version, and referenced attribute names; mismatches make only the attribute facet unavailable. AC-13 covers same-model/different-run and each mismatch class. |
| M4 — Viewer-adapter feasibility timing | **Resolved at specification level; external gate remains** | OQ-4 is now explicitly a pre-implementation-planning gate, names the live evidence artifact, and defines the fail-closed/narrow-v1/core-change fallback. The evidence has not been gathered, so adapter implementation planning remains unauthorized even after design findings are cleared. |
| M5 — stored-reference failures | **Resolved** | §5.5 validates every untrusted store read and maps invalid, unsupported, or unmigratable definitions to exhaustive planning causes with `definition: null` and `semanticDigest: null`. AC-16 covers each failure class. |
| M6 — schema evolution | **Resolved** | §13.6 gives a per-type open/closed policy, requires versioned migration for definition and identity-shape changes, and excludes unknown optional fields from the documented digests. The strict V1 definition rule is no longer contradicted by a blanket additive-field policy. |
| M7 — target cap | **Resolved** | §6.4 makes `maxTargetFragmentsPerUnit` a hard pre-call bound for both whole-model sentinels and explicit roots, while the source cap remains a packing target. AC-18 covers both over-cap target forms and verifies no call is issued. |
| M8 — diagnostic overflow | **Resolved** | §§7.1 and 12.4 separate examined exact counts from `unclassifiedOccurrences`; `completenessAffectingUpperBound` alone covers unexamined entries, and integrity uses the upper bound. AC-3 exercises mixed, benign, and affecting oversized arrays. |

### M2 minimum correction

Define budget exhaustion for **every** record class that may be created after planning. Either reserve the maximum required non-element records before execution and prove the reserve formula, or define one fail-closed preallocated unit-wide overflow representation that replaces all further runtime taint/gap/split detail. Extend AC-16 to exhaust the budget with target-model/unit taints and runtime split/gap records, not only element taints.

## Acceptance and verification assessment

The round 8 acceptance additions are generally specific and mechanically testable. NH1 and NH2 now have direct concurrency and schedule-order tests. M1, M3, M5, M7 and M8 have concrete observable assertions. The schema table makes M6 testable by per-type read/migrate cases.

Missing coverage remains in two places:

1. AC-1 has no direct-definition or embedded-rerun case after a `testId` tombstone and no assertion that such a Result Set cannot be durably inserted.
2. AC-16's combined ledger-ceiling case covers element-taint collapse, but not exhaustion caused by the other runtime record classes counted by §6.5.1.

OQ-4 is intentionally a live pre-planning evidence gate rather than a unit-test contract. Its required artifact does not yet exist in `docs/research/`; this is an outstanding prerequisite, not a hidden assumption.

## Repository and architecture compatibility

- The fixes do not require M4 Phase 4, worker execution, or a collision-core contract change. M4 remains closed under Verdict D.
- The current collision library continues to own geometry queries, lease/epoch checks, owner-level diagnostics, and cumulative epoch admission. The proposed orchestration layer can consume those public behaviors without silently changing them.
- The geometry-readiness disposition matches the existing transient render-proxy failure path and preserves fail-closed absence claims.
- The settlement table does not rebind a running unit to a new model object and therefore preserves lease, binding-generation, placement-generation, and snapshot semantics.
- The hard-delete gap is in the new persistence/test-identity design, not in the current collision implementation.

## Trust boundaries and outstanding evidence

- OQ-4 still requires live Viewer evidence for owner-mapping agreement, source enumeration, tree readiness, and unreachable/mixed-owner counts before adapter implementation planning.
- Host-supplied `modelKey`/`modelVersion` truthfulness, placement-change notification ownership, and the OQ-16 product acceptance reference remain explicit trust boundaries.
- Sizing defaults, including `maxLedgerRecords`, remain provisional and unmeasured.

## Blocking revisions

1. Close NH3 across **all** persisted run paths, not only `ClashTestStore.put`, and add direct-start/rerun-after-delete acceptance coverage.

M2 should be corrected in the same revision so the aggregate memory contract has defined fail-closed behavior for every counted runtime record class. After those edits, perform another independent review. Before any Viewer-adapter implementation plan is authorized, also complete and record the OQ-4 live feasibility check.

`revise spec before implementation planning`
