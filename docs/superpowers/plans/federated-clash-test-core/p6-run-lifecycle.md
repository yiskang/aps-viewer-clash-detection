# Run lifecycle — Phase P6 Implementation Plan

**Goal:** Build the part of `clashtest/` that turns a plan into a sealed Result Set: the world-scoped coordinator that gives every engine over one `CollisionWorld` a single FIFO queue, a single in-flight slot and a single `ModelRegistry`; the `RunHandle` state machine with its progress snapshots, throttled events and listener isolation; cooperative cancellation at Work-Unit boundaries with the pre-resolution seal; the bracketed scope-proof inputs and the drift/taint/invalidation rules; the coherent read-time `getFreshness` (two digest passes between three registry snapshots); and the normative settlement precedence that decides one terminal status when a cancel, a disposal, a reload, a drift and a core failure all surface at the same boundary. Everything is driven through injected seams — P3's plan, P4's `UnitExecutor` port, P5's seal/Result Set API, an injected clock, yield and timer — so every test in this phase runs deterministically with no wall clock and no real library call.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase **inherits the master's Global Constraints** in full. Phase-specific constraints, copied verbatim from the spec:

- §16.6 — "`unregister` and any engine hook wired to `BEFORE_MODEL_UNLOAD_EVENT` **never throw** and never `await`: an uncaught throw aborts the Viewer's teardown of every remaining model (M1). They only mark state; runs observe it at the next boundary."
- §9.2 rule 5 — "A listener exception is caught, counted (`listenerErrors`), and never propagates into the run."
- §10.2 — "**Cancel never** evicts, disposes, invalidates placement, or clears library caches."
- §10.1 — "`evictModel`/`dispose()` do stop a call (at its next checkpoint) but **destructively** … Neither may ever be used as a cancel mechanism."
- §8.1 — "Terminal states are absorbing; a Result Set is sealed **exactly once**, at the transition into a terminal state."
- §16.7 — "facts are **collected from committed state first, then resolved by this fixed order**. Nothing is decided until the whole set of facts for that settlement is in hand."
- §16.3.4 (invariant I-scope, normative) — "*A unit is `evaluated` only if its `scopeProof` is `equal`.*"
- §13.5.1 item 1 — "`done: Promise<RunSummary>` … resolves **exactly once** and **never rejects** for any run or persistence outcome."
- §17.3 — "a slice checks the injected `now` at least every 64 items and yields once `sliceBudgetMs` (provisional 4 ms…) has elapsed".

**Simplification notes (spec over-specification, externally observable invariants preserved).** Where §16.3.2 and §7.1 both describe the per-unit bracket, the *expectation* and the *comparison* are owned by **P3** (reconciliation D1): the expectation is `materializeUnit(plan, unit).scopeExpect` and the comparison is `checkScopeBracket`, in `clashtest/planning/scopeDigest.js`. P4's executor runs it per unit; P6 runs the same P3 function at read time inside `getFreshness`, over an expectation projected from the *sealed* `provenance.models[].scopeDigests`. One comparison implementation serves both, so the per-unit proof and the read-time proof cannot drift apart, and `execution/` never imports `run/`. The externally observable invariants — a unit is `evaluated` only with `scopeProof: 'equal'`, drift invalidates, an uncomputable digest is a gap — are unchanged. See "Gates and open items".

---

## Consumed interfaces from other phases (centralized; RECONCILED)

> **Status: reconciled and applied.** This table was written as *assumptions* while P3/P4/P5 were authored in parallel. It has since been checked against each owning phase's **Phase interface summary** and corrected **producer-wins** throughout, and **every executable step, code sketch and test below has been rewritten to these signatures** — no superseded name survives anywhere in this file, and the mechanical proof of that is the final section, *Conformance check*. The authority for every row is [`interface-reconciliation.md`](interface-reconciliation.md); where a row changed, the reconciliation row id is given. Where a controller ruling (R1–R11, recorded under *Gates and open items*) settled a point the reconciliation left open, the row says so. Nothing else in this file consumes an unlisted interface.

| # | Owner | Reconciled signature | Used by |
|---|---|---|---|
| A1 | P0 | **CHANGED (N31).** `resolveRunOptions(input, limits?) → frozen ResolvedRunOptions` (throws `InvalidOptionsError` **synchronously**); `resolveEngineLimits(input) → frozen ResolvedLimits`. Note the second argument: run options are validated *against* the resolved engine limits, so P6 resolves limits first. | P6.2, P6.5 |
| A2 | P0 | **CHANGED (N6).** `createSlicer({ now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery?, spanRecorder?, afterYield? }) → { tick(label?), yieldNow(label?), forEach(list, fn, opts?), sortSliced(list, compare, opts?), stats() }`. The yield point is **`tick(label?)`, not `step()`**; it returns `undefined` when not due, else a Promise — `const p = slicer.tick('units'); if (p) await p;`. `afterYield` may throw to abort, which is P6's cancel-at-yield seam. Every call site in this file spells it `tick`. | P6.4, P6.5 |
| A3 | P0 | **CHANGED (N1).** `clashtest/errors.js` exports every typed error of §18 as a named class with `name` equal to the class name, each constructed with **one object argument**: `new XError({ ...typedFields, message?, cause? })`. **`ModelBindingError` is `new ModelBindingError({ reason, modelKey })` and exposes `.reason` — not `(code, message?)` and not `.code`.** P6's own `'coordinator-version-mismatch'` is a `reason` value. | all |
| A4 | P1 | `registry.snapshotBindings(modelKeys) → Readonly<{ registryRevision, bindings: ReadonlyArray<Binding\|null> }>`, `registry.registrySessionId`, `registry.bindingFor(key)`, `registry.notifyPlacementChanged(key)`, `registry.invalidateModelPlacement(key)`, `registry.isBindingCurrent(binding)`, `bindingsEquivalent(a, b)`, `assertRegistryBelongsToWorld(registry, world)`. `Binding = { modelKey, model, modelVersion, lease, bindingGeneration, placementGeneration }` — **there is no `dead` flag** (N10): a dead or unregistered binding reads as **`null`**, and so does one whose lease the world no longer honors. P6's freshness comparison uses `bindingsEquivalent`, never a `dead` field. | P6.2, P6.6, P6.7 |
| A5 | P1 | **CHANGED (N11).** `createModelRegistry({ world, makeSessionId? }) → ModelRegistry` — **`world` is required**; there is no `now` option. One registry per world, constructed by this coordinator (§4.3). P1 also exports the `ModelRegistry` class; the factory is the §18 public name. | P6.2 |
| A6 | P3 | **CHANGED (N15).** `planRun({ definition, snapshot, enumerator, options, checkpoint, ledger? }) → Promise<PlanResult>` where **`PlanResult = { status: 'planned'\|'failed', plan: Plan\|null, ledger, planningGaps: PlanningGap[], preTerminalGapWeight: number }`** — P6 reads `result.plan`, `result.planningGaps` and (**controller ruling R11**) `result.preTerminalGapWeight` off the **wrapper**, not off the plan. `preTerminalGapWeight` is P3's tested Σ of `pairSpaceWeight` over the unit records it wrote at plan time that are already terminal and will never be executed (today exactly `not-run:target-too-large`); `adoptPlanIntoProgress` adds it to the settled weight instead of re-deriving the same sum by filtering `toLedgerRecord().units`, so P6 and P3 cannot disagree about what "pre-planned gap weight" means. Argument names are P3's: `snapshot` (the A4 snapshot result), `options` (resolved run options), `checkpoint` (the §6.2 enumeration-context checkpoint — a *different* thing from `slicer.tick`). Engine limits reach the planner through P3's `createRecordBudget(limits)`, not as a `planRun` argument. `Plan = { tables, tableById, ownersByModel, ownerRootByModel, models (alias modelsByKey), selectionKindByRole, units, unitsById, pairSpaceTotal, planRecords, sizing }`. **P6 creates the budget and the ledger itself (A17) and passes the ledger in**, so planning gaps, unit records and runtime taints all accumulate in **one** ledger object that survives into execution and is projected once at seal. | P6.4 |
| A7 | P3 | **CHANGED (N16).** `materializeUnit(plan, unit) → { sourceDbIds, targets, scopeExpect }` — a **superset** of what this file assumed. `scopeExpect` is the canonically ordered bracket expectation including the R20-1 whole-model-source rule; P6 passes it through in `ExecutionRequest.materialized` and **does not build it** (see O2, D1). Released by the caller after the attempt settles. | P6.5, P6.6 |
| A8 | P3 | **CHANGED (N17), then EXTENDED by controller ruling R8.** `splitUnit(plan, unit) → { children: [WorkUnit, WorkUnit] } \| { reason: 'unsplittable' \| 'unit-cap' \| 'ledger-cap', capDetail? }` — the alias of `planSplit`, and the **single live split-admission operation**: it takes the **`WorkUnit`, not `(unitId, capacityKind)`**, **never returns `null`**, and **atomically** counts the projected unit records (the split parent plus both children, against `maxUnitsPerRun`) and their ledger records (against `maxLedgerRecords`) through P3's own budget/`tryRecordSplit` before performing the split — so nested runtime splits cannot exceed either bound and no half-recorded split can exist. Callers **test `'children' in result`, then branch on `result.reason`** — never on `null` or truthiness. `capDetail` is `'unit-records'` for `'unit-cap'` and `'ledger-records'` for `'ledger-cap'`; P6 copies it onto the ledger `UnitRecord`. The split order of §6.4 is deterministic and kind-independent, so `capacityKind` is not an input; P6 records it on the `UnitRecord`. **Cause mapping (§6.4 item 4 vs. the cap rows):** `'unsplittable'` leaves the unit's original `failed:capacity-exceeded` cause standing (a fundamentally indivisible unit is a gap of the capacity failure itself); both cap reasons become `failed:unit-cap` with `capDetail`. | P6.5 |
| A9 | P4 | `UnitExecutor = (request: ExecutionRequest) => Promise<UnitOutcome>` (§7.1, §11.2 shapes verbatim). P4's reference implementation is `createLocalUnitExecutor({ world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs })`. P6 may also call `validateExecutionRequest(request)` before issuing. | P6.5 |
| A10 | P4 | **CHANGED (N8).** `validateUnitOutcome(request, outcome) → { ok: boolean, issues: Issue[] }` where **`Issue = {code, path, detail}` — structured objects, not `string[]`** — and it is **always** a two-field result (`ok:true` still carries `issues: []`). On `ok:false` P6 substitutes **`internalErrorOutcome(request, issues)`** (P4 exports the canonical `failed:internal-error` outcome; P6 does not hand-build one) and fails the run. | P6.5 |
| A11 | P4 | **CHANGED (N20).** There is **no `aggregateDiagnostics` / `readDiagnostics` pair.** P4 exports **`createDiagnosticAggregator({ maxRetainedDiagnostics, maxDistinctReasons, maxUnitIdsPerDiagnostic, slicer }) → { addUnit(unitId, outcome) → Promise<{unitTaints: TaintEntry[]}>, snapshot() → DiagnosticsSummary }`**. P6 creates **one aggregator per run**, `await`s `addUnit(unitId, outcome)` for each settled unit and merges the returned `unitTaints` into that unit's ledger record, then calls `snapshot()` once at seal time in place of `readDiagnostics`. P6 also owns the **`admit(n)` ledger-budget oracle** it injects into P4's `deriveUnitTaints(diagnostics, {maxElementTaintsPerUnit, admit})` (N9), built over P3's budget (A17). **Charging rule (implementation-level decision, recorded here):** P3's `ledger.addTaint` already *charges* `budget.admitRuntime` for every taint it records, so P6 passes a **non-charging capacity peek** — `admit: (n) => budget.discretionaryRemaining >= n` — and lets `ledger.addTaint` perform the one real, charging admission. Charging in both places would double-count the same record; peeking first and charging at write time keeps `budget.used ≤ maxLedgerRecords` exact, and if the peek is optimistic the ledger's own refusal path (collapse to the reserved `taint-overflow` unit taint) still applies — the same conservative direction §6.5.1 requires. P4's aggregator — not the executor — applies `maxDistinctReasons` and owns `omittedReasonOccurrences` (P4 spec item 1). P6 additionally drives P4's `createStatisticsAccumulator()` and passes its `snapshot()` to `buildResultSet`. | P6.5, P6.8 |
| A12 | P5 | **CHANGED (N21).** There is **no `createResultSetDraft`**. P5 exports **`createResultAccumulator(ctx) → { addUnit(unitOutcome) → {accepted, reason?, added?}, size(), toArray() }`** for results and **`buildResultSet(parts) → ResultSet` (unsealed draft)** for assembly. P6 therefore keeps the run's own ledger records and planning gaps (they are P6/P3 state, not P5's), creates **one accumulator per run at plan completion** — `createResultAccumulator(ctx)` with the context P5's *Accumulator context* paragraph pins, `{mode, testId, semanticDigest, maxResultsPerRun, unitPlanRank, unreachableOwners, mixedOwners}`, where **`unitPlanRank` is the live plan-order oracle** P6 builds (`run.unitOrder`, P6.5) — P5 accepts a `Map` **or any `{get(unitId) → number\|undefined}`**, and P6 passes the second form because runtime split descendants do not exist when the plan does and a `Map` fixed here would rank every one of them last (re-verification I6, cross-file need C-P5-3); the accumulator still cannot exist before the plan does and `unreachableOwners`/`mixedOwners` are `Map<modelKey, Set<dbId>>` built from the ledger's `unreachablePopulation` **plan** rows, never from a unit — feeds each accepted `UnitOutcome` to it, honors its `{accepted:false, reason}` answer as the whole-unit `maxResultsPerRun` boundary rule, and calls `buildResultSet(parts)` **once** at seal time, where `parts = {runId, testRef, definition, derivedFromRunId, outcome, provenance, ledger, results, diagnostics, statistics}` — `ledger` is P3's `ledger.toLedgerRecord()` projection (A17), `results` is `accumulator.toArray()`, `diagnostics` is the aggregator's `snapshot()` and `outcome` is P5's own `deriveRunOutcome(...)` (A13). The progress counter `resultsFound` is `accumulator.size()`. | P6.4, P6.5 |
| A13 | P5 | **CHANGED (N22).** `sealResultSet(draft, { slicer }) → Promise<ResultSet>` — **the `outcome` and `diagnostics` are already inside `draft`**, because P6 supplies them to `buildResultSet`/`deriveRunOutcome` first. Deep-frozen, digests computed, sealed exactly once. P5 also exports `deriveRunOutcome({status, freshness, ledger, diagnostics, results, reasons})`, whose `status`/`freshness`/`reasons` P6 supplies from `resolveRunStatus`/`collectReasons`; note `freshness` there is the **bare state string** stored on `RunOutcome` (see C1). **P6 derives none of the other axes itself:** `coverage`, `integrity`, `environmentSensitive` and `environmentSensitiveCauses` are all computed by `deriveRunOutcome` from the ledger, the diagnostics summary and the results — P6's only obligation is to have written the facts they read (`capacityKind: 'bucket-capacity'`, `cause: 'stale-placement'` on retry exhaustion) onto the ledger `UnitRecord`s. | P6.8 |
| A14 | P5 | **CHANGED (N23); owner of the queue cap settled by R6.** There is **no `residency.admit`/`slot` object.** P5 exports `createResidencyManager({ limits, resultStore, now, onPersistence }) → ResidencyManager` with `reserveRunSlot(runId)` (throws `ResultCapacityError` **synchronously**), `releaseRunSlot(runId)`, **`admitSealedSet(runId, resultSet)`** in place of `slot.attachSealed` — it *converts* the reservation the run was admitted with into an ordinary resident set (§13.1: "the slot it was already admitted with becomes an ordinary resident set"), needs no new slot, and is required to be **atomic and exception-safe** — either it converts and returns, or it throws having changed nothing (cross-file need **C-P5-1**, re-verification I8/Q1); P6's seal-failure recovery asks `getResident(runId)` and never assumes which happened — `getResident(runId)`, `retainResultSet`/`releaseResultSet`/`discardRun`/`touch`/`retentionReport`, and **`drainForDispose() → {droppedUnsaved, persistenceInFlight}`** in place of `handBackUnsaved()` — note it returns an object, and that object is exactly P7's `DisposeSummary`. Class is read via `retentionReport()`, not a per-slot `classOf()`. **`reserveRunSlot` is called by P7's synchronous admission prefix, not by P6**; every P6 path that ends a run without admitting a sealed set must `releaseRunSlot(runId)` exactly once. **`RunQueueFullError` is P7's, not P6's and not residency's** (R6). | P6.2, P6.8 |
| A15 | P5 | **CHANGED (N24).** There is **no free `startPersistence`.** The attempt is driven through the residency manager: **`beginPersist(runId, { persist }) → Promise<PersistenceOutcome>`** (never rejects), **`getPersistenceState(runId) → PersistenceSnapshot\|null`** in place of a returned `snapshot()`, and `retryPersist(runId)`. The store is the one P5's manager was constructed with, so P6 passes no `store`; the `signal` seam is P6's `scheduleTimeout` window (O3) wrapped around the returned promise. | P6.8 |
| A16 | P5 | **CONFIRMED and now real (N19).** `freshnessStateOf(freshness) → 'current'\|'stale'\|'unverifiable'\|null`, exported from `clashtest/results/claim.js`, accepting **either** a `Freshness` object or the bare string, and returning **`null` for anything unrecognized** (fail-closed). P5 did not originally export it; reconciliation added it there as the single adapter that resolves C1. Per **R3**, `assessNoClashClaim`/`canClaimNoClashes` accept either shape, read it through `freshnessStateOf` **exactly once**, and append a `Freshness` object's `reasons[]` to `qualifiers`. P6 hands them the **object** `getFreshness` returns and never a bare string, so a refusal is always explainable. | P6.7 |
| A17 | P3 | **ADDED by this pass** (the budget/ledger surface P6 drives was never listed, although N9/N15 both depend on it). `createRecordBudget(limits) → RecordBudget` with `admitPlan`, `reserveUnitSlots`, `consumeReservedSlot(unitId)`, `admitRuntime(cls, n, unitId)`, and the read-only getters `planRecords`, `used`, `discretionaryRemaining`, plus `budgetExhausted` / `firstRefusalUnitId`; `createLedger({limits, budget}) → Ledger` with **`recordUnit`, `recordOutcome`, `recordGap`, `tryRecordSplit`, `addTaint`, `unitRecord(unitId)`, `toLedgerRecord()`, `budgetExhausted`, `firstRefusalUnitId`** (P3 Task P3.8 *Produces*). P6 constructs both at run start, passes the ledger to `planRun` (A6), writes every unit outcome through `recordOutcome`/`addTaint`, and projects **once** at seal with `toLedgerRecord()` — the arrays-only shape P5's `ledgerDigestInput`/`validateResultSet` are written against (P5 *Shapes this phase pins*). P6 re-derives none of it. | P6.4, P6.5, P6.8 |
| A18 | P0 | **ADDED by this pass** (P6's tests imported four support doubles under names P0 does not export). `test/clashtest/support/index.mjs` exports **`createFakeClock({start, tickMs, yieldAdvanceMs}) → {now, advance, peek, yieldToScheduler, yieldCount, onYield}`**, **`createFakeWorld({defaultResult}) → {calls, script, hold, dispose, inFlight, maxInFlight, disposed, findClashes}`**, **`createFakeEnumerator({models, checkpointsPerCall, cooperative}) → {calls, resolveRoots, digestScope, set(modelKey, patch), onCall(fn)}`** and **`createFakeRegistry({registrySessionId, models}) → {registrySessionId, register, getBinding, snapshotBindings}`** — `create*`, never `make*`, and all from `support/index.mjs`, never from per-fake paths. P0's `createFakeRegistry` is a deliberate **placeholder** carrying no `placementGeneration` and no mutation hooks, so P6 adds (never forks — P0 extension rule 2) `support/placementRegistry.mjs` and appends its export to `index.mjs`. | P6.3–P6.8 |

---

## Phase interface summary

Every exported name this phase produces. Other phases rely on exactly these.

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `COORDINATOR_PROTOCOL_VERSION` | `clashtest/run/coordinator.js` | `number` (1) | Wire version of the cross-bundle coordinator contract (§7.3). |
| `COORDINATOR_SLOT` | `clashtest/run/coordinator.js` | `symbol` = `Symbol.for('clashtest.coordinators')` | `globalThis` key holding the `WeakMap<CollisionWorld, Coordinator>` so duplicate bundles join one coordinator (§7.3). |
| `getWorldCoordinator` | `clashtest/run/coordinator.js` | `(world, { protocolVersion?, createRegistry?, now?, yieldToScheduler? }) → Coordinator` | Returns (creating once) the world's coordinator; calls `createRegistry({ world })` — P1's `createModelRegistry` by default (A5) — exactly once per world; throws `new ModelBindingError({ reason: 'coordinator-version-mismatch' })` on a version mismatch. |
| `Coordinator` | `clashtest/run/coordinator.js` | `{ world, protocolVersion, registry, enqueue(job) → QueueTicket, cancelQueued(runId) → boolean, stopAdmitting(engineId), queueDepth(engineId?) → number, inFlightRunId() → string\|null }` | One FIFO queue and one in-flight slot per world; owns the sole `ModelRegistry` for the world (§4.3, §7.3). **The coordinator carries no queue limit of its own (R6):** `maxQueuedRuns` is a per-*engine* option, checked in P7's synchronous admission prefix *before* `enqueue`, which is why `queueDepth(engineId)` is per engine and why `enqueue` never throws `RunQueueFullError`. |
| `QueueTicket` | `clashtest/run/coordinator.js` | `{ runId, started: Promise<void>, finished: Promise<unknown>, withdraw(): boolean }` | `started` resolves when the job reaches the head; `finished` settles when the job's function settles (or immediately on a successful withdrawal); `withdraw()` removes a still-queued job and returns `true`, or returns `false` once the job has started — the synchronous, single-winner hinge the queued-cancel path (R5) branches on. |
| `createRun` | `clashtest/run/Run.js` | `(spec: RunSpec) → { handle: RunHandle, controller: RunController, begin(): void }` | Builds a run in state `queued`, its **public** handle and its **engine-only** controller; `begin()` hands the run to the coordinator queue. All three are **synchronous** (R1: only Promise-returning entry points reject; `createRun`/`begin` throw). `createRun` also **validates `spec.derivedFromRunId`** (re-verification I7): absent ⇒ `null`; otherwise `null` or a non-empty string, and anything else is a `TypeError` (a malformed `RunSpec` is an engine bug, not user data — the same class of programmer error as P5's `ERR_RESULT_SET_NOT_DRAFT`). |
| `RunSpec` | `clashtest/run/Run.js` | `{ runId, engineId, coordinator, world, testIdOfInput, derivedFromRunId, resolveDefinition, modelKeysOf, planningCauseOf, enumerator, executor, validateUnitOutcome, internalErrorOutcome, diagnosticAggregator, statisticsAccumulator, deriveUnitTaints, plannerPort, resultPort, runOptions, limits, provenanceBase, now, yieldToScheduler, scheduleTimeout }` | Every collaborator of a run, all injected (no module-level singletons). **`derivedFromRunId: string\|null`** is the rerun lineage §13.1 requires on the sealed set (`ResultSet.derivedFromRunId`); it is part of the authoritative shape precisely so an implementation that projects only the documented fields cannot legally discard it (re-verification I7). `plannerPort` = `{ planRun, materializeUnit, splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket }` (P3, A6/A7/A8/A17 + D1's comparator); `resultPort` = `{ createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome, residency }` (P5, A12/A13/A14/A15). **There is no `store` field:** the result store is bound into P5's residency manager at construction (A15), so a run never holds one. |
| `RunHandle` | `clashtest/run/Run.js` | `{ runId, getSnapshot() → RunProgress, subscribe(listener) → () => void, cancel(reason?) → Promise<RunSummary>, done: Promise<RunSummary>, persisted: Promise<PersistenceOutcome> }` | §18 `RunHandle`, semantics of §9, §10, §13.5.1. **Exactly these five members and nothing else** — no disposal control, enumerable or otherwise (see `RunController`). |
| `RunController` | `clashtest/run/Run.js` | `{ requestDispose() → Promise<RunSummary> }` | **Engine-only** control surface, returned by `createRun` **beside** the handle and never reachable from it (re-verification C3). `requestDispose()` marks `disposeRequested` on committed state, cancels the run at its next boundary, forces the finalize window closed when the run is already past its seal, and resolves with the same `RunSummary` as `done` — it is the one published way `engine.dispose()` can signal a live run. **P7 must call it for every owned run *before* awaiting that run's `done`** (cross-file need C-P7-1 below); a `dispose()` that only awaits `done` leaves the run with no `disposeRequested` fact and no forced close. |
| `RUN_STATES` / `RUN_PHASES` | `clashtest/run/Run.js` | frozen string arrays | §8.1 states and §9.1 phases, in declaration order. |
| `isTerminalStatus` | `clashtest/run/Run.js` | `(status: string) → boolean` | `completed \| cancelled \| failed \| invalidated`. |
| `UNIT_PRECEDENCE` | `clashtest/run/settlement.js` | `ReadonlyArray<{ rank, fact, code, kindByPhase }>` | Table A of §16.7, U1…U9 in precedence order. |
| `classifyUnitSettlement` | `clashtest/run/settlement.js` | `(facts: Fact[], phase: 'pre'\|'call'\|'post') → { outcome, cause, primaryFact, secondaryCauses: string[], merges: boolean }` | Table A + matrix C merge policy for one attempt; pure, order-independent. |
| `resolveRunStatus` | `clashtest/run/settlement.js` | `(state: SettlementState) → 'failed'\|'invalidated'\|'cancelled'\|'completed'\|null` | Order B of §16.7; `null` = continue. |
| `collectReasons` | `clashtest/run/settlement.js` | `(state: SettlementState) → string[]` | Every observed fact, ascending by code-unit order (§16.7 closing paragraph). |
| `SettlementState` | `clashtest/run/settlement.js` | `{ unitCauses: string[], planningCause: string\|null, planningGapCauses: string[], placementChangedVsSnapshot: boolean, cancelRequested: null\|{reason}, disposeRequested: boolean, allLeafUnitsTerminal: boolean }` | The committed facts a boundary resolves from. **`planningCause`** is the ONE cause order B resolves the status from; **`planningGapCauses`** is *every* §6.6.2 gap P3 reported (and every one P6 detected after `planRun` returned), which is what `collectReasons` turns into `planning:<cause>` entries — re-verification Q2. `unitCauses` carries a cause **only for a unit that has one**: U9 (`evaluated`) has `cause: null` and contributes nothing (re-verification I5). |
| `sealedScopeExpect` | `clashtest/run/freshness.js` | `(provenanceModels) → ReadonlyArray<ScopeExpectEntry>` | Pure projection of the **sealed** `provenance.models[].scopeDigests` into the entry shape P3's comparator takes (`{ modelKey, role: 'recorded', scope: 'whole'\|'roots', population?, roots? }`), so the read-time bracket runs through P3's one comparison implementation. It applies **no** planning rule: the sealed record already lists exactly the scopes the run bracketed. |
| `getFreshness` | `clashtest/run/freshness.js` | `(resultSet, { registry, enumerator?, ctx? }) → Promise<Freshness>` | §16.4: snapshot₁ → pass₁ → snapshot₂ → pass₂ → snapshot₃, every touched binding compared across all three **and** snapshot₁ compared against the sealed provenance values (R9). Each pass is one `checkScopeBracket` call (P3, D1) over `sealedScopeExpect(...)`. |
| `Freshness` | `clashtest/run/freshness.js` | `{ state: 'current'\|'stale'\|'unverifiable', reasons: string[] }` (frozen) | Read-time freshness with its machine-readable reasons. |
| `createEmitter` | `clashtest/run/emitter.js` | `({ now, progressMinIntervalMs }) → { subscribe(l) → () => void, emit(type, payload), listenerErrors: number, listenerCount: number }` | Throttled `progress`, never-throttled `state`/`unit`/`persistence`, listener isolation (§9.2 rules 4–5, §16.6). |

**Names this phase deliberately does NOT own** (reconciliation D1, so an implementer reading only P6 cannot recreate them here): the per-unit scope-bracket **expectation** is `materializeUnit(plan, unit).scopeExpect` (**P3** `planning/planner.js`, the sole home of the §16.3.2 **R20-1** whole-model-source rule) and the **re-digest-and-compare** half is `checkScopeBracket` (**P3** `planning/scopeDigest.js`, beside the `compareScopeExpectation` it folds). P6 imports the second and passes the first through; it builds no expectation from `plan.models[…].scopeDigests` and implements no digest comparison. The per-unit **lease gate** is P4's (**D2**): `LocalUnitExecutor` runs `world.isLeaseValid(binding.lease)` before every unit, and P6 never re-checks a lease per unit. All diagnostic **aggregation** is P4's (**D3**): P6 drives `createDiagnosticAggregator` and consumes a finished `DiagnosticsSummary`. `getPairStatus`/`getElementStatus`/`readLedger` are P5's (**D4**).

---

## File structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `clashtest/run/settlement.js` | Create | Pure precedence tables and resolvers of §16.7 (tables A, B, C). No I/O, no state. |
| `clashtest/run/coordinator.js` | Create | World-scoped coordinator: `globalThis` registry of coordinators, the world's sole `ModelRegistry`, FIFO queue, one in-flight slot, per-engine admission stop. |
| `clashtest/run/emitter.js` | Create | Phase-local: subscriber list, `progressMinIntervalMs` throttle, listener-exception isolation and `listenerErrors` counter. (Addition to the master module map — see "Gates and open items", item O1.) |
| `clashtest/run/freshness.js` | Create | **`sealedScopeExpect`, `getFreshness` and the `Freshness` DTO only** (reconciliation D1): the §16.4 read-time loop — snapshot₁ → pass₁ → snapshot₂ → pass₂ → snapshot₃ — the comparison of snapshot₁ against the **sealed** provenance generations (R9), and the placement-generation comparison. Each pass is one `checkScopeBracket` call **imported from `clashtest/planning/scopeDigest.js`** (P3); this module defines no expectation builder and no digest comparison. |
| `clashtest/run/Run.js` | Create | The run state machine: resolution → planning → unit loop → settlement → seal → finalize window. Owns `RunHandle`. |
| `test/clashtest/support/scriptedExecutor.mjs` | Create | Shared fake: `createScriptedExecutor(script)` — a `UnitExecutor` driven by a per-unit script of facts/outcomes, plus a fact-ordering shuffler for AC-21. **Added** to P0's `support/` under P0 extension rule 2 (new file + one line appended to `support/index.mjs`), never forked from it. |
| `test/clashtest/support/fakePlanner.mjs` | Create | Shared fakes: `createFakePlan(units, opts)` (a minimal `Plan` + `PlanResult` wrapper: units, weights, tables, `scopeExpect` per unit, preplanned `target-too-large` gaps) and `createFakeLedger()` (P3's A17 ledger surface over plain arrays), so P6 tests do not depend on P3's real planner. |
| `test/clashtest/support/placementRegistry.mjs` | Create | `createPlacementRegistry({registrySessionId, models})` — P0's `createFakeRegistry` extended with `placementGeneration`/`bindingGeneration` and the mutation hooks the freshness suite needs (`notifyPlacementChanged`, `reload`, `setVersion`, `unregisterKey`, `onSnapshot(n, fn)`, `snapshotCalls`). Additive per P0 extension rule 2; P0's own fake is left untouched. |
| `test/clashtest/support/runFixture.mjs` | Create | `createRunFixture(opts) → {spec, clock, world, registry, executor, residency, ledger, resultPort, diagnosticAggregator, statisticsAccumulator, reached(phase), afterUnit(id, fn), sealed(), release(step), requestDispose(controller)}` — wires P0's `createFakeClock` and the three fakes above into a complete `RunSpec`. **`requestDispose(controller)` models P7's `dispose()` exactly** (re-verification C3): it calls `controller.requestDispose()` for the run, waits for that promise, then returns `residency.drainForDispose()`, so a test that passes no controller reproduces the *defective* P7 order and fails. `resultPort` additionally records `lastAccumulatorCtx` (the `ctx` P6 handed `createResultAccumulator`) so the plan-order oracle is assertable without reaching into P5. Options used by the re-verification tests: **`realSealing: true`** wires P5's *real* `buildResultSet`/`sealResultSet`/`deriveRunOutcome` (over a fake residency) instead of the recording doubles — the only way a pre-resolution seal proves it produces a readable set (C2); `planningGaps: PlanningGap[]` scripts P3's wrapper; `derivedFromRunId`; `unbindKeys`; `admitSealedSet: 'throws-before' \| 'throws-after'` for the I8 recovery cases; `holdAt: 'sealResultSet'` with `release(step)` and `reached('sealing')` for the dispose-during-seal case (C3). The two P4 doubles are exposed so a test can assert what was *not* handed to them: `diagnosticAggregator.addUnitCalls` and `statisticsAccumulator.addCalls` (C4). |
| `test/clashtest/support/sealedSetFixture.mjs` | Create | `createSealedSetFixture({models, registrySessionId})` — a minimal sealed set over P5's pinned shape (`provenance.models[]` incl. `bindingGeneration`/`placementGeneration`/`scopeDigests`), for the read-time freshness suite. |
| `test/clashtest/run/settlement.test.mjs` | Create | Task P6.1 tests. |
| `test/clashtest/run/coordinator.test.mjs` | Create | Task P6.2 tests. |
| `test/clashtest/run/progress.test.mjs` | Create | Tasks P6.3, P6.5 progress tests. |
| `test/clashtest/run/lifecycle.test.mjs` | Create | Tasks P6.4, P6.8 tests. |
| `test/clashtest/run/scopeConsequences.test.mjs` | Create | Task P6.6 tests — **run-level consequences only** (drift/unverifiable → settlement → ledger → invalidation). The pure bracket cases moved to P3 with the functions (D1). |
| `test/clashtest/run/freshness.test.mjs` | Create | Task P6.7 tests. |

---

### Task P6.1: Settlement precedence tables (§16.7 A/B/C)

**Files**
- Create: `clashtest/run/settlement.js`
- Test: `test/clashtest/run/settlement.test.mjs`

**Interfaces**
- *Consumes:* nothing (pure module).
- *Produces:* `UNIT_PRECEDENCE`, `classifyUnitSettlement`, `resolveRunStatus`, `collectReasons`, `SettlementState`.

Facts are the closed set of §16.7: `world-disposed`, `internal-error`, `result-cap`, `input-changed`, `scope-drift`, `model-evicted`, `scope-unverifiable`, `capacity-exceeded`, `extraction-limit`, `object-tree-unavailable`, `stale-placement`, `unit-cap`, `target-too-large`.

- [ ] **Step 1: Write the failing precedence test.**

```js
// test/clashtest/run/settlement.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIT_PRECEDENCE, classifyUnitSettlement, resolveRunStatus, collectReasons,
} from '../../../clashtest/run/settlement.js';

const FACTS = UNIT_PRECEDENCE.map((r) => r.fact);
const REAL = FACTS.filter((f) => f !== null);              // U9's fact IS null; `Boolean` would also drop ''
const rowOf = (f) => UNIT_PRECEDENCE.find((r) => r.fact === f);

test('table A ranks are non-decreasing and the DISTINCT ranks are dense 1..9', () => {
  // Six facts share rank 8 (§16.7 table A row U8), so the ranks are NOT one-per-row.
  const ranks = UNIT_PRECEDENCE.map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'rows are in precedence order');
  assert.deepEqual([...new Set(ranks)], [1, 2, 3, 4, 5, 6, 7, 8, 9], 'U1..U9, no gaps');
  assert.equal(UNIT_PRECEDENCE.filter((r) => r.fact === null).length, 1, 'exactly one U9 row');
  assert.equal(new Set(REAL).size, REAL.length, 'no fact appears twice');
});

test('a single fact yields its own row and no secondary cause', () => {
  for (const row of UNIT_PRECEDENCE) {
    if (row.fact === null) continue;                       // U9 = "none of the above"
    const got = classifyUnitSettlement([row.fact], 'post');
    assert.equal(got.primaryFact, row.fact, `fact ${row.fact}`);
    assert.equal(got.cause, row.code);
    assert.deepEqual(got.secondaryCauses, []);
  }
});

test('no facts is U9 evaluated and is the only merging outcome', () => {
  const got = classifyUnitSettlement([], 'post');
  assert.deepEqual(
    { outcome: got.outcome, cause: got.cause, merges: got.merges },
    { outcome: 'evaluated', cause: null, merges: true },
  );
  for (const fact of REAL) {
    assert.equal(classifyUnitSettlement([fact], 'post').merges, false, fact);
  }
});

test('every PAIR resolves order-independently; EQUAL ranks break by ascending cause code', () => {
  for (const a of REAL) for (const b of REAL) {
    if (a === b) continue;
    const forward = classifyUnitSettlement([a, b], 'post');
    const backward = classifyUnitSettlement([b, a], 'post');
    assert.deepEqual(forward, backward, `${a} + ${b} must be order-independent`);
    const [ra, rb] = [rowOf(a), rowOf(b)];
    const expected = ra.rank !== rb.rank
      ? (ra.rank < rb.rank ? a : b)                        // lower rank wins
      : (ra.code < rb.code ? a : b);                       // same rank: lowest cause code wins
    assert.equal(forward.primaryFact, expected, `${a} + ${b}`);
    assert.deepEqual(forward.secondaryCauses, [rowOf(expected === a ? b : a).code]);
  }
});

test('two DIFFERENT U8 causes pick the same primary in both orders (the C3 case)', () => {
  for (const order of [['capacity-exceeded', 'stale-placement'], ['stale-placement', 'capacity-exceeded']]) {
    const got = classifyUnitSettlement(order, 'post');
    assert.equal(got.cause, 'capacity-exceeded', `order ${order.join('+')}`);
    assert.deepEqual(got.secondaryCauses, ['stale-placement']);
  }
});

test('the review triple: cancel + unload/re-register + WorldDisposedError + failed post-digest', () => {
  const got = classifyUnitSettlement(
    ['scope-unverifiable', 'model-evicted', 'world-disposed'], 'post',
  );
  assert.equal(got.cause, 'world-disposed');
  assert.equal(got.outcome, 'failed');
  assert.equal(got.merges, false);
  assert.deepEqual(got.secondaryCauses, ['model-evicted', 'scope-unverifiable']); // ascending
});

test('secondaryCauses is distinct, ascending, and capped at 8', () => {
  const got = classifyUnitSettlement([...REAL, ...REAL], 'post');
  assert.equal(got.cause, 'world-disposed');
  assert.equal(got.secondaryCauses.length, 8);             // 12 others, capped (C3 in the open items)
  assert.deepEqual(got.secondaryCauses, [...got.secondaryCauses].sort());
  assert.equal(new Set(got.secondaryCauses).size, 8);
});

test('phase decides failed vs skipped vs discarded for the phase-sensitive causes', () => {
  assert.equal(classifyUnitSettlement(['scope-drift'], 'pre').outcome, 'skipped');
  assert.equal(classifyUnitSettlement(['scope-drift'], 'post').outcome, 'discarded');
  assert.equal(classifyUnitSettlement(['model-evicted'], 'pre').outcome, 'skipped');
  assert.equal(classifyUnitSettlement(['model-evicted'], 'call').outcome, 'failed');
  assert.equal(classifyUnitSettlement(['target-too-large'], 'pre').outcome, 'not-run');
});

test('order B: failed > invalidated > cancelled > completed', () => {
  const base = {
    unitCauses: [], planningCause: null, planningGapCauses: [], placementChangedVsSnapshot: false,
    cancelRequested: null, disposeRequested: false, allLeafUnitsTerminal: false,
  };
  assert.equal(resolveRunStatus({ ...base, unitCauses: ['internal-error'], cancelRequested: { reason: 'x' } }), 'failed');
  assert.equal(resolveRunStatus({ ...base, planningCause: 'world-disposed', cancelRequested: { reason: 'x' } }), 'failed');
  assert.equal(resolveRunStatus({ ...base, planningCause: 'cancelled', cancelRequested: { reason: 'x' } }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, unitCauses: ['scope-drift'], cancelRequested: { reason: 'x' } }), 'invalidated');
  assert.equal(resolveRunStatus({ ...base, placementChangedVsSnapshot: true, cancelRequested: { reason: 'x' } }), 'invalidated');
  assert.equal(resolveRunStatus({ ...base, cancelRequested: { reason: 'x' } }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, disposeRequested: true }), 'cancelled');
  assert.equal(resolveRunStatus({ ...base, allLeafUnitsTerminal: true }), 'completed');
  assert.equal(resolveRunStatus(base), null);
});

test('reasons record a cancel even when a higher-precedence status won', () => {
  const reasons = collectReasons({
    unitCauses: ['scope-drift'], planningCause: null, planningGapCauses: [],
    placementChangedVsSnapshot: false,
    cancelRequested: { reason: 'user' }, disposeRequested: true, allLeafUnitsTerminal: false,
  });
  assert.ok(reasons.includes('cancel-requested'));
  assert.ok(reasons.includes('engine-disposed'));
  assert.ok(reasons.includes('unit:scope-drift'));
  assert.deepEqual(reasons, [...reasons].sort());
});

test('EVERY planning gap reaches reasons, not just the one that decided the status (Q2)', () => {
  // Re-verification question 2. The status is resolved from ONE cause (order B), but §6.6.2 gaps
  // are coverage facts: dropping the others would silently hide a gap from every consumer that
  // reads `RunOutcome.reasons` as the caveat list.
  const state = {
    unitCauses: [], planningCause: 'enumeration-failed',
    planningGapCauses: ['cancelled', 'enumeration-failed', 'enumeration-failed'],
    placementChangedVsSnapshot: false, cancelRequested: { reason: 'user' },
    disposeRequested: false, allLeafUnitsTerminal: false,
  };
  const reasons = collectReasons(state);
  assert.deepEqual(reasons,
    ['cancel-requested', 'planning:cancelled', 'planning:enumeration-failed'],
    'distinct, ascending, and the primary cause is not privileged',
  );
  assert.equal(resolveRunStatus(state), 'failed', 'the STATUS still comes from planningCause alone');
});

test('a run with no cause at all has NO reasons (I5)', () => {
  // U9 has `cause: null`; a clean completed run must seal `reasons: []`. Pushing a placeholder
  // like 'evaluated' into `unitCauses` would put `unit:evaluated` into every clean run's reasons,
  // change its serialized output, and read as a caveat to consumers.
  assert.deepEqual(collectReasons({
    unitCauses: [], planningCause: null, planningGapCauses: [],
    placementChangedVsSnapshot: false, cancelRequested: null,
    disposeRequested: false, allLeafUnitsTerminal: true,
  }), []);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/settlement.test.mjs` ⇒ `Cannot find module '.../clashtest/run/settlement.js'`.

- [ ] **Step 3: Write `clashtest/run/settlement.js`.**

```js
// clashtest/run/settlement.js
//
// Spec §16.7 — normative settlement precedence. Pure: no clock, no I/O, no state.
// Table A decides ONE attempt's primary cause; order B decides the run's status; matrix C's
// merge/discard column is `merges` (only U9 merges).

/** @typedef {'world-disposed'|'internal-error'|'result-cap'|'input-changed'|'scope-drift'
 *           |'model-evicted'|'scope-unverifiable'|'capacity-exceeded'|'extraction-limit'
 *           |'object-tree-unavailable'|'stale-placement'|'unit-cap'|'target-too-large'} Fact */

const F = (rank, fact, code, kindByPhase) => Object.freeze({ rank, fact, code, kindByPhase });

// `kindByPhase` maps WHERE the fact was observed to the §8.3 unit-outcome kind:
//   'pre'  = before the call was issued      'call' = thrown/returned by the attempt
//   'post' = after the call settled
export const UNIT_PRECEDENCE = Object.freeze([
  F(1, 'world-disposed',         'world-disposed',         { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(2, 'internal-error',         'internal-error',         { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(3, 'result-cap',             'result-cap',             { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(4, 'input-changed',          'input-changed',          { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(5, 'scope-drift',            'scope-drift',            { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(6, 'model-evicted',          'model-evicted',          { pre: 'skipped', call: 'failed',    post: 'failed' }),
  F(7, 'scope-unverifiable',     'scope-unverifiable',     { pre: 'skipped', call: 'discarded', post: 'discarded' }),
  F(8, 'capacity-exceeded',      'capacity-exceeded',      { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'extraction-limit',       'extraction-limit',       { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'object-tree-unavailable','object-tree-unavailable',{ pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'stale-placement',        'stale-placement',        { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'unit-cap',               'unit-cap',               { pre: 'failed',  call: 'failed',    post: 'failed' }),
  F(8, 'target-too-large',       'target-too-large',       { pre: 'not-run', call: 'not-run',   post: 'not-run' }),
  F(9, null,                     null,                     { pre: 'evaluated', call: 'evaluated', post: 'evaluated' }),
]);                                                       // already in precedence order; a re-sort would
                                                          // be UNSTABLE-safe but pointless, and would hide
                                                          // a mis-ordered row from the dense-rank test.

const ROW_BY_FACT = new Map(UNIT_PRECEDENCE.map((r) => [r.fact, r]));
const MAX_SECONDARY = 8;                                  // §16.7 table A closing paragraph

/** Facts that make the RUN fail (F) / invalidate it (I). §16.7 order B. */
const FAILING_UNIT_CAUSES = Object.freeze(['world-disposed', 'internal-error', 'result-cap']);
const INVALIDATING_UNIT_CAUSES = Object.freeze(['input-changed', 'scope-drift']);

/**
 * Table A + matrix C for ONE attempt. `facts` is the set collected from committed state; the
 * result is a pure function of the SET, never of the arrival order (§16.7 opening paragraph).
 *
 * WITHIN a rank — six facts share rank 8 — the tie-break is the **ascending cause code**
 * (controller ruling R4): the lowest code is the primary cause and every other observed fact goes
 * to `secondaryCauses`, also ascending. Without it, `['capacity-exceeded','stale-placement']` and
 * its reverse would pick different primaries, and two runs over identical facts would seal
 * different ledgers and different `ledgerDigest`s — exactly what AC-21 forbids.
 */
export function classifyUnitSettlement(facts, phase) {
  const seen = new Set();
  for (const f of facts) {
    if (f === null || !ROW_BY_FACT.has(f)) throw new TypeError(`unknown settlement fact: ${String(f)}`);
    seen.add(f);
  }
  let primary = ROW_BY_FACT.get(null);                    // U9
  for (const f of seen) {
    const row = ROW_BY_FACT.get(f);
    if (row.rank < primary.rank) { primary = row; continue; }
    // R4: same rank ⇒ lowest cause code wins. `primary.code === null` only for U9, whose rank is 9
    // and therefore never equal to a real row's rank, so no null comparison can be reached here.
    if (row.rank === primary.rank && row.code < primary.code) primary = row;
  }
  const secondaryCauses = [...seen]
    .filter((f) => f !== primary.fact)
    .map((f) => ROW_BY_FACT.get(f).code)
    .sort()
    .slice(0, MAX_SECONDARY);
  return Object.freeze({
    outcome: primary.kindByPhase[phase],
    cause: primary.code,
    primaryFact: primary.fact,
    secondaryCauses: Object.freeze(secondaryCauses),
    merges: primary.rank === 9,                           // matrix C: only U9 merges
  });
}

/** Order B. Returns null when the run continues. */
export function resolveRunStatus(state) {
  const failing = state.unitCauses.some((c) => FAILING_UNIT_CAUSES.includes(c))
    || (state.planningCause !== null && state.planningCause !== 'cancelled');
  if (failing) return 'failed';
  const invalidating = state.unitCauses.some((c) => INVALIDATING_UNIT_CAUSES.includes(c))
    || state.placementChangedVsSnapshot;
  if (invalidating) return 'invalidated';
  if (state.cancelRequested !== null || state.disposeRequested) return 'cancelled';
  if (state.planningCause === 'cancelled') return 'cancelled';
  if (state.allLeafUnitsTerminal) return 'completed';
  return null;
}

/**
 * Every observed fact, ascending — a `failed` run still records that a cancel was requested.
 *
 * Two rules the re-verification pinned:
 *  - **I5:** `unitCauses` only ever holds a REAL cause. U9 (`evaluated`) has `cause: null` and the
 *    writer (`applyUnitResult`) skips it, so a clean run seals `reasons: []` rather than
 *    `['unit:evaluated']`. Nothing is defended here, because nothing null can arrive here.
 *  - **Q2:** every §6.6.2 planning gap contributes, not only the one order B resolved the status
 *    from. `planningCause` decides the STATUS; `planningGapCauses` decides the REASONS. The `Set`
 *    makes a repeated cause idempotent and the sort makes the list order-independent, so a run that
 *    reported the same gap twice still seals one digest-stable entry.
 */
export function collectReasons(state) {
  const out = new Set();
  for (const c of state.unitCauses) out.add(`unit:${c}`);
  if (state.planningCause !== null) out.add(`planning:${state.planningCause}`);
  for (const c of state.planningGapCauses) out.add(`planning:${c}`);
  if (state.placementChangedVsSnapshot) out.add('placement-changed');
  if (state.cancelRequested !== null) out.add('cancel-requested');
  if (state.disposeRequested) out.add('engine-disposed');
  return Object.freeze([...out].sort());
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/run/settlement.test.mjs` ⇒ all tests pass.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P6.1 settlement precedence tables`.

---

### Task P6.2: World-scoped coordinator, shared registry and FIFO queue (§7.3, §4.3)

**Files**
- Create: `clashtest/run/coordinator.js`
- Test: `test/clashtest/run/coordinator.test.mjs`

**Interfaces**
- *Consumes:* A3 (`ModelBindingError`/`EngineDisposedError`, **one object argument**, `.reason`), A5 (`createModelRegistry({ world })` — the default, overridable via `createRegistry` so this test needs no P1), A14 (nothing at run-admission time: `reserveRunSlot` is P7's, R6).
- *Produces:* `COORDINATOR_PROTOCOL_VERSION`, `COORDINATOR_SLOT`, `getWorldCoordinator`, `Coordinator`, `QueueTicket`.
- *Explicitly NOT produced (R6):* any `maxQueuedRuns` check and any `RunQueueFullError`. See open item O5.

- [ ] **Step 1: Write the failing coordinator test.**

```js
// test/clashtest/run/coordinator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COORDINATOR_PROTOCOL_VERSION, COORDINATOR_SLOT, getWorldCoordinator,
} from '../../../clashtest/run/coordinator.js';

const fakeWorld = () => ({ tag: 'world' });
// A5: the factory's argument is `{ world }` and `world` is REQUIRED — the double asserts it.
const createRegistry = ({ world }) => {
  assert.ok(world !== undefined, 'createRegistry must receive the world');
  return { world, registrySessionId: `s${Math.random()}` };
};

test('two engines over one world get the SAME coordinator and the SAME registry', () => {
  const world = fakeWorld();
  const a = getWorldCoordinator(world, { createRegistry });
  const b = getWorldCoordinator(world, { createRegistry });
  assert.equal(a, b);
  assert.equal(a.registry, b.registry);
  assert.equal(a.registry.world, world, 'the registry was built FOR this world (A5)');
  assert.notEqual(getWorldCoordinator(fakeWorld(), { createRegistry }), a);
});

test('the coordinator map lives on globalThis under the documented symbol', () => {
  const world = fakeWorld();
  getWorldCoordinator(world, { createRegistry });
  assert.equal(COORDINATOR_SLOT, Symbol.for('clashtest.coordinators'));
  assert.ok(globalThis[COORDINATOR_SLOT] instanceof WeakMap);
  assert.ok(globalThis[COORDINATOR_SLOT].has(world));
});

test('an incompatible protocol version throws instead of running beside it', () => {
  const world = fakeWorld();
  getWorldCoordinator(world, { createRegistry });
  assert.throws(
    () => getWorldCoordinator(world, { createRegistry, protocolVersion: COORDINATOR_PROTOCOL_VERSION + 1 }),
    // A3/N1: ONE object argument, and the field is `.reason` — `.code` reads undefined.
    (e) => e.name === 'ModelBindingError' && e.reason === 'coordinator-version-mismatch',
  );
});

test('two engines over one world SERIALIZE: exactly one job is in flight, FIFO', async () => {
  const world = fakeWorld();
  const engineA = getWorldCoordinator(world, { createRegistry });
  const engineB = getWorldCoordinator(world, { createRegistry });
  const log = [];
  let concurrent = 0;
  let peak = 0;
  const job = (id, release) => async () => {
    concurrent += 1; peak = Math.max(peak, concurrent);
    log.push(`start:${id}`);
    await release;
    log.push(`end:${id}`);
    concurrent -= 1;
  };
  let releaseA; const gateA = new Promise((r) => { releaseA = r; });
  let releaseB; const gateB = new Promise((r) => { releaseB = r; });

  const t1 = engineA.enqueue({ runId: 'r1', engineId: 'A', run: job('r1', gateA) });
  const t2 = engineB.enqueue({ runId: 'r2', engineId: 'B', run: job('r2', gateB) });

  await t1.started;
  assert.equal(engineA.inFlightRunId(), 'r1');
  assert.deepEqual(log, ['start:r1']);
  releaseA();
  await t2.started;
  assert.deepEqual(log, ['start:r1', 'end:r1', 'start:r2']);
  releaseB();
  await t2.finished;
  assert.equal(peak, 1, 'never two jobs in flight over one world');
  assert.equal(engineA.inFlightRunId(), null);
});

test('a queued job can withdraw before it starts, and never after', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const t1 = c.enqueue({ runId: 'r1', engineId: 'A', run: async () => { await gate; } });
  const t2 = c.enqueue({ runId: 'r2', engineId: 'A', run: async () => {} });
  await t1.started;
  assert.equal(t2.withdraw(), true);
  assert.equal(c.queueDepth('A'), 0);
  assert.equal(t2.withdraw(), false, 'withdrawing twice wins once — the R5 single-winner hinge');
  assert.equal(t1.withdraw(), false, 'a started job cannot withdraw');
  await t2.finished;                                      // a withdrawn ticket settles, never hangs
  release();
  await t1.finished;
});

test('cancelQueued reports whether IT withdrew the job (R5 hinge)', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const head = c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  const waiting = c.enqueue({ runId: 'w', engineId: 'A', run: async () => 'ran' });
  await head.started;
  assert.equal(c.cancelQueued('w'), true, 'a still-queued job is withdrawn');
  assert.equal(c.cancelQueued('w'), false, 'it is gone now');
  assert.equal(c.cancelQueued('h'), false, 'the in-flight job is never withdrawn');
  assert.equal(c.cancelQueued('nope'), false, 'an unknown id is false, never a throw');
  release();
  await head.finished;
  assert.equal(c.queueDepth('A'), 0);
});

test('the coordinator enforces NO queue limit of its own (R6)', async () => {
  // maxQueuedRuns is a per-ENGINE option checked in P7's synchronous admission prefix, before
  // enqueue is ever reached. The coordinator must not second-guess it, or two engines sharing one
  // world would apply one engine's limit to the other's runs.
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  for (let i = 0; i < 50; i += 1) {
    assert.doesNotThrow(() => c.enqueue({ runId: `q${i}`, engineId: 'A', run: async () => {} }));
  }
  assert.equal(c.queueDepth('A'), 50, 'depth counts runs WAITING, not the in-flight one');
  assert.equal(typeof c.enqueue, 'function');
  assert.equal('maxQueuedRuns' in c, false, 'the coordinator holds no per-engine limit');
  release();
});

test('queueDepth is per engine; stopAdmitting refuses only that engine', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  let release; const gate = new Promise((r) => { release = r; });
  const head = c.enqueue({ runId: 'h', engineId: 'A', run: async () => { await gate; } });
  await head.started;
  c.enqueue({ runId: 'a1', engineId: 'A', run: async () => {} });
  c.enqueue({ runId: 'b1', engineId: 'B', run: async () => {} });
  assert.equal(c.queueDepth('A'), 1);
  assert.equal(c.queueDepth('B'), 1);
  c.stopAdmitting('A');
  assert.throws(() => c.enqueue({ runId: 'a2', engineId: 'A', run: async () => {} }),
    (e) => e.name === 'EngineDisposedError');
  assert.doesNotThrow(() => c.enqueue({ runId: 'b2', engineId: 'B', run: async () => {} }));
  release();
});

