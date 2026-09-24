# Engine facade, integration, acceptance traceability, docs — Phase P7 Implementation Plan

**Goal:** Assemble the parts P0–P6 built into the one public surface the spec names in §18 — `createClashTestEngine` wiring every port (world, enumerator, registry, unit executor, test store, result store) and exposing the definition, run, residency/persistence, freshness/claim and disposal methods — then prove the assembled engine against the *real* `CollisionWorld` — with a differential suite **and** the five T2 integration families (cancellation mid-plan, mixed reachable/unreachable owners, diagnostic fan-out stress, dirty-world and geometry readiness, disposal and eviction mid-run) that carry this phase's share of AC-7/17/18/19/21 — pin the producer/reader round trip that AC-12's calibration will later freeze, map every spec §22 acceptance criterion to a named test or a named deferral owner, and land the CHANGELOG/README/handoff updates that spec §21.3 requires. P7 owns no algorithm of its own: where it looks like it is deciding something, it is wiring an owner phase's decision and testing the seam.

Master: ../2026-09-20-federated-clash-test-core-engine-implementation.md

## Global Constraints

This phase inherits the master's Global Constraints in full. Phase-specific constraints, copied verbatim from the spec:

- §21.3: "Existing acceptance/performance harnesses and `npm test` are untouched, and `npm test` must stay free of any live server or APS credentials (live coverage is script-based, like the existing acceptance and regression scripts)."
- §21.3: "None. There is no existing consumer, stored data, or schema to migrate; the layer is additive and new (`clashtest/`, `test/clashtest/`)."
- §19.1: "`CollisionWorld.findClashes` and every public library contract … stay exactly as they are. The engine calls them; it does not wrap, patch, or subclass them, and reaches no `_`-prefixed member or module-internal."
- §15.3: "`engine.rerun(runIdOrResultSet, { definitionRevision?, runOptions? }) → Promise<RunHandle>` (**asynchronous, R21-1**: both a raw set and a by-id set must be captured/read and validated first, §13.6, so errors need a Promise; `startRun` stays synchronous)."
- §15.3: "Prior Result Sets are **never mutated**. There is no incremental/partial rerun in v1."
- §13.6: "the capture runs **synchronously inside the call, before the returned Promise's first `await`**, so a caller that mutates its object immediately after the call cannot affect the operation."
- §18: "`EngineDisposedError` (any method after `dispose()` is called, except `dispose()` itself which is idempotent and non-throwing here — unlike `CollisionWorld.dispose()`)."
- §15.1: "The determinism contract above holds for runs with `environmentSensitive = false`." and "For `time-sensitive` runs the engine **promises no repeatability** whenever a `crossing-budget-exhausted` caveat is present, and a differing rerun is not by itself a defect."
- §17.1 calibration gate: "*No default in this section — including the 16,000,000-node capture ceiling and the 512 MiB stored-result allowance … — may be implemented as a frozen constant before the AC-12 calibration; until then they ship only as provisional, overridable defaults.*"

