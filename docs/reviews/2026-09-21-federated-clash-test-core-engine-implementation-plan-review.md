# Federated Clash Test core-engine implementation-plan review

- **Plan reviewed:** `docs/superpowers/plans/2026-09-20-federated-clash-test-core-engine-implementation.md`
- **Plan SHA-256:** `81b0afed07a75785fa557b1f115878b51caf5aa474d43bd4a7ac1b0c7af6a55c`
- **Frozen design:** `docs/superpowers/specs/2026-09-20-federated-clash-test-and-results-design.md`
- **Design SHA-256:** `9bee6af5f206cbcb3a00d4c12545e8dba42b0bef33805ad9bc6e62a16d5ff29c`
- **Repository:** `/Users/kangea/Workspace/Codes/aps-viewer-clash-detection`
- **Branch:** `feature/m4-performance-worker-decision-design`
- **Reviewed at HEAD:** `e29efec23a407b002358f43d35d1a2a2704ab113`
- **Review date:** 2026-09-21

## Verdict

The plan requires a bounded remediation before core-only implementation authorization.

The frozen core design does not need to be reopened. The blocking lifecycle contradiction has an unambiguous answer in the frozen design: an in-flight unit is drained, and `engine.dispose()` may therefore remain pending if an injected executor never returns. The plan must align P7 with that contract rather than inventing forced abandonment.

Findings: **1 Critical, 3 High, 3 Medium, 2 Low**.

## Critical

### C1 — P7 requires disposal to abandon a never-returning in-flight unit, contradicting the frozen design and P6

**Sections:** frozen design §10.1–§10.2; P6 Task P6.8 and its `requestDispose()` state table; P7 Task P7.5; P7 AC-16 traceability and verification row 5.

The frozen design says an in-flight `findClashes` call has no abort seam, is drained rather than discarded, and `engine.dispose()` resolves only after every run has drained and sealed. P6 implements that reading and explicitly says indefinite drain is accepted when an injected executor never returns.

P7 asserts the opposite. Its test `dispose terminates with an executor blocked forever` supplies an executor whose Promise never settles but expects both `dispose()` and `done` to resolve. The adjacent queued-run test also leaves the head executor permanently pending while expecting both runs to settle. P7 then states that the core accepts no indefinite drain. The proposed `dispose()` implementation only calls `requestDispose()` and awaits `handle.done`; P6's own contract says that signal does not settle an in-flight unit until the executor returns. The tests are therefore unreachable without discarding in-flight work or falsifying the sealed ledger.

**Failure mode:** an implementer must either hang the P7 tests while honoring the design, or force-seal a run while a unit remains live, violating cancellation, ledger, result-set, and exactly-once settlement semantics.

**Type:** implementation-plan correctness contradiction. It exposes no impossibility in the frozen architecture; P7 is the inconsistent layer.

**Minimum correction:** delete the never-returning-executor termination requirement. Replace it with a controllably blocked executor test that verifies: disposal signals first, remains pending while the unit is blocked, drains and merges/discards by §16.7 when released, then seals and resolves. Keep never-settling persistence as the separately bounded case. Update P7's prose, AC-16 row, verification row 5, and reconciliation disposition to say that executor non-return is an accepted injected-port limit, matching P6 and §10.

## High

### H1 — The authoritative AC traceability table names test files that no phase creates

**Sections:** P7 `## AC traceability (spec §22)` and Task P7.11 Step 3; P4–P6 file-structure and verification sections.

Examples include:

- `run/cancellation.test.mjs`, `run/freshness.bracket.test.mjs`, `run/persistencePromises.test.mjs`, and `run/environmentSensitive.test.mjs`; P6 creates only `settlement`, `coordinator`, `progress`, `lifecycle`, `scopeConsequences`, and `freshness` test files.
- `results/validateResultSet.test.mjs`, `results/schemaEvolution.test.mjs`, `results/pairStatus.test.mjs`, and lower-case `inMemoryResultStore.test.mjs`; P5 creates split capture/invariant validation files, `status.test.mjs`, and `InMemoryResultStore.test.mjs`.
- `execution/outcomeValidation.test.mjs`, `diagnosticOverflow.test.mjs`, `localUnitExecutor.test.mjs`, `diagnostics.test.mjs`, `unattributable.test.mjs`, `errorTaxonomy.test.mjs`, and `placementRetry.test.mjs`; P4's planned files use the `unitOutcome.validate`, `diagnostics.*`, and `localExecutor.*` names.