test('a job that throws does not wedge the queue', async () => {
  const world = fakeWorld();
  const c = getWorldCoordinator(world, { createRegistry });
  const t1 = c.enqueue({ runId: 'boom', engineId: 'A', run: async () => { throw new Error('boom'); } });
  const t2 = c.enqueue({ runId: 'ok', engineId: 'A', run: async () => 'fine' });
  await assert.rejects(t1.finished, /boom/);
  await t2.started;
  assert.equal(await t2.finished, 'fine');
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/coordinator.test.mjs` ⇒ module not found.

- [ ] **Step 3: Write `clashtest/run/coordinator.js`.**

```js
// clashtest/run/coordinator.js
//
// Spec §7.3 / §4.3 — ONE coordinator per CollisionWorld, discovered through a globalThis symbol so
// duplicate bundles or module copies in one page join the same coordinator. The coordinator owns the
// world's sole ModelRegistry, its FIFO run queue and its single in-flight slot.

import { ModelBindingError, EngineDisposedError } from '../errors.js';
import { createModelRegistry } from '../identity/ModelRegistry.js';   // A5 (N11)

export const COORDINATOR_PROTOCOL_VERSION = 1;
export const COORDINATOR_SLOT = Symbol.for('clashtest.coordinators');

function coordinatorMap() {
  let map = globalThis[COORDINATOR_SLOT];
  if (map instanceof WeakMap) return map;
  map = new WeakMap();
  Object.defineProperty(globalThis, COORDINATOR_SLOT, {
    value: map, writable: false, enumerable: false, configurable: false,
  });
  return map;
}

function createCoordinator(world, { protocolVersion, registry }) {
  /** @type {Array<{runId, engineId, run, ticket, resolveStart, resolveFinish, rejectFinish}>} */
  const queue = [];
  const stopped = new Set();
  let inFlight = null;                                    // the single in-flight slot
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        inFlight = job;
        job.started = true;
        job.resolveStart();
        try {
          const value = await job.run();
          job.resolveFinish(value);
        } catch (err) {
          job.rejectFinish(err);                          // a failing job never wedges the queue
        } finally {
          inFlight = null;
        }
      }
    } finally {
      draining = false;
    }
  }

  return Object.freeze({
    world,
    protocolVersion,
    registry,
    // Synchronous and limit-free (R6): `maxQueuedRuns` belongs to ONE engine, and P7's admission
    // prefix has already checked it (and rolled back its residency reservation if it failed)
    // before this is reached.
    enqueue({ runId, engineId, run }) {
      if (stopped.has(engineId)) {
        throw new EngineDisposedError({                   // A3/N1: one object argument
          message: `engine ${engineId} is disposing; no further runs are admitted`,
        });
      }
      let resolveStart; let resolveFinish; let rejectFinish;
      const started = new Promise((r) => { resolveStart = r; });
      const finished = new Promise((res, rej) => { resolveFinish = res; rejectFinish = rej; });
      const job = { runId, engineId, run, started: false, resolveStart, resolveFinish, rejectFinish };
      const ticket = Object.freeze({
        runId,
        started,
        finished,
        withdraw() {
          if (job.started) return false;
          const i = queue.indexOf(job);
          if (i < 0) return false;
          queue.splice(i, 1);
          job.resolveFinish(undefined);
          return true;
        },
      });
      job.ticket = ticket;
      queue.push(job);
      // Start draining on a microtask so `enqueue` itself is synchronous and side-effect ordered.
      Promise.resolve().then(drain);
      return ticket;
    },
    // Returns TRUE iff this call is the one that withdrew the job. The run's own cancel path
    // branches on that boolean (R5): the winner owes the queued run a pre-resolution cancelled
    // seal, because a withdrawn job's `run` function is never invoked.
    cancelQueued(runId) {
      const job = queue.find((j) => j.runId === runId);
      return job === undefined ? false : job.ticket.withdraw();
    },
    stopAdmitting(engineId) { stopped.add(engineId); },
    // Depth is runs WAITING; the in-flight job has already left the array (R6).
    queueDepth(engineId) {
      return engineId === undefined ? queue.length : queue.filter((j) => j.engineId === engineId).length;
    },
    inFlightRunId() { return inFlight === null ? null : inFlight.runId; },
  });
}

/**
 * Join (or create) the coordinator for `world`. A coordinator built by an incompatible engine copy
 * is refused rather than run beside (§7.3).
 */
export function getWorldCoordinator(world, {
  protocolVersion = COORDINATOR_PROTOCOL_VERSION,
  createRegistry = createModelRegistry,                   // A5: P1's factory is the default
} = {}) {
  const map = coordinatorMap();
  let coordinator = map.get(world);
  if (coordinator === undefined) {
    if (typeof createRegistry !== 'function') {
      throw new ModelBindingError({                       // A3/N1: ONE object argument, `.reason`
        reason: 'registry-factory-required', modelKey: null,
        message: 'createRegistry is required to build a coordinator',
      });
    }
    // A5: `world` is REQUIRED and there is no `now` option. One registry per world (§4.3).
    coordinator = createCoordinator(world, { protocolVersion, registry: createRegistry({ world }) });
    map.set(world, coordinator);
  }
  if (coordinator.protocolVersion !== protocolVersion) {
    throw new ModelBindingError({
      reason: 'coordinator-version-mismatch', modelKey: null,
      message: `this world already has a clashtest coordinator at protocol ${coordinator.protocolVersion}`,
    });
  }
  return coordinator;
}
```

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/run/coordinator.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P6.2 world-scoped run coordinator`.

---

### Task P6.3: `RunHandle`, state machine, event emission and the progress snapshot (§8.1–§8.2, §9)

**Files**
- Create: `clashtest/run/emitter.js`, `clashtest/run/Run.js` (states, handle, snapshot; the planning and unit loop arrive in P6.4/P6.5)
- Test: `test/clashtest/run/progress.test.mjs`

