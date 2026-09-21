# Executive Summary

The specification requires major revision before implementation. Four defects can directly produce incorrect lifecycle behavior or deadlock:

- Production placement retries do not match the P6 retry protocol.
- Pre-resolution runs attempt to use an accumulator that does not exist.
- Engine disposal has no specified path to signal or force-finalize runs.
- Result-cap rejection occurs after diagnostics/statistics have already been committed.

The review compared P6 with the adjacent P3, P4, P5, and P7 phase contracts. No files were modified.

# Critical Issues

## 1. Production placement retries cannot occur

- **Severity:** Critical
- **Location or section:** [P6.5 `runUnitWithRetries`](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1683), compared with [P4 error mapping](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p4-executor-diagnostics.md:1330)
- **Problem:** P6 retries only when the fact is the undocumented value `placement-contention`. P4’s production executor emits `failure.code: 'stale-placement'` with `retryable: true`.
- **Why it matters:** The test double and production executor speak different protocols. The retry tests can pass while real placement contention is never retried.
- **Concrete failure scenario:** `ModelPlacementChangedError` occurs without a generation change. P4 returns retryable `stale-placement`; P6 classifies it immediately as a failed unit instead of retrying up to `maxPlacementRetries`.
- **Recommended specification change:** Define retry eligibility using P4’s actual outcome, such as `outcome.failure.code === 'stale-placement' && outcome.failure.retryable === true`, together with the required generation comparison. Remove `placement-contention` as an executor fact, or add it explicitly to the owning P4 interface and settlement model. Run P6 retry tests with P4-shaped outcomes.

## 2. Pre-resolution cancellation and failure cannot build the promised Result Set

- **Severity:** Critical
- **Location or section:** [P6.4 accumulator creation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1225), [resultParts](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1308), [sealAs](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2687)
- **Problem:** `run.results` is created only after successful planning, but both `sealAs` and `resultParts` unconditionally call `run.results.toArray()`.
- **Why it matters:** This contradicts the principal requirement that cancellation before definition resolution seals a valid, empty, pre-resolution set.
- **Concrete failure scenario:** A run is cancelled while `resolveDefinition()` is pending. `settlePlanning` invokes `sealAs`; `run.results.toArray()` throws. The fallback also calls `resultParts`, which throws for the same reason, leaving `RunSummary.resultSet` as `null` instead of the required pre-resolution set.
- **Recommended specification change:** Specify an explicit pre-plan result representation. Either initialize an empty accumulator that needs no plan context, or make sealing use `run.results?.toArray() ?? []`. Add an integration test using the actual sealing sketch that asserts a non-null sealed set for cancellation, lookup failure, and model-not-bound before accumulator creation.

## 3. `engine.dispose()` cannot cancel or force-finalize runs through the published interfaces

- **Severity:** Critical
- **Location or section:** [P6 RunHandle interface](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:65), [P6 disposal request](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2829), [P7 dispose implementation](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md:747)
- **Problem:** P6 has an internal `requestCancel(..., {dispose:true})` and `forceFinalize`, but neither appears on `RunHandle` or another P7-consumable interface. P7’s `dispose()` only stops admission and awaits `handle.done`; it never signals existing runs.
- **Why it matters:** The disposal behavior described and tested cannot be implemented from the specified public or internal contracts.
- **Concrete failure scenario:** An executor is blocked in an in-flight unit or persistence never settles. `engine.dispose()` awaits `handle.done`, but the run never receives `disposeRequested` or a force-finalize signal. Disposal hangs until an unrelated timeout—or indefinitely if execution never returns.
- **Recommended specification change:** Add a concrete engine-only control surface, for example `RunController.requestDispose()` returning `done`, distinct from the public `RunHandle`. Require P7 to call it for every owned run before awaiting them. Define behavior when disposal arrives during building, sealing, and the short interval before `forceFinalize` is installed.

## 4. Result-cap rejection leaves diagnostics and statistics from a rejected unit committed

- **Severity:** Critical
- **Location or section:** [P6.5 `applyUnitResult`](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1720)
- **Problem:** P6 calls `diagnosticAggregator.addUnit` and `statisticsAccumulator.add` before `run.results.addUnit`. If the result accumulator refuses the unit for `result-cap`, P6 recursively records a non-merging failure but cannot roll back the earlier aggregation.
- **Why it matters:** The plan explicitly says a refused unit merges nothing. The sealed diagnostics, statistics, taints, integrity, and environment-sensitive outcome may nevertheless include it.
- **Concrete failure scenario:** A unit produces results that exceed `maxResultsPerRun` plus a completeness-affecting diagnostic. Its results are refused, but the diagnostic remains and can downgrade integrity or add taints to a run that claims the unit was not merged.
- **Recommended specification change:** Make the entire unit commit transactional. Check result-cap before mutating diagnostics/statistics, or add a non-mutating result admission/projection step followed by a single commit. Add acceptance assertions that refused units affect neither results, diagnostics, statistics, taints, nor progress counters.

# Important Improvements

## 5. Successful units are incorrectly recorded as failure reasons