Task P7.11 correctly says a missing mapped test is a plan defect and reopens the owning phase. In the current plan, that gate is guaranteed to fail even after correct implementation.

**Failure mode:** core acceptance cannot complete mechanically; evidence can be falsely reported against nonexistent paths or implementation stops at P7.11 for avoidable plan repair.

**Type:** verification gap and plan-internal consistency defect.

**Minimum correction:** regenerate the AC table from the actual per-phase file inventories and named verification rows. Every entry must point to a file that a task creates and a named assertion that task specifies.

### H2 — P7 maps required integration tests that Task P7.8 never instructs the implementer to build

**Sections:** P7 Task P7.8 Steps 1–10; AC-7, AC-17, AC-18, AC-19, and AC-21 traceability rows; P7 verification row 8.

The traceability table promises these real-`CollisionWorld` tests:

- cancellation mid-plan with evaluated-subset comparison;
- mixed reachable/unreachable owner orientations;
- diagnostic stress plus an unsliced negative control;
- dirty-world and geometry-readiness arms;
- world disposal and model eviction mid-run.

Task P7.8 specifies four selection shapes, partition/broad-phase invariance, a same-model negative control, determinism, and call conformance. It contains no construction steps, fixtures, assertions, or failure expectations for the five promised integration families above. A repository search finds those names only in the traceability/summary tables, not in executable task steps.

**Failure mode:** an executor can complete every P7.8 checkbox while omitting acceptance evidence that P7.11 later declares mandatory, or must invent high-risk lifecycle/diagnostic integration behavior during implementation.

**Type:** task-decomposition and verification gap.

**Minimum correction:** add bounded P7.8 steps for each promised test family, including the fixture seam and expected assertions, or remove the T2 mapping where the frozen AC is already fully satisfied by named lower-phase tests. Do not silently defer an in-scope AC.

### H3 — P7.9 asserts an uncalibrated wall-clock budget while its gate text says no such assertion exists

**Sections:** master §4 G-CAL; P7 Task P7.9 Step 6; P7 gate register; AC-12 traceability.

Task P7.9 Step 6 requires every sliced span to be `<= RUN_OPTION_DEFAULTS.frameBudgetMs` under an ordinary test run. The P7 gate section says, verbatim in substance, that P7.9 is calibration input and “Nothing in P7.9 asserts a wall-clock budget.” Those statements cannot both be true. The default is explicitly provisional, and the test result depends on machine load and timer behavior.

**Failure mode:** the functional core suite can fail nondeterministically before G-CAL, or passing on one development machine can be misreported as AC-12 calibration evidence.

**Type:** verification/calibration-gate violation.

**Minimum correction:** before G-CAL, assert deterministic slicing behavior—yield/checkpoint occurrence, bounded work-item cadence, and absence of unsliced size-dependent work—and record span measurements without a timing pass/fail threshold. Add the calibrated wall-clock assertion only to the G-CAL work package or a calibrated environment profile.

## Medium

### M1 — The phase graph and the parallel-execution instruction disagree

Master §3 declares P4 dependent on P3 and P5 dependent on P4, then says `P3 ∥ P4` and `P5 ∥ P3/P4`. The following paragraph explains that only P4.8 needs P3.2, but the phase dependency table and graph remain phase-level hard edges. P5 also consumes the P3 ledger contract conceptually while its dependency row omits P3.

This is implementable with task-level scheduling, but not from the graph as written. Replace the parallel sentence with explicit task edges, or keep phase-level execution strictly `P3 → P4 → P5`. If parallel execution is retained, list the exact P4/P5 tasks that may start and the producer checkpoints that release the remaining tasks.

### M2 — The time-sensitive differential oracle can accept an unrelated pair-set defect

P7.8's `assertPairSets` accepts any symmetric pair-set difference for `surface-intersection` or `containment` whenever the run has a nonzero global completeness-affecting diagnostic upper bound. That proves a caveat exists somewhere, not that the differing pair is within the affected scope.

For stable fixtures, require exact equality when `environmentSensitive === false` and no completeness-affecting diagnostics occur. For deliberately caveated fixtures, either correlate differences to affected units/elements or state clearly that the test is characterization only and does not prove decomposition equivalence for that arm.

### M3 — The owner-confirmation items are not yet part of a checkable G-PLAN acceptance record