**Interfaces**
- *Consumes:* A1 (`resolveRunOptions` for `progressMinIntervalMs`), P0's fake clock from `test/clashtest/support/`.
- *Produces:* `createEmitter`, `createRun`, `RUN_STATES`, `RUN_PHASES`, `isTerminalStatus`, `RunHandle.getSnapshot/subscribe`.

- [ ] **Step 1: Write the failing emitter/snapshot test.**

```js
// test/clashtest/run/progress.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../../../clashtest/run/emitter.js';
import { createFakeClock } from '../support/index.mjs';            // P0 (A18)

test('progress events are throttled; state, unit and persistence events never are', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 100 });
  const seen = [];
  e.subscribe((ev) => seen.push(`${ev.type}@${clock.now()}`));

  e.emit('progress', { seq: 1 });                    // t=0   -> delivered (first is never throttled)
  clock.advance(40);
  e.emit('progress', { seq: 2 });                    // t=40  -> suppressed
  e.emit('state', { seq: 3, status: 'running' });    // t=40  -> delivered
  e.emit('unit', { seq: 4 });                        // t=40  -> delivered
  clock.advance(61);
  e.emit('progress', { seq: 5 });                    // t=101 -> delivered
  assert.deepEqual(seen, ['progress@0', 'state@40', 'unit@40', 'progress@101']);
});

test('a listener that throws is isolated, counted, and cannot stop other listeners (16.6)', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  e.subscribe(() => { throw new Error('bad subscriber'); });
  e.subscribe((ev) => seen.push(ev.type));
  assert.doesNotThrow(() => e.emit('state', { seq: 1 }));
  assert.doesNotThrow(() => e.emit('state', { seq: 2 }));
  assert.deepEqual(seen, ['state', 'state']);
  assert.equal(e.listenerErrors, 2);
});

test('a listener that unsubscribes (or subscribes) during delivery does not corrupt the pass', () => {
  const clock = createFakeClock();
  const e = createEmitter({ now: clock.now, progressMinIntervalMs: 0 });
  const seen = [];
  const off = e.subscribe(() => { off(); e.subscribe(() => seen.push('late')); });
  e.subscribe(() => seen.push('stable'));
  e.emit('state', { seq: 1 });
  e.emit('state', { seq: 2 });
  assert.deepEqual(seen, ['stable', 'stable', 'late']);   // the late one joins from the NEXT emit
  assert.equal(e.listenerErrors, 0);
});

test('unsubscribe is idempotent and removes exactly one listener', () => {
  const e = createEmitter({ now: () => 0, progressMinIntervalMs: 0 });
  let n = 0;
  const off = e.subscribe(() => { n += 1; });
  e.subscribe(() => { n += 1; });
  off(); off();
  e.emit('state', { seq: 1 });
  assert.equal(n, 1);
  assert.equal(e.listenerCount, 1);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/progress.test.mjs` ⇒ module not found.

- [ ] **Step 3: Write `clashtest/run/emitter.js`.**

```js
// clashtest/run/emitter.js
//
// Spec §9.2 rules 4-5 and §16.6. Delivery is isolated: a subscriber exception is caught and counted
// and never reaches the run; the subscriber list is COPIED before a pass so subscribing or
// unsubscribing during delivery cannot corrupt it.

const NEVER_THROTTLED = new Set(['state', 'unit', 'persistence']);

export function createEmitter({ now, progressMinIntervalMs }) {
  const listeners = new Set();
  let listenerErrors = 0;
  let lastProgressAt = null;

  return {
    get listenerErrors() { return listenerErrors; },
    get listenerCount() { return listeners.size; },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const box = { listener };                          // boxed so identical functions unsubscribe 1:1
      listeners.add(box);
      return () => { listeners.delete(box); };
    },
    emit(type, payload) {
      if (!NEVER_THROTTLED.has(type)) {
        const t = now();
        if (lastProgressAt !== null && t - lastProgressAt < progressMinIntervalMs) return false;
        lastProgressAt = t;
      }
      const event = Object.freeze({ type, ...payload });
      for (const box of [...listeners]) {                 // copy: safe against mutation mid-pass
        if (!listeners.has(box)) continue;                // unsubscribed during THIS pass
        try { box.listener(event); } catch { listenerErrors += 1; }
      }
      return true;
    },
  };
}
```

- [ ] **Step 4: Add the state machine and snapshot to `clashtest/run/Run.js`.**

```js
// clashtest/run/Run.js  (first slice: states, handle, snapshot; the loop lands in P6.4/P6.5)
import { createEmitter } from './emitter.js';

export const RUN_STATES = Object.freeze(
  ['queued', 'planning', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'invalidated'],
);
export const RUN_PHASES = Object.freeze(
  ['queued', 'binding', 'enumerating', 'planning', 'executing', 'finalizing', 'terminal'],
);
const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'invalidated']);

export const isTerminalStatus = (status) => TERMINAL.has(status);

/**
 * `committed` is the ONLY state a snapshot is built from (§9.2 rule 4: "never torn, built at unit
 * boundaries and state changes from committed state only"). Mutating counters live in `pending` and
 * are copied into `committed` by `commit()`, which is the single place `seq` advances.
 */
function createProgressState(runId) {
  const zero = {
    runId, status: 'queued', phase: 'queued', seq: 0,
    unitsTotal: 0, unitsEvaluated: 0, unitsFailedOrSkipped: 0,
    pairSpaceTotal: 0, pairSpaceEvaluated: 0, pairSpaceProcessed: 0,
    resultsFound: 0, caveatCount: 0, caveatUnclassified: 0,
    currentUnitId: null, startedAtMs: 0,
  };
  return { pending: { ...zero }, committed: null };
}

function snapshotOf(committed, now) {
  const total = committed.pairSpaceTotal;
  const frac = (n) => (total === 0 ? null : n / total);
  return Object.freeze({
    runId: committed.runId,
    status: committed.status,
    phase: committed.phase,
    seq: committed.seq,
    unitsTotal: committed.unitsTotal,
    unitsEvaluated: committed.unitsEvaluated,
    unitsFailedOrSkipped: committed.unitsFailedOrSkipped,
    pairSpaceTotal: total,
    pairSpaceEvaluated: committed.pairSpaceEvaluated,
    pairSpaceProcessed: committed.pairSpaceProcessed,
    fractionEvaluated: frac(committed.pairSpaceEvaluated),
    fractionProcessed: frac(committed.pairSpaceProcessed),
    resultsFound: committed.resultsFound,
    caveatCount: committed.caveatCount,
    caveatUnclassified: committed.caveatUnclassified,
    currentUnitId: committed.currentUnitId,
    elapsedMs: now() - committed.startedAtMs,             // NOT part of any digest
  });
}
```

**What `createRun` establishes before anything can be cancelled.** Three of the re-verification's
findings are all one fact: *a run can reach a seal before it has a plan*, so everything the seal
reads must exist from the first synchronous instant of the run's life, not from plan completion.

```js
// clashtest/run/Run.js  (P6.3 slice, continued)

/**
 * C2 — the plan-independent results holder.
 *
 * `run.results` is read by `resultParts` and by `sealAs`, both of which run on the
 * **pre-resolution** paths (a cancel while `resolveDefinition` is pending, a lookup failure, a
 * `model-not-bound` planning gap) — i.e. long before `planStage` can build P5's accumulator, which
 * needs `unitPlanRank` and therefore needs a plan (A12). Leaving the field `undefined` until then
 * makes `run.results.toArray()` throw inside the seal, which the fallback cannot recover from
 * because the fallback calls `resultParts` too: the required pre-resolution set (§13.1) would come
 * out `null`.
 *
 * So the run starts with a REAL, inert holder implementing the same three-method surface. It is
 * frozen and shared: it owns no state, so one instance serves every run.
 */
const EMPTY_RESULTS = Object.freeze({
  addUnit() { return Object.freeze({ accepted: false, reason: 'no-plan' }); },
  size() { return 0; },
  toArray() { return []; },
});

/**
 * I7 — `derivedFromRunId` is part of the authoritative `RunSpec`, so it is validated where every
 * other structural expectation of the spec is: synchronously, in `createRun`, before the run can
 * be queued. A bad value is an engine bug (P7 built the spec), never user data, so it is a
 * `TypeError` and not a §18 error class.
 */
function normalizeDerivedFromRunId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('RunSpec.derivedFromRunId must be a non-empty string or null');
  }
  return value;
}

export function createRun(spec) {
  const run = {
    spec, runId: spec.runId,
    derivedFromRunId: normalizeDerivedFromRunId(spec.derivedFromRunId),
    results: EMPTY_RESULTS,                                // C2: replaced at plan completion
    unitOrder: createUnitOrder(),                          // I6: the rank oracle, empty until planning
    settlementState: {
      unitCauses: [], planningCause: null, planningGapCauses: [],
      placementChangedVsSnapshot: false, cancelRequested: null,
      disposeRequested: false, allLeafUnitsTerminal: false,
    },
    // … emitter, progress state, promises, flags (sealStarted / sealed / reservationSettled /
    //     forceFinalize / disposeRequestedDuringSeal)
  };
  // C3: the public handle carries EXACTLY the §18 members. Disposal control is a separate object
  // handed to the engine, so `getRun(id)` — which returns the handle — cannot leak it to a caller.
  const handle = Object.freeze({
    runId: run.runId,
    getSnapshot: () => snapshotOf(run.progress.committed, run.spec.now),
    subscribe: (listener) => run.emitter.subscribe(listener),
    cancel: (reason) => requestCancel(run, reason),
    done: run.donePromise,
    persisted: run.persistedPromise,
  });
  const controller = Object.freeze({ requestDispose: () => requestDispose(run) });
  return Object.freeze({ handle, controller, begin: () => beginRun(run) });
}
```

- [ ] **Step 5: Add the snapshot/monotonicity tests to `test/clashtest/run/progress.test.mjs`.**

```js
import { createRun } from '../../../clashtest/run/Run.js';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';
import { createRunFixture } from '../support/runFixture.mjs';   // wires clock + fakes into createRun

test('a snapshot is never torn: seq only advances at a commit, and repeated reads are identical', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 10 }]) });
  const { handle } = createRun(fx.spec);
  const a = handle.getSnapshot();
  const b = handle.getSnapshot();
  assert.deepEqual(a, b);
  assert.equal(a.seq, b.seq);
  assert.equal(a.status, 'queued');
  assert.equal(a.phase, 'queued');
  assert.equal(a.fractionProcessed, null, 'null while pairSpaceTotal is 0');
});
```

- [ ] **Step 6: Run both files and watch them pass.** `node --test test/clashtest/run/progress.test.mjs`.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs: P6.3 run handle, emitter and progress snapshot`.

---

### Task P6.4: Resolution, planning, run-start leases, and the pre-resolution cancel seal (§8.2, §10.2, §13.1, §7.4)

**Files**
- Modify: `clashtest/run/Run.js`
- Create: `test/clashtest/run/lifecycle.test.mjs`
- Create: `test/clashtest/support/fakePlanner.mjs`, `test/clashtest/support/runFixture.mjs`

**Interfaces**
- *Consumes:* A1 (`resolveRunOptions(input, limits)`), A2 (`createSlicer`, yield point `tick`), A4 (`snapshotBindings`; `Binding` has **no `dead` flag** — `null` covers dead, unregistered *and* lease-invalid), A6 (`planRun` → `PlanResult`, with P6's own `ledger` passed in), A12 (`createResultAccumulator`, `buildResultSet`), A13 (`sealResultSet`, `deriveRunOutcome`), A14 (`residency.admitSealedSet` / `releaseRunSlot` — **never** `reserveRunSlot`, which is P7's), A17 (`createRecordBudget`, `createLedger`).
- *Produces:* the `queued → planning → running` path, the planning-gap → `failed`/`cancelled` mapping, the pre-resolution seal shape, the **queued-withdrawal** seal path (R5) and the adoption of P3's preplanned gaps into progress (R11).

The stage order inside `queued`, from §13.1 and §8.2, is fixed: **(1) resolve** (stored-reference lookup + migration + `validateTest`, or the captured direct definition) — **raced against cancellation** (R5), **(2) normalize + `semanticDigest`**, **(3) snapshot bindings** at the `queued → planning` transition, **(4) record `provenance.admissionBaseline` at that same instant** — §13.2 defines it as the per-epoch bucket size "at the moment leases are taken", **(5) enumerate + plan**. A cancel observed before step 2 completes seals in the pre-resolution representation; after it, the resolved definition is embedded.

**Run-start leases come from P1, not from a second admission loop (R7, review I2).** `snapshotBindings` returns **frozen** `Binding`s that *already* carry a valid, cached lease: P1's `bindingFor`/`snapshotBindings` call `world.admitModel` lazily on first read, cache the lease, and re-check `world.isLeaseValid` on every read, returning `null` when the world no longer honors it (P1 design decisions 2 and 6). P6 therefore **takes the snapshot and keeps it**: it never calls `world.admitModel`, never writes `binding.lease` (the binding is frozen — in an ES module that assignment *throws*), and never invents a replacement record with `lease: null`. A `null` entry in the snapshot is the run-start `model-not-bound` planning gap. The **per-unit** lease re-check is P4's executor (D2); P6 owns only this run-start snapshot and the run-level `model-evicted` settlement fact.

- [ ] **Step 1: Write the failing lifecycle test.**

```js
// test/clashtest/run/lifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';

test('cancel BEFORE resolution seals the pre-resolution representation', async () => {
  // The definition lookup NEVER settles. The cancel must still bound `cancel()` and `done`
  // (review C2): resolution is RACED against cancellation and the loser is abandoned (R5).
  const fx = createRunFixture({
    resolveDefinition: () => new Promise(() => {}),        // never settles
    plan: createFakePlan([]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');             // must not hang
  assert.equal(summary.status, 'cancelled');
  const set = summary.resultSet;
  assert.equal(set.definition, null);
  assert.deepEqual(set.testRef, { testId: fx.testId, revision: null, semanticDigest: null });
  assert.equal(set.ledger.units.length, 0);
  assert.equal(set.results.length, 0);
  assert.equal(set.outcome.coverage, 'partial');
  assert.ok(set.outcome.reasons.includes('planning:cancelled'));
  assert.deepEqual(handle.getSnapshot().unitsTotal, 0);
  assert.equal(handle.getSnapshot().pairSpaceTotal, 0);
  assert.equal(structuredClone(set).runId, set.runId, 'the set is structured-clone safe');
  assert.equal(fx.residency.admitted.includes(handle.runId), true,
    'the reserved slot became an ordinary resident set, never leaked (§13.1)');
});

test('a definition that resolves AFTER the cancel won is abandoned, and changes nothing', async () => {
  let settleLookup;
  const fx = createRunFixture({
    resolveDefinition: () => new Promise((r) => { settleLookup = r; }),
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');
  settleLookup({ definition: fx.definition, testRef: fx.testRef });   // the loser arrives late
  await Promise.resolve();
  assert.equal(summary.resultSet.definition, null, 'the late winner is discarded, not embedded');
  assert.equal(await handle.done, summary, 'done still settles exactly once');
  assert.deepEqual(fx.executor.startedUnits, [], 'planning and execution never began');
});

test('a definition lookup that REJECTS after the cancel won does not reject done', async () => {
  let failLookup;
  const fx = createRunFixture({
    resolveDefinition: () => new Promise((_, reject) => { failLookup = reject; }),
    plan: createFakePlan([]),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.cancel('user');
  failLookup(new Error('store exploded'));                 // abandoned, and HANDLED
  await Promise.resolve();
  assert.equal(summary.status, 'cancelled');
  assert.equal(await handle.done, summary);
});

test('cancel while QUEUED behind another run still seals and still releases the slot (R5)', async () => {
  // The withdrawn job's `run` function is never invoked, so nothing inside the loop can seal it.
  // The withdrawal winner owes it the pre-resolution cancelled seal.
  const shared = createRunFixture.sharedWorld();
  const head = createRunFixture({ shared, plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }] }) });
  const waiting = createRunFixture({ shared, plan: createFakePlan([{ unitId: '1.0', weight: 1 }]) });

  const a = createRun(head.spec); a.begin();
  await head.executor.inFlight('1.0');
  const b = createRun(waiting.spec); b.begin();
  assert.equal(shared.coordinator.queueDepth(waiting.engineId), 1, 'b is WAITING, not in flight');

  const summary = await b.handle.cancel('user');           // must not hang
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.definition, null, 'pre-resolution representation');
  assert.equal(summary.resultSet.ledger.units.length, 0);
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:cancelled'));
  assert.equal(shared.coordinator.queueDepth(waiting.engineId), 0, 'withdrawn from the queue');
  assert.deepEqual(waiting.executor.startedUnits, [], 'a withdrawn run never executes');
  assert.equal(waiting.residency.admitted.includes(b.handle.runId), true, 'slot converted, not leaked');
  assert.equal(waiting.residency.released.includes(b.handle.runId), false, 'and not double-freed');

  head.executor.release('1.0');
  assert.equal((await a.handle.done).status, 'completed', 'the head run is unaffected');
});

test('a cancel that LOSES the withdrawal race is handled by the boundary, not sealed twice', async () => {
  // withdraw() returns false once the job has started; the run then reaches its own first
  // boundary and settles there. Exactly one of the two paths seals.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    cancelAt: 'job-started',                               // fires after withdraw() can succeed
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'cancelled');
  assert.equal(fx.residency.admitted.filter((id) => id === handle.runId).length, 1, 'sealed once');
});

test('cancel AFTER resolution but during enumeration embeds the resolved definition', async () => {
  const fx = createRunFixture({ stallAt: 'enumerating', plan: createFakePlan([{ unitId: '1.0', weight: 5 }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.reached('enumerating');
  const summary = await handle.cancel('user');
  assert.equal(summary.status, 'cancelled');
  assert.notEqual(summary.resultSet.definition, null);
  assert.equal(summary.resultSet.testRef.semanticDigest, fx.semanticDigest);
  assert.equal(summary.resultSet.ledger.units.length, 0, 'planning is abandoned; no unit ledger');
});

test('a planning gap other than `cancelled` fails the run, and beats a coincident cancel', async () => {
  for (const cause of ['model-not-bound', 'enumeration-failed', 'plan-too-large', 'world-disposed']) {
    const fx = createRunFixture({ planningGap: cause, plan: null });
    const { handle, begin } = createRun(fx.spec);
    begin();
    handle.cancel('user');                                  // same slice
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', cause);
    assert.equal(summary.resultSet.outcome.coverage, 'partial');
    assert.equal(summary.resultSet.ledger.units.length, 0);
    assert.ok(summary.resultSet.outcome.reasons.includes(`planning:${cause}`));
    assert.ok(summary.resultSet.outcome.reasons.includes('cancel-requested'));
  }
});

test('the run-start leases are P1\'s snapshot leases; P6 admits nothing and mutates nothing (R7)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(fx.world.calls.admitModel, 0,
    'P6 runs NO second admitModel loop — the registry admitted lazily inside snapshotBindings');
  assert.deepEqual(fx.registry.admittedKeys.sort(), ['mk-a', 'mk-b'],
    'the registry took exactly one lease per touched model');
  for (const binding of fx.registry.lastSnapshot.bindings) {
    assert.equal(Object.isFrozen(binding), true, 'P1 hands back FROZEN bindings');
    assert.notEqual(binding.lease, null, 'each carries its valid cached lease');
  }
});

test('a frozen binding is never written to: the run keeps P1\'s objects as-is', async () => {
  'use strict';
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const [binding] = fx.registry.lastSnapshot.bindings;
  assert.equal(fx.registry.mutationAttempts, 0, 'no write was attempted on a frozen binding');
  assert.throws(() => { binding.lease = null; }, TypeError,
    'proof the object would have thrown had the old second-admission loop survived');
});

test('a null in the run-start snapshot is the model-not-bound planning gap (no `dead` flag)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'gone'] }]) });
  fx.registry.unregisterKey('gone');                       // dead, unregistered and lease-invalid all read as null
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.ok(summary.resultSet.outcome.reasons.includes('planning:model-not-bound'));
  assert.equal(summary.resultSet.ledger.units.length, 0);
});

test('C2: every PRE-RESOLUTION seal produces a real, non-null Result Set', async () => {
  // Re-verification C2. These three runs seal before `createResultAccumulator` could ever have been
  // called, and they go through the REAL sealing sketch (`sealAs` -> `resultParts` ->
  // `buildResultSet` -> `sealResultSet` -> `admitSealedSet`) with P5's real assembly, not a stub.
  // With `run.results` left `undefined` until plan completion, `resultParts` throws, the R10
  // fallback calls `resultParts` again and throws again, and `RunSummary.resultSet` is `null` —
  // exactly the §13.1 guarantee ("a valid, empty, pre-resolution set") that is being tested here.
  const cases = [
    ['cancel during resolution', { resolveDefinition: () => new Promise(() => {}) },
      { cancel: true }, 'cancelled', 'planning:cancelled'],
    ['definition lookup failure', { resolveDefinition: () => Promise.reject(new Error('store exploded')) },
      {}, 'failed', 'planning:enumeration-failed'],
    ['model-not-bound', { unbindKeys: ['gone'], models: ['mk-a', 'gone'] },
      {}, 'failed', 'planning:model-not-bound'],
  ];
  for (const [label, opts, how, status, reason] of cases) {
    const fx = createRunFixture({ plan: createFakePlan([]), realSealing: true, ...opts });
    const { handle, begin } = createRun(fx.spec);
    begin();
    if (how.cancel) await handle.cancel('user');           // must not hang
    const settled = await handle.done;
    assert.notEqual(settled.resultSet, null, `${label}: a pre-resolution set is REQUIRED (§13.1)`);
    assert.equal(settled.status, status, label);
    assert.deepEqual(settled.resultSet.results, [], `${label}: empty, not absent`);
    assert.equal(settled.resultSet.ledger.units.length, 0, label);
    assert.equal(settled.resultSet.sealed, true, `${label}: sealed exactly once`);
    assert.ok(settled.resultSet.outcome.reasons.includes(reason), label);
    assert.equal(settled.resultSet.outcome.coverage, 'partial', label);
    assert.ok(!settled.resultSet.outcome.reasons.includes('unit:internal-error'),
      `${label}: this must be the PLANNED seal, never the R10 seal-failure fallback`);
    assert.equal(fx.residency.admitted.includes(handle.runId), true, label);
  }
});

test('Q2: every planning gap P3 reported reaches RunOutcome.reasons', async () => {
  const fx = createRunFixture({
    plan: null,
    planningGaps: [{ phase: 'enumerating', cause: 'cancelled' },
                   { phase: 'enumerating', cause: 'enumeration-failed' },
                   { phase: 'planning', cause: 'plan-too-large' }],
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed',
    'a non-cancelled gap decides the status even when a `cancelled` gap came first (order B)');
  for (const cause of ['cancelled', 'enumeration-failed', 'plan-too-large']) {
    assert.ok(summary.resultSet.outcome.reasons.includes(`planning:${cause}`), cause);
  }
  assert.deepEqual(summary.resultSet.outcome.reasons,
    [...summary.resultSet.outcome.reasons].sort(), 'ascending and distinct');
});

test('I7: derivedFromRunId is part of the RunSpec, validated, and reaches the sealed set', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    derivedFromRunId: 'run-base-7',
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.resultSet.derivedFromRunId, 'run-base-7', 'rerun lineage survives the seal');

  const plain = createRunFixture({ plan: createFakePlan([]) });          // no field at all
  assert.equal(createRun(plain.spec).handle.runId, plain.spec.runId, 'absent is legal');
  assert.equal(
    createRun({ ...plain.spec, derivedFromRunId: null }).handle.runId, plain.spec.runId,
    'explicit null is legal');
  for (const bad of ['', 7, {}, ['run-1']]) {
    assert.throws(() => createRun({ ...plain.spec, derivedFromRunId: bad }), TypeError,
      `a malformed RunSpec is a programmer error: ${JSON.stringify(bad)}`);
  }
});

test('provenance.admissionBaseline is recorded at the snapshot instant (§13.2)', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.provenance.admissionBaseline.map((e) => e.modelKey), ['mk-a']);
  assert.equal(typeof summary.resultSet.provenance.admissionBaseline[0].epochInstanceCount, 'number');
});

test('a preplanned target-too-large gap is adopted into progress; the run seals FULLY processed (R11)', async () => {
  // P3 records `not-run:target-too-large` gap records at planning and creates NO executable unit
  // for them, yet their weight IS part of pairSpaceTotal (AC-18(b)). Without adoption the run
  // would seal `completed` at fractionProcessed 0.5 (review I3).
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 5 }],
      { gaps: [{ unitId: '1.1', pairSpaceWeight: 5, cause: 'target-too-large' }] }),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const snap = handle.getSnapshot();
  assert.equal(summary.status, 'completed');
  assert.equal(snap.pairSpaceTotal, 10, 'the gap weight is part of the total');
  assert.equal(snap.fractionProcessed, 1, 'processed = evaluated + gaps');
  assert.equal(snap.fractionEvaluated, 0.5, 'a gap is processed but never evaluated');
  assert.equal(snap.unitsTotal, 2);
  assert.equal(snap.unitsEvaluated, 1);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'a preplanned gap is never issued');
  assert.deepEqual(
    summary.resultSet.ledger.units.map((u) => `${u.outcome}:${u.cause}`),
    ['evaluated:null', 'not-run:target-too-large'],
  );
});

test('the adoption is idempotent: a mid-run snapshot never counts a gap twice', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }, { unitId: '1.1', weight: 2 }],
      { gaps: [{ unitId: '1.2', pairSpaceWeight: 4, cause: 'target-too-large' }] }),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  const seen = [];
  handle.subscribe(() => seen.push(handle.getSnapshot()));
  begin();
  await handle.done;
  const processed = seen.map((s) => s.pairSpaceProcessed);
  assert.deepEqual(processed, [...processed].sort((a, b) => a - b), 'monotone');
  assert.equal(processed.at(-1), 8);
  assert.ok(processed.every((p) => p >= 4), 'the gap weight is adopted once, at plan completion');
});

test('the queued->planning binding snapshot is ONE snapshotBindings call', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a', 'mk-b'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const planningSnapshots = fx.registry.snapshotCalls.filter((c) => c.at === 'queued->planning');
  assert.equal(planningSnapshots.length, 1);
  assert.deepEqual(planningSnapshots[0].keys, ['mk-a', 'mk-b']);
});

test('a model registered AFTER the snapshot does not join the run', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.reached('planning');
  fx.registry.register('mk-late', {}, { modelVersion: 'v1' });
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.provenance.models.map((m) => m.modelKey), ['mk-a']);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/lifecycle.test.mjs` ⇒ `createRun` has no planning stage yet; the first assertion fails on `summary` being `undefined`.

- [ ] **Step 3: Implement the resolution/planning stage in `clashtest/run/Run.js`.**

```js
// clashtest/run/Run.js  (P6.4 slice)

const CANCELLED = Symbol('cancelled-before-resolution');

/**
 * Stage 1+2, RACED against cancellation (R5, review C2). `resolveDefinition` may be a store read
 * that never settles; awaiting it unconditionally would make `cancel()` and `done` unbounded and
 * would wedge `dispose()`. The loser of the race is ABANDONED — never awaited again, never
 * committed — and its eventual settlement is swallowed so a late rejection cannot surface as an
 * unhandled rejection or reject `done` (§13.5.1 item 1). There is no cancellation *signal* on the
 * port: `resolveDefinition` is a host-supplied lookup and the spec gives it no abort contract.
 */
async function resolveStage(run) {
  run.setPhase('binding');
  const lookup = run.spec.resolveDefinition();            // Promise<{definition, testRef}>
  const settled = Promise.resolve(lookup).then(
    (value) => ({ kind: 'resolved', value }),
    (error) => ({ kind: 'rejected', error }),
  );
  const outcome = await Promise.race([settled, run.cancellationSignal().then(() => ({ kind: 'cancelled' }))]);
  if (outcome.kind === 'cancelled') {
    void settled;                                         // abandoned; already has both handlers
    return CANCELLED;
  }
  if (outcome.kind === 'rejected') {
    return run.failPlanning(run.spec.planningCauseOf(outcome.error));
  }
  if (run.cancelRequested !== null) return CANCELLED;     // observed before we committed it
  run.resolution = outcome.value;                         // committed: from here on, post-resolution
  return outcome.value;
}

/** P5's accumulator ctx takes `Map<modelKey, Set<dbId>>` built from PLAN data. The ledger's
 *  `unreachablePopulation` rows are that plan data in their persisted shape. */
function ownerSetsFromLedger(ledger, field) {
  const out = new Map();
  for (const row of ledger.toLedgerRecord().unreachablePopulation) {
    if (row[field].length > 0) out.set(row.modelKey, new Set(row[field]));
  }
  return out;
}