- **Severity:** Important
- **Location or section:** [P6.5 settlement-state update](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1775), [collectReasons](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:338)
- **Problem:** `settlement.cause ?? 'evaluated'` pushes `evaluated` into `unitCauses`, even though U9 explicitly has no fact and no cause.
- **Why it matters:** Clean completed runs acquire `unit:evaluated` in `RunOutcome.reasons`, changing serialized output and result digests and confusing consumers that interpret reasons as caveats.
- **Concrete failure scenario:** A one-unit successful run seals with `reasons: ['unit:evaluated']` rather than an empty reasons list.
- **Recommended specification change:** Append to `unitCauses` only when `settlement.cause !== null`. Add a clean-run acceptance test asserting empty reasons.

## 6. Runtime split children have no valid plan-order rank

- **Severity:** Important
- **Location or section:** [P6 accumulator context](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1231), [P6 split insertion](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1619), [P5 reconciliation ranking](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p5-result-set.md:362)
- **Problem:** `unitPlanRank` contains only initial `plan.units`. Runtime children are all assigned the unranked fallback.
- **Why it matters:** Duplicate-result reconciliation promises “lowest unit in plan order,” but split children can incorrectly lose to later initial units or tie according to settlement arrival.
- **Concrete failure scenario:** Initial unit 1 splits; child `1.0.0` and later initial unit 2 report the same pair with conflicting evidence. Unit 2 wins because it has a rank while the logically earlier child does not.
- **Recommended specification change:** Define a stable total order for runtime descendants and update the rank oracle during every admitted split. Test conflicts between a child and a later initial unit, and between sibling/nested children.

## 7. `derivedFromRunId` is consumed but absent from `RunSpec`

- **Severity:** Important
- **Location or section:** [P6 RunSpec definition](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:64), [P6 result assembly](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1318), [P7 rerun construction](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md:1019)
- **Problem:** P6 reads `run.spec.derivedFromRunId`, and P7 passes it to an unspecified `buildRunSpec`, but the authoritative `RunSpec` shape omits it.
- **Why it matters:** An implementation adhering to the declared interface can legally discard rerun lineage.
- **Concrete failure scenario:** P7 passes the base run ID into `buildRunSpec`; its typed/object projection retains only documented fields, so the rerun seals with `derivedFromRunId: null`.
- **Recommended specification change:** Add `derivedFromRunId: string|null` to the P6 and P7 authoritative `RunSpec` definitions and specify its validation/capture behavior.

## 8. Sealing recovery assumes undocumented atomicity from `admitSealedSet`

- **Severity:** Important
- **Location or section:** [P6 normal admission and fallback](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2714), [terminal fallback](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2738)
- **Problem:** Any `admitSealedSet` exception sends control to a fallback that may call `admitSealedSet` again or release the reservation. The P5 contract does not state whether a throwing call is guaranteed to leave residency unchanged.
- **Why it matters:** Recovery correctness depends on undocumented transactional behavior.
- **Concrete failure scenario:** Residency converts the reservation, then an observer callback throws. P6 treats admission as failed and attempts to admit a fallback set under the same ID or release an already-converted slot.
- **Recommended specification change:** Specify `admitSealedSet` as atomic and exception-safe, or return an explicit result instead of throwing after mutation. Add tests for failures before mutation, after internal mutation, and from callbacks.

## 9. The terminal event is emitted before terminal phase is committed

- **Severity:** Important
- **Location or section:** [P6 finalize close](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2803), [terminal fallback](/Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2769)
- **Problem:** Both paths emit the terminal state event before `setPhase('terminal')`.
- **Why it matters:** A listener responding synchronously to the terminal event can call `getSnapshot()` and observe `phase: 'finalizing'`. That violates the stated coherent-snapshot/state-change model.
- **Concrete failure scenario:** UI receives `{terminal:true}`, reads the snapshot immediately, and continues showing finalization because the phase transition occurs only after the callback returns.
- **Recommended specification change:** Commit the complete terminal snapshot—including `status`, `phase`, and final persistence state—before emitting the terminal event. Test snapshot contents inside the listener, not only after `done`.

# Questions / Clarifications

1. Is `admitSealedSet` guaranteed not to throw after converting a reservation? P6 recovery requires a definitive answer.
2. Should all P3 `planningGaps` contribute to `RunOutcome.reasons`, or only the first cause selected by P6?
3. What is the normative order of runtime split descendants relative to initial work units?
4. Should cancellation/disposal be able to interrupt an executor that never cooperatively returns, or is indefinite drain explicitly accepted?
5. Are detailed freshness reasons such as `placement-changed:<modelKey>` required in the sealed `RunOutcome.reasons`? The sketch computes them but passes only `collectReasons(settlementState)` to `deriveRunOutcome`.

# Positive Observations

- The phase boundaries and producer-wins reconciliation are documented more rigorously than usual.
- Settlement precedence is pure, order-independent, and covered with pair/permutation tests.
- Cancellation is correctly distinguished from destructive world/model disposal.
- The three-snapshot/two-digest freshness design catches changes before and during a read.
- Injected time, scheduling, executor, planner, and persistence seams make deterministic testing feasible.

# Overall Readiness

**Requires major revision**

Resolve the four critical lifecycle defects and add cross-phase tests using production-shaped P4/P5/P7 interfaces before implementation starts.