Block P6 implementation until the critical lifecycle and interface contradictions below are resolved.

# Executive Summary

The specification is not implementation-ready. Its reconciled interface table is largely correct, but the executable steps, code sketches, tests, and phase summary still describe the pre-reconciliation design. Following the document sequentially would produce code that does not compile against P1–P5 and would fail several normative lifecycle guarantees.

The highest-risk defects are:

- Cancellation can hang indefinitely during resolution or while queued.
- The settlement precedence code and its own tests are mutually incompatible.
- Read-time freshness can report `current` after a model changed before the check began.
- Runtime splitting does not enforce the stated unit/ledger bounds.
- Most P6 implementation sketches still call removed or differently shaped cross-phase APIs.

No files were modified.

# Critical Issues

## C1 — Executable plan still uses superseded cross-phase APIs

- **Severity:** Critical
- **Location or section:** Reconciled interfaces [lines 25–46](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:25>); stale phase summary [lines 50–75](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:50>); planning implementation [lines 895–980](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:895>); unit loop [lines 1115–1235](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1115>); sealing [lines 2032–2058](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2032>)
- **Problem:** The document says “producer wins,” but later instructs implementers to use removed or incompatible APIs: positional `ModelBindingError`, `createRegistry()` without `world`, `Plan` instead of `PlanResult`, incorrect planner argument names, `buildScopeExpect`, the old `splitUnit` signature, `draft.mergeUnit`, synchronous diagnostic aggregation, `slot.attachSealed`, and free `startPersistence`.
- **Why it matters:** The warning that old names “must be read through” the table is insufficient. Several changes alter ownership, return shapes, asynchronous behavior, and control flow—not merely names.
- **Concrete failure scenario:** `planRun` returns `{status, plan, ledger, planningGaps}`, but P6 assigns that wrapper to `run.plan` and reads `plan.units`; execution fails before the first unit. Independently, an unsplittable result `{reason:'unsplittable'}` is treated as a successful split because the sketch checks only for `null`.
- **Recommended specification change:** Rewrite the phase summary and every executable step/test to the reconciled interfaces. Delete superseded code instead of retaining it as “read through” material. Add a mechanical acceptance check that no removed identifier or old signature remains in P6.

## C2 — Cancellation cannot satisfy the promised bounded settlement behavior

- **Severity:** Critical
- **Location or section:** Pre-resolution cancellation test [lines 799–817](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:799>); `resolveStage` [lines 886–892](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:886>); queued cancellation [lines 2096–2107](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2096>)
- **Problem:** `resolveStage` awaits `resolveDefinition()` before observing cancellation. The test deliberately supplies a promise that never settles, so the specified implementation can never pass that test. For a truly queued run, `cancelQueued` withdraws the job, meaning its run function never executes and no path seals its Result Set.
- **Why it matters:** `cancel()` and `done` may remain pending forever, blocking `dispose()` and leaking an admitted residency slot.
- **Concrete failure scenario:** Run A is in flight. Run B queues behind it and is cancelled. Its coordinator ticket is removed, but no lifecycle code starts to create the pre-resolution cancelled set. `handle.cancel()` and `handle.done` never settle.
- **Recommended specification change:** Define a cancellation race for resolution/planning, including abandonment or abort behavior for the losing operation. Define a dedicated queued-withdrawal sealing path that creates the pre-resolution cancelled set and releases/converts the reserved slot. Add separate tests for cancellation while waiting behind another run and while `resolveDefinition` never settles.

## C3 — Settlement precedence is internally inconsistent and order-dependent

- **Severity:** Critical
- **Location or section:** Precedence tests [lines 115–186](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:115>); table implementation [lines 235–252](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:235>); classifier [lines 266–287](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:266>)
- **Problem:** The test expects ranks exactly `[1…9]`, but `UNIT_PRECEDENCE` contains six separate rank-8 rows. More seriously, the classifier chooses the first encountered fact among equal-rank U8 facts, making the primary cause depend on input order.
- **Why it matters:** The normative requirement is scheduling-independent settlement. The proposed pairwise test cannot pass for two different U8 causes.
- **Concrete failure scenario:** `['capacity-exceeded','stale-placement']` selects `capacity-exceeded`, while the reversed input selects `stale-placement`. Ledger records and digests differ despite identical facts.
- **Recommended specification change:** Define deterministic precedence within U8, or explicitly define a canonical tie-break such as ascending cause code. Update the dense-rank test to validate unique rank groups rather than one rank per row. Test every U8 pair in both orders.

