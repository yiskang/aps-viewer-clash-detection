# Federated Clash Test & Results round 9 remediation review

- **Reviewed draft:** [`docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`](../superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md)
- **Draft SHA-256:** `4960814b1f6c2bd0c5c655deba21888f93add110a85a1d0d3b632b9c1c158643`
- **Prior review authority:** [`docs/reviews/2026-09-20-federated-clash-test-and-results-round8-review.md`](2026-09-20-federated-clash-test-and-results-round8-review.md)
- **Review date:** 2026-09-20
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `017eb7d6e18dc2bc39031fa6cdc4e94bb40148e1`
- **Scope:** Independent review of the current draft, with direct verification of the round 9 NH3 and M2 remediations and a regression check against the established architecture, persistence, lifecycle, roadmap, M4 closeout, and acceptance contracts.

## Verdict

**Revise the specification before implementation planning.**

The two round 9 designs are now fail-closed in their core behavior: the `ResultStore` tombstone closes the durable direct-definition/rerun bypass, and the reserved overflow record plus per-class fallbacks keep runtime ledger allocation bounded. No Critical or High finding remains from those failure modes.

Two Medium cross-section defects remain. One required NH3 acceptance case invokes an API from a state that the persistence contract forbids. The M2 reserve proof uses `maxPlanReferences` as though it bounded all planning records, while the specification explicitly defines it as a narrower counter; the associated minimum-budget acceptance setup can therefore fail during planning instead of exercising runtime exhaustion.

| Severity | Current findings |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium — revision required | 2 |
| Low | 0 new |

## Round 9 remediation verification

### NH3 — hard-delete identity reservation: design resolved

The current design closes the original durable aliasing path:

1. `ResultStore.tombstoneTest(testId)` creates a permanent reservation at the storage boundary through which every durable Result Set passes.
2. `ResultStore.put` checks that reservation in the same all-or-nothing linearization point as `runId`, model-identity claims, and insertion.
3. The engine performs an early, fail-closed `ClashTestStore.isTombstoned` check for persistable stored-reference, direct-definition, and embedded-definition rerun paths.
4. `engine.deleteTest` writes the result-store tombstone before deleting definitions, so a partially completed delete blocks new durable insertion rather than allowing reuse.
5. A run admitted before deletion can finish, but a later persistence attempt rejects `TestDeletedError` without changing the sealed run outcome.

The store-level race and all-or-nothing requirements in AC-11 are mechanically testable and cover new insertions, model-index side effects, tombstone-vs-put ordering, idempotent re-put, and tombstone retention. The stated cross-store and host-bypass limitations are explicit trust boundaries rather than hidden guarantees.

The remaining issue is an acceptance/API contradiction, not a reopening of the original identity design; see R9-M1.

### M2 — aggregate ledger exhaustion: boundedness resolved, proof incomplete

Section §6.5.1 now provides a fail-closed outcome for each runtime allocation class:

- element, target-model, and unit taints collapse to a pre-reserved unit-wide `taint-overflow` record;
- a split is admitted atomically or converted to a `failed:unit-cap` gap;
- unit outcome and retry fields update an existing fixed-size record;
- independently capped result, diagnostic, reason, and annotation structures retain their own limits; and
- planning-only structures fail `plan-too-large` before execution.

This closes the prior unbounded/undefined runtime-allocation failure mode. The residual issue is the claimed reserve formula and the acceptance setup built on it; see R9-M2.

## Findings

### R9-M1 — AC-1 requires `retryPersist` from a state where the API forbids it