async function planStage(run) {
  run.transition('planning');
  const registry = run.spec.coordinator.registry;
  const keys = run.spec.modelKeysOf(run.resolution.definition);   // ascending, distinct
  // R7 / review I2: ONE snapshot; its frozen bindings already carry valid cached leases (P1
  // decision 2). No second admitModel loop, and nothing is written back onto a frozen binding.
  run.snapshotKeys = keys;
  run.snapshot = registry.snapshotBindings(keys);         // {registryRevision, bindings}
  if (run.snapshot.bindings.some((b) => b === null)) {    // null = dead | unregistered | lease-invalid (N10)
    return run.failPlanning('model-not-bound');
  }
  // §13.2: the admission baseline is read at the moment the leases are held, i.e. now.
  run.admissionBaseline = keys.map((modelKey, i) => ({
    modelKey,
    epochInstanceCount: run.spec.world.getEpochCollisionInstanceCount(run.snapshot.bindings[i].lease),
  }));
  if (run.cancelRequested !== null) return run.cancelPlanning();

  run.setPhase('enumerating');
  // A6/N15 + A17: P6 owns the budget and the ledger, and hands the ledger to the planner so
  // planning gaps, unit records and runtime taints all land in ONE object.
  run.budget = run.spec.plannerPort.createRecordBudget(run.limits);
  run.ledger = run.spec.plannerPort.createLedger({ limits: run.limits, budget: run.budget });
  let result;
  try {
    result = await run.spec.plannerPort.planRun({
      definition: run.resolution.definition,
      snapshot: run.snapshot,                             // P3's argument name, and the whole result
      enumerator: run.spec.enumerator,
      options: run.runOptions,                            // resolved run options
      checkpoint: run.enumerationCheckpoint(),            // §6.2 context checkpoint; throws
      ledger: run.ledger,                                 //   EnumerationCancelledError on cancel
    });
  } catch (err) {
    if (err.name === 'EnumerationCancelledError') return run.cancelPlanning();
    // planningCauseOf maps an enumeration/bind error to the EXHAUSTIVE §6.6.2 planning-cause enum:
    //   WorldDisposedError -> 'world-disposed'; ObjectTreeUnavailableError -> 'enumeration-failed';
    //   ModelEvictedError / dead lease -> 'model-not-bound'; a planner cap refusal -> 'plan-too-large';
    //   anything else -> 'enumeration-failed' (fail closed: an unknown planning error is never silent).
    return run.failPlanning(run.spec.planningCauseOf(err));
  }
  // N15: `planRun` returns the WRAPPER. The plan is one level down and may be null.
  if (result.status !== 'planned' || result.planningGaps.length > 0) {
    // Q2: EVERY gap is recorded as a reason; ONE of them decides the status. A non-`cancelled`
    // gap outranks a `cancelled` one (order B: failed > cancelled), so the primary is the first
    // non-`cancelled` cause if there is one — picking `planningGaps[0]` blindly would seal a run
    // `cancelled` that actually failed to enumerate.
    const causes = result.planningGaps.map((g) => g.cause);
    for (const cause of causes) run.settlementState.planningGapCauses.push(cause);
    const primary = causes.find((c) => c !== 'cancelled') ?? causes[0] ?? 'enumeration-failed';
    return primary === 'cancelled' ? run.cancelPlanning() : run.failPlanning(primary);
  }
  if (run.cancelRequested !== null) return run.cancelPlanning();

  run.plan = result.plan;
  // I6: seed the plan-order oracle with the INITIAL units. Runtime split children are added to it
  // by `executeStage` as each split is admitted, so a child never falls back to the unranked
  // sentinel (see "Plan order over runtime descendants" in Task P6.5).
  run.unitOrder.seed(run.plan.units.map((u) => u.unitId));
  // A12: the run's result accumulator is created HERE, because its `ctx` needs the plan. P5 owns
  // the merge rules; P6 owns the context they read (P5 *Accumulator context*). Until this point
  // `run.results` is the inert `EMPTY_RESULTS` holder from `createRun` (C2), never `undefined`.
  run.results = run.spec.resultPort.createResultAccumulator({
    mode: run.resolution.definition.mode,
    testId: run.resolution.testRef.testId,
    semanticDigest: run.resolution.testRef.semanticDigest,
    maxResultsPerRun: run.runOptions.maxResultsPerRun,
    // §11.4 rule 2's explicit plan order. P5 accepts a `Map` **or any `{get(unitId) → number}`**
    // (P5 summary), and the oracle is the second form because its ranks are re-derived on every
    // admitted split — a `Map` snapshot taken here would freeze the plan before its descendants
    // existed and rank every one of them `Number.MAX_SAFE_INTEGER` (I6).
    unitPlanRank: run.unitOrder,
    // Built from PLAN data, never from a unit (P5's rule): Map<modelKey, Set<dbId>>.
    unreachableOwners: ownerSetsFromLedger(run.ledger, 'ownerDbIds'),
    mixedOwners: ownerSetsFromLedger(run.ledger, 'mixedOwnerDbIds'),
  });
  adoptPlanIntoProgress(run, result);
  run.transition('running');
  run.setPhase('executing');
  return run.plan;
}

/**
 * R11 / review I3 — plan completion is where P3's PREPLANNED gaps join progress accounting.
 * `sizeUnits` turns an over-cap target entry into a `not-run:target-too-large` ledger record with
 * a real `pairSpaceWeight` and NO executable unit (P3 Task P3.7), and that weight is part of the
 * required pair space (AC-18(b): "`pairSpaceTotal` includes its weight as a gap"). Initializing
 * progress from `plan.units` alone would seal a `completed` run at `fractionProcessed < 1`.
 * Such a record is already terminal, so it is adopted ONCE, here, and never revisited by the loop.
 */
function adoptPlanIntoProgress(run, planResult) {
  const executable = new Set(run.plan.units.map((u) => u.unitId));
  const preTerminalGaps = run.ledger.toLedgerRecord().units
    .filter((u) => u.kind !== 'split' && !executable.has(u.unitId) && u.outcome === 'not-run');

  run.pending.unitsTotal = run.plan.units.length + preTerminalGaps.length;
  run.pending.pairSpaceTotal = run.plan.pairSpaceTotal;   // already includes the gap weights
  // R11: the WEIGHT comes from P3's accessor, not from re-summing the records here. The record
  // scan above still runs, because P6 needs each gap's `cause` for §16.7 and the unit COUNT for
  // `unitsTotal` — neither of which the scalar carries — but the arithmetic that has to agree
  // with `pairSpaceTotal` is P3's own, and the assertion below is the standing guard.
  run.pending.pairSpaceProcessed += planResult.preTerminalGapWeight;   // processed, never evaluated
  for (const gap of preTerminalGaps) {
    run.pending.unitsFailedOrSkipped += 1;
    run.settlementState.unitCauses.push(gap.cause);          // §16.7 collects it like any other fact
  }
  run.commit('state');
}
```

`failPlanning(cause)` and `cancelPlanning()` both funnel into one place so the §16.7 order B is applied once, not duplicated:

```js
function settlePlanning(run, cause) {
  run.settlementState.planningCause = cause;
  // Q2: a cause P6 detected itself (a cancel, a rejected lookup, `model-not-bound`) is a gap too,
  // and `collectReasons` reads the gap list — not `planningCause` alone — for the reasons.
  if (!run.settlementState.planningGapCauses.includes(cause)) {
    run.settlementState.planningGapCauses.push(cause);
  }
  const status = resolveRunStatus(run.settlementState);   // 'failed' for anything but 'cancelled'
  // A17: the gap goes on P3's ledger (P5 has no such call), as the {phase, cause} row §6.6.2 and
  // P5's pinned `Ledger.planningGaps` both use. A run that never planned still has a ledger.
  // NOTE `recordPlanningGap` — NOT `recordGap`, which records a *unit* gap and would put a unit
  // record in a ledger this path must leave at `units: []` (see the cross-phase note below).
  run.ledger ??= run.spec.plannerPort.createLedger({
    limits: run.limits,
    budget: run.spec.plannerPort.createRecordBudget(run.limits),
  });
  run.ledger.recordPlanningGap({ phase: run.phase, cause });
  return run.sealAs(status);                              // zero units, coverage 'partial'
}
```

**The queued-withdrawal path (R5, review C2).** A run cancelled while still queued has never had its
job function invoked, so no loop boundary exists to settle it; the withdrawal winner must seal it
directly. `withdraw()` is synchronous and returns `true` to exactly one caller, which makes this a
race with one winner and no double seal:

```js
function cancelWhileQueued(run) {
  // TRUE  => we removed it from the queue; its `run` function will never be called, so WE owe it
  //          the pre-resolution cancelled seal and the conversion of its reserved slot.
  // FALSE => it had already started; its own next boundary observes `cancelRequested` and seals.
  if (run.spec.coordinator.cancelQueued(run.runId) !== true) return;
  void settlePlanning(run, 'cancelled');                  // zero units, definition null (§13.1)
}
```

The set a run that never resolved seals is built in the **pre-resolution** shape (§13.1), through
P5's real assembly call (A12) — there is no draft object with `recordPlanningGap`/`mergeUnit`:

```js
function resultParts(run, outcome, diagnostics) {
  const resolved = run.resolution !== undefined;
  return {
    runId: run.runId,
    testRef: resolved
      ? run.resolution.testRef
      : { testId: run.spec.testIdOfInput, revision: null, semanticDigest: null },
    definition: resolved ? run.resolution.definition : null,
    // I7: validated and normalized once, in `createRun`. Reading it off the run (not off the raw
    // spec, and with no `?? null` rescue here) is what makes a missing field a loud construction
    // error instead of a silently dropped rerun lineage.
    derivedFromRunId: run.derivedFromRunId,
    outcome,
    provenance: run.provenance(),                         // provenanceBase + models + admissionBaseline
    ledger: run.ledger.toLedgerRecord(),                  // A17: arrays-only, P5's pinned shape
    // C2: ALWAYS defined — `EMPTY_RESULTS` before planning, P5's accumulator after it. This is the
    // one call every pre-resolution path makes, and the reason the holder exists at all.
    results: run.results.toArray(),                       // A12: the accumulator
    diagnostics,                                          // A11: aggregator snapshot()
    statistics: run.spec.statisticsAccumulator.snapshot(),
  };
}
```

> **C2, stated as an invariant rather than a defensive read.** Every field `resultParts` touches is
> established synchronously in `createRun` (`run.results`, `run.derivedFromRunId`,
> `run.settlementState`) or by `settlePlanning` before it seals (`run.ledger`, which it creates if
> planning never reached `planStage`). `run.results?.toArray() ?? []` would also work and is the
> review's own suggestion, but it hides a second bug class: a seal that silently produces an empty
> result array because the accumulator was *lost*, not because the run never planned. The holder
> keeps "no plan ⇒ no results" a fact of the object graph, and V26 asserts it end-to-end through
> the real sealing sketch on all three pre-resolution paths.

> **Cross-phase note — RESOLVED by the residual cross-file sweep; P3 now exposes it.** P3's Task
> P3.8 *Produces* list had `recordGap` (a **unit** gap, used for `target-too-large`) but no writer
> for the ledger's `planningGaps` array, which P5's pinned `Ledger` shape declares and
> `ledgerDigestInput` digests. P6 needs one for `planning:cancelled` and for every §6.6.2 cause it
> detects after `planRun` returned (a cancel during planning, a post-plan `world-disposed`). P3's
> ledger now exports **`recordPlanningGap({phase, cause}) → void`** beside `recordGap`, documented
> there as *not interchangeable* with it: it appends one `{phase, cause}` row, allocates no
> `UnitRecord`, charges no budget class and cannot be refused, so it is safe on a ledger the
> pre-resolution seal requires to have `units: []`. Using `recordGap` instead would put a unit
> record into that ledger.

- [ ] **Step 4: Run it and watch it pass.** `node --test test/clashtest/run/lifecycle.test.mjs`.

- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).** `docs: P6.4 planning stage and pre-resolution seal`.

---

### Task P6.5: The unit loop — requests, retries, splits, progress growth, main-thread discipline (§7.3, §7.5, §9, §17.3)

**Files**
- Modify: `clashtest/run/Run.js`
- Create: `test/clashtest/support/scriptedExecutor.mjs`
- Modify: `test/clashtest/run/progress.test.mjs`

**Interfaces**
- *Consumes:* A2 (`slicer.tick`), A7 (`materializeUnit` — **including its `scopeExpect`**, passed through untouched), A8 (`splitUnit(plan, unit)`, the single live split-admission operation, R8), A9 (`UnitExecutor` = a **function**), A10 (`validateUnitOutcome` → `{ok, issues: Issue[]}` and `internalErrorOutcome(request, issues)`), A11 (`diagnosticAggregator.addUnit`, `deriveUnitTaints`, `statisticsAccumulator.add`), A12 (`resultAccumulator.addUnit`), A17 (`ledger.recordOutcome` / `addTaint` / `tryRecordSplit` via `splitUnit`); `classifyUnitSettlement` (P6.1).
- *Produces:* the executing loop, `ExecutionRequest` construction, the inter-unit yield, retry and split bookkeeping, progress commits.
- *Does NOT produce:* any scope expectation (A7 supplies it), any digest comparison (P3's `checkScopeBracket`, D1), any per-unit lease check (P4's executor, D2), any diagnostic de-duplication (P4's aggregator, D3), any coverage/integrity/environment-sensitivity derivation (P5's `deriveRunOutcome`, A13).

- [ ] **Step 1: Write the failing progress-growth and loop tests.**

```js
// appended to test/clashtest/run/progress.test.mjs
test('progress never regresses when unitsTotal GROWS through a split', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 100 }, { unitId: '1.1', weight: 100 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }],
      '1.0.1': [{ facts: [] }],
      '1.1': [{ facts: [] }],
    }),
    // §6.4 child ids are `${unitId}.0` / `${unitId}.1`, and their weights PARTITION the parent's.
    splits: { '1.0': [{ unitId: '1.0.0', weight: 50 }, { unitId: '1.0.1', weight: 50 }] },
  });
  const { handle, begin } = createRun(fx.spec);
  const seen = [];
  handle.subscribe((ev) => { if (ev.type !== 'persistence') seen.push(handle.getSnapshot()); });
  begin();
  await handle.done;

  const totals = seen.map((s) => s.unitsTotal);
  assert.ok(totals.includes(2) && totals.includes(3), 'unitsTotal grew by one leaf');
  for (let i = 1; i < seen.length; i += 1) {
    for (const key of ['seq', 'unitsEvaluated', 'pairSpaceEvaluated', 'pairSpaceProcessed',
                       'resultsFound', 'caveatCount', 'caveatUnclassified']) {
      assert.ok(seen[i][key] >= seen[i - 1][key], `${key} regressed at ${i}`);
    }
    assert.ok(seen[i].unitsTotal >= seen[i - 1].unitsTotal, 'unitsTotal shrank');
    const f = (s) => (s.fractionProcessed === null ? 0 : s.fractionProcessed);
    assert.ok(f(seen[i]) >= f(seen[i - 1]), 'fractionProcessed regressed');
    assert.equal(seen[i].pairSpaceTotal, 200, 'a split CONSERVES pairSpaceTotal');
  }
  const last = handle.getSnapshot();
  assert.equal(last.fractionProcessed, 1);
  assert.equal(last.fractionEvaluated, 1);
  assert.equal(last.status, 'completed');
});

test('the engine yields between units and never starts two units at once', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }, { unitId: '1.2', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }], '1.2': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  assert.equal(fx.executor.maxConcurrent, 1);
  assert.equal(fx.yields.interUnit, 2, 'one yield between each pair of units');
  assert.equal(fx.clock.longestSyncSpanMs <= fx.limits.sliceBudgetMs, true);
});

// --- The placement-retry protocol, driven by P4's ACTUAL outcome shape (re-verification C1) ---
//
// P4's executor never emits a fact called `placement-contention`. `ModelPlacementChangedError`
// with the engine's own generation UNCHANGED is `{outcome:'failed', failure:{code:'stale-placement',
// retryable:true}}`; with the generation CHANGED it is `{outcome:'discarded',
// failure:{code:'input-changed', retryable:false}}` (P4 Task P4.7, `classifyLibraryError`).
// `placement-contention` is the ENVIRONMENTAL cause the *run* records once retries are exhausted
// (spec §7.5, §8.3, §15.1), and P5 derives it from the sealed `failed:stale-placement` unit record
// — P6 never names it as an executor-level fact. Every test below scripts the P4 shape.
const stalePlacement = (retryable = true) => ({
  outcome: 'failed',
  failure: { code: 'stale-placement', retryable, errorName: 'ModelPlacementChangedError' },
});

test('C1: a retryable stale-placement outcome with an UNCHANGED generation re-issues up to the cap', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({
      '1.0': [
        stalePlacement(),
        stalePlacement(),
        { facts: [] },                                     // succeeds on attempt 3
      ],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1, 2, 3]);
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, [],
    'a retry that SUCCEEDS adds no cause');
});

test('C1: `retryable: false` on the same code is NOT retried', async () => {
  // The whole point of reading P4's field rather than an invented fact: eligibility is the
  // producer's statement about its own failure, not P6's guess from a code string.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': [stalePlacement(false), { facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1], 'exactly one attempt');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'stale-placement');
  assert.equal(summary.resultSet.ledger.units[0].attempts, 1);
});

test('C1: a placement generation that MOVED against the run snapshot is never retried', async () => {
  // §7.5 row 2 vs row 3: a host-signalled placement change is `input-changed` and INVALIDATES the
  // run; retrying it would re-issue a unit whose inputs the engine already knows have changed.
  // P6 re-checks the generation itself, so a third-party executor that wrongly answered
  // `retryable: true` cannot talk P6 into a retry.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['mk-a'] }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': [stalePlacement(), { facts: [] }] }),
    beforeUnit: { '1.0': () => fx.registry.notifyPlacementChanged('mk-a') },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1], 'no retry once the generation moved');
  assert.equal(summary.status, 'invalidated');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'input-changed');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, [],
    'a host-signalled change is never placement-contention (§7.5)');
});

test('C1: a retryable stale-placement alongside a higher-precedence fact settles, never retries', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ ...stalePlacement(), scopeProof: 'drift' }, { facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(fx.executor.attemptsFor('1.0'), [1]);
  assert.equal(summary.resultSet.ledger.units[0].cause, 'scope-drift', 'table A, not the retry');
  assert.equal(summary.status, 'invalidated');
});

test('retries exhausted is a stale-placement gap and marks the run environmentSensitive', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    runOptions: { maxPlacementRetries: 2 },
    executor: createScriptedExecutor({ '1.0': Array(3).fill(stalePlacement()) }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'stale-placement');
  assert.equal(summary.resultSet.ledger.units[0].attempts, 3);          // maxPlacementRetries + 1
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  // §8.3: P5 DERIVES the environmental cause from the sealed `failed:stale-placement` record.
  // P6 wrote no `placement-contention` anywhere — not as a fact, not as a unit cause (A13).
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, ['placement-contention']);
  assert.equal(summary.resultSet.outcome.environmentSensitive, true);
  assert.ok(summary.resultSet.outcome.reasons.includes('unit:stale-placement'));
  assert.ok(!summary.resultSet.outcome.reasons.includes('unit:placement-contention'));
});

test('a malformed outcome becomes P4\'s internalErrorOutcome and FAILS the run (fail fast)', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ malformed: true }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'internal-error');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'not-run');
  assert.equal(summary.resultSet.results.length, 0, 'nothing from a malformed outcome is merged');
  assert.equal(fx.executor.attemptsFor('1.1').length, 0, 'no unit starts after the fatal one');
  // A10/N8: `issues` are {code, path, detail} OBJECTS and the substitute outcome is P4's, not a
  // hand-built one — a `string[]` assumption would have written "[object Object]" into the ledger.
  assert.deepEqual(fx.substitutedOutcomes.map((o) => o.source), ['internalErrorOutcome']);
  for (const issue of fx.lastValidationIssues) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'detail', 'path']);
  }
});

test('C5: a split is admitted ATOMICALLY against both caps; nested splits stay inside them', async () => {
  // The old guard read `run.plan.units.length`, which never changes as runtime children are
  // created, so repeated nested splits could pass forever. R8 moves admission into P3's
  // `splitUnit`, which counts unit records (parent + 2 children) and their ledger records.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 8 }]),
    limits: { maxUnitsPerRun: 4 },
    // every leaf keeps failing on capacity, so the run splits until admission refuses
    executor: createScriptedExecutor.capacityAlways({ capacityKind: 'tlas-candidate-budget' }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const units = summary.resultSet.ledger.units;
  assert.ok(units.length <= 4, `unit records ${units.length} must not exceed maxUnitsPerRun`);
  const capped = units.filter((u) => u.cause === 'unit-cap');
  assert.ok(capped.length > 0, 'the refusal surfaced as failed:unit-cap');
  assert.equal(capped[0].capDetail, 'unit-records');
  assert.equal(summary.status, 'completed', 'a budget refusal never FAILS the run (§6.5.1)');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(handle.getSnapshot().pairSpaceTotal, 8, 'every split CONSERVES the weight');
  assert.equal(handle.getSnapshot().fractionProcessed, 1);
});

test('C5: a ledger-record refusal is failed:unit-cap with capDetail ledger-records', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 4 }]),
    limits: { maxLedgerRecords: 'exhausted' },             // the fixture pre-spends the discretionary pool
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(
    summary.resultSet.ledger.units.map((u) => [u.outcome, u.cause, u.capDetail]),
    [['failed', 'unit-cap', 'ledger-records']],
  );
  assert.equal(fx.ledger.halfRecordedSplits, 0, 'no half-recorded split exists');
});

test('C5: an UNSPLITTABLE unit keeps its capacity-exceeded cause and is never called unit-cap', async () => {
  // §6.4 item 4: one source root against one explicit target root (or a whole-model sentinel) is
  // fundamentally indivisible. The capacity failure itself is the gap; `unit-cap` would misreport
  // a budget refusal that never happened.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, splittable: false }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  const [record] = summary.resultSet.ledger.units;
  assert.equal(record.cause, 'capacity-exceeded');
  assert.equal(record.capacityKind, 'tlas-candidate-budget');
  assert.equal(record.capDetail, null);
  assert.equal(fx.plannerCalls.splitUnit, 1, 'the refusal came from splitUnit, not from a P6 guard');
});

test('C5: a refusal wrapper is never mistaken for a successful split', async () => {
  // N17, the single most dangerous mismatch of the reconciliation: `{reason:'unsplittable'}` is
  // TRUTHY, so `result !== null` would have produced two `undefined` children.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2, splittable: false }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'clearance-narrow-phase-budget' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.resultSet.ledger.units.length, 1, 'no phantom children were queued');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'failed');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
});

test('a NON-splittable capacity kind is not split at all', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'bucket-capacity' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(fx.plannerCalls.splitUnit, 0, '§6.4 splits only the two per-call budget kinds');
  assert.equal(summary.resultSet.ledger.units[0].cause, 'capacity-exceeded');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses, ['bucket-capacity']);
});

test('C4: a result-cap REFUSAL merges nothing at all — not results, diagnostics, statistics, taints or progress', async () => {
  // The refused unit carries pairs (over the cap), a completeness-affecting diagnostic, real
  // statistics and an element taint. The plan says a refused unit merges nothing; the sealed set
  // must agree on EVERY channel, because a leaked diagnostic can downgrade `integrity` and a
  // leaked taint can add caveats to a run that claims the unit was never merged.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxResultsPerRun: 2 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: [], pairs: 2 }],                                   // accepted: fills the cap
      '1.1': [{ facts: [], pairs: 5,                                      // refused: whole unit
               diagnostics: [{ reason: 'fragment-not-loaded', dbId: 7, modelId: 1 }],
               statistics: { broadPhasePairs: 40 } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const before = { ...fx.diagnosticAggregator.snapshot(), calls: fx.diagnosticAggregator.addUnitCalls };
  const summary = await handle.done;
  const snap = handle.getSnapshot();

  assert.equal(summary.resultSet.results.length, 2, 'only the accepted unit merged');
  assert.deepEqual(fx.diagnosticAggregator.addUnitCalls, ['1.0'],
    'the refused unit was never handed to the aggregator');
  assert.deepEqual(fx.statisticsAccumulator.addCalls.length, 1, 'and never to the statistics');
  assert.equal(summary.resultSet.statistics.broadPhasePairs < 40, true,
    'the refused unit\'s statistics are absent from the sealed totals');
  assert.equal(summary.resultSet.diagnostics.total, before.total + 0 + 1,
    'exactly the accepted unit\'s diagnostics');
  const refused = summary.resultSet.ledger.units.find((u) => u.unitId === '1.1');
  assert.equal(refused.cause, 'result-cap');
  assert.deepEqual(refused.taints, [], 'no taint was derived or charged for a refused unit');
  assert.equal(snap.unitsEvaluated, 1, 'a refused unit is not evaluated');
  assert.equal(snap.pairSpaceEvaluated, 1);
  assert.equal(snap.resultsFound, 2);
  assert.equal(snap.unitsFailedOrSkipped, 1);
  assert.equal(snap.pairSpaceProcessed, 2, 'but it IS processed — it is a gap, not a hole');
  assert.equal(summary.status, 'failed', '§16.7: result-cap is a failing unit cause');
});

test('I5: a clean run seals with EMPTY reasons', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: 1 }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.deepEqual(summary.resultSet.outcome.reasons, [],
    'no cancel, no gap, no drift ⇒ nothing to report; `unit:evaluated` is not a reason');
  assert.equal(summary.resultSet.outcome.coverage, 'full');
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => u.cause), [null, null]);
});

// --- Plan order over runtime split descendants (re-verification I6) ---

test('I6: a split CHILD outranks a later initial unit in the duplicate-reconciliation order', async () => {
  // §11.4 rule 2 resolves a duplicate pair in favour of the lowest unit *in plan order*. A child of
  // initial unit 1 is logically earlier than initial unit 2; with only `plan.units` in the oracle
  // the child is unranked (`Number.MAX_SAFE_INTEGER`) and LOSES to unit 2 — or ties, and is then
  // decided by settlement arrival, which is not an order at all.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 2 }, { unitId: '1.1', weight: 2 }]),
    splits: { '1.0': [{ unitId: '1.0.0', weight: 1 }, { unitId: '1.0.1', weight: 1 }] },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }], '1.0.1': [{ facts: [] }], '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const rank = fx.resultPort.lastAccumulatorCtx.unitPlanRank;
  const r = (id) => rank.get(id);
  assert.ok(Number.isInteger(r('1.0.0')) && Number.isInteger(r('1.1')), 'every live unit is ranked');
  assert.ok(r('1.0.0') < r('1.1'), 'a descendant of unit 1 precedes initial unit 2');
  assert.ok(r('1.0.1') < r('1.1'));
  assert.ok(r('1.0.0') < r('1.0.1'), 'siblings keep the §6.4 split order');
  assert.ok(r('1.0') < r('1.0.0'), 'the superseded parent still precedes its own children');
  assert.notEqual(r('1.1'), Number.MAX_SAFE_INTEGER, 'nothing fell back to the unranked sentinel');
});

test('I6: NESTED children stay in order, and the order is a strict total order', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 8 }, { unitId: '1.1', weight: 1 }]),
    splits: {
      '1.0': [{ unitId: '1.0.0', weight: 4 }, { unitId: '1.0.1', weight: 4 }],
      '1.0.1': [{ unitId: '1.0.1.0', weight: 2 }, { unitId: '1.0.1.1', weight: 2 }],
    },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.1': [{ facts: ['capacity-exceeded'], capacityKind: 'tlas-candidate-budget' }],
      '1.0.0': [{ facts: [] }], '1.0.1.0': [{ facts: [] }], '1.0.1.1': [{ facts: [] }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const rank = fx.resultPort.lastAccumulatorCtx.unitPlanRank;
  const ids = ['1.0', '1.0.0', '1.0.1', '1.0.1.0', '1.0.1.1', '1.1'];
  const ranks = ids.map((id) => rank.get(id));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'the documented order, exactly');
  assert.equal(new Set(ranks).size, ranks.length, 'strict: no two live units share a rank');
  assert.equal(rank.get('nope'), undefined, 'an unknown id is still unranked (P5 fails it last)');
  // The lexicographic path order is what produces this; string order does NOT. With ten children
  // the string comparison '1.0.10' < '1.0.2' would invert two siblings.
  assert.ok(rank.get('1.0.1.1') < rank.get('1.1'));
});

test('the unit request carries P3\'s scopeExpect through untouched (A7, D1)', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await handle.done;
  const [request] = fx.executor.requests;
  const expected = fx.plan.materializeUnit(fx.plan, fx.plan.units[0]).scopeExpect;
  assert.deepEqual(request.materialized.scopeExpect, expected,
    'P6 passes the planner\'s expectation through; it builds none of its own');
  assert.equal(Object.isFrozen(request), true);
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/progress.test.mjs` ⇒ the run never leaves `running` (no unit loop).

- [ ] **Step 3: Implement the loop in `clashtest/run/Run.js`.**

```js
// clashtest/run/Run.js  (P6.5 slice)
import { classifyUnitSettlement, resolveRunStatus, collectReasons } from './settlement.js';

// §6.4: only the two PER-CALL budget kinds scale with source count, so only they are splittable.
const SPLITTABLE_CAPACITY_KINDS = new Set(['tlas-candidate-budget', 'clearance-narrow-phase-budget']);
// R8: how a split refusal maps onto a §16.7 fact. `unsplittable` is NOT a cap refusal — the
// unit's own capacity failure stands (§6.4 item 4 "and is a gap").
const SPLIT_REFUSAL_FACT = Object.freeze({
  unsplittable: null,                                     // keep the capacity-exceeded settlement
  'unit-cap': 'unit-cap',
  'ledger-cap': 'unit-cap',
});

async function executeStage(run) {
  const queue = [...run.plan.units];                      // leaf work list, grows on a split
  let first = true;
  while (queue.length > 0) {
    if (!first) await run.interUnitYield();               // §7.3: animation-frame-aligned or macrotask
    first = false;

    // --- BOUNDARY: collect facts from committed state BEFORE choosing anything (§16.7) ---
    const boundary = run.collectBoundaryFacts();
    const boundaryStatus = resolveRunStatus(boundary);
    if (boundaryStatus !== null && boundaryStatus !== 'completed') {
      run.markRemainingNotRun(queue, boundaryStatus === 'cancelled' ? 'cancelled' : 'run-failed');
      return run.sealAs(boundaryStatus);
    }

    const unit = queue.shift();
    run.pending.currentUnitId = unit.unitId;
    const result = await runUnitWithRetries(run, unit);

    if (result.split !== undefined) {                     // §6.4: the parent is superseded by 2 leaves
      queue.unshift(...result.split.children);            // the split was ALREADY admitted (R8)
      // I6: the rank oracle learns the descendants at the same instant the queue does, so a child
      // is ranked BEFORE it can ever settle a result. §11.4 rule 2 reads this through `ctx`.
      run.unitOrder.split(unit.unitId, result.split.children.map((c) => c.unitId));
      run.pending.unitsTotal += 1;                        // +1 LEAF per split; weight is CONSERVED
      run.ledger.recordOutcome(unit.unitId, {
        outcome: 'split', cause: null,
        children: result.split.children.map((c) => c.unitId),
      });
      run.commit('unit');
      continue;
    }

    await run.applyUnitResult(unit, result);              // merges iff result.settlement.merges
    run.commit('unit');
  }
  run.pending.currentUnitId = null;
  // §16.3.3 — the end-of-plan check IS a boundary.
  const endState = run.collectBoundaryFacts({ allLeafUnitsTerminal: true });
  return run.sealAs(resolveRunStatus(endState) ?? 'completed');
}

async function runUnitWithRetries(run, unit) {
  const maxAttempts = run.runOptions.maxPlacementRetries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // A7/N16: `materializeUnit` returns {sourceDbIds, targets, scopeExpect}. The third field IS
    // the §16.3.2 bracket expectation including R20-1; P6 passes it through and builds none.
    const materialized = run.spec.plannerPort.materializeUnit(run.plan, unit);
    const request = Object.freeze({
      unit,
      materialized: Object.freeze({ ...materialized }),
      runId: run.runId,
      attempt,
      mode: run.resolution.definition.mode,
      ...(run.resolution.definition.mode === 'clearance'
        ? { clearance: run.resolution.definition.clearance } : {}),
      broadPhase: run.runOptions.broadPhase,
      snapshot: run.snapshotFor(unit),
      limits: Object.freeze({
        maxPairsPerOutcome: run.runOptions.maxPairsPerOutcome,
        maxDiagnosticsPerOutcome: run.runOptions.maxDiagnosticsPerOutcome,
        maxDistinctReasons: run.runOptions.maxDistinctReasons,
      }),
    });

    let outcome;
    let facts = [];
    let phase = 'post';
    try {
      outcome = await run.spec.executor(request);         // A9: the executor IS the function
    } catch (err) {
      // An executor that THROWS is a defect of the executor, not a library signal: the port
      // returns outcomes (§7.1). Fail fast, with P4's canonical substitute (A10).
      const issues = [{ code: 'executor-threw', path: '', detail: String(err?.name ?? err) }];
      return run.unitResult(unit, classifyUnitSettlement(['internal-error'], 'call'),
        run.spec.internalErrorOutcome(request, issues), attempt);
    }
    // A10/N8: ALWAYS two fields, and `issues` are {code, path, detail} OBJECTS. On `ok:false` the
    // substitute is P4's `internalErrorOutcome`, never a hand-built one — hand-building it would
    // stringify structured issues into the ledger as "[object Object]".
    const valid = run.spec.validateUnitOutcome(request, outcome);
    if (valid.ok !== true) {
      return run.unitResult(unit, classifyUnitSettlement(['internal-error'], 'call'),
        run.spec.internalErrorOutcome(request, valid.issues), attempt);
    }
    ({ facts, phase } = run.factsFromOutcome(request, outcome));

    // §7.5 row 2 — C1. Eligibility is read off P4's ACTUAL outcome, never off an invented fact:
    //   (1) the producer classified it as `stale-placement` and declared it `retryable: true`
    //       (P4 `classifyLibraryError`: that pair happens only for `ModelPlacementChangedError`
    //       with the engine generation unchanged);
    //   (2) P6's own generation comparison agrees — the run's snapshot generation for every model
    //       the unit touches is unmoved, and P4's two bracketing reads agree with each other, so
    //       nothing changed placement under the attempt either;
    //   (3) nothing else was observed. Any other fact outranks `stale-placement` in table A
    //       (ranks 1-7) or ties at rank 8, and a unit with a second fact must SETTLE, not retry.
    // Retrying anything else would re-issue a unit whose inputs are already known to have moved.
    if (isRetryablePlacement(run, unit, outcome, facts) && attempt < maxAttempts) continue;
    const settlement = classifyUnitSettlement(facts, phase);

    // §6.4: a splittable capacity failure is a split DECISION, made by the engine — but the
    // ADMISSION is P3's (R8, review C5). P6 no longer guards with `run.plan.units.length`, which
    // never changes as runtime children are created and therefore bounded nothing.
    if (settlement.cause === 'capacity-exceeded'
        && SPLITTABLE_CAPACITY_KINDS.has(outcome.failure?.capacityKind)) {
      // A8/N17: takes the WorkUnit, never `(unitId, capacityKind)`; returns a wrapper, never null.
      const split = run.spec.plannerPort.splitUnit(run.plan, unit);
      if ('children' in split) {                          // the ONLY successful shape
        return { split, settlement: null, outcome: null, attempt };
      }
      // Test the REASON. `{reason:'unsplittable'}` is truthy, so `split !== null` would have
      // queued two `undefined` children and corrupted the ledger instead of throwing.
      const fact = SPLIT_REFUSAL_FACT[split.reason];
      if (fact === null) {                                // unsplittable: the capacity gap stands
        return run.unitResult(unit, settlement, outcome, attempt,
          { capacityKind: outcome.failure.capacityKind });
      }
      return run.unitResult(unit, classifyUnitSettlement([fact], 'call'), outcome, attempt,
        { capacityKind: outcome.failure.capacityKind, capDetail: split.capDetail ?? null });
    }
    return run.unitResult(unit, settlement, outcome, attempt,
      { capacityKind: outcome.failure?.capacityKind ?? null });
  }
  /* c8 ignore next */ throw new Error('unreachable: retry loop always returns');
}

