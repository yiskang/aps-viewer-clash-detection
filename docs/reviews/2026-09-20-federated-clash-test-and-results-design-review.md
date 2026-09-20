# Federated Clash Test & Results design review

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Review date:** 2026-09-20
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `959a8a829f98d2111e743f184c12fb24f085e2b3`
- **Scope:** Full independent review against the current implementation, collision-library invariants, roadmap and milestone layering, M4 closeout, public APIs and diagnostics, lifecycle semantics, determinism, persistence, cancellation, capacity, acceptance criteria, and implementation feasibility.

## Verdict

**Revise the specification before implementation planning.**

The draft is correctly positioned after M4 and contains several strong fail-closed contracts, but seven High findings remain blocking. They include implementation incompatibilities, contradictory acceptance criteria, unbounded work, an unresolved product decision that can produce a false clean result, and identity/determinism contracts that are not implementable as written.

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 5 |
| Low | 4 |

## High findings — blocking

### H1. Tree-unreachable attribution cannot be implemented safely from current collision results

- **Spec sections:** §6.2, especially the `unreachablePopulation` treatment; §12.5 pair status; AC-2.
- **Classification:** Spec issue and implementation-compatibility issue.
- **Failure mode:** The design records tree-unreachable population by owner `dbId`, but the current [`CollisionWorld`](../../collision/CollisionWorld.js) result is already aggregated to owner-level model/`dbId` pairs. It does not retain the fragment identity needed to prove whether a returned pair arose from a tree-reachable fragment or a tree-unreachable fragment. The same owner can contain both kinds of fragments. That makes the proposed `unreachableOwner` attribution unsafe and conflicts with the claim that such owners are “not required” while root coverage remains mandatory. A pair can therefore be classified as fully verified even though its contributing fragment came from an unverified population.
- **Minimum design correction:** Define the mixed-owner case explicitly. Either conservatively taint every covering unit and pair involving an owner/model that overlaps reachable and unreachable fragment populations, or fail planning for that scope. Reserve “not required” for owners absent from the root-owner population. Add acceptance coverage for both pair orientations where one owner has both reachable and unreachable fragments.

### H2. Target fan-out bypasses the specification's outcome and diagnostic bounds

- **Spec sections:** §6.3 cell construction; §6.4 adaptive splitting; §7.1 bounded outcomes; §10.2 execution; §17 capacity limits.
- **Classification:** Spec issue and capacity/memory design issue.
- **Failure mode:** Cell 1 can submit all target models in one collision call while only the source side is initially partitioned. The current [`CollisionWorld`](../../collision/CollisionWorld.js) implementation iterates target entries and accumulates whole-model diagnostics before the proposed `UnitOutcome` projection. A target-heavy query can therefore allocate diagnostics and perform work proportional to the full federation before `maxDiagnosticsPerUnit`, result-set limits, or post-call projection can take effect. `maxSourceFragmentsPerUnit` does not bound target population, target model count, raw diagnostics, latency, or memory. One unit can remain both uncancellable for too long and capable of exhausting memory.
- **Minimum design correction:** Introduce deterministic target-side partitioning before the first collision call. Bound target model count and target population per unit, while preserving the current whole-model target sentinel within each call. State which capacity limits apply before, during, and after the core call, and add a target-heavy diagnostic stress acceptance test.

### H3. Determinism invariant P1 ignores cumulative epoch-cache state

- **Spec sections:** §6.4 split determinism; §15.1 determinism guarantees; AC-6.
- **Classification:** Implementation-compatibility issue.
- **Failure mode:** The current collision world's epoch-capacity admission is based on existing cache size plus missing entries. That cache is cumulative and can be populated by prior unrelated queries or direct callers. The same clash definition, registered models, and options can therefore run in a fresh world but fail with bucket-capacity exhaustion in an otherwise equivalent world whose epoch cache is already occupied. The final ledger is not a pure function of only the inputs listed by P1.
- **Minimum design correction:** Treat starting epoch-cache/admission state as an explicit environmental input, capture it in run diagnostics, and narrow P1 and AC-6 accordingly. Add a repeatability test against a dirty world populated by an unrelated query. If strict input-only determinism is required, identify the collision-core isolation or cache-control change needed rather than claiming no core change.

### H4. Hierarchy-internal exclusions can produce a clean claim without accepted product semantics

- **Spec sections:** §5.6.3 hierarchy-internal exclusions; §6.6.3 coverage; §8.3 claim behavior; OQ-16.
- **Classification:** Unresolved product decision and spec issue.
- **Failure mode:** A whole-model self-test omits parent/descendant clashes. The draft declares this omission an exclusion rather than a coverage gap, and the exclusion is not claim-blocking. Until product owners accept that behavior, a completed, full, current result can state “No clashes” while deliberately omitting a class of geometrically intersecting pairs. OQ-16 acknowledges that acceptance is unresolved, so the clean-result claim is premature.
- **Minimum design correction:** Obtain and record explicit product acceptance with fixture counts and expected examples, or make any non-empty hierarchy-internal exclusion claim-blocking and partial until acceptance is recorded. The claim helper and acceptance criteria must exercise the unresolved state.