- **Severity:** Medium.
- **Spec sections:** §5.5 layer 2; §13.5.1 “Later attempts”; §18 API; AC-1 tombstone bypass case (b); AC-11.
- **Classification:** Internal consistency / unreachable acceptance criterion.
- **Concrete contradiction:** AC-1(b) requires direct and embedded runs with `persist: false` to complete and then requires `retryPersist` to fail with `TestDeletedError`. Section §13.5.1 defines `persist: false` as final persistence state `skipped`, while `retryPersist(runId)` is permitted only for a set whose state is `failed`. The API summary repeats that restriction. A conforming implementation therefore cannot execute the required AC-1 test.
- **Impact:** The durable `ResultStore` tombstone still protects an external `put`, so the original NH3 identity failure is closed. However, the specified acceptance suite cannot mechanically establish the claimed protection for a completed non-persisting run without violating another normative API contract.
- **Minimum correction:** Keep `retryPersist` restricted to `failed` and change AC-1(b) to retrieve the sealed set and call the configured `ResultStore.put` directly, asserting `TestDeletedError` and no index/result mutation. If the intended product API is to opt a previously skipped set into persistence, then broaden `retryPersist` deliberately and update §13.5.1, §13.5.2, §18, persistence-state transitions, and AC-11 together.

### R9-M2 — the discretionary-capacity proof uses a counter that does not bound `planRecords`

- **Severity:** Medium.
- **Spec sections:** §6.5.1; §17.1.1; AC-16 combined ledger ceiling.
- **Classification:** Verification gap / incorrect bound.
- **Concrete contradiction:** §6.5.1 defines `maxPlanReferences` as counting table entries plus unit range records. The separate `maxLedgerRecords` planning count additionally includes owner rows, unreachable/mixed-owner rows, scope-digest rows, hierarchy rows/examples, unit records, and planning gaps. Therefore `planRecords` can exceed `maxPlanReferences`. The stated cross-field rule `maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun` does **not** prove `D ≥ maxUnitsPerRun` for `D = maxLedgerRecords − (planRecords + maxUnitsPerRun)` unless `planRecords ≤ maxPlanReferences`, which the document does not establish.
- **Impact:** The direct check `planRecords + maxUnitsPerRun ≤ maxLedgerRecords` and the runtime fallbacks still prevent over-allocation, so the hard memory bound remains fail-closed. But AC-16 asks for a plan with many additional planning rows, `maxUnitsPerRun` units, and the minimum cross-field `maxLedgerRecords`; that setup may terminate `plan-too-large` before the fake executor can exercise any runtime exhaustion behavior. The claimed proof and its acceptance criterion are not mechanically aligned.
- **Minimum correction:** Either redefine `maxPlanReferences` to include every planning-time record counted in `planRecords`, or remove the false `D ≥ maxUnitsPerRun` claim and size the AC-16 fixture from its measured `planRecords + maxUnitsPerRun + desired D`. Preserve the direct end-of-planning check and reserved overflow slots; those are the actual safety proof.

## Regression and architecture assessment

- The round 9 changes do not require a collision-core API change, worker execution, or M4 Phase 4. M4 remains closed under Verdict D.
- The `ResultStore` tombstone is additive to the new orchestration layer and does not alter collision-library lease, epoch, query, identity, or diagnostic behavior.
- The ledger fallback rules remain conservative: they widen taint scope or convert work into a gap, never create a clean result from omitted evidence.
- Previously resolved NH1/NH2 and M1/M3–M8 contracts remain present and internally unchanged by the round 9 diff.
- No production source or test implementation exists for this draft yet; the acceptance criteria remain design-time contracts.

## External gates and trust boundaries

OQ-4 remains a separate pre-implementation-planning gate for the Viewer adapter. The required live owner-mapping/source-enumeration evidence is still absent from `docs/research/`. Host truthfulness for model identity, host placement-change notifications, OQ-16 product acceptance, and cross-store `testId` uniqueness remain explicit trust boundaries.

The two original Low items still noted by the handoff—L2 wording and L4 coverage for AC-15(d)–(g)—were not changed by round 9 and remain non-blocking. Sizing defaults remain provisional and unmeasured.

## Required revisions

1. Make AC-1(b) use a persistence operation that is legal from a `persist: false`/`skipped` set, or explicitly redesign the retry contract.
2. Correct the `maxPlanReferences`/`planRecords` proof and make AC-16's runtime-exhaustion fixture reachable under the corrected accounting.

After those changes, perform another independent consistency review. Viewer-adapter implementation planning also remains blocked until the OQ-4 evidence artifact exists.

`revise spec before implementation planning`
