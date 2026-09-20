# Engine facade, integration, acceptance traceability, docs — Phase P7 Implementation Plan

**Goal:** Assemble the parts P0–P6 built into the one public surface the spec names in §18 — `createClashTestEngine` wiring every port (world, enumerator, registry, unit executor, test store, result store) and exposing the definition, run, residency/persistence, freshness/claim and disposal methods — then prove the assembled engine against the *real* `CollisionWorld` with a differential suite, pin the producer/reader round trip that AC-12's calibration will later freeze, map every spec §22 acceptance criterion to a named test or a named deferral owner, and land the CHANGELOG/README/handoff updates that spec §21.3 requires. P7 owns no algorithm of its own: where it looks like it is deciding something, it is wiring an owner phase's decision and testing the seam.

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
| `ClashTestEngine#dispose` | `clashtest/engine.js` | `() → Promise<DisposeSummary>` | Idempotent, never throws, returns the same promise; `{droppedUnsaved: [{runId, resultSet}], persistenceInFlight: runId[]}`. **Signals before it waits:** `stopAdmitting(engineId)` → `controller.requestDispose()` on **every** owned run (queued *and* in-flight/persisting, P6's engine-only control surface) → `await` their `done` → `residency.drainForDispose()` (Task P7.5). |
| `createClashTestEngine`, `validateTest`, `assessNoClashClaim`, `canClaimNoClashes`, `getPairStatus`, `getElementStatus`, `getFreshness`, `createInMemoryClashTestStore`, `createInMemoryResultStore`, `createLocalUnitExecutor`, `createModelRegistry`, `RUN_OPTION_DEFAULTS`, `ENGINE_LIMIT_DEFAULTS`, every error class | `clashtest/index.js` | re-exports | The single public entry point of the layer, mirroring `collision/index.js`'s pure-re-export convention. **Reconciled sources:** `validateTest` ← P2 `definition/validate.js`; `assessNoClashClaim`/`canClaimNoClashes` ← P5 `results/claim.js`; **`getPairStatus`/`getElementStatus` ← P5 `results/status.js`, never P8 `derive/` (duplicate-ownership D4)**; `getFreshness` ← P6 `run/freshness.js`; **`createModelRegistry` ← P1 `identity/ModelRegistry.js`, a factory P1 added during reconciliation (N11)** — it did not exist when this row was written. P8's Task P8.8 later adds `createDerivationContext` to this list and re-exports the same two status functions it consumes from P5. |

Test-support modules P7 adds to the shared `test/clashtest/support/` tree (P0 owns the directory; later phases add, never fork — master §2.1 rule 5):

| Export | Module | Signature | Meaning |
|---|---|---|---|
| `makeRealWorldFixture` | `test/clashtest/support/realWorld.mjs` | `({models}) → {world, viewer, models: Map<modelKey, Model>, enumerator, registry}` | Builds N mock models (`buildMockModel`) over ONE shared fake viewer, a real `CollisionWorld`, a tree-backed `ElementEnumerator` derived from the same tree, and a populated registry. |
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
| `test/clashtest/support/realWorld.mjs` | Create (P7) | Real-`CollisionWorld` fixture builder for T2 work. |
| `test/clashtest/support/bruteForce.mjs` | Create (P7) | Per-pair reference implementation for the differential suite. |
| `test/clashtest/support/maximumShape.mjs` | Create (P7) | Maximum-shape Result Set synthesizer. |
| `test/clashtest/engine/construction.test.mjs` | Create (P7.2) | Construction, limits, registry join/mismatch, `EngineDisposedError`, dispose idempotence. |
| `test/clashtest/engine/definitions.test.mjs` | Create (P7.3) | `validateTest`/`saveTest`/`getTest`/`listTests`/`listResults`/`archiveTest`, `StoreNotConfiguredError`. |
| `test/clashtest/engine/deleteTest.tombstone.test.mjs` | Create (P7.3) | §13.5 two-layer delete order and the NH3 engine-level bypass matrix of AC-1. |
| `test/clashtest/engine/startRun.test.mjs` | Create (P7.4) | Both overloads, synchronous error contract, `getRun`, `getResultSet`. |
| `test/clashtest/engine/residency.test.mjs` | Create (P7.5) | retain/release/discard/retryPersist/getPersistenceState/retentionReport, `DisposeSummary`. |
| `test/clashtest/engine/claim.test.mjs` | Create (P7.6) | `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `invalidateModelPlacement`, raw-set entry rules. |
| `test/clashtest/engine/rerun.test.mjs` | Create (P7.7) | `rerun` promise contract, capture-first, `definitionRevision`, comparability reporting. |
| `test/clashtest/integration/differential.test.mjs` | Create (P7.8) | Engine-over-real-`CollisionWorld` vs brute force, four modes × four selection shapes. |
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
    testStore: stores.test, limits: effectiveLimits, yieldToScheduler, now,
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
- **P2 `definition/operations.js` — module added by P2, now in the master §2 map (N28).** `createDefinitionOperations({testStore, limits, yieldToScheduler, now}) → {validateTest, saveTest, getTest, listTests, archiveTest}` is the §5-governed definition surface (synchronous capture before the promise, untrusted store reads, `StoreNotConfiguredError`, `CorruptListingError`, the `put` refusal precedence tombstone → archive → revision). **P7's engine delegates to it and does not re-derive §5.5.** `deleteTest` stays P7's, because only P7 knows both stores and owns the two-layer order. P2 also exports `RESOLVE_STATUS_TO_PLANNING_CAUSE = {live:null, archived:'test-archived', deleted:'test-deleted', missing:'test-not-found'}` for P6.
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
  - **`controller` is P6's `RunController` — engine-only, and *never reachable from the handle*** (P6 re-verification C3): `{ requestDispose(): Promise<RunSummary> }`. `RunHandle` has exactly its five public members and no disposal control, enumerable or otherwise, so the **only** way P7 can ever hold a controller is the `createRun` return value. P7 stores it in the engine's own `ownRuns` map (`runId → {handle, controller}`) at the moment `createRun` returns — the map `dispose()` walks (Task P7.5) and the admission rollback deletes from. `requestDispose()` marks `disposeRequested` on committed state, cancels the run at its next boundary, forces the finalize window closed when the run is already past its seal, and resolves with the same `RunSummary` as `done`. **P6 requires P7 to call it for every owned run *before* awaiting that run's `done`** (P6's cross-file need C-P7-1); a `dispose()` that only awaits `done` leaves the run with no `disposeRequested` fact and no forced close.
  - **There is no store field.** The result store is bound into P5's residency manager at construction and reaches the run only through `resultPort.residency`; the `ClashTestStore` reaches it only through the closures `resolveDefinition` / `testIdOfInput` / `planningCauseOf`, which P7 builds over `stores.test`. A run never holds a store object.
  - `validateUnitOutcome` is P4's `(request, outcome) → {ok, issues}` — it **never throws** and always returns both fields — and `internalErrorOutcome(request, issues)` is P4's canonical `failed:internal-error` substitute, which P6 uses on `ok:false` rather than hand-building one.
  - **`diagnosticAggregator`** is one `createDiagnosticAggregator({maxRetainedDiagnostics, maxDistinctReasons, maxUnitIdsPerDiagnostic, slicer})` per run (P4, **D3**) — the single owner of all aggregation — beside `statisticsAccumulator` (`createStatisticsAccumulator()`) and `deriveUnitTaints` (P4). P7 constructs these three and injects nothing else diagnostic-shaped; P6 drives `await addUnit(unitId, outcome)` and `snapshot()`, and supplies `deriveUnitTaints`'s `admit(n)` ledger-budget oracle from P3's budget (N9).
  - `plannerPort = {planRun, materializeUnit, splitUnit, rootsForRanges, createRecordBudget, createLedger, checkScopeBracket}` (P3). **D1 conformance:** the whole bracket is P3's — the expectation is `materializeUnit(plan, unit).scopeExpect`, the comparator is `compareScopeExpectation`, and the fold is `checkScopeBracket`; P4 imports the fold directly and P6 receives it through this port. P7 builds no expectation, owns no comparator and runs no re-digest pass.
  - `resultPort = {createResultAccumulator, buildResultSet, sealResultSet, deriveRunOutcome, residency}` (P5; N21, N22, N24). Persistence runs through `residency.beginPersist(runId, {persist})`; there is no free-standing persistence starter and no draft builder beyond `buildResultSet`.
  - `resolveDefinition` / `planningCauseOf` read P2's `resolveForRun(...).status` through `RESOLVE_STATUS_TO_PLANNING_CAUSE` (P2 `definition/operations.js`), so the §5.5 mapping exists once.
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
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Checkpoint commit (only if the user has authorized commits).**

---

### Task P7.5: Residency, persistence and retention surface

**Files**
- Modify: `clashtest/engine.js`
- Test: `test/clashtest/engine/residency.test.mjs`

**Interfaces**

*Consumes — **RECONCILED** (N23; producer wins):* P5 `residency.js` — **`retainResultSet(runId) → {release()}`**, **`releaseResultSet(runId, {acknowledgeUnsaved})`**, **`discardRun(runId) → Promise<void>`**, `retryPersist(runId) → Promise<PersistenceOutcome>`, `getPersistenceState(runId) → PersistenceSnapshot|null`, **`retentionReport() → object`**, **`drainForDispose() → {droppedUnsaved, persistenceInFlight}`**. The per-set class is already in **`retentionReport().sets[i].class`**, so `engine.retentionReport()` is one call plus `reads.inUse()`, never a per-set loop. `retryPersist` is legal only from `failed`: a nonresident id throws `ResultNotResidentError`, and a resident set in any other state throws `InvalidOptionsError{issues:[{path:'runId', code:'not-failed'}]}` (P5 Gates item 6). P6 `coordinator.stopAdmitting(engineId)` is the dispose-side admission stop, and P6's engine-only **`RunController.requestDispose() → Promise<RunSummary>`** (N33, returned by `createRun` beside the handle and never reachable *from* it) is the per-run disposal *signal*. The engine keeps its own `runId → {handle, controller}` map (`ownRuns`, Task P7.4) so `dispose()` signals and then awaits exactly its own runs — never the world's, and never a run belonging to a second engine over the same world.

*Produces:* `retainResultSet`, `releaseResultSet`, `discardRun`, `retryPersist`, `getPersistenceState`, `retentionReport`, and the engine's `dispose()` contract.

**Steps**

- [ ] **Step 1: Write the failing residency test.**

```js
// test/clashtest/engine/residency.test.mjs (excerpt)
test('retain/release/discard refusals', async () => {
  const engine = createClashTestEngine({ ...base(), resultStore: null });
  const h = engine.startRun(validDef());
  assert.throws(() => engine.discardRun(h.runId), RunNotTerminalError);
  await h.done;
  assert.throws(() => engine.retainResultSet(h.runId), UnsavedResultSetError);  // held, never auto-evicted
  assert.throws(() => engine.releaseResultSet(h.runId), UnsavedResultSetError);
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });
  engine.releaseResultSet(h.runId, { acknowledgeUnsaved: true });               // idempotent no-op
  assert.throws(() => engine.retryPersist(h.runId), ResultNotResidentError);
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

test('dispose terminates with an executor blocked forever: signal first, wait second', async () => {
  // P6 re-verification finding 3 / Question 4: the core accepts NO indefinite drain. This executor
  // never cooperatively returns, so if `dispose()` awaited `done` without first calling
  // `controller.requestDispose()`, this test would hang rather than fail.
  const entered = deferred();
  const unitExecutor = () => { entered.resolve(); return new Promise(() => {}); };  // never settles
  const engine = createClashTestEngine({ ...base(), resultStore: null, unitExecutor });
  const h = engine.startRun(validDef());
  await entered.promise;                                  // the run is INSIDE the unit loop
  const summary = await engine.dispose();
  const done = await h.done;                              // settled, not pending
  assert.equal(done.status, 'cancelled');                 // P6 order B: disposeRequested ⇒ cancelled
  assert.ok(done.resultSet !== null && Object.isFrozen(done.resultSet));
  assert.ok(done.resultSet.outcome.reasons.includes('engine-disposed'));   // P6 collectReasons
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId), [h.runId]); // no store ⇒ handed back
  // The executor promise is deliberately never settled: proving the run is let go of rather than
  // awaited is the whole point, so nothing in this test resolves it.
});