### H5. Cross-mode comparison cannot reliably join results by `PairId`

- **Spec sections:** §4.4 pair identity; §15.4 comparison across mode changes; AC-14.
- **Classification:** Spec issue.
- **Failure mode:** Containment mode defines an ordered pair identity, while symmetric mode canonicalizes an unordered pair. The same two elements can therefore have different `PairId` values when direction reverses or when containment and symmetric result sets are compared. The draft nevertheless says a mode change can join on `PairId` and report `changed`. In practice, the comparison can misreport the same geometric pair as `added`, `removed`, or `unverified`.
- **Minimum design correction:** Declare pair-semantics changes incomparable, or define a separate comparison-only unordered identity plus explicit orientation metadata. Do not reuse the mode-specific `PairId` as the cross-mode join key. Add both orientation cases to AC-14.

### H6. Synchronous validation requirements conflict with the 8 ms execution-span gate

- **Spec sections:** §5.3–§5.5 validation; §17.1.1 capacity ceilings; §17.3 responsiveness; AC-12.
- **Classification:** Spec issue and unreachable acceptance criterion.
- **Failure mode:** `startRun` is required to validate synchronously and collect all validation issues, with explicit selections allowed to contain up to one million elements. That work cannot be cooperatively sliced while preserving synchronous error delivery. The same draft requires every engine-controlled span, including a cap-sized validation path as phrased by AC-12, to remain within 8 ms. Both contracts cannot be guaranteed together on the supported device range.
- **Minimum design correction:** Exclude synchronous validation from the 8 ms scheduling guarantee, substantially lower and measure the synchronous validation ceiling, or move deep validation into an asynchronous planning phase with an explicit lifecycle state. Rewrite AC-12 to measure the selected contract.

### H7. Diagnostic overflow rules and AC-3 contradict one another

- **Spec sections:** §7.1 diagnostic validation and overflow; §12.4 diagnostic counts; AC-3.
- **Classification:** Spec issue and unreachable acceptance criterion.
- **Failure mode:** The draft limits diagnostic reason strings to 128 characters and treats longer values as an internal error, but AC-3 requires 100,000 distinct 10 KB reasons to collapse through the overflow mechanism. Those values must be rejected before overflow under the normative rule. In addition, a bounded summary with an overflow bucket cannot retain exact per-original-reason counts for an arbitrary number of unique legal reasons while also remaining bounded.
- **Minimum design correction:** Separate oversize-reason rejection from legal-length high-cardinality overflow. Require exact total and completeness counts, exact counts only for retained reasons, and one explicit overflow count for omitted reasons. Replace AC-3 with separate tests for oversize rejection and bounded legal-reason overflow.

## Medium findings

### M1. Combined terminal-condition precedence is undefined

- **Spec sections:** §7.5 outcome mapping; §16.3 post-execution verification.
- A core call can throw a lifecycle or capacity error while cancellation, generation drift, or post-scope drift is also observed. The draft does not define which terminal state wins or which secondary facts must be retained.
- **Correction:** Add one precedence table covering thrown core errors, cancellation, generation change, pre/post scope mismatch, and post-digest failure, with mechanical tests for combined cases.

### M2. Plan-memory accounting omits or ambiguously counts material structures

- **Spec sections:** §6.5.1 plan normalization; §17 capacity limits.
- `maxPlanReferences` discusses unit tables and ranges but does not clearly include unreachable-owner sets, unresolved selections, scope-digest rows, root-owner tables, and other run-scoped indexes. A plan can remain within the named limit while exceeding the intended resident-memory budget.
- **Correction:** Define the counted record types and accounting formula, then test an unreachable-heavy, multi-model plan at the ceiling.

### M3. Viewer-adapter feasibility is deferred too late

- **Spec sections:** OQ-4; AC-15(g); design constraint D1.
- The draft depends on agreement between tree-owner derivation and viewer `getDbIds` ownership, but live evidence is still absent. If those APIs disagree for target content, the integration cannot meet attribution and coverage contracts without either narrowing scope or changing architecture.
- **Correction:** Make owner-source agreement an early pre-planning feasibility gate and state the fallback when it fails.

### M4. The determinism promise is broader than its acceptance coverage

- **Spec sections:** §15.1; AC-6.
- The normative text promises deterministic pairs, flags, and diagnostics across machines, load, and reloads, while AC-6 primarily checks the pair set in a live environment. The persisted digest also does not establish deterministic diagnostic details.
- **Correction:** Narrow the promise to a defined build/runtime/environment envelope and add canonical diagnostic-count and taint comparisons. Treat cross-machine reproducibility as separately evidenced.

### M5. Annotation-input compatibility is unspecified

- **Spec sections:** §14.5 annotations.
- Standalone grouping/annotation inputs can be applied without a stated proof that they refer to the same run, model identities, element identities, or naming snapshot as the result set. That permits stale or foreign metadata to be attached to otherwise immutable results.
- **Correction:** Define compatibility keys and reject or mark unavailable any annotation input that cannot be matched to the result set's captured identity context.

## Low findings

### L1. Split-child identifiers are written as duplicates