/**
 * C1 — the whole retry-eligibility rule, in one pure-ish predicate so the protocol lives in exactly
 * one place and the tests can state it directly.
 *
 * `outcome.generations` is P4's `{start: [{modelKey, placementGeneration, bindingGeneration}],
 * end: [...]}` — the two reads that bracket the call (P4 Task P4.8). Comparing them catches a
 * placement change that landed DURING the attempt but that P4's own ctx flag did not see; comparing
 * `start` against the run-start snapshot catches one that landed between the snapshot and the
 * attempt. A run whose generation moved is `input-changed` at the unit and `invalidated` at the run
 * (§16.7 order B) — the opposite of a retry.
 */
function isRetryablePlacement(run, unit, outcome, facts) {
  if (outcome.outcome !== 'failed') return false;
  if (outcome.failure === null || outcome.failure.code !== 'stale-placement') return false;
  if (outcome.failure.retryable !== true) return false;
  if (facts.length !== 1 || facts[0] !== 'stale-placement') return false;   // (3): nothing else
  return placementGenerationsSteady(run, unit, outcome.generations);
}

/** (2): the engine's OWN placement generation for this unit's models, across all three reads. */
function placementGenerationsSteady(run, unit, generations) {
  const atSnapshot = run.snapshotGenerationsFor(unit);       // Map<modelKey, placementGeneration>
  const bySide = (side) => new Map(generations[side].map((g) => [g.modelKey, g.placementGeneration]));
  const [start, end] = [bySide('start'), bySide('end')];
  for (const [modelKey, generation] of atSnapshot) {
    if (start.get(modelKey) !== generation) return false;    // moved before the attempt
    if (end.get(modelKey) !== generation) return false;      // moved during the attempt
  }
  return true;
}
```

**Plan order over runtime descendants (I6).** P5 resolves a duplicate pair by "the lowest unit **in
plan order**" through the explicit `ctx.unitPlanRank`, and ranks everything it cannot find
`Number.MAX_SAFE_INTEGER` (fail-last). Runtime split children exist in no `plan.units` array, so a
`Map` built once at plan completion ranks every one of them last — a child of unit 1 would lose a
conflict to initial unit 2, and two children of the same parent would tie and be decided by
settlement arrival. P6 therefore defines the order **normatively** and keeps the oracle current:

> **The order.** Every live unit has a `planPath`, an array of integers: an initial unit at index
> `i` has `[i]`; the `k`-th child (`k ∈ {0,1}`, in `splitUnit`'s deterministic §6.4 order) of a unit
> with path `P` has `P.concat(k)`. Units are ordered **lexicographically by `planPath`, with a
> prefix ordered before its extensions** — so a parent precedes its own descendants, all of a
> parent's descendants precede the next initial unit, and siblings keep the split order. That is a
> strict total order on a set of distinct paths, and it is independent of unit-id *strings*, which
> is the point: `'1.0.10' < '1.0.2'` lexically, and that is the wrong order.

```js
/**
 * The oracle P6 hands P5 as `ctx.unitPlanRank`. P5's contract is `Map<unitId, number>` **or any
 * `{get(unitId) → number|undefined}`** (P5 summary), and this is the second form because the set of
 * units grows at runtime.
 *
 * Ranks are consecutive integers re-derived on every admitted split. Re-numbering is safe because
 * it is ORDER-PRESERVING: inserting two children directly after their parent never changes the
 * relative order of any two units that already existed, so a reconciliation P5 decided earlier
 * would be decided the same way now. Cost is O(n log n) per split with n ≤ `maxUnitsPerRun`, and a
 * split is already a capacity-failure path, so this is never on the hot loop.
 */
function comparePlanPaths(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;                             // a parent precedes its descendants
}

function createUnitOrder() {
  const paths = new Map();                                // unitId -> number[]
  const ranks = new Map();                                // unitId -> consecutive integer
  const renumber = () => {
    ranks.clear();
    const ordered = [...paths.entries()].sort((x, y) => comparePlanPaths(x[1], y[1]));
    ordered.forEach(([unitId], i) => ranks.set(unitId, i));
  };
  return {
    seed(unitIds) { paths.clear(); unitIds.forEach((id, i) => paths.set(id, [i])); renumber(); },
    split(parentId, childIds) {
      const parent = paths.get(parentId);
      /* c8 ignore next */ if (parent === undefined) throw new Error(`unranked split parent ${parentId}`);
      childIds.forEach((id, k) => paths.set(id, [...parent, k]));
      renumber();
    },
    get(unitId) { return ranks.get(unitId); },            // undefined ⇒ P5 ranks it last, by contract
  };
}
```

Progress commit — the single place counters move, so monotonicity is structural rather than asserted:

```js
async function applyUnitResult(run, unit, { settlement, outcome, attempt, extra }) {
  const weight = unit.pairSpaceWeight;

  // A DISCARDED or SKIPPED unit contributes NOTHING — not its results and not its diagnostics
  // (§16.3 item 3): merging a drifted unit's evidence is exactly what invariant I-scope forbids.
  //
  // C4 — THE COMMIT IS TRANSACTIONAL, AND THE ADMISSION GATE RUNS FIRST.
  // P5's accumulator exposes only a mutating `addUnit` that ANSWERS with a refusal (A12/N21:
  // `{accepted, reason?, added?}`), and that refusal is whole-unit: on `{accepted:false}` the
  // accumulator added nothing (P5 *whole-unit `maxResultsPerRun` boundary rule*; cross-file need
  // C-P5-2 below pins it as a requirement rather than an observation). There is no non-mutating
  // projection to consult, so ORDER is the transaction: ask the only refusing collaborator first,
  // and touch the irreversible ones — diagnostics, statistics, taints, progress counters — only
  // after it has accepted. The old order aggregated first and could not roll back, so a refused
  // unit still moved `caveatCount`, the statistics totals, the taint ledger, and through them
  // `integrity` and `environmentSensitive` — for a unit the plan says merged nothing.
  let unitTaints = [];
  if (settlement.merges) {
    const merge = run.results.addUnit(outcome);           // (1) the ONLY step that can refuse
    if (merge.accepted === false) {                       // reason === 'result-cap'
      // Nothing above this line mutated anything, so the re-classification starts from a clean
      // state: it re-enters with `merges: false`, skipping this whole block.
      return applyUnitResult(run, unit, {
        settlement: classifyUnitSettlement(['result-cap'], 'post'), outcome, attempt, extra,
      });
    }
    // (2) committed: from here the unit IS merged, and every remaining step is total.
    // A11/N20 + D3: ONE stateful aggregator per run, awaited per settled unit; it returns the
    // extra unit-wide taints this unit earned. There is no `aggregateDiagnostics(...)` pair.
    ({ unitTaints } = await run.spec.diagnosticAggregator.addUnit(unit.unitId, outcome));
    run.spec.statisticsAccumulator.add(outcome.statistics, outcome.durationMs);
    run.pending.unitsEvaluated += 1;
    run.pending.pairSpaceEvaluated += weight;
    run.pending.resultsFound = run.results.size();
  } else {
    run.pending.unitsFailedOrSkipped += 1;
  }

  // A17: the ledger is P3's. `recordOutcome` writes INLINE fixed-size fields only, so it can never
  // be refused by the budget (§6.5.1) — which is what makes a gap recordable when the pool is full.
  run.ledger.recordOutcome(unit.unitId, {
    outcome: settlement.outcome,
    cause: settlement.cause,
    secondaryCauses: settlement.secondaryCauses,          // deterministic by R4; see the digest note
    capacityKind: extra?.capacityKind ?? null,
    capDetail: extra?.capDetail ?? null,
    scopeProof: outcome?.scopeProof ?? 'not-checked',
    attempts: attempt,
    durationMs: outcome?.durationMs ?? 0,
  });
  // N9: `deriveUnitTaints` gets the NON-charging capacity peek; `ledger.addTaint` does the one
  // real, charging admission and owns the taint-overflow collapse (A11, A17).
  const derived = settlement.merges
    ? run.spec.deriveUnitTaints(outcome.diagnostics, {
        maxElementTaintsPerUnit: run.runOptions.maxElementTaintsPerUnit,
        admit: (n) => run.budget.discretionaryRemaining >= n,
      }).taints
    : [];
  for (const taint of [...derived, ...unitTaints]) run.ledger.addTaint(unit.unitId, taint);

  run.pending.pairSpaceProcessed += weight;               // evaluated + gaps: always advances
  const diagnostics = run.spec.diagnosticAggregator.snapshot();
  run.pending.caveatCount = diagnostics.completenessAffectingCount;
  run.pending.caveatUnclassified = diagnostics.unclassifiedOccurrences;
  // I5: U9 has NO fact and NO cause (§16.7 table A, and `classifyUnitSettlement` returns
  // `cause: null` for it). `?? 'evaluated'` invented one, and `collectReasons` turned it into
  // `unit:evaluated` on every clean run — a fabricated caveat inside `RunOutcome.reasons`, which
  // is digested into the sealed set and read by consumers as "something went wrong here".
  if (settlement.cause !== null) run.settlementState.unitCauses.push(settlement.cause);
}
```

**What happens if a step AFTER acceptance fails (C4).** `statisticsAccumulator.add`,
`ledger.recordOutcome` and the progress counters are total: §12.6's accumulator is arithmetic,
`recordOutcome` writes inline fixed-size fields and "can never be refused by the budget" (§6.5.1),
and `ledger.addTaint` answers a refusal with its own `taint-overflow` collapse rather than an
exception. The one step that can genuinely throw is `diagnosticAggregator.addUnit` (it is
asynchronous and slices). P6 does **not** attempt to un-merge the unit: the throw propagates out of
`applyUnitResult`, the loop's `catch` records `internal-error` and the run seals **`failed`** through
the R10 path. That is coherent — a `failed` run never claims `coverage: 'full'` and never supports a
no-clash claim, so a merged unit inside it misleads no one — whereas a *rolled-back* merge would
leave the accumulator's cross-unit reconciliation state (§11.4) half-applied with no P5 operation to
undo it. The rule, stated for implementers: **the only reversible decision is the one taken before
any mutation; after acceptance the unit is committed and a later failure is a run-level failure.**

**`environmentSensitiveCauses` is not accumulated here.** P5's `deriveRunOutcome` derives it at seal
from the ledger (`capacityKind === 'bucket-capacity'`, `failed:stale-placement`) and the diagnostics
summary (`geometryReadinessOccurrences`), so P6's only obligation is that `recordOutcome` above
carries those two fields. A second P6-side set would be a duplicate derivation of a §8.3 axis P5
owns — and would silently diverge the moment either rule changed.

- [ ] **Step 4: Write `test/clashtest/support/scriptedExecutor.mjs`.** `createScriptedExecutor(script)` returns a **function** (A9/N26: `UnitExecutor` is `(request) => Promise<UnitOutcome>`, not an object with `.execute`). The script maps `unitId → attempt descriptors`; each descriptor is `{ facts, pairs?, diagnostics?, statistics?, capacityKind?, scopeProof?, malformed?, hold?, generations? }` and the fake builds a §11.2-shaped `UnitOutcome` from it, recording `requests`, `startedUnits`, `maxConcurrent` and per-unit attempt numbers. **A descriptor may instead be written in P4's own outcome shape — `{ outcome, failure: {code, retryable?, capacityKind?, …}, … }` — and the fake then passes it through nearly verbatim** (C1): that is how the retry tests script `failed:stale-placement` with `retryable: true/false`, and it is what keeps P6's protocol honest against `classifyLibraryError`'s real output. Where a descriptor gives `facts`, the fake expands each fact into exactly the shape P4 would have produced for it (`failure.code` = the fact, `retryable` per P4's table, `scopeProof` for the two scope facts) — there is **no** fact spelling that P4 cannot produce, and in particular none called `placement-contention`. `generations` defaults to `{start, end}` reads that agree with the run's snapshot, so a test asserts a *changed* generation by moving the registry (`beforeUnit`), never by hand-editing one side. `createScriptedExecutor.capacityAlways(opts)` answers every unit with the same capacity failure (the nested-split boundary tests). A `shuffleFacts` option delivers a descriptor's facts in every permutation (used by P6.8/AC-21). Append the export to `support/index.mjs`; do not edit another phase's support file.

- [ ] **Step 5: Run it and watch it pass.** `node --test test/clashtest/run/progress.test.mjs`.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).** `docs: P6.5 unit execution loop and progress`.

---

### Task P6.6: Run-level consequences of a scope answer — drift, taint, invalidation (§16.3)

**Files**
- Create: `test/clashtest/run/scopeConsequences.test.mjs` — **run-level behavior only**
- Modify: `clashtest/run/Run.js` (scope answer → unit settlement → ledger → invalidation)

**Interfaces**
- *Consumes:* A4 (`Binding`, `bindingsEquivalent`, `notifyPlacementChanged`), **A7 `materializeUnit(plan, unit).scopeExpect`** (P3, the one R20-1 producer, passed through in `ExecutionRequest.materialized`), A17 (`ledger.recordOutcome`).
- *Produces:* **no new module and no new export.** This task wires the run-level half of §16.3 into `Run.js`.

> **SCOPE CHANGE — reconciliation D1, applied (review I5).** This task originally created two functions in `clashtest/run/freshness.js`: an expectation builder over `plan.models[…].scopeDigests` and a re-digest-and-compare fold. **Both are gone from P6 and both their test suites moved with them**, so this task no longer creates, imports or tests either one:
>
> | What moved | Where it lives now | Where its tests live now |
> |---|---|---|
> | The bracket **expectation**, incl. the R20-1 whole-model-source rule | P3 `planning/planner.js` :: `materializeUnit(plan, unit).scopeExpect` | `test/clashtest/planning/planner.test.mjs` (3 cases, in P3's *Verification / acceptance*) |
> | The **re-digest-and-compare** fold | P3 `planning/scopeDigest.js` :: `checkScopeBracket` | `test/clashtest/planning/scopeDigest.test.mjs` (4 cases, in P3's *Verification / acceptance*) |
> | The **per-unit** execution of the bracket (when to call, pre/post, outcome mapping) | P4 `execution/LocalUnitExecutor.js` (Task P4.8) | `test/clashtest/execution/localExecutor.scope.test.mjs` |
>
> The fold had to leave `run/` because **P4's executor calls it per unit and P4 may not import from `run/`** (P6 depends on P4; the reverse edge inverts the master's graph). The expectation had to leave because two implementations of R20-1 is exactly the drift §16.3.4's invariant I-scope cannot survive. P6 keeps only `checkScopeBracket`'s **read-time** use inside `getFreshness` (Task P6.7), where it runs over an expectation projected from the sealed provenance.
>
> **What is still P6's, and is what this task implements and tests:** how a `drift` / `unverifiable` `scopeProof` on a returned `UnitOutcome` maps onto the unit's settlement (§16.7 facts `scope-drift` / `scope-unverifiable`); that a drifted or unverifiable unit's results **and** diagnostics are discarded rather than merged; that the unit's `scopeProof` reaches its ledger `UnitRecord`; that invariant I-scope holds at the run level; and that a placement change observed against the **run snapshot** invalidates the run at the next boundary.

- [ ] **Step 1: Write the failing run-level consequence tests.**

```js
// test/clashtest/run/scopeConsequences.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun } from '../../../clashtest/run/Run.js';
import { createRunFixture } from '../support/runFixture.mjs';
import { createFakePlan } from '../support/fakePlanner.mjs';
import { createScriptedExecutor } from '../support/scriptedExecutor.mjs';

// Every case below drives the run through a SCRIPTED executor outcome. The pure question
// "does this content drift?" is P3's and is tested there; the question here is "what does a run
// DO with the answer", which is §16.3's run-level half and P6's alone.

test('a drifted unit invalidates the run, retains earlier units and merges nothing', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-drift'], scopeProof: 'drift', pairs: 4, modelKeys: ['M'] }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'invalidated');
  const [drifted, later] = summary.resultSet.ledger.units;
  assert.equal(drifted.outcome, 'discarded');
  assert.equal(drifted.cause, 'scope-drift');
  assert.equal(drifted.scopeProof, 'drift', 'the proof reaches the ledger record');
  assert.equal(summary.resultSet.results.length, 0, 'a drifted unit merges NOTHING (§16.3 item 3)');
  assert.deepEqual(fx.diagnosticAggregator.unitsAdded, [],
    'and its diagnostics are not aggregated either');
  assert.equal(later.outcome, 'not-run', 'no unit starts after the invalidating boundary');
});

test('scope-unverifiable is a GAP: the run continues and completes partial', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-unverifiable'], scopeProof: 'unverifiable', pairs: 2 }],
      '1.1': [{ facts: [] }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'discarded');
  assert.equal(summary.resultSet.ledger.units[0].scopeProof, 'unverifiable');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'evaluated', 'a later unit may succeed');
  assert.equal(summary.resultSet.results.length, 0, 'the unverifiable unit still merges nothing');
  assert.equal(handle.getSnapshot().fractionProcessed, 1, 'a gap is processed');
  assert.equal(handle.getSnapshot().fractionEvaluated, 0.5);
});

test('invariant I-scope: no evaluated unit ever carries a non-equal scopeProof', async () => {
  // §16.3.4, normative. P4's validateUnitOutcome rejects the combination at the boundary; the
  // run-level consequence is a fail-fast internal error, never a silently evaluated unit.
  for (const proof of ['drift', 'unverifiable', 'not-checked']) {
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [], forceScopeProof: proof }] }),
    });
    const { handle, begin } = createRun(fx.spec); begin();
    const summary = await handle.done;
    assert.equal(summary.status, 'failed', `evaluated + ${proof} must be rejected`);
    assert.equal(summary.resultSet.ledger.units[0].cause, 'internal-error');
    assert.equal(summary.resultSet.results.length, 0);
  }
  // and the converse holds over every sealed set this suite produced
});

test('every evaluated ledger record in ANY of these runs has scopeProof equal', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['scope-unverifiable'], scopeProof: 'unverifiable' }],
      '1.1': [{ facts: [], scopeProof: 'equal' }],
    }),
  });
  const { handle, begin } = createRun(fx.spec); begin();
  const summary = await handle.done;
  for (const u of summary.resultSet.ledger.units) {
    if (u.outcome === 'evaluated') assert.equal(u.scopeProof, 'equal');
  }
});

test('a placementGeneration change against the RUN SNAPSHOT invalidates at the next boundary', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['M'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => fx.registry.notifyPlacementChanged('M'));
  const summary = await handle.done;
  assert.equal(summary.status, 'invalidated');
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated', 'earlier units are RETAINED');
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.ok(summary.resultSet.outcome.reasons.includes('placement-changed'));
  assert.deepEqual(fx.world.destructiveCalls, [], 'observing a placement change destroys nothing');
});

test('a RELOAD (bindingGeneration bump, same modelKey) is a gap + stale, never invalidated', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['N'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: ['model-evicted'] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec); begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'completed', 'a reload does NOT invalidate (§16.3 item 1, §16.7)');
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.equal(summary.resultSet.ledger.units[1].outcome, 'evaluated');
});

test('the boundary comparison uses bindingsEquivalent, never a `dead` flag (N10)', async () => {
  // `Binding` has no `dead` property: a check written against `binding.dead` reads `undefined`
  // and treats every dead binding as live — fail-OPEN where §16.1 requires fail-closed.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1, models: ['M'] }, { unitId: '1.1', weight: 1, models: ['M'] }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => fx.registry.unregisterKey('M'));   // snapshot entry becomes null
  const summary = await handle.done;
  assert.equal(summary.resultSet.outcome.freshness, 'stale');
  assert.ok(summary.resultSet.outcome.reasons.some((r) => r.startsWith('unit:') || r === 'placement-changed')
    || summary.resultSet.outcome.freshness === 'stale');
  assert.equal(fx.registry.deadFlagReads, 0, 'nothing read a `dead` property');
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/scopeConsequences.test.mjs` ⇒ the run has no scope-answer handling yet, so the drift case seals `completed`.

- [ ] **Step 3: Map the scope answer onto the settlement in `clashtest/run/Run.js`.** The answer arrives on the returned `UnitOutcome` — P4's executor ran the bracket (D1/D2) and already mapped it onto `outcome.scopeProof` and, when it refused the call, onto `outcome.failure.code`:

```js
// clashtest/run/Run.js  (P6.6 slice)

const SCOPE_PROOF_FACT = Object.freeze({
  drift: 'scope-drift',
  unverifiable: 'scope-unverifiable',
  equal: null,
  'not-checked': null,                                    // only legal on a non-evaluated outcome
});

/**
 * Facts for ONE settled attempt, collected from committed state before anything is decided
 * (§16.7). The scope answer is one of them; it is never applied on its own.
 */
function factsFromOutcome(run, request, outcome) {
  const facts = [];
  const phase = outcome.kind === 'skipped' ? 'pre' : (outcome.failure !== null ? 'call' : 'post');
  const scopeFact = SCOPE_PROOF_FACT[outcome.scopeProof];
  if (scopeFact !== null) facts.push(scopeFact);
  if (outcome.failure !== null && UNIT_FACTS.has(outcome.failure.code)) facts.push(outcome.failure.code);
  if (run.placementChangedSince(request.unit)) facts.push('input-changed');
  if (run.worldDisposed) facts.push('world-disposed');
  return { facts, phase };
}
```

Only `merges` (U9, an `evaluated` unit with `scopeProof: 'equal'`) reaches the result accumulator
and the diagnostic aggregator — that single branch in `applyUnitResult` is what makes invariant
I-scope structural rather than asserted, and is why a drifted unit contributes neither results nor
diagnostics.

- [ ] **Step 4: Observe placement against the run snapshot at every boundary.**

```js
/**
 * §16.2/§16.3: the run compares the CURRENT binding against the one its run-start snapshot froze,
 * through P1's `bindingsEquivalent` — there is no `dead` flag to test (N10), and `null` already
 * covers dead, unregistered and lease-invalid. `placementGeneration` moving is `input-changed`
 * at the unit level and `placementChangedVsSnapshot` at the run level (§16.7 order B ⇒ invalidated);
 * `bindingGeneration` moving alone is deliberately NOT an input-change signal (§16.1 vs §16.3,
 * settled in the spec's own R-list) — it surfaces as a `model-evicted` gap and a `stale` seal.
 */
function collectBoundaryFacts(run, extra = {}) {
  const now = run.spec.coordinator.registry.snapshotBindings(run.snapshotKeys);
  run.snapshot.bindings.forEach((was, i) => {
    const is = now.bindings[i];
    if (is === null) { run.deadModelKeys.add(was.modelKey); return; }
    if (is.placementGeneration !== was.placementGeneration) {
      run.settlementState.placementChangedVsSnapshot = true;
      run.staleReasons.add(`placement-changed:${was.modelKey}`);
    } else if (!bindingsEquivalent(is, was)) {
      run.staleReasons.add(`model-reloaded:${was.modelKey}`);
    }
  });
  return { ...run.settlementState, ...extra };
}
```

- [ ] **Step 5: Compute the seal-time freshness from committed state.** §16.4 bullet 3: at seal,
`outcome.freshness = 'stale'` if any binding died, any generation moved, or any unit ended
`scope-drift`; else `'current'`. It is computed **independently of which status won** (§16.7
closing paragraph), from the ledger P3 owns and the reasons the boundary already committed:

```js
function sealTimeFreshness(run) {
  const reasons = new Set(run.staleReasons);              // committed at each boundary, above
  for (const record of run.ledger.toLedgerRecord().units) {
    if (record.cause === 'scope-drift' || record.cause === 'model-evicted') {
      reasons.add(`${record.cause}:${record.sourceModelKey}`);
    }
  }
  for (const modelKey of run.deadModelKeys) reasons.add(`model-evicted:${modelKey}`);
  return Object.freeze({
    state: reasons.size === 0 ? 'current' : 'stale',
    reasons: Object.freeze([...reasons].sort()),
  });
}
```

**Where the detailed reasons go, and where they do not (re-verification Q5).** Only `.state` reaches
`RunOutcome.freshness` (§8.3 stores the bare enum, C1/R3). The **per-model** reasons this function
computes — `placement-changed:<modelKey>`, `model-reloaded:<modelKey>`, `scope-drift:<modelKey>`,
`model-evicted:<modelKey>` — are **read-time** data: they are the shape `getFreshness` returns
(`Freshness.reasons`, §16.4 "with reasons") and the shape whose `qualifiers` explain a refused claim.
They are deliberately **not** written into the sealed `RunOutcome.reasons`, which carries only the
coarse, model-free facts `collectReasons(settlementState)` produces (`placement-changed`,
`unit:scope-drift`, `unit:model-evicted`, `planning:<cause>`, `cancel-requested`,
`engine-disposed`) — which is exactly what `sealAs` passes to `deriveRunOutcome`, and why that call
site takes `collectReasons(...)` and nothing else. Three reasons this split is the right one:

1. `RunOutcome.reasons` is **digested** (it is part of the outcome record two runs must agree on for
   AC-21); a per-model reason list makes the digest depend on model *keys*, and a reason whose
   `<modelKey>` differs between two otherwise identical runs would break the byte-identity property
   V9 asserts.
2. The sealed set already names the affected models precisely and durably, per unit, in
   `ledger.units[].taints` and `sourceModelKey` — the detail is not lost, it is stored where a
   reader can act on it.
3. Freshness is a **read-time** question. A sealed `freshness: 'stale'` is a statement about the
   moment of sealing; the reasons a consumer needs at read time come from `getFreshness`, which
   recomputes them against the live registry (§16.4, P6.7).

`sealTimeFreshness(run).reasons` therefore stays inside the run (it decides `.state`, and V21/V23
assert it through the observable seal and through `getFreshness`); nothing carries it into the
sealed `outcome.reasons`.

- [ ] **Step 6: Run it and watch it pass.** `node --test test/clashtest/run/scopeConsequences.test.mjs`.

- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).** `docs: P6.6 run-level scope consequences and invalidation`.

---

### Task P6.7: `getFreshness` — two scope passes between three registry snapshots (§16.4)

**Files**
- Modify: `clashtest/run/freshness.js`
- Create: `test/clashtest/run/freshness.test.mjs`, `test/clashtest/support/placementRegistry.mjs`, `test/clashtest/support/sealedSetFixture.mjs`

**Interfaces**
- *Consumes:* A4 (`snapshotBindings`, `registrySessionId`; `Binding` has **no `dead` flag**), A18 (`createFakeEnumerator` for the `ElementEnumerator` port), and **`checkScopeBracket` imported from `clashtest/planning/scopeDigest.js`** (P3, D1) — the *one* re-digest-and-compare implementation, which P4 also calls per unit.
- *Produces:* `sealedScopeExpect`, `getFreshness`, `Freshness`.
- *Consumed by:* P7's `engine.getFreshness` / `canClaimNoClashes` / `assessNoClashClaim`, which pass the returned **object** straight to P5's claim helpers (A16/R3) so a refusal carries §16.4's reasons.

**What snapshot₁ must be compared against (R9, review C4).** Comparing only the three *live*
snapshots detects changes that happen **during** the operation. It cannot detect a reload or a
placement change that completed **before** the operation began: all three snapshots then agree on
the same *new* generation, the scope digests exclude transforms, and the result is `current` for a
set that is demonstrably stale. §16.4 requires "all generations equal" against the sealed record,
which `provenance.models[]` carries (`bindingGeneration`, `placementGeneration`, `modelVersion`,
§13.2). So snapshot₁ is compared against the **sealed provenance values** as well:

| Comparison | Catches | Gate |
|---|---|---|
| snapshot₁ vs. sealed `modelVersion` | a host identity-contract violation (§4.2) | always — a different session does not excuse it |
| snapshot₁ vs. sealed `placementGeneration` / `bindingGeneration` | a placement change or reload **completed before the call** | only when `registrySessionId` matches — generations from another registry lifetime are not comparable, and the set is `unverifiable` for placement anyway (§13.2 `placementVerified: false`) |
| snapshot₁ vs. ₂ vs. ₃ | a change **during** the operation; placement during pass₂ needs snapshot₃ | as above |
| pass₁ and pass₂ vs. the sealed digests | content drift, incl. streaming that finished after the run | needs an enumerator; otherwise `unverifiable` |

- [ ] **Step 1: Write the failing freshness test.**

```js
// test/clashtest/run/freshness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFreshness, sealedScopeExpect } from '../../../clashtest/run/freshness.js';
import { freshnessStateOf, canClaimNoClashes, assessNoClashClaim }           // P5 (A16/R3)
  from '../../../clashtest/results/claim.js';
import { createFakeEnumerator } from '../support/index.mjs';                 // P0 (A18)
import { createPlacementRegistry } from '../support/placementRegistry.mjs';  // P6, additive
import { createSealedSetFixture } from '../support/sealedSetFixture.mjs';    // P6, over P5's shape

const twoModelSet = () => createSealedSetFixture({
  registrySessionId: 'sess-1',
  models: [
    { modelKey: 'X', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 1,
      population: { count: 2, digest: 'sha256:x' }, roots: [{ dbId: 1, subtreeDigest: 'sha256:x1' }] },
    { modelKey: 'Y', modelVersion: 'v1', bindingGeneration: 1, placementGeneration: 1,
      population: { count: 2, digest: 'sha256:y' }, roots: [{ dbId: 1, subtreeDigest: 'sha256:y1' }] },
  ],
});
const liveWorld = (set) => createFakeEnumerator({ models: set.provenance.models });

test('the read-time expectation is projected from the SEALED provenance, not from a plan', () => {
  const set = twoModelSet();
  const expect = sealedScopeExpect(set.provenance.models);
  assert.deepEqual(expect.map((e) => `${e.modelKey}/${e.scope}`),
    ['X/whole', 'X/roots', 'Y/whole', 'Y/roots']);
  assert.equal(Object.isFrozen(expect[0]), true);
  assert.equal(expect.every((e) => e.role === 'recorded'), true,
    'no planning role survives into a sealed set; the label is opaque to the comparator');
});

test('an unchanged world is current, and costs exactly two passes and three snapshots', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  const f = await getFreshness(set, { registry, enumerator });
  assert.deepEqual(f, { state: 'current', reasons: [] });
  assert.equal(Object.isFrozen(f), true);
  assert.equal(registry.snapshotCalls.length, 3, 'snapshot1, snapshot2, snapshot3');
  assert.equal(enumerator.calls.length, 2 * sealedScopeExpect(set.provenance.models).length,
    'exactly two passes over every recorded scope');
});

test('C4: a placement change COMPLETED BEFORE snapshot1 is stale, not current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');                 // the host told us, then called us
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale', 'all three live snapshots agree — only the SEALED value differs');
  assert.deepEqual(f.reasons, ['placement-changed:X']);
});