**Simplification note (convergence review §2, permitted by the master's preamble).** Where the spec over-specifies machinery this phase touches, P7 picks the simplest mechanism preserving the externally observable invariant and says so at the task. The three places this happens are: (1) the ambiguous-commit reconciliation loop (`PersistenceOutcomeUnknownError` → one reconciliation read → `reconcileTimeoutMs`) is **not** wired in the core engine — the core's `ResultStore` port is local and transactional (master §1.2, gate G-REMOTE), so a `put` rejection is the end of the attempt and the typed error plus its port-conformance case stay in P5; (2) `StoreNotConfiguredError` is raised by exactly the store-requiring methods named in Task P7.3 rather than by a general capability negotiation; (3) the engine object exposes no `annotate` and no `derivations` (see Gates and open items).

---

## Phase interface summary

Every name P7 exports. Other phases' writers may rely on these signatures; names follow spec §18 and the master's module map §2.

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `createClashTestEngine` | `clashtest/engine.js` | `({world, enumerator, registry?, unitExecutor?, testStore?, resultStore?, limits?, hierarchyInternalAcceptance?, libraryVersion?, spanRecorder?, now?, yieldToScheduler?}) → ClashTestEngine` | Builds the engine over one `CollisionWorld`; joins (or validates) the world-scoped registry; validates `limits` synchronously via P0 `resolveEngineLimits`. |
| `ClashTestEngine#registry` | `clashtest/engine.js` | `ModelRegistry` | The world-scoped registry (§4.3), read-only property. |
| `ClashTestEngine#validateTest` | `clashtest/engine.js` | `(def) → {issues, issuesTruncated}` | Pure passthrough to P2 `validateTest`; never throws for data errors. |
| `ClashTestEngine#saveTest` | `clashtest/engine.js` | `(def) → Promise<ClashTestDefinition>` | Capture → validate → `testStore.put`; rejects `InvalidTestDefinitionError`, `RevisionConflictError`, `TestDeletedError`, `TestArchivedError`. |
| `ClashTestEngine#getTest` | `clashtest/engine.js` | `(testId, revision?) → Promise<ClashTestDefinition\|null>` | No revision ⇒ latest (also when archived). |
| `ClashTestEngine#listTests` | `clashtest/engine.js` | `({limit?, cursor?}) → Promise<{summaries, next?}>` | Validated `TestSummary` page; `CorruptListingError` on a bad page. |
| `ClashTestEngine#listResults` | `clashtest/engine.js` | `({testId?, limit?, cursor?}) → Promise<{summaries, next?}>` | Validated `ResultSetSummary` page; takes a read slot. |
| `ClashTestEngine#archiveTest` | `clashtest/engine.js` | `(testId) → Promise<void>` | One-way `active → archived`, all revisions. |
| `ClashTestEngine#deleteTest` | `clashtest/engine.js` | `(testId) → Promise<void>` | `resultStore.tombstoneTest(testId)` **then** `testStore.delete(testId)`; idempotent, fail-closed order (§5.5, §18). |
| `ClashTestEngine#startRun` | `clashtest/engine.js` | `(definition \| {testId, revision?}, runOptions?) → RunHandle` | **Synchronous; throws, never rejects** (controller ruling R1: only Promise-returning entry points reject). Captures the input, validates it, resolves options, reserves a residency slot, checks queue admission, then `createRun(spec).begin()` and returns `handle`. |
| `ClashTestEngine#rerun` | `clashtest/engine.js` | `(runIdOrResultSet, {definitionRevision?, runOptions?}) → Promise<RunHandle>` | Capture (sync, pre-`await`) → read/validate → admit → start with `derivedFromRunId`. |
| `ClashTestEngine#getRun` | `clashtest/engine.js` | `(runId) → RunHandle \| null` | Active/queued runs and terminal runs whose set is still resident; `null` once nonresident. |
| `ClashTestEngine#getResultSet` | `clashtest/engine.js` | `(runId) → Promise<ResultSet\|null>` | Resident copy, else store read-through through a read slot (never made resident). |
| `ClashTestEngine#discardRun` | `clashtest/engine.js` | `(runId) → Promise<void>` | Release-with-acknowledgement + chained `resultStore.delete`; `RunNotTerminalError` for a live run. |
| `ClashTestEngine#retainResultSet` | `clashtest/engine.js` | `(runId) → {release()}` | Lease on a `saved` set; `UnsavedResultSetError` / `ResultNotResidentError`. |
| `ClashTestEngine#releaseResultSet` | `clashtest/engine.js` | `(runId, {acknowledgeUnsaved?}) → void` | Drops the resident copy only; idempotent for a nonresident id. |
| `ClashTestEngine#retryPersist` | `clashtest/engine.js` | `(runId) → Promise<PersistenceOutcome>` | New attempt for a `failed` set only. |
| `ClashTestEngine#getPersistenceState` | `clashtest/engine.js` | `(runId) → PersistenceSnapshot \| null` | Synchronous; `null` for any nonresident id, never throws for an unknown id. |
| `ClashTestEngine#getFreshness` | `clashtest/engine.js` | `(runIdOrResultSet) → Promise<Freshness>` | Bound form of P6 `getFreshness`; returns the frozen **object** `{state, reasons}` unchanged (controller ruling R3). Raw sets take a read slot and are captured first. |
| `ClashTestEngine#canClaimNoClashes` | `clashtest/engine.js` | `(runIdOrResultSet) → Promise<boolean>` | Recomputes freshness, then passes that **`Freshness` object straight through** to P5 `canClaimNoClashes` (R3); `true` only when `unqualified`. |
| `ClashTestEngine#assessNoClashClaim` | `clashtest/engine.js` | `(runIdOrResultSet) → Promise<ClaimAssessment>` | Same read-through/freshness, same straight-through `Freshness` object; the only path returning qualifiers (and therefore §16.4's `reasons`). |
| `ClashTestEngine#invalidateModelPlacement` | `clashtest/engine.js` | `(modelKey) → void` | One-line delegate to **`registry.invalidateModelPlacement(modelKey)`** — P1's §16.2 "single call", which bumps `placementGeneration` and then calls `world.invalidateModelPlacement(model)`. |
| `ClashTestEngine#retentionReport` | `clashtest/engine.js` | `() → {slotsInUse, cap, sets: Array<{runId, class, persistence}>, readSlotsInUse}` | §17.2 retention view; plain data. |
| `ClashTestEngine#dispose` | `clashtest/engine.js` | `() → Promise<DisposeSummary>` | Idempotent, never throws, returns the same promise; `{droppedUnsaved: [{runId, resultSet}], persistenceInFlight: runId[]}`. **Signals before it waits:** `stopAdmitting(engineId)` → `controller.requestDispose()` on **every** owned run (queued *and* in-flight/persisting, P6's engine-only control surface) → `await` their `done` → `residency.drainForDispose()` (Task P7.5). The signal bounds every wait the **engine** owns — the queue, the unit boundary, the seal, and the `persistTimeoutMs` finalize window — but an in-flight unit is **drained, never abandoned** (§10.1–§10.2, F6 *drain, not discard*), so `dispose()` legitimately stays pending until that unit's executor returns. Executor non-return is an **accepted limit of an injected port** (P6 open item O9 / its Question 4), not a P7 defect to engineer around. |
| `createClashTestEngine`, `validateTest`, `assessNoClashClaim`, `canClaimNoClashes`, `getPairStatus`, `getElementStatus`, `getFreshness`, `createInMemoryClashTestStore`, `createInMemoryResultStore`, `createLocalUnitExecutor`, `createModelRegistry`, `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS`, every error class | `clashtest/index.js` | re-exports | The single public entry point of the layer, mirroring `collision/index.js`'s pure-re-export convention. **Reconciled sources:** `validateTest` ← P2 `definition/validate.js`; `assessNoClashClaim`/`canClaimNoClashes` ← P5 `results/claim.js`; **`getPairStatus`/`getElementStatus` ← P5 `results/status.js`, never P8 `derive/` (duplicate-ownership D4)**; `getFreshness` ← P6 `run/freshness.js`; **`createModelRegistry` ← P1 `identity/ModelRegistry.js`, a factory P1 added during reconciliation (N11)** — it did not exist when this row was written. P8's Task P8.8 later adds `createDerivationContext` to this list and re-exports the same two status functions it consumes from P5. |

Test-support modules P7 adds to the shared `test/clashtest/support/` tree (P0 owns the directory; later phases add, never fork — master §2.1 rule 5):

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `makeRealWorldFixture` | `test/clashtest/support/realWorld.mjs` | `({models, fragments?, renderProxy?, worldOptions?, register?}) → {world, viewer, models: Map<modelKey, Model>, modelFor, enumerator, registry, setRenderProxyAvailable}` | Builds N mock models (`buildMockModel`) over ONE shared fake viewer, a real `CollisionWorld`, a tree-backed `ElementEnumerator` derived from the same tree, and a populated registry. The four options are the seams the six real-world integration families need (Task P7.8 Step 11 — F6 and F4c add no fifth option: they reuse `fragments` and `worldOptions`), each defaulted so the Step 1–10 fixtures are unchanged: `fragments` passes `buildMockModel`'s own `fragmentCount`/`notLoadedFragIds`/`ownerDbIdOverrides`/`hiddenDbIds` per model, `renderProxy(modelKey, fragId) → boolean` gates the shared `viewer.impl.getRenderProxy` (⇒ the real world's own `RenderProxyUnavailableError` ⇒ a `geometry-not-yet-available` diagnostic), `worldOptions` reaches `CollisionWorld.fromViewer`'s documented `now`/`yieldToScheduler`, and `register` limits which models the registry binds. |
| `recordFindClashes` | `test/clashtest/support/realWorld.mjs` | `(world) → {calls: Array<{query, pairs, statistics}>, restore()}` | The suite's one recording seam: an own-property override on the `CollisionWorld` **instance** that delegates to the real method. Never a substitute world — `getWorldCoordinator`/`assertRegistryBelongsToWorld` key on world identity. Used by the library-call conformance arm (Step 8) and by the AC-18(d)/AC-21 arms. |
| `bruteForceReference` | `test/clashtest/support/bruteForce.mjs` | `(world, {sources, targets, mode, clearance, broadPhase}) → Promise<{pairIds: string[], calls: number}>` | One `findClashes` per (source owner dbId × target model), unioned and mapped to canonical `PairId`s through P1's `makePairId(mode, x, y)` — the reference the differential suite compares against. |
| `pairKey` | `test/clashtest/support/bruteForce.mjs` | `(PairId) → string` | `canonicalJson(pairId)` (P0). A `PairId` is the closed record `{first, second}` and carries no string key, so both sides of the differential comparison are keyed the same way without inventing an encoding. |
| `maximumShapeSet` | `test/clashtest/support/maximumShape.mjs` | `({resultCount, ledgerRecordCount, diagnosticCount}) → ResultSet` | Synthesizes a schema-valid Result Set at configurable counts for the AC-12 harness. |
| `measuredNodes` | `test/clashtest/support/maximumShape.mjs` | `(ResultSet) → number` | `captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes` (P0). P0 ships the *worst-case* formula (`worstCaseCapturedNodes`) but no per-set counter, so this is the one wrapper. |

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `clashtest/engine.js` | Create (P7) | `createClashTestEngine`: port wiring, engine-limit validation, method surface, dispose lifecycle. The only module in the core that knows every other module. |
| `clashtest/index.js` | Create (P7) | Pure re-export entry point. No side effects (mirrors `collision/index.js`). |
| `test/clashtest/support/realWorld.mjs` | Create (P7) | Real-`CollisionWorld` fixture builder for T2 work. **Deliberately separate from P4's `support/realWorldFixture.mjs`** (both mirror `test/CollisionWorld.findClashes.crossModel.test.mjs`): P4 ships first and cannot import a P7 file, and P0's support extension rule 2 forbids P7 from editing P4's — so one shared builder is not reachable without relaxing that rule. This one is the N-model, engine-grade fixture (shared viewer, enumerator, registry, and the `fragments`/`renderProxy`/`worldOptions`/`register` seams of Step 11); P4's is the two-model executor fixture. Neither is an oracle for the other, so nothing breaks if they drift (verified against duplicate-ownership decisions D1–D4, 2026-09-21). |
| `test/clashtest/support/bruteForce.mjs` | Create (P7) | Per-pair reference implementation for the differential suite. |
| `test/clashtest/support/maximumShape.mjs` | Create (P7) | Maximum-shape Result Set synthesizer. |
| `test/clashtest/engine/construction.test.mjs` | Create (P7.2) | Construction, limits, registry join/mismatch, `EngineDisposedError`, dispose idempotence. |
| `test/clashtest/engine/definitions.test.mjs` | Create (P7.3) | `validateTest`/`saveTest`/`getTest`/`listTests`/`listResults`/`archiveTest`, `StoreNotConfiguredError`. |
| `test/clashtest/engine/deleteTest.tombstone.test.mjs` | Create (P7.3) | §13.5 two-layer delete order and the NH3 engine-level bypass matrix of AC-1. |
| `test/clashtest/engine/startRun.test.mjs` | Create (P7.4) | Both overloads, synchronous error contract, `getRun`, `getResultSet`. |
| `test/clashtest/engine/residency.test.mjs` | Create (P7.5) | retain/release/discard/retryPersist/getPersistenceState/retentionReport, `DisposeSummary`. |
| `test/clashtest/engine/claim.test.mjs` | Create (P7.6) | `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `invalidateModelPlacement`, raw-set entry rules. |
| `test/clashtest/engine/rerun.test.mjs` | Create (P7.7) | `rerun` promise contract, capture-first, `definitionRevision`, comparability reporting. |
| `test/clashtest/integration/differential.test.mjs` | Create (P7.8, Steps 1–10) | Engine-over-real-`CollisionWorld` vs brute force, four modes × four selection shapes, partition/broad-phase invariance, determinism, library-call conformance. |
| `test/clashtest/integration/realWorldProvenance.test.mjs` | Create (P7.8, Steps 12–13) | Real-world provenance and fan-out arms: mixed reachable/unreachable owner in both orientations plus the F3 library fact (AC-17 b, f), and diagnostic stress with its un-sliced negative control (AC-18 d). |
| `test/clashtest/integration/realWorldEnvironment.test.mjs` | Create (P7.8, Steps 14–17b) | Real-world environment and lifecycle arms: cancellation mid-plan with the evaluated-subset comparison (AC-7), dirty world (AC-19 a), geometry readiness (AC-19 e), world disposal and model eviction mid-run (AC-21), equal `admissionBaseline` / different membership at the real capacity ceiling (AC-19 b′, Step 17a), and foreign placement contention with its host-signalled negative control (AC-19 d′ at T2, Step 17b). |
| `test/clashtest/integration/maximumShape.test.mjs` | Create (P7.9) | AC-12 produce → persist → evict → read → validate → rerun round trip at configurable ceilings. |
| `CHANGELOG.md` | Modify (P7.10) | One entry for the additive `clashtest/` layer. |
| `README.md` | Modify (P7.10) | Pointer to `clashtest/README.md` and the spec. |
| `clashtest/README.md` | Create (P7.10) | Layer overview, ports, provisional-defaults warning, what is deferred. |
| `docs/handoffs/latest.md` | Modify (P7.10, P7.11) | Handoff state per project CLAUDE.md. |

---

### Task P7.1: Cross-phase interface reconciliation (pre-implementation gate, no code)

The master requires one consistency check before P0 implementation starts: every phase's **Phase interface summary** must agree with every consumer's **Consumes** block. This task is a checklist a reviewer executes by reading the seven phase files; it produces a short reconciliation record, not a script.

> **A first full pass has already been run and applied.** Its output is **[`interface-reconciliation.md`](interface-reconciliation.md)** — the cross-phase name register, the duplicate-ownership decisions, the merged spec-issues register and the list of items still needing a controller decision — and the corresponding edits are already in the phase files (every one is listed there). **This task is therefore a verification pass, not a from-scratch derivation:** walk the steps below against that file, confirm each recorded decision still matches the phase files, and record only *new* drift introduced since. **Blocking before implementation starts:** the file's §(iv) "items needing a human/controller decision" must be empty or explicitly dispositioned by the milestone owner.

**Files**
- Create: none (the record is `interface-reconciliation.md`; the verification outcome is appended to `docs/handoffs/latest.md` under "P7 interface reconciliation" in Task P7.10).
- Modify: `docs/superpowers/plans/federated-clash-test-core/interface-reconciliation.md` (new rows only, if drift is found).
- Test: none — this task has no runtime deliverable. Its acceptance is the reviewer's signed checklist.

**Interfaces**
- Consumes: every phase file's `## Phase interface summary` table, and `interface-reconciliation.md`.
- Produces: a verification record: for each new mismatch, `{consumer phase, consumed name, consumer's assumption, owner's declaration, resolution}`.

**Steps**

- [ ] **Step 1: Build the name inventory.** List, from P0–P8's Phase interface summaries, every exported name with its module path and signature. One row per name. A name that appears in two owners' tables is a defect — the master's rule 1 says each module has exactly one owning phase.
- [ ] **Step 2: Resolve every `Assumed` block.** Each phase file states assumptions about earlier phases under `Assumed`. For each, check the owner's declaration. Record one of: `matches`, `owner-differs (adopt owner)`, `owner-silent (owner must add it)`. No `Assumed` entry may survive into implementation unresolved.
- [ ] **Step 3: Check the closed-DTO rule.** For each DTO named in master §2.1 rule 2 (`ClashTestDefinition`, `ExecutionRequest`, `UnitOutcome`, `ProjectedDiagnostic`, `NormalizedDiagnostic`, `RunOutcome`, `ResultSet`) confirm exactly one schema module and one `validate*` function exists in exactly one phase, and that every consumer calls it rather than duck-typing.
- [ ] **Step 4: Check the two-diagnostic-DTO split (errata item 2).** Confirm `ProjectedDiagnostic` appears only in P4's executor-facing signatures and `NormalizedDiagnostic` only in stored/aggregated ones, with exactly one projection→aggregation bridge function named in P4's table.
- [ ] **Step 5: Check the defaults rule (errata item 3).** Grep every phase file for a bare numeric literal that matches a spec §17.1 default (`200`, `500`, `10000`, `100000`, `4`, `20000`, `2`, `8`, `5000`, `1024`, …) appearing outside a table row that cites §17.1. Every one must be an import from `clashtest/options.js`, in both modules and tests.
- [ ] **Step 6: Check `result.mode` (errata item 1).** Grep every phase file for `result.type` / `.type` on a `ClashResult`; there must be none. The persisted field is `mode` (§11.1, §13.6).
- [ ] **Step 7: Check the error inventory.** Every error name in spec §18's error paragraph must be either (a) declared in P0's `errors.js` table, or (b) listed in this file's Gates and open items as out of core with its owner. No third state.
- [ ] **Step 8: Record and sign.** Write the reconciliation record. Any `owner-silent` row blocks the start of the owning phase until that phase file is amended (amendment is a plan edit, not an implementation decision).
- [ ] **Step 9: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.2: `createClashTestEngine` — port wiring, engine limits, registry join, dispose lifecycle

**Files**
- Create: `clashtest/engine.js`
- Test: `test/clashtest/engine/construction.test.mjs`

**Interfaces**

*Consumes — **RECONCILED** against each owner's Phase interface summary (producer wins). Task P7.1 now **verifies** [`interface-reconciliation.md`](interface-reconciliation.md) rather than re-deriving it:*
- `clashtest/options.js` (P0): `resolveEngineLimits(input) → frozen ResolvedLimits` (throws `InvalidOptionsError{issues}` listing every issue), `ENGINE_LIMIT_DEFAULTS`, `RUN_OPTION_DEFAULTS`, `SCHEMA_MAX_NODES`, `BYTES_PER_NODE`. ✔ as assumed. **Issue `path`s are JSON pointers** (`/maxResidentResultSets`), never bare key names, and the code vocabulary is closed (`bad-shape`, `unknown-key`, `not-an-integer`, `not-a-boolean`, `bad-enum`, `below-minimum`, `above-ceiling`, `cross-field`) — every P7 assertion below spells them that way.
- `clashtest/identity/ModelRegistry.js` (P1) — **CHANGED (N11):** `createModelRegistry({ world, makeSessionId? }) → ModelRegistry`; **`world` is required** and there is no `now` option. P7 does not construct one in production (the coordinator owns the world's single registry); it constructs one in tests only, to build a *foreign* registry. `assertRegistryBelongsToWorld(registry, world) → registry` throws `ModelBindingError({reason:'registry-mismatch'})`, and it is what P7's host-supplied-registry check calls. `registry.invalidateModelPlacement(modelKey) → number` is the §16.2 single call P7's engine method delegates to.
- `clashtest/errors.js` (P0): `InvalidOptionsError`, `ModelBindingError`, `EngineDisposedError`, `StoreNotConfiguredError`, and every other §18 name. **Every class is constructed with one object argument** — `new XError({...typedFields, message?, cause?})`, never positionally — `error.name` is the class name, and every typed field is plain data (N1). The discriminant P7 branches on for a binding failure is **`error.reason`** (`'registry-mismatch'`, `'coordinator-version-mismatch'`, `'model-not-bound'`, …); the only `code` anywhere in this file is the `code` of an `Issue` (`{path, code, message}`).
- `clashtest/util/slicer.js` (P0) — **CHANGED (N6):** `createSlicer({now?, yieldToScheduler?, limits?, sliceBudgetMs?, maxItemsPerSlice?, checkEvery?, spanRecorder?, afterYield?}) → {tick(label?), yieldNow(label?), forEach(list, fn, opts?), sortSliced(list, compare, opts?), stats()}`. `tick()` returns `undefined` (not due) or a Promise (due), so the call site is `const p = slicer.tick('x'); if (p) await p;`. **One slicer per sliced operation** (P0's own rule), so the engine holds a `newSlicer(label)` factory, never one long-lived shared slicer.
- `clashtest/run/coordinator.js` (P6) — **CHANGED (N25):** `getWorldCoordinator(world, {protocolVersion?, createRegistry?, now?, yieldToScheduler?}) → Coordinator` where `Coordinator = {world, protocolVersion, registry, enqueue(job) → QueueTicket, cancelQueued(runId) → boolean, stopAdmitting(engineId), queueDepth(engineId?) → number, inFlightRunId() → string|null}` and `QueueTicket = {runId, started: Promise<void>, withdraw() → boolean}`. `getWorldCoordinator` builds the world's single registry once, through `createRegistry({world})`, defaulting to P1's `createModelRegistry` — which is why P7 never constructs one and `engine.registry` is `coordinator.registry`. A run is created by P6's **`createRun(spec) → {handle, begin(), controller}`** and reaches the coordinator's queue through **`begin()`**, so P7's `startRun` calls `createRun(spec)`, then `begin()`, then returns `handle` — and keeps `controller` (the engine-only control surface, Task P7.4) in its own `runId → {handle, controller}` map. For `dispose()`, P7 calls **`stopAdmitting(engineId)`**, then **`controller.requestDispose()` on every owned run**, and only then awaits the engine's own outstanding `handle.done` promises; `inFlightRunId()` and `queueDepth(engineId)` are the only run-census readers the coordinator offers, and **`queueDepth` counts runs *waiting* — the in-flight run is not in it** (controller ruling R6). `getWorldCoordinator` throws `ModelBindingError({reason:'coordinator-version-mismatch'})` on a protocol mismatch; the `registry-mismatch` throw for a host-supplied registry is P7's own, using P1's `assertRegistryBelongsToWorld`. **The coordinator enforces no queue limit of its own** (R6): `maxQueuedRuns` is an *engine* limit, `enqueue` never throws `RunQueueFullError`, and P7 checks the depth *before* the run is handed over (Task P7.4).
- `clashtest/execution/LocalUnitExecutor.js` (P4) — **CHANGED (N26):** `createLocalUnitExecutor({world, registry, enumerator, now, yieldToScheduler, sliceBudgetMs}) → UnitExecutor` where **`UnitExecutor` is itself a function** `(request) => Promise<UnitOutcome>`. P7 passes it straight through as the run's `executor` and calls no method on it. All six dependencies are required and P7 already holds every one. **D2 conformance:** P7 wires no lease check of its own — the per-unit `world.isLeaseValid(binding.lease)` gate is the executor's (P4) and the run-start **binding snapshot** is P6's (one `snapshotBindings` call, no `admitModel` sweep — R7).
- `clashtest/stores/InMemoryClashTestStore.js` (P2): `createInMemoryClashTestStore({now?} = {}) → ClashTestStore`. ✔
- `clashtest/results/InMemoryResultStore.js` (P5): `createInMemoryResultStore({now?}) → ResultStore`. ✔
- `clashtest/results/residency.js` (P5) — **CHANGED (N23):** `createResidencyManager({limits, resultStore, now, onPersistence}) → ResidencyManager` with `reserveRunSlot(runId)` / `releaseRunSlot(runId)` / `admitSealedSet(runId, resultSet)` / `beginPersist(runId, {persist}) → Promise<PersistenceOutcome>` / `getPersistenceState(runId) → PersistenceSnapshot|null` / `retryPersist(runId) → Promise<PersistenceOutcome>` / `retainResultSet(runId) → {release()}` / `releaseResultSet(runId, {acknowledgeUnsaved})` / `discardRun(runId) → Promise<void>` / `getResident(runId) → ResultSet|null` / `touch(runId)` / `retentionReport() → object` / **`drainForDispose() → {droppedUnsaved, persistenceInFlight}`**, whose return value *is* the engine's `DisposeSummary`. Slot reservation and slot release are the two separate calls P7's admission prefix pairs for its atomic rollback (Task P7.4). `onPersistence` is the manager's state-change callback; **P7 passes it through to the run so P6 owns the `persisted` promise and the `'persistence'` event, and P7 owns only the state projection.**
  Also from P5: `createReadCoordinator({limits}) → {reserveSync() → slot, acquire() → Promise<slot>, inUse() → number}`, where every slot is `{release()}`. **`reserveSync()` is the raw-set path** — it returns a slot or throws `ReadCapacityError{limit}` immediately, never queueing — and **`acquire()` is the by-id path**, resolving immediately when a slot is free, queueing up to `maxQueuedStoreReads`, and otherwise rejecting `ReadCapacityError{limit}`.

*Produces:* `createClashTestEngine(config) → ClashTestEngine` with the property/method set of the Phase interface summary.

**Steps**

- [ ] **Step 1: Write the failing construction test.**

```js
// test/clashtest/engine/construction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/engine.js';
import { InvalidOptionsError, ModelBindingError, EngineDisposedError } from '../../../clashtest/errors.js';
import { ENGINE_LIMIT_DEFAULTS } from '../../../clashtest/options.js';
// The engine's world must carry BOTH surfaces: `findClashes` (P0's `createFakeWorld`) *and* the
// lease surface P1's registry validates at construction (`makeLeaseWorld`). P0's double alone has
// no `admitModel`/`isLeaseValid`, so `getWorldCoordinator` -> `createModelRegistry({world})` would
// throw `ModelBindingError{reason:'invalid-world'}` before any of these assertions ran. P4's
// `createExecutionWorld` is the composed double (P4 file structure; it exists for exactly this).
import { createExecutionWorld } from '../support/executionWorld.mjs';
import { makeLeaseWorld } from '../support/leaseWorld.mjs';       // P1.4 — a lease-only world
import { createFakeEnumerator } from '../support/fakeEnumerator.mjs';
import { createModelRegistry } from '../../../clashtest/identity/ModelRegistry.js';

const base = () => ({ world: createExecutionWorld(), enumerator: createFakeEnumerator() });

test('required ports are required', () => {
  assert.throws(() => createClashTestEngine({ enumerator: createFakeEnumerator() }), /world/);
  assert.throws(() => createClashTestEngine({ world: createExecutionWorld() }), /enumerator/);
});

test('two engines over one world share one registry object', () => {
  const cfg = base();
  const a = createClashTestEngine(cfg);
  const b = createClashTestEngine({ ...cfg });
  assert.equal(a.registry, b.registry);
  assert.equal(a.registry.registrySessionId, b.registry.registrySessionId);
});

test('a foreign registry is a registry-mismatch ModelBindingError', () => {
  const cfg = base();
  createClashTestEngine(cfg);
  // A DIFFERENT world (N11: `world` is required). It must have a lease surface — `makeLeaseWorld()`
  // (or `createExecutionWorld()`), NOT P0's bare `createFakeWorld()`, whose missing
  // `admitModel`/`isLeaseValid` would make the registry constructor throw
  // `ModelBindingError{reason:'invalid-world'}` and let this test pass for the wrong reason
  // (P1 cross-phase note, "deliberately not added").
  const foreign = createModelRegistry({ world: makeLeaseWorld() });
  const err = assert.throws(
    () => createClashTestEngine({ ...cfg, registry: foreign }),
    ModelBindingError,
  );
  assert.equal(err.reason, 'registry-mismatch');       // N1: `.reason`, and the class takes ONE object argument
});

test('the coordinator-owned registry is accepted when the host passes it back', () => {
  const cfg = base();
  const first = createClashTestEngine(cfg);
  const second = createClashTestEngine({ ...cfg, registry: first.registry });
  assert.equal(second.registry, first.registry);
});

test('engine limits are validated synchronously and every issue is collected', () => {
  const err = assert.throws(
    () => createClashTestEngine({
      ...base(),
      limits: { maxResidentResultSets: 0, persistTimeoutMs: 1.5, nope: 1 },
    }),
    InvalidOptionsError,
  );
  // P0 issue paths are JSON pointers, not bare key names.
  const codes = err.issues.map((i) => `${i.path}:${i.code}`).sort();
  assert.deepEqual(codes, [
    '/maxResidentResultSets:below-minimum',
    '/nope:unknown-key',
    '/persistTimeoutMs:not-an-integer',
  ]);
});

test('a RunOption passed as an engine limit is an unknown key', () => {
  const err = assert.throws(
    () => createClashTestEngine({ ...base(), limits: { broadPhase: 'tlas' } }),
    InvalidOptionsError,
  );
  assert.deepEqual(err.issues.map((i) => i.code), ['unknown-key']);
});

test('omitted limits take the §17.1 defaults', () => {
  const engine = createClashTestEngine(base());
  assert.equal(engine.retentionReport().cap, ENGINE_LIMIT_DEFAULTS.maxResidentResultSets);
});

test('dispose is idempotent, returns the same promise, and closes the surface', async () => {
  const engine = createClashTestEngine(base());
  const p = engine.dispose();
  assert.equal(engine.dispose(), p);
  const summary = await p;
  assert.deepEqual(summary, { droppedUnsaved: [], persistenceInFlight: [] });
  for (const m of ['validateTest', 'startRun', 'getRun', 'retentionReport']) {
    assert.throws(() => engine[m]({}), EngineDisposedError, `${m} after dispose`);
  }
  await assert.rejects(() => engine.saveTest({}), EngineDisposedError);   // promise-returning ⇒ rejects (R1)
  assert.equal(await engine.dispose(), summary);
});
```

  The disposed-surface split is controller ruling **R1** in miniature: the synchronous methods (`validateTest`, `startRun`, `getRun`, `getPersistenceState`, `retainResultSet`, `releaseResultSet`, `invalidateModelPlacement`, `retentionReport`) **throw** `EngineDisposedError`; the Promise-returning ones (`saveTest`, `getTest`, `listTests`, `listResults`, `archiveTest`, `deleteTest`, `rerun`, `getResultSet`, `discardRun`, `retryPersist`, `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`) **reject** with it. `dispose()` itself is idempotent and non-throwing.

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/construction.test.mjs` → `ERR_MODULE_NOT_FOUND: clashtest/engine.js`.
- [ ] **Step 3: Implement the constructor.** `clashtest/engine.js`:

```js
const persistenceSinks = new Map();      // runId → the run's own onPersistence, registered by buildRunSpec

export function createClashTestEngine(config = {}) {
  const {
    world, enumerator, registry, unitExecutor, testStore, resultStore,
    limits, hierarchyInternalAcceptance = null, libraryVersion = null,
    spanRecorder, now = () => Date.now(), yieldToScheduler,
  } = config;
  if (!world) throw new TypeError('createClashTestEngine: `world` is required');
  if (!enumerator) throw new TypeError('createClashTestEngine: `enumerator` is required');

  const effectiveLimits = resolveEngineLimits(limits);           // throws InvalidOptionsError
  assertHierarchyAcceptance(hierarchyInternalAcceptance);        // §18: {recordRef ≤ 512} | null
  assertHostString('libraryVersion', libraryVersion, 256);       // §13.5.2 length caps

  const coordinator = getWorldCoordinator(world, {
    protocolVersion: COORDINATOR_PROTOCOL_VERSION, now, yieldToScheduler,
  });
  if (registry !== undefined) assertRegistryBelongsToWorld(registry, world);   // P1; ModelBindingError({reason:'registry-mismatch'})

  const engineId = newEngineId();                                // the key `stopAdmitting`/`queueDepth` are scoped by
  const stores = {
    test: testStore === undefined ? createInMemoryClashTestStore() : testStore,
    result: resultStore === undefined ? createInMemoryResultStore() : resultStore,
  };
  const executor = unitExecutor || createLocalUnitExecutor({
    world, registry: coordinator.registry, enumerator, now, yieldToScheduler,
    sliceBudgetMs: effectiveLimits.sliceBudgetMs,
  });                                                            // UnitExecutor IS the function (request) => Promise<UnitOutcome>
  const newSlicer = () => createSlicer({                         // one slicer per sliced operation (P0);
    now, yieldToScheduler, limits: effectiveLimits, spanRecorder, // span labels are per CALL: tick('x'),
  });                                                             // forEach(list, fn, {label}), sortSliced(…)
  const residency = createResidencyManager({
    limits: effectiveLimits, resultStore: stores.result, now,
    onPersistence: (runId, snapshot) => persistenceSinks.get(runId)?.(snapshot),
  });
  const reads = createReadCoordinator({ limits: effectiveLimits });
  const definitions = createDefinitionOperations({              // P2 owns §5.5; P7 delegates (N28)
    testStore: stores.test, limits: effectiveLimits, yieldToScheduler, now, spanRecorder,
  });

  const ownRuns = new Map();     // runId → {handle, controller} — THIS engine's runs only (Tasks P7.4, P7.5)
  let disposed = false;
  let disposePromise = null;
  const alive = () => { if (disposed) throw new EngineDisposedError(); };
  const aliveAsync = () => { try { alive(); } catch (err) { return Promise.reject(err); } return null; };
  // … method surface (Tasks P7.3–P7.7) …
  return engine;
}
```

  `testStore`/`resultStore` use `undefined` (not falsy) to select the reference implementation, so an explicit `null` means "no store" and reaches `StoreNotConfiguredError` (Task P7.3). `dispose()` sets `disposed` **before** awaiting, so a concurrent call sees the flag; it stores and returns one promise. `engine.registry` is `coordinator.registry` — P7 never constructs a registry, because §4.3's one-per-world rule is the coordinator's to keep; a host-supplied `registry` is only ever *checked*, by P1's `assertRegistryBelongsToWorld`. `engine.retentionReport()` is `{...residency.retentionReport(), readSlotsInUse: reads.inUse()}` — one residency call plus one read-coordinator call, and the per-set class is already in `sets[i].class`.
- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/engine/construction.test.mjs`.
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.3: Definition surface, listings, and the two-layer `deleteTest`

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/definitions.test.mjs`, `test/clashtest/engine/deleteTest.tombstone.test.mjs`

**Interfaces**

*Consumes (Assumed):*
- P2 `definition/validate.js`: `validateTest(def, opts?) → {issues, issuesTruncated}` with `opts = {limits?}` — pure, never throws for data errors.
- P2 `stores/InMemoryClashTestStore.js` port: `put(def)`, `get(testId, revision?)`, `list({limit?, cursor?} = {})`, `archive(testId)`, `delete(testId)`, **`resolveForRun(testId, revision?) → Promise<{status: 'live'|'archived'|'deleted'|'missing', definition, latestRevision}>`** — the lifecycle discriminant is the field **`status`** (N27), and every P7 branch reads it by that name — `isTombstoned(testId) → Promise<boolean>`.
- **P2 `definition/operations.js` — module added by P2, now in the master §2 map (N28).** `createDefinitionOperations({testStore, limits, yieldToScheduler, now, spanRecorder}) → {validateTest, saveTest, getTest, listTests, archiveTest}` is the §5-governed definition surface (synchronous capture before the promise, untrusted store reads, `StoreNotConfiguredError`, `CorruptListingError`, the `put` refusal precedence tombstone → archive → revision). **P7's engine delegates to it and does not re-derive §5.5.** `deleteTest` stays P7's, because only P7 knows both stores and owns the two-layer order. P2 also exports `RESOLVE_STATUS_TO_PLANNING_CAUSE = {live:null, archived:'test-archived', deleted:'test-deleted', missing:'test-not-found'}` for P6.
- P5 `ResultStore` port: `tombstoneTest(testId) → Promise<void>`, `list({testId?, limit?, cursor?})`; `validateResultSetSummary(summary, {limits})` for the untrusted listing page.
- **CHANGED (N29):** the definition-shaped capture entry point lives in **P2 `definition/validate.js`**, not in P0 — P0 ships only the generic `captureData(root, opts)`, which P7 never calls directly. P7 uses **`captureAndValidate(def, opts?) → {issues, issuesTruncated, captured, gate?}`** (`captured` non-`null` **iff** `issues` is empty; **`gate`** is P2's own addition to its summary — the root-shape gate that decides `InvalidTestDefinitionError` vs. `UnsupportedSchemaVersionError`) and **`toDefinitionError(result) → InvalidTestDefinitionError | UnsupportedSchemaVersionError`**, whose parameter list is `{issues, issuesTruncated, gate}`. P7 therefore **passes the whole `captureAndValidate` result through**, never a rebuilt `{issues, issuesTruncated}` pair, so `gate` is not silently dropped; the one place P7 does build the argument literally is the `classify` `'invalid'` branch, where no capture ran and there is no gate to carry. The reference form is **`validateReference(ref, opts?) → {issues, issuesTruncated, captured}`** with `captured = {testId, revision}` (`revision` `null` when absent), and the `startRun` overload is discriminated by **`classifyStartRunArgument(arg) → {kind: 'definition'|'reference'|'invalid', issues}`** (R21-I3; see also Open item 3).

*Produces:* `validateTest`, `saveTest`, `getTest`, `listTests`, `listResults`, `archiveTest`, `deleteTest`.

**Steps**

- [ ] **Step 1: Write the failing definition-surface test.**

```js
// test/clashtest/engine/definitions.test.mjs (excerpt)
test('validateTest is pure and never throws for data errors', () => {
  const engine = createClashTestEngine(base());
  const r = engine.validateTest({ testId: 42, revision: 1.5, selectionA: null });
  assert.equal(r.issuesTruncated, false);
  assert.ok(r.issues.length >= 3);
  assert.ok(r.issues.every((i) => typeof i.path === 'string' && typeof i.code === 'string'));
  assert.ok(r.issues.every((i) => !('value' in i)));   // §16: no offending value is recorded
});

test('saveTest rejects an invalid definition with InvalidTestDefinitionError carrying the same issues', async () => {
  const engine = createClashTestEngine(base());
  const def = { testId: 42, revision: 1.5 };
  const expected = engine.validateTest(def);
  await assert.rejects(() => engine.saveTest(def), (err) => {
    assert.ok(err instanceof InvalidTestDefinitionError);
    assert.deepEqual(err.issues, expected.issues);
    assert.equal(err.issuesTruncated, expected.issuesTruncated);
    return true;
  });
});

test('store-requiring methods throw StoreNotConfiguredError when the store is explicitly null', async () => {
  const engine = createClashTestEngine({ ...base(), testStore: null, resultStore: null });
  for (const call of [
    () => engine.saveTest(validDef()), () => engine.getTest('t'), () => engine.listTests({}),
    () => engine.archiveTest('t'), () => engine.deleteTest('t'),
  ]) {
    await assert.rejects(call, (e) => e instanceof StoreNotConfiguredError && e.store === 'testStore');
  }
  await assert.rejects(() => engine.listResults({}),
    (e) => e instanceof StoreNotConfiguredError && e.store === 'resultStore');
  // validateTest needs no store and still works.
  assert.equal(engine.validateTest(validDef()).issues.length, 0);
});

test('listTests/listResults reject a malformed cursor and an out-of-range limit', async () => {
  const engine = createClashTestEngine(base());
  await assert.rejects(() => engine.listTests({ limit: 0 }), InvalidOptionsError);
  await assert.rejects(() => engine.listTests({ limit: 1001 }), InvalidOptionsError);
  await assert.rejects(() => engine.listTests({ cursor: 'v9:zzz' }),
    (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'bad-cursor');
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/definitions.test.mjs` → every case fails with `TypeError: engine.saveTest is not a function`.
- [ ] **Step 3: Implement the definition surface as a delegation to P2 (N28).** P7 owns no §5.5 rule here: five of the six methods are one line each.

```js
const validateTest   = (def)              => { alive(); return definitions.validateTest(def); };
const saveTest       = (def)              => aliveAsync() ?? definitions.saveTest(def);
const getTest        = (testId, revision) => aliveAsync() ?? definitions.getTest(testId, revision);
const listTests      = (page = {})        => aliveAsync() ?? definitions.listTests(page);
const archiveTest    = (testId)           => aliveAsync() ?? definitions.archiveTest(testId);
```

  `createDefinitionOperations` already owns the synchronous capture-before-the-promise, the untrusted store read, `StoreNotConfiguredError{store:'testStore'}`, `CorruptListingError`, and the `put` refusal precedence (tombstone → archive → revision), so `saveTest` rejects `InvalidTestDefinitionError{issues, issuesTruncated}` derived from the *captured* value and a caller's later mutation cannot change what was stored (§5.3). The two methods P7 does own, because only P7 holds both stores, are **`listResults`** (`requireStore('resultStore')` → `resultStore.list(page)` → `validateResultSetSummary` per row, under a read slot) and **`deleteTest`** (Step 7).
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Write the failing `deleteTest` order + bypass test.** This is AC-1's NH3 engine-level matrix, reduced to the six paths the core owns:

```js
// test/clashtest/engine/deleteTest.tombstone.test.mjs (excerpt)
test('deleteTest tombstones the result store BEFORE deleting from the test store', async () => {
  const order = [];
  const resultStore = wrapStore(createInMemoryResultStore(), order);
  const testStore = wrapStore(createInMemoryClashTestStore(), order);
  const engine = createClashTestEngine({ ...base(), testStore, resultStore });
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  order.length = 0;
  await engine.deleteTest('T');
  assert.deepEqual(order, ['resultStore.tombstoneTest', 'testStore.delete']);
});

test('a failing testStore.delete leaves the reservation in place and a retry completes', async () => {
  const resultStore = createInMemoryResultStore();
  const testStore = createInMemoryClashTestStore();
  let fail = true;
  const guarded = { ...testStore, delete: async (id) => {
    if (fail) throw new Error('backend down');
    return testStore.delete(id);
  } };
  const engine = createClashTestEngine({ ...base(), testStore: guarded, resultStore });
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await assert.rejects(() => engine.deleteTest('T'), /backend down/);
  // layer 1 already holds: a NEW set for T can never be inserted.
  await assert.rejects(() => resultStore.put(sealedSetFor('T')), TestDeletedError);
  fail = false;
  await engine.deleteTest('T');                       // retry completes, idempotently
  assert.equal(await guarded.get('T'), null);
});

test('after deleteTest, a persisting direct-definition run seals failed with test-deleted and issues no findClashes call', async () => {
  const fx = makeRealWorldFixture({ models: [twoBoxModel('a'), twoBoxModel('b')] });
  const recorder = recordFindClashes(fx.world);
  const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await engine.deleteTest('T');
  const handle = engine.startRun(directDefinition({ testId: 'T' }));   // persist defaults to true
  const summary = await handle.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.definition, null);
  assert.equal(summary.resultSet.testRef.semanticDigest, null);
  assert.ok(summary.resultSet.ledger.planningGaps.some((g) => g.cause === 'test-unavailable'
    && g.detail === 'test-deleted'));
  assert.equal(recorder.calls.length, 0);
});

test('with persist:false the same run completes and persistence is skipped', async () => { /* … */ });

test('an isTombstoned lookup that rejects fails the run closed with test-lookup-failed', async () => { /* … */ });
```

- [ ] **Step 6: Run it and see it fail.** `node --test test/clashtest/engine/deleteTest.tombstone.test.mjs` → the ordering assertion fails first (nothing calls `tombstoneTest`).
- [ ] **Step 7: Implement `deleteTest` and the admission tombstone check.**

```js
async function deleteTest(testId) {
  alive();
  const ts = requireStore('testStore');
  const rs = stores.result;                 // may be null: layer 1 is then absent, documented residual
  if (rs) await rs.tombstoneTest(testId);   // layer 1 first: fail-closed order (§5.5)
  await ts.delete(testId);                  // layer 2
}
```

  Admission check, inside the run's resolution step (§5.5): when the run will persist (a result store is configured and `runOptions.persist !== false`), `await stores.result.isTombstoned(testRef.testId)`; `true` ⇒ seal `failed` with planning gap `test-unavailable` / `test-deleted`; a *rejecting* `isTombstoned` ⇒ seal `failed` with `test-lookup-failed`. With `persist: false` the check is skipped (§17.1 `persist` row).
- [ ] **Step 8: Run it and see it pass.**
- [ ] **Step 9: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.4: Run surface — `startRun` overloads, synchronous error contract, `getRun`, `getResultSet`

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/startRun.test.mjs`

**Interfaces**

*Consumes — **RECONCILED** (producer wins):*
- P0 `options.js` — **CHANGED (N31):** **`resolveRunOptions(input, limits?)`** takes the resolved engine limits as its **second positional argument**, not as a `{limits}` wrapper: `(object | undefined, ResolvedLimits?) → frozen ResolvedRunOptions`, throwing `InvalidOptionsError{issues, reason}` **synchronously** and collecting every issue. The run-option cross-field rules are `maxPairsPerOutcome ≤ maxResultsPerRun` and `maxLedgerRecords ≥ maxPlanReferences + 2 × maxUnitsPerRun`, plus the producer/reader invariant (`reason: 'result-unreadable'`, issue codes `result-unreadable-nodes` / `result-unreadable-bytes`, §13.6). **`maxQueuedRuns ≤ maxResidentResultSets − 1` is an ENGINE-limit cross-field rule** and is enforced by `resolveEngineLimits` at construction (Task P7.2), never by `resolveRunOptions`. Because the returned object is a frozen, fully detached resolution of the caller's input, calling it inside the synchronous prefix *is* §13.6's capture of the options object — P7 adds no second copy step.
- P5 `residency.js` — **CHANGED (N23):** **`reserveRunSlot(runId)`**, throwing `ResultCapacityError{cap, active, retained, held}` **synchronously**, paired with **`releaseRunSlot(runId)`** for the rollback below.
- P6 — **CHANGED (N25, N33):** P7 builds P6's **`RunSpec`** and calls **`createRun(spec) → {handle: RunHandle, controller: RunController, begin(): void}`**, then `begin()`, and returns `handle`.
  `RunSpec = {runId, engineId, coordinator, world, testIdOfInput, derivedFromRunId, resolveDefinition, modelKeysOf, planningCauseOf, enumerator, executor, validateUnitOutcome, internalErrorOutcome, diagnosticAggregator, statisticsAccumulator, deriveUnitTaints, plannerPort, resultPort, runOptions, limits, provenanceBase, now, yieldToScheduler, scheduleTimeout}` where:
  - **`derivedFromRunId: string | null` is part of the authoritative `RunSpec` shape (N33, P6 re-verification I7)**, precisely so an implementation that projects only the documented fields cannot legally discard rerun lineage. P6 seals it as `ResultSet.derivedFromRunId` (§13.1). `buildRunSpec` writes `derivedFromRunId: input.derivedFromRunId ?? null` on **both** entry points — `startRun` passes nothing (⇒ `null`), `rerun` passes the **base set's `runId`** (Task P7.7) — so P7 never relies on P6's absent-⇒-`null` tolerance. **`createRun` validates it** (`null` or a non-empty string; anything else is a `TypeError`, an engine bug rather than user data), which is one more reason `buildRunSpec` is the single place that writes it. It is a lineage record only: P7 does **not** check that the id still names a set the engine holds (the base may be discarded before the rerun seals), and it never participates in comparability or admission.
  - **`controller` is P6's `RunController` — engine-only, and *never reachable from the handle*** (P6 re-verification C3): `{ requestDispose(): Promise<RunSummary> }`. `RunHandle` has exactly its six public members (`runId`, `getSnapshot`, `subscribe`, `cancel`, `done`, `persisted`) and no disposal control, enumerable or otherwise, so the **only** way P7 can ever hold a controller is the `createRun` return value. P7 stores it in the engine's own `ownRuns` map (`runId → {handle, controller}`) at the moment `createRun` returns — the map `dispose()` walks (Task P7.5) and the admission rollback deletes from. `requestDispose()` marks `disposeRequested` on committed state, cancels the run at its next boundary, forces the finalize window closed when the run is already past its seal, and resolves with the same `RunSummary` as `done`. **P6 requires P7 to call it for every owned run *before* awaiting that run's `done`** (P6's cross-file need C-P7-1); a `dispose()` that only awaits `done` leaves the run with no `disposeRequested` fact and no forced close.
  - **There is no store field.** The result store is bound into P5's residency manager at construction and reaches the run only through `resultPort.residency`; the `ClashTestStore` reaches it only through the closures `resolveDefinition` / `testIdOfInput` / `planningCauseOf`, which P7 builds over `stores.test`. A run never holds a store object.
  - `validateUnitOutcome` is P4's `(request, outcome) → {ok, issues}` — it **never throws** and always returns both fields — and `internalErrorOutcome(request, issues)` is P4's canonical `failed:internal-error` substitute, which P6 uses on `ok:false` rather than hand-building one.
  - **`diagnosticAggregator`** is one `createDiagnosticAggregator({maxRetainedDiagnostics, maxDistinctReasons, maxUnitIdsPerDiagnostic, slicer})` per run (P4, **D3**) — the single owner of all aggregation — beside `statisticsAccumulator` (`createStatisticsAccumulator()`) and `deriveUnitTaints` (P4). P7 constructs these three and injects nothing else diagnostic-shaped; P6 drives `await addUnit(unitId, outcome)` and `snapshot()`, and supplies `deriveUnitTaints`'s `admit(n)` ledger-budget oracle from P3's budget (N9).
  - `plannerPort = {planRun, materializeUnit, splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket}` (P3). **D1 conformance:** the whole bracket is P3's — the expectation is `materializeUnit(plan, unit).scopeExpect`, the comparator is `compareScopeExpectation`, and the fold is `checkScopeBracket`; P4 imports the fold directly and P6 receives it through this port. P7 builds no expectation, owns no comparator and runs no re-digest pass.
  - `resultPort = {createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome, residency}` (P5; N21, N22, N24). Persistence runs through `residency.beginPersist(runId, {persist})`; there is no free-standing persistence starter and no draft builder beyond `buildResultSet`.
  - `resolveDefinition` / `planningCauseOf` read P2's `resolveForRun(...).status` through `RESOLVE_STATUS_TO_PLANNING_CAUSE` (P2 `definition/operations.js`), so the §5.5 mapping exists once. Both come from **one per-engine factory, `createStoredDefinitionResolver`** (an internal named export of `clashtest/engine.js`, not of `clashtest/index.js`; Step 3a support obligation 3): `buildRunSpec` wraps its `resolveDefinition(reference)` as the zero-argument per-run closure and passes `planningCauseOf` through unchanged, so this `RunSpec` shape is exactly as P6 declares it.
  - **D4 conformance:** `getPairStatus` / `getElementStatus` / `createStatusReader` / `buildStatusReaderSteps` / `readLedger` are read from **P5 `results/status.js`** wherever P7 needs them (only `index.js`, Task P7.10); no status reader or ledger reader is wired into `RunSpec`.
  - `createRun(spec)` and `begin()` are both **synchronous and throwing** (R1), which is what lets `startRun`'s prefix wrap them in the rollback below.
- **Queue admission is P7's (controller ruling R6).** `maxQueuedRuns` is an engine limit, the world coordinator enforces no limit of its own, and the check lives in the **synchronous** admission prefix of `startRun`/`rerun`: depth is `coordinator.queueDepth(engineId)`, which counts runs **waiting** and does **not** count the in-flight run. Ordering makes §18's rule fall out: `reserveRunSlot` runs first, so at the default `maxQueuedRuns = maxResidentResultSets − 1` the slot check always fires first and the refusal is `ResultCapacityError`; `RunQueueFullError{limit, queued}` is reachable only when the host configured `maxQueuedRuns` **below** slot capacity. Whichever refusal fires, and whatever `createRun`/`begin()` may throw, the reserved slot is released again by `releaseRunSlot` before the error leaves the prefix — the reservation and the queue admission succeed or fail together.

*Produces:* `startRun`, `getRun`, `getResultSet`.

**Steps**

- [ ] **Step 1: Write the failing run-surface test.**

```js
// test/clashtest/engine/startRun.test.mjs (excerpt)
test('startRun throws InvalidTestDefinitionError SYNCHRONOUSLY for a bad direct definition', () => {
  const engine = createClashTestEngine(base());
  const err = assert.throws(() => engine.startRun({ testId: 42 }), InvalidTestDefinitionError);
  assert.ok(Array.isArray(err.issues) && err.issues.length > 0);
  assert.equal(engine.retentionReport().slotsInUse, 0);     // no slot leaked on the throw
});

test('startRun throws InvalidOptionsError synchronously and lists every issue', () => {
  const engine = createClashTestEngine(base());
  const err = assert.throws(
    () => engine.startRun(validDef(), { maxUnitsPerRun: Infinity, progressMinIntervalMs: NaN, zzz: 1 }),
    InvalidOptionsError,
  );
  assert.deepEqual(err.issues.map((i) => i.path).sort(),
    ['/maxUnitsPerRun', '/progressMinIntervalMs', '/zzz']);     // P0 paths are JSON pointers
});

test('a stored reference is the two-field shape and an unknown extra key is a definition, not a reference', () => {
  const engine = createClashTestEngine(base());
  // {testId, revision} → reference; {testId, revision, selectionA, …} → definition (§5.3 scope rule (ii))
  const h = engine.startRun({ testId: 'T', revision: 1 });
  assert.equal(typeof h.runId, 'string');
  assert.throws(() => engine.startRun({ testId: 'T', revision: 1, bogus: true }),
    InvalidTestDefinitionError);
});

test('admission refusal is synchronous and never queues', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null, limits: { maxResidentResultSets: 1 } });
  const first = engine.startRun(validDef());
  await first.done;                                   // seals HELD (no store ⇒ never evictable)
  const err = assert.throws(() => engine.startRun(validDef()), ResultCapacityError);
  assert.equal(err.cap, 1);
  assert.deepEqual(err.held.map((h) => h.runId), [first.runId]);
  engine.releaseResultSet(first.runId, { acknowledgeUnsaved: true });
  assert.ok(engine.startRun(validDef()));             // slot freed
});

test('an explicitly lower maxQueuedRuns refuses with RunQueueFullError, counting waiting runs only', () => {
  // Slot capacity 4, queue capacity 1: the QUEUE is the binding constraint, so R6's
  // RunQueueFullError becomes reachable (at the default it never is -- see Gates item 3).
  const engine = createClashTestEngine({
    ...base(), resultStore: null, limits: { maxResidentResultSets: 4, maxQueuedRuns: 1 },
  });
  const inFlight = engine.startRun(slowDef());        // occupies the coordinator's ONE in-flight slot
  const waiting = engine.startRun(slowDef());         // queue depth 1
  const err = assert.throws(() => engine.startRun(slowDef()), RunQueueFullError);
  assert.equal(err.limit, 1);
  assert.equal(err.queued, 1);                        // the in-flight run is NOT counted
  // The refused call rolled its reservation back atomically: only the two live runs hold slots.
  assert.equal(engine.retentionReport().slotsInUse, 2);
  inFlight.cancel(); waiting.cancel();
});

test('a slot reserved for a refused admission is released, not leaked', () => {
  const engine = createClashTestEngine({
    ...base(), resultStore: null, limits: { maxResidentResultSets: 4, maxQueuedRuns: 1 },
  });
  const a = engine.startRun(slowDef());
  const b = engine.startRun(slowDef());
  const before = engine.retentionReport().slotsInUse;
  for (let i = 0; i < 5; i++) assert.throws(() => engine.startRun(slowDef()), RunQueueFullError);
  assert.equal(engine.retentionReport().slotsInUse, before);   // five refusals, zero drift
  a.cancel(); b.cancel();
});

test('cancelling a QUEUED run settles done with a pre-resolution cancelled set (R5)', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null, limits: { maxResidentResultSets: 4 } });
  const inFlight = engine.startRun(slowDef());
  const queued = engine.startRun(validDef());          // never reaches the head of the queue
  const summary = await queued.cancel();               // P6 seals a pre-resolution cancelled set
  assert.equal(summary.status, 'cancelled');
  assert.equal(summary.resultSet.definition, null);    // cancelled BEFORE resolution
  assert.equal(summary.resultSet.ledger.planExists, false);
  assert.equal(await queued.done, summary);            // `done` settles, it does not hang
  inFlight.cancel();
});

test('an archived stored reference fails ASYNCHRONOUSLY after a successful admission', async () => {
  const engine = createClashTestEngine(base());
  await engine.saveTest(validDef({ testId: 'T', revision: 1 }));
  await engine.archiveTest('T');
  const h = engine.startRun({ testId: 'T' });          // handle IS returned
  const summary = await h.done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.resultSet.definition, null);
  assert.ok(summary.resultSet.ledger.planningGaps.some((g) => g.cause === 'test-unavailable'));
});

test('getRun returns terminal-but-resident runs and null once nonresident', async () => {
  const engine = createClashTestEngine(base());
  const h = engine.startRun(validDef());
  const { runId } = h;
  await h.done;
  assert.equal(engine.getRun(runId).runId, runId);
  engine.releaseResultSet(runId, { acknowledgeUnsaved: true });
  assert.equal(engine.getRun(runId), null);
  assert.equal(engine.getPersistenceState(runId), null);      // never throws for a nonresident id
});

test('getResultSet reads through without making the set resident', async () => {
  const resultStore = createInMemoryResultStore();
  const engine = createClashTestEngine({ ...base(), resultStore, limits: { maxResidentResultSets: 1 } });
  const h = engine.startRun(validDef());
  const { runId } = h;
  await h.persisted;
  engine.releaseResultSet(runId);
  assert.equal(engine.retentionReport().slotsInUse, 0);
  const set = await engine.getResultSet(runId);
  assert.equal(set.runId, runId);
  assert.equal(engine.retentionReport().slotsInUse, 0);       // read-through, not cached
  assert.ok(Object.isFrozen(set));
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/startRun.test.mjs`.
- [ ] **Step 3: Implement `startRun`.** The synchronous prefix, in this fixed order, before anything asynchronous can run:

```js
function startRun(input, runOptions) {
  alive();

  // (1) Discriminate and capture-and-validate, both through P2 (N29). Nothing here is async.
  const classified = classifyStartRunArgument(input);              // 'definition' | 'reference' | 'invalid'
  if (classified.kind === 'invalid') {
    throw toDefinitionError({ issues: classified.issues, issuesTruncated: false });
  }
  const validated = classified.kind === 'reference'
    ? validateReference(input, { limits: effectiveLimits })
    : captureAndValidate(input, { limits: effectiveLimits });
  if (validated.issues.length > 0) throw toDefinitionError(validated);   // InvalidTestDefinition/UnsupportedSchemaVersion

  // (2) Resolve options against the RESOLVED ENGINE LIMITS -- positional second argument (N31).
  //     The frozen result is itself the detached copy of the caller's options object.
  const options = resolveRunOptions(runOptions, effectiveLimits);   // InvalidOptionsError, synchronous

  // (3) Admission: reserve the residency slot, then check the engine's own queue limit (R6).
  //     Either refusal, or anything createRun/begin() throws, rolls the reservation back.
  const runId = newRunId();                                        // crypto.randomUUID (§13.5)
  residency.reserveRunSlot(runId);                                 // ResultCapacityError
  try {
    admitToQueue(runId);                                           // RunQueueFullError
    const { handle, controller, begin } = createRun(buildRunSpec({  // `controller` is engine-only (N33)
      runId, kind: classified.kind, captured: validated.captured, options,
      // no `derivedFromRunId`: buildRunSpec writes `null`. Only `rerun` passes one (Task P7.7).
    }));
    ownRuns.set(runId, { handle, controller });                    // the map dispose() walks (Task P7.5)
    begin();                                                       // hands the run to the coordinator queue
    return handle;
  } catch (err) {
    ownRuns.delete(runId);
    residency.releaseRunSlot(runId);
    persistenceSinks.delete(runId);
    throw err;
  }
}

function admitToQueue(runId) {
  const queued = coordinator.queueDepth(engineId);   // WAITING runs only; the in-flight run is not counted
  if (queued >= effectiveLimits.maxQueuedRuns) {
    throw new RunQueueFullError({ limit: effectiveLimits.maxQueuedRuns, queued });
  }
}
```

  Discrimination of the two overloads is **P2's `classifyStartRunArgument`**, not a P7 predicate: spec §5.3 scope rule (ii) fixes the rule, R21-I3 makes it fail-closed, and keeping it in one module is what stops `startRun` and `rerun` from drifting. The order matters for the tests above: a validation or option failure must leave `slotsInUse` unchanged, so the reservation is last — and when it *has* been taken, `releaseRunSlot` in the `catch` makes the reservation and the queue admission atomic as a pair (R6). `startRun` throws for every one of these failures and never returns a rejected promise (R1); only `rerun` (Task P7.7) rejects.

  **`buildRunSpec` is P7's one `RunSpec` constructor** and both entry points go through it, so P6's required fields are written in exactly one place. Two of them are P7's own and are the reason it exists rather than an inline object literal: `derivedFromRunId: input.derivedFromRunId ?? null` (N33 — `startRun` omits it, `rerun` supplies the base set's `runId`) and the `persistenceSinks` registration that makes `onPersistence` reach this run. Everything else is a port P7 already holds (`coordinator`, `world`, `enumerator`, `executor`, the three P4 per-run objects, `plannerPort`, `resultPort`, `runOptions`, `limits`, `provenanceBase`, the clock and scheduler seams). `ownRuns.set(runId, {handle, controller})` happens **after** `createRun` returns and **before** `begin()`, so a run is in the map from the instant it exists: a `dispose()` racing `begin()` either has not seen the run (it was never admitted, and the rollback deletes the map entry) or sees it and signals it. The `catch` deletes the entry for exactly the same reason the slot is released — a refused admission leaves no trace.
- [ ] **Step 3a: Add the §5.5 stored-reference *validation* arms (AC-16, added by the 2026-09-21 H1 sweep).** The AC traceability table previously mapped this conjunct to a `test/clashtest/stores/storedReference.test.mjs` that no phase creates, and to **P2** — but P2's own decision (P2.8) is explicit that "the run-admission path's richer `definition-invalid` / `schema-unsupported` / `migration-failed` planning causes" are **not** `getTest`'s. They are this task's: `resolveDefinition` and `planningCauseOf` are P7's closures over `stores.test` (Step 3), and `RESOLVE_STATUS_TO_PLANNING_CAUSE` covers only the four **lifecycle** statuses, so a `live` status returning an untrusted definition still has to be validated here.

  **Obligation (no new module).** `resolveDefinition` validates every `live` definition a store returns (§5.3 scope (iv)) through P2's `captureAndValidate` (the capture-first boundary; `validateTest` is the pure schema half of the same pass) — **at the RESOLVED engine limits**, which is what bounds the issue list — and maps a non-empty result with P2's **`toDefinitionError`**, and `planningCauseOf` extends the lifecycle map with rows drawn **only** from P3's existing `PLANNING_CAUSES` enum (`clashtest/planning/ElementEnumerator.js`) — no new vocabulary and no new error class: `InvalidTestDefinitionError ⇒ 'definition-invalid'`, `UnsupportedSchemaVersionError{type:'ClashTestDefinition'} ⇒ 'schema-unsupported'`. P6 already turns a planning cause into a sealed `failed` run (`failPlanning`), so nothing in P6 changes. Both closures are produced by **one internal factory in `clashtest/engine.js`**, `createStoredDefinitionResolver` (support obligation 3 below) — still no new module, no public API and no migration seam, but the limits hand-down becomes directly observable.

  **`migration-failed` is structurally unreachable in this build; its coverage is a RECORDED, OWNER-ACCEPTED, NON-BLOCKING deferral (2026-09-21) — not an open question and not a plan defect.** The milestone owner dispositioned this on 2026-09-21: `migration-failed` **remains** part of the forward-compatible failure taxonomy and stays a reserved, **DISTINCT** `PLANNING_CAUSES` member; it is unreachable in the current `schemaVersion` 1 implementation scope because no older definition schema and no migration registry exists; AC-16's migration-failure coverage (clauses (iii)/(iv)) is therefore **deferred until a real definition migration path exists**; and the owner **declined to add a definition-migration seam solely to make the cause reachable**. **That deferral does not block this plan, Task P7.11 core acceptance, or G-PLAN**, and Task P7.11 Step 3's mechanical walk accepts it (master §6 line (e), master §8, reconciliation register **S-P7-5**). `DEFINITION_SCHEMA_VERSION === 1`, so the admissible-older-version window `[1, DEFINITION_SCHEMA_VERSION)` is **empty** and no definition migration can run — exactly the situation P5 already records for Result Sets (`p5-result-set.md`, `schemaVersion` handling: "*Unreachable while `SCHEMA_VERSION === 1`*"). P2's V2 split makes this precise: an integer `> 1` stops at the capture **gate** as `unsupported-schema-version`, and **every** other non-`1` value (`0`, `-1`, `1.5`, `'1'`) is `invalid-schema-version` (P2 spec-issue 3 / S-P2-3). So a stored `schemaVersion: 0` is `definition-invalid`, **never** `migration-failed`, and the arm below pins that boundary so a later reader cannot "correct" it the wrong way. No definition-migration registry, migration error class or migration operation is produced by **any** phase (P5's `applyMigration` is Result-Set-only; the engine factory has no `migrations` option and P7 supplies none), so P7 invents **neither** a host-facing `definitionMigrations` option **nor** an internal sentinel error just to make the arm executable — either would test dead protocol rather than stored-reference behaviour. `'migration-failed'` therefore stays a **reserved, distinct member** of `PLANNING_CAUSES` with no reachable producer, recorded as an **owner-accepted, non-blocking deferral** (see *Gates and open items*). **Exact re-open trigger:** when a real definition migration path is introduced — an older definition schema / `DEFINITION_SCHEMA_VERSION > 1` **plus** a phase that owns the migration registry and its discriminator — three arms are added to this test, and not before: (i) a lower-version definition whose **registered migration throws** ⇒ `'migration-failed'`; (ii) a lower-version definition whose migration **produces an invalid definition** (the post-migration `validateTest` then decides the cause); (iii) a lower-version definition with **no registered migration** ⇒ `'migration-failed'`. Their resolution order is load-bearing and must be: capture and **preflight the version → migrate → run `validateTest` on the migrated definition**; running today's V2 first would reject the older definition before migration could occur, and a missing migration for an admissible older version must then produce `'migration-failed'`, not `'definition-invalid'`. Until that trigger fires, the reachable arms below plus the `PLANNING_CAUSES.includes('migration-failed')` reserved-member assertion are the **whole** of the required coverage, and their absence is not a plan defect.

  Add to `test/clashtest/engine/startRun.test.mjs`, next to the archived-reference test:

  ```js
  // `SENTINEL` is the one unique string planted in every bad definition; `deepFind` walks a plain
  // object/array tree and returns true if any KEY or STRING/NUMBER value matches. `JSON.stringify(…)
  // .includes('99')` is NOT a legal substitute: a timestamp, runId or counter can legitimately
  // contain '99' (and a `schemaVersion: 99` needle would be a false positive on any digest hex).
  const SENTINEL = 'zz-offending-value-9f3a1c-must-never-be-persisted';
  // Field-level issue detail is exactly these key names. `message` is deliberately EXCLUDED as too
  // generic to assert on a whole tree; the sharper guarantee is the closed `{phase, cause}` row below.
  const ISSUE_KEYS = new Set(['path', 'code', 'issues', 'issuesTruncated']);

  test('a store-returned definition that fails validation seals failed with definition: null and no offending value', async () => {
    const observed = [];                                // the cause each arm ACTUALLY produced
    for (const [label, stored, cause] of [
      // Reachable arms. `migration-failed` has NO reachable input while DEFINITION_SCHEMA_VERSION === 1
      // (see the obligation note above); it is a gated conjunct, not a missing arm.
      ['fails validateTest', validDef({ name: SENTINEL, selectionA: { entries: [] } }), 'definition-invalid'],
      ['schemaVersion above the engine', validDef({ schemaVersion: 99, name: SENTINEL }), 'schema-unsupported'],
      // Boundary (P2 V2 / S-P2-3): a NON-newer, non-`1` version is `invalid-schema-version`, so it is
      // `definition-invalid` — asserting `migration-failed` here would be wrong, and `[1, 1)` is empty.
      ['schemaVersion 0 is an invalid version, not an older one', validDef({ schemaVersion: 0, name: SENTINEL }), 'definition-invalid'],
    ]) {
      const resultStore = createInMemoryResultStore();
      const cfg = base();                                 // carries the fake world + enumerator spies
      const engine = createClashTestEngine({ ...cfg, testStore: storeReturning(stored), resultStore });
      const handle = engine.startRun({ testId: 'T' });     // admission already succeeded: a handle EXISTS
      const summary = await handle.done;
      assert.equal(summary.status, 'failed', label);

      // (a) the EXACT sealed gap for this arm — the whole `planningGaps` array, not a containment
      //     check. `includes` would pass a schema-version failure that ALSO recorded
      //     `definition-invalid`, which is precisely the confusion this arm exists to rule out.
      //     `phase` is **`'queued'`**: the stored-reference lookup and its validation are the FIRST
      //     STEP of `queued` (spec §6.6.2, the `queued|planning → failed` row: "stored-reference
      //     lookup and validation, first step of `queued`"; §5.5/§13.1's pre-resolution seal), and
      //     P5's own pre-resolution fixtures write exactly that phase —
      //     `{phase:'queued', cause:'test-unavailable'}` and the `cancelled-pre-resolution` shape's
      //     `{phase:'queued', cause:'cancelled'}` (`p5-result-set.md`).
      assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: 'queued', cause }], label);
      observed.push(cause);
      assert.ok(PLANNING_CAUSES.includes(cause), `${label}: cause is in P3's closed enum`);
      // The reserved member, asserted on its own: `migration-failed` is a real, DISTINCT row of P3's
      // enum with no reachable producer in this build (owner-accepted deferral, above).
      assert.ok(PLANNING_CAUSES.includes('migration-failed'),
        'migration-failed stays a reserved, DISTINCT enum member with no reachable producer in this build');

      // (b) FAIL CLOSED before planning or collision execution: neither spy was ever called
      assert.equal(cfg.enumerator.calls.length, 0, `${label}: no planning — resolveRoots/digestScope never called`);
      assert.equal(cfg.world.calls.length, 0, `${label}: no collision execution — findClashes never called`);
      assert.equal(summary.resultSet.ledger.planExists, false, `${label}: no plan was ever built`);
      assert.deepEqual(summary.resultSet.ledger.units, [], `${label}: no unit ever existed`);

      // (c) the pre-resolution seal of §13.1
      assert.equal(summary.resultSet.definition, null, label);
      assert.equal(summary.resultSet.testRef.semanticDigest, null, label);
      assert.equal(summary.resultSet.testRef.testId, 'T', `${label}: only the caller's testId is recorded`);
      assert.equal(engine.getRun(summary.runId).runId, summary.runId, `${label}: the admitted slot is an ordinary resident set`);

      // (d) NEITHER the offending value NOR any field-level issue detail — in the sealed set OR the
      //     persisted store copy (owner disposition A1: nothing issue-shaped is durable).
      //     The persisted copy is PROVEN to exist before it is scanned, so a never-persisted set can
      //     no longer let this arm pass vacuously: `persist` defaults to `true` (P0
      //     `RUN_OPTION_SPECS.persist`), a `resultStore` IS configured above, and a **`failed` run
      //     still persists its sealed set** — §13.5.1/§13.5.2 hold a set back (`held`, awaiting
      //     `retryPersist`) only when the WRITE itself failed, which a successful in-memory `put`
      //     does not. `PersistenceSnapshot.state` is §13.5.1's closed
      //     `'skipped'|'pending'|'saved'|'failed'` enum, so `'saved'` is the successful-write value.
      assert.equal(summary.persistence.state, 'saved', `${label}: the failed set's write succeeded`);
      const persisted = await resultStore.get(summary.runId);
      assert.notEqual(persisted, null, `${label}: a durable copy exists to scan`);
      for (const [where, set] of [['sealed', summary.resultSet], ['persisted', persisted]]) {
        assert.equal(deepFind(set, (k, v) => v === SENTINEL), false, `${label}/${where}: offending value present`);
        assert.equal(deepFind(set, (k) => ISSUE_KEYS.has(k)), false, `${label}/${where}: field-level issue detail present`);
        // The sharpest form of A1: the gap row is still EXACTLY P5's closed pair, unwidened.
        for (const g of set.ledger.planningGaps) {
          assert.deepEqual(Object.keys(g).sort(), ['cause', 'phase'], `${label}/${where}: PlanningGap widened`);
        }
      }
    }

    // The reachable causes are mutually distinguishable — asserted over the causes the arms ACTUALLY
    // produced, and over P3's real enum, never over a literal set (`new Set([...literals]).size === 3`
    // tests a constant, so it was removed). Arms 1 and 3 share `definition-invalid` by design (arm 3
    // is the `schemaVersion: 0` boundary), so the two DISTINCT observed causes are exactly these:
    assert.deepEqual([...new Set(observed)].sort(), ['definition-invalid', 'schema-unsupported'],
      'the reachable arms produced two distinct causes, and a schema-version failure did not collapse into definition-invalid');
    // …and the three taxonomy members are pairwise-distinct POSITIONS in `PLANNING_CAUSES` itself.
    const at = (c) => { const i = PLANNING_CAUSES.indexOf(c); assert.ok(i >= 0, `${c} missing from PLANNING_CAUSES`); return i; };
    const idx = ['definition-invalid', 'schema-unsupported', 'migration-failed'].map(at);
    assert.equal(new Set(idx).size, 3, 'definition-invalid / schema-unsupported / migration-failed are three distinct enum members');
  });

  // (e) BOUNDED WORK, and the LIMIT HAND-DOWN. The bound itself is P2's — `captureAndValidate` caps
  // the list at `limits.maxValidationIssues` and sets `issuesTruncated` (P2
  // `definition/validate.test.mjs` owns that assertion). What P7 owns is that the **engine's own
  // stored-definition resolver** is built with the RESOLVED engine limits and hands them to the
  // validator, and that the run still fails closed. A separate direct `validateTest` call cannot
  // observe that — it only re-proves P2 — so the resolver is reached directly instead.
  //
  // **`createStoredDefinitionResolver({testStore, limits, validate})` is an internal NAMED EXPORT of
  // `clashtest/engine.js`** — the P7 module that already owns these two closures (Step 3's
  // `RunSpec.resolveDefinition` / `RunSpec.planningCauseOf`) — and is deliberately **NOT** re-exported
  // from `clashtest/index.js`, so §18's public surface (pinned by P7.10's `exports.test.mjs`) is
  // unchanged, no new file enters P7's inventory, and NO migration seam is introduced. `validate`
  // defaults to P2's `captureAndValidate` and exists only so this test can see what it was handed.
  // The factory's method takes the reference — `resolveDefinition(reference)` — because P6's
  // `RunSpec.resolveDefinition` is the ZERO-ARGUMENT per-run closure `buildRunSpec` wraps it in
  // (`() => resolver.resolveDefinition(input)`); the factory is per-engine, the closure is per-run.
  test('the engine resolver hands its RESOLVED maxValidationIssues to the definition validator', async () => {
    const limits = resolveEngineLimits({ maxValidationIssues: 5 });
    const seen = [];
    const validate = (def, opts) => { seen.push(opts); return captureAndValidate(def, opts); };
    const resolver = createStoredDefinitionResolver({ testStore: storeReturning(validDef()), limits, validate });
    await resolver.resolveDefinition({ testId: 'T' });
    assert.equal(seen.length, 1, 'the resolver validated the store-returned definition exactly once');
    assert.equal(seen[0].limits.maxValidationIssues, 5, 'the RESOLVED limit, not the default');
    assert.notEqual(seen[0].limits.maxValidationIssues, ENGINE_LIMIT_DEFAULTS.maxValidationIssues);  // 100
    assert.equal(seen[0].limits, limits, 'the very resolved-limits object, not a re-derived one');
  });

  test('a stored definition with vastly more invalid entries than maxValidationIssues is bounded at the resolver and fails closed', async () => {
    // 1,000 < the `maxEntriesPerSelection` default of 1,024 ON PURPOSE: over that cap V4 emits a
    // single structural `too-many-entries` and never reads the entries, which would prove nothing
    // about the ISSUE-list bound. Each entry here is individually invalid (`invalid-enum` on `kind`,
    // and `modelKey` in a value position where a careless validator would copy the sentinel).
    const entries = Array.from({ length: 1000 }, () => ({ kind: 'nope', modelKey: SENTINEL }));
    const stored = () => validDef({ selectionA: { entries } });

    // (i) the resolver with the REAL `captureAndValidate` and the RESOLVED limits: its rejection
    //     carries exactly `maxValidationIssues` issues with `issuesTruncated`, and the ONLY value
    //     that crosses from here into P6 is the bare cause string `planningCauseOf` returns — which
    //     is why nothing issue-shaped can reach the sealed ledger (owner disposition A1).
    const limits = resolveEngineLimits({ maxValidationIssues: 5 });
    const resolver = createStoredDefinitionResolver({ testStore: storeReturning(stored()), limits });
    const err = await resolver.resolveDefinition({ testId: 'T' }).then(() => null, (e) => e);
    assert.ok(err instanceof InvalidTestDefinitionError);
    assert.equal(err.issues.length, 5);
    assert.equal(err.issuesTruncated, true);
    const cause = resolver.planningCauseOf(err);
    assert.equal(cause, 'definition-invalid');
    assert.equal(typeof cause, 'string');            // a bare enum member: no issues, no paths, no values

    // (ii) the engine end to end on the same definition: still the EXACT sealed gap, still no sentinel.
    //      This arm asserts the CAUSE and the absence of detail only — a `definition-invalid` seal would
    //      also appear if the engine kept an inline validator at the DEFAULT limit, so the *limit
    //      hand-down* is not this arm's claim; the next test owns it at engine level.
    const engine = createClashTestEngine({
      ...base(), limits: { maxValidationIssues: 5 }, testStore: storeReturning(stored()),
    });
    const summary = await engine.startRun({ testId: 'T' }).done;
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: 'queued', cause: 'definition-invalid' }]);
    assert.equal(deepFind(summary.resultSet, (k, v) => v === SENTINEL), false);
    assert.equal(deepFind(summary.resultSet, (k) => ISSUE_KEYS.has(k)), false);
  });

  // THE ENGINE-LEVEL PROOF of the hand-down. The factory test above shows only that the factory obeys
  // limits it is HANDED; neither it nor arm (ii) shows that `createClashTestEngine` BUILDS that factory
  // with its own `effectiveLimits` rather than keeping an inline validator at the default 100.
  //
  // A read counter on the stored entries cannot supply this proof, which is why a construction seam is
  // used instead. P2's pass is **capture-first**: `captureAndValidate` runs `captureStructural` over the
  // WHOLE definition and only then applies V1–V6 to the detached copy (`p2-definitions.md`,
  // `captureAndValidate` / `checkDefinition`), P0's `captureData` stops early only on its own `maxIssues`,
  // the node ceiling, the root gate or the open-field budget, and the 1,000 entries here are structurally
  // legal — so capture reads and copies EVERY entry whatever `maxValidationIssues` is. P0's capture is
  // also descriptor-based and never invokes a getter (`p0-foundations.md`, capture design note 2 and its
  // "a throwing getter … is never read, let alone invoked" test), and the schema pass then runs on the
  // detached plain-object copy, where no getter or `Proxy` of the caller's object survives. The one
  // limit-sensitive stop that DOES exist — `checkSelection`'s `for (… && !c.full; …)` loop — is therefore
  // invisible to any counter the test could attach. Hence the construction seam below, not a canary.
  //
  // **`withStoredDefinitionValidator(validate, fn)` is a second internal named export of
  // `clashtest/engine.js`** (support obligation 4). There is still exactly ONE constructor:
  // `createClashTestEngine(options)` is the whole construction path, for hosts and for this test alike.
  // The helper sets a MODULE-SCOPED override that the engine's own wiring line consumes as
  // `createStoredDefinitionResolver`'s `validate` default, for engines constructed SYNCHRONOUSLY inside
  // `fn`; it restores the previous value in a `finally` and returns `fn`'s result. The override is
  // captured AT CONSTRUCTION TIME — the engine keeps its own reference to the validator it was built
  // with, never a live module read at run time — so the `startRun` below, which happens after the
  // override has already been restored, still reaches the spy. Like the factory it is a **test-only**
  // seam, not a host option, **NOT** re-exported from `clashtest/index.js` (P7.10's public-surface test
  // asserts both absences by name), and **no new module or file**.
  test('createClashTestEngine builds its stored-definition resolver with the engine effectiveLimits', async () => {
    const entries = Array.from({ length: 1000 }, () => ({ kind: 'nope', modelKey: SENTINEL }));  // 1,000 < 1,024, as above
    const seen = [];
    const validate = (def, opts) => { seen.push(opts); return captureAndValidate(def, opts); };
    const engine = withStoredDefinitionValidator(validate, () => createClashTestEngine({
      ...base(), limits: { maxValidationIssues: 5 }, testStore: storeReturning(validDef({ selectionA: { entries } })),
    }));

    const summary = await engine.startRun({ testId: 'T' }).done;

    // The spy sits in the resolver the ENGINE constructed, reached through a real `startRun` — and the
    // engine was built by the PUBLIC `createClashTestEngine`, so this is exactly the path a host takes.
    // An engine that kept a divergent inline (default-limit) validator on that public path therefore
    // CANNOT pass: the override reaches only the resolver factory's `validate` default, so an inline
    // validator would leave `seen` EMPTY and fail the very next assertion.
    assert.equal(seen.length, 1, 'the engine resolved and validated the stored definition exactly once');
    assert.equal(seen[0].limits.maxValidationIssues, 5, "the engine's RESOLVED limit reached the validator");
    assert.notEqual(seen[0].limits.maxValidationIssues, ENGINE_LIMIT_DEFAULTS.maxValidationIssues);  // not 100
    // The engine's own limits object is not reachable from here (OPEN-3: no resolved-limits accessor), so
    // equality is asserted by VALUE against the same resolution — proving the engine handed the FULL
    // resolved set, not a one-field literal built at the call site:
    assert.deepEqual(seen[0].limits, resolveEngineLimits({ maxValidationIssues: 5 }));
    // …and the bound the engine's limit produced is the one the run failed on:
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.resultSet.ledger.planningGaps, [{ phase: 'queued', cause: 'definition-invalid' }]);
  });
  ```

  **Four support obligations this step creates, all inside P7's own files** (nothing is added to another phase's inventory, and no new file is created, so P7's *File structure* table and this task's **Files** block are unchanged — `clashtest/engine.js` is already *Modify* and `test/clashtest/engine/startRun.test.mjs` already *Create (P7.4)*):

  1. `deepFind(tree, pred)` and `storeReturning(def)` are local helpers in `test/clashtest/engine/startRun.test.mjs`, beside the existing `base()` / `validDef()`.
  2. `base()` must expose the fake `world` and `enumerator` it builds (P0 `createFakeWorld`/`createFakeEnumerator` both carry a real `calls` array — A18) so the zero-call assertions can read them; if `base()` currently hides them, widening its return value is a test-file change only.
  3. **`clashtest/engine.js` gains one internal named export, `createStoredDefinitionResolver({testStore, limits, validate = captureAndValidate}) → {resolveDefinition(reference), planningCauseOf(err)}`.** It is the *factory* form of the two closures Step 3 already places in this module (`RunSpec.resolveDefinition` / `RunSpec.planningCauseOf` over `stores.test`), and `createClashTestEngine` builds it **once**, with `stores.test` and **`effectiveLimits`** (`resolveEngineLimits(limits)`) — so the hand-down of `maxValidationIssues` is a single wiring line a test can observe, rather than an untestable inline closure. The factory is **per-engine** and its `resolveDefinition` takes the reference; `buildRunSpec` wraps it in the **per-run, zero-argument** `RunSpec.resolveDefinition` P6 requires (`() => resolver.resolveDefinition(input)`) and passes `resolver.planningCauseOf` straight through, so P6's `RunSpec` shape is unchanged. Three things it is **not**: it is **not re-exported from `clashtest/index.js`**, so §18's public surface is unchanged and this adds **no public API** (P7.10's `exports.test.mjs` gains one *absence* assertion pinning exactly that); the `validate` parameter is a **test-only default-argument seam** — its default is P2's `captureAndValidate` unless obligation 4's module-scoped override is active at construction time — not a host option and **not a definition-migration seam** (the owner declined one, above); and it is **no new module** — the obligation note's "no new module" wording still holds exactly.
  4. **`clashtest/engine.js` gains a second internal named export, `withStoredDefinitionValidator(validate, fn) → ReturnType<fn>`.** There remains **exactly ONE constructor** — `createClashTestEngine(options)` is the whole construction path, with no second entry point and no delegation line, so nothing can diverge between a public and an internal build. The helper sets a **module-scoped override** that obligation 3's single wiring line consumes as `createStoredDefinitionResolver`'s `validate` **default** for engines constructed **synchronously inside `fn`**, restores the previous value in a `finally` (so a throw inside `fn` cannot leak it), and returns `fn`'s result. The override is **captured at construction time**: the engine stores its own reference to the validator it was built with and never re-reads the module-scoped slot at run time, so a `startRun` issued after the override is restored still validates through the captured function, and no two engines can interfere. This is what makes the `effectiveLimits` hand-down observable *at engine level through the public constructor*; obligation 3's factory test proves only that the factory obeys limits it is handed, and the end-to-end arm (ii) proves only the cause, which an inline default-limit validator would also produce. Because the engine under test is built by `createClashTestEngine` itself, a divergent inline default-limit validation path on that public path **fails** the test (the spy would see zero calls). Same three non-properties as obligation 3: **not** re-exported from `clashtest/index.js` (Task P7.10's public-surface test asserts its absence by name), a **test-only** seam and not a host option, and **no new module or file**. Why a construction seam rather than a read-counter canary through the public engine: P2's pass is **capture-first** — `captureAndValidate` runs `captureStructural` over the whole definition and only then applies V1–V6 to the detached copy (`p2-definitions.md`, `captureAndValidate`) — P0's `captureData` stops early only on its own `maxIssues`, the node ceiling, the root gate or the open-field budget, and P0's capture is **descriptor-based and never invokes a getter** (`p0-foundations.md`, capture design note 2). With structurally legal entries, capture therefore reads and copies **every** entry at any `maxValidationIssues`, and the one limit-sensitive stop — `checkSelection`'s `for (… && !c.full; …)` loop — runs over the detached copy, where no getter or `Proxy` of the caller's object survives. A visit counter could observe neither the bound nor a difference between limit 5 and the default 100, so it is **not** used.

  The tests import P0's **`resolveEngineLimits`** and **`ENGINE_LIMIT_DEFAULTS`** (`clashtest/options.js`), P0's **`InvalidTestDefinitionError`** (`clashtest/errors.js`), P2's **`captureAndValidate`** (`clashtest/definition/validate.js`), P3's **`PLANNING_CAUSES`** (`clashtest/planning/ElementEnumerator.js`) and P7's own `createStoredDefinitionResolver` and `withStoredDefinitionValidator` (alongside the public `createClashTestEngine`) — every one a real export of a module P7 already depends on or owns — and add **no** engine *member*: per the OPEN-3 ruling the engine object exposes no resolved-limits accessor, so the test resolves the limits itself and passes them to the factory.

  **The former "≤ 20 `{path, code}` issues recorded" sub-conjunct is CLOSED by owner disposition A1 (2026-09-21) and must not be reopened here.** The earlier draft of §22 AC-16 required those issues to be recorded durably, which had no home in P5's closed sealed `PlanningGap` (`{phase, cause}`, P5.5's structural schema `TYPES`). The milestone owner chose **"Option 2"** and authorized a narrow spec amendment (spec errata row **A1**; §5.5 now says "**no field-level issue detail — no path, code or value — is recorded in the sealed set**", and §22 AC-16 now says "**no invalid definition, offending value or field-level issue detail persisted or exposed on the sealed set**"). Consequences, all of them binding on this step: the durable recording requirement is **gone**; **P5's `PlanningGap` shape is unchanged and P7 does not widen it**; assertion (d) above — no offending value *and* no `path`/issue-code field-level detail, in the sealed set *and* the persisted copy — is the positive form of the amended requirement, not a workaround. Registered as **S-P7-5** in the reconciliation's Spec issues register (the one **APPLIED** erratum there) and in the master's §8. Unaffected and still carrying full issue lists: the **synchronous** direct-definition `InvalidTestDefinitionError{issues, issuesTruncated}` (thrown, never persisted) and `CorruptResultSetError{issues}` / `CorruptListingError{issues}`. **Nothing here remains open for the owner.** The `migration-failed` reachability item above is a *coverage* matter, not a schema question, and it too was dispositioned on 2026-09-21: it is a **recorded, owner-accepted, non-blocking deferral** with the exact re-open trigger written at that paragraph, and it does not block this plan, P7.11 core acceptance or G-PLAN.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.5: Residency, persistence and retention surface

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/residency.test.mjs`