## C4 — `getFreshness` misses changes that occurred before snapshot₁

- **Severity:** Critical
- **Location or section:** Freshness tests [lines 1544–1638](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1544>); `compareToSealed` [lines 1692–1699](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1692>); `getFreshness` [lines 1750–1798](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1750>)
- **Problem:** `compareToSealed` compares only `modelVersion`. It does not compare snapshot₁’s `bindingGeneration` and `placementGeneration` to the sealed provenance values.
- **Why it matters:** Comparing the three live snapshots only detects changes during the freshness operation. It cannot detect a reload or placement change completed before the operation began.
- **Concrete failure scenario:** A host calls `notifyPlacementChanged('X')`, then calls `getFreshness`. All three live snapshots contain the same new generation and all digests match because transforms are excluded. The proposed implementation returns `current` instead of `stale:placement-changed:X`.
- **Recommended specification change:** On matching registry sessions, compare snapshot₁ against every recorded provenance field before digesting. Keep the three-snapshot comparisons for changes during the operation. Add tests for reload and placement changes completed before snapshot₁.

## C5 — Runtime splitting can exceed both unit and ledger limits

- **Severity:** Critical
- **Location or section:** Split decision [lines 1202–1214](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1202>); progress update [lines 1127–1134](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1127>); normative split bound in the master specification [§6.4](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md:397>)
- **Problem:** The split guard checks `run.plan.units.length`, which never changes as runtime children are created. It does not count split-parent records, children, range records, or consult the ledger-budget oracle required by A11.
- **Why it matters:** Repeated nested splits can exceed `maxUnitsPerRun` and `maxLedgerRecords`, violating the hard resident-memory bound.
- **Concrete failure scenario:** A plan begins with 9,999 units under a 10,000 cap. One unit splits, and a child splits again. The unchanged original length remains 9,999, so every split passes even though total unit records exceed the cap.
- **Recommended specification change:** Define one live split-admission operation that atomically checks projected unit-record count and ledger-record cost, performs the split only if both fit, and otherwise records `failed:unit-cap` with the correct `capDetail`. Add nested-split boundary tests.

# Important Improvements

## I1 — `maxQueuedRuns` has no owner or implementation path

- **Severity:** High
- **Location or section:** Coordinator surface [lines 54–60](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:54>); coordinator implementation [lines 505–535](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:505>); open item O5 [line 2204](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2204>)
- **Problem:** P7 assigns `RunQueueFullError` to P6, but P6’s coordinator accepts no limit and performs no queue-cap check. O5 incorrectly suggests residency may surface the error, while A14 explicitly says residency only throws `ResultCapacityError`.
- **Why it matters:** The public synchronous admission contract cannot be implemented consistently.
- **Concrete failure scenario:** An engine configured with `maxQueuedRuns: 1` successfully queues a second waiting run because the coordinator has no access to that engine’s limit.
- **Recommended specification change:** Assign the check explicitly to either `Coordinator.enqueue` or P7’s synchronous admission prefix. Specify whether depth includes the in-flight run and make reservation rollback atomic when queue admission fails.

## I2 — Lease acquisition contradicts the P1 binding contract

- **Severity:** High
- **Location or section:** Planning snapshot [lines 895–915](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:895>); P1 binding contract [P1 summary](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p1-identity.md:30>)
- **Problem:** P1’s `snapshotBindings` already returns frozen bindings with valid cached leases. P6 instead discards that lease, freezes a replacement with `lease:null`, and then assigns to the frozen property.
- **Why it matters:** In an ES module, the assignment throws. It also duplicates admission and undermines the atomic snapshot semantics supplied by P1.
- **Concrete failure scenario:** The first bound model reaches `binding.lease = world.admitModel(...)`; the frozen-object write throws before planning begins.
- **Recommended specification change:** Preserve the `Binding` objects or copy their existing leases into immutable run-snapshot records. Remove the second `admitModel` loop and update the “once at run start” test to assert P1 snapshot acquisition rather than P6 mutation.