test('C4: a RELOAD completed before snapshot1 is stale, not current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.reload('X');                                  // bindingGeneration bump, same content
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['model-reloaded:X']);
});

test('a model changed BETWEEN pass1 and pass2 is caught by the second pass', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  // X is digested first; mutate X while Y is being digested in pass 1 -> pass 2 disagrees.
  enumerator.onCall(({ modelKey, method }) => {
    if (method === 'digestScope' && modelKey === 'Y') {
      enumerator.set('X', { population: { count: 3, digest: 'sha256:x-grown' } });
    }
  });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['scope-drift:X']);
});

test('a placement change landing DURING pass2 is caught only by snapshot3', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  let pass = 0;
  enumerator.onCall(({ modelKey, index }) => { if (index === 0) pass += 1; });
  enumerator.onCall(({ modelKey }) => { if (modelKey === 'Y' && pass === 2) registry.notifyPlacementChanged('X'); });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'stale');
  assert.deepEqual(f.reasons, ['placement-changed:X']);
  assert.equal(registry.snapshotCalls.length, 3);
});

test('an UNRELATED model registered between the snapshots leaves the result current', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.onSnapshot(2, () => registry.register('Z', {}, { modelVersion: 'v1' }));
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.equal(f.state, 'current', 'only TOUCHED bindings matter (§16.4)');
});

test('a dead binding, a reload and a modelVersion conflict are each stale with their own reason', async () => {
  for (const [mutate, reason] of [
    [(r) => r.unregisterKey('X'), 'model-evicted:X'],     // null: dead, unregistered or lease-invalid
    [(r) => r.reload('X'), 'model-reloaded:X'],
    [(r) => r.setVersion('X', 'v2'), 'model-version-conflict:X'],
  ]) {
    const set = twoModelSet();
    const registry = createPlacementRegistry(set);
    mutate(registry);
    const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
    assert.equal(f.state, 'stale', reason);
    assert.ok(f.reasons.includes(reason), `${reason} not in ${f.reasons}`);
  }
});

test('no enumerator, or an uncomputable digest, is at best unverifiable — never current', async () => {
  const set = twoModelSet();
  assert.equal((await getFreshness(set, { registry: createPlacementRegistry(set) })).state, 'unverifiable');
  const broken = liveWorld(set);
  broken.set('X', { throws: new Error('tree unavailable') });
  const f = await getFreshness(set, { registry: createPlacementRegistry(set), enumerator: broken });
  assert.equal(f.state, 'unverifiable');
  assert.ok(f.reasons.includes('scope-unverifiable:X'));
});

test('a definite change BEATS "could not tell"', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');
  const broken = liveWorld(set);
  broken.set('Y', { throws: new Error('tree unavailable') });
  const f = await getFreshness(set, { registry, enumerator: broken });
  assert.equal(f.state, 'stale', 'stale wins over unverifiable when both are observed');
});

test('a set from a DIFFERENT registry session is unverifiable, but a version conflict still makes it stale', async () => {
  const set = twoModelSet();
  const other = createPlacementRegistry(set, { registrySessionId: 'some-other-session' });
  assert.equal((await getFreshness(set, { registry: other, enumerator: liveWorld(set) })).state, 'unverifiable');
  other.setVersion('X', 'v2');
  const f = await getFreshness(set, { registry: other, enumerator: liveWorld(set) });
  assert.equal(f.state, 'stale');
  assert.ok(f.reasons.includes('model-version-conflict:X'));
});

test('a cross-session set does NOT report a foreign generation as placement-changed', async () => {
  // Generation counters are session-local (§13.2 `placementVerified: false`); comparing them
  // across lifetimes would manufacture a reason rather than report one.
  const set = twoModelSet();
  const other = createPlacementRegistry(set, { registrySessionId: 'some-other-session' });
  other.notifyPlacementChanged('X');
  const f = await getFreshness(set, { registry: other, enumerator: liveWorld(set) });
  assert.equal(f.state, 'unverifiable');
  assert.deepEqual(f.reasons, ['registry-session-mismatch']);
});

test('the result is the OBJECT P5\'s claim helpers accept, and its state is what §8.3 digests', async () => {
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  registry.notifyPlacementChanged('X');
  const f = await getFreshness(set, { registry, enumerator: liveWorld(set) });
  assert.deepEqual(Object.keys(f).sort(), ['reasons', 'state']);      // R3
  assert.equal(freshnessStateOf(f), 'stale');                         // A16, P5's one adapter
  assert.equal(canClaimNoClashes(set, f), false, 'not current ⇒ not claimable');
  assert.ok(assessNoClashClaim(set, f).qualifiers.some((q) => JSON.stringify(q).includes('placement-changed:X')),
    'the object form carries its reasons into the refusal (§16.4 "with reasons")');
});

test('DOCUMENTED LIMIT (OQ-19, §16.3 item 5): an A->B->A excursion between the two passes is NOT detected', async () => {
  // This asserts the ACCEPTED residual, not a defect: a population that changes and reverts wholly
  // between pass1 and pass2 is invisible to any caller-side mechanism (F18). If this test ever
  // fails because the result became `stale`, the proof got STRONGER — update the test and
  // provenance.scopeProof.method deliberately, do not weaken the check back.
  const set = twoModelSet();
  const registry = createPlacementRegistry(set);
  const enumerator = liveWorld(set);
  let fired = false;
  enumerator.onCall(({ modelKey }) => {
    if (modelKey === 'Y' && !fired) {
      fired = true;
      enumerator.set('X', { population: { count: 3, digest: 'sha256:x-B' } });   // A -> B
      enumerator.set('X', { population: { count: 2, digest: 'sha256:x' } });     // B -> A
    }
  });
  const f = await getFreshness(set, { registry, enumerator });
  assert.equal(f.state, 'current', 'accepted residual: the bracket is not continuous');
  assert.equal(set.provenance.scopeProof.method, 'bracketed-digest');
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/freshness.test.mjs` ⇒ `getFreshness is not a function`.

- [ ] **Step 3: Implement `sealedScopeExpect` and `getFreshness`.**

```js
// clashtest/run/freshness.js
//
// Spec §16.4 — read-time freshness as a bracketed WHOLE-OPERATION check:
//   snapshot1 -> pass1 -> snapshot2 -> pass2 -> snapshot3
// `current` only when every bracket agrees AND snapshot1 still matches the SEALED provenance.
// A definite change always beats "could not tell".
//
// The re-digest-and-compare half is P3's `checkScopeBracket` (duplicate-ownership D1) — the same
// function P4's executor calls per unit, so the per-unit proof and the read-time proof are one
// implementation and cannot diverge. This module contributes only the read-time expectation, the
// registry comparisons, and the fold into a `Freshness`.

import { checkScopeBracket } from '../planning/scopeDigest.js';

const STALE = 'stale';
const UNVERIFIABLE = 'unverifiable';
const CURRENT = 'current';

/**
 * Project the SEALED `provenance.models[].scopeDigests` into the entry shape the comparator takes.
 * This applies no planning rule — in particular it does not re-derive R20-1 (P3's `materializeUnit`
 * owns that, D1): the sealed record already lists exactly the scopes the run bracketed, so a
 * whole-model source's population row is present here iff the planner emitted it.
 */
export function sealedScopeExpect(models) {
  const out = [];
  for (const m of models) {
    if (m.scopeDigests.population !== null) {
      out.push(Object.freeze({
        modelKey: m.modelKey, role: 'recorded', scope: 'whole',
        population: Object.freeze({ ...m.scopeDigests.population }),
      }));
    }
    if (m.scopeDigests.roots.length > 0) {
      out.push(Object.freeze({
        modelKey: m.modelKey, role: 'recorded', scope: 'roots',
        roots: Object.freeze(m.scopeDigests.roots.map(({ dbId, subtreeDigest }) =>
          Object.freeze({ dbId, subtreeDigest }))),
      }));
    }
  }
  return Object.freeze(out);
}

/** A4: positions match the input keys, and a `null` entry means dead | unregistered | lease-invalid. */
// P3's `checkScopeBracket` takes `bindings` as a `Map<modelKey, Binding|null>` (its lookup is by
// `entry.modelKey`), while P1's `snapshotBindings` returns a POSITIONAL array aligned to `keys`
// (R7). Building the Map is therefore the caller's job — P4 passes its own `resolved.byKey`.
const bindingMap = (keys, snapshot) => new Map(keys.map((k, i) => [k, snapshot.bindings[i]]));

function foldBracket({ proof, modelKeys }, stale, unverifiable) {
  if (proof === 'drift') for (const k of modelKeys) stale.add(`scope-drift:${k}`);
  else if (proof === 'unverifiable') for (const k of modelKeys) unverifiable.add(`scope-unverifiable:${k}`);
}

/** Two LIVE snapshots, in order. There is no `dead` flag to test (N10). */
function compareSnapshots(keys, a, b, stale) {
  keys.forEach((key, i) => {
    const before = a.bindings[i];
    const after = b.bindings[i];
    if (before === null || after === null) { stale.add(`model-evicted:${key}`); return; }
    if (after.modelVersion !== before.modelVersion) { stale.add(`model-version-conflict:${key}`); return; }
    if (after.placementGeneration !== before.placementGeneration) { stale.add(`placement-changed:${key}`); return; }
    if (after.bindingGeneration !== before.bindingGeneration) stale.add(`model-reloaded:${key}`);
  });
}

/**
 * R9 / review C4 — snapshot1 against the SEALED provenance. Without this, a change that COMPLETED
 * before the call began is invisible: every live snapshot carries the same new generation and the
 * digests match, because scope digests exclude transforms.
 *
 * `modelVersion` is compared unconditionally (a host identity-contract violation, §4.2, is not
 * excused by a different session). The two generation counters are session-local, so they are
 * compared only when the registry session matches the sealed one.
 */
function compareToSealed(models, snapshot, { sameSession }, stale) {
  models.forEach((recorded, i) => {
    const live = snapshot.bindings[i];
    if (live === null) { stale.add(`model-evicted:${recorded.modelKey}`); return; }
    if (live.modelVersion !== recorded.modelVersion) {
      stale.add(`model-version-conflict:${recorded.modelKey}`); return;
    }
    if (!sameSession) return;
    if (live.placementGeneration !== recorded.placementGeneration) {
      stale.add(`placement-changed:${recorded.modelKey}`); return;
    }
    if (live.bindingGeneration !== recorded.bindingGeneration) {
      stale.add(`model-reloaded:${recorded.modelKey}`);
    }
  });
}

export async function getFreshness(resultSet, { registry, enumerator, ctx = { checkpoint() {} } } = {}) {
  const models = resultSet.provenance.models;
  const keys = models.map((m) => m.modelKey);
  const expect = sealedScopeExpect(models);
  const stale = new Set();
  const unverifiable = new Set();

  const sameSession = registry.registrySessionId === resultSet.provenance.registrySessionId;
  if (!sameSession) unverifiable.add('registry-session-mismatch');   // placement cannot be checked
  if (enumerator === undefined || enumerator === null) unverifiable.add('no-enumerator');

  const snapshot1 = registry.snapshotBindings(keys);
  compareToSealed(models, snapshot1, { sameSession }, stale);        // R9
  if (enumerator) {
    foldBracket(await checkScopeBracket(expect, { enumerator, bindings: bindingMap(keys, snapshot1), ctx }),
      stale, unverifiable);
  }

  const snapshot2 = registry.snapshotBindings(keys);
  compareSnapshots(keys, snapshot1, snapshot2, stale);
  if (enumerator) {
    // Each pass is compared against the SEALED expectation, which is strictly stronger than
    // comparing the two passes to each other: any change that persists into either pass differs
    // from the sealed value. The one case neither catches is the declared A->B->A residual.
    foldBracket(await checkScopeBracket(expect, { enumerator, bindings: bindingMap(keys, snapshot2), ctx }),
      stale, unverifiable);
  }

  const snapshot3 = registry.snapshotBindings(keys);                 // ONLY this sees a late placement change
  compareSnapshots(keys, snapshot2, snapshot3, stale);

  if (stale.size > 0) return Object.freeze({ state: STALE, reasons: Object.freeze([...stale].sort()) });
  if (unverifiable.size > 0) {
    return Object.freeze({ state: UNVERIFIABLE, reasons: Object.freeze([...unverifiable].sort()) });
  }
  return Object.freeze({ state: CURRENT, reasons: Object.freeze([]) });
}
```

- [ ] **Step 4: Write the two support files.** `createPlacementRegistry(set, {registrySessionId?})` extends P0's `createFakeRegistry` shape with `placementGeneration`/`bindingGeneration`, the mutators the table above needs (`notifyPlacementChanged`, `reload`, `setVersion`, `unregisterKey`, `register`), an `onSnapshot(n, fn)` hook and a `snapshotCalls` log; `createSealedSetFixture({models, registrySessionId})` builds a minimal set over **P5's** pinned shape (`provenance.models[]` with `bindingGeneration`/`placementGeneration`/`scopeDigests`, `provenance.scopeProof.method: 'bracketed-digest'`). Both are **new files** appended to `support/index.mjs` (P0 extension rule 2); P0's own `createFakeRegistry` is not modified.

- [ ] **Step 5: Run it and watch it pass.** `node --test test/clashtest/run/freshness.test.mjs`.

- [ ] **Step 6: Checkpoint commit (only if the user has authorized commits).** `docs: P6.7 coherent read-time freshness`.

---

### Task P6.8: Sealing, the `done`/`persisted` window, the cancellation matrix and `dispose()` (§10.2, §13.5.1, §16.7 C, §15.1)

**Files**
- Modify: `clashtest/run/Run.js`
- Modify: `test/clashtest/run/lifecycle.test.mjs`

**Interfaces**
- *Consumes:* A11 (`diagnosticAggregator.snapshot()`, `statisticsAccumulator.snapshot()`), A12 (`buildResultSet`), A13 (`sealResultSet(draft, {slicer})`, `deriveRunOutcome`), A14 (`residency.admitSealedSet` / `releaseRunSlot` / `drainForDispose`), A15 (`residency.beginPersist(runId, {persist})` — **never rejects** — and `getPersistenceState(runId)`; there is no free `startPersistence` and no returned `snapshot()` closure), A17 (`ledger.toLedgerRecord()`), `collectReasons`/`resolveRunStatus` (P6.1).
- *Produces:* `RunHandle.cancel/done/persisted`, `RunSummary`, the `finalizing` window, the terminal internal-error fallback (R10), `DisposeSummary` contributions.

- [ ] **Step 1: Write the failing terminal-window and matrix tests.**

```js
// appended to test/clashtest/run/lifecycle.test.mjs
test('cancel BETWEEN units: no unit starts after the request; unstarted units are not-run:cancelled', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }, { unitId: '1.2', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }], '1.1': [{ facts: [] }], '1.2': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.afterUnit('1.0', () => handle.cancel('user'));
  const summary = await handle.done;
  assert.equal(summary.status, 'cancelled');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
  assert.equal(summary.resultSet.ledger.units[0].outcome, 'evaluated');
  assert.deepEqual(summary.resultSet.ledger.units.slice(1).map((u) => `${u.outcome}:${u.cause}`),
    ['not-run:cancelled', 'not-run:cancelled']);
  assert.equal(summary.resultSet.outcome.coverage, 'partial');
  assert.deepEqual(fx.world.destructiveCalls, [], 'cancel never evicts, disposes or invalidates');
});

test('cancel DURING an in-flight unit: the unit is DRAINED and merged', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], pairs: 3, hold: true }], '1.1': [{ facts: [] }] }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const cancelPromise = handle.cancel('user');
  assert.equal(handle.getSnapshot().status, 'cancelling');
  fx.executor.release('1.0');
  const summary = await cancelPromise;
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.results.length, 3, 'the drained unit IS merged');
  assert.deepEqual(fx.executor.startedUnits, ['1.0']);
});

test('cancel is idempotent, first reason wins, and terminal cancel is a no-op', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const first = handle.cancel('first');
  const second = handle.cancel('second');
  const a = await first; const b = await second;
  assert.equal(a, b, 'the same summary object');
  assert.ok(a.resultSet.outcome.reasons.includes('cancel-requested'));
  assert.equal((await handle.cancel('third')), a);
});

test('matrix C: an in-flight unit settling under a pending cancel follows the fixed order', async () => {
  const rows = [
    { facts: [], merges: true, unit: 'evaluated', status: 'cancelled' },
    { facts: ['capacity-exceeded'], merges: false, unit: 'failed', status: 'cancelled' },
    { facts: ['scope-unverifiable'], merges: false, unit: 'discarded', status: 'cancelled' },
    { facts: ['model-evicted'], merges: false, unit: 'failed', status: 'cancelled' },
    { facts: ['scope-drift'], merges: false, unit: 'discarded', status: 'invalidated' },
    { facts: ['input-changed'], merges: false, unit: 'discarded', status: 'invalidated' },
    { facts: ['result-cap'], merges: false, unit: 'failed', status: 'failed' },
    { facts: ['internal-error'], merges: false, unit: 'failed', status: 'failed' },
    { facts: ['world-disposed'], merges: false, unit: 'failed', status: 'failed' },
  ];
  for (const requester of ['cancel', 'dispose']) {
    for (const row of rows) {
      const fx = createRunFixture({
        plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
        executor: createScriptedExecutor({ '1.0': [{ facts: row.facts, pairs: 2, hold: true }] }),
      });
      const { handle, controller, begin } = createRun(fx.spec);
      begin();
      await fx.executor.inFlight('1.0');
      // C3: dispose reaches the run through the ENGINE-ONLY controller, never through the handle.
      if (requester === 'cancel') handle.cancel('user'); else fx.requestDispose(controller);
      fx.executor.release('1.0');
      const summary = await handle.done;
      const label = `${requester} + ${row.facts.join('+') || 'evaluated'}`;
      assert.equal(summary.status, row.status, label);
      assert.equal(summary.resultSet.ledger.units[0].outcome, row.unit, label);
      assert.equal(summary.resultSet.results.length, row.merges ? 2 : 0, label);
      assert.ok(summary.resultSet.outcome.reasons.includes(
        requester === 'cancel' ? 'cancel-requested' : 'engine-disposed'), label);
    }
  }
});

/** Every ordering of a fact list — the fake executor delivers the facts in each of them. */
function* permutations(items) {
  if (items.length <= 1) { yield [...items]; return; }
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) yield [items[i], ...tail];
  }
}

test('the same facts in EVERY delivery order produce a byte-identical sealed set', async () => {
  const facts = ['model-evicted', 'scope-unverifiable', 'world-disposed'];
  const seals = [];
  for (const order of permutations(facts)) {
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: order, shuffleFacts: true }] }),
    });
    const { handle, begin } = createRun(fx.spec);
    begin();
    handle.cancel('user');
    seals.push((await handle.done).resultSet);
  }
  for (const set of seals) {
    assert.equal(set.outcome.status, seals[0].outcome.status);
    assert.equal(set.ledger.units[0].cause, seals[0].ledger.units[0].cause);
    // R4: the tie-break makes even the secondary list order-independent, so this is a stronger
    // assertion than "the digest ignores it" — and it is the property AC-21 actually needs.
    assert.deepEqual(set.ledger.units[0].secondaryCauses, seals[0].ledger.units[0].secondaryCauses);
    assert.equal(set.digests.ledgerDigest, seals[0].digests.ledgerDigest);
    assert.equal(set.digests.pairSetDigest, seals[0].digests.pairSetDigest);
  }
});

test('done resolves at first persistence settle, exactly once, never rejecting', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    // A15: the store is bound into P5's residency manager, not carried on the RunSpec.
    resultStore: { put: async () => { throw new Error('backend exploded'); } } });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;                       // resolves, does NOT reject
  assert.equal(summary.status, 'completed');
  assert.equal(summary.persistence.state, 'failed');
  assert.equal(summary.persistence.timedOut, false);
  assert.deepEqual(await handle.persisted, { state: 'failed', error: summary.persistence.error });
  assert.equal(await handle.done, summary, 'settles exactly once');
  assert.deepEqual(fx.residency.beginPersistCalls, [{ runId: handle.runId, persist: true }],
    'the attempt is driven through residency.beginPersist, never a free startPersistence');
});

test('R10: a failure while BUILDING or SEALING the set still settles done, exactly once', async () => {
  for (const failAt of ['buildResultSet', 'sealResultSet', 'admitSealedSet']) {
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
      failSeal: failAt,                                    // the fixture throws from that P5 call
    });
    const { handle, begin } = createRun(fx.spec);
    begin();
    const summary = await handle.done;                     // must NOT hang and must NOT reject
    assert.equal(summary.status, 'failed', failAt);
    assert.ok(summary.resultSet === null || summary.resultSet.outcome.status === 'failed', failAt);
    assert.ok(summary.resultSet === null
      || summary.resultSet.outcome.reasons.includes('unit:internal-error'), failAt);
    assert.equal(await handle.done, summary, 'still exactly once');
    assert.equal(handle.getSnapshot().status, 'failed');
    assert.equal(handle.getSnapshot().phase, 'terminal');
    // R10: the slot is freed on every path that ends without an admitted set.
    const admitted = fx.residency.admitted.includes(handle.runId);
    assert.equal(admitted || fx.residency.released.includes(handle.runId), true, failAt);
  }
});

test('R10: a build failure does not leave a half-sealed run that a later cancel can re-seal', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    failSeal: 'sealResultSet',
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const first = await handle.done;
  const second = await handle.cancel('too late');
  assert.equal(second, first, 'terminal is absorbing even after a seal failure');
  assert.equal(fx.residency.released.filter((id) => id === handle.runId).length <= 1, true,
    'the slot is released at most once');
});

test('a hanging store times out the WAIT, never the write; persisted still settles later', async () => {
  let settle;
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    limits: { persistTimeoutMs: 5000 },
    resultStore: { put: () => new Promise((r) => { settle = r; }) },
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  await fx.sealed();
  assert.equal(handle.getSnapshot().phase, 'finalizing');
  assert.equal(handle.getSnapshot().status, 'completed');
  fx.clock.advance(5000); await fx.clock.drainTimers();
  const summary = await handle.done;
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true },
  );
  assert.equal(handle.getSnapshot().phase, 'terminal');
  settle();
  assert.deepEqual(await handle.persisted, { state: 'saved' });
});

test('the terminal state event is emitted EXACTLY ONCE, after seal, before done resolves', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, begin } = createRun(fx.spec);
  const order = [];
  handle.subscribe((ev) => { if (ev.type === 'state' && ev.terminal) order.push('terminal-event'); });
  handle.done.then(() => order.push('done'));
  begin();
  await handle.done; await Promise.resolve();
  assert.deepEqual(order, ['terminal-event', 'done']);
});

test('environmentSensitiveCauses is ascending, exact, and drives the boolean', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    runOptions: { maxPlacementRetries: 0 },
    executor: createScriptedExecutor({
      '1.0': [{ facts: ['capacity-exceeded'], capacityKind: 'bucket-capacity' }],
      // C1: with `maxPlacementRetries: 0` the first attempt IS the last, so P4's retryable
      // `stale-placement` outcome settles immediately as the `failed:stale-placement` gap that
      // P5 derives the environmental cause from. P6 writes no `placement-contention` anywhere.
      '1.1': [{ outcome: 'failed', failure: { code: 'stale-placement', retryable: true } }],
    }),
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.deepEqual(summary.resultSet.ledger.units.map((u) => u.cause),
    ['capacity-exceeded', 'stale-placement'], 'the LEDGER carries the unit causes …');
  assert.deepEqual(summary.resultSet.outcome.environmentSensitiveCauses,
    ['bucket-capacity', 'placement-contention'], '… and P5 derives the environmental causes');
  assert.equal(summary.resultSet.outcome.environmentSensitive, true);
});

test('dispose forces the finalizing window closed and hands back unsaved sets', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }] }),
    resultStore: { put: () => new Promise(() => {}) },        // never settles
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const disposeSummary = fx.requestDispose(controller);
  fx.executor.release('1.0');                                 // drain, then seal
  const summary = await handle.done;                          // forced closed, NOT after 5s
  assert.equal(summary.status, 'cancelled');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true },
  );
  const disposed = await disposeSummary;
  assert.deepEqual(disposed.droppedUnsaved.map((d) => d.runId), [handle.runId]);
  assert.deepEqual(disposed.persistenceInFlight, [handle.runId]);
  assert.equal(disposed.droppedUnsaved[0].resultSet.sealed, true);
  assert.equal(fx.emitter.listenerReleaseOrder[0], 'terminal-event',
    'no listener is released before the terminal event');
});

test('C3: the dispose control surface is engine-only and NOT reachable from RunHandle', async () => {
  const fx = createRunFixture({ plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }) });
  const { handle, controller } = createRun(fx.spec);
  assert.deepEqual(Object.keys(handle).sort(),
    ['cancel', 'done', 'getSnapshot', 'persisted', 'runId', 'subscribe'],
    'exactly the §18 members');
  assert.equal(Reflect.ownKeys(handle).includes('requestDispose'), false,
    'not there even as a non-enumerable property');
  assert.equal(handle.requestDispose, undefined);
  assert.equal(typeof controller.requestDispose, 'function');
  assert.equal(Object.isFrozen(handle) && Object.isFrozen(controller), true);
});

test('C3: requestDispose settles a run whose executor is BLOCKED, once the unit drains', async () => {
  // The review's scenario: an engine disposing while a unit is in flight and persistence never
  // settles. Without the controller the run never learns `disposeRequested`, never stops issuing
  // the remaining units, and `dispose()` waits for `persistTimeoutMs` — or forever, if the store
  // hangs and nothing forces the window.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }, { unitId: '1.1', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [], hold: true }], '1.1': [{ facts: [] }] }),
    resultStore: { put: () => new Promise(() => {}) },        // never settles
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.executor.inFlight('1.0');
  const disposed = controller.requestDispose();
  assert.equal(await Promise.race([disposed, Promise.resolve('pending')]), 'pending',
    'an in-flight unit is DRAINED, never abandoned (§10.1, F6)');
  fx.executor.release('1.0');
  const summary = await disposed;
  assert.equal(summary, await handle.done, 'the controller resolves with the run\'s own summary');
  assert.equal(summary.status, 'cancelled');
  assert.ok(summary.resultSet.outcome.reasons.includes('engine-disposed'));
  assert.deepEqual(fx.executor.startedUnits, ['1.0'], 'no unit started after the dispose');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true }, 'the window was FORCED, not timed out by the clock');
  assert.equal(fx.clock.now(), fx.clock.peek(), 'and no timer had to fire to get there');
  assert.equal(await controller.requestDispose(), summary, 'idempotent');
});

test('C3: a dispose that lands DURING the seal still closes the window', async () => {
  // The interval the review names: `sealStarted` is true, `forceFinalize` does not exist yet.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    resultStore: { put: () => new Promise(() => {}) },
    holdAt: 'sealResultSet',                                  // the fixture parks inside the seal
  });
  const { handle, controller, begin } = createRun(fx.spec);
  begin();
  await fx.reached('sealing');
  const disposed = controller.requestDispose();
  fx.release('sealResultSet');
  const summary = await disposed;
  assert.equal(summary.status, 'completed', 'the seal had already decided the status');
  assert.deepEqual(
    { state: summary.persistence.state, timedOut: summary.persistence.timedOut },
    { state: 'pending', timedOut: true }, 'the window closed at once, not after persistTimeoutMs');
  assert.equal(await handle.done, summary);
  assert.equal(handle.getSnapshot().phase, 'terminal');
});

test('I8: an admitSealedSet that throws BEFORE mutating releases the slot exactly once', async () => {
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    admitSealedSet: 'throws-before',        // fake residency: throws, getResident stays null
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(fx.residency.released.filter((id) => id === handle.runId).length, 1,
    'released once — never leaked, never double-freed');
  assert.deepEqual(fx.residency.admitted, [], 'nothing was admitted under this id');
  assert.equal(summary.resultSet, null, 'O7: the fallback could not admit either');
});

test('I8: an admitSealedSet that throws AFTER converting keeps the resident set and releases nothing', async () => {
  // Residency converted the reservation and then an observer callback threw. Releasing here would
  // free a live resident set; re-admitting a fallback set under the same id would be a second
  // admission. P6 asks `getResident(runId)` and adopts the answer.
  const fx = createRunFixture({
    plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
    executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
    admitSealedSet: 'throws-after',        // converts, then throws from an observer
  });
  const { handle, begin } = createRun(fx.spec);
  begin();
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(fx.residency.released, [], 'the converted slot is NEVER released here');
  assert.deepEqual(fx.residency.admitted, [handle.runId], 'admitted exactly once');
  assert.equal(summary.resultSet, fx.residency.getResident(handle.runId),
    'the summary carries the set residency actually holds');
  assert.equal(summary.resultSet.sealed, true);
  assert.equal(await handle.done, summary, 'still settles exactly once');
});