Master §8 marks OPEN-1 as “confirm,” while the handoff asks a human to confirm OPEN-1 and the durable `cls` schema ruling. These are explicit and do not silently depend on Viewer work or product calibration, but an implementer must not infer confirmation from this review recommendation.

G-PLAN should record the milestone owner's core-only authorization and the disposition of the plan rulings in one checkable artifact or handoff entry. This is an authorization prerequisite, not a reason to reopen the design.

## Low

### L1 — `RunHandle` is repeatedly called “exactly five members” while six members are listed

P6 and P7 list `runId`, `getSnapshot`, `subscribe`, `cancel`, `done`, and `persisted`, and the P6 test correctly expects six keys. The prose says five. Correct the count so a future surface check is not “fixed” in the wrong direction.

### L2 — The plan hard-requires a tool-specific execution skill

The master and phase headers say a `superpowers:*` skill is required. That is execution-environment guidance, not a code dependency, and the repository's current agent environment does not expose that skill. Rephrase it as an optional workflow recommendation or provide a repository-native fallback so the plan is portable.

## Acceptance and scope assessment

### Task decomposition and sequencing

P0–P7 have clear ownership, concrete file lists, red/green steps, and phase-local verification. P5 and P6 are detailed enough to implement after their producer interfaces exist. The phase graph needs the M1 task-level correction, and P7 needs the C1/H1/H2 corrections before it can serve as the acceptance phase.

P8 is correctly marked deferrable and is not part of core Definition of Done. Its engine binding correctly waits for P7. Nothing in this review authorizes P8 execution.

### Dependency and architecture compatibility

The plan can implement the frozen architecture without Viewer-adapter code, OQ-4 evidence, remote persistence, annotation, calibrated values, or unresolved Host/product decisions. The use of fake `ElementEnumerator` and host-supplied identity values is explicit. The local transactional result store is separated from the remote ambiguous-commit follow-up. Annotation remains absent. P8 derivations remain deferrable.

No collision-core production change is planned. The real-world test layer uses the public `CollisionWorld.findClashes` surface, and the current repository exposes the required source, multi-target, mode, clearance, grouping, diagnostics, statistics, lease, and placement-invalidation behavior.

### Gates

- G-OQ4 blocks only the later Viewer adapter and live T3 evidence.
- G-OQ1 and G-OQ17 block Host integration, not the parameterized core.
- G-OQ16 blocks enabling a qualified Host claim, not testing both core branches.
- G-REMOTE blocks only the remote-persistence follow-up.
- G-CAL must block timing/default promotion, not functional work; H3 is the one current violation.
- G-PLAN still blocks all implementation and is not satisfied by this review.

### Verification coverage

The planned exact-cover, identity, definition, executor, sealed-result, claim, lifecycle, and real-`CollisionWorld` differential layers are appropriate. P5/P6's targeted matrices cover their highest-risk invariants. However, the authoritative acceptance map is not mechanically executable until H1 and H2 are fixed, and P7's disposal and timing tests are not currently valid.

The existing repository suite could not be run in this review environment: `npm test` stopped in `pretest` because `scripts/sync-vendor.mjs` attempted to unlink `wwwroot/vendor/three/build/three.core.js` and received `EPERM`. It failed before tests started and left the working tree unchanged. This environmental limitation does not change the plan findings.

## Confirmed sound areas

- The core design remains frozen; no finding requires new pair-space, identity, coverage, result-set, or persistence architecture.
- Three-cell planning and exact-cover verification are assigned to P3 without Viewer coupling.
- P4 consumes only the public collision surface through a bounded executor DTO.
- P5 owns the durable Result Set schema, validation, claim predicate, status reader, local store, and residency boundary.
- P6 correctly models unit-boundary cancellation, lifecycle precedence, live freshness, and drain-before-seal semantics.
- Remote persistence, annotation, Viewer adapter work, OQ-4, calibration, and product/Host choices are explicitly gated or deferred rather than silently required by P0–P7.
- P8 is separable and not required for core completion.

## Blocking revisions before authorization

1. Reconcile P7 disposal with frozen §10 and P6; remove the never-returning-executor completion claim.
2. Repair the AC traceability table so every core entry names an actually planned test file and assertion.
3. Add or disposition the missing P7 integration-test families promised by AC-7/17/18/19/21.
4. Remove the pre-calibration wall-clock pass/fail assertion from functional P7.9 and place it behind G-CAL.

`revise implementation plan before authorization`