**Interfaces**

*Consumes — **RECONCILED** (N23; producer wins):* P5 `residency.js` — **`retainResultSet(runId) → {release()}`**, **`releaseResultSet(runId, {acknowledgeUnsaved})`**, **`discardRun(runId) → Promise<void>`**, `retryPersist(runId) → Promise<PersistenceOutcome>`, `getPersistenceState(runId) → PersistenceSnapshot|null`, **`retentionReport() → object`**, **`drainForDispose() → {droppedUnsaved, persistenceInFlight}`**. The per-set class is already in **`retentionReport().sets[i].class`**, so `engine.retentionReport()` is one call plus `reads.inUse()`, never a per-set loop. `retryPersist` is legal only from `failed` and **rejects** (it returns a Promise — A8's single rule): a nonresident id **rejects** `ResultNotResidentError`, and a resident set in any other state **rejects** `InvalidOptionsError{issues:[{path:'runId', code:'not-failed'}]}` (P5 Gates item 6). P6 `coordinator.stopAdmitting(engineId)` is the dispose-side admission stop, and P6's engine-only **`RunController.requestDispose() → Promise<RunSummary>`** (N33, returned by `createRun` beside the handle and never reachable *from* it) is the per-run disposal *signal*. The engine keeps its own `runId → {handle, controller}` map (`ownRuns`, Task P7.4) so `dispose()` signals and then awaits exactly its own runs — never the world's, and never a run belonging to a second engine over the same world.

*Produces:* `retainResultSet`, `releaseResultSet`, `discardRun`, `retryPersist`, `getPersistenceState`, `retentionReport`, and the engine's `dispose()` contract.

**Steps**

- [ ] **Step 1: Write the failing residency test.**

```js
// test/clashtest/engine/residency.test.mjs (excerpt)
test('retain/release/discard refusals', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null });
  const h = engine.startRun(validDef());
  await assert.rejects(engine.discardRun(h.runId), RunNotTerminalError);        // Promise-returning ⇒ rejects (A8)
  await h.done;
  assert.throws(() => engine.retainResultSet(h.runId), UnsavedResultSetError);  // held, never auto-evicted
  assert.throws(() => engine.releaseResultSet(h.runId), UnsavedResultSetError);
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });               // idempotent no-op
  await assert.rejects(engine.retryPersist(h.runId), ResultNotResidentError);   // Promise-returning ⇒ rejects (A8)
});

test('a retained saved set is never the LRU eviction victim', async () => {
  const engine = createClashTestEngine({ ...base(), limits: { maxResidentResultSets: 2 } });
  const a = engine.startRun(validDef()); await a.persisted;
  const lease = engine.retainResultSet(a.runId);
  const b = engine.startRun(validDef()); await b.persisted;
  assert.throws(() => engine.startRun(validDef()), ResultCapacityError);   // a retained, b… see below
  lease.release();
  assert.ok(engine.startRun(validDef()));                                  // a is now evictable
  assert.equal(engine.getRun(a.runId), null);
});

test('discardRun chains the store delete after an in-flight put settles', async () => {
  const gate = deferred();
  const resultStore = { ...createInMemoryResultStore(), put: async (s) => { await gate.promise; } };
  const seen = [];
  resultStore.delete = async (id) => { seen.push(id); };
  const engine = createClashTestEngine({ ...base(), resultStore });
  const h = engine.startRun(validDef());
  await h.done;                                            // resolves at persistTimeoutMs, pending
  assert.deepEqual(engine.getPersistenceState(h.runId), { state: 'pending', timedOut: false, attempt: 1 });
  const discarding = engine.discardRun(h.runId);
  assert.deepEqual(seen, []);                              // delete NOT issued while the put is in flight
  gate.resolve();
  await discarding;
  assert.deepEqual(seen, [h.runId]);
});

test('dispose hands unsaved sets back and names in-flight writes', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null, limits: { maxResidentResultSets: 4 } });
  const runs = [];
  for (let i = 0; i < 4; i++) { const h = engine.startRun(validDef()); await h.done; runs.push(h.runId); }
  const summary = await engine.dispose();
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId).sort(), [...runs].sort());
  for (const d of summary.droppedUnsaved) assert.ok(Object.isFrozen(d.resultSet));
  assert.deepEqual(summary.persistenceInFlight, []);
});

test('dispose forces a hung write\'s terminal event and done closed exactly once', async () => {
  // Persistence that NEVER settles. `requestDispose()` force-finalizes the run inside its finalize
  // window, so neither `done` nor `dispose()` waits for `persistTimeoutMs`, let alone for the put.
  const resultStore = { ...createInMemoryResultStore(), put: () => new Promise(() => {}) };
  const engine = createClashTestEngine({ ...base(), resultStore, now: fakeClock.now });
  const h = engine.startRun(validDef());
  const events = [];
  h.subscribe((e) => { if (e.type === 'state') events.push(e); });
  const summary = engine.dispose();                       // BEFORE persistTimeoutMs elapses
  const done = await h.done;
  assert.equal(events.length, 1);
  assert.deepEqual(done.persistence, { state: 'pending', timedOut: true, attempt: 1 });
  const s = await summary;
  assert.deepEqual(s.persistenceInFlight, [h.runId]);
  fakeClock.advance(ENGINE_LIMIT_DEFAULTS.persistTimeoutMs * 2);   // nothing further is emitted
  assert.equal(events.length, 1);
});

test('dispose signals first and waits second: a blocked in-flight unit DRAINS, then the run seals', async () => {
  // Spec §10.1-§10.2 (F6: *drain, not discard*) and P6 open item O9 / its Question 4: an in-flight
  // `findClashes` has NO abort seam, so `dispose()` legitimately stays pending until that unit
  // returns. The block is therefore CONTROLLABLE and this test releases it -- executor non-return is
  // an accepted limit of an injected port, not something the core terminates; a host that must bound
  // a hostile executor bounds it inside the executor. What the signal-first order buys is that every
  // wait the ENGINE owns is bounded, and that is what this test proves: no unit is abandoned, the
  // drained unit is merged or discarded by §16.7, the set is sealed, and only then do both settle.
  // `hold()` reaches `createExecutionWorld()` from the P0 `createFakeWorld` half of the composed
  // double (P4 support): `hold()` parks the next `findClashes` and `release()` settles it.
  const world = createExecutionWorld();
  const held = world.hold();                              // parks the next `findClashes`
  const engine = createClashTestEngine({ ...base(), world, resultStore: null });
  const h = engine.startRun(validDef());
  await held.started;                                     // the run is INSIDE the unit loop
  const summary = engine.dispose();                       // signals EVERY owned run before any await
  let disposeSettled = false, doneSettled = false;
  summary.then(() => { disposeSettled = true; }); h.done.then(() => { doneSettled = true; });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.equal(disposeSettled, false, 'dispose() stays PENDING while the in-flight unit drains');
  assert.equal(doneSettled, false, 'and so does `done`: the unit is drained, not discarded');
  held.release();                                         // the drained unit finally returns
  const s = await summary;                                // NOW both settle -- and only now
  const done = await h.done;
  assert.equal(done.status, 'cancelled');                 // P6 order B: disposeRequested ⇒ cancelled
  assert.equal(done.resultSet.ledger.units[0].outcome, 'evaluated');  // §16.7 matrix C: U9 ⇒ MERGED
  assert.ok(done.resultSet !== null && Object.isFrozen(done.resultSet));
  assert.ok(done.resultSet.outcome.reasons.includes('engine-disposed'));   // P6 collectReasons
  assert.deepEqual(s.droppedUnsaved.map((d) => d.runId), [h.runId]); // no store ⇒ handed back
});

test('dispose seals a QUEUED run that never reached the head of the queue', async () => {
  const world = createExecutionWorld();
  const held = world.hold();                               // the head of the queue is PARKED, not stuck
  const engine = createClashTestEngine({
    ...base(), world, resultStore: null, limits: { maxResidentResultSets: 4 },
  });
  const inFlight = engine.startRun(validDef());
  const queued = engine.startRun(validDef());              // waits behind it: one in-flight slot per world
  await held.started;
  assert.equal(engine.retentionReport().slotsInUse, 2);
  const summary = engine.dispose();
  const q = await queued.done;                             // settles WITHOUT ever having run -- and
  assert.equal(q.status, 'cancelled');                     // BEFORE the head is released: signal-first
  assert.equal(q.resultSet.definition, null);              // the R5 pre-resolution cancelled-set shape
  assert.equal(q.resultSet.ledger.planExists, false);
  held.release();                                          // only now does the head's unit drain
  assert.equal((await inFlight.done).status, 'cancelled');
  const s = await summary;
  assert.deepEqual(s.droppedUnsaved.map((d) => d.runId).sort(),
    [inFlight.runId, queued.runId].sort());                // BOTH were signalled, not only the in-flight one
});

test('concurrent dispose calls share one promise, one summary and one terminal event per run', async () => {
  const world = createExecutionWorld();
  const held = world.hold();
  const engine = createClashTestEngine({ ...base(), world, resultStore: null });
  const h = engine.startRun(validDef());
  const terminals = [];
  h.subscribe((e) => { if (e.type === 'state' && e.terminal) terminals.push(e); });
  await held.started;
  const a = engine.dispose();
  const b = engine.dispose();
  assert.equal(a, b);                                      // the SAME promise object, not an equal one
  held.release();                                          // the drained unit returns; both awaits settle
  const [sa, sb] = await Promise.all([a, b]);
  assert.equal(sa, sb);
  assert.equal(terminals.length, 1);                       // requestDispose is idempotent: one finalize
  assert.equal(await engine.dispose(), sa);                // and after settling, still the same summary
  assert.throws(() => engine.startRun(validDef()), EngineDisposedError);
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/residency.test.mjs`.
- [ ] **Step 3: Implement the residency surface.** Each method is `alive()` (or `aliveAsync()`) plus a delegation to P5's residency manager — `retainResultSet`, `releaseResultSet`, `discardRun`, `retryPersist`, `getPersistenceState` are one line each, and `retentionReport()` is `{...residency.retentionReport(), readSlotsInUse: reads.inUse()}`. Only `dispose()` has an order of its own:

```js
function dispose() {
  if (disposePromise) return disposePromise;
  disposed = true;                                   // set BEFORE the first await: a concurrent call sees it
  disposePromise = (async () => {
    coordinator.stopAdmitting(engineId);             // no further run of THIS engine is admitted (N25)
    // SIGNAL EVERY OWNED RUN FIRST, THEN WAIT. Taking one synchronous snapshot of the map and
    // signalling all of it before the first await is what bounds every wait the ENGINE owns: a
    // queued run is sealed as a pre-resolution cancelled set without ever reaching the head of the
    // queue, an in-flight run stops issuing at its next cooperative boundary, and a run in its
    // finalize window force-finalizes instead of waiting for a write that may never settle.
    // What it does NOT do -- deliberately -- is abandon a unit that is already in flight: §10.1
    // gives that call no abort seam and F6's disposition is *drain, not discard*, so this promise
    // stays pending until that executor returns. That residual unboundedness is P6's accepted
    // injected-port limit (O9), not a defect this order is meant to remove.
    const owned = [...ownRuns.values()];
    for (const { controller } of owned) controller.requestDispose();   // idempotent, never throws (N33)
    // Only NOW await. `requestDispose()` settles with the same RunSummary as `done`, so awaiting
    // `done` adds no new failure mode; `.catch` is belt-and-braces for a listener-thrown rejection.
    await Promise.all(owned.map(({ handle }) => handle.done.catch(() => {})));
    return residency.drainForDispose();              // IS the DisposeSummary (N23)
  })();
  return disposePromise;
}
```

  **Signal-then-wait is the whole contract, and the order is load-bearing.** `stopAdmitting` only closes the *door*; it says nothing to the runs already inside, so an implementation that goes straight from `stopAdmitting` to `await handle.done` waits for as long as the slowest run takes — for a queued run, for the whole queue ahead of it; for a sealed run, for a `put` that may never settle. The signal removes exactly those waits: **every wait the engine itself owns is bounded** — the queue, the unit boundary, the seal, and the `persistTimeoutMs` finalize window. **It does not, and must not, remove the drain of an in-flight unit.** P6 answers its own Question 4 the other way round from an earlier draft of this file, and P7 follows P6 and the frozen §10.1–§10.2: `findClashes` has no abort seam, F6's disposition is *drain, not discard*, and a unit that eventually returns must still be settled by §16.7 rather than abandoned with its partial evidence in limbo. So **`dispose()` (and the run's `done`) may stay pending while an injected executor has not returned, and that is accepted, not a defect** — it is P6 open item O9, recorded there as an injected-port limit with no new timer, because a timer would either seal a ledger claiming a unit is still running or break §13.5.1's "resolves exactly once". A host that must bound a hostile executor bounds it inside the executor, which is a port it supplies. `requestDispose()` is P6's engine-only surface, so this path exists without widening `RunHandle`: a host still cannot force-finalize somebody else's run. Three properties P7 relies on and tests: it is **idempotent** (a second `dispose()` returns the stored promise and signals nothing again, and even a redundant signal is a no-op), it **never throws** (so one bad run cannot abort the loop mid-way and strand the rest), and it is **total over the map** — queued, in-flight and persisting runs are signalled alike, because `ownRuns` holds a run from `createRun` until the engine is gone, not only while it is executing.

  `dispose()` never throws and never waits for an in-flight write: `drainForDispose()` names those runs in `persistenceInFlight` and hands every unsaved set back in `droppedUnsaved`.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.6: Freshness and claim surface, raw-set entry rules

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/claim.test.mjs`

**Interfaces**

*Consumes (Assumed):*
- P6 `run/freshness.js` — **CHANGED (N32):** **`getFreshness(resultSet, {registry, enumerator?, ctx?}) → Promise<Freshness>`** implementing the three-snapshot / two-digest-pass bracket of §16.4. `Freshness` is the frozen **object `{state, reasons}`**, not a bare string (N19/C1) — `engine.getFreshness` returns it unchanged, and `RunOutcome.freshness` holds only `.state`.
- P5 `results/claim.js`: `assessNoClashClaim(resultSet, currentFreshness) → ClaimAssessment`, `canClaimNoClashes(resultSet, currentFreshness) → boolean`, **`freshnessStateOf(freshness)`** — all pure, all accepting **either** a `Freshness` object or the bare state string, and all requiring the argument (an absent/unrecognized value reads as `null` ⇒ not claimable, fail-closed). P7 passes the **object** it just computed, so refusal `qualifiers` carry §16.4's reasons. **The digest-version rule is a conjunct of this predicate (P5 re-verification finding 2, and its Question 2's answer):** P5 adds `digests.digestVersion === DIGEST_VERSION` to `assessNoClashClaim` and refuses with a **`{kind: 'digest-version', reason: 'unknown-digest-version'}`** qualifier. **P5's claim predicate is the normative owner**; P6's read-time freshness *may additionally* return `unverifiable` for the same input, which P5 declares a second, independent refusal path and **never a substitute**. P7 therefore asserts the *qualifier*, not a particular freshness state — that is what distinguishes "the claim predicate refused it" from "freshness happened to refuse it first", and it is the one assertion that stays true whichever way P6 resolves its own half. P7 owns no part of the rule and adds no check of its own; it owns only the **engine-bound** proof, because the engine path is the one a host calls and the standalone P5 test cannot see it.
- P5 `results/validateResultSet.js` — **CHANGED (N30):** `validateResultSet(set, {limits}) → {ok, issues}` is **pure and synchronous** and **returns** rather than rejecting. The awaitable read-through is **`readResultSet(raw, {limits, migrations?, slicer, runId?}) → Promise<ResultSet>`** (capture → version → migrate → validate → freeze), and *that* is what rejects with `CorruptResultSetError{runId, issues}` / `UnsupportedSchemaVersionError` / `ResultSetTooLargeError`. P7's read-through path uses `readResultSet`; `validateResultSetSteps` is the sliceable generator form.
- **CHANGED (N29):** `captureResultSet` is **not in P0** — it is **P5 `results/validateResultSet.js`'s** `captureResultSet(raw, {limits}) → ResultSet`, synchronous, throwing `UnsupportedSchemaVersionError` / `CorruptResultSetError` / `ResultSetTooLargeError` per §13.6. P7 imports it from `results/validateResultSet.js`. (P0's generic `captureData` is what P5 builds it on; P0's *Gates* item 3 records the two-ceiling mapping P5 applies.)
- P1 `ModelRegistry#invalidateModelPlacement(modelKey) → number` — the §16.2 "single call" (bump `placementGeneration`, then `world.invalidateModelPlacement(model)`), which P1's own summary names as the target of P7's one-line delegate. An unbound key throws `ModelBindingError({reason:'model-not-bound'})`.

