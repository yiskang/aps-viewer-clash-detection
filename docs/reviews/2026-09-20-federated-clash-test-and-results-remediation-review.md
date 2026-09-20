# Federated Clash Test & Results remediation verification review

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256:** `81b43dcddf0d9509b73850071b9a76d06acf12c82cffd74e5c428c7ba11078ee`
- **Original review:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-design-review.md`](2026-09-20-federated-clash-test-and-results-design-review.md)
- **Review date:** 2026-09-20
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `ec5f50f7d79cad81ab9baa92836791bb845400dd`
- **Scope:** Independent verification of the seven original High remediations and adjudication of the subsequent Codex findings against the current specification, collision implementation, tests, roadmap constraints, and repository state.

## Verdict

**Revise the specification before implementation planning.**

The seven original High findings are substantively remediated. They no longer block on their original failure modes. The follow-up review confirms three new High findings that remain blocking, accepts eight Medium findings, and identifies no new Critical finding.

| Severity | Current findings |
| --- | ---: |
| Critical | 0 |
| High — blocking | 3 |
| Medium | 8 |
| Low | 0 |

## Verification of the original seven High findings

### H1 — mixed reachable/unreachable owners: resolved

The draft now classifies owners as root-only, unreachable-only, or mixed (§6.2). A mixed owner remains in required pair space but taints every pair involving that owner in either orientation; `not-required` is reserved for unreachable-only owners. The rule is applied from recorded owner tables rather than from the producing unit, matching the current collision library's owner-level aggregation and absence of retained fragment provenance. §12.5 rule 6 and AC-17 cover positive results, absences, both orientations, comparisons, and the clean-claim path.

### H2 — target fan-out: resolved, with a Medium residual

The planner now bounds target model count and target fragment weight before the first collision call, partitions target roots deterministically, treats an over-cap whole-model sentinel as a pre-call gap, and includes target slicing in plan-size guards (§6.4, §17.1, AC-18). This addresses the original failure mode in which cell 1 sent an entire federation to a core call and accumulated all target diagnostics before outcome projection.

The remediation contains a separate Medium contradiction for a single explicit root heavier than a caller-selected target cap; see M7. That does not restore the original unbounded federation fan-out because the core's per-root extraction ceiling remains an absolute bound, but the stated per-unit cap and AC-18 are not internally consistent.

### H3 — cumulative epoch-cache state: resolved

The determinism contract now names the existing epoch bucket as an environmental input, records `admissionBaseline`, records `bucket-capacity` details, marks affected runs `environmentSensitive`, and restricts strict repeatability assertions to runs without that failure (§1.3.5, §6.4, §13.2, §15.1, AC-19). This matches the current `CollisionWorld` admission rule, which tests existing bucket size plus missing instances.

### H4 — hierarchy-internal exclusion: resolved

The draft now records affected roots in `ledger.hierarchyInternal` and blocks both clean-claim helpers unless that table is empty or a product-acceptance reference was sealed into provenance (§5.6, §6.6, §8.3, AC-20). The default is fail-closed. OQ-16 identifies the required external evidence and correctly labels the acceptance reference as a host trust boundary.

### H5 — cross-mode pair identity: resolved

Ordered and unordered pair identities are now explicitly different semantic classes. `compareResultSets` returns `incomparable` before joining when `pairSemantics` changes, and AC-14 covers both directions plus reversed containment orientation (§4.4, §15.2, §15.4).

### H6 — synchronous validation versus the 8 ms gate: resolved

The draft separates synchronous validation from sliced work, caps the issue list, lowers the default explicit-element limit, moves normalization and digesting to sliced execution, and makes validation latency a measured plan-time gate rather than an asserted 8 ms guarantee (§5.3, §17.1, §17.3, AC-12). The formerly contradictory acceptance requirement has been removed.

### H7 — diagnostic rejection versus overflow: resolved, with a Medium residual

Malformed diagnostics, including over-length reasons, are now rejected. Legal high-cardinality diagnostics use bounded retained reason detail, exact total occurrence counts, an omitted-reason counter, and fail-safe unit taints (§7.1, §12.4, AC-3). This resolves the original contradiction involving 10 KB reasons.

The new whole-array overflow path calls an unexamined fail-safe count “exact”; see M8.

## New High findings — blocking

### NH1. `ResultStore.put` does not require the identity-index claim and result insert to be one atomic operation

- **Spec sections:** §4.2 enforcement point 2; §13.5 lines defining `put` and create-only persistence; AC-11 and AC-16.
- **Classification:** Persistence-contract issue.
- **Failure mode:** The draft requires a permanent `modelKey → modelVersion` index and separately requires atomic create-only insertion by `runId`, but it does not state that checking/claiming the identity index and inserting the new result are one transaction. Two concurrent writes with different `runId`s and conflicting versions for the same `modelKey` can both observe no index entry, both claim success, and permanently persist incompatible durable identities. Existing concurrency acceptance covers same-`runId` conflicts, not this cross-`runId` race.
- **Minimum correction:** Require one atomic transaction that validates every offered key against the permanent index, claims previously unseen keys, and inserts the result. On any conflict, neither index nor result may change. Add a concurrent two-`runId` acceptance case with opposite completion order and a partial-overlap multi-key case.

### NH2. Terminal-state precedence remains underspecified and internally contradictory

- **Spec sections:** §7.5; §8.2; §10.2 “Precedence” and `engine.dispose()`; §16.3; AC-7, AC-8, and AC-16.
- **Classification:** Lifecycle-contract issue.
- **Failure mode:** “The first terminal transition wins” does not define the decision point when cancellation is requested while a unit is in flight and that unit later reports world disposal, internal failure, placement drift, generation drift, or scope drift. `cancelling` is non-terminal, while `engine.dispose()` nevertheless requires every run to seal `cancelled`; §7.5 and §8.2 require some of the same in-flight outcomes to seal `failed` or `invalidated`. Implementations can legitimately choose different final statuses and different merge/discard behavior for the same event sequence.
- **Minimum correction:** Add one normative precedence table evaluated at defined boundaries. It must cover user cancel, engine disposal, world disposal, fatal executor error, result-cap failure, generation drift, scope drift, and a successfully drained unit. State merge/discard behavior and final status for every pairwise race. Add deterministic schedule tests for each row.

### NH3. Hard deletion permits durable `ResultId` aliasing when a `testId` is reused

- **Spec sections:** §4.4 `ResultId`; §5.4–§5.5 definition identity and hard delete; AC-1.
- **Classification:** Durable-identity issue.
- **Failure mode:** `ResultId` is derived from `(testId, semanticDigest, PairId)`, while hard delete removes all definition revisions and `put` treats an absent `testId` as a new test beginning at revision 1. Recreating the same `testId` with the same semantic question and model identities reproduces old durable result IDs even though the definition lineage was deleted and restarted. Workflow state can silently attach to a logically new test.
- **Minimum correction:** Make `testId` permanently reserved after first use. `delete` must leave a tombstone, and later `put` for that identifier must reject with a typed error. Alternatively add an immutable generation/lineage identifier to every durable test and result identity. Add delete/recreate and concurrent delete/put acceptance cases.

## Adjudication of the remaining Codex findings

### M1. Transient render-proxy readiness is not represented in scope or repeatability evidence — accepted, severity adjusted to Medium

The current library intentionally treats `getRenderProxy` absence as transient and emits `geometry-not-yet-available`; a later identical call can succeed without `fragId`, owner, or `geometryId` changing. Scope digests cover those stable fields but not proxy readiness (§6.2.1), while §15.1 promises identical diagnostics and taints for deterministic modes under the listed inputs. `getFreshness` can also report `current` after the proxy becomes available.

This is not High because the diagnostic is completeness-affecting: the original result remains `integrity: caveated`, so it cannot produce a clean absence or “no clashes” claim. The needed correction is to name geometry readiness as an environmental input, narrow diagnostic repeatability accordingly, and define whether readiness improvement makes a sealed set stale or merely remains an integrity caveat requiring rerun. Add a missing-proxy-then-present test.

### M2. Global ledger/result memory accounting is incomplete — accepted

`maxPlanReferences` counts table entries and unit range records, but the resident set also retains owner mappings, unreachable and hierarchy tables, planning scope digests, per-unit taints, diagnostic summaries, and other ledger records. Component caps make memory finite, but the specification does not provide one complete accounting formula or a total serialized-byte/record budget. A cap-sized configuration can satisfy each named guard while producing a much larger set than the resident-memory rationale implies.

Minimum correction: define all counted record classes and either one aggregate resident-set budget or a provable formula from component caps. Exercise unreachable-heavy, hierarchy-heavy, and taint-heavy cases, not only target-root planning.

### M3. Annotation compatibility is not mechanically established — accepted

`engine.annotate(runId, names)` safely keys the engine-managed snapshot to a run, but the documented `AttributeSnapshot` itself contains no `runId`, result-set digest, or element-set digest, while aggregation is described as a pure derivation over a Result Set plus an optional snapshot. A detached or future consumer can apply a snapshot from a different run with matching model versions.

Minimum correction: bind snapshots to `runId` plus an immutable result/scope identity and require grouping/filter APIs to reject mismatches. Add same-model-version/different-selection and stale-snapshot tests.

### M4. Viewer-adapter feasibility is gated too late — accepted

OQ-4 and AC-15(g) defer owner-mapping agreement and source-side owner enumeration to integration acceptance. A failure of that gate invalidates the planned attribution and pair-identity architecture, not merely adapter polish. The repository has no live evidence that the target Viewer content satisfies the assumption.

Minimum correction: make this a mandatory pre-implementation-planning feasibility check, or explicitly scope the plan to a disposable adapter spike whose failure returns the design to revision.

### M5. Stored-reference validation failure causes are incomplete — accepted

The exhaustive planning-cause enum has `test-unavailable`, with only `test-not-found` and `test-archived` detail. A store can return a corrupt, unsupported-schema, or otherwise invalid definition. The draft does not say whether this is `test-unavailable`, `internal-error`, or a distinct planning cause, nor whether the admitted slot seals into a resident set under each case.

Minimum correction: define typed causes for invalid stored data and unsupported stored schema, map them to a terminal status, and add store-returned malformed/unsupported acceptance cases.

### M6. Schema-evolution language conflicts with strict version-1 validation — accepted as an ambiguity

The definition validator rejects every unknown field and requires `schemaVersion === 1`, while Result Set schema evolution says additive fields within a version are tolerated and preserved and lower versions are migrated. Because Result Sets embed definitions and the paragraph does not clearly limit its rules to the outer Result Set, readers cannot determine whether unknown embedded-definition fields are rejected, preserved, or migrated.

Minimum correction: define separate schema/version policies for definitions, Result Sets, and attribute snapshots, including the order of outer migration, embedded-definition migration, and strict validation.

## Additional independent findings

### M7. The explicit-root target-cap exception contradicts the per-unit cap and AC-18

- **Spec sections:** §6.4 target-side bounds; §17.1; AC-18(a).
- §6.4 says every unit's target weight is at most `maxTargetFragmentsPerUnit`, then allows a single explicit root heavier than that cap to form its own slice. AC-18 simultaneously requires every unit to remain at or below the cap while mentioning the over-weight-root case. A caller lowering the cap below one legal root makes the criterion impossible.
- **Minimum correction:** Either make an over-cap explicit root a pre-call `target-too-large` gap, matching the whole-model rule, or rename the option as a packing target and specify the separate absolute per-root bound. Rewrite AC-18 to match the chosen semantics.

### M8. Whole-array diagnostic overflow cannot produce an exact completeness-affecting count without inspection

- **Spec sections:** §7.1 overflow path; §12.4; §13.1; AC-3 and AC-10.
- When `diagnostics.length > maxDiagnosticsPerOutcome`, the array is deliberately not inspected and every occurrence is conservatively counted as completeness-affecting. That is fail-safe, but it is not an exact `completenessAffectingCount` when any omitted item is the explicitly benign `witness-unavailable` reason. The Result Set type and acceptance criteria nevertheless call the count exact.
- **Minimum correction:** Represent the overflow contribution as an upper bound/unknown classification while keeping `integrity: caveated`, or inspect enough data to compute the exact predicate. Do not label the conservative count exact.

## Acceptance and verification assessment

The new AC-17–AC-20 coverage is materially stronger and directly exercises the seven original remediations. The following coverage is still missing or contradictory:

1. Concurrent cross-`runId` writes that race to claim one `modelKey` with different versions.
2. A complete terminal-precedence matrix with deterministic event schedules.
3. Missing render proxy followed by availability with unchanged scope digest.
4. Delete and recreate of the same `testId`, including a delete/put race.
5. Over-cap explicit roots and mixed benign/completeness-affecting whole-array diagnostic overflow.

## Confirmed sound areas

1. The original mixed-owner, epoch-cache, hierarchy-claim, and pair-semantics failures now have explicit fail-closed behavior and mechanical acceptance criteria.
2. Target-model fan-out is no longer permitted to grow with the full federation in one call.
3. Synchronous validation and sliced work now have honest, distinct performance contracts.
4. Diagnostic detail overflow no longer conflates malformed data with legal high cardinality.
5. M4 remains closed with Verdict D; the draft does not authorize M4 Phase 4 or silently adopt a worker.

## Blocking revisions before implementation planning

1. Make permanent model-version index validation/claim and Result Set insertion one atomic `ResultStore.put` transaction.
2. Define terminal-condition precedence and merge/discard behavior for cancellation, disposal, fatal errors, and input drift.
3. Prevent `testId` reuse from aliasing durable Result IDs through a tombstone or explicit lineage identity.

The Medium findings should be corrected or explicitly dispositioned before the next independent review. Implementation planning remains unauthorized until a subsequent review returns no blocking findings.

**Final status: `revise spec before implementation planning`**