- **Spec section:** §6.4.
- The example `children: [unitId, unitId]` does not identify two distinct deterministic children.
- **Correction:** Use explicit child suffixes such as `.0` and `.1`.

### L2. Cell 1's source/federation wording is misleading

- **Spec section:** §6.3.
- The text describes a single source against the federation, but in the normal layout the source model is also represented in the downstream B ⇒ C and cell-2 construction.
- **Correction:** Describe the exact role-specific coverage without implying a single exhaustive source/federation call.

### L3. “Every fragment in one root” contradicts tree-unreachable handling

- **Spec section:** §5.6.
- The statement is false for the explicit tree-unreachable population later handled by the design.
- **Correction:** Say every **tree-reachable** fragment maps to the specified root ownership rule.

### L4. AC-15 selection fixtures are incomplete

- **Spec section:** AC-15(b) and AC-15(c).
- The criteria omit selection B, so the tested definition is not fully specified and results are not independently reproducible.
- **Correction:** State complete A and B selections, modes, and expected pair/coverage results for each fixture.

## Acceptance and verification assessment

### Unreachable or internally contradictory criteria

1. **AC-3:** 10 KB reason strings are required to overflow, but the normative diagnostic contract rejects reasons over 128 characters.
2. **AC-12:** Cap-sized synchronous validation cannot also be cooperatively sliced to guarantee every engine-controlled span remains below 8 ms.
3. **AC-14:** Cross-mode comparison lacks a valid join contract for ordered versus unordered pair identities.

### Missing acceptance coverage

1. One owner containing both tree-reachable and tree-unreachable fragments, in both pair orientations.
2. Target-heavy federation calls whose raw diagnostics exceed the post-call per-unit limit.
3. Identical runs before and after unrelated callers populate the collision world's epoch cache.
4. Hierarchy-internal exclusions flowing through the final `canClaimNoClashes`/clean-claim helper.
5. Precedence when core errors, cancellation, generation drift, and post-scope digest failures coincide.

### Trust boundaries and contracts not currently mechanically established

1. `modelVersion` is asserted as a genuine immutable-content witness rather than merely a caller-provided label.
2. Every placement mutation passes through the engine's epoch/update hook; direct viewer or extension mutations can bypass it.
3. An instance tree that appears complete actually enumerates the full fragment-owning population.
4. “Any machine/load/reload” determinism cannot be established by one-environment reload tests.
5. Global collision resistance of an identity scheme cannot be established by a finite 100,000-item no-collision test.

These can still be useful operational assumptions, but the specification must label their trust boundary and define fail-closed behavior when evidence is unavailable.

## Confirmed sound areas

1. **Milestone layering:** Federated Clash Test & Results is correctly placed after the closed M4 worker-decision milestone and does not reopen or authorize M4 Phase 4.
2. **Current API direction:** The design consumes the existing public `findClashes` query and does not silently require a core API rewrite for its basic execution path.
3. **Existing collision invariants:** Lease ownership, eviction behavior, whole-model target sentinel usage, null-`dbId` diagnostics, and existing capacity error kinds are represented accurately.
4. **Result lifecycle:** Resident-slot accounting, immutable model identity intent, persistence backpressure, and the separation of `done` from `persisted` are directionally coherent.
5. **Fail-closed result semantics:** Separating coverage, integrity, freshness, taints, and claim eligibility is the correct design direction and prevents many incomplete results from masquerading as clean.

## Stale, ambiguous, or unsupported statements

- **Stale/inaccurate:** §5.6's assertion that every fragment belongs to one root is superseded by the same draft's tree-unreachable population.
- **Ambiguous normative language:** “Exact diagnostic counts” does not say whether exactness applies to every original reason after overflow or only to retained reasons plus a total.
- **Ambiguous normative language:** The terminal outcome rules do not establish precedence among cancellation, thrown errors, lifecycle drift, generation drift, and post-digest failure.
- **Unsupported assumption:** Input-only deterministic completion assumes a fresh or equivalent epoch cache, which the current implementation does not guarantee.
- **Unsupported assumption:** Product acceptance of hierarchy-internal exclusion is not present in repository evidence; OQ-16 explicitly leaves it open.
- **Unsupported assumption:** Viewer owner-enumeration agreement required by AC-15(g) has not been demonstrated on live target content.

## Blocking revisions required before implementation planning

1. Resolve mixed reachable/unreachable owner attribution so incomplete fragment provenance cannot produce verified pairs or clean claims.
2. Bound target-side population, model fan-out, raw diagnostics, memory, and uninterrupted work before invoking the collision core.
3. Reconcile determinism with cumulative epoch-cache state and test dirty-world behavior.
4. Make hierarchy-internal exclusions claim-blocking until explicit product acceptance is recorded.
5. Replace or constrain cross-mode `PairId` comparison semantics.
6. Reconcile synchronous validation with the 8 ms responsiveness contract and AC-12.
7. Reconcile diagnostic reason validation, overflow accounting, and AC-3.

Implementation planning remains unauthorized until the specification is remediated and a subsequent independent review returns no blocking findings.

**Final status: `revise spec before implementation planning`**