*Produces:* `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `invalidateModelPlacement`.

**Steps**

- [ ] **Step 1: Write the failing claim/freshness test.**

```js
// test/clashtest/engine/claim.test.mjs (excerpt)
test('engine-bound claim uses LIVE freshness, never the sealed value', async () => {
  const fx = makeRealWorldFixture({ models: [cleanModel('a'), cleanModel('b')] });
  const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
  const h = engine.startRun(cleanCrossModelDef()); const s = await h.done;
  assert.equal(s.resultSet.outcome.freshness, 'current');
  assert.equal(await engine.canClaimNoClashes(h.runId), true);
  engine.invalidateModelPlacement('a');                       // post-seal placement change
  assert.equal(s.resultSet.outcome.freshness, 'current');     // the SEALED value is unchanged
  assert.equal(await engine.canClaimNoClashes(h.runId), false);
  const a = await engine.assessNoClashClaim(h.runId);
  assert.equal(a.allowed, false);
});

test('a hierarchy-accepted run is allowed-but-qualified, and the boolean stays false', async () => {
  const fx = makeRealWorldFixture({ models: [nestedOwnerModel('x')] });
  const cfg = { world: fx.world, enumerator: fx.enumerator };
  const plain = createClashTestEngine(cfg);
  const accepting = createClashTestEngine({ ...cfg, hierarchyInternalAcceptance: { recordRef: 'REC-1' } });
  const h = accepting.startRun(selfTestDef('x'));
  const s = await h.done;
  assert.deepEqual(s.resultSet.results, []);
  assert.equal(s.resultSet.outcome.coverage, 'full');
  assert.equal(s.resultSet.outcome.integrity, 'clean');
  const a = await accepting.assessNoClashClaim(h.runId);
  assert.equal(a.allowed, true);
  assert.equal(a.unqualified, false);
  assert.equal(a.proofMethod, 'bracketed-digest');
  assert.deepEqual(a.qualifiers.map((q) => q.kind), ['hierarchy-internal-accepted']);
  assert.equal(await accepting.canClaimNoClashes(h.runId), false);
  // acceptance is per SEALED set, never retroactive:
  const viaPlain = await plain.assessNoClashClaim(s.resultSet);
  assert.equal(viaPlain.allowed, true);                        // the set records its own acceptance
  const unaccepted = await plain.startRun(selfTestDef('x')).done;
  assert.equal((await accepting.assessNoClashClaim(unaccepted.resultSet)).allowed, false);
});

test('an engine-bound assessment of a RAW set captures before the first await', async () => {
  const engine = createClashTestEngine(base());
  const h = engine.startRun(cleanDef()); const { resultSet } = await h.done;
  const mutable = structuredClone(resultSet);
  const p = engine.assessNoClashClaim(mutable);
  mutable.outcome.coverage = 'partial';                        // synchronous post-call mutation
  const control = await engine.assessNoClashClaim(structuredClone(resultSet));
  assert.deepEqual(await p, control);
});

test('raw-set calls are never queued: the surplus rejects ReadCapacityError immediately', async () => {
  const engine = createClashTestEngine({ ...base(), limits: { maxConcurrentStoreReads: 1, maxQueuedStoreReads: 8 } });
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  const first = engine.getFreshness(structuredClone(set));     // holds the only read slot
  await assert.rejects(() => engine.canClaimNoClashes(structuredClone(set)),
    (e) => e instanceof ReadCapacityError && e.limit === 1);
  await first;
});

test('an unknown digestVersion is never claimable through the ENGINE-bound path', async () => {
  // P5 re-verification finding 2. The NORMATIVE owner is the CLAIM PREDICATE (P5's
  // `digests.digestVersion === DIGEST_VERSION` conjunct: unknown ⇒ not allowed). The fixture must
  // therefore be an EMPTY-RESULTS, otherwise-claimable completed-clean set: a positives fixture is
  // already refused by `noResults` and would prove nothing (the exact defect in P5's old test).
  const engine = createClashTestEngine(base());
  const clean = (await engine.startRun(cleanDef()).done).resultSet;
  assert.deepEqual(clean.results, []);                         // the control IS claimable
  assert.equal(await engine.canClaimNoClashes(clean.runId), true);

  // The ONLY difference is the digest version. Both digest strings are replaced because an unknown
  // version is not compared (P5 validation table), so the set still reads back `ok` and uncorrupted.
  const unknown = structuredClone(clean);
  unknown.digests = { digestVersion: 99, pairSetDigest: 'sha256:' + '0'.repeat(64),
                      ledgerDigest: 'sha256:' + '1'.repeat(64) };

  assert.equal(await engine.canClaimNoClashes(unknown), false);
  const a = await engine.assessNoClashClaim(unknown);
  assert.equal(a.allowed, false);
  assert.equal(a.unqualified, false);
  // The PREDICATE's own refusal, named: P5 emits this qualifier from the digest-version conjunct.
  // Asserting the qualifier rather than a freshness state is deliberate -- P5 declares read-time
  // freshness a SECOND, INDEPENDENT refusal path for the same input ("never a substitute"), so an
  // assertion like `getFreshness(unknown).state === 'current'` would pin a P6 choice P5 leaves open
  // and could pass for the wrong reason.
  assert.ok(a.qualifiers.some((q) => q.kind === 'digest-version' && q.reason === 'unknown-digest-version'));
});