test('dispose seals a QUEUED run that never reached the head of the queue', async () => {
  const unitExecutor = () => new Promise(() => {});        // the head of the queue never finishes
  const engine = createClashTestEngine({
    ...base(), resultStore: null, unitExecutor, limits: { maxResidentResultSets: 4 },
  });
  const inFlight = engine.startRun(validDef());
  const queued = engine.startRun(validDef());              // waits behind it: one in-flight slot per world
  assert.equal(engine.retentionReport().slotsInUse, 2);
  const summary = await engine.dispose();
  const q = await queued.done;                             // settles WITHOUT ever having run
  assert.equal(q.status, 'cancelled');
  assert.equal(q.resultSet.definition, null);              // the R5 pre-resolution cancelled-set shape
  assert.equal(q.resultSet.ledger.planExists, false);
  assert.equal((await inFlight.done).status, 'cancelled');
  assert.deepEqual(summary.droppedUnsaved.map((d) => d.runId).sort(),
    [inFlight.runId, queued.runId].sort());                // BOTH were signalled, not only the in-flight one
});

test('concurrent dispose calls share one promise, one summary and one terminal event per run', async () => {
  const engine = createClashTestEngine({
    ...base(), resultStore: null, unitExecutor: () => new Promise(() => {}),
  });
  const h = engine.startRun(validDef());
  const terminals = [];
  h.subscribe((e) => { if (e.type === 'state' && e.terminal) terminals.push(e); });
  const a = engine.dispose();
  const b = engine.dispose();
  assert.equal(a, b);                                      // the SAME promise object, not an equal one
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
    // signalling all of it before the first await is what makes disposal terminate: a queued run
    // is sealed as a pre-resolution cancelled set without ever reaching the head of the queue,
    // an in-flight run stops at its next cooperative boundary, and a run in its finalize window
    // force-finalizes instead of waiting for a write that may never settle.
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

  **Signal-then-wait is the whole contract, and the order is load-bearing.** `stopAdmitting` only closes the *door*; it says nothing to the runs already inside, so an implementation that goes straight from `stopAdmitting` to `await handle.done` hangs for as long as the slowest run takes — indefinitely when an executor never cooperatively returns or a `put` never settles (P6 re-verification finding 3; it is also the answer this phase gives to that review's Question 4: **the core accepts no indefinite drain**, because every wait is preceded by a signal). `requestDispose()` is P6's engine-only surface, so this path exists without widening `RunHandle`: a host still cannot force-finalize somebody else's run. Three properties P7 relies on and tests: it is **idempotent** (a second `dispose()` returns the stored promise and signals nothing again, and even a redundant signal is a no-op), it **never throws** (so one bad run cannot abort the loop mid-way and strand the rest), and it is **total over the map** — queued, in-flight and persisting runs are signalled alike, because `ownRuns` holds a run from `createRun` until the engine is gone, not only while it is executing.

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

**Files**
- Create: `test/clashtest/support/realWorld.mjs`, `test/clashtest/support/bruteForce.mjs`
- Test: `test/clashtest/integration/differential.test.mjs`

**Interfaces**

*Consumes:* `collision/index.js`'s `CollisionWorld` (public surface only); `test/fixtures/mockInstanceTree.mjs`'s `buildMockModel(rootNodes, fragmentGeometry, options) → {model, stats}`; `test/fixtures/geometry.mjs`'s `box`, `at`, `THREE`. The multi-model plumbing mirrors `test/CollisionWorld.findClashes.crossModel.test.mjs`'s `makeTwoModelFixture` (one shared `viewer.impl.getRenderProxy` dispatching by model identity — `CollisionWorld` holds exactly one `_viewer`).

*Produces:* `makeRealWorldFixture`, `bruteForceReference` (signatures in the Phase interface summary).

**Steps**

- [ ] **Step 1: Write `realWorld.mjs` and the failing same-model differential test.** The fixture's enumerator is derived from the *same* tree definition the mock model was built from, so it is a faithful `ElementEnumerator` without any Viewer (gate G-OQ4 stays out of the way — master §4).

```js
// test/clashtest/integration/differential.test.mjs (excerpt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClashTestEngine } from '../../../clashtest/index.js';
import { makeRealWorldFixture } from '../support/realWorld.mjs';
import { bruteForceReference, pairKey } from '../support/bruteForce.mjs';

// Two models, 3 owners each, deliberately overlapping across and within a model.
const SPEC = {
  a: { 100: [[0, 0, 0]], 200: [[0.5, 0, 0]], 300: [[10, 0, 0]] },
  b: { 100: [[0.25, 0, 0]], 200: [[9.75, 0, 0]] },
};

const MODES = [
  { mode: 'volume-overlap', deterministic: true },
  { mode: 'clearance', clearance: 0.05, deterministic: true },
  { mode: 'surface-intersection', deterministic: false },
  { mode: 'containment', deterministic: false },
];

function assertPairSets(actual, reference, deterministic, diagnostics) {
  if (deterministic) { assert.deepEqual(actual, reference); return; }
  // §15.1: time-sensitive modes promise only that a difference is accompanied by a
  // completeness-affecting caveat -- never a silent flip.
  const symmetricDifference = [
    ...actual.filter((p) => !reference.includes(p)),
    ...reference.filter((p) => !actual.includes(p)),
  ];
  if (symmetricDifference.length > 0) {
    assert.ok(diagnostics.completenessAffectingUpperBound > 0,
      `time-sensitive difference without a completeness-affecting diagnostic: ${symmetricDifference}`);
  } else {
    assert.deepEqual(actual, reference);
  }
}

for (const { mode, clearance, deterministic } of MODES) {
  test(`differential: same-model, ${mode}`, async () => {
    const fx = makeRealWorldFixture({ models: SPEC });
    const engine = createClashTestEngine({ world: fx.world, enumerator: fx.enumerator });
    const def = { schemaVersion: 1, testId: `same-${mode}`, revision: 1, mode, ...(clearance ? { clearance } : {}),
      selectionA: [{ kind: 'model', modelKey: 'a' }], selectionB: [{ kind: 'model', modelKey: 'a' }] };
    const { resultSet } = await engine.startRun(def).done;
    assert.equal(resultSet.outcome.coverage, 'full');
    const ref = await bruteForceReference(fx.world, {
      sources: [['a', 100], ['a', 200], ['a', 300]], targets: [['a', null]], mode, clearance,
    });
    assertPairSets(resultSet.results.map((r) => pairKey(r.pairId)).sort(),
      ref.pairIds, deterministic, resultSet.diagnostics);
  });
}
```

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
- [ ] **Step 7: Add the determinism arm (AC-6 T2).** Ten repeated runs on one world and ten on fresh worlds, `volume-overlap` and `clearance`, asserting identical `pairSetDigest`, `ledgerDigest`, the canonical JSON of `diagnostics.{total, completenessAffectingCount, unclassifiedOccurrences, countsByReason, omittedReasonOccurrences, geometryReadinessOccurrences}` and every unit's `taints` table — and asserting `environmentSensitive === false` first, since the promise is scoped to that (§15.1, AC-19(c)). For `surface-intersection`/`containment` assert only the §15.1 guarantee already encoded in `assertPairSets`.
- [ ] **Step 8: Add the library-call conformance arm (AC-3 tail).** With a recording proxy over `world.findClashes`, assert for every run above: every call uses the `targets` shape, `groupBy: 'dbId'`, exactly one `mode`, `clearance` present iff the mode is `clearance`; peak concurrent in-flight calls is 1; zero calls after a cancel or a terminal seal; and the engine calls neither `evictModel` nor `dispose` on the world.
- [ ] **Step 9: Run it and see it pass.**
- [ ] **Step 10: Checkpoint commit (only if the user has authorized commits).**

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
    `${nodes} > ${ENGINE_LIMIT_DEFAULTS.maxCapturedNodes}`);              // 14,585,536 ≤ 16,000,000
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
- [ ] **Step 6: Add the sliced-span assertion (AC-12(a)).** With a `spanRecorder` injected into the engine, assert every **sliced** span label (`normalize`, `semanticDigest`, `plan`, `merge`, `digest`, `seal`, `validate-result-set`) is ≤ `RUN_OPTION_DEFAULTS.frameBudgetMs` at the `scaled` shape, and that the synchronous path records no `sort`/`dedup`/`normalize`/`digest` span (a spy proving nothing size-dependent hides in it). The capture/validation spans of §17.3(b) are **recorded, not asserted**.
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

test('the public surface is exactly what §18 names for the core', () => {
  for (const name of EXPECTED_FUNCTIONS) assert.equal(typeof api[name], 'function', name);
  assert.ok(api.RUN_OPTION_DEFAULTS && api.ENGINE_LIMIT_DEFAULTS);
  // Deferred surfaces are ABSENT, not stubbed (see the phase file's Gates and open items):
  assert.equal(api.createDerivationContext, undefined);
  assert.equal(api.compareResultSets, undefined);
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
- [ ] **Step 3: Write `clashtest/index.js`.** A pure re-export, in the style of `collision/index.js`'s header comment: no side effects, no `globalThis` read, one `export {…} from` per owning module.
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
  - `node --test test/clashtest/planning/exactCover.property.test.mjs` (P3's exact-cover property test — master DoD item 5)
  - `node --test test/clashtest/integration/differential.test.mjs` (master DoD item 4)
- [ ] **Step 3: Walk the AC traceability table.** For every row marked *in core*, confirm the named test file and test name exist and passed in Step 1. A row whose test does not exist is a plan defect: it is recorded and the owning phase is reopened, never silently reclassified as deferred.
- [ ] **Step 4: Walk the master's Definition of Done (§5) as a checklist.**

| DoD item | Evidence |
|---|---|
| 1. P0–P7 phase acceptance checklists pass | each phase file's final checklist, signed |
| 2. `npm test` green, clean checkout, no credentials/network | Step 1 output |
| 3. Every in-scope §22 AC mapped to a passing named test; excluded ACs listed with owner | the AC traceability table below + Step 3 |
| 4. Differential suite equals brute force for four modes × four selections | Step 2 output |
| 5. Coverage exact-cover property test passes | Step 2 output |
| 6. `docs/handoffs/latest.md`, `CHANGELOG.md`, README pointer updated | Task P7.10 |

- [ ] **Step 5: Record branch, HEAD, exact verification results and final `git status`** in the handoff, per project CLAUDE.md "Before declaring a substantial task complete".
- [ ] **Step 6: Mark the core ready for the independent review gate** in `docs/handoffs/latest.md` (project CLAUDE.md internal-review-loop section). The internal Codex review is not the final acceptance gate.
- [ ] **Step 7: Checkpoint commit (only if the user has authorized commits).**

---

## AC traceability (spec §22)

Every AC-n → where it is satisfied. **In core** = a named test in P0–P7 that `npm test` runs. **Deferred** = an excluded work package (master §1.2) with a named owner. **Gated** = present but its *values* or *evidence* wait on a gate (master §4).

| AC | Tier | In core: test file :: test name | Deferred (owner) | Gated |
|---|---|---|---|---|
| AC-1 definition validation, options, store, tombstone | T1 | P2 `test/clashtest/definition/validate.test.mjs::…` (V-rules, golden digests, capture-at-boundary), P2 `test/clashtest/stores/clashTestStore.test.mjs::…` (revisioning, archive, linearizable `resolveForRun`, tombstone), P0 `test/clashtest/options.test.mjs::…` (§17.1.1), **P7 `engine/deleteTest.tombstone.test.mjs::deleteTest tombstones the result store BEFORE…` and the NH3 bypass paths (a)–(f)** | — | — |
| AC-2 exact cover, hierarchy, scope-digest conformance, tree-unreachable, unresolved selections | T1 | P3 `test/clashtest/planning/exactCover.property.test.mjs`, `planning/hierarchy.test.mjs`, `planning/scopeDigest.test.mjs`, `planning/unreachable.test.mjs` | — | — |
| AC-3 executor port conformance, outcome validation, overflow, library-call conformance | T1 | P4 `test/clashtest/execution/outcomeValidation.test.mjs`, `execution/diagnosticOverflow.test.mjs`, `execution/localUnitExecutor.test.mjs`; **P7 `integration/differential.test.mjs::library-call conformance` (Task P7.8 Step 8)** | — | — |
| AC-4 partition and broad-phase independence | T2 | **P7 `integration/differential.test.mjs::partition and broad-phase independence (AC-4)` + `::negative control: a naive whole-set-vs-itself…`** | — | — |
| AC-5 single-query equivalence | T2 | **P7 `integration/differential.test.mjs::differential: whole-model target, volume-overlap` / `…, clearance` (the `\|A\|=1` arm)** | — | — |
| AC-6 determinism | T2 + T3 | **P7 `integration/differential.test.mjs::determinism, 10 runs, same world / fresh worlds` (T2, `environmentSensitive === false` only)** | T3 reload arm → Viewer-adapter live evidence (never in `npm test`, §22 tier note) | G-OQ4 for the T3 arm |
| AC-7 cancellation | T1 + T2 | P6 `test/clashtest/run/cancellation.test.mjs` (every §10.2 row, immediate pre-resolution cancel, and the **queued**-run cancel that seals a pre-resolution cancelled set — controller ruling R5); **P7 `engine/startRun.test.mjs::cancelling a QUEUED run settles done with a pre-resolution cancelled set (R5)` (the engine-level half: `done` settles rather than hanging) and `integration/differential.test.mjs::a real-world run cancelled mid-plan has an evaluated subset identical to the uncancelled run`** | — | — |
| AC-8 engine-bound claim, source-population bracket, read-time freshness bracket, lifecycle | T1 + T2 | P6 `run/freshness.bracket.test.mjs`, `run/lifecycle.test.mjs`, P3 `planning/scopeDigest.test.mjs`; **P7 `engine/claim.test.mjs::engine-bound claim uses LIVE freshness, never the sealed value`, `::an unknown digestVersion is never claimable through the ENGINE-bound path` (the claim predicate owns the digest-version rule, not freshness — P5 re-verification finding 2) and the shared-registry / cross-engine-invalidation cases of `engine/construction.test.mjs`** | — | G-OQ17 (host placement-invalidation ownership; core tests the engine side) |
| AC-9 progress | T1 | P6 `run/progress.test.mjs`, P3 `planning/split.test.mjs` | — | — |
| AC-10 diagnostics and completeness | T1 + T2 | P4 `execution/diagnostics.test.mjs` (known-reason table + drift test), P5 `results/claim.test.mjs` (every axis × terminal status), P4 `execution/unattributable.test.mjs` | the `compareResultSets` conjuncts (`resolved`, `addedUnverifiedBase`, `removedUnverifiedNext`) → **P8** | — |
| AC-11 serialization and persistence | T1 + T2 | P5 `results/resultSet.seal.test.mjs`, `results/validateResultSet.test.mjs`, `results/inMemoryResultStore.test.mjs` (atomic `put`, identity index, listings, byte guard, tombstone), `results/schemaEvolution.test.mjs`, P6 `run/persistencePromises.test.mjs`; **P7 `engine/rerun.test.mjs` (the R21-1 `rerun` contract, and `::rerun lineage survives the RunSpec…` for the sealed `derivedFromRunId` — P6 re-verification finding 7), `engine/residency.test.mjs` (dispose with a hung write), `integration/maximumShape.test.mjs` (R21-2 producer/reader invariant)** | the ambiguous-commit reconciliation conjuncts (R16-3, R18-2 `reconcileTimeoutMs`, R19-3 post-dispose ambiguity) → **remote-persistence follow-up**; P5 keeps the typed `PersistenceOutcomeUnknownError` and its port-conformance case | G-REMOTE |
| AC-12 memory and span ceilings | T1/T2 gating + T3 characterization | **P7 `integration/maximumShape.test.mjs` (round trip at configurable ceilings; sliced-span assertions; capture spans recorded)** | T3 Audubon characterization (unit count, makespan, frame gaps, `retentionReport` growth) → Viewer-adapter/performance harness, `test/performance/results/` | **G-CAL** — the ceilings the harness runs at are provisional; G-CAL freezes them and the harness reruns unchanged |
| AC-13 grouping, filters, facets, annotation lifecycle | T1 | — | **P8** (grouping/filter/facet/derivation-context parts) and the **annotation follow-up** (`ElementAttributeSource`, `annotate`, `AnnotationBusyError`, snapshot compatibility) | — |
| AC-14 comparison | T1 | — | **P8** (`compareResultSets`, pair-semantics gate, tolerance boundaries, `identityConflicts` classification) | — |
| AC-15 live acceptance on the Audubon fixture | T3 | — | **Viewer-adapter live evidence** (`test/acceptance/clash-test.acceptance.mjs`; never part of `npm test`) | G-OQ4, G-OQ1, G-OQ16 (the (b) arm records the counts OQ-16 needs) |
| AC-16 resident bound and identity enforcement | T1 | P5 `results/residency.test.mjs` (slot property test, classes, LRU, `ResultCapacityError`), P1 `identity/registry.test.mjs` (`ModelBindingError`, `ModelKeyVersionConflictError`, `bindingGeneration`), P5 `results/inMemoryResultStore.test.mjs` (`IdentityConflictError`), P3 `planning/ledgerBudget.test.mjs` (combined ledger ceiling), P2 `stores/storedReference.test.mjs` (`definition-invalid`/`schema-unsupported`/`migration-failed`); **P7 `engine/residency.test.mjs` (nonresident-id table, `DisposeSummary`, hung-write slot exhaustion, and the four disposal-termination cases — `::dispose terminates with an executor blocked forever…`, `::dispose seals a QUEUED run…`, `::dispose forces a hung write's terminal event…`, `::concurrent dispose calls share one promise…` — which together close P6 re-verification finding 3) and `engine/startRun.test.mjs` (synchronous `ResultCapacityError` on both overloads)** | the `annotate`-beyond-limits conjunct → **annotation follow-up** | — |
| AC-17 mixed reachable/unreachable owner | T1 + T2 | P3 `planning/unreachable.test.mjs` (classification, property test), P5 `results/pairStatus.test.mjs` (`mixed-owner-provenance`, `not-required`), P5 `results/claim.test.mjs` (claim false); **P7 `integration/differential.test.mjs::mixed-owner orientations over a real CollisionWorld (AC-17 b, f)`** | the (d) comparison conjunct → **P8** | — |
| AC-18 target fan-out bounded before the first call | T1 + T2 (+T3) | P3 `planning/targetFanout.property.test.mjs` (a)–(c); **P7 `integration/differential.test.mjs::diagnostic stress and the un-sliced negative control (AC-18 d)`** | (e) T3 informational → performance harness | — |
| AC-19 epoch cache, placement contention, geometry readiness | T1 + T2 | P4 `execution/errorTaxonomy.test.mjs` (injected `CapacityExceededError`, `bucket-capacity`, `capacityDetails`), P6 `run/environmentSensitive.test.mjs` (a), (b′), (c), (d), P4 `execution/placementRetry.test.mjs` (d′); **P7 `integration/differential.test.mjs::dirty-world arm (AC-19 a) and geometry-readiness arm (AC-19 e)` over the real world** | — | — |
| AC-20 hierarchy-internal exclusions through the claim helper | T1 + T2 | P3 `planning/hierarchy.test.mjs` (the `hierarchyInternal` table and its scope), P5 `results/claim.test.mjs` (truth table × acceptance); **P7 `engine/claim.test.mjs::a hierarchy-accepted run is allowed-but-qualified, and the boolean stays false` (both engine configurations, per-set non-retroactivity, `recordRef` validation)** | — | **G-OQ16** blocks *enabling* an acceptance in a Host build; both branches are tested in core regardless |
| AC-21 settlement precedence | T1 + T2 | P6 `run/settlement.test.mjs` (table-driven over §16.7 matrix A/B/C, randomized scheduling), P6 `run/lifecycle.test.mjs` (reload-vs-`notifyPlacementChanged` consistency); **P7 `integration/differential.test.mjs::world dispose and model eviction mid-run over a real CollisionWorld`** | — | — |

---

## Verification / acceptance for P7

| # | Check | Command | Maps to |
|---|---|---|---|
| 1 | Engine construction, limits, registry join/mismatch, dispose idempotence | `node --test test/clashtest/engine/construction.test.mjs` | §18, AC-8 (shared registry), AC-16 (dispose) |
| 2 | Definition surface, listings, `StoreNotConfiguredError` | `node --test test/clashtest/engine/definitions.test.mjs` | §5.5, §13.5 listing contract, AC-1 |
| 3 | `deleteTest` two-layer order and the NH3 bypass matrix | `node --test test/clashtest/engine/deleteTest.tombstone.test.mjs` | §5.5, §13.5, AC-1 |
| 4 | `startRun` overloads, synchronous error contract, queue admission (`RunQueueFullError`, slot rollback, in-flight not counted), queued-run cancellation settling `done`, `getRun`/`getResultSet` | `node --test test/clashtest/engine/startRun.test.mjs` | §18, §13.5.2, §17.1, AC-7, AC-16 |
| 5 | Residency, persistence, retention, `DisposeSummary`, and disposal **termination** — blocked executor, queued run, never-settling persistence, concurrent-dispose idempotence | `node --test test/clashtest/engine/residency.test.mjs` | §13.5.1, §13.5.2, AC-11, AC-16 |
| 6 | Freshness/claim surface, raw-set entry rules, unknown-`digestVersion` refusal through the engine-bound path | `node --test test/clashtest/engine/claim.test.mjs` | §8.3, §13.6, §16.4, AC-8, AC-11, AC-20 |
| 7 | `rerun` promise contract and sealed `derivedFromRunId` lineage | `node --test test/clashtest/engine/rerun.test.mjs` | §15.3, AC-11 (R21-1) |
| 8 | Differential suite (4 modes × 4 selection shapes, invariance, determinism, call conformance) | `node --test test/clashtest/integration/differential.test.mjs` | §15.1, §19.2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-17, AC-18, AC-19, AC-21 |
| 9 | Maximum-shape round trip and span budgets | `node --test test/clashtest/integration/maximumShape.test.mjs` | §13.6, §17.1, §17.3, AC-11, AC-12 |
| 10 | Public export surface, no side effects, deferred surfaces absent | `node --test test/clashtest/engine/exports.test.mjs` | §18, §21.3 |
| 11 | Whole suite, clean checkout, no server/credentials/network | `npm test` | §21.3, master DoD 2 |
| 12 | Exact-cover property test (P3, re-run as a DoD gate here) | `node --test test/clashtest/planning/exactCover.property.test.mjs` | AC-2, master DoD 5 |
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
| §17.3 span classes (sliced gating vs. capture measurement) | P7.9 |
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
| **G-CAL** | *Freezing* the ceilings Task P7.9 runs at — not the task | P7.9 ships with `PROVISIONAL_SHAPES` and env overrides, and its recorded spans/bytes are G-CAL's **input**. When G-CAL closes, the numbers move into `clashtest/options.js` (P0) and P7.9 reruns unchanged. Nothing in P7.9 asserts a wall-clock budget. |
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

### Controller rulings recorded here that need no P7 change

- **R2 / OPEN-2 — the sealed ledger's per-root class marker.** The ruling is that sealed-ledger rows carry **`cls`**. That is a change to the *digested* `Ledger` shape P5 pins (`rootOwners` rows) and to what P3 emits; **P7 changes nothing**, because no P7 module reads the ledger's physical layout — `engine.js` never touches `rootOwners`, and the only reader anywhere is P5's `readLedger` (**D4**). P7's `integration/maximumShape.test.mjs` synthesizes ledger records through `maximumShapeSet`, so it inherits whatever shape P5 validates; the AC traceability rows for AC-17 and AC-20 are unaffected.
- **OPEN-4 — `COMPARE_TOLERANCE_DEFAULTS`.** The ruling is that these live in **P0's `clashtest/options.js`**, like every other default, rather than in P8's `derive/compare.js`. **No P7 change follows**: comparison is deferred to P8, `compareResultSets` is absent from the core surface and `exports.test.mjs` pins that absence. Recorded only so that Task P7.1's Step 5 defaults sweep (and any later reviewer) reads the master's single-defaults rule as covering these two numbers, not as having been quietly narrowed to spec §17.1's list.

### Spec items that look contradictory — reported, not resolved

1. **`rerun`'s error delivery: "throws" vs. "rejects".** §15.3 and §13.1 both say a pre-resolution base set "**throws** `InvalidOptionsError('no-embedded-definition')`", and §17.1.1 says option validation "throws `InvalidOptionsError{issues}` **synchronously** — from `startRun`/`rerun`". But §18's `rerun` line (R21-1) and AC-11's "`rerun` contract (R21-1)" both require every capture/validation/option/admission failure to **reject** the returned Promise so callers handle one shape, and §13.6's "Uniform entry rules (R19-1)" makes the same requirement general. P7 follows §18/§13.6/AC-11 (reject) because that is the externally observable contract the acceptance criteria test; the two "throws" phrasings read as pre-R21 residue. Recorded for a spec erratum, not resolved by redesign.
2. **The §17.1.1 hard ceilings are jointly unreachable.** Taking every ceiling at once gives `SCHEMA_MAX_NODES = 24×1,000,000 + 12×20,000,000 + 12×100,000 + 65,536 = 265,265,536` nodes, and `265,265,536 × 32 B ≈ 7.9 GiB`, far above `maxStoredResultBytes`'s own 1 GiB ceiling — so an engine configured at the ceilings fails §13.6's producer/reader invariant and cannot start a run. AC-11 already hedges ("a maximum-shape run at each hard ceiling **that option validation accepts**"), so this is a consistency note rather than a defect: "maximum shape" means the largest *invariant-satisfying* configuration, which is exactly why Task P7.9 parameterizes its shapes. The shipped defaults are self-consistent (`14,585,536 ≤ 16,000,000` nodes; `512,000,000 ≤ 536,870,912` bytes) and Task P7.9 Step 1 pins that arithmetic as a test.
3. **`RunQueueFullError` is unreachable at the default `maxQueuedRuns`.** §18 says it is thrown "only when a configured `maxQueuedRuns` lower than slot capacity is reached; otherwise refusal is always `ResultCapacityError`", and §17.1 defaults `maxQueuedRuns = maxResidentResultSets − 1`. Since a queued run occupies a slot and the coordinator runs one at a time, the queue can hold at most `maxResidentResultSets − 1` runs — exactly the default — so at defaults the slot check always fires first and `RunQueueFullError` never occurs. It is reachable only with an explicitly lower `maxQueuedRuns`. **Controller ruling R6 fixes where the check lives:** it is **P7's**, in the synchronous admission prefix of `startRun`/`rerun`, measured as `coordinator.queueDepth(engineId)` over runs *waiting* (the in-flight run is not counted); **the world coordinator enforces no queue limit of its own**, because `maxQueuedRuns` is a per-engine limit and two engines sharing a world must not consume one another's queue budget. The ordering `reserveRunSlot` → queue check is what makes §18's sentence true without a special case, and a failed queue admission **rolls the reservation back atomically** (`releaseRunSlot`). P7.4 tests all three halves: the reachable `RunQueueFullError` at a lowered `maxQueuedRuns`, the rollback under repeated refusal, and the in-flight-run-not-counted depth. No behavior change is proposed.
4. **`StoreNotConfiguredError` has no normative raiser.** See Open item 2 above — reported as under-specification, resolved at plan level by the narrowest reading.
5. **`startRun` throws while `rerun` rejects — settled, not a defect (controller ruling R1).** `startRun` returns a `RunHandle`, not a Promise, so every one of its failures (definition capture/validation, option validation, slot admission, queue admission) is a **synchronous throw**; §13.6's R19-1 "uniform entry rules" bind only the Promise-returning entry points, which is the reading OPEN-1 confirms. `rerun`, `saveTest`, `getResultSet`, `getFreshness`, `canClaimNoClashes`, `assessNoClashClaim`, `discardRun` and `retryPersist` all **reject**. P7.2 pins the split on the disposed surface, P7.4 pins the throwing half and P7.7 the rejecting half, so the asymmetry is executable rather than a note.
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
| P6 finding 3 — `engine.dispose()` cannot cancel or force-finalize runs through the published interfaces (and its Question 4, "is indefinite drain accepted?") | P6 exposes the engine-only **`RunController = {requestDispose(): Promise<RunSummary>}`** beside the handle, never reachable *from* it (P6 C3). P7's `dispose()` signals **every** owned run — queued ones, which P6 seals as pre-resolution cancelled sets, and in-flight/persisting ones — **before** awaiting any `done`, then calls `drainForDispose()`. **Indefinite drain is not accepted.** | Phase interface summary (`#dispose`), P7.2 (`ownRuns`), P7.4 Consumes + impl, P7.5 Consumes + impl + four tests |
| P6 finding 7 — `derivedFromRunId` is consumed but absent from `RunSpec` | `derivedFromRunId: string\|null` becomes a declared `RunSpec` field; `buildRunSpec` writes `input.derivedFromRunId ?? null`, `startRun` omits it and `rerun` passes the base set's `runId`. | P7.4 Consumes + impl, P7.7 impl + `::rerun lineage survives the RunSpec…` |
| P5 finding 2 — an unknown digest version can still pass the claim predicate (and its Question 2, "which component owns it?") | **The claim predicate is the normative owner** (P5 adds the `digests.digestVersion === DIGEST_VERSION` conjunct and a `{kind:'digest-version', reason:'unknown-digest-version'}` qualifier); P6 freshness may refuse the same input independently, never as a substitute. P7 adds no rule of its own and contributes the **engine-bound** proof, on an empty-results completed-clean set rather than the positives fixture, asserting the *qualifier* so it cannot pass for a freshness reason. | P7.6 Consumes + `::an unknown digestVersion is never claimable through the ENGINE-bound path` |

Two P6 questions this pass also answers from P7's side: **Question 3** (the normative order of runtime split descendants) is P6/P5's — P7 wires no ranking and asserts none. **Question 4** is answered above: signal-then-wait, no indefinite drain in the core.

**Producer summaries re-read at the end of this pass**, after P6's and P5's own concurrent remediations landed, and this file follows their **current** text. Two of this pass's working assumptions were wrong and were corrected against it: (1) the controller is **not** installed on the handle as a non-enumerable property — P6's C3 makes `RunHandle` exactly its five public members and the controller reachable **only** from the `createRun` return value, so `ownRuns` is the one place P7 can keep it; (2) freshness is **not** required to stay `current` for an unknown `digestVersion` — P5 declares its read-time `unverifiable` a second, independent refusal path, so the engine-bound test asserts P5's `digest-version` **qualifier** instead of a freshness state. Names this file now depends on, all verified present in the producers' tables: `createRun(spec) → {handle, controller, begin()}`, `RunController.requestDispose()`, `RunSpec.derivedFromRunId`, `resolveRunStatus({disposeRequested:true}) === 'cancelled'`, `collectReasons` ⇒ `'engine-disposed'`, and P5's `{kind:'digest-version', reason:'unknown-digest-version'}` qualifier.

**Sweep re-run 2026-09-21** over the body of this file after every edit of this pass: lists 1 and 2 return **`0`** for every name, and list 3 returns the same three native-error lines recorded above. All 21 fenced `js` blocks pass `node --check`, and the `dispose()` block was additionally **executed** against stubs — two runs whose `done` settles only when signalled — confirming it terminates, signals each run exactly once, and is idempotent; with the `requestDispose()` line removed the same harness hangs, so the signal is load-bearing rather than decorative.

### (d) Not closed by this pass

- **R2 / OPEN-2 (`cls` on sealed-ledger rows)** needs the edit in **P5** (the pinned `Ledger.rootOwners` typedef), **P3** (what it emits) and **P8** (which may stop falling back to `hierarchyInternal.examples`). No P7 module reads the ledger's physical layout, so no P7 edit follows.
- **OPEN-4 (`COMPARE_TOLERANCE_DEFAULTS` into P0 `options.js`)** needs the edit in **P0** and **P8**; P7 records the ruling only, because comparison is absent from the core surface.
- **The terminal status and `RunOutcome.reasons` of a *disposed* run are P6's §16.7 ruling, and P7 consumes them rather than deciding them.** P6's landed text fixes both: `resolveRunStatus({disposeRequested: true})` is **`'cancelled'`** and `collectReasons` contributes **`'engine-disposed'`**, so `engine/residency.test.mjs` asserts exactly those two names plus the R5 pre-resolution shape (`definition: null`, `ledger.planExists: false`) for the queued arm — the same shape `engine/startRun.test.mjs` pins for an explicitly cancelled queued run. These are **consumed names**: if P6 renames either, this file's assertions are the drift the next reconciliation sweep must catch, and P7 changes with the owner.