## I3 — Preplanned `target-too-large` gaps are not integrated into progress

- **Severity:** High
- **Location or section:** Planning completion [lines 936–947](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:936>); execution queue [lines 1119–1144](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1119>); P3 gap contract [P3 sizing](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p3-planner.md:1222>)
- **Problem:** P3 records `target-too-large` gaps without creating executable units. P6 initializes and advances progress only from `plan.units`, with no stated adoption of those existing ledger gaps.
- **Why it matters:** A completed run containing a planning-created unit gap can finish with `fractionProcessed < 1`, or incorrectly report full coverage.
- **Concrete failure scenario:** Half the pair space is an over-cap target gap and half is one executable unit. After that unit succeeds, P6 advances only half the total weight and seals `completed` at `fractionProcessed = 0.5`.
- **Recommended specification change:** Specify how P6 imports P3’s ledger and initializes processed/evaluated weights from preterminal unit gaps before execution. Add a mixed executable-plus-`target-too-large` progress test.

## I4 — Sealing failures can permanently wedge `done`

- **Severity:** High
- **Location or section:** `sealAs` [lines 2032–2062](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2032>)
- **Problem:** `run.sealed` is set before asynchronous Result Set construction/sealing and residency admission. No failure path settles `done`, and subsequent calls return `run.summary`, which may still be undefined.
- **Why it matters:** This contradicts the requirement that `done` resolves exactly once and never rejects for every run outcome.
- **Concrete failure scenario:** Deep-freezing or digest construction throws because of an internal malformed record. The run remains marked sealed, has no Result Set, and `done` never settles.
- **Recommended specification change:** Define the exact behavior of build/seal failures. Either prove these operations are total after validated inputs or provide a terminal internal-error fallback and guaranteed slot cleanup. Do not set the absorbing seal flag until the final immutable set exists.

## I5 — Acceptance material cannot currently validate the reconciled design

- **Severity:** High
- **Location or section:** Scope tests [lines 1262–1420](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:1262>); verification table [lines 2122–2153](</Users/kangea/Workspace/Codes/aps-viewer-clash-detection/docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md:2122>)
- **Problem:** The plan says bracket construction/tests moved to P3, but P6 still instructs creating tests importing removed P6 exports and implementing those removed functions. The verification section is duplicated and omits critical queued-cancel and pre-snapshot freshness cases.
- **Why it matters:** Implementers cannot tell which tests are authoritative, and a nominally green suite could miss required lifecycle failures.
- **Concrete failure scenario:** The implementer follows P6.6 literally, recreates `buildScopeExpect` in P6, and introduces the dependency inversion that reconciliation D1 explicitly removed.
- **Recommended specification change:** Delete moved tests and implementation sketches from P6. Replace them with run-level consequence tests using P3-produced `scopeExpect`. Deduplicate the verification section and add explicit coverage for C2, C4, C5, and I1–I4.

# Questions / Clarifications

1. What deterministic primary-cause rule applies when two different U8 facts are observed in the same settlement?
2. Is unresolved definition lookup abandoned through `Promise.race`, or must `resolveDefinition` accept a cancellation checkpoint/signal?
3. Which component performs the synchronous per-engine `maxQueuedRuns` check, and how is a previously reserved residency slot rolled back?
4. Is P1’s snapshot-acquired lease the run-start lease, or is P6 intentionally expected to acquire a second lease?
5. What Result Set and terminal status must be produced if Result Set assembly or sealing itself fails?

# Positive Observations

- The document correctly centralizes reconciled producer interfaces and records why each changed.
- Settlement facts, run-status precedence, and cancellation matrix are expressed as testable tables.
- The specification preserves listener isolation and injected clock, timer, and scheduler seams.
- The three-snapshot/two-digest freshness protocol is strong once comparison to sealed generations is added.
- The acceptance plan emphasizes deterministic scheduling permutations and whole-unit result-cap behavior.

# Overall Readiness

**Requires major revision**

The lifecycle design is conceptually strong, but the implementation plan must be made self-consistent and fully reconciled before coding starts.