test('I9: a listener on the terminal event already sees the terminal snapshot', async () => {
  for (const failSeal of [undefined, 'sealResultSet']) {      // normal close AND the R10 fallback
    const fx = createRunFixture({
      plan: createFakePlan([{ unitId: '1.0', weight: 1 }]),
      executor: createScriptedExecutor({ '1.0': [{ facts: [] }] }),
      failSeal,
    });
    const { handle, begin } = createRun(fx.spec);
    const seen = [];
    handle.subscribe((ev) => {
      if (ev.type === 'state' && ev.terminal) seen.push({ ev, snap: handle.getSnapshot() });
    });
    begin();
    const summary = await handle.done;
    assert.equal(seen.length, 1, `${failSeal ?? 'normal'}: exactly one terminal event`);
    const [{ ev, snap }] = seen;
    assert.equal(snap.phase, 'terminal',
      `${failSeal ?? 'normal'}: a UI reading the snapshot from the event must not see 'finalizing'`);
    assert.equal(snap.status, summary.status);
    assert.equal(ev.status, snap.status, 'the event and the committed snapshot agree');
    assert.equal(Object.hasOwn(snap, 'persistence'), false,
      '§9.1 RunProgress is a closed shape: persistence rides on the event and the summary');
    assert.deepEqual(ev.persistence, summary.persistence,
      'the final persistence state is announced with the terminal event');
    assert.equal(snap.seq, ev.seq, 'the commit IS the state change the event reports');
  }
});
```

- [ ] **Step 2: Run it and watch it fail.** `node --test test/clashtest/run/lifecycle.test.mjs` ⇒ `handle.done` never settles (no finalize window).

- [ ] **Step 3: Implement sealing and the finalize window in `clashtest/run/Run.js`.**

```js
// clashtest/run/Run.js  (P6.8 slice)

/**
 * §8.1: "Terminal states are absorbing; a Result Set is sealed EXACTLY ONCE."
 *
 * R10 / review I4 — two flags, not one. `sealStarted` is the re-entrancy guard (a second caller
 * gets the same `done` promise, never a half-built `run.summary` that is still `undefined`).
 * `run.sealed` — the flag every other path reads as "this run is finished and immutable" — is set
 * only once the final immutable set actually exists. Between them lies asynchronous work that CAN
 * throw: `buildResultSet` walks P6's records, `sealResultSet` digests and deep-freezes, and
 * `admitSealedSet` touches residency. §13.5.1 item 1 says `done` "resolves exactly once and never
 * rejects for any run or persistence outcome" — so every one of those failures must still settle.
 */
async function sealAs(run, status) {
  if (run.sealStarted) return run.donePromise;             // terminal is ABSORBING; first seal wins
  run.sealStarted = true;
  run.transition(status);                                  // status change; phase becomes 'finalizing'
  run.setPhase('finalizing');

  let resultSet = null;
  try {
    const freshness = sealTimeFreshness(run);              // computed regardless of which status won
    const diagnostics = run.spec.diagnosticAggregator.snapshot();          // A11
    // A13: P5 derives coverage / integrity / environmentSensitive(+Causes); P6 supplies only the
    // three fields §16.7 and §16.4 make its own, and `freshness` is the BARE state (§8.3, C1).
    const outcome = run.spec.resultPort.deriveRunOutcome({
      status,
      freshness: freshness.state,
      reasons: collectReasons(run.settlementState),
      ledger: run.ledger.toLedgerRecord(),                 // A17
      diagnostics,
      results: run.results.toArray(),                      // A12
    });
    // A12/N21 then A13/N22: assemble the draft, then seal it. `sealResultSet` takes ONLY
    // `{slicer}` — the outcome and diagnostics are already inside the draft by construction, so
    // passing them again would be silently ignored.
    const draft = run.spec.resultPort.buildResultSet(resultParts(run, outcome, diagnostics));
    resultSet = await run.spec.resultPort.sealResultSet(draft, { slicer: run.slicer() });
    // A14/N23: converts the slot P7 reserved at admission into an ordinary resident set (§13.1).
    // I8: `admitSealedSet` is required to be atomic and exception-safe (cross-file need C-P5-1);
    // P6's recovery assumes NOTHING beyond that, and re-reads residency rather than guessing.
    run.spec.resultPort.residency.admitSealedSet(run.runId, resultSet);
    run.reservationSettled = true;                                // the reservation is now a resident set
    run.sealed = true;                                     // ONLY now: the final set exists
  } catch (error) {
    return terminalInternalError(run, error);
  }

  // Persistence starts AFTER the seal and never alters the outcome (§13.5).
  // A15/N24: driven through the residency manager, which already holds the store. It NEVER
  // rejects, so the `.then` below needs no rejection handler to keep `done` safe.
  const attempt = run.spec.resultPort.residency.beginPersist(run.runId, {
    persist: run.runOptions.persist,
  });
  attempt.then((o) => { run.resolvePersisted(o); run.emit('persistence', { ...o, seq: run.bumpSeq() }); });

  await openFinalizeWindow(run, attempt, resultSet);
  return run.summary;
}

/**
 * R10 — the terminal fallback. Reached only when sealing itself failed, which means the run has no
 * trustworthy Result Set. It settles `done` ONCE with `failed` / `internal-error`, releases the
 * reserved residency slot (nothing was admitted, so nothing will release it later), and emits the
 * terminal event first, exactly like the normal path.
 *
 * It makes ONE attempt at a minimal, unit-free set so callers still get a readable artifact; if
 * that also throws, the summary carries `resultSet: null`. That is a deliberate, documented
 * deviation from `RunSummary.resultSet` always being a set (§13.5.1): the only alternative is
 * rejecting `done`, which the same sentence forbids outright. Recorded as open item O7.
 */
async function terminalInternalError(run, error) {
  run.settlementState.unitCauses.push('internal-error');
  // I8, FIRST: the failure that brought us here may have been `admitSealedSet` itself, and an
  // atomic admission can still throw AFTER converting the reservation (an observer hook, a report
  // callback). Building a second set and admitting it under the SAME runId would be a double
  // admission; releasing the slot would free a live resident set. So ask residency what it holds,
  // and if it already holds this run's set, adopt it and stop.
  const resident = run.spec.resultPort.residency.getResident(run.runId);
  if (resident !== null) {
    run.reservationSettled = true;
    run.sealed = true;
    return finishTerminalInternalError(run, resident);
  }
  let resultSet = null;
  try {
    const outcome = run.spec.resultPort.deriveRunOutcome({
      status: 'failed',
      freshness: 'unverifiable',
      reasons: collectReasons(run.settlementState),
      ledger: emptyLedgerRecord(run),
      diagnostics: emptyDiagnosticsSummary(),
      results: [],
    });
    const draft = run.spec.resultPort.buildResultSet({
      ...resultParts(run, outcome, emptyDiagnosticsSummary()),
      ledger: emptyLedgerRecord(run), results: [],
    });
    resultSet = await run.spec.resultPort.sealResultSet(draft, { slicer: run.slicer() });
    run.spec.resultPort.residency.admitSealedSet(run.runId, resultSet);
    run.reservationSettled = true;
    run.sealed = true;
  } catch {
    resultSet = releaseIfStillReserved(run);               // I8: never leak, never double-free
  }
  return finishTerminalInternalError(run, resultSet);
}

/** The one terminal commit of the fallback path, shared by both ways into it. */
function finishTerminalInternalError(run, resultSet) {
  run.status = 'failed';
  const persistence = Object.freeze(
    { state: 'skipped', reason: 'seal-failed', timedOut: false, attempt: 0 });
  run.summary = Object.freeze({ runId: run.runId, status: 'failed', resultSet, persistence });
  // I9: the terminal snapshot is COMMITTED before the event that announces it, so a listener that
  // reads `getSnapshot()` synchronously sees `phase: 'terminal'`, not `'finalizing'`.
  run.commitTerminal({ status: 'failed', persistence });
  run.emit('state',
    { seq: run.seq(), status: 'failed', terminal: true, cause: 'internal-error', persistence });
  run.resolvePersisted(persistence);
  run.resolveDone(run.summary);                            // AFTER the terminal event, always
  return run.summary;
}

/**
 * I8 — the ONLY assumption P6's recovery makes about a throwing `admitSealedSet` is the one
 * C-P5-1 requires of P5: the call is atomic, so residency either converted the reservation or did
 * not. P6 does not guess which; it ASKS, through the query P5 already exports.
 *
 * `getResident(runId)` is that query: it returns the resident set for an admitted run and `null`
 * otherwise (A14). A non-null answer after a throw means the conversion completed and something
 * *after* it — an observer callback, a report hook — threw; releasing the slot then would free a
 * live resident set, and re-admitting under the same id would be a second admission. A `null`
 * answer means the reservation is untouched and must be released exactly once. `reservationSettled` is
 * the idempotence guard that makes "exactly once" true even if two paths reach here.
 */
function releaseIfStillReserved(run) {
  if (run.reservationSettled) return run.spec.resultPort.residency.getResident(run.runId);
  const resident = run.spec.resultPort.residency.getResident(run.runId);
  run.reservationSettled = true;
  if (resident !== null) return resident;                  // admitted after all: adopt it, keep it
  run.spec.resultPort.residency.releaseRunSlot(run.runId); // A14: never leak the reservation
  return null;
}

/** The two minimal inputs the fallback needs, built without touching the records that just failed. */
const emptyLedgerRecord = (run) => Object.freeze({
  planExists: run.plan !== undefined, pairSpaceTotal: 0, emptyOperand: false, units: [],
  rootOwners: [], unresolvedSelections: [], unreachablePopulation: [], hierarchyInternal: [],
  planningGaps: [{ phase: run.phase, cause: 'internal-error' }], exclusions: [], warnings: [],
  budgetExhausted: false, firstRefusalUnitId: null,
});
const emptyDiagnosticsSummary = () => Object.freeze({
  diagnostics: [], truncated: false, total: 0, completenessAffectingCount: 0,
  unclassifiedOccurrences: 0, completenessAffectingUpperBound: 0, countsByReason: [],
  omittedReasonOccurrences: 0, geometryReadinessOccurrences: 0,
});

/**
 * §13.5.1 item 1: `done` resolves at the FIRST of (a) the first attempt settling, (b) persistTimeoutMs
 * since seal, (c) a forced close by engine.dispose() — and in every case only AFTER the terminal
 * `state` event has been emitted.
 */
function openFinalizeWindow(run, attempt, resultSet) {
  return new Promise((resolve) => {
    let closed = false;
    let timedOut = false;
    const close = () => {
      if (closed) return;
      closed = true;
      cancelTimer();
      // A15/N24: the state is read BY ID from the residency manager — there is no `snapshot()`
      // closure on a returned attempt object. A timeout is a statement about OUR wait, not about
      // the write, so it is layered on top of whatever residency currently reports (§13.5.1).
      const state = run.spec.resultPort.residency.getPersistenceState(run.runId)
        ?? { state: 'skipped', attempt: 0 };
      const persistence = Object.freeze({ ...state, timedOut });
      run.summary = Object.freeze({
        runId: run.runId, status: run.status, resultSet, persistence,
      });
      // I9 — COMMIT, then announce. `commitTerminal` writes the terminal `status`, `phase` and the
      // final persistence state into the committed snapshot and bumps `seq` WITHOUT emitting; the
      // one terminal `state` event follows. A listener that calls `getSnapshot()` synchronously
      // from that event therefore observes `phase: 'terminal'` and the same `persistence` the
      // event carries, instead of the `finalizing` it was still in one line earlier. §9.2 rule 4
      // ("built at state changes from committed state only") is what makes this the ordering, not
      // a nicety: the event IS the state change, so the state must already be committed.
      run.commitTerminal({ status: run.status, persistence });
      run.emit('state', { seq: run.seq(), status: run.status, terminal: true, persistence });
      run.resolveDone(run.summary);                        // AFTER the terminal event, always
      resolve();
    };
    const cancelTimer = run.spec.scheduleTimeout(() => {   // O3: the injected timer seam
      timedOut = true;                                     // ⇒ {state:'pending', timedOut:true}
      close();
    }, run.limits.persistTimeoutMs);
    attempt.then(close, close);                            // (a): never rejects, but be defensive
    run.forceFinalize = close;                             // (c): engine.dispose()
    // C3 — the gap this closes: a `requestDispose()` that arrived while the run was BUILDING or
    // SEALING found no `forceFinalize` to call, and setting `disposeRequested` at that point is
    // too late for a boundary that has already been passed. It therefore leaves a flag, and the
    // window closes on the first turn of its own existence.
    if (run.disposeRequestedDuringSeal) close();
  });
}

/**
 * `commitTerminal` — the single terminal commit (I9). It is `commit()` with two differences: it
 * **never emits** (its caller emits the one terminal `state` event immediately afterwards, and
 * committing plus emitting in one call would either re-introduce the ordering bug or emit twice),
 * and it is called only once `run.summary` — which carries the final `persistence` — already
 * exists. §9.1's `RunProgress` is a **closed** shape with no persistence field, so the final
 * persistence state is committed where the spec puts it: on `RunSummary` (`done`) and on the
 * terminal `state` event's payload. "The complete terminal snapshot before the event" therefore
 * means: `status` and `phase` in the committed progress state, `persistence` in the summary and
 * the payload, all of it established before any listener runs.
 */
function commitTerminal(run, { status, persistence }) {
  /* c8 ignore next */ if (run.summary === undefined) throw new Error('summary must exist first');
  run.pending.status = status;
  run.pending.phase = 'terminal';
  run.pending.currentUnitId = null;
  run.pending.seq += 1;
  run.progress.committed = Object.freeze({ ...run.pending });
  run.terminalPersistence = persistence;                  // reachable through `done`/the event
}
// `run.seq()` reads the seq of the COMMITTED snapshot (it does not advance it). The terminal event
// therefore carries the same `seq` a listener reads back from `getSnapshot()` — `bumpSeq()` there
// would announce a state the snapshot does not have, which is the same tear I9 is about.
```

`cancel()` and `dispose()` both mark committed state and let the boundary decide — never a direct transition:

```js
function requestCancel(run, reason, { dispose = false } = {}) {
  if (run.sealStarted) {
    // C3 — "sealing" and "terminal" are not the same state, and a dispose must not be dropped in
    // between. If the finalize window is open, force it closed now; if the seal is still building
    // (before `forceFinalize` exists), leave the flag the window checks the moment it opens.
    // The settlement state is deliberately NOT touched: §16.7 resolves from facts committed
    // BEFORE the seal began, and mutating it mid-seal would race `collectReasons` inside `sealAs`
    // and make the sealed reasons depend on timing. A dispose arriving now changes nothing about
    // the run's status — it only stops the engine waiting on the write.
    if (dispose) {
      if (run.forceFinalize !== undefined) run.forceFinalize();
      else run.disposeRequestedDuringSeal = true;
    }
    return run.donePromise;                                // terminal (or sealing): absorbed
  }
  if (run.cancelRequested === null) run.cancelRequested = { reason: dispose ? 'engine-disposed' : (reason ?? null) };
  if (dispose) run.settlementState.disposeRequested = true;
  run.settlementState.cancelRequested = run.cancelRequested;
  if (run.status === 'running') run.transition('cancelling');
  // R5 / review C2 — a still-QUEUED run has no boundary of its own: withdrawing it means its run
  // function is never invoked, so whoever wins the withdrawal owes it the seal. A run that has
  // already started ignores this and settles at its own next boundary instead.
  if (run.status === 'queued') cancelWhileQueued(run);     // see Task P6.4
  run.resolveCancellationSignal();                         // (a) frees a stalled resolveDefinition race
  run.wakeBoundary();                                      // (b) the loop re-collects facts at its boundary
  return run.donePromise;                                  // §13.5.1 item 5: same value/timing as `done`
}

/**
 * C3 — the engine-only control surface `createRun` returns beside the handle. This is the ONE
 * published way `engine.dispose()` reaches a live run, and it is deliberately not on `RunHandle`:
 * `getRun(runId)` hands that handle to application code, which must never be able to dispose the
 * engine's runs.
 *
 * It is `requestCancel(..., {dispose:true})` — the same committed-fact path as a user cancel, so a
 * dispose is resolved by §16.7 order B exactly like any other fact (`disposeRequested` ⇒
 * `cancelled`, unless a failing or invalidating fact outranks it) — plus the force-close of a run
 * that is already past its seal. Idempotent: a second call returns the same `done` promise.
 */