test('capture/validation failures REJECT, never throw synchronously', async () => {
  const engine = createClashTestEngine(base());
  const cyclic = { schemaVersion: 1 }; cyclic.self = cyclic;
  const p = engine.getFreshness(cyclic);                        // must not throw here
  await assert.rejects(() => p, CorruptResultSetError);
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/claim.test.mjs`.
- [ ] **Step 3: Implement the read-side surface.** One shared helper does the entry work for all four raw-set-or-id methods:

```js
function withReadSet(input, fn) {
  // Synchronous prefix, before any await:
  let detached = null, slot = null, queued = null;
  try {
    alive();
    if (typeof input === 'string') queued = reads.acquire();              // FIFO up to maxQueuedStoreReads
    else {
      slot = reads.reserveSync();                                        // ReadCapacityError, never queued
      detached = captureResultSet(input, { limits: effectiveLimits });   // P5 (N29); sync, pre-await
    }
  } catch (err) { if (slot) slot.release(); return Promise.reject(err); }
  return (async () => {
    if (queued) slot = await queued;                 // may reject ReadCapacityError; no slot to release yet
    try {
      const raw = detached ?? await readRawById(input);
      if (raw === null) return await fn(null);
      // ONE validating path for both entry shapes: capture -> version -> migrate -> validate -> freeze.
      // `runId` is an explicit diagnostic parameter (P5): it is NEVER read off the untrusted value.
      const set = await readResultSet(raw, {
        limits: effectiveLimits, slicer: newSlicer(), runId: typeof input === 'string' ? input : null,
      });
      return await fn(set);
    } finally { slot.release(); }
  })();
}

async function readRawById(runId) {
  const rs = requireStore('resultStore');
  return rs.get(runId, { maxBytes: effectiveLimits.maxStoredResultBytes });   // byte guard before any parse
}
```

  **The `null` raw value is a real branch, not an oversight.** `ResultStore.get` answers `null` for an id it does not hold, so `getResultSet` resolves `null` (its declared contract), while `getFreshness` / `canClaimNoClashes` / `assessNoClashClaim` / `rerun` reject `ResultNotResidentError{runId}` — a set that is neither resident nor stored has no freshness to compute and nothing to rerun, and answering `false`/`'unverifiable'` would be indistinguishable from a real negative. Each caller's `fn` therefore decides; `withReadSet` only routes.

  `reserveSync()` throws `ReadCapacityError{limit}` immediately when no slot is free (raw sets are never queued, §13.6); `acquire()` queues up to `maxQueuedStoreReads` and rejects beyond it. The whole prefix is synchronous, so `try/catch → Promise.reject` is what converts a synchronous failure into the rejection the spec requires. **The awaitable, rejecting path is `readResultSet` (N30)** — `validateResultSet(set, {limits}) → {ok, issues}` is pure, synchronous and *returns*, so it is never the thing P7 awaits; re-running `readResultSet` over an already-detached copy is what applies migration, validation and the deep freeze on the raw-set path.
  P6's `getFreshness` is imported under an alias so it does not shadow the engine method — `import { getFreshness as readTimeFreshness } from './run/freshness.js'` — and the engine method is `withReadSet(input, (set) => readTimeFreshness(set, { registry, enumerator }))`, returning P6's frozen **`Freshness` object `{state, reasons}` unchanged** (R3). `canClaimNoClashes` / `assessNoClashClaim` compute that same object and pass it **straight through** to P5's pure helpers — `canClaimNoClashes(set, freshness)` / `assessNoClashClaim(set, freshness)` — never a bare string and never through an adapter of P7's own, so a `stale`/`unverifiable` refusal carries §16.4's `reasons` in `qualifiers` (N19). `invalidateModelPlacement(modelKey)` is `alive(); registry.invalidateModelPlacement(modelKey);` — P1's §16.2 single call.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.7: `rerun`

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/rerun.test.mjs`

**Interfaces**

*Consumes:* everything Tasks P7.4 and P7.6 wired — in particular P5's `captureResultSet(raw, {limits})` (synchronous) and **`readResultSet(raw, {limits, migrations?, slicer, runId?}) → Promise<ResultSet>`** as the one rejecting validate-and-freeze path (N30), P0's positional **`resolveRunOptions(input, limits?)`** (N31), P5's `reserveRunSlot`/`releaseRunSlot` (N23), P6's `createRun(spec) → {handle, begin()}` (N25), and the R6 queue-admission prefix. The `definitionRevision` path resolves through the P2 store's `resolveForRun(...).status` (N27).

*Produces:* `rerun(runIdOrResultSet, {definitionRevision?, runOptions?}) → Promise<RunHandle>`.

**Steps**

- [ ] **Step 1: Write the failing rerun test.**

```js
// test/clashtest/engine/rerun.test.mjs (excerpt)
test('rerun resolves to a live handle only after capture, validation AND admission', async () => {
  const engine = createClashTestEngine(base());
  const base0 = await engine.startRun(cleanDef()).done;
  const h = await engine.rerun(base0.runId, {});
  assert.notEqual(h.runId, base0.runId);
  const s = await h.done;
  assert.equal(s.resultSet.derivedFromRunId, base0.runId);
  assert.equal(s.resultSet.testRef.semanticDigest, base0.resultSet.testRef.semanticDigest);
});

test('rerun lineage survives the RunSpec: the sealed set carries the BASE runId, startRun seals null', async () => {
  // N33. `derivedFromRunId` is a declared RunSpec field, so a typed/object projection of the spec
  // cannot drop it -- the defect this pins is a rerun that seals `null` and loses its lineage.
  const engine = createClashTestEngine(base());
  const first = await engine.startRun(cleanDef()).done;
  assert.equal(first.resultSet.derivedFromRunId, null, 'a run that derives from nothing seals null');

  const second = await (await engine.rerun(first.runId, {})).done;
  assert.equal(second.resultSet.derivedFromRunId, first.runId);

  // A rerun OF a rerun names its immediate base, not the root of the chain.
  const third = await (await engine.rerun(second.resultSet, {})).done;
  assert.equal(third.resultSet.derivedFromRunId, second.runId);

  // Lineage is a record, not a liveness claim: discarding the base does not retract it.
  engine.releaseResultSet(second.runId, { acknowledgeUnsaved: true });
  assert.equal(engine.getRun(second.runId), null);
  assert.equal(third.resultSet.derivedFromRunId, second.runId);
});

test('every failure class REJECTS and leaves no run, no queue entry and no held slot', async () => {
  const engine = createClashTestEngine({ ...base(), limits: { maxResidentResultSets: 2 } });
  const before = engine.retentionReport().slotsInUse;
  for (const [input, opts, Err] of [
    [corruptSet(), {}, CorruptResultSetError],
    [futureSchemaSet(), {}, UnsupportedSchemaVersionError],
    [validSetClone(), { runOptions: { zzz: 1 } }, InvalidOptionsError],
  ]) {
    await assert.rejects(() => engine.rerun(input, opts), Err);
    assert.equal(engine.retentionReport().slotsInUse, before);
    assert.equal(engine.retentionReport().readSlotsInUse, 0);
  }
});

test('a ResultCapacityError at admission rejects the rerun promise (it does not throw)', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null, limits: { maxResidentResultSets: 1 } });
  const first = await engine.startRun(cleanDef()).done;
  const p = engine.rerun(first.resultSet, {});
  assert.ok(p instanceof Promise);
  await assert.rejects(() => p, ResultCapacityError);
});

test('capture is synchronous: a caller mutating the raw set right after the call gets the control run', async () => {
  const engine = createClashTestEngine(base());
  const set = (await engine.startRun(cleanDef()).done).resultSet;
  const mutable = structuredClone(set);
  const opts = { runOptions: { broadPhase: 'linear' } };
  const p = engine.rerun(mutable, opts);
  mutable.definition.selectionA = [];            // synchronous, post-call
  opts.runOptions.broadPhase = 'tlas';           // the options object is captured in the same step
  const s = await (await p).done;
  assert.equal(s.resultSet.provenance.broadPhase, 'linear');
  assert.deepEqual(s.resultSet.definition, set.definition);
});

test('a pre-resolution set has nothing to rerun without a definitionRevision', async () => {
  const engine = createClashTestEngine(base());
  const h = engine.startRun(slowDef()); h.cancel();            // seals before resolution
  const { resultSet } = await h.done;
  assert.equal(resultSet.definition, null);
  await assert.rejects(() => engine.rerun(resultSet, {}),
    (e) => e instanceof InvalidOptionsError && e.issues[0].code === 'no-embedded-definition');
  await engine.saveTest(validDef({ testId: resultSet.testRef.testId, revision: 1 }));
  const h2 = await engine.rerun(resultSet, { definitionRevision: 1 });   // stored-reference lookup
  assert.equal((await h2.done).resultSet.testRef.revision, 1);
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/rerun.test.mjs`.
- [ ] **Step 3: Implement `rerun`.**

```js
function rerun(input, opts = {}) {
  let detached = null, options = null, slot = null, queued = null;
  let definitionRevision;
  try {
    alive();
    assertClosedOptions(opts, ['definitionRevision', 'runOptions']);     // InvalidOptionsError
    ({ definitionRevision } = opts);
    // resolveRunOptions is BOTH the validation and the detached copy of the caller's object (N31),
    // and it runs in the same synchronous step as the set capture (§13.6).
    options = resolveRunOptions(opts.runOptions, effectiveLimits);       // positional limits
    if (typeof input === 'string') queued = reads.acquire();
    else {
      slot = reads.reserveSync();
      detached = captureResultSet(input, { limits: effectiveLimits });   // P5 (N29); sync, pre-await
    }
  } catch (err) { if (slot) slot.release(); return Promise.reject(err); }
  return (async () => {
    if (queued) slot = await queued;
    let reserved = null;
    try {
      const raw = detached ?? await readRawById(input);
      if (raw === null) throw new ResultNotResidentError({ runId: input });
      const set = await readResultSet(raw, {                            // the one rejecting path (N30)
        limits: effectiveLimits, slicer: newSlicer(),
        runId: typeof input === 'string' ? input : null,                // explicit; never read off `raw`
      });
      if (definitionRevision === undefined && set.definition === null) {
        throw new InvalidOptionsError({                                  // ONE object argument (N1)
          issues: [{ path: '/definitionRevision', code: 'no-embedded-definition',
                     message: 'the base set was sealed before resolution' }],
          reason: 'no-embedded-definition',
        });
      }
      const source = definitionRevision === undefined
        ? { kind: 'definition', value: set.definition }
        : { kind: 'reference', value: { testId: set.testRef.testId, revision: definitionRevision } };
      const runId = newRunId();
      residency.reserveRunSlot(runId);                 // ResultCapacityError, at the moment validation succeeded
      reserved = runId;
      admitToQueue(runId);                             // RunQueueFullError (R6)
      const { handle, controller, begin } = createRun(buildRunSpec({
        runId, source, options,
        derivedFromRunId: set.runId,                   // N33: the BASE set's runId, sealed as lineage
      }));
      ownRuns.set(runId, { handle, controller });      // a rerun is an owned run like any other
      begin();
      reserved = null;                                 // the run owns the slot from here
      return handle;
    } catch (err) {
      if (reserved) { ownRuns.delete(reserved); residency.releaseRunSlot(reserved); persistenceSinks.delete(reserved); }
      throw err;
    } finally { slot.release(); }
  })();
}
```

  The rollback is the same pair as `startRun`'s — `reserveRunSlot` / `releaseRunSlot` (N23) — so a `RunQueueFullError`, or anything `createRun`/`begin()` throws after the reservation, returns the slot before the rejection escapes (R6). `InvalidOptionsError{reason:'no-embedded-definition'}` is *rejected*, not thrown, because §18's `rerun` contract governs, and per R1 that asymmetry is deliberate: `rerun` returns a Promise, `startRun` does not (see Gates and open items, item 4).
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.8: Differential suite over the real `CollisionWorld`

The master's Definition of Done item 4. Four modes × four selection shapes, engine result vs a brute-force reference built from the **same** library, so the suite tests the engine's *decomposition*, not the library's geometry.

**This task also owns the six real-`CollisionWorld` integration families the AC traceability table maps to T2** (five added by the 2026-09-21 independent plan review, finding **H2** — the table promised them while the steps built none; the sixth, and F4c, added when the owner ordered AC-19 (b′) and (d′)'s T2 arm closed in-core on 2026-09-21): **(F1)** cancellation mid-plan with an evaluated-subset comparison (AC-7 tail), **(F2)** mixed reachable/unreachable owner orientations (AC-17 b, f), **(F3)** diagnostic stress plus an un-sliced negative control (AC-18 d), **(F4)** the dirty-world, geometry-readiness and equal-baseline/different-membership arms — F4a, F4b, F4c (AC-19 a, e, b′), **(F5)** world disposal and model eviction mid-run (AC-21), **(F6)** foreign placement contention over the real world (AC-19 d′ at T2). They are Steps 11–19 below and live in two additional files, because the differential file is the *decomposition* oracle and these six are *environment and provenance* arms with different fixtures. **What they prove, and what they do not:** every one of these ACs already has a T1 owner (P3/P4/P5/P6) that pins the full table or matrix over fakes; the P7 arms prove only that the **real library raises the facts those T1 matrices assume**, and that the assembled engine's end-to-end sealed set records them. No P7 arm re-derives a T1 table, and no P7 arm may be the *only* evidence for a conjunct a T1 owner already covers.

**Files**
- Create: `test/clashtest/support/realWorld.mjs`, `test/clashtest/support/bruteForce.mjs`
- Test: `test/clashtest/integration/differential.test.mjs` (Steps 1–10), `test/clashtest/integration/realWorldProvenance.test.mjs` (Steps 12–13: F2, F3), `test/clashtest/integration/realWorldEnvironment.test.mjs` (Steps 14–17b: F1, F4a–F4c, F5, F6)

**Interfaces**

*Consumes:* `collision/index.js`'s `CollisionWorld` (public surface only) plus its exported `WorldDisposedError`, `ModelEvictedError`, `RenderProxyUnavailableError`; `test/fixtures/mockInstanceTree.mjs`'s `buildMockModel(rootNodes, fragmentGeometry, options) → {model, stats}`; `test/fixtures/geometry.mjs`'s `box`, `at`, `THREE`. The multi-model plumbing mirrors `test/CollisionWorld.findClashes.crossModel.test.mjs`'s `makeTwoModelFixture` (one shared `viewer.impl.getRenderProxy` dispatching by model identity — `CollisionWorld` holds exactly one `_viewer`). **Verified public seams the six families use, all already present — none is invented here** (F4c and F6, Steps 17a/17b, add nothing to this list; they reuse `world.findClashes`, `world.getEpochCollisionInstanceCount` and `world.invalidateModelPlacement`, plus `maxCollisionInstancesPerEpoch` imported read-only from `collision/constants.js`)**:** `CollisionWorld.fromViewer(viewer, {now, yieldToScheduler, …})`, `world.findClashes(query) → {pairs, statistics}` where `statistics.diagnostics` is the raw per-call array, `world.evictModel(model)`, `world.dispose()`, `world.invalidateModelPlacement(model)`, `world.getEpochCollisionInstanceCount(epoch)`; and on the fixture side `buildMockModel`'s `options.fragmentCount`, `options.ownerDbIdOverrides` (a `Map<fragId, number|number[]|undefined>`; an explicit `undefined` forces `fragment-owner-unresolvable`), `options.notLoadedFragIds` (forces `fragment-not-loaded`) and `options.hiddenDbIds`. The **only** new seam is a test-local one in P7's own `realWorld.mjs` (see *Produces*): there is no production API for "make this fragment's render proxy unavailable", so the fixture's shared `viewer.impl.getRenderProxy` gate is where AC-19(e) is driven — the real `CollisionWorld` then raises its own `RenderProxyUnavailableError` and converts it to a `geometry-not-yet-available` diagnostic (`collision/errors.js`, `_runNarrowPhasePair`), so the arm exercises production code, not a stub.
  Also consumed by the six families: P5 `results/status.js`'s **`createStatusReader(resultSet) → {pairStatus, elementStatus, ledger: LedgerModel}`** and `getPairStatus(set, pairId) → {required, coveringUnitId, unitOutcome, roots, caveats, verdict, reason?}` / `getElementStatus` (D4 — never a P7-local ledger reader), and the sealed `UnitRecord` fields P5 pins (`unitId`, `outcome`, `cause`, `secondaryCauses`, `taints`, `scopeProof`). P4's **`buildFindClashesQuery(request, resolved)`** stays the call-shape oracle of Step 8.

*Produces:* `makeRealWorldFixture`, `bruteForceReference`, `pairKey` and — added for Steps 11–19 — **`recordFindClashes(world) → {calls, restore()}`** (the one recording seam, used by Step 8 and by F3/F5) and the widened `makeRealWorldFixture` options `fragments`, `renderProxy`, `worldOptions`, `register` (signatures in the Phase interface summary). Every addition is an **option with a default that preserves the current behaviour**, per the support-barrel extension rule (P0's `support/index.mjs`, rule 1); `realWorld.mjs` is P7's own file, so this widens no other phase's double.

**Steps**

- [ ] **Step 1: Write `realWorld.mjs` and the failing same-model differential test.** The fixture's enumerator is derived from the *same* tree definition the mock model was built from, so it is a faithful `ElementEnumerator` without any Viewer (gate G-OQ4 stays out of the way — master §4).

```js
// test/clashtest/integration/differential.test.mjs (excerpt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
// `createStatusReader` is not on the §18 public surface (index.js re-exports only the one-shot
// `getPairStatus`/`getElementStatus`), so the suite imports P5's module directly -- still P5's
// reader, never a P7-local one (duplicate-ownership D4).
import { createStatusReader } from '../../../clashtest/results/status.js';
import { makeRealWorldFixture } from '../support/realWorld.mjs';
import { bruteForceReference, pairKey } from '../support/bruteForce.mjs';

// Two models, 3 owners each, deliberately overlapping across and within a model.
const SPEC = {
  a: { 100: [[0, 0, 0]], 200: [[0.5, 0, 0]], 300: [[10, 0, 0]] },
  b: { 100: [[0.25, 0, 0]], 200: [[9.75, 0, 0]] },
};

// `expect` is the arm's ORACLE STRENGTH, not the mode's: see the note under this sketch. Every
// fixture in this file is built to run clean, so every arm here is 'exact' -- 'correlated' and
// 'characterization-only' exist for the deliberately caveated arms of Steps 11-19.
const MODES = [
  { mode: 'volume-overlap', expect: 'exact' },
  { mode: 'clearance', clearance: 0.05, expect: 'exact' },
  { mode: 'surface-intersection', expect: 'exact' },
  { mode: 'containment', expect: 'exact' },
];

// The differential oracle. Review finding M2: the earlier version accepted ANY symmetric difference
// in the two time-sensitive modes as long as SOME global completeness-affecting caveat existed --
// which proves a caveat exists somewhere, not that the differing pair is inside the caveated scope,
// so an unrelated decomposition defect passed. The oracle is therefore EXACT by default, and a
// difference is admissible only on an arm that declares why.
function assertPairSets(actual, reference, { mode, resultSet, expect, caveatReasons = [], record }) {
  const { outcome, diagnostics } = resultSet;
  // A CLEAN run: nothing the engine recorded can license a difference. §15.1 scopes its
  // no-repeatability licence to caveated runs, never to a mode -- `surface-intersection` and
  // `containment` on a clean run are as exact as `volume-overlap`.
  const clean = outcome.environmentSensitive === false
    && diagnostics.completenessAffectingUpperBound === 0
    && diagnostics.unclassifiedOccurrences === 0;
  if (expect === 'exact' || clean) {
    assert.deepEqual(actual, reference, `${mode}: a clean run must equal the brute-force reference `
      + `(environmentSensitive=${outcome.environmentSensitive}, `
      + `completenessAffectingUpperBound=${diagnostics.completenessAffectingUpperBound}, `
      + `unclassifiedOccurrences=${diagnostics.unclassifiedOccurrences})`);
    return;
  }
  const symmetricDifference = [
    ...actual.filter((p) => !reference.includes(p)),
    ...reference.filter((p) => !actual.includes(p)),
  ];
  if (symmetricDifference.length === 0) return;          // equality is always acceptable
  if (expect === 'correlated') {
    // A deliberately caveated fixture: EACH differing pair must be inside the run's own caveated
    // scope, read from the sealed set through P5's status reader -- never from the test's own
    // expectations, and never from a global counter.
    const reader = createStatusReader(resultSet);
    for (const key of symmetricDifference) {
      const status = reader.pairStatus(JSON.parse(key));  // pairKey is canonicalJson(pairId)
      assert.notEqual(status.verdict, 'covered-clean',
        `${mode}: ${key} differs from the reference yet the sealed set calls it covered-clean`);
      assert.ok(status.caveats.some((c) => caveatReasons.includes(c.reason)),
        `${mode}: ${key} differs with no caveat drawn from ${JSON.stringify(caveatReasons)} `
        + `(caveats: ${JSON.stringify(status.caveats)})`);
    }
    return;
  }
  // The last resort, and it is a MEASUREMENT, not a proof: the arm records the difference and
  // claims nothing about decomposition equivalence. Only an arm that says so in its own name and
  // in `record`'s output may use it; it is never the sole evidence for any AC row.
  assert.equal(expect, 'characterization-only');
  record(`${mode}: CHARACTERIZATION ONLY -- ${symmetricDifference.length} pair(s) differ under `
    + `${JSON.stringify(outcome.environmentSensitiveCauses)}; this arm does NOT prove decomposition `
    + `equivalence: ${JSON.stringify(symmetricDifference)}`);
}

for (const { mode, clearance, expect } of MODES) {
  test(`differential: same-model, ${mode}`, async () => {
    const fx = makeRealWorldFixture({ models: SPEC });
    const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
    const def = { schemaVersion: 1, testId: `same-${mode}`, revision: 1, mode, ...(clearance ? { clearance } : {}),
      selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'a' }] };
    const { resultSet } = await engine.startRun(def).done;
    assert.equal(resultSet.outcome.coverage, 'full');
    // The fixtures in THIS file are built to run clean, so the arm also asserts that it IS clean --
    // otherwise `expect: 'exact'` would be silently weakened by a fixture that started caveating.
    assert.equal(resultSet.outcome.integrity, 'clean');
    assert.equal(resultSet.outcome.environmentSensitive, false);
    const ref = await bruteForceReference(fx.world, {
      sources: [['a', 100], ['a', 200], ['a', 300]], targets: [['a', null]], mode, clearance,
    });
    assertPairSets(resultSet.results.map((r) => pairKey(r.pairId)).sort(),
      ref.pairIds, { mode, resultSet, expect });
  });
}
```

  **Oracle strength is a property of the arm, not of the mode (review finding M2).** Three levels, and the arm names which one it is entitled to:

| `expect` | When it is legal | What it asserts | What it proves |
|---|---|---|---|
| `exact` | the fixture is built to run clean, and the arm asserts `environmentSensitive === false` **and** `integrity === 'clean'` itself | `deepEqual` against the brute-force reference | decomposition equivalence |
| `correlated` | a deliberately caveated fixture (Steps 11–19: geometry readiness, capacity, placement contention, mixed-owner provenance) | every pair in the symmetric difference is **not** `covered-clean` and carries a caveat from the arm's declared `caveatReasons` | decomposition equivalence **outside** the caveated scope |
| `characterization-only` | nothing weaker is available and the arm says so in its own test name | the difference is *recorded*, nothing is asserted about it | nothing about equivalence — a measurement only |

  A clean run is always held to `exact`, whichever branch the arm asked for: the `clean` short-circuit above is deliberate, so a caveated arm whose caveat fails to appear cannot quietly fall through to a weaker oracle. `characterization-only` may never be the sole evidence for an AC traceability row; if an arm ends up there, the row keeps its T1 owner and the arm is recorded as characterization in Task P7.11's Step 2 output.

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/integration/differential.test.mjs` → `ERR_MODULE_NOT_FOUND` for the two support modules, then a same-model coverage failure.
- [ ] **Step 3: Implement `bruteForceReference`.** One `findClashes` per (source owner dbId, target model), unioned:

```js
// test/clashtest/support/bruteForce.mjs
import { makePairId, makeElementRef } from '../../../clashtest/identity/ids.js';
import { canonicalJson } from '../../../clashtest/util/canonical.js';

// A `PairId` is the closed frozen record {first, second} (P1) -- it carries no string key of its
// own, so the suite compares canonical JSON rather than inventing a second encoding.
export const pairKey = (pairId) => canonicalJson(pairId);

export async function bruteForceReference(world, { sources, targets, mode, clearance, broadPhase = 'tlas' }) {
  const pairIds = new Set();
  let calls = 0;
  for (const [sourceKey, sourceDbId] of sources) {
    for (const [targetKey, targetDbIds] of targets) {
      const query = {
        source: { model: world.modelFor(sourceKey), dbIds: [sourceDbId] },
        target: { targets: [targetDbIds === null
          ? { model: world.modelFor(targetKey) }                 // whole-model sentinel
          : { model: world.modelFor(targetKey), dbIds: targetDbIds }] },
        mode, groupBy: 'dbId', broadPhase,
        ...(mode === 'clearance' ? { clearance } : {}),
      };
      calls++;
      const { pairs } = await world.findClashes(query);
      for (const p of pairs) {
        // makePairId is arity 3, MODE FIRST (N13). It derives the ordered/unordered semantics
        // itself from `mode`, so nothing in this suite computes or forwards that value
        // (§4.5: "derived, never supplied").
        pairIds.add(pairKey(makePairId(
          mode,
          makeElementRef(sourceKey, p.source.dbId),
          makeElementRef(targetKey, p.target.dbId),
        )));
      }
    }
  }
  return { pairIds: [...pairIds].sort(), calls };
}
```

  `world.modelFor` is the fixture's own lookup, not a `CollisionWorld` method — `makeRealWorldFixture` returns a small façade so the reference reads cleanly. The reference deliberately issues **one source dbId per call**, which is the shape AC-5 names ("for `|A| = 1` and `B` = all models"); the engine's plan uses whatever chunking its options dictate, so equality of the two proves invariant P2 (partition independence).
- [ ] **Step 4: Run it and see it pass for same-model.**
- [ ] **Step 5: Add the cross-model, whole-model-target and whole-model-source shapes.** Same loop, four `selection` shapes:

| Shape | `selectionA` | `selectionB` | What it proves |
|---|---|---|---|
| same-model | `[{kind:'model', modelKey:'a'}]` | same | cell-1 bisection, self-exclusion, F2 (a naive whole-set-vs-itself call returns zero pairs — asserted as a negative control) |
| cross-model explicit | `[{kind:'element', modelKey:'a', dbIds:[100,200]}]` | `[{kind:'element', modelKey:'b', dbIds:[100,200]}]` | cell-2 cross product |
| whole-model target | `[{kind:'element', modelKey:'a', dbIds:[100]}]` | `[{kind:'model', modelKey:'b'}]` | the `targets` entry with `dbIds` omitted (§19.2) |
| whole-model source | `[{kind:'model', modelKey:'a'}]` | `[{kind:'model', modelKey:'b'}]` | enumerator-driven source expansion (F15) |

  Plus the two invariance arms, run for the deterministic modes only:

```js
test('partition and broad-phase independence (AC-4)', async () => {
  const arms = [
    { maxSourceDbIdsPerUnit: 1, maxTargetModelsPerUnit: 1, broadPhase: 'tlas' },
    {                                                       broadPhase: 'tlas' },   // defaults
    { maxSourceDbIdsPerUnit: 500, maxTargetModelsPerUnit: 4, broadPhase: 'tlas' },
    { maxSourceDbIdsPerUnit: 1,                              broadPhase: 'linear' },
    {                                                        broadPhase: 'linear' },
  ];
  const digests = [];
  for (const runOptions of arms) {
    const fx = makeRealWorldFixture({ models: SPEC });
    const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
    const { resultSet } = await engine.startRun(crossModelDef('volume-overlap'), runOptions).done;
    assert.equal(resultSet.outcome.environmentSensitive, false);
    digests.push(resultSet.digests.pairSetDigest);
  }
  assert.equal(new Set(digests).size, 1, 'pairSetDigest must not depend on chunking or broad phase');
});

test('negative control: a naive whole-set-vs-itself findClashes finds no same-model pairs (F2)', async () => {
  const fx = makeRealWorldFixture({ models: SPEC });
  const all = [100, 200, 300];
  const { pairs } = await fx.world.findClashes({
    source: { model: fx.modelFor('a'), dbIds: all },
    target: { model: fx.modelFor('a'), dbIds: all },
    mode: 'volume-overlap', groupBy: 'dbId',
  });
  assert.deepEqual(pairs, []);
  const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
  const { resultSet } = await engine.startRun(selfTestDef('a')).done;
  assert.ok(resultSet.results.length > 0, 'the engine finds the pairs the naive call cannot');
});
```

- [ ] **Step 6: Run the full differential file and see it pass.** `node --test test/clashtest/integration/differential.test.mjs`.
- [ ] **Step 7: Add the determinism arm (AC-6 T2).** Ten repeated runs on one world and ten on fresh worlds, `volume-overlap` and `clearance`, asserting identical `pairSetDigest`, `ledgerDigest`, the canonical JSON of `diagnostics.{total, completenessAffectingCount, unclassifiedOccurrences, countsByReason, omittedReasonOccurrences, geometryReadinessOccurrences}` and every unit's `taints` table — and asserting `environmentSensitive === false` first, since the promise is scoped to that (§15.1, AC-19(c)). **`surface-intersection` and `containment` are included in the digest-equality assertion on these clean fixtures** (review finding M2): §15.1 withholds repeatability from *caveated* runs, not from those two modes, and every fixture in this file asserts itself clean — so a rerun that differs here is a defect, not a licensed flip. The §15.1 licence is exercised instead by the deliberately caveated `correlated` arms of Steps 14–17, which is where a real caveat exists to correlate against.
- [ ] **Step 8: Add the library-call conformance arm (AC-3 tail).** With `recordFindClashes(fx.world)` — `realWorld.mjs`'s one recording seam: an own-property override on the instance that delegates to the real prototype method, records `{query, pairs, statistics}` per call and is undone by `restore()`, never a substitute world (the engine must still see the genuine `CollisionWorld` its coordinator and registry are bound to) — assert for every run above: every call uses the `targets` shape, `groupBy: 'dbId'`, exactly one `mode`, `clearance` present iff the mode is `clearance`; peak concurrent in-flight calls is 1; zero calls after a cancel or a terminal seal; and the engine calls neither `evictModel` nor `dispose` on the world.
- [ ] **Step 9: Run it and see it pass.**
- [ ] **Step 10: Checkpoint commit (only if the user has authorized commits).**

**Steps 11–19 — the six real-`CollisionWorld` integration families (review finding H2; F4c and F6 added by the owner's 2026-09-21 order to close AC-19 (b′) and (d′) T2 in-core).** Appended, not interleaved: Steps 1–10 above are unchanged and every reference to them stays valid. Step 10 remains the checkpoint for Steps 1–9; Step 19 is the checkpoint for Steps 11–18 (Steps 17a and 17b are inserted between Steps 17 and 18 so that no existing step number and no existing cross-reference moves). Each family states its **fixture seam**, its **assertions**, and its **negative control / expected failure mode** — the last one is not optional, because most of these arms assert that something *is* caveated, *is* flagged or *is* absent, and an arm like that passes vacuously on a build that caveats or flags everything. Steps 12–17b each follow this file's red/green convention: write the test, run it and see it fail for the stated reason, then make it pass; Step 18 is the final full-file and full-suite pass. **Nothing in Steps 11–19 changes a production module** — the engine and every port are already complete at Step 10, so a failure here is either a fixture defect or a genuine defect in an *owner* phase, and the second case is a reopen of that phase (Task P7.11's rule), never a fix inside P7.

- [ ] **Step 11: Widen `realWorld.mjs` (seams only — no new test yet).** Five families need four things the current fixture cannot express. All four are **options with behaviour-preserving defaults** (support-barrel extension rule 1), so Steps 1–10 keep passing byte-for-byte:

| Option | Default | What it does |
|---|---|---|
| `fragments` | `{}` | Per-`modelKey` pass-through to `buildMockModel`'s own documented options: `{fragmentCount?, notLoadedFragIds?, ownerDbIdOverrides?, hiddenDbIds?}`. This is how an unreachable-but-loaded fragment (F2) and a diagnostic storm (F3) are built — **from the existing fixture's own knobs, not from a new API**. |
| `renderProxy` | `() => true` | `(modelKey, fragId) => boolean`. `false` ⇒ the shared `viewer.impl.getRenderProxy` returns `undefined` for that fragment, so the **real** `CollisionWorld` raises its own `RenderProxyUnavailableError` and converts it to a `geometry-not-yet-available` diagnostic. The gate is the fixture's, the behaviour under test is production's. |
| `worldOptions` | `{}` | Spread into `CollisionWorld.fromViewer(viewer, {...})` — used only for the library's two documented injection points, `now` and `yieldToScheduler` (`CollisionWorld.js`: "test seam, forwarded to the constructor"). **The two must be injected together.** The library yields from `createCheckpointPort` only when `createFrameBudgetAccumulator({now})`'s `isDue()` is true, i.e. when `now() - lastCheckpointAt >= frameBudgetMs`; on a fixture this small a real clock may never reach that, so `worldOptions.now` must be a fake clock that advances past `frameBudgetMs` on every read. That makes "the n-th yield" a **counted, deterministic** event rather than a timing race — and every arm that installs the hook asserts it actually fired (`yields > 0`), because a hook that never fires turns the whole arm into a vacuous pass. |
| `register` | every `modelKey` | Which models the returned registry binds, so a model can be present in the world and absent from the run's bindings. |

  Returned additions: `setRenderProxyAvailable(modelKey, fragId, available)` (flips the gate between two runs — F4's geometry-readiness arm) alongside the existing `world`, `viewer`, `models`, `modelFor`, `enumerator`, `registry`. Plus the one recording seam, exported from `realWorld.mjs`: **`recordFindClashes(world) → {calls, restore()}`**, an own-property override on the instance that `await`s the real prototype method and pushes `{query, pairs, statistics}`. It must **not** be a substitute world object: `getWorldCoordinator(world)` and `assertRegistryBelongsToWorld` key on world identity, so a wrapper would either be rejected or silently create a second coordinator. **Two rules for every arm below:** the fixture never reaches a `_`-prefixed member of `CollisionWorld` (§19.1 applies to the tests too — `statistics.diagnostics`, `world.evictModel`, `world.dispose`, `world.getEpochCollisionInstanceCount` are all public), and nothing the engine does is simulated — the engine is always the real assembled `createClashTestEngine`.
  Verification for this step: `node --test test/clashtest/integration/differential.test.mjs` still green, and `test/clashtest/support.test.mjs` still green (the barrel's own test). **Expected failure mode if the defaults are not behaviour-preserving:** Steps 1–10 change their `pairSetDigest`, which is the signal that a new option leaked into the default fixture.

- [ ] **Step 12: F2 — mixed reachable/unreachable owner over the real world (AC-17 b, f).** New file `test/clashtest/integration/realWorldProvenance.test.mjs`. Two tests, written failing first.

  *Fixture (AC-17's owner classes, built entirely from `buildMockModel`'s documented knobs):* model `m` with tree `[{dbId: 100, children: [{dbId: 900, fragments: [1]}]}, {dbId: 200, fragments: [0]}]` and `fragments: {m: {fragmentCount: 4, ownerDbIdOverrides: new Map([[2, 900], [3, 950]])}}`. Fragment `2` is therefore **loaded, numeric-owned by `900`, and in no root subtree** ⇒ `900` is *mixed*; fragment `3` belongs to `950`, which owns nothing reachable ⇒ *unreachable-only*; `200` is *root-only*. Model `x` has one root `700` whose fragment overlaps `m`'s fragment `2` and **not** its fragment `1`, so the pair `900↔700` is one only the unreachable fragment can produce. **Why the fragIds are 0–3 and not the spec's 41/42/43:** `buildMockModel`'s whole-model walk enumerates `0 … fragmentCount-1`, and every in-range fragId the tree does not claim is itself a `fragment-owner-unresolvable` diagnostic — a gap from 0 to 41 would inject 40 unrelated diagnostics and caveat the arm for the wrong reason. AC-17 fixes the four owner **roles**, not the literal fragment numbers; the arm's comment says so.

  *Test `mixed-owner orientations over a real CollisionWorld (AC-17 b)`.* Run both orientations — `{A: {model m}, B: {model x}}` and `{A: {model x}, B: {model m}}` — and assert, per orientation: `ledger.unreachablePopulation` lists `m` with `mixedOwnerDbIds: [900]`; for **every** pair with `900` on either side, present in `results` *or* absent, `getPairStatus(set, pairId).verdict === 'covered-caveated'` with a `mixed-owner-provenance` caveat, and **never** `covered-clean`, **never** `not-required`; the retained `900↔700` result exists and carries `flags.mixedOwnerProvenance`; `950`'s pair is `not-required` with `flags.unreachableOwner` in the target orientation and unevaluated in the source orientation; every `200` pair is `covered-clean`; and `await engine.canClaimNoClashes(runId) === false` — the **engine-bound** path, since P5's standalone predicate is already T1-covered. Then assert the classification is stable: identical `ledgerDigest` across `broadPhase: 'tlas'` vs `'linear'` and across a reordered `selectionA`.
  **Negative control (mandatory).** The same fixture with fragment `2` moved *into* root `100`'s subtree, so `900` is root-only: no `mixedOwnerProvenance` flag anywhere, every `900` pair is `covered-clean`, `unreachablePopulation` is empty for `m`, and `canClaimNoClashes` is `true`. Without this arm the whole test passes on a build that marks every pair caveated.

  *Test `a mixed owner's library result is identical whichever of its fragments produced the hit (AC-17 f)`.* Two fixtures differing **only** in which fragId carries the overlapping geometry — `1` at position `P` and `2` far away, then `2` at position `P` and `1` far away — and one direct `world.findClashes({source: {model: m, dbIds: [900]}, target: {targets: [{model: x}]}, mode: 'volume-overlap', groupBy: 'dbId'})` against each. Because the geometry and its placement are identical, `assert.deepEqual(pairsA, pairsB)` is the assertion: the library's owner-level record is byte-identical and **no fragment identity is recoverable from it**. This is the documented library fact (F3) that makes §12.5 rule 6's taint conservative rather than precise.
  **Expected failure mode, and what it means:** if this ever fails, the library has started reporting fragment identity. That is a *spec* consequence (the taint could become precise), not a test to loosen — the arm's comment says so and points at §12.5 rule 6.

- [ ] **Step 13: F3 — diagnostic stress and the un-sliced negative control (AC-18 d).** Same file. One source model `s` (one root, one real fragment) and **six** target models `t1…t6`, each built so its whole-model extraction emits ~800 diagnostics with no geometry cost at all: its root owns fragIds `0…400` of which only `0` has geometry and `1…400` are in `notLoadedFragIds` (⇒ `fragment-not-loaded`), and `fragmentCount: 801` leaves `401…800` unclaimed (⇒ `fragment-owner-unresolvable`). ~4,800 diagnostics across the federation, and the run still does exactly one narrow-phase pair per target model — the reason this arm is affordable in `npm test`.

  *Test `sliced target fan-out bounds every call's diagnostic volume (AC-18 d)`.* `{maxTargetModelsPerUnit: 1, maxTargetFragmentsPerUnit: 1_000}` (above each model's own weight, so no unit becomes `not-run:target-too-large` — that conjunct is AC-18(b) and belongs to P3). With `recordFindClashes`, assert for **every** recorded call: `query.target.targets.length <= runOptions.maxTargetModelsPerUnit`, and the call's target fragment weight `<= maxTargetFragmentsPerUnit`. Then, per unit, partition the call's `statistics.diagnostics` on the library's own `scope` field:
  - `scope === 'fragment'` entries are deduped per fragment per call by the library, so their count must be `<= unit source weight + unit target weight` — the AC's "the unit's own (source + target) fragment weight";
  - `scope !== 'fragment'` entries are the library's **call-scoped budget** diagnostics; assert their count is `<=` the number of *distinct* call-scoped reasons in that call, i.e. bounded by the reason vocabulary and **not** proportional to fan-out — the AC's "plus the library's per-call budgets", pinned to something checkable instead of an absolute number the spec deliberately refuses to state;
  - the projection stays inside the per-outcome cap: each unit's projected diagnostic count `<= runOptions.maxDiagnosticsPerOutcome`, and the sealed `diagnostics.{total, countsByReason, omittedReasonOccurrences, truncated}` accounting is exact against the recorded raw totals.

  *Test `negative control: one un-sliced call receives the whole federation's diagnostic volume (AC-18 d)`.* The same fixture at the **ceilings** (`maxTargetModelsPerUnit: 64`, `maxTargetFragmentsPerUnit: 100_000`) so all six target models land in one unit: assert exactly one recorded `findClashes` call, and that its fragment-scoped diagnostic count is `>=` the sum of the six models' individual sliced counts — i.e. the fan-out the caps prevent, measured rather than asserted against an absolute bound (the spec is explicit that it states none). Finally assert the two arms produce the **same `pairSetDigest`**: changing only the target caps changes chunking, never coverage (AC-18 a, T2 half).
  **Expected failure mode:** if the sliced arm's per-call counts scale with the federation rather than the unit, the caps are not being applied before the first call — which is exactly the H2/§6.4 defect this AC exists to catch.

- [ ] **Step 14: F1 — cancellation mid-plan with an evaluated-subset comparison (AC-7 tail).** New file `test/clashtest/integration/realWorldEnvironment.test.mjs`. Test `a real-world run cancelled mid-plan has an evaluated subset identical to the uncancelled run (AC-7)`.

  *Seam:* the public `RunHandle#subscribe`. Subscribe, count `unit` events (the §9 event shape P6 owns), and call `handle.cancel()` from the **k-th** one, with `k` chosen so at least one unit has settled and at least two are still unstarted (`maxSourceDbIdsPerUnit: 1` over a 4-owner source model makes the unit count explicit and `k = 2` unambiguous). No timer, no wall clock. A control run of the **same** definition and options, uncancelled, in a fresh fixture.

  *Assertions.* The cancelled set: `outcome.status === 'cancelled'`, `coverage === 'partial'`, `done` **resolves** (never rejects), every unstarted unit is `not-run` with cause `cancelled`, and no `findClashes` call is recorded after the cancel (`recordFindClashes`). Then the subset comparison, which is the AC's actual content: for every `UnitRecord` whose `outcome === 'evaluated'` in the cancelled set, the pair-key set of `results.filter((r) => r.unitId === u.unitId)` equals the same `unitId`'s pair-key set in the control run. **Unit ids are comparable across the two runs only because of invariant P1** — `unitId` is `${cell}.${seq}` in canonical plan order, a pure function of (definition semantics, sorted enumerations, sizing options), all three identical here; the arm asserts the two plans agree on unit ids before comparing pairs, so a plan-determinism regression fails loudly instead of silently making the comparison vacuous.
  **Negative control (mandatory).** Assert the evaluated subset is a **non-empty strict subset**: `0 < evaluatedUnits.length < controlUnits.length`. Without it the test passes both when the cancel landed before any unit (empty subset, nothing compared) and when it landed after all of them (no cancellation actually exercised). Assert too that the control run is `completed` with `coverage: 'full'`.

- [ ] **Step 15: F4a — the dirty-world arm (AC-19 a).** Same file. Test `dirty world: an unrelated direct-caller admission changes only admissionBaseline (AC-19 a)`.

  *Seam:* a plain **direct** `world.findClashes` call, made by the test before the engine run — precisely the "another caller pre-populated the epoch bucket" situation §1.3.5 declares an environmental input. The definition covers owners `100`/`200` of models `a` and `b`; the priming call uses owner `300` of each, so it is genuinely *unrelated* (different source, different targets) while still admitting fragments into the **same** touched epochs. Capacity pressure is deliberately absent: the fixture's instance count is orders below `maxCollisionInstancesPerEpoch`, and the arm asserts no unit carries `capacity-exceeded` so that it cannot silently become the (b) arm, which is P4/P6's T1 property.

  *Assertions.* Fresh world vs primed world, same definition, same registered models, same options: identical `digests.pairSetDigest` **and** `digests.ledgerDigest`; `outcome.environmentSensitive === false` in **both**; and `provenance.admissionBaseline` **differs** between them (the primed run's `epochInstanceCount` is strictly greater for each touched `modelKey`) while contributing nothing to either digest. `expect: 'exact'` against `bruteForceReference` for both runs.
  **Negative control / expected failure mode.** Assert the priming call actually admitted something (`pairs` or `statistics` prove it ran, and the baselines differ) — an arm where the baseline happens to match proves nothing, and is a fixture bug rather than a pass. If a digest differs, epoch-cache state has leaked into a digested field, which is the exact H3 defect AC-19 was written for.

- [ ] **Step 16: F4b — the geometry-readiness arm (AC-19 e).** Same file. Test `geometry readiness: an unavailable render proxy is caveated, never silently missing (AC-19 e)`.

  *Seam:* `renderProxy` / `setRenderProxyAvailable` from Step 11. Run the same definition twice **in one world**: first with the needed fragment's proxy gated off, then with it on. Nothing about the model changes — fragment count, `isNotLoaded`, owner and `geometryId` are untouched — so **every scope digest is identical**, which is the whole point of the AC (a caveat that no scope check could have predicted). The gated fragment is given its **own** `geometryIndex`, because the library's geometry registry is keyed by `(loadEpoch, geometryIndex)`; a shared index would let a sibling's successful entry mask the miss. That the second run succeeds in the *same* world is itself the assertion that the transient path settled no persistent state (`collision/errors.js`: a `RenderProxyUnavailableError` "must settle NO persistent `GeometryRegistry` state").

  *Assertions.* First run: `diagnostics.geometryReadinessOccurrences >= 1`, a `geometry-not-yet-available` diagnostic naming that fragment, `outcome.environmentSensitiveCauses` contains `geometry-readiness`, `outcome.integrity === 'caveated'`, the affected element `covered-caveated` via `getElementStatus`, `canClaimNoClashes` false, **and** `await engine.getFreshness(runId)` is `current` — with the arm's comment stating the uncomfortable truth the spec insists on: `current` does not mean a rerun would match. Second run: finds the pair, `geometry-readiness` absent, `integrity: 'clean'`.
  *This is the arm the M2 oracle was rebuilt for.* The reference comes from a **separate clean fixture** (identical models, gate open), because a brute-force reference computed in the gated world would miss the same pair and the comparison would be circular. Then: `assertPairSets(run1, reference, {expect: 'correlated', caveatReasons: ['geometry-not-yet-available']})` — every differing pair must be `covered-caveated` for *that* reason, not merely accompanied by some global caveat — and `assertPairSets(run2, reference, {expect: 'exact'})`.
  **Negative control (mandatory).** A third run with the gate open from the start: `geometryReadinessOccurrences === 0`, `environmentSensitiveCauses` empty, `canClaimNoClashes` true. And the arm asserts the symmetric difference in run 1 is **exactly** the gated fragment's pair — one pair, not "at least one" — so a build that drops unrelated pairs fails here instead of being absorbed by the caveat.
  *Deferred conjunct:* AC-19(e)'s `compareResultSets` clause needs P8's comparison surface, which the core does not ship (`engine.compareResultSets === undefined`, asserted in Task P7.6). It is recorded as **deferred → P8** in the AC-19 row, not silently dropped, alongside the same clause of (b) and (d′) — those three are the **only** deferred AC-19 sub-conjuncts. AC-19 (a), which this file's Step 15 covers, and (b′), which Step 17a covers, contain no `compareResultSets` clause at all and are fully in-core.

- [ ] **Step 17: F5 — world disposal and model eviction mid-run (AC-21).** Same file. Two tests.

  *Scope, stated first so this arm does not drift into P6's matrix.* P6 `run/settlement.test.mjs` owns the §16.7 matrix over a fake world in every delivery order; that is the normative table. This arm proves only that the **real** `CollisionWorld` raises the two facts the matrix assumes — `WorldDisposedError` and `ModelEvictedError` — that they reach the seal through the assembled engine, and that the engine itself calls neither method. It asserts the matrix's prediction for the rows it triggers; it does not re-enumerate the matrix.

  *Test `model eviction mid-run settles the unit model-evicted and the engine never evicts or disposes (AC-21)`.* Seam: `worldOptions.{now, yieldToScheduler}` (the library's own documented injection points, paired as Step 11 requires so the yield is counted rather than timed) counts yields and calls `world.evictModel(fx.modelFor('b'))` on the n-th — a genuinely *mid-call* eviction, not a between-units one. The arm asserts the hook fired before asserting anything about the outcome. Assertions: the affected unit's primary `cause` is `model-evicted` with the matrix's outcome kind for that row, every other observed fact appears in `secondaryCauses`, the run's final `status` follows order B, `coverage: 'partial'`, `canClaimNoClashes` false, and every unit that evaluated in **both** this run and a quiet control run has identical pairs. Then the conformance half: wrap `evictModel`, `dispose` and `invalidateModelPlacement` with counting overrides and assert the recorded call count equals exactly the **test's own** calls — the engine adds none (AC-7's "never calls evict/dispose/invalidate", now proven against the real world rather than a fake).

  *Test `world disposal mid-run seals failed, and still failed with a cancel already pending (AC-21)`.* Two arms. (i) `world.dispose()` from the same yield hook during unit execution: the unit is `failed` with cause `world-disposed`, the run seals `failed`, `done` resolves with that summary rather than rejecting, and no further `findClashes` call is recorded. (ii) The planning-slice variant the AC names explicitly: with the **engine's** own `{now, yieldToScheduler}` (same pairing rule — P0's slicer yields on its own frame budget, so the engine's `now` is a fake advancing clock too; and the hook needs a mutable handle box, since it is supplied at construction while `handle` does not exist yet), call `handle.cancel()` and then `world.dispose()` inside the same planning slice — the run must seal **`failed`, not `cancelled`**, with `cancel-requested` present in `outcome.reasons`. Assert the `cancelled`-shaped outcome is *absent*, since "seals failed" is only meaningful against the outcome it outranks.
  **Expected failure mode:** a build that treats a disposed world as a cooperative cancellation seals `cancelled` here and silently under-reports a hard failure — the precedence inversion §16.7 order B exists to prevent.

- [ ] **Step 17a: F4c — equal `admissionBaseline`, different membership (AC-19 b′).** Same file. Test `equal admissionBaseline, different membership: the flag follows the outcome, not the baseline (AC-19 b′)`.

  *Why this arm exists and why it is T2.* Spec §22 AC-19 (b′) contains **no** `compareResultSets` conjunct, so — unlike (b), (d′) and (e) — it cannot be deferred to P8 on that ground; it is **closed in-core by owner order (2026-09-21)**, replacing the open disposition the H1 sweep recorded for it. It must be T2 (a real `CollisionWorld`) because the fact under test is a *library* fact the engine cannot fake: `admitCollisionInstances` admits on `currentSize + genuinely-new ids` (`collision/CollisionWorld.js`), so two buckets of **equal size** admit differently, and an injected `CapacityExceededError` (P4's T1 row) proves nothing about equal-count/different-membership because the count is then the test's own fiction.

  *No capacity-limit seam exists — verified.* `maxCollisionInstancesPerEpoch` is a module constant in `collision/constants.js` (`20_000`); `CollisionWorld.fromViewer` accepts only `narrowPhase`/`indexOwnership`/`now`/`yieldToScheduler`, and neither a query nor a `RunOption` can lower it (verified 2026-09-21 against `fromViewer`, `admitCollisionInstances` and §17.1's option lists). The arm therefore reaches the **real** ceiling, which is exactly the condition AC-19 (b) states for its own T2 form ("if ≥ 19,000 synthetic instances are practical"). **Nothing test-local is invented**: the arm uses only Step 11's existing `fragments` seam, a direct `world.findClashes` (F4a's own seam) and the public `world.getEpochCollisionInstanceCount`.

  *Why 20,000 instances are affordable — and what it is **not** claiming.* The bucket is filled by **extraction**, not by geometry: `admitCollisionInstances` runs after extraction and before the broad phase, and `_resolveGeometryView`/BVH work happens only for a narrow-phase **candidate pair**. Every filler fragment is therefore placed far from every priming source box, so each priming call forms **zero** candidate pairs and builds **no** geometry-registry entry and **no** BVH. What remains is still `O(fragment count)`, not one `Map` insert: per fragment the library does a world-matrix and world-bounds read with copied arrays, a geometry-identity and frozen extraction record, placement-table and representative-geometry bookkeeping, collision-instance staging and insertion, a linear broad-phase overlap test, and traversal/checkpoint overhead (`collision/viewer/ViewerModelAdapter.js`). A one-fragment source keeps each 19,980-fragment linear call far below `maxBroadPhaseInstancePairs` (1,000,000), and each filler owner stays under `maxFragmentsPerDbId` (5,000) and `maxChildrenPerNode` (10,000). **Affordability is therefore an inference until measured**, which is what the cost guard below exists for (2026-09-21 `codex-advisor` consult).

  *Fixture — three worlds, one model layout.* All three fixtures are built from the **same** generated `SPEC` for model `b`: twenty filler owners `901…920` of 999 far-away fragments each (19,980), one spare far-away owner `921` of 20 fragments, and the unit's own owner `200` of 20 fragments overlapping model `a`'s owner `100` (`fragments: {b: {fragmentCount: 20_020}}`). Model `a` carries owner `100` (the source) and a far-away owner `300` used only for priming. The definition is an **explicit** `dbIds` selection on both sides (`a:100` → `b:200`), never `kind:'model'`, so every scope digest covers only those two subtrees and is identical in all three worlds. Two direct priming calls per dirty world, each `{source: {model: a, dbIds: [300]}, target: {targets: [{model: b, dbIds: [...]}]}, mode: 'volume-overlap', broadPhase: 'linear'}`:
  - **fresh world:** no priming — `getEpochCollisionInstanceCount` for `b`'s epoch is `0`.
  - **world 1:** `[901…920]` (19,980) then `[200]` (20) ⇒ bucket **20,000**, and the unit's 20 ids are **in** it.
  - **world 2:** `[901…920]` (19,980) then `[921]` (20) ⇒ bucket **20,000**, and the unit's 20 ids are **not** in it.

  Both dirty worlds run the identical number and shape of priming calls, so their cost and their per-epoch counts match by construction; only *which* 20 ids the second call names differs. The run passes `{broadPhase: 'linear', maxSourceDbIdsPerUnit: 1}` — `'linear'` deliberately, because a cached TLAS is built from the **whole epoch's** placement table and would rebuild over all 20,000 primed records for no benefit here, while admission happens *before* the broad phase and is identical under either choice (all three runs use the same option, so the digest comparison is unaffected) — and leaves the target caps at their §17.1 defaults (`maxTargetFragmentsPerUnit` 20,000 ≥ 20, `maxTargetModelsPerUnit` 4 ≥ 1), so the definition is **exactly one unit** and `failure.capacityDetails.missing` is exactly 20. The *outcome* is robust to sizing regardless: the bucket sits **at** the limit, so any genuinely-new id at all overflows it and a differently-sized plan would change `missing` but never the verdict — the arm pins the unit count first so that the `deepEqual` on `capacityDetails` stays a fact rather than a coincidence. The arm asserts the counts through `world.getEpochCollisionInstanceCount` **before** `startRun` (`=== maxCollisionInstancesPerEpoch`, imported from `collision/constants.js` rather than hard-coded), so a fixture that drifted off the ceiling fails as a fixture bug instead of silently becoming F4a.

  *Assertions.* `provenance.admissionBaseline` is `deepEqual` between run 1 and run 2 (both `[{modelKey:'a', epochInstanceCount:1}, {modelKey:'b', epochInstanceCount:20_000}]` — `a`'s count is 1 in both because both priming calls share the same one-fragment source). Run 1: `status: 'completed'`, `coverage: 'full'`, `outcome.environmentSensitive === false`, `environmentSensitiveCauses` empty, **no** unit whose cause is `capacity-exceeded`, and `digests.pairSetDigest`/`digests.ledgerDigest` equal to the **fresh** world's run (the AC's "reproduces the fresh-world pair set and ledger") even though its baseline is `20_000` against the fresh run's `0` — the §13.1 exclusion of `admissionBaseline` from every digest. Run 2: the `a:100 → b:200` unit is `failed` with cause `capacity-exceeded`, `failure.capacityKind === 'bucket-capacity'`, `failure.capacityDetails` `deepEqual` `{currentSize: 20_000, missing: 20, limit: 20_000}` (and **no** `epoch`/`loadEpoch` key — §16.5), `environmentSensitiveCauses` `['bucket-capacity']`, `outcome.environmentSensitive === true`, `coverage: 'partial'`, `await engine.canClaimNoClashes(runId) === false`. The fresh run is held to `expect: 'exact'` against `bruteForceReference`; run 2 is **not** compared to a reference — the AC's own comparison conjunct is (b)'s, and (b′) asserts facts, not a diff.

  **Negative control (mandatory) — the actual point of (b′).** The arm builds the baseline-only oracle explicitly and shows it misclassifies: `const fromBaselineAlone = (set) => canonicalJson(set.provenance.admissionBaseline);` then `assert.equal(fromBaselineAlone(set1), fromBaselineAlone(set2))` **and** `assert.notEqual(set1.outcome.environmentSensitive, set2.outcome.environmentSensitive)`. Any predicate that is a function of the baseline alone therefore returns the same verdict for a clean run and for a capacity-failed run, i.e. it is wrong for one of them — which is why §1.3.5 calls the baseline an *observational witness, not a reproduction key*, and why the flag follows the **outcome**. Run 1 is the sharper half: its bucket sits **at** the limit (maximum apparent pressure) and it is still `environmentSensitive === false`. The arm's comment says all of this, and cites §1.3.5 (a) and R11-2.
  **Expected failure mode.** If run 1 fails on capacity, the priming call did not actually cache the unit's own fragment ids (a fixture bug — the arm's pre-`startRun` count assertion localizes it). If run 2 *passes* clean, the library has stopped admitting on membership, which is a spec consequence (the baseline would then be a reproduction key after all) and a reopen of §1.3.5, never a test to loosen. If run 1's digests differ from the fresh run's, epoch-cache state has leaked into a digested field — the H3 defect.
  **Cost guard.** Step 18 records this file's duration. The three 20,020-fragment fixtures and the 40,000 filler extractions are this file's dominant cost. **The arm keeps the real 20,000-instance ceiling unconditionally.** If its runtime exceeds the practical threshold — **~10 s** for the arm alone on the reference machine — that is **classified as a G-CAL calibration concern** and reported to the owner as a verification/calibration item (AC-19 (b)'s "if … practical" is a measurement, not an assumption); **it is never** resolved by weakening the arm, by shrinking the fixture to a smaller instance count, by introducing an injected-limit / lowered-`maxCollisionInstancesPerEpoch` variant (no such seam exists, and inventing one would make the ceiling the test's own fiction), or by silently dropping to a T1 injection, which cannot express (b′) at all. A slow arm is a number for G-CAL to calibrate against, not a licence to replace the test.

- [ ] **Step 17b: F6 — foreign placement contention over the real world (AC-19 d′ at T2).** Same file. Four tests. Spec §22 AC-19 (d′) states this arm "in T2"; the plan previously realized it only at T1 over fakes (P4 `localExecutor.errors`, P6 `run/progress` V17/V27). It is **closed in-core by owner order (2026-09-21)**, replacing the open disposition the H1 sweep recorded for it. **Scope, stated first:** P4 owns the outcome mapping and P6 owns the retry protocol over fakes; this arm proves only that the **real** `CollisionWorld` raises `ModelPlacementChangedError` for a *foreign* revision bump, that the engine's own `placementGeneration` stays put, and that the assembled engine's sealed set records `placement-contention`. It re-enumerates neither T1 table.

  *Seam — all public, nothing invented; and the bump must be a **growth** bump.* Spec §22 (d′) and §1.3.5 both name the foreign actor precisely: "a direct `findClashes` caller … that **grows** the placement state of a touched model bumps its placement revision" (§7.5's table row is "Foreign growth revision bump (another caller's extraction)"). `world.invalidateModelPlacement` bumps the same counter but is *explicit invalidation*, a different origin that also writes `_placementInvalidatedAtRevision` — so the primary arm induces real growth and the invalidation form is kept only as the extra discriminator test below (finding from the 2026-09-21 `codex-advisor` consult on this step; both origins verified in `collision/CollisionWorld.js`). Growth is produced by a **nested direct `world.findClashes`** made from inside the fixture's own `worldOptions.yieldToScheduler` hook, over a **spare** owner of the contended model that no planned unit touches: `_recordPlacement` inserts a genuinely new `fragmentId` for that epoch, sets `grew = true`, and bumps `_placementRevisionByEpoch`. The library explicitly does **not** serialize callers against each other (§7.3 rationale, F6/F13), so a concurrent direct call is the real scenario, not a contrivance. Mechanics, all of them already-sanctioned techniques in this file:
  - *Timing.* `worldOptions.{now, yieldToScheduler}` with Step 11's pairing rule (the fake `now` advances past `frameBudgetMs` on every read, so the yield is a counted event, not a timing race) and Step 17's **mutable box**, since the hook is supplied at `fromViewer` time while `fx`/`engine` do not exist yet.
  - *Re-entrancy.* The hook **disarms itself** around the nested call, so the nested query's own yields cannot recurse.
  - *One growth per outer call.* The arm wraps `world.findClashes` with the own-property override technique Step 11 sanctions for `recordFindClashes` (await the real method), pushing a call token on entry and popping it on exit; the hook grows at most once per token. Expected growths are therefore **exactly 4** — one during unit `b`'s call and one per attempt of unit `c` — out of a pool of **8** spare owners, and the arm asserts `growths === 4` **and** `growths < spares.length`, so "bumped on every attempt" is a fact rather than an artifact of a pool that ran dry.
  - *Why the growth is contention and not scope drift.* It grows the world's **placement table** with fragments the engine never planned; the `ElementEnumerator` tree is untouched, and both selections are **explicit `dbIds`** lists (never `kind:'model'`), so no root subtree and no population digest covers the spare owners and §16.3.2's pre/post checks stay `equal`. A whole-model selection here would legitimately produce `scope-drift` instead — the arm's comment says so, because that is the mistake a later editor would make.

  Three library facts the arm depends on, all verified in `collision/CollisionWorld.js`: (1) revision revalidation is armed **only** for `tlasConsultedEpochs`, "every distinct epoch among the query's own `targetsEntries`' models", and is **empty for a `broadPhase:'linear'` call** — so the run must pass `broadPhase: 'tlas'` and the growth must name a **target** model of the contended unit (the nested growth query itself uses `'linear'`, so it arms nothing and cannot abort itself); (2) `createCompositeCheckpointPort` re-asserts the revision *after* awaiting `yieldToScheduler`, and `_recordPlacement` compares before its own insertion, so the growth aborts the attempt at the next of those two points; (3) a growth in `c`'s epoch is invisible to unit `b`'s call — `b`'s armed map contains only `b`'s epoch, and the long-lived registry/`TlasCache` ports check disposal and epoch liveness, never placement revision. The arm asserts the **engine-owned** figure exactly (`failure.attempts === maxPlacementRetries + 1`) and never claims a hook-invocation count per attempt: one `yieldToScheduler` is shared by the per-call composite port and both long-lived ports, so that is not a contract.

  *Fixture.* One source model `a` (owner `100`, plus a far-away owner `399` used only as the nested growth query's target), two small target models `b` and `c` whose owner-`200` fragments overlap `a:100`, and on `c` **eight spare owners `391…398` of one far-away fragment each** — outside the definition, outside every digested subtree, and the fuel for the growth bumps. The definition selects `a:100` → `{b:200, c:200}`, all explicit `dbIds`; `{broadPhase: 'tlas', maxTargetModelsPerUnit: 1, maxPlacementRetries: 2}` gives exactly two units in canonical plan order (`b` then `c`). The hook grows **only `c`**, one spare per outer call, and the arm pins the two runs' unit ids before comparing anything, so a plan-order assumption cannot silently make the comparison vacuous. A **quiet** control run uses the same fixture with the hook disarmed.

  *Test `foreign placement contention: a direct-caller growth bump on every attempt exhausts maxPlacementRetries (AC-19 d′)`.* Assertions: the growth hook fired as designed (`growths === 4`, `growths < spares.length`) and `registry.bindingFor('c').placementGeneration` is the **same** value as before `startRun`; unit `c` is `failed` with cause `stale-placement` and `failure.attempts === 3` (`maxPlacementRetries + 1`); `outcome.environmentSensitiveCauses` contains `placement-contention` and `outcome.environmentSensitive === true`; `coverage: 'partial'`; `await engine.canClaimNoClashes(runId) === false`. Then the AC's comparison-free half: unit `b` is `evaluated` in **both** runs and, per `unitId`, the pair-key set of `results.filter((r) => r.unitId === u.unitId)` is equal across the contended and quiet runs — **unit ids are comparable only because of invariant P1**, so the arm asserts the two plans agree on unit ids first, exactly as Step 14 does. The quiet run is separately held to `expect: 'exact'` against `bruteForceReference` and asserted `completed`/`full`/`environmentSensitive === false`, so it is a trustworthy control rather than a second degraded run.
  **Negative control / vacuity guard (mandatory).** Assert the contended run has **both** at least one `evaluated` unit and at least one `stale-placement` gap (`0 < evaluated.length < quietEvaluated.length`) — without it the test passes when the bump aborted everything (nothing compared) and when it aborted nothing.

  *Test `a foreign growth bump that clears on a retry adds no cause and equals the quiet run (AC-19 d′)`.* A **single-unit** definition (target `c:200` only) and a spare pool of exactly **one**: attempt 1 aborts on the growth, attempt 2 has nothing left to grow and completes (`growths === 1` asserted). Assertions: the unit is `evaluated`; `environmentSensitiveCauses` is empty and `environmentSensitive === false`; `status: 'completed'`, `coverage: 'full'`; and **both** `pairSetDigest` and `ledgerDigest` equal the quiet run's — legal precisely because §13.1 excludes *attempt counts* from `ledgerDigest`, which the arm's comment cites. This is the AC's "a retry that succeeds adds no cause and equals the quiet result".

  *Test `a direct-caller invalidateModelPlacement is the same foreign fact as a growth bump (AC-19 d′)`.* The same single-unit fixture with **no** spare pool; the hook instead calls `world.invalidateModelPlacement(fx.modelFor('c'))` on every outer call. This is the second origin §7.5 folds into one row (explicit invalidation rather than another caller's extraction) and the plainest possible foreign actor: assert the same terminal facts as the first test (`failed:stale-placement`, `failure.attempts === 3`, `placement-contention`, `coverage: 'partial'`) and that `registry.bindingFor('c').placementGeneration` is unchanged. It exists so the next test's contrast is *exactly* one variable — the same world method, reached two ways. The arm notes that this form additionally records `_placementInvalidatedAtRevision` (arming the library's own staged placement refresh) and asserts nothing about that path; if a future library change made the refresh swallow the abort, this unit would come back `evaluated` and the arm fails loudly, which is the correct signal.

  *Test `negative control: a host-signalled placement change is discarded:input-changed, never placement-contention (AC-19 d′)`.* Same single-unit fixture, but the hook calls `engine.invalidateModelPlacement('c')` once — the §16.2 single call that bumps `placementGeneration` **first** and then calls the very same `world.invalidateModelPlacement` (P1.7), so the library raises the *same* `ModelPlacementChangedError` while the engine's generation has moved. Assertions: the unit is `discarded` with cause `input-changed`, **no** retry occurred (the unit ran once — `recordFindClashes` shows exactly one call for it), the run is `invalidated`, `placement-contention` is **absent** from `environmentSensitiveCauses`, and `registry.bindingFor('c').placementGeneration` has increased. This is the control that gives the other arms their meaning: paired with the test above it injects the **identical library call** and differs only in the engine-owned generation, so a build that classified every abort as contention passes the contention tests and fails here.
  **Expected failure mode.** If the first test's unit is `evaluated`, the bump never reached an armed epoch — almost always because the run used `broadPhase: 'linear'` (revalidation unarmed), the growth named a *source* model, or the spare pool ran dry; the arm's comment names all three and the `growths` assertions localize the third. If the first test yields `skipped:`/`discarded:scope-drift` instead of contention, the growth landed inside a digested subtree — use a spare owner outside every selection. If it yields `discarded:input-changed`, something in the arm touched the registry and the "foreign" premise is broken.

- [ ] **Step 18: Run the three integration files and the full suite.** `node --test test/clashtest/integration/differential.test.mjs test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs`, then `npm test`. Every arm must be green with no timer, no wall-clock threshold, no network and no Viewer (§21.3). Record the per-file totals **and each file's duration** — `realWorldEnvironment.test.mjs` now carries Step 17a's 20,000-instance arm, whose cost guard is that step's own (report it to the owner as a verification/calibration item rather than weakening the arm). Task P7.11's Step 2 quotes the totals as the master's Definition-of-Done item 4 evidence.
- [ ] **Step 19: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.9: AC-12 maximum-shape round trip (produce → persist → evict → read → validate → rerun)

Runnable **now** at provisional ceilings; frozen when G-CAL supplies numbers. The ceilings are parameters of the test, not literals in it.

**Files**
- Create: `test/clashtest/support/maximumShape.mjs`
- Test: `test/clashtest/integration/maximumShape.test.mjs`

**Interfaces**

*Consumes — **RECONCILED**:* P0 `options.js`: `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS`, `SCHEMA_MAX_NODES`, `BYTES_PER_NODE`, and **`worstCaseCapturedNodes(runOptions) → number`** — the §13.6 worst-case formula P0 already owns, so the harness restates none of its factors (`SCHEMA_NODE_FACTORS` is the table, also P0's). P0 exports **no** per-set node counter; the *measured* node count of a concrete set is `captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes` from P0 `util/capture.js`, wrapped once in `maximumShape.mjs` as the test-support helper `measuredNodes(set)`. Also P0 `producerReaderIssues(runOptions, limits)` / `assertProducerReaderInvariant(runOptions, limits)` for the R21-2 arithmetic. P5: `createInMemoryResultStore`, and `validateResultSet(set, {limits}) → {ok, issues}` (pure, synchronous) for the harness's direct shape checks.

*Produces:* `maximumShapeSet` and the harness. No production module changes.

**Steps**

- [ ] **Step 1: Write the failing producer/reader arithmetic test.** This one is pure arithmetic over the defaults and needs no run; it is the guard that makes the rest meaningful.

```js
// test/clashtest/integration/maximumShape.test.mjs (excerpt)
import { RUN_OPTION_DEFAULTS, ENGINE_LIMIT_DEFAULTS, SCHEMA_MAX_NODES, BYTES_PER_NODE,
         worstCaseCapturedNodes } from '../../../clashtest/options.js';

test('the shipped defaults satisfy the producer/reader invariant (§13.6)', () => {
  // The formula lives in P0 (single-defaults rule): the harness never restates its factors.
  const nodes = worstCaseCapturedNodes(RUN_OPTION_DEFAULTS);
  assert.ok(nodes <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes,
    `${nodes} > ${ENGINE_LIMIT_DEFAULTS.maxCapturedNodes}`);              // 15,685,536 ≤ 16,000,000 (A11; was 14,585,536)
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes * BYTES_PER_NODE
    <= ENGINE_LIMIT_DEFAULTS.maxStoredResultBytes);                        // 512,000,000 ≤ 536,870,912
  assert.ok(ENGINE_LIMIT_DEFAULTS.maxCapturedNodes <= SCHEMA_MAX_NODES);
});

test('options whose worst case exceeds the reader limits are rejected at startRun', () => {
  const engine = createClashTestEngine(base());
  const err = assert.throws(
    () => engine.startRun(validDef(), { maxResultsPerRun: 1_000_000, maxLedgerRecords: 20_000_000,
                                        maxPlanReferences: 10_000_000, maxUnitsPerRun: 100_000 }),
    InvalidOptionsError,
  );
  // `result-unreadable` is the error's REASON; the issue codes are the two P0 spellings.
  assert.equal(err.reason, 'result-unreadable');
  assert.ok(err.issues.some((i) => i.code === 'result-unreadable-nodes'
                                || i.code === 'result-unreadable-bytes'));
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/integration/maximumShape.test.mjs` → `worstCaseCapturedNodes` is not exported / no `result-unreadable` refusal is produced.
- [ ] **Step 3: Implement `maximumShapeSet` and the round trip at *configurable* ceilings.** The harness reads its shape from an environment-overridable table so a calibrated run needs no code edit:

```js
// test/clashtest/support/maximumShape.mjs
export const PROVISIONAL_SHAPES = {
  // A shape is "maximum" for a dimension; running all three at the true §17.1 defaults is minutes of
  // work, so the committed suite runs the SCALED tier and the calibration run overrides it.
  scaled:   { resultCount: 2_000, ledgerRecordCount: 20_000, diagnosticCount: 2_000 },
  ledger:   { resultCount: 100,   ledgerRecordCount: Number(process.env.CLASHTEST_MAX_LEDGER ?? 200_000), diagnosticCount: 100 },
  results:  { resultCount: Number(process.env.CLASHTEST_MAX_RESULTS ?? 100_000), ledgerRecordCount: 1_000, diagnosticCount: 100 },
};
```

  and the round trip itself:

```js
for (const [name, shape] of Object.entries(PROVISIONAL_SHAPES)) {
  test(`maximum-shape round trip: ${name}`, async () => {
    const resultStore = createInMemoryResultStore();
    const engine = createClashTestEngine({ ...base(), resultStore, limits: { maxResidentResultSets: 1 } });
    const set = maximumShapeSet(shape);
    const spans = [];
    // produce -- `measuredNodes` is maximumShape.mjs's one-line wrapper over P0's
    // captureData(set, {maxNodes: SCHEMA_MAX_NODES}).nodes; P0 ships no per-set counter.
    assert.ok(measuredNodes(set) <= ENGINE_LIMIT_DEFAULTS.maxCapturedNodes);
    // persist
    await resultStore.put(set);
    // evict
    engine.releaseResultSet(set.runId);
    assert.equal(engine.getRun(set.runId), null);
    // read + validate (measured, not asserted <= frameBudgetMs -- §17.3(b))
    const t0 = performance.now();
    const read = await engine.getResultSet(set.runId);
    spans.push({ label: 'capture+validate', ms: performance.now() - t0 });
    assert.equal(read.digests.pairSetDigest, set.digests.pairSetDigest);
    assert.ok(Object.isFrozen(read));
    // rerun
    const h = await engine.rerun(set.runId, {});
    assert.equal((await h.done).resultSet.derivedFromRunId, set.runId);
    // AC-12 (b): record, do not gate.
    console.log(`[AC-12] ${name}`, JSON.stringify({ shape, spans, nodes: measuredNodes(set) }));
  });
}
```

- [ ] **Step 4: Run it and see it pass.** `node --test test/clashtest/integration/maximumShape.test.mjs`.
- [ ] **Step 5: Add the reader-limit and corruption boundary cases.** A valid set read by an engine with a smaller `maxCapturedNodes` rejects `ResultSetTooLargeError` (never `CorruptResultSetError`); a set above `SCHEMA_MAX_NODES` is `CorruptResultSetError`; a store whose `get(runId, {maxBytes})` is called is asserted to receive `maxBytes === limits.maxStoredResultBytes`.
- [ ] **Step 6: Add the deterministic slicing assertions (AC-12(a)) — and NO wall-clock threshold.** With a `spanRecorder` and the support fake clock (`createFakeClock`, whose `yieldCount`/`onYield` count every yield) injected into the engine, assert at the `scaled` shape:
  1. **Yield/checkpoint occurrence.** Every **sliced** span label (`normalize`, `semanticDigest`, `plan`, `merge`, `digest`, `seal`, `validate-result-set`) is recorded, and each one **yielded at least once** — the clock's `yieldCount` strictly grows across the span, i.e. the slicer's `tick()` was consulted and returned a Promise at least once inside it.
  2. **Bounded work-item cadence per slice.** No slice runs more than the slicer's own ceilings before yielding: at most `checkEvery` (64) items pass between two clock reads and at most `limits.aggregationSliceMaxItems` items pass between two yields, and the **number of yields grows with the item count** — the same span, re-run over a deliberately small shape built inline from one tenth of `scaled`'s counts, yields strictly fewer times (the size-dependence lives in *how many* slices there are, never in the length of one slice).
  3. **Absence of size-dependent unsliced work.** The synchronous path records **no** `sort`/`dedup`/`normalize`/`digest` span — the existing spy, kept verbatim: nothing size-dependent may hide in it.
  4. **Spans are recorded, never gated.** Every span **duration** — the sliced labels above and the §17.3(b) capture/validation spans alike — is logged through the same `[AC-12]` record as Step 3 and compared against **nothing**. This step deliberately contains **no** timing pass/fail assertion and in particular never compares a span to `RUN_OPTION_DEFAULTS.frameBudgetMs`, which spec §17.1 declares provisional until G-CAL closes.

  **Why the wall-clock assertion is not here.** A `span ≤ frameBudgetMs` pass/fail in the functional core suite would depend on machine load and timer resolution — it could fail nondeterministically on a slow or busy machine, and a green run on one developer's laptop would be indistinguishable from AC-12 calibration evidence. The calibrated assertion (`span ≤ the product-confirmed frame budget`, run on a **calibrated environment profile**) therefore belongs to the **G-CAL work package**, which is also what freezes the number it would compare against. Until then the slicing *structure* above is what P7.9 proves, and the durations are G-CAL's input.
- [ ] **Step 7: Run it and see it pass.**
- [ ] **Step 8: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.10: Public exports, CHANGELOG, README, `clashtest/README.md`, handoff

**Files**
- Create: `clashtest/index.js`, `clashtest/README.md`
- Modify: `CHANGELOG.md`, `README.md`, `docs/handoffs/latest.md`
- Test: `test/clashtest/engine/exports.test.mjs`

**Interfaces**

*Consumes:* every phase's public names. *Produces:* the `clashtest/index.js` export surface listed in the Phase interface summary.

**Steps**

- [ ] **Step 1: Write the failing exports test.**

```js
// test/clashtest/engine/exports.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../../clashtest/index.js';
import * as errors from '../../../clashtest/errors.js';

const EXPECTED_FUNCTIONS = [
  'createClashTestEngine', 'validateTest', 'assessNoClashClaim', 'canClaimNoClashes',
  'getPairStatus', 'getElementStatus', 'getFreshness',
  'createInMemoryClashTestStore', 'createInMemoryResultStore',
  'createLocalUnitExecutor', 'createModelRegistry',
];

// Internal names that other tasks add to `clashtest/engine.js` as NAMED exports of that module and that
// this barrel must NOT re-export (Task P7.4 Step 3a support obligations 3 and 4):
const MUST_NOT_BE_PUBLIC = ['createStoredDefinitionResolver', 'withStoredDefinitionValidator'];

test('§18 names are all present, and the deferred and internal names are absent', () => {
  for (const name of EXPECTED_FUNCTIONS) assert.equal(typeof api[name], 'function', name);
  assert.ok(api.RUN_OPTION_DEFAULTS && api.ENGINE_LIMIT_DEFAULTS);
  // Deferred surfaces are ABSENT, not stubbed (see the phase file's Gates and open items):
  assert.equal(api.createDerivationContext, undefined);
  assert.equal(api.compareResultSets, undefined);
  // …and so are P7's own INTERNAL engine seams: they are named exports of `clashtest/engine.js`, so a
  // careless `export * from './engine.js'` in the barrel would publish them silently. Asserted by name
  // because the two checks above are presence/absence checks, not a closed-set comparison.
  for (const name of MUST_NOT_BE_PUBLIC) assert.equal(api[name], undefined, `${name} must stay internal`);
});

test('every error class of §18 that the core raises is exported from the entry point', () => {
  for (const [name, ctor] of Object.entries(errors)) {
    if (typeof ctor === 'function' && name.endsWith('Error')) assert.equal(api[name], ctor, name);
  }
});

test('the core engine object has no annotate and no derivations', () => {
  const engine = api.createClashTestEngine(base());
  assert.equal(engine.annotate, undefined);
  assert.equal(engine.derivations, undefined);
  assert.equal('annotate' in engine, false);
});

test('importing the entry point runs no side effect', async () => {
  const before = globalThis.THREE;
  await import('../../../clashtest/index.js?fresh=1');
  assert.equal(globalThis.THREE, before);
});
```

  **OPEN-3 is settled (controller ruling): the core engine ships WITHOUT `derivations` and WITHOUT `annotate`, and `exports.test.mjs` pins their absence.** P7 reserves no key for them and exposes no `isDisposed()` seam. The two assertions above are therefore *core-scoped*, not permanent: **Task P8.8 legitimately edits this test file** when it extends `createClashTestEngine`'s returned object with `derivations` and adds `createDerivationContext` to `clashtest/index.js`, and the annotation follow-up does the same for `annotate`. That is an authorized amendment of a P7-owned test by a later phase, recorded here so the P8 implementer does not read the pin as a prohibition — and so a reviewer does not read the edit as P8 weakening a P7 guarantee. Nothing else in `exports.test.mjs` may be relaxed by a later phase.
- [ ] **Step 2: Run it and see it fail.** `node --test test/clashtest/engine/exports.test.mjs`.
- [ ] **Step 3: Write `clashtest/index.js`.** A pure re-export, in the style of `collision/index.js`'s header comment: no side effects, no `globalThis` read, one `export {…} from` per owning module — never `export * from './engine.js'`, whose internal named exports (`createStoredDefinitionResolver`, `withStoredDefinitionValidator`; Task P7.4 Step 3a obligations 3 and 4) must not reach the barrel, as Step 1's test now asserts by name.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Write `clashtest/README.md`.** Sections: what the layer is; the six ports and which have reference implementations; the one-collision-mode-per-test rule; **"every cap in `options.js` is provisional until the AC-12 calibration gate (G-CAL) closes"**; what is deliberately absent from the core (annotation, derivations/compare, remote persistence, the Viewer adapter) and where each lives; a pointer to the spec and this plan.
- [ ] **Step 6: Add the CHANGELOG entry.** Under the current unreleased heading, matching the file's existing style: the additive `clashtest/` core engine, that `collision/` is unchanged, that `npm test` gains T1/T2 suites and stays credential-free, and that every default is provisional pending G-CAL.
- [ ] **Step 7: Add the README pointer.** One line in the existing module/architecture list pointing at `clashtest/README.md` and the design spec — no restatement of either.
- [ ] **Step 8: Update `docs/handoffs/latest.md`** from verified repository state, per project CLAUDE.md: branch, HEAD, working-tree state, milestone/task context, governing spec/plan, unresolved/deferred work (the Gates and open items below plus the Task P7.1 reconciliation record), suggested next action.
- [ ] **Step 9: Run the full suite.** `npm test`.
- [ ] **Step 10: Checkpoint commit (only if the user has authorized commits).** Do not create a commit *solely* because the handoff was updated (project CLAUDE.md).

---

### Task P7.11: Core acceptance run

**Files**
- Modify: `docs/handoffs/latest.md` (final state only)
- Test: no new test file — this task *runs* the suites and checks the traceability table below against reality.

**Interfaces**

*Consumes:* every phase's acceptance checklist. *Produces:* the recorded acceptance evidence.

**Steps**

- [ ] **Step 1: Run the full suite from a clean checkout.** `npm test`. Record the exact totals (`# pass`, `# fail`, `# skipped`) and the duration. Requirement: zero failures, no server, no APS credentials, no network (§21.3).
- [ ] **Step 2: Run the two named property/differential suites individually and record their output.**
  - `node --test test/clashtest/planning/planner.property.test.mjs` (P3's seeded exact-cover property suite — master DoD item 5. This is the file P3's *Verification / acceptance* names; the earlier `planning/exactCover.property.test.mjs` here was a plan-internal name no task ever created — 2026-09-21 H1 sweep)
  - `node --test test/clashtest/integration/differential.test.mjs` (master DoD item 4)
  - `node --test test/clashtest/integration/realWorldProvenance.test.mjs test/clashtest/integration/realWorldEnvironment.test.mjs` (the six real-`CollisionWorld` integration families of Task P7.8 Steps 11–19 — the T2 acceptance evidence for AC-7, AC-17 b/f, AC-18 d, AC-19 a/b′/d′/e and AC-21). **Record separately from the differential file**: DoD item 4 is the differential oracle only, while these two files are what the AC rows above point at, and Step 3's walk fails if either is missing.
- [ ] **Step 3: Walk the AC traceability table — mechanically, in three passes.** The table's *Citation conventions* exist so that passes (a) and (b) are `grep`, not judgement.

  **(a) Every cited path exists on disk.** Extract every path the table cites and check it against the repository:

  ```sh
  sed -n '/^## AC traceability/,/^## Verification/p' \
      docs/superpowers/plans/federated-clash-test-core/p7-engine-integration.md \
    | grep -o '[A-Za-z0-9_./-]*\.test\.mjs' | sed 's#^test/clashtest/##' | sort -u \
    | while read -r p; do [ -f "test/clashtest/$p" ] || echo "MISSING FILE: $p"; done
  ```

  Zero output is the pass condition. A miss is a **plan defect**, never a deferral.

  **(b) Every cited path is owned by the phase the table attributes it to.** For each cited path, the nearest `P<n>` marker to its left on the same row must name the phase whose *File structure* table creates it (convention 2). The same extraction, checked against the phase files, catches a path attributed to the wrong owner:

  ```sh
  grep -n 'Create' docs/superpowers/plans/federated-clash-test-core/p*.md \
    | grep -o 'p[0-8][^:]*:.*[A-Za-z0-9_./-]*\.test\.mjs'
  ```

  Compare the two lists. This is exactly the check that finding **H1** failed in the 2026-09-20 revision: 27 of 61 citations named a file no task creates, and 4 more named the wrong owning phase.

  **(c) Every cited assertion exists and passed.** For a `::<title>` citation, the title must appear verbatim in that file and in Step 1's passing output. For a lower-phase verification-row id (a P2/P4 check number, a P3/P5 bullet, a P6 `V<n>`), that row's command must appear in Step 1's output with zero failures.

  A row whose file, owner or named assertion does not check out is a **plan defect**: it is recorded and the owning phase is reopened, never silently reclassified as deferred. A conjunct that no named test covers is likewise recorded in the table's *Deferred*/*Gated* cell with its disposition. **Exception, by name — the AC-16 `migration-failed` deferral is ACCEPTED by this walk and is NOT a plan defect.** The owner dispositioned it on 2026-09-21 as a recorded, accepted, non-blocking deferral (master §6 line (e), master §8; Task P7.4 Step 3a), so for the AC-16 row Step 3 confirms only that (a) Step 3a's **reachable** arms (`definition-invalid`, `schema-unsupported`, and the `schemaVersion: 0` boundary) are present and passing, and (b) the `PLANNING_CAUSES.includes('migration-failed')` reserved-member assertion is present and passing. Step 3 must **not** require a passing `migration-failed` arm, must **not** treat the deferred clauses (iii)/(iv) as an uncovered conjunct, and must **not** treat this row as blocking P7.11 acceptance or G-PLAN. What *would* be a plan defect in this row: a missing reachable arm, a missing reserved-member assertion, a `migration-failed` arm faked through an invented `definitionMigrations` option or sentinel error, or a reappearance of "needs owner confirmation"/"STILL OPEN" wording in its cell. The two conjuncts the H1 sweep found uncovered — AC-19 (b′) and the AC-19 (d′) T2 arm — were **closed in-core by owner order (2026-09-21)** as Task P7.8 Steps 17a and 17b, so Step 3 now confirms the AC-19 row cites those named tests and that its *Deferred* cell claims **only** the `compareResultSets` sub-conjuncts of (b), (d′) and (e) → P8; a reappearance of "needs owner confirmation" in that cell, or a cited test name missing from Step 17a/17b, is a plan defect.
- [ ] **Step 4: Walk the master's Definition of Done (§5) as a checklist.**

| DoD item | Evidence |
|---|---|
| 1. P0–P7 phase acceptance checklists pass | each phase file's final checklist, signed |
| 2. `npm test` green, clean checkout, no credentials/network | Step 1 output |
| 3. Every in-scope §22 AC mapped to a passing named test; excluded ACs listed with owner | the AC traceability table below + Step 3 |
| 4. Differential suite equals brute force for four modes × four selections | Step 2 output, first command (`differential.test.mjs`). The six real-world integration families are **additional** T2 acceptance evidence, not part of this DoD item — Step 2's second command, and the AC-7/17/18/19/21 rows below |
| 5. Coverage exact-cover property test passes | Step 2 output |
| 6. `docs/handoffs/latest.md`, `CHANGELOG.md`, README pointer updated | Task P7.10 |

- [ ] **Step 5: Record branch, HEAD, exact verification results and final `git status`** in the handoff, per project CLAUDE.md "Before declaring a substantial task complete".
- [ ] **Step 6: Mark the core ready for the independent review gate** in `docs/handoffs/latest.md` (project CLAUDE.md internal-review-loop section). The internal Codex review is not the final acceptance gate.
- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).**

---

## AC traceability (spec §22)

Every AC-n → where it is satisfied. **In core** = a named test in P0–P7 that `npm test` runs. **Deferred** = an excluded work package (master §1.2) with a named owner. **Gated** = present but its *values* or *evidence* wait on a gate (master §4).

**Citation conventions (so Task P7.11 Step 3 is mechanical, not a reading exercise).** This table was regenerated on **2026-09-21** from each phase's own *File structure* `Create` inventory and its own *Verification / acceptance* rows, after the independent plan review's finding **H1**. The sweep checked all 61 citations mechanically: **27 named a file no task creates** (24 distinct paths) and **4 more named the wrong owning phase**; the regenerated table's 94 citations all resolve.

1. **Every path is relative to `test/clashtest/`** and is the exact file some phase's *File structure* table creates.
2. **Every path is immediately preceded by its owning phase marker** (`P0` … `P7`). Nothing between a marker and the path it owns, so `\bP[0-7]\b` before a path is always that path's owner — the H1 sweep found four citations whose nearest preceding marker named the wrong phase.
3. **The named assertion** is either a P7 test title written `::<title>` exactly as the task step writes it, or — for a lower phase — the owning phase's own verification-row id, which names the assertions: a P2/P4 check number, a P3/P5 `node --test` bullet, or a P6 `V<n>` row. A parenthetical without such an id is a description, not a citation, and Step 3 treats it as a plan defect.
4. **No row may claim coverage that no task's steps specify.** Where a §22 conjunct has no named test anywhere, it is written into the *Deferred* or *Gated* cell as an explicit open disposition — never omitted, never silently folded into a neighbouring citation.

| AC | Tier | In core: test file :: test name | Deferred (owner) | Gated |
|---|---|---|---|---|
| AC-1 definition validation, options, store, tombstone | T1 | P2 `definition/validate.test.mjs` (the V1–V6 matrix, `maxValidationIssues` + `issuesTruncated`, the distinct newer-`schemaVersion` rejection — P2 check 2), P2 `definition/normalize.test.mjs` (the seven golden canonical-JSON/`semanticDigest` vectors and the selection-swap pair — check 3), P2 `definition/capture-stability.test.mjs` (capture at the boundary, R11-1: mutation right after return and from a `yieldToScheduler` hook — check 4), P2 `definition/reference.test.mjs` (`classifyStartRunArgument`, R21-I3 — check 1), P2 `stores/InMemoryClashTestStore.test.mjs` (revisioning, archive, delete/tombstone, linearizability — check 5), P2 `stores/clashTestStore.listing.test.mjs` (`resolveForRun`'s four statuses and the `list` contract — check 6), P2 `definition/operations.test.mjs` (`validateTest`/`saveTest` accept and reject identically, `StoreNotConfiguredError` — check 7), P0 `options.test.mjs` (§17.1.1 validation: unknown keys rejected, no coercion, finite-integer rule, `InvalidOptionsError{issues}`) and P0 `options.defaults.test.mjs` (§17.1/§17.1.1 provisional-defaults conformance and the §13.6 producer/reader invariant), **P7 `engine/deleteTest.tombstone.test.mjs::deleteTest tombstones the result store BEFORE…` and the NH3 bypass paths (a)–(f)** | — | — |
| AC-2 exact cover, hierarchy, scope-digest conformance, tree-unreachable, unresolved selections | T1 | P3 `planning/decompose.test.mjs` (the four cells, exact cover against a brute-force `P` for unordered and ordered modes, same-model disjointness F2, canonical emission order), P3 `planning/planner.property.test.mjs` (200 seeded cases × 2 modes: exact-cover equality with the brute-force reference and no pair covered twice — master DoD 5), P3 `planning/rootResolution.test.mjs` (`hierarchy-overlap` with the first 20 offenders and no units, tree-unreachable population, `unresolvedSelections`, `owner-mapping-mismatch`, three-answer agreement), P3 `planning/scopeDigest.test.mjs` (every digest mutation class, the `equal`/`mismatch`/`unverifiable` comparator, and `checkScopeBracket` — reconciliation D1), P3 `planning/planner.test.mjs` (`scopeExpect` per selection kind incl. R20-1, `plan-too-large`, units holding ranges only) | — | — |
| AC-3 executor port conformance, outcome validation, overflow, library-call conformance | T1 | P4 `execution/unitOutcome.validate.test.mjs` (the 35-row `validateUnitOutcome` rejection battery and the never-throws guarantee — P4 check 8), P4 `execution/diagnostics.overflow.test.mjs` (§7.1 H7.2: an over-cap array is never iterated, the marker crosses instead, exact totals — checks 5–6), P4 `execution/diagnostics.projection.test.mjs` (illegal diagnostics **rejected**, never collapsed — check 4), P4 `execution/localExecutor.call.test.mjs` (the `targets`/`groupBy: 'dbId'`/one-mode call shape, F3 verbatim pair order, F4 `structuredClone` safety — checks 9–11), P4 `execution/localExecutor.errors.test.mjs` (every §7.5 taxonomy row incl. the plain-`Error` linear ceiling and a non-`Error` throw — check 12), P4 `execution/localExecutor.realWorld.test.mjs` (**T2**: a real-`CollisionWorld` evaluated outcome, the pinned linear-ceiling matcher, `LIBRARY_STATISTICS_KEYS` drift — checks 13–15), P4 `execution/localExecutor.scope.test.mjs` (the lease gate and the bracketed scope-digest protocol — check 16); **P7 `integration/differential.test.mjs::library-call conformance` (Task P7.8 Step 8)** | — | — |
| AC-4 partition and broad-phase independence | T2 | **P7 `integration/differential.test.mjs::partition and broad-phase independence (AC-4)` + `::negative control: a naive whole-set-vs-itself…`** | — | — |
| AC-5 single-query equivalence | T2 | **P7 `integration/differential.test.mjs::differential: whole-model target, volume-overlap` / `…, clearance` (the `\|A\|=1` arm)** | — | — |
| AC-6 determinism | T2 + T3 | **P7 `integration/differential.test.mjs::determinism, 10 runs, same world / fresh worlds` (T2, `environmentSensitive === false` only)** | T3 reload arm → Viewer-adapter live evidence (never in `npm test`, §22 tier note) | G-OQ4 for the T3 arm |
| AC-7 cancellation | T1 + T2 | P6 `run/lifecycle.test.mjs` (the four §10.2 cancel rows — V5; cancel while the definition lookup never settles **and** cancel while queued behind another run, both bounding `cancel()`/`done` and both sealing a pre-resolution cancelled set — V6 with V26's real-sealing proof, controller ruling R5; idempotent cancel, first reason wins, and **no** destructive `evictModel`/`dispose`/`invalidateModelPlacement` call — V10; the exactly-once terminal `state` event before `done` — V13), P6 `run/coordinator.test.mjs` (`cancelQueued`'s single-winner boolean — V4); **P7 `engine/startRun.test.mjs::cancelling a QUEUED run settles done with a pre-resolution cancelled set (R5)` (the engine-level half: `done` settles rather than hanging) and `integration/realWorldEnvironment.test.mjs::a real-world run cancelled mid-plan has an evaluated subset identical to the uncancelled run (AC-7)` (P7.8 Step 14: cancel fired from the k-th `unit` event, per-`unitId` pair-set equality against an uncancelled control, and the non-empty-strict-subset guard that stops the comparison passing vacuously)** | — | — |
| AC-8 engine-bound claim, source-population bracket, read-time freshness bracket, lifecycle | T1 + T2 | P6 `run/freshness.test.mjs` (two scope passes between three registry snapshots, a change landing during pass₂ caught only by snapshot₃, ruling R9's "completed **before** snapshot₁ is `stale`", the `{state, reasons}` shape P5's claim helpers accept, and the documented OQ-19 A→B→A limit — V22–V25), P6 `run/lifecycle.test.mjs` (run-start leases taken from P1's **frozen** snapshot bindings, ruling R7 — V7), P3 `planning/scopeDigest.test.mjs` (`checkScopeBracket`, the single bracket owner — D1), P3 `planning/planner.test.mjs` (the R20-1 `scopeExpect` rule the bracket compares against), P5 `results/claim.test.mjs` (the conjunct-by-conjunct claim truth table with a **required** `currentFreshness`); **P7 `engine/claim.test.mjs::engine-bound claim uses LIVE freshness, never the sealed value`, `::an unknown digestVersion is never claimable through the ENGINE-bound path` (the claim predicate owns the digest-version rule, not freshness — P5 re-verification finding 2) and the shared-registry / cross-engine-invalidation cases of P7 `engine/construction.test.mjs`** | — | G-OQ17 (host placement-invalidation ownership; core tests the engine side) |
| AC-9 progress | T1 | P6 `run/progress.test.mjs` (monotonicity across a split with `pairSpaceTotal` conserved and `unitsTotal` +1 — V14; nested runtime splits staying inside `maxUnitsPerRun`/`maxLedgerRecords` with the right `capDetail` — V15; a preplanned `target-too-large` gap adopted at plan completion — V16; the emitter throttle, listener isolation and `listenerErrors` — V19; split descendants ranked — V30), P3 `planning/splitting.test.mjs` (the four-step split order, `${unitId}.0`/`.1` ids, children's weights partitioning the parent's exactly, ruling R8's refusal vocabulary and its "a refused split records **nothing**"), P3 `planning/ledger.exhaustion.test.mjs` (the split record classes: the parent flips to `kind:'split'`/`outcome:'split'` and `pairSpaceTotal` sums over **leaf** units only) | — | — |
| AC-10 diagnostics and completeness | T1 + T2 | P4 `execution/diagnostics.predicate.test.mjs` (the §12.3 table-driven completeness predicate over every known reason, unknown fails safe, and the `collision/` known-reason drift guard — P4 checks 1–2), P4 `execution/diagnostics.projection.test.mjs` (attribution classes incl. `dbId: null` and an ambiguous `modelId ⇒ null` — the **unattributable** rule — check 3), P4 `execution/diagnostics.taints.test.mjs` (the §12.2.1 per-unit taint table and both collapse triggers — check 7), P4 `execution/diagnostics.aggregate.test.mjs` (§12.4 cross-unit de-duplication, the unit-id cap, a null `modelKey` never merged, the Σ invariant, §12.6 statistics — check 17), P4 `execution/localExecutor.realWorld.test.mjs` (**T2**: real unattributable `dbId: null` diagnostics from the real library — check 13), P5 `results/claim.test.mjs` (every axis × terminal status), P5 `results/resultSet.outcome.test.mjs` (`integrity` derived from the diagnostics upper bound) | the `compareResultSets` conjuncts (`resolved`, `addedUnverifiedBase`, `removedUnverifiedNext`) → **P8** | — |
| AC-11 serialization and persistence | T1 + T2 | P5 `results/resultSet.seal.test.mjs` (deep freeze, structured-clone/JSON semantic equality, digest scope and stability, sealed exactly once — incl. **`::the per-root cls marker IS digested (R2: it is schema, not decoration)`**, which pins spec **A9**'s `ledgerDigest` coverage of `rootOwners` incl. `cls` and that `pairSetDigest` is unchanged by it), P5 `results/validateResultSet.capture.test.mjs` (capture-first detachment, `schemaVersion` classified first, migration admissibility as a **range check** and the single-hop dispatcher — the schema-evolution conjunct), P5 `results/validateResultSet.invariants.test.mjs` (the generated structural-schema suite with one mutation per violation class per reachable field, every cross-field rule row, a tampered digest — incl. **`::each corruption is rejected with its own code, even when digests are recomputed consistently`**, whose two `root-cls-invalid` rows make a `rootOwners` row with an **absent** or **invalid** `cls` corrupt, per spec **A9**), P5 `results/InMemoryResultStore.test.mjs` (create-only atomic `put`, the all-or-nothing identity index, keyset listing and cursor validation, the non-materializing byte guard, tombstone reservation), P5 `results/residency.test.mjs` (the persistence attempt state machine: ambiguous ⇒ `failed`+`ambiguous`, idempotent `retryPersist`), P5 `results/roundTrip.test.mjs` (produce → persist → evict → read → validate with an identical claim outcome for all five terminal shapes), P6 `run/lifecycle.test.mjs` (`done` resolving once and never rejecting, the `{state:'pending', timedOut:true}` timeout, `persisted` with no timer, the attempt running through `residency.beginPersist` — V11; a seal-path failure still settling `done` once — V12; `admitSealedSet` atomicity on both throw sides — V33); **P7 `engine/rerun.test.mjs` (the R21-1 `rerun` contract, and `::rerun lineage survives the RunSpec…` for the sealed `derivedFromRunId` — P6 re-verification finding 7), P7 `engine/residency.test.mjs` (dispose with a hung write), P7 `integration/maximumShape.test.mjs` (R21-2 producer/reader invariant)** | the ambiguous-commit reconciliation conjuncts (R16-3, R18-2 `reconcileTimeoutMs`, R19-3 post-dispose ambiguity) → **remote-persistence follow-up**; P5 keeps the typed `PersistenceOutcomeUnknownError` and its port-conformance case | G-REMOTE |
| AC-12 memory and span ceilings | T1/T2 gating + T3 characterization | **P7 `integration/maximumShape.test.mjs` (round trip at configurable ceilings; deterministic slicing assertions — yield/checkpoint occurrence, bounded per-slice cadence, no size-dependent unsliced work; every span duration **recorded, none gated on wall clock**)**, P6 `run/progress.test.mjs` (one unit in flight, inter-unit yields counted, no synchronous span over `sliceBudgetMs` — V19, the AC-12 (a) run-loop span classes only) | T3 Audubon characterization (unit count, makespan, frame gaps, `retentionReport` growth) → Viewer-adapter/performance harness, `test/performance/results/` | **G-CAL** — the ceilings the harness runs at are provisional; G-CAL freezes them and the harness reruns unchanged. **The calibrated wall-clock assertion (`span ≤ frame budget` on a calibrated environment profile) is G-CAL's, not P7.9's** |
| AC-13 grouping, filters, facets, annotation lifecycle | T1 | — | **P8** (grouping/filter/facet/derivation-context parts) and the **annotation follow-up** (`ElementAttributeSource`, `annotate`, `AnnotationBusyError`, snapshot compatibility) | — |
| AC-14 comparison | T1 | — | **P8** (`compareResultSets`, pair-semantics gate, tolerance boundaries, `identityConflicts` classification) | — |
| AC-15 live acceptance on the Audubon fixture | T3 | — | **Viewer-adapter live evidence** (`test/acceptance/clash-test.acceptance.mjs`; never part of `npm test`) | G-OQ4, G-OQ1, G-OQ16 (the (b) arm records the counts OQ-16 needs) |
| AC-16 resident bound and identity enforcement | T1 | P5 `results/residency.test.mjs` (slot property test, classes, LRU, `ResultCapacityError`), P1 `identity/ModelRegistry.register.test.mjs` (`ModelBindingError` for a missing `modelVersion`, `ModelKeyVersionConflictError` including after `unregister`, `bindingGeneration` bumped by a reload of unchanged content), P1 `identity/ids.resultId.test.mjs` (distinct `modelKey`s over identical dbIds ⇒ distinct `ResultId`s), P5 `results/InMemoryResultStore.test.mjs` (`IdentityConflictError` when a `put`'s `models[]` remaps an accepted `modelKey`), P3 `planning/ledger.budget.test.mjs` (`planRecords ≤ maxPlanReferences` always, the reserve consumed in place, atomic runtime refusal) and P3 `planning/ledger.exhaustion.test.mjs` (the **combined ledger ceiling** over every runtime record class, `taint-overflow` always admitted, a no-longer-fitting split refused with `capDetail` `ledger-records`/`unit-records`, `budgetExhausted` + the first refusing unit id), P0 `options.test.mjs` (the cross-field rule rejecting `maxLedgerRecords < maxPlanReferences + 2 × maxUnitsPerRun`), P6 `run/coordinator.test.mjs` (two module copies over one world sharing one coordinator and one registry; an incompatible `protocolVersion` throws — V3); **P7 `engine/residency.test.mjs` (nonresident-id table, `DisposeSummary`, hung-write slot exhaustion, and the four disposal signal-then-wait cases — `::dispose signals first and waits second: a blocked in-flight unit DRAINS…`, `::dispose seals a QUEUED run…`, `::dispose forces a hung write's terminal event…`, `::concurrent dispose calls share one promise…` — which together close P6 re-verification finding 3, bounding every engine-owned wait while keeping §10.1's drain of an in-flight unit) and P7 `engine/startRun.test.mjs` (synchronous `ResultCapacityError` on both overloads; and the §5.5 **stored-reference admission** arms of Task P7.4 Step 3a — `::a store-returned definition that fails validation seals failed with definition: null and no offending value`, covering the **reachable** causes `definition-invalid` and `schema-unsupported` plus the `schemaVersion: 0` boundary arm that pins a non-newer version as `definition-invalid` rather than `migration-failed`, each arm's sealed ledger asserted as the **exact** closed row `[{phase:'queued', cause}]` (not a containment check, so a failure that recorded two causes fails the test) with the two reachable observed causes proven distinct and `definition-invalid`/`schema-unsupported`/`migration-failed` proven pairwise-distinct **positions in P3's `PLANNING_CAUSES`**, fail-closed **before** planning or collision execution (enumerator and world `calls` both empty, no unit record), `definition: null` / `testRef.semanticDigest: null`, `persistence.state === 'saved'` with a non-null `resultStore.get(runId)` proven **before** the scan so an unpersisted set cannot pass vacuously, and a deep scan of both the sealed set **and** the persisted copy finding neither a planted offending-value sentinel nor any `path`/issue-code field-level detail (owner disposition **A1**), and the admitted slot becoming an ordinary resident set; plus, for the §5.5 scan bound, **three** tests whose claims are stated here exactly as narrowly as each one proves them: `::the engine resolver hands its RESOLVED maxValidationIssues to the definition validator` (a spy `validate` proves the stored-definition **resolver**, constructed directly, hands the validator the **resolved** limits object it was given — a factory-level claim only, not evidence about what `createClashTestEngine` builds); `::a stored definition with vastly more invalid entries than maxValidationIssues is bounded at the resolver and fails closed` (the real `captureAndValidate` through that resolver yields exactly `maxValidationIssues` issues with `issuesTruncated`, `planningCauseOf` returns the bare cause string, and the engine end-to-end still seals the exact gap with no sentinel — the end-to-end arm claims the **cause and the absence of detail**, not the limit value, since a `definition-invalid` seal would also follow from an inline validator at the default limit); and, closing exactly that gap, `::createClashTestEngine builds its stored-definition resolver with the engine effectiveLimits` (a spy installed by the internal, non-barrel `withStoredDefinitionValidator(validate, fn)` seam around a **public `createClashTestEngine`** call observes, during a **real `startRun`**, that the resolver **the engine itself constructed** was handed `resolveEngineLimits({maxValidationIssues: 5})` by value — `maxValidationIssues: 5`, not `ENGINE_LIMIT_DEFAULTS`' 100 — so an engine that kept an inline default-limit validator fails this test). All three assert the bound through the engine's own wiring, never through wall-clock, never through a standalone `validateTest` call, and **not** through a read/visit counter on the stored entries — P2's pass is capture-first and P0's capture is descriptor-based and getter-free, so capture reads every structurally legal entry at any limit and the limit-sensitive stop runs over the detached copy (Step 3a states the citation). The two seams these tests reach — `createStoredDefinitionResolver` and `withStoredDefinitionValidator` — are **internal** named exports of `clashtest/engine.js` that `clashtest/index.js` does not re-export, an absence Task P7.10's public-surface test now pins **by name**; the engine itself still has **exactly one constructor**, `createClashTestEngine`, so no public API, no second entry point, no new module and no migration seam is added. Added by the 2026-09-21 H1 sweep, which found this conjunct mapped to a P2 store-reference test file that no phase creates, and to P2 itself, although P2.8 assigns these causes to the engine's run-admission path)** | the `annotate`-beyond-limits conjunct → **annotation follow-up**. **RESOLVED — owner disposition A1 (2026-09-21, "Option 2"):** the sub-conjunct "at most 20 `{path, code}` issues **recorded**" is **withdrawn** by an owner-authorized spec amendment (spec errata row **A1**; register entry **S-P7-5**). P5's sealed `PlanningGap` stays the closed pair `{phase, cause}` and is **not** widened; what the sealed set must do instead — bounded validation, fail closed before planning/execution, `definition: null` / `testRef.semanticDigest: null`, and **no** invalid definition, offending value or field-level issue detail persisted or exposed — is asserted in full by Task P7.4 Step 3a's two tests above. No longer an open item. **One sub-conjunct is deferred, and the deferral is itself RECORDED, OWNER-ACCEPTED and NON-BLOCKING (2026-09-21):** the `migration-failed` arm is **structurally unreachable** while `DEFINITION_SCHEMA_VERSION === 1` (the `[1, 1)` older-version window is empty; P2's V2 classifies every non-newer value as `invalid-schema-version`) and **no phase owns a definition-migration registry, error class or operation**. The milestone owner dispositioned this on 2026-09-21: `migration-failed` **stays** in the forward-compatible failure taxonomy as a reserved, DISTINCT `PLANNING_CAUSES` member; AC-16's migration-failure coverage (clauses (iii)/(iv)) is **deferred until a real definition migration path exists**; **no definition-migration seam is to be added solely to make it reachable**; and **this deferral must not block the core-engine implementation plan, Task P7.11 core acceptance or G-PLAN** — Step 3 of P7.11 accepts this specific deferral and must not report it as a plan defect. Step 3a keeps `'migration-failed'` a reserved, distinct `PLANNING_CAUSES` member and invents neither a host-facing `definitionMigrations` option nor an internal sentinel error to fake it. **Re-open trigger:** an older definition schema / `DEFINITION_SCHEMA_VERSION > 1` plus an owning phase, at which point Step 3a gains the three arms it names — a lower-version definition whose registered migration **throws**, one whose migration **produces an invalid definition**, and one with **no** registered migration ⇒ `migration-failed` — under the resolution order **preflight version → migrate → `validateTest`** | — |
| AC-17 mixed reachable/unreachable owner | T1 + T2 | P3 `planning/rootResolution.test.mjs` (`unreachablePopulation` and `unattributable` recorded **orientation-independently**, `element-unresolvable` vs the claim-blocking `no-fragments` record — AC-17 (g)), P3 `planning/owners.test.mjs` (the root-only / unreachable-only / **mixed** owner classes — AC-17 (a)), P5 `results/status.test.mjs` (the `mixed-owner-provenance` caveat, `not-required` for unreachable-only and hierarchy-internal owners, `undetermined` with `required: null` for a foreign owner, and a **mixed owner still required**), P5 `results/resultSet.merge.test.mjs` (the `mixedOwnerProvenance` flag on the projected result), P5 `results/claim.test.mjs` (claim false); **P7 `integration/realWorldProvenance.test.mjs::mixed-owner orientations over a real CollisionWorld (AC-17 b)` (both orientations, every `900` pair present *or* absent, `mixedOwnerProvenance` flag, `950` `not-required`, engine-bound `canClaimNoClashes`, digest stability across broad phases and input order, **plus the root-only negative control** that stops a caveat-everything build passing) and `::a mixed owner's library result is identical whichever of its fragments produced the hit (AC-17 f)`** (P7.8 Step 12) | the (d) comparison conjunct → **P8**; (e) property test and (g) unattributable stay with P3/P4/P5 | — |
| AC-18 target fan-out bounded before the first call | T1 + T2 (+T3) | P3 `planning/sizing.test.mjs` ((a)–(c): source packing target vs the hard target cap, explicit entries cut between roots, a whole sentinel never partitioned, over-cap entries becoming `not-run:target-too-large` gaps with **zero** calls, and sizing options changing chunking but never coverage — each case repeated under input reordering), P6 `run/progress.test.mjs` (the preplanned `target-too-large` gap adopted at plan completion and **never issued** — V16, AC-18 (b) at run level); **P7 `integration/realWorldProvenance.test.mjs::sliced target fan-out bounds every call's diagnostic volume (AC-18 d)` (per-call `targets`-length and target-weight caps; raw `statistics.diagnostics` partitioned on the library's own `scope` field — fragment-scoped ≤ the unit's own source+target weight, call-scoped bounded by the reason vocabulary rather than fan-out; projection ≤ `maxDiagnosticsPerOutcome` with exact sealed accounting) and `::negative control: one un-sliced call receives the whole federation's diagnostic volume (AC-18 d)` (one call, volume ≥ the six sliced counts, identical `pairSetDigest` across both cap settings)** (P7.8 Step 13) | (e) T3 informational → performance harness | — |
| AC-19 epoch cache, placement contention, geometry readiness | T1 + T2 | P4 `execution/localExecutor.errors.test.mjs` (the injected `CapacityExceededError{kind:'bucket-capacity'}` row with `capacityDetails` `{currentSize, missing, limit}` — the (b) executor half; the **input-only** `call-wide-unique-fragment-precheck` row — (d); `ModelPlacementChangedError` with an unchanged generation ⇒ retryable `failed:stale-placement` and a moved generation ⇒ `discarded:input-changed` — the (d′) executor half — P4 check 12), P6 `run/progress.test.mjs` (the retry protocol on P4's outcome shape: retry to `maxPlacementRetries` with `attempts = cap + 1`, `placement-contention` derived **by P5**, a moved generation never a retry — V17/V27, the (d′) run half; and a non-splittable `bucket-capacity` unit sealing `environmentSensitiveCauses: ['bucket-capacity']` — the (b) run half), P5 `results/resultSet.outcome.test.mjs` (`environmentSensitiveCauses` exact, ascending and driving the boolean, empty for a clean run — so an input-only cause never sets the flag, (d)), P7 `integration/differential.test.mjs::determinism, 10 runs, same world / fresh worlds` ((c): the AC-6 determinism assertions are made only for `environmentSensitive === false` runs); **P7 `integration/realWorldEnvironment.test.mjs::dirty world: an unrelated direct-caller admission changes only admissionBaseline (AC-19 a)` (identical `pairSetDigest`/`ledgerDigest`, `environmentSensitive === false` in both, `provenance.admissionBaseline` strictly greater per touched model, `capacity-exceeded` asserted absent so it cannot drift into the (b) arm) and `::geometry readiness: an unavailable render proxy is caveated, never silently missing (AC-19 e)` (render-proxy gate; `geometryReadinessOccurrences ≥ 1`, `geometry-readiness` cause, `integrity: caveated`, affected element `covered-caveated`, `canClaimNoClashes` false, `getFreshness` still `current`; the differing pair **correlated** to its own `geometry-not-yet-available` caveat — M2 — against a reference from a separate clean fixture, plus a gate-open negative control)**, **`::equal admissionBaseline, different membership: the flag follows the outcome, not the baseline (AC-19 b′)`** (P7.8 Step 17a — three worlds over one 20,020-fragment model layout, both dirty buckets driven to the real `maxCollisionInstancesPerEpoch` by direct `findClashes` priming that differs only in *which* 20 ids it caches: `deepEqual` `admissionBaseline`, world 1 `completed`/`full`/`environmentSensitive === false` reproducing the fresh world's `pairSetDigest` **and** `ledgerDigest`, world 2's unit `failed:capacity-exceeded` with `capacityKind: 'bucket-capacity'` and `capacityDetails` `{currentSize, missing, limit}`, `environmentSensitiveCauses: ['bucket-capacity']`, `coverage: partial`, `canClaimNoClashes` false — plus the mandatory negative control that a baseline-only oracle returns the same key for both runs and therefore misclassifies one), **`::foreign placement contention: a direct-caller growth bump on every attempt exhausts maxPlacementRetries (AC-19 d′)`**, **`::a foreign growth bump that clears on a retry adds no cause and equals the quiet run (AC-19 d′)`**, **`::a direct-caller invalidateModelPlacement is the same foreign fact as a growth bump (AC-19 d′)`** and **`::negative control: a host-signalled placement change is discarded:input-changed, never placement-contention (AC-19 d′)`** (P7.8 Step 17b — the **T2** half: a real `CollisionWorld` and the AC's own actor, a **direct-caller growth** bump (a nested, re-entrancy-guarded direct `findClashes` over a spare owner, one per outer call, landed through the library's own `yieldToScheduler`) on every attempt of a `broadPhase: 'tlas'` unit — `failed:stale-placement` with `failure.attempts = maxPlacementRetries + 1`, `placement-contention`, `coverage: partial`, `canClaimNoClashes` false, `registry.bindingFor` `placementGeneration` **unchanged**, unit-`b` pairs equal per `unitId` against a quiet control with a non-empty-strict-subset guard; the cleared retry equal to the quiet run on both digests; the explicit-invalidation form asserted to be the same foreign fact; and the host-signalled control separating the identical library call by the engine-owned generation alone)** (P7.8 Steps 15–17b) | the `compareResultSets` **sub-conjuncts** of (b), (d′) and (e) → **P8** (the core ships no comparison surface; `engine.compareResultSets === undefined` is asserted in Task P7.6) — and nothing else. **(b′) and (d′)'s T2 arm are closed in-core by owner order (2026-09-21)**, replacing the two open dispositions the H1 sweep recorded in this cell: (b′) has **no** `compareResultSets` conjunct and is now covered end-to-end by Step 17a; (d′)'s T2 arm is now Step 17b's family F6, with the P4/P6 rows above remaining the normative T1 owners of the outcome mapping and the retry protocol. The (d′) and (b) conjuncts that survive the deferral are only their `compareResultSets(quiet, contended)` / `compareResultSets(fresh, dirty)` clauses; Steps 17a/17b assert the two sets' underlying facts individually instead (per-`unitId` pair equality and each set's own sealed outcome), never through a comparison surface the core does not ship | — |
| AC-20 hierarchy-internal exclusions through the claim helper | T1 + T2 | P3 `planning/rootResolution.test.mjs` (the `hierarchyInternal` classification and its scope), P3 `planning/planner.test.mjs` (ruling R2: an `A ∩ B` root with ≥ 2 owners recoverable from the **persisted** ledger alone, the marker distinguishing `'A'`/`'B'`/`'C'` — the AC-20 (c) element-level half), P5 `results/claim.test.mjs` (truth table × acceptance), P5 `results/status.test.mjs` (`getPairStatus` ⇒ `not-required` with reason `hierarchy-internal`, and element status from the persisted `cls` with an empty `examples` list — AC-20 (c)); **P7 `engine/claim.test.mjs::a hierarchy-accepted run is allowed-but-qualified, and the boolean stays false` (both engine configurations, per-set non-retroactivity, `recordRef` validation)** | — | **G-OQ16** blocks *enabling* an acceptance in a Host build; both branches are tested in core regardless |
| AC-21 settlement precedence | T1 + T2 | P6 `run/settlement.test.mjs` (table-driven over the §16.7 matrices A/B/C: dense distinct ranks, every fact pair in both orders, equal-rank tie-break by ascending cause code, `secondaryCauses` distinct/ascending/capped — with `::secondaryCauses is distinct, ascending, and capped at 8` asserting that the surviving 8 are the **first 8 distinct causes in canonical order** and that the dropped tail still reaches `RunOutcome.reasons` (register S-P6-C3, spec erratum **A7**, owner-clarified Option A: the truncation is deterministic and expected, and `RunOutcome.reasons` stays the complete record — carried by `classifyUnitSettlement`'s uncapped `observedCauses`) — and order B — V1/V2), P6 `run/lifecycle.test.mjs` (matrix C for an in-flight unit settling under a pending cancel, run for **both** a user cancel and `engine.dispose()` — V8; the same facts in every delivery order producing a byte-identical sealed set — V9; the exactly-once terminal event and the forced finalize window — V13), P6 `run/scopeConsequences.test.mjs` (reload ⇒ gap + `stale` + continue **vs** `notifyPlacementChanged` ⇒ `invalidated`, compared through `bindingsEquivalent` — V21, the §16.7 consistency clause; drift ⇒ `invalidated` with the drifted unit merging nothing — V20), P6 `run/progress.test.mjs` (the progress parts — V14); **P7 `integration/realWorldEnvironment.test.mjs::model eviction mid-run settles the unit model-evicted and the engine never evicts or disposes (AC-21)` and `::world disposal mid-run seals failed, and still failed with a cancel already pending (AC-21)`** (P7.8 Step 17 — mid-*call* facts injected through `CollisionWorld`'s own `yieldToScheduler`; this arm proves the **real** library raises the two facts P6's matrix assumes and that they reach the seal, and asserts the matrix's prediction for the rows it triggers. **P6 `run/settlement.test.mjs` remains the normative table**; P7 re-enumerates no part of it) | — | — |

---

## Verification / acceptance for P7

| # | Check | Command | Maps to |
|---|---|---|---|
| 1 | Engine construction, limits, registry join/mismatch, dispose idempotence | `node --test test/clashtest/engine/construction.test.mjs` | §18, AC-8 (shared registry), AC-16 (dispose) |
| 2 | Definition surface, listings, `StoreNotConfiguredError` | `node --test test/clashtest/engine/definitions.test.mjs` | §5.5, §13.5 listing contract, AC-1 |
| 3 | `deleteTest` two-layer order and the NH3 bypass matrix | `node --test test/clashtest/engine/deleteTest.tombstone.test.mjs` | §5.5, §13.5, AC-1 |
| 4 | `startRun` overloads, synchronous error contract, queue admission (`RunQueueFullError`, slot rollback, in-flight not counted), queued-run cancellation settling `done`, `getRun`/`getResultSet`, and the §5.5 stored-reference validation arms (Step 3a: the reachable `definition-invalid`/`schema-unsupported` causes asserted as the **exact** sealed row `[{phase:'queued', cause}]`, the `schemaVersion: 0` boundary, pairwise distinctness against P3's `PLANNING_CAUSES`, fail-closed before planning/execution, `definition: null` / `testRef.semanticDigest: null`, a **proven-persisted** copy (`persistence.state === 'saved'`) carrying no offending value or field-level issue detail in the sealed **or** persisted set per owner disposition **A1**, and the `maxValidationIssues` hand-down observed **at engine level** — `::createClashTestEngine builds its stored-definition resolver with the engine effectiveLimits` wraps a **public `createClashTestEngine`** call in the internal, non-barrel `withStoredDefinitionValidator(validate, fn)` seam and sees the **resolver the engine constructed** receive `resolveEngineLimits({maxValidationIssues: 5})` during a real `startRun`, not the default 100 — so a divergent inline default-limit path on the public constructor cannot pass — with the direct-factory test `::the engine resolver hands its RESOLVED maxValidationIssues to the definition validator` retained as the narrower factory-level claim, and neither claim resting on a standalone `validateTest` call or a read counter; `migration-failed` is an **unreachable** cause in this build, kept as a reserved DISTINCT `PLANNING_CAUSES` member, and its coverage is a **recorded, owner-accepted, non-blocking deferral** (2026-09-21) that does not gate this row) | `node --test test/clashtest/engine/startRun.test.mjs` | §18, §13.5.2, §17.1, §5.5, AC-7, AC-16 |
| 5 | Residency, persistence, retention, `DisposeSummary`, and disposal **signal-then-wait** — a controllably blocked in-flight unit that stays pending while it drains and then seals (§10.1: not abandoned), a queued run sealed without ever running, a never-settling `put` force-closed at its finalize window, concurrent-dispose idempotence | `node --test test/clashtest/engine/residency.test.mjs` | §13.5.1, §13.5.2, §10.1–§10.2, AC-11, AC-16 |
| 6 | Freshness/claim surface, raw-set entry rules, unknown-`digestVersion` refusal through the engine-bound path | `node --test test/clashtest/engine/claim.test.mjs` | §8.3, §13.6, §16.4, AC-8, AC-11, AC-20 |
| 7 | `rerun` promise contract and sealed `derivedFromRunId` lineage | `node --test test/clashtest/engine/rerun.test.mjs` | §15.3, AC-11 (R21-1) |
| 8 | Differential suite (4 modes × 4 selection shapes, partition/broad-phase invariance, same-model negative control, determinism, library-call conformance) — the oracle is **exact** on every clean run, both time-sensitive modes included (M2) | `node --test test/clashtest/integration/differential.test.mjs` | §15.1, §19.2, AC-3, AC-4, AC-5, AC-6 |
| 8a | Real-world provenance and fan-out: mixed reachable/unreachable owner in both orientations with a root-only negative control, the F3 no-fragment-identity library fact, sliced diagnostic stress with per-call scope-partitioned bounds, and the un-sliced fan-out negative control | `node --test test/clashtest/integration/realWorldProvenance.test.mjs` | §6.2, §6.4, §12.5 rule 6, AC-17 (b, f), AC-18 (d) |
| 8b | Real-world environment and lifecycle: cancellation mid-plan with the per-`unitId` evaluated-subset comparison (non-empty strict subset asserted), dirty-world `admissionBaseline`, geometry readiness with a **correlated** oracle plus a clean negative control, world disposal and model eviction mid-run, **equal `admissionBaseline` / different membership at the real 20,000-instance ceiling with the baseline-only-oracle negative control (Step 17a)**, and **a direct-caller *growth* bump exhausting `maxPlacementRetries`, the growth that clears on a retry, the explicit-invalidation form, and the host-signalled `discarded:input-changed` negative control (Step 17b)** | `node --test test/clashtest/integration/realWorldEnvironment.test.mjs` | §1.3.5, §1.3.6, §7.5, §10.2, §13.1, §15.1, §16.7, AC-7, AC-19 (a, b′, d′, e), AC-21 |
| 9 | Maximum-shape round trip, deterministic slicing structure (yields, bounded per-slice cadence, no unsliced size-dependent work), and span durations **recorded with no wall-clock threshold** (the calibrated budget assertion is G-CAL's) | `node --test test/clashtest/integration/maximumShape.test.mjs` | §13.6, §17.1, §17.3, AC-11, AC-12 |
| 10 | Public export surface, no side effects, deferred surfaces absent, and P7's internal engine seams (`createStoredDefinitionResolver`, `withStoredDefinitionValidator`) asserted absent from the barrel by name | `node --test test/clashtest/engine/exports.test.mjs` | §18, §21.3 |
| 11 | Whole suite, clean checkout, no server/credentials/network | `npm test` | §21.3, master DoD 2 |
| 12 | Exact-cover property test (P3, re-run as a DoD gate here) | `node --test test/clashtest/planning/planner.property.test.mjs` | AC-2, master DoD 5 |
| 13 | AC traceability table walked; every *in core* row's test exists and passed | Task P7.11 Step 3 | master DoD 3 |
| 14 | CHANGELOG entry, README pointer, `clashtest/README.md`, handoff updated | manual review of the four files | §21.3, master DoD 6 |

---

## Spec coverage

| Spec § | Task |
|---|---|
| §5.5 definition lifecycle at the engine (`saveTest`/`getTest`/`archiveTest`/`deleteTest`, stored-reference admission) | P7.3, P7.4 |
| §8.3 claim rule, engine-bound forms | P7.6 |
| §13.5 `ResultStore` port wiring, `tombstoneTest` ordering, listing exposure | P7.3, P7.5 |
| §13.5.1 persistence promises (`done`/`persisted`/`getPersistenceState`/`retryPersist`) | P7.5 |
| §13.5.2 residency, retain/release/discard, nonresident ids, dispose | P7.5 |
| §13.6 capture-first entry rules, read slots, producer/reader invariant | P7.6, P7.7, P7.9 |
| §15.1 determinism contract per mode, `environmentSensitive` scoping | P7.8 |
| §15.2 comparability preconditions (reported, not asserted) | P7.7 |
| §15.3 rerun | P7.7 |
| §16.2 `invalidateModelPlacement` | P7.6 |
| §16.4 engine-bound `getFreshness` | P7.6 |
| §17.1 / §17.1.1 engine-limit validation and defaults at the constructor | P7.2, P7.9 |
| §17.3 span classes (which spans are sliced vs. which are only measured) — P7.9 proves the **slicing structure** of the first class and records the durations of both; the calibrated `span ≤ frame budget` comparison is **G-CAL's** | P7.9 |
| §18 `createClashTestEngine` wiring and the engine method list | P7.2–P7.7 |
| §19.1 / §19.2 single-query surface unchanged; the mapping | P7.8 |
| §21.3 CHANGELOG, README pointer, handoff, credential-free `npm test`, sibling module | P7.10, P7.11 |
| §22 AC traceability | AC traceability section, P7.11 |
| master §2.1 cross-phase interface rules | P7.1 |
| master §5 Definition of Done | P7.11 |

---

## Gates and open items

### Gates that block a task of THIS phase

| Gate | Blocks | Effect on P7 |
|---|---|---|
| **G-PLAN** | Start of implementation of every task | Authoring and plan review proceed; no code until the milestone owner records "core-only". |
| **G-CAL** | *Freezing* the ceilings Task P7.9 runs at — not the task | P7.9 ships with `PROVISIONAL_SHAPES` and env overrides, and its recorded spans/bytes are G-CAL's **input**. When G-CAL closes, the numbers move into `clashtest/options.js` (P0) and P7.9 reruns unchanged. **Nothing in P7.9 asserts a wall-clock budget:** Step 6 asserts slicing *structure* only — yield/checkpoint occurrence, bounded per-slice work-item cadence, and the absence of size-dependent unsliced work — and records every span duration without comparing it to anything, `RUN_OPTION_DEFAULTS.frameBudgetMs` included. The calibrated `span ≤ frame budget` assertion, on a calibrated environment profile, is part of **this gate's** work package, not of the functional core suite. **Also this gate's, added 2026-09-21: Task P7.8 Step 17a's cost guard.** That arm runs at the **real** `maxCollisionInstancesPerEpoch` (20,000) ceiling and keeps it unconditionally; if its runtime exceeds the practical threshold (**~10 s** for the arm alone on the reference machine), the overrun is **classified as a G-CAL calibration concern** and reported as a verification/calibration item — **never** resolved by weakening or replacing the test with a smaller-fixture or injected-limit variant, nor by dropping to a T1 injection, which cannot express AC-19 (b′) at all. This gate does **not** block Step 17a: the arm runs, and only its measured cost is G-CAL's input. |
| **G-OQ4** | The T3 arms of AC-6 and all of AC-15 | P7 never runs a live Viewer; the differential suite uses `makeRealWorldFixture`'s tree-derived enumerator. Those AC rows stay *deferred with owner*. |
| **G-OQ16** | *Enabling* a qualified claim in a Host build | P7.6 tests both branches (`hierarchyInternalAcceptance` `null` and `{recordRef}`); nothing in the core is blocked. |
| **G-REMOTE** | The ambiguous-commit conjuncts of AC-11 | P7 wires a local transactional store only; a `put` rejection ends the attempt. See Open item 1. |

No gate blocks Tasks P7.1–P7.8, P7.10 or P7.11.

### Implementation-level items deliberately left to implementers

1. **Ambiguous-commit reconciliation is not wired in the core engine.** §13.5's `PersistenceOutcomeUnknownError` → one reconciliation `get` → `reconcileTimeoutMs` loop exists for remote backends (excluded, G-REMOTE). The core keeps the port's transactional contract and treats every `put` rejection as the end of the attempt (`failed`, set `held`). *Reason:* the observable safety invariants — never evict an unsaved set, `persisted` always settles, `done` never rejects, `discardRun` chains the delete after settlement — hold unchanged without the loop, and a distributed protocol deserves its own design (convergence §2). The typed error and its port-conformance case stay in P5 so a remote backend can be added without a core change.
2. **`StoreNotConfiguredError` is raised by exactly the store-requiring methods.** §18 lists the error but no normative section names its raisers. P7 raises it from `saveTest`/`getTest`/`listTests`/`archiveTest`/`deleteTest` (`store: 'testStore'`) and `listResults` (`store: 'resultStore'`), only when the host passed an explicit `null`. Every other method keeps its already-specified no-store behavior (`persist` ⇒ `skipped`/`no-store`; `getResultSet` ⇒ `null`; `discardRun` ⇒ release only). *Reason:* the simplest mechanism that makes "no store" a visible, typed failure rather than a silent one.
3. **Overload discrimination is structural.** `{testId}`/`{testId, revision}` is a reference; anything else is a direct definition. §5.3's scope rule (ii) fixes this; the implementer chooses the exact predicate but not its observable outcome.
4. **`retentionReport()`'s exact fields.** §17.2 requires "slotsInUse and per-set class"; P7 adds `cap` and `readSlotsInUse` because the residency and read-backpressure tests need them. Implementers may add more fields; the four above are contract.
5. **Run-id generation.** `crypto.randomUUID()` where available, else ≥122 bits of `crypto.getRandomValues` (§13.5). The choice is the implementer's; collision-resistance is contract.

### Items absent from the core engine object (recorded, not invented)

- **`annotate` and `derivations` are absent from the engine object** — not stubbed, not throwing a typed error. §18 lists both, but §14.5 annotation is an excluded follow-up and §14.2–§14.4 derivations are P8 (master §1.2). P7 deliberately does **not** invent a `NotSupportedInCoreError`: the core ships an object without those keys, `exports.test.mjs` pins their absence, and P8 (plus the annotation follow-up) adds them by extending `createClashTestEngine`'s returned object. A host that needs `summarize`/`groupBy`/`filter`/`compareResultSets` before P8 lands has no core-supplied path — that is the stated consequence of the master's deferral, and it is why the master's DoD does not require P8.
- `createDerivationContext` is likewise not exported from `clashtest/index.js` in P7.
- **Settled by the controller (OPEN-3):** this is the ruling, not a P7 preference. The core ships without both keys, `exports.test.mjs` pins their absence, **and Task P8.8 legitimately edits that test** when it adds `derivations` and `createDerivationContext` (Task P7.10 Step 1 states it at the test itself). P7 reserves no key and exposes no internal `isDisposed()` seam for P8; a later phase that needs one adds it by extending the returned object, which is an additive change to `engine.js` that P7's own suites must still pass.

### Open cross-phase items raised by the 2026-09-21 H1 traceability sweep (recorded, not invented)

The sweep regenerated the AC traceability table from the per-phase `Create` inventories and found three §22 conjuncts with **no** named test anywhere. Each is written into the table's *Deferred*/*Gated* cell and repeated here so the controller sees them in one place. **Status as of 2026-09-21: item 1 is RESOLVED by owner disposition A1** (an applied spec amendment, not a plan-level workaround), and the narrower coverage matter inside it — the `migration-failed` arm — was **dispositioned by the owner on the same date as a recorded, accepted, non-blocking deferral**; **items 2 and 3 are RESOLVED by owner order — both closed in-core as Task P7.8 Steps 17a and 17b** (families F4c and F6). **No item in this section is an outstanding owner decision, and nothing in it blocks the plan, P7.11 core acceptance or G-PLAN.**

1. **AC-16, stored-reference issues carrier — ✅ RESOLVED 2026-09-21 by owner disposition A1 ("Option 2"). No longer open; kept here as the record.** The item was: §22 AC-16 required the four stored-reference failures to record "at most 20 `{path, code}` issues", which had no home in P5's closed sealed `PlanningGap` (`{phase, cause}`), leaving only "widen P5" or "read the AC as satisfied by the synchronous error". **The milestone owner chose neither** and instead authorized a narrow spec amendment (spec errata row **A1**, §5.5 + §22 AC-16; reconciliation register entry **S-P7-5**, the one **APPLIED** erratum there; master §8): the durable field-level recording is **removed**, and **P5's `PlanningGap` shape is unchanged and is not widened by any phase.** The replacement contract — validate with bounded work (`maxValidationIssues` scan bound), fail closed **before** planning or collision execution, seal `failed` with `definition: null` / `testRef.semanticDigest: null`, persist **no** invalid definition, offending value or field-level (`path`/issue-code) detail, and keep `definition-invalid` / `schema-unsupported` / `migration-failed` distinguishable — is asserted in full by **Task P7.4 Step 3a**. **One narrower matter survived, and it is coverage rather than schema — it was dispositioned by the owner on the same date and is now a RECORDED, OWNER-ACCEPTED, NON-BLOCKING DEFERRAL:** the `migration-failed` arm is **structurally unreachable** in this build (`DEFINITION_SCHEMA_VERSION === 1` ⇒ the `[1, 1)` older-version window is empty; P2's V2 makes every non-newer value `invalid-schema-version`) and **no phase owns a definition-migration registry, error class or operation** — mirroring P5's identical Result-Set precedent. The milestone owner's 2026-09-21 disposition: `migration-failed` **remains** part of the forward-compatible failure taxonomy as a reserved, DISTINCT `PLANNING_CAUSES` member; AC-16's migration-failure coverage (clauses (iii)/(iv)) is **deferred until a real definition migration path exists**; **no definition-migration seam may be added solely to make it reachable**; and **the deferral must not block the core-engine implementation plan, Task P7.11 core acceptance or G-PLAN** (P7.11 Step 3 accepts it by name). Step 3a keeps the reserved-member assertion, invents no `definitionMigrations` option and no internal sentinel error, and writes down both the three arms to add and the resolution order (**preflight version → migrate → `validateTest`**) the future build must use. **No owner decision is outstanding on either the carrier or the deferral;** the deferral re-opens by itself only when an older definition schema / `DEFINITION_SCHEMA_VERSION > 1` and an owning phase exist.
2. **AC-19 (b′), equal count / different membership — ✅ RESOLVED 2026-09-21 by owner order: closed in-core. No longer open; kept here as the record.** The item was: no phase named a test for it, and — unlike (b), (d′) and (e) — its spec text contains **no** `compareResultSets` conjunct, so the P8 deferral did not reach it. The owner ordered it closed inside the core plan, and it is now **Task P7.8 Step 17a** (family F4c), test `equal admissionBaseline, different membership: the flag follows the outcome, not the baseline (AC-19 b′)` in `test/clashtest/integration/realWorldEnvironment.test.mjs`. It is realized at **T2**, not T1: an injected `CapacityExceededError` cannot express the AC at all, because the equal-and-yet-different *membership* is a library fact (`admitCollisionInstances` admits on `currentSize + genuinely-new ids`) that a fake makes into the test's own fiction. `maxCollisionInstancesPerEpoch` is a module constant with no `fromViewer`, query or `RunOption` override (verified), so the arm reaches the real 20,000-instance ceiling — which is exactly the condition AC-19 (b) already states for its own T2 form; Step 17a carries the cost guard and the negative control. **No owner decision is outstanding**; the only surviving deferral in the AC-19 row is the `compareResultSets` sub-conjuncts of (b), (d′) and (e) → P8.
3. **AC-19 (d′) at T2 — ✅ RESOLVED 2026-09-21 by owner order: closed in-core. No longer open; kept here as the record.** The item was: spec §22 states the foreign-placement-contention arm "in T2 a real `CollisionWorld` whose placement revision is bumped … on every attempt", while the plan realized it only at **T1** over fakes (P4 `localExecutor.errors`, P6 `run/progress` V17/V27) and Task P7.8's real-world families did not include a placement-contention arm. The owner ordered the sixth family added: it is now **Task P7.8 Step 17b** (family **F6**) with four tests — `foreign placement contention: a direct-caller growth bump on every attempt exhausts maxPlacementRetries (AC-19 d′)`, `a foreign growth bump that clears on a retry adds no cause and equals the quiet run (AC-19 d′)`, `a direct-caller invalidateModelPlacement is the same foreign fact as a growth bump (AC-19 d′)` and `negative control: a host-signalled placement change is discarded:input-changed, never placement-contention (AC-19 d′)` — in the same file. It uses only public seams (a nested direct `world.findClashes` **growth** call landed mid-call through `worldOptions.yieldToScheduler`, which is the actor the frozen AC names; `world.invalidateModelPlacement` and `engine.invalidateModelPlacement` for the two discriminator arms) and adds no fixture option. The first draft of this step used explicit invalidation as the *primary* bump; an independent `codex-advisor` consult (2026-09-21) correctly flagged that AC-19 (d′) and §1.3.5 both specify a direct-caller **growth**, and the step was revised before this item was marked resolved. **P4 and P6 remain the normative T1 owners** of the outcome mapping and the retry protocol; F6 re-enumerates neither. **No owner decision is outstanding**; the `compareResultSets(quiet, contended)` clause stays deferred to P8 and Step 17b asserts the two sets' underlying facts individually instead.

### Controller rulings recorded here that need no P7 change

- **R2 / OPEN-2 — the sealed ledger's per-root class marker. ✅ SETTLED 2026-09-21: owner-confirmed, and the spec side applied as erratum A9** (§5.6 item 2 defines the v1 row `{rootDbId, ownerDbIds, cls}`; §13.1 names `rootOwners` incl. `cls` in the `ledgerDigest` enumeration; `schemaVersion` stays 1). The ruling is that sealed-ledger rows carry **`cls`**. That is a change to the *digested* `Ledger` shape P5 pins (`rootOwners` rows) and to what P3 emits; **P7 changes nothing**, because no P7 module reads the ledger's physical layout — `engine.js` never touches `rootOwners`, and the only reader anywhere is P5's `readLedger` (**D4**). P7's `integration/maximumShape.test.mjs` synthesizes ledger records through `maximumShapeSet`, so it inherits whatever shape P5 validates; the AC traceability rows for AC-17 and AC-20 are unaffected.
- **OPEN-4 — `COMPARE_TOLERANCE_DEFAULTS`.** The ruling is that these live in **P0's `clashtest/options.js`**, like every other default, rather than in P8's `derive/compare.js`. **No P7 change follows**: comparison is deferred to P8, `compareResultSets` is absent from the core surface and `exports.test.mjs` pins that absence. Recorded only so that Task P7.1's Step 5 defaults sweep (and any later reviewer) reads the master's single-defaults rule as covering these two numbers, not as having been quietly narrowed to spec §17.1's list.

### Spec items that look contradictory — reported, not resolved

1. **`rerun`'s error delivery: "throws" vs. "rejects" — ✅ SETTLED 2026-09-21 (register S-P7-1, spec erratum A8, owner-authorized). Kept here as the record.** §15.3 and §13.1 both said a pre-resolution base set "**throws** `InvalidOptionsError('no-embedded-definition')`", and §17.1.1 said option validation "throws `InvalidOptionsError{issues}` **synchronously** — from `startRun`/`rerun`". But §18's `rerun` line (R21-1) and AC-11's "`rerun` contract (R21-1)" both require every capture/validation/option/admission failure to **reject** the returned Promise so callers handle one shape, and §13.6's "Uniform entry rules (R19-1)" makes the same requirement general. P7 followed §18/§13.6/AC-11 (reject), and **the milestone owner authorized that reading as spec erratum A8: the "throws" wording at §15.3 / §13.1 / §17.1.1 is corrected to Promise rejection for `rerun`.** `startRun`'s synchronous throw is untouched (OPEN-1, confirmed the same date — item 5 below). **No P7 test or implementation step changes:** `rerun`'s failures were already written as rejections (`engine/rerun.test.mjs`, e.g. `::a ResultCapacityError at admission rejects the rerun promise (it does not throw)`), and only `startRun` is asserted to throw synchronously (P7.4).
2. **The §17.1.1 hard ceilings are jointly unreachable.** Taking every ceiling at once gives `SCHEMA_MAX_NODES = 35×956,824 + 12×20,000,000 + 12×100,000 + 65,536 = 274,754,376` nodes, and `274,754,376 × 32 B ≈ 8.2 GiB` (spec erratum A11, 2026-09-24; was `24×1,000,000 + … = 265,265,536` ≈ 7.9 GiB), far above `maxStoredResultBytes`'s own 1 GiB ceiling — so an engine configured at the ceilings fails §13.6's producer/reader invariant and cannot start a run. AC-11 already hedges ("a maximum-shape run at each hard ceiling **that option validation accepts**"), so this is a consistency note rather than a defect: "maximum shape" means the largest *invariant-satisfying* configuration, which is exactly why Task P7.9 parameterizes its shapes. The shipped defaults are self-consistent (`15,685,536 ≤ 16,000,000` nodes under A11, was 14,585,536; `512,000,000 ≤ 536,870,912` bytes) and Task P7.9 Step 1 pins that arithmetic as a test.
3. **`RunQueueFullError` is unreachable at the default `maxQueuedRuns`.** §18 says it is thrown "only when a configured `maxQueuedRuns` lower than slot capacity is reached; otherwise refusal is always `ResultCapacityError`", and §17.1 defaults `maxQueuedRuns = maxResidentResultSets − 1`. Since a queued run occupies a slot and the coordinator runs one at a time, the queue can hold at most `maxResidentResultSets − 1` runs — exactly the default — so at defaults the slot check always fires first and `RunQueueFullError` never occurs. It is reachable only with an explicitly lower `maxQueuedRuns`. **Controller ruling R6 fixes where the check lives:** it is **P7's**, in the synchronous admission prefix of `startRun`/`rerun`, measured as `coordinator.queueDepth(engineId)` over runs *waiting* (the in-flight run is not counted); **the world coordinator enforces no queue limit of its own**, because `maxQueuedRuns` is a per-engine limit and two engines sharing a world must not consume one another's queue budget. The ordering `reserveRunSlot` → queue check is what makes §18's sentence true without a special case, and a failed queue admission **rolls the reservation back atomically** (`releaseRunSlot`). P7.4 tests all three halves: the reachable `RunQueueFullError` at a lowered `maxQueuedRuns`, the rollback under repeated refusal, and the in-flight-run-not-counted depth. No behavior change is proposed.
4. **`StoreNotConfiguredError` has no normative raiser.** See Open item 2 above — reported as under-specification, resolved at plan level by the narrowest reading.
5. **`startRun` throws while `rerun` rejects — settled, not a defect (controller ruling R1, and CONFIRMED by the milestone owner 2026-09-21 as OPEN-1 Option A).** `startRun` returns a `RunHandle`, not a Promise, so every one of its failures (definition capture/validation, option validation, slot admission, queue admission) is a **synchronous throw**; §13.6's R19-1 "uniform entry rules" bind only the Promise-returning entry points, which is the reading OPEN-1 confirms. `rerun`, `saveTest`, `getResultSet`, `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `discardRun` and `retryPersist` all **reject**. P7.2 pins the split on the disposed surface, P7.4 pins the throwing half and P7.7 the rejecting half, so the asymmetry is executable rather than a note.
6. **Master §7's AC → phase summary did not match spec §22's numbering — FIXED.** Eight rows were mismapped (AC-2, AC-4, AC-5, AC-6, AC-9, AC-14, AC-15, AC-18). Per the master's own footnote ("confirmed against spec §22 during P7 task 1"), the cross-phase reconciliation pass **replaced master §7** with a pointer to the AC traceability table above plus a corrected per-AC primary-phase list. **The table in this phase file remains the authority**; master §7 is now explicitly subordinate to it and no longer restates a per-test mapping. Not a spec issue: spec §22's numbering was always correct and was never in doubt — the defect was entirely in the master plan's summary.

---

## Conformance check

A mechanical sweep closing the plan-conformance pass on this file. The two Codex reviews of the P5 and P6 plans found the same defect class in both: the *Consumes* blocks had been reconciled while the **executable** steps — test code, implementation code, verification lists — still called the pre-reconciliation API. P7 was the most exposed file in the plan, because it is the only phase that consumes every other phase. This section records the sweep so a later reviewer re-runs it rather than re-deriving it.

### (a) What the executable steps were re-written against

Every cross-phase call, import and assertion in this file was checked against the **producing** phase's current `## Phase interface summary` (P0–P8) and against [`interface-reconciliation.md`](interface-reconciliation.md). P5's and P6's summaries were re-read at the end of this pass, after their own concurrent remediations landed, and this file follows their **current** text — notably P6's `RunSpec`, which has **no `store` field**, carries `internalErrorOutcome` / `statisticsAccumulator` / `deriveUnitTaints`, and whose `plannerPort` now also carries `createRecordBudget` / `createLedger` / `checkScopeBracket`.

| Where | Was (consumer-assumed) | Now (producer's declaration) | Row |
|---|---|---|---|
| P7.2 test | `createModelRegistry({now})` | `createModelRegistry({world})` — `world` required, no clock option | N11 |
| P7.2 test, P7.4 test | issue paths as bare key names | JSON pointers (`/maxResidentResultSets`) | P0 `options.js` |
| P7.2 impl | positional `new ModelBindingError(reason, details)` | `assertRegistryBelongsToWorld(registry, world)`; every error class takes **one object argument** | N1 |
| P7.2 impl | `createLocalUnitExecutor({world})`, called through a method | all six deps; the executor **is** the function | N26 |
| P7.2 impl | one long-lived shared slicer | `newSlicer()` per sliced operation; labels are per call | N6 |
| P7.2 impl | — | `createReadCoordinator`, `createDefinitionOperations` and the `onPersistence` fan-out added | N23, N28 |
| P7.3 impl | P7 re-deriving the §5.5 rules | delegation to P2 `createDefinitionOperations`; only `listResults` + `deleteTest` stay P7's | N28 |
| P7.3 Consumes | a definition-shaped capture in P0 | P2 `captureAndValidate` / `validateReference` / `toDefinitionError` / `classifyStartRunArgument` | N29 |
| P7.4 Consumes | `resolveRunOptions(input, {limits})`; `maxQueuedRuns` as a run-option cross-field rule | `resolveRunOptions(input, limits?)` positional; `maxQueuedRuns` is an **engine**-limit rule | N31 |
| P7.4 impl | a P7-local overload predicate, a P0 run-input capture, a slot `admit`, a coordinator hand-off by method | `classifyStartRunArgument` → `captureAndValidate`/`validateReference` → `resolveRunOptions(…, limits)` → `reserveRunSlot` → `admitToQueue` → `createRun(spec).begin()` → `handle` | N25, N29, N31, N23 |
| P7.4 Consumes | `createRun(spec) → {handle, begin()}`; a `RunSpec` with no `derivedFromRunId`, and a `buildRunSpec` that passed one anyway | `createRun(spec) → {handle, begin(), controller}`; **`derivedFromRunId` is a declared `RunSpec` field** and `buildRunSpec` writes it on both entry points | N33 |
| P7.5 impl | a coordinator-wide drain and a residency-wide dispose | `stopAdmitting(engineId)` + awaiting this engine's own `handle.done` + `drainForDispose()` | N23, N25 |
| P7.5 impl | `stopAdmitting` then straight to `await handle.done` — no per-run disposal signal existed | **signal then wait:** `controller.requestDispose()` for **every** owned run (queued, in-flight, persisting) *before* the first await, then `drainForDispose()` | N33 |
| P7.6 impl | engine-local read-slot helpers; `captureResultSet(input, limits)`; an awaited `validateResultSet` | `reserveSync()` / `acquire()`; `captureResultSet(raw, {limits})`; **`readResultSet`** as the one rejecting path | N23, N29, N30 |
| P7.6 impl | the placement delegate pointing at the host-facing half | `registry.invalidateModelPlacement(modelKey)` — P1's §16.2 single call | P1 summary |
| P7.7 impl | positional `new InvalidOptionsError([issues])`; a residency slot-return helper invented for this path | one object argument; `releaseRunSlot` | N1, N23 |
| P7.8 support | `makePairId(source, target, {mode})` and a `.key` on the result | `makePairId(mode, x, y)`; a `PairId` is `{first, second}` and the suite keys it with `canonicalJson` | N13 |
| P7.9 harness | a P0 per-set node counter; a local worst-case formula; a single `result-unreadable` issue code | `worstCaseCapturedNodes`; `measuredNodes` over `captureData(...).nodes`; `reason` vs. the two issue codes | P0 summary |

Superseded code and every "read X as Y" translation note were **deleted**, not annotated: the file now states only the API that exists.

### (b) The mechanical sweep

Run from the repository root. Each name is a *consumer-assumed* spelling from the reconciliation register's name table (or a P7-local invention this pass removed); the requirement is **zero** hits in this file.

This section names the removed spellings in order to record them, so the sweep must **exclude this section** or it would find its own checklist. `BODY` below is the file up to (but not including) the `## Conformance check` heading — that is, every part of the plan an implementer actually executes.

```sh
cd docs/superpowers/plans/federated-clash-test-core
sed '/^## Conformance check$/,$d' p7-engine-integration.md > /tmp/p7-body.md

# 1. Removed identifiers, literal match.
for n in digestOf digestSync ownKeysOf readOwnValue prototypeIsPlain runSliced checkpoint \
         pairSemanticsForMode pairSemantics captureDefinition createResultSetDraft mergeUnit \
         recordPlanningGap startPersistence aggregateDiagnostics readDiagnostics buildScopeExpect \
         activeRunIds submit 'drain()' classOf handBackUnsaved attachSealed disposeAll abandon \
         capacityKind nodeCountOf acquireById acquireRawOrFail captureRunInput validateTestPure \
         captureOptions readThrough 'admit({' 'spec.store'; do
  printf '%s\t%s\n' "$(grep -c -- "$n" /tmp/p7-body.md)" "$n"
done

# 2. Removed call/member shapes, regex match.
for p in '\.execute\b' '\.key\b' 'resolveRunOptions\([^)]*\{ *limits' 'residency\.admit' \
         '\{ *maxCapturedNodes *\}' '\bstep\(' 'resolveForRun[^)]*\)\.state' \
         'registry\.notifyPlacementChanged'; do
  printf '%s\t%s\n' "$(grep -cE -- "$p" /tmp/p7-body.md)" "$p"
done

# 3. Positional construction of a clashtest error (N1 forbids it).
grep -nE "new [A-Za-z]*Error\((\[|')" /tmp/p7-body.md

# 4. Every fenced JS block still parses.
python3 - <<'PY' && for f in /tmp/p7-blocks/b*.mjs; do node --check "$f" || echo "FAIL $f"; done
import re, os
os.makedirs('/tmp/p7-blocks', exist_ok=True)
src = open('p7-engine-integration.md').read()
for i, b in enumerate(re.findall(r'```js\n(.*?)```', src, re.S)):
    open(f'/tmp/p7-blocks/b{i}.mjs', 'w').write(b)
PY
```

**Result (run 2026-09-20, after every edit of this pass):** every name in lists 1 and 2 returns **`0`**. List 3 returns exactly three lines, all of them native JavaScript errors that the N1 convention does not govern — two `new TypeError('createClashTestEngine: … is required')` guards in the constructor and one `new Error('backend down')` inside a test double. No `clashtest/errors.js` class is constructed positionally anywhere in this file.

Three near-miss matches were inspected and cleared rather than "fixed", because the token is legitimate in its context and is **not** the register's removed spelling:

- **`{state, reasons}`** (3 occurrences) — the `Freshness` DTO of R3/N19, not N27's `resolveForRun` field. The lifecycle discriminant is spelled `status` at all three of its uses.
- **`seen`** (4 occurrences) — a local array in the `discardRun` test double, not N2's `ModelKeyVersionConflictError` field.
- **`.code`** (7 occurrences) — all of them `issue.code` on P2's `Issue = {path, code, message}`. The error discriminant this file branches on is `error.reason` (N1).

### (c) Verified against the reconciliation's duplicate-ownership decisions

| | Single owner | How P7 conforms |
|---|---|---|
| **D1** scope bracket | expectation + comparator + fold in **P3** | P7 builds no expectation and owns no comparator; the fold reaches P4 by direct import and P6 through `plannerPort.checkScopeBracket` |
| **D2** lease gate | per-unit in **P4**, run-start sweep in **P6** | P7 wires no lease check and calls `world.isLeaseValid` nowhere |
| **D3** diagnostics | all aggregation in **P4** | one `diagnosticAggregator` per run in `RunSpec`; no aggregation function pair, no P5-side aggregation |
| **D4** status readers | **P5 `results/status.js`** | `index.js` re-exports `getPairStatus`/`getElementStatus` from P5; no reader is wired into `RunSpec`; P8 re-exports the same two |

### (d′) Targeted alignment pass — P5/P6 re-verification reviews (2026-09-21)

A second, **bounded** pass over this file only, applying three cross-phase decisions from the P6 and P5 re-verification Codex reviews. Nothing else in the file was reopened; the design spec is frozen and was not edited.

| Review finding | Decision applied | Where in this file |
|---|---|---|
| P6 finding 3 — `engine.dispose()` cannot cancel or force-finalize runs through the published interfaces (and its Question 4, "is indefinite drain accepted?") | P6 exposes the engine-only **`RunController = {requestDispose(): Promise<RunSummary>}`** beside the handle, never reachable *from* it (P6 C3). P7's `dispose()` signals **every** owned run — queued ones, which P6 seals as pre-resolution cancelled sets, and in-flight/persisting ones — **before** awaiting any `done`, then calls `drainForDispose()`. That bounds every wait the **engine** owns (queue, unit boundary, seal, `persistTimeoutMs` finalize window). **Indefinite drain of an in-flight unit remains accepted**, exactly as P6 answers its Question 4 and as frozen §10.1–§10.2 / F6 (*drain, not discard*) require: `dispose()` and `done` may stay pending while an injected executor has not returned, and that is P6 open item **O9**, an injected-port limit with no new timer — not a P7 defect and not something the signal is meant to remove. An earlier draft of this file claimed the opposite; it was wrong against both the frozen design and P6, and is corrected here. | Phase interface summary (`#dispose`), P7.2 (`ownRuns`), P7.4 Consumes + impl, P7.5 Consumes + impl + four tests |
| P6 finding 7 — `derivedFromRunId` is consumed but absent from `RunSpec` | `derivedFromRunId: string\|null` becomes a declared `RunSpec` field; `buildRunSpec` writes `input.derivedFromRunId ?? null`, `startRun` omits it and `rerun` passes the base set's `runId`. | P7.4 Consumes + impl, P7.7 impl + `::rerun lineage survives the RunSpec…` |
| P5 finding 2 — an unknown digest version can still pass the claim predicate (and its Question 2, "which component owns it?") | **The claim predicate is the normative owner** (P5 adds the `digests.digestVersion === DIGEST_VERSION` conjunct and a `{kind:'digest-version', reason:'unknown-digest-version'}` qualifier); P6 freshness may refuse the same input independently, never as a substitute. P7 adds no rule of its own and contributes the **engine-bound** proof, on an empty-results completed-clean set rather than the positives fixture, asserting the *qualifier* so it cannot pass for a freshness reason. | P7.6 Consumes + `::an unknown digestVersion is never claimable through the ENGINE-bound path` |

Two P6 questions this pass also answers from P7's side: **Question 3** (the normative order of runtime split descendants) is P6/P5's — P7 wires no ranking and asserts none. **Question 4** is answered above, and P7 now states the *same* answer P6 does rather than contradicting it: signal-then-wait bounds every engine-owned wait, while an in-flight unit is still drained — so an executor that never returns leaves `dispose()`/`done` pending, an accepted injected-port limit (P6 O9).

**Producer summaries re-read at the end of this pass**, after P6's and P5's own concurrent remediations landed, and this file follows their **current** text. Two of this pass's working assumptions were wrong and were corrected against it: (1) the controller is **not** installed on the handle as a non-enumerable property — P6's C3 makes `RunHandle` exactly its six public members and the controller reachable **only** from the `createRun` return value, so `ownRuns` is the one place P7 can keep it; (2) freshness is **not** required to stay `current` for an unknown `digestVersion` — P5 declares its read-time `unverifiable` a second, independent refusal path, so the engine-bound test asserts P5's `digest-version` **qualifier** instead of a freshness state. Names this file now depends on, all verified present in the producers' tables: `createRun(spec) → {handle, controller, begin()}`, `RunController.requestDispose()`, `RunSpec.derivedFromRunId`, `resolveRunStatus({disposeRequested:true}) === 'cancelled'`, `collectReasons` ⇒ `'engine-disposed'`, and P5's `{kind:'digest-version', reason:'unknown-digest-version'}` qualifier.

**Sweep re-run 2026-09-21** over the body of this file after every edit of this pass: lists 1 and 2 return **`0`** for every name, and list 3 returns the same three native-error lines recorded above. All 21 fenced `js` blocks pass `node --check`, and the `dispose()` block was additionally **executed** against stubs — two runs whose `done` settles only when signalled, i.e. the queued/boundary/finalize-window waits the engine owns — confirming it settles for those, signals each run exactly once, and is idempotent; with the `requestDispose()` line removed the same harness hangs, so the signal is load-bearing rather than decorative. It is **not** a claim that `dispose()` settles while an in-flight unit's executor has not returned: §10.1 drains that unit and P6's O9 accepts the wait.

### (d) Not closed by this pass

- **R2 / OPEN-2 (`cls` on sealed-ledger rows)** needs the edit in **P5** (the pinned `Ledger.rootOwners` typedef), **P3** (what it emits) and **P8** (which may stop falling back to `hierarchyInternal.examples`). No P7 module reads the ledger's physical layout, so no P7 edit follows.
- **OPEN-4 (`COMPARE_TOLERANCE_DEFAULTS` into P0 `options.js`)** needs the edit in **P0** and **P8**; P7 records the ruling only, because comparison is absent from the core surface.
- **The terminal status and `RunOutcome.reasons` of a *disposed* run are P6's §16.7 ruling, and P7 consumes them rather than deciding them.** P6's landed text fixes both: `resolveRunStatus({disposeRequested: true})` is **`'cancelled'`** and `collectReasons` contributes **`'engine-disposed'`**, so `engine/residency.test.mjs` asserts exactly those two names plus the R5 pre-resolution shape (`definition: null`, `ledger.planExists: false`) for the queued arm — the same shape `engine/startRun.test.mjs` pins for an explicitly cancelled queued run. These are **consumed names**: if P6 renames either, this file's assertions are the drift the next reconciliation sweep must catch, and P7 changes with the owner.