function requestDispose(run) {
  return requestCancel(run, 'engine-disposed', { dispose: true });
}
```

**What `requestDispose()` guarantees, per run state (C3, and re-verification question 4).**

| Run state when dispose arrives | What happens | When `requestDispose()` resolves |
|---|---|---|
| `queued` (in the FIFO, or racing `resolveDefinition`) | the withdrawal / cancellation-signal paths of the cancel table below, with `disposeRequested` also committed | at the pre-resolution seal |
| `planning` | the next enumeration checkpoint throws; the planning gap is `cancelled` | at the planning seal |
| `running`, between units | the next boundary reads `disposeRequested` and stops issuing | at the seal of the already-settled units |
| `running`, one unit in flight | the unit is **drained** (§10.1: the world's `evictModel`/`dispose()` may never be used as a cancel mechanism), then the boundary decides | after the in-flight unit returns |
| **building or sealing** the Result Set | `forceFinalize` does not exist yet, so the flag `disposeRequestedDuringSeal` is left and the finalize window closes on the first turn of its own existence | at that forced close |
| in the `finalizing` window (persistence outstanding) | `forceFinalize()` closes it immediately with `{state:'pending', timedOut:true}` — the write is never cancelled, only no longer waited on (§13.5.1) | immediately |
| already `terminal` | absorbed; nothing changes | immediately, with the existing summary |

> **Question 4, answered: indefinite drain is accepted, and is not a defect.** An executor that never
> cooperatively returns cannot be interrupted by this engine. §10.1 forbids the only mechanisms that
> *could* stop an in-flight library call (`evictModel`, `world.dispose()`) from being used as a
> cancel, and the spec's F6 disposition is **drain, not discard** — a unit that eventually returns
> must still be settled by §16.7 rather than abandoned with its partial evidence in limbo. So
> `requestDispose()` (and therefore `engine.dispose()`) is bounded by *every* wait the engine owns —
> the queue, the boundary, the seal, and the finalize window, the last of these by the
> `persistTimeoutMs` timer already specified in `openFinalizeWindow` (O3) — and unbounded only by a
> port that never returns. **No new timer is introduced**, deliberately: a timer that abandoned a
> drained unit would seal a ledger claiming a unit is still running, and a timer that abandoned the
> *run* would break §13.5.1's "resolves exactly once" for a summary the drained unit is still going
> to change. A host that must bound a hostile executor bounds it in the executor, which is an
> injected port. Recorded as open item **O9**.

`cancel()` and `dispose()` therefore have exactly three ways to reach a seal, and every run state
maps to one of them — which is what makes `cancel()` and `done` **bounded** for every run,
including one parked on a definition lookup that never settles (review C2):

| Run state when the cancel arrives | What settles it | Sealed as |
|---|---|---|
| `queued`, still in the coordinator's FIFO | `cancelWhileQueued` wins `withdraw()` and calls `settlePlanning(run, 'cancelled')` | pre-resolution, `cancelled` (§13.1) |
| `queued`, already at the head, inside `resolveDefinition` | the cancellation signal wins the race in `resolveStage`; the lookup is abandoned | pre-resolution, `cancelled` |
| `planning` (bindings taken, enumerating) | the next `checkpoint()` throws `EnumerationCancelledError`, or the post-plan check observes it | resolved definition embedded, `cancelled` |
| `running`, between units | the loop's boundary `resolveRunStatus` | remaining units `not-run:cancelled` |
| `running`, one unit in flight | the unit is **drained**, then the boundary decides (matrix C) | the drained unit merges iff its primary cause is U9 |
| already sealing or terminal | absorbed: the same `done` promise is returned | unchanged |

- [ ] **Step 4: Run the whole phase suite and watch it pass.**
`node --test test/clashtest/run/settlement.test.mjs test/clashtest/run/coordinator.test.mjs test/clashtest/run/progress.test.mjs test/clashtest/run/scopeConsequences.test.mjs test/clashtest/run/lifecycle.test.mjs test/clashtest/run/freshness.test.mjs`

- [ ] **Step 5: Run the full repo suite.** `npm test` ⇒ green, no server, no credentials, no network.

- [ ] **Step 6: Run the *Conformance check* at the end of this file** and paste its zero-hit output into the task record. A green suite does not prove the phase consumes the reconciled interfaces; that grep does.

- [ ] **Step 7: Update `docs/handoffs/latest.md`** from the verified final state (project CLAUDE.md "Before declaring a substantial task complete"): branch, HEAD, working-tree state, P6 status, unresolved items O1–O7 and C1–C4 below.

- [ ] **Step 8: Checkpoint commit (only if the user has authorized commits).** `docs: P6.8 sealing, finalize window and dispose semantics`.

---

## Cross-file needs raised by the re-verification (not editable from this file)

Each is a requirement on another phase's file. P6 is written against them and cannot satisfy them
alone; the owning phase's *Phase interface summary* stays the authority (master §2.1 rule 3).

| # | Owner | Exact need | Why P6 needs it | Raised by |
|---|---|---|---|---|
| **C-P7-1** | P7 | `createRun(spec)` now returns **`{ handle, controller, begin }`**; P7 must keep the `controller` (`RunController = { requestDispose(): Promise<RunSummary> }`) for every run it owns and, in `dispose()`, **call `controller.requestDispose()` for every owned run BEFORE awaiting that run's `done`** — i.e. `await Promise.all([...ownRuns.values()].map((r) => r.controller.requestDispose()))` in place of today's `map((h) => h.done.catch(...))`, then `residency.drainForDispose()`. `startRun`/`rerun` return only the handle, exactly as §18 says. | P7.2's `dispose()` currently only calls `coordinator.stopAdmitting` and awaits `handle.done`, so no live run ever learns `disposeRequested` and no finalize window is ever forced: dispose hangs for `persistTimeoutMs`, or indefinitely when the store never settles. | C3 |
| **C-P7-2** | P7 | `buildRunSpec({runId, source, options, derivedFromRunId})` must place **`derivedFromRunId`** on the `RunSpec` it returns (P7.7 already passes the value in; the spec object must carry it out). `createRun` validates it and throws `TypeError` for anything but `null` or a non-empty string. | A `buildRunSpec` that projects only the fields P7's own docs list would drop rerun lineage silently, and the rerun would seal `derivedFromRunId: null`. | I7 |
| **C-P5-1** | P5 | State in P5's residency contract that **`admitSealedSet(runId, resultSet)` is atomic and exception-safe**: either the reservation is converted and the call returns, or it throws having left residency unchanged. If P5 keeps observer/report callbacks in that path, they must be isolated from the mutation the way P6's emitter isolates listeners (§9.2 rule 5) — or the operation must return an explicit result instead of throwing after mutating. `getResident(runId)` must remain a truthful post-hoc query of whether the conversion happened. | P6's seal-failure recovery (R10) either releases the reservation or adopts the resident set, and picks between them by asking `getResident`. Without the atomicity statement the recovery rests on undocumented behavior, and a throw after conversion could double-admit or free a live set. | I8, Q1 |
| **C-P5-2** | P5 | State that `addUnit` is **all-or-nothing**: `{accepted:false, reason:'result-cap'}` means the accumulator merged *nothing* of that unit (P5's own whole-unit boundary rule, made explicit as a contract rather than an implementation note). | P6's unit commit is a transaction whose only gate is this call: it runs first precisely because its refusal is total. If a refusal could leave partial results, P6 would have no way to reach a consistent state. | C4 |
| **C-P5-3** | P5 | Keep `ctx.unitPlanRank`'s documented "`Map` **or any `{get(unitId) → number\|undefined}`**" — P6 passes the *object* form (a live oracle), not a `Map` snapshot, and relies on `undefined ⇒ Number.MAX_SAFE_INTEGER` staying the documented fallback for a genuinely unknown id. | Runtime split children do not exist when the plan does; a `Map` fixed at plan completion ranks every descendant last. | I6 |

---

## Verification / acceptance for P6

Six commands cover the phase; every row below names the file, the test, and what would be lost if
the row were dropped. Rows are grouped by command so no command is restated.

```
C1  node --test test/clashtest/run/settlement.test.mjs
C2  node --test test/clashtest/run/coordinator.test.mjs
C3  node --test test/clashtest/run/progress.test.mjs
C4  node --test test/clashtest/run/lifecycle.test.mjs
C5  node --test test/clashtest/run/scopeConsequences.test.mjs
C6  node --test test/clashtest/run/freshness.test.mjs
```

| # | Cmd | Named test | Spec AC / review finding |
|---|---|---|---|
| V1 | C1 | dense DISTINCT ranks with six rank-8 rows; every fact pair in both orders; equal-rank tie-break by ascending cause code; the review triple; `secondaryCauses` distinct/ascending/capped | AC-21; **review C3**, ruling R4 |
| V2 | C1 | order B (`failed > invalidated > cancelled > completed`); `collectReasons` records a cancel that a higher-precedence status beat | AC-21 |
| V3 | C2 | two engines over one world serialize, share one coordinator and one registry; `createRegistry({world})`; a protocol mismatch throws `ModelBindingError` with **`.reason`** | AC-8 (lifecycle parts); N1, N11 |
| V4 | C2 | the coordinator enforces **no** queue limit; `queueDepth` counts waiting runs only; `cancelQueued` returns the single-winner boolean | **review I1**, ruling R6; **review C2**, ruling R5 |
| V5 | C4 | the four §10.2 cancel rows: pre-resolution, post-resolution/pre-plan, between units, in-flight drained | AC-7 |
| V6 | C4 | **cancel while the definition lookup never settles**, and **cancel while queued behind another run** — both bound `cancel()` and `done`, both seal a pre-resolution cancelled set, both convert the reserved slot; a late resolve/reject is abandoned and never rejects `done` | **review C2**, ruling R5 |
| V7 | C4 | run-start leases come from P1's frozen snapshot bindings: zero `admitModel` calls from P6, no write to a frozen binding, a `null` entry ⇒ `planning:model-not-bound` | **review I2**, ruling R7; N10 |
| V8 | C4 | matrix C for an in-flight unit settling under a pending cancel, run for **both** a user cancel and `engine.dispose()` | AC-21 |
| V9 | C4 | the same facts in every delivery order produce a byte-identical sealed set: same primary cause, same `secondaryCauses`, same `ledgerDigest` and `pairSetDigest` | AC-21; ruling R4 |
| V10 | C4 | idempotent cancel, first reason wins, terminal cancel is a no-op, and **no destructive call** (`evictModel`/`dispose`/`invalidateModelPlacement`) is ever made | AC-7; §10.1, §10.2 |
| V11 | C4 | `done` resolves once and never rejects; the timeout is `{state:'pending', timedOut:true}`; `persisted` has no timer; the attempt runs through `residency.beginPersist` | §13.5.1 (AC-11/AC-15 persistence parts belong to P5); N24 |
| V12 | C4 | **a failure in `buildResultSet` / `sealResultSet` / `admitSealedSet` still settles `done` once** as `failed:internal-error`, releases or converts the slot, emits the terminal event, and stays absorbing against a later cancel | **review I4**, ruling R10 |
| V13 | C4 | terminal `state` event exactly once, before `done`; `dispose()` forces the window closed and hands back unsaved sets via `drainForDispose()` | AC-7, AC-21; N23 |
| V14 | C3 | progress monotonicity across a split, `pairSpaceTotal` conserved, `unitsTotal` +1 per split | AC-21 (progress parts) |
| V15 | C3 | **nested runtime splits stay inside `maxUnitsPerRun` and `maxLedgerRecords`**; a cap refusal is `failed:unit-cap` with the right `capDetail`; an **unsplittable** unit keeps `capacity-exceeded`; a refusal wrapper is never mistaken for a split | **review C5**, ruling R8; N17 |
| V16 | C3 | **a preplanned `target-too-large` gap is adopted at plan completion**: a run with one executable unit and one such gap seals `completed` at `fractionProcessed === 1` with `fractionEvaluated === 0.5`, and the gap is never issued | **review I3**, ruling R11; AC-18(b) |
| V17 | C3 | a placement retry with an unchanged generation re-issues up to the cap; exhaustion is `stale-placement` and drives `environmentSensitiveCauses` **through P5's derivation**, not a P6-side set | §7.5; AC-19(d′) |
| V18 | C3 | a malformed outcome becomes P4's `internalErrorOutcome`, fails the run fast, merges nothing, and carries `{code, path, detail}` **objects** | N8 |
| V19 | C3 | emitter throttle, listener isolation, `listenerErrors`; one unit in flight, inter-unit yields counted, no sync span over `sliceBudgetMs` | §9.2, §16.6; AC-12(a) (the P6 span classes only) |
| V20 | C5 | drift ⇒ `invalidated`, earlier units retained, the drifted unit merges **neither results nor diagnostics**, `scopeProof` reaches the ledger; `scope-unverifiable` ⇒ gap and the run continues; invariant I-scope | AC-8, AC-21; §16.3.4 |
| V21 | C5 | reload ⇒ gap + `stale` + continues, vs `notifyPlacementChanged` ⇒ `invalidated`; the comparison uses `bindingsEquivalent`, never a `dead` flag | AC-21 (consistency clause); N10 |
| V22 | C6 | two passes and three snapshots; a change between the passes; a placement change landing during pass₂ caught only by snapshot₃; an unrelated registration stays `current` | AC-8 (R15-2) |
| V23 | C6 | **a placement change or reload COMPLETED BEFORE snapshot₁ is `stale`, not `current`**, by comparing snapshot₁ with the sealed provenance generations; a cross-session set does not manufacture one from foreign counters | **review C4**, ruling R9 |
| V24 | C6 | the result is the `{state, reasons}` object P5's claim helpers accept; `freshnessStateOf` reads it; a refusal carries its reasons into `qualifiers` | C1, ruling R3; N19 |
| V25 | C6 | "DOCUMENTED LIMIT (OQ-19): an A→B→A excursion … is NOT detected" | AC-8 (documented-limitation test) |
| V26 | C4 | **every pre-resolution seal produces a non-null Result Set** through the real sealing sketch — cancel during resolution, definition-lookup failure, and `model-not-bound` — each `sealed`, `results: []`, `units: []`, and *not* the R10 fallback | **re-verification C2**; §13.1 |
| V27 | C3 | the **retry protocol runs on P4's outcome shape**: `failed:stale-placement` + `retryable:true` + unmoved generations retries to the cap; `retryable:false` does not; a moved placement generation is `input-changed`/`invalidated`, never a retry; a second fact settles instead of retrying; exhaustion is `failed:stale-placement` with `attempts = maxPlacementRetries + 1` and P5 derives `placement-contention` | **re-verification C1**; §7.5, AC-19(d′) |
| V28 | C3 | **a result-cap refusal merges nothing**: no results, no aggregator call, no statistics, no taints, and `unitsEvaluated`/`pairSpaceEvaluated`/`resultsFound` unchanged (only `pairSpaceProcessed` and `unitsFailedOrSkipped` move) | **re-verification C4** |
| V29 | C3 | a **clean run seals `reasons: []`** — `unit:evaluated` is never fabricated | **re-verification I5** |
| V30 | C3 | **runtime split descendants are ranked**: a child precedes a later initial unit, siblings keep split order, nested children keep path order, ranks are strict and integral, and an unknown id is still unranked | **re-verification I6**; §11.4 rule 2 |
| V31 | C4 | `derivedFromRunId` is on the `RunSpec`, validated (`TypeError` for anything but `null`/non-empty string) and present on the sealed set | **re-verification I7** |
| V32 | C4 | `RunHandle` exposes **exactly** the six §18 members and no disposal control; `controller.requestDispose()` drains an in-flight unit, stops later units, force-closes the window with `{pending, timedOut:true}` **without any timer firing**, is idempotent, and also works when the dispose lands *during* the seal | **re-verification C3**, Q4 |
| V33 | C4 | an `admitSealedSet` that throws **before** mutating releases the slot exactly once and admits nothing; one that throws **after** converting keeps the resident set, releases nothing and admits exactly once | **re-verification I8**, Q1 |
| V34 | C4 | the **terminal snapshot is committed before the terminal event**: a listener reading `getSnapshot()` from that event sees `phase: 'terminal'` and the matching status/seq, on the normal close *and* the R10 fallback | **re-verification I9**; §9.2 rule 4 |
| V35 | C4 | **every planning gap** P3 reported reaches `RunOutcome.reasons`, while the status still comes from the one primary cause (a non-`cancelled` gap outranking a `cancelled` one) | **re-verification Q2**; §6.6.2 |

**Relocated by reconciliation D1 — verified in P3, not here** (listed so the coverage stays
traceable rather than silently missing): the R20-1 whole-model-source expectation (3 cases, now in
`test/clashtest/planning/planner.test.mjs`) and the re-digest-and-compare fold, including
grow-and-revert between the pre- and post-check (4 cases, now in
`test/clashtest/planning/scopeDigest.test.mjs`). Both lists are in P3's *Verification / acceptance*.

**Phase acceptance checklist**

- [ ] V1–V35 all pass with the commands above.
- [ ] `npm test` passes from a clean checkout.
- [ ] The *Conformance check* below reports **zero hits** for every superseded identifier.
- [ ] No test in this phase uses a real timer, a real clock, `setTimeout` without the injected seam, or a real `CollisionWorld`.
- [ ] `clashtest/run/**` imports nothing from `wwwroot/`, the Viewer, `three`, or `collision/` internals.
- [ ] `clashtest/execution/**` imports nothing from `clashtest/run/` (D1's dependency-direction rule): `grep -Rn "run/" clashtest/execution/` is empty.
- [ ] Every default used by `run/**` comes from `clashtest/options.js`; `grep -Rn "[0-9]\{2,\}" clashtest/run/*.js` shows no hard-coded cap (the only literals are `1` for the protocol version, `8` for `MAX_SECONDARY`, `64` for the slice item stride).
- [ ] `docs/handoffs/latest.md` updated from the verified final state.

---

## Spec coverage

| Spec § | Task |
|---|---|
| §7.3 sequential execution, world-scoped coordinator, queueing, `interUnitYield` | P6.2, P6.5 |
| §7.4 lease handling **at run start** (the snapshot's cached leases, R7). The **per-unit** `isLeaseValid` gate is P4's (D2) | P6.4 |
| §7.5 error taxonomy → run effect (retry, fail-fast, continue) | P6.5 |
| §8.1 states | P6.3 |
| §8.2 transition rules incl. planning-gap mapping and the end-of-plan check | P6.4, P6.5, P6.8 |
| §8.3 run outcome record — P6 supplies `status`/`freshness`/`reasons`; `coverage`, `integrity` and `environmentSensitive*` are **derived by P5** from the ledger P6 emitted (A13) | P6.8 |
| §9.1 snapshot fields | P6.3 |
| §9.2 rules 1–6 (monotone, two fractions, delivery, throttle, listener isolation, queued/planning counters) | P6.3, P6.5 |
| §10.1 the constraint (never evict/dispose as cancel) | P6.8 |
| §10.2 semantics table, latency, retention, precedence, `dispose()` | P6.4, P6.8 |
| §13.1 pre-resolution seal representation | P6.4 |
| §13.5.1 items 1–6 (`done`, `persisted`, detached write, `finalizing` phase, terminal event) | P6.8 |
| §15.1 `environmentSensitive` inputs recorded on the ledger (`capacityKind`, `stale-placement`) for P5 to derive from | P6.5, P6.8 |
| §16.1 event matrix (running column) | P6.6 |
| §16.2 placement generation, `invalidateModelPlacement` (registry side owned by P1; run-side observation here) | P6.6 |
| §16.3 taint, invalidation, invariant I-scope — the **run-level consequences** of a scope answer. The bracket expectation (incl. R20-1) and the comparison are P3's (D1); the per-unit execution is P4's | P6.5, P6.6 |
| §16.4 freshness at seal (P6.6) and at read (P6.7), incl. the snapshot₁-vs-sealed comparison (R9) | P6.6, P6.7 |
| §16.5 epochs (never durable; leases only) | P6.4 |
| §16.6 handler safety | P6.3 |
| §16.7 settlement precedence A/B/C | P6.1, P6.5, P6.8 |
| §17.3 main-thread discipline (`sliceBudgetMs`, slices, `interUnitYield`) | P6.4, P6.5 |
| §18 `RunHandle` surface | P6.3, P6.8 |

---

## Gates and open items

### Master gates that touch this phase

| Gate | Effect on P6 |
|---|---|
| **G-PLAN** | Blocks the start of P6.1, as for every phase. |
| **G-CAL** | Blocks nothing functional here. `persistTimeoutMs`, `progressMinIntervalMs`, `sliceBudgetMs` and `maxPlacementRetries` are read from `clashtest/options.js` and ship as documented **provisional** values; P6 tests inject their own values and never assert a default number. |
| **G-OQ17** (placement-invalidation owner) | Does not block P6. The run fails closed on every placement change it *can* see (`placementGeneration` against the run snapshot, and `snapshot₃` at read time); an unreported host mutation stays undetectable by construction and is recorded as `placementVerified: false`. |
| **G-OQ19** (bracketed-proof tightening) | Non-gating. V13 pins the accepted residual as a **documented limitation test**, not a defect. |
| **G-RESP** | Blocks nothing. V16 asserts only the engine's *own* span class; it makes no responsiveness claim. |
| **G-OQ4 / G-OQ1 / G-OQ16 / G-REMOTE** | Do not block P6: the enumerator, registry, acceptance record and store are all injected ports here. |

### Implementation-level items deliberately left to implementers

| # | Item | Why it is left open |
|---|---|---|
| O1 | `clashtest/run/emitter.js` is an addition to the master's module map. | **ACCEPTED by reconciliation** — the module is now listed in the master §2 map; no fold-back. The master's §2.1 rule 1 lets the owning phase choose internal names, and the emitter is ~40 lines of subscriber bookkeeping that would otherwise sit inside `Run.js`. |
| O2 | ~~The per-unit bracket algorithm lives in P6.~~ | **SUPERSEDED by reconciliation D1 — no longer an open item, and nothing in this file implements it.** The expectation is P3's `materializeUnit(...).scopeExpect` (the sole home of R20-1) and the comparison is P3's `checkScopeBracket`. The goal O2 stated — *one* comparison implementation shared by the per-unit and read-time brackets — is preserved, and the dependency direction O2 worried about is eliminated rather than confirmed: the original plan required `execution/` to import `run/`, which inverts the master's graph (P6 depends on P4), so the shared code moved down to P3, which both phases already depend on. See C2 below. |
| O3 | `scheduleTimeout(fn, ms) → cancel` is a P6-local injected seam, additional to the spec's `now` / `yieldToScheduler`. | §13.5.1's `persistTimeoutMs` window needs a *timer*, which neither existing seam provides; the master's "Injectable time/scheduling seams" constraint requires it be injectable so tests use a fake clock. Default is `setTimeout`/`clearTimeout`. |
| O4 | The exact inter-unit yield mechanism for `interUnitYield: 'animation-frame'` (feature-detect `requestAnimationFrame`, else macrotask). | The spec fixes the *policy* (§7.3) but the detection is environment code; the core is tested with an injected `yieldToScheduler` and never touches a global. |
| O5 | ~~Whether the `maxQueuedRuns` refusal throws `RunQueueFullError` or `ResultCapacityError`, and whether residency surfaces it.~~ | **CLOSED by controller ruling R6 — the suggestion that residency might surface it was wrong** (A14 is explicit that `reserveRunSlot` throws only `ResultCapacityError`), and so was leaving the owner open: **P7's synchronous admission prefix** owns the check, in this order — resolve options, `residency.reserveRunSlot(runId)` (may throw `ResultCapacityError`), then `coordinator.queueDepth(engineId) >= runOptions.maxQueuedRuns` ⇒ **roll the reservation back with `releaseRunSlot(runId)` and throw `RunQueueFullError{limit, queued}`**, then `enqueue`. Depth is runs **waiting**, not counting the in-flight one, which is what makes the §17.1 default (`maxResidentResultSets − 1`) unreachable and `RunQueueFullError` reachable only with an explicitly lower value (S-P7-3). **P6's coordinator has no limit, performs no check and throws no `RunQueueFullError`** — a per-engine option cannot live in a world-scoped object shared by two engines. Verified by V4. |
| O6 | The worst-case cost of running the bracket twice per unit on top of `getFreshness`'s two passes. | §6.2.1 "Cost" explicitly defers this to AC-12 measurement; P6 asserts no timing. |
| O7 | What `RunSummary.resultSet` is when sealing itself fails **and** the minimal fallback set also fails to build. | **Bounded by ruling R10, with one documented deviation.** §13.5.1 item 1 requires `done` to resolve exactly once and never reject "for any run or persistence outcome"; §13.5.1's `RunSummary` typedef implies `resultSet` is always a set. When Result Set assembly is itself the thing that failed, those two cannot both hold. P6 chooses the first: one attempt at a minimal unit-free `failed:internal-error` set, and if that also throws, `resultSet: null` with `persistence: {state:'skipped', reason:'seal-failed'}` and the residency slot released. The alternative — rejecting or never settling `done` — would wedge `dispose()` and violate the explicitly normative sentence. Flagged so P7's facade and any consumer typing `RunSummary` treat `resultSet` as nullable **only** on this path. |
| O9 | An executor that never cooperatively returns makes `requestDispose()` / `engine.dispose()` unbounded for that run. | **Accepted, not fixed (re-verification question 4).** §10.1 forbids the destructive mechanisms that could stop an in-flight library call from being used as a cancel, and F6's disposition is *drain, not discard*: a unit that eventually returns must still be settled by §16.7. Every wait the engine itself owns is bounded (queue, boundary, seal, and the `persistTimeoutMs` finalize window via O3's timer); only the port is not. A timer here would either seal a ledger that claims a unit is still running, or break §13.5.1's "resolves exactly once". A host that must bound a hostile executor does it in the executor, which is injected. See the `requestDispose()` state table in Task P6.8. |
| O8 | ~~The `role` label on a read-time scope entry.~~ | **CLOSED — P3 confirmed (see `p3-planner.md`, Task P3.2 Step 3, the paragraph after `compareScopeExpectation`).** `role` is an **opaque label**: `compareScopeExpectation` copies `expect.role` into its result and never branches on it, and `checkScopeBracket` does not read it at all. `sealedScopeExpect`'s `role: 'recorded'` is therefore valid input to the same one comparator P4 drives with `'source'`/`'target'`, and neither P6's entries nor P5's provenance need to carry a planning role. P3 records a standing guard against adding a `role` branch without telling P6. |

### Controller rulings applied to this phase

Plan-level decisions taken after the internal review of this file. Each is recorded here with the
one place it is implemented, so a later reader can check the ruling and the code in one step.

| Ruling | What it settled | Where it lands in P6 | Closes |
|---|---|---|---|
| **R1** | `startRun` throws synchronously; only Promise-returning entry points reject | `createRun`/`begin`/`enqueue` are synchronous and throwing (Phase interface summary, P6.2) | OPEN-1 |
| **R3** | `Freshness` is `{state, reasons}`; the claim helpers accept it and append its reasons to `qualifiers` | A16, P6.7 Step 3, V24 | C1 |
| **R4** | Same-rank settlement facts tie-break on the ascending cause code; the rest go to `secondaryCauses`, ascending | P6.1 `classifyUnitSettlement`, V1, V9 | review C3 |
| **R5** | A withdrawn queued run must still seal a pre-resolution cancelled set and convert its slot; `resolveDefinition` is raced against cancellation | P6.4 `resolveStage` / `cancelWhileQueued`, P6.8 `requestCancel`, V4, V6 | review C2 |
| **R6** | `maxQueuedRuns` is P7's synchronous admission check (depth = waiting runs), with atomic rollback; the coordinator has no limit | P6.2 (no limit; `queueDepth` semantics), O5, V4 | review I1 |
| **R7** | Run-start leases come from P1's frozen `snapshotBindings`; no second `admitModel` loop, never mutate a frozen binding | P6.4 `planStage`, V7 | review I2 |
| **R8** | `splitUnit(plan, unit)` is the one live split-admission operation and returns `{children}` or a reason; callers test the reason | A8, P6.5 split branch, V15 | review C5 |
| **R9** | Read-time freshness compares snapshot₁ against the **sealed** generations (same session) as well as the three-snapshot bracket | P6.7 `compareToSealed`, V23 | review C4 |
| **R10** | Do not set the absorbing sealed flag until the final immutable set exists; a build/seal failure still settles `done` once as `failed:internal-error` and frees the slot | P6.8 `sealAs` / `terminalInternalError`, O7, V12 | review I4 |
| **R11** | P3's preplanned `target-too-large` gaps are adopted into progress at plan completion | P6.4 `adoptPlanIntoProgress`, V16 | review I3 |
| **R2** | The sealed ledger's `rootOwners` rows carry a per-root class marker `cls` (P3 emits, P5 digests, P8 reads) | **No P6 change.** P6 writes unit records and planning gaps, never `rootOwners`; the marker reaches the ledger through P3's tables and is projected by `toLedgerRecord()` | OPEN-2 |

### Re-verification dispositions (round 2), and where each landed

Every finding of `docs/reviews/2026-09-20-core-engine-plan-p6-reverification-codex-review.md`,
checked against the producing phase's *Phase interface summary* before it was acted on. All nine
findings were **accepted**; none was rejected as factually wrong.

| Finding | Verified against | Disposition | Where |
|---|---|---|---|
| **C1** production placement retries cannot occur | P4 summary + Task P4.7 `classifyLibraryError` (`stale-placement` / `retryable: true`; `input-changed` when the generation changed); spec §7.5, §8.3, §15.1 (`placement-contention` is the *environmental* cause, derived by P5) | Accepted. Retry eligibility now reads P4's outcome plus P6's own generation comparison; `placement-contention` exists nowhere as an executor fact or unit cause | P6.5 `isRetryablePlacement`, V27, conformance (c)/(d) |
| **C2** pre-resolution runs use an accumulator that does not exist | A12 / P5 *Accumulator context* (`unitPlanRank` needs a plan); §13.1 pre-resolution shape | Accepted. `EMPTY_RESULTS` from `createRun`; integration tests through the real sealing sketch | P6.3, P6.4 `resultParts`, V26 |
| **C3** `dispose()` cannot signal or force-finalize runs | P7.2 `dispose()` (stop admitting → await `handle.done` → `drainForDispose`); P6's `forceFinalize` was private | Accepted. `RunController.requestDispose()` beside the handle; behavior pinned for building/sealing/finalizing/terminal | Phase interface summary, P6.8, C-P7-1, V32, O9 |
| **C4** result-cap rejection leaves diagnostics/statistics committed | P5 summary (`addUnit` is the only refusing call, whole-unit rule) | Accepted. Admission first, then the total steps; failure after acceptance is a run-level failure | P6.5 `applyUnitResult`, C-P5-2, V28 |
| **I5** successful units recorded as failure reasons | §16.7 table A (U9 `cause: null`) | Accepted | P6.5, P6.1 `collectReasons`, V29 |
| **I6** runtime split children have no plan rank | P5 summary (`unitPlanRank`, unranked ⇒ `MAX_SAFE_INTEGER`); §11.4 rule 2 | Accepted. Normative `planPath` order + a live oracle re-ranked on every admitted split | P6.4/P6.5 `createUnitOrder`, C-P5-3, V30 |
| **I7** `derivedFromRunId` consumed but absent from `RunSpec` | P7.7 `rerun` (passes it into `buildRunSpec`); P6's `RunSpec` row omitted it | Accepted. Added and validated | Phase interface summary, P6.3, C-P7-2, V31 |
| **I8** sealing recovery assumes undocumented atomicity | A14 / P5 residency surface (no atomicity statement) | Accepted. Stated as a requirement on P5; P6 recovers by *asking* `getResident`, never by assuming | P6.8 `releaseIfStillReserved`, C-P5-1, V33 |
| **I9** terminal event emitted before the terminal phase | §9.2 rule 4 (snapshots built from committed state at state changes) | Accepted. `commitTerminal` before the emit, on both terminal paths | P6.8, V34 |
| **Q1** can `admitSealedSet` throw after converting? | — | Answered: it must not, and that is now C-P5-1; P6 does not depend on more than atomicity | C-P5-1 |
| **Q2** do all planning gaps reach `reasons`? | §6.6.2 cause enum; P5 `Ledger.planningGaps` | Answered: **yes** — all gaps are reasons, one primary cause decides the status | P6.1, P6.4, V35 |
| **Q3** order of runtime descendants? | §6.4 split order; §11.4 rule 2 | Answered: the `planPath` lexicographic order, prefix first | P6.5 |
| **Q4** can a non-returning executor be interrupted? | §10.1, spec F6 (drain, not discard) | Answered: **no**, and indefinite drain is accepted; every engine-owned wait stays bounded, no new timer | P6.8 table, O9 |
| **Q5** do detailed freshness reasons belong in sealed `reasons`? | §8.3 (bare enum), §16.4 ("with reasons"), AC-21 byte-identity | Answered: read-time only; sealed `outcome.reasons` carry the coarse facts | P6.6 |

### Items found in the spec that look contradictory (reported, not resolved)

- **C1 — `Freshness` is both a string and a value with reasons. RESOLVED by reconciliation (row N19); classification: *implementation-plan requirement*, not a spec defect.** §8.3 defines `RunOutcome.freshness` as the bare enum `'current'|'stale'|'unverifiable'`, and says `canClaimNoClashes(resultSet, currentFreshness)` "returns `false` when it is absent or not `'current'`" — a string comparison. But §16.4 requires `getFreshness` to return `stale` **"with the reason"** / **"with reasons"** (`scope-drift:<modelKey>`, `model-version-conflict:<modelKey>`), which a bare string cannot carry. **The settled plan-level rule, consistent with both sections:**
  1. `getFreshness` returns the frozen object **`Freshness = {state, reasons}`** (§16.4's "with reasons").
  2. `RunOutcome.freshness` stores the **bare `state` string** (§8.3's enum, and what gets digested and persisted).
  3. **P5 exports `freshnessStateOf(freshness)`** from `results/claim.js` (it did not before; reconciliation added it) as the single adapter, accepting either shape and returning `null` for anything unrecognized — so "absent ⇒ not claimable" is preserved as a fail-closed default rather than an exception.
  4. `assessNoClashClaim` / `canClaimNoClashes` accept **either** shape, reading through `freshnessStateOf` exactly once; given the object form they append its `reasons[]` to `qualifiers` so a refusal is explainable.
  Both sections' literal requirements are met simultaneously, so **no spec change is needed and none is proposed**. The observable rule ("not `current` ⇒ not claimable") is unaffected either way.
- **C2 — the bracket's owner. RESOLVED by reconciliation (duplicate-ownership D1); classification: *implementation-plan requirement*.** §7.1 ("the *executor* … runs the pre/post **scope-digest checks** (§16.3.2) via the `ElementEnumerator`") and §16.3.2 (the same protocol stated in the run's voice, "the engine") describe one mechanism from two sides — a division-of-labor ambiguity, not a semantic conflict. The settled split, which contradicts neither sentence: **P3** owns the *expectation* (`materializeUnit(...).scopeExpect`, incl. R20-1) and the *comparison* (`compareScopeExpectation`, `checkScopeBracket`, both in `planning/scopeDigest.js`); **P4's executor** owns the *per-unit execution* of the bracket (§7.1's "the executor … runs"), because it alone holds the live bindings and the lease state at call time; **P6** owns the *read-time* bracket inside `getFreshness` and the run-level consequences of a drift answer (§16.3.2's "the engine"). One comparison implementation, so the two proofs cannot diverge — which is what O2 was protecting — and **no `execution/` → `run/` import**, which O2's original direction would have required.
- **C3 — `secondaryCauses` cap vs. the fact set size.** §16.7 caps `secondaryCauses` at 8 "distinct, ascending by code-unit order", but the closed fact set has 13 members, so a settlement observing 9 or more distinct facts silently drops the tail. The cap is honored here (the drop is deterministic because the list is sorted first), and `RunOutcome.reasons` still records *every* fact at run level, so nothing is lost overall — but the spec does not say the unit-level list may be lossy. Worth an errata note; no behavior change made.
- **C4 — `target-too-large` outcome kind.** §8.3's unit-outcome enum lists `not-run:target-too-large` and §17.1 says "A whole-model target above it becomes a `not-run:target-too-large` gap", while §16.7 table A groups `target-too-large` with U8, whose other members are `failed:` gaps. P6 keeps `not-run` for `target-too-large` (the §17.1/§8.3 wording is explicit) and `failed` for the rest of U8. Reported, not redesigned.

---

## Conformance check

A green test suite proves the phase is self-consistent; it does **not** prove the phase calls the
interfaces its producers actually export, because every collaborator here is a fake. This section
is the mechanical proof, and it is a required step of Task P6.8. Run it from the repository root.

### What is checked

Every **consumer-assumed old name** the reconciliation register attributes to P6 (rows N1, N6, N10,
N11, N15, N16, N17, N19, N20, N21, N22, N23, N24, N31, N32), plus every identifier the internal
review's finding C1 called stale, plus the two names duplicate-ownership D1 removed from this phase
and the four test-support doubles P0 exports under different names (A18):

| Superseded / never-existed | Reconciled replacement | Row |
|---|---|---|
| positional `new ModelBindingError(reason, msg)`, `.code` | `new ModelBindingError({reason, modelKey})`, `.reason` | N1 |
| `slicer.step()` | `slicer.tick(label?)` | N6 |
| `binding.dead === true` | a dead / unregistered / lease-invalid binding **is `null`** | N10 |
| `createRegistry()` with no `world` | `createModelRegistry({ world })` | N11 |
| `planRun({bindings, runOptions, limits, ctx}) → Plan` | `planRun({definition, snapshot, enumerator, options, checkpoint, ledger}) → PlanResult` | N15 |
| `materializeUnit(...) → {sourceDbIds, targets}` | `… → {sourceDbIds, targets, scopeExpect}` | N16 |
| `splitUnit(plan, unitId, capacityKind)`, `result !== null` | `splitUnit(plan, unit)`, `'children' in result` else branch on `result.reason` | N17, R8 |
| `validateUnitOutcome → {ok:false, issues: string[]}`, hand-built substitute | `{ok, issues: Issue[]}` + `internalErrorOutcome(request, issues)` | N8 |
| `aggregateDiagnostics(...)` / `readDiagnostics(...)` | `diagnosticAggregator.addUnit(unitId, outcome)` / `.snapshot()` | N20 |
| `createResultSetDraft`, `draft.mergeUnit` / `recordUnit` / `recordPlanningGap` / `counters` | `createResultAccumulator` + `buildResultSet` + P3's `ledger` | N21 |
| `sealResultSet(draft, {outcome, diagnostics, slicer})` | `sealResultSet(draft, {slicer})` | N22 |
| `residency.admit({runId})`, `slot.attachSealed`, `handBackUnsaved()` | `reserveRunSlot` (P7's) / `admitSealedSet` / `drainForDispose()` | N23 |
| free `startPersistence(resultSet, …)`, `attempt.snapshot()` | `residency.beginPersist(runId, {persist})`, `getPersistenceState(runId)` | N24 |
| `resolveRunOptions(input)` | `resolveRunOptions(input, limits)` | N31 |
| a P6-owned bracket builder and comparator | P3's `materializeUnit(...).scopeExpect` and `checkScopeBracket` | D1 |
| `makeFakeClock` / `makeFakeRegistry` / `makeFakeEnumerator` / `makeFakePlan` / `makeScriptedExecutor` | `createFakeClock` / `createPlacementRegistry` / `createFakeEnumerator` / `createFakePlan` / `createScriptedExecutor` | A18 |

### The commands

```sh
F=docs/superpowers/plans/federated-clash-test-core/p6-run-lifecycle.md
BODY() { sed '/^## Conformance check/,$d' "$F"; }                      # exclude this section itself
CODE() { BODY | awk '/^```/{f=!f;next} f' | sed -e 's://.*$::' -e "s:'[^']*'::g"; }

STALE='buildScopeExpect|createResultSetDraft|\.mergeUnit|draft\.recordUnit|draft\.recordPlanningGap|draft\.counters|draft\.unitRecords|startPersistence|attachSealed|handBackUnsaved|aggregateDiagnostics|readDiagnostics|residency\.admit\(|run\.slot|\.dead\b|slicer\.step|\.step\(\)|digestOf\(|captureDefinition|makeFake|makeScripted|runFixture\(|unitId, capacityKind|result !== null|split !== null|plan\.planningGaps|run\.plan\.units\.length <|spec\.store|RunQueueFullError|ENV_CAUSES|environmentSensitiveCauses\.add|coverageFromLedger|integrityFrom|issues: string|scopeBracket|error\.code|bindings: run\.snapshot|runOptions: run\.runOptions|ctx: run\.enumerationContext|ModelBindingError\([a-z]'

# (a) executable contexts — fenced code with comments and single-quoted strings stripped,
#     so a name may survive in prose that says it does NOT exist, but never in a call.
CODE | grep -n -E "$STALE"; echo "matches: $(CODE | grep -c -E "$STALE")"

# (b) whole file — names that must not survive anywhere, not even in a note.
BODY | grep -n -E 'buildScopeExpect|scopeBracket|makeFakeClock|makeFakeRegistry|makeFakeEnumerator|makeFakePlan|makeScriptedExecutor'
```

### Result (run 2026-09-20, against this revision of the file)

```
--- (a) executable contexts
matches: 0
--- (b) whole file
matches: 0
```

Two further checks, recorded because a zero-hit grep alone cannot distinguish "corrected" from
"deleted":

1. **The reconciled names are present and in use.** `grep -c` over the file:
   `createResultAccumulator` 3 · `buildResultSet` 11 · `deriveRunOutcome` 9 · `admitSealedSet` 8 ·
   `releaseRunSlot` 5 · `beginPersist` 6 · `getPersistenceState` 3 · `drainForDispose` 3 ·
   `diagnosticAggregator` 9 · `internalErrorOutcome` 9 · `materializeUnit` 13 ·
   `checkScopeBracket` 15 · `createRecordBudget` 6 · `createLedger` 5 · `toLedgerRecord` 8 ·
   `snapshotBindings` 13 · `bindingsEquivalent` 6 · `freshnessStateOf` 6 · `createModelRegistry` 5 ·
   `resolveRunOptions` 3.
2. **`admitModel` survives in exactly one place**, and it is the assertion that P6 calls it **zero**
   times (`assert.equal(fx.world.calls.admitModel, 0, …)`, Task P6.4, ruling R7). Any other
   occurrence would mean the second admission loop came back.

### Additions from the re-verification remediation (round 2)

The re-verification found four Critical and five Important defects whose common shape is *P6 calling
a collaborator the way P6 wished it worked*. Six of the corrections leave a **spelling** behind that
must never come back, so they get the same mechanical treatment as the reconciliation's names. Note
that `CODE()` strips single-quoted strings, so a bare literal like `'placement-contention'` — which
is a **legitimate** environmental cause in prose and in P5's derivation — cannot be checked there;
the ones below are therefore matched on the **call shape around** the literal, and on the whole file
where the shape is unambiguous.

| Superseded / never-existed | Correct form | Finding |
|---|---|---|
| `facts: ['placement-contention']`, a `placement-contention` fact or unit cause | P4's `failure.code: 'stale-placement'` + `retryable: true`; `placement-contention` only as P5's derived **environmental cause** | C1 |
| `{ environmentSensitiveCause: … }` passed from P6 | P5's `deriveRunOutcome` derives it from the ledger (A13) | C1 |
| `unitCauses.push(settlement.cause ?? 'evaluated')` | `if (settlement.cause !== null) unitCauses.push(settlement.cause)` | I5 |
| `unitPlanRank: new Map(run.plan.units…)` | `unitPlanRank: run.unitOrder` (the live oracle) | I6 |
| `handle.requestDispose`, dispose control on `RunHandle` | `createRun(...).controller.requestDispose()` | C3 |
| `run.spec.derivedFromRunId ?? null` at the seal | validated once in `createRun`; `run.derivedFromRunId` | I7 |

```sh
# (c) round-2 prohibitions — executable contexts, where the shape survives quote-stripping.
# Note the deliberate shapes: `environmentSensitiveCause:` with the colon does not match the
# LEGITIMATE plural `environmentSensitiveCauses`, and `handle.requestDispose(` (a call) does not
# match V32's assertion that `handle.requestDispose` is `undefined`.
STALE2='environmentSensitiveCause:|unitCauses\.push\(settlement\.cause \?\?|unitPlanRank: new Map|handle\.requestDispose\(|spec\.derivedFromRunId \?\?|run\.results\.toArray\(\) \?\?'
CODE | grep -n -E "$STALE2"; echo "matches: $(CODE | grep -c -E "$STALE2")"

# (d) round-2 prohibitions — whole file, for the shapes a stripped string would hide.
BODY | grep -n -E "facts: \['placement-contention|'placement-contention'\]\}|cause: 'placement-contention'"
echo "matches: $(BODY | grep -c -E "facts: \['placement-contention|'placement-contention'\]\}|cause: 'placement-contention'")"
```

### Result (round-2 run, against this revision of the file)

```
--- (a) executable contexts
matches: 0
--- (b) whole file
matches: 0
--- (c) round-2 executable contexts
matches: 0
--- (d) round-2 whole file
matches: 0
```

Two presence checks, for the same "corrected, not deleted" reason as the originals: the reconciled
retry shape is in use — lines matching `stale-placement` 32 · `retryable` 17 ·
`isRetryablePlacement` 4 · `placementGenerationsSteady` 3 — and the new P6-owned names are each
defined once and used: `EMPTY_RESULTS` 6 · `createUnitOrder` 4 · `run.unitOrder` 5 ·
`RunController` 6 · `requestDispose` 26 · `commitTerminal` 6 · `releaseIfStillReserved` 3
(`grep -c` over the whole file, this revision).

### When to re-run it

Re-run (a) and (b) after **any** edit to this file, and after any change to a producer's *Phase
interface summary* — a rename in P0–P5 makes this file stale again, and the tests here cannot
detect it because they run against fakes.
